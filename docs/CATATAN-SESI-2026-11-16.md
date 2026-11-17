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
