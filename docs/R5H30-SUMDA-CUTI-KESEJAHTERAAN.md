# R5H30 — Subbagsumda: Cuti & Perizinan + Kesejahteraan

Status: **DI `main` (merge PR #6), belum di `origin/staging`; belum dipastikan terdeploy di produksi (cek 2026-11-24)**. K1–K4 dijawab pemilik 2026-11-24; K5–K24 (usulan) disetujui pemilik 2026-11-24. Rencana Implementasi + K25–K42 disetujui pemilik 2026-11-24 **sebagai versi sementara untuk dipaparkan ke pengguna** (alur bisnis belum pasti), ditambah K43.
Khusus Express. Migrasi **071** (R5H15 digeser lagi ke **072**, lihat K24). Commit: b9b7d14 migrasi · 4426687 `HttpError`
· 7eb19fe API Cuti · 1823d81 API Kesejahteraan · d6b208e skenario x5 · e0cdfcf frontend.
Lanjutan R5H27 (Master Personel), R5H28 (Karier & Mutasi) dan R5H29 (Diklat & Kompetensi): setiap pengajuan merujuk
satu baris `sdl_sumda_personel`. Alur persetujuan, maker-checker, validasi, dan lampiran tersegel memakai pola R5H28
beserta seluruh perbaikan review R5H28/R5H29 (`umum.js`, `lampiran.js`, `SumdaBersama.tsx`).

Referensi: modul `leaves` dan `welfare` di `docs/reference/Subbagsumda.html` (prototipe localStorage).
- **Cuti & Perizinan**: personel, jenis cuti (Tahunan/Sakit/Alasan Penting/Besar/Lainnya), tanggal mulai & selesai,
  status Diajukan → Diproses → Disetujui/Ditolak → Selesai, catatan; validasi selesai ≥ mulai; "kalender
  ketidakhadiran".
- **Kesejahteraan & Pensiun**: personel, jenis layanan (Persiapan Pensiun/MPP/Administrasi ASABRI/Kartu-Identitas/
  Layanan Personel Lain), target penyelesaian, status yang sama, catatan; tombol "Proses Pensiun" dari detail
  personel yang membuat layanan Persiapan Pensiun (tidak ganda bila masih terbuka).
- **Tidak** diambil: perubahan status bebas tanpa pembagian peran, ekspor CSV, notifikasi browser.

## Kebutuhan (kata pemilik)

> "oke kita bisa lanjut untuk mengerjakan yang cuti & perizinan serta menu kesejahteraan ya, kerjakan untuk dua menu
> tersebut"

## Kondisi sekarang

- Menu Sumda di `App.tsx`: Master Personel, Monitoring Pensiun, Karier & Mutasi, Diklat & Kompetensi, Inventaris &
  BMN, Pemeliharaan Logistik. **Belum ada** menu cuti maupun kesejahteraan, dan tidak ada data lama yang perlu disalin
  (registry R5B hanya `personel`/`pendidikan`/`inventaris`).
- R5H27 menunda **"Proses Pensiun"** ("menyusul bersama modul layanan"). Monitoring Pensiun sudah punya alert
  H-60…jatuh tempo dan tinjau bersama, tetapi belum ada tindak lanjut administrasinya.
- Status personel (`Aktif`/`MPP`/`Pensiun`/`Nonaktif`) saat ini hanya diubah manual di Master Personel.
- `/api/v1/subbagsumda/*` sudah dilayani Express di produksi.

## Keputusan

| # | Hal | Keputusan | Sumber |
|---|---|---|---|
| K1 | Alur cuti | **Kasubbag memutuskan.** Petugas mencatat → Diproses → Kasubbagsumda Setujui/Tolak (**bukan pencatat/pengubah terakhir**, maker-checker R5H28 K9/K19) → Selesai. Personel bukan pengguna aplikasi; semua dicatat petugas | Pemilik |
| K2 | Jatah cuti tahunan | **Dihitung + peringatan.** Jatah 12 hari kerja per tahun kalender. Sisa ditampilkan di form, detail, dan detail personel; bila melebihi sisa, server tetap menerima tetapi respons membawa `peringatan:["melebihi_jatah"]` dan UI meminta konfirmasi | Pemilik |
| K3 | Kesejahteraan → Master Personel & "Proses Pensiun" | Alert Monitoring Pensiun dan detail personel mendapat tombol **"Proses Pensiun"** (membuat layanan Persiapan Pensiun, target = tanggal pensiun; bila sudah ada yang terbuka, membukanya). Saat **Selesai**: layanan **MPP** menawarkan status personel → `MPP`; **Persiapan Pensiun** menawarkan → `Pensiun`. Petugas mengonfirmasi (boleh tidak mengubah), Master Personel diperbarui **dalam transaksi yang sama** + audit (pola R5H28 K2/K10) | Pemilik |
| K4 | Lampiran & data kesehatan | **PDF** tersegel (`SDL1`, maks. 5 MB, maks. 10 per pengajuan, PDF terenkripsi/rusak ditolak). Lampiran **cuti Sakit** hanya bisa diunduh pemegang `subbagsumda.cuti.approve` dan pengunggahnya; pembaca lain hanya melihat nama berkas "(dibatasi)". Lampiran lain: semua pemegang hak baca Sumda | Pemilik |
| K5 | Menu | Dua menu baru di grup Sumda: **"Cuti & Perizinan"** (ikon kalender) dan **"Kesejahteraan"** (ikon jabat tangan), di bawah Diklat & Kompetensi | Usulan |
| K6 | Hak baca | Sama dengan R5H27 K2: semua pemegang grant aktif Subbagsumda (scope apa pun) + Kabagrenmin baca; Superadmin ditolak. Pengecualian hanya unduhan lampiran Sakit (K4) | Usulan |
| K7 | Permission | `subbagsumda.cuti.manage`/`.approve` dan `subbagsumda.kesejahteraan.manage`/`.approve`. `manage` → op, staf, Kasubbagsumda; `approve` → Kasubbagsumda (pola 069) | Usulan |
| K8 | Jenis cuti | `TAHUNAN`, `SAKIT`, `ALASAN_PENTING`, `BESAR`, `LAINNYA` (sesuai referensi). Hanya `TAHUNAN` yang mengurangi jatah | Usulan |
| K9 | Hitungan hari | **Hari kerja Senin–Jumat** antara mulai dan selesai (inklusif), dihitung server. Libur nasional tidak dikurangkan (belum ada tabel libur); petugas dapat menyesuaikan `jumlahHari` secara manual dengan alasan di catatan | Usulan |
| K10 | Jatah: apa yang terpakai | Terpakai = cuti Tahunan berstatus **Disetujui + Selesai** dengan tanggal mulai di tahun itu. "Dalam proses" (Diajukan/Diproses) ditampilkan terpisah. Tidak ada saldo bawaan dari tahun lalu (penangguhan di luar cakupan) | Usulan |
| K11 | Cuti bertumpuk | Satu personel tidak boleh punya dua cuti **terbuka atau disetujui** (Diajukan/Diproses/Disetujui/Selesai) yang tanggalnya beririsan → 409 `cuti_bertumpuk` | Usulan |
| K12 | Selesai (cuti) | Setelah Disetujui; boleh memperbaiki **tanggal kembali sebenarnya** bila kembali lebih awal (tidak boleh melewati tanggal selesai yang disetujui); hari terpakai dihitung ulang | Usulan |
| K13 | Syarat personel | Cuti dan layanan baru hanya untuk personel **Aktif/MPP** belum terarsip. Personel terarsip: pengajuan hanya bisa dibatalkan (R5H28 K26) | Usulan |
| K14 | Jenis layanan kesejahteraan | `PERSIAPAN_PENSIUN`, `MPP`, `ASABRI`, `KARTU_IDENTITAS`, `LAINNYA`. Field: target penyelesaian (opsional), nomor referensi, catatan | Usulan |
| K15 | Alur kesejahteraan | Sama dengan cuti (Diajukan → Diproses → Disetujui/Ditolak → Selesai/Dibatalkan), Kasubbagsumda memutuskan, maker-checker | Usulan (konsisten K1) |
| K16 | Satu layanan terbuka per jenis | Personel tidak boleh punya dua layanan **terbuka** (Diajukan/Diproses/Disetujui) dengan jenis sama → 409 `pengajuan_ganda` (R5H28 K11). "Proses Pensiun" memakai aturan ini | Usulan |
| K17 | Status akhir | `Ditolak`, `Selesai`, `Dibatalkan` final. Tolak/batalkan wajib alasan ≥ 8 karakter; batalkan oleh pencatat atau pemegang approve selama Diajukan/Diproses/Disetujui (cuti yang sudah disetujui bisa dibatalkan sebelum Selesai) | Usulan |
| K18 | Kalender ketidakhadiran | Tab **Kalender** di menu Cuti: tampilan bulan, siapa yang cuti per hari (status Disetujui/Selesai; Diproses dengan tanda "belum diputus"). Jenis cuti, termasuk Sakit, tetap tampil bagi semua pembaca karena bukan diagnosis; yang dibatasi hanya lampirannya (K4) | Usulan |
| K19 | Data kesehatan di teks | Catatan cuti Sakit tidak untuk diagnosis: UI menampilkan petunjuk "Jangan menulis diagnosis atau keterangan medis". Audit tidak memuat catatan, nama, atau NRP | Usulan |
| K20 | Riwayat di Master Personel | Detail personel (R5H27) mendapat bagian **"Cuti tahun ini"** (sisa jatah + daftar) dan **"Layanan kesejahteraan"** (aditif) | Usulan |
| K21 | Dashboard Sumda | Dua angka aditif: **"Sedang cuti hari ini"** (Disetujui/Selesai mencakup hari ini, WIB) dan **"Layanan menunggu keputusan"** (cuti + kesejahteraan berstatus Diproses) | Usulan |
| K22 | Klasifikasi | Tidak dipakai (semua *biasa*), sama dengan Master Personel | Usulan |
| K23 | Satu rilis, satu migrasi | Dua menu dikerjakan dalam satu rilis R5H30 dan satu migrasi (071), dua modul Express terpisah (`cuti.js`, `kesejahteraan.js`) dan dua irisan kerja | Usulan |
| K24 | Nomor migrasi | R5H30 memakai **071**; R5H15 (belum dikerjakan backend-nya) digeser ke **072** (preseden R5H25/R5H27/R5H28/R5H29) | Usulan |

## Alur

**Cuti & Perizinan**

```
            Operator/Staf                     Kasubbagsumda (≠ pencatat)        Operator/Staf
 [catat] → Diajukan ──proses──► Diproses ──setujui──► Disetujui ──selesai (tgl kembali)──► Selesai
               │                    │        └─tolak (alasan)──► Ditolak
               └──batalkan──────────┴──────────────┴──────────► Dibatalkan
```

1. **Daftar**: personel, jenis, mulai–selesai, hari kerja, status; filter status/jenis/bulan; cari nama/NRP;
   paginasi server. Tab **Kalender** (K18).
2. **Catat cuti**: pilih personel (Aktif/MPP), jenis, mulai, selesai, catatan; form menampilkan hari kerja dan sisa
   jatah Tahunan (K2/K9/K10). Melebihi jatah → konfirmasi "tetap simpan?".
3. **Detail**: data, sisa jatah, lampiran PDF (Sakit dibatasi, K4), riwayat status, tombol sesuai status dan hak.

**Kesejahteraan**

```
 Monitoring Pensiun / detail personel ─"Proses Pensiun"─┐
            Operator/Staf                               ▼        Kasubbagsumda (≠ pencatat)
 [catat] → Diajukan ──proses──► Diproses ──setujui──► Disetujui ──selesai + konfirmasi status──► Selesai
                                            └─tolak──► Ditolak                (MPP → status MPP;
               └──batalkan──────────────────────────► Dibatalkan               Persiapan Pensiun → Pensiun, K3)
```

1. **Daftar**: personel, jenis layanan, target, status; filter; tanda "lewat target" bila target < hari ini dan
   belum final.
2. **Selesai**: untuk MPP/Persiapan Pensiun form menampilkan status personel sekarang dan usulan status baru dengan
   centang "Perbarui Master Personel" (cek versi personel, konflik → 409 `personel_berubah`).

## Backend yang melayani

Express saja. `infra/Caddyfile` meneruskan `@express path {$SDL_EXPRESS_PATHS}`; pola `/api/v1/subbagsumda/*` sudah
ada di produksi sehingga **Caddy tidak berubah**. Dua mount spesifik baru di `src/app.js`: `/subbagsumda/cuti` dan
`/subbagsumda/kesejahteraan` (bukan `/subbagsumda`). Go tidak mendapat endpoint; hanya migrasi 071 + manifes + seed.

**Rollback** ke Go: `/cuti*` dan `/kesejahteraan*` dijawab chi 404 `text/plain`; layar menampilkan "tidak tersedia"
**tanpa cadangan** (tidak ada padanan lama). Tombol "Proses Pensiun" di Monitoring Pensiun ikut hilang karena seluruh
Sumda R5H27+ adalah Express-only. Tabel 071 diam; skema tidak perlu dibalik.

## Endpoint baru

Guard operasional (**O**), validasi strict, `no-store`. Hak: `R` = `subbagsumda.personel.read`, `Mc`/`Ac` =
`subbagsumda.cuti.manage`/`.approve`, `Mk`/`Ak` = `subbagsumda.kesejahteraan.manage`/`.approve`, `U` =
`subbagsumda.personel.update`.

| Metode | Path | Hak | Isi |
|---|---|---|---|
| GET | `/cuti/capabilities` | O | `{canRead,canManage,canApprove}` |
| GET | `/cuti` | R | `?q=&status=&jenis=&bulan=YYYY-MM&personelId=&page=&size=` → `{items,total,page,size}` |
| GET | `/cuti/kalender` | R | `?bulan=YYYY-MM` → `{bulan,hari:[{tanggal,items:[{id,nama,jenis,status}]}],terpotong}` (K18/K39) |
| GET | `/cuti/jatah` | R | `?personelId=&tahun=` → `{tahun,jatah:12,terpakai,dalamProses,sisa}` (K10) |
| POST | `/cuti` | Mc | `{personelId,jenis,tanggalMulai,tanggalSelesai,jumlahHari?,catatan}` → 201 `{item,peringatan[]}` |
| GET | `/cuti/:id` | R | `{item,jatah,lampiran[],riwayat[]}` |
| PATCH | `/cuti/:id` | Mc | badan penuh + `version`; hanya Diajukan |
| POST | `/cuti/:id/aksi` | Mc/Ac | `{aksi:proses\|setujui\|tolak\|batalkan\|selesai,catatan,version,tanggalKembali?}` |
| POST · GET · DELETE | `/cuti/:id/lampiran` · `…/:lid` · `…/:lid` | Mc · R* · Mc | *Sakit: Ac atau pengunggah (K4) |
| GET | `/kesejahteraan/capabilities` | O | `{canRead,canManage,canApprove}` |
| GET | `/kesejahteraan` | R | `?q=&status=&jenis=&personelId=&lewatTarget=&page=&size=` |
| POST | `/kesejahteraan` | Mk | `{personelId,jenis,nomorReferensi,targetSelesai,catatan}` → 201 |
| GET | `/kesejahteraan/:id` | R | `{item,lampiran[],riwayat[]}` |
| PATCH | `/kesejahteraan/:id` | Mk | badan penuh + `version`; hanya Diajukan |
| POST | `/kesejahteraan/:id/aksi` | Mk/Ak(+U) | `{aksi,catatan,version}`; `selesai` juga `{terapkan?:{status,personelVersion}}` (MPP/Persiapan Pensiun; butuh U) |
| POST · GET · DELETE | `/kesejahteraan/:id/lampiran` · `…/:lid` · `…/:lid` | Mk · R · Mk | |
| GET | `/personel/:id` (R5H27) | R | **Aditif**: `cutiTahunIni:{jatah,items[]}`, `riwayatKesejahteraan[]` (K20) |
| GET | `/dashboard` (R5H27) | R | **Aditif**: `totals.cutiHariIni`, `totals.layananMenunggu` (K21) |

Kode galat (pola R5H28): 400 `invalid_body`/`invalid_input`/`invalid_file_type`/`one_file_required`; 413
`file_too_large`; 403 `access_denied`/`self_review_forbidden`; 404 `not_found`; 409 `version_conflict`/
`status_tidak_sesuai`/`cuti_bertumpuk`/`pengajuan_ganda`/`personel_tidak_aktif`/`personel_terarsip`/
`personel_berubah`/`personel_belum_lengkap`/`batas_lampiran`; 503 `evidence_encryption_unavailable`/
`evidence_integrity_failure`/`database_unavailable`. "Melebihi jatah" **bukan** galat (K2).

## Migrasi `071_sumda_cuti_kesejahteraan.sql`

File baru; manifes `migrate_test.go` dan `src/migrations/index.js` diperbarui di commit yang sama; seed Go + Express
identik. Tidak ada salinan data lama.

- `sdl_sumda_cuti`: `personel_id` FK RESTRICT ke `sdl_sumda_personel`, `jenis` CHECK, `tanggal_mulai`/
  `tanggal_selesai` (CHECK selesai ≥ mulai), `tanggal_kembali` (CHECK antara mulai dan selesai), `jumlah_hari`
  (CHECK ≥ 1), `status` CHECK, catatan, versi, created/updated/decided/selesai by+at (~~`deleted_at`~~ dibatalkan,
  temuan 1); CHECK maker-checker `decided_by <> created_by` (R5H28); indeks (personel, tanggal) untuk K11/K18.
- `sdl_sumda_cuti_riwayat`, `sdl_sumda_cuti_lampiran` (isi wajib `SDL1`, RESTRICT).
- `sdl_sumda_kesejahteraan`: `jenis` CHECK, `nomor_referensi`, `target_selesai`, status, `diterapkan` JSONB, versi,
  pelaku. ~~Partial unique index satu layanan terbuka per (personel, jenis)~~ — digantikan K43: K16 dijaga di
  Express dengan kunci personel `FOR NO KEY UPDATE`.
- `sdl_sumda_kesejahteraan_riwayat`, `sdl_sumda_kesejahteraan_lampiran`.
- Permission K7 + `role_permissions` ke role BagRenmin yang sudah ada (pola 069).
- Ditolak checker substring: tanpa `UPDATE␠`/`DELETE FROM`/`;`/`--` di literal. Gladi dari `pg_dump` sebelum commit.

## Otorisasi

Bukan Engine A/B. Sama dengan R5H27–R5H29: guard `AuthorizeOperational` (Superadmin, `must_change_password`, CSRF
non-GET), lalu `PERMIT_SQL` di `umum.js` — grant aktif unit `subbagsumda` (belum kedaluwarsa/dicabut, role aktif) **dan**
permission role, diputus di SQL sebelum query data. Scope dan klasifikasi tidak menyaring baris (K6/K22), sehingga
tidak ada penyaringan pasca-SELECT yang bisa bocor. Tambahan:
- **Maker-checker** diputus di `WHERE` UPDATE (`created_by <> $actor AND updated_by <> $actor`) + CHECK database.
- **Lampiran Sakit (K4)** diputus di SQL unduhan: `jenis <> 'SAKIT' OR uploaded_by = $actor OR $canApprove`; selain itu
  403 `access_denied` (bukan 404, karena keberadaan lampiran sudah terlihat di detail).
- **Selesai + terapkan** butuh `U` (`personel.update`), mengunci layanan → personel (`FOR UPDATE`) dengan cek versi.

## Rencana uji

**`verify/r5h30-sumda-cuti-kesejahteraan.js`** (personel `UJI-R5H30-`, dibersihkan berurutan):
1. Hari kerja (Senin–Jumat, lintas akhir pekan/bulan/tahun), jatah 12, terpakai Disetujui+Selesai, dalam proses,
   peringatan `melebihi_jatah` tanpa menolak, `jumlahHari` manual.
2. Alur cuti penuh + transisi tidak sah + maker-checker (pencatat & pengubah terakhir) + alasan tolak/batal +
   Selesai dengan `tanggalKembali` (lebih awal ok, lewat selesai 400).
3. `cuti_bertumpuk` (beririsan, berbatasan tidak), personel Pensiun/terarsip, kalender bulan (WIB, `bulan` tak sah 400).
4. Kesejahteraan: alur, `pengajuan_ganda`, Selesai MPP/Persiapan Pensiun → status personel berubah dalam transaksi +
   audit `personel.update`; tanpa centang → tidak berubah; tanpa `U` → 403; versi personel lama → 409.
5. "Proses Pensiun": dua kali → kedua 409 `pengajuan_ganda` + id yang terbuka.
6. Lampiran: byte-identik, `SDL1`, batas, terenkripsi/rusak 400, id silang 404, **Sakit**: staf tanpa approve 403,
   pengunggah 200, Kasubbag 200; Kabagrenmin 403.
7. Aditif R5H27 (`cutiTahunIni`, `riwayatKesejahteraan`, dua angka dashboard), audit tanpa PII, regresi R5H27–R5H29.

**Skenario `x5_r5h30_sumda_layanan_guard`**: guard + Superadmin (termasuk demo) di kedua prefix, capabilities unit
lain kosong, matriks baca/manage/approve, maker-checker lewat API, CSRF/Origin JSON + multipart, **lampiran Sakit
dibatasi** (uji mutasi: hapus syarat ini → hanya x5 merah), id silang, bentuk (`__proto__`, Cf, > 32 KB, probe
query), pencabutan grant, kunci evidence kosong fail-closed. Suite Express **26/26**.

**Harness golden:** endpoint baru tidak direkam; 127/128 berubah lagi (katalog permission 071) → rekam ulang oleh
pemilik; 32–37 tetap cocok.

## Di luar cakupan

- Personel mengajukan cuti sendiri (personel bukan pengguna aplikasi).
- Tabel libur nasional, cuti bersama, saldo bawaan/penangguhan dari tahun lalu, aturan jatah khusus per golongan.
- Persetujuan berjenjang ke Kabagrenmin, tanda tangan elektronik, cetak surat izin cuti.
- Integrasi ASABRI/Taspen, BPJS, SIPP/HRIS; perhitungan manfaat pensiun.
- Email/notifikasi browser; pengingat otomatis target layanan.
- Menu Kinerja & Pembinaan, Persuratan & Arsip Sumda, Laporan & Analitik (halaman referensi lain).
- Perubahan endpoint lama (registry R5B, Engine A/B) dan backend Go selain migrasi + seed.

## Rencana Implementasi

> Disusun 2026-11-24 dari kode di `main` (1148219). Belum ada kode. K1–K24 sudah disetujui. K25–K42 (§9) masih
> menunggu persetujuan pemilik. Klaim dokumen rilis sudah dicocokkan dengan kode, dan koreksinya dicatat di
> "Temuan yang mengoreksi dokumen rilis".

### 1. Backend: Express saja (ditambah migrasi 071, manifes, dan seed Go)

- Caddy meneruskan `@express path {$SDL_EXPRESS_PATHS}` ke `api-express:8080` (`infra/Caddyfile:39-42`). Pola
  `/api/v1/subbagsumda/*` yang sudah ada mencakup `/cuti*` dan `/kesejahteraan*`, jadi **Caddyfile tidak berubah**.
  Caddy tidak memasang batas `request_body`, sehingga unggahan 5 MB sampai utuh (sama dengan R5H28/R5H29).
- Go tidak mendapat endpoint baru. Yang berubah hanya `071_sumda_cuti_kesejahteraan.sql` (ter-embed, jadi image `api`
  harus di-rebuild), manifes `migrate_test.go:82`, dan empat permission di `cmd/seed-bagrenmin/main.go:55-57`.
- Pola yang diikuti: `karier.js` (alur, maker-checker di `WHERE`, Selesai yang mengubah Master Personel), `lampiran.js`
  (`bacaPdf`/`bukaPdf`/`pasangHeaderUnduh`), dan `umum.js` (`PERMIT_SQL`, `teks`, `tanggal`, `HARI_INI`, `makeHandle`).
- Deploy: migrasi dijalankan sebelum `up` (`deploy.sh` langkah 7 lalu 8). Image Go baru menolak start bila 071 belum
  ada. Image lama tetap bisa start di DB yang sudah ber-071.

### 2. Dampak kontrak API

- **142 endpoint beku tidak disentuh** (registry R5B, harness 32–37, `/registry/ranks`, `/opsi-dropdown`).
- Dua mount spesifik ditambahkan setelah `src/app.js:117`. `config` wajib karena dibutuhkan untuk `evidenceKey`.
  `/capabilities`, `/kalender`, dan `/jatah` didaftarkan sebelum `/:id`.
  ```js
  v1.use('/subbagsumda/cuti', operational, createSumdaCutiRouter({ pool, config }))
  v1.use('/subbagsumda/kesejahteraan', operational, createSumdaKesejahteraanRouter({ pool, config }))
  ```
- **Penambahan pada endpoint R5H27** (Express-only, dihitung hanya di route GET, bukan di `ambil()`, supaya respons
  POST/PATCH personel tidak berubah):
  - `GET /personel/:id` (`personel.js:199-220`) mendapat `item.cutiTahunIni`
    `{tahun,jatah:12,terpakai,dalamProses,sisa,items:[{id,jenis,status,tanggalMulai,tanggalSelesai,tanggalKembali,jumlahHari}]}`
    (tahun berjalan WIB, maks. 50) dan `item.riwayatKesejahteraan[]` `{id,jenis,status,targetSelesai,nomorReferensi,selesaiAt}`
    (terbaru di atas, maks. 50).
  - `GET /dashboard` (`personel.js:391-397`) mendapat `totals.cutiHariIni` dan `totals.layananMenunggu` (K40).
  - `personel.js` mengimpor helper dari `cuti.js`/`kesejahteraan.js`. Kedua modul baru **tidak boleh** mengimpor
    `personel.js`, karena itu akan membuat siklus impor (pelajaran R5H29 temuan 7).
- **Bentuk galat baru yang aditif:** 409 `pengajuan_ganda` di `POST /kesejahteraan` membawa `{error,id}` (K35).
- **`API-CONTRACT.md`:** tambahkan bagian `## R5H30 …` setelah `:1800` dengan format § R5H29: tabel endpoint, kode galat,
  audit, penambahan pada R5H27, dan rollback. Tambahkan rujukan silang di baris R5H27 `GET /personel/:id` dan
  `/dashboard`. Pola rollback sempit § R5H29 (`:1798-1800`) ditandai **"Usang sejak R5H30"**, sama seperti catatan
  `:1697` dan `:1742`.

### 3. Rollback ke Go

| Yang di-rollback | Akibat |
|---|---|
| `/api/v1/subbagsumda/*` dicabut dari `SDL_EXPRESS_PATHS` + `--force-recreate caddy` (`admin off`) | `/cuti*` dan `/kesejahteraan*` dijawab chi 404 `text/plain`. Personel/dashboard/karier/diklat ikut 404 (sudah ditangani) |
| Frontend | Deteksi 404 non-JSON (`makeApi` di `SumdaBersama.tsx`) memunculkan "Cuti & Perizinan / Kesejahteraan tidak tersedia". **Tidak ada cadangan** karena tidak ada padanan lama. Tombol "Proses Pensiun" hilang bersama layar Monitoring Pensiun, yang jatuh ke cadangan registry R5H27 |
| Rollback sempit (pola baru, menggantikan pola R5H29) | `/api/v1/subbagsumda/personel* /api/v1/subbagsumda/pensiun/* /api/v1/subbagsumda/dashboard /api/v1/subbagsumda/karier* /api/v1/subbagsumda/diklat* /api/v1/subbagsumda/kompetensi* /api/v1/subbagsumda/cuti* /api/v1/subbagsumda/kesejahteraan* /api/v1/subbagsumda/opsi-dropdown/*` |
| Data dan skema | Tabel 071 diam, tanpa dual-write. Pengajuan yang Disetujui menunggu Express kembali. Skema tidak perlu dibalik |

### 4. Migrasi `071_sumda_cuti_kesejahteraan.sql`

Migrasi terakhir saat ini adalah 070 (`migrate_test.go:82`, `src/migrations/index.js:121`). R5H15 digeser ke **072**
(`docs/R5H15-RIWAYAT-VERSI-DOKUMEN.md:12,106,169`). `MIGRATION-PLAN.md:16` diubah menjadi "049–071", ditambah R5H30.

```sql
-- R5H30 (2026-11-24): Subbagsumda Cuti & Perizinan + Kesejahteraan. Express saja.
-- Hak lewat permission pada grant unit 'subbagsumda' (pola 068/069), scope TIDAK menyaring baris (K6).
-- K11 (cuti bertumpuk) ditegakkan transaksional di API dengan kunci baris personel (lihat dokumen §5),
-- bukan exclusion constraint: belum ada satu pun extension di 70 migrasi.

CREATE TABLE sdl_sumda_cuti (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 jenis VARCHAR(16) NOT NULL CHECK (jenis IN ('TAHUNAN','SAKIT','ALASAN_PENTING','BESAR','LAINNYA')),
 tanggal_mulai DATE NOT NULL,
 tanggal_selesai DATE NOT NULL,
 tanggal_kembali DATE,
 jumlah_hari SMALLINT NOT NULL CHECK (jumlah_hari BETWEEN 1 AND 366),
 hari_disesuaikan BOOLEAN NOT NULL DEFAULT FALSE,
 status VARCHAR(12) NOT NULL DEFAULT 'Diajukan'
   CHECK (status IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_at TIMESTAMPTZ,
 selesai_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 selesai_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_cuti_rentang CHECK (tanggal_selesai >= tanggal_mulai AND tanggal_selesai - tanggal_mulai <= 365),
 CONSTRAINT sdl_sumda_cuti_kembali CHECK (tanggal_kembali IS NULL
   OR (status = 'Selesai' AND tanggal_kembali BETWEEN tanggal_mulai AND tanggal_selesai)),
 CONSTRAINT sdl_sumda_cuti_hari CHECK (jumlah_hari <= coalesce(tanggal_kembali, tanggal_selesai) - tanggal_mulai + 1),
 CONSTRAINT sdl_sumda_cuti_tahunan CHECK (jenis <> 'TAHUNAN'
   OR date_part('year', tanggal_mulai) = date_part('year', tanggal_selesai)),          -- K28
 CONSTRAINT sdl_sumda_cuti_pemutus CHECK ((decided_by IS NULL) = (decided_at IS NULL)
   AND (decided_by IS NULL OR decided_by <> created_by)),
 CONSTRAINT sdl_sumda_cuti_diputus CHECK (status NOT IN ('Disetujui','Ditolak','Selesai') OR decided_by IS NOT NULL),
 CONSTRAINT sdl_sumda_cuti_selesai CHECK (status <> 'Selesai' OR (selesai_by IS NOT NULL AND selesai_at IS NOT NULL))
);
CREATE INDEX sdl_sumda_cuti_personel_idx ON sdl_sumda_cuti(personel_id, tanggal_mulai);
CREATE INDEX sdl_sumda_cuti_kalender_idx ON sdl_sumda_cuti(tanggal_mulai, tanggal_selesai)
 WHERE status IN ('Diproses','Disetujui','Selesai');
CREATE INDEX sdl_sumda_cuti_status_idx ON sdl_sumda_cuti(status, created_at DESC);

CREATE TABLE sdl_sumda_cuti_riwayat ( -- pola sdl_sumda_karier_riwayat (dari, ke, catatan, oleh, pada), CASCADE ke induk
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cuti_id UUID NOT NULL REFERENCES sdl_sumda_cuti(id) ON DELETE CASCADE,
 dari VARCHAR(12) CHECK (dari IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 ke VARCHAR(12) NOT NULL CHECK (ke IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_cuti_riwayat_idx ON sdl_sumda_cuti_riwayat(cuti_id, id);

CREATE TABLE sdl_sumda_cuti_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 cuti_id UUID NOT NULL REFERENCES sdl_sumda_cuti(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_cuti_lampiran_idx ON sdl_sumda_cuti_lampiran(cuti_id, uploaded_at);

CREATE TABLE sdl_sumda_kesejahteraan (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 jenis VARCHAR(20) NOT NULL CHECK (jenis IN ('PERSIAPAN_PENSIUN','MPP','ASABRI','KARTU_IDENTITAS','LAINNYA')),
 nomor_referensi VARCHAR(100) NOT NULL DEFAULT '',
 target_selesai DATE,
 status VARCHAR(12) NOT NULL DEFAULT 'Diajukan'
   CHECK (status IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 diterapkan JSONB,
 created_by / updated_by / decided_by / decided_at / selesai_by / selesai_at / version / created_at / updated_at  -- persis sdl_sumda_cuti
 CONSTRAINT sdl_sumda_kesejahteraan_pemutus CHECK (... sama dengan cuti ...),
 CONSTRAINT sdl_sumda_kesejahteraan_diputus CHECK (... sama dengan cuti ...),
 CONSTRAINT sdl_sumda_kesejahteraan_selesai CHECK (status <> 'Selesai'
   OR (diterapkan IS NOT NULL AND selesai_by IS NOT NULL AND selesai_at IS NOT NULL)),
 CONSTRAINT sdl_sumda_kesejahteraan_terapkan CHECK (diterapkan IS NULL OR diterapkan = '{}'::jsonb
   OR jenis IN ('PERSIAPAN_PENSIUN','MPP'))
);
-- [DIGANTIKAN K43: indeks ini TIDAK dibuat; K16/K37 dijaga di Express dengan kunci personel.]
-- K16: satu layanan terbuka per (personel, jenis). Bila K37 disetujui, tambahkan "AND jenis <> 'LAINNYA'".
CREATE UNIQUE INDEX sdl_sumda_kesejahteraan_terbuka_uq ON sdl_sumda_kesejahteraan(personel_id, jenis)
 WHERE status IN ('Diajukan','Diproses','Disetujui');
CREATE INDEX sdl_sumda_kesejahteraan_personel_idx ON sdl_sumda_kesejahteraan(personel_id, created_at DESC);
CREATE INDEX sdl_sumda_kesejahteraan_status_idx ON sdl_sumda_kesejahteraan(status, created_at DESC);
CREATE INDEX sdl_sumda_kesejahteraan_target_idx ON sdl_sumda_kesejahteraan(target_selesai)
 WHERE status IN ('Diajukan','Diproses','Disetujui');

-- sdl_sumda_kesejahteraan_riwayat dan sdl_sumda_kesejahteraan_lampiran: bentuk identik dengan tabel cuti
-- (kolom induk kesejahteraan_id; riwayat CASCADE, lampiran RESTRICT, SDL1).

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.cuti.manage', 'Catat dan kelola cuti dan perizinan personel Subbagsumda'),
 ('subbagsumda.cuti.approve', 'Setujui atau tolak cuti dan perizinan personel Subbagsumda'),
 ('subbagsumda.kesejahteraan.manage', 'Catat dan kelola layanan kesejahteraan dan pensiun Subbagsumda'),
 ('subbagsumda.kesejahteraan.approve', 'Setujui atau tolak layanan kesejahteraan dan pensiun Subbagsumda')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda','subbagsumda.cuti.manage'), ('br_staf_subbagsumda','subbagsumda.cuti.manage'),
    ('br_kasubbagsumda','subbagsumda.cuti.manage'), ('br_kasubbagsumda','subbagsumda.cuti.approve'),
    ('br_op_subbagsumda','subbagsumda.kesejahteraan.manage'), ('br_staf_subbagsumda','subbagsumda.kesejahteraan.manage'),
    ('br_kasubbagsumda','subbagsumda.kesejahteraan.manage'), ('br_kasubbagsumda','subbagsumda.kesejahteraan.approve')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;
```

**Kenapa K11 tidak memakai exclusion constraint:**
- Kendala teknis memang bisa diatasi. `EXCLUDE USING gist (personel_id WITH =, daterange(...) WITH &&) WHERE (...)`
  lolos pemeriksa substring, dan `btree_gist` tersedia di `postgres:18.6-alpine` sebagai extension *trusted*. User
  aplikasi juga `POSTGRES_USER` (superuser image resmi).
- Tetapi `grep` atas 70 migrasi tidak menemukan satu pun `CREATE EXTENSION` maupun `EXCLUDE`. Ini akan menjadi preseden
  baru dan objek tingkat database, padahal DB produksi tidak bisa digladi dari sini.
- Galatnya `23P01`, yang di `makeHandle` (`umum.js:57-70`) jatuh ke 503. Akibatnya `umum.js` harus diubah lagi.
- Rentang efektif bergantung pada `tanggal_kembali` dan status.

Pilihan rencana ini: **cek transaksional di bawah kunci baris personel** (§5). Konsekuensinya, tidak ada jaminan
tingkat DB untuk K11. Sebagai gantinya ada uji balapan di verify (§7, butir 3).

**Lolos pemeriksa substring** (`migrate_test.go:107-153`):
- `updated_*` tidak cocok dengan pola `UPDATE␠`, dan `ON DELETE …` tidak cocok dengan `DELETE FROM`.
- `date_part`/`substring(body FROM …)` mengandung `FROM`, bukan `DELETE FROM`.
- Tidak ada `;` atau `--` di dalam literal. `'{}'::jsonb` aman.
- Tidak ada `ALTER TABLE`, dan deskripsi permission tidak memuat kata "update".

**Lampiran RESTRICT** (pelajaran R5H29): bug akan gagal keras, bukan diam-diam menghapus berkas tersegel. Verify
membersihkan lampiran lebih dulu.

**Seed:** keempat permission ditambahkan ke `cmd/seed-bagrenmin/main.go:55-57` dan `src/cli/seed-bagrenmin.js:61-63`
secara identik. Seed menolak permission yang belum ada (`main.go:210-218`) dan hanya berjalan di DB baru, jadi DB
produksi mendapat permission lewat INSERT di migrasi.

**Gladi** (071 tidak bisa diperbaiki setelah commit, pelajaran S7):
1. `pg_dump -Fc` DB lokal.
2. Jalankan `--migrate` Express, start Go, `go test ./internal/migrations/`, dan diff seed.
3. Uji CHECK manual: Sabtu–Minggu dengan `jumlah_hari=0`, `kembali` di luar rentang atau tanpa Selesai, `decided_by=created_by`,
   Tahunan lintas tahun, `diterapkan` tidak kosong pada ASABRI, `body` tanpa `SDL1`, indeks unik terbuka.
4. Pulihkan dump, **baru commit**.

Tidak ada salinan data, jadi tidak perlu pra-cek data produksi.

Angka CLAUDE.md: 115 tabel dari migrasi (+ `sdl_schema_migrations` milik runner), 71 berkas SQL, suite Express 26/26.

### 5. Otorisasi

**Bukan Engine A/B.** Otorisasi memakai `PERMIT_SQL` (`umum.js:38-47`) lewat `SELECT EXISTS` sebelum query data.
Syaratnya: grant aktif unit `subbagsumda` yang belum kedaluwarsa atau dicabut, role aktif bukan Superadmin, user aktif
dengan `NOT must_change_password`, dan permission role yang sesuai. Scope dan klasifikasi tidak menyaring baris
(K6/K22), jadi tidak ada penyaringan setelah SELECT.

| Hak | Permission | Role |
|---|---|---|
| R | `subbagsumda.personel.read` (`003_role_editor.sql:52`) | op, staf, kasubbag, `br_kabagrenmin` (grant di keempat unit, `main.go:243-248`) |
| Mc / Ac | `subbagsumda.cuti.manage` / `.approve` | op, staf, kasubbag / kasubbag |
| Mk / Ak | `subbagsumda.kesejahteraan.manage` / `.approve` | op, staf, kasubbag / kasubbag |
| U | `subbagsumda.personel.update` | op, staf, kasubbag |

| Aksi | Dari | Ke | Hak |
|---|---|---|---|
| `proses` | Diajukan | Diproses | M |
| `setujui` / `tolak` | Diproses | Disetujui / Ditolak | A, bukan pencatat dan bukan pengubah terakhir. Tolak wajib alasan ≥ 8 karakter |
| `batalkan` | Diajukan / Diproses / Disetujui (K17) | Dibatalkan | M dan (pencatat **atau** punya A). Alasan ≥ 8 karakter |
| `selesai` (cuti) | Disetujui | Selesai | Mc. `tanggalKembali?`, `jumlahHari?` (K31) |
| `selesai` (kesejahteraan) | Disetujui | Selesai | Mk. Dengan `terapkan` juga butuh U (K33) |

Hak diperiksa sebelum validasi isian (review R5H28 S8). Kunci badan request strict per aksi: `tanggalKembali`/`jumlahHari`
hanya untuk `selesai` cuti, `terapkan` hanya untuk `selesai` kesejahteraan.

- **Maker-checker diputus di SQL:**
  - `UPDATE … WHERE id AND status='Diproses' AND version=$v AND created_by<>$actor AND updated_by<>$actor`. Bila
    `rowCount=0` setelah versi dan status sudah dicek di bawah kunci, hasilnya 403 `self_review_forbidden`.
  - CHECK `*_pemutus` menjadi penahan terakhir.
  - `updated_by` diisi oleh PATCH, unggah/hapus lampiran (perluasan K19, R5H28 W1), dan aksi `selesai`. **Tidak**
    diisi oleh `proses` (sama dengan `karier.js:306`).
  - Batalkan: `WHERE … AND (created_by=$actor OR $isApprover)`, gagal → 403 `access_denied`.
- **Lampiran Sakit (K4) diputus di SQL:**
  - Unduh: `SELECT l.filename,l.sha256,l.body FROM sdl_sumda_cuti_lampiran l JOIN sdl_sumda_cuti c ON c.id=l.cuti_id
    WHERE l.id=$1 AND l.cuti_id=$2 AND (c.jenis<>'SAKIT' OR l.uploaded_by=$3 OR $4::boolean)`. `$4` adalah hasil
    `PERMIT_SQL` untuk Ac, preseden `karier.js:323`.
  - `rowCount=0` lalu dicek keberadaannya: ada → 403 `access_denied`, tidak ada atau id silang → 404.
  - Daftar lampiran di `GET /cuti/:id` memakai `CASE WHEN <syarat sama> THEN l.filename END AS filename` dan
    `dibatasi`, jadi nama berkas Sakit **tidak pernah keluar** ke pembaca yang tidak berhak (K39).
  - `jenis` tidak bisa diubah lewat PATCH (K29), sehingga syarat ini tidak bisa dielakkan.
- **K11 cuti bertumpuk**, di POST dan PATCH, dalam transaksi:
  1. `SELECT … FROM sdl_sumda_personel WHERE id=$1 FOR NO KEY UPDATE` (menolak terarsip/tidak aktif).
  2. `SELECT EXISTS(… WHERE personel_id=$1 AND id IS DISTINCT FROM $self AND status IN
     ('Diajukan','Diproses','Disetujui','Selesai') AND tanggal_mulai <= $selesai AND coalesce(tanggal_kembali,
     tanggal_selesai) >= $mulai)`. Bila ada, 409 `cuti_bertumpuk`.
  3. INSERT/UPDATE.

  Dua POST untuk personel yang sama berjalan berurutan pada kunci itu. Di READ COMMITTED, cek kedua melihat baris
  pertama yang sudah di-commit. Transisi status tidak pernah memasukkan baris ke himpunan di atas, dan Selesai hanya
  memperpendek rentang, jadi cek cukup di POST dan PATCH.
- **Urutan kunci tetap: induk → personel.**

  | Jalur | Urutan kunci |
  |---|---|
  | POST cuti | personel `FOR NO KEY UPDATE`, lalu INSERT. **Menyimpang secara sadar** dari `karier.js:30-31` karena K11 butuh serialisasi; aman karena POST tidak mengunci baris cuti lain |
  | PATCH cuti | cuti `FOR UPDATE`, lalu personel `FOR NO KEY UPDATE` |
  | `proses`/`setujui`/`tolak` | induk `FOR UPDATE`, lalu personel `FOR SHARE` (cek terarsip) |
  | Selesai | induk `FOR UPDATE`, lalu personel `FOR NO KEY UPDATE` |
  | POST kesejahteraan | personel `FOR NO KEY UPDATE`, lalu INSERT (K43: K16 dijaga kunci ini, tanpa indeks unik) |

  Arsip dan PATCH personel R5H27 hanya mengunci personel, jadi tidak ada siklus.
- **Selesai + terapkan (K3/K33)**, satu transaksi: kunci layanan `FOR UPDATE`, lalu personel `FOR NO KEY UPDATE`.
  - Terarsip → 409 `personel_terarsip`. Versi ≠ `terapkan.personelVersion` → 409 `personel_berubah`.
  - `terapkan.status` harus persis hasil pemetaan, kalau tidak 400. Syarat status asal lihat K33.
  - `UPDATE sdl_sumda_personel SET status=$s,updated_by,updated_at,version=version+1 WHERE id AND version AND deleted_at
    IS NULL` (rowCount harus 1). Lalu layanan diubah ke Selesai dengan `diterapkan={"fields":{"status":{lama,baru}},
    "personelVersion":{lama,baru}}`, kemudian riwayat dan audit. Audit kedua `subbagsumda.personel.update
    {fields:['status'],version}` muncul di "Aktivitas terakhir" dashboard.
  - Tanpa `terapkan`: `diterapkan={}` dan U tidak diperiksa.
- **Lampiran** (pola R5H28/R5H29 pasca-review):
  - Hak, status, dan personel terarsip dicek **sebelum** `bacaPdf`, lalu diulang di transaksi.
  - `bacaPdf` menolak PDF terenkripsi/rusak (400). Batas 10 berkas per pengajuan (409 `batas_lampiran`).
  - `naikVersi` mengisi `updated_by`.
  - Unduhan: `bukaPdf` dan `pasangHeaderUnduh` dipanggil sebelum audit `*.lampiran.download`.
- **Audit:** `subject_type` adalah `subbagsumda.cuti` / `subbagsumda.kesejahteraan`.
  - Event: `create|update|proses|setujui|tolak|batalkan|selesai|lampiran.add|lampiran.delete|lampiran.download`.
  - Metadata daftar putih `{jenis,status,fields,version}`, tanpa catatan, nama, NRP, tanggal, atau nama berkas (K19).

### 6. Berkas dibuat/diubah

**Express**
- `src/modules/subbagsumda/umum.js`: `HttpError(status, code, extra?)` dan `makeHandle` yang menggabungkan `extra`
  ke badan galat (aditif; R5H27–R5H29 tidak memakainya, K35).
- `src/modules/subbagsumda/cuti.js` (baru):
  - `createSumdaCutiRouter`, `JENIS_CUTI`, `STATUS_CUTI`.
  - `hariKerja(mulai, selesai)`: fungsi murni atas string tanggal, tanpa zona waktu (K25).
  - `jatahCuti`, `cutiHariIniSql(hari = HARI_INI)` (bisa diuji dengan `hariDari`), `cutiTahunIni(db, id)`,
    `CUTI_HARI_INI_SQL`.
  - Route: kalender, jatah, CRUD, aksi, lampiran.
- `src/modules/subbagsumda/kesejahteraan.js` (baru): `createSumdaKesejahteraanRouter`, `JENIS_LAYANAN`, `PETA_TERAPKAN
  = {MPP:'MPP', PERSIAPAN_PENSIUN:'Pensiun'}`, `kesejahteraanPersonel(db, id)`, `LAYANAN_MENUNGGU_SQL` (cuti +
  kesejahteraan berstatus Diproses, personel belum terarsip).
- `personel.js`: penambahan di `GET /:id` dan `/dashboard`.
- `src/app.js`: dua mount.
- `src/migrations/index.js:121`, `src/cli/seed-bagrenmin.js:61-63`.
- `payload.js` tidak perlu diubah (`SUMDA` 32 KB, `SUMDA_LAMPIRAN` sudah ada).

**Go:** `internal/migrations/sql/071_sumda_cuti_kesejahteraan.sql`, `internal/migrations/migrate_test.go:82`,
`cmd/seed-bagrenmin/main.go:55-57`.

**Frontend**
- `SumdaBersama.tsx`: `LampiranItem` mendapat `filename: string | null` dan `dibatasi?: boolean`. `LampiranPdf`
  menampilkan "Lampiran (dibatasi)" tanpa tombol pratinjau untuk item itu.
- `SumdaCutiR5H30.tsx/.css`:
  - Tab Daftar dan Kalender lewat `effectiveScreen.tab`, alamat `/subbagsumda/cuti/kalender`.
  - Form menampilkan hari kerja (`hariKerja` versi TS, hanya untuk tampilan) dan sisa jatah dari `/cuti/jatah`. Bila
    melebihi jatah, muncul `confirmDialog` lalu `peringatan` ditampilkan setelah simpan.
  - Petunjuk K19 untuk Sakit, dialog alasan, dialog Selesai dengan "hari terakhir cuti sebenarnya".
  - `?id=` divalidasi dengan UUID.
- `SumdaKesejahteraanR5H30.tsx/.css`:
  - Daftar dengan penanda "lewat target".
  - Dialog Selesai: untuk MPP/Persiapan Pensiun ada "Status sekarang → usulan" dan centang "Perbarui Master Personel"
    (hanya bila `canUpdate` personel). 409 `personel_berubah` memuat ulang dialog.
- `SumdaPersonelR5H27.tsx`:
  - `SumdaNav` (`:44`) ditambah `'cuti' | 'kesejahteraan'`.
  - `DashboardView` (`:111-130`) mendapat dua kartu.
  - `DetailDialog` (`:293-344`) mendapat bagian "Cuti tahun ini" dan "Layanan kesejahteraan", plus tombol "Proses
    Pensiun". Tombol itu memuat `/kesejahteraan/capabilities` sendiri, karena `caps` di dialog adalah caps personel.
  - `PensiunView` (`:416-475`) mendapat kolom aksi "Proses Pensiun".
  - Helper `prosesPensiun(personel, onNavigate)` (K34).
- `App.tsx`:
  - `IconName` (`:44`) dan peta ikon (`:80`) ditambah `handshake`.
  - Modul di `:156` setelah `diklat`: `{id:'cuti',title:'Cuti & Perizinan',icon:'calendar',…}` dan
    `{id:'kesejahteraan',title:'Kesejahteraan',icon:'handshake',…}`.
  - Cabang render dekat `:600-602`.
  - `RouteR5H26.ts` tidak berubah.

**Docs:** dokumen ini, `API-CONTRACT.md` (§2), `MIGRATION-PLAN.md:16`, `R5H15-…md:12,106,169` (→ 072),
`R2D5-SECURITY-TESTS.md:8` (26/26, x5) dan bagian uji mutasi `:32-35`, catatan sesi. Untuk pemilik: CLAUDE.md
(115 tabel dari migrasi / 71 berkas SQL / 26/26) dan memori R5H15 → 072.

### 7. Pengujian

**`verify/r5h30-sumda-cuti-kesejahteraan.js`** mengikuti pola `verify/r5h29-sumda-diklat.js`. Personel uji memakai
`UJI-R5H30-`. Pembersihan berurutan: lampiran, riwayat, cuti/kesejahteraan, audit, personel.

0. **Hari kerja:** `hariKerja()` dibandingkan dengan oracle SQL `count(*) FROM generate_series(..) WHERE isodow<6`
   untuk ±200 rentang acak, termasuk akhir pekan, akhir bulan, 29 Feb, dan akhir tahun. Sabtu–Minggu menghasilkan 400,
   kecuali dengan `jumlahHari` manual. `jumlahHari` > hari kalender juga 400.
1. **Jatah (K10/K29):** terpakai = Disetujui+Selesai Tahunan pada tahun mulai, dalam proses dihitung terpisah, jenis
   lain tidak dihitung. `peringatan:["melebihi_jatah"]` muncul tanpa menolak. Tahunan lintas tahun ditolak 400.
2. **Alur cuti:**
   - Transisi tidak sah → 409.
   - Maker-checker: Kasubbag yang mencatat 403; pengubah terakhir lewat PATCH atau lampiran 403; `proses` oleh
     Kasubbag lalu setujui 200.
   - CHECK DB diuji dengan UPDATE langsung (23514).
   - Alasan < 8 karakter → 400. Batalkan dari Disetujui → 200.
   - Selesai sebelum tanggal mulai → 409. `tanggalKembali` lebih awal → hari dihitung ulang. Lewat tanggal selesai
     atau lewat hari ini → 400.
3. **K11:** rentang beririsan → 409, berbatasan → 201. Setelah kembali lebih awal, sisa rentang bebas. PATCH tanggal
   ke rentang yang beririsan → 409. **Balapan:** dua POST beririsan dikirim bersamaan (`Promise.all`), hasilnya tepat
   satu 201 dan satu 409.
4. **Syarat personel (K13/K32):** Pensiun/Nonaktif → 409 `personel_tidak_aktif`. Terarsip → POST 409, aksi lain 409,
   batalkan 200. Personel yang menjadi Pensiun setelah pengajuan tetap bisa diproses.
5. **Kalender & dashboard (WIB):**
   - `cutiHariIniSql(hariDari('$1'))` dengan stempel `2026-11-23T17:00:00Z` (= 24 Nov WIB).
   - Kalender: `bulan` tidak sah → 400; Diajukan dan personel terarsip tidak tampil; Diproses bertanda.
6. **Kesejahteraan:**
   - Alur, `pengajuan_ganda`, dan jenis lain tetap boleh.
   - Selesai MPP → status MPP (versi personel +1, audit `personel.update`). Persiapan Pensiun → Pensiun.
   - Tanpa centang → master tetap, `diterapkan={}`. Tanpa U → 403. Versi lama → 409 `personel_berubah`.
   - MPP tanpa tanggal pensiun → 409 `personel_belum_lengkap`. `terapkan.status` lain → 400. `terapkan` pada ASABRI → 400.
7. **Proses Pensiun (K34/K35):** POST kedua → 409 `{error:'pengajuan_ganda', id}` yang sama dengan pengajuan pertama.
   Setelah Selesai, boleh membuat baru.
8. **Lampiran:**
   - Byte-identik dan `body` diawali `SDL1`. Batas 11 berkas → 409. Terenkripsi/rusak → 400. Id silang → 404.
     `body` dirusak → 503.
   - **Sakit:** staf non-pengunggah → 403 dan nama berkas `null`; pengunggah 200; Kasubbag 200; Kabagrenmin 403.
   - Lampiran Tahunan terbuka untuk semua pemegang R.
9. **Audit tanpa PII:** tidak ada nama, NRP, catatan, nama berkas, atau tanggal.
10. **Penambahan R5H27:** `cutiTahunIni`, `riwayatKesejahteraan`, `cutiHariIni`, `layananMenunggu` (diukur sebagai
    selisih). POST/PATCH personel tidak membawa field baru.
11. **Regresi:** `verify/r5h27-*`, `r5h28-*`, `r5h29-*` (karena perubahan `HttpError`/`makeHandle`).

**Skenario `x5_r5h30_sumda_layanan_guard`** (`security/scenarios/r5h30.js`, didaftarkan setelah `x4_` di
`security/index.js:71`):
- **Guard:** anonim 401. Superadmin 403 di kedua prefix untuk semua metode, termasuk app demo. UUID fiktif 403, bukan
  404. Capabilities `false` untuk unit lain, tanpa keanggotaan, dan Superadmin demo.
- **Matriks:**
  - Baca-saja tidak bisa membuat, mengubah, unggah, atau aksi.
  - Tanpa A tidak bisa setujui/tolak. Pencatat yang punya A → 403. Pengubah lampiran → 403 (W1).
  - Approver-saja bisa setujui, tetapi proses/selesai 403. Selesai+terapkan tanpa U → 403.
- **Pencabutan:** grant kedaluwarsa, role nonaktif, `must_change_password`, grant dicabut → 403.
- **CSRF/Origin** untuk JSON dan multipart (multipart tanpa CSRF, keterbatasan D6 R5H28).
- **Lampiran Sakit dibatasi** (unduh 403, nama `null`). Lampiran: PDF palsu, nama berbahaya, > 5 MB, dua berkas, id
  silang antar-pengajuan dan antar-modul (lid cuti lewat path kesejahteraan → 404).
- **Bentuk:** field asing, `__proto__`, Cf, NUL, JSON > 32 KB, `tanggalKembali` pada aksi lain, `terapkan` pada cuti,
  probe query `bulan`/`tahun`.
- **Kunci evidence kosong** → 503 (fail-closed).
- **Uji mutasi:**
  - Hapus `c.jenis<>'SAKIT' OR …` dari SQL unduhan → hanya x5 merah.
  - Hapus `updated_by<>$actor` → x5 merah.
  - Berkas dipulihkan setiap kali.
- Suite Express **26/26**. Suite Go tetap dijalankan (071 ter-embed).

**Harness golden:** endpoint baru tidak direkam. 127 `/admin/permissions` dan 128 `/admin/roles` berubah lagi karena
071, jadi direkam ulang oleh pemilik. Kasus 32–37 harus tetap cocok.

### 8. Urutan kerja

1. Persetujuan K25–K42; R5H15 → 072. *Gerbang:* pemilik setuju.
2. Migrasi 071 + manifes (Go dan Express) + seed (Go dan Express), **belum di-commit**. *Gerbang:* gladi `pg_dump`,
   `go test`, uji CHECK manual, diff seed kosong, **baru commit**.
3. `umum.js`: `HttpError.extra` (aditif). *Gerbang:* `node --check`, verify R5H27–R5H29, x2–x4 hijau.
4. **Irisan A, cuti:** `cuti.js` + mount + `cutiTahunIni`/`cutiHariIni` + bagian cuti di verify dan x5. *Gerbang:*
   verify butir 0–5, 8 (cuti), 9–10, harness 32–37.
5. **Irisan B, kesejahteraan:** `kesejahteraan.js` + mount + `riwayatKesejahteraan`/`layananMenunggu` + bagian
   kesejahteraan di x5. *Gerbang:* verify penuh, regresi R5H27–R5H29, dua suite keamanan (26/26), uji mutasi.
6. **Frontend:** `SumdaBersama`, `SumdaCutiR5H30`, `SumdaKesejahteraanR5H30`, R5H27 (nav, dashboard, detail,
   Proses Pensiun), `App.tsx`. *Gerbang:* `npm run build`, demo per akun (op mencatat → Kasubbag memutus → op
   Selesai; staf; Kabagrenmin baca-saja dengan Sakit dibatasi; akun unit lain 403), lebar 390 px, simulasi rollback.
7. Docs, `/verifikasi`, `/review`; golden 127/128 oleh pemilik.
8. **Deploy:** cek `SDL_EVIDENCE_KEY` produksi (baca saja), **centang "Izinkan migrasi"**, rebuild `api`,
   `api-express`, dan `frontend`.

### 9. Risiko dan keputusan baru

| # | Risiko | Penanganan |
|---|---|---|
| R1 | 071 tidak bisa diperbaiki setelah commit | Gladi + `pg_dump`; K25–K42 diputus dulu |
| R2 | K11 tanpa jaminan DB (tidak ada exclusion constraint) | Kunci personel di POST/PATCH; uji balapan; CHECK lain tetap di DB |
| R3 | Deadlock karena POST cuti mengunci personel lebih dulu | POST tidak mengunci baris cuti lain; jalur lain selalu induk → personel; diuji paralel |
| R4 | Data kesehatan bocor lewat nama berkas atau audit | Nama berkas di-`NULL`-kan di SQL; audit daftar putih; `jenis` tidak bisa diubah (K29) |
| R5 | Seed hanya punya satu Kasubbagsumda, jadi pengajuan yang ia catat sendiri macet | Sama dengan R5H28 R1: peringatan di form, approver kedua lewat Role Editor |
| R6 | Hari kerja tanpa libur nasional (K9) membuat jatah tampak lebih besar | `jumlahHari` manual + `hari_disesuaikan`; tabel libur di luar cakupan |
| R7 | Terapkan Pensiun mengeluarkan personel dari Monitoring Pensiun dan Master Personel menjadi "Pensiun" | Dikonfirmasi lewat centang; audit `personel.update`; bisa dikoreksi manual di Master Personel |
| R8 | Perubahan `HttpError`/`makeHandle` merusak R5H27–R5H29 | Langkah terpisah + verify + x2–x4 |
| R9 | `SDL_EVIDENCE_KEY` produksi salah | Fail-closed; dicek sebelum deploy |
| R10 | Golden 127/128 berubah | Rekam ulang oleh pemilik |

| # | Hal | Usulan |
|---|---|---|
| K25 | Tempat hitung hari kerja | Fungsi murni JS `hariKerja()` dari string `YYYY-MM-DD` (tanpa zona waktu), diuji terhadap oracle SQL. Semua "hari ini" (Selesai, kalender, dashboard, tahun jatah bawaan) memakai `HARI_INI` WIB di Postgres, **tidak pernah** `CURRENT_DATE` atau `new Date()` |
| K26 | Rentang tanpa hari kerja dan penyesuaian manual | 0 hari kerja → 400, kecuali `jumlahHari` manual ≥ 1. Manual: 1 … hari kalender rentang, tersimpan `hari_disesuaikan`, ditandai "disesuaikan" di UI |
| K27 | Batas rentang | Maks. 366 hari kalender per pengajuan, tahun 2000–2100. Cuti lebih panjang dicatat beberapa pengajuan |
| K28 | Tahun jatah untuk cuti lintas tahun | Cuti **Tahunan tidak boleh lintas tahun** (400, catat dua pengajuan), dijaga juga oleh CHECK. Jenis lain boleh lintas tahun (tidak memengaruhi jatah) |
| K29 | Ubah pengajuan (PATCH) | Badan penuh + `version`, hanya saat Diajukan. `personelId` dan `jenis` **tidak bisa diubah** (pola R5H28 K18, wajib untuk K4); ganti berarti batalkan lalu buat baru |
| K30 | Peringatan jatah | `melebihi_jatah` bila `jumlahHari > 12 − terpakai − dalamProses` (pengajuan itu sendiri tidak dihitung), dikirim di POST dan PATCH. Detail menampilkan jatah untuk Kasubbag. `sisa` boleh negatif ("lebih N hari") |
| K31 | Selesai cuti | Hanya bila hari ini (WIB) ≥ tanggal mulai; sebelum itu yang ada hanya batalkan. `tanggalKembali` = **hari terakhir cuti yang benar-benar dijalani** (inklusif), ∈ [mulai, min(selesai, hari ini)]. Bila diisi, `jumlahHari` dihitung ulang (boleh dikoreksi `jumlahHari` di aksi yang sama) |
| K32 | Perubahan status atau arsip personel setelah pengajuan | Pensiun/Nonaktif tidak memblokir aksi (pola R5H28 K20/D1). Terarsip: hanya batalkan; cuti dan layanannya tidak tampil di kalender, dashboard, dan jatah |
| K33 | Terapkan status (K3) | MPP hanya dari Aktif (tanggal pensiun wajib, kalau tidak 409 `personel_belum_lengkap`). Pensiun dari Aktif/MPP. Sudah berstatus target: tidak ditawarkan. Status lain → 409 `personel_tidak_aktif`. Tidak ada syarat tanggal pensiun sudah lewat, hanya catatan di UI |
| K34 | Tombol "Proses Pensiun" | Hanya untuk personel Aktif/MPP belum terarsip dan pemegang Mk; ada konfirmasi. Target = tanggal pensiun (kosong bila belum diisi). Layanan terbuka → dibuka. Ada yang Selesai dan personel sudah Pensiun → tombol disembunyikan. Selesai tetapi status bukan Pensiun → boleh membuat baru dengan peringatan |
| K35 | 409 `pengajuan_ganda` membawa `id` | Lewat `HttpError(..., {id})` (aditif di `umum.js`, kunci daftar putih `id`), hanya di POST kesejahteraan. *(K43: tanpa indeks unik tidak ada jalur 23505; semua POST terserialisasi kunci personel dan selalu membawa `id`.)* |
| K36 | Lampiran: kapan | Unggah selama Diajukan/Diproses/Disetujui/**Selesai** (surat keterangan atau SK susulan). Hapus oleh pengunggah atau A, hanya sebelum Disetujui. Tambah/hapus menaikkan versi dan `updated_by` |
| K37 | K16 untuk `LAINNYA` | Tidak berlaku: beberapa "layanan lain" boleh terbuka bersamaan. *(K43: dijaga di kode `kesejahteraan.js`, bukan indeks.)* |
| K38 | Pembaca tanpa hak lampiran Sakit | `filename: null, dibatasi: true` (nama asli bisa memuat diagnosis); ukuran dan pengunggah tetap tampil |
| K39 | Batas kalender | Satu bulan per permintaan. Status Diproses (bertanda)/Disetujui/Selesai. Maks. 1000 cuti per bulan, lebih dari itu `terpotong: true`. Hanya nama personel, tanpa NRP |
| K40 | Angka dashboard | `cutiHariIni` = jumlah personel berbeda yang rentang efektifnya memuat hari ini (Disetujui/Selesai, belum terarsip). `layananMenunggu` = cuti + kesejahteraan berstatus Diproses dengan personel belum terarsip (pelajaran R5H28 S3) |
| K41 | Penambahan di detail personel | `cutiTahunIni` `{tahun,jatah,terpakai,dalamProses,sisa,items}` + `riwayatKesejahteraan`, masing-masing maks. 50 |
| K42 | Ikon "jabat tangan" (K5) | Tambah ikon SVG `handshake` di `App.tsx`; tidak ada pustaka ikon baru |

### K43: aturan bisnis di kode, bukan di migrasi (2026-11-24)

Pemilik: alur bisnis cuti & kesejahteraan **belum pasti** dan akan dipaparkan ke pengguna dulu; K25–K42 disetujui
sementara. Karena 071 tidak bisa diedit setelah commit, **migrasi hanya memuat aturan struktural**: daftar status dan
jenis, `tanggal_selesai >= tanggal_mulai`, `jumlah_hari >= 1`, `tanggal_kembali` di dalam rentang, pemutus ≠ pencatat,
syarat kolom pemutus/selesai, isi lampiran `SDL1`. Yang **dipindah ke kode Express** (bisa diubah tanpa migrasi baru):
Tahunan tidak lintas tahun (K28), batas 366 hari (K27), `jumlah_hari` ≤ hari kalender (K26), `terapkan` hanya MPP/
Persiapan Pensiun (K33), dan satu layanan terbuka per jenis kecuali `LAINNYA` (K16/K37) — yang terakhir dijaga
transaksional dengan kunci personel `FOR NO KEY UPDATE` di POST kesejahteraan (sama dengan K11 cuti), tanpa indeks
unik parsial. Dua aturan ini diuji balapan di verify.

### Temuan yang mengoreksi dokumen rilis

1. **`deleted_at` pada `sdl_sumda_cuti`** tidak punya alur. Tidak ada arsip pengajuan di K1–K24, dan 069 juga tidak
   memakainya. Kolom ini dihapus; "Dibatalkan" yang menggantikan.
2. **Kunci personel saat Selesai** di dokumen tertulis `FOR UPDATE`. Pola yang benar adalah `FOR NO KEY UPDATE`
   (`karier.js:342`), supaya tidak memblokir `FOR KEY SHARE` dari FK.
3. **Maker-checker:** CHECK DB hanya menegakkan `decided_by <> created_by` (`069:35-36`); syarat `updated_by` hanya ada
   di `WHERE`. Aksi `proses` tidak mengisi `updated_by` (`karier.js:306`), jadi yang memproses tetap boleh memutus.
4. **K11 tidak bisa dijaga indeks unik**, dan migrasi yang ada tidak memakai `btree_gist`. K11 ditegakkan secara
   transaksional dengan kunci personel di POST/PATCH, menyimpang secara sadar dari "membuat tidak mengunci personel"
   (`karier.js:30-31`). Irisan memakai rentang efektif `coalesce(tanggal_kembali, tanggal_selesai)`.
5. **"Nama berkas (dibatasi)" (K4)** butuh dua hal: nama berkas di-`NULL`-kan **di SQL** detail, dan `LampiranPdf`
   mendukung item `dibatasi`. Selain itu `jenis` harus tidak bisa diubah (K29); kalau bisa, mengubah Sakit menjadi
   jenis lain membuka lampirannya.
6. **"409 `pengajuan_ganda` + id"** belum didukung `makeHandle`, yang hanya mengirim `{error}` (`umum.js:57-70`,
   `subbagren/shared.js:18`). Perlu perluasan aditif (K35).
7. **Kode galat kurang `personel_belum_lengkap`**: menerapkan MPP tanpa tanggal pensiun akan melanggar aturan R5H27 K1
   (`personel.js:100`). Hasilnya 409, kode yang sudah ada di R5H28 K27.
8. **`tanggalKembali` ambigu**: apakah hari masuk kerja atau hari terakhir cuti. Dengan CHECK "antara mulai dan
   selesai", artinya hari terakhir cuti yang dijalani (K31).
9. **Tidak ada ikon jabat tangan** di `IconName` (`App.tsx:44`); `calendar` sudah ada (K42).
10. **`SumdaNav`** (`SumdaPersonelR5H27.tsx:44`) perlu `'cuti' | 'kesejahteraan'`. `caps` di `DetailDialog` dan
    `PensiunView` adalah caps personel, jadi "Proses Pensiun" harus memuat `/kesejahteraan/capabilities`.
11. **Klaim yang terverifikasi benar:**
    - Kabagrenmin memegang `subbagsumda.personel.read` lewat role `br_kabagrenmin` (`main.go:61`), dengan grant di
      unit `subbagsumda` (`main.go:243-248`). Kabagrenmin tidak punya approve, jadi unduhan lampiran Sakit 403.
    - Status personel memang `Aktif/MPP/Pensiun/Nonaktif` (`068:19`).
    - Hitungan suite 26/26 = 21 + x1…x5.
12. **Personel terarsip**: `GET /personel/:id` mengembalikan 404 untuk personel terarsip (`personel.js:133`), jadi
    penambahan K20 tidak tampil untuk mereka. Ini konsisten dengan R5H28/R5H29.
13. **Rollback sempit** § R5H29 di API-CONTRACT (`:1798-1800`) ditandai usang, dan pola baru memuat `/cuti*` dan
    `/kesejahteraan*`.
14. **CLAUDE.md** menjadi 115 tabel dari migrasi / 71 berkas SQL / suite Express 26/26. `MIGRATION-PLAN.md:16` menjadi "049–071".
    R5H15 → 072.

## Menyimpang dari rencana

1. **K43 (atas persetujuan pemilik, sebelum kode):** CHECK bisnis di §4 (Tahunan lintas tahun, `jumlah_hari` ≤ hari
   kalender, batas 365 hari, `tanggal_kembali` hanya saat Selesai, `terapkan` hanya MPP/Persiapan Pensiun) dan indeks
   unik parsial K16 **tidak** dibuat; semuanya ditegakkan di Express. K16 dijaga dengan kunci personel
   `FOR NO KEY UPDATE` di POST kesejahteraan (diuji balapan di verify). `jumlah_hari` memakai `INTEGER`, bukan
   `SMALLINT`.
2. **Skenario x5 satu commit** setelah irisan B (bukan dipecah per irisan); verify cuti sudah lulus sebelum irisan B.
3. **Kalender**: respons `{bulan, hari:[{tanggal, items}], terpotong}`; parameter selain `bulan` ditolak 400.
4. **Komponen bersama**: `CariPersonel`, `AlasanDialog`, `StatusPengajuan` ditambahkan ke `SumdaBersama.tsx` untuk
   layar R5H30; layar Karier/Diklat tidak dipindahkan (tidak disentuh).
5. **Traversal nama berkas** `../../x.pdf`: parser multipart sudah mengambil basename (padanan `safeName` Go), jadi x5
   memakai pola x3: 201 boleh asal nama tersimpan tanpa `/` atau `..`.

## Sisa uji (untuk /verifikasi)

Sudah dijalankan: gladi 071 dari `pg_dump` + 15 uji CHECK + Go start; `go test` (build image); verify R5H30 lulus
(hari kerja vs SQL 204 rentang, jatah, bertumpuk + balapan, maker-checker, Selesai, terarsip, kalender & dashboard WIB,
lampiran Sakit dibatasi, kesejahteraan + terapkan + balapan, aditif R5H27, audit); regresi verify R5H27/R5H28/R5H29;
suite Express **26/26** + tiga uji mutasi (lampiran Sakit dibuka, syarat pengubah terakhir, syarat `personel.update`
— masing-masing hanya x5 merah); `npm run build`; demo browser (op catat Sakit + PDF → Proses → Kasubbag Setujui →
staf melihat "Lampiran (dibatasi)" → kalender → Proses Pensiun dari Monitoring Pensiun membuka layanan; 390 px tanpa
geser horizontal).

Belum:
- Suite Go `security-test-r2d5.sh` dan putaran `/verifikasi` penuh.
- Demo per akun: Kabagrenmin (baca saja, lampiran Sakit 403), akun unit lain; dialog Selesai kesejahteraan dengan
  centang perbarui status; simulasi rollback (layar "tidak tersedia").
- Harness golden: 127/128 berubah lagi (katalog permission 071) → **rekam ulang oleh pemilik**; 32–37 harus cocok.
- Deploy: `SDL_EVIDENCE_KEY` produksi valid; **centang "Izinkan migrasi"** (071). Tidak ada salinan data, jadi tidak
  perlu pra-cek data.
- Paparan ke pengguna; keputusan bisnis yang berubah dikerjakan di kode (K43) tanpa migrasi baru bila struktural tetap.

## Perbaikan hasil review (2026-11-24)

`/review` (migration-guard + security-reviewer): tidak ada temuan wajib di kode; ketujuh aturan migrasi dipatuhi.
Wajib di dokumen (bagian yang masih memuat rencana sebelum K43) sudah dikoreksi di atas. Atas permintaan pemilik
("kerjakan sekalian semua") juga dikerjakan:

| # | Temuan | Perbaikan |
|---|---|---|
| S1 | Selesai cuti bisa mengubah jumlah hari tanpa pemeriksa | `jumlahHari` saat Selesai hanya bersama `tanggalKembali` dan ≤ jumlah yang disetujui; hitung ulang juga dibatasi jumlah yang disetujui |
| S2 | "Pengubah terakhir" bisa terlewati (Y mengubah, X mengunggah, Y memutus) | Pemutus juga tidak boleh **pernah** mengubah isian/lampiran pengajuan itu — dicek dari `sdl_audit_events` (`*.update`, `*.lampiran.add/delete`, ditulis dalam transaksi yang sama), untuk cuti dan kesejahteraan; id URL dibandingkan lowercase. **Karier R5H28 belum ikut** (di luar cakupan) |
| S3 | Catatan dan alasan riwayat cuti Sakit terbuka untuk semua pembaca | Diputus di SQL: hanya pencatat cuti, penulis riwayat, dan pemegang `cuti.approve` yang menerima teksnya; lainnya `null` + `catatanDibatasi`. PATCH dengan `catatan: null` = tidak diubah. Dialog alasan menampilkan petunjuk "jangan menulis diagnosis" untuk cuti Sakit |
| C5 | PATCH cuti tidak cek ulang status personel | PATCH menolak personel yang tidak lagi Aktif/MPP (409 `personel_tidak_aktif`) |
| C7 | `extra` badan galat bebas | Hanya kunci daftar putih (`id`) |

Tidak diubah (keputusan sadar, dicatat): `proses` tidak mengisi `updated_by`, jadi Kasubbag yang memproses tetap
boleh memutus (pola R5H28); jenis cuti (termasuk Sakit) tampil di kalender/daftar (K18); lampiran kesejahteraan
terbuka untuk semua pembaca Sumda — **ditanyakan saat paparan**; pembedaan 403/404 lampiran Sakit.

Uji baru: verify §7b (S2 termasuk id huruf besar, S3 detail/daftar/riwayat/PATCH, C5) + S1 di §4; x5 (S2, S3). Uji
mutasi: hapus syarat "pernah mengubah" → hanya x5 merah; buka penyamaran catatan Sakit → hanya x5 merah. Suite 26/26.
