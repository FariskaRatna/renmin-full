# R5H32 — Subbagsumda: Persuratan & Arsip + Laporan & Analitik

Status: **terimplementasi di branch `feat/r5h32-sumda-arsip-laporan` (2026-11-24), belum di-push; menunggu /verifikasi + /review**. K1–K4 dijawab pemilik 2026-11-24; K5–K28 (usulan) disetujui pemilik 2026-11-24; K29–K49 (rencana, §9 Rencana Implementasi) disetujui **sementara** lewat "oke lanjut ke /implementasi" (aturan bisnis di kode Express, dapat diubah setelah paparan ke pengguna).
Khusus Express. Migrasi **073** (R5H15 digeser lagi ke **074**, lihat K28).
Lanjutan R5H27–R5H31. Pola dipakai ulang: `PERMIT_SQL` (`umum.js`), lampiran tersegel (`lampiran.js`), penyamaran di SQL
(R5H30 S3, R5H31 K1), prinsip K43 R5H30 (migrasi hanya struktural), maker-checker tidak diperlukan (pencatatan).

Referensi: modul `letters` dan halaman `reports` di `docs/reference/Subbagsumda.html` (prototipe localStorage).
- **Persuratan & Arsip** (referensi): nomor surat, jenis (Surat Masuk/Surat Keluar/Nota Dinas/Surat Keputusan/Lainnya),
  perihal, tanggal, status Draft/Diproses/Disetujui/Diarsipkan, catatan; "lampiran tidak diunggah ke demo".
- **Laporan & Analitik** (referensi): kartu Personel aktif, Pensiun 30 hari, Layanan SDM, Aset terdaftar; komposisi
  personel aktif per unit (batang); ringkasan register per modul (jumlah + yang masih diproses); unduh CSV per modul;
  cetak; backup JSON (khusus demo).
- **Tidak** diambil: alur persetujuan surat di dalam register (sudah ada di Surat Keluar R5H21), backup/restore JSON,
  impor data.

## Kebutuhan (kata pemilik)

> "selanjutnya kerjakan bagian persuaratan & arsip serta menu laporan & analitik ya"

## Kondisi sekarang

- Sumda **sudah punya** Surat Masuk/Keluar antar-unit (R5H21, migrasi 064, `/api/v1/persuratan`, layar
  `PersuratanR5H21`): draf → diajukan → disetujui Kabagrenmin → dikirim; surat masuk diterima seluruh staf unit.
  Tabel `sdl_surat_antar` (+ `_tujuan`, `_berkas`).
- Belum ada tempat menyimpan **dokumen yang tidak lewat aplikasi** (SK, nota dinas internal, surat eksternal/hardcopy,
  berita acara) beserta lokasi simpan fisik dan masa retensi.
- Belum ada halaman analitik Sumda selain kartu ringkas di Dashboard Unit (R5H27–R5H31); belum ada ekspor data.
- `/api/v1/subbagsumda/*` sudah dilayani Express di produksi.

## Keputusan

| # | Hal | Keputusan | Sumber |
|---|---|---|---|
| K1 | Isi Persuratan & Arsip | **Register arsip dokumen Sumda**: SK, nota dinas, surat eksternal/hardcopy, berita acara, dll. — nomor, jenis, perihal, tanggal, asal/tujuan, lokasi simpan, retensi, PDF tersegel. Surat R5H21 yang sudah **dikirim/diterima** bisa **ditautkan**. Surat Masuk/Keluar tetap memakai menu yang ada | Pemilik |
| K2 | Kerahasiaan | **Biasa / Terbatas.** Arsip Biasa terbaca semua pembaca Sumda; arsip **Terbatas** (mis. SK pribadi, data kesehatan) hanya Kasubbagsumda, Kabagrenmin, dan pencatatnya — **diputus di SQL** (pola R5H31 K1) | Pemilik |
| K3 | Laporan & Analitik | **Ringkasan + grafik + ekspor CSV**: satu halaman analitik lintas modul Sumda + ekspor CSV per modul. Isi tiap angka/ekspor mengikuti hak modulnya (kinerja, cuti Sakit, arsip Terbatas tetap dibatasi) | Pemilik |
| K4 | Ekspor | **Hanya Kasubbagsumda + Kabagrenmin** (permission baru), **setiap unduhan diaudit** | Pemilik |
| K5 | Menu | "Persuratan & Arsip" (ikon arsip) dan "Laporan & Analitik" (ikon grafik) di grup Sumda; menu Surat Masuk/Keluar R5H21 di sidebar tidak berubah | Usulan |
| K6 | Permission arsip | `subbagsumda.arsip.read` (op, staf, Kasubbag, Kabagrenmin), `subbagsumda.arsip.manage` (op, staf, Kasubbag), `subbagsumda.arsip.restricted` (Kasubbag, Kabagrenmin) — membaca arsip Terbatas milik orang lain | Usulan |
| K7 | Permission laporan | Membaca halaman analitik: `subbagsumda.personel.read` (sudah ada). Ekspor: `subbagsumda.laporan.export` (Kasubbag, Kabagrenmin) | Usulan |
| K8 | Field arsip | `nomor` (opsional, ≤ 120), `jenis` (`SURAT_MASUK`, `SURAT_KELUAR`, `NOTA_DINAS`, `SURAT_KEPUTUSAN`, `BERITA_ACARA`, `LAINNYA`), `perihal` (3–240), `tanggal` (wajib), `asalTujuan` (≤ 200), `kodeKlasifikasi` (kode arsip, ≤ 60), `lokasiSimpan` (lemari/rak/map, ≤ 200), `retensiSampai` (tanggal, opsional), `kerahasiaan` (`BIASA`/`TERBATAS`), `catatan`, `personelId` (opsional, dokumen milik seorang personel, mis. SK) | Usulan |
| K9 | Status arsip | **Aktif** → **Inaktif** (setelah masa retensi aktif; petugas) → **Musnah** (dimusnahkan; Kasubbag, alasan ≥ 8 + lampiran berita acara pemusnahan wajib) ; Aktif/Inaktif ↔ boleh dikembalikan. Musnah final, hanya-baca (lampiran tetap tersimpan sebagai bukti) | Usulan |
| K10 | Alert retensi | `retensiSampai` ≤ 30 hari lagi atau terlewat (WIB) untuk arsip Aktif/Inaktif → tanda "Retensi" + angka di dashboard | Usulan |
| K11 | Tautan surat R5H21 | Opsional, satu surat per arsip: surat `dikirim` oleh `subbagsumda`, atau surat yang `subbagsumda` terima (tujuan). Detail arsip menampilkan nomor/perihal surat itu dan tautan ke menu Surat Masuk/Keluar. Satu surat boleh ditautkan ke banyak arsip? **Tidak** — satu surat satu arsip (409 `surat_sudah_diarsip`) | Usulan |
| K12 | Lampiran arsip | PDF tersegel, maks. 10, ≤ 5 MB; arsip Terbatas: unduh hanya K2 (pola R5H30 S3 / R5H31) | Usulan |
| K13 | Ubah arsip | Petugas (`manage`) mengubah arsip Aktif/Inaktif; arsip Terbatas hanya oleh pencatat atau pemegang `restricted`. `kerahasiaan` boleh dinaikkan Biasa→Terbatas oleh siapa pun yang boleh mengubah, diturunkan Terbatas→Biasa hanya oleh pemegang `restricted` | Usulan |
| K14 | Pencarian | Nomor, perihal, asal/tujuan, kode klasifikasi; filter jenis, status, tahun, kerahasiaan (filter Terbatas atas kolom tersamar), "retensi mendekat" | Usulan |
| K15 | Isi halaman analitik | Kartu: personel aktif/MPP, pensiun ≤ 30 hari, layanan SDM berjalan (karier+cuti+kesejahteraan belum final), aset aktif, arsip (+ retensi mendekat). Grafik: komposisi personel per unit kerja, per pangkat/golongan (Polri/PNS), proyeksi pensiun 12 bulan, cuti per bulan (tahun berjalan), status aset per kondisi, diklat per bulan. Ringkasan register per modul (jumlah + yang masih diproses) | Usulan |
| K16 | Kinerja di analitik | Distribusi kategori kinerja **hanya** untuk pemegang `kinerja.read`; selain itu tidak tampil (bukan angka nol) | Usulan |
| K17 | Rentang & filter | Tahun (bawaan tahun berjalan WIB) untuk grafik berbasis tanggal; data dihitung di server (SQL agregat), tanpa mengirim baris mentah | Usulan |
| K18 | Ekspor: modul | CSV per modul: Master Personel, Pensiun (alert), Karier, Diklat (kegiatan + peserta), Kompetensi, Cuti, Kesejahteraan, Kinerja*, Aset, Arsip* | Usulan |
| K19 | Ekspor: isi | Kolom sama dengan daftar di layar masing-masing. **Kinerja**: hanya baris yang boleh dibaca (pemegang `kinerja.read` = semua). **Cuti**: catatan Sakit mengikuti R5H30 S3. **Arsip Terbatas**: ikut bila pengekspor memegang `restricted` (Kasubbag/Kabag memegangnya). Tidak pernah memuat isi lampiran, hash, atau id internal pengguna | Usulan |
| K20 | Ekspor: format | CSV UTF-8 dengan BOM (dibuka benar oleh Excel), pemisah `;`, tanggal `YYYY-MM-DD`; **sel yang diawali `=`, `+`, `-`, `@`, tab, CR diberi awalan `'`** (cegah CSV/formula injection); nama berkas `sumda-<modul>-<YYYYMMDD>.csv` | Usulan |
| K21 | Ekspor: batas | Maks. 10.000 baris per unduhan (lebih → 413 `terlalu_banyak` dengan saran filter tahun); filter tahun/status sama dengan layar | Usulan |
| K22 | Audit ekspor | Setiap unduhan: `subbagsumda.laporan.export` dengan metadata `{modul, jumlah, filter}` (filter tanpa teks bebas) | Usulan |
| K23 | Cetak | Tombol "Cetak" memakai cetak browser dengan gaya cetak (tanpa PDF server, sesuai K3) | Usulan |
| K24 | Detail Master Personel | Bagian "Arsip dokumen" (arsip yang menautkan personel itu; Terbatas hanya untuk yang berhak) | Usulan |
| K25 | Dashboard Sumda | Satu angka aditif: **"Arsip retensi ≤ 30 hari"** (bagi pemegang `arsip.read`, selain itu `null`) | Usulan |
| K26 | Klasifikasi sistem | Tidak dipakai (kerahasiaan arsip memakai K2, bukan `classification_limit`) | Usulan |
| K27 | Aturan bisnis | Prinsip K43 R5H30: migrasi hanya struktural; aturan bisnis (peta status, lampiran wajib saat Musnah, satu surat satu arsip, batas ekspor) di Express | Usulan |
| K28 | Nomor migrasi | R5H32 memakai **073**; R5H15 digeser ke **074** | Usulan |

## Alur

**Persuratan & Arsip**

```
 [catat arsip] → Aktif ⇄ Inaktif ──musnahkan (Kasubbag, alasan + BA pemusnahan)──► Musnah (final)
       │
       └─ (opsional) tautkan surat R5H21 yang sudah dikirim/diterima Sumda
```

1. **Daftar arsip**: nomor, perihal, jenis, tanggal, lokasi simpan, retensi (tanda), kerahasiaan (ikon gembok),
   status; ~~arsip Terbatas milik orang lain tampil sebagai "Arsip terbatas" tanpa perihal/nomor (K2)~~ — **digantikan K29**:
   arsip Terbatas milik orang lain tidak tampil sama sekali.
2. **Catat arsip**: isian K8, unggah PDF, tautan surat R5H21 (pilih dari surat Sumda yang sudah dikirim/diterima).
3. **Detail**: data, lampiran, riwayat status, tombol sesuai hak.

**Laporan & Analitik**

1. Halaman analitik (K15/K16) dengan pilihan tahun; tombol "Cetak".
2. Panel "Unduh data" (hanya Kasubbag/Kabag, K4): satu tombol per modul (K18), memakai filter tahun.

## Backend yang melayani

Express saja. `infra/Caddyfile` meneruskan `/api/v1/subbagsumda/*` ke Express di produksi; **Caddy tidak berubah**.
Mount spesifik baru: `/subbagsumda/arsip` dan `/subbagsumda/laporan`. Persuratan R5H21 (`/api/v1/persuratan`) **tidak
diubah**; arsip hanya **membaca** `sdl_surat_antar` untuk tautan. Go hanya mendapat migrasi 073 + manifes + seed.

**Rollback** ke Go: `/arsip*` dan `/laporan*` dijawab chi 404 `text/plain` → kedua layar "tidak tersedia" (tanpa
cadangan). Tabel 073 diam.

## Endpoint baru

Guard operasional (**O**), validasi strict, `no-store`. Hak: `Ra`/`Ma`/`Xa` = `arsip.read`/`.manage`/`.restricted`,
`R` = `personel.read`, `E` = `laporan.export`.

| Metode | Path | Hak | Isi |
|---|---|---|---|
| GET | `/arsip/capabilities` | O | `{canRead,canManage,canRestricted,canTautSurat}` (lihat §2) |
| GET | `/arsip` | Ra | `?q=&jenis=&status=&tahun=&kerahasiaan=&retensi=1&page=&size=` → Terbatas yang tidak berhak **tidak tampil** (K29) |
| GET | `/arsip/surat-tertaut` | Ma | surat R5H21 Sumda yang sudah dikirim/diterima dan belum diarsipkan (pilihan tautan K11) |
| POST | `/arsip` | Ma | isian K8 + `suratId?` → 201 |
| GET | `/arsip/:id` | Ra | `{item,lampiran,riwayat,surat?}` (Terbatas yang tidak berhak → 404, K29) |
| PATCH | `/arsip/:id` | Ma | badan penuh + `version` (K13) |
| POST | `/arsip/:id/aksi` | Ma/Xa | `{aksi:inaktifkan\|aktifkan\|musnahkan,catatan,version}` (musnahkan: Kasubbag = `restricted` + `manage`, K9) |
| POST · GET · DELETE | `/arsip/:id/lampiran` · `…/:lid` · `…/:lid` | Ma · Ra(K2) · Ma | PDF tersegel |
| GET | `/laporan/ringkasan` | R | `?tahun=` → agregat K15 (kinerja hanya `kinerja.read`, aset hanya `inventaris.read`, arsip hanya `arsip.read`) |
| GET | `/laporan/ekspor/:modul` | E | `?tahun=&status=` → `text/csv` (K18–K22) |
| GET | `/personel/:id` (R5H27) | R | **Aditif**: `arsip[]` (K24) |
| GET | `/dashboard` (R5H27) | R | **Aditif**: `totals.arsipRetensi30` (K25) |

Kode galat: pola R5H28–R5H31 + `surat_sudah_diarsip`, `surat_tidak_berlaku` (surat bukan milik/terima Sumda atau belum
dikirim), `lampiran_wajib` (musnahkan tanpa BA), `terlalu_banyak` (413, ekspor).

## Migrasi `073_sumda_arsip_laporan.sql`

File baru; manifes `migrate_test.go` + `src/migrations/index.js` dan seed Go + Express di commit yang sama. Hanya
aturan struktural (K27).
- `sdl_sumda_arsip` (+ `_riwayat`, `_lampiran`): jenis/status/kerahasiaan CHECK, tanggal, `personel_id` FK RESTRICT
  opsional, `surat_id` → `sdl_surat_antar` (FK atau tanpa FK — diputuskan di `/rencana`, karena harness mengosongkan
  sebagian tabel), lampiran `SDL1`.
- Permission K6/K7 + role_permissions (Kabagrenmin: `arsip.read`, `arsip.restricted`, `laporan.export`).
- Tidak ada salinan data. Gladi dari `pg_dump` sebelum commit.

## Otorisasi

Bukan Engine A/B. Sama dengan R5H27–R5H31: guard `AuthorizeOperational`, lalu `PERMIT_SQL` — grant aktif unit
`subbagsumda` + permission role, diputus di SQL. Tambahan:
- **Arsip Terbatas (K2) diputus di SQL** dengan predikat baris (`created_by = $actor OR $restricted`; K29: baris disembunyikan, bukan kolom disamarkan) untuk
  daftar, filter, hitungan, detail, lampiran, detail personel, dan ekspor (pola R5H31 `kolomKinerja`).
- **Analitik**: setiap blok agregat dihitung hanya bila pemanggil memegang hak modulnya; blok tanpa hak bernilai `null`.
- **Ekspor**: `laporan.export` + hak baca modulnya + penyamaran yang sama dengan layar; audit per unduhan (K22).

## Rencana uji

**`verify/r5h32-sumda-arsip-laporan.js`**: hak & capabilities; arsip CRUD; Terbatas tersamar di daftar/filter/detail/
lampiran/detail personel bagi staf, terbaca pencatat/Kasubbag/Kabag; naik/turun kerahasiaan (K13); Aktif ⇄ Inaktif;
musnahkan tanpa BA → 409, dengan BA → Musnah final; tautan surat R5H21 (bukan milik Sumda/belum dikirim → 400/409,
ganda → 409); retensi WIB + dashboard; analitik (angka cocok dengan SQL acuan; blok kinerja `null` bagi staf); ekspor
(hanya Kasubbag/Kabag, BOM + `;`, formula injection diberi `'`, kinerja/cuti Sakit/arsip Terbatas mengikuti hak,
batas baris, audit `{modul,jumlah,filter}`); regresi R5H27–R5H31.

**Skenario `x7_r5h32_sumda_arsip_laporan_guard`**: guard + Superadmin (demo), capabilities unit lain, matriks, **arsip
Terbatas dibatasi** dan **ekspor hanya E** (uji mutasi masing-masing → hanya x7 merah), CSRF/Origin + multipart, id
silang antar-modul, bentuk, probe query, pencabutan, kunci evidence kosong. Suite Express **28/28**.

**Harness golden:** endpoint baru tidak direkam; 127/128 berubah (permission 073) → rekam ulang pemilik.

## Di luar cakupan

- Perubahan alur Surat Masuk/Keluar R5H21 (tetap di menu yang ada); persetujuan surat di dalam register arsip.
- Jadwal retensi resmi (JRA) per kode klasifikasi, berita acara otomatis, peminjaman arsip fisik.
- Laporan PDF berformat resmi buatan server, laporan terjadwal/email, dashboard lintas unit.
- Ekspor XLSX, impor CSV, backup/restore JSON.
- Perubahan endpoint lama dan backend Go selain migrasi + seed.

## Hasil implementasi (2026-11-24)

- **Migrasi 073** sesuai §4. Gladi di DB lokal (dump `pg_dump` lebih dulu): 21/21 uji CHECK lulus; uji rambatan
  `TRUNCATE sdl_urmin_registry CASCADE` mengosongkan `sdl_surat_antar` tetapi **`sdl_sumda_arsip` utuh** (2 `surat_id`
  menjadi yatim) — keputusan tanpa FK terbukti. `go test` (build image Go) hijau; Go start normal di DB ber-073; seed Go ↔
  Express identik (13 role).
- **Express:** `arsip.js`, `csv.js`, `ekspor.js`, `laporan.js`; aditif `personel.js` (`item.arsip`, `totals.arsipRetensi30`,
  `proyeksiPensiunSql` — string dashboard identik, diuji) dan `kinerja.js` (`export boleh`).
- **Uji:** `verify/r5h32-sumda-arsip-laporan.js` **140 OK / 0 gagal**; regresi `verify/r5h27-*` 101 OK, `verify/r5h31-*`
  104 OK. Suite Express **28/28** (`x7_r5h32_sumda_arsip_laporan_guard`). Uji mutasi 1–5 (§7): masing-masing **hanya x7
  merah**, berkas dipulihkan (diff 0).
- **Frontend:** `SumdaArsipR5H32.tsx`, `SumdaLaporanR5H32.tsx`, `SumdaR5H32.css`; R5H27 (nav, kartu "Arsip retensi ≤ 30 hari",
  bagian "Arsip dokumen" di detail personel); `App.tsx` (dua modul, cabang `unit.id==='sumda'`). `npm run build` hijau.
  Demo browser (Edge): op mencatat arsip TERBATAS dari surat masuk `[UJI]` yang sudah diterima + PDF → staf tidak
  melihatnya → Kasubbag menginaktifkan, mengunggah BA, memusnahkan → Kabag membuka laporan (blok kinerja ada, 10 tombol
  unduh) dan mengunduh `sumda-arsip-20261124.csv` (BOM, `;`) → staf: tanpa blok kinerja dan tanpa panel unduh → 390 px
  tanpa scroll horizontal → cetak menyembunyikan header/sidebar/footer/tombol/panel unduh.
  Data demo yang tertinggal di DB lokal: surat `[UJI] Pemberitahuan SK pensiun personel` dan arsipnya (Musnah).

### Menyimpang dari rencana

1. **Urutan ekspor: audit → header → kirim** (rencana §6: header → audit). Nama berkas selalu ASCII dari daftar putih
   modul + tanggal, jadi `setHeader` tidak bisa melempar setelah audit (alasan urutan header-dulu R5H28 S1 tidak berlaku),
   dan dengan audit lebih dulu kegagalan audit dijawab 503 JSON bersih tanpa header `attachment` yang sudah terpasang.
2. **`kinerja.js` hanya mengekspor `boleh`**, bukan `TAMPAK`: ekspor kinerja menyaring dengan `boleh` (lebih ketat dari
   `TAMPAK`), dan blok kinerja analitik hanya untuk Rk sehingga tidak butuh penyamaran.
3. **Uji akun tanpa Ra/Ri/Rk/Xa dipindah ke x7.** Verify memakai empat akun seed yang semuanya memegang `arsip.read`;
   role uji (Ra-saja, tanpa Ps, pola Kabag tanpa Ri, E tanpa Xa/Rk, tanpa Ra) dibuat di DB sekali pakai suite keamanan.
   Batas 10.001 baris (413) juga hanya diuji di x7.
4. **Uji batas tahun WIB 31 Des (rencana §7 butir 0)** tidak dibuat: ringkasan memakai `HARI_INI` langsung (tanpa parameter
   stempel). Yang diuji: tahun bawaan = tahun WIB hari ini, proyeksi dimulai bulan WIB, dan rumus retensi di batas hari.
5. **Lampiran di layar:** dua bagian (Dokumen, Berita acara pemusnahan) masing-masing menampilkan "/10" karena batas 10
   berlaku gabungan; tombol unggah hilang bila kuota gabungan habis (server tetap menolak 409 `batas_lampiran`).

6. **K50 (pemilik, 2026-11-24, menggantikan K5): sidebar Sumda disamakan dengan referensi.** Grup WORKSPACE SUBBAGSUMDA
   (Dashboard, Master Personel, Monitoring Pensiun) · ADMINISTRASI SDM (Karier, Diklat, Cuti, Kesejahteraan, Kinerja) ·
   DUKUNGAN & LAPORAN (Inventaris/BMN, Persuratan & Arsip, Laporan & Analitik). Surat Masuk dan Surat Keluar R5H21 menjadi
   **tab** di Persuratan & Arsip (Surat Masuk · Surat Keluar · Arsip Dokumen; badge "belum diterima" pindah ke menu itu);
   rute `/subbagsumda/surat-masuk|surat-keluar` dan tautan dari Inbox tetap berlaku. Inbox Distribusi dan Disposisi
   dihapus dari sidebar (sama dengan tombol Inbox dan Tasks di header); Berkas, Foto & Disposisi (registry lama) dihapus
   dari sidebar, tetap terbuka lewat tautan darurat di layar terkait. Hanya frontend (`App.tsx`); unit lain tidak berubah.

### Perbaikan hasil review (2026-11-24)

Disetujui pemilik ("oke kerjakan dulu ya"). Commit `fix(subbagsumda): perbaikan hasil review keamanan R5H32`.

| # | Temuan | Perbaikan |
|---|---|---|
| S1 | Surat yang tertaut ke arsip TERBATAS menghilang dari pilihan surat dan ditolak 409; bila tidak ada arsip terlihat yang menautkannya, pemegang Ma+Ps bisa menyimpulkan "perihal surat ini adalah subjek arsip rahasia" (lebih dari yang tertulis di R8/K31) | **K51:** menautkan surat ke arsip TERBATAS — saat mencatat, mengganti tautan, atau menaikkan arsip bersurat ke TERBATAS — hanya oleh pemegang `arsip.restricted` (403). **Sisa yang diterima:** bila Kasubbag sendiri menautkan surat ke arsip TERBATAS, kesimpulan yang sama masih mungkin bagi pemegang Ma+Ps; kini hanya terjadi atas keputusan Kasubbag. Penutupan penuh hanya dengan melarang tautan surat pada arsip TERBATAS sama sekali (belum diambil) |
| S2 | Detail membaca surat tanpa syarat sah | `SURAT_SAH_SQL` ditambahkan; surat yang tidak lagi sah → `{hilang:true}` |
| S3 | `suratId` dikirim ke pemegang Ra tanpa Ps | `suratId` null bagi non-Ps, diganti `bertautSurat:boolean`; PATCH tanpa kunci `suratId` mempertahankan tautan (frontend tidak mengirimnya bila tanpa Ps) |
| S4 | Penangkal formula melewatkan `\n=`, spasi/NBSP di depan, `﹦` | Diperiksa juga setelah NFKC dan membuang spasi di depan; `\n` masuk daftar awalan |
| S5 | Ekspor tanpa batas waktu | Satu transaksi `REPEATABLE READ, READ ONLY` + `statement_timeout 10s` (timeout → 503) |
| S6 | Nama/NRP personel terkirim ke pemegang arsip/ekspor tanpa `personel.read` | **Diterima** (keputusan): semua role bawaan memegang `personel.read`; berlaku hanya untuk role kustom. Ringkasan dan ekspor modul personel tetap butuh `personel.read` |

Catatan review yang diterima apa adanya: kolom "Penilai" di ekspor kinerja adalah teks isian (nama pejabat penilai), bukan
nama petugas/akun — K41 berarti "tanpa nama akun pengguna"; ekspor yang ditolak 413 tidak diaudit (K21/K43); menaikkan arsip
orang lain ke TERBATAS (K34) tercatat di audit `subbagsumda.arsip.update` (`fields`).

Uji baru di x7: S1 (POST/PATCH tanpa Xa → 403, Xa → 201), S3 (`suratId` null + `bertautSurat` bagi Ra tanpa Ps; PATCH tanpa
`suratId` mempertahankan tautan; melepas tanpa Ps → 403), S2 (surat tidak lagi sah → `hilang`), S4 (data lama berawalan NBSP/
`﹦`/baris baru diberi `'`), unggah > 5 MB ke arsip tak terlihat → 404 (bukan 413), GET ringkasan/ekspor/unduh oleh
`must_change_password` → 403. Uji mutasi 6–9 (membuang syarat S1, mengirim `suratId` ke semua, membuang syarat sah S2,
membuang normalisasi S4): masing-masing **hanya x7 merah**.

Tidak ada endpoint beku yang berubah; `DEVIATIONS.md` tidak perlu entri baru.

### Sisa uji untuk /verifikasi

- `bash scripts/security-test-r2d5.sh` (suite Go; 073 ter-embed) — belum dijalankan di sesi implementasi.
- `npm run verify` Express + verify `r5h28`, `r5h29`, `r5h30` (regresi; `r5h27`, `r5h31`, `r5h32` sudah).
- Harness golden: 127 `/admin/permissions` dan 128 `/admin/roles` berubah karena 073 → **rekam ulang oleh pemilik**.
- CLAUDE.md (untuk pemilik): 126 tabel dari migrasi, 73 berkas SQL (`:186`, `:206-207`), suite Express 28/28 dengan
  x1–x7 (`:130-131`), "R5H11–R5H32" (`:20`).
- Deploy: centang **"Izinkan migrasi"** (073); rebuild `api`, `api-express`, `frontend`; cek `SDL_EVIDENCE_KEY` produksi.

## Rencana Implementasi

> Disusun 2026-11-24 dari kode di `main` (c4118b1, sudah memuat R5H27–R5H31; migrasi terakhir 072), sebelum kode ditulis.
> K1–K28 sudah disetujui. K29–K49 (§9) disetujui sementara pemilik 2026-11-24 ("oke lanjut ke /implementasi"). Semua klaim dokumen rilis sudah dicocokkan dengan
> kode, dan koreksinya ada di "Temuan yang mengoreksi dokumen rilis". "K43 R5H30" selalu berarti keputusan R5H30, bukan
> nomor di dokumen ini.

### 1. Backend: Express saja (ditambah migrasi 073, manifes, dan seed Go)

- Caddy meneruskan `@express path {$SDL_EXPRESS_PATHS}` ke `api-express:8080` (`infra/Caddyfile:39-42`).
  - Pola `/api/v1/subbagsumda/*` sudah mencakup `/arsip*` dan `/laporan*`, jadi **Caddyfile tidak berubah**.
  - Caddy tidak memasang batas `request_body`, jadi PDF 5 MB tetap utuh.
  - `encode zstd gzip` (`:23`) ikut memampatkan CSV. Itu tidak masalah karena header unduhan tetap utuh.
  - Persuratan R5H21 tetap di pola terpisah `/api/v1/persuratan/*`.
- Go tidak mendapat endpoint baru. Yang berubah di Go hanya:
  - `073_sumda_arsip_laporan.sql`. Berkas ini ter-embed, jadi image `api` harus di-rebuild.
  - Manifes `migrate_test.go:84`.
  - Permission di `cmd/seed-bagrenmin/main.go:55-57,61`.
- Pola yang diikuti:
  - `umum.js`: `PERMIT_SQL` (`:38-47`), `teks`/`tanggal`/`pilihan`/`idParam`, `HARI_INI`/`hariDari`, `makeHandle`, `HttpError`.
  - `lampiran.js`: `bacaPdf`/`bukaPdf`/`pasangHeaderUnduh`/`disposisi`.
  - `kinerja.js`: satu fragmen visibilitas (`boleh`, `TAMPAK`, `:57,83`) dan CTE `v` untuk filter/hitungan (`:239-242`).
  - `aset.js`: rumus tahap WIB tunggal (`tahapAsetSql`, `:48-52`).
  - `cuti.js`: kunci personel dan audit dengan daftar putih.
- **Modul persuratan R5H21 (`modules/persuratan/index.js`) tidak disentuh.** Arsip hanya **membaca** `sdl_surat_antar` dan
  `sdl_surat_antar_tujuan`, lalu mengunci baris surat (§5, K31).
- Deploy:
  - Migrasi dijalankan sebelum `up`.
  - Image Go baru menolak start bila 073 belum ada. Image lama tetap bisa start di DB yang sudah ber-073.
  - Tidak ada salinan data, jadi tidak perlu pra-cek data produksi.

### 2. Dampak kontrak API

- **142 endpoint beku tidak disentuh**, termasuk registry R5B, `/opsi-dropdown`, `/urmin/kode-arsip`, dan `GET /executive/v2/*`.
- **Persuratan R5H21 tidak berubah.** Bentuk, status, dan alurnya tetap. Arsip hanya membaca tabelnya, dan tidak ada kolom
  atau trigger yang ditambahkan ke tabel 064.
- Dua mount spesifik ditambahkan setelah `src/app.js:128`. `config` dibutuhkan untuk `evidenceKey`. `/capabilities`,
  `/surat-tertaut`, dan `/ekspor/:modul` didaftarkan sebelum `/:id`.
  ```js
  v1.use('/subbagsumda/arsip', operational, createSumdaArsipRouter({ pool, config }))
  v1.use('/subbagsumda/laporan', operational, createSumdaLaporanRouter({ pool }))
  ```
- **Tambahan terhadap tabel endpoint dokumen rilis** (Express-only, dicatat di API-CONTRACT):
  - `GET /laporan/capabilities` → `{canRead, canExport, modul:{personel,pensiun,karier,diklat,kompetensi,cuti,kesejahteraan,
    kinerja,aset,arsip}}`. Flag `modul` = hak ekspor per modul. Endpoint ini juga dipakai frontend mendeteksi rollback.
  - `GET /arsip/capabilities` mendapat `canTautSurat` (= `persuratan.read` di unit `subbagsumda`, K30).
  - `POST /arsip/:id/lampiran?peran=DOKUMEN|BA_MUSNAH` (bawaan `DOKUMEN`, K33).
  - `PATCH /arsip/:id` → 200 `{item:null, tersembunyi:true}` bila perubahan membuat arsip tidak lagi terlihat oleh pengubahnya
    (K34).
- **Penambahan pada endpoint R5H27** (Express-only). Field baru hanya dihitung di route GET, bukan di `ambil()`, jadi respons
  POST/PATCH personel tidak berubah.
  - `GET /personel/:id` (`personel.js:203-228`) → `item.arsip[]` `{id,nomor,jenis,perihal,tanggal,status,kerahasiaan,
    retensiSampai,tahapRetensi}`. Isinya maks. 50, hanya baris yang terlihat (K29), dan bernilai `null` bila pemanggil tidak
    memegang `arsip.read` (K45).
  - `GET /dashboard` (`personel.js:398-412`) → `totals.arsipRetensi30`. Angkanya dihitung atas baris yang terlihat, dan
    bernilai `null` tanpa `arsip.read` (K25/K36).
  - `personel.js` mengimpor `arsipPersonel` dan `arsipRetensi30Sql` dari `arsip.js`. **`arsip.js` tidak boleh mengimpor
    `personel.js`** karena akan membuat siklus impor (pelajaran R5H29). `laporan.js` boleh mengimpor semua modul, tetapi
    tidak satu pun modul mengimpor `laporan.js`.
- **Ekspor adalah respons non-JSON pertama di Sumda:** `200 text/csv` (K43/K44). Galatnya tetap JSON
  `{error}`: 400/403/404/413.
- **Kode galat baru:**

  | Kode | Status | Kapan |
  |---|---|---|
  | `surat_tidak_berlaku` | 400 | Surat bukan milik/terima Sumda, belum dikirim, atau belum diterima |
  | `surat_sudah_diarsip` | 409 | Surat sudah ditautkan ke arsip lain |
  | `lampiran_wajib` | 409 | Musnahkan tanpa BA |
  | `terlalu_banyak` | 413 | Ekspor melebihi batas baris |

  Kode yang dipakai ulang: `invalid_body`/`invalid_input`/`invalid_file_type`/`one_file_required`/`file_too_large`/
  `access_denied`/`not_found`/`version_conflict`/`status_tidak_sesuai`/`batas_lampiran`/`personel_terarsip`/`evidence_*`/
  `database_unavailable`. `makeHandle()` tidak mendapat kunci `extra` baru.
- **`API-CONTRACT.md`:** tambahkan bagian `## R5H32 …` setelah `:1913` dengan format § R5H31:
  - tabel endpoint dan notasi hak
  - galat
  - audit
  - visibilitas arsip Terbatas
  - analitik per blok
  - format CSV
  - aditif R5H27
  - rollback

  Tambahkan juga rujukan silang di baris R5H27 `GET /personel/:id` dan `/dashboard`. Rollback sempit § R5H31
  (`:1909-1912`) ditandai **"Usang sejak R5H32"** (belum memuat `/arsip*` dan `/laporan*`), sama seperti `:1697`, `:1742`,
  `:1798`, dan `:1855`.

### 3. Rollback ke Go

| Yang di-rollback | Akibat |
|---|---|
| `/api/v1/subbagsumda/*` dicabut dari `SDL_EXPRESS_PATHS` + `--force-recreate caddy` (`admin off`) | `/arsip*` dan `/laporan*` dijawab chi 404 `text/plain`. Modul Sumda R5H27–R5H31 juga 404 (sudah ditangani) |
| Frontend: Persuratan & Arsip / Laporan & Analitik | `makeApi` (`SumdaBersama.tsx:40`) melempar `TidakTersedia` dari `/arsip/capabilities` dan `/laporan/capabilities`. Layar menampilkan "Persuratan & Arsip tidak tersedia" / "Laporan & Analitik tidak tersedia" **tanpa cadangan** (tidak ada padanan lama). Kartu dashboard dan bagian "Arsip dokumen" di detail personel tidak tampil (field `undefined`) |
| Hanya `/api/v1/persuratan/*` yang di-rollback | Arsip tetap jalan karena membaca DB langsung. Tautan "Buka di Surat Masuk/Keluar" mendarat di layar R5H21 yang sudah menampilkan "tidak tersedia". Pilihan surat (`/arsip/surat-tertaut`) tetap jalan karena hanya membaca tabel 064 |
| Rollback sempit (pola baru, menggantikan § R5H31) | `/api/v1/subbagsumda/personel* /api/v1/subbagsumda/pensiun/* /api/v1/subbagsumda/dashboard /api/v1/subbagsumda/karier* /api/v1/subbagsumda/diklat* /api/v1/subbagsumda/kompetensi* /api/v1/subbagsumda/cuti* /api/v1/subbagsumda/kesejahteraan* /api/v1/subbagsumda/kinerja* /api/v1/subbagsumda/aset* /api/v1/subbagsumda/arsip* /api/v1/subbagsumda/laporan* /api/v1/subbagsumda/opsi-dropdown/*` |
| Data dan skema | Tabel 073 diam, tanpa dual-write, dan skema tidak perlu dibalik. Tidak ada data lama yang perlu disalin balik |

### 4. Migrasi `073_sumda_arsip_laporan.sql`

- Migrasi terakhir saat ini adalah 072 (`migrate_test.go:84`, `src/migrations/index.js:123`).
- R5H15 menjadi **074** (K28): ubah `docs/R5H15-RIWAYAT-VERSI-DOKUMEN.md:12,106,169`.
- `MIGRATION-PLAN.md:16` menjadi "049–073", ditambah R5H32.
- Hanya aturan struktural (K27, prinsip K43 R5H30):
  - daftar jenis/status/kerahasiaan/peran
  - syarat kolom Musnah
  - isi lampiran `SDL1`
  - FK RESTRICT ke personel dan user
- Aturan bisnis ada di §5: peta status, Musnah hanya dari Inaktif, BA wajib, satu surat satu arsip, batas ekspor, dan
  `retensi_sampai ≥ tanggal`.

**Keputusan FK `surat_id`: TANPA FK** (pola `source_registry_id` 068/072):
- Harness `seed-docs` tidak menyebut `sdl_surat_antar` di `DOCUMENT_TABLES` (`harness/seed-documents.js:244-297`).
- Tetapi tabel itu tetap ikut dikosongkan: `TRUNCATE … sdl_urmin_registry … CASCADE` (`:278`, `:492`) merambat ke
  `sdl_surat_antar` lewat FK `urmin_registry_id` (`064:21`).
- Dengan FK, rambatan yang sama akan **mengosongkan seluruh `sdl_sumda_arsip`** (beserta riwayat dan lampirannya) setiap kali
  harness dijalankan. Data [UJI] lokal hilang, dan prosedur rekam golden menjadi berbahaya.
- Akibat tanpa FK: `surat_id` bisa yatim. Detail arsip memakai `LEFT JOIN` dan menampilkan `surat:{hilang:true}`. Validitas
  saat menautkan dicek di Express di bawah kunci baris surat (K31).

**Keputusan FK `personel_id`: FK `ON DELETE RESTRICT`, opsional.**
- Personel tidak pernah di-DELETE (arsip personel = `deleted_at`), dan `sdl_sumda_personel` tidak ikut TRUNCATE harness.
- Indeks parsial dipakai untuk detail personel (K24).

```sql
-- R5H32 (2026-11-24): Subbagsumda Persuratan & Arsip (register arsip dokumen) + Laporan & Analitik. Express saja.
-- Hak lewat permission pada grant unit 'subbagsumda' (pola 068-072). Kerahasiaan Biasa/Terbatas diputus di SQL Express.
-- Prinsip K43 R5H30: hanya aturan STRUKTURAL. Peta status, BA wajib saat Musnah, satu surat satu arsip,
-- dan batas ekspor ditegakkan di Express.

CREATE TABLE sdl_sumda_arsip (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 nomor VARCHAR(120) NOT NULL DEFAULT '',
 jenis VARCHAR(16) NOT NULL
   CHECK (jenis IN ('SURAT_MASUK','SURAT_KELUAR','NOTA_DINAS','SURAT_KEPUTUSAN','BERITA_ACARA','LAINNYA')),
 perihal VARCHAR(240) NOT NULL CHECK (length(btrim(perihal)) BETWEEN 3 AND 240),
 tanggal DATE NOT NULL,
 asal_tujuan VARCHAR(200) NOT NULL DEFAULT '',
 kode_klasifikasi VARCHAR(60) NOT NULL DEFAULT '',
 lokasi_simpan VARCHAR(200) NOT NULL DEFAULT '',
 retensi_sampai DATE,
 kerahasiaan VARCHAR(8) NOT NULL DEFAULT 'BIASA' CHECK (kerahasiaan IN ('BIASA','TERBATAS')),
 catatan VARCHAR(2000) NOT NULL DEFAULT '',
 personel_id UUID REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 surat_id UUID,                                   -- TANPA FK: TRUNCATE CASCADE harness merambat ke sdl_surat_antar
 status VARCHAR(8) NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif','Inaktif','Musnah')),
 musnah_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 musnah_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_arsip_musnah CHECK (((status = 'Musnah') = (musnah_by IS NOT NULL))
   AND ((musnah_by IS NULL) = (musnah_at IS NULL)))
);
CREATE INDEX sdl_sumda_arsip_daftar_idx ON sdl_sumda_arsip(tanggal DESC, created_at DESC);
CREATE INDEX sdl_sumda_arsip_status_idx ON sdl_sumda_arsip(status, jenis);
CREATE INDEX sdl_sumda_arsip_retensi_idx ON sdl_sumda_arsip(retensi_sampai)
 WHERE status IN ('Aktif','Inaktif') AND retensi_sampai IS NOT NULL;
CREATE INDEX sdl_sumda_arsip_personel_idx ON sdl_sumda_arsip(personel_id) WHERE personel_id IS NOT NULL;
-- Bukan UNIQUE: satu surat satu arsip adalah aturan bisnis K27/K31 (kunci baris surat di Express).
CREATE INDEX sdl_sumda_arsip_surat_idx ON sdl_sumda_arsip(surat_id) WHERE surat_id IS NOT NULL;

CREATE TABLE sdl_sumda_arsip_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 arsip_id UUID NOT NULL REFERENCES sdl_sumda_arsip(id) ON DELETE CASCADE,
 dari VARCHAR(8) CHECK (dari IN ('Aktif','Inaktif','Musnah')),
 ke VARCHAR(8) NOT NULL CHECK (ke IN ('Aktif','Inaktif','Musnah')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_arsip_riwayat_idx ON sdl_sumda_arsip_riwayat(arsip_id, id);

CREATE TABLE sdl_sumda_arsip_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 arsip_id UUID NOT NULL REFERENCES sdl_sumda_arsip(id) ON DELETE RESTRICT,
 peran VARCHAR(10) NOT NULL DEFAULT 'DOKUMEN' CHECK (peran IN ('DOKUMEN','BA_MUSNAH')),
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_arsip_lampiran_idx ON sdl_sumda_arsip_lampiran(arsip_id, uploaded_at);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.arsip.read', 'Lihat register arsip dokumen Subbagsumda'),
 ('subbagsumda.arsip.manage', 'Catat dan kelola arsip dokumen Subbagsumda'),
 ('subbagsumda.arsip.restricted', 'Lihat dan kelola arsip Terbatas Subbagsumda milik pencatat lain'),
 ('subbagsumda.laporan.export', 'Unduh data Subbagsumda sebagai berkas CSV')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda','subbagsumda.arsip.read'), ('br_op_subbagsumda','subbagsumda.arsip.manage'),
    ('br_staf_subbagsumda','subbagsumda.arsip.read'), ('br_staf_subbagsumda','subbagsumda.arsip.manage'),
    ('br_kasubbagsumda','subbagsumda.arsip.read'), ('br_kasubbagsumda','subbagsumda.arsip.manage'),
    ('br_kasubbagsumda','subbagsumda.arsip.restricted'), ('br_kasubbagsumda','subbagsumda.laporan.export'),
    ('br_kabagrenmin','subbagsumda.arsip.read'), ('br_kabagrenmin','subbagsumda.arsip.restricted'),
    ('br_kabagrenmin','subbagsumda.laporan.export')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;
```

**Lolos pemeriksa substring** (`migrate_test.go:109-155`):
- Tidak ada `UPDATE␠`: `updated_*` tidak cocok, dan deskripsi tidak memuat "update".
- Tidak ada `DELETE FROM` (`ON DELETE …` tidak cocok) dan tidak ada `ALTER TABLE`.
- Tidak ada `;` atau `--` di dalam literal. Komentar `--` di akhir baris dipotong pemeriksa.
- Daftar `ALTER TABLE` yang ditinjau tidak perlu diubah.

**Lampiran RESTRICT, riwayat CASCADE** (pelajaran R5H29): verify membersihkan lampiran lebih dulu.

**Seed:** empat permission ditambahkan secara identik ke `cmd/seed-bagrenmin/main.go:55-57,61` dan
`src/cli/seed-bagrenmin.js:61-63,67`.
- op/staf: `arsip.read`, `arsip.manage`.
- Kasubbag: keempatnya.
- Kabagrenmin: `arsip.read`, `arsip.restricted`, `laporan.export`, **tanpa** `manage`.
- Seed menolak permission yang belum ada. Produksi mendapat permission lewat INSERT di migrasi.

**Gladi** (073 tidak bisa diperbaiki setelah commit):
1. `pg_dump -Fc` DB lokal ke scratchpad.
2. Jalankan `--migrate` Express, start Go, `go test ./internal/migrations/`, dan diff seed Go ↔ Express (harus kosong).
3. Uji CHECK manual:
   - Musnah tanpa `musnah_by`, `musnah_by` tanpa `musnah_at`, Aktif dengan `musnah_by`
   - jenis/kerahasiaan/peran di luar daftar
   - perihal 2 karakter
   - `body` tanpa `SDL1`
   - `personel_id` fiktif (23503)
4. **Uji rambatan harness:** `TRUNCATE sdl_urmin_registry CASCADE` di salinan dump. `sdl_sumda_arsip` harus **tetap utuh** dan
   `surat_id` menjadi yatim. Ini membuktikan keputusan tanpa FK.
5. Pulihkan dump, **baru commit**.

Angka CLAUDE.md (oleh pemilik):
- `:206` menjadi **126 tabel** dari migrasi (+ `sdl_schema_migrations`).
- `:186` dan `:207` menjadi **73 berkas SQL**.
- `:130` menjadi suite Express **28/28**.

### 5. Otorisasi

**Bukan Engine A (access/policy) dan bukan Engine B (`unitwork.permit`).**
- Guard `AuthorizeOperational`, lalu `PERMIT_SQL` (`umum.js:38-47`) lewat `SELECT EXISTS` sebelum query data. Syaratnya:
  grant aktif unit `subbagsumda`, role aktif bukan Superadmin, user aktif dengan `NOT must_change_password`, dan permission
  role.
- Scope dan `classification_limit` tidak dipakai (K26).
- Kerahasiaan arsip **seluruhnya diputus di SQL**, tidak pernah setelah SELECT.

| Hak | Permission | Role (seed) |
|---|---|---|
| R | `subbagsumda.personel.read` (ada) | op, staf, kasubbag, kabagrenmin |
| Ra / Ma / Xa | `subbagsumda.arsip.read` / `.manage` / `.restricted` | op, staf, kasubbag, kabag / op, staf, kasubbag / kasubbag, kabag |
| E | `subbagsumda.laporan.export` | kasubbag, kabag |
| Ps | `persuratan.read` (064) pada grant `subbagsumda` | op, staf, kasubbag, kabag |
| Rk / Ri | `subbagsumda.kinerja.read` / `subbagsumda.inventaris.read` (ada) | kasubbag + kabag / op, staf, kasubbag, kabag |

**Arsip Terbatas: satu predikat visibilitas di SQL** (`arsip.js`, menggantikan placeholder di Alur butir 1, lihat K29):
- `const boleh = (actor, xa) => \`(a.kerahasiaan='BIASA' OR a.created_by=${actor}::uuid OR ${xa}::boolean)\``.
  - `xa` adalah hasil `PERMIT_SQL` untuk Xa yang dikirim sebagai parameter boolean (preseden `kinerja.js:220-222`).
  - Hanya `boleh` yang diekspor. Tidak ada salinan predikat di modul lain.
- **Semua jalur baca** memakai CTE `WITH v AS (SELECT … FROM sdl_sumda_arsip a … WHERE ${boleh})`. Filter `q` (nomor, perihal,
  asal/tujuan, kode), jenis, status, tahun, kerahasiaan, `retensi=1`, urutan, dan `count(*)` dijalankan atas `v`. Jalur itu
  adalah:
  - daftar
  - detail
  - riwayat
  - lampiran (daftar dan unduh)
  - `arsipPersonel()` (K24)
  - `arsipRetensi30Sql()` (dashboard)
  - blok arsip analitik
  - ekspor arsip
  - info surat di detail
- Akibatnya, baris Terbatas milik orang lain **tidak ada** bagi akun itu: tidak muncul di daftar, tidak dihitung, dan tidak
  bisa dicari.
- Detail, unduh, PATCH, aksi, dan lampiran atas baris itu → **404 `not_found`**, identik dengan UUID fiktif. Jadi 403 vs 404
  tidak membocorkan keberadaannya.
- **Mutasi:** `kunci(c, id, actor, xa)` = `SELECT … FROM sdl_sumda_arsip a WHERE a.id=$1 AND ${boleh} FOR UPDATE`. `rowCount=0`
  → 404 **sebelum** status, versi, atau isian divalidasi.
- **Kerahasiaan (K13/K34):**
  - Biasa→Terbatas boleh oleh siapa pun dengan Ma yang bisa melihat arsip itu.
  - Terbatas→Biasa butuh Ma + Xa, kalau tidak 403 `access_denied` (pencatat tanpa Xa sudah bisa melihatnya, jadi 403 tidak
    membocorkan apa pun).
- **Surat tertaut (K30/K31):**
  - `GET /arsip/surat-tertaut` dan `suratId` di POST/PATCH butuh Ma **dan** Ps, kalau tidak 403.
  - Surat dinilai sah lewat satu fragmen `SURAT_SAH_SQL`, yaitu `s.status='dikirim' AND (s.unit_pengirim='subbagsumda' OR
    EXISTS(SELECT 1 FROM sdl_surat_antar_tujuan t WHERE t.surat_id=s.id AND t.unit_key='subbagsumda' AND
    t.diterima_at IS NOT NULL))`.
  - Info surat di detail (`{id,arah,nomor,tanggal,perihal,unitPengirim}`) hanya untuk pemanggil yang memegang Ps. Lainnya
    `{dibatasi:true}`. Surat yatim → `{hilang:true}`.
- **Aksi:**

  | Aksi | Dari | Ke | Hak |
  |---|---|---|---|
  | `inaktifkan` | Aktif | Inaktif | Ma (+ `boleh`). Catatan opsional ≤ 1000 |
  | `aktifkan` | Inaktif | Aktif | Ma (+ `boleh`) |
  | `musnahkan` | **Inaktif** (K32) | Musnah (`musnah_by/at`) | Ma **dan** Xa. Alasan ≥ 8 masuk riwayat. Tanpa ≥ 1 lampiran `peran='BA_MUSNAH'` → 409 `lampiran_wajib`. Dari Aktif → 409 `status_tidak_sesuai` |

  Musnah bersifat final: PATCH, aksi, unggah, dan hapus lampiran → 409 `status_tidak_sesuai`. Baca dan unduh tetap boleh (K9).
- **Lampiran (K12/K33):**
  - Unggah: Ma + `boleh`, status bukan Musnah, maks. 10 (409 `batas_lampiran`).
  - Hapus: Ma + `boleh` + (pengunggah atau Xa).
  - Unduh: Ra + `boleh`, memakai `JOIN sdl_sumda_arsip a … WHERE l.id=$1 AND l.arsip_id=$2 AND ${boleh}`, jadi id silang →
    404.
  - Header dipasang sebelum audit unduhan (review R5H28 S1).
- **Analitik:** setiap blok dihitung hanya bila pemanggil memegang hak modulnya, kalau tidak `null` (K37). Ringkasan butuh R.
- **Ekspor:** butuh E **dan** hak baca modulnya (K42), dicek sebelum validasi query. Kolom tersamar diambil dari fragmen modul
  asal:
  - kinerja memakai `kolomKinerja` + `TAMPAK` + `boleh` (diekspor aditif dari `kinerja.js`); non-Rk hanya mendapat barisnya
    sendiri
  - arsip memakai `boleh`
  - modul lain tidak memuat kolom tersamar (K41)
- **Audit** (K49), metadata daftar putih:
  - `subject_type='subbagsumda.arsip'`, event `create|update|inaktifkan|aktifkan|musnahkan|lampiran.add|lampiran.delete|
    lampiran.download`, metadata `{status,jenis,kerahasiaan,fields,version}`. Tanpa nomor, perihal, personel, nama berkas,
    atau catatan.
  - `subbagsumda.laporan.export` dengan `subject_type='subbagsumda.laporan'`, `subject_id`=modul, dan metadata
    `{modul,jumlah,filter}`. `filter` hanya memuat kunci enum/bilangan yang lolos validasi (`tahun,status,jenis,tahap`).
- **Urutan kunci tetap: arsip → surat → personel.** Persuratan hanya mengunci surat/tujuan, dan personel R5H27 hanya mengunci
  personel. Tidak ada jalur yang mengunci personel lalu arsip, jadi tidak ada siklus.

  | Jalur | Urutan |
  |---|---|
  | POST arsip | surat `FOR NO KEY UPDATE` (bila `suratId`) → cek sah + `NOT EXISTS` arsip lain → personel `FOR SHARE` (tolak terarsip) → INSERT |
  | PATCH arsip | arsip `FOR UPDATE` → surat `FOR NO KEY UPDATE` (bila berubah) → personel `FOR SHARE` (bila berubah) |
  | Aksi, lampiran | arsip `FOR UPDATE` saja |
  | Analitik | satu transaksi `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY` + `SET LOCAL statement_timeout='5s'`, tanpa kunci baris |

### 6. Berkas dibuat/diubah

**Express**
- `src/modules/subbagsumda/arsip.js` (baru):
  - `createSumdaArsipRouter`, `JENIS_ARSIP`, `STATUS_ARSIP`, `KERAHASIAAN`, `PERAN_LAMPIRAN`.
  - `bolehArsip(actor, xa)`, `KOLOM_ARSIP`, `tahapRetensiSql(alias = 'a', hari = HARI_INI)` (K35, satu-satunya rumus),
    `arsipRetensi30Sql(actor, xa)`, `arsipPersonel(db, personelId, actor, xa)`, `SURAT_SAH_SQL`.
  - Route: capabilities, daftar, surat-tertaut, CRUD, aksi, dan lampiran.
  - `handle = makeHandle()`.
- `src/modules/subbagsumda/csv.js` (baru, tanpa dependensi):
  - `sel(v)`:
    - `null`/`undefined` → kosong
    - bilangan dari kode → apa adanya
    - teks → penangkal formula (K44), lalu `"`→`""`, **selalu** dibungkus `"…"`
  - `barisCsv(cells)` digabung dengan `;`.
  - `berkasCsv(header, rows)` = `Buffer.concat([BOM EF BB BF, utf8(header + rows, CRLF)])`.
  - `pasangHeaderCsv(res, nama)`:
    - `Content-Type: text/csv; charset=utf-8`
    - `Content-Disposition` lewat `disposisi()` (`lampiran.js:25`), nama ASCII dari daftar putih modul + tanggal WIB, tidak
      pernah dari request
    - `X-Content-Type-Options: nosniff`
    - `Content-Security-Policy: sandbox`
    - `Cache-Control: no-store`
- `src/modules/subbagsumda/ekspor.js` (baru):
  - `MODUL_EKSPOR`: peta modul → `{hak, filter:{tahun?,status?,jenis?,tahap?}, header, sql(args), baris(r)}` untuk 10 modul
    K18 (tabel K42).
  - `BATAS_EKSPOR = 10000`.
  - Query memakai `LIMIT 10001`; lebih dari 10.000 baris → 413 `terlalu_banyak` sebelum satu byte pun dikirim.
  - **Buffer, bukan stream** (K43): tanpa `pg-cursor` (tidak ada dependensi baru), jumlah baris pasti untuk audit, dan galat
    bisa dijawab JSON.
- `src/modules/subbagsumda/laporan.js` (baru):
  - `createSumdaLaporanRouter`: `GET /capabilities`, `GET /ringkasan?tahun=`, `GET /ekspor/:modul`.
  - Urutan ekspor:
    1. `need(E)` → `need(hak modul)`
    2. validasi query: kunci asing → 400; modul tak dikenal → 404 `not_found` JSON
    3. SELECT → CSV dalam memori
    4. `pasangHeaderCsv`
    5. **audit dalam transaksi tersendiri; gagal → 503 tanpa data**
    6. `res.end(buf)`
  - 403/404/413 tidak diaudit.
  - Fungsi SQL agregat per blok (K37–K40), masing-masing menerima `hari = HARI_INI`. Kartu memakai fungsi yang sama dengan
    grafiknya. Tidak ada salinan rumus tahap: `tahapSql`, `tahapAsetSql`, `tahapRetensiSql`, dan `boleh*` diimpor.
- Ekspor aditif (string SQL yang sudah ada **tidak berubah**):
  - `kinerja.js`: `export` untuk `boleh` dan `TAMPAK`.
  - `personel.js`: `proyeksiPensiunSql(bulan, hari = HARI_INI)`, diekstrak dari `:381-386`. Dashboard memanggilnya dengan
    `bulan=6`, dan string yang dihasilkan harus identik (diuji).
- `personel.js`: `item.arsip` di `GET /:id` (K45) dan `totals.arsipRetensi30` di `/dashboard`.
- `src/app.js`: dua mount (§2).
- `src/migrations/index.js:123` dan `src/cli/seed-bagrenmin.js:61-63,67`.
- `payload.js` tidak berubah (`SUMDA` 32 KB, `SUMDA_LAMPIRAN`).
- `verify/r5h32-sumda-arsip-laporan.js`, `security/scenarios/r5h32.js`, dan `security/index.js:75`
  (`x7_r5h32_sumda_arsip_laporan_guard` setelah `x6_`).

**Go:** `internal/migrations/sql/073_sumda_arsip_laporan.sql`, `internal/migrations/migrate_test.go:84`,
`cmd/seed-bagrenmin/main.go:55-57,61`.

**Frontend** (ikuti `docs/DESIGN-BRIEF.md`; tanpa pustaka chart atau dependensi baru)
- `SumdaArsipR5H32.tsx` (baru):
  - Daftar dengan filter jenis/status/tahun/kerahasiaan/"retensi mendekat" dan cari. Tanda retensi (`H-30`/`JATUH_TEMPO`)
    dan ikon `lock` untuk Terbatas.
  - Form K8:
    - `CariPersonel statusAktif={false}`
    - pemilih surat dari `/arsip/surat-tertaut`, hanya bila `canTautSurat`; memilih surat mengisi nomor/tanggal/perihal/
      asal-tujuan/jenis di form (disimpan sebagai isian arsip sendiri)
    - saran kode klasifikasi dari `/api/v1/urmin/kode-arsip` (teks bebas tetap boleh, K8)
  - Detail:
    - data
    - blok surat ("Buka di Surat Masuk/Keluar" → `navigate({menu:'__surat-masuk'|'__surat-keluar',recordID})`, App.tsx:619
      menerima `initialID`)
    - `LampiranPdf` untuk dua peran
    - riwayat
    - `AlasanDialog` untuk musnahkan, dengan petunjuk "unggah BA pemusnahan dulu"
  - `?id=` divalidasi dengan UUID. Prop `legacy` kosong, jadi rollback menampilkan "tidak tersedia".
- `SumdaLaporanR5H32.tsx` (baru):
  - Pilihan tahun (bawaan tahun berjalan dari server).
  - Kartu K15. Blok `null` tidak dirender (bukan nol, K16).
  - Grafik batang memakai ulang kelas `sdl-sumda__bars`/`sdl-sumda__bar` (`SumdaPersonelR5H27.css:67-71`) dengan modifier
    `--label` untuk label panjang (unit kerja/pangkat).
  - Tabel register.
  - Panel "Unduh data" hanya bila `canExport`. Satu tombol per modul `modul[x]===true` memanggil `fetch → blob →
    createObjectURL`; nama berkas diambil dari `Content-Disposition` (pola `SuratR3B.tsx:28-29`). 413 → pesan "Terlalu
    banyak baris, persempit dengan filter tahun".
  - Tombol "Cetak": `document.body.classList.add('sdl-cetak-laporan')` → `window.print()` → hapus pada `afterprint`.
- `SumdaR5H32.css` (baru):
  - Gaya layar.
  - `@media print` yang **dicakup** `body.sdl-cetak-laporan` (sembunyikan header, sidebar, panel unduh, tombol) supaya CSS
    global Vite tidak memengaruhi cetak halaman lain (pola terbatas `LraDashboardR5H24.css:110`).
- `SumdaPersonelR5H27.tsx`:
  - `SumdaNav` (`:53`) ditambah `'arsip' | 'laporan'`.
  - Tipe `totals` (`:48`) ditambah `arsipRetensi30?: number | null`. `DashboardView` mendapat kartu "Arsip retensi ≤ 30 hari"
    (hanya bila `typeof === 'number'`) dan tautan "Laporan & Analitik".
  - `DetailDialog` (`:322`) mendapat bagian "Arsip dokumen" bila `p.arsip` berupa array.
- `App.tsx`:
  - Setelah `inventaris` (`:165`): `{id:'arsip',title:'Persuratan & Arsip',icon:'archive',…}` dan
    `{id:'laporan',title:'Laporan & Analitik',icon:'chart',…}`.
  - Cabang render dekat `:612-613`, selalu dengan `unit.id==='sumda'` lebih dulu supaya tidak tertukar dengan `arsip` Urmin
    (`:614`) dan `laporan` Subbagren (`:624`).
  - Tidak ada ikon baru: `archive` dan `chart` sudah ada di `IconName` (`:48`). `RouteR5H26.ts` tidak berubah.
  - Menu Surat Masuk/Keluar R5H21 (`:505-509`) tidak berubah (K5).

**Docs:**
- dokumen ini
- `API-CONTRACT.md` (§2)
- `MIGRATION-PLAN.md:16`
- `R5H15-…md:12,106,169` (→ 074)
- `docs/R2D5-SECURITY-TESTS.md` (x7, 28/28, uji mutasi)
- catatan sesi

Untuk pemilik: CLAUDE.md (126 / 73 / 28/28) dan memori R5H15 → 074.

### 7. Pengujian

**`verify/r5h32-sumda-arsip-laporan.js`** mengikuti pola `verify/r5h31-…`.
- Data uji memakai awalan `UJI-R5H32-`.
- Pembersihan berurutan: lampiran, riwayat, arsip, audit, surat uji, personel.

0. **Rumus WIB** lewat `hariDari('$1')`:
   - Stempel `2026-11-23T17:00:00Z` (= 24 Nov WIB): retensi 24 Nov → `JATUH_TEMPO`; 25 Nov dan 24 Des → `H-30`; 25 Des → null;
     Musnah → null.
   - Stempel `2026-12-31T17:00:00Z`: tahun bawaan 2027; kesejahteraan dibuat pada stempel itu masuk tahun 2027 (WIB).
   - `proyeksiPensiunSql(6)` identik dengan string dashboard lama.
1. **Capabilities** per akun: op, staf, Kasubbag, Kabag, unit lain. `canTautSurat` mengikuti Ps.
2. **CRUD K8:**
   - batas panjang, jenis di luar daftar, tanggal tidak ada, `retensiSampai < tanggal` → 400
   - personel terarsip baru → 409, personel terarsip lama dipertahankan → 200
   - nomor ganda boleh (K48)
3. **Terbatas K29 (inti):** staf membaca Terbatas milik op.
   - Tidak muncul di daftar, `?q=<perihal>`, `?kerahasiaan=TERBATAS`, `?retensi=1`, atau `total`.
   - Detail, unduh lampiran, PATCH, aksi, unggah → 404 dengan badan **byte-identik** dengan UUID fiktif.
   - Detail personel `arsip[]` tidak memuatnya. `totals.arsipRetensi30` dan blok arsip analitik **tidak berubah** (selisih 0)
     saat op menambah Terbatas beretensi dekat.
   - Pencatat, Kasubbag, dan Kabag menerimanya. Kabag tidak bisa memutasi.
4. **K13/K34:**
   - staf menaikkan Biasa milik op → 200 `{item:null,tersembunyi:true}` dan sesudahnya 404
   - pencatat tanpa Xa menurunkan → 403
   - Kasubbag menurunkan → 200
5. **Status:**
   - Aktif ⇄ Inaktif.
   - Musnahkan dari Aktif → 409. Tanpa BA → 409 `lampiran_wajib`. Oleh Ma tanpa Xa → 403.
   - Dengan BA → Musnah. Setelah itu PATCH, aksi, unggah, hapus → 409; unduh → 200.
   - CHECK diuji dengan UPDATE langsung (23514).
6. **Tautan surat K30/K31** (surat uji dibuat lewat SQL langsung atau API persuratan):
   - Surat unit lain, draft/diajukan/disetujui/ditolak, atau masuk belum diterima → 400 `surat_tidak_berlaku`.
   - Keluar Sumda dikirim atau masuk sudah diterima → 201.
   - Ganda → 409 `surat_sudah_diarsip` (termasuk ke arsip Musnah).
   - **Balapan:** dua POST bersamaan → satu 201 dan satu 409.
   - Tanpa Ps → 403.
   - Surat dihapus lewat SQL → detail `surat.hilang`.
   - `surat-tertaut` mengecualikan surat yang sudah diarsip.
7. **Lampiran:**
   - byte-identik, `body` diawali `SDL1`, peran tersimpan
   - berkas ke-11 → 409; terenkripsi/rusak → 400
   - id silang arsip ↔ aset ↔ kinerja → 404
   - `body` dirusak → 503
   - hapus oleh bukan pengunggah tanpa Xa → 403
8. **Aditif R5H27:**
   - `arsip[]` dan `arsipRetensi30` sebagai selisih.
   - Akun tanpa Ra (role uji) → `null`.
   - POST/PATCH personel tidak membawa field baru.
9. **Analitik:**
   - Setiap angka cocok dengan SQL acuan yang ditulis ulang di verify.
   - Staf → `kinerja: null`. Role tanpa Ri → `aset: null`. Role tanpa Ra → `arsip: null`.
   - Unit kerja `''` → "Belum diisi", 16 unit → 15 + Lainnya.
   - Pangkat Polri terurut `sort_order`.
10. **Ekspor:**
    - Matriks hak (op/staf 403; Kasubbag dan Kabag 200).
    - Isi berkas:
      - 3 byte BOM, CRLF, `;`, semua sel berkutip
      - `"` digandakan
      - sel `=1+1`, `+x`, `-x`, `@x` → `"'=1+1"` dst.
      - jumlah baris = `total` daftar dengan filter yang sama
      - header 10 modul sama dengan konstanta
    - Tidak ada UUID, hash, nama berkas, atau nama petugas (regex UUID atas seluruh isi).
    - Kinerja lengkap bagi Kasubbag; role E+R tanpa Rk → hanya barisnya sendiri.
    - Arsip Terbatas ikut bagi Kasubbag; role E+Ra tanpa Xa → tidak ikut.
    - Param asing → 400; modul tak dikenal → 404 JSON.
    - Header: `Content-Type`, `Content-Disposition` persis `sumda-<modul>-<YYYYMMDD WIB>.csv`, `no-store`, `nosniff`.
11. **Audit tanpa PII:** arsip tanpa perihal/nomor; ekspor tepat `{modul,jumlah,filter}`; 413 dan 403 tidak tercatat.
12. **Regresi:** `verify/r5h27-*` sampai `r5h31-*` (karena `personel.js` dan `kinerja.js` berubah).

**Skenario `x7_r5h32_sumda_arsip_laporan_guard`** (`security/scenarios/r5h32.js`):
- **Di awal:** memundurkan stempel CAPTCHA seperti x6 (`r5h31.js:49-51`), karena 28 skenario berjalan < 1 menit dan batas
  60/menit per IP.
- **Guard:** anonim 401. Superadmin 403 (termasuk app demo) untuk semua metode di `/arsip*` dan `/laporan*`, termasuk
  `/laporan/ekspor/personel`. UUID fiktif 404.
- **Capabilities:** unit lain, tanpa keanggotaan, dan Superadmin demo → semua `false`.
- **Matriks:**
  - Ra-saja tidak bisa memutasi.
  - Ma tanpa Ps → 403 di `surat-tertaut` dan POST `suratId`.
  - Ma tanpa Xa → 403 `musnahkan`.
  - Ra+Xa+E (pola Kabag) tidak bisa memutasi.
  - E tanpa hak modul → 403 (aset tanpa Ri). E+R tanpa Rk → kinerja hanya barisnya sendiri.
- **Terbatas dibatasi:** daftar, `q`, filter, hitungan, detail/lampiran/mutasi 404 identik, detail personel, dashboard,
  analitik, ekspor tanpa Xa.
- **Ekspor:** hanya E; formula injection; BOM dan `;`; `terlalu_banyak` (10.001 personel lewat `generate_series` di DB uji
  sekali pakai → 413 tanpa audit).
- **CSRF/Origin** JSON dan multipart (multipart tanpa CSRF, keterbatasan D6 R5H28).
- **Bentuk:** field asing, `__proto__`, Cf, NUL, JSON > 32 KB, `version` bukan bilangan. Probe query: `tahun=abc`, `size=7`,
  `retensi=2`, `kerahasiaan=X`, `peran=X`, param asing di ekspor.
- **Pencabutan:** grant kedaluwarsa, role nonaktif, `must_change_password`, grant dicabut → 403.
- **Kunci evidence kosong** → 503.
- **Uji mutasi** (berkas dipulihkan setiap kali, masing-masing harus **hanya x7 merah**):
  1. `${boleh}` dihapus dari CTE daftar arsip.
  2. `${boleh}` dihapus dari SQL unduh lampiran arsip.
  3. `need(E)` dihapus dari ekspor.
  4. Penangkal formula di `csv.js` dihapus.
  5. Syarat Xa dihapus dari `musnahkan`.
- Suite Express **28/28** (21 + x1…x7). Suite Go `security-test-r2d5.sh` tetap dijalankan karena 073 ter-embed.

**Harness golden:** endpoint baru tidak direkam. 127 `/admin/permissions` dan 128 `/admin/roles` berubah karena 073, jadi
**direkam ulang oleh pemilik**. Harness tidak menyentuh `sdl_sumda_arsip` (gladi butir 4).

### 8. Urutan kerja

1. Persetujuan K29–K49 dan R5H15 → 074. *Gerbang:* pemilik setuju.
2. Migrasi 073 + manifes (Go dan Express) + seed (Go dan Express), **belum di-commit**. *Gerbang:* gladi `pg_dump`, uji CHECK,
   uji rambatan TRUNCATE, `go test` (build image), diff seed kosong, **baru commit**.
3. **Irisan A, arsip:** `arsip.js` + mount + aditif `personel.js` (`arsip[]`, `arsipRetensi30`) + verify butir 0–8, 11–12 +
   bagian arsip x7. *Gerbang:*
   - `node --check`
   - verify irisan A dan regresi R5H27
   - uji mutasi 1, 2, 5
4. **Irisan B, laporan/ekspor:** `csv.js`, `ekspor.js`, `laporan.js`, ekspor aditif `kinerja.js`/`personel.js`, mount, verify
   butir 9–10, x7 lengkap. *Gerbang:*
   - verify penuh
   - regresi R5H27–R5H31
   - dua suite keamanan (Express 28/28)
   - uji mutasi 3–4
5. **Frontend:** dua layar, R5H27 (nav, kartu, detail), `App.tsx`, CSS cetak. *Gerbang:*
   - `npm run build`.
   - Demo per akun:
     - op mencatat SK Terbatas + PDF, menautkan surat masuk yang sudah diterima.
     - staf tidak melihatnya.
     - Kasubbag melihat, menginaktifkan, mengunggah BA, lalu memusnahkan.
     - Kabagrenmin baca saja dan bisa ekspor.
     - Staf: Laporan tanpa blok kinerja dan tanpa panel unduh.
     - Akun unit lain → 403.
   - Buka CSV di Excel (BOM, `;`, sel `'=`).
   - Cetak (header dan sidebar hilang hanya saat cetak laporan).
   - Lebar 390 px.
   - Simulasi rollback ("tidak tersedia").
6. Docs, `/verifikasi`, `/review`; golden 127/128 oleh pemilik.
7. **Deploy:** cek `SDL_EVIDENCE_KEY` produksi, **centang "Izinkan migrasi"** (073), lalu rebuild `api`, `api-express`, dan
   `frontend`. Tidak ada pra-cek data.

### 9. Risiko dan keputusan baru

| # | Risiko | Penanganan |
|---|---|---|
| R1 | 073 tidak bisa diperbaiki setelah commit | Gladi + `pg_dump` + uji CHECK + uji rambatan; K29–K49 diputus dulu |
| R2 | **(a) Kebocoran lewat angka.** Pelajaran R5H31 S1: angka agregat berubah tepat saat seseorang mencatat atau mengubah sesuatu. Jumlah arsip per kerahasiaan/jenis, kartu retensi, register "diproses", dan distribusi kategori kinerja bisa dikorelasikan dengan daftar atau peristiwa | Arsip: semua angka atas baris **terlihat** (K36), tanpa rincian kerahasiaan bagi non-Xa, sehingga Terbatas milik orang lain tidak pernah menggerakkan angka staf. Kinerja: blok dan baris register hanya Rk (K16/K37). Cuti: hanya jumlah per bulan/jenis; jenis Sakit sudah terlihat di daftar/kalender (R5H30 K18), dan catatan tidak pernah masuk agregat. Personel dan aset tidak mengandung data yang tersembunyi dari pembaca modulnya. Diuji sebagai **selisih 0** di verify dan x7 |
| R3 | **(b) Ekspor sebagai jalur bocor massal**: NRP + nama seluruh personel, kategori kinerja, arsip Terbatas, catatan Sakit | Hanya E (dua akun) + hak modul. Penyamaran memakai fragmen modul asal. **Tanpa kolom teks bebas catatan/alasan** (K41). Batas 10.000 baris. Audit **sebelum** kirim (gagal → 503). Tidak ada rate-limit baru; audit dipantau Superadmin |
| R4 | **(c) Formula injection dan encoding** (Excel menjalankan `=HYPERLINK`/DDE) | `csv.js`: awalan `'` (K20 + K44), semua sel berkutip, BOM, CRLF, tanpa baris `sep=`. Uji mutasi 4 |
| R5 | **(d) "Personel per unit"**: `unit_kerja` teks bebas ≤ 200 (`068:16`), sehingga varian ejaan menjadi batang terpisah | K38: teks persis (sama dengan filter `personel.js:175`, supaya angka = hasil filter), kosong → "Belum diisi", 15 teratas + Lainnya. Normalisasi atau master unit kerja di luar cakupan |
| R6 | **(e) Tanggal WIB**: pool bersesi UTC (`umum.js:19-22`), tahun berjalan, proyeksi, pensiun ≤ 30, retensi, tahun `created_at`, nama berkas | Semua lewat `HARI_INI`/`hari` parameter, kolom DATE dibaca `::text`, `created_at AT TIME ZONE 'Asia/Jakarta'`. Diuji di batas tahun (butir 0) |
| R7 | **(f) Arsip Terbatas bertautan personel** muncul di detail Master Personel bagi semua R | `arsipPersonel` memakai `boleh`. `arsip:null` tanpa Ra (K45). Diuji |
| R8 | **(g) Tautan surat R5H21**: surat masuk Sumda terlihat semua pemegang Ps. Arsip bisa membuka perihal surat ke pemegang Ra tanpa Ps (role kustom), dan arsip Terbatas bisa menyingkap "surat X adalah SK pribadi" | Menautkan butuh Ma + Ps (K30). Info surat hanya bagi Ps. Arsip Terbatas tersembunyi utuh, termasuk tautannya. Sisa kebocoran yang diterima: surat yang sudah diarsip hilang dari pilihan dan POST ganda mendapat 409, yang menyiratkan "sudah diarsip" tanpa isi (K31). Kerahasiaan arsip tidak berlaku surut ke surat R5H21 |
| R9 | **(h) Pemusnahan tanpa maker-checker**: Kasubbag satu-satunya pemegang Xa+Ma (seed). Maker-checker akan macet (R5H31 R4) | K32: hanya dari Inaktif, BA wajib, alasan ≥ 8, audit, catatan dan lampiran tidak pernah dihapus (Musnah hanya status). Alternatif usulan → putus (pola aset K4) bila pemilik meminta |
| R10 | **(i) Performa agregat**: pool `max: 8` (`db.js:31`), ±12 query per ringkasan | Satu koneksi per ringkasan dalam transaksi `REPEATABLE READ READ ONLY` (angka kartu = grafik) + `statement_timeout 5s`. Indeks 068–073 sudah menutup filter. Ekspor `LIMIT 10001` dengan buffer ≤ ±5 MB. Tabel Sumda berskala ratusan sampai ribuan baris |
| R11 | `surat_id` yatim (tanpa FK) | `LEFT JOIN` + `hilang:true`. Harness tidak lagi bisa mengosongkan arsip (gladi butir 4) |
| R12 | Deadlock arsip ↔ surat ↔ personel | Urutan tetap (§5). Persuratan tidak mengunci arsip. Uji balapan |
| R13 | `SDL_EVIDENCE_KEY` produksi salah | Fail-closed; dicek sebelum deploy |
| R14 | Golden 127/128 berubah | Rekam ulang oleh pemilik |

| # | Hal | Usulan |
|---|---|---|
| K29 | Bentuk Terbatas bagi yang tidak berhak (mengoreksi Alur butir 1) | **Tersembunyi utuh**: tidak tampil, tidak dihitung, tidak bisa dicari, dan detail/mutasi 404 identik UUID fiktif. Placeholder "Arsip terbatas" akan menampakkan kapan arsip itu bertambah (pelajaran S1) tanpa memberi nilai kerja bagi yang tidak bisa membukanya. *Alternatif:* placeholder minimal `{id,kerahasiaan,dibatasi}` tanpa tanggal/jenis/status, dikecualikan dari semua filter selain kerahasiaan |
| K30 | Definisi surat yang bisa ditautkan dan siapa yang boleh | `status='dikirim'` dan (dikirim oleh Sumda, **atau** tujuan Sumda dengan `diterima_at` terisi). Ini termasuk salinan surat keluar Urmin (`sumber='urmin_registry'`). Surat masuk yang belum ditandai diterima tidak bisa ditautkan. Menautkan butuh Ma + Ps. Info surat di detail hanya untuk Ps |
| K31 | Satu surat satu arsip | Berlaku juga terhadap arsip Musnah. Dijaga dengan kunci baris surat `FOR NO KEY UPDATE` + `NOT EXISTS` (K27; indeks `surat_id` bukan UNIQUE). Tautan boleh diganti atau dilepas lewat PATCH selama Aktif/Inaktif. Kebocoran "sudah diarsip" diterima |
| K32 | Pemusnahan | Hanya **dari Inaktif** (diagram K9), oleh Ma + Xa, alasan ≥ 8, ≥ 1 lampiran `BA_MUSNAH`. Tanpa maker-checker (R9). Musnah final, hanya-baca, tetap tampil (filter status) |
| K33 | Peran lampiran | `DOKUMEN` (bawaan) / `BA_MUSNAH`, total maks. 10, PDF ≤ 5 MB. Hapus oleh pengunggah atau Xa, tidak saat Musnah |
| K34 | Naik kerahasiaan oleh bukan pencatat | Boleh (K13). Respons `{item:null,tersembunyi:true}`, dan UI menutup detail dengan pesan "Arsip kini Terbatas". Turun hanya Ma + Xa |
| K35 | Tahap retensi | `JATUH_TEMPO` (sisa ≤ 0) / `H-30` (1–30), hanya Aktif/Inaktif bertanggal retensi. `?retensi=1` = keduanya. `retensiSampai` ≥ `tanggal` (Express) |
| K36 | Angka arsip | Dashboard, kartu, blok, dan register dihitung atas baris terlihat akun itu. Rincian per kerahasiaan hanya untuk Xa |
| K37 | Blok analitik dan hak | R: kartu personel/MPP, pensiun ≤ 30 hari (tahap `H-30` s.d. `JATUH_TEMPO`, termasuk terlewat, sama dengan alert), layanan berjalan (karier + cuti + kesejahteraan selain Selesai/Ditolak/Dibatalkan, personel belum terarsip), komposisi unit/pangkat, proyeksi 12 bulan, cuti/bulan, diklat/bulan, register karier/diklat/kompetensi/cuti/kesejahteraan. Ri: aset (kartu, per kondisi, per status, register). Rk: kinerja (per kategori, Disetujui/Selesai, tahun terpilih; register). Ra: arsip (K36). Blok tanpa hak → `null` |
| K38 | Komposisi per unit kerja | Personel Aktif + MPP belum terarsip, dikelompokkan atas teks persis. Kosong → "Belum diisi". 15 teratas + "Lainnya (n unit)" |
| K39 | Komposisi per pangkat | Polri: `coalesce(short_name,pangkat)` terurut `sort_order`. PNS: urutan `GOLONGAN_PNS`. Pangkat kosong atau jenis NULL (salinan) → "Belum diisi" |
| K40 | Sumbu waktu | Tahun bawaan = tahun WIB. Cuti per bulan = `tanggal_mulai` (Disetujui/Selesai: jumlah pengajuan + hari). Diklat = `tanggal_mulai` (bukan Dibatalkan/terarsip: kegiatan + peserta). Kinerja = kolom `tahun`. Kesejahteraan = `created_at` WIB. Arsip = `tanggal`. Proyeksi pensiun = 12 bulan mulai bulan berjalan WIB, tidak bergantung tahun. Register: `jumlah` = tahun terpilih, `diproses` = saat ini |
| K41 | Kolom ekspor | Sama dengan kolom tabel daftar di layar (konstanta per modul). **Tanpa** catatan/alasan/teks bebas selain nama/judul/perihal, tanpa nama petugas, id, hash, atau nama berkas. Ini mempersempit K19 untuk cuti: catatan Sakit tidak diekspor sama sekali. Bila kelak ditambah, wajib lewat fragmen `kolom()` cuti |
| K42 | Modul ekspor, hak, filter | personel (R; `status`) · pensiun (R; `tahap`) · karier (R; `tahun`=tanggal usulan, `status`, `jenis`) · diklat (R; `tahun`, `status`; satu baris per peserta) · kompetensi (R; `tahap`) · cuti (R; `tahun`, `status`, `jenis`) · kesejahteraan (R; `tahun`, `status`, `jenis`) · kinerja (R + baris `boleh`; `tahun`, `status` asli) · aset (Ri; `status`, `kondisi`) · arsip (Ra + `boleh`; `tahun`, `status`, `jenis`). Param lain → 400. Ditambah E |
| K43 | Mekanik ekspor | Buffer (bukan stream), `LIMIT 10001`, 413 sebelum byte pertama. Header → audit (transaksi sendiri) → kirim; audit gagal → 503 tanpa data. 403/404/413 tidak diaudit. Cetak tidak diaudit (isinya sama dengan layar) |
| K44 | Detail format CSV | UTF-8 + BOM, `;`, CRLF, semua sel berkutip, `"`→`""`. Awalan `'` untuk sel teks yang diawali `= + - @`, tab, CR, **dan** padanan lebar penuh `＝ ＋ － ＠` (defensif). Bilangan dari kode tanpa awalan. Tanggal `YYYY-MM-DD`. Nama `sumda-<modul>-<YYYYMMDD WIB>.csv` |
| K45 | Arsip di detail personel | Hanya bila pemanggil memegang Ra (lainnya `null`), baris terlihat, maks. 50 terbaru, tanpa catatan |
| K46 | Cetak | Cetak browser dengan kelas `body.sdl-cetak-laporan`. Panel unduh dan tombol disembunyikan |
| K47 | Personel pada arsip | Pilih dari personel belum terarsip, status apa pun (SK pensiun). Personel yang kemudian terarsip tetap tertaut, ditandai "(terarsip)" |
| K48 | Batas lain | Halaman 5/10/50/100. `surat-tertaut` maks. 200 terbaru (`dikirim` terbaru). Nomor arsip tidak unik (dokumen eksternal). Tahun 1950–2100 |
| K49 | Audit | Arsip `{status,jenis,kerahasiaan,fields,version}`. Ekspor `{modul,jumlah,filter}` (enum/bilangan saja). Tanpa nomor, perihal, NRP, nama, nama berkas, atau catatan |

### Temuan yang mengoreksi dokumen rilis

1. **Harness memang mengosongkan `sdl_surat_antar`, tetapi tidak langsung.** Tabel itu tidak ada di `DOCUMENT_TABLES`
   (`harness/seed-documents.js:244-297`). Namun `TRUNCATE … sdl_urmin_registry … CASCADE` (`:278`, `:492`) merambat lewat FK
   `urmin_registry_id` (`064:21`). FK `surat_id` akan ikut mengosongkan seluruh arsip, jadi **tanpa FK** (§4).
2. **Status surat** adalah `draft|diajukan|ditolak|disetujui|dikirim` (`064:30`). Dokumen menulis "draf" dan melewatkan
   `ditolak`. Hanya `dikirim` yang final (`064:44`).
3. **"Diterima" ada per unit** di `sdl_surat_antar_tujuan.diterima_at/by` (`064:50-57`). Surat masuk sudah tampil begitu
   `dikirim`, sebelum ditandai diterima (`persuratan/index.js:535-541`, `:553-562`). K11 butuh definisi, yaitu K30.
4. **"Terlihat seluruh staf unit"** sebenarnya berarti pemegang `persuratan.read` pada grant unit itu: op/staf/Kasubbag
   (`main.go:55-57`), ditambah Kabagrenmin yang punya grant di keempat unit (`main.go:61,243-248`). Arsip tidak menambah
   paparan bagi role seed, tetapi role kustom membutuhkan syarat Ps (K30).
5. **Salinan surat keluar Urmin** (`sumber='urmin_registry'`, `unit_pengirim='urmin'`) juga menjadi Surat Masuk Sumda dan ikut
   bisa ditautkan.
6. **Ikon `archive` dan `chart` sudah ada** (`App.tsx:48`), jadi tidak perlu ikon baru. Id modul `arsip`/`laporan` juga dipakai
   Urmin (`:147`, registry R5D, Engine B) dan Subbagren (`:153`). Cabang render wajib mensyaratkan `unit.id==='sumda'`.
7. **Kabagrenmin tidak memegang `subbagsumda.cuti.approve`** (`main.go:61`), sehingga catatan Sakit tersamar baginya (R5H30
   S3). Klaim K19 "Kasubbag/Kabag memegangnya" hanya benar untuk `arsip.restricted` setelah 073. Karena K41, catatan Sakit
   tidak diekspor.
8. **"Filter tahun/status sama dengan layar" (K21) tidak berlaku untuk semua modul.** Daftar karier, kesejahteraan,
   kompetensi, personel, dan pensiun tidak punya filter tahun (`karier.js:178-186`, `kesejahteraan.js:142-152`,
   `personel.js:156-163`), dan cuti memakai `bulan`. Filter ekspor ditetapkan per modul (K42).
9. **K15 "pensiun ≤ 30 hari"** ambigu soal yang terlewat. K37 mengikuti alert (`personel.js:65-70`). Proyeksi dashboard hanya
   6 bulan (`:381-386`), sedangkan laporan 12 bulan, jadi rumusnya diekstrak dengan string identik.
10. **K9:** diagram menempatkan "musnahkan" setelah Inaktif, sedangkan tabel menulis "Aktif/Inaktif ↔". K32 menetapkan:
    dari Inaktif saja. "Lampiran BA wajib" membutuhkan penanda peran (K33), karena lampiran dokumen biasa tidak boleh memenuhi
    syarat itu.
11. **Endpoint kurang di tabel dokumen:** `GET /laporan/capabilities` (rollback + panel unduh), `canTautSurat`, `?peran=`
    lampiran, dan respons `tersembunyi` PATCH (§2).
12. **Belum ada penulis CSV di Express.** Satu-satunya ekspor server adalah XLSX LKIP (`subbagren/perencanaan.js:1020`) yang
    **tidak diaudit**, jadi tidak menjadi preseden bagi K22. `csv.js` baru tanpa dependensi.
13. **`withTransaction` tidak punya opsi isolasi** (`db.js:53-58`), jadi `SET TRANSACTION …` dijalankan sebagai pernyataan
    pertama. Pool `max: 8` (`db.js:31`) menjadi alasan analitik memakai satu koneksi.
14. **Master kode klasifikasi sudah ada** (`/api/v1/urmin/kode-arsip`, referensi tanpa permit, `kode-arsip.js:16-19`) dan
    bisa dipakai sebagai saran isian `kodeKlasifikasi`. Isiannya tetap teks bebas (K8).
15. **Rollback sempit** § R5H31 di API-CONTRACT (`:1909-1912`) ditandai usang; pola baru memuat `/arsip*` dan `/laporan*`.
16. **CLAUDE.md** (`:130,186,206-207`) menjadi 126 tabel dari migrasi / 73 berkas SQL / suite Express 28/28.
    `MIGRATION-PLAN.md:16` menjadi "049–073". R5H15 → 074 (`R5H15-…md:12,106,169`).
