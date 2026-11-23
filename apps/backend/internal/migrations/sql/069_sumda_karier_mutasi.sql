-- R5H28 (2026-11-23): Subbagsumda Karier & Mutasi.
-- Dokumen: docs/R5H28-SUMDA-KARIER-MUTASI.md. Dilayani Express saja.
--
-- Hak akses lewat permission pada grant unit 'subbagsumda' (pola 068);
-- scope grant TIDAK menyaring baris (K5). Baca memakai subbagsumda.personel.read.
-- Sengaja tanpa FK ke tabel yang dikosongkan harness seed-docs (TRUNCATE CASCADE).

CREATE TABLE sdl_sumda_karier (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 jenis VARCHAR(20) NOT NULL CHECK (jenis IN ('UKP','KGB','MUTASI','PENYESUAIAN_JABATAN')),
 nomor_referensi VARCHAR(100) NOT NULL DEFAULT '',
 tanggal_usulan DATE NOT NULL,
 tanggal_efektif DATE,
 usulan_pangkat VARCHAR(200) NOT NULL DEFAULT '',
 usulan_jabatan VARCHAR(200) NOT NULL DEFAULT '',
 usulan_unit_kerja VARCHAR(200) NOT NULL DEFAULT '',
 status VARCHAR(12) NOT NULL DEFAULT 'Diajukan'
   CHECK (status IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 -- Nilai lama -> baru yang diterapkan ke Master Personel saat Selesai (K21).
 diterapkan JSONB,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_at TIMESTAMPTZ,
 selesai_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 selesai_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 -- KGB tidak mengubah Master Personel (K2), jadi tidak membawa nilai usulan.
 CONSTRAINT sdl_sumda_karier_kgb CHECK (jenis <> 'KGB' OR (usulan_pangkat = '' AND usulan_jabatan = '' AND usulan_unit_kerja = '')),
 -- Maker-checker (K3/K9) juga ditegakkan database: pemutus bukan pencatat.
 CONSTRAINT sdl_sumda_karier_pemutus CHECK ((decided_by IS NULL) = (decided_at IS NULL)
   AND (decided_by IS NULL OR decided_by <> created_by)),
 CONSTRAINT sdl_sumda_karier_diputus CHECK (status NOT IN ('Disetujui','Ditolak','Selesai') OR decided_by IS NOT NULL),
 -- K10: Selesai wajib bertanggal efektif dan mencatat nilai yang diterapkan.
 CONSTRAINT sdl_sumda_karier_selesai CHECK (status <> 'Selesai' OR (tanggal_efektif IS NOT NULL
   AND diterapkan IS NOT NULL AND selesai_by IS NOT NULL AND selesai_at IS NOT NULL))
);
-- K11: satu pengajuan terbuka per personel per jenis.
CREATE UNIQUE INDEX sdl_sumda_karier_terbuka_uq ON sdl_sumda_karier(personel_id, jenis)
 WHERE status IN ('Diajukan','Diproses','Disetujui');
CREATE INDEX sdl_sumda_karier_personel_idx ON sdl_sumda_karier(personel_id, created_at DESC);
CREATE INDEX sdl_sumda_karier_status_idx ON sdl_sumda_karier(status, created_at DESC);

-- Riwayat status untuk tampilan (append-only oleh aplikasi).
CREATE TABLE sdl_sumda_karier_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 karier_id UUID NOT NULL REFERENCES sdl_sumda_karier(id) ON DELETE CASCADE,
 dari VARCHAR(12) CHECK (dari IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 ke VARCHAR(12) NOT NULL CHECK (ke IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_karier_riwayat_idx ON sdl_sumda_karier_riwayat(karier_id, id);

-- Lampiran PDF (K4, pola 063): isi disegel AES-256-GCM (envelope SDL1).
-- CHECK memastikan tidak ada plaintext yang tersimpan.
CREATE TABLE sdl_sumda_karier_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 karier_id UUID NOT NULL REFERENCES sdl_sumda_karier(id) ON DELETE CASCADE,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_karier_lampiran_idx ON sdl_sumda_karier_lampiran(karier_id, uploaded_at);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.karier.manage', 'Catat dan kelola pengajuan karier dan mutasi Subbagsumda'),
 ('subbagsumda.karier.approve', 'Setujui atau tolak pengajuan karier dan mutasi Subbagsumda')
ON CONFLICT (permission_key) DO NOTHING;

-- Diberikan ke role BagRenmin yang SUDAH ADA. Pada database baru role belum
-- ada saat migrasi berjalan; seed-bagrenmin (Go dan Express) membawa
-- permission yang sama.
INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key
  FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda', 'subbagsumda.karier.manage'),
    ('br_staf_subbagsumda', 'subbagsumda.karier.manage'),
    ('br_kasubbagsumda', 'subbagsumda.karier.manage'),
    ('br_kasubbagsumda', 'subbagsumda.karier.approve')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;
