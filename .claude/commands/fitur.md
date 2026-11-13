---
description: Mulai fitur baru — susun dokumen rilis docs/<KODE>-<NAMA>.md (tanpa kode)
argument-hint: <KODE-RILIS> <deskripsi singkat>, mis. R5H9 lampiran surat keluar bisa diganti
---
Fitur baru: $ARGUMENTS

1. Baca CLAUDE.md, docs/ROADMAP.md, dan dua dokumen rilis terbaru sebagai contoh gaya
   (mis. docs/R5H7-TTD-KABAG-SURAT-KELUAR.md).
2. Cek di infra/Caddyfile prefix API mana yang sudah dilayani Express dan mana yang masih Go.
3. Ajukan maksimal 5 pertanyaan klarifikasi kepada saya (sebagai "pemilik sistem"), terutama
   yang menyangkut keputusan: siapa yang boleh (role/scope/klasifikasi), alur status,
   data sensitif, dan apa yang di luar cakupan. Tunggu jawaban.
4. Setelah dijawab, buat `docs/<KODE>-<NAMA-KEBAB-KAPITAL>.md` dengan bagian:
   Status · Kebutuhan (kata pemilik) · tabel Keputusan · Alur · Backend yang melayani ·
   Endpoint baru/berubah · Migrasi · Otorisasi (engine A/B, permission, scope) ·
   Rencana uji (verify script, skenario keamanan) · Di luar cakupan.
5. JANGAN menulis kode di tahap ini.
