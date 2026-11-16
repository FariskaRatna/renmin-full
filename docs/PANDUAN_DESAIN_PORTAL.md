# Panduan Implementasi Desain Portal SIERA DELTA LIMA

Dokumen ini adalah acuan wajib untuk mengubah tampilan halaman Portal (`#/portal`). Baca seluruh dokumen sebelum menulis kode. Jika ada hal yang tidak diatur di sini, tanyakan dulu, jangan menebak.

## 1. Lingkup pekerjaan

Yang boleh diubah:
- Tampilan halaman Portal (Beranda) beserta header dan footer aplikasi.
- Token warna tema (light dan dark).
- Ikon pada navigasi dan kartu unit.

Yang TIDAK boleh diubah tanpa izin:
- Logika data, pemanggilan API, state management, dan routing.
- Halaman lain selain Portal.
- Struktur folder, nama file yang sudah ada, dan dependency (jangan menambah library baru tanpa bertanya).
- Teks konten yang berasal dari data (judul berita, agenda, pengumuman). Hanya teks statis antarmuka yang boleh disesuaikan.

## 2. Cara kerja

1. Baca struktur proyek dan komponen yang dipakai halaman Portal. Laporkan temuanmu secara singkat: framework, library UI, lokasi token tema, dan komponen yang akan disentuh.
2. Buat rencana perubahan per bagian (lihat urutan di bagian 5). Tunggu persetujuan sebelum mengubah kode.
3. Kerjakan satu bagian per langkah. Setelah tiap langkah, jalankan aplikasi dan pastikan tidak ada error di console maupun saat build.
4. Jangan menulis ulang komponen dari nol jika cukup mengubah kelas atau token.
5. Jika memakai shadcn/ui, ubah variabel CSS tema dan kelas Tailwind. Jangan mengedit file di `components/ui` kecuali benar-benar perlu, dan sebutkan alasannya.
6. Semua perintah terminal yang diberikan ke pengguna ditulis untuk Windows Command Prompt (CMD).

## 3. Token warna

Gunakan variabel CSS berikut sebagai satu-satunya sumber warna. Jangan menulis kode hex langsung di komponen, kecuali tag "Penting" (lihat aturan warna).

| Token | Light | Dark | Dipakai untuk |
|---|---|---|---|
| `--bg` | `#F2F4F7` | `#121417` | Latar halaman |
| `--surface` | `#FFFFFF` | `#1B1E23` | Kartu, panel |
| `--surface-2` | `#EEF0F3` | `#272B32` | Latar sekunder, tab bulan, blok tanggal biasa |
| `--border` | `#D3D8DE` | `#343942` | Garis kartu |
| `--divider` | `#E8EBEF` | `#2A2E35` | Garis antarbaris dalam kartu |
| `--header-bg` | `#FFFFFF` | `#1B1E23` | Header dan baris tab |
| `--header-border` | `#DDE1E6` | `#2A2E35` | Garis bawah header |
| `--text` | `#1C1F24` | `#E8EAED` | Teks utama, ikon |
| `--text-2` | `#3A3F46` | `#C4C8CE` | Teks isi sekunder |
| `--muted` | `#5A5F66` | `#A0A6AE` | Keterangan, tanggal, metadata |
| `--link` | `#1A4E8A` | `#8AB4F8` | Tautan |
| `--link-hover` | `#0F3360` | `#B3CEFB` | Tautan saat hover |
| `--band` | `#1C1F24` | `#262A31` | Pita judul |
| `--band-sub` | `#D0D4D9` | `#C4C8CE` | Subjudul di pita judul |
| `--brand-red` | `#7E1416` | `#D64545` | Garis atas header, garis menu aktif |
| `--accent` | `#F0C419` | `#F0C419` | Garis bawah pita judul, focus ring |
| `--strong` | `#1C1F24` | `#E8EAED` | Badge, tag kategori, blok tanggal terdekat |
| `--on-strong` | `#FFFFFF` | `#121417` | Teks di atas `--strong` |
| `--photo` | `#E3E6EA` | `#2A2E35` | Latar slot foto |
| `--note-bg` | `#FEF7DA` | `#2E2814` | Latar baris pengumuman penting |
| `--footer` | `#1C1F24` | `#0B0C0E` | Latar footer |
| `--footer-text` | `#B9BDC3` | `#A0A6AE` | Teks footer |

Mode gelap diaktifkan dengan kelas pada elemen root (misalnya `.dark` atau `data-theme="dark"`, ikuti yang sudah dipakai proyek). Simpan pilihan pengguna di `localStorage`. Jika belum ada pilihan, ikuti `prefers-color-scheme`.

## 4. Aturan warna (wajib dipatuhi)

Warna membawa makna. Ikuti aturan ini tanpa pengecualian:

- Merah lambang (`--brand-red`) HANYA untuk garis atas header (4px) dan garis bawah menu navigasi aktif (3px). Jangan dipakai untuk ikon, badge, tag, tombol, atau teks.
- Kuning (`--accent`) HANYA untuk garis bawah pita judul (5px) dan focus ring keyboard.
- Tag "Penting" memakai latar `#F0C419` dengan teks `#1C1F24` di kedua mode, ditambah ikon tanda seru. Ini satu-satunya penanda peringatan di halaman.
- Biru (`--link`) HANYA untuk tautan.
- Badge jumlah, ikon unit, tag kategori berita, label PDF, dan blok tanggal memakai warna netral (`--strong`, `--text`, `--text-2`).
- Merah terang untuk error disimpan untuk pesan error di masa depan dan selalu disertai ikon serta teks.
- Dilarang memakai gradien, efek cahaya (glow), bayangan tebal, dan warna pastel pada ikon.

## 5. Spesifikasi per bagian (urutan dari atas)

Lebar konten maksimum 1400px (setara container widescreen USWDS), dengan padding samping `clamp(24px, 4vw, 56px)`. Aturan ini berlaku SAMA untuk header, pita judul, baris tab, isi halaman, dan footer, supaya tepi kiri logo, judul, tab, dan kartu selalu sejajar. Buat satu komponen atau kelas container bersama (misalnya `.container`) dan pakai di semua tempat, jangan menulis max-width berbeda-beda per bagian.

Jarak antarbagian 48px. Jarak judul bagian ke isinya 16px. Radius sudut kartu 6px.

### 5.1 Header
- Garis atas 4px `--brand-red`, garis bawah 1px `--header-border`, latar `--header-bg`.
- Kiri: logo 44px, lalu "SIERA DELTA LIMA" (800, 16px) dan "BagRenmin Densus 88 AT Polri" (14px, `--muted`) di bawahnya.
- Navigasi: Portal, Arahan, Inbox, Tugas. Tiap item berisi ikon 18px dan label.
- Badge jumlah berupa bulatan kecil 16px di pojok kanan atas ikon (bukan teks "(1)" dan bukan pil di samping label). Latar `--strong`, teks `--on-strong`, 10px tebal, dengan cincin 2px warna `--header-bg`.
- Bungkus ikon dan badge dalam satu elemen `position: relative; display: inline-flex`, lalu badge `position: absolute; top: -7px; right: -9px`. Jarak antara wrapper ikon dan label minimal 10px, sehingga badge tidak pernah menyentuh atau menimpa huruf pertama label.
- Saat pengguna berada di halaman turunan Portal (misalnya halaman unit Urmin), menu "Portal" tetap berstatus aktif.
- Menu aktif: teks tebal, ikon versi solid (fill), garis bawah 3px `--brand-red`. Menu lain memakai ikon bergaris.
- Tombol ganti mode 44x44px, ikon bulan di mode terang dan matahari di mode gelap. `aria-label` berubah sesuai mode: "Ganti ke mode gelap" atau "Ganti ke mode terang".
- Menu akun: avatar inisial (latar `--strong`), nama, jabatan, dan chevron.
- Setiap tautan navigasi punya `aria-label` lengkap, misalnya "Inbox, 2 belum dibaca".

### 5.2 Pita judul
- Latar `--band`, garis bawah 5px `--accent`, padding 44px atas dan 40px bawah.
- Judul "Portal BagRenmin" 48px, tebal 800, satu warna putih. Jangan memecah judul menjadi dua warna.
- Subjudul 19px warna `--band-sub`.
- Watermark logo di kanan atas: sekitar 440px, opacity 0.07, grayscale, `aria-hidden`.
- Tanpa gradien, tanpa eyebrow label, tanpa logo besar dalam lingkaran.

### 5.3 Baris tab portal
- Latar `--header-bg`, garis bawah 1px. Tab: Beranda, Berita & pengumuman, Kalender, SOP & peraturan.
- Tinggi 52px. Tab aktif: tebal, garis bawah 3px `--text` (sengaja berbeda dari merah menu header).
- Di layar sempit, baris tab bisa digeser horizontal.

### 5.4 Unit & layanan
- Judul bagian + deskripsi "Pilih unit untuk mengakses layanan administrasi."
- Grid `repeat(auto-fit, minmax(300px, 1fr))`, jarak 16px. Enam kartu.
- Kartu RATA KIRI, seluruh kartu bisa diklik: ikon 28px tanpa kotak latar, lalu nama unit (700, 18px) dan deskripsi (15px, `--muted`), lalu chevron di kanan.
- Hover: garis kartu berubah ke `--text` dan nama unit bergaris bawah.
- Ikon unit memakai SVG khusus di bagian 7. Jangan diganti ikon generik.

### 5.5 Informasi & berita (carousel)
- Selebar halaman. Kepala bagian: judul di kiri; di kanan berurutan tautan "Semua berita", penunjuk "1-3 dari 4", tombol sebelumnya, tombol berikutnya.
- Tombol panah bulat 44px, garis 1px `--text`. Nonaktif (opacity 0.35) di ujung.
- Desktop menampilkan 3 kartu, layar di bawah 1000px menampilkan 2, layar di bawah 700px berubah menjadi geser horizontal native dengan scroll-snap dan tombol panah disembunyikan.
- Tidak boleh berputar otomatis. Penunjuk posisi memakai `aria-live="polite"`.
- Kartu: foto 16:9 di atas, lalu tag kategori (latar `--strong`) dan tanggal, judul (800, 19px), ringkasan (15px).
- Jika belum ada berita, tampilkan SATU empty state saja dan sembunyikan kontrol carousel.

### 5.6 Pengumuman
- Selebar halaman, satu kartu berisi daftar baris.
- Baris penting: latar `--note-bg`, tag "Penting", judul tebal, ringkasan satu kalimat, lalu "Dari Subbagren, 12 Nov 2026" di kanan dan chevron.
- Baris biasa: judul, keterangan pengirim dan tanggal di kanan, chevron.
- Jangan dijadikan carousel. Tampilkan maksimal 3 baris, sisanya lewat "Lihat semua".

### 5.7 Kalender dan SOP & peraturan
- Dua kolom 50:50 (`flex: 1 1 420px` untuk keduanya), tinggi kartu disamakan, bertumpuk di layar sempit.
- Kalender: deskripsi "Agenda yang telah dipublikasikan untuk BagRenmin.", segmented tab tiga bulan (bulan lalu, bulan ini, bulan depan) dengan bulan aktif berlatar `--surface`, lalu daftar agenda.
- Baris agenda: blok tanggal 56px (singkatan hari dan angka tanggal), judul, keterangan waktu dan tempat. Agenda terdekat memakai blok `--strong`, sisanya `--surface-2`.
- SOP: daftar dokumen dengan label "PDF" bergaris `--text-2`, judul, ukuran file, ikon unduh.

### 5.8 Footer
- Latar `--footer`, teks `--footer-text`, 14px.
- Kiri: "© 2026 SIERA DELTA LIMA". Kanan: "BagRenmin Densus 88 AT Polri". Tidak ada isi lain.

## 6. Aturan penulisan teks

- Nama aplikasi selalu "SIERA DELTA LIMA". Jangan menulis "SIHERA".
- Penulisan "BagRenmin" harus seragam di seluruh halaman.
- Gunakan sentence case: "Berita & pengumuman", "Lihat semua", bukan "Berita & Pengumuman" atau "Lihat Semua".
- DILARANG memakai tanda pisah panjang (em dash) dan titik tengah (·) sebagai pemisah. Gunakan koma, kata sambung, atau kalimat terpisah.
- Format waktu mengikuti tata naskah dinas: "Pukul 09.00 s.d. 11.00 WIB di ruang rapat", "Paling lambat pukul 16.00 WIB".
- Jangan menambahkan tanda panah teks ("→") di tautan.
- Satu bahasa: gunakan bahasa Indonesia untuk semua label (Tugas, bukan Tasks).
- Hapus label "Data contoh" dan teks placeholder ketika data asli sudah tersedia.

## 7. Ikon

- Navigasi: ikon garis 18px, stroke 2. Ikon menu aktif memakai versi solid.
- Unit: SVG di bawah ini, 28px, `stroke="currentColor"`, stroke-width 1.8, linecap dan linejoin round, `fill="none"`, warna `--text`, `aria-hidden="true"`.
- Jangan meletakkan ikon di dalam kotak berwarna. Jangan menambahkan ikon di judul bagian.

```html
<!-- Urmin: amplop dengan cap disposisi -->
<rect x="2" y="5" width="15" height="11" rx="1.5"/><path d="M2.5 6.5l7 5 7-5"/><circle cx="18" cy="17" r="4" fill="var(--surface)"/><path d="M16.3 17l1.2 1.2 2.2-2.4"/>

<!-- Subbagren: buku anggaran dengan Rp -->
<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/><text x="7.6" y="13.4" font-family="Public Sans, sans-serif" font-size="7" font-weight="800" fill="currentColor" stroke="none">Rp</text>

<!-- Subbagsumda: kartu identitas personel -->
<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10.8" r="2.2"/><path d="M5.8 16.2a3.4 3.4 0 0 1 6.4 0"/><path d="M14.5 10h3.5"/><path d="M14.5 13.5h3.5"/>

<!-- Subbagbinfung: medali berpita -->
<path d="M8 2.5l2.2 6.2"/><path d="M16 2.5l-2.2 6.2"/><circle cx="12" cy="15" r="5.8"/><path d="M12 11.8l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z"/>

<!-- SPP: kuitansi SPJ -->
<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 7.5h6"/><path d="M9 11h6"/><path d="M9 14.5h3"/>

<!-- Kalender -->
<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M8 3v4"/><path d="M16 3v4"/><rect x="7.5" y="13.5" width="3.5" height="3.5" rx="0.5"/>
```

Jika nanti pengguna menyediakan ikon dari template Nifty, ganti ikon di atas dengan ikon tersebut dan tetap ikuti aturan ukuran serta warna di bagian ini.

## 8. Tipografi

- Font: Public Sans (400, 500, 600, 700, 800) dengan fallback `system-ui, sans-serif`.
- Teks isi minimal 15–16px, keterangan minimal 14px, label kecil minimal 12px.
- Judul bagian 24px, tebal 800. Jangan memakai judul bertebal tipis.
- Angka tanggal memakai `font-variant-numeric: tabular-nums`.

## 9. Aksesibilitas (wajib)

- Kontras teks minimal 4.5:1 di kedua mode.
- Target klik minimal 44x44px.
- Focus ring 3px `--accent` dengan offset 2px pada semua tautan dan tombol (`:focus-visible`).
- Gunakan elemen semantik: `<a href>`, `<button>`, `<nav aria-label>`, `<section aria-labelledby>`.
- Tombol yang hanya berisi ikon wajib punya `aria-label`.
- Tautan di dalam paragraf bergaris bawah. Tautan berupa baris atau kartu cukup bergaris bawah saat hover.

## 10. Daftar larangan (pola yang terasa AI)

- Eyebrow label kecil kapital di atas judul bagian ("TERBARU DARI...", "AKSES RUANG KERJA").
- Headline dua warna dan slogan pemasaran yang besar.
- Banner bergradien, efek cahaya, logo besar dalam lingkaran.
- Kartu dengan ikon di tengah dan teks rata tengah.
- Ikon dengan latar pastel warna-warni.
- Kartu di dalam kartu yang berlapis-lapis.
- Thumbnail placeholder yang sama berulang. Gunakan foto asli, atau hilangkan slot foto.
- Empty state ganda atau kotak yang menjelaskan kotak kosong.
- Tombol besar yang fungsinya sama dengan tautan di atasnya.

## 11. Pemeriksaan akhir

Sebelum menyatakan selesai, pastikan dan laporkan:
- [ ] Urutan bagian sesuai bagian 5.
- [ ] Mode terang dan gelap sudah dicek, termasuk saat halaman dimuat ulang.
- [ ] Tidak ada warna hex di komponen selain tag "Penting".
- [ ] Tidak ada em dash, titik tengah, dan "SIHERA" di teks antarmuka.
- [ ] Tampilan dicek pada lebar 1440px, 1024px, dan 390px.
- [ ] Navigasi keyboard berfungsi dan focus ring terlihat.
- [ ] Build berhasil tanpa error atau warning baru.
- [ ] Daftar file yang diubah beserta ringkasan perubahannya.

## 12. Halaman unit (contoh: Dashboard Urmin)

Halaman unit adalah halaman yang terbuka saat pengguna memilih kartu di "Unit & layanan". Halaman ini memakai token, tipografi, aturan warna, dan aturan teks yang SAMA dengan Portal. Jangan membuat palet gelap tersendiri (misalnya navy kebiruan). Mode gelap halaman unit harus identik dengan mode gelap Portal.

### 12.1 Tata letak
- Header aplikasi sama persis dengan Portal, dengan menu "Portal" tetap aktif.
- Di bawah header: sidebar kiri selebar 260–280px dan area konten di kanan. Halaman unit boleh memakai lebar penuh layar (tanpa max-width 1400px), tetapi area konten diberi `max-width: 1400px` dan padding `clamp(24px, 3vw, 40px)` agar baris teks tidak terlalu panjang di layar lebar.
- Sidebar dan konten berada di latar `--bg`. Sidebar dipisahkan dengan garis kanan 1px `--border`, bukan dengan warna latar yang berbeda.
- Di layar di bawah 1024px, sidebar berubah menjadi menu yang bisa dibuka lewat tombol, atau bertumpuk di atas konten.

### 12.2 Sidebar
- Bagian atas: nama unit (700, 18px), contoh "Urusan Administrasi", lalu deskripsi singkat (14px, `--muted`). Jangan menambahkan badge atau pil "Urmin" di atasnya karena mengulang informasi.
- Daftar menu langsung di bawahnya, TANPA label kecil kapital seperti "MENU UTAMA".
- Item menu: ikon 18px dan label, tinggi minimal 44px.
- Item aktif: teks tebal, ikon solid, latar `--surface-2`, dan garis kiri 3px `--brand-red`. Ini konsisten dengan penanda aktif di header (merah = posisi saat ini).
- Tautan "Kembali ke Portal" di bagian bawah sidebar berupa tautan biasa dengan ikon panah kiri, bukan tombol besar berbingkai.

### 12.3 Kepala halaman
- Breadcrumb di atas judul: "Portal > Urmin > Dashboard", 14px, item terakhir tidak berupa tautan.
- Judul halaman 32px, tebal 800. Deskripsi satu kalimat di bawahnya (16px, `--muted`).
- Tombol aksi di kanan judul, sejajar dengan baris judul:
  - Tombol utama (misalnya "Catat surat masuk"): latar `--strong`, teks `--on-strong`. JANGAN memakai biru, karena biru khusus untuk tautan.
  - Tombol sekunder (misalnya "Buat surat keluar"): latar transparan, garis 1px `--text`, teks `--text`.
  - Tinggi tombol 44px.
- Filter periode (select dan tombol "Perbarui") diletakkan satu baris di bawah kepala halaman, rata kiri, dengan label di atas select.

### 12.4 Kartu ringkasan angka
- Empat kartu dalam satu baris (grid `repeat(auto-fit, minmax(220px, 1fr))`, jarak 16px). Kartu terpisah, bukan satu panel yang dibagi garis.
- Isi kartu: label (15px, 600, `--text-2`, TIDAK bergaris bawah), angka besar (40px, 800, tabular-nums), keterangan (14px, `--muted`).
- Seluruh kartu bisa diklik. Garis bawah hanya muncul pada label saat hover.
- Angka berwarna netral (`--text`). Kartu yang menandakan masalah (misalnya "Disposisi terlambat" dengan nilai lebih dari 0) diberi ikon peringatan kecil di samping label dan garis atas 3px warna error, bukan angka merah besar.

### 12.5 Status dan daftar surat
- Status SELALU berbentuk tag (latar berwarna, teks gelap, ikon kecil), bukan teks berwarna dengan titik. Palet status (sama di kedua mode, teks `#1C1F24`):
  - Terlambat dan Dikembalikan: latar `#F4B5B5` dengan ikon tanda seru
  - Menunggu diterima dan Menunggu review: latar `#F5D77A` dengan ikon jam
  - Dalam proses: latar `#B9D4F5` dengan ikon putar
  - Selesai: latar `#B7E1C1` dengan ikon centang
- Label status ditulis dalam sentence case dan selalu disertai teks, tidak hanya warna.
- Baris surat:
  - Baris 1: nomor surat kecil (13px, `--muted`, tabular-nums), contoh "R/45/XI/2026".
  - Baris 2: perihal surat (600, 16px).
  - Baris 3: keterangan dalam kalimat biasa, contoh "Disposisi dari Hendra Wijaya, tenggat 8 Nov 2026 (lewat 4 hari)".
  - Tag status di kanan, sejajar dengan baris perihal.
- DILARANG menggabungkan nomor dan perihal dengan titik tengah ("R/45/XI/2026 · Tindak lanjut"), dan DILARANG memakai titik tengah di baris keterangan.
- Panel "Status disposisi saya": tiap baris berisi tag status di kiri dan jumlah di kanan. Teks baris berwarna netral, bukan seluruh teks berwarna.

### 12.6 Data contoh
- Label "Data contoh" cukup muncul SATU kali, sebagai banner tipis di atas konten halaman ("Halaman ini masih menampilkan data contoh."), bukan di setiap panel.

## 13. Prompt untuk perbaikan tahap ini

Gunakan prompt berikut di Claude Code:

```
Baca ulang docs/PANDUAN_DESAIN_PORTAL.md, khususnya bagian 5 (aturan container), 5.1 (badge header), dan 12 (halaman unit). Jangan ubah kode dulu.

1. Laporkan di mana saja max-width dan padding samping didefinisikan sekarang, dan usulkan satu komponen container bersama sesuai bagian 5.
2. Laporkan perbedaan halaman Dashboard Urmin dengan bagian 12, termasuk palet mode gelapnya.
3. Buat rencana perubahan bertahap. Tunggu persetujuanku sebelum mulai.
```
