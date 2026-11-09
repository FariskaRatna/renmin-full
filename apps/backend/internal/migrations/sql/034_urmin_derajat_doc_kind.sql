-- R5G1: derajat surat masuk, dan pemisahan berkas surat dari lampirannya.
-- Aditif sepenuhnya: tidak ada baris, kepemilikan, atau hak akses yang diubah.
--
-- Dua kolom, keduanya dengan DEFAULT sehingga baris yang sudah ada tetap sah
-- tanpa UPDATE. Itu syarat migrasi di sini: runner menerapkannya dalam satu
-- transaksi dan menolak kalau checksum berubah, jadi backfill yang keliru tidak
-- bisa diperbaiki dengan mengedit berkas ini.

-- 1. Derajat kecepatan. Terpisah dari `classification` dan TIDAK ikut dalam
--    keputusan otorisasi mana pun: classification mengatur siapa boleh melihat,
--    derajat hanya mengatur seberapa cepat harus ditangani. Mencampurnya ke
--    Engine A akan mengubah arti classification_limit pada grant yang sudah ada.
-- CHECK ditulis dengan OR, bukan IN(...), karena pemeriksa keamanan migrasi
-- membelah klausa ALTER TABLE pada koma; koma di dalam IN akan terbaca sebagai
-- klausa kedua yang bukan ADD COLUMN. Artinya identik.
ALTER TABLE sdl_urmin_incoming
 ADD COLUMN derajat VARCHAR(12) NOT NULL DEFAULT 'biasa'
 CHECK (derajat = 'biasa' OR derajat = 'kilat');

-- Daftar surat masuk disaring dan diurut per status; tag derajat ikut dibaca di
-- jalur yang sama, jadi indeksnya mengikuti bentuk query itu.
CREATE INDEX sdl_urmin_incoming_derajat_idx
 ON sdl_urmin_incoming(derajat, received_date DESC);

-- 2. Jenis berkas. 'surat' = naskah suratnya sendiri, 'lampiran' = berkas
--    pendukung. Default 'lampiran' membuat seluruh berkas yang sudah tersimpan
--    tetap muncul di tempatnya sekarang (bagian bawah), bukan tiba-tiba
--    terangkat jadi naskah utama.
--
--    Sengaja TANPA unique index "satu surat per naskah". Dua alasan: berkas
--    lama tidak punya penanda sehingga constraint apa pun harus menebak, dan
--    menambah constraint lewat migrasi berikutnya jauh lebih murah daripada
--    mencabutnya setelah data terlanjur ditolak.
ALTER TABLE sdl_urmin_incoming_attachments
 ADD COLUMN doc_kind VARCHAR(10) NOT NULL DEFAULT 'lampiran'
 CHECK (doc_kind = 'surat' OR doc_kind = 'lampiran');

CREATE INDEX sdl_urmin_attachments_kind_idx
 ON sdl_urmin_incoming_attachments(incoming_id, doc_kind, created_at, id);
