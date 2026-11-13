-- R5H11: Program Anggaran (PROGAR) dan Pagu Anggaran yang mengambil darinya.
--
-- Keputusan pemilik sistem (2026-11-13):
--   * Struktur dua tingkat: Program -> Kegiatan. Pagu dicatat PER KEGIATAN.
--   * Terpisah dari pagu lama R4A3 (sdl_subbagren_budget_*, berbasis Usulan);
--     tabel lama tidak disentuh.
--   * Operator dan Kasubbagren menginput; Staf dan Kabagrenmin membaca.
--   * Pagu berstatus draft sampai DISETUJUI Kasubbagren; pencatat tidak boleh
--     menyetujui inputannya sendiri (ditegakkan juga di level database).
--
-- EXPRESS SAJA. Go tidak mengenal tabel ini; prefix /api/v1/subbagren/* di
-- server sudah dilayani Express.
--
-- Hak akses lewat permission pada grant unit 'subbagren' (lihat
-- modules/subbagren/progar.js). Scope grant TIDAK dipakai: program dan pagu
-- adalah register tingkat unit tanpa konsep penugasan dokumen, dan scope
-- 'assigned' milik Operator tidak akan pernah cocok dengan apa pun
-- (docs/PERTANYAAN-KONFIGURASI-AKSES.md, pertanyaan 2).

CREATE TABLE sdl_ren_program (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tahun INTEGER NOT NULL CHECK (tahun BETWEEN 2000 AND 2100),
 kode VARCHAR(40) NOT NULL CHECK (length(btrim(kode)) BETWEEN 1 AND 40),
 nama VARCHAR(240) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 240),
 keterangan VARCHAR(1000) NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX sdl_ren_program_kode_idx
 ON sdl_ren_program(tahun, lower(kode)) WHERE deleted_at IS NULL;

CREATE TABLE sdl_ren_kegiatan (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 program_id UUID NOT NULL REFERENCES sdl_ren_program(id) ON DELETE RESTRICT,
 kode VARCHAR(40) NOT NULL CHECK (length(btrim(kode)) BETWEEN 1 AND 40),
 nama VARCHAR(240) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 240),
 keterangan VARCHAR(1000) NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX sdl_ren_kegiatan_kode_idx
 ON sdl_ren_kegiatan(program_id, lower(kode)) WHERE deleted_at IS NULL;

-- Satu kegiatan punya paling banyak SATU pagu yang hidup (draft atau
-- disetujui). Pagu yang ditolak boleh diganti dengan pagu baru.
CREATE TABLE sdl_ren_pagu (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kegiatan_id UUID NOT NULL REFERENCES sdl_ren_kegiatan(id) ON DELETE RESTRICT,
 jumlah NUMERIC(18,0) NOT NULL CHECK (jumlah > 0),
 dasar VARCHAR(240) NOT NULL CHECK (length(btrim(dasar)) BETWEEN 3 AND 240),
 keterangan VARCHAR(1000) NOT NULL DEFAULT '',
 status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','disetujui','ditolak')),
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 reviewed_at TIMESTAMPTZ,
 review_note VARCHAR(500) NOT NULL DEFAULT '',
 CONSTRAINT sdl_ren_pagu_review_shape CHECK (
   (status = 'draft' AND reviewed_by IS NULL AND reviewed_at IS NULL)
   OR (status <> 'draft' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
 CONSTRAINT sdl_ren_pagu_maker_checker CHECK (reviewed_by IS NULL OR reviewed_by <> created_by)
);
CREATE UNIQUE INDEX sdl_ren_pagu_one_live_idx
 ON sdl_ren_pagu(kegiatan_id) WHERE status IN ('draft','disetujui');
CREATE INDEX sdl_ren_pagu_status_idx ON sdl_ren_pagu(status, created_at);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagren.progar.read', 'Lihat Program, Kegiatan, dan Pagu Anggaran Subbagren'),
 ('subbagren.progar.manage', 'Catat dan ubah Program, Kegiatan, dan Pagu Anggaran (draft)'),
 ('subbagren.pagu.approve', 'Setujui atau tolak Pagu Anggaran yang dicatat orang lain')
ON CONFLICT (permission_key) DO NOTHING;

-- Diberikan ke role BagRenmin yang SUDAH ADA (server dan laptop). Pada
-- database baru, role belum ada saat migrasi berjalan; seed-bagrenmin
-- (Go dan Express) membawa permission yang sama.
INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key
  FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagren', 'subbagren.progar.read'),
    ('br_op_subbagren', 'subbagren.progar.manage'),
    ('br_staf_subbagren', 'subbagren.progar.read'),
    ('br_kasubbagren', 'subbagren.progar.read'),
    ('br_kasubbagren', 'subbagren.progar.manage'),
    ('br_kasubbagren', 'subbagren.pagu.approve'),
    ('br_kabagrenmin', 'subbagren.progar.read')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;
