# SIERA DELTA LIMA — R5F6 Surat Masuk Modal & Upload

## Ruang lingkup

- **Tambah Surat** dan **Edit Draft** dibuka melalui modal yang responsif, tanpa menggeser tabel.
- Toolbar daftar dan baris surat terdaftar menampilkan **Upload Lampiran**. Detail surat menyediakan tombol upload yang sama.
- Modal upload mendukung pemilihan surat terdaftar, multi-file, drag & drop, nama file/tipe/ukuran, alasan, daftar antrean, dan progres upload per file.
- Backend R3B tetap membatasi PDF/JPG/JPEG/PNG, maksimal **5 MiB per file**, **10 file per surat**, validasi konten dan nama aman, audit alasan, CSRF serta pengecekan permission.
- Proses tetap **Buat Draft → Register Surat (konfirmasi modal) → Upload Lampiran**. Upload pada draft tidak diizinkan backend; tidak ada auto-registrasi diam-diam.
- Upload per file adalah operasi independen; jika salah satu gagal, file sebelumnya yang sudah tersimpan **tidak di-rollback**. UI menampilkan jumlah yang berhasil dan mempertahankan antrean yang belum diunggah.
- List lampiran, distribusi dan disposisi dari R3B/R3C tetap tersedia pada detail surat. Tidak ada API atau skema baru.

## Perubahan file

- `apps/frontend/src/SuratMasuk.tsx`
- `apps/frontend/src/SuratR3B.tsx`
- `apps/frontend/src/SuratMasukR5F6.css` (baru)
- `docs/R5F6-SURAT-MASUK-MODAL-UPLOAD.md` (baru)

## Uji fungsional yang perlu dilakukan

1. Daftar Surat → **Tambah Surat** → modal → validasi → Simpan Draft → detail berisi data baru.
2. Draft → Edit Draft → modal → Simpan → history versi bertambah.
3. Draft → Register Surat → modal konfirmasi → surat terdaftar (draft terkunci).
4. Surat terdaftar → Upload Lampiran → pilih file PDF/gambar valid → alasan → unggah → lampiran tampil pada detail; unduh berhasil.
5. Tolak file >5 MiB / ekstensi selain PDF/JPG/PNG / nama file tidak sesuai; batasi maksimum total 10.
6. Ganti surat dari tabel saat memuat detail, tes jaringan lambat, tes akses unggah role tanpa permission.
7. Uji dark mode, mobile, Escape/tombol tutup, dan shortcut dashboard ke form Tambah Surat.
8. Pastikan Inbox R5F2, Tugas Disposisi R5F3, Berkas Kerja R5F4, dan navigasi R5F5 tetap bekerja.

## Instalasi

Simpan installer `sdl-r5f6-surat-masuk-modal-upload-install.sh` di `0.sekerips/` lalu dari root project jalankan:

```bash
bash 0.sekerips/sdl-r5f6-surat-masuk-modal-upload-install.sh && ./sdl-run.sh
```

Installer memverifikasi baseline R5F5, melakukan backup dan memeriksa checksum. Tidak mengubah database, API, role, data, ataupun container proyek lain.
