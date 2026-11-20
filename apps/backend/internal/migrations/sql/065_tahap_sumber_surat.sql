-- R5H22: tahap "menerima surat/undangan" bisa MENAUTKAN sumbernya: disposisi
-- Kabagrenmin (sdl_leadership_directives) atau Surat Masuk antar-unit
-- (sdl_surat_antar, R5H21). Keputusan pemilik (2026-11-19): hanya tautan,
-- PDF tidak disalin; status diterima Surat Masuk tetap manual.
--
-- Dua ADD COLUMN nullable tanpa DEFAULT, tanpa backfill (CHECK memakai regex, bukan IN,
-- karena pengaman migrasi memecah klausa per koma). Pasangan
-- (jenis, id) dan keberadaan/hak akses sumbernya ditegakkan di API Express
-- (modules/subbagren/perencanaan.js), bukan FK: dua tabel sumber berbeda.
--
-- EXPRESS SAJA.

ALTER TABLE sdl_ren_dokumen_tahap ADD COLUMN sumber_jenis VARCHAR(12) CHECK (sumber_jenis ~ '^(disposisi|surat_masuk)$'), ADD COLUMN sumber_id UUID;
