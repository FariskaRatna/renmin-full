# R5H21 — Persuratan antar-unit (Surat Masuk, Surat Keluar, Disposisi)

Status: **Langkah 1–4 DIBANGUN lokal (2026-11-19), belum di-commit**; langkah 5 (verify + /verifikasi) belum. Khusus Express.
Migrasi: **064** (R5H15 bergeser ke 065).

## Latar

Subbagren (juga Subbagsumda dan Subbagbinfung) butuh persuratan sendiri. Pemetaan
2026-11-19 menunjukkan:

- Disposisi Kabagrenmin → Subbagren **sudah ada** (directives #90, `sections.js`), tampil di
  "Tugas Disposisi". Cukup diberi menu sendiri.
- **Tidak ada pengiriman surat antar-unit.** Surat keluar Urmin (`sdl_urmin_registry`) hanya
  punya kolom bebas "Kepada"; tidak ada tahap "dikirim" dan tidak ada yang sampai ke unit tujuan.
- Sumda dan Binfung **tidak punya surat keluar sama sekali**.

## Keputusan pemilik (2026-11-19)

| Hal | Keputusan |
|---|---|
| Menu | Grup **PERSURATAN** (Surat Masuk, Surat Keluar, Disposisi); di Subbagren tampil sama di PROGAR dan DALGAR |
| Surat Masuk | Surat keluar unit lain (Urmin, Subbagren, Sumda, Binfung) yang ditujukan ke unit ini; **ditandai diterima** dan **terlihat oleh semua staf unit** (tanpa penerusan) |
| Surat Keluar | Mirip Urmin: draf → diajukan → **disetujui + TTD Kabagrenmin** (R5H7 dipakai ulang) → **Kirim** |
| Tujuan | Satu/lebih unit internal **dan/atau** eksternal; eksternal **ketik bebas** dan ditandai "Dikirim" manual (tanpa email) |
| Cakupan | Subbagren + Sumda + Binfung (modul sama) + tombol **Kirim ke unit internal** di surat keluar Urmin yang sudah disetujui |
| Disposisi | Disposisi Kabagrenmin ke unit masuk menu **Disposisi**, mirip Urmin |

## Rancangan

### Data (migrasi 064, semua tabel baru)

- `sdl_surat_antar`: `unit_pengirim` (urmin|ren|sumda|binfung), `sumber` (baru|urmin_registry +
  `urmin_registry_id`), nomor, tanggal, perihal, sifat, ringkasan, `tujuan_eksternal` (teks),
  `status` draft|diajukan|ditolak|disetujui|dikirim, catatan tolak, siapa/kapan ajukan-setuju-kirim, `version`.
- `sdl_surat_antar_tujuan` (surat_id, unit_key, `diterima_at`, `diterima_by`).
- `sdl_surat_antar_berkas`: naskah PDF, lampiran (PDF/.xlsx/.docx), naskah bertanda tangan;
  disegel AES-GCM seperti lampiran lain.
- Izin baru: `persuratan.<unit>.read` / `persuratan.<unit>.manage` untuk role unit masing-masing
  (op, staf, kasubbag; Urmin: op/staf/ka), `persuratan.approve` untuk Kabagrenmin (baca semua unit).

### API (`/api/v1/persuratan`, baru; 142 endpoint lama tidak diubah)

- Surat keluar: daftar/buat/ubah/hapus draf, unggah/hapus berkas, ajukan, setujui+TTD /
  tolak (Kabagrenmin), kirim (operator; menulis baris tujuan), tandai eksternal terkirim.
- Surat masuk: daftar per unit (status dikirim, unit ada di tujuan), detail + unduh berkas, **Terima**.
- Urmin: `POST /dari-urmin/:registryId` — surat keluar Urmin yang sudah disetujui dikirim ke unit
  internal (naskah bertanda tangan ikut disalin).
- Nomor surat: memakai `nomor-surat.js` (urut Bagrenmin + sufiks unit) dan reservasinya.

### Tampilan

- Sidebar Subbagren (PROGAR & DALGAR), Sumda, Binfung: grup **PERSURATAN** — Surat Masuk
  (angka belum diterima), Surat Keluar, Disposisi (tampilan Tugas Disposisi yang ada).
- Urmin: tab **Dari Unit Internal** di Surat Masuk; tombol **Kirim ke unit internal** di detail surat
  keluar yang sudah disetujui.
- Kabagrenmin: antrean **Surat keluar menunggu TTD** (di Inbox Saya) dan halaman tinjau + tanda tangan.

## Urutan kerja

1. Migrasi 064 + manifes; API surat keluar & masuk; uji izin per unit.
2. Layar Surat Keluar/Surat Masuk bersama + grup PERSURATAN di tiga subbag; menu Disposisi.
3. Persetujuan + TTD Kabagrenmin (pakai ulang R5H7) dan antreannya.
4. Kirim ke unit internal dari surat keluar Urmin; tab "Dari Unit Internal" di Urmin.
5. Uji Chrome per peran (op/kasubbag tiap unit, Kabagrenmin) + `verify/r5h21-flow.js`
   (izin, IDOR lintas unit, status tidak bisa dilompati); `/verifikasi`.

## Risiko

- Mengisi `sdl_role_permissions` di produksi bersifat permanen sampai diubah lagi: cadangkan DB.
- Operator subbag berskop `assigned` (Engine B) — fitur ini memakai izin permission-key (seperti
  PROGAR), bukan `unitwork.permit`, supaya operator boleh membuat surat.
- Endpoint Urmin #43–51 dan #90 tidak diubah (kontrak beku); semua tambahan rute baru.

## Progres

### 2026-11-19 — langkah 1 & 2 (disetujui pemilik)

- **Migrasi 064** `064_persuratan_antar_unit.sql`: `sdl_surat_antar`, `_tujuan`, `_berkas`; izin
  `persuratan.read|manage|approve` (juga di seed-bagrenmin Go & Express). Diterapkan di DB laptop.
- **API** `modules/persuratan/index.js`, dipasang di `/api/v1/persuratan` (prefix baru: produksi butuh
  `SDL_EXPRESS_PATHS` mencakup `/api/v1/persuratan/*`). Termasuk setujui/tolak polos untuk
  Kabagrenmin (`/persetujuan`, `/keluar/:id/setujui|tolak`); **TTD dan layar Kabagrenmin = langkah 3**.
  Unit Urmin tidak bisa membuat surat di sini (409 `pakai_surat_keluar_urmin`, menunggu langkah 4).
- **Tampilan** `PersuratanR5H21.tsx/.css`: grup sidebar **PERSURATAN** (Surat Masuk + penanda jumlah
  belum diterima, Surat Keluar, Disposisi = Tugas Disposisi lama, Inbox Distribusi) di Subbagren
  (PROGAR & DALGAR), Subbagsumda, Subbagbinfung.
- **Uji API**: izin per unit, unit lain 403/404 (IDOR), naskah wajib PDF, ajukan tanpa naskah 409,
  status tidak bisa dilompati, Kasubbag tidak bisa menyetujui, tolak → ajukan ulang, kirim → Surat
  Masuk unit tujuan saja, terima sekali, Kabagrenmin tidak bisa menandai diterima.
- **Uji Chrome**: Subbagren menyusun (nomor otomatis `B/ND-33/XI/BIN.1./2026/Subbagren`), unggah
  naskah + lampiran Excel/Word, ajukan; disetujui (API); kirim; Binfung melihat penanda, pratinjau
  naskah, Tandai Diterima; pengirim melihat "1/2 unit menerima". Tanpa error halaman.
- Data uji: dua surat `[UJI R5H21]` dari Subbagren ke Sumda + Binfung.
- R5H15 bergeser ke migrasi **065**.

### 2026-11-19 — langkah 3 & 4 (disetujui pemilik)

- **Langkah 3 — TTD Kabagrenmin.** Setujui polos dihapus; satu-satunya jalan `POST /keluar/:id/ttd-setujui`
  (tanda tangan + setujui SATU transaksi; pakai ulang `pdf-sign.js` dan tanda tangan tersimpan R5H7;
  helper `outgoing-sign.js` kini diekspor tanpa perubahan perilaku). Hasil disimpan sebagai berkas
  `naskah_ttd` (tersegel); penerima hanya melihat naskah bertanda tangan + lampiran.
  - UI: menu Kabagrenmin **Surat Antar-Unit** (sidebar Urmin) + item **Menunggu tanda tangan** di Inbox Saya;
    `TtdNaskahR5H7` menerima `fileUrl`/`signUrl` opsional (default tetap Urmin).
- **Langkah 4 — Urmin → unit internal.** `GET|POST /dari-urmin/:registryId`: surat keluar Urmin yang sudah
  **disetujui** disalin ke Surat Masuk subbag (naskah bertanda tangan bila ada; "Kepada" Urmin masuk ke
  ringkasan). Akses registry lewat `permit()` Urmin dengan aksi **edit** (pemilik atau scope unit);
  surat **Rahasia** ditolak (409 `surat_rahasia`); sekali kirim (409 `sudah_dikirim`).
  - UI: blok **Kirim ke Unit Internal** di detail surat keluar Urmin (status per unit penerima);
    tab **Dari Unit Internal** di Surat Masuk Urmin untuk surat dari subbag.
- **Uji**: Sumda → Subbagren lewat Inbox Kabagrenmin → TTD di Chrome → kirim → Subbagren mengunduh naskah
  ber-TTD; penempatan untuk berkas lain 400, operator TTD 403; Urmin meneruskan surat bertanda tangan ke
  Subbagren + Binfung, kirim ulang 409, subbag tidak bisa mengirim atas nama Urmin (403); Subbagren → Urmin
  tampil di tab Dari Unit Internal. Tanpa error halaman.
- Catatan uji: op-urmin di DB laptop berscope **unit** sejak 2026-11-05, jadi boleh meneruskan surat milik
  ka-urmin. Data uji: salinan "Menghadiri undangan pernikahan" (Urmin) di Surat Masuk Subbagren & Binfung.

### 2026-11-19 — langkah 5 (verifikasi)

| Gerbang | Hasil |
|---|---|
| `verify/r5h21-flow.js` (baru) | 54/55 — 1 GAGAL: penerima masih bisa mengunduh naskah ASLI (belum TTD) lewat id langsung, padahal daftar hanya menampilkan `naskah_ttd`. Perbaikan menunggu persetujuan pemilik (zona otorisasi) |
| `npm run build` frontend | lulus |
| `docker build` Go (go test + pengaman migrasi) | lulus |
| `security-test-r2d5.sh` (Go) | lulus |
| `security-test-express.sh` | 21/21 lulus |
| `npm run verify` Express | crypto 30/30, JSON 18/18, email 16/16 |
| Harness golden | BELUM — `seed-docs` men-TRUNCATE 34 tabel (CASCADE ikut mengosongkan `sdl_surat_antar`); menunggu izin pemilik karena menghapus data latihan laptop |

- **Tindak lanjut 2026-11-19 (disetujui pemilik):** temuan unduh naskah asli diperbaiki — penerima tidak bisa
  mengunduh `naskah` bila `naskah_ttd` ada (404). `verify/r5h21-flow.js` kini **LULUS 55/55**. Harness golden
  tetap belum dijalankan (menunggu izin; `seed-docs` mengosongkan data latihan).

### 2026-11-19 — "Kepada" distandarkan untuk tujuan internal (semua unit)

Keputusan pemilik: tujuan internal adalah **UNIT** (seluruh anggotanya menerima, bukan hanya kepala/kasubbagnya) dan
sama di semua unit — **Urmin, Subbagren, Subbagsumda, Subbagbinfung, Seluruh Subbag**; tujuan lain tetap diketik bebas.
(Label jabatan "Kasubbagren/Para Kasubbag" sempat dipakai hari yang sama; masih dikenali saat membaca surat lama.)

- Surat Keluar **Urmin**: kolom "Kepada" menjadi pemilih (`KepadaPick`) — daftar internal + "Lainnya / eksternal
  (ketik)". Yang tersimpan tetap teks di kunci `tujuan` (kontrak API Urmin #43–51 tidak berubah); surat lama yang
  teksnya bebas tampil sebagai "Lainnya" dengan teksnya.
- **Kirim ke unit internal** Urmin: unit langsung tercentang dari "Kepada" standar (`unitDariKepada`), tombol
  menjadi "Kirim ke Kasubbagren, …"; "Kepada" non-standar memberi petunjuk untuk memilih unit sendiri.
- Surat Keluar **subbag**: centang tujuan berlabel jabatan ("Kepada (internal Bagrenmin)") + tombol pintas
  **Para Kasubbag**; daftar/detail menampilkan jabatan; tujuan eksternal berlabel "Kepada (eksternal)".
- Uji Chrome: opsi Kepada Urmin (tanpa Kaurmin), "Lainnya" + ketik; surat "Para Kasubbag" yang sudah ber-TTD →
  3/3 unit tercentang otomatis → terkirim; editor subbag berlabel jabatan, pintas Para Kasubbag. Tanpa error.
