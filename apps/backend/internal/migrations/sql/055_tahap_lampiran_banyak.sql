-- R5H16 lanjutan: lampiran tahap pekerjaan boleh LEBIH DARI SATU per jenis.
--
-- Permintaan pemilik sistem (2026-11-17): tiap jenis lampiran pekerjaan
-- (mis. notulen, daftar hadir) bisa berisi beberapa PDF, dan lampiran yang
-- sudah disimpan bisa ditambah atau dihapus satu per satu selama dokumen belum
-- final.
--
-- Tabel 053 sdl_ren_dokumen_tahap_berkas berkunci (tahap_id, slot), artinya satu
-- berkas per slot, dan kuncinya tidak boleh diubah (aturan migrasi aditif).
-- Maka lampiran pindah ke tabel baru berkunci id sendiri; isi tabel lama
-- disalin apa adanya (envelope AES-GCM byte-identik, tetap terbaca). Tabel lama
-- tidak dipakai API lagi dan tidak dihapus (DROP TABLE dilarang).
--
-- EXPRESS SAJA.

CREATE TABLE sdl_ren_dokumen_tahap_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tahap_id UUID NOT NULL REFERENCES sdl_ren_dokumen_tahap(id) ON DELETE CASCADE,
 slot VARCHAR(40) NOT NULL CHECK (slot ~ '^[a-z_]{2,40}$'),
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_ren_dokumen_tahap_lampiran_idx ON sdl_ren_dokumen_tahap_lampiran(tahap_id, slot, uploaded_at);

INSERT INTO sdl_ren_dokumen_tahap_lampiran(tahap_id, slot, filename, size_bytes, sha256, body, uploaded_by, uploaded_at)
SELECT tahap_id, slot, filename, size_bytes, sha256, body, uploaded_by, uploaded_at FROM sdl_ren_dokumen_tahap_berkas;
