# SIERA DELTA LIMA — R5D UX02 Surat Keluar Inline Upload & Preview

## Tujuan
Di menu Urmin → Surat Keluar, form Tambah/Edit memiliki bagian keempat **File Surat & Lampiran**.
Pengguna memilih PDF/JPG/JPEG/PNG (maks. 5 MiB per berkas, 10 berkas aktif per surat), melihat thumbnail gambar, dan membuka PDF/gambar di modal tanpa berpindah ke workspace R5A.

## Data-flow nyata
1. Operator mengisi register Surat Keluar, memilih satu atau lebih lampiran; sebelum Simpan, lampiran masih ada di browser lokal, belum dikirim.
2. Saat Simpan, frontend POST ke API register Urmin yang membuat register dan berkas unit R5A terkait di PostgreSQL.
3. Frontend POST multipart untuk setiap file ke API R5A menggunakan `workRecordId` dari response. Server memvalidasi magic bytes PDF/JPEG/PNG, batas ukuran 5 MiB, batas 10 aktif, dan izin upload yang sudah berlaku. File tersimpan privat di PostgreSQL (`sdl_unit_work_files`) dengan SHA-256.
4. Saat Edit, GET detail R5A menampilkan lampiran tersimpan. Tombol Preview memakai authenticated fetch + Blob URL; PDF ditampilkan di iframe modal dan foto dengan img. Tombol Unduh menggunakan endpoint lama, dan Hapus menghapus attachment dari daftar aktif.
5. Tombol File & Disposisi pada register masih tersedia untuk penugasan internal.

## Perlindungan dari pekerjaan ganda
Penyimpanan register lalu upload terdiri dari request terpisah, **bukan satu transaksi atomik**. Bila register berhasil tetapi upload gagal, form dibiarkan terbuka dan ID register yang telah dibuat diingat; menekan Simpan lagi mengulang **hanya file yang belum berhasil**, bukan membuat surat duplikat. Bila browser ditutup di tengah upload, operator bisa Edit surat lalu tambahkan lampiran yang kurang.

## Perubahan lain
Judul modal sebelumnya salah menyebut `SUBBAGBINFUNG`; kini menjadi `URMIN`, termasuk id aksesibilitas modal.

## Batas
- Tidak ada perubahan schema/database, endpoint, role, grant, atau password.
- Mekanisme storage tetap R5A: file dicatat dalam PostgreSQL. **Tidak otomatis terenkripsi at rest**, jadi gunakan data uji non-rahasia sampai kontrol penyimpanan produksi disiapkan.
- Preview PDF memerlukan dukungan penampil PDF dari browser desktop/mobile; bila browser tidak mendukung, Unduh tetap tersedia setelah file disimpan.
- Jika reloading browser sebelum klik Simpan, file yang belum diupload tidak akan tersimpan.
- Build dan functional browser E2E memerlukan verifikasi di Mac; hasil syntax check/installer simulation bukan bukti Browser E2E PASS.

## Functional smoke test di Mac
1. Login akun operasional (atau superadmin development demo), Urmin → Surat Keluar → Tambah.
2. Isi kode dan judul, pilih satu PDF dan satu JPG/PNG di form. Klik Preview masing-masing; klik Simpan. Pastikan sukses.
3. Refresh, klik Edit surat yang sama. Daftar dua lampiran harus ada, PDF dan foto dapat dipreview dan diunduh.
4. Tambah file di Edit, Simpan; uji Hapus lampiran, lalu refresh.
5. Klik File & Disposisi dari baris surat, pastikan riwayat dan penugasan tetap tersedia.
6. Uji file >5 MiB dan ekstensi tidak didukung (harus ditolak).
