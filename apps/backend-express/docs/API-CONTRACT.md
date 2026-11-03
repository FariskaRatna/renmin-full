# Kontrak API SDL — Baseline Go (acuan migrasi Express)

> **Status dokumen:** diekstrak langsung dari source Go pada 2026-10-30.
> **Sumber kebenaran:** `apps/backend/` (Go + chi). Dokumen ini adalah *acceptance test* migrasi,
> bukan dokumentasi aspiratif. Kalau Express berbeda dari dokumen ini, Express yang salah.
>
> **Aturan main:** selama migrasi, kontrak ini **beku**. Tidak ada perbaikan desain API,
> tidak ada rename field, tidak ada penggantian status code — sekalipun yang sekarang terasa keliru.
> Frontend (`apps/frontend`) memanggil path relatif `/api/v1/...` dan tidak boleh disentuh.
> Perbaikan desain dilakukan **setelah** paritas tercapai, sebagai pekerjaan terpisah.

---

## 0. Ringkasan

| Metrik | Nilai |
|---|---|
| Endpoint terpasang (mounted) | **146** (142 + arsip disposisi R5G3 + tiga lampiran disposisi R5G6) |
| Prefix mount | 15 |
| Tabel Postgres | 56 |
| File migrasi SQL | 36 (`001_core.sql` … `036_disposition_files.sql`) |
| Model otorisasi | **2 engine berbeda** (lihat §4) |
| Worker latar | 1 (notifications, tick 10 detik) |

### Koreksi angka

Estimasi awal **173** berasal dari hitungan mentah pemanggilan `.Get(/.Post(/...` di seluruh
file `.go` — termasuk file `_test.go` dan helper yang tidak terpasang. Setelah ditelusuri
pohon komposisi router yang sebenarnya, jumlah endpoint yang benar-benar dilayani adalah **142**.
Sejak R5G3 dan R5G6 (2026-11-03) bertambah empat menjadi **146**; penomorannya melanjutkan, bukan menyisip,
supaya nomor yang sudah dirujuk di golden file dan dokumen lain tidak bergeser.

Selisihnya bukan hanya file test. Ada juga **kode mati yang sengaja tidak dipasang**:
`internal/delegations/service.go` mendefinisikan 4 route lengkap, tapi `router.go:242-247`
menggantinya dengan handler `denyDelegation` yang selalu `403`. Paket `delegations`
bahkan tidak di-import oleh router. **Jangan porting paket ini** — porting perilaku 403-nya saja.

---

## 1. Konvensi global

### 1.1 Envelope respons

Tidak ada envelope pembungkus. Body sukses adalah objek domain langsung.
Ada **4 helper berbeda** di codebase (`writeJSON`, `respond`, `jsonResponse`, `write`)
tapi semuanya identik perilakunya:

```
Content-Type: application/json; charset=utf-8
```

### 1.2 Envelope error

Seragam di seluruh API — satu field, snake_case, tanpa pesan manusia:

```json
{ "error": "invalid_request" }
```

Kode error yang terverifikasi dipakai:

| Kode | Status | Dipakai saat |
|---|---|---|
| `invalid_request` | 400 | body gagal validasi / JSON malformed |
| `invalid_credentials` | 401 | username/password salah |
| `unauthenticated` | 401 | cookie sesi hilang/kedaluwarsa |
| `invalid_otp` | 401 | OTP salah, kedaluwarsa, terpakai, atau attempts ≥ 5 |
| `access_denied` | 401/403 | gagal guard `AuthorizeOperational` / `AuthorizeRoleEditor` |
| `csrf_invalid` | 403 | Origin tidak di allowlist atau token CSRF tidak cocok |
| `captcha_invalid` | 403 | proof-of-work captcha gagal/replay |
| `policy_changed_retry_login` | 403 | OTP dinyalakan admin di tengah login |
| `not_found` | 404 | `pgx.ErrNoRows` |
| `version_or_status_conflict` | 409 | optimistic locking gagal (review evidence) |
| `try_later` | 429 | throttle login / OTP / captcha |
| `unavailable` | 503 | error database generik |
| `database_unavailable` | 503 | idem, varian paket `unitwork` |
| `authorization_unavailable` | 503 | query otorisasi gagal |
| `email_delivery_unavailable` | 503 | SMTP tidak siap atau gagal kirim |

> **Catatan porting:** status 503 untuk error DB adalah pilihan desain yang disengaja
> (fail-closed), bukan bug. Express harus meniru, bukan mengubahnya jadi 500.

### 1.3 Security header (middleware global, semua respons)

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Cache-Control: no-store
```

Di Express: **jangan** pakai `helmet()` default — set empat header ini persis,
karena helmet menambah header lain (HSTS, CSP) yang mengubah perilaku di balik Caddy.

### 1.4 Trailing slash — jebakan nyata

chi memperlakukan `Get("/")` di dalam `Route("/portal/posts")` sebagai
`/api/v1/portal/posts/` **dengan** slash, dan melakukan redirect 301 dari versi tanpa slash.
Express default (`strict routing: false`) menganggap keduanya sama — **tanpa** redirect.

Frontend memanggil `/api/v1/portal/posts/?...` (dengan slash). Perbedaan ini tidak akan
terlihat sampai ada klien yang bergantung pada 301. Keputusan yang disarankan:
biarkan Express menerima keduanya (lebih longgar, tidak memecahkan frontend),
dan catat sebagai deviasi sadar di `DEVIATIONS.md`.

### 1.5 Batas ukuran body

Diverifikasi dari `http.MaxBytesReader` / konstanta:

| Konteks | Batas | Sumber |
|---|---|---|
| **Semua** body JSON `/api/v1/auth/*` | 4 096 B, `DisallowUnknownFields` **aktif** | `auth/service.go:89` |
| Avatar profil | 2 MiB + 1 | `auth/profile.go:143` |
| `project-roadmap`, `subbagren/usulan`, `urmin/surat-masuk` | 8 192 B | masing-masing paket |
| `POST /leadership/directives`, draft directive | 14 000 B | `directives/api.go:181`, `draft.go:110` |
| Satu endpoint draft directive | 512 B | `directives/draft.go:152` |
| `portal/posts` | 16 000 B | `portal/api.go:139` |
| `admin/roles`, `unit-work` (JSON) | 16 384 B | `roles/service.go:19`, `unitwork/work.go:42` |
| `admin/users` | 32 768 B | `users/service.go:88` |
| Unggah berkas unit-work | 6 MiB | `unitwork/work.go:579` |
| Bukti/evidence anggaran | 5 MiB + 64 KiB | `subbagren/evidence.go:130` |
| Lampiran surat masuk | 10 MiB + 64 KiB | `urmin/r3b.go:244` |
| `POST /urmin/surat-masuk/intake` | 10×10 MiB + 1 MiB | `urmin/r5f7.go:165` |
| Lampiran direktif | 100 MiB + 1 | `directives/attachments.go:26` |
| Header HTTP | 1 MiB | `cmd/api/main.go` |

> **Koreksi.** Versi awal dokumen ini menulis `POST /profile/email/verify` = 512 B
> dan `PATCH /profile` = 16 000 B. Keduanya salah: angka 512 milik
> `directives/draft.go` dan 16 000 milik `portal/api.go`. Seluruh endpoint JSON
> auth memakai `readPayload` yang seragam 4 096 B.

> **Penting:** `DisallowUnknownFields` pada endpoint auth berarti field asing di body
> menghasilkan **400**, bukan diabaikan. `express.json()` default mengabaikannya.
> Ini wajib direplikasi dengan validasi mode strict, kalau tidak ada celah perilaku.

### 1.6 Timeout server

```
ReadHeaderTimeout 5s · ReadTimeout 15s · WriteTimeout 15s · IdleTimeout 65s
Graceful shutdown 10s
Pool Postgres: MaxConns 8, MinConns 1, MaxConnIdleTime 5m
```

---

## 2. Autentikasi

### 2.1 Cookie

| Nama | HttpOnly | Umur | Isi |
|---|---|---|---|
| `sdl_session` | **ya** | 8 jam | token acak 32 byte, base64url **raw** (43 char) |
| `sdl_csrf` | **tidak** | 1 jam | token acak 32 byte, base64url raw (43 char) |

Keduanya: `Path=/`, `SameSite=Strict`, `Secure` mengikuti `SDL_COOKIE_SECURE`.

Sesi **disimpan di database** (`sdl_sessions`), bukan JWT. Yang disimpan adalah
`sha256(token)` hex, bukan tokennya. Validasi sesi = satu query join ke `sdl_users`
dengan syarat `expires_at > NOW() AND revoked_at IS NULL AND u.is_active`.

> **Jangan ganti ke JWT saat migrasi.** Itu menambah variabel baru persis di saat
> kamu sedang mengejar paritas, dan menghapus kemampuan revoke sesi yang sekarang ada.

### 2.2 CSRF — double-submit, bukan token sesi

`allowMutation()` (`auth/service.go:108`) menolak kecuali **ketiganya** benar:

1. Header `Origin` ada **di dalam allowlist** `SDL_ALLOWED_ORIGINS` (tidak pernah `*`)
2. Cookie `sdl_csrf` ada, panjang 24–128 char
3. Header `X-CSRF-Token` **sama persis** dengan cookie (dibanding konstan-waktu)

Gagal salah satu → `403 csrf_invalid`.

> **Jebakan produksi yang sudah pernah terjadi:** kalau `SDL_ALLOWED_ORIGINS` tidak diisi
> saat di balik reverse proxy HTTPS, browser mengirim `Origin` berisi alamat publik,
> allowlist menolaknya, dan UI menampilkannya sebagai **pesan CAPTCHA gagal** — bukan
> pesan CSRF. Gejalanya menyesatkan. Lihat komentar di `cmd/api/main.go:110`.

CSRF diberlakukan di dua tempat berbeda:
- `wrapMutation()` membungkus tiap mutation di `/api/v1/auth/*`
- `AuthorizeOperational` / `AuthorizeRoleEditor` memanggil `allowMutation` untuk
  semua method **selain GET**

### 2.3 Hash password — argon2id (zona bahaya)

```
algoritma  argon2id
versi      19
memory     65536 KiB  (64 MiB)
time       3
threads    2
keyLen     32 byte
salt       16 byte
encoding   $argon2id$v=19$m=65536,t=3,p=2$<salt>$<hash>
base64     RawStdEncoding — standard alphabet, TANPA padding '='
```

Verifier menerima rentang: `memory` 32768–131072, `time` 1–5, `threads` 1–4,
salt tepat 16 byte, hash tepat 32 byte. Di luar itu → tolak.

> **Ini satu-satunya bagian yang kalau salah tidak bisa diperbaiki.** Password yang
> tersimpan tidak bisa dipulihkan. Kalau format atau parameter Express meleset,
> seluruh user existing terkunci permanen dan harus reset massal.
>
> Di Node, paket `argon2` (bukan `argon2-browser`) mendukung ini. Dua hal yang
> paling sering meleset: (a) `memoryCost` dalam **KiB** bukan MiB, (b) output default
> paket Node memakai base64 **tanpa padding** juga — verifikasi dengan test vektor,
> jangan diasumsikan.
>
> **Gerbang wajib:** ambil satu hash nyata dari kolom `sdl_users.password_hash`
> di database dev, dan buktikan implementasi Express memverifikasinya `true`
> dengan password yang benar dan `false` dengan yang salah. Lakukan ini **sebelum**
> menulis endpoint login. Lihat Tahap 1 di `MIGRATION-PLAN.md`.

Saat username tidak ditemukan, Go tetap menjalankan `HashPassword()` pada string dummy
agar waktu respons tidak membocorkan keberadaan akun. **Replikasi ini** — menghapusnya
mengembalikan celah enumerasi akun.

### 2.4 CAPTCHA lokal — proof-of-work SHA-256

Bukan reCAPTCHA. Murni lokal, tanpa layanan eksternal.

```
GET /api/v1/auth/captcha  →  { id, nonce, difficulty: 16, expiresInSeconds: 120 }
```

Klien mencari `counter` sehingga `sha256(nonce + ":" + counter)` dua byte pertamanya nol
(`sum[0] == 0 && sum[1] == 0`). `counter` maksimum 5 000 000. Hasilnya dikirim di body login
sebagai `{ "captcha": { "id": "...", "counter": 12345 } }`.

Challenge **dikonsumsi transaksional** sebelum query kredensial — sekali pakai, anti-replay,
aman terhadap request konkuren. Rate limit: 60 challenge per menit per IP (berdasarkan
`RemoteAddr`, **bukan** header `X-Forwarded-For` — disengaja, header klien tidak dipercaya).

> **Konsekuensi deployment yang sudah terdokumentasi:** frontend menghitung proof pakai
> `crypto.subtle`, yang hanya tersedia di *secure context*. Akses lewat `http://<ip>:port`
> tidak akan pernah bisa login. Wajib HTTPS. Ini bukan bug Express/Go, tapi harus
> tetap jalan setelah migrasi.
>
> **Catatan proxy:** karena rate limit captcha memakai `RemoteAddr` langsung, di balik
> Caddy semua request terlihat datang dari satu IP proxy. Verifikasi apakah batas 60/menit
> sudah jadi masalah di deployment sekarang — kalau ya, itu bug yang sudah ada di Go,
> catat di `DEVIATIONS.md` dan perbaiki setelah paritas, bukan sambil jalan.

### 2.5 Alur login

```
1. GET  /api/v1/auth/csrf            → cookie sdl_csrf + {csrfToken}
2. GET  /api/v1/auth/captcha         → {id, nonce, difficulty}
3. (klien menghitung proof-of-work)
4. POST /api/v1/auth/login           {username, password, captcha:{id, counter}}
      ├─ captcha gagal       → 403 captcha_invalid
      ├─ terkunci            → 429 try_later
      ├─ kredensial salah    → 401 invalid_credentials
      ├─ OTP tidak wajib     → 200 {authenticated:true, otpRequired:false} + cookie sesi  ← SELESAI
      ├─ SMTP tidak siap     → 503 email_delivery_unavailable
      └─ OTP wajib           → 200 {challenge, otpRequired:true, expiresInSeconds:300}
5. POST /api/v1/auth/verify-otp      {challenge, code}
      └─ sukses              → 200 {authenticated:true} + cookie sesi
```

**`mustUseOTP(enabled, isSuperadmin) = isSuperadmin || enabled`** —
Superadmin **selalu** wajib OTP, apa pun nilai `otp_enabled` di database. Tidak bisa dimatikan.
Artinya: tanpa SMTP yang berfungsi, Superadmin tidak bisa login sama sekali.

Validasi ketat yang harus direplikasi:
- `username` 3–254 char, `password` 1–256 char
- `challenge` **tepat 43 char**, `code` **tepat 6 digit** (dicek karakter per karakter)
- OTP hidup 5 menit, maksimum **5 percobaan**, sekali pakai
- Menerbitkan challenge baru otomatis membatalkan challenge lama akun itu (transaksional)

Jalur tanpa-OTP mengunci baris user (`FOR SHARE`) dan **memeriksa ulang** policy di dalam
transaksi, untuk mencegah race dengan admin yang menyalakan OTP → `403 policy_changed_retry_login`.

### 2.6 Throttling login

Tabel `sdl_login_limits`, kunci = HMAC-SHA256 (bukan nilai mentah):

| Tujuan | Kunci |
|---|---|
| per username | `signature("limit-user", lowercase(username))` |
| per IP | `signature("limit-ip", remoteIP)` |
| penerbitan OTP per user | `signature("otp-send-user", userID)` |
| penerbitan OTP per IP | `signature("otp-send-peer", ipKey)` |
| ganti password per user | `signature("password-change-user", userID)` |

Aturan: jendela 15 menit · kunci setelah **5 kegagalan** (`failures >= 4` lalu +1) ·
durasi kunci 15 menit · counter di-cap di 20 · sukses login menghapus counter.

Semua HMAC memakai `SDL_AUTH_SECRET` dengan pola `HMAC(secret, purpose || 0x00 || value)`.
**Byte pemisah `0x00` wajib direplikasi** — tanpa itu, nilai hash berbeda dan seluruh
baris throttle/challenge existing jadi tidak cocok.

---

## 3. Variabel lingkungan

| Variabel | Wajib | Catatan |
|---|---|---|
| `DATABASE_URL` | ya | proses exit kalau kosong |
| `SDL_AUTH_SECRET` | ya | **tepat 64 char hex** (32 byte). Dipakai HMAC throttle, challenge, captcha, OTP |
| `SDL_EVIDENCE_KEY` | untuk file bukti | 64 char hex (32 byte), **harus berbeda** dari `SDL_AUTH_SECRET`. Kunci AES-256-GCM; invalid → operasi file evidence **fail-closed** |
| `SDL_ALLOWED_ORIGINS` | ya di produksi | koma-separated. Default dev: `http://127.0.0.1:5174,http://localhost:5174` |
| `SDL_COOKIE_SECURE` | ya di produksi | `"true"`. Proses **menolak start** kalau `SDL_ENV != development` dan ini bukan true |
| `SDL_ENV` | — | `development` melonggarkan syarat cookie secure |
| `SDL_SMTP_HOST/PORT/USER/PASSWORD/FROM` | ya | port dipaksa 465 atau 587; selain itu jadi 587 |
| `SDL_EMAIL_NOTIFICATIONS_ENABLED` | — | worker aktif kecuali diisi persis `"false"` |
| `SDL_DEV_SUPERADMIN_WORKSPACE` | — | workspace demo lokal, jangan pernah di produksi |
| `HTTP_ADDR` | — | default `:8080` |

Flag CLI yang juga harus punya padanan di Express:

| Flag | Fungsi |
|---|---|
| `--migrate` | jalankan migrasi lalu keluar |
| `--bootstrap-superadmin` | bootstrap sekali, **hanya via stdin** |
| `--healthcheck` | probe `127.0.0.1:8080/readyz`, exit 0/1 (dipakai Docker HEALTHCHECK) |

Saat start normal (tanpa `--migrate`), server menjalankan `migrations.Verify()` dan
**menolak start** kalau skema tidak konsisten. Migrasi tidak pernah jalan otomatis.

---

## 4. Dua model otorisasi (jangan disatukan)

Ini temuan arsitektural paling penting untuk migrasi. Codebase punya **dua engine
otorisasi yang berdiri sendiri**, dipakai oleh kelompok endpoint yang berbeda.
Menyatukannya saat porting akan mengubah perilaku keamanan secara halus.

### 4.1 Engine A — RBAC + grant (`internal/access`)

Dipakai oleh: `urmin/*`, `subbagren/*`, `directives`, `executive/v2`.

`Evaluate(userID, permission, resource, grants, now)` menolak kecuali **semua** lolos:

1. `userID`, `permission`, `resource.Unit` tidak kosong → else `invalid_context`
2. Prefix permission harus cocok dengan unit resource
   (`urmin.*` hanya untuk unit `urmin`, dst.) → else `permission_unit_mismatch`
3. Klasifikasi ∈ {`biasa`, `penting`} → else `classification_denied`
4. Permission `*.update` hanya kalau status = `draft` → else `workflow_denied`
5. Permission `*.approve` hanya kalau status = `review` → else `workflow_denied`
6. Ada grant yang: role aktif · punya permission · unit cocok · belum kedaluwarsa ·
   kalau dokumen `penting` maka `classification_limit` harus `penting` juga
7. Scope grant cocok: `unit` (selalu lolos) / `own` (creator = user) /
   `assigned` (user ada di `AssignedUserIDs`)

Default: **deny** (`no_matching_grant`). Superadmin **tidak** mendapat hak apa pun di sini.

### 4.2 Engine B — grant-scope langsung (`internal/unitwork`)

Dipakai oleh: `unit-work`, `subbagsumda/registry`, `subbagbinfung/registry`, `urmin/registry`.

`permit(ctx, unit, classification, owner, recordID, action)` — **tidak memakai
`permission_key` sama sekali**. Ia query `sdl_access_grants` langsung dan mencocokkan
`scope` dengan verb (`create` / `read` / …). Untuk `read` dengan scope `assigned`,
ia melakukan query tambahan ke `sdl_unit_work_tasks`.

Unit yang diterima dibatasi hard-code: `urmin`, `subbagren`, `subbagsumda`, `subbagbinfung`.

### 4.3 Guard tingkat router

| Guard | Dipakai di | Aturan |
|---|---|---|
| `AuthorizeOperational` | semua mount operasional | authenticated · bukan GET → wajib CSRF · `is_active` · **`NOT must_change_password`** · **bukan Superadmin** |
| `AuthorizeRoleEditor` | `/api/v1/admin` | authenticated · bukan GET → wajib CSRF · **harus** Superadmin · role aktif · punya `identity.roles.manage` · `NOT must_change_password` |

Dua hal yang kontra-intuitif dan wajib dipertahankan:

- **Superadmin ditolak dari semua endpoint operasional.** Ia administrator identitas,
  bukan pengguna operasional. Pengecualian hanya lewat `devdemo.Superadmin()` yang
  harus mati di produksi.
- **`must_change_password = true` memblokir hampir semua hal.** User yang belum
  rotasi password sementara hanya bisa mengakses endpoint auth. Ini sering salah
  didiagnosis sebagai "RBAC rusak".

### 4.4 Otorisasi ad-hoc

Tiga tempat memakai pengecekan sendiri, bukan engine A atau B:

- `directives.isKabag()` — satu query cek grant `br_kabagrenmin` aktif
- `portal.editor()` — cek grant editor portal
- `executiveV2Access()` — Superadmin **boleh** di sini (read-only), atau pemegang
  `br_kabagrenmin` + permission `dashboard.cross_unit.read`

`executive/v2` adalah **satu-satunya tempat Superadmin boleh membaca data operasional**.
Jangan generalisasi aturan ini ke endpoint lain.

---

## 5. Inventaris endpoint (146)

Legenda guard: **P** = publik · **S** = butuh sesi · **O** = `AuthorizeOperational` ·
**R** = `AuthorizeRoleEditor` · **C** = butuh CSRF + Origin

### 5.1 Root — 2

| # | Method | Path | Guard | Catatan |
|---|---|---|---|---|
| 1 | GET | `/healthz` | P | `{"status":"alive"}`, tidak menyentuh DB |
| 2 | GET | `/readyz` | P | ping DB timeout 2 s → 200 `ready` / 503 `unavailable` |

### 5.2 `/api/v1` — 1

| # | Method | Path | Guard | Catatan |
|---|---|---|---|---|
| 3 | GET | `/api/v1/system/status` | P | `{service, phase:"urmin-r5d", status, demoSuperadminWorkspace}` |

### 5.3 `/api/v1/auth` — 15

Semua handler di `internal/auth/service.go` + `profile.go`.

| # | Method | Path | Guard | Request | Respons sukses |
|---|---|---|---|---|---|
| 4 | GET | `/csrf` | P | — | `{csrfToken}` + set cookie |
| 5 | GET | `/bootstrap-status` | P | — | `{hasSuperadmin, smtpConfigured}` |
| 6 | GET | `/captcha` | P | — | `{id, nonce, difficulty, expiresInSeconds}` |
| 7 | POST | `/login` | P + C | `{username, password, captcha:{id,counter}}` | lihat §2.5 |
| 8 | POST | `/verify-otp` | P + C | `{challenge, code}` | `{authenticated:true}` |
| 9 | GET | `/me` | S | — | `{id, username, email, displayName, roles[], units[], mustChangePassword}` |
| 10 | POST | `/logout` | C | — | **204 tanpa body** |
| 11 | POST | `/change-password` | S + C | `{current, new}` | password baru min **14** char, ≠ current |
| 12 | GET | `/profile` | S | — | `{username, displayName, email, phone, hasAvatar}` |
| 13 | PATCH | `/profile` | S + C | `{displayName, phone}` | nama 3–160 rune, telepon cocok `^[+0-9() .-]{0,40}$` |
| 14 | GET | `/profile/avatar` | S | — | `image/jpeg`, `Cache-Control: no-store, private`; tanpa avatar → 404 teks |
| 15 | PUT | `/profile/avatar` | S + C | body biner JPEG/PNG | maks 2 MiB; 413 `avatar_too_large`, 400 `invalid_avatar`. Dikodekan ulang jadi JPEG 256×256 q85 |
| 16 | DELETE | `/profile/avatar` | S + C | — | |
| 17 | POST | `/profile/email/start` | S + C | `{email, password}` | 202 `{challenge}`; maks 3 per 15 menit; 409 `email_in_use`, 400 `same_email` |
| 18 | POST | `/profile/email/verify` | S + C | `{challenge, code}` | challenge 43 char, code 6 digit; gagal → 400 `invalid_or_expired_code` |

> `/me` menggabungkan role dari **dua sumber**: `sdl_user_roles` (langsung) `UNION`
> `sdl_access_grants` (grant aktif, belum dicabut, belum kedaluwarsa). Query ini
> harus diporting apa adanya — menyederhanakannya mengubah role yang terlihat user.

### 5.4 `/api/v1/unit-work` — 13 · guard **O** · engine B

`{unit}` ∈ `urmin` | `subbagren` | `subbagsumda` | `subbagbinfung` (hard-coded).

| # | Method | Path |
|---|---|---|
| 19 | GET | `/{unit}/people` |
| 20 | GET | `/{unit}/records` |
| 21 | POST | `/{unit}/records` |
| 22 | GET | `/{unit}/records/{id}` |
| 23 | PATCH | `/{unit}/records/{id}` |
| 24 | DELETE | `/{unit}/records/{id}` |
| 25 | POST | `/{unit}/records/{id}/files` |
| 26 | GET | `/{unit}/records/{id}/files/{fileID}` |
| 27 | DELETE | `/{unit}/records/{id}/files/{fileID}` |
| 28 | POST | `/{unit}/records/{id}/tasks` |
| 29 | POST | `/{unit}/records/{id}/tasks/{taskID}/receive` |
| 30 | POST | `/{unit}/records/{id}/tasks/{taskID}/complete` |
| 31 | POST | `/{unit}/records/{id}/tasks/{taskID}/cancel` |

Ketiga task action memakai handler-factory `taskAction(status)` dengan transisi
`received` / `completed` / `cancelled`. Ada cabang khusus `unit == "urmin"` di
4 tempat (`work.go:370, 423, 613, 700`) — periksa saat porting.

### 5.5 `/api/v1/subbagsumda/registry` — 6 · guard **O** · engine B

| # | Method | Path |
|---|---|---|
| 32 | GET | `/ranks` |
| 33 | GET | `/` |
| 34 | POST | `/` |
| 35 | GET | `/{id}` |
| 36 | PATCH | `/{id}` |
| 37 | DELETE | `/{id}` |

`/ranks` membaca master `sdl_polri_rank_master`; `validRank()` memvalidasi input terhadapnya.

### 5.6 `/api/v1/subbagbinfung/registry` — 5 · guard **O** · engine B

| # | Method | Path |
|---|---|---|
| 38 | GET | `/` |
| 39 | POST | `/` |
| 40 | GET | `/{id}` |
| 41 | PATCH | `/{id}` |
| 42 | DELETE | `/{id}` |

### 5.7 `/api/v1/urmin/registry` — 9 · guard **O** · engine B

Registry surat **keluar** (`sdl_outgoing_workflows`, `sdl_outgoing_events`).

| # | Method | Path | Catatan |
|---|---|---|---|
| 43 | GET | `/` | |
| 44 | POST | `/` | |
| 45 | GET | `/{id}` | |
| 46 | PATCH | `/{id}` | |
| 47 | DELETE | `/{id}` | |
| 48 | GET | `/{id}/workflow` | |
| 49 | POST | `/{id}/submit` | |
| 50 | POST | `/{id}/approve` | `outgoingDecision(true)` |
| 51 | POST | `/{id}/reject` | `outgoingDecision(false)` |

#### R5G7 — `source` pada endpoint 43 (2026-11-03)

Arsip Urmin terbagi dua kategori, dan pembedanya `fields->>'sumber'` — kunci
yang **hanya** ditulis endpoint 143 saat mengarsipkan disposisi.

| `source` | Hasil |
|---|---|
| absen / `''` | semua, perilaku sebelum R5G7 |
| `manual` | `fields->>'sumber'` bukan `'disposisi'` — **termasuk yang tidak punya kunci itu sama sekali** |
| `disposisi` | lahir dari pengarsipan disposisi |

Nilai lain → **400 `invalid_source`**.

Tiga hal yang mudah salah diporting:

- **Tidak ada backfill, dan tidak perlu.** Entri arsip yang dibuat sebelum R5G7
  tidak punya kunci `sumber`; `IS DISTINCT FROM` memperlakukan NULL itu sebagai
  manual, yang memang benar — semuanya dulu diinput tangan.
- **Disaring di SQL, bukan sesudahnya.** Endpoint ini memotong di 100 baris
  SETELAH penyaringan izin per baris (pola B5). Menyaring kategori di luar SQL
  berarti arsip manual bisa terdorong keluar jendela begitu entri disposisi
  menumpuk. Dengan filter di SQL, tiap kategori punya 100 barisnya sendiri.
- **Param ini berlaku untuk ketiga `kind`**, bukan hanya `arsip` — tapi hanya
  di `arsip` ia bermakna, karena `surat_keluar` dan `agenda` tidak pernah punya
  kunci `sumber` sehingga keduanya selalu terhitung `manual`.

### 5.8 `/api/v1/subbagren/usulan` — 10 · guard **O** · engine A

| # | Method | Path | Permission |
|---|---|---|---|
| 52 | GET | `/capabilities` | — (probe izin) |
| 53 | GET | `/` | `subbagren.usulan.read` |
| 54 | POST | `/` | `subbagren.usulan.create` |
| 55 | GET | `/{id}` | `subbagren.usulan.read` |
| 56 | PATCH | `/{id}` | `subbagren.usulan.update` |
| 57 | POST | `/{id}/submit` | `subbagren.usulan.submit` |
| 58 | POST | `/{id}/review` | `subbagren.usulan.review` |
| 59 | PATCH | `/{id}/revision` | `subbagren.usulan.update` |
| 60 | POST | `/{id}/resubmit` | `subbagren.usulan.submit` |
| 61 | GET | `/consolidation` | `subbagren.usulan.consolidate` |

### 5.9 `/api/v1/subbagren/budget` — 11 · guard **O** · engine A

Endpoint file menyimpan bukti **terenkripsi AES-256-GCM** di kolom `body`
(`subbagren/evidence_crypto.go`): prefix envelope ASCII `"SDL1"` + nonce 96-bit acak
+ ciphertext/tag, dengan envelope `"SDL1"` dipakai sebagai **AAD**. Kunci 32 byte
dari `SDL_EVIDENCE_KEY`; kunci invalid → **fail-closed**, tidak ada fallback plaintext.

Review bukti memakai **optimistic locking**: body menyertakan `version`, dan
ketidakcocokan menghasilkan `409 version_or_status_conflict` (`evidence.go:328`).

| # | Method | Path | Permission |
|---|---|---|---|
| 62 | GET | `/` | `subbagren.anggaran.read` |
| 63 | GET | `/capabilities` | — |
| 64 | POST | `/pagu` | `subbagren.anggaran.pagu.register` |
| 65 | POST | `/pagu/{id}/review` | `subbagren.anggaran.pagu.verify` |
| 66 | POST | `/realisasi` | `subbagren.anggaran.realisasi.record` |
| 67 | POST | `/realisasi/{id}/review` | `subbagren.anggaran.realisasi.verify` |
| 68 | GET | `/realisasi/{id}/evidence` | `subbagren.anggaran.bukti.read` |
| 69 | POST | `/realisasi/{id}/evidence` | `subbagren.anggaran.bukti.upload` (maks 5 MiB) |
| 70 | GET | `/realisasi/{id}/evidence/{proofId}/download` | `subbagren.anggaran.bukti.read` |
| 71 | POST | `/realisasi/{id}/evidence/{proofId}/review` | `subbagren.anggaran.bukti.verify` |
| 72 | GET | `/reconciliation` | `subbagren.anggaran.reconcile` |

### 5.10 `/api/v1/portal/posts` — 3 · guard **ad-hoc**

Guard unik: coba `AuthorizeOperational`; kalau gagal **dan** method GET,
coba `AuthorizeRoleEditor` (Superadmin boleh baca publikasi terbit saja).

| # | Method | Path |
|---|---|---|
| 73 | GET | `/` |
| 74 | POST | `/` |
| 75 | PUT | `/{id}` |

POST dan PUT memakai handler yang **sama** (`portalAPI.Save`).

### 5.11 `/api/v1/executive/v2` — 2 · guard **ad-hoc**

| # | Method | Path | Catatan |
|---|---|---|---|
| 76 | GET | `/access` | apakah pemanggil boleh melihat ringkasan |
| 77 | GET | `/overview` | query param `period` |

Satu-satunya tempat Superadmin boleh membaca data operasional (read-only).
Jalur non-Superadmin: `br_kabagrenmin` + `dashboard.cross_unit.read`.

### 5.12 `/api/v1/leadership/directives` — 18 · guard **O** · ad-hoc `isKabag()`

| # | Method | Path | Catatan |
|---|---|---|---|
| 78 | GET | `/meta` | |
| 79 | GET | `/candidates` | **LIMIT 300**, mengecualikan Superadmin & Kabagrenmin |
| 80 | GET | `/draft` | |
| 81 | PUT | `/draft` | |
| 82 | DELETE | `/draft` | |
| 83 | GET | `/draft/attachments` | |
| 84 | POST | `/draft/attachments` | |
| 85 | DELETE | `/draft/attachments/{fileID}` | |
| 86 | GET | `/attachments/{fileID}/download` | |
| 87 | GET | `/inbox` | |
| 88 | GET | `/sent` | |
| 89 | GET | `/notifications` | |
| 90 | POST | `/` | body maks 14 000 B |
| 91 | GET | `/{id}` | |
| 92 | GET | `/{id}/attachments` | |
| 93 | POST | `/{id}/read` | `event(w, r, "read")` |
| 94 | POST | `/{id}/acknowledge` | `event(w, r, "acknowledged")` |
| 95 | POST | `/{id}/ack-seen` | |

> **Urutan route penting.** `GET /{id}/attachments` didaftarkan **sebelum** `GET /{id}`
> (`api.go:80-81`), dan `/draft`, `/inbox`, `/sent`, `/meta`, `/candidates`,
> `/notifications` semuanya didaftarkan sebelum `/{id}`. Express mencocokkan route
> **berurutan** — kalau `/{id}` naik ke atas, `GET /inbox` akan tertangkap sebagai
> `id = "inbox"`. Pertahankan urutan deklarasi persis seperti di Go.

#### R5G2 — `incomingId` (migrasi 035, 2026-11-03)

Tautan opsional dari arahan ke surat masuk yang memicunya. **Diubah di Go dan
Express bersamaan** dan golden direkam ulang dalam satu siklus.

| Endpoint | Bentuk | Catatan |
|---|---|---|
| 90 `POST /` | body: `incomingId` UUID \| `null` \| absen | Absen dan `null` sama artinya: tidak ada surat asal |
| 81 `PUT /draft` | body: idem | Draf hanya diperiksa **bentuknya**, bukan izinnya |
| 80 `GET /draft` | respons: `draft.incomingId`, **selalu hadir**, `null` kalau kosong | Field draf lain pun selalu hadir, jadi tanpa `omitempty` |
| 87, 88, 91 | respons: `incomingId` **ber-`omitempty`** | Arahan tanpa surat asal terserialisasi persis seperti sebelum R5G2 |

Dua hal yang mudah salah diporting:

- **`omitempty` berbeda antara draf dan summary.** Di `GET /draft` field-nya
  selalu muncul (bisa `null`); di 87/88/91 ia **hilang sama sekali** saat kosong.
  Ketidaksamaan ini mengikuti struct Go apa adanya.
- **Gerbang izin hanya berjalan saat kirim, bukan saat autosave.** Draf adalah
  kertas buram privat yang tidak pernah terkirim; memvalidasi izin di sana akan
  membuat autosave gagal selagi penulisnya masih memilih surat.

Surat yang boleh ditautkan: hanya yang `route_status='awaiting_kabag'`, yang
`kabag_recipient`-nya adalah aktor itu sendiri, **dan** yang distribusinya sudah
berstatus `received`. Gagal memenuhi salah satunya → **400 `invalid_request`**,
sama dengan jalur penerima tidak sah. Surat tanpa baris intake (sebelum R5F7)
sengaja **tidak** bisa ditautkan.

### 5.13 `/api/v1/urmin/surat-masuk` — 15 · guard **O** · engine A

Komposisi: `incoming.Routes` (6) + `R3BRoutes` (7) + `R5F7Routes` (2).

| # | Method | Path | Permission |
|---|---|---|---|
| 96 | GET | `/capabilities` | probe `urmin.surat_masuk.create` |
| 97 | GET | `/` | `urmin.surat_masuk.read` (difilter per dokumen) |
| 98 | POST | `/` | `urmin.surat_masuk.create` |
| 99 | GET | `/{id}` | `urmin.surat_masuk.read` |
| 100 | PATCH | `/{id}` | `urmin.surat_masuk.update` |
| 101 | POST | `/{id}/register` | `urmin.surat_masuk.update` (`mutating(…, true)`) |
| 102 | GET | `/{id}/attachments` | `urmin.surat_masuk.read` |
| 103 | POST | `/{id}/attachments` | `urmin.surat_masuk.attach`, maks 10 MiB |
| 104 | GET | `/{id}/attachments/{attachmentId}/download` | `urmin.surat_masuk.download` |
| 105 | GET | `/{id}/recipient-candidates` | `read` + `distribute` |
| 106 | GET | `/{id}/distributions` | `urmin.surat_masuk.read` |
| 107 | GET | `/{id}/disposition-tracking` | `surat_masuk.read` + `disposisi.read` |
| 108 | POST | `/{id}/distributions` | `read` + `distribute` |
| 109 | POST | `/intake` | `create` atau `update` + `attach` (R5F7) |
| 110 | GET | `/{id}/intake` | `urmin.surat_masuk.read` |

> `GET /` memuat daftar lalu **memfilter per dokumen** lewat `a.decision()` — otorisasi
> baris demi baris, bukan satu query. Lambat tapi disengaja. Jangan "optimasi" jadi
> filter SQL saat migrasi; itu mengubah semantik klasifikasi/scope.
>
> `POST /intake` adalah endpoint gabungan terbesar: membuat **atau** mengubah dokumen,
> melampirkan file, mendaftarkan, **dan** mendistribusikan dalam satu transaksi
> (`r5f7.go:164-430`). Ia menulis ke `sdl_urmin_intake_mail_outbox`. Porting paling akhir
> di domain Urmin.

#### R5G1 — `derajat` dan `docKind` (migrasi 034, 2026-11-02)

Dua field aditif. **Keduanya diubah di Go dan Express bersamaan** dan golden
file direkam ulang dalam satu siklus — bukan perubahan sepihak di Express.

| Field | Di mana | Nilai | Catatan |
|---|---|---|---|
| `derajat` | body & respons endpoint 97–101, 109–110 | `biasa` \| `kilat` | Posisi **persis setelah `classification`** dalam urutan field. Go menserialisasi sesuai urutan deklarasi struct, jadi posisi ini bagian dari kontrak |
| `docKind` | respons endpoint 102; field form endpoint 103; nama field multipart endpoint 109 | `surat` \| `lampiran` | Memisahkan naskah surat dari berkas pendukung |

Tiga perilaku yang mudah salah diporting:

- **`derajat` kosong diterima, bukan 400.** Pemanggil yang belum mengenal field
  ini harus tetap jalan, jadi `""` dinormalkan jadi `biasa` sebelum menyentuh
  SQL — string kosong melanggar CHECK constraint di 034.
- **`docKind` di endpoint 103 bersifat opsional**, dan nilai di luar dua itu
  ditolak `400 invalid_doc_kind` — tidak didiamkan jadi `lampiran`.
- **Endpoint 109 memakai dua field multipart**: `surat` (paling banyak satu) dan
  `files` (lampiran). Batas 10 berkas dihitung **gabungan**, bukan per field,
  karena `MaxBytesReader` menimbang seluruh body.

`derajat` **tidak ikut keputusan otorisasi mana pun.** `classification` mengatur
siapa boleh melihat; `derajat` hanya mengatur seberapa cepat ditangani.
Memasukkannya ke Engine A akan mengubah arti `classification_limit` pada grant
yang sudah ada.

#### R5G2 — dua nilai `workflowStatus` baru (migrasi 035, 2026-11-03)

`workflowStatus` **bukan kolom**; ia diturunkan saat dibaca dari `route_status`
ditambah keadaan distribusi, tugas, dan — sejak R5G2 — arahan yang tertaut.
Kolom `route_status` sendiri tidak pernah berubah setelah intake.

Saat `route_status='awaiting_kabag'`, presedensinya **paling maju lebih dulu**:

| Urutan | Nilai | Syarat |
|---|---|---|
| 1 | `directive_issued` | ada arahan dengan `incoming_id` = surat ini |
| 2 | `in_progress` / `awaiting_review` / `dispatched` | Kabagrenmin sudah meneruskan (jalur distribusi lama) |
| 3 | `read_kabag` | distribusi ke Kabagrenmin sudah `received` |
| 4 | `awaiting_kabag` | belum satu pun di atas |

`directive_issued` **mengalahkan** `dispatched`: begitu pimpinan menjawab
suratnya, apakah ia juga diteruskan bukan lagi yang dilaporkan field ini.

#### R5G5 — `workflowSince` pada endpoint 97 (2026-11-03)

Field aditif di sebelah `workflowStatuses`, **bukan di dalamnya**: peta
`{incomingId: submitted_at}` dari `sdl_urmin_incoming_intake`.

```json
{
  "items": [...],
  "limited": false,
  "workflowStatuses": { "<id>": "awaiting_kabag" },
  "workflowSince":    { "<id>": "2026-11-01T02:15:30Z" }
}
```

Tiga hal yang mudah salah diporting:

- **Peta terpisah, bukan nilai gabungan.** Mengubah `workflowStatuses[id]` dari
  string menjadi objek akan mematahkan setiap pemanggil lama; peta kedua tidak.
- **Hanya memuat surat yang punya baris intake.** Surat warisan R3B tidak punya
  `submitted_at`, jadi id-nya tidak muncul sama sekali — bukan muncul bernilai
  null. Pemanggil harus menyiapkan diri atas id yang tidak ada.
- **Selalu `{}` saat kosong, tidak pernah `null`.** Di Go map-nya diinisialisasi
  non-nil; di Express ia objek literal.

Gunanya: tanpa angka ini `awaiting_kabag` tidak bisa dibedakan antara surat yang
diajukan tadi pagi dan yang menggantung dua minggu. Itulah yang dibutuhkan
Staf Urmin untuk tahu kapan perlu mengingatkan Kabagrenmin.

#### R5G6 — lampiran hasil tindak lanjut (migrasi 036, 2026-11-03)

Tiga endpoint baru pada mount disposisi, dan **gerbangnya tidak sama**:

| # | Aksi | Siapa | Gagal |
|---|---|---|---|
| 144 | unggah | pihak tugas **dan** pelaksananya, selama tugas belum `completed` | bukan pihak → 404 · pihak tapi bukan pelaksana → **403** · sudah selesai → **409 `already_completed`** |
| 145 | daftar | seluruh pihak tugas | bukan pihak → 404 |
| 146 | unduh | seluruh pihak tugas | bukan pihak → 404 · berkas bukan milik tugas itu → 404 |

Pembedaan itu yang menjadikannya bukti. Kalau penerbit boleh mengunggah, berkas
di sini berhenti berarti "ini yang dikerjakan pelaksana"; kalau pelaksana masih
boleh mengunggah sesudah selesai, telaah penerbit berjalan atas kumpulan berkas
yang masih bisa berubah di belakangnya.

Empat hal yang mudah salah diporting:

- **403 pada endpoint 144, bukan 404.** Penerbit adalah pihak tugas, jadi
  keberadaan tugasnya memang sudah boleh ia ketahui — yang ditolak hanyalah
  perbuatannya. Dua endpoint lainnya tetap 404 untuk bukan-pihak.
- **Status dinilai ULANG di dalam transaksi, dengan `FOR UPDATE`.** Tugas bisa
  diselesaikan selama berkasnya dibaca dari jaringan; tanpa penguncian itu,
  bukti bisa menyelinap sesudah telaah dimulai.
- **Batas 10 berkas per tugas**, dihitung di dalam transaksi yang sama →
  409 `attachment_limit`.
- **`Content-Type` balasan 146 SELALU `application/octet-stream`**, apa pun
  `mime_type` yang tersimpan, berikut `Content-Security-Policy: sandbox` dan
  `X-Content-Type-Options: nosniff`. Berkas ini tidak pernah dirender peramban.
  SHA-256 diperiksa ulang sebelum satu byte pun dikirim; tidak cocok →
  503 `attachment_integrity_failure`.

Batas ukuran, daftar MIME, dan kode errornya sengaja **sama persis** dengan
lampiran surat masuk (102–104): PDF/PNG/JPEG, maksimal 10 MiB,
`invalid_attachment` · `file_required` · `file_too_large` · `invalid_file_type`
· `invalid_reason`.

> **Urutan route di Express.** `/{taskId}/attachments` harus dideklarasikan
> sebelum `/{taskId}/attachments/{fileId}/download`, dan keduanya setelah
> `/leadership`. Lihat §6.

> **Belum ada endpoint "kirim pengingat", dan itu disengaja.** Kedua tabel
> outbox yang ada tidak bisa membawanya: `sdl_urmin_email_outbox` terikat ke
> tugas disposisi dengan `event_key` ber-CHECK tertutup, dan
> `sdl_urmin_intake_mail_outbox` ber-`UNIQUE(distribution_id,recipient_user)`
> yang kuotanya sudah terpakai oleh pemberitahuan intake. Pengingat lewat email
> karena itu menuntut migrasi tersendiri.

### 5.13.1 Catatan daftar vs detail

> **Daftar (97) dan detail (110) sengaja tidak sama dalamnya.** Keduanya
> mengenali `directive_issued` dan `read_kabag`, tetapi hanya 110 yang
> menghitung rantai tugas `in_progress`/`awaiting_review` — 97 berhenti di
> `dispatched`. Asimetri ini sudah ada sebelum R5G2 dan dipertahankan apa adanya;
> menyamakannya akan mengubah baris yang tidak diniatkan tersentuh.

### 5.14 `/api/v1/urmin/distribution-inbox` — 5 · guard **O**

Komposisi: `R3BInboxRoutes` (3) + `R3CInboxRoutes` (2).

| # | Method | Path |
|---|---|---|
| 111 | GET | `/` |
| 112 | POST | `/{distributionId}/receive` |
| 113 | GET | `/{distributionId}/events` |
| 114 | GET | `/{distributionId}/disposition-candidates` |
| 115 | POST | `/{distributionId}/dispositions` |

### 5.15 `/api/v1/urmin/dispositions` — 15 · guard **O**

Komposisi: `R3CTaskRoutes` (11) + `R3D3Routes` (4).

| # | Method | Path | Permission |
|---|---|---|---|
| 116 | GET | `/` | `urmin.disposisi.read` |
| 143 | POST | `/{taskId}/archive` | `urmin.surat_masuk.read` atas suratnya **+** wewenang buat register Urmin |
| 144 | POST | `/{taskId}/attachments` | pihak tugas **dan** pelaksananya |
| 145 | GET | `/{taskId}/attachments` | pihak tugas |
| 146 | GET | `/{taskId}/attachments/{fileId}/download` | pihak tugas |
| 117 | GET | `/{taskId}/history` | |
| 118 | POST | `/{taskId}/accept` | `urmin.disposisi.execute` |
| 119 | POST | `/{taskId}/complete` | `urmin.disposisi.execute` |
| 120 | POST | `/{taskId}/review` | `urmin.disposisi.review` |
| 121 | GET | `/{taskId}/forward-candidates` | `urmin.disposisi.forward` |
| 122 | POST | `/{taskId}/forward` | `urmin.disposisi.forward` |
| 123 | GET | `/leadership` | `urmin.disposisi.final.monitor` |
| 124 | GET | `/{taskId}/final-status` | `urmin.disposisi.final.monitor` |
| 125 | POST | `/{taskId}/submit-final` | `disposisi.review` + `final.submit` |
| 126 | POST | `/{taskId}/decide-final` | `urmin.disposisi.final.approve` |

> **Jebakan urutan route:** `GET /leadership` didaftarkan di `R3D3Routes`, yang dipanggil
> **setelah** `R3CTaskRoutes` mendaftarkan `/{taskId}/...`. Di chi ini aman karena chi
> memakai radix tree yang memprioritaskan segmen statis. **Di Express tidak** — Express
> mencocokkan berurutan, jadi `/leadership` harus dipindah ke **atas** `/{taskId}/...`,
> kalau tidak ia tidak akan pernah tereksekusi untuk path `/leadership/...`.
>
> Ini perbedaan router paling berbahaya dalam migrasi ini. Sapu **seluruh** route
> dan pastikan segmen statis selalu dideklarasikan sebelum parameter yang setara.
> Lihat §6.

`taskChainValid()` memvalidasi rantai disposisi berjenjang (`sdl_urmin_disposition_tasks`
dengan parent), dan `leadershipAllowed()` punya validasi UUID + whitelist permission sendiri.

#### R5G3 — rentang tanggal, dan arsip disposisi (2026-11-03)

**Diubah di Go dan Express bersamaan**, golden direkam ulang dalam satu siklus.

**Endpoint 116 menerima tiga query param baru**, dan **perilaku bawaannya berubah**:

| Param | Nilai | Arti |
|---|---|---|
| `window` | `active` (bawaan) · `archive` · `all` | `active` = `letter_date` dalam ±30 hari; `archive` komplemen persisnya; `all` perilaku sebelum R5G3 |
| `from` + `to` | `YYYY-MM-DD` | Rentang eksplisit atas `letter_date`; **menimpa `window`** |

Empat hal yang mudah salah diporting:

- **Tanpa param apa pun, 116 TIDAK lagi mengembalikan semua.** Bawaannya kini
  `window=active`. `window=all` memulihkan perilaku lama; tidak ada baris yang
  menjadi tak terjangkau, ia hanya berpindah tampilan.
- **`from` dan `to` wajib berpasangan.** Salah satu saja → `400 invalid_input`.
  Rentang setengah terbuka terbaca sebagai "sejak tanggal ini seterusnya" oleh
  pemanggil, padahal diam-diam tetap kena batas ±30 hari.
- **Nilai `window` di luar ketiganya → `400 invalid_input`**, bukan didiamkan
  jatuh ke `active`.
- **Klausa pihak WAJIB dalam kurung.** `WHERE (t.issued_by=$1 OR t.assigned_to=$1)`
  — tanpa kurungnya `AND` yang disusulkan mengikat ke `t.assigned_to=$1` saja,
  dan setiap tugas yang pemanggilnya hanya menerbitkan lolos dari saringan tanggal.

**Endpoint 143 `POST /{taskId}/archive`** membuat entri di register Arsip Urmin:

- Tunduk pada **dua** gerbang: Engine A `urmin.surat_masuk.read` atas surat di
  balik disposisinya (gagal → **404**, bentuk yang sama dengan endpoint 99),
  **dan** wewenang membuat register Urmin — pemeriksaan yang sama dengan
  `unitwork.permit()` di endpoint 44 (gagal → **403**).

> **Gerbang pertama sengaja BUKAN `taskParty()`.** Mengarsipkan adalah urusan
> rumah tangga Urmin atas daur hidup surat, sedangkan pihak disposisi hampir
> selalu berada di `subbagren`/`subbagsumda`/`subbagbinfung` — dan tidak satu
> pun dari ketiganya punya grant di unit `urmin`. Memasangkan `taskParty`
> dengan pemeriksaan register akan menghasilkan endpoint yang **tidak
> terjangkau akun nyata mana pun**: 403 bagi para pihak, 404 bagi staf Urmin
> yang justru memiliki arsipnya. Itu persis bentuk kegagalan B9. Akun yang
> benar-benar bisa memakainya: `ka-urmin` dan `kabagrenmin` (scope unit),
> serta `op-urmin`/`staf-urmin` untuk surat buatan sendiri.
- Menulis **dua baris**, sama seperti endpoint 44: satu `sdl_unit_work_records`
  lalu satu `sdl_urmin_registry` yang menunjuknya (`work_record_id` NOT NULL UNIQUE).
- `ref_code` deterministik: `ARS-DISP-<nomor surat>-<8 digit id tugas>`, huruf
  besar, maksimal 64 karakter. Karena deterministik, `UNIQUE(kind, lower(ref_code))`
  menjadi penjaga idempotensi: percobaan kedua → **409 `already_archived`**.
- Surat yang masih di dalam rentang aktif → **409 `still_active`**. Rentangnya
  ditegakkan di server, bukan hanya di UI.
- **Tidak menghapus atau memindahkan apa pun.** Baris disposisinya tetap di
  tempatnya dan tetap terjangkau lewat `?window=archive`.

> **Paginasi tidak ada di API ini, dan itu disengaja.** Pilihan 5/10/50/100 per
> halaman dikerjakan frontend atas data yang sudah lolos otorisasi. Endpoint 116
> menyaring izin **sesudah** `LIMIT 200` (lihat B5), jadi `?page`/`?size` di
> server akan menghasilkan halaman yang jumlah barisnya tidak tetap.

### 5.16 `/api/v1/admin` — 16 · guard **R** (Superadmin)

**roles** (`internal/roles/service.go`):

| # | Method | Path |
|---|---|---|
| 127 | GET | `/permissions` |
| 128 | GET | `/roles` |
| 129 | POST | `/roles` |
| 130 | PUT | `/roles/{roleKey}` |

**roadmap** (`internal/roadmap/api.go`):

| # | Method | Path |
|---|---|---|
| 131 | GET | `/project-roadmap` |
| 132 | PATCH | `/project-roadmap/{id}` |

**delegasi — fail-closed, `HandleFunc` jadi berlaku untuk SEMUA method:**

| # | Method | Path | Perilaku |
|---|---|---|---|
| 133 | * | `/delegations` | selalu `403 {"error":"access_denied"}` |
| 134 | * | `/delegations/*` | selalu `403` |
| 135 | * | `/delegation-candidates` | selalu `403` |

**users** (`internal/users/service.go`), dibungkus group yang meneruskan actor:

| # | Method | Path |
|---|---|---|
| 136 | GET | `/users` |
| 137 | POST | `/users` |
| 138 | PATCH | `/users/{userID}` |
| 139 | PUT | `/users/{userID}/access` |
| 140 | GET | `/units` |
| 141 | GET | `/audit` |
| 142 | PATCH | `/users/{userID}/otp` |

> `PATCH /users/{userID}/otp` **tidak bisa** mematikan OTP untuk Superadmin —
> `mustUseOTP()` mengabaikan nilai database untuk Superadmin (§2.5).

---

## 6. Perbedaan router chi → Express (wajib dibaca sebelum coding)

| Aspek | chi (Go) | Express | Tindakan |
|---|---|---|---|
| Pencocokan route | radix tree, segmen statis menang atas parameter **apa pun urutan deklarasinya** | berurutan, yang pertama cocok menang | **Urutkan ulang manual**: semua segmen statis sebelum `:param` yang setara |
| Parameter | `{id}` | `:id` | konversi mekanis |
| Wildcard | `/delegations/*` | `/delegations/*` atau `/delegations/:rest(*)` | verifikasi |
| Trailing slash | `Route("/x")` + `Get("/")` → redirect 301 | sama, tanpa redirect | catat deviasi (§1.4) |
| Field JSON asing | ditolak (`DisallowUnknownFields`) | diabaikan | validasi mode strict |
| Batas body | `MaxBytesReader` per handler | `express.json({limit})` global | set **per route**, bukan global |
| Panic | `middleware.Recoverer` → 500 | perlu error handler eksplisit (+ `async` handler) | pasang handler global |

Route yang **dipastikan** butuh penataan ulang urutan:

- `/api/v1/urmin/dispositions/leadership` sebelum `/{taskId}/*`
- `/api/v1/leadership/directives/{meta,candidates,draft,inbox,sent,notifications,attachments}`
  sebelum `/{id}`
- `/api/v1/subbagren/usulan/{capabilities,consolidation}` sebelum `/{id}`
- `/api/v1/subbagren/budget/{capabilities,pagu,realisasi,reconciliation}` sebelum pola `/{id}`
- `/api/v1/urmin/surat-masuk/{capabilities,intake}` sebelum `/{id}`
- `/api/v1/subbagsumda/registry/ranks` sebelum `/{id}`

---

## 7. Yang BELUM ada di dokumen ini

Jujur soal batas dokumen ini. Yang sudah diverifikasi dari source: daftar route,
guard, permission, cookie, parameter kripto, batas ukuran, kode error, env.

Yang **belum** diekstrak dan masih harus dikerjakan per-endpoint saat porting:

1. **Bentuk request/response body** untuk 124 endpoint domain (semua kecuali auth).
2. **Query parameter** (`?q=`, `?period=`, paginasi) — baru sebagian terlihat.
3. **Status code sukses** non-200 di luar `logout` (204).
4. **Header `Content-Disposition`** pada endpoint download.

**Jangan menebak keempatnya.** Ambil lewat *golden file capture*: jalankan Go backend
yang ada, panggil tiap endpoint dengan data benih yang sama, simpan respons mentahnya
sebagai fixture, lalu jadikan itu test paritas untuk Express. Itu Tahap 0 di
`MIGRATION-PLAN.md`, dan alasan utama kenapa `apps/backend/` tidak boleh dihapus
sampai migrasi selesai.
