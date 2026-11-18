# Catatan sesi 2026-11-16 — Dokumen Perancangan/Final, riwayat versi, Tahap Pekerjaan (R5H16)

Sesi ini melanjutkan Subbagren PROGAR (R5H11–R5H14). Isinya: rancangan R5H15
(riwayat versi dokumen), tampilan riwayat versi, pemisahan menu Dokumen
Perancangan / Dokumen Final, dan fitur baru **Tahap Pekerjaan** (R5H16) yang
diturunkan dari dokumen alur kerja Densus 88. Semua yang baru **khusus Express**.

## Posisi sekarang

| Hal | Keadaan |
|---|---|
| Repo (`sdl-express`, branch `main`) | `origin/main` = `c48ad24` (rancangan R5H15). R5H13 (`4d970dd`) dan R5H14 (`2cc2556`) **sudah di-commit dan di-push** |
| Belum di-commit | Semua pekerjaan sesi ini: `App.tsx`, `DokumenR5H13.tsx`, `DokumenTahapR5H16.tsx` (baru), `ProgarR5H11.tsx/.css`, `perencanaan.js`, `tahap-katalog.js` (baru), **`053_dokumen_tahap.sql`, `054_dokumen_final.sql`, `055_tahap_lampiran_banyak.sql`, `056_tahap_cek.sql` (baru)**, `migrate_test.go`, `migrations/index.js`, `docs/R5H15-…md`, catatan ini. `docs/Alur_Pekerjaan_Densus88_Format_Kolom.docx` untracked (pemilik putuskan ikut repo atau tidak) |
| Database laptop | **Migrasi 053–056 sudah diterapkan.** Jangan buang file 053 tanpa memulihkan DB, karena Go menolak start bila ledger berisi migrasi yang tidak ia kenal |
| Server produksi | Tidak tersentuh. Migrasi **049–056** belum pernah dideploy (Run workflow dengan *migrate* dicentang). `SDL_EXPRESS_PATHS` harus mencakup `/api/v1/subbagren/*` |
| Uji yang sudah jalan | `tsc` frontend, `node --check`, build image Go (go test lulus, termasuk test pengaman migrasi), uji browser Playwright (lihat §6) |
| Uji yang BELUM jalan | `security-test-express.sh`, harness, skrip `verify/r5h16-flow.js` (belum ada), uji **＋ Catat Distribusi** di Dokumen Final |
| Menunggu pemilik | Lihat "Keputusan terbuka" |

Data uji di laptop (tahun 2028): tiga dokumen `[UJI DEMO 2153]` (Renja: ditolak,
sah, revisi sah) dan `[UJI TAHAP] Renstra …` (draft, 2 tahap). Hapus hanya bila
diminta. 2025/2027 tetap data latihan pemilik.

## 1. R5H15 — riwayat versi dokumen (rancangan)

`docs/R5H15-RIWAYAT-VERSI-DOKUMEN.md`. Keputusan pemilik:

| Hal | Keputusan |
|---|---|
| Daftar | Satu baris per rantai: versi sah + penanda "Revisi vN sedang diproses" |
| Unggahan PDF | Semua disimpan, tidak ditimpa; maks 20 PDF per versi |
| Dokumen ditolak | Lanjut sebagai versi berikutnya di rantai yang sama |
| Yang boleh melihat riwayat | Semua yang boleh membaca |
| Yang boleh memperbaiki versi ditolak | Siapa pun yang boleh mengunggah |

Temuan: `digantikan` hanya melihat penerus langsung yang sah; rantai yang
melewati versi ditolak salah dihitung (berdampak ke pilihan DIPA di Pagu R5H14).
Migrasinya digeser menjadi **054** karena 053 dipakai R5H16. Backend R5H15
**belum dikerjakan**, menunggu `/rencana R5H15`.

## 2. Tampilan riwayat versi (tanpa backend)

- Tombol **🕘 Riwayat · N versi** di baris dokumen membuka jendela v1…vN
  (Berlaku / Digantikan / Ditolak / Draft), dengan siapa yang mengesahkan atau
  menolak dan pratinjau PDF tiap versi. Rantai disusun di layar dari `penggantiDari`.
- Centang "Tampilkan versi lama" dihapus.
- Batasan sampai R5H15 jadi: PDF yang diganti saat draft tetap hilang (server
  menimpa), dokumen ditolak tetap baris terpisah.

## 3. Perubahan kecil atas permintaan pemilik

- Isian dan kolom **Terkait Program/Kegiatan** disembunyikan (di-comment),
  karena membingungkan; backend tetap menerima, dan kaitan lama dipertahankan saat Ubah.
- Kartu Program: tombol **Ubah Program / Hapus Program** di bagian atas kartu
  (Hapus nonaktif selama masih ada kegiatan), **＋ Tambah Kegiatan** di bawah,
  baris kegiatan **Ubah Kegiatan / Hapus Kegiatan**, pagu **Ubah Pagu**.

## 4. Menu Dokumen Perancangan dan Dokumen Final

- "Dokumen Perencanaan" → **Dokumen Perancangan** (draft, menunggu pengesahan,
  ditolak). Menu baru **Dokumen Final** (sah dan berlaku + Riwayat + Buat Revisi
  + ＋ Catat Distribusi). Id menu lama `perencanaan` tetap dipakai untuk Perancangan.
- Penanda "✎ Revisi sedang dirancang" di Final, dan tautan antarmenu.
- Ikon Final: ikon baru `fileCheck` (dokumen + centang) di `App.tsx`.
- **Semua tahun anggaran dalam satu daftar**; tahun hanya **filter** (bawaan
  "Semua tahun"). Tahun anggaran pindah ke formulir Unggah Dokumen. API:
  `GET /dokumen?tahun=semua` (Program Anggaran tetap per tahun).
- Perbaikan bug: respons tahun lama yang tiba belakangan menimpa tahun terpilih.

## 5. Identifikasi alur kerja dari dokumen Densus 88

Sumber: `docs/Alur_Pekerjaan_Densus88_Format_Kolom.docx` (20 alur, khusus
perencanaan dan pelaporan Subbagren). Lima pola: dokumen Tim Pokja
(Renstra/Renja/IKU), siklus anggaran (RKKS Renbut → Pagu Indikatif → Anggaran →
Alokasi → DIPA), penjabaran setelah DIPA (Rendisgar, Rengiat, Renaksi,
Perjanjian Kinerja), pelaporan (LRA, Penggunaan Anggaran, EKA PN, Capaian
Kinerja, LKIP, Hibah), dan revisi POK/RPD. Kejanggalan di dokumen sumber dicatat
di percakapan (catatan "Rendisgar belum diuraikan" usang, Rancangan Renja
langkah 4, nomor surat arahan LRA kosong).

## 6. R5H16 — Tahap Pekerjaan (dibangun lokal)

Permintaan pemilik: saat menambah dokumen, setelah Jenis/Judul/Nomor/Tanggal,
pilih **pekerjaan** dari dropdown; isiannya baru muncul setelah dipilih; lalu
**＋ Tambah Tahap Pekerjaan** untuk blok berikutnya dengan cara yang sama.

- **Katalog** `apps/backend-express/src/modules/subbagren/tahap-katalog.js`:
  11 bentuk isian (undangan, pokja, rapat, pengesahan, distribusi, surat masuk,
  surat keluar, kompilasi, input aplikasi, pemeriksaan, draf), 20 pekerjaan, dan
  urutan tahap per jenis. Frontend menggambar formulir dari `GET /tahap-katalog`
  (satu sumber untuk validasi dan tampilan).
- **Jenis dokumen baru:** Rancangan Renstra, Rancangan Renja, IKU, RKKS Renbut,
  RKKS Pagu Indikatif/Anggaran/Alokasi, Rendisgar, Rengiat, Renaksi, Perjanjian
  Kinerja. DIPA/POK/TOR-KAK/RAB/RKA-K/L/Lainnya tanpa tahap.
- **Migrasi 053** `053_dokumen_tahap.sql`: memperlebar CHECK `jenis`, tabel
  `sdl_ren_dokumen_tahap` (isian JSONB) dan `sdl_ren_dokumen_tahap_berkas`
  (PDF per slot, AES-256-GCM). **`migrate_test.go` diberi pengecualian sempit**
  untuk DROP/ADD constraint jenis itu (preseden: 027). Perlu ditinjau.
- **Endpoint** (di bawah `/api/v1/subbagren/perencanaan`): `GET /tahap-katalog`,
  `POST /dokumen/:id/tahap`, `PUT|DELETE /dokumen/:id/tahap/:tid`,
  `POST|GET /dokumen/:id/tahap/:tid/berkas/:slot`. `GET /dokumen` kini memuat `tahap[]`.
- **Aturan:** tahap boleh diubah selama dokumen draft; setelah sah hanya tahap
  distribusi; isian divalidasi ketat (kunci asing ditolak); tahap milik dokumen
  lain → 404 (IDOR); setiap perubahan menaikkan `version` dokumen; maks 50 tahap;
  ganti jenis ditolak bila sudah ada tahap (`jenis_terkunci_tahap`).
- **Uji browser:** membuat Renstra dengan tahap Tim Pokja + Rapat dan PDF-nya,
  garis tahap tampil di baris (⚠ bila bukti utama belum ada), pratinjau PDF
  tahap, dan dialog Ubah memuat kedua tahap (jenis dan tahun terkunci). Tidak ada error JS.
- **Belum ada dokumen rilis `docs/R5H16-…md`** (fitur langsung dibangun atas
  permintaan pemilik, tanpa `/fitur`).

## 7. Tambahan 2026-11-17 — detail dokumen dan penanda Final

Permintaan pemilik: detail dokumen bisa dibuka dan tetap bisa ditambah tahap
setelah disimpan; dokumen yang sudah disahkan **tidak otomatis** masuk Final.

- **Sah ≠ final.** Migrasi **054** `054_dokumen_final.sql` (dua ADD COLUMN
  `final_at`, `final_by`; terdaftar di daftar ADD COLUMN yang ditinjau di
  `migrate_test.go`). Endpoint `POST /dokumen/:id/final {final,version}`
  (hak `subbagren.progar.manage`, hanya dokumen sah yang belum digantikan,
  bisa dibatalkan, tercatat di audit).
- Dokumen Perancangan = draft, ditolak, **dan sah belum final**; Dokumen Final =
  sah + ditandai final. Badge "Sah · belum final" / "Final".
- Tahap pekerjaan bisa ditambah/diubah selama draft **atau sah belum final**;
  setelah final terkunci (`dokumen_terkunci`). Tombol "＋ Catat Distribusi" di
  Final dihapus (distribusi dicatat sebelum final).
- **Detail Dokumen:** klik judul → data dokumen, PDF, riwayat, tabel semua tahap
  (isian + lampiran) dan aksi ＋ Tambah Tahap Pekerjaan / Ubah Dokumen / Tandai
  Final / Kembalikan ke Perancangan. Baris daftar juga punya ＋ Tahap dan Tandai Final.
- Migrasi 054 sudah diterapkan di laptop; image Go dibangun ulang (go test lulus).
  R5H15 bergeser ke **055**.
- Uji browser lulus: detail draft → tambah tahap pengesahan (3 tahap); dokumen
  sah → tambah tahap distribusi → Tandai Final → pindah ke Final. Tanpa error JS.
- Catatan: Portal sudah berganti tampilan (kartu "Subbagren"); skrip demo lama
  yang mencari tombol "SUBBAGREN" perlu disesuaikan.

### 7b. Lampiran banyak per jenis, pilihan pekerjaan tanpa nomor (2026-11-17)

- Dropdown pekerjaan **tanpa angka urutan** (urutan tidak pasti); pekerjaan yang
  sudah dipilih ditandai "(sudah N×)" karena boleh berulang (mis. rapat).
- **Migrasi 055** `055_tahap_lampiran_banyak.sql`: tabel baru
  `sdl_ren_dokumen_tahap_lampiran` (berkunci id, maks 10 berkas per slot di API),
  isi tabel 053 disalin apa adanya; tabel lama tidak dipakai lagi (tidak bisa
  di-DROP). Endpoint diganti: `POST …/tahap/:tid/lampiran/:slot` (menambah),
  `GET|DELETE …/tahap/:tid/lampiran/:lid`. R5H15 bergeser ke **056**.
- Formulir tahap: tiap jenis lampiran menampilkan daftar berkas (tersimpan /
  baru / akan dihapus), bisa pilih banyak PDF sekaligus, hapus satu per satu.
  Diuji: lampiran lama hasil salinan masih terdekripsi; tambah 2 notulen +
  daftar hadir dan hapus Sprin tersimpan benar.
- Bug yang ditemukan saat uji: daftar lampiran di dalam `<label>` membuat tombol
  "Hapus" menjadi kontrol label (klik di area mana pun memicu Hapus). Diganti `<div role="group">`.

### 7c. Pemeriksaan tahap oleh Kasubbagren, daftar satu tabel (2026-11-17)

Keputusan pemilik: **setiap tahap dicek Kasubbagren**; **Tandai Final boleh
operator maupun Kasubbagren**; **PDF utama diambil dari tahap pengesahan**.

- **Migrasi 056** `056_tahap_cek.sql`: `cek_status` (menunggu/diterima/
  dikembalikan, default menunggu), `cek_by`, `cek_at`, `cek_note`.
  Endpoint `POST …/tahap/:tid/cek {keputusan,catatan,version}` (hak
  `subbagren.dokumen.sahkan`; pengubah terakhir tidak boleh mengecek sendiri;
  Kembalikan wajib catatan ≥ 8 karakter). Tahap diterima terkunci
  (`tahap_sudah_diterima`); ubah isian/lampiran mengembalikan status ke menunggu.
  Tandai Final ditolak bila ada tahap belum diterima (`tahap_belum_diterima`).
  Sahkan dokumen bertahap memakai lampiran slot `dokumen_sah` sebagai PDF utama.
  R5H15 bergeser ke **057**, lalu ke **058** setelah 057 dipakai untuk anggaran (§7g).
- Layar: kolom **Pemeriksaan** di tabel tahap Detail (Terima / Kembalikan),
  centang **"Perlu dicek saya (n)"** untuk Kasubbagren, ringkasan "n menunggu dicek /
  dikembalikan / ✓ Semua diterima" di daftar, tahap diterima tidak tampil sebagai
  blok yang bisa diubah, catatan pengembalian tampil di blok operator. Status draf
  kini "Draf" (bertahap) atau "Draf · PDF belum dilampirkan" (tanpa tahap).
- Daftar dokumen menjadi **satu tabel** (Jenis · Dokumen · Tahap · Status · aksi),
  tombol baris hanya Buka + keputusan; ＋ Tahap, PDF, Ubah pindah ke Detail.
- Uji dua akun lulus: KS terima 2 tahap + kembalikan 1 → operator lampirkan PDF
  bertanda tangan → kembali menunggu → KS terima → Sahkan (PDF dari tahap) →
  Tandai Final aktif.
- Belum: notifikasi/Inbox untuk tahap yang menunggu dicek; Detail tidak memuat ulang
  sendiri bila operator mengubah tahap sementara Kasubbagren membukanya (aksi akan
  ditolak `version_conflict` dengan pesan muat ulang).

### 7d. Tahap yang sudah diterima tetap bisa diubah (2026-11-17)

- Keputusan pemilik: mengunci tahap yang sudah diterima "terlalu berlebihan".
  Selama dokumen **belum final**, tahap yang sudah diterima boleh diubah isiannya
  dan ditambah atau dihapus lampirannya. Setiap perubahan mengembalikannya ke
  **Menunggu dicek**, jadi Tandai Final terblokir lagi sampai Kasubbagren menerima
  ulang.
- Tetap dikunci:
  - **Menghapus tahap yang sudah diterima** (`tahap_sudah_diterima`).
  - **Menghapus PDF bertanda tangan terakhir** dari dokumen yang sudah sah
    (`pdf_sah_wajib_ada`). Formulir mengunggah berkas baru lebih dulu, baru
    menghapus yang lama, jadi mengganti PDF tetap bisa.
  - **Dokumen yang sudah final.** Untuk mengubahnya, pakai "Kembalikan ke
    Perancangan" atau buat revisi.
- Penomoran tahap tetap mengikuti urutan asli, yaitu `nomorTahap`.
- Uji di browser: tahap 1 [UJI TAHAP] yang sudah diterima diberi satu lampiran
  tambahan. Hasilnya tersimpan, statusnya kembali `menunggu`, dan tidak ada error.
  Penjaga `pdf_sah_wajib_ada` belum diuji.

### 7e. Register tahap untuk tahap yang banyak dan berulang (2026-11-17)

Pemilik memilih **arah A (register)** dan tidak memakai "salin isian dari rapat
sebelumnya".

- **Detail dokumen.** Tahap tampil sebagai tabel register dengan kolom No, Tanggal,
  Pekerjaan, Ringkasan, Lampiran, Pemeriksaan, dan Ubah.
  - Tanggal diambil dari field tanggal pertama di katalog.
  - Pekerjaan yang berulang diberi akhiran "· ke-n".
  - Ringkasan berisi dua isian teks pertama; angka diberi label, misalnya
    "14 peserta".
  - Klik nama pekerjaan atau 📎 untuk membuka rincian isian dan pratinjau lampiran
    baris itu.
  - Saringan "Semua / Belum diterima / per pekerjaan" muncul kalau tahap lebih
    dari 3.
- **Formulir satu tahap.** Tombol ＋ Tambah dan Ubah membuka formulir untuk satu
  tahap saja (`mode 'tahap'` dengan `tahapId`). Kepala formulirnya, misalnya
  "Tahap 5 · Rapat penyusunan ke-3 · Menunggu dicek".
  - Hapus Tahap ada di formulir ini, hanya untuk tahap yang belum diterima.
  - "Ubah Dokumen" kini hanya mengubah data dokumen, tidak lagi tahapnya.
  - Formulir Unggah Dokumen baru tetap bisa memuat beberapa tahap sekaligus.
- **Uji di browser.** Tiga rapat ditambahkan ke [UJI TAHAP], sehingga dokumen itu
  kini punya 6 tahap: Rapat ke-1 sampai ke-4, saringan, rincian baris, dan
  formulir Ubah. Screenshot 1440 dan 390 sudah diambil. Di 390 kolom Ringkasan
  dan Lampiran disembunyikan, dan tabel masih digeser horizontal di dalam
  wadahnya.
- **Revisi pemilik: rincian tahap menjadi halaman sendiri.** Rincian tidak lagi
  dibuka sebagai baris yang melebar ke bawah. Menekan baris, nama pekerjaan, atau
  tombol Lihat membuka **halaman detail tahap** di dalam dialog Detail, berisi:
  - jejak "← judul dokumen" dan "Tahap n dari N";
  - Isian;
  - Lampiran per jenis, termasuk bukti utama yang belum dilampirkan;
  - Pemeriksaan beserta tombol Terima/Kembalikan;
  - tombol ‹ Sebelumnya / Berikutnya › (mengikuti saringan aktif), Ubah Tahap, dan
    Kembali ke Dokumen.

  Esc kembali ke halaman dokumen. Penekanan berikutnya menutup dialog.

### 7f. Jenis RKKS/pagu tanpa pengesahan: "Selesai" (2026-11-17)

- **Keputusan pemilik.** Nomor 5–8 alur Densus 88 (RKKS Renbut, Pagu Indikatif,
  Pagu Anggaran, Pagu Alokasi) tidak disahkan. Alurnya adalah proses usulan ke
  Stamarena/SAKTI, jadi dokumen langsung ditandai **Selesai**.
  - Nomor 1–4, 9, 10, 12, dan 13 tetap disahkan.
  - Nomor 11 (Perjanjian Kinerja) tetap disahkan dengan PDF bertanda tangan
    Kapolri.
- **Backend.** Daftar jenisnya `TANPA_SAH` di `tahap-katalog.js`, dikirim ke
  frontend sebagai `katalog.tanpaSah`.
  - `/review` menolak jenis ini dengan `jenis_tanpa_pengesahan`.
  - `/final` untuk jenis ini berjalan dari status **draft** dan memerlukan minimal
    satu tahap (`tahap_kosong`) yang semuanya sudah diterima.
  - Dokumen yang sudah final/selesai terkunci: `lockForTahap`, PUT dokumen, dan
    unggah berkas menolak dengan `dokumen_terkunci`.
  - Jenis tidak bisa ditukar antara alur sah dan alur selesai (`jenis_beda_alur`).
  - Tidak ada migrasi: `final_at` dipakai untuk "selesai".
- **Frontend.** Status "Dalam proses" / "Selesai", tombol **Tandai Selesai**, tanpa
  Sahkan/Tolak. Detail menampilkan "Pengesahan: Tidak diperlukan". Dokumen Final
  menampilkan jenis ini dengan label "Selesai" dan tombol Kembalikan ke Perancangan.
- **Uji di browser dengan dua akun.** Alurnya: OP membuat
  `[UJI SELESAI] RKKS Pagu Indikatif` (TA 2028) dengan satu tahap → KS tidak
  melihat Sahkan, lalu Terima → OP Tandai Selesai → dokumen pindah ke Dokumen Final
  berlabel "Selesai". Tidak ada error.

### 7g. Anggaran (estimasi) per dokumen (2026-11-17)

- **Keputusan pemilik.** Satu angka total dalam rupiah bulat, ditambah catatan.
  Angkanya boleh diubah sampai dokumen Final/Selesai, termasuk setelah disahkan.
  Setelah itu terkunci, dan terbuka lagi kalau dokumen dikembalikan ke Perancangan.
- **Migrasi 057** `057_dokumen_anggaran.sql` menambah empat kolom: `anggaran`
  (BIGINT ≥ 0), `anggaran_note`, `anggaran_by`, dan `anggaran_at`. Migrasi ini
  sudah didaftarkan di kedua manifes dan di peta reviewed `migrate_test.go`.
  R5H15 bergeser ke **058**.
- **Endpoint** `PUT /dokumen/:id/anggaran` dengan isi `{anggaran:"digit"|"", catatan, version}`.
  - Isian kosong menghapus estimasi.
  - Dokumen yang sudah final/selesai atau sudah digantikan revisi ditolak dengan
    `dokumen_terkunci`.
  - Setiap perubahan menaikkan versi dokumen dan masuk audit `dokumen.anggaran.update`.
- **Frontend.** Detail menampilkan baris "Anggaran (estimasi)" berisi angka,
  catatan, dan siapa yang terakhir mengubah, dengan tombol Isi/Ubah. Daftar
  dokumen menampilkan "Estimasi Rp …" di bawah judul.
- **Uji di browser.** [UJI TAHAP]: Rp 2.500.000.000 lalu diubah menjadi
  Rp 2.750.000.000. Di dokumen yang sudah Selesai tombolnya tidak muncul. Migrasi
  sudah diterapkan di laptop, dan build Go (`go test`) hijau.

### 7h. Menu Program Anggaran, Monitoring Kinerja, dan Usulan Kebutuhan dihapus (2026-11-17)

- **Keputusan pemilik.**
  - **Program Anggaran dihapus total.** Pemilik sudah diberi tahu konsekuensinya:
    program/kegiatan baru tidak bisa dibuat lagi, sehingga Pagu dan Realisasi
    untuk tahun baru tidak bisa diisi.
  - **Monitoring Kinerja & LKIP** dan **Usulan Kebutuhan** disembunyikan.
- **Perubahan di frontend saja:** `App.tsx` (definisi menu, rute, dan import) dan
  `SmartUnitDashboard.tsx` (kartu Usulan Kebutuhan). Teks kosong di Pagu tidak lagi
  menunjuk ke Program Anggaran.
- **Tidak berubah:** backend, endpoint, dan data. Program/kegiatan, indikator
  kinerja, dan usulan yang sudah ada tetap tersimpan. Komponen `ProgarR5H11`
  (mode program), `KinerjaR5H13`, dan `UsulanR4A` masih ada di repo, hanya tidak
  dirutekan lagi. Untuk memunculkannya kembali cukup mengembalikan entri menu dan
  rutenya.
- **Uji di browser.**
  - Sidebar PROGAR tinggal Dashboard, Dokumen Perancangan, dan Dokumen Final.
  - Sidebar Pagu tinggal Pagu Anggaran dan Realisasi.
  - Halaman Pagu tetap terbuka.
  - Tidak ada error.

### 7i. Grup PAGU ANGGARAN diganti nama menjadi DALGAR (2026-11-17)

- **Kartu dan judul grup** di halaman SUBBAGREN menjadi **DALGAR**. Nama lengkapnya
  "Pengendalian Anggaran" tampil di sidebar dan tautan "Buka Pengendalian Anggaran".
- **Tidak berubah:** `id` grup tetap `pagu`, jadi rute dan tautan lain tidak
  terpengaruh. Isi menu tetap Pagu Anggaran dan Realisasi Anggaran (LRA).

### 7j. R5H17: DALGAR, menu Laporan (no. 14–19) dan Revisi Anggaran (no. 20) (2026-11-17)

- **Keputusan pemilik:** dua menu, bukan satu menu per tugas. Keterkaitan dengan
  undangan dan disposisi Urmin **ditunda**.
- **Migrasi 058** `058_dokumen_laporan.sql`:
  1. Memperlebar `sdl_ren_dokumen_jenis_check` dengan delapan jenis: `lap_lra`,
     `lap_penggunaan_anggaran`, `lap_eka_pn`, `lap_capaian_kinerja`, `lap_lkip`,
     `lap_hibah`, `revisi_pok`, `revisi_rpd`. Ini pengecualian yang ditinjau
     (`reviewedJenisLaporan`), sama seperti 053.
  2. ADD COLUMN `periode` VARCHAR(4) dengan nilai `''`, `B01`–`B12`, atau
     `TW1`–`TW4`.

  R5H15 bergeser ke **059**.
- **Katalog** (`tahap-katalog.js`):
  - Form baru: `laporan`, `ttd`, `kirim`, `data_dukung`, `unggah_aplikasi`,
    `dipa_baru`.
  - 15 pekerjaan baru dan `JENIS_TAHAP` untuk delapan jenis tersebut, mengikuti
    dokumen alur.
  - `PERIODE`: `lap_lra` bulanan, `lap_capaian_kinerja` triwulanan. Pemeriksaan
    lewat `cleanPeriode`; galat `periode_tidak_sesuai`.
  - Kedelapan jenis masuk `TANPA_SAH`, sehingga berakhir **Selesai**.
- **Frontend.** `DokumenR5H13` mendapat mode `'laporan'` dan `'revisi'`:
  - Satu daftar tanpa pemisahan perancangan/final, dengan saringan Tahun, Jenis,
    dan Status.
  - Tombol "＋ Laporan Baru" / "＋ Revisi Baru"; kolom Jenis menampilkan periode.
  - Baris Anggaran (estimasi) disembunyikan; tombol "Buka Kembali" menggantikan
    "Kembalikan ke Perancangan".
  - Dokumen Perancangan/Final tidak lagi menampilkan jenis DALGAR.
  - `DokumenDialog` mendapat prop `kind`, isian Bulan/Triwulan, dan judul
    otomatis kalau dikosongkan (misalnya "LRA Oktober 2028").
  - `App.tsx`: DALGAR berisi Pagu, Laporan, Revisi Anggaran (POK/RPD), dan
    Realisasi.
- **Uji di browser.**
  - Sidebar DALGAR dan formulir Laporan Baru berjalan.
  - LRA Oktober 2028 tersimpan dengan judul otomatis dan satu tahap
    "Menyusun laporan".
  - Daftar pekerjaan Revisi RPD berisi 7 langkah.
  - Jenis DALGAR tidak muncul di Perancangan.
  - Tidak ada error.
- **Belum dikerjakan:**
  - Kelengkapan per periode (misalnya "LRA 2028: 9/12 bulan").
  - Tautan Revisi RPD selesai → Revisi DIPA → dasar pagu.
  - Tautan undangan/disposisi Urmin.
  - Isian capaian dan ekspor LKIP (menu Kinerja masih disembunyikan).

### 7k. R5H18: Realisasi memotong anggaran dokumen Final; menu Pagu disembunyikan (2026-11-17)

- **Keputusan pemilik:**
  - Acuan anggaran adalah "Anggaran (estimasi)" pada **setiap dokumen Final/Selesai**.
    Setiap dokumen itu menjadi satu pos.
  - Menu Pagu Anggaran disembunyikan.
  - Data pagu dan realisasi lama **tidak ditampilkan lagi**, tetapi tetap ada di
    database.
- **Migrasi 059** `059_realisasi_dokumen.sql` membuat dua tabel:
  `sdl_ren_realisasi_dok` (FK dokumen) dan `sdl_ren_realisasi_dok_bukti`.
  - Bentuk dan aturannya sama dengan 050: pembuat ≠ pemeriksa, bukti terenkripsi
    wajib sebelum verifikasi.
  - Permission yang dipakai tetap milik 050.
  - Tabel baru diperlukan karena `sdl_ren_realisasi.pagu_id` NOT NULL.
  - R5H15 bergeser ke **060**.
- **Endpoint** `progar.js` `/realisasi-dokumen` (GET, POST, PUT, bukti POST/GET, review).
  - Pos aktif = dokumen final, punya anggaran, dan belum digantikan revisi. Pos
    yang sudah punya realisasi tetap tampil walau tidak aktif.
  - Galat: `pos_tidak_aktif`, `melebihi_sisa_anggaran`, `tahun_tidak_cocok`.
  - `PUT /dokumen/:id/anggaran` menolak nilai di bawah realisasi terverifikasi
    (`anggaran_di_bawah_realisasi`).
- **Frontend.**
  - `RealisasiR5H12`: pos dokumen menggantikan pos kegiatan; arsip LRA lama
    dihapus dari layar.
  - `App.tsx`: DALGAR berisi Realisasi, Laporan, dan Revisi Anggaran. Rute dan
    import `ProgarR5H11` (Pagu) dihapus.
- **Uji di browser dengan dua akun.**
  - [UJI SELESAI] dibuka kembali, diberi anggaran Rp 500.000.000, lalu ditandai
    Selesai, dan tampil sebagai pos.
  - OP mencatat Rp 120.000.000 dan mengunggah bukti; KS memverifikasi. Hasilnya:
    terserap 24%, sisa Rp 380.000.000.
  - Pencatatan Rp 400.000.000 ditolak dengan pesan "melebihi sisa anggaran".
  - Tidak ada error.
  - Belum diuji: penjaga anggaran di bawah realisasi.
- **Risiko yang perlu diingat:** anggaran di Renja, RKKS, dan DIPA bisa mencakup
  uang yang sama, jadi bisa terhitung ganda kalau semuanya diisi. Pemilik memilih
  "tiap dokumen Final" dengan konsekuensi ini.

### 7l. R5H19: Laporan dan Revisi Anggaran tersambung ke angka (2026-11-18)

- **Keputusan pemilik:**
  - LRA, Laporan Penggunaan Anggaran, EKA PN, dan Hibah otomatis mengambil
    realisasi terverifikasi per pos.
  - Angka laporan **sementara** selama Dalam proses, **dibekukan** (potret) saat
    ditandai Selesai.
  - Revisi POK = daftar dokumen Final + anggaran baru, diterapkan saat revisi Selesai.
  - RPD bulanan per pos; Revisi RPD mengubahnya saat Selesai.
  - Undangan/disposisi Urmin → Laporan **ditunda**.
- **Migrasi 060** `060_laporan_revisi_rpd.sql`:
  - `sdl_ren_dokumen` + `hibah` (BOOLEAN, default FALSE) + `ringkasan` (JSONB potret).
  - Tabel `sdl_ren_rpd` (dokumen, bulan 1–12, jumlah) dan `sdl_ren_revisi_item`
    (revisi → dokumen, anggaran/RPD baru, nilai lama, `diterapkan_at`).
  - R5H15 bergeser ke **061**, lalu ke **062** (lihat §7m).
- **Backend** (modul baru `dalgar.js`, dipakai `perencanaan.js` dan `progar.js`):
  - `GET /dokumen/:id/ringkasan`: periode laporan (bulan/triwulan/setahun),
    anggaran, rencana RPD, realisasi periode dan kumulatif, sisa per pos.
    Laporan Hibah hanya pos bertanda hibah.
  - `GET/PUT /dokumen/:id/revisi-item` (maks 40 butir, hanya sebelum Selesai).
  - `/final` revisi: terapkan ke pos (POK: tidak di bawah realisasi terverifikasi;
    RPD: total = anggaran pos). Revisi yang sudah diterapkan tidak bisa dibuka
    kembali (`revisi_sudah_diterapkan`).
  - `/final` laporan: simpan potret; dibuka kembali = potret dihapus.
  - `PUT /progar/realisasi-dokumen/pos/:dokumenId/rpd`: RPD awal sekali saja
    (`rpd_sudah_ada`); total harus sama dengan anggaran.
  - `PUT /dokumen/:id/anggaran` menerima `hibah`. Pos realisasi tidak lagi bisa
    berupa dokumen laporan/revisi DALGAR.
- **Frontend:** `DalgarR5H19.tsx` (RingkasanRealisasi, RevisiAnggaran + editor,
  RpdDialog). Detail laporan/revisi menampilkan panelnya; Realisasi menampilkan
  RPD vs realisasi per bulan (dilipat) dan tanda "Dana hibah"; dialog anggaran
  punya pilihan Sumber dana.
- **Uji di browser dengan dua akun (tanpa error):**
  - RPD awal [UJI SELESAI]: total salah ditolak; bagi rata Rp 500 jt disimpan;
    isi ulang ditolak 409.
  - LRA Oktober 2028: angka sementara (anggaran 500 jt, rencana Okt 41,67 jt,
    realisasi s.d. Okt 120 jt, 24%), lalu Selesai → potret.
  - [UJI] Revisi POK I 2028: 100 jt ditolak (di bawah realisasi), 600 jt
    disimpan, Selesai → anggaran pos jadi 600 jt (sisa 480 jt); tombol Buka
    Kembali hilang; LRA beku tetap 500 jt; Realisasi memberi tanda RPD ≠ anggaran.
  - [UJI] Revisi RPD I 2028: bagi rata 600 jt, Selesai → RPD baru 50 jt/bulan.
  - [UJI TAHAP] Renstra ditandai Dana hibah.
- **Catatan:** penanda hibah hanya bisa diubah selama dokumen belum Final (ikut
  aturan anggaran). Revisi DIPA belum tersambung ke Revisi RPD.

### 7m. Revisi RPD tersambung ke dokumen DIPA (2026-11-18)

- **Keputusan pemilik:**
  - Revisi RPD **ditautkan ke dokumen DIPA yang sudah ada**. Operator mengunggah
    DIPA/Revisi DIPA seperti biasa; sistem tidak membuatnya otomatis.
  - Revisi RPD **wajib** sampai tahap "DIPA baru terbit" diterima Kasubbagren
    dengan PDF DIPA terlampir sebelum bisa ditandai Selesai.
- **Migrasi 061** `061_revisi_rpd_dipa.sql`: `sdl_ren_dokumen.dipa_id` (UUID FK,
  nullable). R5H15 bergeser ke **062**, lalu ke **063** (lihat §7n).
- **Backend** `perencanaan.js`:
  - `PUT /dokumen/:id/dipa {dipaId:""|uuid,version}`: hanya Revisi RPD yang belum
    Selesai. DIPA tujuan berjenis DIPA/Revisi DIPA, setahun, tidak ditolak, dan
    belum digantikan (`dipa_tidak_sesuai`).
  - `/final` Revisi RPD: `dipa_baru_belum` atau `dipa_belum_ditautkan`; DIPA
    diperiksa ulang saat Selesai.
  - Daftar dokumen mengirim `dipaId`.
- **Frontend** `DokumenR5H13`:
  - Detail Revisi RPD punya baris "DIPA terkait" dengan tombol Pilih DIPA/Ganti.
    Dialognya memilih otomatis DIPA yang nomornya cocok dengan tahap "DIPA baru
    terbit".
  - Detail DIPA punya baris "Revisi RPD terkait". Tautan di kedua arah membuka
    dokumennya.
  - Tombol Tandai Selesai nonaktif dan menjelaskan syarat yang belum terpenuhi.
- **Uji di browser dengan dua akun (tanpa error):** [UJI] Revisi RPD II 2028.
  - Tautan ke dokumen non-DIPA ditolak 409; Selesai sebelum DIPA terbit ditolak 409.
  - Setelah tahap DIPA baru + PDF diterima, dialog memilih otomatis
    [UJI] Revisi DIPA 2028 ke-1 (cocok nomor).
  - Selesai berhasil: RPD pos jadi Jan 100 jt, Feb–Nov 50 jt, Des 0. Detail DIPA
    menampilkan Revisi RPD terkait.
- **Catatan:** [UJI] Revisi RPD I 2028 sudah Selesai sebelum aturan ini, jadi
  tanpa DIPA terkait.

### 7n. R5H20: impor myinterest sebagai acuan resmi LRA dan dashboard (2026-11-18)

- **Keputusan pemilik:**
  - Angka **myinterest** ("Realisasi Belanja per Jenis Kegiatan") menjadi acuan
    resmi untuk LRA dan dashboard. Realisasi manual per dokumen (R5H18) tetap ada
    sebagai catatan internal; menunya berganti nama menjadi "Realisasi Anggaran Dokumen".
  - Operator mengimpor file; langsung berlaku tanpa persetujuan.
  - Grafik tampil di Dashboard Subbagren dan Dashboard pimpinan.
- **Migrasi 062** `062_myinterest_impor.sql`: `sdl_ren_myinterest_impor` (potret
  per tanggal data; hapus lunak; satu potret aktif per tanggal) dan
  `sdl_ren_myinterest_baris` (kegiatan × jenis belanja: pagu, realisasi).
  R5H15 bergeser ke **063**.
- **Backend:**
  - `myinterest-xlsx.js`: pembaca xlsx tanpa dependensi baru. Zip dibaca dengan
    `node:zlib` dengan batas ukuran (berkas 2 MB, entri 16 MB). Angka diperiksa
    silang dengan kolom Total dan baris GRAND TOTAL. Rentang tanggal wajib mulai
    1 Januari (angka kumulatif).
  - `myinterest.js`, dipasang di router progar:
    - `GET /myinterest?tahun=|terbaru` (`progar.read`).
    - `POST /myinterest` (`realisasi.manage`); impor ulang tanggal yang sama
      menggantikan potret lama.
    - `DELETE /myinterest/:id`.
  - `dalgar.js`: ringkasan LRA kini per kegiatan dari myinterest.
    - Kumulatif = potret terakhir di bulan laporan.
    - Realisasi bulan itu = selisih dengan potret terakhir bulan sebelumnya.
    - Dibekukan saat Selesai.
- **Frontend** `MyinterestR5H20.tsx`:
  - Menu DALGAR "Data myinterest (LRA)": impor, riwayat dan hapus, rincian per
    kegiatan × jenis belanja.
  - `LraChart`: angka serapan, batang serapan per kegiatan, dan realisasi per bulan
    (grafik mulai dua bulan).
  - Dipasang di `SmartUnitDashboard` (unit ren, menggantikan panel Budget
    Performance lama) dan `ExecutiveDecisionR5F24` (leader).
  - Dashboard pimpinan membaca endpoint progar, karena Kabagrenmin punya
    `subbagren.progar.read`; API executive/v2 tidak diubah.
- **Uji di browser, akun OP dan Kabagrenmin (tanpa error):**
  - Berkas yang totalnya diubah ditolak (`total_tidak_cocok`).
  - Impor uji 30 Sep 2028 dan 31 Okt 2028 berhasil; impor ulang 31 Okt
    menggantikan yang lama.
  - Serapan 78,29%, realisasi Oktober Rp 149,10 M dari selisih potret.
  - LRA Oktober 2028 dibuka kembali, lalu menampilkan per kegiatan (mis. 3073:
    Okt Rp 18,9 M, s.d. Okt Rp 189,9 M), lalu Selesai dan dibekukan.
  - Panel tampil di Dashboard Subbagren (PROGAR dan DALGAR) dan Dashboard pimpinan.
  - Pembaca juga diuji pada `docs/realisasi-belanja.xlsx` asli (cocok:
    Rp 1.487.719.385.000 / Rp 1.398.947.177.519). Hanya dibaca, tidak diimpor
    ke database.
- **Catatan:**
  - `docs/realisasi-belanja.xlsx` berisi angka anggaran asli dan **belum masuk
    git**; sebaiknya tidak di-commit.
  - Temuan lama yang tidak terkait: halaman workspace di lebar 390px melebar ke
    624px (juga di menu Laporan yang lama).
  - Data uji di laptop: potret myinterest 30 Sep dan 31 Okt 2028 (fiktif).

### 7o. File myinterest diunggah di tahap 1 LRA, bukan menu terpisah (2026-11-18)

- **Keputusan pemilik:**
  - File myinterest **hanya** diunggah di tahap 1 LRA bulanan dan langsung berlaku
    untuk dashboard. Kasubbagren tetap memeriksa tahapnya.
  - Menu Data myinterest menjadi **halaman lihat** (tanpa impor/hapus).
- **Alur LRA (docx no. 14):**
  1. Mengunduh realisasi dari myinterest: isian tanggal unduh, dasar (default
     "Surat arahan … pengganti aplikasi SMAP"), dan satu file Excel.
  2. Menyusun laporan dan surat pengantar (PDF).
  3. Tanda tangan Kadensus.
  4. Kirim ke Astamarena.
- **Backend:**
  - Katalog: form/pekerjaan `unduh_myinterest`, slot `myinterest` berjenis `xlsx`.
    `lap_lra` kini dimulai dari tahap ini.
  - Unggah lampiran slot xlsx:
    - Batas 2 MB, dibaca dengan `parseMyinterest`, rentang wajib 1 Januari.
    - Tanggal data wajib di bulan laporan (`myinterest_bulan_tidak_cocok`).
    - Unggahan baru menggantikan file lama beserta potretnya, lalu langsung
      diimpor (`simpanPotret`).
  - Hapus lampiran = potret dihapus lunak (`hapusPotretLampiran`, cocok sha256).
  - `myinterest.js`: POST/DELETE dicabut; GET menambahkan tautan `lra` per potret.
- **Frontend:**
  - Formulir tahap: slot xlsx satu file (".xlsx"), ditandai "akan diganti".
  - Lampiran .xlsx diunduh, tidak dipratinjau.
  - Halaman Data myinterest: tanpa tombol impor; tombol "Buka LRA di menu
    Laporan"; riwayat berkolom LRA.
- **Uji di browser (tanpa error)**, data uji: LRA November 2028.
  - File Oktober ditolak untuk LRA November.
  - File November diterima: realisasi November 3073 = Rp 19,2 M (selisih potret);
    riwayat "30 Nov 2028 → LRA November 2028".
  - Mengganti file tetap satu potret.
  - Menghapus lampiran: potret 30 Nov hilang dan ringkasan meminta unggah.
    Unggah kembali berhasil.
  - Grafik bulanan Okt–Nov tampil; serapan 88,31%.
- **Catatan:** potret uji 30 Sep dan 31 Okt 2028 diimpor lewat endpoint lama
  (sudah dicabut), sehingga tidak punya lampiran tahap.

### 7p. Tanggal dan jam unduh myinterest otomatis dari file (2026-11-18)

- **Permintaan pemilik:** tanggal dan jam unduh tidak diketik, tetapi diambil dari
  baris "Waktu unduh excel" di file. Dashboard menerangkan data per tanggal berapa.
- **Backend:**
  - `waktuUnduhOf()` membaca "16-11-2026 12:34:02 WIB (+0700 GMT)" (format
    myinterest) dan format ISO.
  - Isian `tanggal` dan `jamUnduh` tahap "Mengunduh realisasi" kini berflag
    `auto`: `cleanIsian` mengabaikan nilai dari klien, `PUT` tahap
    mempertahankannya, unggah file mengisinya, dan hapus file mengosongkannya.
- **Frontend:**
  - Isian auto tampil sebagai kotak baca-saja ("Terisi otomatis saat file diunggah").
  - Keterangan di grafik, LRA, dan riwayat menjadi "Data myinterest per
    30 Nov 2028 · diunduh 2 Des 2028 pukul 09.15 WIB" (`fmtUnduh`).
- **Uji (tanpa error):**
  - Unggah file November (waktu unduh 02-12-2028 09:15:40) → isian
    `tanggal=2028-12-02`, `jamUnduh=09:15:40 WIB`; kolom Tanggal di register
    2 Des 2028.
  - `PUT` dengan tanggal palsu diabaikan.
  - Dashboard Subbagren dan Dashboard pimpinan menampilkan keterangan tersebut.

### 7q. Tahap PROGAR tanpa pengecekan Kasubbagren (2026-11-18)

Keputusan pemilik: tahap pekerjaan di dokumen **PROGAR** (Dokumen Perancangan/Final)
langsung berlaku tanpa cek Kasubbagren. Tahap **DALGAR** (laporan, revisi anggaran)
tetap Menunggu dicek -> Diterima/Dikembalikan. Pengesahan dokumen (Sahkan/Tolak) tidak
berubah. Tanpa migrasi; kolom `cek_status` tetap ada tetapi diabaikan untuk PROGAR.

- Backend: `tahapPerluCek(jenis)` di `dalgar.js` (= jenis DALGAR). `/final` hanya
  mensyaratkan semua tahap diterima untuk DALGAR; hapus tahap yang sudah diterima hanya
  dikunci untuk DALGAR; `POST /tahap/:tid/cek` pada dokumen PROGAR -> 409 `tahap_tanpa_cek`.
  `tahapOf` kini ikut membaca `jenis` dokumen (`FOR UPDATE OF t`).
- Frontend: kolom/bagian "Pemeriksaan", status cek, saringan "Belum diterima", tombol
  Terima/Kembalikan, dan antrean "Perlu dicek saya" untuk tahap tidak tampil pada PROGAR.
  Tandai Final/Selesai PROGAR tidak lagi menunggu cek.
- Uji (Chrome): cek tahap Renstra [UJI TAHAP] -> 409 `tahap_tanpa_cek`; tabel tahap tanpa
  kolom Pemeriksaan; Tandai Final aktif meski 4 tahap lama "menunggu"; final -> 200 lalu
  dikembalikan -> 200; LRA November Selesai masih 409 `tahap_belum_diterima`; tanpa error.

### 7r. Lampiran dokumen di luar tahap pekerjaan (2026-11-18, migrasi 063)

Permintaan pemilik: Dokumen Perancangan dan Dokumen Final punya lampiran sendiri, terpisah
dari lampiran tiap tahap pekerjaan. Keputusan: **PDF, Excel (.xlsx), atau Word (.docx)**;
bisa ditambah/dihapus selama dokumen belum final; **terkunci setelah Final**.
R5H15 bergeser ke migrasi **064**.

- Migrasi `063_dokumen_lampiran.sql`: tabel baru `sdl_ren_dokumen_lampiran` (dokumen_id,
  jenis pdf|xlsx|docx, filename, size_bytes <= 20 MB, sha256, body tersegel AES-GCM,
  uploaded_by/at). Terdaftar di `migrate_test.go` dan `migrations/index.js`.
- API: `POST /dokumen/:id/lampiran` (multipart `file`), `GET`/`DELETE /dokumen/:id/lampiran/:lid`;
  daftar dokumen membawa `lampiran[]`. Maks 30 per dokumen. PDF diperiksa seperti biasa;
  .xlsx/.docx harus zip OOXML utuh dengan bagian intinya, berkas bermakro (`vbaProject.bin`)
  ditolak. Unduhan selalu `attachment` + `nosniff` + CSP sandbox; id lampiran dokumen lain -> 404.
  Terbuka = belum final dan (draft, atau sah dan belum digantikan); selain itu 409 `dokumen_terkunci`.
- UI: bagian **Lampiran Dokumen** di detail dokumen PROGAR (tidak di DALGAR), di atas Tahap
  Pekerjaan: label jenis, nama berkas (PDF dipratinjau, Excel/Word diunduh), pengunggah,
  tanggal, ukuran, Hapus; ＋ Tambah Lampiran bisa memilih beberapa berkas sekaligus.
- Uji (Chrome): 3 berkas sekaligus tersimpan; .docx palsu, .docx bermakro, dan .exe ditolak;
  pratinjau PDF terbuka; unduhan .docx byte-sama; IDOR 404; hapus jalan; dokumen final 409 dan
  tampil "Terkunci"; tanpa error. Data uji: 2 lampiran di "[UJI TAHAP] Renstra".

### 7s. LRA dan myinterest dikembalikan ke bentuk sebelumnya (2026-11-18)

Keputusan pemilik: **membatalkan §7o–§7p** (unggah myinterest di tahap 1 LRA, tanggal/jam
unduh otomatis di tahap). Impor myinterest kembali ke **menu sendiri** "Data myinterest (LRA)".

- LRA kembali ke alur semula: `terima_permintaan_laporan` → `susun_laporan` →
  `ttd_kadensus` → `kirim_laporan`. Pekerjaan/form `unduh_myinterest`, slot berjenis `xlsx`,
  isian `auto` (`autoKeys`), `readMyinterestFile`/`cekBulanLra`, dan `waktuUnduhOf` dibuang.
- Menu Data myinterest kembali punya **⤒ Impor file myinterest** (Operator,
  `subbagren.realisasi.manage`), Riwayat impor dengan **Hapus**, dan tautan "Buka menu Laporan".
  API `POST /myinterest` dan `DELETE /myinterest/:id` dipasang lagi (POST memakai `simpanPotret`).
  Kolom LRA di riwayat dibuang.
- Tetap dipertahankan: ringkasan LRA membaca potret myinterest (seperti sebelum §7o) dan
  keterangan "Data myinterest per … · diunduh … pukul …" (`fmtUnduh`) di grafik, LRA, riwayat.
- Data uji: tahap `unduh_myinterest` di "LRA November 2028" dihapus (potret 30 Nov tetap ada).
- Uji (Chrome): pilihan pekerjaan LRA 4 langkah lama; ringkasan LRA November tetap dari
  myinterest; impor (menggantikan tanggal sama), file rusak ditolak, hapus + impor ulang jalan;
  dashboard menampilkan keterangan tanggal; Kabagrenmin POST 403; tanpa error.

### 7t. Tahap "Mengunduh realisasi dari myinterest" kembali, hanya sebagai lampiran (2026-11-18)

Keputusan pemilik: tahap unduh myinterest tetap ada di LRA, tetapi file hasil unduhan
**hanya lampiran** -- tidak diimpor dan tidak memengaruhi dashboard/ringkasan LRA (angka
tetap dari menu Data myinterest).

- Katalog: form/pekerjaan `unduh_myinterest` (Tanggal unduh -- diketik, Dasar penyusunan,
  Catatan; slot `unduhan` berjenis `office`). `lap_lra`: terima_permintaan_laporan,
  unduh_myinterest, susun_laporan, ttd_kadensus, kirim_laporan.
- Slot berjenis `office` menerima PDF/.xlsx/.docx (pemeriksaan sama dengan lampiran dokumen,
  `readLampiranDokumen`); slot lain tetap PDF saja. Frontend menyesuaikan accept dan pesan.
- Uji (Chrome): tahap ditambahkan ke LRA November dengan 1 Excel + 1 PDF; jumlah impor
  myinterest tetap 3; unduhan Excel byte-sama; tanpa error.

## Keputusan terbuka (menunggu pemilik)

1. **Nama menu:** usulan *Penyusunan Dokumen* + *Dokumen Sah* (sesuai istilah
   dokumen alur dan status "Sah"), menggantikan "Dokumen Perancangan / Final".
2. **Siapa "mengesahkan" di sistem:** dokumen alur menyebut Kadensus (atau
   Kapolri untuk Perjanjian Kinerja); di SDL tombol Sahkan dipegang Kasubbagren.
   Apakah "Sah" berarti *dicatat sah* setelah ditandatangani di luar sistem?
3. **Asumsi R5H16 yang belum dikonfirmasi:** urutan tahap bebas; bukti
   "utama" tidak memblokir pengesahan (hanya ditandai ⚠). (Tandai Final oleh operator
   maupun Kasubbagren: **sudah diputuskan 2026-11-17**.)
4. Apakah `Alur_Pekerjaan_Densus88_Format_Kolom.docx` ikut di-commit.
5. R5H15 backend: lanjut `/rencana R5H15`?

## Langkah berikutnya

1. **Commit** pekerjaan sesi ini. File 053 **wajib** satu commit dengan
   `migrate_test.go` dan `migrations/index.js` (pelajaran insiden 050). Perintah
   commit ada di percakapan 2026-11-16.
2. Nyalakan Docker Desktop (mati saat catatan ini ditulis), lalu jalankan
   `/verifikasi`: `security-test-express.sh`, harness, dan tulis
   `apps/backend-express/verify/r5h16-flow.js` (izin, IDOR tahap/berkas, isian
   asing ditolak, aturan draft/sah/distribusi, `tahun=semua`).
3. Tulis `docs/R5H16-TAHAP-PEKERJAAN.md` (keputusan, katalog, endpoint, migrasi).
4. Uji ＋ Catat Distribusi di Dokumen Final.
5. Deploy: migrasi 049–056 lewat Run workflow (*migrate* dicentang); pastikan
   `SDL_EXPRESS_PATHS` mencakup `/api/v1/subbagren/*`.
