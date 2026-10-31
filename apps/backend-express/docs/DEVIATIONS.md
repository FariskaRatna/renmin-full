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
| D2 | Byte HTML dan MIME email OTP | `buildOTPEmail` + `buildMultipartEmail` buatan sendiri | nodemailer, HTML disusun ulang setara | Teks polos disalin **persis**; struktur dan gaya HTML setara tapi byte berbeda. Isi email bukan bagian kontrak API dan tidak diuji golden file | Diterima |
| D3 | Byte JPEG avatar hasil pengkodean ulang | `image/jpeg` Go, quality 85 | `sharp`/libvips, quality 85 | Encoder berbeda, byte tidak akan pernah identik. Format, dimensi 256×256, dan hilangnya metadata dipertahankan. `GET /profile/avatar` karenanya tidak bisa dibandingkan byte-per-byte | Diterima |
| D4 | Format timestamp pada field tanggal dari database | `time.Time` → RFC3339Nano: presisi mikrodetik, nol di belakang dibuang (`...T04:00:00Z`) | `Date` dari `pg` → `JSON.stringify` → ISO-8601: **selalu** 3 desimal, presisi milidetik (`...T04:00:00.000Z`) | **Belum diverifikasi, bukan sudah diterima.** Harness mengganti setiap timestamp dengan `<timestamp>`, jadi perbedaan ini tidak akan pernah terdeteksi olehnya. `executive/index.js:288` sudah menambal satu field secara manual (`.replace(/\.\d{3}Z$/,'Z')`), tanda gejalanya pernah terlihat. Kalau Go memang memakai mikrodetik, Express **kehilangan presisi**, bukan sekadar berbeda format. Perlu satu helper bersama yang dipakai seluruh modul | Perlu diverifikasi |

---

## Backlog perbaikan (setelah paritas)

| # | Temuan | Lokasi di Go | Dampak | Status |
|---|---|---|---|---|
| B1 | Rate limit captcha memakai `RemoteAddr`, bukan `X-Forwarded-For`. Di balik Caddy, seluruh LAN terlihat sebagai satu IP, sehingga batas 60 challenge/menit dibagi bersama. | `auth/captcha.go:26` | Berpotensi `429 try_later` palsu saat banyak user login bersamaan | Perlu diverifikasi di deployment sekarang |
| B2 | Empat helper respons JSON yang identik (`writeJSON`, `respond` ×3, `jsonResponse`, `write`) tersebar di paket berbeda | seluruh `internal/` | Kosmetik; satu helper cukup di Express | Terbuka |
| B3 | Paket `internal/delegations` (4 route, 411 baris) tidak pernah dipasang — digantikan handler 403 | `httpapi/router.go:242` | Kode mati; perilaku 403 tetap diporting | Terbuka |
| B4 | Lima paket kosong 0 baris: `rbac`, `config`, `audit`, `subbagsumda`, `subbagbinfung` | `internal/` | Tidak perlu diporting | Terbuka |
| B5 | `GET /urmin/surat-masuk/` memfilter otorisasi per baris setelah query, bukan di SQL | `urmin/incoming.go:134` | Lambat pada dataset besar. **Jangan diubah saat migrasi** — semantik scope/klasifikasi akan bergeser | Terbuka |
| B6 | `GET /admin/users` memakai `ORDER BY u.created_at DESC LIMIT 500` **tanpa tiebreaker**. Akun yang dibuat dalam satu transaksi (ke-12 hasil `seed-bagrenmin`) punya `created_at` identik, jadi Postgres memutus seri sesukanya. | `users/service.go:136` | Urutan daftar user berubah antar request pada backend yang **sama** — bukan masalah paritas, tapi paginasi apa pun di atasnya akan tidak stabil. Express menyalin query persis. Harness menandainya `unordered` supaya isi tetap dibanding penuh tanpa urutan ikut dinilai. Perbaikannya kelak: tambah `, u.id` sebagai tiebreaker di **kedua** backend | Terbuka |

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
