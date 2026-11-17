-- R5H16 lanjutan: penanda FINAL pada dokumen Subbagren.
--
-- Permintaan pemilik sistem (2026-11-17): dokumen yang sudah DISAHKAN tidak
-- otomatis masuk "Dokumen Final". Ia tetap di "Dokumen Perancangan" (tahap
-- pekerjaan masih bisa ditambah, mis. distribusi) sampai seseorang menekan
-- "Tandai Final". Final bisa dikembalikan ke perancangan; setiap perubahan dicatat
-- di audit. Aturan (hanya dokumen sah yang belum digantikan) ditegakkan di API.
--
-- Dua ADD COLUMN nullable tanpa DEFAULT, tanpa backfill: dokumen sah yang sudah
-- ada sebelum migrasi ini berstatus "sah, belum final".
--
-- EXPRESS SAJA.

ALTER TABLE sdl_ren_dokumen ADD COLUMN final_at TIMESTAMPTZ, ADD COLUMN final_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT;
