# Penomoran surat keluar — aturan yang sudah disepakati

Status: **TUNTAS** · ditulis 2026-11-03, dirampungkan 2026-11-03

> Seluruh enam segmen nomor surat sudah terbangun dan terverifikasi. Tidak ada
> lagi bagian yang menunggu keputusan maupun kiriman daftar.

Dokumen ini menahan aturan penomoran nomor surat dinas supaya keputusan yang
sudah diambil tidak perlu ditanyakan dua kali.

## Bentuk nomor

```
B / ND - 157 / X / HUM.1.2. / 2026 / Bagrenmin
│   │     │    │       │        │        │
1a  1b    2    3       4        5        6
```

| # | Segmen | Isi | Sumber | Keadaan |
|---|---|---|---|---|
| 1a | `B` | **derajat** surat: Biasa=`B` \| Kilat=`K` | field `sifatSurat` (label "Derajat") | **tuntas** |
| 1b | `ND` | **jenis surat** (`ND` = Nota Dinas) | master `sdl_surat_jenis` | **tuntas** |
| 2 | `157` | nomor urut | `sdl_surat_nomor_urut`, satu deret per tahun | **tuntas** |
| 3 | `X` | bulan berjalan, angka Romawi | jam sistem saat nomor dibuat | **tuntas** |
| 4 | `HUM.1.2.` | kode arsip tempat surat disimpan | master `sdl_surat_kode_arsip` | **tuntas** |
| 5 | `2026` | tahun berjalan | jam sistem saat nomor dibuat | **tuntas** |
| 6 | `Bagrenmin` | unit | pilihan petugas, field `unitNomor` | **tuntas** |

> **Koreksi 2026-11-03.** Versi pertama dokumen ini mencatat `B/ND` sebagai satu
> nilai bernama "klasifikasi surat". Itu salah. `B/ND` adalah **dua field yang
> digabung**: derajat dan jenis surat — keduanya sudah ada di formulir sejak
> R5G9, tinggal nilainya yang perlu punya kode huruf.

## Keputusan yang sudah diambil

**Nomor urut direset tiap tahun.** Deretnya kembali ke 1 setiap 1 Januari.
Tahun ikut tercetak di nomor, jadi `157/2026` dan `157/2027` tidak pernah
bentrok.

**Nomor diberikan saat draf dibuat**, bukan saat disetujui. Konsekuensinya
diterima secara sadar: draf yang batal meninggalkan lubang pada deret, dan
lubang itu tidak bisa diisi ulang tanpa merusak sifat sekali-pakai nomor.

**Akhiran unit dipilih petugas**, lewat satu pilihan "internal subbag" lawan
"keluar subdit" di formulir. Sistem tidak menebaknya dari isian **Kepada**
yang berupa teks bebas.

- internal subbag → nama subbagnya, misalnya `/Subbagren`
- keluar subdit → tetap `/Bagrenmin`, siapa pun pengajunya

**Kode arsip dicari dengan mengetik nama perkaranya**, bukan kodenya. Petugas
mengetik `buku tamu`, sistem menjawab `HUM.1.2.`.

**Klasifikasi tetap Biasa dan Penting**, dan karena itu **tidak ada yang perlu
diubah**. Permintaan awal sempat menyebut nilai ketiga "Lainnya"; itu dicabut.
Kolom `classification` di `sdl_unit_work_records` sudah persis berisi dua nilai
itu dan ikut menentukan hak akses lewat `permit()` — menambah nilai ketiga akan
menuntut perubahan CHECK constraint sekaligus menggeser arti otorisasinya di
empat unit sekaligus. Semuanya terhindar.

**Derajat dan Klasifikasi adalah dua hal berbeda**, dan hanya derajat yang
masuk ke nomor surat. Derajat menyatakan seberapa cepat ditangani (Biasa,
Kilat); klasifikasi menyatakan siapa boleh membukanya (Biasa, Penting).

## Yang sudah terbangun

| Rilis | Isi |
|---|---|
| R5G10 | Migrasi **037** `sdl_surat_kode_arsip` + 701 kode · endpoint **147** pencarian · pemilih di formulir |
| R5G12 | Migrasi **038** `sdl_surat_jenis` · endpoint **148–152** · Settings Master Data di Superadmin |
| R5G13 | Migrasi **039** `sdl_surat_nomor_urut` · perakitan nomor saat draf dibuat · field Lingkup Surat |

**Satu deret untuk seluruh Bagrenmin.** Nomor 157 berarti surat keluar ke-157
pada tahun itu — tidak peduli subbag mana yang mengajukan maupun apa jenis
suratnya. Bukan deret terpisah per subbag, bukan per jenis.

**Bulan dan tahun dari jam sistem saat nomor dibuat**, bukan dari Tanggal Surat.
Konsekuensinya perlu diketahui petugas: draf yang dibuat 1 November untuk surat
bertanggal 28 Oktober akan bernomor `/XI/` sementara kop suratnya tertulis
Oktober.

**Akhiran unit yang sah** ada lima: `Bagrenmin` untuk surat keluar subdit, dan
`Urmin` · `Subbagren` · `Subbagsumda` · `Subbagbinfung` untuk surat internal.
Nilai di luar itu ditolak `400 unit_nomor_required`.

## Bagaimana nomor diambil

Satu baris per tahun di `sdl_surat_nomor_urut`, dan baris itulah yang dikunci:

```sql
INSERT INTO sdl_surat_nomor_urut(tahun) VALUES($1)
ON CONFLICT(tahun) DO UPDATE SET nomor_terakhir = sdl_surat_nomor_urut.nomor_terakhir + 1
RETURNING nomor_terakhir
```

`ON CONFLICT DO UPDATE` mengambil row lock, jadi penambahannya atomik tanpa
`SELECT ... FOR UPDATE` terpisah dan tanpa celah antara baca dan tulis.

Pengambilan itu berada **di dalam transaksi pembuatan surat**. Kalau penyimpanan
suratnya gagal, nomor yang terlanjur diambil ikut dibatalkan — tanpa itu setiap
kegagalan penyimpanan akan membakar satu nomor.

Empat bagian wajib ada sebelum transaksi dibuka, masing-masing dengan kode
errornya sendiri: `derajat_required`, `jenis_surat_required`,
`kode_arsip_required`, `unit_nomor_required`.

## Rincian tiap segmen

### 1a. Derajat

**Nilainya sudah pasti: `Biasa` dan `Kilat`** — sama persis dengan derajat
surat masuk (migrasi 034), sehingga tidak ada dua daftar derajat berbeda di
dalam satu aplikasi.

Pilihan lama `Penting` dan `Segera` sudah dicabut (R5G11). Keduanya warisan
label "Sifat" sebelum diganti menjadi "Derajat"; `Penting` sebenarnya
klasifikasi dan sudah punya tempatnya sendiri.

**Kode hurufnya sudah pasti** (dikonfirmasi 2026-11-03):

| Derajat | Kode |
|---|---|
| Biasa | `B` |
| Kilat | `K` |

Segmen 1a karena itu **tuntas** — tidak ada lagi yang ditunggu untuk bagian ini.

> Surat keluar yang terlanjur bernilai `Penting` atau `Segera` **tidak
> kehilangan isiannya**. Formulir menampilkan nilai lama yang sudah tidak ada
> di daftar sebagai pilihan tersendiri bertanda "(nilai lama)", sehingga
> menyunting surat itu karena alasan lain tidak diam-diam mengosongkannya.

### 1b. Jenis surat — dikelola sendiri, tidak menunggu siapa pun

Sejak R5G12 jenis surat menjadi **master data yang dikelola Superadmin**
(migrasi 038, tabel `sdl_surat_jenis`). Isinya saat ini satu baris: `ND` →
Nota Dinas.

Sisanya **ditambahkan sendiri lewat Settings → Master Data**, tanpa migrasi dan
tanpa menunggu rilis. Itu justru alasan tabel ini dibuat: pemilik sistem baru
mengetahui satu jenis, dan sisanya akan datang satu per satu.

Formulir Surat Keluar sudah membaca daftar itu — field "Jenis Surat" kini
dropdown berkode, bukan ketik bebas lagi. Yang tersimpan adalah **kodenya**,
karena kode itulah yang tercetak di nomor surat.

### 2. Kode arsip yang hilang dari berkas sumber

Berkas `416270180-Sistem-Penomoran-Surat-Dinas.xlsx` tampak **terpotong di
bagian depan**. Keluarga HUK hanya menyisakan tiga kode — `HUK.12.24.`,
`HUK.12.25.`, `HUK.12.26.` — yang duduk di baris 2–4 tanpa induk di kolom kiri,
bentuk khas ekor halaman sebelumnya.

Akibatnya **`HUK.7.1.` yang dipakai sebagai contoh di permintaan asli tidak ada
di database**. Prefiks yang sudah masuk: BIN, DIK, HUK (3 kode saja), HUM, IPP,
KES, LIT, OPS, PAM, PTK, RES, SIP, TIK, TUK, WAS, YAN.

Kekurangannya ditambahkan lewat migrasi susulan. Menambah baris tidak
membongkar apa pun — tabelnya murni referensi.

### 3. Tiga pertanyaan lama, dan jawabannya sekarang

Ketiganya sempat terbuka. Dua sudah diputuskan, satu terjawab sendiri oleh
keputusan lain.

**Surat mundur tanggal memakai bulan dan tahun saat nomor dibangkitkan**, bukan
tanggal suratnya. Diputuskan 2026-11-03. Konsekuensinya sudah disebut di atas
dan perlu diketahui petugas.

**Nama subbag di nomor surat sama dengan nama unit di aplikasi** — Urmin,
Subbagren, Subbagsumda, Subbagbinfung. Tidak ada daftar penamaan terpisah yang
perlu dijaga.

**Nomor yang sudah terbit tidak pernah dipakai ulang.** Ini bukan keputusan
tersendiri melainkan akibat dari dua yang sudah diambil: nomor diberikan saat
draf dibuat, dan lubang pada deret diterima. Memakai ulang nomor hangus akan
merusak sifat sekali-pakai yang justru lebih penting daripada kerapatan deret.
