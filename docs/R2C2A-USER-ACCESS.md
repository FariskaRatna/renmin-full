# Siera Delta Lima — R2C2A: User & Scoped Access

Status: source patch siap pengujian di Mac (belum dinyatakan selesai).

## Model

- Superadmin bootstrap R2B tetap di `sdl_user_roles`; role sistem yang dilindungi tidak dapat diberikan melalui UI R2C2A.
- Penugasan biasa menjadi tuple `(user, role, unit, scope, classification_limit, expiry)` di tabel `sdl_access_grants`.
- Scope `own`, `assigned`, `unit`. Satu role pada Urmin tidak otomatis memberikan izin pada Subbagren.
- Tanggal kedaluwarsa opsional. Grants lama **dicabut secara historis** (`revoked_at`) saat penetapan ulang, bukan dihapus.
- Klasifikasi dibatasi pada `biasa` dan `penting`. Dokumen `rahasia` ditolak oleh policy engine. Penerapan klasifikasi dan workflow pada setiap handler dokumen baru dilakukan bersama R3.
- Superadmin hanya untuk administrasi sistem, **bukan** bypass dokumen. Semua akses dokumen masih nonaktif karena backend Urmin belum tersedia.

## Endpoint R2C2A

Protected by existing Superadmin-only middleware, CSRF + Origin validation for mutation, and active database session:

- `GET /api/v1/admin/users` — metadata user + grant aktif, tanpa password hash.
- `POST /api/v1/admin/users` — membuat user dan mengembalikan password acak **sekali**.
- `PATCH /api/v1/admin/users/{id}` — profil/status, optimistic version check.
- `PUT /api/v1/admin/users/{id}/access` — penggantian semua grant aktif secara transaksional; reason wajib, role dan unit diverifikasi.
- `GET /api/v1/admin/units` — master unit.
- `GET /api/v1/admin/audit` — metadata audit terbaru, tanpa isi OTP/password.
- `POST /api/v1/auth/change-password` — user yang sudah menyelesaikan OTP mengganti password sementara; dicegah brute force dengan throttle.

Perubahan user/role mencabut session target; self-edit dan modifikasi Superadmin dari UI ditolak.

## User onboarding

1. Superadmin membuat akun melalui frontend.
2. Password sementara kriptografis tampil sekali di browser Superadmin. Distribusikan hanya lewat kanal aman milik organisasi; jangan disimpan dalam chat/log, jangan dipublikasi.
3. Pengguna login memakai password sementara dan OTP email.
4. Sebelum masuk portal, pengguna **harus** mengubah password.
5. Baru kemudian role dan unit aktif sesuai grant dan izin yang dikonfigurasi.

Tidak ada password default, bypass OTP, atau reset database.

## Verifikasi / release gate

1. `./sdl-run.sh` lulus Go tests, TypeScript/Vite build, dan migration 004.
2. Superadmin R2B tetap bisa login; R2C1 role editor tetap berfungsi.
3. Buat satu user uji dengan email yang dikuasai; pastikan password tampil sekali dan tidak muncul lagi setelah refresh.
4. Login user memakai OTP lalu lakukan mandatory password change.
5. Uji role `operator` pada Urmin dengan scope `assigned`; refresh: grant tetap ada.
6. Uji pengguna non-Superadmin mengakses `/api/v1/admin/users` → HTTP 403, tanpa akses mutation.
7. Nonaktifkan user uji; session sebelumnya harus menjadi 401.
8. Uji assignment lintas unit dan grant kedaluwarsa di policy tests; penegakan pada endpoint surat **belum** diklaim sampai R3.
9. Audit alasan pembuatan/perubahan muncul pada audit viewer.

## Batas fase

- Reset password via email/self-service, approval delegasi, policy editor per klasifikasi/entitas, dan **enforcement document object-level live** belum tersedia.
- Dashboard per unit masih preview; tidak ada dokumen operasional asli yang diekspos.
- Semua role pada fase ini untuk operasi dokumen masih berupa permission catalog; perlu handler dokumen dengan evaluasi resource metadata saat R3.
