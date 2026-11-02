# Deviasi & Backlog Pasca-Paritas

Dua daftar terpisah. Jangan campur.

- **Deviasi sadar** — Express sengaja berbeda dari Go, dengan alasan. Harus ditinjau
  sebelum peralihan penuh.
- **Backlog perbaikan** — hal yang terasa keliru di Go, ditemukan saat porting,
  **direplikasi apa adanya dulu**, dan dikerjakan setelah Express melayani 100% trafik.

Memperbaiki sambil memporting menghilangkan kemampuan membandingkan dengan oracle.

---

## Deviasi sadar

| # | Perilaku | Go | Express | Alasan | Status |
|---|---|---|---|---|---|
| D1 | Trailing slash pada `Route("/x")` + `Get("/")` | redirect 301 dari `/x` ke `/x/` | menerima keduanya, tanpa redirect | Frontend selalu mengirim versi ber-slash; redirect 301 tidak dipakai klien manapun | Usulan |
| D2 | Byte amplop MIME email | `buildMultipartEmail` buatan sendiri | dirakit nodemailer | Boundary-nya acak dan header `Date` berisi jam saat itu, jadi perbandingan byte mustahil pada level amplop. **Isi pesannya sendiri sudah diverifikasi identik**: `npm run verify:email` membandingkan teks polos DAN HTML notifikasi terhadap `buildNotificationEmail` Go yang asli — 16/16 bagian byte-identik. Yang tersisa berbeda hanya HTML email OTP, yang memang disusun ulang bebas dan tidak punya pembanding otomatis | Diterima, sebagian terverifikasi |
| D3 | Byte JPEG avatar hasil pengkodean ulang | `image/jpeg` Go, quality 85 | `sharp`/libvips, quality 85 | Encoder berbeda, byte tidak akan pernah identik. Format, dimensi 256×256, dan hilangnya metadata dipertahankan. `GET /profile/avatar` karenanya tidak bisa dibandingkan byte-per-byte | Diterima |
| D4 | Format dan presisi timestamp | `time.Time` → RFC3339Nano: nol di belakang dibuang (`...T04:00:00Z`), mikrodetik database diteruskan apa adanya | **Sudah disamakan.** Type parser `pg` untuk OID 1114/1184 menyerahkan teks Postgres, bukan `Date` (`src/db.js` + `src/time.js`) | **Terverifikasi 2026-11-01, bukan lagi deviasi.** Dugaan semula benar dan lebih luas: `Date` JavaScript hanya menyimpan milidetik, jadi Express bukan sekadar berbeda format melainkan **kehilangan presisi** — dan karena `Date.toJSON()` selalu menulis tiga desimal, setiap timestamp berbeda, tidak hanya yang sub-milidetik. Harness memang tidak akan pernah menangkapnya (`Normalizer` → `<timestamp>`); pembuktiannya `verify/timestamp-parity.js`, yang membandingkan byte mentah: 79/79 timestamp cocok. Dua di antaranya berasal dari jam server (`executive` `generatedAt`, `dispositions/leadership` `updatedAt`) — nilainya mustahil sama, jadi yang diuji aturan formatnya, dan keduanya kini memakai `goTime()` dari helper yang sama | Selesai |

---

## Backlog perbaikan (setelah paritas)

> **Dua pengecualian sudah diambil: B8 dan B9.** Aturan "replikasikan dulu,
> perbaiki nanti" ada supaya Go tetap bisa dipakai sebagai oracle. Keduanya
> tidak mengancam itu, karena pada keduanya **tidak ada perilaku benar yang
> bisa dibandingkan**: B8 statement SQL yang tidak sah (satu-satunya keluaran
> yang mungkin 503), B9 pemeriksaan yang menolak setiap akun yang mungkin ada
> (satu-satunya keluaran yang mungkin 403). Keduanya diperbaiki atas
> persetujuan eksplisit pemilik sistem, **di kedua backend pada perubahan yang
> sama**, lalu golden-nya direkam ulang dalam satu siklus capture/compare
> penuh. Tiga syarat itu yang menjaga oracle tetap utuh; memperbaiki satu sisi
> saja akan merusaknya.
>
> Keduanya berurutan dan bukan kebetulan: B9 menyembunyikan B8, dan membereskan
> B8 tidak ada gunanya tanpa B9. Sisa entri di tabel ini **bukan** kasus yang
> sama — semuanya punya perilaku yang bisa dibandingkan, jadi jangan jadikan
> ini preseden.

| # | Temuan | Lokasi di Go | Dampak | Status |
|---|---|---|---|---|
| B1 | Rate limit captcha memakai `RemoteAddr`, bukan `X-Forwarded-For`. Di balik Caddy, seluruh LAN terlihat sebagai satu IP, sehingga batas 60 challenge/menit dibagi bersama. | `auth/captcha.go:26` | Berpotensi `429 try_later` palsu saat banyak user login bersamaan | Perlu diverifikasi di deployment sekarang |
| B2 | Empat helper respons JSON yang identik (`writeJSON`, `respond` ×3, `jsonResponse`, `write`) tersebar di paket berbeda | seluruh `internal/` | Kosmetik; satu helper cukup di Express | Terbuka |
| B3 | Paket `internal/delegations` (4 route, 411 baris) tidak pernah dipasang — digantikan handler 403 | `httpapi/router.go:242` | Kode mati; perilaku 403 tetap diporting | Terbuka |
| B4 | Lima paket kosong 0 baris: `rbac`, `config`, `audit`, `subbagsumda`, `subbagbinfung` | `internal/` | Tidak perlu diporting | Terbuka |
| B5 | `GET /urmin/surat-masuk/` memfilter otorisasi per baris setelah query, bukan di SQL | `urmin/incoming.go:134` | Lambat pada dataset besar. **Jangan diubah saat migrasi** — semantik scope/klasifikasi akan bergeser | Terbuka |
| B6 | `GET /admin/users` memakai `ORDER BY u.created_at DESC LIMIT 500` **tanpa tiebreaker**. Akun yang dibuat dalam satu transaksi (ke-12 hasil `seed-bagrenmin`) punya `created_at` identik, jadi Postgres memutus seri sesukanya. | `users/service.go:136` | Urutan daftar user berubah antar request pada backend yang **sama** — bukan masalah paritas, tapi paginasi apa pun di atasnya akan tidak stabil. Express menyalin query persis. Harness menandainya `unordered` supaya isi tetap dibanding penuh tanpa urutan ikut dinilai. Perbaikannya kelak: tambah `, u.id` sebagai tiebreaker di **kedua** backend | Terbuka |
| B7 | `GET /urmin/dispositions/leadership` memvalidasi ulang rantai **per simpul**: untuk tiap akar ia menjalankan `taskProgress`, yang untuk tiap tugas di pohonnya memanggil `loadTask` lalu `taskChainValid` — dan `taskChainValid` menelusuri induk ke atas sambil memanggil `dispositionEligible` (satu query) per hop. | `urmin/r3d3.go:81` lewat `r3c.go:117` | Satu permintaan dasbor dengan 151 akar bisa menjadi ribuan query. Mahalnya **disengaja** — grant yang dicabut harus mematikan kasusnya di sini, bukan baru ketahuan saat persetujuan final — tapi bisa di-memo per request tanpa menggeser semantik sama sekali: `dispositionEligible` dipanggil berulang untuk (user, unit, klasifikasi, permission) yang identik. **Jangan diubah saat migrasi**; Express menyalin polanya persis | Terbuka |
| B8 | **Endpoint 50 (`approve`) dan 51 (`reject`) surat keluar SELALU gagal 503.** UPDATE-nya memakai `$2` di dua tempat dengan tipe berbeda: `stage=$2` (kolom `VARCHAR(24)`) dan `CASE WHEN $2='approved'` (literal → `text`). Driver tidak mengirim OID tipe, jadi Postgres harus mendeduksi dan menolak: `inconsistent types deduced for parameter $2 — DETAIL: text versus character varying`. | `unitwork/outgoing_review.go:255` | **Alur persetujuan surat keluar mati total di produksi.** Surat yang diajukan menggantung di tahap `submitted` selamanya. Kegagalannya terjadi SESUDAH otorisasi, pemeriksaan tahap, dan verifikasi integritas dokumen lolos, lalu `sqlerr` memetakannya ke 503 `database_unavailable` — terbaca seperti database bermasalah, padahal query-nya yang tidak sah. Tidak pernah terlihat karena B9 menolak 403 lebih dulu, sehingga SQL-nya tidak pernah sempat dijalankan | **Selesai 2026-11-01.** Diperbaiki atas persetujuan eksplisit pemilik sistem di **kedua backend sekaligus** (`outgoing_review.go:255` dan `outgoing-review.js:311`): kedua pemakaian disamakan menjadi `$2::varchar`. Mengecast hanya sisi CASE (`$2::text`) **tidak** cukup — konfliknya justru antara kedua sisi. Golden 50/51 direkam ulang: keduanya kini 200 (`approved` / `rejected`), dan `approved_at` terisi hanya pada persetujuan. **B9 masih membuat kedua endpoint tak terjangkau di produksi** — perbaikan ini belum membuat alurnya bisa dipakai |
| B9 | `outgoingManager()` menuntut baris di **`sdl_user_roles`** (peran langsung) selain grant berskop di `sdl_access_grants`. `cmd/seed-bagrenmin` tidak pernah menulis ke tabel itu; isinya hanya satu baris `superadmin`. | `unitwork/outgoing_review.go:39` lawan `cmd/seed-bagrenmin/main.go:261` | Fungsi itu mengembalikan false untuk **siapa pun**, sehingga endpoint 50/51 menjawab 403 dan `canReview` pada endpoint 48 selalu false | **Selesai 2026-11-01.** Diperbaiki atas persetujuan eksplisit pemilik sistem di kedua backend: JOIN ke `sdl_user_roles` dibuang, wewenangnya murni dari grant — konsisten dengan `directives.isKabag`, `executiveV2Access`, dan `access.EvaluateForUser`. `sdl_user_roles` tetap dibaca di query yang sama, tapi hanya untuk apa yang memang jadi tugasnya: menolak Superadmin. Tambalan harness dicabut dan barisnya **dihapus aktif** (`dropObsoleteDirectRole`) — tabel itu tidak ikut `TRUNCATE`, jadi baris tertinggal akan membuat 50/51 lolos lewat jalur lama dan perbaikan ini tidak terbukti apa-apa. Terverifikasi: `canReview: true` untuk kabagrenmin dengan `sdl_user_roles` berisi hanya `superadmin` |

---

## Cara menambah entri

Saat porting, kalau menemukan sesuatu yang terasa salah di Go:

1. Replikasikan apa adanya di Express.
2. Tambahkan baris di tabel **Backlog**, sebutkan lokasi di source Go.
3. Lanjut. Jangan perbaiki sekarang.

Kalau Express **tidak bisa** meniru Go (perbedaan platform, bukan perbedaan pendapat):

1. Tambahkan baris di tabel **Deviasi sadar** dengan alasannya.
2. Pastikan golden file untuk endpoint itu diberi anotasi, supaya ketidakcocokan
   tidak terbaca sebagai kegagalan.
