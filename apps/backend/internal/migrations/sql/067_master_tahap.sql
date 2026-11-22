-- R5H25: Master Data tahap pekerjaan aktif/nonaktif (docs/R5H25-MASTER-DATA-TAHAP-PEKERJAAN.md).
--
-- Keputusan pemilik sistem (2026-11-22):
--   * Superadmin (menu Master Data, guard AuthorizeRoleEditor) bisa menonaktifkan
--     tahap per jenis dokumen Progar/DALGAR; hanya tahap, tanpa urutan.
--   * Nonaktif = tidak ditawarkan saat MENAMBAH tahap; tahap yang sudah tercatat
--     tetap utuh dan bisa diubah.
--   * Bawaan semua aktif: hanya pasangan NONAKTIF yang disimpan, sehingga tahap
--     baru dari kode (tahap-katalog.js) otomatis aktif.
--   * Tahap syarat sistem dikunci di kode (TAHAP_WAJIB), minimal satu tahap aktif
--     per jenis, alasan wajib; jejak di sdl_audit_events.
-- Aturan ditegakkan di API Express (modules/subbagren/master-tahap.js).
--
-- Dua tabel baru; tabel lama tidak diubah.
--
-- EXPRESS SAJA.

CREATE TABLE sdl_ren_tahap_nonaktif (
 jenis VARCHAR(40) NOT NULL CHECK (jenis ~ '^[a-z][a-z0-9_]{1,39}$'),
 pekerjaan VARCHAR(40) NOT NULL CHECK (pekerjaan ~ '^[a-z][a-z0-9_]{1,39}$'),
 updated_by UUID NOT NULL REFERENCES sdl_users(id),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY (jenis, pekerjaan)
);

-- Satu baris versi global untuk optimistic locking PUT Master Data.
CREATE TABLE sdl_ren_tahap_master_versi (
 id SMALLINT PRIMARY KEY CHECK (id = 1),
 version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
);

INSERT INTO sdl_ren_tahap_master_versi(id) VALUES (1);
