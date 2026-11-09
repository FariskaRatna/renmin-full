-- R5G2: tautan opsional dari Arahan Pimpinan kembali ke surat masuk yang
-- memicunya. Aditif sepenuhnya: tidak ada baris, kepemilikan, atau hak akses
-- yang diubah, dan tidak ada backfill.
--
-- Latar belakangnya: migrasi 031 sengaja membuat sdl_leadership_directives
-- "independent from Urmin". Konsekuensinya tidak ada satu pun kolom yang bisa
-- menjawab "surat ini sudah diarahkan atau belum", sehingga antrean surat masuk
-- tidak dapat membedakan surat yang sudah ditangani dari yang dibuka lalu
-- ditinggalkan. Kolom di bawah ini menutup lubang itu.
--
-- NULL tetap sah dan merupakan keadaan mayoritas: arahan ber-kind 'umum',
-- 'sprint', dan 'lainnya' memang tidak berasal dari surat apa pun, dan SELURUH
-- baris yang sudah ada sebelum migrasi ini juga tidak punya asal surat. Karena
-- itu kolomnya nullable tanpa DEFAULT -- baris lama sah apa adanya.

-- 1. Tautan pada arahan yang sudah terkirim.
--    ON DELETE RESTRICT, bukan SET NULL: arahan yang sudah terbit adalah
--    catatan append-only (lihat kepala 031), jadi asal-usulnya tidak boleh
--    hilang diam-diam kalau suatu saat jalur hapus surat ditambahkan. Saat ini
--    tidak ada satu pun DELETE terhadap sdl_urmin_incoming di kedua backend,
--    jadi pembatas ini belum pernah aktif -- ia penjaga untuk nanti.
ALTER TABLE sdl_leadership_directives
 ADD COLUMN incoming_id UUID REFERENCES sdl_urmin_incoming(id) ON DELETE RESTRICT;

-- Satu-satunya pola baca yang dilayani: "adakah arahan untuk surat ini",
-- dipanggil per surat saat daftar surat masuk menurunkan workflowStatus.
-- Parsial karena sebagian besar baris NULL dan baris NULL tidak pernah dicari.
CREATE INDEX sdl_directive_incoming_idx
 ON sdl_leadership_directives(incoming_id)
 WHERE incoming_id IS NOT NULL;

-- 2. Tautan yang sama pada draf privat, supaya autosave tidak kehilangan pilihan
--    suratnya di antara dua ketukan ketik. Di sini ON DELETE SET NULL, BUKAN
--    RESTRICT: draf adalah kertas buram milik satu akun dan tidak boleh menjadi
--    alasan sebuah operasi lain gagal.
ALTER TABLE sdl_leadership_directive_drafts
 ADD COLUMN incoming_id UUID REFERENCES sdl_urmin_incoming(id) ON DELETE SET NULL;
