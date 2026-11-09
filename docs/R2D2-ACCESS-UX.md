# R2D2 — Access Editor UX Refinement

## Prinsip

- User/Role CRUD tetap menggunakan Go API R2C1/R2C2A, PostgreSQL, CSRF dan audit yang sudah ada.
- UI hanya membuat permission mudah dipahami melalui toggle per aksi (default OFF).
- Role Superadmin terlindungi. `identity.roles.manage` tidak dapat diberikan ke role lain.
- Superadmin tetap diblokir dari seluruh menu/dokumen operasional (aturan Go SA01).
- Grant pengguna tetap kombinasi **role + unit + scope + klasifikasi + masa berlaku**, tidak digabung silang untuk menciptakan cakupan akses lebih luas.
- Pengaturan role tersimpan hanya setelah tombol **Simpan Perubahan** dan alasan audit diisi (minimal 8 karakter).
- Tidak ada bulk-enable dan tidak ada bypass approval klasifikasi Rahasia.

## Mode editor

- **Sederhana:** label bahasa sehari-hari; toggle ON/OFF.
- **Lanjutan:** tampilkan permission key secara read-only, untuk pemeriksaan operator teknis.
- Pilihan scope di User Management: Dibuat sendiri, Ditugaskan, Dalam unit; klasifikasi Biasa/Penting.

## Pratinjau grant

Data pratinjau diambil dari endpoint `GET /api/v1/admin/users` dan `GET /api/v1/admin/roles` yang sudah ada. Ini hanya **kemungkinan izin dari grant tersimpan**, bukan keputusan per dokumen. Pratinjau memperhitungkan status akun, pergantian password wajib, role aktif, masa berlaku grant, unit + permission prefix, dan pengecualian Superadmin. Pratinjau **tidak mencakup delegasi** dan belum mengevaluasi status dokumen, ID pembuat, penugasan, klasifikasi data nyata, maupun constraints backend lainnya. Backend Go harus tetap mengevaluasi setiap request aktual via ABAC terhadap data yang diambil dari database.

## Verification gate

- Build `./sdl-run.sh` lulus.
- User dan Role Editor dapat dimuat, bukan sekadar build.
- Toggle role, simpan dengan alasan, refresh, dan verifikasi nilai tersimpan.
- Role Superadmin tidak dapat diedit; izin `identity.roles.manage` tetap locked pada role lainnya.
- Pilihan scope dan klasifikasi untuk grant tersimpan setelah refresh.
- Pratinjau user tidak menunjukkan hak operasional untuk Superadmin, akun nonaktif, atau akun wajib ubah password.
- Negative authorization tests tetap wajib sebelum R2D2 dinyatakan selesai.
