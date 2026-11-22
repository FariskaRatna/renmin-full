# R5H15 — Riwayat versi Dokumen Perencanaan

Status: **rancangan; sebagian tampilan sudah dikerjakan.** Disusun 2026-11-16 dari
keputusan pemilik sistem di sesi yang sama.

Sudah dikerjakan lebih dulu (2026-11-16, frontend saja, tanpa migrasi): tombol
**"Riwayat · N versi"** di baris dokumen membuka jendela Riwayat Versi (v1…vN,
status, pengunggah, keputusan, pratinjau PDF tiap versi), disusun di layar dari
`penggantiDari` pada daftar yang sudah ada. Centang "Tampilkan versi lama"
dihapus. Sisa rancangan di bawah (PDF tidak ditimpa, Perbaiki setelah ditolak,
satu baris per rantai selama revisi diproses, definisi `digantikan` per rantai)
tetap butuh backend + migrasi 068. Lanjutan R5H13 (Dokumen Perencanaan) dan menyentuh
R5H14 (pagu berdasar DIPA sah).

## Kebutuhan (kata pemilik)

> Dokumen perencanaan biasanya tidak langsung jadi, bisa beberapa bulan. Jadi
> misalkan revisi, yang muncul di bagian list itu yang paling baru, hanya yang
> lama tetap ada; kalau kita buka baru muncul dokumen-dokumen sebelumnya.

Perilaku R5H13 yang bertentangan dengan kebutuhan itu:

| Hal | Sekarang |
|---|---|
| Unggah ulang PDF saat draft | **Menimpa** berkas lama (`ON CONFLICT (dokumen_id) DO UPDATE`, `perencanaan.js:209-212`). Draf berbulan-bulan tidak berjejak |
| Versi lama | Tersembunyi, lalu tampil **berjajar di daftar** lewat centang "Tampilkan versi lama" |
| Dokumen ditolak | Buntu: revisi hanya boleh dari dokumen sah (`revisi_hanya_dari_dokumen_sah`). Perbaikan menjadi dokumen baru tanpa sambungan; yang ditolak tertinggal di daftar |

## Keputusan pemilik sistem (2026-11-16)

| Hal | Keputusan |
|---|---|
| Baris di daftar | **Satu baris per dokumen (rantai).** Yang tampil: versi **sah yang berlaku**, dengan penanda bila ada revisi yang sedang diproses ("Revisi v3 sedang diproses" / "v3 ditolak — perlu perbaikan"). Rantai yang belum pernah sah menampilkan versi terbarunya |
| Membuka baris | Panel **Riwayat Versi** v1…vN: status, pengunggah, tanggal, pengesah/penolak, catatan, dan semua PDF tiap versi |
| Riwayat PDF | **Setiap unggahan disimpan**, tidak pernah ditimpa. Yang diajukan untuk pengesahan = unggahan terakhir |
| Batas unggahan | **20 PDF per versi** (masing-masing ≤ 20 MB, aturan lama) |
| Dokumen ditolak | **Dilanjutkan sebagai versi berikutnya** di rantai yang sama ("Perbaiki"). Versi ditolak + catatannya tetap di riwayat |
| Siapa yang memperbaiki | **Siapa pun yang boleh mengunggah** (Operator, Kasubbagren); pengunggah versi itu tetap tidak boleh mengesahkannya |
| Siapa yang melihat riwayat | **Semua yang boleh membaca** (Operator, Kasubbagren, Staf Subbagren, Kabagrenmin), termasuk draft, versi ditolak, dan PDF lama |

## Temuan yang ikut diperbaiki (wajib, bukan tambahan)

`digantikan` sekarang = "ada **penerus langsung** yang sah". Begitu versi
ditolak bisa diteruskan, rantai v1 sah → v2 ditolak → v3 sah membuat v1
**tetap tampak berlaku** (penerus langsungnya ditolak). Dampaknya nyata di
R5H14: pagu draft yang berdasar DIPA v1 masih bisa **disetujui** padahal DIPA
sudah direvisi. Pemakai definisi lama — semuanya diganti dengan definisi
rantai:

- `perencanaan.js:91` (daftar), `perencanaan.js:420` (lembar "Dokumen Sah" Excel LKIP)
- `progar.js:130` (`dokumen_digantikan` di baris pagu), `progar.js:156` (`dasarDipa`, pemeriksaan saat catat/ubah/setujui pagu)

Definisi baru: **digantikan = ada versi lain di rantai yang sama, berstatus
sah, dengan nomor versi lebih tinggi.**

## Alur

1. **Unggah Dokumen** (seperti R5H13) → v1 draft. Unggah PDF kapan saja
   selama draft; setiap unggahan menjadi baris riwayat (nama berkas, ukuran,
   pengunggah, waktu). Unggahan ke-21 ditolak.
2. Kasubbagren membuka baris → Riwayat Versi → pratinjau PDF terakhir →
   **Sahkan** atau **Tolak** (alasan ≥ 8 huruf, aturan lama). Pengesahan
   mencatat **PDF mana** yang disahkan.
3. **Ditolak** → tombol **Perbaiki** pada versi itu → v(n+1) draft di rantai
   yang sama, metadata disalin, PDF diunggah ulang. Kembali ke langkah 2.
4. **Sah** → tombol **Buat Revisi** → v(n+1) draft. Selama belum sah, daftar
   tetap menampilkan versi sah lama + penanda revisi. Begitu revisi disahkan,
   versi lama menjadi "Digantikan v(n+1)" dan hanya terlihat di riwayat.
5. Perbaiki/Buat Revisi hanya dari **versi terakhir** rantai, dan hanya bila
   versi itu sudah selesai (sah atau ditolak). Satu rantai paling banyak satu
   draft.

Ubah metadata (judul, nomor, tanggal, keterkaitan) tetap hanya saat draft dan
**tidak** diberi riwayat sendiri — perubahannya tercatat di audit seperti
sekarang.

## Backend yang melayani

**Express saja**, `modules/subbagren/perencanaan.js` dan `progar.js`. Go tidak
mengenal tabel `sdl_ren_*`; prefix `/api/v1/subbagren/*` dialihkan ke Express
lewat `SDL_EXPRESS_PATHS` (Caddyfile `@express`). Sebelum deploy: pastikan
nilai itu di `.env` server memang mencakup `/api/v1/subbagren/*` — tidak bisa
diperiksa dari repo.

## Endpoint baru/berubah

Semuanya di bawah `/api/v1/subbagren/perencanaan` (prefix yang sama dengan
R5H13), guard Operasional.

| Method | Path | Hak | Perubahan |
|---|---|---|---|
| GET | `/dokumen?tahun=` | R | **Tambah field** per baris: `rantaiId`, `versiKe`, `berkasCount`. `digantikan` memakai definisi rantai. Tetap mengembalikan **semua** versi (bentuk lama utuh) — pengelompokan per rantai di layar. Alasan: `ProgarR5H11.tsx:117` memakai daftar ini untuk pilihan DIPA |
| GET | `/dokumen/:id/riwayat` | R | **Baru.** `{rantaiId, versions:[{id,versiKe,status,judul,nomor,tanggal,createdByName,createdAt,reviewedByName,reviewedAt,reviewNote,digantikan,berkas:[{id,filename,size,uploadedByName,uploadedAt,disahkan}]}]}`, versi urut naik, berkas urut waktu unggah. `:id` = versi mana pun di rantai |
| POST | `/dokumen` | M | `penggantiDari` kini boleh menunjuk versi **ditolak**. 409 `revisi_bukan_versi_terakhir` (sudah ada penerus), 409 `revisi_dari_draft` (versi itu masih draft). `revisi_hanya_dari_dokumen_sah` tidak dipakai lagi |
| POST | `/dokumen/:id/berkas` | M | **Tidak menimpa**: selalu baris baru. 409 `batas_berkas` pada unggahan ke-21. Respons tambah `berkasId` |
| GET | `/dokumen/:id/berkas` | R | Tidak berubah: unduh PDF **terakhir** versi itu |
| GET | `/dokumen/:id/berkas/:berkasId` | R | **Baru.** Unduh satu PDF riwayat. 404 bila `berkasId` bukan milik `:id`. Header sama dengan unduhan lama (`attachment`, `nosniff`, CSP `sandbox`, `no-store`) |
| POST | `/dokumen/:id/review` | S | Saat `disahkan`, catat `berkas_sah_id` = PDF terakhir. Lainnya tetap (maker-checker, `version`, `berkas_required`) |

R = `subbagren.progar.read`, M = `subbagren.progar.manage`,
S = `subbagren.dokumen.sahkan`. Dicatat di `apps/backend-express/docs/API-CONTRACT.md`
bagian R5H15.

## Migrasi

`068_riwayat_versi_dokumen.sql` (baru; **051 tidak disentuh**). Daftarkan di
**kedua** manifes — `apps/backend/internal/migrations/migrate_test.go` dan
`apps/backend-express/src/migrations/index.js` — dalam commit yang sama dengan
file SQL-nya (pelajaran insiden 050, 2026-11-13).

1. `sdl_ren_dokumen`: tambah `rantai_id UUID` (FK ke `sdl_ren_dokumen(id)`) dan
   `versi_ke INTEGER`. Isi data lama dengan CTE rekursif dari akar
   (`pengganti_dari IS NULL`); `versi_ke` = `row_number()` per rantai urut
   `created_at, id` — **bukan** kedalaman, karena aturan R5H13 mengizinkan
   beberapa penerus ditolak dari dokumen yang sama (saudara sekedalaman).
   Lalu `NOT NULL`, `UNIQUE (rantai_id, versi_ke)`, `CHECK (versi_ke >= 1)`,
   dan indeks unik `(rantai_id) WHERE status='draft'` (satu draft per rantai).
2. `sdl_ren_dokumen`: tambah `berkas_sah_id UUID` (FK ke berkas). Data lama yang
   sah diisi dengan satu-satunya berkasnya.
3. `sdl_ren_dokumen_berkas`: tambah `id UUID NOT NULL DEFAULT gen_random_uuid()`,
   lepas PK `dokumen_id`, PK baru `id`, indeks `(dokumen_id, uploaded_at, id)`.
   **Isi `body` tidak disentuh** — amplop AES-GCM lama tetap byte-identik
   (batasan keras 7).
4. Indeks `sdl_ren_dokumen_one_revision_idx` dari 051 dibiarkan; ia tidak
   menghalangi alur baru.

Batas 20 PDF dan "revisi hanya dari versi terakhir" ditegakkan di handler
dengan mengunci baris akar rantai (`FOR UPDATE`); `UNIQUE (rantai_id, versi_ke)`
menangkap balapan yang lolos.

## Otorisasi

- **Bukan Engine A maupun Engine B.** Sama dengan R5H11–R5H14: permission pada
  grant unit `subbagren`, scope tidak dipakai (register tingkat unit). Tidak ada
  permission baru.
- Maker-checker tetap per versi: pengunggah versi (`created_by`) tidak boleh
  mengesahkannya (`self_review_forbidden` + CHECK di database).
- `berkasId` selalu dicari bersama `dokumen_id` di SQL
  (`WHERE id=$1 AND dokumen_id=$2`), bukan disaring setelah `SELECT`.
- Setiap unduhan PDF riwayat diaudit (`dokumen.berkas.download`, dengan id berkas).

Catatan, tidak diubah di rilis ini: `subbagren.dokumen.sahkan` hanya dimiliki
`br_kasubbagren`. Dokumen yang **diunggah Kasubbagren sendiri** hanya bisa
disahkan oleh akun Kasubbagren lain — bila hanya ada satu, versi itu tidak bisa
disahkan. Sudah begitu sejak R5H13; perlu keputusan terpisah.

## Rencana uji

`apps/backend-express/verify/r5h15-flow.js` (baru), ditambah regresi
`r5h11`, `r5h12`, `r5h13`:

1. Unggah PDF dua kali ke v1 → dua baris riwayat, keduanya terunduh, sha256 cocok.
2. Unggahan ke-21 → 409 `batas_berkas`; unggahan ke-20 masih diterima.
3. Sahkan → `berkas_sah_id` = PDF terakhir; riwayat menandai `disahkan`.
4. Tolak v2 → Perbaiki → v3 di rantai sama (`versiKe=3`, `rantaiId` sama).
5. Perbaiki dari versi yang sudah punya penerus → 409 `revisi_bukan_versi_terakhir`;
   dari draft → 409 `revisi_dari_draft`; dua Perbaiki bersamaan → satu 201, satu 409.
6. **Rantai v1 sah → v2 ditolak → v3 sah**: v1 `digantikan=true` di daftar;
   pagu draft berdasar v1 → setujui 409 `dasar_dipa_digantikan`; Excel LKIP
   hanya memuat v3.
7. Staf Subbagren dan Kabagrenmin: `GET /riwayat` dan unduh PDF lama 200;
   unggah/perbaiki 403.
8. `GET /dokumen/A/berkas/<berkas milik B>` → 404 (IDOR).
9. Migrasi atas data R5H13 (termasuk dua penerus ditolak dari satu dokumen)
   → nomor versi unik, PDF lama tetap terdekripsi (uji dengan **record lama**,
   bukan record baru).

Gerbang: `bash scripts/security-test-express.sh` tetap 21/21; build image Go
(`migrate_test.go` memuat 068); `npm run build` frontend. Demo browser:
unggah 3 PDF → sahkan → buat revisi → tolak → perbaiki → sahkan, lihat daftar
tetap satu baris dan riwayat lengkap.

Frontend (`DokumenR5H13.tsx`): kelompokkan per `rantaiId`; centang "Tampilkan
versi lama" dihapus; tombol aksi draft (Ubah, Unggah PDF, Sahkan/Tolak)
dipindah ke panel riwayat; "Perbaiki" di versi ditolak terakhir.
`ProgarR5H11.tsx` tidak perlu diubah — pilihan DIPA otomatis benar karena
`digantikan` diperbaiki di backend.

## Di luar cakupan

- Membandingkan isi dua PDF (diff) — hanya daftar dan pratinjau.
- Riwayat perubahan metadata per field (cukup audit).
- Menghapus PDF riwayat atau versi — tidak ada endpoint hapus.
- Hubungan jenis `dipa` ↔ `revisi_dipa`: revisi dalam rantai wajib berjenis
  sama (aturan R5H13), sehingga "Revisi DIPA" tetap dokumen/rantai tersendiri.
  Tidak diubah.
- Pengesah alternatif untuk unggahan Kasubbagren (lihat catatan Otorisasi).
- Backend Go.
