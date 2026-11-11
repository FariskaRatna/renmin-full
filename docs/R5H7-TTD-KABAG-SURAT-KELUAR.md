# R5H7 — Tanda tangan Kabagrenmin pada naskah surat keluar (rencana)

Status: **diimplementasikan di lokal 2026-11-10, belum di-deploy.** Disusun dan
dikerjakan dari keputusan pemilik sistem di sesi yang sama.

Bukti lokal: `verify/r5h7-pdf-sign.js` (pemetaan 4 rotasi + CropBox, penolakan
PDF rusak/terenkripsi), `verify/r5h7-flow.js` (28 cek alur API, termasuk
penolakan), uji browser Edge (tanda tangan mendarat di kotak yang dipilih),
suite keamanan Express 21/21 dan Go PASS dengan migrasi 045.

Menyimpang dari rencana: kunci "disposisi sekali" di server DITUNDA -- kasus
harness 90 mengirim arahan ke surat fixture yang sama setiap putaran, sehingga
Go (201) dan Express (409) akan selalu berbeda selama Go masih jalur rollback.
Kunci di layar sudah berlaku.

## Kebutuhan (kata pemilik)

Staf yang menerima disposisi membuat surat keluar, mengunggah naskah PDF, lalu
mengajukannya. Naskah itu **harus ditandatangani Kabagrenmin sebelum
disetujui (ACC)**. Satu dokumen bisa punya beberapa tempat tanda tangan, dan
semuanya harus bisa ditandatangani.

| Keputusan | Isi |
|---|---|
| Sumber tanda tangan | Disimpan sekali (tanda tangan saya), atau dicoret baru setiap kali |
| Jumlah | Banyak tanda tangan per dokumen, di semua PDF naskah |
| Konfirmasi | Tanpa OTP dan **tanpa ketik ulang password** (keputusan 2026-11-10) |
| Jenis | Tanda tangan visual (signature_pad + ditempel ke PDF), **bukan TTE tersertifikasi** — wajib tertulis di PDF (lihat R5F10) |
| Backend | **Hanya Express.** `/api/v1/urmin/*` dilayani Express sejak 2026-11-10 (Fase 2 langkah 2–4) |
| Ditolak | Documenso: juga bukan TTE tersertifikasi, dan menambah satu aplikasi utuh |

## Alur

1. Staf: Surat Keluar → Proses → unggah PDF di **Naskah Surat & Lampiran** → Ajukan.
   Sidik jari isi (`content_sha256`) dicatat seperti sekarang.
2. Kabag: Surat Keluar → Proses → **Tanda Tangani & Setujui** (menggantikan
   tombol Setujui biasa di layar). Jendela penanda tangan:
   - kiri: daftar PDF naskah, tanda centang bila sudah diberi tanda tangan;
   - tengah: halaman PDF (pdf.js), navigasi halaman, tombol **Tambah tanda
     tangan** → kotak yang bisa digeser dan diubah ukurannya; bisa banyak,
     bisa dihapus;
   - kanan: tanda tangan tersimpan, atau kanvas coret baru (signature_pad) +
     centang "simpan sebagai tanda tangan saya"; catatan;
     **Setujui**.
   - Setiap PDF naskah wajib punya minimal satu tanda tangan. Gambar (JPG/PNG)
     di naskah tidak ditandatangani.
3. Server, **satu transaksi**: periksa Kabag + status `submitted` + versi +
   sidik jari isi masih sama → tempel tanda tangan ke setiap PDF → simpan
   sebagai **berkas bertanda tangan** (PDF asli tetap utuh) → status
   `approved` → riwayat "Disetujui · N dokumen ditandatangani".
4. Staf: status Disetujui; bagian baru **Naskah Bertanda Tangan** di jendela
   Proses untuk diunduh dan dikirim.

"Kembalikan untuk Revisi" tidak berubah dan tidak meminta tanda tangan.

## Database — migrasi `045_ttd_kabag.sql` (hanya menambah)

```sql
-- tanda tangan tersimpan per akun; gambar PNG terenkripsi AES-256-GCM
CREATE TABLE sdl_user_signatures (
  user_id     UUID PRIMARY KEY REFERENCES sdl_users(id),
  image_seal  TEXT NOT NULL,            -- envelope SDL1 (crypto/evidence.js)
  sha256      CHAR(64) NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- hasil tanda tangan; TERPISAH dari sdl_unit_work_files
CREATE TABLE sdl_outgoing_signed_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id     UUID NOT NULL REFERENCES sdl_urmin_registry(id),
  source_file_id  UUID NOT NULL REFERENCES sdl_unit_work_files(id),
  source_sha256   CHAR(64) NOT NULL,
  file_name       TEXT NOT NULL,
  byte_size       INTEGER NOT NULL,
  sha256          CHAR(64) NOT NULL,
  file_data       BYTEA NOT NULL,
  placements      JSONB NOT NULL,       -- [{page,x,y,w,h}] relatif 0..1
  signed_by       UUID NOT NULL REFERENCES sdl_users(id),
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (register_id, source_file_id)
);
```

Kenapa tabel terpisah, bukan `purpose` baru di `sdl_unit_work_files`:

- Jalur Berkas Kerja (unggah/hapus) hanya mengunci `purpose='lampiran'`.
  Purpose baru akan **bisa dihapus staf** lewat Berkas Kerja — di Go maupun
  Express — kecuali kedua backend diubah.
- Kalau `/urmin` di-rollback ke Go, Go tidak pernah membaca tabel baru ini,
  jadi tidak ada yang rusak; ia hanya tidak menampilkannya.

Berkas SQL ditaruh di `apps/backend/internal/migrations/sql/` (satu sumber,
aturan 6) dan `migrate_test.go` diperbarui manifesnya. Go perlu di-build ulang
supaya `Verify()` mengenal 045; kodenya tidak berubah.

## Endpoint baru (Express saja)

| Endpoint | Siapa | Isi |
|---|---|---|
| `GET /api/v1/urmin/ttd/me` | Kabag | ada/tidaknya tanda tangan tersimpan + gambar (data URL) |
| `PUT /api/v1/urmin/ttd/me` | Kabag | simpan/ganti (PNG, ≤ 200 KB, didekode ulang dengan `sharp`) |
| `DELETE /api/v1/urmin/ttd/me` | Kabag | hapus |
| `POST /api/v1/urmin/registry/:id/sign-approve` | Kabag | `{version,note,image?,useSaved,placements:{[fileId]:[{page,x,y,w,h}]}}` |
| `GET /api/v1/urmin/registry/:id/signed-files` | pembaca surat | daftar berkas bertanda tangan |
| `GET /api/v1/urmin/registry/:id/signed-files/:fid` | pembaca surat | unduh PDF |

Di bawah `/urmin`, bukan `/me`: `/me` masih dilayani Go sampai langkah 5.

Pemeriksaan `sign-approve`, berurutan: CSRF + guard operasional →
`canManageOutgoing` (grant `br_kabagrenmin` + `urmin.surat_keluar.approve` +
klasifikasi) → validasi
payload ketat (fileId harus PDF `lampiran` milik surat ini, halaman ada,
koordinat 0..1, maks. 20 tanda tangan per berkas, setiap PDF naskah ≥ 1) →
transaksi: `FOR UPDATE`, status `submitted`, versi, sidik jari = tersimpan →
tempel → simpan → `approved` → event.

Penempelan dengan **pdf-lib** (JavaScript murni, tanpa native, aman untuk
container `read_only`): gambar PNG di setiap posisi + teks kecil di bawahnya
"Ditandatangani · {nama} · {waktu WIB}", dan baris kaki di halaman terakhir:
"Tanda tangan visual SIERA DELTA LIMA, bukan TTE tersertifikasi · kode {8 hex
sha256 naskah asli}". PDF terenkripsi/rusak → 422 `pdf_unreadable`, transaksi
batal, surat tetap `submitted`.

## Frontend

- Paket baru: `signature_pad`, `pdfjs-dist` (frontend); `pdf-lib` (Express).
- `UrminR5D.tsx`: bagi Kabag di status `submitted`, tombol Setujui menjadi
  **Tanda Tangani & Setujui** yang membuka komponen baru `TtdNaskahR5H7.tsx`.
- Jendela Proses (semua pembaca): bagian **Naskah Bertanda Tangan** bila ada.

## Celah yang disengaja (perlu disadari)

- `POST /:id/approve` lama **tetap ada** di API (kontrak beku; Go masih jalur
  rollback). Layar tidak memakainya lagi, tapi secara teknis Kabag masih bisa
  menyetujui tanpa tanda tangan lewat API langsung. Ditutup setelah Go
  dipensiunkan.
- Tanda tangan visual bisa ditiru siapa pun yang punya gambarnya. Nilainya ada
  pada jejak audit (akun, sesi login, waktu, sidik jari naskah), bukan pada
  gambarnya.

## Uji

- Unit test penempelan (PDF 1 dan banyak halaman, ukuran halaman campuran,
  rotasi halaman, PDF terenkripsi ditolak).
- Skenario baru di `scripts/security-test-express.sh` (`14_ttd_kabag`): bukan
  Kabag 403, Superadmin 403, naskah diubah setelah diajukan
  409, tanda tangan ganda 409, fileId surat lain 400, PNG palsu ditolak, staf
  tidak bisa menghapus berkas bertanda tangan.
- Harness golden: endpoint baru tidak punya padanan Go → dicatat sebagai
  tambahan Express-only di `apps/backend-express/docs/API-CONTRACT.md`.
- Uji manual di browser: staf ajukan → Kabag tanda tangan 3 tempat di 2 PDF →
  staf unduh dan cek tampilan.

## Sekalian (kecil)

- Kunci disposisi sekali di server (`POST /leadership/directives` dengan
  `incomingId` yang sudah punya disposisi → 409). `/leadership` kini Express.

## Deploy

Butuh `-migrate` (045) → jalankan workflow deploy dengan "Izinkan migrasi".
Rebuild `api` (Go, karena manifes migrasi), `api-express`, dan `frontend`.

## Tambahan: Kode Register dipesan saat "Tambah" (migrasi 046)

Keputusan pemilik 2026-11-10: Kode Register Internal (nomor urut) harus
langsung terlihat saat "Tambah Surat Keluar" ditekan, untuk dipakai di naskah
PDF yang dibuat di luar aplikasi. Nomor surat lengkap tidak perlu tampil lebih
awal. Form lain TIDAK berubah.

- `POST /urmin/registry/nomor-urut` memesan satu nomor urut untuk akun itu;
  pesanan yang belum terpakai dikembalikan lagi pada "Tambah" berikutnya, jadi
  Tambah → Batal berulang tidak menghabiskan deret.
- Saat draf pertama kali disimpan, frontend mengirim `?reservasi=<id>` dan
  nomor surat memakai urut pesanan itu.
- Lubang deret hanya terjadi bila pesanan ditinggalkan sampai tahun berganti.
- Uji: bagian 6 `verify/r5h7-flow.js` (10 cek) + uji browser (26 → Batal → 26 →
  tersimpan `B/ND-26/...`).

