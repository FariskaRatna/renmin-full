# R5F2 — Inbox Distribusi (Urmin)

## Implementasi
- Komponen Inbox terpisah dari Surat Masuk, tetap memakai API R3B dan Disposisi R3C.
- Filter status/pencarian atas daftar authorized, ringkasan dibatasi sesuai limit backend.
- Detail, metadata, lampiran privat, riwayat event, dan konfirmasi penerimaan.
- Konfirmasi melalui modal aplikasi; notifikasi singkat via toast kanan atas; update badge header setelah mutasi.
- Quick-link dashboard hanya auto-open sekali, tutup detail tidak membuka ulang.
- Async detail race dijaga; selection ditutup bila hilang setelah refresh/grant revoked.
- Lampiran diunduh, tidak dipreview inline karena scanning malware R3B belum tersedia.
- Penerimaan tetap memakai backend atomic, audit, event append-only dan CSRF existing.
- Tidak ada endpoint baru, migration, permission, grant, update data, atau perubahan modul disposisi.

## Verifikasi pengguna (wajib sebelum sign-off)
1. Jalankan installer, lalu `./sdl-run.sh`. Go test, TypeScript/Vite build, tiga health-check harus lulus.
2. Login operator Urmin: register dan distribusikan surat ke penerima berizin (data uji), pastikan surat tampil hanya di akun tujuan.
3. Login akun penerima: buka Inbox via header/sidebar, gunakan filter, pencarian, detail, lihat lampiran dan histori.
4. Konfirmasi penerimaan dengan alasan >=8 karakter; cek toast, badge header, status dan histori setelah refresh.
5. Gunakan shortcut dashboard ke distribusi spesifik, tutup detail, pastikan tidak terbuka kembali.
6. Cek izin: penerima lain tidak dapat membaca; revoke grant menutup akses berikutnya, termasuk download; superadmin bukan aktor operasional.
7. Uji desktop/mobile/dark mode serta status jaringan gagal/retry.
8. File PDF/gambar masih *forced download*. Gate antivirus, E2E dan pen-test tetap terpisah.

## Catatan cakupan
API existing hanya mengembalikan distribusi terbaru hingga 100 per pengguna dan field `limited` bersifat indikatif.
Ringkasan bukan jumlah global; untuk lebih dari 100 data diperlukan query backend teragregasi/paginasi terotorisasi.
