# R4A2 — Review Internal Usulan dan Konsolidasi Subbagren

**Status:** siap source review, belum lulus build & security Mac. R4A1 Mac 18/18 PASS; browser E2E R3E pending.

## Workflow dan batas

Register R4A1 tetap menggunakan `draft`/`submitted`. Migration 016 bersifat *additive*, membuat tabel `review_cases` dan `review_events` sehingga status dasar R4A1 dan checksum migration 015 tidak diubah. Status review dihitung sebagai `pending`, `revision_requested`, `approved` untuk usulan submitted. Persetujuan internal **bukan pengesahan pagu maupun DIPA**.

1. Draft dibuat/diperbarui dan di-submit menggunakan izin R4A1.
2. Reviewer berbeda dari pembuat, dengan `subbagren.usulan.read` dan `subbagren.usulan.review` dalam grant `subbagren` yang sah (umumnya scope unit), memilih `approved` atau `revision_requested` dengan alasan 8–500 karakter.
3. Untuk pengembalian, pembuat asli yang memiliki `read` + `update` bisa mengoreksi melalui `PATCH /{id}/revision`; hanya dari state `revision_requested`. Perubahan klasifikasi harus lolos ABAC sebelum dan sesudah perubahan.
4. Dengan `submit` tetap aktif dan sesudah koreksi nyata, pembuat dapat `POST /{id}/resubmit`. Review kembali `pending`; review ulang harus dilakukan pihak berbeda dari pembuat. Semua mutation memakai optimistic version dan transaksi dengan audit. Tidak dapat membuat keputusan ganda untuk versi yang sama.
5. `GET /consolidation?year=2027` hanya menampilkan usulan approved internal yang lolos kedua permission `read` dan `consolidate` **per record**. Tahun dalam rentang 2020–2100. Nilai total sebagai string integer rupiah. Lebih dari 2000 kandidat akan ditolak, bukan dikembalikan total parsial.

Tidak ada izin baru yang auto-ON. Permission baru: `subbagren.usulan.review`, `subbagren.usulan.consolidate`. `AuthorizeOperational` memblokir Superadmin dan user yang belum mengganti password. Semua mutation memakai Origin dan CSRF. Pengujian browser E2E serta grant akun nyata masih pending.

## Uji yang diharapkan

Target isolated security suite: **19/19** dengan test baru `09g_r4a2_internal_review_consolidation`. Test harus membuktikan persetujuan internal, self-review deny, return → revise → resubmit → review, conflict 409, klasifikasi Penting, audit history, konsolidasi filtered.
