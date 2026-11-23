# R5H26 — Alamat bersih (Back/Forward, refresh, tautan)

Status: **DIBANGUN lokal (2026-11-22), belum di-commit.** Frontend saja: tanpa migrasi, tanpa API, tanpa
perubahan Vite/Caddy.

## Kebutuhan (kata pemilik)

> "aku ga bisa back kalau misal udah masuk suatu halaman, dia ga ada route kayak urmin/surat-masuk gitu ya,
> jadi kalau misal mau balik ke urmin ga bisa" … "aku ingin hasil yang bersih" (tanpa `#`).

Sebelumnya seluruh navigasi hanya state `screen` di `App.tsx`. URL tidak pernah berubah, sehingga:
- Back/Forward browser tidak bekerja;
- refresh selalu kembali ke Portal;
- halaman tidak bisa dibagikan sebagai tautan.

## Rancangan

`src/RouteR5H26.ts` berisi fungsi murni `screenToUrl` / `urlToScreen`. `App.tsx` menyambungkannya ke
History API: setiap perpindahan memakai `pushState`, Back/Forward memakai `popstate`, dan alamat dibaca
sekali setelah akun siap (juga setelah ganti password).

| Halaman | Alamat |
|---|---|
| Portal | `/` |
| Unit / menu / tab | `/urmin/surat-masuk/daftar`, `/subbagsumda/personel`, `/subbagbinfung/sop` |
| Subbagren | `/subbagren` (pilihan), `/subbagren/progar/perencanaan`, `/subbagren/dalgar/myinterest` |
| Menu internal `__x` | ditulis tanpa awalan: `/subbagren/progar/surat-masuk`, `/urmin/unitwork` |
| Inbox / Disposisi unit | `/subbagren/inbox`, `/subbagren/tugas` |
| Rekaman | `?id=<id>` (mis. `/subbagren/tugas?id=dispo:<id arahan>`); `?baru=1` untuk formulir baru |
| Lainnya | `/arahan`, `/dashboard`, `/profil`, `/roadmap`, `/admin/pengguna`, `/admin/role`, `/admin/master-data`, `/admin/kewenangan` |

- Alamat yang diketik **tetap lewat `navigate()`**, jadi semua aturan lama berlaku:
  - Kabagrenmin `/urmin/disposisi` dialihkan ke `/urmin/surat-masuk/daftar`;
  - Superadmin hanya membuka halaman admin, selain itu dikembalikan ke `/`;
  - `/dashboard` menunggu hak dashboard diketahui.
- Alamat tak dikenal atau ditolak menampilkan Portal dan alamatnya diganti `/` (replaceState, tanpa menambah riwayat).
- Belum login: alamat dipertahankan; setelah login pengguna dibawa ke halaman itu. Logout mengembalikan alamat ke `/`.
- Hak akses tetap sepenuhnya di backend; tautan tidak membuka apa pun yang tidak boleh dilihat.
- **Server:** Vite (di belakang Caddy) sudah mengembalikan `index.html` untuk path yang bukan berkas (SPA
  fallback bawaan). Path halaman tidak bertabrakan dengan `/api/*` maupun `SDL_EXPRESS_PATHS`. Dicek: `GET
  /urmin/surat-masuk` → 200 `text/html`.
- Batasan: dialog/jendela di dalam halaman tidak ikut alamat, kecuali yang memang dibuka lewat `recordID`.

## Uji (2026-11-22, Chrome)

| Akun | Skenario | Hasil |
|---|---|---|
| op-subbagren | Portal → SUBBAGREN → DALGAR → Data myinterest → Laporan | Alamat mengikuti tiap langkah |
| op-subbagren | Back ×3, Forward | Benar |
| op-subbagren | Refresh / tautan langsung myinterest, surat masuk, inbox | Benar |
| op-subbagren | Alamat ngawur | Portal + alamat `/` |
| op-urmin | Tautan `/urmin/surat-masuk`, Inbox, Back, `/urmin/unitwork` | Benar |
| Kabagrenmin | `/urmin/disposisi` | Dialihkan ke `/urmin/surat-masuk/daftar` |
| Kabagrenmin | `/dashboard` | Executive Dashboard |
| Superadmin | `/admin/master-data` | Benar |
| Superadmin | `/urmin/surat-masuk` | Ditolak → Portal, alamat `/` |
| Tanpa sesi | Tautan Laporan | Form login, alamat dipertahankan; setelah sesi ada langsung ke Laporan |
| staf-subbagren | Inbox → disposisi | `/subbagren/tugas?id=dispo:…` + dialog; Back ke `/subbagren/inbox` |

Tanpa error halaman. `tsc` dan `npm run build` lulus.
