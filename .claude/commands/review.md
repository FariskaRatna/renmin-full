---
description: Review branch ini sebelum PR (migrasi + keamanan)
---
Review semua perubahan di `git diff main...HEAD`.

1. Gunakan subagent `migration-guard` untuk memeriksa kepatuhan pada 7 aturan migrasi di CLAUDE.md.
2. Gunakan subagent `security-reviewer` untuk memeriksa keamanan.
3. Gabungkan menjadi satu laporan: **Wajib diperbaiki** / **Disarankan** / **Catatan**,
   dengan lokasi file:baris.
4. Jangan mengubah kode. Kalau tidak ada temuan wajib, buatkan draf judul dan deskripsi PR
   ke `main`, termasuk hasil /verifikasi dan apakah deploy nanti butuh centang "Izinkan migrasi".
