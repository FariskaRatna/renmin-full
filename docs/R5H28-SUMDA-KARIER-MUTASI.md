# R5H28 — Subbagsumda: Karier & Mutasi

Status: **DIIMPLEMENTASI (2026-11-23), branch `feat/r5h28-sumda-karier`, belum di-push.** K1–K28 disetujui pemilik.
Khusus Express. Migrasi **069** (R5H15 → **070**). Lulus: `go test` (migrasi + seed), gladi 069 + uji CHECK, verify
R5H28 + R5H27, suite keamanan Express 24/24 (+ uji mutasi x3), `npm run build`, demo browser alur UKP penuh (op →
Kasubbag → op, Master Personel berubah). Belum: lihat "Sisa uji".
Lanjutan R5H27 (Master Personel): setiap pengajuan merujuk satu baris `sdl_sumda_personel`.

Referensi: modul `career` di `docs/reference/Subbagsumda.html` (prototipe localStorage). Diambil: jenis
pengajuan, kolom (personel, jenis, tanggal usulan, TMT/efektif, status), dan status Diajukan → Diproses →
Disetujui/Ditolak → Selesai. **Tidak** diambil: perubahan status bebas tanpa pembagian peran, ekspor CSV.

## Kebutuhan (kata pemilik)

> "selanjutnya buat untuk bagian karier & mutasi untuk subbagsumda"

## Kondisi sekarang

- Menu Sumda **"Pelayanan Kepegawaian"** (`App.tsx`, modul `layanan`: "Tracking cuti, UKP, KGB, mutasi,
  pensiun") hanyalah placeholder tanpa backend.
- Master Personel (R5H27) menyimpan `pangkat`, `jabatan`, `unit_kerja` yang berubah karena UKP/mutasi, tetapi
  belum ada riwayat perubahannya.
- `/api/v1/subbagsumda/*` sudah dilayani Express di produksi.

## Keputusan

| # | Hal | Keputusan | Sumber |
|---|---|---|---|
| K1 | Menu | Placeholder **"Pelayanan Kepegawaian" diganti "Karier & Mutasi"**. Cuti dan kesejahteraan/pensiun nanti menjadi menu sendiri | Pemilik |
| K2 | Efek ke Master Personel | **Diusulkan lalu dikonfirmasi.** Saat menandai Selesai, form menampilkan nilai baru (UKP → pangkat; Mutasi → jabatan + unit kerja; Penyesuaian Jabatan → jabatan), petugas mengonfirmasi/mengoreksi, lalu Master Personel diperbarui **dalam transaksi yang sama** + audit. KGB tidak mengubah master | Pemilik |
| K3 | Alur & peran | Operator/Staf: buat, ubah selama Diajukan, majukan ke Diproses, tandai Selesai setelah Disetujui. **Kasubbagsumda: Setujui/Tolak** (catatan wajib bila Tolak), **tidak boleh memutuskan pengajuan yang ia catat sendiri**. Kabagrenmin: baca saja | Pemilik |
| K4 | Lampiran | **PDF**, maks. 5 MB per berkas, disegel AES-256-GCM (envelope `SDL1`, kunci `SDL_EVIDENCE_KEY`) seperti lampiran dokumen Subbagren (063). Hanya pemegang hak baca Sumda yang bisa mengunduh | Pemilik |
| K5 | Hak baca | Sama dengan R5H27 K2: semua pemegang grant aktif Subbagsumda (scope apa pun) + Kabagrenmin; Superadmin ditolak | Pemilik (usulan disetujui) |
| K6 | Jenis pengajuan | `UKP` (kenaikan pangkat), `KGB` (kenaikan gaji berkala), `MUTASI`, `PENYESUAIAN_JABATAN` — sesuai referensi | Pemilik (usulan disetujui) |
| K7 | Nilai usulan | Diisi saat membuat pengajuan (pangkat/golongan baru untuk UKP; jabatan & unit kerja baru untuk Mutasi; jabatan baru untuk Penyesuaian Jabatan), bisa dikoreksi saat Selesai. Validasi pangkat sama dengan Master Personel (rank master Polri / golongan PNS) | Pemilik (usulan disetujui) |
| K8 | Status akhir | `Ditolak`, `Selesai`, dan `Dibatalkan` final. Pengajuan yang ditolak diajukan ulang sebagai **pengajuan baru**. **Batalkan** (dengan alasan): pencatat atau Kasubbag, selama Diajukan/Diproses | Pemilik (usulan disetujui) |
| K9 | Maker-checker | Yang diperiksa: `created_by` ≠ pemutus. Bila Kasubbagsumda sendiri yang mencatat, pengajuan menunggu pemegang hak `approve` lain (role Kasubbagsumda lain / pejabat yang ditunjuk lewat Role Editor). Disarankan pengajuan dicatat operator/staf | Pemilik (usulan disetujui) |
| K10 | Syarat Selesai | Status Disetujui, `tanggalEfektif` wajib, personel masih ada (tidak terarsip). Bila Master Personel berubah sejak pengajuan dibuat, form menampilkan nilai master terkini (cek versi personel; konflik → 409) | Pemilik (usulan disetujui) |
| K11 | Satu pengajuan terbuka per jenis | Satu personel tidak boleh punya dua pengajuan **terbuka** (Diajukan/Diproses/Disetujui) dengan jenis yang sama → 409 `pengajuan_ganda` | Pemilik (usulan disetujui) |
| K12 | Lampiran: kapan | Tambah selama belum final; hapus hanya oleh pengunggah atau Kasubbag, sebelum Disetujui; maks. 10 berkas per pengajuan | Pemilik (usulan disetujui) |
| K13 | Riwayat di Master Personel | Dialog detail personel (R5H27) mendapat bagian **"Riwayat karier & mutasi"** (daftar pengajuan personel itu, terbaru di atas) | Pemilik (usulan disetujui) |
| K14 | Dashboard Sumda | Ringkasan satu baris bertambah satu angka: **"Pengajuan karier menunggu keputusan"** (status Diproses), tautan ke menu | Pemilik (usulan disetujui) |
| K15 | Nomor migrasi | R5H28 memakai **069**; R5H15 (belum dikerjakan backend-nya) digeser ke **070** (preseden R5H25/R5H27) | Pemilik (usulan disetujui) |
| K16 | Klasifikasi | Tidak dipakai (semua *biasa*), sama dengan Master Personel | Pemilik (usulan disetujui) |

## Alur

```
            Operator/Staf                     Kasubbagsumda (≠ pencatat)        Operator/Staf
 [buat] → Diajukan ──proses──► Diproses ──setujui──► Disetujui ──selesai + konfirmasi nilai──► Selesai
              │                    │        └─tolak (catatan)──► Ditolak                    (Master Personel
              └──batalkan──────────┴──────────────────────────► Dibatalkan                    diperbarui, K2)
```

1. **Daftar Karier & Mutasi**: tabel (personel, jenis, nilai usulan ringkas, tanggal usulan, TMT, status),
   filter status/jenis, cari nama/NRP/no. referensi, paginasi server. Tombol sesuai `/capabilities`.
2. **Buat pengajuan**: pilih personel (pencarian ke Master Personel, hanya status Aktif/MPP), jenis, nomor
   referensi, tanggal usulan, tanggal efektif (opsional), nilai usulan sesuai jenis, catatan.
3. **Detail**: data pengajuan, nilai sekarang vs usulan, lampiran PDF (pratinjau seperti modul lain),
   riwayat status (siapa, kapan, catatan), tombol aksi sesuai status dan hak.
4. **Selesai**: dialog konfirmasi menampilkan "Master Personel sekarang → akan menjadi", bisa dikoreksi.
   Server mengunci baris pengajuan dan personel (`FOR UPDATE`), memeriksa versi keduanya, menulis keduanya.

## Backend yang melayani

Express saja, di bawah pola Caddy `/api/v1/subbagsumda/*` yang sudah ada — **tidak ada perubahan Caddy**.
Go tidak mendapat endpoint baru; hanya migrasi 069 (ter-embed), manifes `migrate_test.go`, dan seed
permission. Rollback prefix ke Go → endpoint baru 404 teks; layar memakai fallback "tidak tersedia" seperti
R5H27.

## Endpoint baru

Guard operasional (**O**), validasi strict, `Cache-Control: no-store`. Mount spesifik
`/subbagsumda/karier` (bukan `/subbagsumda`, pelajaran R5H25/R5H27).

| Metode | Path | Hak | Isi |
|---|---|---|---|
| GET | `/api/v1/subbagsumda/karier/capabilities` | O | `{canRead,canManage,canApprove}` |
| GET | `/api/v1/subbagsumda/karier` | R | `?q=&status=&jenis=&personelId=&page=&size=` → `{items,total,page,size}` |
| POST | `/api/v1/subbagsumda/karier` | M | `{personelId,jenis,nomorReferensi,tanggalUsulan,tanggalEfektif,usulan:{pangkat?,jabatan?,unitKerja?},catatan}` → 201 |
| GET | `/api/v1/subbagsumda/karier/:id` | R | detail + `lampiran[]` + `riwayat[]` + nilai master terkini |
| PATCH | `/api/v1/subbagsumda/karier/:id` | M | badan penuh + `version`; hanya status Diajukan |
| POST | `/api/v1/subbagsumda/karier/:id/aksi` | M / A | `{aksi:"proses"\|"setujui"\|"tolak"\|"batalkan"\|"selesai",catatan,version,terapkan?:{pangkat?,jabatan?,unitKerja?,personelVersion},tanggalEfektif?}`. `setujui`/`tolak` butuh A + bukan pencatat |
| POST | `/api/v1/subbagsumda/karier/:id/lampiran` | M | multipart `file` (PDF ≤ 5 MB) |
| GET | `/api/v1/subbagsumda/karier/:id/lampiran/:lid` | R | unduh (attachment, dibuka segelnya) |
| DELETE | `/api/v1/subbagsumda/karier/:id/lampiran/:lid` | M | pengunggah/Kasubbag, sebelum Disetujui |
| GET | `/api/v1/subbagsumda/personel/:id` (R5H27) | R | **Aditif**: field `riwayatKarier[]` (K13) |
| GET | `/api/v1/subbagsumda/dashboard` (R5H27) | R | **Aditif**: `totals.karierMenunggu` (K14) |

Kode galat: 400 `invalid_body`/`invalid_input`/`invalid_rank`/`invalid_file_type`/`one_file_required`; 413
`file_too_large`; 403 `access_denied`/`self_review_forbidden`; 404 `not_found`; 409 `version_conflict`/
`status_tidak_sesuai`/`pengajuan_ganda`/`personel_berubah`/`personel_terarsip`/`personel_tidak_aktif`/
`personel_belum_lengkap`/`batas_lampiran`; 503 `evidence_encryption_unavailable`/
`evidence_integrity_failure`/`database_unavailable`.

## Migrasi `069_sumda_karier_mutasi.sql`

- `sdl_sumda_karier`: `id`, `personel_id` (FK `sdl_sumda_personel`, RESTRICT), `jenis` (CHECK 4 nilai),
  `nomor_referensi` ≤ 100, `tanggal_usulan` DATE NOT NULL, `tanggal_efektif` DATE, `usulan_pangkat`,
  `usulan_jabatan`, `usulan_unit_kerja` (≤ 200), `status` (CHECK `Diajukan|Diproses|Disetujui|Ditolak|
  Selesai|Dibatalkan`), `catatan` ≤ 1000, `diterapkan` JSONB (nilai lama→baru saat Selesai), `created_by`,
  `updated_by`, `decided_by`, `decided_at`, `selesai_by`, `selesai_at`, `version`, timestamps. Indeks unik parsial K11:
  `(personel_id, jenis) WHERE status IN ('Diajukan','Diproses','Disetujui')`.
- `sdl_sumda_karier_riwayat`: `(karier_id, dari, ke, catatan, oleh, pada)` — append-only untuk tampilan.
- `sdl_sumda_karier_lampiran`: `id`, `karier_id`, `filename`, `size_bytes`, `sha256`, `body BYTEA` (tersegel),
  `uploaded_by`, `uploaded_at` (pola 063).
- Permission `subbagsumda.karier.manage` (op, staf, kasubbag) dan `subbagsumda.karier.approve` (kasubbag);
  baca memakai `subbagsumda.personel.read` yang sudah ada (op, staf, kasubbag, kabagrenmin). Pola pemberian
  049/068 (`ON CONFLICT DO NOTHING`, role yang tidak ada dilewati). Seed Go + Express ikut.
- Manifes `migrate_test.go` + `migrations/index.js`. R5H15 → 070 (`docs/R5H15-…`, memori).

## Otorisasi

- **Bukan Engine A/B.** Pola R5H27/R5H11: `PERMIT_SQL` (grant aktif unit `subbagsumda` + permission role),
  diputuskan di SQL sebelum query data. Scope/klasifikasi tidak menyaring baris (K5).
- `setujui`/`tolak`: butuh `karier.approve` **dan** `created_by <> actor` (diperiksa di SQL dalam transaksi,
  setelah `FOR UPDATE`) → 403 `self_review_forbidden`.
- `selesai` yang mengubah Master Personel: `karier.manage` **dan** `personel.update` (keduanya sudah dimiliki
  op/staf/kasubbag setelah 068). Penulisan master memakai validasi yang sama dengan `PATCH /personel/:id`
  (rank master, golongan PNS, karakter tak terlihat).
- Lampiran: unduh butuh hak baca; isi selalu lewat `openEvidence`; validasi PDF (magic `%PDF-`, `%%EOF`,
  `detectFileType`), nama berkas disaring, `Content-Disposition: attachment`.
- Audit `subbagsumda.karier.create|update|proses|setujui|tolak|batalkan|selesai|lampiran.add|lampiran.delete|lampiran.download`,
  metadata tanpa data pribadi (jenis, status, nama field yang diterapkan, versi).

## Frontend

- `App.tsx`: modul `layanan` diganti `{id:'karier',title:'Karier & Mutasi',…}` (K1).
- Komponen baru `SumdaKarierR5H28.tsx/.css`, gaya "buku register" seperti R5H27; pilih personel memakai
  pencarian ke `/personel`; pratinjau PDF memakai komponen lampiran yang sudah ada.
- R5H27: detail personel menampilkan riwayat karier (K13); ringkasan dashboard + satu angka (K14).

## Rencana uji

**`verify/r5h28-sumda-karier.js`**: alur penuh tiap jenis (UKP → pangkat berubah; Mutasi → jabatan+unit;
Penyesuaian Jabatan → jabatan; KGB → master tetap) · maker-checker (Kasubbag pencatat tidak bisa memutuskan)
· transisi tidak sah → 409 · pengajuan ganda → 409 · versi personel berubah sebelum Selesai → 409 · personel
terarsip → 409 · lampiran PDF: unggah, unduh byte-identik, bukan PDF ditolak, > 5 MB ditolak, batas 10,
hapus setelah Disetujui ditolak · riwayat & audit tanpa PII · aditif R5H27 (riwayat di detail, angka
dashboard) · regresi `r5h27-sumda-personel.js`.

**Skenario keamanan `x3_r5h28_sumda_karier_guard`** (`security/index.js`): Superadmin (termasuk demo) 403 ·
baca-saja (Kabag) tidak bisa membuat/aksi/unggah · tanpa `approve` tidak bisa setujui/tolak · pencatat tidak
bisa menyetujui sendiri · grant unit lain/dicabut/kedaluwarsa/must_change_password 403 · CSRF/Origin untuk
POST/PATCH/DELETE/multipart · lampiran: berkas bukan PDF, nama berbahaya, `../`, ukuran berlebih ·
unduh lampiran milik pengajuan lain via id silang → 404 · field asing/`__proto__`/karakter tak terlihat 400.

**Gerbang:** `go test` (manifes + seed), `node --check`, verify R5H28 + R5H27, dua suite keamanan (Express
24/24), `npm run build`, harness golden (127/128 berubah lagi karena permission baru — rekam ulang pemilik),
demo browser.

## Di luar cakupan

- Cuti & perizinan, kesejahteraan/pensiun ("Proses Pensiun" R5H27), kinerja — menu terpisah berikutnya.
- Diklat & kompetensi → dikerjakan di R5H29 (`docs/R5H29-SUMDA-DIKLAT-KOMPETENSI.md`); pola rollback sempit di
  API-CONTRACT § R5H28 usang sejak R5H29.
- Pengingat otomatis KGB/UKP berdasarkan TMT, email/notifikasi.
- Persetujuan berjenjang ke Kabagrenmin atau integrasi tanda tangan elektronik.
- Ekspor/impor CSV, integrasi SIPP/HRIS Polri.
- Perubahan endpoint lama (registry R5B, Engine A/B) dan backend Go selain migrasi + seed.

## Rencana Implementasi

> Disusun 2026-11-23 dari kode di `main` (3908313). Belum ada kode. K1–K16 disetujui; K17–K28 (§9) disetujui pemilik 2026-11-23.

### 1. Backend: Express saja (+ migrasi 069, manifes, seed Go)

- Caddy meneruskan `@express path {$SDL_EXPRESS_PATHS}` ke `api-express:8080` (`infra/Caddyfile:39-42`). Pola
  `/api/v1/subbagsumda/*` (`docs/PERALIHAN-EXPRESS-PRODUKSI.md:98`) mencakup `/subbagsumda/karier` dan semua sub-path →
  **Caddyfile tidak berubah**. Caddy tidak memasang batas `request_body`, dan jalur Express tidak lewat Vite, jadi
  unggahan 5 MB sampai utuh.
- Go: tidak ada endpoint baru. Hanya `069_sumda_karier_mutasi.sql` (ter-embed → image `api` di-rebuild), manifes
  `migrate_test.go:80`, dan dua permission di `cmd/seed-bagrenmin/main.go:55-57`.
- Pola: R5H27 (`modules/subbagsumda/personel.js`); lampiran tersegel pola 063 (`subbagren/perencanaan.js:631-716`);
  maker-checker `self_review_forbidden` (`perencanaan.js:424-430`, `progar.js:403-407`).

### 2. Dampak kontrak API

- 142 endpoint beku tidak tersentuh (registry §5.5 / harness 32–37, `/registry/ranks`, `/subbagsumda/opsi-dropdown`).
- Satu mount spesifik setelah `app.js:109` (bukan `/subbagsumda`, pelajaran R5H25/R5H27):
  ```js
  v1.use('/subbagsumda/karier', operational, createSumdaKarierRouter({ pool, config }))
  ```
  `config` wajib karena `config.evidenceKey` (`src/config.js:35`). `GET /capabilities` didaftarkan sebelum `/:id`.
- **Aditif pada endpoint R5H27** (Express-only, tidak direkam harness; verify/x2 tidak membandingkan kunci persis —
  satu-satunya `Object.keys` di `verify/r5h27-sumda-personel.js:282` hanya untuk `rincian`):
  - `GET /personel/:id`: `item.riwayatKarier[]` `{id,jenis,status,tanggalUsulan,tanggalEfektif,ringkas}`, terbaru di atas.
    Dihitung hanya di route GET (`personel.js:291-294`), bukan di `ambil()` (`:224-228`), supaya respons POST/PATCH
    tidak berubah.
  - `GET /dashboard`: `totals.karierMenunggu` = pengajuan `Diproses` yang personelnya belum terarsip (pelajaran S3).
  - Frontend: `DetailDialog` diisi dari baris daftar (`SumdaPersonelR5H27.tsx:292`) atau respons PATCH (`:310`), jadi
    dialog harus memuat `GET /personel/:id` saat dibuka (K28).
- `API-CONTRACT.md`: bagian baru `## R5H28 …` setelah `:1695` (format R5H27 `:1650-1695`); catatan aditif di baris
  R5H27 `:1666` dan `:1671`; pola rollback sempit `:1694-1695` ditambah `/api/v1/subbagsumda/karier*`.

### 3. Rollback ke Go

| Yang di-rollback | Akibat |
|---|---|
| `/api/v1/subbagsumda/*` dicabut dari `SDL_EXPRESS_PATHS` + `--force-recreate caddy` (`admin off`, `Caddyfile:30-33`, `PERALIHAN-EXPRESS-PRODUKSI.md:107-108`) | `/karier*` → chi 404 `text/plain`. Personel/dashboard R5H27 juga 404 (sudah ditangani, `SumdaPersonelR5H27.tsx:78,121-130`) |
| Frontend | `SumdaKarierR5H28` memakai deteksi 404 non-JSON yang sama → "Karier & Mutasi tidak tersedia". Tidak ada cadangan registry (tidak ada padanan lama) |
| Rollback sempit | Pola R5H27 + `/api/v1/subbagsumda/karier*` → hanya registry ke Go |
| Data | Tabel 069 diam, tanpa dual-write; pengajuan Disetujui menunggu Express kembali; master tidak tersentuh |
| Skema | Tidak perlu dibalik; `Verify()` Go hanya memeriksa berkas ter-embed (`migrate.go:94-108`) |

### 4. Migrasi `069_sumda_karier_mutasi.sql`

Terakhir 068 (`migrate_test.go:80`, `src/migrations/index.js:119`). R5H15 → **070**
(`docs/R5H15-RIWAYAT-VERSI-DOKUMEN.md:12,106,169`); `MIGRATION-PLAN.md:16` → "049–069" + R5H28.

```sql
CREATE TABLE sdl_sumda_karier (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 jenis VARCHAR(20) NOT NULL CHECK (jenis IN ('UKP','KGB','MUTASI','PENYESUAIAN_JABATAN')),
 nomor_referensi VARCHAR(100) NOT NULL DEFAULT '',
 tanggal_usulan DATE NOT NULL,
 tanggal_efektif DATE,
 usulan_pangkat VARCHAR(200) NOT NULL DEFAULT '',
 usulan_jabatan VARCHAR(200) NOT NULL DEFAULT '',
 usulan_unit_kerja VARCHAR(200) NOT NULL DEFAULT '',
 status VARCHAR(12) NOT NULL DEFAULT 'Diajukan'
   CHECK (status IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 diterapkan JSONB,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_at TIMESTAMPTZ,
 selesai_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 selesai_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_karier_kgb CHECK (jenis <> 'KGB' OR (usulan_pangkat = '' AND usulan_jabatan = '' AND usulan_unit_kerja = '')),
 CONSTRAINT sdl_sumda_karier_pemutus CHECK ((decided_by IS NULL) = (decided_at IS NULL)
   AND (decided_by IS NULL OR decided_by <> created_by)),
 CONSTRAINT sdl_sumda_karier_diputus CHECK (status NOT IN ('Disetujui','Ditolak','Selesai') OR decided_by IS NOT NULL),
 CONSTRAINT sdl_sumda_karier_selesai CHECK (status <> 'Selesai' OR (tanggal_efektif IS NOT NULL
   AND diterapkan IS NOT NULL AND selesai_by IS NOT NULL AND selesai_at IS NOT NULL))
);
CREATE UNIQUE INDEX sdl_sumda_karier_terbuka_uq ON sdl_sumda_karier(personel_id, jenis)
 WHERE status IN ('Diajukan','Diproses','Disetujui');
CREATE INDEX sdl_sumda_karier_personel_idx ON sdl_sumda_karier(personel_id, created_at DESC);
CREATE INDEX sdl_sumda_karier_status_idx ON sdl_sumda_karier(status, created_at DESC);

CREATE TABLE sdl_sumda_karier_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 karier_id UUID NOT NULL REFERENCES sdl_sumda_karier(id) ON DELETE CASCADE,
 dari VARCHAR(12) CHECK (dari IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 ke VARCHAR(12) NOT NULL CHECK (ke IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_karier_riwayat_idx ON sdl_sumda_karier_riwayat(karier_id, id);

CREATE TABLE sdl_sumda_karier_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 karier_id UUID NOT NULL REFERENCES sdl_sumda_karier(id) ON DELETE CASCADE,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_karier_lampiran_idx ON sdl_sumda_karier_lampiran(karier_id, uploaded_at);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.karier.manage', 'Catat dan kelola pengajuan karier dan mutasi Subbagsumda'),
 ('subbagsumda.karier.approve', 'Setujui atau tolak pengajuan karier dan mutasi Subbagsumda')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key
  FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda', 'subbagsumda.karier.manage'),
    ('br_staf_subbagsumda', 'subbagsumda.karier.manage'),
    ('br_kasubbagsumda', 'subbagsumda.karier.manage'),
    ('br_kasubbagsumda', 'subbagsumda.karier.approve')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;
```

- Lolos pemeriksa substring (`migrate_test.go:105-151`): `updated_*` bukan `UPDATE␠`, `ON DELETE …` bukan
  `DELETE FROM`, tidak ada `;`/`--` dalam literal, tanpa `ALTER TABLE`. Deskripsi permission tanpa kata "update".
- Sengaja tanpa FK ke registry/tabel dokumen harness (`seed-docs` `TRUNCATE … CASCADE`,
  `harness/seed-documents.js:492`; pelajaran R1 R5H27).
- Manifes `migrate_test.go:80` + `src/migrations/index.js:119` dalam **commit yang sama** (runner Express menolak start
  bila berbeda, `index.js:144-151`).
- **069 harus benar sebelum di-commit** (hook memblokir edit migrasi ter-commit; pelajaran S7): `pg_dump` DB lokal →
  gladi `--migrate` Express + start Go + `go test ./internal/migrations/` → uji CHECK manual → baru commit.
- Angka CLAUDE.md (pemilik): 105 tabel / 69 berkas SQL.

### 5. Otorisasi

- **Bukan Engine A/B.** `PERMIT_SQL` R5H27 (`personel.js:79-88`), diputuskan lewat `SELECT EXISTS` sebelum query data;
  scope/klasifikasi tidak menyaring baris (K5/K16).

| Hak | Permission | Role |
|---|---|---|
| R | `subbagsumda.personel.read` (ada, `003_role_editor.sql:52`) | op, staf, kasubbag, kabagrenmin |
| M | `subbagsumda.karier.manage` (baru) | op, staf, kasubbag |
| A | `subbagsumda.karier.approve` (baru) | kasubbag |
| Selesai | M **dan** `subbagsumda.personel.update` | op, staf, kasubbag |

| Aksi | Dari | Ke | Hak |
|---|---|---|---|
| `proses` | Diajukan | Diproses | M |
| `setujui` | Diproses | Disetujui | A, bukan `created_by` (+ K19 bukan pengubah terakhir) |
| `tolak` | Diproses | Ditolak | A, bukan `created_by` (+ K19); catatan wajib (K24) |
| `batalkan` | Diajukan/Diproses | Dibatalkan | M dan (pencatat **atau** punya A); catatan wajib |
| `selesai` | Disetujui | Selesai | M + `personel.update`; `tanggalEfektif` wajib |

Kunci badan strict per aksi (`terapkan` hanya untuk `selesai`).

- **Maker-checker di SQL dalam transaksi** (naik dari preseden yang membandingkan di JS, `perencanaan.js:430`):
  (1) `UPDATE … WHERE id=$1 AND status='Diproses' AND version=$4 AND created_by <> $2::uuid`; `rowCount=0` → baca baris
  terkunci untuk memilih `version_conflict` / `status_tidak_sesuai` / 403 `self_review_forbidden`; (2) CHECK
  `sdl_sumda_karier_pemutus` sebagai penahan terakhir. Kepemilikan untuk batalkan/hapus lampiran masuk `WHERE`.
- **Selesai mengubah master, satu transaksi:** `SELECT karier … FOR UPDATE` → `SELECT personel … FOR NO KEY UPDATE`
  (terarsip → 409 `personel_terarsip`; versi ≠ `terapkan.personelVersion` → 409 `personel_berubah`) → validasi →
  `UPDATE sdl_sumda_personel … WHERE id AND version AND deleted_at IS NULL` (rowCount 1) → `UPDATE sdl_sumda_karier
  … status='Selesai' … WHERE status='Disetujui' AND version` → riwayat + audit.
- **Urutan kunci karier → personel** di semua jalur. `POST /karier` **tidak** mengunci personel (hindari deadlock dengan
  indeks K11 + FK). Personel dikunci `FOR NO KEY UPDATE` agar tidak memblokir `FOR KEY SHARE` FK.
- **Validasi nilai master:** `validasi()` R5H27 (`personel.js:171-197`) memvalidasi badan penuh dan menolak baris
  salinan; helper-nya tidak diekspor (`:98-197`). Ekstrak ke `src/modules/subbagsumda/umum.js`: `HttpError`,
  `handle(peta constraint→kode)`, `permit`/`PERMIT_SQL`, `body`, `teks`, `tanggal`, `pilihan`, `idParam`, `UUID_RE`,
  `GOLONGAN_PNS`, dan `cekPangkat(c, jenis, pangkat)` baru. **Satu kelas `HttpError`** (`handle()` memakai
  `instanceof`). Saat Selesai validasi per field: `teks(…,0,200)` (menolak `Cf`, pelajaran S5) + `cekPangkat`; pangkat
  tanpa pengecualian "lama" (pelajaran S6). `handle()` memetakan 23505 `sdl_sumda_karier_terbuka_uq` → 409
  `pengajuan_ganda` dan **23503 → 400 `invalid_input`** (kini jatuh ke 503, `:102-116`).
- **Lampiran:** periksa M + status sebelum membaca berkas (`perencanaan.js:670-671`); route tanpa `rawBody`;
  `readSingleFile({fieldName:'file', maxBodyBytes: BODY_LIMITS.SUMDA_LAMPIRAN, maxFileBytes: 5<<20, maxFiles: 2})`;
  validasi PDF (`SAFE_PDF_NAME`, `detectFileType`, `%PDF-`, `%%EOF`, `perencanaan.js:96,341-343`); `sealEvidence`,
  kunci invalid → 503 `evidence_encryption_unavailable` (fail-closed). Dalam transaksi: kunci karier, cek status,
  hitung (≥ 10 → 409 `batas_lampiran`), INSERT. Unduh: `id AND karier_id` (silang → 404), `openEvidence` + sha256
  (gagal → 503 `evidence_integrity_failure`), `octet-stream` + `attachment` + `nosniff` + `CSP sandbox` + `no-store`
  (`perencanaan.js:701-716`).
- **Audit** `subject_type='subbagsumda.karier'`: `create|update|proses|setujui|tolak|batalkan|selesai|lampiran.add|
  lampiran.delete|lampiran.download`; metadata daftar putih `{jenis,status,fields,version}` (pelajaran S4). Selesai
  juga menulis `subbagsumda.personel.update {fields,version}` (K23).

### 6. Berkas dibuat/diubah

**Express**: `src/modules/subbagsumda/umum.js` (baru, ekstraksi) · `personel.js` (impor `umum.js`; aditif
`riwayatKarier`, `karierMenunggu`) · `karier.js` (baru, `createSumdaKarierRouter`; daftar strict seperti
`personel.js:242-273`) · `src/http/payload.js:113` `SUMDA_LAMPIRAN: 5*1024*1024+65536` · `src/app.js` ·
`src/migrations/index.js:119` · `src/cli/seed-bagrenmin.js:61-63` · `verify/r5h28-sumda-karier.js` ·
`security/scenarios/r5h28.js` · `security/index.js`.

**Go**: `internal/migrations/sql/069_sumda_karier_mutasi.sql` · `internal/migrations/migrate_test.go:80` ·
`cmd/seed-bagrenmin/main.go:55-57` (identik dengan seed Express; seed menolak permission yang belum ada,
`main.go:209-218`).

**Frontend**: `SumdaBersama.tsx` (ekstraksi `Shade`, `api()` dengan peta galat + `FormData`, `TidakTersedia`/`ApiError`,
`tgl`, `waktu`, `StatusBadge`, `NamaSel` dari `SumdaPersonelR5H27.tsx:65-109,314-323`) · `SumdaKarierR5H28.tsx/.css`
(daftar + `Pager`, pilih personel via `GET /personel`, detail "sekarang → usulan", riwayat, lampiran dengan
`LampiranPreviewR5F15 … maxBytes={5*1024*1024}` pola `PersuratanR5H21.tsx:213`, unggah `FormData` + CSRF pola
`DokumenR5H13.tsx:108-110,313-314`, dialog Selesai, `?id=`/`lid` divalidasi UUID) · `SumdaPersonelR5H27.tsx`
(`DetailDialog` memuat `GET /personel/:id` + riwayat K13; kartu `karierMenunggu` K14; `SumdaNav` + `'karier'`) ·
`App.tsx` (`:153` `layanan` → `karier`; cabang render dekat `:598`). `RouteR5H26.ts` tidak berubah (`:85-87`);
alamat lama `/subbagsumda/layanan` menjadi `__layanan` — diuji.

**Docs**: dokumen ini, `API-CONTRACT.md`, `MIGRATION-PLAN.md:16`, `R5H15-…md:12,106,169` (→ 070),
`R2D5-SECURITY-TESTS.md` (x3), catatan sesi. Untuk pemilik: CLAUDE.md, memori R5H15.

### 7. Pengujian

**`verify/r5h28-sumda-karier.js`** (pola `verify/r5h27-sumda-personel.js`; personel uji `UJI-R5H28-`, dibersihkan di
awal/akhir; lampiran lewat `client.request(…,{multipart:[…]})`, `harness/client.js:27-42,100-102`):
1. Alur per jenis: UKP → pangkat (Polri rank aktif / PNS golongan); MUTASI → jabatan + unit; PENYESUAIAN_JABATAN →
   jabatan; KGB → master tetap, `diterapkan={}`. Versi personel naik tepat satu; `diterapkan` lama→baru; riwayat lengkap.
2. Maker-checker: op catat → Kasubbag setujui 200; Kasubbag catat → setujui/tolak 403, status tetap; K19 (Kasubbag
   PATCH milik op → tidak bisa setujui); Kabag 403; CHECK DB diuji dengan UPDATE langsung → 23514.
3. Transisi tidak sah → 409 `status_tidak_sesuai`; PATCH saat Diproses; batalkan oleh non-pencatat tanpa A → 403.
4. K11 → 409 `pengajuan_ganda`; jenis lain boleh; setelah Ditolak boleh baru.
5. K10/personel: `personel_berubah` tanpa sisa tulisan; `personel_terarsip`; `tanggalEfektif` kosong 400;
   `personel_belum_lengkap` (K27); `personel_tidak_aktif` (K20); `invalid_rank`.
6. Validasi setara R5H27: zero-width/U+202E, panjang 201, field asing.
7. Lampiran: unggah→unduh byte-identik, `body` diawali `SDL1` tanpa `%PDF`; PDF palsu 400; > 5 MB 413; ke-11 409;
   hapus oleh bukan pengunggah/Kasubbag 403; hapus setelah Disetujui 409; unggah setelah final 409; `body` dirusak →
   503 `evidence_integrity_failure` (pola `r4a3b.js:149-154`).
8. Audit tanpa NRP/nama/nama berkas/nilai; Selesai juga menulis `personel.update`.
9. Aditif R5H27: `riwayatKarier` urut terbaru; POST/PATCH personel tanpa field itu; `karierMenunggu` sebagai selisih.
10. Regresi `verify/r5h27-sumda-personel.js` (ekstraksi `umum.js`).

**Skenario `x3_r5h28_sumda_karier_guard`** (`security/scenarios/r5h28.js`, setelah `x2_` di `security/index.js:67`;
role terisolasi penuh / operator / baca / approver-saja):
- Guard: anonim 401; Superadmin 403 untuk semua metode termasuk **app kedua mode demo** (pola `r5h27.js:79-99`); UUID
  fiktif 403 bukan 404; capabilities `false` untuk unit lain/tanpa keanggotaan/Superadmin demo.
- Matriks: baca → mutasi/unggah 403; tanpa A → setujui/tolak 403; pencatat dengan A → 403; approver-saja → setujui 200,
  proses/selesai 403; selesai tanpa `personel.update` → 403.
- Pencabutan: kedaluwarsa, role nonaktif, `must_change_password`, dicabut → 403.
- CSRF/Origin untuk POST/PATCH/aksi/DELETE lampiran/**multipart** (`browser.upload(…,{csrf:false})`, `browser.js:109-137`).
- Lampiran: PDF palsu 400; nama `<script>.pdf`/`a.exe` 400; `../../x.pdf` tersimpan tanpa `/`/`..` (perilaku busboy
  `preservePath:false` **belum diperiksa di kode** — diasersikan); > 5 MB 413; dua berkas 400 `one_file_required`;
  `lid` silang → 404 unduh/hapus; header unduhan aman.
- Bentuk: field asing, `__proto__`, NUL, surrogate, `Cf` → 400; `terapkan` pada aksi selain selesai → 400; JSON > 32 KB
  → 400; probe `q` & parameter ganda (pola `r5h27.js:129-146`); `no-store`.
- Kunci evidence: app ketiga dengan `evidenceKey` kosong → unggah/unduh 503 (fail-closed).
- Suite Express **24/24**.

**Harness golden:** endpoint baru tidak direkam; kasus 32–37 tetap cocok; 127 `/admin/permissions` & 128 `/admin/roles`
(`harness/registry.js:355-359`) berubah karena 069 → rekam ulang `capture` + `compare` satu siklus, **oleh pemilik**.

**Gerbang:** `go test ./...` · build image `api` · `node --check` · `--migrate` Express + start Go · diff seed kosong ·
verify R5H28 + R5H27 · x2 tetap hijau setelah ekstraksi · dua suite keamanan (24/24) · harness `compare` ·
`npm run build` · demo browser (op, staf, kasubbag, kabagrenmin) + simulasi rollback.

### 8. Urutan kerja

1. Persetujuan K17–K28; R5H15 → 070. *Gerbang:* pemilik setuju.
2. Migrasi 069 + manifes + seed, **belum di-commit**: `pg_dump -Fc` → gladi → `go test` → uji CHECK manual →
   *baru commit*.
3. Ekstraksi `umum.js` tanpa perubahan perilaku. *Gerbang:* `node --check`, verify R5H27, x2.
4. `karier.js` + mount + `payload.js` + aditif R5H27. *Gerbang:* verify R5H28, regresi R5H27, harness compare.
5. Skenario `x3_`. *Gerbang:* dua suite hijau + uji mutasi (matikan cek pencatat/CSRF sementara → x3 merah).
6. Frontend (`SumdaBersama` → `SumdaKarierR5H28` → R5H27 + `App.tsx`). *Gerbang:* `npm run build`, demo per akun,
   simulasi rollback.
7. Docs, `/verifikasi`, `/review`; golden 127/128 oleh pemilik.
8. Deploy: cek `SDL_EVIDENCE_KEY` produksi (baca saja); **centang "Izinkan migrasi"** (`deploy.sh` menjalankan migrasi
   di langkah 7 sebelum `up` di langkah 8); rebuild `api`, `api-express`, `frontend`.

### 9. Risiko dan keputusan baru

| # | Risiko | Penanganan |
|---|---|---|
| R1 | Seed hanya punya satu Kasubbagsumda (`main.go:57`) → pengajuan yang ia catat sendiri macet (K9) | Peringatan di layar saat Kasubbag mencatat; approver kedua lewat Role Editor; disarankan op/staf mencatat |
| R2 | Deadlock karier↔personel | Urutan kunci tetap, `FOR NO KEY UPDATE`, `POST /karier` tanpa kunci personel; diuji paralel |
| R3 | 069 tidak bisa diperbaiki setelah commit | Gladi + `pg_dump` sebelum commit; CHECK seminimal keputusan |
| R4 | Ekstraksi `umum.js` merusak R5H27 | Langkah terpisah + gerbang verify R5H27 + x2; satu `HttpError` |
| R5 | `SDL_EVIDENCE_KEY` produksi salah → lampiran 503 | Fail-closed disengaja; cek sebelum deploy; x3 membuktikan 503 tanpa plaintext |
| R6 | PII di `diterapkan` & lampiran terbuka untuk semua pembaca Sumda + Kabag (K5) | Sama dengan Master Personel; tanpa ekspor, `no-store`, audit tanpa nilai, lampiran tersegel & unduhan teraudit |
| R7 | Rollback Go → layar Karier tanpa cadangan | Pesan "tidak tersedia"; data diam |
| R8 | 23503/22P02 jatuh ke 503 (`personel.js:113`) | UUID divalidasi dulu; `handle()` memetakan 23503 |
| R9 | Alamat lama `/subbagsumda/layanan` | Menjadi `__layanan`; diuji di demo |

| # | Hal | Usulan |
|---|---|---|
| K17 | Jenis berkas | PDF saja (K4); pindaian JPG/PNG diubah ke PDF dulu |
| K18 | PATCH | Hanya saat Diajukan; `personelId` dan `jenis` tidak bisa diubah (ganti = batalkan + buat baru) |
| K19 | Maker-checker | Pengubah terakhir usulan (`updated_by` dari PATCH) juga tidak boleh memutuskan |
| K20 | Status personel | Buat: hanya Aktif/MPP (409 `personel_tidak_aktif`). Selesai: boleh status apa pun yang belum terarsip, dengan peringatan |
| K21 | Isi `diterapkan` | `{"fields":{"pangkat":{"lama":…,"baru":…},…},"personelVersion":{"lama":n,"baru":n+1}}`; KGB `{}` |
| K22 | Versi pengajuan | Tambah/hapus lampiran menaikkan `version` (preseden `perencanaan.js:365`) |
| K23 | Audit tambahan | `lampiran.download`; Selesai juga menulis `subbagsumda.personel.update` |
| K24 | Catatan wajib | Tolak/batalkan ≥ 8 karakter (preseden `perencanaan.js:421`); lainnya opsional |
| K25 | Kode galat lampiran | 413 `file_too_large`, 400 `one_file_required`/`invalid_file_type` (pola `perencanaan.js:336-343`) |
| K26 | Arsip personel | Tetap boleh walau ada pengajuan terbuka; pengajuan tampil "personel terarsip" dan hanya bisa dibatalkan |
| K27 | UKP untuk personel tanpa `jenis` | Ditolak saat buat → 409 `personel_belum_lengkap` |
| K28 | Riwayat K13 | Aditif di `GET /personel/:id`, dialog memuat ulang saat dibuka |

### Temuan yang mengoreksi dokumen rilis (sudah diterapkan di atas)

1. Validasi Selesai tidak bisa memakai `validasi()` R5H27 apa adanya → ekstraksi `umum.js` + validasi per field.
2. K13 butuh dialog memuat `GET /personel/:id`; `SumdaNav` perlu `'karier'`.
3. "Kunci pengajuan dan personel `FOR UPDATE`" berisiko deadlock → `FOR NO KEY UPDATE`, pembuatan tanpa kunci personel.
4. Kode galat lampiran mengikuti pola yang ada (`file_too_large`, `one_file_required`, `invalid_file_type`).
5. Kolom lampiran `filename`/`size_bytes`; tambahan `selesai_by`/`selesai_at`.
6. Maker-checker dinaikkan ke `WHERE` UPDATE + CHECK DB.
7. Rollback sempit + `/api/v1/subbagsumda/karier*`; rollback Caddy = `--force-recreate caddy`.
8. Satu Kasubbag di seed → R1.
9. Kode galat baru `personel_tidak_aktif`, `personel_belum_lengkap`; 23503 dipetakan.
10. Audit `lampiran.download`.
11. R5H15 069 → 070 di `R5H15-…md:12,106,169`; `MIGRATION-PLAN.md:16`.

## Menyimpang dari rencana

Tambahan kecil; tidak ada yang mengubah keputusan K1–K28.

| # | Rencana | Yang dikerjakan | Alasan |
|---|---|---|---|
| D1 | K26: pengajuan personel terarsip hanya bisa dibatalkan | Ditegakkan juga pada PATCH dan aksi `proses`/`setujui`/`tolak` (409 `personel_terarsip`) | Konsekuensi langsung K26 |
| D2 | `riwayatKarier` di `GET /personel/:id` | Dibatasi 50 entri terbaru | Mencegah respons membengkak |
| D3 | Batalkan oleh bukan pencatat tanpa hak setuju | 403 `access_denied` (diputuskan di `WHERE` UPDATE) | Rencana tidak menyebut kodenya |
| D4 | `handle()` memetakan 23503 → 400 | Berlaku juga untuk modul Master Personel (R5H27) | Satu `handle` bersama di `umum.js`; di R5H27 kasus ini praktis tidak terjadi |
| D5 | Uji deadlock paralel (R2) di verify | **Belum dibuat.** Pencegahan tetap lewat urutan kunci + `FOR NO KEY UPDATE` + pembuatan tanpa kunci personel | Perlu dua koneksi bersamaan; diusulkan sebagai uji lanjutan |
| D6 | x3: Origin asing untuk multipart | Diuji tanpa CSRF saja | `Browser.upload` belum bisa mengirim Origin kustom; JSON sudah diuji Origin asing |
| D7 | Alasan tolak/batal | Dialog alasan sendiri (bukan `window.prompt`) | Sesuai design brief |
| D8 | — | `.sdl-progar__fields.sdl-sumda__grid label{align-content:start}` di CSS R5H27 | Tinggi input tidak meregang bila label sebelah punya teks bantuan (juga memperbaiki form personel) |

## Perbaikan hasil review (2026-11-23)

`/review` (migration-guard + security-reviewer): satu temuan wajib (W1), dikerjakan bersama saran S1–S8 atas
persetujuan pemilik (termasuk perluasan K19).

| # | Temuan | Perbaikan |
|---|---|---|
| W1 | Maker-checker bisa dielakkan: approver mengganti lampiran operator lalu menyetujui | Unggah/hapus lampiran kini juga mengisi `updated_by` (perluasan **K19**: pengubah lampiran termasuk "pengubah terakhir") |
| S1 | Nama berkas non-Latin-1 bisa membuat unduhan 503 setelah audit tercatat | `Content-Disposition` dengan `filename*=UTF-8''…` (RFC 5987); header dipasang sebelum audit. Catatan: busboy membaca nama multipart sebagai Latin-1, jadi nama UTF-8 umumnya tertolak di validasi nama (400); frontend kini mengganti karakter non-ASCII dengan `_` sebelum unggah |
| S2 | K26 belum berlaku untuk lampiran | Unggah dan hapus lampiran menolak `personel_terarsip` |
| S3 | Cek "personel terarsip" pada proses/setujui/tolak tanpa kunci | `FOR SHARE` (urutan karier → personel tetap) |
| S4 | Nilai Selesai yang berbeda dari usulan tidak terlihat | `diterapkan.dikoreksi` + metadata audit `selesai` (nama field saja) + penanda "Dikoreksi saat selesai" di UI |
| S5 | Bagian R5H27 di API-CONTRACT tanpa rujukan R5H28 | Rujukan silang `riwayatKarier`, `karierMenunggu`, 23503, dan pola rollback ditandai usang |
| S6 | Komentar `umum.js` mengklaim tanpa perubahan perilaku | Dikoreksi (menyebut 23503 → 400) |
| S7 | Skenario x3 kurang | + K19 via PATCH, W1 via lampiran, `terapkan` strict (7 varian), KGB + `terapkan`, K26 lampiran, nama non-ASCII tanpa 503, penanda `dikoreksi` |
| S8 | `/aksi` memvalidasi isian sebelum cek hak | Cek hak lebih dulu |

## Sisa uji (lewat `/verifikasi`)

- `scripts/security-test-r2d5.sh` (suite Go; 069 ter-embed) dan `go test ./...` penuh (sejauh ini migrasi + seed + build image `api`).
- Harness golden: 127 `/admin/permissions` dan 128 `/admin/roles` berubah lagi karena 069 → rekam ulang oleh pemilik;
  kasus 32–37 harus tetap cocok.
- Verify regresi lain (`r5h25-master-tahap.js`, `r5h21-flow.js`, `r5h13-flow.js`).
- Demo browser akun staf & Kabagrenmin, alur Tolak/Batal, dan simulasi rollback (upstream ke Go) untuk layar Karier.

Data uji lokal yang ditinggalkan: satu pengajuan UKP Selesai untuk `[UJI] Budi Santoso` (pangkat berubah ke Bharaka)
beserta lampiran `sk-uji.pdf`.
