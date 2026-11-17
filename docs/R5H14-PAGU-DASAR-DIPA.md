# R5H14 — Pagu wajib berdasar DIPA yang sah

Status: di-commit dan di-push ke `main` (`2cc2556`, 2026-11-16); belum dideploy ke produksi (migrasi 052).

## Latar

Dalam praktik, DIPA terbit lebih dulu dan **menetapkan** pagu per kegiatan.
Sebelumnya aplikasi membalik urutan itu: "dasar" pagu hanya teks bebas, dan
dokumen perencanaan tidak tersambung ke pagu. Keputusan pemilik sistem
(2026-11-13): **pagu wajib memilih DIPA/Revisi DIPA yang sudah disahkan.**

## Alur

1. PROGAR → Dokumen Perencanaan: unggah DIPA + PDF → Kasubbagren mengesahkan.
2. PROGAR → Program Anggaran: susun program/kegiatan sesuai DIPA (boleh
   sebelum atau sesudah langkah 1).
3. PAGU → Pagu Anggaran: selama belum ada DIPA sah tahun itu, tampil
   pemberitahuan + tombol "Buka Dokumen Perencanaan", dan "Catat Pagu"
   nonaktif. Setelah ada, "Dasar Pagu" dipilih dari DIPA sah (terpilih
   otomatis bila hanya satu).
4. Kasubbagren mengklik dasar pagu di baris → DIPA terbuka dalam pratinjau →
   dicocokkan → Setujui.
5. Bila DIPA direvisi (Revisi DIPA disahkan) sebelum pagu draft disetujui,
   persetujuan ditolak sampai pagu diarahkan ke revisi terbaru; baris pagu
   menampilkan peringatannya.

Pagu yang sudah ada sebelum migrasi 052 tidak punya rujukan: tetap tampil
dengan teks dasarnya; bila masih draft, harus diubah dan dipilih DIPA-nya
sebelum bisa disetujui.

## Verifikasi

- `verify/r5h11-flow.js` (termasuk 3a & 5a: tanpa DIPA, DIPA draft, TOR,
  DIPA tahun lain, DIPA digantikan) + regresi `r5h12`, `r5h13`: LULUS.
- Demo Chrome tahun 2028 (DIPA dulu → pagu → Kasubbag melihat DIPA → setuju): 12/12.

## Deploy

`-migrate` (052) bersama 049–051.
