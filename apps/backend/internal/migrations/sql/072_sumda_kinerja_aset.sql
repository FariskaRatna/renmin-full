-- R5H31 (2026-11-24): Subbagsumda Kinerja & Pembinaan + Inventaris & BMN.
-- Dokumen: docs/R5H31-SUMDA-KINERJA-INVENTARIS.md. Dilayani Express saja.
--
-- Hak akses lewat permission pada grant unit 'subbagsumda' (pola 068-071); scope TIDAK menyaring baris (K24/K25).
-- Prinsip K43 R5H30: hanya aturan STRUKTURAL. Satu penilaian per periode (K8), tindak lanjut minimal, lampiran
-- wajib saat Dihapus, dan peta status ditegakkan di Express dengan kunci baris.
-- Pengecualian: indeks unik kode BMN (identitas barang, K17/K43 R5H31).
-- Sengaja tanpa FK ke tabel yang dikosongkan harness seed-docs (TRUNCATE CASCADE), termasuk sdl_sumda_registry.

CREATE TABLE sdl_sumda_kinerja (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 tahun SMALLINT NOT NULL CHECK (tahun BETWEEN 2000 AND 2100),
 periode VARCHAR(12) NOT NULL CHECK (periode IN ('SEMESTER_I','SEMESTER_II','TAHUNAN')),
 kategori VARCHAR(16) NOT NULL CHECK (kategori IN ('BAIK_SEKALI','BAIK','CUKUP','PERLU_PEMBINAAN')),
 penilai VARCHAR(200) NOT NULL DEFAULT '',
 tanggal_penilaian DATE,
 catatan VARCHAR(2000) NOT NULL DEFAULT '',
 status VARCHAR(12) NOT NULL DEFAULT 'Draft'
   CHECK (status IN ('Draft','Diajukan','Disetujui','Selesai','Dibatalkan')),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_at TIMESTAMPTZ,
 selesai_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 selesai_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 -- Maker-checker (K2) juga ditegakkan database: pemutus bukan pencatat.
 CONSTRAINT sdl_sumda_kinerja_pemutus CHECK ((decided_by IS NULL) = (decided_at IS NULL)
   AND (decided_by IS NULL OR decided_by <> created_by)),
 CONSTRAINT sdl_sumda_kinerja_diputus CHECK (status NOT IN ('Disetujui','Selesai') OR decided_by IS NOT NULL),
 CONSTRAINT sdl_sumda_kinerja_selesai CHECK (status <> 'Selesai' OR (selesai_by IS NOT NULL AND selesai_at IS NOT NULL))
);
CREATE INDEX sdl_sumda_kinerja_personel_idx ON sdl_sumda_kinerja(personel_id, tahun, periode) WHERE status <> 'Dibatalkan';
CREATE INDEX sdl_sumda_kinerja_daftar_idx ON sdl_sumda_kinerja(tahun DESC, periode, status);

-- Tindak lanjut pembinaan (K11/K35). Tenggat wajib di Express (K38), bukan di database.
CREATE TABLE sdl_sumda_kinerja_tindak_lanjut (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kinerja_id UUID NOT NULL REFERENCES sdl_sumda_kinerja(id) ON DELETE RESTRICT,
 bentuk VARCHAR(16) NOT NULL CHECK (bentuk IN ('KONSELING','PELATIHAN','PENDAMPINGAN','TEGURAN','LAINNYA')),
 uraian VARCHAR(1000) NOT NULL,
 tenggat DATE,
 status VARCHAR(12) NOT NULL DEFAULT 'Rencana' CHECK (status IN ('Rencana','Berjalan','Selesai','Dibatalkan')),
 hasil VARCHAR(1000) NOT NULL DEFAULT '',
 selesai_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_kinerja_tl_selesai CHECK (status <> 'Selesai' OR selesai_at IS NOT NULL)
);
CREATE INDEX sdl_sumda_kinerja_tl_idx ON sdl_sumda_kinerja_tindak_lanjut(kinerja_id, created_at);
CREATE INDEX sdl_sumda_kinerja_tl_tenggat_idx ON sdl_sumda_kinerja_tindak_lanjut(tenggat) WHERE status IN ('Rencana','Berjalan');

CREATE TABLE sdl_sumda_kinerja_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 kinerja_id UUID NOT NULL REFERENCES sdl_sumda_kinerja(id) ON DELETE CASCADE,
 dari VARCHAR(12) CHECK (dari IN ('Draft','Diajukan','Disetujui','Selesai','Dibatalkan')),
 ke VARCHAR(12) NOT NULL CHECK (ke IN ('Draft','Diajukan','Disetujui','Selesai','Dibatalkan')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_kinerja_riwayat_idx ON sdl_sumda_kinerja_riwayat(kinerja_id, id);

CREATE TABLE sdl_sumda_kinerja_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kinerja_id UUID NOT NULL REFERENCES sdl_sumda_kinerja(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_kinerja_lampiran_idx ON sdl_sumda_kinerja_lampiran(kinerja_id, uploaded_at);

CREATE TABLE sdl_sumda_aset (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kode_bmn VARCHAR(64) NOT NULL CHECK (length(btrim(kode_bmn)) BETWEEN 2 AND 64),
 nama VARCHAR(200) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 200),
 kategori VARCHAR(20) NOT NULL
   CHECK (kategori IN ('Komputer','Perangkat Jaringan','Perabot','Elektronik','Kendaraan','Lainnya')),
 merek_tipe VARCHAR(200) NOT NULL DEFAULT '',
 tahun_perolehan SMALLINT CHECK (tahun_perolehan BETWEEN 1900 AND 2100),
 jumlah INTEGER NOT NULL CHECK (jumlah >= 1),
 satuan VARCHAR(32) NOT NULL DEFAULT '',
 lokasi VARCHAR(200) NOT NULL DEFAULT '',
 kondisi VARCHAR(20) NOT NULL CHECK (kondisi IN ('Baik','Perlu Pemeriksaan','Rusak Ringan','Rusak Berat')),
 penanggung_jawab_id UUID REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 penanggung_jawab_teks VARCHAR(200) NOT NULL DEFAULT '',
 jadwal_pemeliharaan DATE,
 status VARCHAR(20) NOT NULL DEFAULT 'Aktif'
   CHECK (status IN ('Aktif','Pemeliharaan','Usulan Penghapusan','Dihapus')),
 status_sebelum VARCHAR(12) CHECK (status_sebelum IN ('Aktif','Pemeliharaan')),
 usulan_alasan VARCHAR(1000) NOT NULL DEFAULT '',
 usulan_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 usulan_at TIMESTAMPTZ,
 decided_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decided_at TIMESTAMPTZ,
 catatan VARCHAR(2000) NOT NULL DEFAULT '',
 source_registry_id UUID UNIQUE,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_aset_pj CHECK (penanggung_jawab_id IS NULL OR penanggung_jawab_teks = ''),
 CONSTRAINT sdl_sumda_aset_usulan CHECK (status NOT IN ('Usulan Penghapusan','Dihapus')
   OR (status_sebelum IS NOT NULL AND usulan_by IS NOT NULL AND usulan_at IS NOT NULL)),
 -- Maker-checker (K4): pemutus bukan pengusul. Aset berumur panjang, jadi pembandingnya usulan_by, bukan created_by.
 CONSTRAINT sdl_sumda_aset_pemutus CHECK ((decided_by IS NULL) = (decided_at IS NULL)
   AND (decided_by IS NULL OR decided_by <> usulan_by)),
 CONSTRAINT sdl_sumda_aset_dihapus CHECK ((status = 'Dihapus') = (decided_by IS NOT NULL))
);
-- K17: identitas BMN unik tanpa peka huruf di antara aset yang belum Dihapus (struktural).
CREATE UNIQUE INDEX sdl_sumda_aset_kode_uq ON sdl_sumda_aset(lower(kode_bmn)) WHERE status <> 'Dihapus';
CREATE INDEX sdl_sumda_aset_daftar_idx ON sdl_sumda_aset(status, kategori, lower(nama));
CREATE INDEX sdl_sumda_aset_jadwal_idx ON sdl_sumda_aset(jadwal_pemeliharaan) WHERE status IN ('Aktif','Pemeliharaan');
CREATE INDEX sdl_sumda_aset_pj_idx ON sdl_sumda_aset(penanggung_jawab_id) WHERE penanggung_jawab_id IS NOT NULL;

-- Riwayat pemeliharaan (K19): append-only oleh aplikasi; salah catat -> entri koreksi.
CREATE TABLE sdl_sumda_aset_pemeliharaan (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 aset_id UUID NOT NULL REFERENCES sdl_sumda_aset(id) ON DELETE RESTRICT,
 tanggal DATE NOT NULL,
 jenis VARCHAR(12) NOT NULL CHECK (jenis IN ('RUTIN','PERBAIKAN','PEMERIKSAAN')),
 uraian VARCHAR(1000) NOT NULL,
 pelaksana VARCHAR(200) NOT NULL DEFAULT '',
 kondisi VARCHAR(20) NOT NULL CHECK (kondisi IN ('Baik','Perlu Pemeriksaan','Rusak Ringan','Rusak Berat')),
 jadwal_berikutnya DATE,
 koreksi_dari UUID,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_sumda_aset_pemeliharaan_aset_uq UNIQUE (id, aset_id),
 -- Entri koreksi hanya boleh merujuk entri aset yang sama (pola FK komposit 070).
 CONSTRAINT sdl_sumda_aset_pemeliharaan_koreksi_fk FOREIGN KEY (koreksi_dari, aset_id)
   REFERENCES sdl_sumda_aset_pemeliharaan(id, aset_id) ON DELETE RESTRICT
);
CREATE INDEX sdl_sumda_aset_pemeliharaan_idx ON sdl_sumda_aset_pemeliharaan(aset_id, tanggal DESC, created_at DESC);

CREATE TABLE sdl_sumda_aset_riwayat (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 aset_id UUID NOT NULL REFERENCES sdl_sumda_aset(id) ON DELETE CASCADE,
 dari VARCHAR(20) CHECK (dari IN ('Aktif','Pemeliharaan','Usulan Penghapusan','Dihapus')),
 ke VARCHAR(20) NOT NULL CHECK (ke IN ('Aktif','Pemeliharaan','Usulan Penghapusan','Dihapus')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 oleh UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 pada TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_aset_riwayat_idx ON sdl_sumda_aset_riwayat(aset_id, id);

CREATE TABLE sdl_sumda_aset_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 aset_id UUID NOT NULL REFERENCES sdl_sumda_aset(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK (substring(body FROM 1 FOR 4) = decode('53444c31', 'hex')),
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_sumda_aset_lampiran_idx ON sdl_sumda_aset_lampiran(aset_id, uploaded_at);

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.kinerja.read', 'Lihat isi penilaian kinerja dan pembinaan personel Subbagsumda'),
 ('subbagsumda.kinerja.manage', 'Catat penilaian kinerja dan tindak lanjut pembinaan Subbagsumda'),
 ('subbagsumda.kinerja.approve', 'Setujui atau kembalikan penilaian kinerja Subbagsumda'),
 ('subbagsumda.aset.manage', 'Catat dan kelola inventaris dan BMN Subbagsumda'),
 ('subbagsumda.aset.approve', 'Putuskan usulan penghapusan BMN Subbagsumda')
ON CONFLICT (permission_key) DO NOTHING;

-- Diberikan ke role BagRenmin yang SUDAH ADA. Pada database baru role belum
-- ada saat migrasi berjalan; seed-bagrenmin (Go dan Express) membawa
-- permission yang sama.
INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key
  FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda', 'subbagsumda.kinerja.manage'),
    ('br_staf_subbagsumda', 'subbagsumda.kinerja.manage'),
    ('br_kasubbagsumda', 'subbagsumda.kinerja.manage'),
    ('br_kasubbagsumda', 'subbagsumda.kinerja.approve'),
    ('br_kasubbagsumda', 'subbagsumda.kinerja.read'),
    ('br_kabagrenmin', 'subbagsumda.kinerja.read'),
    ('br_op_subbagsumda', 'subbagsumda.aset.manage'),
    ('br_staf_subbagsumda', 'subbagsumda.aset.manage'),
    ('br_kasubbagsumda', 'subbagsumda.aset.manage'),
    ('br_kasubbagsumda', 'subbagsumda.aset.approve')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- Salinan sekali K21/K44 dari registry inventaris yang aktif (termasuk 'penting', preseden 068/070).
-- Tidak ada cast yang bisa gagal: jumlah hanya di-cast bila cocok 1-9 digit tanpa nol depan.
-- Kode ganda setelah btrim diberi akhiran ~n. ON CONFLICT hanya pada source_registry_id.
WITH src AS (
  SELECT s.id, s.ref_code, btrim(s.ref_code) AS kode0, left(btrim(s.title), 200) AS nama,
         btrim(coalesce(s.fields->>'kategori', '')) AS kategori_lama,
         btrim(coalesce(s.fields->>'kondisi', '')) AS kondisi_lama,
         left(btrim(coalesce(s.fields->>'lokasi', '')), 200) AS lokasi,
         btrim(coalesce(s.fields->>'jumlah', '')) AS jumlah_lama,
         left(btrim(coalesce(s.fields->>'penanggungJawab', '')), 200) AS pj,
         btrim(coalesce(s.fields->>'keterangan', '')) AS keterangan,
         s.created_by, s.updated_by, s.created_at,
         row_number() OVER (PARTITION BY lower(btrim(s.ref_code)) ORDER BY s.created_at, s.id) AS rn
    FROM sdl_sumda_registry s
    JOIN sdl_unit_work_records w ON w.id = s.work_record_id
   WHERE s.kind = 'inventaris' AND s.deleted_at IS NULL
     AND w.deleted_at IS NULL AND w.unit_key = 'subbagsumda'
), norm AS (
  SELECT src.*, k.nama AS kategori, d.nama AS kondisi,
         CASE WHEN src.jumlah_lama ~ '^[1-9][0-9]{0,8}$' THEN src.jumlah_lama::int END AS jumlah,
         CASE WHEN src.rn = 1 THEN src.kode0 ELSE left(src.kode0, 60) || '~' || src.rn END AS kode
    FROM src
    LEFT JOIN (VALUES ('Komputer'), ('Perangkat Jaringan'), ('Perabot'), ('Elektronik'), ('Kendaraan'), ('Lainnya')) AS k(nama)
      ON lower(k.nama) = lower(src.kategori_lama)
    LEFT JOIN (VALUES ('Baik'), ('Perlu Pemeriksaan'), ('Rusak Ringan'), ('Rusak Berat')) AS d(nama)
      ON lower(d.nama) = lower(src.kondisi_lama)
), ins AS (
  INSERT INTO sdl_sumda_aset(kode_bmn, nama, kategori, jumlah, satuan, lokasi, kondisi, penanggung_jawab_teks,
                             status, catatan, source_registry_id, created_by, updated_by, created_at)
  SELECT n.kode, n.nama, coalesce(n.kategori, 'Lainnya'), coalesce(n.jumlah, 1), 'unit', n.lokasi,
         coalesce(n.kondisi, 'Perlu Pemeriksaan'), n.pj, 'Aktif',
         left(concat_ws(E'\n',
              nullif(n.keterangan, ''),
              CASE WHEN n.rn > 1 THEN 'Kode lama ganda: ' || n.ref_code END,
              CASE WHEN n.kategori IS NULL AND n.kategori_lama <> '' THEN 'Kategori lama: ' || n.kategori_lama END,
              CASE WHEN n.kondisi IS NULL THEN CASE WHEN n.kondisi_lama = '' THEN 'Kondisi lama tidak tercatat'
                                                    ELSE 'Kondisi lama: ' || n.kondisi_lama END END,
              CASE WHEN n.jumlah IS NULL THEN CASE WHEN n.jumlah_lama = '' THEN 'Jumlah lama tidak tercatat'
                                                   ELSE 'Jumlah lama: ' || n.jumlah_lama END END), 2000),
         n.id, n.created_by, n.updated_by, n.created_at
    FROM norm n
  ON CONFLICT (source_registry_id) DO NOTHING
  RETURNING id, created_by
), rw AS (
  INSERT INTO sdl_sumda_aset_riwayat(aset_id, dari, ke, catatan, oleh)
  SELECT id, NULL, 'Aktif', 'Disalin dari registry lama', created_by FROM ins
  RETURNING 1
)
INSERT INTO sdl_audit_events(actor_id, event_key, subject_type, subject_id, metadata)
SELECT NULL, 'subbagsumda.aset.salin_registry', 'subbagsumda.aset', '072',
       jsonb_build_object('sumber', (SELECT count(*) FROM src), 'disalin', (SELECT count(*) FROM ins),
                          'riwayat', (SELECT count(*) FROM rw))
 WHERE (SELECT count(*) FROM src) > 0;
