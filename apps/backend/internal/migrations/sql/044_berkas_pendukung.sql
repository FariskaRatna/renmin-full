-- R5H5: berkas pendukung surat keluar, terpisah dari lampiran surat.
--
-- Keputusan pemilik sistem (2026-11-05): tombol "Berkas" di daftar Surat
-- Keluar menambah berkas kerja pendukung (bukti kirim, foto, tanda terima)
-- yang BOLEH ditambah kapan saja, termasuk setelah surat diajukan atau
-- disetujui, dan TIDAK ikut ditinjau Kabagrenmin.
--
-- Kedua jenis tetap satu tabel dan satu catatan Berkas Kerja, sehingga menu
-- Berkas Kerja menampilkan keduanya tanpa perubahan. Yang membedakan:
--   lampiran  -- naskah dan lampiran surat. Terkunci selama surat diajukan/
--                disetujui, ikut sidik jari persetujuan dan syarat wajib PDF.
--   pendukung -- tidak terkunci, tidak ikut sidik jari, tidak memenuhi syarat
--                wajib PDF.
--
-- DEFAULT 'lampiran' membuat setiap berkas yang sudah ada tetap lampiran,
-- jadi sidik jari surat yang sedang diajukan tidak berubah oleh migrasi ini.

ALTER TABLE sdl_unit_work_files
  ADD COLUMN purpose VARCHAR(12) NOT NULL DEFAULT 'lampiran'
  CHECK (purpose = 'lampiran' OR purpose = 'pendukung');
