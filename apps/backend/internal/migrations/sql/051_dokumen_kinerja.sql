-- R5H13: Dokumen Perencanaan dan Monitoring Kinerja & LKIP (Subbagren).
--
-- Keputusan pemilik sistem (2026-11-13):
--   * Dokumen Perencanaan berstatus draft sampai DISAHKAN Kasubbagren;
--     pengunggah tidak boleh mengesahkan sendiri. Revisi = dokumen baru yang
--     menunjuk dokumen yang digantikannya; versi lama tetap bisa dibuka.
--   * Indikator kinerja melekat per KEGIATAN (Program Anggaran R5H11), target
--     dan capaian per TRIWULAN.
--   * LKIP: rekap di layar + unduh Excel (dibangkitkan backend).
--
-- EXPRESS SAJA.

CREATE TABLE sdl_ren_dokumen (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tahun INTEGER NOT NULL CHECK (tahun BETWEEN 2000 AND 2100),
 jenis VARCHAR(20) NOT NULL CHECK (jenis IN ('renstra','renja','rka_kl','dipa','revisi_dipa','pok','tor_kak','rab','lainnya')),
 judul VARCHAR(240) NOT NULL CHECK (length(btrim(judul)) BETWEEN 3 AND 240),
 nomor VARCHAR(120) NOT NULL DEFAULT '',
 tanggal DATE,
 program_id UUID REFERENCES sdl_ren_program(id) ON DELETE RESTRICT,
 kegiatan_id UUID REFERENCES sdl_ren_kegiatan(id) ON DELETE RESTRICT,
 keterangan VARCHAR(1000) NOT NULL DEFAULT '',
 pengganti_dari UUID REFERENCES sdl_ren_dokumen(id) ON DELETE RESTRICT,
 status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','disahkan','ditolak')),
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 reviewed_at TIMESTAMPTZ,
 review_note VARCHAR(500) NOT NULL DEFAULT '',
 CONSTRAINT sdl_ren_dokumen_review_shape CHECK (
   (status = 'draft' AND reviewed_by IS NULL AND reviewed_at IS NULL)
   OR (status <> 'draft' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
 CONSTRAINT sdl_ren_dokumen_maker_checker CHECK (reviewed_by IS NULL OR reviewed_by <> created_by),
 CONSTRAINT sdl_ren_dokumen_not_self CHECK (pengganti_dari IS NULL OR pengganti_dari <> id)
);
CREATE INDEX sdl_ren_dokumen_tahun_idx ON sdl_ren_dokumen(tahun, jenis, created_at);
-- Satu dokumen hanya boleh digantikan oleh satu revisi yang hidup.
CREATE UNIQUE INDEX sdl_ren_dokumen_one_revision_idx
 ON sdl_ren_dokumen(pengganti_dari) WHERE pengganti_dari IS NOT NULL AND status IN ('draft','disahkan');

-- Berkas dokumen (PDF <= 20 MB), terenkripsi AES-256-GCM dengan SDL_EVIDENCE_KEY.
CREATE TABLE sdl_ren_dokumen_berkas (
 dokumen_id UUID PRIMARY KEY REFERENCES sdl_ren_dokumen(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indikator kinerja per kegiatan. Target dan capaian adalah nilai KUMULATIF
-- s.d. akhir triwulan (TW IV = capaian setahun), dalam satuan indikator.
CREATE TABLE sdl_ren_indikator (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kegiatan_id UUID NOT NULL REFERENCES sdl_ren_kegiatan(id) ON DELETE RESTRICT,
 nama VARCHAR(240) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 240),
 satuan VARCHAR(40) NOT NULL CHECK (length(btrim(satuan)) BETWEEN 1 AND 40),
 target_tw1 NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_tw1 >= 0),
 target_tw2 NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_tw2 >= 0),
 target_tw3 NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (target_tw3 >= 0),
 target_tw4 NUMERIC(18,2) NOT NULL CHECK (target_tw4 > 0),
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ
);
CREATE INDEX sdl_ren_indikator_kegiatan_idx ON sdl_ren_indikator(kegiatan_id) WHERE deleted_at IS NULL;

CREATE TABLE sdl_ren_capaian (
 indikator_id UUID NOT NULL REFERENCES sdl_ren_indikator(id) ON DELETE RESTRICT,
 triwulan SMALLINT NOT NULL CHECK (triwulan BETWEEN 1 AND 4),
 nilai NUMERIC(18,2) NOT NULL CHECK (nilai >= 0),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (indikator_id, triwulan)
);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagren.dokumen.sahkan', 'Sahkan atau tolak Dokumen Perencanaan yang diunggah orang lain')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, 'subbagren.dokumen.sahkan' FROM sdl_roles r WHERE r.role_key = 'br_kasubbagren'
ON CONFLICT (role_key, permission_key) DO NOTHING;
