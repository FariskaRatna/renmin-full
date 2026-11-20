-- R5H23: tindak lanjut arahan/disposisi oleh penerima (docs/R5H23-TINDAK-LANJUT-ARAHAN.md).
--
-- Keputusan pemilik sistem (2026-11-19):
--   * Setelah arahan DITERIMA, tiap penerima punya SATU laporan tindak lanjut
--     (teks bebas) yang bisa diubah, dengan lampiran banyak (maks 10;
--     PDF, gambar, Excel, Word; 20 MB per berkas).
--   * Terlihat oleh pemberi arahan dan SEMUA penerima arahan yang sama.
--   * Tidak ada status "Selesai".
-- Aturan ditegakkan di API Express (modules/directives/tindak-lanjut.js).
-- Lampiran disegel AES-256-GCM (envelope SDL1) seperti lampiran unit lain.
--
-- Dua tabel baru; tabel arahan lama tidak diubah.
--
-- EXPRESS SAJA.

CREATE TABLE sdl_leadership_directive_followups (
 directive_id UUID NOT NULL,
 recipient_id UUID NOT NULL,
 isi VARCHAR(4000) NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (directive_id, recipient_id),
 FOREIGN KEY (directive_id, recipient_id) REFERENCES sdl_leadership_directive_recipients(directive_id, recipient_id) ON DELETE CASCADE
);

CREATE TABLE sdl_leadership_directive_followup_files (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 directive_id UUID NOT NULL,
 recipient_id UUID NOT NULL,
 jenis VARCHAR(4) NOT NULL CHECK (jenis IN ('pdf','png','jpg','xlsx','docx')),
 filename VARCHAR(180) NOT NULL,
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY (directive_id, recipient_id) REFERENCES sdl_leadership_directive_followups(directive_id, recipient_id) ON DELETE CASCADE
);
CREATE INDEX sdl_directive_followup_files_idx ON sdl_leadership_directive_followup_files(directive_id, recipient_id, uploaded_at);
