-- R5H7: pesanan nomor urut surat keluar saat tombol "Tambah" ditekan.
--
-- Keputusan pemilik sistem (2026-11-10): Kode Register Internal (nomor urut,
-- segmen ke-2 nomor surat) harus SUDAH terlihat begitu staf menekan "Tambah
-- Surat Keluar", karena staf sering hanya butuh angka itu untuk mengetik
-- naskah PDF di luar aplikasi, lalu mengajukannya belakangan.
--
-- Sebelumnya (R5G13, 039) nomor diambil saat draf disimpan. Sekarang diambil
-- lebih awal dan dicatat di sini sebagai PESANAN milik satu akun; saat draf
-- disimpan, nomor pesanan itulah yang dipakai, bukan nomor baru.
--
-- Pesanan yang belum terpakai dikembalikan lagi kepada akun yang sama pada
-- "Tambah" berikutnya (tahun yang sama), sehingga menekan Tambah lalu Batal
-- berulang kali TIDAK menghabiskan nomor. Lubang hanya terjadi kalau pesanan
-- ditinggalkan sampai tahun berganti -- konsekuensi yang sudah diterima di 039.
--
-- Hanya dipakai backend Express. Go tidak membaca tabel ini; kalau /urmin
-- dikembalikan ke Go, nomor kembali diambil saat draf disimpan seperti dulu.

CREATE TABLE sdl_surat_nomor_reservasi (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 tahun SMALLINT NOT NULL CHECK (tahun BETWEEN 2000 AND 2200),
 urut INTEGER NOT NULL CHECK (urut >= 1),
 reserved_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 reserved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 register_id UUID REFERENCES sdl_urmin_registry(id) ON DELETE RESTRICT,
 used_at TIMESTAMPTZ,
 CONSTRAINT sdl_nomor_reservasi_unik UNIQUE (tahun, urut),
 CONSTRAINT sdl_nomor_reservasi_pakai CHECK ((register_id IS NULL) = (used_at IS NULL))
);

-- Pola baca: pesanan yang belum terpakai milik satu akun pada satu tahun.
CREATE INDEX sdl_nomor_reservasi_terbuka_idx
 ON sdl_surat_nomor_reservasi(reserved_by, tahun, reserved_at)
 WHERE register_id IS NULL;
