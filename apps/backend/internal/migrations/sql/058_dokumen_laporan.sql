-- R5H17: menu DALGAR "Laporan" (alur no. 14-19) dan "Revisi Anggaran" (no. 20).
--
-- Keputusan pemilik sistem (2026-11-17): laporan dan revisi anggaran dicatat
-- dengan mesin dokumen + tahap pekerjaan yang sama (sdl_ren_dokumen dan
-- sdl_ren_dokumen_tahap), tanpa pengesahan internal (berakhir "Selesai").
--
-- 1. Daftar jenis diperlebar dengan delapan jenis baru; dua puluh jenis lama
--    tetap ada. Pengecualian yang ditinjau di migrate_test.go (seperti 053).
-- 2. Satu ADD COLUMN periode NOT NULL DEFAULT '' (dokumen lama tidak berperiode):
--    'B01'..'B12' = bulan (LRA), 'TW1'..'TW4' = triwulan (Capaian Kinerja).
--    Tahunnya memakai kolom tahun. Tanpa backfill.
--
-- EXPRESS SAJA.

ALTER TABLE sdl_ren_dokumen DROP CONSTRAINT sdl_ren_dokumen_jenis_check, ADD CONSTRAINT sdl_ren_dokumen_jenis_check CHECK (jenis IN ('renstra','renja','rka_kl','dipa','revisi_dipa','pok','tor_kak','rab','lainnya','rancangan_renstra','rancangan_renja','iku','rkks_renbut','rkks_pagu_indikatif','rkks_pagu_anggaran','rkks_pagu_alokasi','rendisgar','rengiat','renaksi','perjanjian_kinerja','lap_lra','lap_penggunaan_anggaran','lap_eka_pn','lap_capaian_kinerja','lap_lkip','lap_hibah','revisi_pok','revisi_rpd'));

ALTER TABLE sdl_ren_dokumen ADD COLUMN periode VARCHAR(4) NOT NULL DEFAULT '' CHECK (periode ~ '^(|B(0[1-9]|1[0-2])|TW[1-4])$');
