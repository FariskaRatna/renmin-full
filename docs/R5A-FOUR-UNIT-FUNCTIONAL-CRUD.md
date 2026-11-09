# R5A — Berkas, Foto dan Disposisi Internal, Empat Unit

## Selesai secara source; uji Mac dan browser masih wajib

Menu: Portal > pilih **Urmin / Subbagren / Subbagsumda / Subbagbinfung** > **Berkas, Foto & Disposisi** (sidebar atau tombol Dashboard Unit). Real PostgreSQL, bukan browser cache. Migrasi 019 additive, tidak menyentuh dokumen finance R4A3B. Go API /api/v1/unit-work/{unit}/...

- Berkas: tambah, cari kategori/judul, detail, ubah, dan hapus dari daftar aktif (soft-delete untuk histori).
- File: unggah/view foto JPG/PNG, buka PDF, hapus lampiran; file maksimal 5 MiB, 10 lampiran aktif/berkas. File data BYTEA dalam PostgreSQL lokal privat, tidak ada public static URLs.
- Disposisi internal: pembuat/petugas dengan scope unit memilih petugas **di unit yang sama**, isi instruksi dan tenggat; penerima memilih **Terima**, lalu mengisi hasil dan **Selesai**. Pengirim bisa membatalkan pending/received. Histori mencatat aksi.
- Hak akses dasar: sesi login operasional yang valid, password first-login sudah diganti, active grant role+unit+classification. Own dan assigned scope difilter pada data; Superadmin operasional tetap dilarang. Tidak ada auto-grant role, reset akun atau perubahan data lama.
- **Disposisi surat resmi antarsubbag** tetap melalui fitur Urmin R3C/R3D; R5A merupakan tugas berkas internal unit, bukan surat dinas resmi atau substitusi tanda tangan.
- MVP ini tidak mengeklaim malware scanning, media encryption-at-rest, redaction, OCR, legal archival/retention or browser E2E. Jangan memasukkan berkas rahasia/produksi sebelum hardening dan DR drill.

## Smoke test 2 akun (browser Mac)

1. Pastikan dua akun dalam unit yang sama sudah selesai first password rotation dan memiliki active non-expired unit grants. Akun yang diberikan scope `own` bisa membuat berkas dan bertindak sebagai penerima disposisi. Superadmin tidak boleh masuk workspace operasional.
2. Akun A: masuk workspace unit > Berkas, Foto & Disposisi > Tambah Berkas > Simpan. Refresh dan cari ulang berkas.
3. Akun A: edit metadata, unggah JPG atau PNG; pastikan preview bisa dibuka setelah refresh; unggah PDF, klik Buka; hapus lampiran dan pastikan hilang dari daftar.
4. Akun A: pilih akun B pada penerima, isi instruksi, tanggal, klik Kirim Disposisi. Logout.
5. Akun B: pilih unit sama, buka berkas yang ditugaskan, klik **Terima**, isi hasil tindak lanjut lalu **Tandai Selesai**. Logout.
6. Akun A: masuk dan buka berkas; pastikan status Completed dan riwayat tampil sesudah refresh.
7. Arsipkan berkas tanpa disposisi aktif; pastikan tidak muncul di daftar, tetapi DB/history dipertahankan. Bila masih ada disposisi aktif, penghapusan ditolak.

## Endpoint (semua memerlukan sesi)

`GET {unit}/people`, `GET/POST {unit}/records`, `GET/PATCH/DELETE {unit}/records/{id}`, `POST {id}/files` (multipart file), `GET/DELETE {id}/files/{fileID}`, `POST {id}/tasks`, `POST {id}/tasks/{taskID}/{receive|complete|cancel}`. JSON mutation menggunakan X-CSRF-Token yang diambil dari `/api/v1/auth/csrf`.

Build Gate dari `./sdl-run.sh` mencakup Go unit tests, React build, migration 019 dan healthcheck; browser CRUD wajib diuji terpisah. Security integration suite 21/21 R4A3B sudah lulus sebelumnya, tetapi R5A belum punya regression suite baru.
