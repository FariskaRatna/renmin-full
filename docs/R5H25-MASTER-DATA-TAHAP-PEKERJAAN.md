# R5H25 — Master Data: tahap pekerjaan aktif/nonaktif

Status: **SELESAI (2026-11-22), di-commit** (`671ec04`, `7863ee5`, `6e20609` + perbaikan review). K1–K11 disetujui pemilik. Menunggu deploy. Khusus Express. Migrasi **067** (R5H15 → 068).

## Kebutuhan (kata pemilik)

> "di menu progar dan dalgar kan ada banyak isian … misal LRA tuh kegiatannya apa saja, nah aku tuh mau supaya
> dia dinamis gitu, jadi mungkin di superadmin bagian master data kali, bisa on off soal list kegiatannya,
> soalnya pas aku paparan kemarin, user mention itu kan banyak banget kegiatannya, dan kemungkinan ada banyak
> yang ga kepakai, nanti pas penggunaan bisa disesuaikan, cuma kan kalau penyesuain dari code kan lumayan ribet"

"Kegiatan" di sini = **tahap pekerjaan** per jenis dokumen, yaitu daftar `JENIS_TAHAP` di
`apps/backend-express/src/modules/subbagren/tahap-katalog.js` (21 jenis: PROGAR Renstra … Perjanjian Kinerja,
DALGAR Laporan LRA … Revisi RPD; 36 tahap unik, 111 pasangan jenis–tahap).

## Keputusan pemilik (2026-11-22)

| Hal | Keputusan |
|---|---|
| Siapa yang mengatur | **Superadmin**, lewat menu khusus **Master Data** (bukan menu kerja Subbagren) |
| Yang diatur | **Tahap saja**, per pasangan (jenis dokumen, tahap). Jenis dokumen tidak bisa disembunyikan |
| Urutan | **Tidak** diatur, tetap urutan kode |
| Efek nonaktif | Tidak muncul sebagai pilihan saat **menambah** tahap. Tahap yang sudah tercatat **tetap utuh**, terbuka, dan bisa diubah |
| Bawaan | Semua **aktif** (tanpa baris = aktif), jadi tidak ada yang berubah sampai Superadmin mematikan |
| Tahap syarat sistem | **Dikunci** (selalu aktif, saklar tampil terkunci dengan alasannya) |
| Minimal | Setiap jenis wajib menyisakan **minimal satu** tahap aktif |
| Alasan | **Wajib** (8–500 karakter, seperti editor role) |
| Jejak | Siapa, kapan, alasan, dan nilai lama/baru dicatat di `sdl_audit_events` |

### Tahap terkunci (syarat aturan yang sudah ada)

| Jenis | Tahap | Alasan |
|---|---|---|
| `revisi_rpd` | `dipa_baru` | Revisi RPD baru bisa Selesai bila tahap ini diterima dengan PDF DIPA (keputusan 2026-11-18, `perencanaan.js` final) |

Daftar ini ditulis di kode (`TAHAP_WAJIB` di `tahap-katalog.js`), bukan di database. Menambah syarat baru di
kemudian hari = menambah entri di sana.

Catatan: tahap **"Mengajukan pengesahan"** tidak dikunci. Bila dimatikan, PDF bertanda tangan tetap bisa
diunggah langsung ke dokumen (jalur `berkas` yang sudah ada), jadi pengesahan tidak macet. Teks bantuan di
detail dokumen yang menyarankan lampiran di tahap pengesahan disesuaikan bila tahap itu nonaktif.

## Pemisahan Superadmin ↔ operasional tetap utuh

`docs/SUPERADMIN-ACCESS-POLICY.md`: Superadmin ditolak dari semua endpoint operasional. R5H25 **tidak**
mengubah aturan itu:

- Endpoint baru dipasang di bawah `/api/v1/admin` (guard **AuthorizeRoleEditor**: Superadmin +
  `identity.roles.manage` + CSRF + bukan `must_change_password`), sama seperti editor role.
- Superadmin hanya melihat dan mengubah **katalog tahap** (nama jenis, nama tahap, aktif/nonaktif). Tidak ada
  dokumen, angka anggaran, lampiran, atau nama pembuat dokumen yang dibaca endpoint ini.
- Pengguna operasional tidak bisa mengubah saklar; mereka hanya menerima katalog yang sudah tersaring.

## Alur

1. Superadmin → **Master Data → Tahap Pekerjaan**. Daftar dikelompokkan PROGAR / DALGAR → jenis dokumen →
   tahap, masing-masing dengan saklar. Tahap terkunci menampilkan gembok + alasan. Saklar terakhir yang aktif
   di satu jenis tidak bisa dimatikan.
2. Superadmin mengubah satu atau beberapa saklar dalam satu jenis, menulis alasan, lalu **Simpan**.
3. Server memvalidasi (pasangan sah, bukan tahap terkunci, minimal satu aktif, versi cocok), menyimpan, dan
   mencatat audit.
4. Operator Subbagren membuka dokumen → **Tambah tahap**: hanya tahap aktif yang ditawarkan. Tahap nonaktif
   yang **sudah tercatat** di dokumen tetap tampil dan bisa dibuka/diubah seperti biasa.

## Backend yang melayani

Express saja (sama dengan R5H16–R5H24). `/api/v1/subbagren/*` sudah dilayani Express di produksi.
`/api/v1/admin/*` **menurut catatan terakhir masih Go** (`CATATAN-SESI-2026-11-10.md`); hanya
`/api/v1/admin/master/*` (R5H8) yang diminta dialihkan. Jadi path endpoint baru harus ikut dialihkan di Caddy
(lihat Rencana Implementasi §1 dan keputusan K2). Go tidak disentuh, dan tidak ada kontrak lama yang berubah
bentuk (lihat di bawah).

## Endpoint baru/berubah

| Metode | Path | Guard | Isi |
|---|---|---|---|
| GET | `/api/v1/admin/master/tahap-pekerjaan` | AuthorizeRoleEditor | `{ version, jenis: [{ key, label, kelompok: 'progar'\|'dalgar', tahap: [{ key, label, aktif, terkunci, alasanKunci? }] }] }` |
| PUT | `/api/v1/admin/master/tahap-pekerjaan/:jenis` | AuthorizeRoleEditor + CSRF | `{ aktif: { <tahap>: boolean, … }, reason, version }` → `200 { version, changed }`. Strict (field asing `400 invalid_request`) |
| GET | `/api/v1/subbagren/perencanaan/tahap-katalog` (sudah ada) | operasional | **Tambahan aditif**: field baru `nonaktif: { <jenis>: [<tahap>…] }`. `jenis` tetap berisi daftar lengkap supaya label/urutan tahap lama tetap terbaca |

Kode galat PUT: `400 invalid_request` (field asing/bukan JSON), `400 invalid_input` (pasangan tidak dikenal, nilai bukan boolean, alasan kurang/lebih atau berisi karakter kendali/surrogate tunggal), `409 tahap_terkunci`,
`409 minimal_satu_tahap`, `409 version_conflict`.

Penegakan di server (bukan hanya UI): `POST /dokumen/:id/tahap` menolak tahap nonaktif dengan
`409 tahap_nonaktif`. **PUT/DELETE tahap yang sudah ada tidak diperiksa**, karena data lama tetap boleh dikoreksi.

## Migrasi

`067_master_tahap.sql`:

```sql
CREATE TABLE sdl_ren_tahap_nonaktif (
  jenis       VARCHAR(40) NOT NULL,
  pekerjaan   VARCHAR(40) NOT NULL,
  updated_by  UUID NOT NULL REFERENCES sdl_users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (jenis, pekerjaan)
);
CREATE TABLE sdl_ren_tahap_master_versi (
  id      SMALLINT PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sdl_ren_tahap_master_versi(id) VALUES (1);
```

- Hanya baris **nonaktif** yang disimpan, sehingga tahap baru dari kode otomatis aktif.
- Baris yatim (pasangan yang sudah dihapus dari kode) diabaikan saat membaca.
- Satu versi global untuk optimistic locking (perubahan jarang, satu editor).
- Daftarkan di `migrate_test.go` + `migrations/index.js`. Aturan "klausa berkoma" pemeriksa migrasi hanya
  berlaku untuk `ALTER TABLE`; `CREATE TABLE` cukup bebas dari substring terlarang. R5H15 digeser ke 068
  (`docs/R5H15-RIWAYAT-VERSI-DOKUMEN.md`).

## Otorisasi

- **Bukan Engine A/B**. Ini endpoint identitas/admin di bawah guard tingkat router AuthorizeRoleEditor, pola
  `modules/roles`. Tidak ada permission baru dan tidak ada grant berskop.
- Superadmin tetap **ditolak** di semua endpoint `/api/v1/subbagren/*` (tidak berubah).
- Akun operasional (termasuk Kasubbagren) → `403` di `/api/v1/admin/master/tahap-pekerjaan*` (perilaku guard yang ada).

## Frontend

- `MasterDataTahapR5H25.tsx/.css`: tab baru **"Subbagren — Tahap Pekerjaan"** di halaman **Master Data**
  Superadmin yang sudah ada (`MasterDataR5G12.tsx`, R5G12/R5H8), ikut `docs/DESIGN-BRIEF.md`. Dialog Simpan
  meminta alasan. `App.tsx` tidak perlu diubah.
- `DokumenTahapR5H16.tsx`: pilihan "Tambah tahap" menyaring `nonaktif`; tahap tercatat yang nonaktif diberi
  label kecil "nonaktif di Master Data".
- `DokumenR5H13.tsx`: teks bantuan PDF sah menyesuaikan bila tahap pengesahan nonaktif.

## Rencana uji

`verify/r5h25-master-tahap.js` (harness, Express):

1. Superadmin GET → 21 jenis, semua aktif, `dipa_baru` di `revisi_rpd` terkunci.
2. Superadmin PUT matikan `lap_lra.unduh_myinterest` + alasan → 200. Katalog operasional memuat `nonaktif`.
3. Operator POST tahap `unduh_myinterest` di dokumen LRA → `409 tahap_nonaktif`. Tahap yang **sudah ada**
   tetap bisa GET/PUT.
4. PUT tanpa alasan / alasan < 8 → 400. Field asing → 400. Versi basi → 409.
5. PUT matikan `revisi_rpd.dipa_baru` → `409 tahap_terkunci`.
6. PUT mematikan semua tahap satu jenis → `409 minimal_satu_tahap`.
7. Pasangan tidak dikenal (`lap_lra.pokja`, jenis palsu) → 400.
8. Audit: baris `master.tahap.update` berisi alasan + daftar perubahan.
9. Nyalakan kembali → pilihan muncul lagi. Data uji dikembalikan ke semua aktif.

Skenario keamanan (tambahkan ke `scripts/security-test-express.sh`):

- Operator/Kasubbagren → GET/PUT Master Data tahap **403**. Anonim → 401.
- Superadmin PUT tanpa CSRF → 403. Superadmin `must_change_password` → 403.
- Superadmin tetap **403** di `/api/v1/subbagren/perencanaan/*` (regresi pemisahan).

Gerbang: `go test` (manifes migrasi), suite keamanan Go + Express, `npm run build` frontend, uji browser
(Superadmin wajib HTTPS + OTP; di lokal pakai sesi uji yang sudah ada).

## Di luar cakupan

- Menyembunyikan **jenis dokumen** atau menu (keputusan: tahap saja).
- Mengatur **urutan** tahap, mengganti **nama/label** tahap, atau menambah tahap baru tanpa kode (tiap tahap
  punya formulir isian sendiri).
- Pengaturan per tahun anggaran atau per unit; saklar berlaku global untuk seluruh Subbagren.
- Master data lain (daftar kegiatan anggaran/kode kegiatan myinterest, aplikasi, cara kirim, dsb.). Kandidat
  rilis berikutnya bila diminta.
- Mengubah perilaku Go atau kontrak 142 endpoint.

## Rencana Implementasi

> Disusun 2026-11-22 dari kode di `main` (6db831d) oleh subagen `planner`, diperiksa ulang. Belum ada kode.
> Status: K1–K11 **disetujui** pemilik 2026-11-22; dikerjakan (lihat Progres implementasi).

### 1. Backend: Express saja

- **Alasan.** `/api/v1/subbagren/perencanaan` hanya ada di Express (`apps/backend-express/src/app.js:105-106`,
  "R5H13 … Express saja"); router Go tidak punya padanannya. Pola sama dengan R5H16–R5H24 dan preseden master
  data Superadmin R5H8 (`API-CONTRACT.md:1487-1503`, "EXPRESS SAJA").
- **Caddy** (`infra/Caddyfile:39-42`): hanya path di `SDL_EXPRESS_PATHS` yang ke `api-express`.
  `/api/v1/subbagren/*` sudah Express. `/api/v1/admin/*` menurut catatan 2026-11-10 masih Go; R5H8 hanya
  menambah `/api/v1/admin/master/*`. **Syarat deploy:** path admin R5H25 harus tercakup (lihat K2). Cek nilai
  produksi dengan `scripts/server-check.sh`.
- **Go:** hanya satu baris manifes di `migrate_test.go`. Image `api` tetap di-rebuild karena meng-embed SQL.
- **`API-CONTRACT.md`:** endpoint Express-only tidak bernomor. Tambah bagian
  `## R5H25 — Master Data tahap pekerjaan aktif/nonaktif (2026-11-22, EXPRESS SAJA)` di akhir berkas, dengan
  tabel `Metode | Path | Guard/Hak | Isi` (guard **RE** / **O**), migrasi 067, rujukan dokumen & verify, dan
  paragraf rollback. Catatan: R5H16–R5H24 (termasuk `tahap-katalog`) belum tercatat di sana; R5H25 jadi entri
  pertama untuk endpoint tahap.

### 2. Dampak kontrak

- **Tidak ada dari 142 endpoint beku yang berubah.** Inventaris §5 `API-CONTRACT.md` tidak memuat
  `/subbagren/perencanaan`; `/api/v1/admin` beku hanya #127-142 + #156-157.
- `GET /tahap-katalog` dan `POST /dokumen/:id/tahap` adalah endpoint **Express-only R5H16** (migrasi 053,
  `perencanaan.js:30-32`), bukan kontrak beku.
- Field `nonaktif` **aditif**; `jenis`, `pekerjaan`, `tanpaSah`, `periode`, `sumber` tidak berubah
  (`tahap-katalog.js:327`). Frontend lama tetap jalan.
- `409 tahap_nonaktif` hanya di `POST /dokumen/:id/tahap`; PUT/DELETE/lampiran/cek tahap tidak terpengaruh.

### 3. Rollback ke Go

| Yang di-rollback | Akibat |
|---|---|
| Path admin R5H25 ke Go | Guard Go tetap jalan (anonim 401, non-Superadmin 403); Superadmin dapat 404. Tab Tahap Pekerjaan menampilkan galat muat. Baris nonaktif yang tersimpan **tetap ditegakkan** Express selama `/subbagren/*` di Express |
| `/api/v1/subbagren/*` ke Go | PROGAR/DALGAR (R5H11+) memang sudah 404 di Go. Tidak ada dampak tambahan; tabel baru diabaikan |
| Image Express lama | Tabel diam, tanpa dual-write. Frontend menganggap `nonaktif` kosong = semua aktif |
| Skema | Tidak perlu dibalik. `Verify()` Go hanya memeriksa berkas ter-embed (`migrate.go:94-102`) |

### 4. Migrasi `067_master_tahap.sql`

- Isi sesuai bagian Migrasi di atas, ditambah CHECK pola mis. `CHECK (jenis ~ '^[a-z_]{2,40}$')`.
- Manifes: `apps/backend/internal/migrations/migrate_test.go:78` dan
  `apps/backend-express/src/migrations/index.js:117`. Runner Express menolak jalan bila daftar tidak cocok
  (`index.js:142-149`), termasuk di stack uji keamanan.
- Pemeriksa (`migrate_test.go:103-219`) memindai semua pernyataan untuk substring terlarang: jangan pakai
  `ON UPDATE`, `DELETE FROM`, `RENAME TO`, dan jangan ada `;` di dalam literal. Tidak perlu entri peta `reviewed`.
- R5H15 → 068: perbarui `docs/R5H15-RIWAYAT-VERSI-DOKUMEN.md:12,106,169`. `MIGRATION-PLAN.md:13-15`
  diperbarui (rentang 049–067, tambah R5H22–R5H25).

### 5. Otorisasi

- **Endpoint admin:** guard **AuthorizeRoleEditor** (`auth/guards.js:60-83`): sesi → CSRF non-GET → Superadmin
  + role aktif + `identity.roles.manage` + `NOT must_change_password`, diputuskan dalam satu query SQL.
  Mount baru setelah `app.js:80`. Bukan Engine A/B; tidak ada permission/grant baru.
- **POST tahap:** hak tetap `subbagren.progar.manage` via `PERMIT_SQL` (`progar.js:71-80`), yang menolak
  Superadmin di SQL, bahkan bila `SDL_DEV_SUPERADMIN_WORKSPACE=true`.
- **Penegakan nonaktif di SQL, di transaksi POST** (`perencanaan.js:779`):
  - `lockForTahap` (`:453-461`) hanya diubah agar `return d`.
  - Pemeriksaan **tidak** dimasukkan ke `lockForTahap`, karena fungsi itu juga dipakai PUT/DELETE/lampiran/cek
    tahap yang wajib tetap bisa mengoreksi data lama.
  - Sesudahnya `tolakNonaktif(c, d.jenis, pekerjaan)`: `SELECT EXISTS(… sdl_ren_tahap_nonaktif …)` pada client
    transaksi yang sama → `409 tahap_nonaktif`; pasangan `TAHAP_WAJIB` dilewati.
  - Urutan galat: 404 / `pekerjaan_tidak_sesuai` / `dokumen_terkunci` → `tahap_nonaktif` → `cekSumber` →
    `batas_tahap`.
- Katalog: `nonaktif` dibaca dari SQL; baris yatim dan pasangan terkunci dibuang (bukan data otorisasi).

### 6. Berkas yang dibuat/diubah

**Express**
- `src/modules/subbagren/master-tahap.js` (baru): `createMasterTahapRouter({ pool })`.
  - `GET /master/tahap-pekerjaan`: `kelompok` dari `tahapPerluCek` (`dalgar.js:17-23`).
  - `PUT /master/tahap-pekerjaan/:jenis`: `parsePayload` strict, `reason` 8–500 tanpa karakter kendali/surrogate tunggal.
  - Transaksi PUT: versi `FOR UPDATE` → validasi `tahap_terkunci` / `minimal_satu_tahap` → DELETE/INSERT baris
    nonaktif jenis itu → naikkan versi → audit `master.tahap.update` (`subject_type='ren.tahap'`, metadata
    `versionBefore`, `nonaktifBefore/After`, `dinyalakan`, `dimatikan`, `reason`; pola `roles/index.js:85-91`).
  - Ekspor `tahapNonaktif(runner)` dan `tolakNonaktif(c, jenis, pekerjaan)`.
- `tahap-katalog.js`: `TAHAP_WAJIB = { revisi_rpd: { dipa_baru: '<alasan>' } }`; `katalog(nonaktif = {})`.
  Berkas tetap murni, tanpa DB.
- `perencanaan.js`: `export JENIS_LABEL` (`:86`); `/tahap-katalog` memuat `nonaktif` (`:146-149`);
  `lockForTahap` `return d`; `tolakNonaktif` di POST (`:779`); komentar kepala.
- `src/app.js`: import + satu mount.

**Frontend**
- `MasterDataTahapR5H25.tsx/.css` (baru): PROGAR/DALGAR → jenis → saklar; gembok + alasan; saklar aktif
  terakhir tidak bisa dimatikan; dialog alasan; `version_conflict` memuat ulang.
- `MasterDataR5G12.tsx`: grup baru di `GROUPS` (`:27-34`) dan render tab (`:315`).
- `DokumenTahapR5H16.tsx`: tipe `nonaktif?`; pisahkan daftar `semua` vs `aktif` (`:83-87`); opsi blok baru
  hanya `aktif` (`:224`); blok tersimpan tetap menampilkan pekerjaannya; label "nonaktif di Master Data".
- `DokumenR5H13.tsx`: pesan `tahap_nonaktif`; label di register tahap; teks bantuan PDF sah (`:595`) dan pesan
  `berkas_required` (`:52`) menyarankan unggah langsung bila tahap pengesahan nonaktif.
- `App.tsx` dan `SumberSuratR5H22.tsx` tidak berubah.

**Docs:** dokumen ini, `API-CONTRACT.md`, `MIGRATION-PLAN.md`, `R5H15-…md`, `R2D5-SECURITY-TESTS.md` (bila K11
disetujui), catatan sesi.

### 7. Pengujian

**`apps/backend-express/verify/r5h25-master-tahap.js`** (pola `verify/r5h21-flow.js`)
- Sesi Superadmin tanpa OTP lewat `db.superadminUserId()` + `db.mintSession()` (`harness/db.js:42-84`).
  Script gagal cepat bila Superadmin lokal masih `must_change_password`.
- Aktor: superadmin, op-subbagren, staf-subbagren, kasubbagren.
- Potret `sdl_ren_tahap_nonaktif` di awal, pulihkan di `finally`.
- Kasus: sembilan butir Rencana uji di atas, ditambah:
  - Tahap LRA yang tercatat **sebelum** dimatikan tetap bisa PUT, tambah lampiran, dan dicek; POST baru 409.
  - Baris terkunci yang disisipkan lewat SQL diabaikan.
  - Baris yatim diabaikan dan tidak memengaruhi aturan minimal satu.
  - Kasubbagren/staf/operator → 403 di admin; Superadmin → 403 di `tahap-katalog`; PUT tanpa CSRF → 403.
  - Isi audit.

**Suite keamanan Express:** `security/scenarios/r5h25.js`, didaftarkan di akhir `SCENARIOS` dengan nama
non-Go (`x1_r5h25_master_tahap_admin_guard`).
- Anonim → 401.
- Operator subbagren buatan → 403.
- Superadmin GET → 200; PUT tanpa CSRF → 403.
- Superadmin `tahap-katalog` → 403.
- Superadmin `must_change_password` → 403 (dipulihkan setelahnya).
- Express menjadi 22/22; suite Go tetap.

**Harness golden:** tidak ada kasus `tahap-katalog`/`perencanaan` di `harness/registry.js`. Golden **tidak
berubah**, tidak perlu rekam ulang.

**Gerbang:** build Go (`go test`), `node --check`, verify R5H25 + R5H21 + R5H13 (regresi), dua suite keamanan,
`npm run build` frontend, uji browser.

### 8. Urutan kerja

1. Migrasi 067 + dua manifes → `go test`.
2. `master-tahap.js` + mount + `tahap-katalog.js`/`perencanaan.js` → verify script.
3. Frontend: tab Master Data, penyaringan "Tambah tahap", label, teks bantuan.
4. Skenario keamanan + docs → `/verifikasi`.
5. Deploy: migrasi (centang *migrate*), rebuild `api` + `api-express` + `frontend`, routing Caddy (K2).

### 9. Keputusan yang perlu disetujui pemilik

| # | Hal | Usulan |
|---|---|---|
| K1 | Nomor migrasi | **067**, R5H15 → 068 |
| K2 | Path admin & routing produksi | **`/api/v1/admin/master/tahap-pekerjaan[/:jenis]`**: ikut pola R5H8 `/api/v1/admin/master/*` yang sudah diminta dialihkan, sehingga **tidak perlu mengubah Caddy**. Didaftarkan sebelum `/master/:set`. Alternatif: `/admin/master-data/*` + tambah ke `SDL_EXPRESS_PATHS` |
| K3 | Letak modul | `modules/subbagren/master-tahap.js` (dekat katalognya) |
| K4 | Letak UI | Tab di halaman Master Data yang sudah ada, bukan menu baru |
| K5 | Field `nonaktif` aditif | Diterima (endpoint Express-only R5H16, bukan kontrak beku) |
| K6 | Galat field asing di PUT | `400 invalid_request` (pola `roles`/`master-data`) |
| K7 | PUT tanpa perubahan | 200, tanpa naik versi dan tanpa audit |
| K8 | Kunci `FOR SHARE` di POST tahap | Ya, menyerialkan dengan PUT Superadmin (murah) |
| K9 | Katalog di frontend | Dimuat per buka halaman; perubahan terlihat setelah muat ulang, server menolak dengan pesan jelas |
| K10 | `SDL_DEV_SUPERADMIN_WORKSPACE` di produksi | Tidak memengaruhi R5H25 (`PERMIT_SQL` tetap menolak Superadmin), tetapi klaim pemisahan penuh hanya benar bila flag itu mati. Keputusan terpisah, sudah terbuka sejak 2026-11-04 |
| K11 | Skenario Express-only di suite keamanan 1:1 | Tambahkan (`x1_…`); angka "21/21" di CLAUDE.md diperbarui oleh pemilik |

K2 dan K6 disetujui; bagian Endpoint di atas sudah memakai path dan kode galat final.

## Progres implementasi (2026-11-22)

| Langkah | Hasil |
|---|---|
| 1. Migrasi | `067_master_tahap.sql` + manifes Go/Express; `go test ./...` lulus; diterapkan lokal (1 baru, 66 dilewati). R5H15 → 068 |
| 2. Backend | `modules/subbagren/master-tahap.js` (GET/PUT, `tahapNonaktif`, `tolakNonaktif`), mount sebelum `/master/:set` di `app.js`; `tahap-katalog.js` (`JENIS_LABEL` dipindah ke sini, `TAHAP_WAJIB`, `katalog(nonaktif)`); `perencanaan.js` (`lockForTahap` mengembalikan dokumen, POST tahap memanggil `tolakNonaktif`). `verify/r5h25-master-tahap.js` LULUS; regresi `r5h13-flow`, `r5h21-flow` LULUS |
| 3. Frontend | `MasterDataTahapR5H25.tsx/.css` (tab "Subbagren (Tahap Pekerjaan)" di `MasterDataR5G12.tsx`); `DokumenTahapR5H16.tsx` (pilihan tahap baru tanpa yang nonaktif, helper `tahapNonaktif`); `DokumenR5H13.tsx` (label "nonaktif di Master Data", galat `tahap_nonaktif`, teks bantuan PDF sah). Diuji di Chrome 1440 terang/gelap + 390 |
| 4. Keamanan & docs | Skenario `x1_r5h25_master_tahap_admin_guard` (`security/scenarios/r5h25.js`); `API-CONTRACT.md` bagian R5H25; `MIGRATION-PLAN.md` |

Deploy: migrasi 067 (centang *migrate*), rebuild `api` (manifes) + `api-express` + `frontend`.
Tidak ada perubahan Caddy (path di bawah `/api/v1/admin/master/*`). Pastikan pola R5H8
`/api/v1/admin/master/*` memang sudah ada di `SDL_EXPRESS_PATHS` produksi (`scripts/server-check.sh`).

### Perbaikan hasil /review (2026-11-22)

- Alasan yang berisi karakter kendali (selain tab/baris baru) atau surrogate tunggal kini `400 invalid_input`;
  sebelumnya lolos validasi lalu ditolak JSONB Postgres sehingga klien menerima **500** (dibuktikan pada kode lama).
- Skenario keamanan `x1_r5h25_master_tahap_admin_guard` diperluas: Origin asing, PUT saat `must_change_password`,
  role superadmin nonaktif, tanpa `identity.roles.manage`, seluruh validasi PUT (termasuk `__proto__`/`constructor`
  di path dan body, NUL, surrogate), `tahap_terkunci`, `minimal_satu_tahap`, versi basi, penegakan
  `409 tahap_nonaktif` dengan tahap lama tetap bisa diubah/dihapus, dan isi audit. Express 22/22 LULUS.
- Router R5H25 dipasang di path-nya sendiri (`/admin/master/tahap-pekerjaan`, route `/` dan `/:jenis`) sehingga
  request `/admin` lain kembali menjalankan guard 2× seperti sebelum R5H25; mount lama tidak diubah.
- GET membaca versi + daftar nonaktif dalam satu pernyataan (satu snapshot).
