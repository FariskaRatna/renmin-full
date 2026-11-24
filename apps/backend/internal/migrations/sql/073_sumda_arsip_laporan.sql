-- R5H32 (2026-11-24): Subbagsumda Persuratan & Arsip (register arsip dokumen) + Laporan & Analitik. Express saja.
-- Hak lewat permission pada grant unit 'subbagsumda' (pola 068-072). Kerahasiaan Biasa/Terbatas diputus di SQL Express.
-- Prinsip K43 R5H30: hanya aturan STRUKTURAL. Peta status, BA wajib saat Musnah, satu surat satu arsip,
-- dan batas ekspor ditegakkan di Express.

CREATE TABLE sdl_sumda_arsip (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 nomor VARCHAR(120) NOT NULL DEFAULT '',
 jenis VARCHAR(16) NOT NULL
   CHECK (jenis IN ('SURAT_MASUK','SURAT_KELUAR','NOTA_DINAS','SURAT_KEPUTUSAN','BERITA_ACARA','LAINNYA')),
 perihal VARCHAR(240) NOT NULL CHECK (length(btrim(perihal)) BETWEEN 3 AND 240),
 tanggal DATE NOT NULL,
 asal_tujuan VARCHAR(200) NOT NULL DEFAULT '',
 kode_klasifikasi VARCHAR(60) NOT NULL DEFAULT '',
 lokasi_simpan VARCHAR(200) NOT NULL DEFAULT '',
 retensi_sampai DATE,
 kerahasiaan VARCHAR(8) NOT NULL DEFAULT 'BIASA' CHECK (kerahasiaan IN ('BIASA','TERBATAS')),
 catatan VARCHAR(2000) NOT NULL DEFAULT '',
 personel_id UUID REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 surat_id UUID,                                   -- TANPA FK: TRUNCATE CASCADE harness merambat ke sdl_surat_antar
 status VARCHAR(8) NOT NULL DEFAULT 'Aktif' CHECK (status IN ('Aktif','Inaktif','Musnah')),
 musnah_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 musnah_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_arsip_musnah CHECK (((status = 'Musnah') = (musnah_by IS NOT NULL))
   AND ((musnah_by IS NULL) = (musnah_at IS NULL)))
);
CREATE INDEX sdl_sumda_arsip_daftar_idx ON sdl_sumda_arsip(tanggal DESC, created_at DESC);
CREATE INDEX sdl_sumda_arsip_status_idx ON sdl_sumda_arsip(status, jenis);
CREATE INDEX sdl_sumda_arsip_retensi_idx ON sdl_sumda_arsip(retensi_sampai)
 WHERE status IN ('Aktif','Inaktif') AND retensi_sampai IS NOT NULL;
CREATE INDEX sdl_sumda_arsip_personel_idx ON sdl_sumda_arsip(personel_id) WHERE personel_id IS NOT NULL;
-- Bukan UNIQUE: satu surat satu arsip adalah aturan bisnis K27/K31 (kunci baris surat di Express).
CREATE INDEX sdl_sumda_arsip_surat_idx ON sdl_sumda_arsip(surat_id) WHERE surat_id IS NOT NULL;

CREATE TABLE sdl_sumda_arsip_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 arsip_id UUID NOT NULL REFERENCES sdl_sumda_arsip(id) ON DELETE CASCADE,
 dari VARCHAR(8) CHECK (dari IN ('Aktif','Inaktif','Musnah')),
 ke VARCHAR(8) NOT NULL CHECK (ke IN ('Aktif','Inaktif','Musnah')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_arsip_riwayat_idx ON sdl_sumda_arsip_riwayat(arsip_id, id);

CREATE TABLE sdl_sumda_arsip_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 arsip_id UUID NOT NULL REFERENCES sdl_sumda_arsip(id) ON DELETE RESTRICT,
 peran VARCHAR(10) NOT NULL DEFAULT 'DOKUMEN' CHECK (peran IN ('DOKUMEN','BA_MUSNAH')),
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_arsip_lampiran_idx ON sdl_sumda_arsip_lampiran(arsip_id, uploaded_at);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.arsip.read', 'Lihat register arsip dokumen Subbagsumda'),
 ('subbagsumda.arsip.manage', 'Catat dan kelola arsip dokumen Subbagsumda'),
 ('subbagsumda.arsip.restricted', 'Lihat dan kelola arsip Terbatas Subbagsumda milik pencatat lain'),
 ('subbagsumda.laporan.export', 'Unduh data Subbagsumda sebagai berkas CSV')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda','subbagsumda.arsip.read'), ('br_op_subbagsumda','subbagsumda.arsip.manage'),
    ('br_staf_subbagsumda','subbagsumda.arsip.read'), ('br_staf_subbagsumda','subbagsumda.arsip.manage'),
    ('br_kasubbagsumda','subbagsumda.arsip.read'), ('br_kasubbagsumda','subbagsumda.arsip.manage'),
    ('br_kasubbagsumda','subbagsumda.arsip.restricted'), ('br_kasubbagsumda','subbagsumda.laporan.export'),
    ('br_kabagrenmin','subbagsumda.arsip.read'), ('br_kabagrenmin','subbagsumda.arsip.restricted'),
    ('br_kabagrenmin','subbagsumda.laporan.export')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;
