# R4A1 — Subbagren | Register Usulan Perencanaan & Anggaran

Status: **Mac Docker build + isolated security suite 18/18 PASS (2026-10-20); browser E2E masih pending**. Belum production-ready. Browser E2E R3E dan 5 akun yang memerlukan first-login password rotation tetap **pending**.

## Tujuan & batas

R4A1 adalah *register usulan internal* bagi Subbagren untuk menampung bahan kegiatan/program, bukan aplikasi penetapan pagu, DIPA, penyaluran uang, atau integrasi e-Sirena/e-Monev. `source_unit` adalah label asal pengusul, **bukan** hak akses lintas subsatker. Data hanya ada di unit `subbagren`; tidak ada akun baru atau sharing otomatis.

Fields: nomor internal `USL-{number}` (identity), tahun anggaran (2020–2100), unit/satker pengusul, judul kegiatan, target output, estimasi biaya dalam integer rupiah, klasifikasi biasa/penting, status draft/submitted, version dan audit.

Workflow:
1. User berwenang **create** dengan reason (8–500 karakter) → `draft`.
2. Selama `draft`, user berwenang **update** dengan optimistic version (`409` bila stale); class *penting* membutuhkan grant baru yang sesuai.
3. User berwenang **submit** dengan reason (`draft` → `submitted`, locked). Submit tidak berarti disetujui pimpinan atau alokasi anggaran final.
4. Histori `created`, `updated`, `submitted` dan sdl_audit_events ditulis dalam transaksi sama. Tidak ada delete/overwrite histori.

## Permission dan keamanan

Permission yang **ditambahkan saja** ke `sdl_permissions`, tanpa assign role otomatis:
- `subbagren.usulan.read`
- `subbagren.usulan.create`
- `subbagren.usulan.update`
- `subbagren.usulan.submit`

Semua request melalui `auth.AuthorizeOperational`: akun valid, password rotation selesai, Superadmin ditolak, mutation wajib Origin/CSRF. Setiap record diperiksa `access.EvaluateForUser` terhadap role permission **dan grant unit/scope/classification aktif**; return `404` untuk detail yang tak boleh dilihat. Daftar terbatas (151 kandidat terbaru, maksimal 150 ditampilkan) dan mungkin belum mencakup semua record yang dapat dibaca; harus dipasangi SQL-level authorization pagination sebelum dataset besar.

R4A1 **belum mempunyai review/approval**, sehingga jangan memberi grant `submit` dengan asumsi ia menyetujui anggaran. Error transaksi DB ditangani dengan rollback, dan alasan audit wajib. Semua field disimpan dalam PostgreSQL eksisting, tanpa external sharing.

## Verifikasi Mac

1. Jalankan installer ZIP, `./sdl-run.sh` dan `bash ./scripts/security-test-r2d5.sh` (target **18/18** termasuk `09f_r4a1_subbagren_usulan_access`).
2. Verifikasi `phase: subbagren-r4a1`, kesehatan 3 container, migration 015 di `sdl_schema_migrations` dan Go test.
3. Lewat Role Editor aktifkan permission secara selektif untuk akun yang *sudah* first-login, sesuai approval admin. Untuk negative tests gunakan dummy, bukan dokumen resmi.
4. Uji create/edit/submit, cek reload/history/version conflict, penolakan Superadmin dan akun tanpa grant, dan klasifikasi penting. **Jangan tandai R4A1 PASS hingga pengujian tercatat**.

R4A2: review+return, konsolidasi usulan, pagu dan revisi. R4A3: realisasi, deviasi dan monitoring kinerja sesuai daftar tugas Subbagren. Subbagsumda/Subbagbinfung menyusul sebagai modul berbeda dan memakai pola RBAC/ABAC yang sama.
