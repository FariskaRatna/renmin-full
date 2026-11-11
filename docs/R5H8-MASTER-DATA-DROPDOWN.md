# R5H8 — Pilihan dropdown sebagai master data

Status: **diimplementasikan di lokal 2026-11-11, belum di-deploy.**

## Kebutuhan (kata pemilik)

Pilihan dropdown harus bisa ditambah tanpa mengubah kode.

## Keputusan

| Hal | Isi |
|---|---|
| Cakupan | 10 daftar yang murni label (tersimpan sebagai teks di `fields`, tidak diperiksa backend) |
| Pengelola | Superadmin, menu **Master Data** (tab Persuratan / Subbagsumda / Subbagbinfung) |
| Backend | **Hanya Express.** Tabel `sdl_opsi_dropdown` (migrasi 047), satu tabel dengan `set_key` |
| Tidak dicakup | Jenis Surat Masuk (CHECK constraint, migrasi 024), Lingkup Surat (membentuk nomor surat), Derajat, Klasifikasi (hak akses) |

| set_key | Formulir | Field |
|---|---|---|
| `arsip-jenis`, `arsip-status` | Urmin → Arsip | `jenisArsip`, `statusArsip` |
| `agenda-hadir` (migrasi 048, pilih-banyak, nama tanpa koma) | Urmin → Agenda & Rapat | `yangMenghadiri` |
| `personel-status` | Sumda → Personel | `status` |
| `kondisi-barang` | Sumda → Inventaris | `kondisi` |
| `sop-jenis`, `sop-status` | Binfung → SOP | `jenis`, `statusDokumen` |
| `pid-kategori`, `pid-tingkat-akses`, `pid-status` | Binfung → PID | `kategori`, `tingkatAkses`, `statusDokumen` |
| `rb-status` | Binfung → RB/SPIP | `statusTindakLanjut` |

## Perilaku

- Data menyimpan **nama** pilihan. Mengganti nama tidak mengubah data lama;
  formulir menampilkan nilai lama itu sebagai "(nilai lama)".
- Menghapus pilihan yang masih dipakai data aktif ditolak (`409 code_in_use`).
- Kode boleh dikosongkan saat menambah: dibuat dari nama ("Rusak Ringan" →
  `RUSAK_RINGAN`). Pilihan baru tampil di urutan terakhir (`seq`).
- "Tingkat Akses" pada PID tetap **hanya label**; ia tidak membatasi siapa yang
  bisa membuka data.
- Kalau endpoint tidak terbaca (rollback ke Go) atau himpunannya dikosongkan,
  formulir memakai daftar bawaan di kode — tidak ada formulir yang kosong.

## Dropdown yang bisa dicari (SearchSelectR5H8)

Semua dropdown yang isinya dari Master Data -- atau dari data nyata seperti
rujukan dan pangkat -- memakai `SearchSelectR5H8.tsx`: diklik, kotak cari
muncul di paling atas (langsung fokus), daftar di bawahnya bisa di-scroll.
Keyboard: ↑ ↓ Enter Esc. Dipakai di Surat Keluar (Rujukan Disposisi, Rujukan
Surat, Jalur, Pemberi Tanda Tangan, Pemberi Nomor, Tipe, Jenis Surat), Arsip,
Sumda (Pangkat, Status Personel, Kondisi Barang), dan semua dropdown Binfung.
Pemilih banyak (Verifikator, Tembusan, Yang Menghadiri) mendapat kotak cari di
atas pilihannya bila pilihannya lebih dari lima. Derajat dan Lingkup Surat
tetap `<select>` biasa: daftarnya tetap dan pendek.

## Deploy

1. Migrasi **047** dan **048** → workflow deploy dengan "Izinkan migrasi". Rebuild `api`
   (Go meng-embed manifes migrasi), `api-express`, `frontend`.
2. Tambahkan `/api/v1/admin/master/*` ke `SDL_EXPRESS_PATHS` (atau langkah 5
   `/api/*`), lalu recreate Caddy. Tanpa ini Master Data di server dilayani Go
   dan sepuluh daftar baru menjawab 404.

## Bukti lokal

- Uji API 19/19 (baca per unit, guard Superadmin↔operasional, tambah, nama
  ganda, isolasi antar-himpunan, ganti nama, tolak hapus saat dipakai, hapus
  setelah data diarsipkan, himpunan lama tetap jalan).
- Uji browser Edge: Superadmin menambah "Hilang" tanpa kode → langsung muncul
  di form Inventaris Sumda → dihapus.
