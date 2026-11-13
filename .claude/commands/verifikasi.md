---
description: Jalankan gerbang uji yang relevan dengan perubahan di branch ini
---
Tentukan area yang berubah dari `git diff --name-only main...HEAD` dan `git status`, lalu jalankan
gerbang yang relevan. Laporkan hasilnya dalam satu tabel (gerbang · hasil · catatan).

- Frontend berubah → `npm run build` di apps/frontend.
- Backend Go berubah (termasuk migrasi) → `docker build -q -t sdl-ci-api apps/backend`.
- Kedua suite keamanan SELALU dijalankan selama dua backend hidup:
  `bash scripts/security-test-r2d5.sh` dan `bash scripts/security-test-express.sh`.
- Express berubah → `npm run verify` di apps/backend-express, ditambah verify script fitur terkait.
- Harness golden (`npm run harness:compare`) hanya jika stack sedang `up`. Ingat: jalankan
  `harness seed-docs` lebih dulu (lihat MIGRATION-PLAN.md). Kalau stack mati, JANGAN menyalakan
  atau merekam ulang golden sendiri — cukup laporkan bahwa gerbang ini belum dijalankan.

Docker Desktop harus berjalan. Kalau tidak, laporkan gerbang mana yang tertunda.
Jangan memperbaiki kegagalan di zona kripto/otorisasi tanpa persetujuan saya.
