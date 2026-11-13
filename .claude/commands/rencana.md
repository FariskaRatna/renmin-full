---
description: Susun rencana implementasi untuk dokumen rilis (berhenti untuk persetujuan)
argument-hint: <path dokumen rilis>
---
Gunakan subagent `planner` untuk menyusun rencana implementasi dari $ARGUMENTS.

Tambahkan bagian "Rencana Implementasi" ke dokumen itu, yang wajib menjawab:
- Backend mana yang diubah (Express saja / Go saja / keduanya) dan alasannya, mengacu ke Caddyfile.
- Dampak ke kontrak API: endpoint lama TIDAK boleh berubah (aturan migrasi 1).
  Endpoint baru Express-only harus dicatat di apps/backend-express/docs/API-CONTRACT.md.
- Apa yang terjadi kalau prefix ini di-rollback ke Go.
- Migrasi: nomor file berikutnya, isi ringkas, dan pembaruan manifes migrate_test.go.
- Otorisasi: engine A atau B, permission/scope/klasifikasi, dan bukti penyaringan di SQL.
- Berkas yang dibuat/diubah (frontend, Go, Express, docs).
- Pengujian: verify script baru di apps/backend-express/verify/, skenario baru untuk
  security-test-express.sh, dan dampaknya ke harness golden.
- Risiko dan keputusan yang perlu saya setujui.

Tampilkan ringkasannya lalu BERHENTI. Jangan menulis kode sebelum saya setuju.
