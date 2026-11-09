-- R5G6: lampiran hasil tindak lanjut pada tugas disposisi.
--
-- Sampai sekarang "Selesaikan Tugas" hanya menerima catatan teks
-- (`completion_note`). Bukti pekerjaan — foto kegiatan, surat balasan, berkas
-- hasil — tidak punya tempat sama sekali, sehingga pelaksana menempuh jalur di
-- luar sistem dan penerbit menelaah tanpa bisa melihat apa yang dikerjakan.
--
-- Tabel baru, bukan menumpang `sdl_urmin_incoming_attachments`: lampiran di
-- sana milik SURAT dan terlihat oleh siapa pun yang boleh membaca suratnya,
-- sedangkan berkas di sini milik satu TUGAS dan hanya untuk para pihaknya.
-- Menyatukan keduanya akan membocorkan hasil kerja satu unit ke unit lain yang
-- kebetulan ikut membaca surat yang sama.

CREATE TABLE sdl_urmin_disposition_files (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 disposition_id UUID NOT NULL REFERENCES sdl_urmin_disposition_tasks(id) ON DELETE RESTRICT,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 -- Tiga MIME yang sama dengan lampiran surat masuk, dan sengaja tidak lebih.
 -- Daftar ini adalah allowlist; menambah tipe berarti menambah permukaan
 -- serang pada berkas yang kelak dibuka orang lain di peramban.
 mime_type VARCHAR(48) NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg')),
 -- Langsung 10 MiB, batas yang sama dengan lampiran surat masuk sesudah
 -- migrasi 027. Ditulis sekali di sini supaya tidak perlu dilonggarkan
 -- belakangan lewat DROP CONSTRAINT seperti yang terjadi di sana.
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 -- Penjaga yang sama dengan lampiran surat masuk: ukuran yang dicatat harus
 -- benar-benar sama dengan isi yang tersimpan, sehingga baris yang separuh
 -- tertulis tidak bisa lolos.
 CONSTRAINT sdl_disposition_file_body_size CHECK(octet_length(body)=size_bytes),
 CONSTRAINT sdl_disposition_file_filename CHECK(length(btrim(filename)) BETWEEN 1 AND 160)
);

-- Satu-satunya pola baca: seluruh berkas milik satu tugas, urut waktu unggah.
CREATE INDEX sdl_disposition_files_task_idx
 ON sdl_urmin_disposition_files(disposition_id, created_at, id);
