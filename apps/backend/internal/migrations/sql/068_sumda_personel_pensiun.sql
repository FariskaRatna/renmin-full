-- R5H27 (2026-11-23): Subbagsumda Master Personel + Monitoring Pensiun.
-- Dokumen: docs/R5H27-SUMDA-PERSONEL-PENSIUN.md. Dilayani Express saja.
--
-- Hak akses lewat permission pada grant unit 'subbagsumda' (pola R5H11,
-- 049_progar_pagu.sql); scope grant TIDAK membatasi baris (keputusan K2).
-- Tahap pensiun (H-60/H-30/H-14/H-7/JATUH_TEMPO) dihitung saat dibaca dari
-- tanggal_pensiun dan tanggal hari ini menurut Asia/Jakarta, tidak disimpan.

CREATE TABLE sdl_sumda_personel (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 nrp VARCHAR(64) NOT NULL CHECK (length(btrim(nrp)) BETWEEN 2 AND 64),
 nama VARCHAR(200) NOT NULL CHECK (length(btrim(nama)) BETWEEN 3 AND 200),
 jenis VARCHAR(8) CHECK (jenis IN ('Polri','PNS')),
 pangkat VARCHAR(200) NOT NULL DEFAULT '',
 jabatan VARCHAR(200) NOT NULL DEFAULT '',
 unit_kerja VARCHAR(200) NOT NULL DEFAULT '',
 tmt_dinas DATE,
 tanggal_pensiun DATE,
 status VARCHAR(10) NOT NULL CHECK (status IN ('Aktif','MPP','Pensiun','Nonaktif')),
 catatan VARCHAR(1000) NOT NULL DEFAULT '',
 -- Asal salinan dari sdl_sumda_registry (keputusan K3). SENGAJA tanpa FK:
 -- harness seed-docs mengosongkan registry dengan TRUNCATE ... CASCADE, dan
 -- FK akan ikut mengosongkan Master Personel (risiko R1).
 source_registry_id UUID UNIQUE,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_at TIMESTAMPTZ,
 -- Jenis hanya boleh kosong pada baris hasil salinan (ditandai "lengkapi").
 CONSTRAINT sdl_sumda_personel_jenis_salinan CHECK (jenis IS NOT NULL OR source_registry_id IS NOT NULL)
);
CREATE UNIQUE INDEX sdl_sumda_personel_nrp_aktif_idx
 ON sdl_sumda_personel(lower(btrim(nrp))) WHERE deleted_at IS NULL;
CREATE INDEX sdl_sumda_personel_pensiun_idx ON sdl_sumda_personel(tanggal_pensiun)
 WHERE deleted_at IS NULL AND status IN ('Aktif','MPP');
CREATE INDEX sdl_sumda_personel_nama_idx ON sdl_sumda_personel(lower(nama)) WHERE deleted_at IS NULL;

-- "Tandai tinjau" bersama satu unit (K4). Kunci memuat tanggal_pensiun (K8):
-- bila tanggal dikoreksi, alert kembali belum ditinjau.
CREATE TABLE sdl_sumda_pensiun_tinjau (
 personel_id UUID NOT NULL REFERENCES sdl_sumda_personel(id) ON DELETE RESTRICT,
 tahap VARCHAR(12) NOT NULL CHECK (tahap IN ('H-60','H-30','H-14','H-7','JATUH_TEMPO')),
 tanggal_pensiun DATE NOT NULL,
 reviewed_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 reviewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (personel_id, tahap, tanggal_pensiun)
);

-- Aktivitas terakhir di dashboard membaca audit modul ini saja (K11).
CREATE INDEX sdl_audit_events_sumda_personel_idx ON sdl_audit_events(created_at DESC)
 WHERE subject_type = 'subbagsumda.personel';

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('subbagsumda.personel.archive', 'Arsipkan data Master Personel Subbagsumda'),
 ('subbagsumda.pensiun.review', 'Tandai alert pensiun Subbagsumda sudah ditinjau')
ON CONFLICT (permission_key) DO NOTHING;

-- Diberikan ke role BagRenmin yang SUDAH ADA. Pada database baru role belum
-- ada saat migrasi berjalan; seed-bagrenmin (Go dan Express) membawa
-- permission yang sama. Staf sudah memegang personel.read/create/edit dan
-- Kabagrenmin personel.read sejak seed awal (K2, K5).
INSERT INTO sdl_role_permissions(role_key, permission_key)
SELECT r.role_key, p.permission_key
  FROM sdl_roles r
  JOIN (VALUES
    ('br_op_subbagsumda', 'subbagsumda.personel.update'),
    ('br_op_subbagsumda', 'subbagsumda.pensiun.review'),
    ('br_staf_subbagsumda', 'subbagsumda.pensiun.review'),
    ('br_kasubbagsumda', 'subbagsumda.personel.archive'),
    ('br_kasubbagsumda', 'subbagsumda.pensiun.review')
  ) AS p(role_key, permission_key) ON p.role_key = r.role_key
ON CONFLICT (role_key, permission_key) DO NOTHING;

-- Salinan sekali (K3) dari registry personel R5B yang masih aktif. Registry
-- tidak ditulis balik dan endpoint-nya tetap hidup. Status registry berasal
-- dari master dropdown yang bisa diubah Superadmin, jadi dicocokkan tanpa
-- peka huruf/spasi; selain aktif/pensiun/mpp menjadi Nonaktif dengan catatan.
-- NRP kembar dilewati; jumlah sumber vs disalin dicatat di satu baris audit.
WITH src AS (
  SELECT s.id, btrim(s.ref_code) AS nrp, btrim(s.title) AS nama,
         btrim(coalesce(s.fields->>'pangkat','')) AS pangkat,
         btrim(coalesce(s.fields->>'jabatan','')) AS jabatan,
         btrim(coalesce(s.fields->>'unitKerja','')) AS unit_kerja,
         btrim(coalesce(s.fields->>'keterangan','')) AS keterangan,
         btrim(coalesce(s.fields->>'status','')) AS status_lama,
         s.created_by, s.updated_by, s.created_at
    FROM sdl_sumda_registry s
    JOIN sdl_unit_work_records w ON w.id = s.work_record_id
   WHERE s.kind = 'personel' AND s.deleted_at IS NULL
     AND w.deleted_at IS NULL AND w.unit_key = 'subbagsumda'
), ins AS (
  INSERT INTO sdl_sumda_personel(nrp, nama, jenis, pangkat, jabatan, unit_kerja, status, catatan,
                                 source_registry_id, created_by, updated_by, created_at)
  SELECT src.nrp, src.nama,
         CASE WHEN EXISTS (SELECT 1 FROM sdl_polri_rank_master m WHERE m.code = src.pangkat) THEN 'Polri' END,
         src.pangkat, src.jabatan, src.unit_kerja,
         CASE lower(src.status_lama) WHEN 'aktif' THEN 'Aktif' WHEN 'pensiun' THEN 'Pensiun'
              WHEN 'mpp' THEN 'MPP' ELSE 'Nonaktif' END,
         left(concat_ws(E'\n', nullif(src.keterangan, ''),
              CASE WHEN lower(src.status_lama) IN ('aktif','pensiun','mpp') THEN NULL
                   ELSE 'Status lama: ' || coalesce(nullif(src.status_lama, ''), '(kosong)') END), 1000),
         src.id, src.created_by, src.updated_by, src.created_at
    FROM src
  ON CONFLICT DO NOTHING
  RETURNING 1
)
INSERT INTO sdl_audit_events(actor_id, event_key, subject_type, subject_id, metadata)
SELECT NULL, 'subbagsumda.personel.salin_registry', 'subbagsumda.personel', '068',
       jsonb_build_object('sumber', (SELECT count(*) FROM src), 'disalin', (SELECT count(*) FROM ins))
 WHERE (SELECT count(*) FROM src) > 0;
