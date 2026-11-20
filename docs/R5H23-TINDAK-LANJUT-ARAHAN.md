# R5H23 — Tindak lanjut arahan & disposisi

Status: **DIBANGUN lokal (2026-11-19), belum di-commit.** Khusus Express. Migrasi **066** (R5H15 → 067).

## Keputusan pemilik (2026-11-19)

| Hal | Keputusan |
|---|---|
| Kapan | Setelah arahan/disposisi **diterima**, di bawahnya ada bagian **Tindak Lanjut** |
| Bentuk | **Satu laporan per penerima**, teks bebas, bisa diubah |
| Lampiran | Banyak: **PDF, gambar (PNG/JPG), Excel, Word**; maks **10** per penerima, 20 MB per berkas |
| Yang melihat | Pemberi arahan (selama masih Kabagrenmin) + **semua penerima** arahan yang sama |
| Penutup | Tidak ada status "Selesai" |

## Rancangan

- Migrasi `066_arahan_tindak_lanjut.sql`: `sdl_leadership_directive_followups` (PK directive+penerima, FK ke tabel
  penerima, `isi` ≤ 4000, `version`) + `sdl_leadership_directive_followup_files` (tersegel AES-GCM).
- API `modules/directives/tindak-lanjut.js` (rute baru di `/leadership/directives`; kontrak lama tidak berubah):
  `GET|PUT /:id/tindak-lanjut`, `POST /:id/tindak-lanjut/berkas`, `GET|DELETE /:id/tindak-lanjut/berkas/:fid`.
  Penerima menulis hanya setelah menerima (409 `belum_diterima`); penerbit hanya membaca (403 saat menulis);
  orang luar 404; optimistic `version`; berkas diperiksa isinya (PDF utuh, PNG/JPG asli, OOXML tanpa makro).
- UI `TindakLanjutR5H23.tsx/.css`: dipasang di detail **Arahan** (DirectivesR5F23) dan di **lembar disposisi**
  (DisposisiSuratR5H6 — Tugas Disposisi penerima dan tampilan surat Kabagrenmin, blok terkirim & diterima).

## Uji (2026-11-19)

Disposisi uji "[UJI R5H22] …" (op/staf/kasubbagren): sebelum diterima menulis 409; op menerima lewat
SUBBAGREN → Disposisi, menulis laporan + 3 lampiran (PDF/XLSX/DOCX), menghapus satu; versi basi 409, field asing
400, .exe/PDF palsu 400; staf (belum menerima) bisa membaca tetapi tidak menulis/menghapus; Kabagrenmin membaca &
mengunduh, tidak bisa menulis; orang luar 404. Tanpa error halaman.

## Temuan (perilaku lama, belum diubah)

Disposisi surat yang dibuka dari **Inbox** diarahkan ke halaman Arahan, padahal daftar Arahan hanya memuat
arahan umum — detailnya tidak terbuka. Disposisi dibuka lewat menu **Disposisi / Tugas Disposisi**.
