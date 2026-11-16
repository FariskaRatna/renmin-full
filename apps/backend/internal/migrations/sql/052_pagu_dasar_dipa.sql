-- R5H14: Pagu Anggaran wajib merujuk DIPA / Revisi DIPA yang sah.
--
-- Keputusan pemilik sistem (2026-11-13): dalam praktik DIPA lebih dulu terbit
-- dan MENETAPKAN pagu per kegiatan; aplikasi harus mengikuti urutan itu.
-- Pagu baru tidak bisa dicatat tanpa memilih dokumen DIPA/Revisi DIPA yang
-- sudah disahkan (dan belum digantikan revisi) di tahun anggaran yang sama.
-- Aturan itu ditegakkan di API (modules/subbagren/progar.js), bukan NOT NULL:
-- pagu yang sudah ada sebelum migrasi ini tidak punya rujukan dan tidak diisi
-- ulang (tanpa backfill). Kolom `dasar` tetap ada sebagai teks tampilan.
--
-- EXPRESS SAJA.

ALTER TABLE sdl_ren_pagu ADD COLUMN dokumen_id UUID REFERENCES sdl_ren_dokumen(id) ON DELETE RESTRICT;

CREATE INDEX sdl_ren_pagu_dokumen_idx ON sdl_ren_pagu(dokumen_id) WHERE dokumen_id IS NOT NULL;
