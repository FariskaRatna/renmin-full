# SIERA DELTA LIMA — R2C1 Role & Permission Editor

**One Workspace. Full Visibility.**  
Integrated Digital Workspace for BagRenmin

## Tujuan

Role bukan jabatan, jabatan bukan unit, dan izin aplikasi bukan izin untuk membaca semua data. Role berisi kumpulan permission (aksi). ABAC mengevaluasi atribut pengguna, dokumen, workflow, dan penugasan ketika resource telah tersedia.

## Kemampuan R2C1 (source; belum diverifikasi di Mac)

- Role list dan katalog permission benar-benar dari PostgreSQL, bukan dummy.
- Superadmin dapat membuat role baru, memperbarui nama/deskripsi, status aktif, dan checklist permission.
- Role Superadmin immutable melalui editor. Permission `identity.roles.manage` tidak dapat diberikan ke role non-Superadmin lewat editor.
- Sesi login, role Superadmin aktif, dan permission `identity.roles.manage` diperiksa Go API **di setiap request**. Mutasi membutuhkan Origin allowlist dan CSRF token.
- Permintaan ditolak secara default. Error HTTP untuk request tak berizin adalah 401/403.
- Mutasi role transaksional dengan alasan (minimal 8 karakter), before/after permission keys, identitas actor, waktu, dan optimistic version control. Role yang diedit akan mencabut sesi user terpengaruh, kecuali Superadmin yang melakukan perubahan.
- Tidak ada delete role fisik. Disable role dipakai sementara sampai model retensi, dampak assignment, dan SOP disepakati.

## API

| Method | Endpoint | Kegunaan |
|---|---|---|
| GET | `/api/v1/admin/roles` | Baca role + daftar izin |
| GET | `/api/v1/admin/permissions` | Baca katalog izin |
| POST | `/api/v1/admin/roles` | Buat role custom |
| PUT | `/api/v1/admin/roles/{key}` | Edit role kecuali Superadmin, membutuhkan `version` |

Mutasi memerlukan `X-CSRF-Token`, `Origin` terpercaya dan session HttpOnly. Semua API di atas memerlukan membership `superadmin` **dan** permission `identity.roles.manage` dari database.

## Role rancangan awal

Superadmin: manajemen sistem dan identitas; **tidak** diberi akses dokumen secara otomatis. Role bawaan `administrator`, `operator`, dan `pimpinan` disediakan untuk disesuaikan. Contoh role tambahan yang dapat dibuat: Kepala Subbag, Staf, Pemeriksa, Auditor. Jangan menganggap daftar ini memberi hak akses otomatis ke user.

## Rule authorization target (gate berikutnya)

`Allow = valid active session AND explicit role action permission AND active role assignment AND scope matches AND data classification allows AND workflow state allows AND assignment/delegation valid`.

- `user`/subject: status user, role aktif, unit penugasan, masa berlaku, delegasi resmi.
- `resource`: unit pemilik, klasifikasi, pembuat, penerima, versi, status.
- `action`: read, create, update, download, distribute, approve, export, manage.
- `environment`: waktu berlaku penugasan dan konteks akses yang disetujui.
- Tidak memakai evaluasi ekspresi arbitrary atau JavaScript dari frontend. UI hanya memilih aturan yang sudah dikenal backend.
- Hak deny/require tidak boleh dilonggarkan lewat UI. Superadmin tidak mendapat hak baca konten melalui identitas role-nya.
- List API harus memfilter query sesuai scope, sementara detail/download/write wajib pemeriksaan object-level kedua.

## Gate R2C2 (belum dibangun)

- CRUD user, deaktivasi dan reset password tanpa mengungkap password lama.
- Role assignment **terikat unit** dan tipe scope (`own`, `assigned`, `unit`, `delegated`), tanggal berakhir, dan reason. Satu user boleh punya lebih dari satu penugasan dengan hak berbeda.
- ABAC policy editor yang menggunakan pilihan aturan eksplisit, bukan free-form expression.
- API middleware/authorization decision; penerapan pada semua resource endpoint.
- Audit viewer dengan pembatasan scope; preview "Siapa bisa apa" (effective permission/decision trace).
- Pengujian cross-unit, unauthorized API request, privilege escalation, session revocation.

## Verifikasi setelah install

1. `./sdl-run.sh`: Go unit tests, React typecheck/Vite build, transaction migration, seluruh service sehat.
2. Masuk sebagai Superadmin; buka **Role & Izin**, daftar role benar-benar dari API.
3. Buat role test custom (tanpa user assignment) dengan alasan; reload browser lalu konfirmasi tersimpan.
4. Edit permission role test, periksa `version` berubah. Coba edit dengan tab lama dan pastikan HTTP 409.
5. Role Superadmin tak dapat diedit dan permission reserved tidak dapat diberikan ke role baru.
6. Akses endpoint tanpa session → 401; dengan session non-Superadmin → 403 (uji pada R2C2 setelah user dibuat).
7. Cek audit event via database secara terbatas/skrip verifikasi berikutnya; jangan mengekspos metadata sensitif.

## Batasan

R2C1 **bukan** otorisasi dokumen yang lengkap. Katalog key untuk modul R3–R5 adalah *policy templates*: fitur operational belum tersedia, sehingga menetapkan key tidak menciptakan kemampuan membaca/mengubah dokumen. Jangan deploy ke production sampai R2C2/ABAC enforcement, test, HTTPS, dan backup/restore selesai.
