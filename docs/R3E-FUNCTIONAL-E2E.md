# SIERA DELTA LIMA — R3E Browser Functional E2E (BagRenmin)

**STATUS: BELUM DIUJI DARI BROWSER.** R3D3 memiliki build/health Mac PASS dan security integration test 17/17 PASS pada 20 Oktober 2026. Jangan menyamakan security suite Go dengan browser E2E.

## Readiness terlebih dahulu

Jalankan `bash ./scripts/r3e-readiness.sh` dari project root. Script hanya `SELECT` di transaksi `BEGIN READ ONLY`; tidak membuat akun/grant/surat. Lihat `BLOCKED:*` dan perbaiki **hanya izin yang diperlukan** via login Superadmin → Role & Permission Editor. Role default dari bulk seed dibuat SEBELUM modul disposisi baru sehingga izin issue/execute/review/forward/final memang belum otomatis dipasang. Tidak perlu reset database.

Perhatikan: jika `BLOCKED:CHANGE_PASSWORD_FIRST`, gunakan login normal akun bersangkutan dan ganti password terlebih dahulu. Jangan berbagi password dalam log. Setiap role harus punya active scope/unit grant dan klasifikasi `biasa` minimal. `kabagrenmin` hanya boleh final monitor dan approve pada unit yang sesuai; Superadmin tetap tidak bisa mengakses data operasional.

## Uji transaksional (surat **dummy** klasifikasi Biasa, jangan data sungguhan)

Lakukan di `http://127.0.0.1:5174` dengan browser/Incognito terpisah agar session tidak tertukar. Gunakan nomor unik, misalnya `E2E-R3E-20261020-01`; lampiran hanya PDF/JPG/PNG dummy tidak mengandung data personal.

1. **Operator Urmin (`op-urmin`)**: Login → Surat Masuk → buat Draft → Register → upload lampiran dummy (jika permission aktif) → distribusikan ke `kasubbagren`. Verifikasi histori status Surat Terdaftar dan Dikirim; refresh.
2. **Kepala Subbagren (`kasubbagren`)**: Login → Inbox Distribusi → konfirmasi Terima → terbitkan disposisi utama kepada `staf-subbagren`. Isi instruksi >=8 karakter dan tenggat beberapa hari ke depan. Pastikan tugas muncul setelah refresh.
3. **Staf Subbagren (`staf-subbagren`)**: Login → Tugas Disposisi → terima → (jika menguji hierarchy) Teruskan kepada `op-subbagren`, due date tidak melebihi induk. Jangan selesaikan tugas induk sebelum child selesai + approved.
4. **Operator Subbagren (`op-subbagren`)**: Login → tugas turunan → Terima Tugas → Selesaikan dengan hasil minimal 8 karakter. Staf pemberi child melakukan Review → Setujui Hasil; lalu menyelesaikan tugas induknya. Kepala Subbagren mengulas → Setujui Hasil.
5. **Kepala Subbagren (`kasubbagren`)**: Ajukan Approval Akhir setelah seluruh rantai reviewed approved. Progres maksimum 90% sebelum final approval, refresh browser.
6. **Kabagrenmin (`kabagrenmin`)**: Monitoring Approval → lihat record surat uji → Review → Approve Final dengan alasan. Verifikasi progres menjadi **100% hanya setelah approved**, histori dan refresh tetap konsisten.

Jika menguji **depth 2 (3 level forwarding)**, dibutuhkan penerima keempat yang distinct dalam unit yang sama. Roster `kasubbagren` + `staf-subbagren` + `op-subbagren` hanya 3 akun; anti-loop mencegah orang yang sama dipilih lagi. Jangan menonaktifkan anti-loop untuk mengejar kedalaman maksimal.

## Negatif dan evidence

- **Superadmin** login: semua menu unit tetap terkunci, akses API operasional harus ditolak.
- **User yang tidak ditunjuk**: surat/disposisi tidak boleh tampil atau terbuka, termasuk lampiran. Uji dengan user lain yang tidak menjadi penerima, tetapi jangan meneruskan URL/ID sensitif keluar lingkungan lokal.
- **Review sendiri** harus ditolak; **approval final dua kali** harus ditolak; perubahan permission/grant harus memengaruhi akses setelah dicabut.
- **Tenggat/SLA**: periksa indikator aktual. Jangan mengubah jam sistem secara langsung.
- Simpan screenshot tanpa data dinas asli/secrets dan catat PASS/FAIL setiap langkah. Otomatisasi test Go sudah 17/17, tetapi hasil dari aplikasi browser harus ditandatangani terpisah.

## Definisi kelulusan

`R3E Browser E2E PASS` hanya apabila semua tahap login–register–distribute–receive–issue–forward–complete–review–final approve serta uji negatif yang disepakati benar-benar diamati bekerja, histori/progres persisten setelah refresh, dan tanpa temuan blocker. Selama belum dicoba, jangan mengubah statusnya menjadi PASS.
