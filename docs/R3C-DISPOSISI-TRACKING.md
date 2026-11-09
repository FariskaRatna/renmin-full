# SIERA DELTA LIMA R3C — Disposisi & Tracking

## Alur tahap pertama (satu level, satu unit)

1. Operator Urmin membuat dan meregister surat melalui R3A, lalu mendistribusikannya ke penerima yang spesifik (R3B).
2. Penerima (contoh Kasubbagren) login dan menekan **Konfirmasi Diterima** di Inbox Distribusi.
3. Role Kasubbagren perlu permission `urmin.disposisi.issue` dalam grant unit Subbagren aktif. Role petugas tujuan perlu `urmin.disposisi.execute` dalam grant Subbagren aktif, klasifikasi memadai.
4. Penerima distribusi memilih **petugas satu unit** dari kandidat eligible, mengisi arahan, dan tenggat (hari ini sampai 1 tahun ke depan). Task muncul di **Tugas Disposisi** bagi penerima dan pemberi tugas.
5. Penerima tugas melakukan **Terima Tugas**, kemudian **Selesaikan Tugas** dengan keterangan hasil. Status dan alasan tercatat di tabel event append-only dan audit.
6. Role Urmin dengan gabungan `urmin.surat_masuk.read` dan `urmin.disposisi.read` dalam scope surat dapat melihat **Monitoring Disposisi** di detail surat, tanpa mendapat hak mengubahnya.

## API operasional

| Method | Endpoint | Syarat tambahan |
|---|---|---|
| GET | `/api/v1/urmin/distribution-inbox/{distributionId}/disposition-candidates` | Distribusi received, actor penerima, permission issue |
| POST | `/api/v1/urmin/distribution-inbox/{distributionId}/dispositions` | Sama + assignee eligible, instruksi, tenggat |
| GET | `/api/v1/urmin/dispositions/` | Hanya task tempat actor merupakan issuer/assignee dan grant masih valid |
| GET | `/api/v1/urmin/dispositions/{taskId}/history` | Party task yang masih eligible |
| POST | `/api/v1/urmin/dispositions/{taskId}/accept` | Assignee; pending; body reason,version |
| POST | `/api/v1/urmin/dispositions/{taskId}/complete` | Assignee; in_progress; body reason,version |
| GET | `/api/v1/urmin/surat-masuk/{id}/disposition-tracking` | Surat readable dan permission read disposisi |

Semua API berada di bawah sesi operasional R2B, CSRF untuk mutasi dan pengecualian Superadmin di backend.

## Batas keamanan

- Disposisi ditujukan ke user **secara eksplisit**, tidak memberikan akses baca ke staf lain pada unit yang sama.
- Grant pemberi dan penerima diperiksa ulang pada operasi sensitif, termasuk download lampiran. Revoke/expiry menutup akses.
- Tidak ada mutasi pada akun lama, OTP, role grant atau volume PostgreSQL. Migration 011 hanya menambahkan dua permission katalog dan dua tabel + indeks.
- Tidak ada permission baru yang otomatis ditambahkan pada role yang sudah ada.
- Disposisi satu level, bukan recursive delegation / transfer lintas unit; belum ada approval pejabat berjenjang.
- Belum ada malware scanning dokumen, SMTP riil, atau browser E2E; bukan approval production.
