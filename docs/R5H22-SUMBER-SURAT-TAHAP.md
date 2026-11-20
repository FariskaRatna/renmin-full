# R5H22 — Sumber surat pada tahap "menerima surat/undangan" (Subbagren)

Status: **DIBANGUN lokal (2026-11-19), belum di-commit.** Khusus Express. Migrasi **065**
(R5H15 bergeser ke 066).

## Keputusan pemilik (2026-11-19)

| Hal | Keputusan |
|---|---|
| Pilihan | Saat mencatat tahap penerimaan surat/undangan: **Isi manual**, **Dari Disposisi** (Kabagrenmin, berinduk surat masuk Urmin), atau **Dari Surat Masuk** (antar-unit, R5H21) |
| Cakupan | Semua tahap Subbagren berform `surat_masuk` atau `undangan` (Laporan, Revisi Anggaran, Dokumen PROGAR) |
| Lampiran | **Hanya tautan** ke sumber; PDF tidak disalin, dibuka dari sumbernya |
| Status Surat Masuk | Tidak berubah otomatis (tanda Diterima tetap manual) |

## Rancangan

- Migrasi `065_tahap_sumber_surat.sql`: `sdl_ren_dokumen_tahap.sumber_jenis` (disposisi|surat_masuk, CHECK regex)
  + `sumber_id` (UUID). Dua ADD COLUMN nullable; terdaftar di peta review `migrate_test.go`.
- API `perencanaan.js`: `POST/PUT /dokumen/:id/tahap` menerima `sumber: {jenis,id} | null` (PUT: tidak dikirim =
  tidak diubah; `null` = kembali manual). Validasi: pekerjaan harus berform surat_masuk/undangan
  (`sumber_tidak_berlaku`); Surat Masuk harus sudah dikirim ke Subbagren; disposisi harus berinduk surat masuk dan
  salah satu penerimanya anggota Subbagren (`sumber_tidak_ditemukan`). Daftar tahap membawa `sumber {jenis,id,label}`.
  Katalog membawa peta `sumber` (form → kunci isian yang diisi dari sumber).
- UI: `SumberSuratR5H22.tsx` (pemilih), dipasang di formulir tahap; memilih sumber mengisi nomor/tanggal/pengirim/
  perihal. Register tahap menandai "🔗 Disposisi/Surat Masuk"; detail tahap punya baris **Sumber** yang membuka
  disposisi (halaman Arahan) atau Surat Masuk (detailnya langsung terbuka). Tahap bertaut tidak ditandai
  "⚠ belum ada bukti utama".

## Uji (2026-11-19, Chrome + API)

Laporan EKA PN 2028 baru: tahap "Menerima undangan rapat penyusunan" dari Disposisi → isian terisi dari lembar
disposisi; register bertanda 🔗; detail menampilkan sumber. Diubah ke Surat Masuk → tersimpan; klik sumber membuka
detail Surat Masuk. Sumber acak / kunci asing / surat yang bukan untuk Subbagren → 400; `sumber: null` → kembali
manual. Tanpa error halaman. Data uji: disposisi "[UJI R5H22] Undangan rapat penyusunan Laporan EKA PN" (ditanam
langsung di DB laptop untuk op/staf/kasubbagren), Laporan EKA PN 2028 baru.
