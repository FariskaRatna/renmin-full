# Pertanyaan terbuka: SPIP, notulen, dan dokumentasi agenda

Status: **menunggu jawaban pemilik sistem** · dibuka 2026-11-03

Dokumen ini menahan satu permintaan yang belum bisa dikerjakan karena jawabannya
mengubah bentuk pekerjaannya secara mendasar, bukan sekadar detailnya. Polanya
mengikuti `docs/PERTANYAAN-KONFIGURASI-AKSES.md`: ditulis supaya keputusannya
bisa diambil sekali dan tercatat, bukan ditebak lalu dibongkar lagi.

Permintaan aslinya:

> SPIP langsung get dari agenda dan rapat yang dibuat, di SPIP ada tambah
> notulen dan dokumentasi.

Enam perubahan Agenda & Rapat lainnya **sudah selesai** dan tidak menunggu
dokumen ini.

---

## Yang sudah ada di sistem hari ini

SPIP muncul di dua tempat, dan keduanya berbeda sifat. Inilah sebabnya
permintaan di atas belum bisa langsung dikerjakan — "SPIP" bisa berarti salah
satu dari dua hal yang tidak saling menggantikan.

| | Register RB Subbagbinfung | Tile SPIP di portal |
|---|---|---|
| Lokasi | `BinfungR5C.tsx`, kind `rb` | `PortalV3R5F21.tsx:108` |
| API | `/api/v1/subbagbinfung/registry/?kind=rb` | belum ada |
| Keadaan | **Berfungsi penuh** | **Placeholder** |
| Isi | Rencana aksi: Area, Periode, Target, Capaian, Status | *"Integrasi SPIP lintas unit sedang disiapkan"* |
| Kepemilikan | Subbagbinfung | lintas unit |

Di roadmap, dua baris yang relevan masih bertanda "Belum mulai":

- `SDL-038` — Repositori data dukung lintas BagRenmin (Fase D)
- `SDL-039` — Kategori foto, undangan, sprint, notulen (Fase D)

---

## Tiga pertanyaan yang menentukan

### 1. SPIP yang mana?

- **(a) Tile portal lintas unit.** Dugaan paling kuat: ia memang dirancang
  lintas unit dan isinya menunggu diisi, cocok dengan "langsung get dari agenda
  dan rapat". Berarti membangun halaman baru berikut API-nya.
- **(b) Register RB Subbagbinfung.** Sudah berfungsi, tapi bentuk datanya
  rencana aksi RB — agenda tidak muat di sana tanpa memaksakan.

Kalau (a), perlu diputuskan juga: SPIP menampilkan **semua** agenda, atau hanya
yang ditandai relevan untuk SPIP?

### 2. "Notulen" itu bentuknya apa?

Jawaban ini menentukan apakah perlu tabel baru atau cukup menumpang penyimpanan
yang sudah ada.

- Teks yang **diketik** di aplikasi, atau berkas yang **diunggah**, atau keduanya?
- **Satu** notulen per agenda, atau boleh **banyak**?
- Boleh **diubah** setelah tersimpan, atau sekali tulis seperti catatan audit?

Catatan teknis: agenda sudah punya lampiran berkas lewat tombol
**File & Disposisi**. Kalau "dokumentasi" yang dimaksud sama dengan itu,
sebagian pekerjaannya sudah ada dan tinggal ditampilkan dari sisi SPIP.

### 3. Siapa yang boleh menambah notulen dan dokumentasi?

Ini gerbang otorisasi, dan paling mahal kalau salah tebak.

- Subbagbinfung sebagai pemilik SPIP?
- Penyelenggara / PIC agendanya?
- Siapa pun yang berhak melihat agenda itu?

> **Kenapa ini bukan detail kecil.** Pada 2026-11-03 sebuah endpoint arsip
> disposisi nyaris dirilis dengan dua gerbang yang irisannya kosong — pihak
> disposisi ada di subbagren/sumda/binfung, sedangkan wewenang menulis register
> hanya dimiliki akun ber-grant `urmin`. Hasilnya 403 bagi satu pihak dan 404
> bagi pihak lain, tanpa seorang pun bisa memakainya. Itu bentuk kegagalan yang
> sama dengan **B9** di `DEVIATIONS.md`, yang sempat mematikan alur persetujuan
> surat keluar di produksi tanpa ketahuan. Menjawab pertanyaan ini di muka jauh
> lebih murah daripada menemukannya setelah dipakai.

---

## Dua akibat dari perubahan Agenda yang sudah jalan

Keduanya sudah terjadi dan **tidak menunggu jawaban**, tapi perlu dikonfirmasi
memang diinginkan.

### Agenda lama menyimpan data yang kini tak terlihat

Jenis agenda, status, dan hasil notulen singkat yang sudah terisi tetap ada di
database tapi tidak lagi muncul di layar. Kuncinya sengaja **tetap diterima
backend**, kalau tidak setiap agenda lama akan gagal disunting dengan 400.

Pilihannya: dibiarkan (aman, bisa dipulihkan kapan saja) atau dibersihkan lewat
migrasi tersendiri. Kalau notulen lama ternyata perlu dipindahkan ke SPIP,
**jangan dibersihkan dulu** — di situlah satu-satunya salinannya berada.

### Semua agenda kini berklasifikasi "biasa"

Sebelumnya agenda bisa ditandai "penting", yang membatasi aksesnya hanya ke akun
dengan grant klasifikasi sesuai. Pilihan itu sudah dihapus dari formulir sesuai
permintaan, sehingga seluruh agenda baru tercatat `biasa` dan **dapat dilihat
semua pemegang grant Urmin**.

Kalau ada rapat yang memang perlu dibatasi — misalnya rapat pimpinan — hilangnya
pilihan ini melebarkan aksesnya. Agenda lama yang terlanjur bertanda `penting`
tidak berubah; hanya yang baru yang terpengaruh.
