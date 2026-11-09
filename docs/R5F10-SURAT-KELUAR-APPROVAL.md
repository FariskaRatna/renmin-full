# R5F10 — Surat Keluar: Persetujuan & Tahapan Resmi

Status: **Approval inti selesai di source; TTE tersertifikasi dan email resmi tidak diaktifkan.**

## Tujuan

- Pertahankan tab/pill status horizontal, beri jarak dari toolbar.
- Hilangkan catatan teknis pencatatan manual dan input status administrasi yang bisa disetel sembarangan.
- Tambahkan alur nyata: **Draft → Menunggu Approval → Disetujui** / **Perlu Revisi**.
- Keputusan approval **hanya oleh Kabagrenmin** dengan akun aktif, role aktif, grant unit aktif, klasifikasi yang sesuai, dan permission khusus.
- Superadmin biasa tidak otomatis mendapat hak approval atau akses dokumen.
- Audit trail dan hash source (data register + daftar digest file aktif) untuk mendeteksi perubahan antara submit dan approval.

## Penggunaan

1. Petugas URMIN membuat surat, mengisi tujuan, menyimpan berkas PDF via modal.
2. Dari daftar surat, tombol **Proses** → **Ajukan ke Kabagrenmin**.
3. Setelah pengajuan, surat dan lampiran terkunci (termasuk endpoint Berkas Kerja).
4. Kabagrenmin masuk ke Surat Keluar → Proses; dapat **Setujui** atau **Kembalikan untuk Revisi** dengan alasan minimal 8 karakter.
5. Jika dikembalikan, petugas dapat mengubah data/file dan mengajukan ulang; semua keputusan tetap di riwayat.
6. Jika disetujui, status **Disetujui · Menunggu TTE**. Dokumen belum ditandatangani, belum diterbitkan, dan belum dikirim.

## Status lama

`fields.statusAdministrasi` yang sebelumnya diisi petugas tidak lagi menjadi status resmi. Data lama dipertahankan. Record berstatus manual **selain Draft** menjadi **Perlu Verifikasi**, bukan disalahartikan sebagai Draft/Disetujui/Terkirim. Untuk memproses record historis tersebut dalam workflow baru dibutuhkan pemeriksaan dan tindakan rekonsiliasi terpisah. Ini tidak menghapus berkas, lampiran, atau sejarah data.

## Belum diaktifkan — wajib sebelum go-live penuh

- **TTE tersertifikasi**: identitas penandatangan, kewenangan menurut SOP, akun/sertifikat PSrE Indonesia, integrasi API resmi, signing challenge/2FA, verifikasi PDF bertanda tangan dan audit transaksi. Jangan tempel gambar TTD lalu menganggapnya tersertifikasi.
- **Pengiriman elektronik**: SMTP resmi dengan TLS, alamat penerima terverifikasi, persetujuan dan validasi TTE sebelum send, idempotency dan outbox/retry, audit Message-ID dan delivery errors. Jangan menandai "Terkirim" hanya dari HTTP 200 atau hasil UI.
- Review SOP untuk pejabat penandatangan, nomor surat resmi, jenis surat dan eskalasi.

## Migrasi & sumber

- `025_outgoing_review.sql`: dua tabel additive (workflow dan event), izin approve hanya ke role `br_kabagrenmin`; legacy status tidak dijadikan bukti approval.
- `urmin_register.go`: workflow routes, checksum/perubahan registry terkunci.
- `work.go`: pengamanan update/delete file dan record bila surat sudah diajukan.
- `outgoing_review.go`: transisi state, bukti hash, histori dan check Kabagrenmin.
- `UrminR5D.tsx` dan `SuratKeluarR5F9.css`: modal Proses dan pill yang lebih lega.

## Acceptance test manual

- Login URMIN; buat surat tanpa PDF; submit ditolak.
- Upload PDF, isi tujuan, submit; status Menunggu Approval.
- Setelah submit, edit/hapus lampiran di form ataupun Berkas Kerja ditolak.
- Login non-Kabagrenmin: tidak bisa approve atau reject (403 server-side).
- Login Kabagrenmin dengan grant valid: approve atau reject berhasil dan tercatat di histori.
- Setelah reject: URMIN bisa revisi dan mengajukan ulang.
- Superadmin tidak bisa approve, dan tidak ada tombol palsu TTE/Send.
- Coba dua tab browser simultan: request kedua mendapat conflict 409 (workflow_state_changed).
- Pastikan data dan ledger existing tetap ada.
