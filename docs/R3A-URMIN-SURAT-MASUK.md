# SIERA DELTA LIMA — R3A: Register Surat Masuk (Go + React)

## Scope

- UI React mengikuti design system `renmin.html`: daftar surat, pencarian sederhana, tambah/edit draft, registrasi final, detail, histori.
- Backend Go dengan penyimpanan PostgreSQL. Migration `007_urmin_incoming.sql` hanya membuat tabel, indeks dan histori; tidak menyentuh data lama.
- Hak setiap operasi diverifikasi melalui session+CSRF dan `access.EvaluateForUser` memakai metadata record yang diambil dari DB.
- Superadmin mendapat HTTP 403 untuk semua endpoint operasional, tanpa bypass grant.
- Klasifikasi pada R3A hanya `biasa` dan `penting`; `rahasia` belum didukung. Tidak ada data demo yang disimpan.

## API

- `GET /api/v1/urmin/surat-masuk/capabilities` — boolean `canCreate` dari effective grant.
- `GET /api/v1/urmin/surat-masuk?q=...` — hasil yang diizinkan; kandidat hasil dibatasi 200 sampai pagination SQL R3B.
- `GET /api/v1/urmin/surat-masuk/{id}` — metadata surat dan history.
- `POST /api/v1/urmin/surat-masuk` — buat draft, permission `urmin.surat_masuk.create`.
- `PATCH /api/v1/urmin/surat-masuk/{id}` — edit draft dengan version check, permission `urmin.surat_masuk.update`.
- `POST /api/v1/urmin/surat-masuk/{id}/register` — set status `registered` lalu kunci draft, membutuhkan permission update.

## Authorization

Akun operasional harus aktif, OTP login berhasil, password pertama sudah diganti, **bukan Superadmin**, memiliki role aktif dan grant aktif pada unit Urmin, serta permission sesuai operasi. ABAC membatasi scope `own`, `assigned`, `unit`, klasifikasi dan status `draft` ketika mutasi. Tidak ada akses lintas unit. Penentuan akses dilakukan per record di backend.

Contoh pengujian: Superadmin diharapkan 403; akun tanpa permission create mendapat 403; detail surat yang tidak berhak dilihat mendapat 404; update pada surat registered gagal; permintaan dengan versi lama menghasilkan 409 jika ada grant edit.

## Batasan yang disengaja

- Belum ada upload/download lampiran, distribusi, disposisi, approval atau klasifikasi Rahasia.
- Assignment personal pada surat dan SQL-level permission-scoped pagination akan ditambahkan R3B; R3A membatasi kandidat daftar 200 terbaru dan memfilter per record. Ini tidak boleh dianggap siap skala besar.
- Dokumen yang sudah diregister tidak dapat diubah melalui R3A; koreksi/pembatalan formal harus menunggu desain workflow berikutnya.
- Pengujian race revokasi grant, IDOR, CSRF, session expiry, concurrency edit dan DB real masih harus dilakukan sebelum production.

## Verification gate

1. Jalankan installer patch, lalu `./sdl-run.sh` — Go unit tests + TypeScript/Vite build + migration 007 + container healthy.
2. Login sebagai Superadmin → menu unit disabled; API `/api/v1/urmin/surat-masuk` → 403.
3. Dari User Management, buat akun non-Superadmin, assign role yang memiliki `urmin.surat_masuk.read`, `.create`, `.update` dengan unit `urmin` dan scope `own` atau `unit`, classification limit sesuai kebutuhan.
4. Login akun tersebut dengan OTP; buat draft, cari, edit, register, refresh dan lihat histori.
5. Coba akun non-granted, unit lain, klasifikasi di atas grant, update draft setelah registered, request tanpa CSRF; pastikan ditolak.
6. Tandai selesai hanya bila seluruh gate di atas lulus. Jangan mengirim rahasia atau OTP melalui chat.
