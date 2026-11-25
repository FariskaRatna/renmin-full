# R5H29 — Subbagsumda: Diklat & Kompetensi

Status: **DI `main` (merge PR #5), belum di `origin/staging`; belum dipastikan terdeploy di produksi (cek 2026-11-24)**. K1–K20 disetujui pemilik 2026-11-23 (K5–K20 sebagai usulan yang diterima). K21–K36 (dari Rencana Implementasi) disetujui pemilik 2026-11-23.
Khusus Express. Migrasi **070** (R5H15 digeser lagi ke **071**, lihat K20). Branch `feat/r5h29-sumda-diklat`
(76cc317 migrasi · 58d48aa refaktor · 0155ea9 API · 386e30b skenario x4 · 1e9f986 frontend).
Lanjutan R5H27 (Master Personel) dan R5H28 (Karier & Mutasi): peserta dan pemegang kompetensi merujuk
`sdl_sumda_personel`; pola otorisasi, validasi, dan lampiran tersegel mengikuti R5H28 beserta perbaikan reviewnya.

Referensi: modul `training` di `docs/reference/Subbagsumda.html` (nama diklat, penyelenggara, mulai, selesai,
status Terjadwal/Berjalan/Selesai/Dibatalkan, catatan; satu baris per personel). Dikembangkan menjadi kegiatan +
peserta + kompetensi (K2).

## Kebutuhan (kata pemilik)

> "lanjutkan bagian diklat & komptensi"

## Kondisi sekarang

- Menu Sumda **"Pendidikan & Pengembangan SDM"** dilayani registry R5B (`sdl_sumda_registry`, `kind='pendidikan'`,
  `fields`: jenis, penyelenggara, tanggalMulai, tanggalSelesai, peserta **teks bebas**, hasil). Peserta tidak
  tersambung ke Master Personel; tidak ada status, hasil per orang, atau masa berlaku sertifikat.
- Endpoint registry termasuk 142 endpoint beku (aturan migrasi 1) → tabel dan endpoint baru, seperti R5H27.
- `/api/v1/subbagsumda/*` sudah dilayani Express di produksi.

## Keputusan

| # | Hal | Keputusan | Sumber |
|---|---|---|---|
| K1 | Menu lama | "Pendidikan & Pengembangan SDM" **diganti "Diklat & Kompetensi"**. Entri pendidikan registry yang aktif **disalin sekali** menjadi kegiatan diklat; peserta teks lama disimpan di catatan (tidak bisa dicocokkan otomatis). Endpoint registry tetap hidup | Pemilik |
| K2 | Model data | **Kegiatan + peserta + kompetensi.** Satu kegiatan, banyak peserta dari Master Personel, hasil per peserta. Ditambah **kompetensi/sertifikasi per personel** dengan masa berlaku dan **alert kedaluwarsa** (pola Monitoring Pensiun). Riwayat diklat & kompetensi tampil di detail personel | Pemilik |
| K3 | Alur & peran | **Pencatatan tanpa persetujuan.** Status Terjadwal → Berjalan → Selesai / Dibatalkan. Operator/staf/Kasubbag mengelola; **arsip hanya Kasubbag**; Kabagrenmin baca saja. **Hasil peserta hanya bisa diisi saat Selesai** | Pemilik |
| K4 | Lampiran | **PDF per kegiatan + per peserta** (dan per kompetensi). ≤ 5 MB, tersegel AES-256-GCM (`SDL1`), seperti Karier & Mutasi | Pemilik |
| K5 | Hak baca | Sama dengan R5H27/R5H28: semua pemegang grant aktif Subbagsumda (scope apa pun) + Kabagrenmin; Superadmin ditolak | Pemilik (usulan disetujui) |
| K6 | Jenis kegiatan | `Pendidikan`, `Pelatihan`, `Kursus`, `Seminar/Lokakarya`, `Sertifikasi`, `Lainnya` | Pemilik (usulan disetujui) |
| K7 | Ubah kegiatan | Data kegiatan (nama, jenis, penyelenggara, lokasi, tanggal, nomor surat) bisa diubah selama Terjadwal/Berjalan. Setelah Selesai/Dibatalkan hanya catatan dan hasil peserta | Pemilik (usulan disetujui) |
| K8 | Transisi | Terjadwal → Berjalan → Selesai; Terjadwal/Berjalan → Dibatalkan (alasan ≥ 8 karakter). Selesai dan Dibatalkan final. Selesai mewajibkan tanggal selesai | Pemilik (usulan disetujui) |
| K9 | Peserta | Ditambah/dihapus selama Terjadwal/Berjalan; hanya personel Aktif/MPP; satu personel sekali per kegiatan. Maks. 200 peserta per kegiatan | Pemilik (usulan disetujui) |
| K10 | Hasil peserta | `Belum`, `Lulus`, `Tidak lulus`, `Tidak hadir`, + nomor sertifikat dan keterangan. Menandai Selesai **tidak** mewajibkan semua hasil terisi; hasil bisa dilengkapi kemudian | Pemilik (usulan disetujui) |
| K11 | Kompetensi dari diklat | Peserta berhasil `Lulus` bisa dijadikan kompetensi dengan satu tombol (nama/nomor/penerbit terisi dari kegiatan, masa berlaku diisi petugas). Kompetensi juga bisa dicatat langsung tanpa diklat | Pemilik (usulan disetujui) |
| K12 | Data kompetensi | Nama, kategori (`Sertifikasi profesi`, `Kursus`, `Lisensi`, `Keahlian`, `Lainnya`), nomor, penerbit, tanggal terbit, **berlaku sampai** (kosong = tanpa batas), catatan | Pemilik (usulan disetujui) |
| K13 | Alert kompetensi | Tahap **H-60** (31–60 hari), **H-30** (1–30), **Kedaluwarsa** (≤ 0), hanya kompetensi aktif milik personel Aktif/MPP. Dihitung di Postgres menurut Asia/Jakarta. **Tanpa "Tandai tinjau"** dan tanpa email | Pemilik (usulan disetujui) |
| K14 | Arsip | Kegiatan dan kompetensi: arsip (soft delete) oleh Kasubbag, dengan versi. Peserta dihapus (bukan arsip) selama Terjadwal/Berjalan | Pemilik (usulan disetujui) |
| K15 | Lampiran: kapan | Kegiatan: selama belum Dibatalkan. Peserta: selama kegiatan Selesai (sertifikat). Kompetensi: selama aktif. Maks. 10 per pemilik. Hapus oleh pengunggah atau Kasubbag | Pemilik (usulan disetujui) |
| K16 | Personel terarsip | Peserta/kompetensinya tetap tampil (label "personel terarsip"); tidak bisa ditambahkan sebagai peserta baru; lampiran dan hasilnya tidak bisa diubah lagi (pelajaran review R5H28 S2) | Pemilik (usulan disetujui) |
| K17 | Salinan K1 | Status salinan dari tanggal: selesai < hari ini → Selesai; mulai > hari ini → Terjadwal; selainnya Berjalan; tanpa tanggal → Selesai + "Tanggal lama tidak tercatat". Jenis lama dicocokkan tanpa peka huruf ke K6, selainnya `Lainnya` + "Jenis lama: …". Peserta dan hasil lama masuk catatan. Baris `penting` ikut disalin (preseden R5H27 K13). Satu baris audit `{sumber, disalin}` | Pemilik (usulan disetujui) |
| K18 | Integrasi R5H27 | Detail personel: bagian "Riwayat diklat" dan "Kompetensi". Dashboard Sumda: angka "Kompetensi segera kedaluwarsa" (≤ 60 hari) | Pemilik (usulan disetujui) |
| K19 | Klasifikasi | Tidak dipakai (semua *biasa*) | Pemilik (usulan disetujui) |
| K20 | Nomor migrasi | R5H29 memakai **070**; R5H15 → **071** | Pemilik (usulan disetujui) |

## Alur

```
 Kegiatan:  [buat] Terjadwal ──mulai──► Berjalan ──selesai──► Selesai ──(isi hasil peserta, sertifikat)
                 └──────────batalkan (alasan)──────────────► Dibatalkan
 Peserta:   tambah/hapus saat Terjadwal/Berjalan · hasil saat Selesai · "Jadikan kompetensi" bila Lulus
 Kompetensi: catat langsung / dari peserta Lulus → alert H-60 / H-30 / Kedaluwarsa (berlaku sampai)
```

Layar: menu **Diklat & Kompetensi** dengan dua tab — **Kegiatan diklat** (daftar + detail dengan peserta, hasil,
lampiran) dan **Kompetensi** (daftar per personel + filter tahap alert). Gaya "buku register" seperti R5H27/R5H28.

## Backend yang melayani

Express saja, di bawah pola Caddy `/api/v1/subbagsumda/*` — **Caddy tidak berubah**. Go hanya mendapat migrasi
070 (ter-embed), manifes, dan seed permission. Rollback prefix ke Go → endpoint baru 404 teks; layar menampilkan
"tidak tersedia" (pola R5H28).

## Endpoint baru

Guard operasional (**O**), validasi strict, `no-store`. Dua mount spesifik: `/subbagsumda/diklat`,
`/subbagsumda/kompetensi`. Hak: `R` = `subbagsumda.personel.read`, `M` = `subbagsumda.diklat.manage`,
`A` = `subbagsumda.diklat.archive`.

| Metode | Path | Hak | Isi |
|---|---|---|---|
| GET | `/diklat/capabilities` | O | `{canRead,canManage,canArchive}` |
| GET | `/diklat` | R | `?q=&status=&jenis=&tahun=&page=&size=` → `{items,total,page,size}` |
| POST | `/diklat` | M | `{nama,jenis,penyelenggara,lokasi,nomorSurat,tanggalMulai,tanggalSelesai,catatan}` → 201 |
| GET | `/diklat/:id` | R | kegiatan + `peserta[]` + `lampiran[]` + riwayat status |
| PATCH | `/diklat/:id` | M | badan penuh + `version` (K7) |
| POST | `/diklat/:id/status` | M | `{status,catatan,version}` (K8) |
| DELETE | `/diklat/:id?version=` | A | arsip |
| POST | `/diklat/:id/peserta` | M | `{personelIds:[…],version}` (1–50 per kirim, K9) |
| PATCH | `/diklat/:id/peserta/:pid` | M | `{hasil,nomorSertifikat,keterangan,version}` (hanya saat Selesai, K10) |
| DELETE | `/diklat/:id/peserta/:pid?version=` | M | hanya Terjadwal/Berjalan |
| POST · GET · DELETE | `/diklat/:id/lampiran[/:lid]` | M · R · M | PDF kegiatan (K15) |
| POST · GET · DELETE | `/diklat/:id/peserta/:pid/lampiran[/:lid]` | M · R · M | sertifikat peserta (K15) |
| GET | `/kompetensi/capabilities` | O | `{canRead,canManage,canArchive}` |
| GET | `/kompetensi` | R | `?q=&personelId=&kategori=&tahap=&page=&size=` → item membawa `sisaHari`, `tahap` |
| GET | `/kompetensi/alert` | R | `{ringkas:{H-60,H-30,KEDALUWARSA},items}` |
| POST | `/kompetensi` | M | `{personelId,nama,kategori,nomor,penerbit,tanggalTerbit,berlakuSampai,catatan,dariPesertaId?}` |
| PATCH | `/kompetensi/:id` | M | badan penuh + `version` |
| DELETE | `/kompetensi/:id?version=` | A | arsip |
| POST · GET · DELETE | `/kompetensi/:id/lampiran[/:lid]` | M · R · M | sertifikat (K15) |
| GET | `/personel/:id` (R5H27) | R | **Aditif**: `riwayatDiklat[]`, `kompetensi[]` (K18) |
| GET | `/dashboard` (R5H27) | R | **Aditif**: `totals.kompetensiKedaluwarsa60` (K18) |

Kode galat (pola R5H28): 400 `invalid_body`/`invalid_input`/`invalid_file_type`/`one_file_required`; 413
`file_too_large`; 403 `access_denied`; 404 `not_found`; 409 `version_conflict`/`status_tidak_sesuai`/
`peserta_ganda`/`batas_peserta`/`personel_tidak_aktif`/`personel_terarsip`/`batas_lampiran`/`hasil_belum_boleh`;
503 `evidence_encryption_unavailable`/`evidence_integrity_failure`/`database_unavailable`.

## Migrasi `070_sumda_diklat_kompetensi.sql`

- `sdl_sumda_diklat`: `nama` ≤ 200, `jenis` (CHECK K6), `penyelenggara`/`lokasi` ≤ 200, `nomor_surat` ≤ 100,
  `tanggal_mulai` DATE (wajib kecuali salinan), `tanggal_selesai` DATE (≥ mulai), `status` (CHECK 4 nilai; Selesai
  wajib `tanggal_selesai`), `catatan` ≤ 2000, `source_registry_id` UUID UNIQUE **tanpa FK** (pelajaran R1 R5H27),
  `created_by`, `updated_by`, `version`, timestamps, `deleted_at`.
- `sdl_sumda_diklat_peserta`: `diklat_id` FK, `personel_id` FK RESTRICT, `hasil` (CHECK K10, `Belum` bawaan),
  `nomor_sertifikat` ≤ 100, `keterangan` ≤ 500, `version`, UNIQUE (`diklat_id`, `personel_id`).
- `sdl_sumda_kompetensi`: `personel_id` FK, `nama` ≤ 200, `kategori` (CHECK K12), `nomor` ≤ 100, `penerbit` ≤ 200,
  `tanggal_terbit`, `berlaku_sampai` (≥ terbit), `dari_peserta_id` FK NULL, `catatan` ≤ 1000, `version`,
  timestamps, `deleted_at`. Indeks parsial `(berlaku_sampai) WHERE deleted_at IS NULL`.
- `sdl_sumda_diklat_lampiran`: `diklat_id` / `peserta_id` / `kompetensi_id` (tepat satu terisi, CHECK
  `num_nonnulls(...) = 1`), `filename`, `size_bytes` ≤ 5 MB, `sha256`, `body` (CHECK awalan `SDL1`), `uploaded_by`,
  `uploaded_at`.
- `sdl_sumda_diklat_riwayat` (dari, ke, catatan, oleh, pada) untuk riwayat status kegiatan.
- Permission `subbagsumda.diklat.manage` (op, staf, kasubbag), `subbagsumda.diklat.archive` (kasubbag); seed Go +
  Express identik.
- Salinan K1/K17 (`INSERT … SELECT` dari registry `kind='pendidikan'` aktif, unit subbagsumda) + satu baris audit.
- **Gladi di DB lokal dengan `pg_dump` sebelum commit** (migrasi ter-commit tidak bisa diubah, pelajaran S7 R5H27).

## Otorisasi

- **Bukan Engine A/B.** `PERMIT_SQL` dari `umum.js` (grant aktif unit `subbagsumda` + permission), diputuskan di
  SQL sebelum query data; scope/klasifikasi tidak menyaring baris (K5/K19).
- Tidak ada maker-checker (K3). Hapus lampiran: pengunggah **atau** pemegang `archive` (diputuskan di `WHERE`).
- Kunci: kegiatan (`FOR UPDATE`) → peserta → personel (`FOR SHARE`); kompetensi → personel. Menambah peserta tidak
  mengunci personel selain `FOR SHARE` untuk cek arsip/status.
- Lampiran: pola R5H28 setelah review — cek hak + status + personel terarsip **sebelum** membaca berkas;
  `Content-Disposition` dengan `filename*` untuk nama Unicode, header sebelum audit; unduhan teraudit; id silang
  (lampiran/peserta milik kegiatan lain) → 404.
- Audit `subbagsumda.diklat.*` dan `subbagsumda.kompetensi.*`, metadata daftar putih (`jenis`, `status`, `fields`,
  `version`, `jumlah`) — tanpa nama, NRP, nomor sertifikat, atau nama berkas.

## Frontend

- `App.tsx`: modul `pendidikan` diganti `{id:'diklat',title:'Diklat & Kompetensi',…}` (K1). SumdaR5B tetap
  melayani `inventaris`.
- Komponen baru `SumdaDiklatR5H29.tsx/.css` (dua tab), memakai `SumdaBersama.tsx`; pilih peserta lewat pencarian
  Master Personel (multi-pilih); `?id=` divalidasi UUID; nama berkas non-ASCII diganti sebelum unggah.
- R5H27: detail personel + riwayat diklat & kompetensi; dashboard + satu angka (K18).

## Rencana uji

**`verify/r5h29-sumda-diklat.js`**: salinan registry (invarian status/jenis/catatan) · alur status + transisi
tidak sah · peserta (tambah, ganda, batas, Aktif/MPP saja, hapus hanya sebelum Selesai) · hasil hanya saat Selesai ·
kompetensi dari peserta Lulus · batas tahap alert H-60/H-30/Kedaluwarsa tepat di batas (WIB) · lampiran tiga
pemilik (tersegel, byte-identik, id silang 404, batas, personel terarsip 409) · arsip hanya Kasubbag · audit tanpa
PII · aditif R5H27 · regresi R5H27 + R5H28.

**Skenario keamanan `x4_r5h29_sumda_diklat_guard`**: Superadmin (termasuk demo) 403 · baca saja/grant unit lain/
dicabut/kedaluwarsa/must_change_password · arsip tanpa hak 403 · CSRF/Origin JSON & multipart · lampiran (bukan PDF,
nama berbahaya, > 5 MB, id silang antar kegiatan/peserta/kompetensi) · bentuk (field asing, `__proto__`, `Cf`,
`personelIds` bukan UUID / > 50) · kunci evidence kosong fail-closed. Suite Express **25/25**.

**Gerbang:** `go test`, gladi 070, `node --check`, verify R5H29 + R5H27 + R5H28, dua suite keamanan, `npm run build`,
demo browser, harness golden 127/128 (rekam ulang pemilik).

## Di luar cakupan

- Cuti & perizinan, kesejahteraan/pensiun, kinerja & pembinaan, inventaris/BMN baru.
- Anggaran/biaya diklat, kuota & pendaftaran mandiri oleh personel, presensi harian.
- Email/notifikasi kedaluwarsa kompetensi; "Tandai tinjau" alert kompetensi (K13).
- Pencocokan otomatis peserta teks lama (registry) ke Master Personel.
- Ekspor/impor CSV, integrasi sistem diklat Polri/BKN.
- Perubahan endpoint registry R5B, Engine A/B, dan backend Go selain migrasi + seed.

## Rencana Implementasi

> Disusun 2026-11-23 dari kode di `main` (172f831; dicek ulang terhadap b0e378c). Belum ada kode. K1–K20 disetujui;
> K21–K36 (§9) disetujui pemilik 2026-11-23.

### 1. Backend: Express saja (+ migrasi 070, manifes, seed Go)

- Caddy meneruskan `@express path {$SDL_EXPRESS_PATHS}` ke `api-express:8080` (`infra/Caddyfile:39-41`); pola
  `/api/v1/subbagsumda/*` (`docs/PERALIHAN-EXPRESS-PRODUKSI.md:98`) mencakup `/diklat*` dan `/kompetensi*` →
  **Caddyfile tidak berubah**. Caddy tidak memasang `request_body`, unggahan 5 MB sampai utuh (sama dengan R5H28).
- Go: tidak ada endpoint baru; hanya `070_sumda_diklat_kompetensi.sql` (ter-embed → image `api` di-rebuild),
  manifes `migrate_test.go:81`, dan dua permission di `cmd/seed-bagrenmin/main.go:55-57`.
- Deploy: migrasi sebelum `up` (`deploy.sh` langkah 7 → 8). Image Go baru menolak start tanpa 070
  (`migrations/migrate.go:94-108`); image lama tetap start di DB ber-070.

### 2. Dampak kontrak API

- **142 endpoint beku tidak disentuh** (registry R5B / harness 32–37, `/registry/ranks`, `/opsi-dropdown`). Registry
  `kind='pendidikan'` tetap bisa ditulis lewat API lama, tanpa sinkronisasi (seperti R5H27).
- Dua mount spesifik setelah `src/app.js:112` (`config` wajib untuk `evidenceKey`); `/capabilities` dan
  `/kompetensi/alert` didaftarkan sebelum `/:id`:
  ```js
  v1.use('/subbagsumda/diklat', operational, createSumdaDiklatRouter({ pool, config }))
  v1.use('/subbagsumda/kompetensi', operational, createSumdaKompetensiRouter({ pool, config }))
  ```
- **Aditif R5H27** (Express-only, hanya di route GET, bukan `ambil()`):
  - `GET /personel/:id` → `item.riwayatDiklat[]` `{diklatId,pesertaId,nama,jenis,status,tanggalMulai,tanggalSelesai,hasil,nomorSertifikat}`
    (kegiatan belum terarsip, terbaru di atas, maks. 50) dan `item.kompetensi[]`
    `{id,nama,kategori,nomor,penerbit,tanggalTerbit,berlakuSampai,sisaHari,tahap}` (belum terarsip, maks. 50).
  - `GET /dashboard` → `totals.kompetensiKedaluwarsa60` (K31), rumus sama dengan `/kompetensi/alert`.
  - Frontend `DetailDialog` sudah memuat `GET /personel/:id` (`SumdaPersonelR5H27.tsx:288-293`).
- **API-CONTRACT.md** (pelajaran S5 R5H28): bagian baru `## R5H29 …` setelah `:1743`; rujukan silang di baris R5H27
  `:1666` dan `:1671`; catatan "Usang sejak R5H28" `:1697` diperluas; pola rollback R5H28 `:1740-1743` ditandai usang.

### 3. Rollback ke Go

| Yang di-rollback | Akibat |
|---|---|
| `/api/v1/subbagsumda/*` dicabut + `--force-recreate caddy` | `/diklat*`, `/kompetensi*` → chi 404 `text/plain` (personel/dashboard/karier juga, sudah ditangani) |
| Frontend | Deteksi 404 non-JSON (`SumdaBersama.tsx:37`) → "Diklat & Kompetensi tidak tersedia" + **tombol darurat registry pendidikan** (K35, pola R5H27; menu ini punya padanan lama yang dilayani Go) |
| Rollback sempit (pola baru) | `/api/v1/subbagsumda/personel* /pensiun/* /dashboard /karier* /diklat* /kompetensi* /opsi-dropdown/*` |
| Data / skema | Tabel 070 diam, tanpa dual-write; skema tidak perlu dibalik |

### 4. Migrasi `070_sumda_diklat_kompetensi.sql`

Terakhir 069 (`migrate_test.go:81`, `src/migrations/index.js:120`). R5H15 → **071**
(`docs/R5H15-RIWAYAT-VERSI-DOKUMEN.md:12,106,169`); `MIGRATION-PLAN.md:16` → "049–070".

```sql
CREATE TABLE sdl_sumda_diklat (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 nama VARCHAR(200) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 200),
 jenis VARCHAR(20) NOT NULL CHECK (jenis IN ('Pendidikan','Pelatihan','Kursus','Seminar/Lokakarya','Sertifikasi','Lainnya')),
 penyelenggara VARCHAR(200) NOT NULL DEFAULT '',
 lokasi VARCHAR(200) NOT NULL DEFAULT '',
 nomor_surat VARCHAR(100) NOT NULL DEFAULT '',
 tanggal_mulai DATE,
 tanggal_selesai DATE,
 status VARCHAR(10) NOT NULL DEFAULT 'Terjadwal' CHECK (status IN ('Terjadwal','Berjalan','Selesai','Dibatalkan')),
 catatan VARCHAR(2000) NOT NULL DEFAULT '',
 source_registry_id UUID UNIQUE,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ,
 CONSTRAINT sdl_sumda_diklat_mulai CHECK (tanggal_mulai IS NOT NULL OR source_registry_id IS NOT NULL),
 CONSTRAINT sdl_sumda_diklat_rentang CHECK (tanggal_selesai IS NULL OR tanggal_mulai IS NULL OR tanggal_selesai >= tanggal_mulai),
 CONSTRAINT sdl_sumda_diklat_selesai CHECK (status <> 'Selesai' OR tanggal_selesai IS NOT NULL OR source_registry_id IS NOT NULL)
);
CREATE INDEX sdl_sumda_diklat_daftar_idx ON sdl_sumda_diklat(tanggal_mulai DESC, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX sdl_sumda_diklat_nama_idx ON sdl_sumda_diklat(lower(nama)) WHERE deleted_at IS NULL;

CREATE TABLE sdl_sumda_diklat_peserta (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 diklat_id UUID NOT NULL REFERENCES sdl_sumda_diklat(id) ON DELETE RESTRICT,
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 hasil VARCHAR(12) NOT NULL DEFAULT 'Belum' CHECK (hasil IN ('Belum','Lulus','Tidak lulus','Tidak hadir')),
 nomor_sertifikat VARCHAR(100) NOT NULL DEFAULT '',
 keterangan VARCHAR(500) NOT NULL DEFAULT '',
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_diklat_peserta_uq UNIQUE (diklat_id, personel_id),
 CONSTRAINT sdl_sumda_diklat_peserta_personel_uq UNIQUE (id, personel_id)
);
CREATE INDEX sdl_sumda_diklat_peserta_personel_idx ON sdl_sumda_diklat_peserta(personel_id);

CREATE TABLE sdl_sumda_kompetensi (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 nama VARCHAR(200) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 200),
 kategori VARCHAR(24) NOT NULL CHECK (kategori IN ('Sertifikasi profesi','Kursus','Lisensi','Keahlian','Lainnya')),
 nomor VARCHAR(100) NOT NULL DEFAULT '',
 penerbit VARCHAR(200) NOT NULL DEFAULT '',
 tanggal_terbit DATE,
 berlaku_sampai DATE,
 dari_peserta_id UUID,
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ,
 CONSTRAINT sdl_sumda_kompetensi_masa CHECK (berlaku_sampai IS NULL OR tanggal_terbit IS NULL OR berlaku_sampai >= tanggal_terbit),
 CONSTRAINT sdl_sumda_kompetensi_dari_fk FOREIGN KEY (dari_peserta_id, personel_id)
   REFERENCES sdl_sumda_diklat_peserta(id, personel_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX sdl_sumda_kompetensi_dari_uq ON sdl_sumda_kompetensi(dari_peserta_id)
 WHERE dari_peserta_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX sdl_sumda_kompetensi_berlaku_idx ON sdl_sumda_kompetensi(berlaku_sampai) WHERE deleted_at IS NULL;
CREATE INDEX sdl_sumda_kompetensi_personel_idx ON sdl_sumda_kompetensi(personel_id) WHERE deleted_at IS NULL;

CREATE TABLE sdl_sumda_diklat_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 diklat_id UUID REFERENCES sdl_sumda_diklat(id) ON DELETE RESTRICT,
 peserta_id UUID REFERENCES sdl_sumda_diklat_peserta(id) ON DELETE RESTRICT,
 kompetensi_id UUID REFERENCES sdl_sumda_kompetensi(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_diklat_lampiran_pemilik CHECK (num_nonnulls(diklat_id, peserta_id, kompetensi_id) = 1)
);
-- + tiga indeks parsial per pemilik

CREATE TABLE sdl_sumda_diklat_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 diklat_id UUID NOT NULL REFERENCES sdl_sumda_diklat(id) ON DELETE CASCADE,
 dari VARCHAR(10) CHECK (dari IN ('Terjadwal','Berjalan','Selesai','Dibatalkan')),
 ke VARCHAR(10) NOT NULL CHECK (ke IN ('Terjadwal','Berjalan','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permission subbagsumda.diklat.manage (op, staf, kasubbag) dan .archive (kasubbag), pola 068/069.

-- Salinan K1/K17: CTE hari (Asia/Jakarta) → src (registry pendidikan aktif, unit subbagsumda) → tgl (cast tanggal
-- hanya bila cocok '^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$', karena registry menerima tahun 0000–9999,
-- unitwork/shared.js:55-61) → norm (selesai < mulai dinolkan; jenis dicocokkan lower() ke K6) → ins (status dari
-- tanggal; catatan: Kode lama, Jenis lama, Tanggal lama/tidak tercatat, Peserta & Hasil (catatan lama); ON CONFLICT
-- DO NOTHING) → rw (satu riwayat "Disalin dari registry lama") → satu audit {sumber, disalin}.
```

- **Lolos pemeriksa substring** (`migrate_test.go:105-152`): `updated_*` bukan `UPDATE␠`, `ON DELETE …` bukan
  `DELETE FROM`, tidak ada `;`/`--` dalam literal, tanpa `ALTER TABLE`, `num_nonnulls` aman (PG 18 di dev),
  deskripsi permission tanpa kata "update".
- Lampiran tanpa CASCADE (RESTRICT): bug gagal keras, bukan diam-diam menghapus berkas tersegel; verify membersihkan
  lampiran lebih dulu.
- Manifes `migrate_test.go:81` + `src/migrations/index.js:120` dalam **commit yang sama**.
- **Gladi (070 tidak bisa diperbaiki setelah commit):** `pg_dump -Fc` → fixture registry pendidikan (jenis huruf
  kecil/tak dikenal/kosong; tanpa tanggal, hanya mulai lampau/depan, selesai kemarin, rentang memuat hari ini;
  `penting`; terarsip; unit lain; peserta/hasil 200 karakter) → `--migrate` Express + start Go + `go test` → uji
  CHECK manual (`num_nonnulls` 0/2, `SDL1`, Selesai tanpa tanggal non-salinan, FK komposit silang) → pulihkan dump →
  baru commit.
- **Pra-cek produksi** (baca saja, pemilik): jumlah registry pendidikan dengan tanggal di luar 1900–2099 = 0.
- CLAUDE.md (pemilik): 110 tabel / 70 berkas SQL.

### 5. Otorisasi

- **Bukan Engine A/B.** `PERMIT_SQL` di `umum.js:29-38` lewat `SELECT EXISTS` sebelum query data; scope/klasifikasi
  tidak menyaring baris (K5/K19). `R` = `subbagsumda.personel.read` (op, staf, kasubbag, kabagrenmin), `M` =
  `subbagsumda.diklat.manage` (op, staf, kasubbag), `A` = `subbagsumda.diklat.archive` (kasubbag).
- **Keputusan di SQL:** transisi `UPDATE … WHERE status=$dari AND version AND deleted_at IS NULL`; hapus lampiran
  `WHERE … AND (uploaded_by=$actor OR $isArchive)`; batas peserta (200) dan lampiran (10) di transaksi setelah induk
  dikunci; Aktif/MPP & terarsip dengan `FOR SHARE`; ganda dari constraint (`makeHandle({ sdl_sumda_diklat_peserta_uq:
  'peserta_ganda', sdl_sumda_kompetensi_dari_uq: 'kompetensi_ganda' })`).
- **Urutan kunci tetap:** kegiatan → peserta → personel `FOR SHARE` (tambah peserta: personel `ORDER BY id FOR
  SHARE` untuk mencegah deadlock antar-kiriman); kompetensi → personel; "Jadikan kompetensi": kegiatan → peserta →
  personel → INSERT. Arsip personel hanya mengunci personel.
- **Lampiran** (pola R5H28 pasca-review): cek hak + status + personel terarsip sebelum membaca berkas, ulang di
  transaksi; `readSingleFile` + validasi PDF + `sealEvidence` (fail-closed 503); unduh dicari bersama rantai induk
  (lampiran peserta: `peserta_id` **dan** `diklat_id` **dan** kegiatan belum terarsip), `openEvidence` + sha256,
  header (termasuk `filename*`) sebelum audit. Unduhan tetap boleh untuk personel terarsip (K16 hanya melarang ubah).
- **Audit** `subbagsumda.diklat.*` (subject = id kegiatan, termasuk event peserta) dan `subbagsumda.kompetensi.*`;
  daftar putih `{jenis,kategori,status,fields,version,jumlah}` — tanpa nama, NRP, nomor sertifikat, hasil, nama berkas.

### 6. Berkas dibuat/diubah

**Express:**
- `umum.js`: pindahkan `HARI_INI`/`hariDari` dari `personel.js:52,55` (personel me-re-export; mencegah siklus impor
  karena `personel.js` akan mengimpor `kompetensi.js`).
- `lampiran.js` (baru, **ekstraksi dari `karier.js` tanpa perubahan perilaku**): `MAKS_PDF`, `MAKS_LAMPIRAN`,
  `SAFE_PDF_NAME`, `disposisi()`, `bacaPdf()`, `bukaPdf()`, `pasangHeaderUnduh()`. Penjaga: verify R5H28 + x3.
- `diklat.js` (baru): kegiatan, status, peserta, hasil, lampiran kegiatan/peserta, `riwayatDiklatPersonel()`.
- `kompetensi.js` (baru): CRUD, alert, lampiran, `tahapKompetensiSql()` (satu-satunya rumus; `HARI_INI`, bukan
  `CURRENT_DATE`), `kompetensiPersonel()`, `KOMPETENSI_60_SQL`.
- `personel.js` (re-export + aditif), `app.js` (dua mount), `migrations/index.js`, `cli/seed-bagrenmin.js`.
  `payload.js` tidak butuh batas baru (50 UUID ≈ 2 KB < `SUMDA`).
- `verify/r5h29-sumda-diklat.js`, `security/scenarios/r5h29.js`, `security/index.js`.

**Go:** `070_sumda_diklat_kompetensi.sql` · `migrate_test.go:81` · `cmd/seed-bagrenmin/main.go:55-57`.

**Frontend:** `SumdaBersama.tsx` (+ komponen `LampiranPdf`; karier tidak direfaktor) · `SumdaDiklatR5H29.tsx/.css`
(tab Kegiatan + Kompetensi, tab lewat `effectiveScreen.tab`, multi-pilih peserta, `?id=` UUID, dialog alasan) ·
`SumdaPersonelR5H27.tsx` (`SumdaNav` + `'diklat'`, riwayat diklat & kompetensi di detail, kartu dashboard) ·
`App.tsx` (`pendidikan` → `diklat`; SumdaR5B tinggal `inventaris`; alamat lama `/pendidikan` → dashboard).

**Docs:** dokumen ini, `API-CONTRACT.md`, `MIGRATION-PLAN.md:16`, `R5H15-…md` (→ 071), `R2D5-SECURITY-TESTS.md` (x4).

### 7. Pengujian

**`verify/r5h29-sumda-diklat.js`** (pola r5h28; personel `UJI-R5H29-`; pembersihan berurutan lampiran → kompetensi →
peserta → riwayat → kegiatan → audit → personel):
0. Rumus tahap WIB dengan stempel tetap (`2026-11-22T17:00:00Z` = 23 Nov WIB): berlaku 23 Nov → KEDALUWARSA (UTC
   akan H-30); 24 Nov & 23 Des → H-30; 24 Des & 22 Jan → H-60; 23 Jan → null; kosong/Pensiun/terarsip → null.
1. Invarian salinan (status K17 terhadap hari salin, jenis, catatan, satu riwayat, audit sumber ≥ disalin).
2. Alur status + transisi tidak sah + Selesai wajib tanggal + alasan batal.
3. PATCH sebelum/sesudah final (K7/K29) + validasi setara `umum.js`.
4. Peserta: tambah, ganda, 51 per kirim, total 201, Pensiun, terarsip, hapus saat Selesai.
5. Hasil: hanya saat Selesai, nomor sertifikat hanya Lulus, personel terarsip, Lulus → lainnya bila ada kompetensi.
6. Kompetensi: dari peserta Lulus (ganda, personel salah → FK komposit), langsung, alert ringkas, K30 pengganti.
7. Lampiran tiga pemilik: byte-identik, `SDL1`, batas, status, id silang 404, hapus tanpa hak 403, dirusak 503,
   CHECK `num_nonnulls`.
8. Arsip hanya Kasubbag; sub-endpoint 404 setelah arsip. 9. Audit tanpa PII. 10. Aditif R5H27. 11. Regresi R5H27 + R5H28.

**Skenario `x4_r5h29_sumda_diklat_guard`**: guard + Superadmin (termasuk demo), UUID fiktif 403, capabilities unit
lain; matriks baca/M tanpa A; pencabutan; CSRF/Origin JSON + multipart tanpa CSRF; lampiran (PDF palsu, nama
berbahaya, traversal, > 5 MB, dua berkas, id silang tiga pemilik, header aman, nama non-ASCII tanpa 503); bentuk
(`personelIds` tidak sah, `tanggalSelesai` pada status lain, `__proto__`, `Cf`, > 32 KB, probe query); kunci evidence
kosong fail-closed. Suite Express **25/25**.

**Harness golden:** endpoint baru tidak direkam; 32–37 tetap cocok; 127/128 berubah → rekam ulang oleh pemilik.

### 8. Urutan kerja

1. Persetujuan K21–K36 + R5H15 → 071.
2. Migrasi 070 (lima tabel sekaligus) + manifes + seed. *Gerbang:* gladi + fixture + `go test` + uji CHECK + diff
   seed → **baru commit**.
3. Refaktor tanpa perubahan perilaku (`HARI_INI` → `umum.js`, `lampiran.js`). *Gerbang:* verify R5H27/R5H28, x2/x3.
4. Irisan A: `diklat.js` + mount + bagian x4 diklat. *Gerbang:* verify butir diklat, harness 32–37.
5. Irisan B: `kompetensi.js` + aditif R5H27 + bagian x4 kompetensi. *Gerbang:* verify penuh, regresi, dua suite
   (25/25), uji mutasi.
6. Frontend. *Gerbang:* `npm run build`, demo per akun, alamat lama, simulasi rollback.
7. Docs, `/verifikasi`, `/review`; golden 127/128 oleh pemilik.
8. Deploy: pra-cek tanggal registry + `SDL_EVIDENCE_KEY`; **centang "Izinkan migrasi"**; rebuild ketiga image.

### 9. Risiko dan keputusan baru

| # | Risiko | Penanganan |
|---|---|---|
| R1 | 070 tidak bisa diperbaiki setelah commit | Gladi + fixture + `pg_dump`; K21–K36 diputus dulu |
| R2 | Data registry kotor (tahun 0000–9999; nilai panjang) menggagalkan migrasi produksi | Regex tahun + `left(btrim…)` + pra-cek |
| R3 | K17 harfiah: mulai lampau tanpa tanggal selesai → Berjalan selamanya | Ditampilkan dengan penanda salinan; petugas menandai Selesai (K27) |
| R4 | Deadlock kegiatan↔peserta↔personel | Urutan tetap, batch `ORDER BY id FOR SHARE` |
| R5 | Ekstraksi `lampiran.js`/`HARI_INI` merusak R5H27/R5H28 | Commit terpisah + gerbang verify + x2/x3 |
| R6 | Alert Kedaluwarsa menumpuk (tanpa tinjau) | K30 pengganti otomatis; arsip |
| R7 | Hasil & sertifikat terlihat semua pembaca Sumda + Kabag | Sama dengan Master Personel; audit tanpa nilai |
| R8 | `SDL_EVIDENCE_KEY` produksi salah | Fail-closed; cek sebelum deploy |
| R9 | FK RESTRICT ke personel mengganggu pembersihan verify lain | Demo/verify memakai personel uji sendiri |
| R10 | Registry pendidikan masih bisa ditulis → divergensi | Menu disembunyikan; cadangan darurat saat rollback (K35) |
| R11 | Alamat lama `/subbagsumda/pendidikan` | Jatuh ke dashboard; diuji |
| R12 | Golden 127/128 berubah | Rekam ulang oleh pemilik |

| # | Hal | Usulan |
|---|---|---|
| K21 | Filter tahun | Tahun dari tanggal mulai (atau selesai); salinan tanpa tanggal hanya di "Semua tahun" (bawaan) |
| K22 | Batas peserta | 200 per kegiatan, 1–50 per kirim, all-or-nothing; ganda dalam kiriman 400, dengan yang ada 409 |
| K23 | Nomor sertifikat | Hanya untuk `Lulus` (aplikasi); lampiran peserta boleh untuk semua hasil |
| K24 | "Jadikan kompetensi" | Tidak menyalin lampiran (detail menautkan sertifikat peserta); satu kompetensi aktif per peserta; personel ikut peserta (FK komposit) |
| K25 | `berlakuSampai` kosong | Tanpa tahap, tidak masuk alert, tampil "Tanpa batas" |
| K26 | Hasil setelah Selesai | M boleh mengubah selama kegiatan & personel belum terarsip; Lulus → lainnya ditolak bila ada kompetensi turunan aktif |
| K27 | Menandai Selesai | `POST /status` menerima `tanggalSelesai` opsional, hanya untuk Selesai |
| K28 | Versi | Peserta & lampiran kegiatan menaikkan versi kegiatan; hasil & lampiran peserta menaikkan versi peserta; lampiran kompetensi menaikkan versi kompetensi; semua mengisi `updated_by` |
| K29 | PATCH setelah final | Badan penuh; selain catatan harus sama, kalau tidak 409 |
| K30 | Kedaluwarsa yang sudah diperbarui | Keluar dari alert bila ada kompetensi aktif lain dengan nama sama dan berlaku lebih akhir/tanpa batas |
| K31 | `kompetensiKedaluwarsa60` | H-60 + H-30 + Kedaluwarsa (sisa ≤ 60) |
| K32 | Catat kompetensi langsung | Personel status apa pun yang belum terarsip; alert tetap Aktif/MPP |
| K33 | Kegiatan terarsip | Semua sub-endpoint 404; tidak tampil di riwayat; kompetensi turunan tetap |
| K34 | Detail salinan | Kode lama, tanggal tak sah → catatan; satu riwayat "Disalin dari registry lama" |
| K35 | Layar saat rollback | Tombol darurat registry pendidikan (pola R5H27) |
| K36 | Audit | Daftar putih + `kategori`; subject event peserta = id kegiatan |

### Temuan yang mengoreksi dokumen rilis

1. CHECK "Selesai wajib tanggal selesai" bertabrakan dengan K17 → pengecualian untuk salinan (juga "mulai wajib").
2. K17 tidak memetakan `ref_code` ("Kode Diklat") → catatan (K34).
3. `POST /diklat/:id/status` perlu `tanggalSelesai` (K27).
4. Tanggal registry bisa bertahun 0000–9999 (`unitwork/shared.js` `isIsoDate`) → SQL defensif + pra-cek.
5. K13 "Kedaluwarsa ≤ 0": berlaku sampai hari ini dihitung kedaluwarsa (sejajar `JATUH_TEMPO` pensiun).
6. Rollback punya padanan lama yang dilayani Go → tombol darurat (K35), bukan "tanpa cadangan".
7. `HARI_INI`/`hariDari` dipindah ke `umum.js` untuk mencegah siklus impor.
8. Skema peserta/kompetensi perlu `created_by`/`updated_by`/timestamps; `ON DELETE` RESTRICT untuk lampiran.
9. FK `dari_peserta_id` tunggal → FK komposit `(dari_peserta_id, personel_id)`.
10. Kode galat baru `kompetensi_ganda`, `kompetensi_terkait`; 23503 → 400.
11. Unduhan lampiran tidak memeriksa arsip personel (sama dengan karier); K16 hanya melarang perubahan.
12. Versi pada `DELETE …/peserta/:pid` = versi peserta (K28).
13. Frontend: `SumdaNav` + `'diklat'`; cast tipe `App.tsx` masih memuat `'pendidikan'`.
14. Pola rollback sempit di API-CONTRACT (R5H27 & R5H28) ditandai usang.
15. CLAUDE.md: 110 tabel / 70 berkas SQL; suite Express 25/25.
16. R5H15 → 071; `MIGRATION-PLAN.md:16` → "049–070".

## Menyimpang dari rencana

1. **Irisan A dan B jadi satu commit** (`0155ea9`, `diklat.js` + `kompetensi.js` + aditif R5H27), bukan dua seperti
   §8 butir 4–5. Gerbang keduanya tetap dijalankan penuh sebelum commit (verify penuh, regresi R5H27/R5H28, suite
   25/25). Tidak ada perubahan perilaku; hanya granularitas riwayat git.
2. **Skenario x4 satu commit terpisah** (`386e30b`), bukan dipecah per irisan. Uji mutasi: syarat "pengunggah atau
   pemegang arsip" pada `DELETE /diklat/:id/lampiran/:lid` dihapus sementara → hanya `x4` merah; berkas dipulihkan.
3. **Tab di alamat.** Tab Kompetensi punya alamat sendiri `/subbagsumda/diklat/kompetensi` (memakai `tab` layar yang
   sudah ada di `App.tsx`), supaya kartu dashboard "Kompetensi kedaluwarsa ≤ 60 hari" langsung membuka tab itu.
   Bukan endpoint; tidak menyentuh kontrak API.
4. **Komponen lampiran bersama.** `LampiranPdf` ditambahkan ke `SumdaBersama.tsx` (dipakai lima tempat di R5H29);
   layar Karier R5H28 belum dipindahkan ke komponen ini agar R5H28 tidak tersentuh.

## Sisa uji (untuk /verifikasi)

Sudah dijalankan selama implementasi: `go test` lewat build image (migrasi + manifes), gladi 070 dari `pg_dump`,
`verify/r5h29-sumda-diklat.js` lulus, regresi `verify/r5h27-*` dan `verify/r5h28-*` lulus, suite Express 25/25 +
mutasi x4, `npm run build`, demo browser operator Subbagsumda (buat kegiatan → 2 peserta → Mulai → Selesai → hasil
Lulus + sertifikat PDF → Jadikan kompetensi → tab Kompetensi H-30; detail Master Personel; kartu dashboard; lebar
390 px tanpa geser horizontal; alamat lama `/subbagsumda/pendidikan` jatuh ke dashboard tanpa galat).

Belum:

- Demo per akun: Kasubbag (Arsipkan muncul), staf, Kabagrenmin (baca saja), akun unit lain (403).
- Simulasi rollback (frontend tanpa `SDL_API_UPSTREAM` → layar "tidak
  tersedia" + tombol registry darurat, K35).
- Harness golden: 127/128 berubah karena katalog permission/role bertambah (068–070; golden belum memuat 068/069
  sekalipun) → **rekam ulang oleh pemilik**. Dashboard/personel R5H27 tidak direkam harness; 32–37 harus tetap cocok.
- Deploy: pra-cek tanggal registry (di bawah) + `SDL_EVIDENCE_KEY`; **centang "Izinkan migrasi"**.

**Pra-cek sebelum deploy (review S3).** 070 hanya memeriksa pola `19xx/20xx-MM-DD` sebelum `::date`; tanggal
berpola benar tapi tidak sah (mis. `2024-02-30`) membuat seluruh `-migrate` gagal. Validator registry Go/Express
menolaknya, jadi hanya data lama/SQL langsung yang berisiko. 070 sudah di-commit dan tidak boleh diedit; jalankan
di database produksi, hasil **harus 0** (lokal: 0):

```sql
SELECT count(*) FROM sdl_sumda_registry s
CROSS JOIN LATERAL (VALUES (btrim(s.fields->>'tanggalMulai')),(btrim(s.fields->>'tanggalSelesai'))) v(t)
 WHERE s.kind='pendidikan' AND s.deleted_at IS NULL
   AND v.t ~ '^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' AND NOT pg_input_is_valid(v.t,'date');
```

Bila bukan 0: betulkan tanggal baris itu lewat UI registry lama (Go) sebelum deploy.

## Perbaikan hasil review (2026-11-23)

`/review` (migration-guard + security-reviewer): tidak ada temuan wajib. Yang dikerjakan atas persetujuan pemilik:

| # | Temuan | Perbaikan |
|---|---|---|
| S1 | K16 tidak ditegakkan di hapus peserta dan arsip kompetensi | `DELETE …/peserta/:pid` dan `DELETE /kompetensi/:id` → 409 `personel_terarsip` bila personel terarsip; tombolnya disembunyikan di UI |
| S2 | PDF terenkripsi/rusak diterima | `lampiran.js` memuat dengan pdf-lib (`ignoreEncryption`) dan menolak bila terenkripsi, gagal parse, atau tanpa halaman → 400 `invalid_file_type`. **Berlaku juga untuk Karier R5H28** (lebih ketat, Express-only, di luar 142 endpoint). Fixture PDF di verify/skenario r5h28 & r5h29 diganti PDF satu halaman yang sah |
| S3 | 070 gagal pada tanggal tak sah | Pra-cek sebelum deploy (di atas); migrasi tidak diubah |
| C2 | Detail kompetensi menampilkan kegiatan asal yang sudah terarsip | `dariDiklat` null dan sertifikat peserta tidak ditautkan bila kegiatan terarsip; UI menulis "Diklat (kegiatan sudah diarsipkan)" |
| C4 | `/kompetensi/alert` tanpa batas | `items` maks. 500; `ringkas` tetap hitungan penuh dari SQL |
| Docs | Alasan golden, notasi lampiran di kontrak, rujukan R5H15 di R5H28 | Diperbaiki |

Skenario x4 ditambah: PDF terenkripsi dan PDF sampah → 400; rantai silang lampiran peserta/kompetensi (tujuh jalur
→ 404; hapus silang via kegiatan yang belum Selesai boleh 409 karena cek status kegiatan jalan lebih dulu, berkas
tetap utuh); personel terarsip → keluarkan peserta 409, arsip kompetensi 409, unduh sertifikat tetap 200. Verify R5H29
menambah cek C2.

Tidak dikerjakan (catatan, keputusan pemilik): C1 salinan `penting` terbaca semua pemegang `personel.read` (K17/K19);
C3 salinan registry ber-karakter Cf tidak bisa di-PATCH (fungsional); C5 pemecahan `FOR SHARE OF d, ps`; C6 id
lampiran di audit; race paralel batas peserta (diserialkan `FOR UPDATE` kegiatan, belum diuji paralel); CLAUDE.md
(angka 25/25, 70 berkas SQL, R5H29) menunggu izin pemilik.
