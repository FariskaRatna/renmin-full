# R5F1 — URMIN Dashboard Operasional & Action Center

## Scope

Dashboard Urmin menggunakan API yang sudah ada; tidak ada migration, perubahan role, atau auto-grant.

- Surat Masuk: `/api/v1/urmin/surat-masuk/` (hasil sesuai akses record)
- Surat Keluar dan Agenda: `/api/v1/urmin/registry/` dengan filter jenis
- Inbox Distribusi: `/api/v1/urmin/distribution-inbox/` (surat dialamatkan kepada akun)
- Disposisi: `/api/v1/urmin/dispositions/` (issuer/assignee, diperiksa lagi per task oleh backend)

Dashboard adalah read-only; CRUD dan perubahan status dilakukan pada modul sumber. Setiap data dilindungi role, active unit grant, klasifikasi, serta alamat penugasan sesuai endpoint masing-masing.

## Fungsi yang dicakup batch ini

| Fungsi | Implementasi | Verifikasi |
| --- | --- | --- |
| KPI surat masuk/keluar | Periode 30/90/365 hari dan semua waktu | Mac/browser pending |
| KPI tindak lanjut/terlambat | Berdasarkan tugas yang diberikan kepada akun dan inbox personal; bukan seluruh unit | Mac/browser pending |
| Grafik surat masuk/keluar | Interaktif, klik interval untuk memfilter aktivitas terbaru | Mac/browser pending |
| Status disposisi | Pending, proses, terlambat, menunggu review | Mac/browser pending |
| Action Center | Prioritas overdue → inbox → menerima tugas → review → proses | Mac/browser pending |
| Agenda terdekat | Tanggal agenda bisnis, bukan tanggal pembuatan record | Mac/browser pending |
| Recent activity | Ke modul/record asal saat tersedia | Mac/browser pending |
| Quick access | Ke Surat Masuk, Surat Keluar, Inbox, Disposisi, Agenda | Mac/browser pending |
| Hak akses | Mengikuti filter endpoint masing-masing; data tidak tersedia ditandai secara eksplisit | Mac/browser pending |

**Batas ketepatan angka:** endpoint existing membatasi daftar surat/agenda/tugas. Bila batas terpenuhi, dashboard menandai `+` dan mencatat keterbatasan; angka bukan statistik final seluruh unit. Khusus status/aksi, angka berorientasi akun login, bukan kinerja organisasi. Next batch bisa menambah endpoint ringkasan berbasis aggregation SQL dengan policy sama jika diperlukan untuk volume besar.

## Target penyelesaian URMIN, belum final

Tahapan berikutnya: R5F2 Inbox Distribusi (penerimaan, file, histori, filter dan role); R5F3 Disposisi (issue/receive/forward/review/final approval); R5F4 Surat Masuk/Keluar (nomor, lampiran, audit, status); R5F5 Agenda/Arsip & role matrix; R5F6 Browser E2E role-by-role + regresi tanpa data nyata. Urmin dianggap final setelah E2E per role lulus, bukan setelah build saja.

## Role/functional acceptance gates

- Superadmin biasa tetap hanya identity/role management; mode workspace khusus lokal tidak boleh menjadi bukti production authorization.
- Operator Urmin: register surat sesuai izin; distribusi hanya ketika izin dan grant sah.
- Penerima distribusi: hanya surat dialamatkan kepadanya, dapat acknowledge jika eligible.
- Pemberi disposisi: hanya dapat issue dari distribusi yang telah diterima dan punya permission relevan.
- Penerima disposisi: tugasnya sendiri saja; menerima, menyelesaikan, meneruskan sesuai permission & chain.
- Reviewer/pejabat: review/approval menurut unit dan permission aktif; self-approval dan lintas unit tidak diperbolehkan.
- Cabut grant saat user login aktif → operasi mutasi berikutnya wajib ditolak.
- Uji fungsional dua user, perbedaan klasifikasi Biasa/Penting, serta file preview PDF dan gambar.
