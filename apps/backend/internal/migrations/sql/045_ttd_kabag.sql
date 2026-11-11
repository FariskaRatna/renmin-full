-- R5H7: tanda tangan Kabagrenmin pada naskah surat keluar.
--
-- Keputusan pemilik sistem (2026-11-10): naskah surat keluar ditandatangani
-- Kabagrenmin sebagai bagian dari persetujuan. Tanda tangannya VISUAL (gambar
-- yang ditempel ke PDF), bukan TTE tersertifikasi; lihat
-- docs/R5H7-TTD-KABAG-SURAT-KELUAR.md.
--
-- Hanya dipakai backend Express. Go tidak membaca kedua tabel ini, jadi
-- mengembalikan /urmin ke Go (rollback Caddy) tidak merusak apa pun: berkas
-- bertanda tangan hanya tidak ditampilkan.

-- Tanda tangan tersimpan, satu per akun. Gambar PNG dienkripsi AES-256-GCM
-- dengan SDL_EVIDENCE_KEY (amplop "SDL1", crypto/evidence.js), sama seperti
-- bukti keuangan Subbagren: gambar tanda tangan pejabat tidak boleh terbaca
-- dari cadangan database.
CREATE TABLE sdl_user_signatures (
 user_id UUID PRIMARY KEY REFERENCES sdl_users(id) ON DELETE RESTRICT,
 image_seal BYTEA NOT NULL,
 sha256 CHAR(64) NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_user_signature_seal_size CHECK (octet_length(image_seal) BETWEEN 33 AND 262144)
);

-- Hasil penandatanganan: SALINAN naskah PDF yang sudah ditempeli tanda tangan.
-- Naskah asli di sdl_unit_work_files tidak diubah.
--
-- Sengaja tabel tersendiri, bukan purpose baru di sdl_unit_work_files: jalur
-- Berkas Kerja (Go dan Express) hanya mengunci purpose 'lampiran', sehingga
-- purpose baru akan bisa dihapus staf lewat menu Berkas Kerja. Di sini tidak
-- ada endpoint hapus sama sekali.
CREATE TABLE sdl_outgoing_signed_files (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 register_id UUID NOT NULL REFERENCES sdl_urmin_registry(id) ON DELETE RESTRICT,
 source_file_id UUID NOT NULL REFERENCES sdl_unit_work_files(id) ON DELETE RESTRICT,
 -- sha256 naskah asli saat ditandatangani; mengikat salinan ke sumbernya.
 source_sha256 CHAR(64) NOT NULL,
 file_name VARCHAR(200) NOT NULL,
 byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 52428800),
 sha256 CHAR(64) NOT NULL,
 file_data BYTEA NOT NULL,
 -- [{page,x,y,w,h}] -- halaman 1-based, koordinat relatif 0..1 dari kiri-atas
 -- halaman sebagaimana tampil (rotasi halaman sudah diperhitungkan).
 placements JSONB NOT NULL,
 signed_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 signed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_outgoing_signed_body_size CHECK (octet_length(file_data)=byte_size),
 CONSTRAINT sdl_outgoing_signed_name CHECK (length(btrim(file_name)) BETWEEN 1 AND 200),
 CONSTRAINT sdl_outgoing_signed_once UNIQUE (register_id, source_file_id)
);

CREATE INDEX sdl_outgoing_signed_register_idx
 ON sdl_outgoing_signed_files(register_id, signed_at, id);
