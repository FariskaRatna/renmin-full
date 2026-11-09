# R5F3 — Tugas Disposisi (Urmin)

## Cakupan
- Tampilan daftar tugas berizin: semua, ditugaskan kepada saya, dan diterbitkan oleh saya.
- Filter status, pencarian, ringkasan aktif/terlambat/review, serta penjelasan batas 200 tugas terbaru dari API existing.
- Detail memakai `GET /api/v1/urmin/dispositions/{id}/history` yang mengembalikan item terbaru, bukan mengandalkan versi daftar.
- Detail dari shortcut dashboard dibuka satu kali. Menutup detail tidak otomatis membukanya lagi; permintaan lama tidak dapat menimpa detail baru.
- Terima tugas, selesaikan tugas, review hasil, dan teruskan ke petugas satu unit (maksimal level 2) memakai endpoint R3C/R3D yang sudah ada, CSRF existing, modal konfirmasi, serta toast kanan atas.
- Persetujuan akhir dan monitoring pimpinan R3D3 tetap memakai komponen existing.
- Tampilan mobile/dark mode scoped untuk Tugas Disposisi, tanpa mengubah dashboard atau Inbox R5F2.

## Batasan
- Backend tetap memverifikasi pihak yang ditunjuk, permission, grant aktif, klasifikasi, tenggat, hierarki, versi transaksi, dan audit.
- Tombol UI yang muncul bukan bukti izin; API tetap menjadi sumber keputusan final.
- Tidak ada migrasi, grant otomatis, role/permission tambahan, perubahan schema, atau perubahan API.
- Tugas yang sudah selesai dan direview final tidak bisa dibuka ulang lewat tombol review; tindak lanjut dilakukan sebagai disposisi baru menurut workflow existing.
- Jumlah review hanya untuk kumpulan data authorized yang dimuat, maksimum 200 terbaru. Untuk total global diperlukan pagination/API tambahan pada fase berbeda.

## Verifikasi sebelum sign-off
1. Jalankan `bash 0.sekerips/sdl-r5f3-tugas-disposisi-install.sh` dari root, lalu `./sdl-run.sh`.
2. Login akun penerima disposisi: filter *Ditugaskan ke Saya*; Terima Tugas dan Selesaikan Tugas (keterangan >=8 karakter). Refresh dan cek timeline.
3. Login akun pemberi disposisi: filter *Saya Terbitkan*, lakukan Review Hasil, pastikan keputusan final tetap dipertahankan setelah reload.
4. Teruskan tugas dalam satu unit ke kandidat authorized, tenggat tidak lebih dari tugas induk; tugas induk baru bisa selesai setelah anak selesai dan direview.
5. Klik shortcut dashboard ke tugas tertentu; tutup detail lalu pastikan tidak terbuka kembali sendiri. Buka beberapa tugas cepat; riwayat tidak tertukar.
6. Pastikan akun lain tak dapat mengakses tugas non-party; revoke/expiry grant menolak akses pada backend. Uji status 409 konflik versi.
7. Uji mobile, dark mode, koneksi gagal/retry dan integrasi Submit Final R3D3 yang existing.
8. Browser E2E dan review keamanan/penetration testing masih merupakan gate tersendiri sebelum production.
