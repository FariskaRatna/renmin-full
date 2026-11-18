-- R5H16 lanjutan: estimasi anggaran per dokumen Subbagren.
--
-- Keputusan pemilik sistem (2026-11-17):
--   * Setiap dokumen di Dokumen Perancangan punya satu angka "Anggaran (estimasi)"
--     dalam rupiah bulat, ditambah catatan singkat.
--   * Boleh diubah selama dokumen belum Final/Selesai (termasuk setelah disahkan),
--     terkunci setelah Final/Selesai, terbuka lagi bila dikembalikan ke Perancangan.
-- Aturan ditegakkan di API Express (modules/subbagren/perencanaan.js).
--
-- Empat ADD COLUMN, semuanya nullable atau ber-DEFAULT. Tanpa backfill.
-- BIGINT (bukan NUMERIC(p,s)) karena nilainya rupiah bulat.
--
-- EXPRESS SAJA.

ALTER TABLE sdl_ren_dokumen ADD COLUMN anggaran BIGINT CHECK (anggaran >= 0), ADD COLUMN anggaran_note VARCHAR(500) NOT NULL DEFAULT '', ADD COLUMN anggaran_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT, ADD COLUMN anggaran_at TIMESTAMPTZ;
