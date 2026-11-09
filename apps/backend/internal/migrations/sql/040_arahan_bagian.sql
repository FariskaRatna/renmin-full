-- R5H1: Arahan Pimpinan ditujukan ke BAGIAN, bukan ke orang.
--
-- Kabagrenmin menunjuk "Kasubbagren", bukan "Budi". Siapa orangnya ditentukan
-- sistem saat kirim, dari pemegang jabatan yang berlaku waktu itu. Dua kolom
-- aditif di bawah ini yang menyimpan pilihan bagian tersebut.
--
-- Yang SENGAJA tidak berubah: sdl_leadership_directive_recipients.recipient_id
-- tetap FK ke sdl_users dan tetap NOT NULL. Bagian hanyalah cara MEMILIH;
-- penerimanya tetap orang, karena seluruh status baca/terima, notifikasi, dan
-- jejak audit arahan bergantung pada identitas perorangan. Menjadikan penerima
-- sebuah unit akan menghapus kemampuan menjawab "siapa yang belum membaca".

-- 1. Bagian asal setiap baris penerima.
--    Nullable tanpa DEFAULT, dan NULL punya arti tersendiri: "dipilih lewat
--    daftar orang", yaitu SELURUH baris yang sudah ada sebelum migrasi ini dan
--    jalur lama yang masih dipertahankan di kontrak API. Jadi kolom ini bukan
--    data yang hilang, melainkan pembeda dua cara penunjukan.
--
--    TEXT tanpa FK dan tanpa CHECK, berbeda dari recipient_unit di
--    sdl_urmin_distributions yang menunjuk sdl_org_units. Alasannya: 'bagian'
--    bukan unit. 'kasubbagurmin' dan 'kabagrenmin' sama-sama berada di unit
--    'urmin', sehingga tabel unit tidak bisa membedakannya. Daftar bagian yang
--    sah hidup di kode (directives/sections.go dan padanannya di Express),
--    satu tempat, dan divalidasi di sana sebelum INSERT.
ALTER TABLE sdl_leadership_directive_recipients
 ADD COLUMN section_key TEXT;

-- 2. Pilihan bagian pada draf privat, supaya autosave tidak kehilangannya di
--    antara dua ketukan ketik -- persis alasan incoming_id ikut ke draf di 035.
--
--    NOT NULL DEFAULT '[]' di sini, bukan nullable seperti kolom di atas: draf
--    adalah kertas buram yang selalu dibaca utuh, dan "belum memilih bagian"
--    sudah terwakili oleh array kosong. Tidak ada keadaan ketiga yang perlu
--    dibedakan, jadi NULL hanya akan menambah cabang di pembacanya.
--    Baris draf lama ikut terisi '[]' oleh DEFAULT, tanpa backfill terpisah.
ALTER TABLE sdl_leadership_directive_drafts
 ADD COLUMN section_keys JSONB NOT NULL DEFAULT '[]'::jsonb;
