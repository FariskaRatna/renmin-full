# SIERA DELTA LIMA — R5F24 Executive Decision Dashboard

## Fungsi

- `Dashboard` di navigasi utama dan drawer mobile, tampil hanya bila backend memberikan capability `leader` atau `admin`.
- `leader` (Kabagrenmin dengan grant aktif `dashboard.cross_unit.read`): ringkasan agregat URMIN, Arahan Pimpinan miliknya, Subbagren, Subbagsumda, Subbagbinfung. Widget `Perlu Tindakan` dan tombol menuju workspace terkait, filter periode 30/90/365 hari/semua, tren Surat Masuk 6 bulan, refresh otomatis 60 detik.
- `admin` (Superadmin): hanya ringkasan jumlah akun, akun aktif, pergantian password yang tertunda, grant aktif serta grant akan berakhir; pintasan Users/Roles/Roadmap. Tidak menampilkan indikator, dokumen, atau personel operasional.
- Dua endpoint read-only dan role-separated: `GET /api/v1/executive/v2/access`, `GET /api/v1/executive/v2/overview?period=...`.
- Endpoint agregat lama R5F8 (`/api/v1/executive/overview` dan `/api/v1/executive/access`) dinonaktifkan apabila masih tertaut agar Superadmin tidak bisa memakai API lama untuk mengakses agregat operasional.

## Definisi

- *Periode* hanya mempengaruhi indikator alur surat masuk/keluar dan tidak membatasi indikator stok kondisi terkini (status tugas aktif, stok aset, pengajuan menunggu, dsb.).
- *Menunggu arahan* adalah surat pada status `awaiting_kabag` yang belum diteruskan Kabag ke penerima lain.
- *Arahan belum diterima* adalah jumlah penerima (bukan jumlah arahan) dari instruksi yang dikeluarkan Kabag yang belum klik Terima.
- *Disposisi terlambat* adalah tugas belum selesai dengan `due_date` sebelum hari ini menurut WIB.
- *Inventaris perlu perhatian* hanya kondisi yang dikenali eksplisit dalam register; status kosong tidak disimpulkan rusak.
- *SOP belum final* berdasarkan metadata, bukan tanda bukti pengesahan resmi.
- Nilai SQL yang gagal dibaca ditampilkan `—` / `Sumber belum tersedia`, **bukan** 0. Seluruh grafik berasal dari PostgreSQL. Tidak ada data demo atau insert SQL.

## Keamanan / UAT

1. Login Kabagrenmin aktif. `GET /executive/v2/access` harus menghasilkan `leader` dan dashboard memuat angka sumber DB.
2. Login Superadmin. Endpoint yang sama harus menghasilkan `admin`, dan respons dashboard **tidak** memuat kartu URMIN, Arahan, Budget, SUMDA, BINFUNG. Tombol workspace hanya tersedia jika diberikan role nyata oleh server (Superadmin tidak).
3. Login staf biasa. Kedua endpoint harus mengembalikan 403 dan menu Dashboard tidak muncul.
4. Cabut grant Kabag atau `dashboard.cross_unit.read`; login kembali: endpoint wajib menolak 403.
5. Ubah status Arahan (penerima mengonfirmasi), refresh/dashboard setiap 60 detik: hitungan penerima belum konfirmasi diperbarui.
6. Uji desktop, tablet dan ponsel; hamburger harus membuka Dashboard bagi Kabag/Superadmin, tidak muncul untuk staf biasa.
7. Pastikan klik perhatian menavigasi ke workspace yang benar dan semua izin detail tetap dipaksakan backend.
8. Simulasikan sumber SQL tidak tersedia: tampil `—`, bukan angka palsu. Tes zero-data: tampil 0 jika tabel tersedia dan kosong.
9. Verifikasi R5F23C (mobile navigation), R5F22 (notifikasi Surat Masuk), Disposisi URMIN, dan Roadmap tidak regresi.

**Belum diuji pada database live** hanya source syntax dan simulator patch sebelum pemasangan di Mac pengguna. Tiap metrik butuh penyelarasan SOP pemilik proses sebelum dipakai sebagai dasar target resmi/KPI penilaian individu.
