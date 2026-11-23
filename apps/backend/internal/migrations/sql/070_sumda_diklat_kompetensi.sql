-- R5H29 (2026-11-23): Subbagsumda Diklat & Kompetensi.
-- Dokumen: docs/R5H29-SUMDA-DIKLAT-KOMPETENSI.md. Dilayani Express saja.
--
-- Hak lewat permission pada grant unit 'subbagsumda' (pola 068/069); scope TIDAK menyaring baris (K5/K19).
-- Sengaja tanpa FK ke registry (harness seed-docs mengosongkannya dengan TRUNCATE CASCADE).
-- Tahap alert kompetensi dihitung saat dibaca menurut Asia/Jakarta, tidak disimpan.

CREATE TABLE sdl_sumda_diklat (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 nama VARCHAR(200) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 200),
 jenis VARCHAR(20) NOT NULL CHECK (jenis IN ('Pendidikan','Pelatihan','Kursus','Seminar/Lokakarya','Sertifikasi','Lainnya')),
 penyelenggara VARCHAR(200) NOT NULL DEFAULT '',
 lokasi VARCHAR(200) NOT NULL DEFAULT '',
 nomor_surat VARCHAR(100) NOT NULL DEFAULT '',
 tanggal_mulai DATE,
 tanggal_selesai DATE,
 status VARCHAR(10) NOT NULL DEFAULT 'Terjadwal' CHECK (status IN ('Terjadwal','Berjalan','Selesai','Dibatalkan')),
 catatan VARCHAR(2000) NOT NULL DEFAULT '',
 -- Asal salinan registry pendidikan (K1). Sengaja tanpa FK.
 source_registry_id UUID UNIQUE,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ,
 -- Tanggal mulai wajib, kecuali baris salinan registry (K17).
 CONSTRAINT sdl_sumda_diklat_mulai CHECK (tanggal_mulai IS NOT NULL OR source_registry_id IS NOT NULL),
 CONSTRAINT sdl_sumda_diklat_rentang CHECK (tanggal_selesai IS NULL OR tanggal_mulai IS NULL OR tanggal_selesai >= tanggal_mulai),
 -- K8: Selesai wajib bertanggal selesai; salinan tanpa tanggal dikecualikan (K17).
 CONSTRAINT sdl_sumda_diklat_selesai CHECK (status <> 'Selesai' OR tanggal_selesai IS NOT NULL OR source_registry_id IS NOT NULL)
);
CREATE INDEX sdl_sumda_diklat_daftar_idx ON sdl_sumda_diklat(tanggal_mulai DESC, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX sdl_sumda_diklat_nama_idx ON sdl_sumda_diklat(lower(nama)) WHERE deleted_at IS NULL;

CREATE TABLE sdl_sumda_diklat_peserta (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 diklat_id UUID NOT NULL REFERENCES sdl_sumda_diklat(id) ON DELETE RESTRICT,
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 hasil VARCHAR(12) NOT NULL DEFAULT 'Belum' CHECK (hasil IN ('Belum','Lulus','Tidak lulus','Tidak hadir')),
 nomor_sertifikat VARCHAR(100) NOT NULL DEFAULT '',
 keterangan VARCHAR(500) NOT NULL DEFAULT '',
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_diklat_peserta_uq UNIQUE (diklat_id, personel_id),
 -- Sasaran FK komposit kompetensi: kompetensi turunan pasti milik personel peserta itu (K24).
 CONSTRAINT sdl_sumda_diklat_peserta_personel_uq UNIQUE (id, personel_id)
);
CREATE INDEX sdl_sumda_diklat_peserta_personel_idx ON sdl_sumda_diklat_peserta(personel_id);

CREATE TABLE sdl_sumda_kompetensi (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 nama VARCHAR(200) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 200),
 kategori VARCHAR(24) NOT NULL CHECK (kategori IN ('Sertifikasi profesi','Kursus','Lisensi','Keahlian','Lainnya')),
 nomor VARCHAR(100) NOT NULL DEFAULT '',
 penerbit VARCHAR(200) NOT NULL DEFAULT '',
 tanggal_terbit DATE,
 berlaku_sampai DATE,
 dari_peserta_id UUID,
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ,
 CONSTRAINT sdl_sumda_kompetensi_masa CHECK (berlaku_sampai IS NULL OR tanggal_terbit IS NULL OR berlaku_sampai >= tanggal_terbit),
 CONSTRAINT sdl_sumda_kompetensi_dari_fk FOREIGN KEY (dari_peserta_id, personel_id)
   REFERENCES sdl_sumda_diklat_peserta(id, personel_id) ON DELETE RESTRICT
);
-- K24: satu kompetensi aktif per peserta.
CREATE UNIQUE INDEX sdl_sumda_kompetensi_dari_uq ON sdl_sumda_kompetensi(dari_peserta_id)
 WHERE dari_peserta_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX sdl_sumda_kompetensi_berlaku_idx ON sdl_sumda_kompetensi(berlaku_sampai) WHERE deleted_at IS NULL;
CREATE INDEX sdl_sumda_kompetensi_personel_idx ON sdl_sumda_kompetensi(personel_id) WHERE deleted_at IS NULL;

-- Lampiran PDF tersegel (K4/K15, pola 069): tepat satu pemilik. RESTRICT, bukan CASCADE:
-- bug apa pun gagal keras alih-alih diam-diam menghapus berkas tersegel.
CREATE TABLE sdl_sumda_diklat_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 diklat_id UUID REFERENCES sdl_sumda_diklat(id) ON DELETE RESTRICT,
 peserta_id UUID REFERENCES sdl_sumda_diklat_peserta(id) ON DELETE RESTRICT,
 kompetensi_id UUID REFERENCES sdl_sumda_kompetensi(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_diklat_lampiran_pemilik CHECK (num_nonnulls(diklat_id, peserta_id, kompetensi_id) = 1)
);
CREATE INDEX sdl_sumda_diklat_lampiran_diklat_idx ON sdl_sumda_diklat_lampiran(diklat_id, uploaded_at) WHERE diklat_id IS NOT NULL;
CREATE INDEX sdl_sumda_diklat_lampiran_peserta_idx ON sdl_sumda_diklat_lampiran(peserta_id, uploaded_at) WHERE peserta_id IS NOT NULL;
CREATE INDEX sdl_sumda_diklat_lampiran_kompetensi_idx ON sdl_sumda_diklat_lampiran(kompetensi_id, uploaded_at) WHERE kompetensi_id IS NOT NULL;

CREATE TABLE sdl_sumda_diklat_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 diklat_id UUID NOT NULL REFERENCES sdl_sumda_diklat(id) ON DELETE CASCADE,
 dari VARCHAR(10) CHECK (dari IN ('Terjadwal','Berjalan','Selesai','Dibatalkan')),
 ke VARCHAR(10) NOT NULL CHECK (ke IN ('Terjadwal','Berjalan','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_diklat_riwayat_idx ON sdl_sumda_diklat_riwayat(diklat_id, id);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.diklat.manage', 'Catat dan kelola kegiatan diklat, peserta, dan kompetensi Subbagsumda'),
 ('subbagsumda.diklat.archive', 'Arsipkan kegiatan diklat dan kompetensi Subbagsumda')
ON CONFLICT (permission_key) DO NOTHING;

-- Diberikan ke role BagRenmin yang SUDAH ADA; pada database baru seed-bagrenmin
-- (Go dan Express) membawa permission yang sama.
INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key
  FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda', 'subbagsumda.diklat.manage'),
    ('br_staf_subbagsumda', 'subbagsumda.diklat.manage'),
    ('br_kasubbagsumda', 'subbagsumda.diklat.manage'),
    ('br_kasubbagsumda', 'subbagsumda.diklat.archive')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- Salinan sekali K1/K17/K34 dari registry pendidikan yang aktif (termasuk 'penting', preseden 068).
-- "Hari ini" menurut Asia/Jakarta. Registry menerima tahun 0000-9999, jadi tanggal hanya di-cast bila
-- tahunnya 1900-2099; selebihnya NULL dan teks aslinya masuk catatan.
WITH hari AS (
  SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date AS d
), src AS (
  SELECT s.id, btrim(s.ref_code) AS kode, left(btrim(s.title), 200) AS nama,
         btrim(coalesce(s.fields->>'jenis', '')) AS jenis_lama,
         left(btrim(coalesce(s.fields->>'penyelenggara', '')), 200) AS penyelenggara,
         nullif(btrim(coalesce(s.fields->>'tanggalMulai', '')), '') AS mulai_teks,
         nullif(btrim(coalesce(s.fields->>'tanggalSelesai', '')), '') AS selesai_teks,
         btrim(coalesce(s.fields->>'peserta', '')) AS peserta,
         btrim(coalesce(s.fields->>'hasil', '')) AS hasil,
         s.created_by, s.updated_by, s.created_at
    FROM sdl_sumda_registry s
    JOIN sdl_unit_work_records w ON w.id = s.work_record_id
   WHERE s.kind = 'pendidikan' AND s.deleted_at IS NULL
     AND w.deleted_at IS NULL AND w.unit_key = 'subbagsumda'
), tgl AS (
  SELECT src.*,
         CASE WHEN mulai_teks ~ '^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN mulai_teks::date END AS mulai,
         CASE WHEN selesai_teks ~ '^(19|20)[0-9]{2}-[0-9]{2}-[0-9]{2}$' THEN selesai_teks::date END AS selesai0
    FROM src
), norm AS (
  SELECT tgl.*, CASE WHEN tgl.selesai0 < tgl.mulai THEN NULL ELSE tgl.selesai0 END AS selesai, j.nama AS jenis
    FROM tgl
    LEFT JOIN (VALUES ('Pendidikan'), ('Pelatihan'), ('Kursus'), ('Seminar/Lokakarya'), ('Sertifikasi'), ('Lainnya')) AS j(nama)
      ON lower(j.nama) = lower(tgl.jenis_lama)
), ins AS (
  INSERT INTO sdl_sumda_diklat(nama, jenis, penyelenggara, tanggal_mulai, tanggal_selesai, status, catatan,
                               source_registry_id, created_by, updated_by, created_at)
  SELECT n.nama, coalesce(n.jenis, 'Lainnya'), n.penyelenggara, n.mulai, n.selesai,
         CASE WHEN n.mulai IS NULL AND n.selesai IS NULL THEN 'Selesai'
              WHEN n.selesai < h.d THEN 'Selesai'
              WHEN n.mulai > h.d THEN 'Terjadwal'
              ELSE 'Berjalan' END,
         left(concat_ws(E'\n',
              'Kode lama: ' || n.kode,
              CASE WHEN n.jenis IS NULL AND n.jenis_lama <> '' THEN 'Jenis lama: ' || n.jenis_lama END,
              CASE WHEN n.mulai_teks IS NULL AND n.selesai_teks IS NULL THEN 'Tanggal lama tidak tercatat' END,
              CASE WHEN (n.mulai_teks IS NOT NULL AND n.mulai IS NULL) OR (n.selesai_teks IS NOT NULL AND n.selesai IS NULL)
                   THEN 'Tanggal lama: ' || concat_ws(' s.d. ', n.mulai_teks, n.selesai_teks) END,
              CASE WHEN n.peserta <> '' THEN 'Peserta (catatan lama): ' || n.peserta END,
              CASE WHEN n.hasil <> '' THEN 'Hasil (catatan lama): ' || n.hasil END), 2000),
         n.id, n.created_by, n.updated_by, n.created_at
    FROM norm n CROSS JOIN hari h
  ON CONFLICT DO NOTHING
  RETURNING id, status, created_by
), rw AS (
  INSERT INTO sdl_sumda_diklat_riwayat(diklat_id, dari, ke, catatan, oleh)
  SELECT id, NULL, status, 'Disalin dari registry lama', created_by FROM ins
  RETURNING 1
)
INSERT INTO sdl_audit_events(actor_id, event_key, subject_type, subject_id, metadata)
SELECT NULL, 'subbagsumda.diklat.salin_registry', 'subbagsumda.diklat', '070',
       jsonb_build_object('sumber', (SELECT count(*) FROM src), 'disalin', (SELECT count(*) FROM ins),
                          'riwayat', (SELECT count(*) FROM rw))
 WHERE (SELECT count(*) FROM src) > 0;
