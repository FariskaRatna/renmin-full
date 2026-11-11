-- R5H8: sepuluh pilihan dropdown yang selama ini tertulis di kode frontend
-- dijadikan master data, dikelola Superadmin lewat menu Master Data.
--
-- Keputusan pemilik sistem (2026-11-11): pilihan dropdown harus bisa ditambah
-- tanpa mengubah kode. Cakupannya HANYA daftar yang murni label -- nilainya
-- disimpan sebagai teks di JSONB `fields` dan tidak diperiksa backend mana pun:
--
--   Urmin / Arsip          arsip-jenis, arsip-status
--   Subbagsumda            personel-status, kondisi-barang
--   Subbagbinfung          sop-jenis, sop-status, pid-kategori,
--                          pid-tingkat-akses, pid-status, rb-status
--
-- SENGAJA tidak di sini: Jenis Surat Masuk (CHECK constraint letter_kind,
-- migrasi 024), Lingkup Surat (ikut nomor surat, diperiksa nomor-surat.js),
-- Derajat dan Klasifikasi (lihat master-data.js).
--
-- Satu tabel dengan kolom set_key, bukan sepuluh tabel seperti 042: himpunan
-- ini hanya dibaca Express (Go tidak tahu tabel ini), dan sepuluh tabel
-- identik hanya menambah 57 tabel menjadi 67 tanpa manfaat.
--
-- Yang tersimpan di data adalah NAMA pilihan, bukan kodenya (sama dengan 042).
-- Mengganti nama di Master Data tidak mengubah data lama; formulir tetap
-- menampilkan nilai lama itu sebagai "(nilai lama)".
--
-- `seq` menentukan urutan tampil: isi awal mengikuti urutan lama di kode,
-- pilihan baru muncul di akhir.

CREATE TABLE sdl_opsi_dropdown (
 set_key VARCHAR(40) NOT NULL CHECK (set_key ~ '^[a-z][a-z0-9-]{1,39}$'),
 code VARCHAR(24) NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
 name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
 seq BIGINT GENERATED ALWAYS AS IDENTITY,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (set_key, code)
);
CREATE UNIQUE INDEX sdl_opsi_dropdown_name_idx ON sdl_opsi_dropdown(set_key, lower(name));

INSERT INTO sdl_opsi_dropdown(set_key, code, name) VALUES
 ('arsip-jenis', 'SURAT_MASUK', 'Surat Masuk'),
 ('arsip-jenis', 'SURAT_KELUAR', 'Surat Keluar'),
 ('arsip-jenis', 'ADMINISTRASI', 'Administrasi'),
 ('arsip-jenis', 'RAPAT', 'Rapat'),
 ('arsip-jenis', 'LAPORAN', 'Laporan'),
 ('arsip-jenis', 'LAINNYA', 'Lainnya'),
 ('arsip-status', 'AKTIF', 'Aktif'),
 ('arsip-status', 'INAKTIF', 'Inaktif'),
 ('arsip-status', 'TINJAU_RETENSI', 'Tinjau Retensi'),
 ('personel-status', 'AKTIF', 'Aktif'),
 ('personel-status', 'MUTASI', 'Mutasi'),
 ('personel-status', 'PENSIUN', 'Pensiun'),
 ('personel-status', 'LAINNYA', 'Lainnya'),
 ('kondisi-barang', 'BAIK', 'Baik'),
 ('kondisi-barang', 'RUSAK_RINGAN', 'Rusak Ringan'),
 ('kondisi-barang', 'RUSAK_BERAT', 'Rusak Berat'),
 ('kondisi-barang', 'LAINNYA', 'Lainnya'),
 ('sop-jenis', 'SOP', 'SOP'),
 ('sop-jenis', 'PERATURAN', 'Peraturan'),
 ('sop-jenis', 'PEDOMAN', 'Pedoman'),
 ('sop-jenis', 'PETUNJUK_TEKNIS', 'Petunjuk Teknis'),
 ('sop-jenis', 'METODE', 'Metode'),
 ('sop-jenis', 'LAINNYA', 'Lainnya'),
 ('sop-status', 'DRAFT', 'Draft'),
 ('sop-status', 'REVIEW', 'Review'),
 ('sop-status', 'AKTIF', 'Aktif'),
 ('sop-status', 'NONAKTIF', 'Nonaktif'),
 ('sop-status', 'DICABUT', 'Dicabut'),
 ('pid-kategori', 'INFORMASI', 'Informasi'),
 ('pid-kategori', 'DOKUMENTASI', 'Dokumentasi'),
 ('pid-kategori', 'LAPORAN', 'Laporan'),
 ('pid-kategori', 'PUBLIKASI_INTERNAL', 'Publikasi Internal'),
 ('pid-kategori', 'LAINNYA', 'Lainnya'),
 ('pid-tingkat-akses', 'INTERNAL', 'Internal'),
 ('pid-tingkat-akses', 'TERBATAS', 'Terbatas'),
 ('pid-status', 'DRAFT', 'Draft'),
 ('pid-status', 'DIVERIFIKASI', 'Diverifikasi'),
 ('pid-status', 'TERSIMPAN', 'Tersimpan'),
 ('pid-status', 'DIARSIPKAN', 'Diarsipkan'),
 ('rb-status', 'DIRENCANAKAN', 'Direncanakan'),
 ('rb-status', 'BERJALAN', 'Berjalan'),
 ('rb-status', 'SELESAI', 'Selesai'),
 ('rb-status', 'PERLU_TINDAK_LANJUT', 'Perlu Tindak Lanjut');
