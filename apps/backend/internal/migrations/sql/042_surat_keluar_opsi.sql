-- R5H3: pilihan dropdown formulir Surat Keluar, dikelola Superadmin lewat
-- Master Data (pola yang sama dengan 038 sdl_surat_jenis).
--
-- Enam daftar, enam tabel berbentuk identik. Bukan satu tabel ber-kolom
-- "set_key": penanganan master data (unitwork/master_data.go) bekerja per
-- tabel, dan enam tabel kecil tidak menuntut satu baris pun perubahan di sana.
--
-- Yang tersimpan di surat (sdl_urmin_registry.fields) adalah NAMA pilihannya,
-- bukan kodenya: nilainya hanya dibaca manusia dan tidak tercetak di nomor
-- surat. Mengganti nama di Master Data karena itu tidak mengubah surat lama.
--
-- Isi awalnya DATA DUMMY: pemilik sistem baru menetapkan bentuknya
-- (dropdown), belum isinya. Diganti lewat Master Data, bukan migrasi susulan.

CREATE TABLE sdl_surat_jalur (
 code VARCHAR(24) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
 name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sdl_surat_jalur_name_idx ON sdl_surat_jalur(lower(name));

CREATE TABLE sdl_surat_penandatangan (
 code VARCHAR(24) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
 name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sdl_surat_penandatangan_name_idx ON sdl_surat_penandatangan(lower(name));

CREATE TABLE sdl_surat_pemberi_nomor (
 code VARCHAR(24) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
 name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sdl_surat_pemberi_nomor_name_idx ON sdl_surat_pemberi_nomor(lower(name));

-- Verifikator dan tembusan boleh dipilih lebih dari satu; di surat tersimpan
-- sebagai nama-nama yang digabung ", " (lihat MultiPick di UrminR5D.tsx).
-- Karena itu nama di dua daftar ini tidak boleh memuat koma.
CREATE TABLE sdl_surat_verifikator (
 code VARCHAR(24) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
 name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120 AND position(',' in name) = 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sdl_surat_verifikator_name_idx ON sdl_surat_verifikator(lower(name));

CREATE TABLE sdl_surat_tembusan (
 code VARCHAR(24) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
 name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120 AND position(',' in name) = 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sdl_surat_tembusan_name_idx ON sdl_surat_tembusan(lower(name));

CREATE TABLE sdl_surat_tipe (
 code VARCHAR(24) PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{1,23}$'),
 name VARCHAR(120) NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sdl_surat_tipe_name_idx ON sdl_surat_tipe(lower(name));

INSERT INTO sdl_surat_jalur(code,name) VALUES
 ('INTERNAL','Internal Bagrenmin'),
 ('EKSTERNAL','Eksternal Satuan'),
 ('KAURMIN','Melalui Ka Urmin'),
 ('PIMPINAN','Langsung Pimpinan');

INSERT INTO sdl_surat_penandatangan(code,name) VALUES
 ('KABAGRENMIN','Kabagrenmin'),
 ('KASUBBAGREN','Kasubbagren'),
 ('KASUBBAGSUMDA','Kasubbagsumda'),
 ('KASUBBAGBINFUNG','Kasubbagbinfung'),
 ('KAURMIN','Kaurmin');

INSERT INTO sdl_surat_pemberi_nomor(code,name) VALUES
 ('URMIN','Urmin Bagrenmin'),
 ('SUBBAGREN','Subbagren'),
 ('SUBBAGSUMDA','Subbagsumda'),
 ('SUBBAGBINFUNG','Subbagbinfung');

INSERT INTO sdl_surat_verifikator(code,name) VALUES
 ('KASUBBAGREN','Kasubbagren'),
 ('KASUBBAGSUMDA','Kasubbagsumda'),
 ('KASUBBAGBINFUNG','Kasubbagbinfung'),
 ('KAURMIN','Kaurmin'),
 ('PAUR_RENMIN','Paur Renmin');

INSERT INTO sdl_surat_tembusan(code,name) VALUES
 ('KABAGRENMIN','Kabagrenmin'),
 ('KASUBBAGREN','Kasubbagren'),
 ('KASUBBAGSUMDA','Kasubbagsumda'),
 ('KASUBBAGBINFUNG','Kasubbagbinfung'),
 ('ARSIP','Arsip');

INSERT INTO sdl_surat_tipe(code,name) VALUES
 ('ND_BIASA','Naskah Dinas Biasa'),
 ('ND_KHUSUS','Naskah Dinas Khusus'),
 ('EDARAN','Surat Edaran'),
 ('UNDANGAN','Surat Undangan'),
 ('NOTA_DINAS','Nota Dinas');
