# R5E UX01 — Branding, Portal dan Roadmap

**Tanggal:** 22 Oktober 2026. **Status:** source siap; build Mac/browser belum diverifikasi.

## Perubahan

- Header, halaman login, portal, favicon, dan ikon home menggunakan `apps/frontend/public/logo.png` yang sudah disediakan di Mac. Installer mensyaratkan PNG valid, tidak mengganti atau membuat ulang logo tersebut.
- Portal disederhanakan menjadi hero satu paragraf, empat unit kerja, dan shortcut pengelolaan akun untuk Superadmin. Panel status teknis, statistik kosong, tahap lama, dan banner mode akses khusus dihapus.
- Teks operasional lebih ringkas; terminologi teknis tidak ditampilkan dalam notifikasi/beranda.
- Menu Roadmap dipertahankan dan bisa dibaca oleh Superadmin tanpa akses workspace operasional (tidak mengubah backend). Update status R5C, R5D, UX02, UX03 dan UX01 berdasarkan bukti pada Mac; belum ada klaim semua modul lulus E2E.
- Tidak ada perubahan Go API, skema PostgreSQL, data, password, role atau grant. Mode khusus Superadmin development tetap dibatasi melalui konfigurasi backend yang sudah ada; **menghapus label mode dari antarmuka tidak membuat aplikasi siap dipakai dengan data produksi/rahasia.**

## Checklist browser

1. Logo tampil di login, header, portal dan favicon, tidak lagi simbol lama.
2. Landing menyajikan tepat empat kartu unit dan tampilan desktop/mobile tetap rapi.
3. Navbar, sidebar, halaman awal tidak menampilkan banner demo/development.
4. Menu Roadmap terbuka dan status R5E tetap *menunggu verifikasi browser*.
5. CRUD/foto/PDF/disposisi tetap bekerja setelah patch UI.
6. Mode gelap/terang dan logout tidak terganggu.

## Catatan integritas

Installer fail-closed memeriksa baseline dan final SHA-256, membuat backup sebelum menyalin, tidak mengubah `logo.png` maupun file rahasia. Tidak ada migration baru.
