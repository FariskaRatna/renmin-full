# R5F16 — Surat Masuk: Inline Preview & 10 MB/file

- Foto baru langsung terlihat sebagai thumbnail di modal Tambah Surat Masuk dan modal Upload Lampiran. PDF ditampilkan sebagai kartu berkas yang bisa dibuka melalui tombol Lihat PDF. Tombol Hapus membatalkan lampiran dari daftar lokal.
- Status file baru jelas **belum tersimpan** sampai pengajuan/upload selesai. File lokal dipreview lewat URL browser sementara dan direvoke saat tidak digunakan. Lampiran tersimpan tetap dibuka lewat endpoint berizin dengan cookie sesi.
- Batas untuk **lampiran Surat Masuk** dinaikkan dari 5 MiB menjadi 10 MiB/file, maksimal 10 file. Intake multipart limit kini 10 * 10 MiB + 1 MiB allowance.
- Update frontend validasi dan label, endpoint intake gabungan, endpoint upload lampiran tambahan, dan pembatas ukuran preview stored. Keamanan, otorisasi, checksum penyimpanan, klasifikasi, transaksi intake dan database tidak diubah.
- Tidak menaikkan limit berkas pada modul lain, seperti Surat Keluar/Berkas Kerja. Tidak ada migrasi.
- Setelah instalasi, jalankan `./sdl-run.sh` dari root. Uji JPG 6–9 MiB dan PDF 6–9 MiB, batas lebih dari 10 MiB harus ditolak, sekaligus preview lokal, preview tersimpan, dan reload.
