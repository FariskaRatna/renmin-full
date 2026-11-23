# R5H27 — Subbagsumda: Dashboard, Master Personel, Monitoring Pensiun

Status: **DIIMPLEMENTASI (2026-11-23), branch `feat/r5h27-sumda-personel`, belum di-push.** K1–K21 disetujui
pemilik 2026-11-23. Khusus Express. Migrasi **068** (R5H15 digeser ke **069**). Arah UI "Buku register" dipilih
pemilik. Lulus: `go test` (migrasi + seed), verify R5H27, suite keamanan Express 23/23 (+ uji mutasi x2),
`npm run build`, gladi salinan K3, simulasi rollback di browser. Belum: lihat "Sisa uji" di bawah.

Referensi tampilan: `docs/reference/Subbagsumda.html` (prototipe localStorage, data fiktif). Yang diambil
hanya tiga halaman pertama dari grup *Workspace Subbagsumda*: **Dashboard**, **Master Personel**, dan
**Monitoring Pensiun**. Grup *Administrasi SDM* dan *Dukungan & Laporan* di referensi **tidak** termasuk.

## Kebutuhan (kata pemilik)

> "kita lanjut ke menu subbagsumda deh, kamu bisa cek di bagian folder docs/references ada file bernama
> Subbagsumda.html, nah itu untuk referensi dari isi portalnya, kamu bisa membuatkannya mulai dari bagian
> dashboard, maasater personel, dan monitoring pensiun ya"

## Kondisi sekarang

- Personel Subbagsumda saat ini hanya entri registry generik R5B (`sdl_sumda_registry`, `kind='personel'`,
  `fields`: pangkat, jabatan, status, unitKerja, keterangan). Di sana **tidak ada tanggal pensiun**.
- Endpoint registry termasuk 142 endpoint porting dari Go. Kontraknya dibekukan (aturan migrasi 1), jadi field
  baru **tidak** ditambahkan ke sana. Master Personel memakai tabel dan endpoint baru, sama seperti R5H11–R5H25.
- Grant Engine B: `kasubbagsumda` = scope `unit`; `op-`/`staf-subbagsumda` = scope `assigned`.
  Kalau dipakai apa adanya, operator dan staf hampir tidak melihat personel (lihat K2).

## Keputusan

| # | Hal | Keputusan | Sumber |
|---|---|---|---|
| K1 | Tanggal pensiun | **Diisi manual** oleh petugas. Tanggal lahir **tidak** disimpan | Pemilik |
| K2 | Akses | Semua akun dengan grant aktif Subbagsumda (scope apa pun) **melihat seluruh** master dan alert. **Tambah/ubah**: Operator & Kasubbagsumda (Staf juga, lihat K5). **Arsipkan**: Kasubbagsumda saja. **Kabagrenmin**: baca saja (dashboard, master, alert). Superadmin tetap ditolak | Pemilik |
| K3 | Menu lama "Data Administrasi Personel" | **Disembunyikan** dari navigasi Sumda. Entri personel registry yang masih aktif **disalin sekali** ke Master Personel. Endpoint registry lama tetap hidup (kontrak beku) dan tidak dihapus | Pemilik |
| K4 | Tindak lanjut alert | **"Tandai tinjau" bersama satu unit**, per personel per tahap. Dicatat siapa dan kapan, plus audit. Tahap berikutnya muncul lagi sebagai *belum ditinjau*. **Tanpa email.** "Proses Pensiun" ditunda | Pemilik |
| K5 | Staf Subbagsumda | Role `br_staf_subbagsumda` **sudah** punya `subbagsumda.personel.update`, jadi staf juga bisa mengubah. Usulan: dibiarkan (tidak mencabut hak yang sudah ada) | Usulan |
| K6 | Tahap alert | H-60 (31–60 hari), H-30 (15–30), H-14 (8–14), H-7 (1–7), **Jatuh tempo** (≤ 0). Tahap terbaru menggantikan yang sebelumnya (sama dengan referensi). "Hari ini" dihitung menurut **Asia/Jakarta** | Usulan |
| K7 | Status yang ikut alert | **Aktif dan MPP** (referensi: Aktif saja). MPP adalah masa persiapan pensiun, jadi orangnya belum pensiun dan justru perlu dipantau. Jatuh tempo bertahan sampai status diubah ke *Pensiun* | Usulan |
| K8 | Kunci tinjau | `(personel, tahap, tanggal_pensiun)`. Kalau tanggal pensiun dikoreksi, alert muncul lagi sebagai belum ditinjau | Usulan |
| K9 | Tombol "Tinjau semua" (referensi) | Ada. Hanya meninjau alert yang **sedang tampil** di filter aktif, dengan dialog konfirmasi | Usulan |
| K10 | Kartu dashboard "Perlu tindak lanjut" | Referensi menghitung modul Karier/Cuti/dll yang belum ada. Usulan: diganti **"Data belum lengkap"**, yaitu personel Aktif/MPP tanpa tanggal pensiun (hasil salinan K3 akan banyak di sini) | Usulan |
| K11 | "Aktivitas terakhir" | Dari `sdl_audit_events` milik modul ini saja (tambah, ubah, arsip, tinjau), 5 terakhir. Kabagrenmin ikut melihat | Usulan |
| K12 | Nomor migrasi | R5H27 memakai **068**; R5H15 (belum dikerjakan backend-nya) digeser ke **069**. Preseden: R5H25 | Usulan |

## Data personel

| Field | Wajib | Aturan |
|---|---|---|
| `nrp` | ya | NRP/NIP, 2–64 karakter (sama dengan `ref_code` registry, supaya salinan K3 lolos). Unik di antara baris aktif, tidak peka huruf besar/kecil |
| `nama` | ya | 3–200 karakter |
| `jenis` | ya* | `Polri` \| `PNS`. *Boleh kosong hanya pada hasil salinan; ditandai "lengkapi" |
| `pangkat` | tidak | Polri: kode dari `sdl_polri_rank_master` aktif (validasi yang sama dengan registry). PNS: golongan `I/a` … `IV/e` (daftar di kode) |
| `jabatan` | tidak | ≤ 200 |
| `tmtDinas`/`tanggalPensiun` | — | rentang 1950–2100 / 2000–2100 (K16) |
| `unitKerja` | tidak | ≤ 200 (teks bebas, sama dengan registry `registry-crud.js:87`; K15) |
| `tmtDinas` | tidak | tanggal |
| `tanggalPensiun` | ya* | tanggal. *Wajib untuk status Aktif/MPP saat **tambah**; boleh kosong pada hasil salinan sampai dilengkapi. Ubah status Aktif/MPP tanpa tanggal pensiun → `400 invalid_input` |
| `status` | ya | `Aktif` \| `MPP` \| `Pensiun` \| `Nonaktif` |
| `catatan` | tidak | ≤ 1000, tanpa karakter kendali |

Klasifikasi tidak dipakai (semua data master dianggap *biasa*); baris registry `penting` yang disalin → K13. Tidak ada foto, NIK, alamat, atau tanggal lahir.

## Alur

1. **Dashboard** (menu pertama Subbagsumda): kartu Total Personel · Alert Pensiun ≤ 60 hari (dan jumlah belum
   ditinjau) · Data belum lengkap (K10) · Pensiun 6 bulan. Panel: 5 alert terdekat, grafik proyeksi pensiun
   6 bulan kalender, 5 personel terdekat pensiun, 5 aktivitas terakhir (K11).
2. **Master Personel**: tabel, cari (nama/NRP/pangkat/unit/jabatan), filter status dan unit kerja, paginasi
   (`PaginationR5H5`). Kolom Estimasi Pensiun menampilkan tanggal + pil tahap/H-n. Aksi: Lihat (detail),
   Ubah, Arsipkan (hanya tampil bila berhak; server tetap memeriksa). Form tambah/ubah memakai versi
   (optimistic locking).
3. **Monitoring Pensiun**: 5 kartu tahap (klik = filter), aturan tahap, tabel alert (personel, unit, tanggal
   pensiun, hitung mundur, status tinjau, tombol **Tandai tinjau**), **Tinjau semua** (K9). Panel "Alur Tindak
   Lanjut" dari referensi **tidak** dipasang, karena isinya contoh SOP fiktif.
4. Tahap dan jumlah hari dihitung di **server** (SQL, `(now() AT TIME ZONE 'Asia/Jakarta')::date`; **bukan** `CURRENT_DATE`, karena sesi pool Express UTC, `db.js:45`). Frontend hanya
   menampilkan.

## Backend yang melayani

Express saja. `/api/v1/subbagsumda/*` sudah dialihkan ke Express di produksi (`subbag*` di
`SDL_EXPRESS_PATHS`), jadi **tidak ada perubahan Caddy**. Go tidak mendapat endpoint baru. Endpoint registry
dan `/registry/ranks` yang ada tidak berubah bentuk.

## Endpoint baru

Semua di bawah guard **AuthorizeOperational** (CSRF untuk non-GET, aktif, bukan `must_change_password`,
bukan Superadmin). Validasi strict: field asing → `400 invalid_body`.

| Metode | Path | Hak | Isi |
|---|---|---|---|
| GET | `/api/v1/subbagsumda/dashboard` | read | `{ totals:{personel,aktif,mpp,alert,belumDitinjau,belumLengkap,enamBulan}, alertTerdekat[5], proyeksi[6]{bulan,jumlah}, terdekat[5], aktivitas[5] }` |
| GET | `/api/v1/subbagsumda/personel/capabilities` | read | `{canRead,canCreate,canUpdate,canArchive,canReview}` (K17) |
| GET | `/api/v1/subbagsumda/personel` | read | `?q=&status=&unitKerja=&lengkap=belum&page=&size=` → `{ items[], total, page, size, unitKerja[] }`. Tiap item membawa `sisaHari`, `tahap` |
| POST | `/api/v1/subbagsumda/personel` | create | buat → `201 {item}` |
| GET | `/api/v1/subbagsumda/personel/:id` | read | detail |
| PATCH | `/api/v1/subbagsumda/personel/:id` | update | `{…field, version}` → `200 {item}` |
| DELETE | `/api/v1/subbagsumda/personel/:id` | archive | `?version=` → soft delete, `204` |
| GET | `/api/v1/subbagsumda/pensiun/alert` | read | `?tahap=H-60\|H-30\|H-14\|H-7\|JATUH_TEMPO` → `{ ringkas:{<tahap>:n}, belumDitinjau, items[]{personel, sisaHari, tahap, ditinjau:{oleh,pada}\|null} }` |
| POST | `/api/v1/subbagsumda/pensiun/alert/tinjau` | review | `{ items:[{personelId, tahap, tanggalPensiun}] }` (1–200 butir). Butir yang tahap/tanggalnya sudah tidak cocok dengan keadaan sekarang ditolak semuanya → `409 alert_berubah` |

Hak (permission pada grant unit `subbagsumda`, pola `PERMIT_SQL` di `subbagren/progar.js`):

| Hak | Permission | Role |
|---|---|---|
| read | `subbagsumda.personel.read` (sudah ada) | op, staf, kasubbag, kabagrenmin |
| create | `subbagsumda.personel.create` (sudah ada) | op, staf, kasubbag |
| update | `subbagsumda.personel.update` (sudah ada) | staf, kasubbag + **op (baru, K2)** |
| archive | `subbagsumda.personel.archive` (**baru**) | kasubbag |
| review | `subbagsumda.pensiun.review` (**baru**) | op, staf, kasubbag |

Kode galat: `400 invalid_body` · `400 invalid_input` · `403 access_denied` · `404 not_found` ·
`409 duplicate_nrp` · `409 version_conflict` · `409 alert_berubah` · `503 database_unavailable`.

## Migrasi `068_sumda_personel_pensiun.sql`

- `sdl_sumda_personel`: kolom sesuai tabel data di atas + `source_registry_id UUID NULL UNIQUE` (asal salinan
  K3), `created_by`, `updated_by`, `version`, `deleted_at`, `created_at`, `updated_at`. CHECK untuk enum dan
  panjang. Indeks unik `lower(btrim(nrp)) WHERE deleted_at IS NULL`; indeks `(tanggal_pensiun) WHERE deleted_at IS
  NULL AND status IN ('Aktif','MPP')`.
- `sdl_sumda_pensiun_tinjau(personel_id, tahap, tanggal_pensiun, reviewed_by, reviewed_at)`, PK tiga kolom
  pertama (K8).
- Permission baru `subbagsumda.personel.archive`, `subbagsumda.pensiun.review`, plus pemberian ke role yang
  sudah ada (`INSERT … SELECT … JOIN sdl_roles … ON CONFLICT DO NOTHING`, pola 049). Role yang tidak ada
  dilewati tanpa galat.
- **Salinan K3**: `INSERT … SELECT` dari `sdl_sumda_registry WHERE kind='personel' AND deleted_at IS NULL`.
  Pemetaan: `ref_code→nrp`, `title→nama`, `fields.pangkat→pangkat`, `jabatan`, `unitKerja`,
  `keterangan→catatan`. Status: Aktif→Aktif, Pensiun→Pensiun, Mutasi/Lainnya/kosong→**Nonaktif** dengan catatan
  "Status lama: …". `jenis`: `Polri` bila pangkat ada di rank master, selain itu kosong. `tanggal_pensiun`
  kosong. `ON CONFLICT DO NOTHING` (NRP ganda dilewati). Hasil salinan **tidak** menulis balik ke registry.
- Didaftarkan di `migrate_test.go` + `migrations/index.js`. Seed Go dan Express ikut membawa permission baru
  untuk database baru.

## Otorisasi

- **Bukan Engine A dan bukan Engine B.** Pola R5H11: grant aktif di unit `subbagsumda` (scope apa pun) +
  permission role, disaring di SQL. Scope `assigned` sengaja **tidak** membatasi baris (K2): master personel
  bukan berkas yang didisposisikan.
- Engine B (`unitwork.permit`) dan Engine A tidak diubah. Registry R5B tetap memakai Engine B.
- Kabagrenmin hanya punya `read`. Mutasi apa pun → `403`.
- Superadmin → `403` di semua endpoint (tolak di guard dan di `PERMIT_SQL`).
- Akun unit lain (mis. `kasubbagren`) → `403` karena tidak punya grant `subbagsumda`.

## Frontend

- `App.tsx` → modul Sumda: `dashboard` (baru), `personel` → **Master Personel** (komponen baru), `pensiun`
  (baru). Menu lama `personel` registry disembunyikan (K3). Modul lain (layanan, pendidikan, inventaris,
  pemeliharaan) tidak berubah.
- Komponen baru `SumdaPersonelR5H27.tsx/.css` (tiga tampilan). Alamat bersih lewat `RouteR5H26`. Mengikuti
  `docs/DESIGN-BRIEF.md` dan aksen ungu Sumda yang sudah ada. Grafik proyeksi berupa bar sederhana (tanpa pustaka chart baru).
- Teks "Simulasi tanpa server / data fiktif" dari referensi tidak dibawa.

## Rencana uji

**`apps/backend-express/verify/r5h27-sumda-personel.js`** (pola `verify/r5h25-master-tahap.js`):

1. Salinan K3: registry personel aktif terbawa dengan pemetaan status yang benar; yang terarsip tidak.
2. CRUD: tambah → ubah (version) → konflik versi → NRP ganda → arsip; Aktif tanpa tanggal pensiun ditolak.
3. Tahap: personel dengan sisa 60/31/30/15/14/8/7/1/0/−3/61 hari masuk tahap yang benar (batas tepat).
4. Tinjau: tinjau → tampil `ditinjau`; tanggal pensiun dikoreksi → kembali belum ditinjau; tahap berganti →
   belum ditinjau; payload basi → `409 alert_berubah`, tidak ada yang tersimpan.
5. Hak per akun: op (create/update/review ✓, archive ✗), staf (✓ kecuali archive), kasubbag (semua),
   kabagrenmin (GET ✓, semua mutasi 403), kasubbagren (403), Superadmin (403).
6. Dashboard: angka total/alert/belum lengkap/6 bulan cocok dengan data uji.

**Skenario keamanan** (`security/scenarios/r5h27.js`, didaftarkan di larik `SCENARIOS`
`security/index.js` sebagai `x2_r5h27_sumda_personel_guard`):

- Superadmin ditolak GET dan POST (termasuk lewat demo).
- Kabagrenmin: GET boleh, POST/PATCH/DELETE/tinjau → 403.
- Akun tanpa grant `subbagsumda` → 403; grant dicabut atau kedaluwarsa → 403.
- `must_change_password` → 403.
- Mutasi tanpa CSRF atau dengan Origin asing → 403.
- Operator mencoba arsip → 403, baris tetap ada.
- Field asing / NRP berisi karakter kendali → 400.

**Gerbang:** `go test` (manifes migrasi), `node --check`, verify R5H27 + regresi registry R5B
(`verify` yang menyentuh `/subbagsumda/registry`), harness `compare` (endpoint lama tidak boleh berubah), dua
suite keamanan, `npm run build` frontend, lalu demo browser (op, kasubbag, kabagrenmin).

## Di luar cakupan

- Halaman referensi lain: Karier & Mutasi, Diklat, Cuti, Kesejahteraan, Kinerja, Inventaris/BMN versi baru,
  Persuratan, Laporan & Analitik, Pengaturan Demo.
  *(Kemudian dikerjakan: Karier & Mutasi di R5H28, Diklat & Kompetensi di R5H29 — keduanya menambah field aditif
  pada `GET /personel/:id` dan `/dashboard`.)*
- **"Proses Pensiun"** (membuat berkas layanan pensiun dari alert) → menyusul bersama modul layanan.
- Email atau notifikasi browser untuk alert (K4). Lonceng notifikasi di header referensi.
- Perhitungan otomatis tanggal pensiun dari tanggal lahir/BUP (K1).
- Ekspor CSV/JSON dan impor data personel (referensi punya). Menyebarkan data personel ke berkas lepas perlu
  keputusan sendiri.
- Perubahan pada endpoint registry R5B, Engine A/B, dan backend Go (selain manifes migrasi dan seed
  permission).
- Integrasi HRIS/SIPP Polri atau sumber data kepegawaian resmi.

## Rencana Implementasi

> Disusun 2026-11-23 dari kode di `main` (843a8df). Belum ada kode. K1–K4 disetujui; K5–K21 menunggu persetujuan
> (rencana memakai usulannya sebagai asumsi, §9).

### 1. Backend: Express saja (+ manifes migrasi dan seed Go)

- Caddy meneruskan `@express path {$SDL_EXPRESS_PATHS}` ke `api-express` (`infra/Caddyfile:39-42`). Runbook
  `docs/PERALIHAN-EXPRESS-PRODUKSI.md:98` memuat `/api/v1/subbagsumda/*` sebagai pola sendiri; ketiga path baru di
  bawahnya → **Caddy tidak berubah**. Nilai `.env` produksi dicek sebelum deploy (`scripts/server-check.sh:82-83`).
- Go: tidak ada endpoint baru. Hanya migrasi 068 (ter-embed → image `api` di-rebuild), manifes `migrate_test.go`,
  dan permission di `cmd/seed-bagrenmin/main.go`.
- Pola: R5H11 (`modules/subbagren/progar.js`), register tingkat unit, permission pada grant unit, tanpa scope.

### 2. Dampak kontrak API

- Endpoint beku tidak berubah: registry (`API-CONTRACT.md:474`, `/registry/ranks` `:1380`) dan
  `/subbagsumda/opsi-dropdown` (`:1496`). Harness kasus 32–37 (`harness/registry.js:159-169`) menjaganya.
- Tidak ada tabrakan mount: `app.js` hanya memasang `/subbagsumda/registry` (`:89`) dan `/subbagsumda/opsi-dropdown`
  (`:101`). Pasang **tiga mount spesifik** (bukan satu `/subbagsumda`, supaya guard tidak jalan dua kali — pelajaran
  review R5H25) setelah `app.js:102`:
  ```js
  v1.use('/subbagsumda/dashboard', operational, createSumdaDashboardRouter({ pool }))
  v1.use('/subbagsumda/personel', operational, createSumdaPersonelRouter({ pool }))
  v1.use('/subbagsumda/pensiun', operational, createSumdaPensiunRouter({ pool }))
  ```
- Di router personel, `GET /capabilities` didaftarkan sebelum `/:id`.
- `API-CONTRACT.md`: bagian baru `## R5H27 … (EXPRESS SAJA)` setelah `:1649`, format R5H11 (`:1530-1559`):
  legenda hak R/C/U/A/V, tabel 9 endpoint, kode galat, paragraf rollback.

### 3. Rollback ke Go

| Yang di-rollback | Akibat |
|---|---|
| `/api/v1/subbagsumda/*` dihapus dari `SDL_EXPRESS_PATHS` | Registry kembali ke Go (`router.go:77-89`). Tiga endpoint baru → **404 `text/plain`** dari chi. `opsi-dropdown` juga 404 (formulir lama punya cadangan, `OpsiDropdownR5H8.ts:6-9`) |
| Frontend | Wajib cek `r.status` sebelum `r.json()` dan tampilkan "Master Personel tidak tersedia di server saat ini". Menu registry personel tersembunyi (K3) → data personel tak terlihat selama rollback, kecuali K20 |
| Rollback sempit | Ganti pola dengan `/api/v1/subbagsumda/personel* /api/v1/subbagsumda/pensiun/* /api/v1/subbagsumda/dashboard /api/v1/subbagsumda/opsi-dropdown/*` agar registry saja yang kembali ke Go |
| Data | Tabel 068 diam; tanpa dual-write. Registry ↔ Master tidak saling mengalir |
| Skema | Tidak perlu dibalik; `Verify()` Go hanya memeriksa berkas ter-embed (`migrate.go:94-108`) |

### 4. Migrasi `068_sumda_personel_pensiun.sql`

Terakhir 067 (`migrate_test.go:79`, `migrations/index.js:118`). R5H15 → **069**
(`docs/R5H15-RIWAYAT-VERSI-DOKUMEN.md:12,106,169`); `MIGRATION-PLAN.md:13-16` → 049–068.

```sql
CREATE TABLE sdl_sumda_personel (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 nrp VARCHAR(64) NOT NULL CHECK (length(btrim(nrp)) BETWEEN 2 AND 64),
 nama VARCHAR(200) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 200),
 jenis VARCHAR(8) CHECK (jenis IN ('Polri','PNS')),
 pangkat VARCHAR(200) NOT NULL DEFAULT '',
 jabatan VARCHAR(200) NOT NULL DEFAULT '',
 unit_kerja VARCHAR(200) NOT NULL DEFAULT '',
 tmt_dinas DATE,
 tanggal_pensiun DATE,
 status VARCHAR(10) NOT NULL CHECK (status IN ('Aktif','MPP','Pensiun','Nonaktif')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 source_registry_id UUID UNIQUE,                  -- sengaja tanpa FK (R1)
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ,
 CONSTRAINT sdl_sumda_personel_jenis_salinan CHECK (jenis IS NOT NULL OR source_registry_id IS NOT NULL)
);
CREATE UNIQUE INDEX sdl_sumda_personel_nrp_aktif_idx ON sdl_sumda_personel(lower(nrp)) WHERE deleted_at IS NULL;
CREATE INDEX sdl_sumda_personel_pensiun_idx ON sdl_sumda_personel(tanggal_pensiun)
 WHERE deleted_at IS NULL AND status IN ('Aktif','MPP');

CREATE TABLE sdl_sumda_pensiun_tinjau (
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 tahap VARCHAR(12) NOT NULL CHECK (tahap IN ('H-60','H-30','H-14','H-7','JATUH_TEMPO')),
 tanggal_pensiun DATE NOT NULL,
 reviewed_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (personel_id, tahap, tanggal_pensiun)
);
```

- **Permission** (pola `049_progar_pagu.sql:75-96`, `ON CONFLICT DO NOTHING`, role yang tidak ada dilewati JOIN):
  `subbagsumda.personel.archive`, `subbagsumda.pensiun.review`. Pemberian: op += `personel.update`, `pensiun.review`;
  staf += `pensiun.review`; kasubbag += `personel.archive`, `pensiun.review`. Kabagrenmin sudah punya
  `personel.read`, staf sudah punya `personel.update` (K5).
- **Salinan K3** (satu pernyataan CTE): sumber `sdl_sumda_registry s JOIN sdl_unit_work_records w … WHERE
  s.kind='personel' AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='subbagsumda'`
  (filter registry, `registry-crud.js:97-98`). Pemetaan: `btrim(ref_code)→nrp`, `btrim(title)→nama`,
  pangkat/jabatan/unitKerja dari `fields`; status tidak peka huruf/spasi (master `personel-status` bisa diubah
  Superadmin, `047:49-52`): aktif→Aktif, pensiun→Pensiun, mpp→MPP, lainnya→Nonaktif + "Status lama: …" di catatan;
  `jenis='Polri'` bila pangkat ada di rank master. `ON CONFLICT DO NOTHING`. Satu baris audit
  `subbagsumda.personel.salin_registry` berisi `{sumber, disalin}` (K21).
- **Pemeriksa migrasi** (`migrate_test.go:104-219`): hindari substring `UPDATE ` (jadi tanpa `ON CONFLICT DO
  UPDATE`, dan deskripsi permission tanpa kata "update "), `DELETE FROM`, dll.; tanpa `;` atau `--` di dalam literal.
  Aturan "klausa berkoma" hanya untuk `ALTER TABLE` (tidak dipakai).
- **Manifes:** `migrate_test.go:79` + `src/migrations/index.js:118` (runner Express menolak bila berbeda, `:143-150`).
- Tidak ada pemeriksa jumlah tabel di kode; angka di CLAUDE.md menjadi 102 tabel / 68 berkas (diperbarui pemilik).

### 5. Otorisasi

- **Bukan Engine A dan bukan Engine B.** `PERMIT_SQL` disalin dari `progar.js:71-80` dengan `UNIT='subbagsumda'`:
  user aktif, bukan `must_change_password`, `sdl_user_units` + grant aktif di unit, role aktif bukan superadmin,
  `sdl_role_permissions` cocok, tidak memegang role superadmin. Scope dan `classification_limit` tidak dipakai (K2).
- Keputusan izin diambil **seluruhnya di SQL** lewat pre-check `SELECT EXISTS` (`can()`/`need()`, pola
  `progar.js:188-191`) sebelum query data. Grant tidak pernah di-SELECT lalu diputuskan di JS. Tidak ada penyaringan
  per baris karena K2 memberi akses ke seluruh master.
- Superadmin ditolak dua lapis: guard (`auth/guards.js:28-31,41`) dan `PERMIT_SQL`, sehingga tetap 403 meski
  `SDL_DEV_SUPERADMIN_WORKSPACE=true`.
- Menambah `personel.update` ke Operator tidak mengubah registry R5B (Engine B tidak membaca `permission_key`,
  `permit.js:8`).
- Seed Go (`main.go:55-57`) dan Express (`seed-bagrenmin.js:61-63`) mendapat daftar permission **identik**. Seed
  menolak permission yang belum ada (`main.go:210-218`) → 068 harus sudah diterapkan (urutan `up` → `seed` sudah
  begitu). Gerbang: diff peta role→permission kedua seed kosong.

### 6. Berkas dibuat/diubah

**Express**
- `src/modules/subbagsumda/personel.js` (baru; **bukan** di `modules/unitwork/`, milik Engine B): `PERMIT_SQL`,
  `can/need`, `handle()` (23505 → `409 duplicate_nrp`, 23514 → `400 invalid_input`, lainnya → 503),
  `HARI_INI = "(now() AT TIME ZONE 'Asia/Jakarta')::date"` + `tahapSql()` sebagai satu sumber hitungan tahap,
  DATE dibaca `::text`, validasi strict (`parsePayload`, `textOk`, regex kendali + `isWellFormed()`), rank Polri
  `EXISTS … is_active`, golongan PNS `I/a`…`IV/e`. Tiga router: personel (capabilities, list berhalaman server
  dengan ILIKE ter-escape, POST, GET/:id, PATCH badan penuh + version dalam transaksi `FOR UPDATE`, DELETE
  `?version=`), pensiun (`GET /alert`, `POST /alert/tinjau` dalam transaksi: hitung ulang tahap tiap butir, satu
  tidak cocok → `409 alert_berubah`), dashboard (totals, proyeksi 6 bulan `generate_series`, terdekat, aktivitas
  dari `sdl_audit_events`). Audit tanpa nilai PII (hanya nama field yang berubah, versi, tahap).
- `src/http/payload.js`: konstanta `SUMDA: 32768` (tinjau 200 butir ≈ 18 KB).
- `src/app.js` (import + tiga mount), `src/migrations/index.js`, `src/cli/seed-bagrenmin.js`.

**Go**: `internal/migrations/sql/068_sumda_personel_pensiun.sql`, `internal/migrations/migrate_test.go`,
`cmd/seed-bagrenmin/main.go`.

**Frontend**
- `SumdaPersonelR5H27.tsx/.css` (baru), `mode: 'dashboard' | 'master' | 'pensiun'`; tombol mengikuti
  `/capabilities`; paginasi memakai `Pager` (`PaginationR5H5.tsx:36`) dengan state dari `total` server (`usePaged`
  memotong di klien, tidak cocok); pangkat dari `/registry/ranks`; `version_conflict` → muat ulang; 404 non-JSON
  ditangani; dialog konfirmasi Tinjau semua.
- `App.tsx`: modul `personel` → Master Personel, tambah `pensiun`; daftar SumdaR5B → `['pendidikan','inventaris']`;
  dashboard Sumda menggantikan `SmartUnitDashboard` untuk unit Sumda (K14, `:613`).
- `RouteR5H26.ts`: tidak berubah (id menu diambil dari `units[].modules`); cukup diuji.

**Docs**: dokumen ini, `API-CONTRACT.md`, `MIGRATION-PLAN.md`, `R5H15-…md` (→ 069), `R2D5-SECURITY-TESTS.md`,
catatan sesi. Untuk pemilik: angka di CLAUDE.md.

### 7. Pengujian

**`apps/backend-express/verify/r5h27-sumda-personel.js`** (pola `verify/r5h25-master-tahap.js`, lewat image harness):
- Aktor op/staf/kasubbag sumda, kabagrenmin, kasubbagren, superadmin via `db.mintSession()`; berhenti cepat bila
  ada yang `must_change_password`; data uji berawalan `UJI-R5H27-` dibersihkan di awal dan di `finally`.
- Tanggal relatif dari DB (`(now() AT TIME ZONE 'Asia/Jakarta')::date`), n ∈ {61,60,31,30,15,14,8,7,1,0,−3} →
  tahap yang diharapkan; MPP ikut, Pensiun/Nonaktif tidak. Tanggal dibaca ulang di akhir (lewat tengah malam →
  ulangi). Uji WIB vs UTC dengan stempel tetap `2026-11-22T16:59:59Z` / `…T17:00:00Z` lewat `tahapSql()`.
- Kasus: invarian salinan K3 · CRUD + versi + NRP ganda beda huruf/spasi + Aktif tanpa tanggal · batas tahap ·
  tinjau (tanggal dikoreksi/tahap bergeser → belum ditinjau; payload basi 409 tanpa sisa; >200 butir 400) · matriks
  hak · dashboard sebagai selisih sebelum/sesudah · audit tanpa NRP/nama.
- Gladi salinan K3 di DB lokal: buat registry personel beragam status/klasifikasi/NRP kembar sebelum `--migrate`.

**Skenario keamanan** `security/scenarios/r5h27.js` → `x2_r5h27_sumda_personel_guard`, didaftarkan di
`security/index.js` (`SCENARIOS`, setelah `x1_…`). Anonim 401; Superadmin 403 (termasuk app kedua dengan
`demoSuperadminWorkspace:true`); role baca saja: GET 200, mutasi 403; tanpa grant/dicabut/kedaluwarsa/tanpa
`sdl_user_units` 403; `must_change_password` 403; tanpa CSRF/Origin asing 403; DELETE tanpa `archive` 403 dan baris
tetap; field asing/`__proto__`/NUL/surrogate/tinjau >200 400. Express menjadi **23/23**.

**Harness golden:** endpoint baru tidak direkam (Go tidak punya). Kasus 32–37 harus tetap cocok. Kasus **127
`/admin/permissions`** dan **128 `/admin/roles`** berubah karena 068 (sama di Go dan Express) → rekam ulang
`capture` + `compare` satu siklus di DB ber-068; dijalankan **pemilik** (golden diblokir hook).

**Gerbang:** `go test ./...` · `node --check` · `--migrate` Express + start Go · verify R5H27 · harness compare ·
dua suite keamanan · `npm run build` · demo browser HTTPS (op, staf, kasubbag, kabagrenmin) + simulasi rollback
(upstream ke Go → halaman menampilkan pesan, bukan rusak).

### 8. Urutan kerja

1. Docs + nomor (R5H15 → 069), persetujuan K5–K21. *Gerbang:* pemilik setuju.
2. Migrasi 068 + dua manifes + dua seed. *Gerbang:* `go test`, gladi salinan K3, `--migrate` + start Go, diff seed kosong.
3. Modul Express + mount + `payload.js`. *Gerbang:* `node --check`, verify R5H27, harness compare.
4. Skenario `x2_`. *Gerbang:* dua suite keamanan hijau.
5. Frontend. *Gerbang:* `npm run build`, demo browser + simulasi rollback.
6. Docs, `/verifikasi`, `/review`.
7. Deploy: catat jumlah registry personel aktif di server (SQL baca saja), run workflow dengan migrasi 068,
   rebuild `api`/`api-express`/`frontend`, pastikan pola Caddy dan grant `subbagsumda` Kabagrenmin di produksi.
   **Urutan wajib (temuan review):** migrasi 068 dijalankan SEBELUM `api` (Go) di-restart. `Verify()` Go
   (`migrate.go:94-108`) menolak start bila berkas ter-embed belum diterapkan, dan Go masih melayani login,
   `/admin/*`, dan worker email, sehingga urutan terbalik berarti padam total, bukan hanya Sumda.

### 9. Risiko dan keputusan

| # | Risiko | Penanganan |
|---|---|---|
| R1 | `harness seed-docs` menjalankan `TRUNCATE … CASCADE` pada tabel dokumen termasuk registry (`seed-documents.js:492`); FK dari `source_registry_id` akan ikut mengosongkan Master Personel | `source_registry_id` tanpa FK |
| R2 | NRP ganda saat salinan (registry unik pada `lower(ref_code)`, bukan `btrim`) | Dilewati, jumlahnya tercatat di audit; query daftar yang dilewati untuk pemilik |
| R3 | Baris registry `penting` setelah disalin terlihat oleh op/staf ber-limit `biasa` | K13 |
| R4 | PII (NRP, nama, jabatan, tanggal pensiun) terbuka untuk semua akun Sumda + Kabagrenmin | Tanpa ekspor, `Cache-Control: no-store`, audit tanpa nilai, tanpa log isi body |
| R5 | Sesi pool Express UTC (`db.js:45`) → `CURRENT_DATE` meleset sehari pukul 00:00–06:59 WIB | Selalu `(now() AT TIME ZONE 'Asia/Jakarta')::date` (preseden `executive/index.js:133`), DATE dibaca `::text`, diuji dengan stempel tetap |
| R6 | Rollback: menu lama tersembunyi → data personel tak terlihat; 404 Go berupa teks | Penanganan 404, K20 |
| R7 | Registry personel tetap bisa ditulis lewat API lama → menyimpang dari Master | Diterima (K3); dicatat di API-CONTRACT |
| R8 | Grant produksi tidak terverifikasi dari repo | Cek SQL baca saja sebelum deploy |
| R9 | Verify gagal semu di tengah malam WIB | Tanggal dibaca dua kali |

| # | Hal | Usulan |
|---|---|---|
| K13 | Salinan registry berklasifikasi `penting` | Ikut disalin (alternatif: dilewati dan dilaporkan) |
| K14 | Letak Dashboard | Menggantikan "Dashboard Unit" Sumda di `/subbagsumda`, bukan modul kedua |
| K15 | Panjang `unitKerja` | 200 (sama dengan registry) |
| K16 | Rentang tanggal | `tmtDinas` 1950–2100, `tanggalPensiun` 2000–2100 |
| K17 | `GET /personel/capabilities` | Ditambah, untuk menampilkan tombol sesuai hak |
| K18 | Bentuk PATCH | Badan penuh + `version`; menyunting baris salinan mewajibkan `jenis` (dan tanggal pensiun bila Aktif/MPP) |
| K19 | Kartu "Pensiun 6 bulan" | Sama dengan jumlah grafik proyeksi (bulan berjalan s.d. +5) |
| K20 | Cadangan saat rollback | Tombol "Data registry lama (darurat)" muncul hanya bila endpoint baru 404 |
| K21 | Paginasi & audit salinan | Paginasi server (5/10/50/100); satu baris audit `salin_registry` berisi jumlah |

## Menyimpang dari rencana

Semua tambahan kecil dan aditif; tidak ada yang mengubah keputusan K1–K21. Dicatat supaya pemilik bisa menolak.

| # | Rencana | Yang dikerjakan | Alasan |
|---|---|---|---|
| D1 | Indeks unik `lower(nrp)` | `lower(btrim(nrp))` | Server sudah memangkas spasi; indeks ikut menegakkannya bila ada penulisan di luar API |
| D2 | Dua indeks di 068 | + indeks `lower(nama)` dan indeks parsial `sdl_audit_events(created_at) WHERE subject_type='subbagsumda.personel'` | Urutan daftar per nama dan "Aktivitas terakhir" tanpa memindai seluruh audit |
| D3 | Filter daftar `q/status/unitKerja` | + `lengkap=belum` | Kartu "Data belum lengkap" (K10) perlu daftar yang bisa dibuka; frontend memakai kotak centang "Belum lengkap saja" |
| D4 | "Belum lengkap" = tanpa tanggal pensiun (K10) | Aktif/MPP tanpa tanggal pensiun **atau tanpa jenis** | Baris salinan K3 tanpa jenis juga belum bisa disunting tanpa melengkapi `jenis` (K18) |
| D5 | Kode galat di dokumen | + `400 invalid_rank` | Membedakan pangkat/golongan tak sah dari isian lain di layar |
| D6 | Pangkat wajib dari master aktif | Pangkat yang **sudah tersimpan** boleh dipertahankan saat mengubah | Baris salinan bisa membawa pangkat non-master; tanpa ini baris itu tidak bisa disunting kecuali pangkatnya dikosongkan |
| D7 | Totals dashboard | + `mpp` | Ringkasan "x aktif · y MPP" |
| D8 | — | `security/env.js` menyimpan `this.config` | Diperlukan app kedua (mode demo Superadmin) di skenario x2, sesuai catatan rencana §7 |

## Perbaikan hasil review (2026-11-23)

`/review` (migration-guard + security-reviewer): tidak ada temuan wajib. Yang dikerjakan:

| # | Temuan | Perbaikan |
|---|---|---|
| S2 | `?id=` dari URL masuk ke path API tanpa validasi (traversal sisi klien) | Frontend hanya memakai `?id=` berbentuk UUID, lalu `encodeURIComponent` |
| S3 | Nama personel terarsip tetap tampil di "Aktivitas terakhir" | Join dashboard menyaring `deleted_at IS NULL` |
| S4 | `rincian` meneruskan metadata audit mentah | Daftar putih kunci `fields,status,tahap,version,sumber,disalin` |
| S5 | NRP/nama menerima karakter tak terlihat & homoglif | Semua isian menolak kategori Unicode `Cf`; NRP baru dibatasi `A-Z a-z 0-9 spasi . _ / ( ) [ ] -`. NRP lama hasil salinan boleh dipertahankan |
| S6 | Pengecualian pangkat lama berlaku walau `jenis` diganti | Pangkat lama hanya dipertahankan bila `jenis` tidak berubah |
| S8 | Dokumen rilis tertinggal dari API-CONTRACT | Disinkronkan (tabel endpoint, indeks, teks K2) |
| S9 | Skenario x2 kurang lengkap | + PATCH/tinjau tanpa CSRF & Origin asing, Superadmin demo PATCH/DELETE/tinjau, capabilities kosong untuk unit lain, probe injeksi & query ganda, `Cache-Control: no-store`, body > 32 KB, NRP/nama tak terlihat. Verify bagian 10 menguji S3–S6 |

**Tidak dikerjakan — S7** (urutan pilih NRP kembar saat salinan K3 tidak deterministik; saran `ORDER BY` + jumlah
baris `penting` di audit). Berkas 068 sudah di-commit dan hook proyek memblokir pengeditannya (runner menolak
checksum berubah). Diterima sebagai risiko: hanya berpengaruh bila registry produksi punya NRP kembar setelah
`btrim`/huruf kecil. **Sebelum deploy**, pemilik bisa memeriksanya dengan SQL baca saja:

```sql
SELECT lower(btrim(s.ref_code)) AS nrp, count(*), array_agg(w.classification)
  FROM sdl_sumda_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id
 WHERE s.kind='personel' AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='subbagsumda'
 GROUP BY 1 HAVING count(*)>1;
SELECT count(*) FILTER (WHERE w.classification='penting') AS penting, count(*) AS total
  FROM sdl_sumda_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id
 WHERE s.kind='personel' AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='subbagsumda';
```

Bila hasil pertama tidak kosong dan urutan penting, alternatifnya adalah membatalkan commit 068 sebelum merge
(keputusan pemilik; berkas belum pernah diterapkan di luar DB lokal).

## Sisa uji (lewat `/verifikasi`)

- `scripts/security-test-r2d5.sh` (suite Go) — migrasi 068 ikut ter-embed.
- Harness golden: kasus 127 `/admin/permissions` dan 128 `/admin/roles` berubah karena 068 → rekam ulang
  `capture` (Go) + `compare` (Express) satu siklus. **Dijalankan pemilik** (golden diblokir hook).
- Harness `compare` kasus 32–37 (registry Sumda) harus tetap cocok.
- `go test ./...` penuh (sejauh ini hanya `internal/migrations` dan `cmd/seed-bagrenmin`, plus build image `api`).
- Verify regresi lain yang menyentuh mount `app.js` (mis. `r5h25-master-tahap.js`, `r5h21-flow.js`).
- Demo browser per akun (op, staf, Kabagrenmin): sejauh ini hanya Kasubbagsumda yang dicoba di browser;
  matriks hak akun lain sudah dibuktikan lewat API (verify bagian 2).

Data uji lokal yang ditinggalkan: 8 personel `[UJI]-8701000x` (demo browser) dan 9 baris registry
`GLADI-R5H27-*` + 7 salinannya (gladi K3). Hapus bila tidak diperlukan.
