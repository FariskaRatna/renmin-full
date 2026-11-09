# SIERA DELTA LIMA — R3D1 Review Hasil & SLA

## Batas fase

**R3D1 saja:** pemberi tugas dapat menilai hasil disposisi selesai, disertai indikator keterlambatan. Ini bukan disposisi multi-level dan bukan persetujuan surat oleh Kabagrenmin otomatis. R3D2 akan mengerjakan hierarki parent/child dan approval tingkat pimpinan secara terpisah setelah browser E2E.

## Aturan keamanan

- Tidak ada permission otomatis untuk role. Admin menambahkan `urmin.disposisi.review` ke role pemberi disposisi jika diperlukan.
- Hanya `issued_by` yang memiliki grant aktif pada unit, `urmin.disposisi.issue`, dan `urmin.disposisi.review` boleh memberi review.
- Surat induk harus masih memiliki distribusi `received` ke pemberi tugas; revokasi grant atau status tidak cocok menyebabkan penolakan.
- Hanya disposisi `completed` yang dapat direview. Satu immutable review (`approved` atau `revision_requested`) per tugas. Teks alasan 8–1000 karakter, versi harus sesuai; audit transaksi wajib.
- `revision_requested` **tidak membuka kembali** status completed atau mengubah histori. Penugasan tindak lanjut dilakukan sebagai tugas baru pada distribusi yang sama (pencatatan tersendiri).
- SLA dihitung berdasarkan tanggal tenggat UTC dan waktu selesai, tanpa job background. `overdue` untuk pending/in_progress melewati tenggat; `completed_late` bila selesai setelah batas hari UTC.
- Tidak ada mutasi akun, kredensial, OTP, data dokumen, atau grant existing.

## API

`POST /api/v1/urmin/dispositions/{taskId}/review` body `{ "decision": "approved"|"revision_requested", "reason": "...", "version": 3 }`, CSRF wajib.

Daftar dan detail task sekarang memuat `reviewStatus`, `reviewReason`, `reviewerName`, `reviewedAt`, dan `slaStatus`. Histori menambahkan event review dari tabel baru.

## Verifikasi

Setelah `./sdl-run.sh` berhasil, jalankan `bash ./scripts/security-test-r2d5.sh`; uji login issuer dan assignee dari browser dengan dokumen sintetis. SMTP nyata, penetration test, dan uji browser lintas-role belum termasuk dalam automated suite.
