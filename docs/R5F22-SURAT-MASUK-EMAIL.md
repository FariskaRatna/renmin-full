# R5F22 – Notifikasi email Surat Masuk ke Kabagrenmin

- Email dibuat hanya setelah pengajuan Surat Masuk dengan `needsDisposition=true` berhasil dirutekan ke satu Kabagrenmin yang eligible.
- Enqueue dilakukan dalam transaksi yang sama dengan surat, lampiran, dan distribusi. Kegagalan menyimpan antrean akan membatalkan transaksi.
- Outbox R5F12 untuk tugas disposisi tidak diubah. Outbox baru R5F22 memiliki kunci unik distribusi/penerima, maksimal enam percobaan dan lease untuk worker.
- Pesan hanya berisi informasi generik dan navigasi `URMIN > Surat Masuk > Inbox`. Tidak mengirimkan nomor, subjek, isi surat, instruksi, file atau data pribadi.
- Tidak ada email retroaktif. Jika SMTP mati, entri menunggu sampai worker tersedia. Status `sent` hanya berarti SMTP menerima pengiriman.
- Uji pascapasang: login `op-urmin`, submit satu surat Biasa yang membutuhkan disposisi, lalu cek Inbox `kabagrenmin`, catatan outbox, dan mailbox email termasuk Spam. Jangan duplikasi surat.
- Setelah pemasangan, perbarui Roadmap Superadmin hanya jika pengujian fungsional berhasil.
