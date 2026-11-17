-- R5H16: Tahap Pekerjaan dokumen Subbagren.
--
-- Permintaan pemilik sistem (2026-11-16): saat menambah dokumen di Dokumen
-- Perancangan, operator memilih tahap pekerjaan dari dokumen "Alur Pekerjaan
-- Perencanaan dan Pelaporan Densus 88 AT Polri" (menyusun Tim Pokja, rapat
-- penyusunan, pengajuan pengesahan, distribusi, ...). Setiap tahap punya
-- isian dan lampiran PDF sendiri, dan bisa ditambah satu per satu.
--
-- Isi:
--   * Jenis dokumen DIPERLEBAR dengan jenis dari dokumen alur (Rancangan
--     Renstra/Renja, IKU, RKKS, Rendisgar, Rengiat, Renaksi, Perjanjian
--     Kinerja). Tidak ada jenis yang dihapus; baris lama tetap sah.
--   * sdl_ren_dokumen_tahap: satu baris per tahap yang dicatat. Daftar
--     pekerjaan dan field isiannya ada di API (tahap-katalog.js), bukan di
--     skema, karena isinya mengikuti dokumen alur yang masih bisa berubah.
--   * sdl_ren_dokumen_tahap_berkas: lampiran PDF per tahap per slot
--     (mis. sprin, notulen), terenkripsi AES-256-GCM dengan SDL_EVIDENCE_KEY.
--
-- EXPRESS SAJA.

ALTER TABLE sdl_ren_dokumen DROP CONSTRAINT sdl_ren_dokumen_jenis_check, ADD CONSTRAINT sdl_ren_dokumen_jenis_check CHECK (jenis IN ('renstra','renja','rka_kl','dipa','revisi_dipa','pok','tor_kak','rab','lainnya','rancangan_renstra','rancangan_renja','iku','rkks_renbut','rkks_pagu_indikatif','rkks_pagu_anggaran','rkks_pagu_alokasi','rendisgar','rengiat','renaksi','perjanjian_kinerja'));

CREATE TABLE sdl_ren_dokumen_tahap (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 dokumen_id UUID NOT NULL REFERENCES sdl_ren_dokumen(id) ON DELETE RESTRICT,
 pekerjaan VARCHAR(40) NOT NULL CHECK (pekerjaan ~ '^[a-z_]{2,40}$'),
 isian JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(isian) = 'object'),
 version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_ren_dokumen_tahap_dokumen_idx ON sdl_ren_dokumen_tahap(dokumen_id, created_at);

CREATE TABLE sdl_ren_dokumen_tahap_berkas (
 tahap_id UUID NOT NULL REFERENCES sdl_ren_dokumen_tahap(id) ON DELETE CASCADE,
 slot VARCHAR(40) NOT NULL CHECK (slot ~ '^[a-z_]{2,40}$'),
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (tahap_id, slot)
);
