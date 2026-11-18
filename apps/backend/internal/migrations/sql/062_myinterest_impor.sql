-- R5H20: impor "Realisasi Belanja per Jenis Kegiatan" dari myinterest.
--
-- Keputusan pemilik sistem (2026-11-18):
--   * Angka myinterest adalah ACUAN RESMI untuk LRA dan dashboard (Beranda
--     Subbagren, Dashboard pimpinan). Realisasi manual per dokumen (059) tetap
--     ada sebagai catatan internal.
--   * Operator mengimpor file Excel unduhan myinterest; langsung berlaku tanpa
--     persetujuan. Setiap impor tercatat di audit dan bisa dihapus bila salah file.
--   * Angka di file KUMULATIF sejak 1 Januari; setiap impor disimpan sebagai
--     potret per tanggal data (tidak menimpa). Realisasi per bulan = selisih
--     potret terakhir di bulan itu dengan potret terakhir bulan sebelumnya.
-- Pembacaan file dan aturannya di API Express (modules/subbagren/myinterest.js).
--
-- Dua tabel baru. Tanpa ALTER, tanpa backfill.
--
-- EXPRESS SAJA.

CREATE TABLE sdl_ren_myinterest_impor (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tahun SMALLINT NOT NULL CHECK (tahun BETWEEN 2000 AND 2100),
 tanggal_awal DATE NOT NULL,
 tanggal_akhir DATE NOT NULL,
 waktu_unduh VARCHAR(80) NOT NULL DEFAULT '',
 filename VARCHAR(160) NOT NULL,
 sha256 CHAR(64) NOT NULL,
 total_pagu NUMERIC(18,0) NOT NULL CHECK (total_pagu >= 0),
 total_realisasi NUMERIC(18,0) NOT NULL CHECK (total_realisasi >= 0),
 imported_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 deleted_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 deleted_at TIMESTAMPTZ,
 CONSTRAINT sdl_ren_myinterest_impor_rentang CHECK (tanggal_awal <= tanggal_akhir),
 CONSTRAINT sdl_ren_myinterest_impor_hapus CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
-- Satu potret aktif per tanggal data; impor ulang tanggal yang sama menggantikan yang lama.
CREATE UNIQUE INDEX sdl_ren_myinterest_impor_aktif ON sdl_ren_myinterest_impor(tanggal_akhir) WHERE deleted_at IS NULL;

CREATE TABLE sdl_ren_myinterest_baris (
 impor_id UUID NOT NULL REFERENCES sdl_ren_myinterest_impor(id) ON DELETE RESTRICT,
 kode VARCHAR(20) NOT NULL,
 nama VARCHAR(300) NOT NULL,
 jenis VARCHAR(10) NOT NULL CHECK (jenis IN ('pegawai','barang','modal','bunga','subsidi','hibah','bansos','lain','transfer')),
 pagu NUMERIC(18,0) NOT NULL CHECK (pagu >= 0),
 realisasi NUMERIC(18,0) NOT NULL CHECK (realisasi >= 0),
 PRIMARY KEY (impor_id, kode, jenis)
);
