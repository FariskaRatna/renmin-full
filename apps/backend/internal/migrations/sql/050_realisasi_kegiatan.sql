-- R5H12: Realisasi Anggaran per kegiatan, memotong Pagu Anggaran R5H11.
--
-- Keputusan pemilik sistem (2026-11-13): realisasi dicatat terhadap pagu
-- kegiatan yang DISETUJUI (sdl_ren_pagu), bukan lagi terhadap pagu berbasis
-- Usulan (R4A3). Tabel R4A3 tidak disentuh; datanya tetap terbaca.
--
-- Aturan:
--   * Realisasi berstatus draft sampai DIVERIFIKASI pihak lain (pencatat !=
--     pemeriksa, ditegakkan juga di level database).
--   * Verifikasi WAJIB ada satu bukti bayar (PDF/JPG/PNG <= 5 MB) yang
--     disimpan terenkripsi AES-256-GCM dengan SDL_EVIDENCE_KEY, envelope sama
--     dengan bukti R4A3B.
--   * Jumlah realisasi terverifikasi tidak boleh melebihi pagu kegiatannya;
--     diperiksa saat verifikasi dengan kunci baris pagu (FOR UPDATE).
--
-- EXPRESS SAJA.

CREATE TABLE sdl_ren_realisasi (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 pagu_id UUID NOT NULL REFERENCES sdl_ren_pagu(id) ON DELETE RESTRICT,
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
 CONSTRAINT sdl_ren_realisasi_review_shape CHECK (
   (status = 'draft' AND reviewed_by IS NULL AND reviewed_at IS NULL)
   OR (status <> 'draft' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
 CONSTRAINT sdl_ren_realisasi_maker_checker CHECK (reviewed_by IS NULL OR reviewed_by <> created_by)
);
CREATE INDEX sdl_ren_realisasi_pagu_idx ON sdl_ren_realisasi(pagu_id, status);

-- Satu bukti bayar per realisasi; mengganti bukti = menimpa baris ini selama
-- realisasi masih draft (riwayatnya di sdl_audit_events).
CREATE TABLE sdl_ren_realisasi_bukti (
 realisasi_id UUID PRIMARY KEY REFERENCES sdl_ren_realisasi(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 mime_type VARCHAR(40) NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagren.realisasi.manage', 'Catat realisasi anggaran per kegiatan dan unggah bukti bayar'),
 ('subbagren.realisasi.verify', 'Verifikasi atau tolak realisasi anggaran yang dicatat orang lain')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key
  FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagren', 'subbagren.realisasi.manage'),
    ('br_kasubbagren', 'subbagren.realisasi.manage'),
    ('br_kasubbagren', 'subbagren.realisasi.verify')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;
