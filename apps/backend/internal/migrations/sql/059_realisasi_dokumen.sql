-- R5H18: Realisasi Anggaran memotong anggaran DOKUMEN FINAL (bukan pagu kegiatan).
--
-- Keputusan pemilik sistem (2026-11-17):
--   * Menu Program Anggaran dan Pagu Anggaran tidak dipakai lagi. Acuan anggaran
--     adalah "Anggaran (estimasi)" pada setiap dokumen yang sudah Final/Selesai
--     (migrasi 057); setiap dokumen itu menjadi satu "pos" anggaran.
--   * Realisasi dicatat per pos, wajib bukti bayar, diverifikasi pihak lain;
--     jumlah terverifikasi tidak boleh melebihi anggaran dokumennya.
--   * Data pagu/realisasi lama (sdl_ren_pagu, sdl_ren_realisasi) TIDAK disentuh,
--     hanya tidak ditampilkan lagi.
--
-- Tabel baru karena sdl_ren_realisasi.pagu_id NOT NULL (tidak boleh diubah).
-- Bentuk dan aturan sama dengan 050. Hak akses memakai permission 050
-- (subbagren.realisasi.manage / .verify); tidak ada permission baru.
--
-- EXPRESS SAJA.

CREATE TABLE sdl_ren_realisasi_dok (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 dokumen_id UUID NOT NULL REFERENCES sdl_ren_dokumen(id) ON DELETE RESTRICT,
 tanggal DATE NOT NULL,
 uraian VARCHAR(240) NOT NULL CHECK (length(btrim(uraian)) BETWEEN 3 AND 240),
 nomor_bukti VARCHAR(120) NOT NULL CHECK (length(btrim(nomor_bukti)) BETWEEN 3 AND 120),
 jumlah NUMERIC(18,0) NOT NULL CHECK (jumlah > 0),
 status VARCHAR(14) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','terverifikasi','ditolak')),
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 reviewed_at TIMESTAMPTZ,
 review_note VARCHAR(500) NOT NULL DEFAULT '',
 CONSTRAINT sdl_ren_realisasi_dok_review_shape CHECK (
   (status = 'draft' AND reviewed_by IS NULL AND reviewed_at IS NULL)
   OR (status <> 'draft' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
 CONSTRAINT sdl_ren_realisasi_dok_maker_checker CHECK (reviewed_by IS NULL OR reviewed_by <> created_by)
);
CREATE INDEX sdl_ren_realisasi_dok_dokumen_idx ON sdl_ren_realisasi_dok(dokumen_id, status);

CREATE TABLE sdl_ren_realisasi_dok_bukti (
 realisasi_id UUID PRIMARY KEY REFERENCES sdl_ren_realisasi_dok(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 mime_type VARCHAR(40) NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
