-- R5H30 (2026-11-24): Subbagsumda Cuti & Perizinan + Kesejahteraan.
-- Dokumen: docs/R5H30-SUMDA-CUTI-KESEJAHTERAAN.md. Dilayani Express saja.
--
-- Hak akses lewat permission pada grant unit 'subbagsumda' (pola 068/069);
-- scope grant TIDAK menyaring baris (K6). Baca memakai subbagsumda.personel.read.
-- K43: alur bisnis masih bisa berubah setelah dipaparkan ke pengguna, jadi migrasi ini
-- hanya memuat aturan STRUKTURAL. Aturan bisnis (Tahunan tidak lintas tahun, batas rentang,
-- jumlah hari maksimum, satu layanan terbuka per jenis, cuti bertumpuk) ditegakkan di Express
-- secara transaksional dengan kunci baris personel, supaya bisa diubah tanpa migrasi baru.
-- Sengaja tanpa FK ke tabel yang dikosongkan harness seed-docs (TRUNCATE CASCADE).

CREATE TABLE sdl_sumda_cuti (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 jenis VARCHAR(16) NOT NULL CHECK (jenis IN ('TAHUNAN','SAKIT','ALASAN_PENTING','BESAR','LAINNYA')),
 tanggal_mulai DATE NOT NULL,
 tanggal_selesai DATE NOT NULL,
 -- Hari terakhir cuti yang benar-benar dijalani, diisi saat Selesai (K31).
 tanggal_kembali DATE,
 jumlah_hari INTEGER NOT NULL CHECK (jumlah_hari >= 1),
 hari_disesuaikan BOOLEAN NOT NULL DEFAULT FALSE,
 status VARCHAR(12) NOT NULL DEFAULT 'Diajukan'
   CHECK (status IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_at TIMESTAMPTZ,
 selesai_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 selesai_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_cuti_rentang CHECK (tanggal_selesai >= tanggal_mulai),
 CONSTRAINT sdl_sumda_cuti_kembali CHECK (tanggal_kembali IS NULL
   OR tanggal_kembali BETWEEN tanggal_mulai AND tanggal_selesai),
 -- Maker-checker (K1) juga ditegakkan database: pemutus bukan pencatat.
 CONSTRAINT sdl_sumda_cuti_pemutus CHECK ((decided_by IS NULL) = (decided_at IS NULL)
   AND (decided_by IS NULL OR decided_by <> created_by)),
 CONSTRAINT sdl_sumda_cuti_diputus CHECK (status NOT IN ('Disetujui','Ditolak','Selesai') OR decided_by IS NOT NULL),
 CONSTRAINT sdl_sumda_cuti_selesai CHECK (status <> 'Selesai' OR (selesai_by IS NOT NULL AND selesai_at IS NOT NULL))
);
CREATE INDEX sdl_sumda_cuti_personel_idx ON sdl_sumda_cuti(personel_id, tanggal_mulai);
CREATE INDEX sdl_sumda_cuti_kalender_idx ON sdl_sumda_cuti(tanggal_mulai, tanggal_selesai)
 WHERE status IN ('Diproses','Disetujui','Selesai');
CREATE INDEX sdl_sumda_cuti_status_idx ON sdl_sumda_cuti(status, created_at DESC);

-- Riwayat status untuk tampilan (append-only oleh aplikasi).
CREATE TABLE sdl_sumda_cuti_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cuti_id UUID NOT NULL REFERENCES sdl_sumda_cuti(id) ON DELETE CASCADE,
 dari VARCHAR(12) CHECK (dari IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 ke VARCHAR(12) NOT NULL CHECK (ke IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_cuti_riwayat_idx ON sdl_sumda_cuti_riwayat(cuti_id, id);

-- Lampiran PDF (K4): isi disegel AES-256-GCM (envelope SDL1); CHECK menolak plaintext.
-- RESTRICT: bug penghapusan gagal keras, tidak diam-diam membuang berkas tersegel.
CREATE TABLE sdl_sumda_cuti_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 cuti_id UUID NOT NULL REFERENCES sdl_sumda_cuti(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_cuti_lampiran_idx ON sdl_sumda_cuti_lampiran(cuti_id, uploaded_at);

CREATE TABLE sdl_sumda_kesejahteraan (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 jenis VARCHAR(20) NOT NULL CHECK (jenis IN ('PERSIAPAN_PENSIUN','MPP','ASABRI','KARTU_IDENTITAS','LAINNYA')),
 nomor_referensi VARCHAR(100) NOT NULL DEFAULT '',
 target_selesai DATE,
 status VARCHAR(12) NOT NULL DEFAULT 'Diajukan'
   CHECK (status IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 -- Status personel lama -> baru yang diterapkan saat Selesai (K3); '{}' bila tidak diterapkan.
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
 CONSTRAINT sdl_sumda_kesejahteraan_pemutus CHECK ((decided_by IS NULL) = (decided_at IS NULL)
   AND (decided_by IS NULL OR decided_by <> created_by)),
 CONSTRAINT sdl_sumda_kesejahteraan_diputus CHECK (status NOT IN ('Disetujui','Ditolak','Selesai') OR decided_by IS NOT NULL),
 CONSTRAINT sdl_sumda_kesejahteraan_selesai CHECK (status <> 'Selesai'
   OR (diterapkan IS NOT NULL AND selesai_by IS NOT NULL AND selesai_at IS NOT NULL))
);
CREATE INDEX sdl_sumda_kesejahteraan_personel_idx ON sdl_sumda_kesejahteraan(personel_id, created_at DESC);
CREATE INDEX sdl_sumda_kesejahteraan_status_idx ON sdl_sumda_kesejahteraan(status, created_at DESC);
CREATE INDEX sdl_sumda_kesejahteraan_target_idx ON sdl_sumda_kesejahteraan(target_selesai)
 WHERE status IN ('Diajukan','Diproses','Disetujui');

CREATE TABLE sdl_sumda_kesejahteraan_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kesejahteraan_id UUID NOT NULL REFERENCES sdl_sumda_kesejahteraan(id) ON DELETE CASCADE,
 dari VARCHAR(12) CHECK (dari IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 ke VARCHAR(12) NOT NULL CHECK (ke IN ('Diajukan','Diproses','Disetujui','Ditolak','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_kesejahteraan_riwayat_idx ON sdl_sumda_kesejahteraan_riwayat(kesejahteraan_id, id);

CREATE TABLE sdl_sumda_kesejahteraan_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kesejahteraan_id UUID NOT NULL REFERENCES sdl_sumda_kesejahteraan(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_kesejahteraan_lampiran_idx ON sdl_sumda_kesejahteraan_lampiran(kesejahteraan_id, uploaded_at);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.cuti.manage', 'Catat dan kelola cuti dan perizinan personel Subbagsumda'),
 ('subbagsumda.cuti.approve', 'Setujui atau tolak cuti dan perizinan personel Subbagsumda'),
 ('subbagsumda.kesejahteraan.manage', 'Catat dan kelola layanan kesejahteraan dan pensiun Subbagsumda'),
 ('subbagsumda.kesejahteraan.approve', 'Setujui atau tolak layanan kesejahteraan dan pensiun Subbagsumda')
ON CONFLICT (permission_key) DO NOTHING;

-- Diberikan ke role BagRenmin yang SUDAH ADA. Pada database baru role belum
-- ada saat migrasi berjalan; seed-bagrenmin (Go dan Express) membawa
-- permission yang sama.
INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key
  FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda', 'subbagsumda.cuti.manage'),
    ('br_staf_subbagsumda', 'subbagsumda.cuti.manage'),
    ('br_kasubbagsumda', 'subbagsumda.cuti.manage'),
    ('br_kasubbagsumda', 'subbagsumda.cuti.approve'),
    ('br_op_subbagsumda', 'subbagsumda.kesejahteraan.manage'),
    ('br_staf_subbagsumda', 'subbagsumda.kesejahteraan.manage'),
    ('br_kasubbagsumda', 'subbagsumda.kesejahteraan.manage'),
    ('br_kasubbagsumda', 'subbagsumda.kesejahteraan.approve')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;
