-- R5H19 lanjutan: Revisi RPD ditautkan ke dokumen DIPA yang sudah ada.
--
-- Keputusan pemilik sistem (2026-11-18):
--   * Operator mengunggah DIPA/Revisi DIPA seperti biasa (Dokumen Perancangan),
--     lalu Revisi RPD ditautkan ke dokumen itu; tautan tampil di kedua detail.
--   * Revisi RPD baru bisa ditandai Selesai setelah tahap "DIPA baru terbit"
--     diterima Kasubbagren dengan PDF DIPA terlampir, dan DIPA sudah ditautkan.
-- Aturan ditegakkan di API Express (modules/subbagren/perencanaan.js).
--
-- Satu ADD COLUMN nullable tanpa DEFAULT, tanpa backfill.
--
-- EXPRESS SAJA.

ALTER TABLE sdl_ren_dokumen ADD COLUMN dipa_id UUID REFERENCES sdl_ren_dokumen(id) ON DELETE RESTRICT;
