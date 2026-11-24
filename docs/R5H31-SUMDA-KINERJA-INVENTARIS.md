# R5H31 — Subbagsumda: Kinerja & Pembinaan + Inventaris/BMN

Status: **DIIMPLEMENTASI (2026-11-24), branch `feat/r5h31-sumda-kinerja-aset`, belum di-push / belum deploy**. K1–K4 dijawab pemilik 2026-11-24; K5–K30 (usulan) disetujui pemilik 2026-11-24. Rencana Implementasi + K31–K49 disetujui pemilik 2026-11-24. Perbaikan hasil review di bagian akhir.
Khusus Express. Migrasi **072** (R5H15 digeser lagi ke **073**, lihat K30). Commit: f31cc3d migrasi · aa52dce
`pernahMengubahSql` · 7ad96b3 API Kinerja · d7806c7 API Aset · 4522311 skenario x6 · 59fe53d frontend.
Lanjutan R5H27–R5H30: penilaian merujuk `sdl_sumda_personel`; alur persetujuan, maker-checker ("bukan pencatat dan
tidak pernah mengubah", perbaikan review R5H30 S2), validasi, lampiran tersegel, dan prinsip **K43 R5H30** (migrasi hanya
aturan struktural, aturan bisnis di Express) dipakai ulang.

Referensi: modul `performance` dan `assets` di `docs/reference/Subbagsumda.html` (prototipe localStorage).
- **Kinerja & Pembinaan**: personel, periode (mis. "2026 Semester II"), kategori hasil (Baik Sekali/Baik/Cukup/Perlu
  Pembinaan/Belum Dinilai), status Draft/Diproses/Disetujui/Selesai, catatan "bukan data sensitif".
- **Inventaris & BMN**: kode BMN, nama aset, kategori (Komputer/Perangkat Jaringan/Perabot/Elektronik/Kendaraan/Lainnya),
  lokasi umum (non-operasional), kondisi (Baik/Perlu Pemeriksaan/Rusak Ringan/Rusak Berat), jadwal maintenance, status
  Aktif/Pemeliharaan/Usulan Penghapusan/Dihapus, catatan.
- **Tidak** diambil: perubahan status bebas tanpa pembagian peran, ekspor CSV, nilai/harga perolehan.

## Kebutuhan (kata pemilik)

> "oke deh, kita lanjut ke menu kinerja & pembinaan, serta bagian inventaris/BMN"

## Kondisi sekarang

- **Kinerja & Pembinaan** belum ada (backend maupun menu).
- **Inventaris & BMN** memakai registry R5B (`sdl_sumda_registry` kind `inventaris`, layar `SumdaR5B`): kategori teks
  bebas, kondisi Baik/Rusak Ringan/Rusak Berat/Lainnya, lokasi, jumlah, penanggung jawab teks, keterangan. Database
  lokal: 1 baris (terhapus). Endpoint registry termasuk 142 endpoint beku (kasus harness 32–37) — **tidak diubah**.
- Menu **Pemeliharaan Logistik** hanya placeholder (tanpa backend).
- `subbagsumda.inventaris.read` sudah ada (003) dan dipegang op, staf, Kasubbagsumda, Kabagrenmin. Tidak ada permission
  kinerja Sumda.
- `/api/v1/subbagsumda/*` sudah dilayani Express di produksi.

## Keputusan

| # | Hal | Keputusan | Sumber |
|---|---|---|---|
| K1 | Akses hasil kinerja | **Kasubbagsumda + Kabagrenmin + pencatat penilaian itu** membaca kategori, catatan, tindak lanjut, dan lampiran. Pembaca Sumda lain hanya melihat bahwa personel sudah/belum dinilai pada periode itu (status saja, tanpa kategori/catatan) | Pemilik |
| K2 | Alur kinerja | **Penilaian + tindak lanjut.** Petugas mencatat penilaian per periode → Kasubbag menyetujui (maker-checker). Kategori **Perlu Pembinaan** wajib punya rencana tindak lanjut (bentuk pembinaan, tenggat, status) yang dipantau sampai selesai | Pemilik |
| K3 | Inventaris & pemeliharaan | **Inventaris & BMN baru menggantikan registry** (data lama disalin sekali). Pemeliharaan menjadi bagian aset: jadwal + riwayat pemeliharaan per aset, alert jadwal jatuh tempo. **Menu "Pemeliharaan Logistik" dihapus** | Pemilik |
| K4 | Penghapusan BMN | Petugas mengusulkan dengan alasan → **Kasubbagsumda memutus** (bukan pengusul/pengubah). **Dihapus wajib berlampiran SK/berita acara PDF.** Perubahan status lain (Aktif ↔ Pemeliharaan) oleh petugas | Pemilik |
| K5 | Menu | "Kinerja & Pembinaan" (ikon clipboard) setelah Kesejahteraan; "Inventaris & BMN" tetap di tempatnya, "Pemeliharaan Logistik" dihilangkan dari daftar menu | Usulan |
| K6 | Permission kinerja | `subbagsumda.kinerja.manage` (op, staf, Kasubbag), `subbagsumda.kinerja.approve` (Kasubbag), `subbagsumda.kinerja.read` (Kasubbag, Kabagrenmin) — pemegang `read` atau pencatat membaca isi (K1); daftar ringkas memakai `subbagsumda.personel.read` | Usulan |
| K7 | Permission aset | Baca: `subbagsumda.inventaris.read` (sudah ada). Baru: `subbagsumda.aset.manage` (op, staf, Kasubbag), `subbagsumda.aset.approve` (Kasubbag). Permission registry lama tidak diubah | Usulan |
| K8 | Periode | `tahun` (2000–2100) + `periode` `SEMESTER_I`/`SEMESTER_II`/`TAHUNAN`. Satu penilaian **aktif** (bukan Dibatalkan) per personel per (tahun, periode) — dijaga di Express dengan kunci personel (K43 R5H30) | Usulan |
| K9 | Kategori | `BAIK_SEKALI`, `BAIK`, `CUKUP`, `PERLU_PEMBINAAN`. "Belum dinilai" = belum ada penilaian / masih Draft | Usulan |
| K10 | Status kinerja | Draft → Diajukan → Disetujui → Selesai; Kasubbag dapat **Kembalikan** (alasan ≥ 8 karakter) → Draft; Batalkan (pencatat/approve, alasan) dari Draft/Diajukan. Disetujui non-Perlu-Pembinaan langsung **Selesai**; Perlu Pembinaan tetap Disetujui sampai semua tindak lanjut Selesai/Dibatalkan, lalu petugas menandai Selesai | Usulan |
| K11 | Tindak lanjut | Daftar per penilaian: bentuk (`KONSELING`, `PELATIHAN`, `PENDAMPINGAN`, `TEGURAN`, `LAINNYA`), uraian, tenggat, status Rencana/Berjalan/Selesai/Dibatalkan, hasil. Ditambah/diubah petugas (manage) selama penilaian Diajukan/Disetujui; minimal satu sebelum Disetujui bila Perlu Pembinaan | Usulan |
| K12 | Penilai | Isian teks "pejabat penilai" + tanggal penilaian; bukan akun aplikasi | Usulan |
| K13 | Lampiran kinerja | PDF tersegel (SKP/berita acara), maks. 10; aksesnya sama dengan K1 (diputus di SQL) | Usulan |
| K14 | Personel | Penilaian baru hanya untuk personel Aktif/MPP belum terarsip; personel terarsip → hanya batalkan | Usulan |
| K15 | Alert pembinaan | Tindak lanjut lewat tenggat (belum Selesai/Dibatalkan) ditandai; dashboard: **"Pembinaan lewat tenggat"** (angka saja, tanpa nama, terlihat semua pembaca Sumda) | Usulan |
| K16 | Detail Master Personel | Bagian "Kinerja" (periode + kategori) hanya untuk pembaca K1; lainnya "periode dinilai" tanpa kategori | Usulan |
| K17 | Field aset | `kodeBmn` (unik di antara aset yang belum Dihapus, tidak peka huruf besar), `nama`, `kategori` (6 pilihan referensi), `merekTipe`, `tahunPerolehan`, `jumlah` (≥ 1), `satuan`, `lokasi` (umum, non-operasional), `kondisi`, `penanggungJawabId` (opsional, dari Master Personel) atau teks, `jadwalPemeliharaan`, `catatan` | Usulan |
| K18 | Status aset | Aktif ↔ Pemeliharaan (petugas); Aktif/Pemeliharaan → **Usulan Penghapusan** (alasan) → Kasubbag **Setujui** (→ Dihapus, wajib ≥ 1 lampiran) / **Tolak** (→ status sebelumnya). Dihapus final dan hanya-baca | Usulan |
| K19 | Riwayat pemeliharaan | Entri per aset: tanggal, jenis (`RUTIN`, `PERBAIKAN`, `PEMERIKSAAN`), uraian, pelaksana (teks), kondisi sesudahnya, jadwal berikutnya. Menyimpan entri memperbarui kondisi dan jadwal aset dalam transaksi yang sama. Entri tidak bisa diubah; salah catat → entri koreksi | Usulan |
| K20 | Alert pemeliharaan | Tahap dari `jadwalPemeliharaan` (WIB): **H-14** (1–14 hari), **Jatuh tempo** (hari ini/terlewat); aset Dihapus/Usulan Penghapusan tidak masuk. Dashboard: "Pemeliharaan jatuh tempo ≤ 14 hari" | Usulan |
| K21 | Salinan registry | Sekali di migrasi: `kind='inventaris'` aktif → aset Aktif; kategori teks dipetakan ke pilihan bila cocok, selain itu `Lainnya` + teks asli di catatan; kondisi `Lainnya` → `Perlu Pemeriksaan`; jumlah bukan bilangan → 1 + catatan; penanggung jawab teks; ditandai salinan (pola R5H27/R5H29). Registry lama tidak dihapus | Usulan |
| K22 | Lampiran aset | PDF tersegel, maks. 10 per aset (SK, BA, faktur); unggah selama belum Dihapus; hapus oleh pengunggah atau approve | Usulan |
| K23 | Foto aset | Di luar cakupan (hanya PDF) | Usulan |
| K24 | Hak baca aset | Semua pemegang `subbagsumda.inventaris.read` (scope apa pun) — tidak ada data pribadi | Usulan |
| K25 | Klasifikasi | Tidak dipakai (semua *biasa*) | Usulan |
| K26 | Audit | Daftar putih `{jenis, status, fields, version}`; **tanpa kategori kinerja**, nama, NRP, catatan | Usulan |
| K27 | Menu lama saat rollback | Inventaris: tombol darurat registry lama (pola R5H27/R5H29 K35). Kinerja: "tidak tersedia" tanpa cadangan | Usulan |
| K28 | Aturan bisnis | Prinsip K43 R5H30: migrasi hanya struktural; aturan bisnis (satu penilaian per periode, minimal tindak lanjut, lampiran wajib saat Dihapus, peta status) di Express | Usulan |
| K29 | Satu rilis | Dua menu dalam satu rilis R5H31 dan satu migrasi (072), dua modul Express (`kinerja.js`, `aset.js`) dan dua irisan kerja | Usulan |
| K30 | Nomor migrasi | R5H31 memakai **072**; R5H15 digeser ke **073** | Usulan |

## Alur

**Kinerja & Pembinaan**

```
            Operator/Staf                 Kasubbagsumda (≠ pencatat/pengubah)
 [catat] → Draft ──ajukan──► Diajukan ──setujui──► Disetujui ──(bukan Perlu Pembinaan)──► Selesai
             ▲                  │                      │
             └──kembalikan──────┘                      └─(Perlu Pembinaan) tindak lanjut ... semua selesai ─► Selesai
   batalkan dari Draft/Diajukan ─► Dibatalkan
```

1. **Daftar** (per tahun/periode): personel, periode, status; kategori hanya untuk pembaca K1. Filter tahun, periode,
   status, kategori (K1), "pembinaan lewat tenggat".
2. **Catat penilaian**: personel (Aktif/MPP), tahun, periode, kategori, pejabat penilai, tanggal penilaian, catatan.
3. **Detail**: data, tindak lanjut (tambah/ubah status), lampiran, riwayat status, tombol sesuai hak.

**Inventaris & BMN**

```
 Aktif ⇄ Pemeliharaan ──usulkan hapus (alasan)──► Usulan Penghapusan ──setujui (lampiran SK/BA wajib)──► Dihapus
                                                         └──tolak──► status sebelumnya
```

1. **Daftar aset**: kode, nama, kategori, lokasi, kondisi, jadwal pemeliharaan (tanda H-14/jatuh tempo), status;
   filter kategori/kondisi/status/lokasi, cari kode/nama; tab **Jadwal pemeliharaan** (alert).
2. **Detail aset**: data, riwayat pemeliharaan (tambah entri), lampiran, riwayat status, tombol status.

## Backend yang melayani

Express saja. `infra/Caddyfile` meneruskan pola `/api/v1/subbagsumda/*` ke Express di produksi, jadi **Caddy tidak
berubah**. Dua mount spesifik baru: `/subbagsumda/kinerja` dan `/subbagsumda/aset` (bukan `/subbagsumda`; registry
`/subbagsumda/registry/*` tetap utuh). Go hanya mendapat migrasi 072 + manifes + seed.

**Rollback** ke Go: `/kinerja*` dan `/aset*` dijawab chi 404 `text/plain`. Inventaris menampilkan tombol darurat
registry lama (K27); Kinerja "tidak tersedia". Tabel 072 diam.

## Endpoint baru

Guard operasional (**O**), validasi strict, `no-store`. Hak: `R` = `subbagsumda.personel.read`, `Rk` =
`subbagsumda.kinerja.read`, `Mk`/`Ak` = `kinerja.manage`/`.approve`, `Ri` = `subbagsumda.inventaris.read`, `Ma`/`Aa` =
`aset.manage`/`.approve`.

| Metode | Path | Hak | Isi |
|---|---|---|---|
| GET | `/kinerja/capabilities` | O | `{canRead,canReadDetail,canManage,canApprove}` |
| GET | `/kinerja` | R | `?q=&tahun=&periode=&status=&kategori=&lewatTenggat=&page=&size=`; `kategori`/`catatan` null bagi selain `Rk`/pencatat (K1); filter `kategori` hanya untuk `Rk` |
| POST | `/kinerja` | Mk | `{personelId,tahun,periode,kategori,penilai,tanggalPenilaian,catatan}` → 201 (Draft) |
| GET | `/kinerja/:id` | R | ringkas untuk semua; `{item,tindakLanjut[],lampiran[],riwayat[]}` lengkap hanya `Rk`/pencatat |
| PATCH | `/kinerja/:id` | Mk | badan penuh + `version`; hanya Draft; `personelId` tidak bisa diubah |
| POST | `/kinerja/:id/aksi` | Mk/Ak | `{aksi:ajukan\|setujui\|kembalikan\|batalkan\|selesai,catatan,version}` |
| POST · PATCH | `/kinerja/:id/tindak-lanjut[/:tid]` | Mk | `{bentuk,uraian,tenggat,status,hasil,version}` |
| POST · GET · DELETE | `/kinerja/:id/lampiran` · `…/:lid` · `…/:lid` | Mk · Rk/pencatat · Mk | PDF tersegel |
| GET | `/aset/capabilities` | O | `{canRead,canManage,canApprove}` |
| GET | `/aset` | Ri | `?q=&kategori=&kondisi=&status=&tahap=&page=&size=` → item membawa `sisaHari`, `tahap` |
| GET | `/aset/jadwal` | Ri | `{ringkas:{H-14,JATUH_TEMPO},items}` (K20) |
| POST | `/aset` | Ma | field K17 → 201 Aktif |
| GET | `/aset/:id` | Ri | `{item,pemeliharaan[],lampiran[],riwayat[]}` |
| PATCH | `/aset/:id` | Ma | badan penuh + `version`; tidak saat Usulan Penghapusan/Dihapus |
| POST | `/aset/:id/aksi` | Ma/Aa | `{aksi:pemeliharaan\|aktifkan\|usulkan_hapus\|setujui_hapus\|tolak_hapus,catatan,version}` |
| POST | `/aset/:id/pemeliharaan` | Ma | `{tanggal,jenis,uraian,pelaksana,kondisi,jadwalBerikutnya,version}` (K19) |
| POST · GET · DELETE | `/aset/:id/lampiran` · `…/:lid` · `…/:lid` | Ma · Ri · Ma | PDF tersegel |
| GET | `/personel/:id` (R5H27) | R | **Aditif**: `kinerja[]` (periode, status; kategori hanya `Rk`) (K16) |
| GET | `/dashboard` (R5H27) | R | **Aditif**: `totals.pembinaanLewatTenggat`, `totals.pemeliharaanJatuhTempo14` |

Kode galat (pola R5H28–R5H30): 400 `invalid_body`/`invalid_input`/`invalid_file_type`/`one_file_required`; 413
`file_too_large`; 403 `access_denied`/`self_review_forbidden`; 404 `not_found`; 409 `version_conflict`/
`status_tidak_sesuai`/`penilaian_ganda`/`tindak_lanjut_wajib`/`tindak_lanjut_terbuka`/`kode_bmn_ganda`/`lampiran_wajib`/
`personel_tidak_aktif`/`personel_terarsip`/`batas_lampiran`; 503 `evidence_*`/`database_unavailable`.

## Migrasi `072_sumda_kinerja_aset.sql`

File baru; manifes `migrate_test.go` + `src/migrations/index.js` dan seed Go + Express di commit yang sama. Hanya aturan
struktural (K28): daftar status/kategori/jenis, rentang tahun, `jumlah ≥ 1`, maker-checker `decided_by <> created_by`,
syarat kolom pemutus, isi lampiran `SDL1`, FK RESTRICT.

- `sdl_sumda_kinerja` (+ `_riwayat`, `_tindak_lanjut`, `_lampiran`).
- `sdl_sumda_aset` (+ `_riwayat`, `_pemeliharaan`, `_lampiran`); `source_registry_id` UNIQUE untuk salinan (K21).
- Indeks unik parsial `lower(kode_bmn)` untuk aset yang belum Dihapus — **struktural** (identitas BMN), bukan aturan
  bisnis yang mungkin berubah; dibahas di `/rencana`.
- Permission K6/K7 + role_permissions (pola 069–071); Kabagrenmin mendapat `subbagsumda.kinerja.read`.
- Salinan sekali registry `kind='inventaris'` (K21) dengan SQL defensif (pola 070) + audit sumber.
- Checker substring (tanpa `UPDATE␠`/`DELETE FROM`/`;`/`--` di literal); gladi dari `pg_dump` sebelum commit.

## Otorisasi

Bukan Engine A/B. Sama dengan R5H27–R5H30: guard `AuthorizeOperational`, lalu `PERMIT_SQL` (`umum.js`) — grant aktif
unit `subbagsumda` + permission role, diputus di SQL. Scope/klasifikasi tidak menyaring baris (K24/K25). Tambahan:
- **Kinerja K1 diputus di SQL**: kategori, catatan, penilai, tindak lanjut, dan lampiran dikembalikan hanya bila
  `$canReadDetail OR created_by = $actor`; selain itu NULL / 403 (pola R5H30 S3). Audit tanpa kategori (K26).
- **Maker-checker**: setujui/kembalikan (kinerja) dan setujui/tolak hapus (aset) oleh approve yang bukan pencatat/
  pengusul dan **tidak pernah mengubah** (`pernahMengubahSql`, R5H30 S2) + CHECK DB.
- **Dihapus** wajib ≥ 1 lampiran, dicek dalam transaksi persetujuan (K4).

## Rencana uji

**`verify/r5h31-sumda-kinerja-aset.js`**: hak & capabilities; K1 (staf/pembaca lain tidak menerima kategori/catatan/
tindak lanjut/lampiran di daftar, detail, detail personel; pencatat & Kasubbag & Kabag menerima); alur kinerja +
kembalikan + maker-checker; Perlu Pembinaan tanpa tindak lanjut → 409; Selesai hanya bila tindak lanjut tuntas;
satu penilaian per periode + balapan; alert tenggat & dashboard (WIB); aset CRUD + kode BMN ganda; Aktif ↔
Pemeliharaan; usulan hapus → tolak/setujui (tanpa lampiran 409; dengan lampiran → Dihapus, hanya-baca); entri
pemeliharaan memperbarui kondisi/jadwal; tahap H-14/jatuh tempo (WIB); salinan registry (gladi); lampiran (byte-identik,
SDL1, terenkripsi 400, id silang 404, kinerja dibatasi); audit tanpa PII/kategori; aditif R5H27; regresi R5H27–R5H30.

**Skenario `x6_r5h31_sumda_kinerja_aset_guard`**: guard + Superadmin (demo), capabilities unit lain, matriks, **K1
dibatasi** (uji mutasi: buka penyamaran → hanya x6 merah), maker-checker, CSRF/Origin + multipart, id silang
antar-modul, bentuk, pencabutan, kunci evidence kosong. Suite Express **27/27**.

**Harness golden:** endpoint baru tidak direkam; 127/128 berubah (permission 072) → rekam ulang pemilik; registry
32–37 harus tetap cocok (salinan tidak mengubah registry).

## Di luar cakupan

- Pengisian SKP/e-Kinerja sesungguhnya, perhitungan nilai, integrasi sistem kinerja Polri/BKN.
- Personel menilai diri sendiri / akun personel.
- Nilai/harga perolehan BMN, penyusutan, SIMAK-BMN, label QR/barcode, foto aset.
- Peminjaman/mutasi aset antar-unit, stok opname.
- Email/notifikasi browser.
- Menu Persuratan & Arsip Sumda, Laporan & Analitik.
- Perubahan endpoint registry R5B (142 beku) dan backend Go selain migrasi + seed.

## Rencana Implementasi

> Disusun 2026-11-24 dari kode di `main` (a4aa35a, sudah memuat R5H27–R5H30), sebelum kode ditulis. K1–K30 sudah disetujui;
> K31–K49 (§9) disetujui pemilik 2026-11-24. Klaim dokumen rilis sudah dicocokkan dengan kode. Koreksinya ada di
> "Temuan yang mengoreksi dokumen rilis". "K43 R5H30" selalu berarti keputusan R5H30, bukan nomor di dokumen ini.

### 1. Backend: Express saja (ditambah migrasi 072, manifes, dan seed Go)

- Caddy meneruskan `@express path {$SDL_EXPRESS_PATHS}` ke `api-express:8080` (`infra/Caddyfile:39-42`). Pola
  `/api/v1/subbagsumda/*` sudah mencakup `/kinerja*` dan `/aset*`, jadi **Caddyfile tidak berubah**. Caddy tidak memasang
  batas `request_body`, sehingga PDF 5 MB sampai utuh (sama dengan R5H28–R5H30).
- Go tidak mendapat endpoint baru. Yang berubah di Go hanya:
  - `072_sumda_kinerja_aset.sql`. Berkas ini ter-embed, jadi image `api` harus di-rebuild.
  - Manifes `migrate_test.go:83`.
  - Permission di `cmd/seed-bagrenmin/main.go:55-57,61`.
- Pola yang diikuti:
  - `cuti.js`: penyamaran di SQL lewat `kolom(actor, approver)`, kunci personel `FOR NO KEY UPDATE`, dan
    maker-checker dengan `pernahMengubahSql`.
  - `kesejahteraan.js` untuk alur status, `lampiran.js` (`bacaPdf`/`bukaPdf`/`pasangHeaderUnduh`), dan `kompetensi.js`
    untuk rumus tahap WIB yang hanya satu.
  - `umum.js`: `PERMIT_SQL`, `teks`, `tanggal`, `HARI_INI`/`hariDari`, `makeHandle`, `HttpError` dengan `extra`
    daftar putih.
- Registry R5B (`unitwork/sumda.js`, `registry-crud.js`) **tidak disentuh**.
- Deploy: migrasi dijalankan sebelum `up`. Image Go baru menolak start bila 072 belum ada. Image lama tetap bisa start di
  DB yang sudah ber-072.

### 2. Dampak kontrak API

- **142 endpoint beku tidak disentuh.** Ini mencakup registry R5B (harness 32–37), `/registry/ranks`, `/opsi-dropdown`,
  dan `GET /executive/v2/*`. Salinan K21 hanya **membaca** `sdl_sumda_registry`.
- Dua mount spesifik ditambahkan setelah `src/app.js:122`. `config` dibutuhkan untuk `evidenceKey`. `/capabilities` dan
  `/jadwal` didaftarkan sebelum `/:id`.
  ```js
  v1.use('/subbagsumda/kinerja', operational, createSumdaKinerjaRouter({ pool, config }))
  v1.use('/subbagsumda/aset', operational, createSumdaAsetRouter({ pool, config }))
  ```
- **Penambahan pada endpoint R5H27** (Express-only). Field baru dihitung hanya di route GET, bukan di `ambil()`, supaya
  respons POST/PATCH personel tidak berubah.
  - `GET /personel/:id` (`personel.js:201-224`) mendapat `item.kinerja[]`
    `{id,tahun,periode,statusRingkas,status,kategori,dibatasi}`. Isinya maks. 50, terbaru di atas, tanpa Dibatalkan.
    Bagi pembaca non-K1, `status`/`kategori` bernilai `null` dan hanya entri `DINILAI` yang muncul (K16/K31).
    `personel.js` menghitung `bolehDetail` dengan `can(actor,'subbagsumda.kinerja.read')` lalu meneruskannya sebagai
    parameter SQL.
  - `GET /dashboard` (`personel.js:395-403`) mendapat `totals.pembinaanLewatTenggat` (K15/K33) dan
    `totals.pemeliharaanJatuhTempo14` (K20). Angka kedua `null` bagi akun tanpa `inventaris.read` (K47).
  - `personel.js` mengimpor `kinerjaPersonel`, `PEMBINAAN_LEWAT_TENGGAT_SQL`, dan `PEMELIHARAAN_14_SQL`. `kinerja.js` dan
    `aset.js` **tidak boleh** mengimpor `personel.js` karena akan membuat siklus impor (R5H29 temuan 7).
- **Bentuk galat:** 409 `penilaian_ganda` membawa `{error,id}` lewat kunci daftar putih `id` yang sudah ada
  (`umum.js:49`). Tidak ada kunci baru.
- **`API-CONTRACT.md`:** tambahkan bagian `## R5H31 …` setelah `:1855` dengan format § R5H30:
  - tabel endpoint dan notasi hak
  - kode galat
  - audit
  - penyamaran K1
  - penambahan pada R5H27
  - rollback

  Tambahkan juga rujukan silang di baris R5H27 `GET /personel/:id` dan `/dashboard`. Rollback sempit § R5H30
  (`:1851-1855`) ditandai **"Usang sejak R5H31"**, sama seperti `:1697`, `:1742`, dan `:1798`.

### 3. Rollback ke Go

| Yang di-rollback | Akibat |
|---|---|
| `/api/v1/subbagsumda/*` dicabut dari `SDL_EXPRESS_PATHS` + `--force-recreate caddy` (`admin off`) | `/kinerja*` dan `/aset*` dijawab chi 404 `text/plain`. Personel, dashboard, karier, diklat, cuti, dan kesejahteraan juga 404 (sudah ditangani). Registry kembali dilayani Go |
| Frontend: Inventaris & BMN | `makeApi` (`SumdaBersama.tsx:25`) mendeteksi 404 non-JSON di `/aset/capabilities`. Layar menampilkan "Inventaris & BMN tidak tersedia" + **tombol darurat registry lama** (`SumdaR5B kind="inventaris"`, K27, pola R5H29 K35) dengan spanduk "Data registry lama, sebelum R5H31; perubahan di sini tidak masuk Inventaris & BMN" |
| Frontend: Kinerja & Pembinaan | "Kinerja & Pembinaan tidak tersedia", **tanpa cadangan** (tidak ada padanan lama) |
| Alamat lama `/subbagsumda/pemeliharaan` | Modul tidak ada lagi, jadi `chosenModule` kosong dan halaman jatuh ke dashboard Sumda (`App.tsx:627`), sama seperti `/pendidikan` di R5H29. Tidak ada backend yang dirujuk |
| Rollback sempit (pola baru, menggantikan § R5H30) | `/api/v1/subbagsumda/personel* /api/v1/subbagsumda/pensiun/* /api/v1/subbagsumda/dashboard /api/v1/subbagsumda/karier* /api/v1/subbagsumda/diklat* /api/v1/subbagsumda/kompetensi* /api/v1/subbagsumda/cuti* /api/v1/subbagsumda/kesejahteraan* /api/v1/subbagsumda/kinerja* /api/v1/subbagsumda/aset* /api/v1/subbagsumda/opsi-dropdown/*`. Registry tetap di Go, jadi tombol darurat juga berfungsi di rollback sempit |
| Data dan skema | Tabel 072 diam, tanpa dual-write, dan skema tidak perlu dibalik. **Data yang ditulis ke registry selama rollback tidak disalin** (K21 hanya sekali) dan harus dimasukkan ulang secara manual. Bila kodenya bentrok, hasilnya 409 `kode_bmn_ganda` |
| Executive v2 `assets_care` | Tetap menghitung registry di kedua backend (Temuan 7) |

### 4. Migrasi `072_sumda_kinerja_aset.sql`

- Migrasi terakhir saat ini adalah 071 (`migrate_test.go:83`, `src/migrations/index.js:122`).
- R5H15 menjadi **073** (K30): ubah `docs/R5H15-RIWAYAT-VERSI-DOKUMEN.md:12,106,169`.
- `MIGRATION-PLAN.md:16` menjadi "049–072", ditambah R5H31.
- Hanya aturan struktural yang masuk migrasi (K28, prinsip K43 R5H30). Aturan bisnis ada di §5.

```sql
-- R5H31 (2026-11-24): Subbagsumda Kinerja & Pembinaan + Inventaris & BMN. Express saja.
-- Hak lewat permission pada grant unit 'subbagsumda' (pola 068-071); scope TIDAK menyaring baris (K24/K25).
-- Prinsip K43 R5H30: hanya aturan STRUKTURAL. Satu penilaian per periode (K8), tindak lanjut minimal, lampiran
-- wajib saat Dihapus, dan peta status ditegakkan di Express dengan kunci baris.

CREATE TABLE sdl_sumda_kinerja (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 tahun SMALLINT NOT NULL CHECK (tahun BETWEEN 2000 AND 2100),
 periode VARCHAR(12) NOT NULL CHECK (periode IN ('SEMESTER_I','SEMESTER_II','TAHUNAN')),
 kategori VARCHAR(16) NOT NULL CHECK (kategori IN ('BAIK_SEKALI','BAIK','CUKUP','PERLU_PEMBINAAN')),
 penilai VARCHAR(200) NOT NULL DEFAULT '',
 tanggal_penilaian DATE,
 catatan VARCHAR(2000) NOT NULL DEFAULT '',
 status VARCHAR(12) NOT NULL DEFAULT 'Draft'
   CHECK (status IN ('Draft','Diajukan','Disetujui','Selesai','Dibatalkan')),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_at TIMESTAMPTZ,
 selesai_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 selesai_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_kinerja_pemutus CHECK ((decided_by IS NULL) = (decided_at IS NULL)
   AND (decided_by IS NULL OR decided_by <> created_by)),
 CONSTRAINT sdl_sumda_kinerja_diputus CHECK (status NOT IN ('Disetujui','Selesai') OR decided_by IS NOT NULL),
 CONSTRAINT sdl_sumda_kinerja_selesai CHECK (status <> 'Selesai' OR (selesai_by IS NOT NULL AND selesai_at IS NOT NULL))
);
CREATE INDEX sdl_sumda_kinerja_personel_idx ON sdl_sumda_kinerja(personel_id, tahun, periode) WHERE status <> 'Dibatalkan';
CREATE INDEX sdl_sumda_kinerja_daftar_idx ON sdl_sumda_kinerja(tahun DESC, periode, status);

CREATE TABLE sdl_sumda_kinerja_tindak_lanjut (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kinerja_id UUID NOT NULL REFERENCES sdl_sumda_kinerja(id) ON DELETE RESTRICT,
 bentuk VARCHAR(16) NOT NULL CHECK (bentuk IN ('KONSELING','PELATIHAN','PENDAMPINGAN','TEGURAN','LAINNYA')),
 uraian VARCHAR(1000) NOT NULL,
 tenggat DATE,                                   -- wajib di Express (K38), bukan di DB
 status VARCHAR(12) NOT NULL DEFAULT 'Rencana' CHECK (status IN ('Rencana','Berjalan','Selesai','Dibatalkan')),
 hasil VARCHAR(1000) NOT NULL DEFAULT '',
 selesai_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_kinerja_tl_selesai CHECK (status <> 'Selesai' OR selesai_at IS NOT NULL)
);
CREATE INDEX sdl_sumda_kinerja_tl_idx ON sdl_sumda_kinerja_tindak_lanjut(kinerja_id, created_at);
CREATE INDEX sdl_sumda_kinerja_tl_tenggat_idx ON sdl_sumda_kinerja_tindak_lanjut(tenggat) WHERE status IN ('Rencana','Berjalan');

-- sdl_sumda_kinerja_riwayat (kinerja_id CASCADE, dari/ke = 5 status kinerja) dan sdl_sumda_kinerja_lampiran
-- (kinerja_id RESTRICT, SDL1, 1..5242880): bentuk identik dengan tabel cuti di 071.

CREATE TABLE sdl_sumda_aset (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kode_bmn VARCHAR(64) NOT NULL CHECK (length(btrim(kode_bmn)) BETWEEN 2 AND 64),
 nama VARCHAR(200) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 200),
 kategori VARCHAR(20) NOT NULL
   CHECK (kategori IN ('Komputer','Perangkat Jaringan','Perabot','Elektronik','Kendaraan','Lainnya')),
 merek_tipe VARCHAR(200) NOT NULL DEFAULT '',
 tahun_perolehan SMALLINT CHECK (tahun_perolehan BETWEEN 1900 AND 2100),
 jumlah INTEGER NOT NULL CHECK (jumlah >= 1),
 satuan VARCHAR(32) NOT NULL DEFAULT '',
 lokasi VARCHAR(200) NOT NULL DEFAULT '',
 kondisi VARCHAR(20) NOT NULL CHECK (kondisi IN ('Baik','Perlu Pemeriksaan','Rusak Ringan','Rusak Berat')),
 penanggung_jawab_id UUID REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 penanggung_jawab_teks VARCHAR(200) NOT NULL DEFAULT '',
 jadwal_pemeliharaan DATE,
 status VARCHAR(20) NOT NULL DEFAULT 'Aktif'
   CHECK (status IN ('Aktif','Pemeliharaan','Usulan Penghapusan','Dihapus')),
 status_sebelum VARCHAR(12) CHECK (status_sebelum IN ('Aktif','Pemeliharaan')),
 usulan_alasan VARCHAR(1000) NOT NULL DEFAULT '',
 usulan_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 usulan_at TIMESTAMPTZ,
 decided_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_at TIMESTAMPTZ,
 catatan VARCHAR(2000) NOT NULL DEFAULT '',
 source_registry_id UUID UNIQUE,                 -- TANPA FK: harness mengosongkan registry (TRUNCATE CASCADE)
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_aset_pj CHECK (penanggung_jawab_id IS NULL OR penanggung_jawab_teks = ''),
 CONSTRAINT sdl_sumda_aset_usulan CHECK (status NOT IN ('Usulan Penghapusan','Dihapus')
   OR (status_sebelum IS NOT NULL AND usulan_by IS NOT NULL AND usulan_at IS NOT NULL)),
 -- Maker-checker (K4): pemutus bukan pengusul. Aset berumur panjang, jadi pembandingnya usulan_by, bukan created_by.
 CONSTRAINT sdl_sumda_aset_pemutus CHECK ((decided_by IS NULL) = (decided_at IS NULL)
   AND (decided_by IS NULL OR decided_by <> usulan_by)),
 CONSTRAINT sdl_sumda_aset_dihapus CHECK ((status = 'Dihapus') = (decided_by IS NOT NULL))
);
-- K17/K43: identitas BMN unik tanpa peka huruf di antara aset yang belum Dihapus (struktural, lihat bawah).
CREATE UNIQUE INDEX sdl_sumda_aset_kode_uq ON sdl_sumda_aset(lower(kode_bmn)) WHERE status <> 'Dihapus';
CREATE INDEX sdl_sumda_aset_daftar_idx ON sdl_sumda_aset(status, kategori, lower(nama));
CREATE INDEX sdl_sumda_aset_jadwal_idx ON sdl_sumda_aset(jadwal_pemeliharaan) WHERE status IN ('Aktif','Pemeliharaan');
CREATE INDEX sdl_sumda_aset_pj_idx ON sdl_sumda_aset(penanggung_jawab_id) WHERE penanggung_jawab_id IS NOT NULL;

CREATE TABLE sdl_sumda_aset_pemeliharaan (   -- append-only oleh aplikasi (K19); tanpa updated_*
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 aset_id UUID NOT NULL REFERENCES sdl_sumda_aset(id) ON DELETE RESTRICT,
 tanggal DATE NOT NULL,
 jenis VARCHAR(12) NOT NULL CHECK (jenis IN ('RUTIN','PERBAIKAN','PEMERIKSAAN')),
 uraian VARCHAR(1000) NOT NULL,
 pelaksana VARCHAR(200) NOT NULL DEFAULT '',
 kondisi VARCHAR(20) NOT NULL CHECK (kondisi IN ('Baik','Perlu Pemeriksaan','Rusak Ringan','Rusak Berat')),
 jadwal_berikutnya DATE,
 koreksi_dari UUID,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_aset_pemeliharaan_aset_uq UNIQUE (id, aset_id),
 -- Entri koreksi hanya boleh merujuk entri aset yang sama (pola FK komposit 070).
 CONSTRAINT sdl_sumda_aset_pemeliharaan_koreksi_fk FOREIGN KEY (koreksi_dari, aset_id)
   REFERENCES sdl_sumda_aset_pemeliharaan(id, aset_id) ON DELETE RESTRICT
);
CREATE INDEX sdl_sumda_aset_pemeliharaan_idx ON sdl_sumda_aset_pemeliharaan(aset_id, tanggal DESC, created_at DESC);

-- sdl_sumda_aset_riwayat (aset_id CASCADE, dari/ke = 4 status aset) dan sdl_sumda_aset_lampiran (aset_id RESTRICT,
-- SDL1, 1..5242880, uploaded_by/at): bentuk identik dengan tabel cuti di 071.

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.kinerja.read', 'Lihat isi penilaian kinerja dan pembinaan personel Subbagsumda'),
 ('subbagsumda.kinerja.manage', 'Catat penilaian kinerja dan tindak lanjut pembinaan Subbagsumda'),
 ('subbagsumda.kinerja.approve', 'Setujui atau kembalikan penilaian kinerja Subbagsumda'),
 ('subbagsumda.aset.manage', 'Catat dan kelola inventaris dan BMN Subbagsumda'),
 ('subbagsumda.aset.approve', 'Putuskan usulan penghapusan BMN Subbagsumda')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda','subbagsumda.kinerja.manage'), ('br_staf_subbagsumda','subbagsumda.kinerja.manage'),
    ('br_kasubbagsumda','subbagsumda.kinerja.manage'), ('br_kasubbagsumda','subbagsumda.kinerja.approve'),
    ('br_kasubbagsumda','subbagsumda.kinerja.read'), ('br_kabagrenmin','subbagsumda.kinerja.read'),
    ('br_op_subbagsumda','subbagsumda.aset.manage'), ('br_staf_subbagsumda','subbagsumda.aset.manage'),
    ('br_kasubbagsumda','subbagsumda.aset.manage'), ('br_kasubbagsumda','subbagsumda.aset.approve')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- Salinan sekali K21/K44 dari registry inventaris yang aktif (termasuk 'penting', preseden 068/070).
-- Tidak ada cast yang bisa gagal: jumlah hanya di-cast bila cocok 1-9 digit tanpa nol depan (< 2^31).
-- Kode ganda setelah btrim (hanya mungkin lewat SQL langsung, karena indeks registry memakai lower(ref_code)
-- tanpa btrim) diberi akhiran ~n. ON CONFLICT hanya pada source_registry_id, jadi bentrok kode tetap gagal keras.
WITH src AS (
  SELECT s.id, s.ref_code, btrim(s.ref_code) AS kode0, left(btrim(s.title), 200) AS nama,
         btrim(coalesce(s.fields->>'kategori', '')) AS kategori_lama,
         btrim(coalesce(s.fields->>'kondisi', '')) AS kondisi_lama,
         left(btrim(coalesce(s.fields->>'lokasi', '')), 200) AS lokasi,
         btrim(coalesce(s.fields->>'jumlah', '')) AS jumlah_lama,
         left(btrim(coalesce(s.fields->>'penanggungJawab', '')), 200) AS pj,
         btrim(coalesce(s.fields->>'keterangan', '')) AS keterangan,
         s.created_by, s.updated_by, s.created_at,
         row_number() OVER (PARTITION BY lower(btrim(s.ref_code)) ORDER BY s.created_at, s.id) AS rn
    FROM sdl_sumda_registry s
    JOIN sdl_unit_work_records w ON w.id = s.work_record_id
   WHERE s.kind = 'inventaris' AND s.deleted_at IS NULL
     AND w.deleted_at IS NULL AND w.unit_key = 'subbagsumda'
), norm AS (
  SELECT src.*, k.nama AS kategori, d.nama AS kondisi,
         CASE WHEN src.jumlah_lama ~ '^[1-9][0-9]{0,8}$' THEN src.jumlah_lama::int END AS jumlah,
         CASE WHEN src.rn = 1 THEN src.kode0 ELSE left(src.kode0, 60) || '~' || src.rn END AS kode
    FROM src
    LEFT JOIN (VALUES ('Komputer'), ('Perangkat Jaringan'), ('Perabot'), ('Elektronik'), ('Kendaraan'), ('Lainnya')) AS k(nama)
      ON lower(k.nama) = lower(src.kategori_lama)
    LEFT JOIN (VALUES ('Baik'), ('Perlu Pemeriksaan'), ('Rusak Ringan'), ('Rusak Berat')) AS d(nama)
      ON lower(d.nama) = lower(src.kondisi_lama)
), ins AS (
  INSERT INTO sdl_sumda_aset(kode_bmn, nama, kategori, jumlah, satuan, lokasi, kondisi, penanggung_jawab_teks,
                             status, catatan, source_registry_id, created_by, updated_by, created_at)
  SELECT n.kode, n.nama, coalesce(n.kategori, 'Lainnya'), coalesce(n.jumlah, 1), 'unit', n.lokasi,
         coalesce(n.kondisi, 'Perlu Pemeriksaan'), n.pj, 'Aktif',
         left(concat_ws(E'\n',
              nullif(n.keterangan, ''),
              CASE WHEN n.rn > 1 THEN 'Kode lama ganda: ' || n.ref_code END,
              CASE WHEN n.kategori IS NULL AND n.kategori_lama <> '' THEN 'Kategori lama: ' || n.kategori_lama END,
              CASE WHEN n.kondisi IS NULL THEN CASE WHEN n.kondisi_lama = '' THEN 'Kondisi lama tidak tercatat'
                                                    ELSE 'Kondisi lama: ' || n.kondisi_lama END END,
              CASE WHEN n.jumlah IS NULL THEN CASE WHEN n.jumlah_lama = '' THEN 'Jumlah lama tidak tercatat'
                                                   ELSE 'Jumlah lama: ' || n.jumlah_lama END END), 2000),
         n.id, n.created_by, n.updated_by, n.created_at
    FROM norm n
  ON CONFLICT (source_registry_id) DO NOTHING
  RETURNING id, created_by
), rw AS (
  INSERT INTO sdl_sumda_aset_riwayat(aset_id, dari, ke, catatan, oleh)
  SELECT id, NULL, 'Aktif', 'Disalin dari registry lama', created_by FROM ins
  RETURNING 1
)
INSERT INTO sdl_audit_events(actor_id, event_key, subject_type, subject_id, metadata)
SELECT NULL, 'subbagsumda.aset.salin_registry', 'subbagsumda.aset', '072',
       jsonb_build_object('sumber', (SELECT count(*) FROM src), 'disalin', (SELECT count(*) FROM ins),
                          'riwayat', (SELECT count(*) FROM rw))
 WHERE (SELECT count(*) FROM src) > 0;
```

**Kenapa indeks unik kode BMN dibuat di DB (berbeda dengan K16 R5H30 yang dipindah ke kode):**
- Kode BMN adalah identitas barang, bukan alur bisnis yang masih akan dipaparkan. K17 sudah disetujui.
- Indeks ini bebas balapan tanpa kunci tambahan. `makeHandle({ sdl_sumda_aset_kode_uq: 'kode_bmn_ganda' })` memetakan
  23505 ke 409.
- Bila kelak pemilik memutuskan kode boleh ganda, cukup migrasi baru dengan `DROP INDEX`. Perintah itu tidak ada di daftar
  terlarang `migrate_test.go:146-150`, jadi tidak perlu pengecualian pemeriksa.
- Indeks memakai `lower(kode_bmn)` tanpa `btrim` karena Express selalu men-trim. Kode yang dipakai aset Dihapus boleh
  dipakai lagi (K17).

**Lolos pemeriksa substring** (`migrate_test.go:108-153`):
- `updated_*` tidak cocok dengan `UPDATE␠`, `ON DELETE …` tidak cocok dengan `DELETE FROM`, dan tidak ada `ALTER TABLE`.
- Tidak ada `;` atau `--` di dalam literal. `E'\n'`, `'~'`, dan regex `'^[1-9][0-9]{0,8}$'` aman.
- Deskripsi permission tidak memuat kata "update". `FOR … UPDATE` hanya ada di Express, tidak di migrasi.

**Lampiran RESTRICT** (pelajaran R5H29): verify membersihkan lampiran lebih dulu. Riwayat memakai CASCADE ke induk.

**Seed:** lima permission ditambahkan secara identik ke `cmd/seed-bagrenmin/main.go:55-57,61` dan
`src/cli/seed-bagrenmin.js:61-63,67`. `br_kabagrenmin` **mendapat `subbagsumda.kinerja.read`**, tanpa manage atau
approve. Seed menolak permission yang belum ada (`main.go:210-218`). DB produksi mendapat permission lewat INSERT di
migrasi.

**Gladi** (072 tidak bisa diperbaiki setelah commit). DB lokal hanya punya 1 baris registry inventaris yang sudah
terhapus, jadi salinannya 0 baris dan **fixture wajib**:
1. `pg_dump -Fc` DB lokal.
2. Siapkan fixture lewat SQL langsung. Ini termasuk baris yang tidak mungkin dibuat lewat API:
   - kategori: `" komputer "`, `Peralatan kantor`, kosong
   - kondisi: `Baik`, `rusak berat`, `Lainnya`, `Tidak layak` (nama kustom Master Data), kosong
   - jumlah: `3`, kosong, `abc`, `0`, `007`, `99999999`, `1234567890`
   - klasifikasi `penting`
   - work record terhapus, registry terhapus, unit lain
   - `ref_code` `A1` dan `" A1"` (ganda setelah btrim)
   - `title` 200 karakter, `keterangan` 200 karakter
3. Jalankan `--migrate` Express, start Go, `go test ./internal/migrations/`, dan diff seed.
4. Cek invarian salinan: jumlah sumber = disalin = riwayat, isi catatan, dan akhiran `~2`.
5. Uji CHECK manual:
   - `decided_by = usulan_by`
   - Dihapus tanpa `decided_by`, Usulan tanpa `status_sebelum`
   - PJ id + teks sekaligus, `jumlah = 0`
   - kode ganda (beda huruf besar), dan kode ganda dengan aset Dihapus (boleh)
   - `koreksi_dari` dari aset lain (FK komposit)
   - kinerja `decided_by = created_by`, Selesai tanpa `selesai_by`
   - `body` tanpa `SDL1`
6. Pulihkan dump, **baru commit**.

**Pra-cek produksi** (baca saja, oleh pemilik). Hasilnya informatif. Satu-satunya jalur gagal adalah bentrok kode
(`kode_ganda_btrim` dan `kode_bertilde` — review S3: kode registry yang sudah berakhiran `~n` bisa bentrok dengan
akhiran salinan ganda); harus 0. `penting`/`keterangan_penting` ditunjukkan ke pemilik (review S2, K44):
```sql
SELECT count(*) AS sumber,
       count(*) - count(DISTINCT lower(btrim(s.ref_code))) AS kode_ganda_btrim,
       count(*) FILTER (WHERE lower(btrim(coalesce(s.fields->>'kondisi',''))) NOT IN ('baik','perlu pemeriksaan','rusak ringan','rusak berat')) AS kondisi_dipetakan,
       count(*) FILTER (WHERE btrim(coalesce(s.fields->>'jumlah','')) !~ '^[1-9][0-9]{0,8}$') AS jumlah_dipetakan,
       count(*) FILTER (WHERE s.ref_code LIKE '%~%') AS kode_bertilde,
       count(*) FILTER (WHERE w.classification = 'penting') AS penting,
       count(*) FILTER (WHERE w.classification = 'penting' AND btrim(coalesce(s.fields->>'keterangan','')) <> '') AS keterangan_penting
  FROM sdl_sumda_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id
 WHERE s.kind='inventaris' AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='subbagsumda';
```

Angka CLAUDE.md (oleh pemilik): **123 tabel** dari migrasi (+ `sdl_schema_migrations`), **72 berkas SQL**, suite Express
**27/27**.

### 5. Otorisasi

**Bukan Engine A (access/policy) dan bukan Engine B (`unitwork.permit`).**
- Guard `AuthorizeOperational`, lalu `PERMIT_SQL` (`umum.js:38-47`) lewat `SELECT EXISTS` sebelum query data. Syaratnya:
  grant aktif unit `subbagsumda` (belum kedaluwarsa atau dicabut), role aktif bukan Superadmin, user aktif dengan
  `NOT must_change_password`, dan permission role yang sesuai.
- Scope dan klasifikasi tidak menyaring baris (K24/K25). Penyaringan K1 sepenuhnya di SQL, tidak pernah setelah SELECT.

| Hak | Permission | Role (seed) |
|---|---|---|
| R | `subbagsumda.personel.read` | op, staf, kasubbag, kabagrenmin |
| Rk / Mk / Ak | `subbagsumda.kinerja.read` / `.manage` / `.approve` | kasubbag + kabagrenmin / op, staf, kasubbag / kasubbag |
| Ri | `subbagsumda.inventaris.read` (003, sudah ada) | op, staf, kasubbag, kabagrenmin |
| Ma / Aa | `subbagsumda.aset.manage` / `.approve` | op, staf, kasubbag / kasubbag |

**Kinerja: penyamaran K1 diputus di SQL** (`kinerja.js`, pola `cuti.js:118`):
- `const boleh = (actor, detail) => \`(k.created_by=${actor}::uuid OR ${detail}::boolean)\``. `detail` adalah hasil
  `PERMIT_SQL` untuk Rk yang dikirim sebagai parameter boolean (preseden `karier.js:323`, `cuti.js:133`).
- `kolomKinerja(actor, detail)` adalah **satu-satunya** sumber kolom yang tersamar. Bila `boleh` salah:
  - `kategori`, `catatan`, `penilai`, `tanggal_penilaian`, `status`, `version`, `created_by`, `decided_*`, `selesai_at`,
    dan `updated_at` bernilai `NULL`.
  - `status_ringkas` = `CASE WHEN k.status IN ('Disetujui','Selesai') THEN 'DINILAI' WHEN k.status='Diajukan' THEN
    'DIAJUKAN' ELSE 'BELUM_DINILAI' END`.
  - `dibatasi = NOT boleh`. Alasannya ada di K31: status Disetujui yang bertahan hanya terjadi pada Perlu Pembinaan.
- **Daftar `GET /kinerja`:**
  - CTE `terlihat` menghitung kolom tersamar lebih dulu. **Semua filter, urutan, dan `count(*)` memakai kolom
    `terlihat`**, bukan kolom asli (K32).
  - Filter `kategori` dan `lewatTenggat` hanya cocok pada baris `boleh`.
  - Filter `status` berlaku pada status asli untuk baris `boleh` dan pada `status_ringkas` untuk baris lain.
  - Baris Dibatalkan hanya muncul untuk baris `boleh`. `q` hanya mencari nama dan NRP.
- **`GET /kinerja/:id`:** item tersamar. `tindakLanjut`, `lampiran`, dan `riwayat` diambil dengan
  `JOIN sdl_sumda_kinerja k … WHERE … AND boleh`, jadi bagi non-K1 hasilnya kosong dari SQL. Respons mengirim `null`
  dengan `dibatasi:true`.
- **`kinerjaPersonel(db, personelId, actor, detail)`** (K16) memakai fragmen yang sama. Bagi non-K1 hanya ada baris
  `status_ringkas='DINILAI'`.
- **Unduh lampiran:** `SELECT l.filename,l.sha256,l.body FROM sdl_sumda_kinerja_lampiran l JOIN sdl_sumda_kinerja k ON
  k.id=l.kinerja_id WHERE l.id=$1 AND l.kinerja_id=$2 AND (k.created_by=$3::uuid OR $4::boolean)`. Penilaian dicek lebih
  dulu: ada tetapi tidak `boleh` → 403 sebelum lampiran dicari. Tidak ada atau id silang → 404.
- **Mutasi (K34):** PATCH, `ajukan`, `batalkan`, `selesai`, tindak lanjut, dan lampiran butuh Mk dan
  `WHERE … AND (created_by=$actor OR $rk)`. Gagal → 403 `access_denied`, **sebelum** validasi status atau kategori.
  Dengan begitu 409 `status_tidak_sesuai` (bukan PP) tidak bisa dipakai menebak kategori.
- **Audit** (K26/K48): `subject_type='subbagsumda.kinerja'`, subject = id penilaian (juga untuk event tindak lanjut).
  - Event: `create|update|ajukan|setujui|kembalikan|batalkan|selesai|tindak_lanjut.add|tindak_lanjut.update|lampiran.add|lampiran.delete|lampiran.download`.
  - Metadata daftar putih `{status,fields,version}`, **tanpa `kategori`**. `setujui` **tanpa** `status` hasil.
  - Tidak ada nama, NRP, catatan, atau nama berkas.

| Aksi | Dari | Ke | Hak |
|---|---|---|---|
| `ajukan` | Draft | Diajukan | Mk dan (pencatat atau Rk). Personel belum terarsip |
| `setujui` | Diajukan | PP → Disetujui, lainnya → **Selesai** (`selesai_by` = pemutus) | Ak + Rk, bukan pencatat, **tidak pernah mengubah** (K36). PP tanpa tindak lanjut non-Dibatalkan → 409 `tindak_lanjut_wajib`. Personel terarsip → 409 |
| `kembalikan` | Diajukan | Draft | Ak + Rk, bukan pencatat, tidak pernah mengubah. Alasan ≥ 8. `decided_*` tidak diisi |
| `batalkan` | Draft / Diajukan | Dibatalkan | (Mk dan pencatat) atau Ak. Alasan ≥ 8. Juga untuk personel terarsip (K14) |
| `selesai` | Disetujui (PP) | Selesai | Mk dan (pencatat atau Rk). Semua tindak lanjut Selesai/Dibatalkan, ≥ 1 Selesai (K37), kalau tidak 409 `tindak_lanjut_terbuka` |

- **Maker-checker kinerja:**
  - `UPDATE … WHERE id AND status='Diajukan' AND version=$v AND created_by<>$actor AND NOT ${pernahMengubahSql(
    'subbagsumda.kinerja','$id','$actor',{tambahan:['tindak_lanjut.add','tindak_lanjut.update']})}`.
  - Bila `rowCount=0` setelah status dan versi dicek di bawah kunci, hasilnya 403 `self_review_forbidden`.
  - CHECK `sdl_sumda_kinerja_pemutus` menjadi penahan terakhir.
- **K8 satu penilaian aktif per (personel, tahun, periode):**
  - POST: personel `FOR NO KEY UPDATE` (menolak terarsip dan bukan Aktif/MPP) → `EXISTS(… status<>'Dibatalkan')` → 409
    `penilaian_ganda` `{id}` → INSERT.
  - PATCH: kunci yang sama, ulang cek bila tahun/periode berubah.
  - Diuji balapan di verify.

**Aset:**
- Baca: Ri untuk semua, scope apa pun (K24).
- Mutasi: Ma. Hak diperiksa sebelum validasi isian (review R5H28 S8).

| Aksi | Dari | Ke | Hak |
|---|---|---|---|
| `pemeliharaan` / `aktifkan` | Aktif / Pemeliharaan | Pemeliharaan / Aktif | Ma |
| `usulkan_hapus` | Aktif / Pemeliharaan | Usulan Penghapusan (`status_sebelum`, `usulan_by/at`, `usulan_alasan` ≥ 8) | Ma |
| `setujui_hapus` | Usulan Penghapusan | Dihapus (`decided_by/at`) | Aa, `usulan_by<>$actor`, tidak pernah mengubah **sejak `usulan_at`**, ≥ 1 lampiran yang diunggah sejak `usulan_at`, kalau tidak 409 `lampiran_wajib` (K39) |
| `tolak_hapus` | Usulan Penghapusan | `status_sebelum`. Kolom usulan dikosongkan, alasan ≥ 8 masuk riwayat | Aa, `usulan_by<>$actor`, tidak pernah mengubah sejak usulan |

- Maker-checker aset:
  - Cek lewat `WHERE … AND usulan_by<>$actor AND NOT ${pernahMengubahSql('subbagsumda.aset','$id','$actor',
    {sejak:'$usulanAt'})}`.
  - Cek lampiran wajib: `EXISTS(SELECT 1 FROM sdl_sumda_aset_lampiran WHERE aset_id=$id AND uploaded_at >= usulan_at)`.
  - Keduanya dalam transaksi yang sama, di bawah kunci aset. CHECK `sdl_sumda_aset_pemutus` menjadi penahan terakhir.
- Usulan Penghapusan membekukan aset (K40): PATCH, entri pemeliharaan, dan `pemeliharaan`/`aktifkan` → 409
  `status_tidak_sesuai`. Unggah dan hapus lampiran tetap boleh.
- Dihapus bersifat final (K41): semua mutasi → 409. Unduh dan baca tetap boleh.
- Entri pemeliharaan (K19/K42), dalam satu transaksi: kunci aset `FOR UPDATE` → INSERT entri → `UPDATE sdl_sumda_aset
  SET kondisi, jadwal_pemeliharaan (bila diisi), updated_by, version+1`. Tidak ada route untuk mengubah atau menghapus
  entri.
- Audit `subbagsumda.aset.*`: `create|update|pemeliharaan_status|aktifkan|usulkan_hapus|setujui_hapus|tolak_hapus|
  pemeliharaan.add|lampiran.add|lampiran.delete|lampiran.download`, dengan daftar putih `{status,kondisi,fields,version}`.

**`umum.js` (aditif):** `pernahMengubahSql(type, subject, actor, { tambahan = [], sejak = null } = {})`.
- Tanpa opsi, string SQL yang dihasilkan **identik** dengan sekarang (R5H30 tidak berubah).
- `tambahan` menambah akhiran event, dari daftar konstanta di kode, tidak pernah dari request.
- `sejak` menambah `AND a.created_at >= ${sejak}::timestamptz`.

**Urutan kunci tetap: induk → personel.**

| Jalur | Urutan |
|---|---|
| POST kinerja | personel `FOR NO KEY UPDATE`, lalu INSERT. Tidak mengunci baris kinerja lain (pola POST cuti R5H30) |
| PATCH kinerja | kinerja `FOR UPDATE`, lalu personel `FOR NO KEY UPDATE` |
| Aksi kinerja | kinerja `FOR UPDATE`, lalu personel `FOR SHARE`, lalu baca tindak lanjut |
| Tindak lanjut, lampiran kinerja | kinerja `FOR UPDATE` (versi penilaian naik, `updated_by`), lalu tindak lanjut `FOR UPDATE`, lalu personel `FOR SHARE` |
| POST aset | personel PJ `FOR SHARE`, lalu INSERT |
| PATCH aset | aset `FOR UPDATE`, lalu personel PJ `FOR SHARE` |
| Aksi aset, entri, lampiran aset | aset `FOR UPDATE` saja |

Arsip dan PATCH personel R5H27 hanya mengunci personel, jadi tidak ada siklus.

### 6. Berkas dibuat/diubah

**Express**
- `src/modules/subbagsumda/umum.js`: opsi `tambahan`/`sejak` pada `pernahMengubahSql` (aditif).
- `src/modules/subbagsumda/kinerja.js` (baru):
  - `createSumdaKinerjaRouter`, `PERIODE`, `KATEGORI`, `STATUS_KINERJA`, `BENTUK_TL`, `STATUS_TL`.
  - `kolomKinerja(actor, detail)`, `lewatTenggatSql(alias, hari = HARI_INI)` (satu-satunya rumus K38),
    `PEMBINAAN_LEWAT_TENGGAT_SQL`, `kinerjaPersonel(db, id, actor, detail)`.
  - Route: capabilities, daftar, CRUD, aksi, tindak lanjut, dan lampiran.
  - `handle = makeHandle()`.
- `src/modules/subbagsumda/aset.js` (baru):
  - `createSumdaAsetRouter`, `KATEGORI_ASET`, `KONDISI`, `STATUS_ASET`, `JENIS_PEMELIHARAAN`.
  - `tahapAsetSql(alias, hari = HARI_INI)` (K20: `JATUH_TEMPO` sisa ≤ 0, `H-14` 1–14, hanya Aktif/Pemeliharaan) dan
    `PEMELIHARAAN_14_SQL`.
  - Route: capabilities, daftar, jadwal, CRUD, aksi, pemeliharaan, dan lampiran.
  - `handle = makeHandle({ sdl_sumda_aset_kode_uq: 'kode_bmn_ganda' })`.
- `personel.js`: penambahan di `GET /:id` dan `/dashboard`.
- `src/app.js`: dua mount.
- `src/migrations/index.js:122`, `src/cli/seed-bagrenmin.js:61-63,67`.
- `payload.js` tidak berubah (`SUMDA` 32 KB, `SUMDA_LAMPIRAN`).
- `verify/r5h31-sumda-kinerja-aset.js`, `security/scenarios/r5h31.js`, `security/index.js:73`
  (`x6_r5h31_sumda_kinerja_aset_guard`).

**Go:** `internal/migrations/sql/072_sumda_kinerja_aset.sql`, `internal/migrations/migrate_test.go:83`,
`cmd/seed-bagrenmin/main.go:55-57,61`.

**Frontend**
- `SumdaKinerjaR5H31.tsx/.css` (baru):
  - Daftar dengan filter tahun/periode/status, plus kategori dan lewat tenggat yang hanya tampil bila `canReadDetail`.
  - Baris `dibatasi` menampilkan chip "Dinilai / Diajukan / Belum dinilai" tanpa kolom kategori.
  - Form catat/ubah memakai `CariPersonel statusAktif`.
  - Detail berisi tindak lanjut (tambah/ubah status, penanda lewat tenggat), `LampiranPdf`, riwayat, `AlasanDialog`
    untuk kembalikan/batalkan, dan tombol sesuai caps + pencatat.
  - `?id=` divalidasi dengan UUID. Menerima prop `legacy` kosong, sehingga yang tampil "tidak tersedia".
- `SumdaAsetR5H31.tsx/.css` (baru):
  - Tab Daftar dan Jadwal lewat `effectiveScreen.tab` (alamat `/subbagsumda/inventaris/jadwal`).
  - Form K17 dengan PJ dari personel atau teks.
  - Detail berisi entri pemeliharaan (form + koreksi), `LampiranPdf`, riwayat, dan tombol status.
  - Petunjuk "unggah SK/BA sebelum Kasubbag memutus" saat Usulan.
  - Tautan "Berkas lama (registry)" untuk salinan (K44).
  - Prop `legacy={<SumdaR5B kind="inventaris" …/>}` untuk tombol darurat.
- `SumdaPersonelR5H27.tsx`:
  - `SumdaNav` (`:50`) ditambah `'kinerja' | 'inventaris'`.
  - Tipe `totals` (`:45`) dan `DashboardView` mendapat dua kartu. "Pembinaan lewat tenggat" hanya bisa diklik bila
    `canReadDetail` (K33).
  - `DetailDialog` mendapat bagian "Kinerja".
- `App.tsx`:
  - Modul `{id:'kinerja',title:'Kinerja & Pembinaan',icon:'clipboard',…}` disisipkan setelah `kesejahteraan` (`:161`).
  - Baris `pemeliharaan` (`:163`) dihapus.
  - Cabang render dekat `:609-610`: `kinerja` → `SumdaKinerjaR5H31`, `inventaris` → `SumdaAsetR5H31` dengan legacy.
  - Tidak ada ikon baru. `RouteR5H26.ts` tidak berubah.
- `MasterDataR5G12.tsx:130`: deskripsi "Kondisi Barang" menjadi "Pilihan kondisi pada registry Inventaris lama
  (cadangan)" (K49).

**Docs:**
- dokumen ini
- `API-CONTRACT.md` (§2)
- `MIGRATION-PLAN.md:16`
- `R5H15-…md:12,106,169` (→ 073)
- `R2D5-SECURITY-TESTS.md` (x6, 27/27, uji mutasi)
- catatan sesi

Untuk pemilik: CLAUDE.md (123 / 72 / 27/27) dan memori R5H15 → 073.

### 7. Pengujian

**`verify/r5h31-sumda-kinerja-aset.js`** mengikuti pola `verify/r5h30-…`.
- Personel uji memakai `UJI-R5H31-` dan aset uji memakai `UJI-R5H31-`.
- Pembersihan berurutan: lampiran, entri pemeliharaan, tindak lanjut, riwayat, kinerja/aset, audit, personel.

0. **Rumus WIB** dengan stempel `2026-11-23T17:00:00Z` (= 24 Nov WIB) lewat `hariDari('$1')`:
   - jadwal 24 Nov → `JATUH_TEMPO`; 25 Nov dan 8 Des → `H-14`; 9 Des → null
   - Dihapus/Usulan → null
   - tenggat tindak lanjut 23 Nov → lewat; 24 Nov → tidak
1. **Salinan registry** (pola `r5h27` verify `:92-99`): invarian terhadap registry yang ada. Jumlah sumber = disalin,
   kategori/kondisi/jumlah dipetakan sesuai K21/K44, satu riwayat, dan audit `sumber ≥ disalin`.
2. **Capabilities** per akun: op, staf, Kasubbag, Kabag, unit lain.
3. **K1 (inti):** staf membaca penilaian milik op.
   - Daftar dan detail: `kategori`/`catatan`/`penilai`/`status`/`version` bernilai `null`, `statusRingkas` benar, dan
     `tindakLanjut`/`lampiran`/`riwayat` bernilai `null`.
   - `?kategori=PERLU_PEMBINAAN`, `?lewatTenggat=true`, dan `?status=Disetujui` **tidak mengembalikan** baris itu, dan
     `total` sama dengan tanpa filter yang mencocokkan.
   - Dibatalkan tidak tampil. Unduh lampiran → 403.
   - Tindak lanjut, PATCH, dan aksi oleh staf → 403, **bukan** 409.
   - Detail personel hanya berisi entri `DINILAI`.
   - Pencatat, Kasubbag, dan Kabag menerima isi lengkap. Kabag tidak bisa memutasi.
4. **Alur kinerja:**
   - Transisi tidak sah → 409. Non-PP disetujui → Selesai (`selesai_by` = pemutus).
   - PP tanpa tindak lanjut → 409 `tindak_lanjut_wajib`.
   - Kembalikan dengan alasan < 8 → 400. Batalkan dari Draft dan dari Diajukan.
5. **Maker-checker:**
   - Kasubbag sebagai pencatat → 403.
   - Kasubbag yang menambah tindak lanjut atau lampiran lalu menyetujui → 403 `self_review_forbidden`, termasuk dengan
     id URL berhuruf besar.
   - CHECK DB diuji dengan UPDATE langsung (23514).
6. **K8:**
   - Penilaian ganda → 409 `{error:'penilaian_ganda',id}`.
   - Setelah Dibatalkan, boleh membuat baru. PATCH tahun/periode ke periode yang terpakai → 409.
   - **Balapan:** dua POST bersamaan (`Promise.all`) menghasilkan tepat satu 201 dan satu 409.
7. **Tindak lanjut (K35/K37/K38):**
   - Hanya untuk PP (lainnya 409). Boleh saat Draft.
   - PATCH PP → BAIK dengan tindak lanjut terbuka → 409.
   - Selesai butuh semua tindak lanjut tuntas dan ≥ 1 Selesai.
   - Personel terarsip: tindak lanjut boleh ditutup dan penilaian boleh di-Selesai-kan, tetapi tambah tindak lanjut 409.
8. **Dashboard:** `pembinaanLewatTenggat` dan `pemeliharaanJatuhTempo14` diukur sebagai selisih. Personel terarsip tidak
   dihitung. Akun tanpa Ri → `null`.
9. **Aset CRUD:**
   - Kode ganda beda huruf besar dan berspasi → 409 `kode_bmn_ganda`. Kode milik aset Dihapus boleh dipakai lagi.
   - PJ id + teks sekaligus → 400. PJ terarsip baru → 409, PJ terarsip lama dipertahankan → 200.
10. **Status aset:**
    - Aktif ⇄ Pemeliharaan.
    - Usulkan, lalu tolak → kembali ke status sebelumnya.
    - Usulkan, lalu setujui **tanpa lampiran sejak usulan** (ada faktur lama) → 409 `lampiran_wajib`.
    - Pemutus adalah pengusul → 403. Pemutus mengunggah sejak usulan → 403.
    - Dengan lampiran dari op → Dihapus.
    - Setelah Dihapus: PATCH, aksi, entri, unggah, dan hapus → 409; unduh → 200.
    - Usulan membekukan PATCH dan entri.
11. **Entri pemeliharaan:**
    - Kondisi dan jadwal diperbarui dalam satu transaksi. Paksa gagal setelah INSERT → aset tidak berubah.
    - RUTIN tanpa jadwal → 400. Tanggal setelah hari ini WIB → 400.
    - `koreksiDari` dari aset lain → 400 (FK komposit 23503).
12. **Lampiran:** byte-identik, `body` diawali `SDL1`. Berkas ke-11 → 409. Terenkripsi/rusak → 400. Id silang antar
    penilaian, antar aset, dan antar modul → 404. `body` dirusak → 503.
13. **Audit tanpa PII dan tanpa kategori.** `setujui` tanpa `status`.
14. **Penambahan R5H27:** POST/PATCH personel tidak membawa field baru.
15. **Regresi:** `verify/r5h27-*`, `r5h28-*`, `r5h29-*`, `r5h30-*` (karena `umum.js` dan `personel.js` berubah).

**Skenario `x6_r5h31_sumda_kinerja_aset_guard`** (`security/scenarios/r5h31.js`, setelah `x5_` di
`security/index.js:73`):
- **Guard:** anonim 401. Superadmin 403 di kedua prefix untuk semua metode, termasuk app demo. UUID fiktif 403.
  Capabilities `false` untuk unit lain, tanpa keanggotaan, dan Superadmin demo.
- **Matriks:**
  - Baca-saja (R/Ri) tidak bisa memutasi.
  - Mk non-pencatat tanpa Rk → 403 pada semua mutasi penilaian orang lain.
  - Ak tanpa Rk → 403 `setujui`. Approver-saja tidak bisa membuat.
  - Aa yang mengusulkan sendiri → 403.
- **K1 dibatasi:** daftar, detail, filter `kategori`/`lewatTenggat`/`status`, detail personel, unduh lampiran, dan
  riwayat.
- **Maker-checker:** pernah mengubah (tindak lanjut, lampiran) dan sejak usulan (lampiran aset).
- **Pencabutan:** grant kedaluwarsa, role nonaktif, `must_change_password`, grant dicabut → 403.
- **CSRF/Origin** untuk JSON dan multipart (multipart tanpa CSRF, keterbatasan D6 R5H28).
- **Lampiran:** PDF palsu atau terenkripsi, nama berbahaya, > 5 MB, dua berkas. Id silang kinerja ↔ aset ↔ cuti → 404.
- **Bentuk:** field asing, `__proto__`, Cf, NUL, JSON > 32 KB, `version` bukan bilangan, probe query
  (`tahun=abc`, `size=7`, `tahap=X`).
- **Kunci evidence kosong** → 503 (fail-closed).
- **Uji mutasi** (berkas dipulihkan setiap kali, masing-masing harus **hanya x6 merah**):
  1. `CASE WHEN boleh` di `kolomKinerja` diganti kolom asli.
  2. `(k.created_by=$3 OR $4)` dihapus dari SQL unduh lampiran kinerja.
  3. `pernahMengubahSql` dihapus dari `setujui` kinerja.
  4. `usulan_by<>$actor` dihapus dari `setujui_hapus` (CHECK DB mengubah 403 menjadi 400, jadi x6 tetap merah).
- Suite Express **27/27**. Suite Go `security-test-r2d5.sh` tetap dijalankan (072 ter-embed).

**Harness golden:** endpoint baru tidak direkam. 127 `/admin/permissions` dan 128 `/admin/roles` berubah karena 072, jadi
**direkam ulang oleh pemilik**. Kasus registry 32–37 harus tetap cocok (salinan hanya membaca).

### 8. Urutan kerja

1. Persetujuan K31–K49, R5H15 → 073. *Gerbang:* pemilik setuju.
2. Migrasi 072 + manifes (Go dan Express) + seed (Go dan Express), **belum di-commit**. *Gerbang:* gladi `pg_dump` +
   fixture, `go test`, uji CHECK manual, invarian salinan, diff seed kosong, **baru commit**.
3. `umum.js`: opsi `pernahMengubahSql` (aditif). *Gerbang:* `node --check`, verify R5H30, x2–x5 hijau.
4. **Irisan A, kinerja:** `kinerja.js` + mount + `kinerja[]`/`pembinaanLewatTenggat` di `personel.js` + bagian kinerja di
   verify dan x6. *Gerbang:* verify butir 0, 2–8, 13–14 hijau; uji mutasi 1–3; harness 32–37.
5. **Irisan B, aset:** `aset.js` + mount + `pemeliharaanJatuhTempo14` + bagian aset di verify dan x6. *Gerbang:* verify
   penuh, regresi R5H27–R5H30, dua suite keamanan (27/27), uji mutasi 4.
6. **Frontend:** dua layar baru, R5H27 (nav, dashboard, detail), `App.tsx`, `MasterDataR5G12.tsx`. *Gerbang:*
   - `npm run build`.
   - Demo per akun:
     - Kinerja: op mencatat PP → tindak lanjut → ajukan → Kasubbag menyetujui → op Selesai.
     - Pembaca lain: staf melihat "Dinilai" tanpa kategori; Kabagrenmin baca lengkap tanpa tombol.
     - Aset: op usulkan hapus + unggah BA → Kasubbag menyetujui → Dihapus; tolak.
     - Akun unit lain → 403.
   - Lebar 390 px, alamat lama `/subbagsumda/pemeliharaan` jatuh ke dashboard, simulasi rollback (tombol darurat
     registry inventaris).
7. Docs, `/verifikasi`, `/review`; golden 127/128 oleh pemilik.
8. **Deploy:** pra-cek registry inventaris produksi (§4, baca saja) dan `SDL_EVIDENCE_KEY`, **centang "Izinkan
   migrasi"**, lalu rebuild `api`, `api-express`, dan `frontend`.

### 9. Risiko dan keputusan baru

| # | Risiko | Penanganan |
|---|---|---|
| R1 | 072 tidak bisa diperbaiki setelah commit | Gladi + fixture + `pg_dump`; K31–K49 diputus dulu |
| R2 | Kategori kinerja bocor lewat status, filter, urutan, hitungan, versi, riwayat, galat, atau lampiran | Satu fragmen `kolomKinerja`; CTE `terlihat`; hak sebelum validasi; x6 + uji mutasi |
| R3 | Angka "pembinaan lewat tenggat" bersifat agregat yang terlihat semua pembaca. Dengan sedikit penilaian, angka ini menyiratkan ada PP | Tanpa nama, tanpa tautan bagi non-Rk (K33); alternatif "hanya Rk" disediakan |
| R4 | Seed hanya punya satu Kasubbagsumda (pemegang Ak/Aa satu-satunya). Penilaian/usulan yang ia catat atau ubah sendiri macet | Sama dengan R5H30 R5: peringatan di form, approver kedua lewat Role Editor |
| R5 | Data registry kotor (kondisi kustom Master Data, jumlah bukan bilangan, kode berspasi) | SQL tanpa cast yang bisa gagal + catatan; pra-cek produksi |
| R6 | Registry inventaris masih bisa ditulis saat rollback, sehingga data menyimpang | Menu disembunyikan; tombol darurat berspanduk; tidak ada salinan ulang (K21) |
| R7 | Salinan membuka baris `penting` dan baris yang dulu hanya terlihat oleh yang ditugaskan (scope `assigned`) bagi semua Ri | K24 + K44: tidak ada data pribadi; dikonfirmasi pemilik |
| R8 | Perubahan `pernahMengubahSql` merusak R5H30 | String tanpa opsi identik; langkah 3 terpisah + verify R5H30 + x5 |
| R9 | Deadlock kinerja ↔ personel | Urutan tetap induk → personel; POST hanya mengunci personel; uji balapan |
| R10 | Batas 10 lampiran aset penuh dari tahun ke tahun, sehingga SK/BA penghapusan tidak bisa diunggah | K46: hapus lampiran lama oleh pengunggah atau Aa; pantau saat paparan |
| R11 | Executive v2 `assets_care` membeku pada registry (kontrak beku) | K49: dicatat, diperbaiki setelah paritas dengan persetujuan pemilik |
| R12 | `SDL_EVIDENCE_KEY` produksi salah | Fail-closed; dicek sebelum deploy |
| R13 | Golden 127/128 berubah | Rekam ulang oleh pemilik |

| # | Hal | Usulan |
|---|---|---|
| K31 | Apa yang persis dilihat pembaca non-K1 | Hanya `{id, personel{id,nama,nrp,pangkatLabel}, tahun, periode, statusRingkas, dibatasi:true}`. `statusRingkas`: `BELUM_DINILAI` (Draft), `DIAJUKAN`, `DINILAI` (**Disetujui dan Selesai digabung**, karena status Disetujui yang bertahan hanya ada pada PP menurut K10). Kategori, catatan, penilai, tanggal penilaian, status asli, versi, pencatat, waktu putus/selesai, tindak lanjut, lampiran, dan riwayat bernilai `null`. Penilaian Dibatalkan tidak tampil |
| K32 | Filter, urutan, hitungan | Semuanya atas kolom tersamar. Filter `kategori` dan `lewatTenggat` hanya cocok pada baris yang boleh dilihat akun itu (pencatat: miliknya). `q` hanya nama/NRP. Tidak ada urutan menurut kategori |
| K33 | Dashboard "Pembinaan lewat tenggat" (K15) | Tetap untuk semua pembaca Sumda: jumlah **penilaian** PP berstatus Disetujui dengan ≥ 1 tindak lanjut lewat tenggat dan personel belum terarsip. Kartu hanya bisa diklik oleh pemegang Rk. *Alternatif bila pemilik ingin lebih ketat:* `null` bagi non-Rk |
| K34 | Siapa boleh memutasi penilaian | Mk **dan** (pencatat atau Rk) untuk PATCH, ajukan, selesai, tindak lanjut, dan lampiran. Batalkan juga boleh oleh Ak. Setujui/kembalikan butuh Ak **dan** Rk (pemutus harus bisa membaca isinya). Staf lain tidak bisa melanjutkan penilaian op; Kasubbag bisa |
| K35 | Tindak lanjut | **Hanya untuk Perlu Pembinaan** (409 `status_tidak_sesuai` untuk kategori lain). Non-PP langsung Selesai saat disetujui, jadi tindak lanjut di sana tidak punya fase pantau. Boleh ditambah juga saat **Draft** (memperluas K11), supaya rencana pembinaan bisa diajukan bersama penilaian. PATCH PP → kategori lain ditolak 409 `tindak_lanjut_terbuka` bila masih ada tindak lanjut non-Dibatalkan. Maks. 20 per penilaian |
| K36 | Maker-checker kinerja dan "kembalikan" | Pemutus setujui/kembalikan: bukan pencatat dan tidak pernah `update`, `lampiran.add/delete`, `tindak_lanjut.add/update` pada penilaian itu. Kembalikan tidak mengisi `decided_*`. Pemutus yang mengembalikan tetap boleh memutus pengajuan ulang selama tidak mengubah. Pencatat tidak bisa menarik pengajuannya sendiri ke Draft; caranya batalkan lalu buat baru |
| K37 | Selesai PP dan personel terarsip | Selesai bila semua tindak lanjut Selesai/Dibatalkan **dan ≥ 1 Selesai**. Personel terarsip: penilaian Draft/Diajukan hanya bisa dibatalkan; penilaian Disetujui boleh menutup tindak lanjut dan Selesai, tetapi tidak boleh menambah tindak lanjut. Tidak dihitung di dashboard |
| K38 | Tindak lanjut lewat tenggat | `tenggat < hari ini (WIB)` dan status Rencana/Berjalan. Tenggat wajib (Express). `hasil` wajib ≥ 3 karakter saat Selesai. Versi yang dipakai adalah versi penilaian (tindak lanjut tidak punya versi sendiri) |
| K39 | Maker-checker aset | Pemutus ≠ pengusul (CHECK DB) dan tidak mengunggah/menghapus lampiran **sejak usulan**. Perubahan sebelum usulan tidak dihitung, karena aset berumur panjang. Lampiran wajib (K4) = ≥ 1 PDF yang **diunggah sejak usulan**; faktur lama tidak memenuhi. Pengusul tidak bisa menarik usulan; Kasubbag menolak |
| K40 | Usulan Penghapusan | Membekukan aset: tanpa PATCH, entri pemeliharaan, atau perubahan Aktif/Pemeliharaan. Hanya lampiran dan putusan |
| K41 | Aset Dihapus | Final dan hanya-baca. Lampiran tetap bisa diunduh tetapi tidak bisa diunggah/dihapus. Riwayat dan entri tetap ada. Tidak tampil di daftar bawaan (filter `status=Dihapus`), jadwal, maupun dashboard. Kodenya boleh dipakai ulang |
| K42 | Status Pemeliharaan vs entri pemeliharaan | Terpisah. Entri **tidak** mengubah status; UI menawarkan "Aktifkan kembali" setelah entri. Aset berstatus Pemeliharaan tetap masuk jadwal. Entri: tanggal ≤ hari ini WIB; `jadwalBerikutnya` > tanggal, wajib untuk RUTIN, opsional untuk lainnya (kosong = jadwal aset tidak berubah) |
| K43 | Kode BMN | Indeks unik parsial di DB (§4). Format `^[A-Za-z0-9 ._/()\-]+$` (2–64). Kode salinan di luar format boleh dipertahankan saat PATCH (pola NRP R5H27). Salinan ganda diberi akhiran `~n` + catatan |
| K44 | Rincian salinan registry | Termasuk baris `penting` dan baris yang dulu hanya terlihat oleh yang ditugaskan. Kategori dicocokkan tanpa peka huruf. Kondisi kosong atau tidak dikenal (termasuk nama kustom Master Data) → Perlu Pemeriksaan + "Kondisi lama: …". Satuan `unit`. PJ tetap teks (tanpa pencocokan nama). Berkas/foto di work record **tidak disalin**; detail aset salinan menautkan "Berkas lama" ke Berkas, Foto & Disposisi, dan aksesnya diputus oleh unit-work (Engine B) |
| K45 | Penanggung jawab | Pilih dari personel belum terarsip (status apa pun). PJ yang kemudian terarsip tetap tersimpan dan ditandai "(terarsip)", tetapi tidak bisa dipilih baru. Arsip personel tidak diblokir oleh aset |
| K46 | Batas dan lampiran kinerja | PDF ≤ 5 MB, 10 per penilaian/aset (K13/K22). Lampiran kinerja diunggah selama Draft/Diajukan/Disetujui dan dihapus oleh pengunggah atau Ak sebelum Selesai/Dibatalkan. Detail aset memuat 200 entri terbaru + `terpotong`. `/aset/jadwal` maks. 500 item (`ringkas` tetap hitungan penuh). `jumlah` ≤ 1.000.000. Ukuran halaman 5/10/50/100 |
| K47 | Angka aset di dashboard Sumda | `pemeliharaanJatuhTempo14` bernilai `null` bagi akun tanpa Ri (dashboard memakai R) |
| K48 | Audit kinerja | Tanpa kategori. `setujui` tanpa status hasil. Event tindak lanjut tetap ada, sehingga pembaca audit (Superadmin) dapat menyimpulkan PP; ini diterima karena mereka administrator identitas, bukan pembaca Sumda |
| K49 | Sisa registry lama | Executive v2 `assets_care` tetap menghitung registry (kontrak beku, kedua backend), dan Master Data "Kondisi Barang" hanya untuk registry lama (teks diperbarui). Perbaikan executive setelah paritas, dengan persetujuan pemilik dan kedua backend sekaligus |

### Temuan yang mengoreksi dokumen rilis

1. **Kondisi registry bukan daftar tertutup.** Backend menerima teks bebas ≤ 200 karakter (`registry-crud.js:83-90`).
   "Baik/Rusak Ringan/Rusak Berat/Lainnya" hanya bawaan UI (`SumdaR5B.tsx:53`) dan master `kondisi-barang`
   (`047:53-56`), yang bisa diubah Superadmin (`MasterDataR5G12.tsx:130`, `OpsiDropdownR5H8.ts:19`). Karena itu
   pemetaan memakai `lower(btrim())` dengan cadangan Perlu Pemeriksaan + catatan (K44).
2. **Jumlah registry** divalidasi 1–8 digit tanpa nol depan (`unitwork/sumda.js:58-60`, `shared.js:64`), tetapi
   **opsional** (boleh kosong). Nilai "bukan bilangan" hanya mungkin dari data lama atau SQL langsung. Kosong dipetakan
   ke 1 + "Jumlah lama tidak tercatat".
3. **Kolom registry:** `ref_code` (2–64), `title` (3–200), dan `fields` JSONB berkunci `kategori, kondisi, lokasi,
   jumlah, penanggungJawab, keterangan` (`020:3-17`, `sumda.js:12`). Klasifikasi ada di
   `sdl_unit_work_records.classification`, bukan di registry. Kode unik per `(kind, lower(ref_code))` tanpa `btrim`, jadi
   salinan tetap perlu `row_number` defensif.
4. **`subbagsumda.inventaris.read` benar** dipegang op, staf, Kasubbag, dan Kabagrenmin (`main.go:55-57,61`). Tetapi
   registry memakai Engine B dan **tidak memakai permission ini**: op/staf (scope `assigned`, `biasa`, `main.go:37-38`)
   selama ini hanya melihat record yang ditugaskan (`registry-crud.js:171-186`). Setelah R5H31, semua pemegang Ri melihat
   semua aset (K24, R7, K44).
5. **Ikon `clipboard` sudah ada** (`App.tsx:46,68`) dan juga dipakai Disposisi/Laporan. Tidak perlu ikon baru.
6. **`/subbagsumda/pemeliharaan` hanya dirujuk `App.tsx:163`.** `SmartUnitDashboard.tsx:24-29` tidak memuatnya dan
   tidak pernah dirender untuk Sumda (`App.tsx:627` menangkap lebih dulu). Tidak ada backend yang merujuknya.
7. **Executive v2 `assets_care` membaca registry inventaris** (`executive/index.js:180-188`, `executive_v2.go:175`).
   Endpoint ini termasuk 142 yang beku, jadi setelah R5H31 angkanya membeku pada registry. Hal ini tidak disebut dokumen
   (K49, R11).
8. **K1 "status saja" membocorkan kategori**, karena hanya PP yang tinggal di Disetujui (K10). Status harus diringkas
   (K31).
9. **Filter "pembinaan lewat tenggat" dan kategori** hanya bisa cocok pada PP, karena tindak lanjut hanya ada untuk PP.
   Filter harus dijalankan atas baris yang boleh dilihat (K32). Kode galat 409 untuk tindak lanjut pada non-PP juga
   membocorkan, jadi hak dicek lebih dulu (K34).
10. **K11 melarang tindak lanjut saat Draft**, padahal setujui PP mewajibkan tindak lanjut. Petugas dipaksa mengajukan
    penilaian yang belum lengkap (K35).
11. **`pernahMengubahSql` hanya mengenal `update`/`lampiran.*`** (`umum.js:57-59`) dan tidak punya batas waktu. Perlu
    perluasan aditif untuk tindak lanjut dan maker-checker aset per usulan.
12. **Bagian Migrasi menulis "`decided_by <> created_by`"** untuk semua tabel. Untuk aset yang benar `decided_by <>
    usulan_by`, karena pencatat aset bisa siapa saja bertahun-tahun sebelumnya.
13. **Harness mengosongkan `sdl_sumda_registry`** (`harness/seed-documents.js:284`, TRUNCATE CASCADE). Karena itu
    `source_registry_id` **tanpa FK**.
14. **DB lokal: salinan 0 baris** (satu-satunya baris inventaris sudah terhapus). Gladi wajib memakai fixture.
15. **Nama permission mirip `subbagren.kinerja.read`** (`003:50`, dipegang staf/Kasubbag Subbagren dan Kabag). Unitnya
    lain dan `PERMIT_SQL` mensyaratkan grant `subbagsumda`, tetapi jangan sampai tertukar di seed atau x6.
16. **Kode galat kurang:** tidak ada yang baru selain daftar dokumen. `penilaian_ganda` membawa `id` lewat daftar putih
    yang ada, dan tindak lanjut pada non-PP memakai `status_tidak_sesuai`.
17. **Rollback sempit** § R5H30 di API-CONTRACT (`:1851-1855`) ditandai usang; pola baru memuat `/kinerja*` dan `/aset*`.
18. **CLAUDE.md** (`:130,186,206`) menjadi 123 tabel dari migrasi / 72 berkas SQL / suite Express 27/27.
    `MIGRATION-PLAN.md:16` menjadi "049–072". R5H15 → 073.

## Menyimpang dari rencana

1. **Kode galat baru `batas_tindak_lanjut`** (409) untuk batas 20 tindak lanjut per penilaian (K35); rencana tidak
   menamai kodenya.
2. **x6 memundurkan stempel CAPTCHA** di awal skenario (DB uji sekali pakai, pola `core.js`). Batas 60 CAPTCHA/menit per
   IP dihitung lintas skenario dan suite 27 skenario berjalan < 1 menit; tanpa ini login x6 kena 429. Batas di kode
   produksi tidak berubah.
3. **Uji kode BMN berpola path** di rencana §7 diganti uji karakter terlarang: K43 sengaja mengizinkan `.` dan `/`
   (kode BMN nyata `3.05.02.01.003/2024`), dan kode hanya pengenal, tidak pernah dipakai sebagai path.
4. **Skenario x6 satu commit** setelah irisan B (pola R5H29/R5H30); verify kinerja sudah lulus sebelum irisan B.
5. **Tautan "Berkas lama" (K44)** membuka menu "Berkas, Foto & Disposisi" secara umum, bukan record work-unit
   tertentu, karena API aset tidak mengekspos id registry/work record.
6. **Gladi 072**: fixture registry kotor dibersihkan dengan SQL (bukan `pg_restore` dump) setelah uji, supaya data [UJI]
   lokal lain tetap ada; dump `pre-072.dump` disimpan di scratchpad.

## Sisa uji (untuk /verifikasi)

Sudah dijalankan: gladi 072 dengan 13 fixture registry kotor (10 tersalin, 3 dikecualikan; peta kategori/kondisi/jumlah,
akhiran `~2`, audit 10/10/10) + 19 uji CHECK + `go test` (build image) + Go start; verify R5H31 lulus (kinerja: K1 di
daftar/detail/filter/detail personel/lampiran, alur, maker-checker termasuk id huruf besar, K8 + balapan, tindak
lanjut, terarsip, dashboard; aset: tahap WIB, kode BMN, PJ terarsip, usulan/tolak/setujui + lampiran sejak usulan,
Dihapus final, entri + koreksi FK komposit, lampiran, audit); verify R5H30 lulus setelah perubahan `umum.js`; suite
Express **27/27** + empat uji mutasi (masing-masing hanya x6 merah); `npm run build`; demo browser (op → Kasubbag →
staf "Dibatasi"; aset tambah → pemeliharaan → usulan + BA → Kasubbag menghapus; dashboard; alamat lama
`/subbagsumda/pemeliharaan` jatuh ke dashboard; 390 px tanpa geser horizontal).

Belum:
- Suite Go `security-test-r2d5.sh`, verify regresi R5H27/R5H28/R5H29, dan `/verifikasi` penuh.
- Demo Kabagrenmin (isi kinerja terbaca, tanpa tombol) dan akun unit lain; simulasi rollback (tombol darurat registry).
- Harness golden: 127/128 berubah lagi (permission 072) → **rekam ulang oleh pemilik**; registry 32–37 harus cocok.
- Deploy: pra-cek registry inventaris produksi (§4) + `SDL_EVIDENCE_KEY`; **centang "Izinkan migrasi"** (072).

## Perbaikan hasil review (2026-11-24)

`/review` (migration-guard + security-reviewer): tidak ada temuan wajib; ketujuh aturan migrasi dipatuhi; SQL
`pernahMengubahSql` tanpa opsi terbukti identik dengan R5H30. Dikerjakan atas persetujuan pemilik:

| # | Temuan | Perbaikan |
|---|---|---|
| S1 | Angka dashboard "Pembinaan lewat tenggat" (terlihat semua pembaca) bisa dikorelasikan dengan perubahan status ringkas Diajukan→Dinilai saat Kasubbag menyetujui, sehingga staf bisa menebak siapa Perlu Pembinaan | **Mengubah K33 ke alternatifnya:** `totals.pembinaanLewatTenggat` hanya untuk pemegang `kinerja.read`, selain itu `null` (kartu tidak tampil) |
| S2 | Salinan registry `penting` (termasuk `keterangan`) terbaca semua pemegang `inventaris.read` | Sesuai K44; pra-cek §4 kini menghitung `penting` dan `keterangan_penting` untuk ditunjukkan ke pemilik sebelum deploy |
| S3 | Migrasi bisa gagal bila kode registry sudah berakhiran `~n` | Pra-cek §4 menghitung `kode_bertilde` (harus 0); 072 tidak diubah |
| C1 | Approve tanpa `kinerja.read` membatalkan → selalu 404 setelah rollback | Batalkan oleh bukan-pencatat butuh approve **dan** `kinerja.read` (403 lebih awal) |
| C3 | Kasubbag bisa mengajukan draf milik operator lalu langsung memutusnya | **Mengubah K34 untuk `ajukan`:** hanya pencatat |
| Docs | Status/rencana masih "belum ada kode"; K49 belum di DEVIATIONS; rollback tidak menyebut data registry selama rollback; urutan deploy | Diperbaiki; DEVIATIONS B10 (K49); API-CONTRACT § R5H31; deploy: rebuild frontend segera setelah migrasi |

Tidak diubah (dicatat): C2 pembaca terbatas mendapat 403 (bukan 404) saat memutasi penilaian Dibatalkan yang id-nya
sudah diketahui; C4 Selesai pembinaan tanpa pemeriksa (K37); C5/C6 invarian: setiap pemegang `kinerja.manage` dan
`inventaris.read` juga memegang `personel.read` (seed saat ini memenuhi); C7 event audit tindak lanjut menyiratkan PP
(hanya Superadmin, K48); `tolak_hapus` tidak mengisi `updated_by`.

**Deploy (tambahan):** rebuild `frontend` segera sesudah migrasi 072 — input ke registry inventaris lewat layar lama
setelah migrasi tidak tersalin. Pemeriksaan pasca-deploy (harus 0):
`SELECT count(*) FROM sdl_sumda_registry WHERE kind='inventaris' AND greatest(created_at,updated_at) > (SELECT applied_at FROM sdl_schema_migrations WHERE filename LIKE '%072_%')`.
