-- R5G12: master jenis surat untuk penomoran surat dinas.
--
-- Dipakai pada segmen pertama nomor surat, separuh di belakang garis miring:
--
--   B/ND-157/X/HUM.1.2./2026/Bagrenmin
--     ^^
--
-- `B` di depannya berasal dari derajat (Biasa=B, Kilat=K) yang nilainya
-- terkunci di aplikasi, bukan di sini. Tabel ini hanya memegang bagian yang
-- daftarnya memang bisa bertambah.
--
-- Dibuat sebagai tabel, bukan daftar tetap di kode, karena pemilik sistem
-- memang baru mengetahui satu jenis — Nota Dinas — dan sisanya akan menyusul
-- satu per satu. Setiap penambahan lewat migrasi berarti menunggu rilis untuk
-- hal yang sebenarnya cuma data; dengan tabel, Superadmin menambahkannya
-- sendiri lewat Settings.
--
-- Referensi murni: tanpa kepemilikan, tanpa klasifikasi akses. Isinya sama
-- untuk semua unit.

CREATE TABLE sdl_surat_jenis (
 -- Kode inilah yang tercetak di nomor surat, jadi bentuknya dijaga ketat:
 -- huruf besar, angka, garis miring dan strip. Spasi sengaja tidak diizinkan.
 code VARCHAR(12) PRIMARY KEY CHECK (code ~ '^[A-Z0-9][A-Z0-9/-]{0,11}$'),
 name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nama dijaga unik tanpa memandang besar-kecil huruf: dua jenis bernama sama
-- dengan kode berbeda hampir pasti salah ketik, bukan niat.
CREATE UNIQUE INDEX sdl_surat_jenis_name_idx ON sdl_surat_jenis(lower(name));

-- Satu-satunya jenis yang sudah diketahui pemilik sistem per 2026-11-03.
-- Sisanya ditambahkan lewat Settings, bukan lewat migrasi susulan.
INSERT INTO sdl_surat_jenis(code,name) VALUES ('ND','Nota Dinas');
