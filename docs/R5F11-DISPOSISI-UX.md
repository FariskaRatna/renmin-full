# R5F11 — Disposisi URMIN: daftar ringkas dan detail modal

## Lingkup
- Satu menu Disposisi; tab utama di App tetap Tugas Saya, Diberikan, Perlu Review, Riwayat.
- Ringkasan ringkas tanpa tiga kartu statistik besar. Jumlah aktif, terlambat, review memakai data API existing (200 terbaru maksimum).
- Daftar disposisi memuat pencarian, filter status, dan pengurutan tanggal atau tenggat.
- Klik Detail membuka modal scrollable dengan arahan, hasil, history dan aksi sesuai permission API.
- Tombol Buka Surat & Lampiran membuka detail Surat Masuk yang terkait; backend surat tetap mengecek akses.
- Dari kondisi kosong, pengguna dapat menuju Surat Masuk > Inbox, tempat surat baru diterima sebelum dibuat tugas disposisi.
- Modal tindakan existing (Terima/Selesaikan/Review/Teruskan) dan review final R3D3 tetap dipakai.
- Tidak ada perubahan API, schema, role, maupun permission.

## Workflow yang tidak diubah
1. URMIN mengajukan surat masuk memilih perlu/tidak perlu disposisi (R5F7).
2. Surat yang perlu disposisi masuk ke Inbox Kabagrenmin.
3. Kabagrenmin menerima distribusi dan membuat disposisi melalui Inbox (R3B/R3C).
4. Penerima membuka Tugas Saya untuk menerima/mengerjakan/meneruskan; pemberi memantau dan mereview hasil.
5. Tahap review final menggunakan R3D3 existing.

## Uji di Mac
1. Jalankan installer R5F11 dari root, kemudian `./sdl-run.sh`.
2. Coba setiap tab: kosong, tersedia, filter, cari, urut.
3. Buka/tutup detail, gunakan Escape, buka task induk dan surat terkait.
4. Uji dengan pengguna penerima dan pemberi untuk aksi terima, lengkap, review, forward dan pemeriksaan historinya.
5. Pastikan Inbox R5F7 dan Surat Keluar R5F10 tidak berubah.

Catatan: tes browser dengan sesi pengguna dan build produksi Mac harus dilakukan di lingkungan asli setelah pemasangan.
