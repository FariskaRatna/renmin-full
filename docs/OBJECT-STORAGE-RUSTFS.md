# Object storage dengan RustFS — panduan dan rencana

Status: **rencana, belum dikerjakan** (2026-11-06). Butuh keputusan pemilik
sistem soal waktu pelaksanaan (lihat §1).

## 0. Posisi sekarang

Semua file disimpan di Postgres sebagai `BYTEA`:

| Tabel | Kolom | Batas ukuran | Terenkripsi? | Kode Express |
|---|---|---|---|---|
| `sdl_urmin_incoming_attachments` | `body` | — | tidak | `modules/urmin/surat-masuk.js` |
| `sdl_subbagren_evidence` | `body` | 5 MiB | **ya**, envelope `SDL1` AES-256-GCM | `modules/subbagren/budget.js` |
| `sdl_unit_work_files` | `file_data` | ±6 MiB/request | tidak | `modules/unitwork/work.js`, `outgoing-review.js` |
| `sdl_leadership_directive_files` | `file_data` | **100 MiB** | tidak | `modules/directives/attachments.js`, `draft.js` |
| `sdl_urmin_disposition_files` | `body` | — | tidak | `modules/urmin/dispositions.js` |
| `sdl_users` | `avatar_jpeg` | kecil | tidak | `auth/profile.js` (**tetap di DB**, tidak dipindah) |

Batas 100 MiB di file arahan adalah alasan paling kuat untuk object storage:
satu baris seukuran itu membengkakkan `pg_dump`, WAL, dan memori proses Node
(seluruh file dibaca ke `Buffer`).

Ukur dulu sebelum memutuskan (DBeaver, koneksi read):

```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

## 1. Syarat waktu — kenapa BUKAN sekarang

Selama Go dan Express hidup bersamaan, object storage tidak bisa dipasang
dengan aman:

- Baris yang filenya sudah di RustFS **tidak bisa dibaca Go** (Go hanya kenal
  `body`). Kalau Caddy masih mengarahkan satu prefix ke Go, pengguna melihat
  file rusak.
- Menulis fitur ini di dua backend sekaligus melanggar aturan migrasi 3
  (perbaiki setelah paritas) dan merusak perbandingan golden-file.

**Urutan yang benar:** Fase 2 cutover selesai → Go dimatikan → baru object
storage, **hanya di Express**. Kontrak API tetap tidak berubah: endpoint,
field, dan status code sama persis; yang berubah hanya tempat byte disimpan.

Langkah A (infrastruktur) boleh dikerjakan lebih awal karena tidak menyentuh
aplikasi.

## 2. Langkah A — menjalankan RustFS (satu VM, berdampingan)

### A.1 Versi

RustFS masih proyek muda. Sebelum memasang, cek tag terbaru di Docker Hub
(`rustfs/rustfs`) dan catatan rilisnya; **pin versi persis**, jangan `latest`
— sama dengan aturan `postgres:18.6-alpine3.24`. Uji dulu di laptop.

### A.2 Compose override `infra/compose.rustfs.yaml`

```yaml
services:
  rustfs:
    image: rustfs/rustfs:<VERSI-PERSIS>
    restart: unless-stopped
    environment:
      RUSTFS_ACCESS_KEY: ${SDL_RUSTFS_ROOT_USER:?define SDL_RUSTFS_ROOT_USER}
      RUSTFS_SECRET_KEY: ${SDL_RUSTFS_ROOT_PASSWORD:?define SDL_RUSTFS_ROOT_PASSWORD}
      RUSTFS_ADDRESS: "0.0.0.0:9000"
      RUSTFS_CONSOLE_ENABLE: "true"
      RUSTFS_CONSOLE_ADDRESS: "0.0.0.0:9001"
    volumes:
      - sdl_root_rustfs_data:/data
    ports:
      # Console hanya di loopback -> buka lewat SSH tunnel, sama seperti DBeaver.
      - "127.0.0.1:9001:9001"
    # API S3 (9000) TIDAK diekspos ke host: hanya api-express yang memakainya,
    # lewat network internal.
    cap_drop: ["ALL"]
    security_opt: ["no-new-privileges:true"]
    networks: [internal]
volumes:
  sdl_root_rustfs_data:
```

Nama env var di atas mengikuti dokumentasi komunitas; cocokkan dengan
dokumentasi resmi untuk versi yang dipin. Kalau kontainer gagal start karena
`cap_drop`, tambahkan kembali capability satu per satu secara sadar, jangan
membuang semuanya.

`.env` tambahan (secret, buat dengan `openssl rand -hex 24`):

```
SDL_RUSTFS_ROOT_USER=sdl_rustfs_root
SDL_RUSTFS_ROOT_PASSWORD=...
```

Jalankan dengan menambahkan `-f infra/compose.rustfs.yaml` ke `$CF`.

### A.3 Bucket dan kredensial aplikasi

Buka console lewat tunnel: `ssh -L 9001:127.0.0.1:9001 devops@172.16.173.34`,
lalu `http://localhost:9001` di laptop. Login dengan root user di atas.

1. Buat bucket **`sdl-files`**. Biarkan **private** (tanpa akses anonim).
2. Buat **access key khusus aplikasi** dengan policy hanya untuk bucket itu
   (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` pada
   `arn:aws:s3:::sdl-files` dan `arn:aws:s3:::sdl-files/*`). Aplikasi
   **tidak pernah** memakai root user.
3. Simpan di `.env`: `SDL_S3_ENDPOINT=http://rustfs:9000`,
   `SDL_S3_BUCKET=sdl-files`, `SDL_S3_ACCESS_KEY=...`, `SDL_S3_SECRET_KEY=...`.

## 3. Langkah B — integrasi di Express (setelah Go mati)

### B.1 Migrasi baru (file baru, bukan mengedit yang lama)

Untuk kelima tabel file:

```sql
ALTER TABLE <tabel> ADD COLUMN storage_key TEXT;
ALTER TABLE <tabel> ALTER COLUMN <body|file_data> DROP NOT NULL;
ALTER TABLE <tabel> ADD CONSTRAINT <tabel>_payload_check
  CHECK ((<body|file_data> IS NULL) <> (storage_key IS NULL));
```

Constraint terakhir menjamin setiap baris punya **tepat satu** sumber data.

### B.2 Aturan desain

- **Kunci objek = UUID acak**, bukan nama file asli (nama file bisa memuat
  informasi sensitif dan karakter aneh). Nama asli tetap di kolom DB.
- **Semua file dienkripsi aplikasi sebelum diunggah** dengan envelope yang sama
  dengan evidence (`SDL1` + nonce + AES-256-GCM). Kunci terpisah,
  `SDL_FILE_KEY` (64 hex), berbeda dari `SDL_AUTH_SECRET` dan
  `SDL_EVIDENCE_KEY`. Evidence tetap memakai `SDL_EVIDENCE_KEY` agar record
  lama tetap terbaca (batasan keras 7). Akibatnya: disk atau backup RustFS
  yang bocor tidak terbaca tanpa `.env`.
- **Otorisasi tetap di SQL.** File tetap dilayani lewat endpoint API yang
  sudah ada: query ber-RBAC dulu, baru ambil objek. **Tidak ada presigned URL
  ke browser**, karena presigned URL melewati otorisasi dan menambah host yang
  harus dijangkau browser.
- **Urutan tulis:** unggah objek dulu → `INSERT` baris dalam transaksi →
  kalau transaksi gagal, hapus objeknya (best effort). Objek yatim yang
  tersisa dibersihkan job harian (objek tanpa baris dan berumur > 24 jam).
- **Urutan hapus:** hapus baris dulu, objek dihapus belakangan oleh job yang
  sama. Dengan begitu tidak pernah ada baris yang menunjuk ke objek hilang.
- **Baca:** `storage_key` ada → ambil dari RustFS; kalau tidak → `body` lama.
  Selama backfill, keduanya harus berfungsi.
- **Streaming:** untuk file sampai 100 MiB, alirkan objek ke response
  (`pipeline`), jangan `Buffer.concat` seluruh isi. Konsekuensinya, enkripsi
  per-file tunggal tidak bisa di-stream; pakai envelope ber-chunk, atau terima
  bahwa file dibaca utuh ke memori (sama dengan perilaku sekarang).
- Library: `@aws-sdk/client-s3` dengan `forcePathStyle: true`.

### B.3 Pengujian wajib

- Harness golden-file: `compare` harus tetap identik. Bentuk respons tidak
  boleh berubah.
- `security-test-express.sh`: tambahkan skenario "pengguna unit lain meminta
  file berstorage RustFS → 403/404 sama seperti sekarang".
- Uji kegagalan: RustFS mati → unggah gagal dengan error yang jelas, tidak
  menulis baris setengah jadi; unduh file lama (`body`) tetap jalan.

## 4. Langkah C — memindahkan file lama (backfill)

1. Backup penuh (`server-backup.sh`) **dan** salinan volume RustFS.
2. Script batch per 50 baris: baca `body`, enkripsi, unggah, lalu dalam satu
   transaksi `UPDATE ... SET storage_key=$1, body=NULL WHERE id=$2 AND body IS NOT NULL`.
3. Verifikasi per baris sebelum `body` dikosongkan: unduh ulang, dekripsi,
   bandingkan SHA-256 dengan isi lama.
4. Evidence: verifikasi dengan **record lama** sungguhan, bukan record uji.
5. Ruang disk Postgres baru kembali setelah `VACUUM FULL` (mengunci tabel →
   lakukan di luar jam kerja) atau `pg_repack`.

## 5. Backup setelah ada RustFS

Backup jadi **dua bagian**, dan urutannya penting:

1. `pg_dump` dulu.
2. Lalu salin bucket (`rclone sync` atau perkakas S3 lain ke disk/VM lain).

Karena objek hanya dihapus belakangan oleh job (§B.2), setiap `storage_key` di
dump pasti masih ada di salinan bucket yang diambil sesudahnya. Restore harus
memulihkan keduanya, ditambah `.env` (tanpa `SDL_FILE_KEY`, isi bucket tidak
bisa dibaca).

`scripts/server-backup.sh` perlu diperluas untuk langkah 2.

## 6. Ringkasan urutan

| # | Kapan | Langkah | Risiko ke produksi |
|---|---|---|---|
| A | Kapan saja | Jalankan RustFS, bucket, kredensial | Nol (aplikasi tidak memakainya) |
| — | — | Fase 2 cutover selesai, Go dimatikan | — |
| B | Setelah Go mati | Migrasi + kode Express + test | Sedang, uji penuh di lokal dulu |
| C | Setelah B stabil ±2 minggu | Backfill file lama | Sedang, bisa dihentikan kapan saja |
| — | Setelah C | Perluas backup | — |
