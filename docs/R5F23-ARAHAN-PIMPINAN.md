# SIERA DELTA LIMA — R5F23 Arahan Langsung Kabagrenmin

- Independen dari modul URMIN dan Disposisi; surat/Sprint adalah tindak lanjut opsional.
- Hanya Kabagrenmin yang memiliki grant `br_kabagrenmin` aktif dapat membuat arahan.
- Arahan diterbitkan sekali kepada 1–10 staf aktif; tidak ada chat/reply dan isi tidak diedit setelah terkirim.
- Staf hanya melihat arahan yang ditujukan ke akunnya; aksi `read` dan `acknowledged` idempoten per staf.
- Monitoring menampilkan setiap penerima dan waktu baca/konfirmasi, serta jumlah diterima dari total.
- Notifikasi di dalam aplikasi via polling 30 detik: penerima mendapat indikator arahan belum dibaca, Kabag mendapat indikator penerimaan baru.
- Belum termasuk SMS/push/email offline, lampiran, penautan otomatis ke Surat Keluar/Sprint, atau fitur pembatalan. Penyempurnaan membutuhkan keputusan operasional.
- Tidak ada data dummy/backfill; migrasi 031 hanya membuat tabel dan indeks. Tidak mengubah data URMIN.
- Keamanan: CSRF/origin melalui auth middleware, otorisasi Kabag berbasis active grant, penerima valid unit + active grant, tidak memberi akses Superadmin, audit event, batas 1–10 server side.
- Validasi pasca-deploy: Kabag buat arahan 2 staf; staf A baca dan konfirmasi; staf B belum; Kabag melihat monitoring 1/2; akun lain mendapatkan HTTP 404 pada detail.
- Penggunaan di luar kantor mensyaratkan akses HTTPS aman melalui domain internal/VPN. Pengembangan lokal 127.0.0.1 tidak otomatis terjangkau di luar.
