-- R5G13: deret nomor urut surat keluar.
--
-- Segmen kedua nomor surat dinas:
--
--   B/ND-157/X/HUM.1.2./2026/Bagrenmin
--        ^^^
--
-- SATU deret untuk seluruh Bagrenmin, direset tiap 1 Januari. Nomor 157 berarti
-- surat keluar ke-157 pada tahun itu — tidak peduli subbag mana yang mengajukan
-- maupun apa jenis suratnya. Keputusan pemilik sistem, 2026-11-03.
--
-- Satu baris per tahun, bukan satu baris per nomor. Baris itulah yang dikunci
-- saat nomor dialokasikan, sehingga dua permintaan bersamaan tidak pernah
-- mendapat angka yang sama:
--
--   INSERT INTO sdl_surat_nomor_urut(tahun) VALUES($1)
--   ON CONFLICT(tahun) DO UPDATE SET nomor_terakhir = sdl_surat_nomor_urut.nomor_terakhir + 1
--   RETURNING nomor_terakhir
--
-- ON CONFLICT DO UPDATE mengambil row lock, jadi penambahannya atomik tanpa
-- SELECT ... FOR UPDATE terpisah dan tanpa celah antara baca dan tulis.
--
-- Deretnya SENGAJA tidak dijamin rapat. Nomor diberikan saat draf dibuat
-- (keputusan pemilik sistem), jadi draf yang dibatalkan meninggalkan lubang.
-- Mengisi ulang lubang itu akan merusak sifat sekali-pakai nomor surat dinas,
-- yang justru lebih penting daripada kerapatan deret.

CREATE TABLE sdl_surat_nomor_urut (
 tahun SMALLINT PRIMARY KEY CHECK (tahun BETWEEN 2000 AND 2200),
 -- DEFAULT 1, bukan 0: baris baru dibuat bersamaan dengan pengambilan nomor
 -- PERTAMA tahun itu, jadi nilai awalnya memang sudah terpakai.
 nomor_terakhir INTEGER NOT NULL DEFAULT 1 CHECK (nomor_terakhir > 0),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
