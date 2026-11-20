# R5H24 — Dashboard Realisasi Anggaran (menu Data myinterest)

Status: **DIBANGUN lokal (2026-11-20), belum di-commit.** Frontend saja; tanpa migrasi, tanpa API baru.

Permintaan pemilik: bentuk dashboard myinterest mengikuti `mockup/redesign/references/dashboad_ren.jpg`.

- `LraDashboardR5H24.tsx/.css`, dipakai di halaman **Data myinterest (LRA)** saat ada data (fallback: grafik lama).
  Isi: kepala + rentang data (1 Jan – tanggal potret) + Cetak; hero serapan (persentase besar, bilah emas,
  "Rp … telah terealisasi dari Rp … pagu") + kartu sisa anggaran (kegiatan dengan sisa terbesar, tanggal data &
  waktu unduh); empat ringkasan (Pagu, Realisasi, Sisa + % dari pagu, Jumlah Kegiatan + jenis belanja aktif);
  Serapan per Kegiatan (urut pagu terbesar); Komposisi Jenis Belanja (donat realisasi, legenda + nilai, hover);
  Realisasi per Bulan. Tabel rincian, riwayat impor, dan tombol impor tetap di bawahnya.
- Warna donat divalidasi `validate_palette.js` (terang & gelap, lolos semua cek): Barang `#2b5ea8`/`#5a86cf`,
  Modal `#16a07a`/`#22a07b`, Pegawai `#d08a1e`/`#c0821f`, Hibah `#8a5fb0`/`#9670c6`; jenis lain dilipat ke
  "Lainnya" (abu). Warna melekat ke jenis, bukan urutan. Emas terang < 3:1 → legenda selalu menampilkan nilai teks.
- Diperiksa di Chrome 1440 (terang & gelap) dan 390; tanpa error. Lebar 390 masih melebar karena masalah lama
  workspace (tabel rincian), bukan dashboard ini.
