-- R5H8: pilihan "Yang Menghadiri" pada Agenda & Rapat (Urmin) menjadi master
-- data, menyusul sepuluh daftar di 047. Keputusan pemilik sistem 2026-11-11.
--
-- Daftar ini PILIH-BANYAK: di agenda tersimpan sebagai nama-nama yang digabung
-- ", " (MultiPick di UrminR5D.tsx), sama dengan Verifikator dan Tembusan di
-- 042. Karena itu namanya tidak boleh memuat koma. Dijaga backend
-- (master-data.js, noComma), bukan CHECK constraint: ALTER TABLE ditolak uji
-- keamanan migrasi Go (migrate_test.go) di luar pengecualian yang sudah ditinjau.

INSERT INTO sdl_opsi_dropdown(set_key, code, name) VALUES
 ('agenda-hadir', 'KABAGRENMIN', 'Kabagrenmin'),
 ('agenda-hadir', 'URMIN', 'Urmin'),
 ('agenda-hadir', 'SUBBAGREN', 'Subbagren'),
 ('agenda-hadir', 'SUBBAGSUMDA', 'Subbagsumda'),
 ('agenda-hadir', 'SUBBAGBINFUNG', 'Subbagbinfung');
