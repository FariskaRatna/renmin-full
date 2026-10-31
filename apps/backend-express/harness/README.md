# Harness Golden-File

Alat ukur Tahap 0. Memanggil seluruh 142 endpoint pada backend yang sedang
berjalan, menormalkan responsnya, dan menyimpannya sebagai *golden file*.
Setelah Express ditulis, harness yang sama diarahkan ke Express dan
membandingkan hasilnya.

Golden file adalah definisi "selesai" untuk setiap tahap migrasi.

JavaScript polos (ESM), memakai `package.json` dan `node_modules` yang sama
dengan backend Express — bukan proyek npm terpisah. Satu dependensi tambahan:
`pg`.

## Kenapa harus di dalam Docker

Service `api` **tidak pernah diekspos ke host**. Dari luar, satu-satunya jalur
masuk adalah proxy Vite di port 5174 — dan itu hanya melayani prefix `/api`,
sehingga `/healthz` dan `/readyz` tidak terjangkau. Harness karena itu berjalan
sebagai service di network `internal` dan menembak `http://api:8080` langsung.

## Menjalankan

Prasyarat: Docker Desktop berjalan, `.env` ada, stack sudah `up`, dan database
sudah di-`bootstrap` + `seed`. Tanpa seed, hanya aktor `anon` dan `superadmin`
yang tersedia dan sebagian besar kasus dilewati.

```bash
# Jalur termudah — pembungkus tanpa penjaga nama folder
bash scripts/local-setup.sh up
bash scripts/local-setup.sh bootstrap
bash scripts/local-setup.sh seed
bash scripts/local-setup.sh harness            # = capture
bash scripts/local-setup.sh harness compare
```

Perintah mentahnya, kalau perlu dikendalikan sendiri:

```bash
# 1. Reset tabel dokumen ke fixture deterministik
docker compose --env-file .env \
  -f infra/compose.dev.yaml -f infra/compose.harness.yaml \
  run --rm --build harness seed-docs

# 2. Rekam baseline dari backend Go
docker compose --env-file .env \
  -f infra/compose.dev.yaml -f infra/compose.harness.yaml \
  run --rm harness capture

# 3. Reset LAGI, supaya Express berangkat dari keadaan yang sama
docker compose --env-file .env \
  -f infra/compose.dev.yaml -f infra/compose.harness.yaml \
  run --rm harness seed-docs

# 4. Bandingkan Express terhadap baseline itu
SDL_HARNESS_TARGET=express \
docker compose --env-file .env \
  -f infra/compose.dev.yaml -f infra/compose.harness.yaml \
  run --rm harness compare
```

Langkah 3 bukan kehati-hatian berlebihan. Kasus mutating mengubah baris, jadi
tanpa reset kedua, Express berangkat dari keadaan yang ditinggalkan Go dan
selisih yang muncul adalah akibat urutan — bukan perbedaan backend.

`seed-docs` bersifat **merusak**: ia `TRUNCATE ... RESTART IDENTITY` atas 37
tabel dokumen. Tabel identitas tidak dikosongkan, tapi ia **menambahkan** baris
`sdl_role_permissions` supaya aktor uji benar-benar bisa menembus Engine A —
peta itu khusus harness, bukan konfigurasi produksi. Lihat catatan di
`seed-documents.js`.

Kode harness ikut di dalam image, jadi pakai `--build` setiap kali registry
diubah. Keluar dengan kode 1 kalau ada perbedaan; rincian lengkap termasuk
daftar kasus yang dilewati ada di `golden/_summary.json`.

Dari host, tanpa Docker, hanya perintah yang tidak menyentuh backend:

```bash
cd apps/backend-express
npm run harness:list
```

## Tiga kelas keamanan

Harness tidak boleh merusak data yang sedang diperiksa, jadi setiap kasus
diklasifikasi otomatis:

| Kelas | Isi | Kapan jalan |
|---|---|---|
| `read` | GET | selalu |
| `probe` | mutation ke path koleksi dengan body sengaja tidak valid; merekam bentuk respons validasi 400 | selalu |
| `mutating` | mutation yang menyasar record nyata (punya path param), dan semua DELETE | hanya saat `SDL_HARNESS_ALLOW_MUTATIONS=true` |

Pembagian saat ini: **68 read · 23 probe · 51 mutating**.

Aktor anonim dikecualikan dari pembatasan ini — tanpa sesi, request selalu
berhenti di gerbang autentikasi sebelum menyentuh data. Itu sebabnya baseline
anonim mencakup seluruh 142 endpoint sekalipun mutasi dimatikan.

Agar cakupan itu benar-benar penuh, aktor anonim memakai **ID sintetis**
(`00000000-0000-4000-8000-000000000000`) untuk path param yang fixture-nya belum
ada di database. Boleh, karena ID-nya tidak pernah dipakai: guard menolak sebelum
handler mencari record. Golden file yang memakainya ditandai `syntheticParams: true`
supaya tidak terbaca seolah menguji data nyata. Aktor bersesi tetap dilewati —
bagi mereka ID palsu hanya menghasilkan 404 yang tidak mewakili apa pun.

### Baseline pertama (backend Go, database belum di-seed)

```
endpoint tersentuh : 142/142
kasus direkam      : 151
kasus dilewati     : 180   (semua karena bootstrap/seed belum dijalankan)

respons anonim: 136×401 · 6×200 · 6×400 · 2×403 · 1×204
```

Keenam respons 200 adalah endpoint yang memang publik: `/healthz`, `/readyz`,
`/api/v1/system/status`, `/auth/csrf`, `/auth/bootstrap-status`, `/auth/captcha`.

**Tidak ada satu pun 404.** Artinya tidak ada handler yang menyentuh database
sebelum gerbang autentikasi — diuji dengan ID acak pada seluruh endpoint ber-`{id}`.

> **Jalankan `mutating` hanya terhadap database sekali pakai.** Ia menghapus
> dan mengubah record nyata, dan beberapa endpoint (`POST /{id}/submit`,
> `/approve`, `/forward`) menggerakkan workflow yang tidak bisa dikembalikan.

## Aktor

Sepuluh persona, mengikuti 13 akun di `cmd/seed-bagrenmin/main.go:29-44`:
`anon`, `superadmin`, `opUrmin`, `stafUrmin`, `kaUrmin`, `opSubbagren`,
`kasubbagren`, `kasubbagsumda`, `kasubbagbinfung`, `kabagrenmin`.

Scope mereka berbeda (`own` / `assigned` / `unit`) dan itu disengaja: otorisasi
SDL memutuskan **per dokumen**, bukan per endpoint, jadi endpoint yang sama
harus dipanggil dari beberapa sudut pandang agar perbedaan scope tertangkap.

### Sesi disuntik langsung, bukan lewat login

Login Superadmin **tidak bisa diotomasi**: OTP selalu wajib (`mustUseOTP`,
`service.go:345`), dikirim lewat SMTP, dan disimpan ter-hash sehingga tidak bisa
dibaca balik dari database. Harness karena itu menulis baris `sdl_sessions`
langsung dengan `sha256(token)` — persis seperti yang dilakukan backend setelah
login berhasil — lalu mencabutnya di akhir run.

Jalur login HTTP yang sebenarnya tetap tersedia (`HttpClient.loginWithPassword`),
lengkap dengan pemecahan proof-of-work CAPTCHA, untuk akun non-Superadmin.

### `must_change_password` harus dibersihkan

`seed-bagrenmin` membuat ke-13 akun dengan `must_change_password=TRUE`
(`main.go:240`), dan **kedua guard menolak user dalam kondisi itu**. Tanpa
dibersihkan, seluruh endpoint operasional menjawab 403 dan golden file merekam
kondisi yang salah — yang mudah disalahartikan sebagai "RBAC rusak".

Harness membersihkannya otomatis, tapi hanya saat mutasi diizinkan, karena itu
operasi tulis.

## Normalisasi

Respons SDL penuh nilai yang berubah tiap run. Yang diganti placeholder:

| Pola | Placeholder |
|---|---|
| UUID | `<uuid:N>` — ordinal, **stabil dalam satu respons** |
| Timestamp ISO-8601 | `<timestamp>` |
| Hex 64 karakter | `<hex64>` |
| base64url 43 karakter (token sesi/CSRF) | `<token43>` |
| Nilai cookie | `<value>`, atributnya dipertahankan |

UUID memakai ordinal, bukan konstanta tunggal, supaya **relasi tetap terbaca**:
kalau dua field merujuk record yang sama, keduanya jadi `<uuid:1>`, dan
perubahan keterkaitan data tetap tertangkap sebagai perbedaan.

Kunci objek diurutkan sebelum dibandingkan — perbedaan urutan serialisasi antara
Go dan Express bukan perbedaan isi.

Header hanya direkam dari allowlist (`content-type`, `content-disposition`,
empat header keamanan, `location`, `allow`). Body non-JSON direkam sebagai
`sha256` + panjang, bukan isinya.

Redirect **tidak diikuti** (`redirect: 'manual'`): 301 trailing-slash dari chi
adalah bagian kontrak yang perlu terlihat.

### Token CSRF dibaca dari cookie, tidak di-cache

`GET /api/v1/auth/csrf` ada **di dalam registry**. Saat kasusnya dijalankan,
server menerbitkan token baru ke cookie `sdl_csrf`. Kalau harness menyimpan
token hasil panggilan sebelumnya, cookie dan header `X-CSRF-Token` jadi berbeda,
dan pola double-submit (`service.go:108`) menolak **seluruh mutation sesudahnya**
dengan 403 `csrf_invalid`.

Akibatnya baseline merekam gerbang CSRF, bukan perilaku endpoint yang dimaksud —
`POST /auth/login` dengan body kosong tercatat 403 padahal seharusnya
`400 invalid_request`. Karena itu `ensureCsrf()` selalu membaca nilai cookie yang
berlaku, dan CSRF diselesaikan sebelum header `Cookie` dibangun.

## Batas yang disadari

- **Multipart belum didukung.** Endpoint unggah (lampiran, avatar, evidence)
  hanya direkam lewat probe JSON, yang mencatat penolakan bentuk — bukan jalur
  unggah yang sebenarnya.
- **Body request belum lengkap.** 124 endpoint domain berjalan dengan body `{}`.
  Yang terekam adalah bentuk respons validasi, dan itu tetap kontrak — tapi
  jalur sukses perlu body nyata, diisi bertahap lewat field `body` di registry.
- **Query parameter** baru terisi di satu tempat (`executive/v2/overview?period=`).
- Harness mengukur **bentuk** respons. Ia tidak mengukur siapa yang *boleh*
  mendapatkannya — itu tugas suite `internal/securitytest` yang diporting
  terpisah. Endpoint bisa cocok byte-per-byte sambil tetap membocorkan data ke
  role yang salah.

Setiap kasus yang dilewati tercatat beserta alasannya di `golden/_summary.json`
dan diringkas di akhir setiap run. Cakupan yang hilang tidak boleh diam-diam.

## Susunan

| Berkas | Isi |
|---|---|
| `registry.js` | 142 endpoint, bernomor sesuai `docs/API-CONTRACT.md` §5 |
| `actors.js` | persona dan pembangunan sesi |
| `client.js` | klien HTTP, cookie jar, CSRF, pemecah CAPTCHA |
| `db.js` | suntikan sesi, pembersihan `must_change_password`, fixture ID |
| `normalize.js` | penggantian nilai volatil |
| `run.js` | perluasan kasus, eksekusi, perbandingan |
| `index.js` | CLI |
| `golden/` | hasil rekaman (per mount) + `_summary.json` |

`assertRegistryComplete()` berjalan di setiap perintah dan menolak jalan kalau
nomor endpoint ganda, ada celah di 1..142, atau jumlahnya bukan 142.
