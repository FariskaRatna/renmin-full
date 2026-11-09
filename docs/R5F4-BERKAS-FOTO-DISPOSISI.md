# R5F4 — Berkas, Foto & Disposisi (Unit Work)

## Ruang lingkup
- Satu menu operasional untuk register berkas dan disposisi **internal** berdasarkan Unit Work API R5A: Urmin/Subbagren/Subbagsumda/Subbagbinfung.
- Tidak digabungkan dengan R3C/R5F3 Tugas Disposisi **surat masuk** karena sumber dan aturan API berbeda.
- Daftar, pencarian backend, filter klasifikasi, informasi keterbatasan 200 hasil, detail, edit, tambah, arsip soft-delete.
- Upload banyak PDF/JPG/JPEG/PNG ke API yang sudah ada, bertahap dengan status, maksimal 5 MiB per file / 10 lampiran aktif; upload parsial tidak diulang otomatis.
- Preview privat memakai fetch autentikasi dan Blob URL yang dicabut setelah ditutup. PDF dapat tidak tampil pada browser tertentu: unduh tetap tersedia. Tidak ada URL berkas publik.
- Disposisi internal: kirim ke petugas eligible satu unit, terima, selesai dengan hasil per tugas, batalkan; konfirmasi memakai modal aplikasi; hasil melalui toast kanan atas.
- Riwayat aktivitas dibaca dari API existing. Timestring riwayat sudah diformat di backend sebagai waktu Jakarta; UI tidak menambahkan konversi zona waktu kedua.
- Race-control untuk detail dan preview saat berkas terpilih berganti; menutup detail tidak otomatis dibuka lagi.
- UI responsif mobile dan dark mode; tidak ada dummy totals/data.

## Batasan / keamanan
- Hanya menggunakan `GET/POST/PATCH/DELETE /api/v1/unit-work/{unit}/...` yang sudah ada; tidak ada migrasi, perluasan hak, role grants, atau perubahan API.
- Permission record, klasifikasi, penerima, dan setiap transisi tugas tetap diputuskan server. Tombol visible bukan kontrol otorisasi.
- List API hanya mengembalikan maksimal 200 kandidat terbaru dan menerapkan izin pada kandidat tersebut; angka di summary bukan total populasi global.
- Endpoint R5A saat ini mengizinkan mode demo Superadmin; untuk produksi harus diverifikasi bahwa mode demo nonaktif.
- Upload dokumen disimpan secara privat dalam PostgreSQL. Encryption-at-rest khusus lampiran, malware scanner/CDR, dan tes browser E2E masih pekerjaan pra-produksi; gunakan berkas uji non-rahasia.
- Tidak ada pembaruan data otomatis lintas klien; gunakan Muat Ulang.

## Uji setelah instalasi
1. `bash 0.sekerips/sdl-r5f4-berkas-foto-disposisi-install.sh && ./sdl-run.sh` dari root project.
2. Daftar/create/edit berkas, klasifikasi biasa/penting, search/filter dan refresh.
3. Upload PDF, JPEG, PNG; buka preview tiap jenis lalu tutup, uji unduh. Coba >5 MiB, ekstensi lain, >10 file (harus ditolak).
4. Buat 2 disposisi internal pada satu berkas; isi hasil A dan B berbeda, terima dan selesaikan secara terpisah; refresh; pastikan hasil tidak tertukar.
5. Pengirim membatalkan tugas aktif melalui modal; penerima tidak dapat membatalkan tugas milik orang lain.
6. Klik item A lalu B dengan cepat, pastikan detail dan preview tidak tertukar. Buka menu dari shortcut `File & Disposisi` pada Surat Keluar.
7. Arsipkan saat ada tugas aktif → server menolak; setelah tugas selesai/batal, arsip tercatat dan tidak muncul pada daftar aktif.
8. Uji akses beda unit / akun dengan grant dicabut, mobile, dark mode, expired session dan 409 saat edit bersamaan.
9. Pastikan service healthy. Pemeriksaan E2E dan keamanan belum otomatis dilakukan oleh installer.
