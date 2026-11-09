# R5F17 — Kalender Dashboard URMIN & Feedback Pengajuan Surat Masuk

Scope:
- Kalender bulan/minggu menggunakan data Agenda & Rapat yang telah tersedia di `/api/v1/urmin/registry/?kind=agenda`; tidak ada sumber data eksternal, CDN, atau integrasi Google.
- Klik agenda membuka dialog ringkas, lalu membuka detail Agenda existing. Tampilan mengikuti akses akun dan batas data API (200 entri, bukan seluruh organisasi).
- Respons gagal pengajuan Surat Masuk ditampilkan di modal tempat pengguna mengajukan, tidak di halaman belakang. Isian dan lampiran lokal dipertahankan saat gagal.
- Pesan error spesifik untuk `invalid_intake`, `invalid_file_type`, dan masalah koneksi database. Tidak ada perubahan server-side validation atau grants.
- Installer menjalankan pemeriksaan READ ONLY untuk username `op-urmin`, yaitu status akun, kesiapan password, grant create/attach, dan penerima Kabag. Itu belum membuktikan proses submit berhasil sampai API/migrasi diuji dengan sesi operator.

Status/keamanan:
- Tidak ada perubahan backend, database, role, password, SMTP atau permission.
- Event kalender hanyalah rekaman Agenda URMIN yang terbaca pengguna. Belum sinkronisasi Google Calendar.
- Jika pengajuan operator tetap gagal, catat isi pesan error dari modal dan HTTP status/`error` code pada `POST /api/v1/urmin/surat-masuk/intake` tanpa mengirim dokumen/OTP/token/cookie.
- Jalankan `./sdl-run.sh` dari root proyek setelah pemasangan.
