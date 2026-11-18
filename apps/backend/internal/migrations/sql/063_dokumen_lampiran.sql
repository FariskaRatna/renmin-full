-- Lampiran tingkat dokumen PROGAR (di luar tahap pekerjaan).
--
-- Keputusan pemilik sistem (2026-11-18):
--   * Dokumen Perancangan/Final punya lampiran pendukung sendiri, terpisah dari
--     lampiran masing-masing tahap pekerjaan.
--   * Boleh PDF, Excel (.xlsx), atau Word (.docx); maks 20 MB per file.
--   * Bisa ditambah/dihapus selama dokumen belum final (draft, atau sah tetapi
--     belum final dan belum digantikan); terkunci setelah Final.
-- Isi disegel AES-256-GCM (envelope SDL1) seperti lampiran tahap.
-- Aturan ditegakkan di API Express (modules/subbagren/perencanaan.js).
--
-- Satu tabel baru; tidak mengubah tabel lama.
--
-- EXPRESS SAJA.

CREATE TABLE sdl_ren_dokumen_lampiran (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 dokumen_id UUID NOT NULL REFERENCES sdl_ren_dokumen(id) ON DELETE CASCADE,
 jenis VARCHAR(4) NOT NULL CHECK (jenis ~ '^(pdf|xlsx|docx)$'),
 filename VARCHAR(160) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_ren_dokumen_lampiran_idx ON sdl_ren_dokumen_lampiran(dokumen_id, uploaded_at);
