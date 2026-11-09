# R5F7 — Surat Masuk Fleksibel & Jalur Disposisi

## Baseline

Dibangun di atas R5F6/R5F5 dan backend R3A/R3B/R3C. Migrasi **024** bersifat additive: hanya tabel metadata/intake baru dan izin distribusi untuk role `br_kabagrenmin`. Tabel surat, lampiran, distribusi, disposisi, akun, grants dan histori lama tidak dihapus.

## Operasional

1. **Tambah Surat Masuk** dalam satu modal: nomor, pengirim, tanggal, klasifikasi, perihal, jenis surat, tanggal penting, deadline, keterangan, lampiran, dan keputusan perlu disposisi atau tidak.
2. **Simpan Draft:** metadata surat disimpan; lampiran yang baru dipilih **belum dikirim ke server**. User harus mengajukan surat agar lampiran tersimpan. Draft tetap bisa diedit.
3. **Ajukan Surat:** satu permintaan multipart; backend memvalidasi nilai, nama/MIME/isi lampiran serta izin; transaksi database membuat/memperbarui surat, meregister, menyimpan metadata dan **seluruh** lampiran, menulis histori/audit, dan bila dipilih, mengirim distribusi kepada **satu akun Kabagrenmin** yang mempunyai grant aktif serta izin penerimaan sesuai klasifikasi. Jika ada kesalahan, seluruh transaksi rollback.
4. **Tidak perlu disposisi:** status `Tercatat · Tanpa Disposisi`. Distribusi langsung melalui jalur lama ditolak; perubahan ke jalur disposisi setelah surat diajukan **belum** disediakan.
5. **Perlu disposisi:** status `Menunggu Disposisi Kabagrenmin`. Penerima perlu membuka **Inbox** dan konfirmasi **Terima**. Setelah itu baru Kabagrenmin bisa menggunakan distribusi existing untuk meneruskan ke personel unit. Surat lain tidak bisa melewati Kabagrenmin secara diam-diam melalui endpoint distribusi lama.
6. Tabel daftar menunjukkan status workflow dari metadata baru. Surat legacy tanpa metadata R5F7 tetap terlihat dengan status existing. Riwayat dan audit sumber tetap digunakan.

## Jenis & tanggal

- Undangan: waktu kegiatan wajib saat **Ajukan**; waktu selesai, lokasi, agenda dan batas konfirmasi opsional.
- Permintaan Data/Dokumen: tanggal batas respons wajib saat **Ajukan**.
- Pemberitahuan / Lainnya: batas respons opsional; Lainnya boleh menyimpan tanggal kegiatan.
- Waktu kegiatan disimpan sebagai waktu lokal WIB (`timestamp without time zone`), bukan jam UTC. Deadline disimpan sebagai `DATE`, terpisah dari kegiatan.
- Format lampiran R3B: PDF/JPG/JPEG/PNG valid dari content, nama aman, lebih dari 0 s/d 5 MiB per file dan maksimal 10 file per surat.

## Prasyarat Kabagrenmin

Sebelum mengajukan surat **perlu disposisi**, pastikan **tepat satu** akun Kabagrenmin aktif: `br_kabagrenmin` dengan grant unit `urmin`, klasifikasi yang mencukupi, akun aktif, `must_change_password=false`, role aktif, dan izin `urmin.distribusi.receive`. Jika tidak tersedia/ambigu, API mengembalikan 409 dan **tidak membuat surat setengah jadi**. Migrasi + seed role mempertahankan `urmin.surat_masuk.distribute` hanya untuk role Kabagrenmin tersebut.

## Batas lingkup / tindak lanjut

- Notifikasi **email**, reminder deadline, sinkronisasi ke Agenda & Rapat, serta proses khusus untuk mengubah surat informatif menjadi memerlukan disposisi **belum diimplementasikan** pada R5F7. Jangan menampilkannya sebagai sudah aktif.
- Dashboard final approval existing R3D3 tetap terpisah; label `Menunggu Review` pada Surat Masuk adalah ringkasan kasar adanya tugas completed, bukan keputusan akhir. Detail status resmi tetap di halaman Disposisi.
- Backend R3B mengizinkan Kabag meneruskan via distribusi, bukan membuat task lintas unit secara langsung. Task mengikuti alur penerimaan/issue R3C dengan batasan unit/hierarki existing.

## Uji manual setelah deploy

- Draft berbagai jenis surat; refresh; edit lagi; cek metadata.
- Ajukan tanpa disposisi dengan 1 PDF dan 1 JPG; refresh, preview & download lampiran; cek status tercatat dan tidak ada Inbox Kabag.
- Ajukan perlu disposisi dengan akun Kabag unik; cek status Menunggu Disposisi, Inbox Kabag, Terima, lalu distribusi ke unit; cek status Didistribusikan.
- Negative: akun Kabag tidak aktif/ganda, lampiran melebihi limit, file salah format, versi draft stale, user tak berizin; jangan ada surat/attachment/distribusi sebagian.
- Verifikasi akun Kabag dan Urmin tetap tidak memperoleh hak admin identitas baru.

## Recovery

Installer membuat backup source sebelum pemasangan. Migrasi 024 **additive dan tidak otomatis di-rollback** oleh restore source. Jangan menjalankan migrasi turun/destruktif. Pulihkan source dari backup hanya setelah memastikan kompatibilitas kode dengan schema yang sudah maju.
