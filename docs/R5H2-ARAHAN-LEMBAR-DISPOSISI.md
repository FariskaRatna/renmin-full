# R5H2 — Arahan membawa lembar disposisi

2026-11-04 · migrasi `041_arahan_lembar_disposisi.sql` · diubah di Go **dan** Express bersamaan

## Yang diminta pemilik sistem

Layar "Buat Arahan" Kabagrenmin meniru lembar disposisi kertas:

| Isian | Perilaku |
|---|---|
| Kepada (Kasubbag) | Bentuk chip + kotak cari seperti sebelum R5H1, **tetap per bagian** |
| No. Agenda | Nonaktif. Terisi otomatis saat bagian yang ditunjuk membuat surat — **tahap 2, belum dikerjakan** |
| Surat dari, Nomor surat, Perihal | Diisi manual (terisi otomatis bila surat tertaut dipilih, tetap bisa diubah) |
| Tanggal | Tanggal arahan dibuat; default hari ini (WIB) |
| Tanggal dibuat surat | Tanggal yang tertulis di surat |
| Klasifikasi | Biasa / Rahasia — menggantikan pilihan "Prioritas" |
| Derajat | Biasa / Kilat |
| Disposisi Kabagrenmin | Chip dari Master Data (awal: Monitor, Arsipkan, Fasilitas) |
| Disposisi lainnya | Teks bebas untuk disposisi di luar daftar |

Judul dan Isi arahan **tetap ada** seperti sebelumnya.

## Kontrak API — hanya bertambah

* `POST /api/v1/leadership/directives` dan `PUT /draft` menerima field opsional
  `sheet` (objek, atau `null`/tidak dikirim). Klien lama tidak terpengaruh.
* `GET /inbox`, `/sent`, `/{id}`, `/draft` mengembalikan `sheet` **hanya bila
  ada** (`omitempty`). Arahan dan draf tanpa lembar diserialisasi byte-identik
  dengan sebelum 041, sehingga golden lama tetap cocok.
* `GET /api/v1/leadership/directives/disposition-options` — baru. Daftar
  `{code,name}` urut nama. Tanpa gerbang Kabagrenmin: penerima arahan juga
  butuh namanya untuk membaca lembar, dan isinya hanya label referensi.
* Master Data (`/api/v1/admin/master/{set}`) mendapat himpunan ketiga
  `disposisi`, di balik guard Superadmin yang sama.

Bentuk `sheet` (urutan kunci = urutan di respons):

```json
{"letterFrom":"","letterNumber":"","directiveDate":"2026-11-04","letterDate":"",
 "subject":"","classification":"biasa","derajat":"biasa",
 "dispositions":["MONITOR"],"dispositionNote":"","agendaNo":null}
```

## Aturan validasi (400 bila dilanggar)

* `classification` ∈ {biasa, penting} dan `derajat` ∈ {biasa, kilat} — wajib
  bila `sheet` dikirim. `penting` berlabel **Rahasia** di layar, sama seperti
  klasifikasi surat.
* Tanggal kosong atau tanggal kalender sah `YYYY-MM-DD`.
* Panjang (dihitung per karakter Unicode): surat dari 200, nomor 100, perihal
  250, disposisi lainnya 1000. Maks. 20 kode disposisi, tanpa duplikat.
* `agendaNo` milik server; permintaan yang mengisinya ditolak.
* Field asing di dalam `sheet` ditolak (validasi strict).

Saat **kirim** (bukan saat simpan draf), tiga gerbang tambahan di dalam
transaksi:

1. Setiap kode disposisi harus ada di `sdl_disposisi_opsi`.
2. Lembar tidak boleh menurunkan klasifikasi surat tertaut: surat Rahasia +
   lembar `biasa` ditolak.
3. Arahan Rahasia hanya boleh sampai pada penerima yang memegang grant
   ber-`classification_limit='penting'` (di unit bagiannya).

Draf sengaja tidak menjalankan gerbang ini — kertas buram tidak boleh gagal
disimpan hanya karena Superadmin menghapus satu opsi.

## Prioritas tidak dihapus dari kontrak

Kolom `priority` tetap ada dan tetap dikirim. Layar menurunkannya dari lembar
(`kilat` bila derajat Kilat, `penting` bila Rahasia, selain itu `biasa`) supaya
badge di daftar arahan tetap bermakna tanpa mengubah kontrak.

## Mengapa JSONB, bukan sepuluh kolom

Lembar selalu dibaca sebagai satu kesatuan dan tidak ada query yang menyaring
per isian. Satu kolom nullable menjaga arti `NULL` = "arahan tanpa lembar"
(seluruh baris sebelum 041) dan membuat migrasi tetap aditif murni.

## Belum dikerjakan (tahap 2)

Pengisian No. Agenda. Saat ini belum ada jalur dari arahan ke pembuatan surat:
Surat Keluar hanya ada di unit Urmin, dan Kasubbagren/sumda/binfung tidak punya
akses ke sana. Perlu dirancang terpisah.
