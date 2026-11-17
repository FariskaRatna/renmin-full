-- R5H16 lanjutan: pengecekan tahap pekerjaan oleh Kasubbagren.
--
-- Keputusan pemilik sistem (2026-11-17):
--   * Setiap tahap pekerjaan dicek Kasubbagren satu per satu: Menunggu dicek ->
--     Diterima (terkunci) atau Dikembalikan (dengan catatan, operator memperbaiki,
--     lalu kembali Menunggu dicek). Pembuat/pengubah terakhir tidak boleh
--     mengecek entrinya sendiri.
--   * Tandai Final hanya bila semua tahap sudah diterima.
--   * PDF utama dokumen berjenis tahap diambil dari lampiran "Dokumen yang sudah
--     ditandatangani" pada tahap pengesahan.
-- Aturan ditegakkan di API Express (modules/subbagren/perencanaan.js).
--
-- Empat ADD COLUMN; cek_status NOT NULL ber-DEFAULT 'menunggu' (tahap yang sudah
-- ada menjadi "menunggu dicek"), sisanya nullable / ber-DEFAULT. Tanpa backfill lain.
--
-- EXPRESS SAJA.

ALTER TABLE sdl_ren_dokumen_tahap ADD COLUMN cek_status VARCHAR(12) NOT NULL DEFAULT 'menunggu' CHECK (cek_status ~ '^(menunggu|diterima|dikembalikan)$'), ADD COLUMN cek_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT, ADD COLUMN cek_at TIMESTAMPTZ, ADD COLUMN cek_note VARCHAR(500) NOT NULL DEFAULT '';
