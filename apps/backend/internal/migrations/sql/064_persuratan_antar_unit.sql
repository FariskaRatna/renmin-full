-- R5H21: persuratan antar-unit (Surat Keluar / Surat Masuk) untuk Subbagren,
-- Subbagsumda, Subbagbinfung, dan Urmin (docs/R5H21-PERSURATAN-ANTAR-UNIT.md).
--
-- Keputusan pemilik sistem (2026-11-19):
--   * Surat keluar subbag: draf -> diajukan -> disetujui/TTD Kabagrenmin -> dikirim.
--   * Tujuan: satu atau lebih unit internal dan/atau eksternal (teks bebas).
--   * Surat yang dikirim muncul di Surat Masuk unit tujuan, ditandai diterima,
--     dan terlihat oleh semua staf unit itu.
-- Aturan ditegakkan di API Express (modules/persuratan). Tabel lama Urmin
-- (sdl_urmin_registry dst.) tidak diubah; surat keluar Urmin yang dikirim ke
-- unit internal disalin ke sini dengan sumber 'urmin_registry'.
--
-- Tiga tabel baru + permission baru untuk role BagRenmin yang sudah ada.
--
-- EXPRESS SAJA.

CREATE TABLE sdl_surat_antar (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_pengirim VARCHAR(32) NOT NULL CHECK (unit_pengirim IN ('urmin','subbagren','subbagsumda','subbagbinfung')),
 sumber VARCHAR(16) NOT NULL DEFAULT 'baru' CHECK (sumber IN ('baru','urmin_registry')),
 urmin_registry_id UUID REFERENCES sdl_urmin_registry(id) ON DELETE RESTRICT,
 nomor VARCHAR(120) NOT NULL DEFAULT '',
 tanggal DATE,
 perihal VARCHAR(240) NOT NULL,
 sifat VARCHAR(8) NOT NULL DEFAULT 'Biasa' CHECK (sifat IN ('Biasa','Kilat')),
 jenis_surat VARCHAR(40) NOT NULL DEFAULT '',
 kode_arsip VARCHAR(60) NOT NULL DEFAULT '',
 ringkasan VARCHAR(2000) NOT NULL DEFAULT '',
 tujuan_eksternal VARCHAR(500) NOT NULL DEFAULT '',
 status VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','diajukan','ditolak','disetujui','dikirim')),
 review_note VARCHAR(500) NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 submitted_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 submitted_at TIMESTAMPTZ,
 reviewed_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 reviewed_at TIMESTAMPTZ,
 sent_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 sent_at TIMESTAMPTZ,
 CONSTRAINT sdl_surat_antar_sumber_ck CHECK ((sumber = 'urmin_registry') = (urmin_registry_id IS NOT NULL)),
 CONSTRAINT sdl_surat_antar_kirim_ck CHECK ((status = 'dikirim') = (sent_at IS NOT NULL))
);
CREATE INDEX sdl_surat_antar_unit_idx ON sdl_surat_antar(unit_pengirim, created_at DESC);
CREATE INDEX sdl_surat_antar_status_idx ON sdl_surat_antar(status, submitted_at);
CREATE UNIQUE INDEX sdl_surat_antar_urmin_idx ON sdl_surat_antar(urmin_registry_id) WHERE urmin_registry_id IS NOT NULL;

CREATE TABLE sdl_surat_antar_tujuan (
 surat_id UUID NOT NULL REFERENCES sdl_surat_antar(id) ON DELETE CASCADE,
 unit_key VARCHAR(32) NOT NULL CHECK (unit_key IN ('urmin','subbagren','subbagsumda','subbagbinfung')),
 diterima_at TIMESTAMPTZ,
 diterima_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 PRIMARY KEY (surat_id, unit_key),
 CONSTRAINT sdl_surat_antar_terima_ck CHECK ((diterima_at IS NULL) = (diterima_by IS NULL))
);
CREATE INDEX sdl_surat_antar_tujuan_unit_idx ON sdl_surat_antar_tujuan(unit_key, diterima_at);

CREATE TABLE sdl_surat_antar_berkas (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 surat_id UUID NOT NULL REFERENCES sdl_surat_antar(id) ON DELETE CASCADE,
 peran VARCHAR(12) NOT NULL CHECK (peran IN ('naskah','lampiran','naskah_ttd')),
 jenis VARCHAR(4) NOT NULL CHECK (jenis IN ('pdf','xlsx','docx')),
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_surat_antar_naskah_pdf_ck CHECK (peran = 'lampiran' OR jenis = 'pdf')
);
CREATE INDEX sdl_surat_antar_berkas_idx ON sdl_surat_antar_berkas(surat_id, peran, uploaded_at);

-- Izin bersifat per unit lewat grant: role yang punya izin ini DI unit X
-- membaca/mengelola persuratan unit X. Kabagrenmin membaca semua dan menyetujui.
INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('persuratan.read', 'Lihat Surat Masuk dan Surat Keluar antar-unit di unit sendiri'),
 ('persuratan.manage', 'Buat, ajukan, dan kirim Surat Keluar; tandai Surat Masuk diterima'),
 ('persuratan.approve', 'Setujui atau tolak Surat Keluar antar-unit (Kabagrenmin)')
ON CONFLICT (permission_key) DO NOTHING;

-- Diberikan ke role BagRenmin yang SUDAH ADA. Pada database baru role belum ada
-- saat migrasi berjalan; seed-bagrenmin (Go dan Express) membawa izin yang sama.
INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key
  FROM sdl_roles r
  JOIN (VALUES
    ('br_op_urmin', 'persuratan.read'), ('br_op_urmin', 'persuratan.manage'),
    ('br_staf_urmin', 'persuratan.read'), ('br_staf_urmin', 'persuratan.manage'),
    ('br_ka_urmin', 'persuratan.read'), ('br_ka_urmin', 'persuratan.manage'),
    ('br_op_subbagren', 'persuratan.read'), ('br_op_subbagren', 'persuratan.manage'),
    ('br_staf_subbagren', 'persuratan.read'), ('br_staf_subbagren', 'persuratan.manage'),
    ('br_kasubbagren', 'persuratan.read'), ('br_kasubbagren', 'persuratan.manage'),
    ('br_op_subbagsumda', 'persuratan.read'), ('br_op_subbagsumda', 'persuratan.manage'),
    ('br_staf_subbagsumda', 'persuratan.read'), ('br_staf_subbagsumda', 'persuratan.manage'),
    ('br_kasubbagsumda', 'persuratan.read'), ('br_kasubbagsumda', 'persuratan.manage'),
    ('br_op_subbagbinfung', 'persuratan.read'), ('br_op_subbagbinfung', 'persuratan.manage'),
    ('br_staf_subbagbinfung', 'persuratan.read'), ('br_staf_subbagbinfung', 'persuratan.manage'),
    ('br_kasubbagbinfung', 'persuratan.read'), ('br_kasubbagbinfung', 'persuratan.manage'),
    ('br_kabagrenmin', 'persuratan.read'), ('br_kabagrenmin', 'persuratan.approve')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;
