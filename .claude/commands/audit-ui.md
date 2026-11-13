---
description: Audit UI/UX sebuah halaman atau komponen (tanpa mengubah file)
argument-hint: <nama halaman atau path komponen>, mis. apps/frontend/src/SuratMasuk.tsx
---
Gunakan subagent `ui-ux-designer` untuk mengaudit $ARGUMENTS beserta CSS-nya.

Hasilkan:
1. Ringkasan 3 masalah terbesar yang paling mengganggu pengguna.
2. Tabel temuan lengkap (lokasi · masalah · standar · tingkat · usulan), diurutkan dari dampak terbesar.
3. Rasio kontras yang dihitung untuk pasangan warna teks/latar yang bermasalah, light dan dark.
4. Daftar "perbaikan cepat" yang bisa dikerjakan tanpa mengubah struktur halaman.

JANGAN mengubah file apa pun.
