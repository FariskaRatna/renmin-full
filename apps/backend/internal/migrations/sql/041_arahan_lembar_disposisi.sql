-- R5H2: arahan menjadi lembar disposisi.
--
-- Kabagrenmin menulis arahan atas sebuah surat dengan isian yang sama seperti
-- lembar disposisi kertas: surat dari, nomor surat, tanggal arahan, tanggal
-- surat, perihal, klasifikasi, derajat, centang disposisi, dan catatan bebas.
--
-- Isian itu disimpan sebagai SATU objek JSONB `sheet`, bukan sepuluh kolom.
-- Seluruhnya opsional dan dibaca hanya sebagai satu kesatuan (tampil di detail
-- arahan); tidak ada query yang menyaring per isian. `NULL` berarti arahan ini
-- dibuat tanpa lembar -- keadaan seluruh arahan sebelum 041 -- sehingga respons
-- lama tetap byte-identik.
--
-- Bentuk isinya dijaga di aplikasi (directives/sheet.go ↔ sheet.js), karena
-- aturannya bergantung pada master disposisi di bawah dan pada klasifikasi
-- surat yang ditautkan, dua hal yang tidak bisa dibaca oleh CHECK constraint.

-- Pilihan centang "Disposisi Kabagrenmin". Dikelola Superadmin lewat Master
-- Data, sama seperti jenis surat (038): daftarnya akan bertambah satu per satu,
-- dan setiap penambahan lewat migrasi berarti menunggu rilis untuk hal yang
-- sebenarnya cuma data.
CREATE TABLE sdl_disposisi_opsi (
 code VARCHAR(24) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
 name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sdl_disposisi_opsi_name_idx ON sdl_disposisi_opsi(lower(name));

-- Tiga pilihan yang diketahui pemilik sistem per 2026-11-04.
INSERT INTO sdl_disposisi_opsi(code,name) VALUES
 ('MONITOR','Monitor'),
 ('ARSIPKAN','Arsipkan'),
 ('FASILITAS','Fasilitas');

ALTER TABLE sdl_leadership_directives
 ADD COLUMN sheet JSONB CHECK (sheet IS NULL OR jsonb_typeof(sheet)='object');

ALTER TABLE sdl_leadership_directive_drafts
 ADD COLUMN sheet JSONB CHECK (sheet IS NULL OR jsonb_typeof(sheet)='object');
