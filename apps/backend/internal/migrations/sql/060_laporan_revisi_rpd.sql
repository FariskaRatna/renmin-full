-- R5H19: Laporan dan Revisi Anggaran tersambung ke angka anggaran/realisasi.
--
-- Keputusan pemilik sistem (2026-11-18):
--   * LRA, Laporan Penggunaan Anggaran, EKA PN, dan Hibah otomatis mengambil
--     realisasi terverifikasi per pos (dokumen Final beranggaran). Selama
--     "Dalam proses" angkanya selalu terbaru; saat ditandai Selesai disimpan
--     sebagai potret tetap (kolom ringkasan). Dibuka kembali = potret dihapus.
--   * Laporan Hibah hanya memuat pos yang ditandai dana hibah (kolom hibah).
--   * Revisi POK berisi daftar pos + anggaran baru; diterapkan otomatis saat
--     revisi ditandai Selesai, tidak boleh di bawah realisasi terverifikasi.
--   * RPD (rencana penarikan dana) bulanan per pos. RPD awal diisi langsung;
--     perubahan berikutnya lewat Revisi RPD, diterapkan saat revisi Selesai.
-- Aturan ditegakkan di API Express (modules/subbagren/perencanaan.js, progar.js).
--
-- EXPRESS SAJA.

ALTER TABLE sdl_ren_dokumen ADD COLUMN hibah BOOLEAN NOT NULL DEFAULT FALSE, ADD COLUMN ringkasan JSONB;

CREATE TABLE sdl_ren_rpd (
 dokumen_id UUID NOT NULL REFERENCES sdl_ren_dokumen(id) ON DELETE RESTRICT,
 bulan SMALLINT NOT NULL CHECK (bulan BETWEEN 1 AND 12),
 jumlah BIGINT NOT NULL CHECK (jumlah >= 0),
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (dokumen_id, bulan)
);

CREATE TABLE sdl_ren_revisi_item (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 revisi_id UUID NOT NULL REFERENCES sdl_ren_dokumen(id) ON DELETE RESTRICT,
 dokumen_id UUID NOT NULL REFERENCES sdl_ren_dokumen(id) ON DELETE RESTRICT,
 anggaran_baru BIGINT CHECK (anggaran_baru >= 0),
 rpd_baru BIGINT[] CHECK (rpd_baru IS NULL OR (cardinality(rpd_baru) = 12 AND 0 <= ALL(rpd_baru))),
 anggaran_lama BIGINT,
 rpd_lama BIGINT[],
 diterapkan_at TIMESTAMPTZ,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_ren_revisi_item_isi CHECK (anggaran_baru IS NOT NULL OR rpd_baru IS NOT NULL),
 CONSTRAINT sdl_ren_revisi_item_beda CHECK (revisi_id <> dokumen_id),
 CONSTRAINT sdl_ren_revisi_item_unik UNIQUE (revisi_id, dokumen_id)
);
CREATE INDEX sdl_ren_revisi_item_dokumen_idx ON sdl_ren_revisi_item(dokumen_id);
