---
description: Kerjakan fitur sesuai rencana yang sudah disetujui
argument-hint: <path dokumen rilis>
---
Implementasikan fitur sesuai rencana yang sudah disetujui di $ARGUMENTS.

1. Buat branch `feat/<kode-rilis-huruf-kecil>-<nama-singkat>` dari `main`.
2. Kerjakan per lapisan dalam satu domain (route → authz → handler → test), sesuai aturan migrasi 4.
3. Migrasi baru: file BARU dengan nomor berikutnya + perbarui manifes di migrate_test.go.
   Jangan pernah mengedit migrasi lama, dan jangan menyalin SQL ke backend-express.
4. Tulis verify script / skenario keamanan yang direncanakan, bersama kodenya.
5. Perbarui dokumen rilis (Status, dan bagian "Menyimpang dari rencana" bila ada),
   serta API-CONTRACT.md / DEVIATIONS.md bila relevan.
6. Commit per langkah logis, pesan gaya repo ini: `feat(<area>): ...`, `fix(<area>): ...`.
7. Kalau perlu menyimpang dari rencana, berhenti dan tanyakan dulu.
8. Akhiri dengan ringkasan dan daftar uji yang masih perlu dijalankan lewat /verifikasi. Jangan push.
