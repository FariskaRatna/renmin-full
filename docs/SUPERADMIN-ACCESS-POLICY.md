# Superadmin — Policy SA01 (R2C2B)

Superadmin = administrator identitas/role, **bukan operator lintas unit/subdit**.

## Tetap diizinkan
- Login, OTP, ganti password sendiri, logout.
- User Management: create/edit/disable users and manage scoped role assignments as part of user provisioning.
- Role & Permission Management: create/update non-protected roles and permissions.
- Kunjungi landing portal (tanpa data operasional).

## Wajib ditolak
- Workspace Urmin, Subbagren, Subbagsumda, Subbagbinfung (semua menu tetap terlihat tetapi disabled di FE).
- Dashboard kinerja/unit/operasional, surat, disposisi, lampiran, arsip, personel, anggaran, dan data modul lainnya.
- Delegation Management (semua endpoints `/api/v1/admin/delegations*` dan `/api/v1/admin/delegation-candidates` mengembalikan HTTP 403 untuk pengguna dengan akses admin; fungsi ditutup bagi seluruh user sampai role non-Superadmin dan otorisasi persetujuan disiapkan).
- Roadmap administratif pada tampilan Superadmin (disabled sebagai menu non-esensial).

## Enforcement
- Frontend disabled + guard navigasi hanya UX, bukan pengaman utama.
- Go admin routes hanya mengaktifkan user + role APIs dengan auth/session/CSRF.
- Go `access.EvaluateForUser` secara eksplisit menolak seluruh akun yang tercatat sebagai `superadmin` di `sdl_user_roles`, meskipun memiliki grant yang tidak sengaja ditambahkan.
- Migration 006 mencabut *hanya* permission role Superadmin selain `identity.users.manage` dan `identity.roles.manage`. Tidak menghapus user, dokumen, session atau data operasional. Permission global role lainnya tidak diubah.
- API dokumen R3 wajib selalu memanggil `access.EvaluateForUser` dengan data dokumen dari PostgreSQL; menu disabled bukan pengganti authorization.

## Verifikasi setelah deploy
1. Login Superadmin dengan OTP; Role dan User Management tetap berhasil.
2. Pastikan empat kartu unit bertanda restricted dan tidak bisa dibuka.
3. Delegation API lewat session valid menolak dengan 403; pengujian manual harus menjaga kerahasiaan cookies/CSRF.
4. Verifikasi migration 006 di ledger dan Role Superadmin hanya memuat dua permission di UI.
5. Uji user non-Superadmin sesuai scoped grants ketika API operasional R3 tersedia; harus gagal lintas unit, klasifikasi, dan tanpa permission.

Status: source patch SA01 siap build Mac, belum lulus E2E keamanan pada server pengguna.
