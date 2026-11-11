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
| Endpoint terpasang (mounted) | **157** (142 + R5G3 arsip disposisi + R5G6 lampiran + R5G10 kode arsip + R5G12 master data + R5H1 bagian & surat tertaut + R5H2 opsi disposisi + R5H4 Paur) |
| Prefix mount | 15 |
| Tabel Postgres | 57 (+`sdl_disposisi_opsi` R5H2, +`sdl_paur` dan `sdl_user_paur` R5H4) |
| File migrasi SQL | 43 (`001_core.sql` … `043_arahan_paur.sql`) |
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

## 5. Inventaris endpoint (155)

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

#### R5H5 — berkas pendukung (migrasi 044, 2026-11-05)

Kolom baru `sdl_unit_work_files.purpose`: `lampiran` (default, termasuk setiap
berkas sebelum 044) atau `pendukung`. Diubah di Go dan Express bersamaan.

| Di mana | Perubahan |
|---|---|
| `POST /{unit}/records/{id}/files` | field multipart opsional `purpose`: kosong/`lampiran`/`pendukung`; selain itu `400 invalid_purpose` (diperiksa sesudah `unsupported_file_type`). Batas `max_10_files` dihitung **per jenis** |
| `GET /{unit}/records/{id}` | objek di `files` mendapat `"purpose":"pendukung"` sebagai kunci terakhir, **hanya** untuk berkas pendukung (`omitempty`) |
| upload & `DELETE …/files/{fileID}` | berkas pendukung **tidak** melewati `lockOutgoingEditing`, jadi tidak pernah `409 outgoing_locked`. Pada DELETE, berkas yang tidak ditemukan diperlakukan sebagai lampiran sehingga urutan kunci → 404 tidak berubah |
| alur surat keluar (submit/approve) | sidik jari dokumen dan syarat `pdf_required_before_submit` hanya menghitung `purpose='lampiran'` |

Keputusan pemilik sistem: tombol "Berkas" di daftar Surat Keluar menambah
berkas pendukung yang boleh ditambah kapan saja dan tidak ikut ditinjau
Kabagrenmin. Lampiran surat tetap dikelola lewat form Edit dan tetap terkunci.

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

### 5.7.1 `/api/v1/urmin/kode-arsip` — 1 · guard **O**

| # | Method | Path | Catatan |
|---|---|---|---|
| 147 | GET | `/` | `?q=` nama atau kode · `?prefix=` keluarga |

#### R5G13 — nomor surat keluar dirakit sistem (migrasi 039, 2026-11-03)

Pada **endpoint 44** (`POST /urmin/registry` dengan `kind=surat_keluar`),
`fields.nomorSurat` **tidak lagi diisi pemanggil**. Backend merakitnya dan
menimpa apa pun yang dikirim:

```
B/ND-157/X/HUM.1.2./2026/Bagrenmin
│ │   │   │     │     │      └─ fields.unitNomor
│ │   │   │     │     └──────── tahun, jam sistem
│ │   │   │     └────────────── fields.kodeArsip
│ │   │   └──────────────────── bulan Romawi, jam sistem
│ │   └──────────────────────── sdl_surat_nomor_urut, satu deret per tahun
│ └──────────────────────────── fields.jenisSurat
└────────────────────────────── fields.sifatSurat: Biasa=B, Kilat=K
```

Empat field menjadi **wajib** untuk `kind=surat_keluar`, masing-masing dengan
kode errornya sendiri — semuanya 400:

| Kurang | Kode |
|---|---|
| `sifatSurat` bukan Biasa/Kilat | `derajat_required` |
| `jenisSurat` kosong | `jenis_surat_required` |
| `kodeArsip` kosong | `kode_arsip_required` |
| `unitNomor` di luar lima nilai sah | `unit_nomor_required` |

`unitNomor` hanya menerima `Bagrenmin` · `Urmin` · `Subbagren` · `Subbagsumda`
· `Subbagbinfung`.

Empat hal yang mudah salah diporting:

- **Pemeriksaan kelengkapan terjadi SEBELUM transaksi dibuka.** Kalau ditunda
  ke dalam transaksi, permintaan yang tidak lengkap sudah terlanjur mengambil
  nomor dari deret sebelum ditolak.
- **Perakitan terjadi DI DALAM transaksi.** Kalau penyimpanan suratnya gagal,
  nomor yang terlanjur diambil ikut dibatalkan — tanpa itu setiap kegagalan
  penyimpanan membakar satu nomor.
- **Alokasinya `INSERT ... ON CONFLICT(tahun) DO UPDATE ... RETURNING`.** Itu
  mengambil row lock sehingga atomik tanpa `SELECT ... FOR UPDATE` terpisah.
  Membacanya lalu menulisnya terpisah membuka celah dua surat bernomor sama.
- **Deret tidak dijamin rapat, dan itu disengaja.** Nomor diberikan saat draf
  dibuat, jadi draf yang batal meninggalkan lubang yang tidak diisi ulang.

> **Golden endpoint 44 tetap stabil** karena responsnya hanya `{id, workRecordId}`
> — nomor yang dirakit tidak ikut terkirim. Tapi `sdl_surat_nomor_urut` **wajib**
> ada di daftar TRUNCATE `seed-docs`, kalau tidak capture memperoleh nomor 1 dan
> compare memperoleh 2 untuk surat yang sama.

#### R5G10 — master kode arsip (migrasi 037, 2026-11-03)

Data referensi untuk segmen keempat nomor surat dinas:

```
B/ND-157/X/HUM.1.2./2026/Bagrenmin
           ^^^^^^^^
```

Arah pencariannya **nama → kode**: petugas mengetik `buku tamu`, sistem
menjawab `HUM.1.2.`. Kode tetap bisa dicari langsung bagi yang hafal, tapi itu
bonus, bukan alur utamanya.

| Param | Nilai | Gagal |
|---|---|---|
| `q` | maks 100 karakter, dicocokkan ke `name` **atau** `code` dengan ILIKE | > 100 → **400 `invalid_search`** |
| `prefix` | 2–5 huruf, dinormalkan ke huruf besar | pola lain → **400 `invalid_prefix`** |

Respons: `{ items: [{code, name, depth}], limited }`. Dibatasi **50 baris**;
`limited: true` berarti masih ada sisanya. Pencarian kosong mengembalikan 50
pertama, bukan seluruh 701 baris.

Tiga hal yang mudah salah diporting:

- **Mount tersendiri, bukan sub-path `/urmin/registry`.** Di sana ia akan
  bersaing dengan `/{id}`, dan Express mencocokkan route berurutan sehingga
  segmen statis tidak otomatis menang. Lihat §6.
- **Hanya guard operasional — tidak memanggil Engine A maupun B.** Isinya data
  referensi yang sama untuk semua unit: tidak ada kepemilikan atau klasifikasi
  yang bisa dilanggar, dan setiap akun yang boleh menyusun surat perlu
  membacanya. Ini satu-satunya endpoint operasional dengan sifat itu, dan
  karena itu disebutkan di sini.
- **`LIMIT 51`, lalu baris ke-51 dibuang.** Satu baris lebih diambil hanya
  untuk menentukan `limited`; ia tidak pernah ikut terkirim.

> **Isi tabelnya belum lengkap.** Berkas sumber terpotong di bagian depan —
> keluarga HUK hanya menyisakan tiga kode, dan `HUK.7.1.` dari contoh permintaan
> asli tidak ada. Rinciannya di `PENOMORAN-SURAT-KELUAR.md`.

### 5.7.2 `/api/v1/urmin/jenis-surat` — 1 · guard **O**

| # | Method | Path | Catatan |
|---|---|---|---|
| 148 | GET | `/` | seluruh daftar, tanpa pencarian dan tanpa batas |

### 5.7.3 `/api/v1/admin/master/{set}` — 4 · guard **R** (Superadmin)

| # | Method | Path |
|---|---|---|
| 149 | GET | `/master/{set}` |
| 150 | POST | `/master/{set}` |
| 151 | PATCH | `/master/{set}/{code}` |
| 152 | DELETE | `/master/{set}/{code}` |

#### R5G12 — master data persuratan (migrasi 038, 2026-11-03)

`{set}` hanya menerima **tiga** nilai (`disposisi` sejak R5H2); selain itu → **404 `not_found`**:

| `set` | Tabel | Pola kode |
|---|---|---|
| `jenis-surat` | `sdl_surat_jenis` | `^[A-Z0-9][A-Z0-9/-]{0,11}$` |
| `kode-arsip` | `sdl_surat_kode_arsip` | `^[A-Z]{2,5}(\.[0-9]+)+\.$` |
| `disposisi` | `sdl_disposisi_opsi` | `^[A-Z][A-Z0-9_]{1,23}$` (nama maks 120) |

Payload POST dan PATCH seragam `{code, name}` untuk ketiga himpunan, dengan
`DisallowUnknownFields`. Kode dinormalkan ke huruf besar dan nama dirapatkan
spasinya sebelum diperiksa.

| Kode error | Status | Sebab |
|---|---|---|
| `invalid_code` | 400 | kode tidak sesuai pola himpunannya |
| `invalid_name` | 400 | nama < 2 karakter atau melewati batas |
| `code_immutable` | 400 | `code` di body berbeda dari `code` di path |
| `duplicate` | 409 | kode sudah ada, atau nama bentrok (jenis surat unik per nama) |
| `code_in_use` | 409 | masih dipakai surat yang tercatat; untuk `disposisi`: disebut di `sheet->'dispositions'` arahan **terkirim** (draf tidak menahan penghapusan) |

Lima hal yang mudah salah diporting:

- **Derajat dan klasifikasi SENGAJA bukan bagian dari `{set}`.** Derajat terikat
  CHECK constraint di `sdl_urmin_incoming` (migrasi 034), sehingga "bisa
  dikelola" hanya akan jadi ilusi — menambah nilai ketiga tetap menuntut
  migrasi. Klasifikasi dibaca `permit()` untuk menentukan siapa boleh membuka
  dokumen; menjadikannya data yang dapat disunting berarti satu operasi di sini
  menggeser hak akses di empat unit sekaligus.
- **Kode tidak dapat diubah lewat PATCH.** Ia kunci primer dan sudah tercetak
  di nomor surat yang terlanjur terbit. Hanya nama yang boleh berganti.
- **`prefix` dan `depth` kode arsip diturunkan dari kodenya**, bukan diminta ke
  pemanggil — keduanya selalu bisa dihitung, dan memintanya hanya membuka
  peluang mereka tidak cocok dengan kodenya.
- **Tidak ada foreign key dari surat ke master ini.** Kodenya tersimpan sebagai
  teks di JSONB, jadi penghapusan tidak merusak surat yang sudah ada — tapi
  membuat kodenya yatim. Karena itu dihalangi `code_in_use` selama terpakai.
- **Guard Superadmin, bukan operasional.** Ini konfigurasi, bukan pekerjaan
  unit. Endpoint 148 yang membaca daftar jenis surat untuk formulir justru
  sebaliknya: guard operasional, sama alasannya dengan kode arsip (147).

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

### 5.12 `/api/v1/leadership/directives` — 21 · guard **O** · ad-hoc `isKabag()`

| # | Method | Path | Catatan |
|---|---|---|---|
| 78 | GET | `/meta` | |
| 79 | GET | `/candidates` | **LIMIT 300**, mengecualikan Superadmin & Kabagrenmin. **Tidak lagi dipakai layar sejak R5H1**; tetap ada karena kontrak beku |
| 153 | GET | `/sections` | R5H1, diperluas R5H4. Sebelas pilihan tujuan (jabatan · bagian · Paur), selalu kesebelasnya |
| 154 | GET | `/letters` | R5H1. Surat yang boleh ditautkan, **LIMIT 100** |
| 155 | GET | `/disposition-options` | R5H2. Opsi centang disposisi. **Tanpa `isKabag()`** — penerima juga butuh namanya |
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
> `/sections`, `/letters`, `/disposition-options`, `/notifications` semuanya didaftarkan sebelum `/{id}`.
> Express mencocokkan route **berurutan** — kalau `/{id}` naik ke atas,
> `GET /inbox` akan tertangkap sebagai `id = "inbox"`. Pertahankan urutan
> deklarasi persis seperti di Go.

#### R5H2 — lembar disposisi (migrasi 041, 2026-11-04)

Arahan boleh membawa **satu objek `sheet` opsional** berisi isian lembar
disposisi kertas. Disimpan sebagai satu kolom JSONB (`sheet`) di
`sdl_leadership_directives` dan `sdl_leadership_directive_drafts`; `NULL` =
arahan tanpa lembar. **Diubah di Go dan Express bersamaan**
(`directives/sheet.go` ↔ `modules/directives/sheet.js`).

Bentuk, dengan **urutan kunci = urutan field struct Go**:

```
{letterFrom, letterNumber, directiveDate, letterDate, subject,
 classification, derajat, dispositions, dispositionNote, agendaNo}
```

| Kunci | Aturan (400 kalau dilanggar) |
|---|---|
| `letterFrom` / `letterNumber` / `subject` / `dispositionNote` | string, maks 200 / 100 / 250 / 1000 **rune**, dihitung atas nilai **mentah**; di-`TrimSpace` saat disimpan |
| `directiveDate` / `letterDate` | `''` atau tanggal kalender nyata `YYYY-MM-DD` (`2026-02-30` → 400); **tidak** di-trim |
| `classification` | **wajib** `biasa` \| `penting` — kunci absen menjadi `''` dan ditolak |
| `derajat` | **wajib** `biasa` \| `kilat` |
| `dispositions` | string[] 0–20, tiap kode `^[A-Z][A-Z0-9_]{1,23}$`, tanpa duplikat; absen/`null` → `[]` |
| `agendaNo` | milik server, **selalu `null`**; nilai bukan-null → 400 |

Kunci teks yang absen atau `null` menjadi `''` (zero value Go), bukan error.

| Endpoint | Bentuk | Catatan |
|---|---|---|
| 155 `GET /disposition-options` | `{items:[{code,name}]}` urut `name` | Guard **O** saja, **tanpa `isKabag()`** — penerima arahan juga butuh namanya untuk menampilkan lembar. Hanya 503 saat database gagal |
| 90 `POST /` | body: `sheet` objek \| `null` \| absen | Kunci asing **di dalam** `sheet` → 400 (`DisallowUnknownFields` berlaku bersarang). Tipe salah → 400 |
| 81 `PUT /draft` | body: idem | Hanya **bentuk** (`validSheet`); master disposisi tidak diperiksa — autosave tidak boleh gagal karena Superadmin menghapus satu opsi |
| 80 `GET /draft` | respons: `draft.sheet` **ber-`omitempty`**, kunci terakhir | BERBEDA dari `draft.incomingId` yang selalu hadir |
| 87, 88, 91 | respons: `sheet` **ber-`omitempty`**, kunci **terakhir** (sesudah `incomingId`) | Arahan tanpa lembar terserialisasi persis seperti sebelum 041 |

Gerbang saat kirim (`sheetAllowed`, di transaksi, **sesudah** gerbang surat
tertaut; ditolak → **400**, galat database → **503**):

- setiap kode `dispositions` harus ada di `sdl_disposisi_opsi`;
- dengan `incomingId`, lembar `biasa` atas surat `penting` ditolak — lembar
  tidak boleh menurunkan klasifikasi surat;
- lembar `penting`: setiap penerima wajib punya grant aktif ber-
  `classification_limit='penting'` (jalur bagian: di unit bagiannya; jalur
  `recipients` lama: unit mana pun).

> **Belum byte-identik di dua hal, keduanya bukan milik R5H2.** Encoder Go
> menulis `<`, `>`, `&`, U+2028, U+2029 sebagai escape Unicode; `writeJson`
> Express memakai `JSON.stringify` untuk **semua** endpoint, jadi isinya sama
> tapi byte-nya tidak. Dan decoder Go mencocokkan nama field **tanpa peka huruf
> besar** (`"LetterFrom"` diterima), sedangkan `parsePayload` / `sheet.js`
> mencocokkan persis (400). Keduanya teruji di `verify/r5h2-sheet-parity.js`
> sebagai deviasi yang diketahui.

#### R5H4 — jabatan, seluruh bagian, dan Paur (migrasi 043, 2026-11-04)

Keputusan pemilik sistem. **Diubah di Go dan Express bersamaan**
(`directives/sections.go` ↔ `modules/directives/sections.js`), diverifikasi
`verify/r5h4-flow.js` termasuk paritas byte. Desain lengkap:
`docs/R5H4-ARAHAN-BAGIAN-PAUR.md`.

| Jenis (`kind`) | Kunci | Penerima |
|---|---|---|
| `jabatan` | `kasubbagren` `kasubbagsumda` `kasubbagbinfung` `kasubbagurmin` | pemegang role kepala (perilaku R5H1, kunci tidak berubah) |
| `bagian` | `subbagren` `subbagsumda` `subbagbinfung` `urmin` | **seluruh** anggota unit ber-grant aktif di unit itu, tanpa Kabagrenmin/Superadmin |
| `paur` | `paur_sumda` `paur_log` `paur_ada` | anggota `sdl_user_paur` untuk Paur itu |

Perubahan kontrak:

- **153** `items[]` kini 11 dan membawa kunci **`kind`** sesudah `label`.
  Label `kasubbagurmin` berubah `Kasubbagurmin` → `Kaurmin`.
  `canReceive*` kini dihitung atas semua grant orang itu di unitnya, dengan
  syarat scope `unit`/`assigned` — sama dengan `urmin.recipientEligible`.
- **90 / 81** `sections` 1–11 / 0–11. Orang yang terjaring dua pilihan dicatat
  **sekali**, dengan `section` pilihan pertama yang menyebutnya.
- **90: klasifikasi tidak lagi menolak penerima.** Lembar `penting` tidak lagi
  menuntut grant `penting` pada setiap penerima, dan penerima yang tidak berhak
  atas surat tertaut **dilewati** saat penyerahan surat (dulu 400 untuk seluruh
  payload). Arahannya tetap sampai; naskah suratnya tidak. Pemeriksaan akses
  surat di modul Urmin tidak berubah.
- Yang tetap 400: pilihan tanpa anggota, lembar `biasa` atas surat `penting`.

#### R5H5 — No. Agenda dari surat keluar (tanpa migrasi, 2026-11-05)

Keputusan pemilik sistem: No. Agenda pada lembar arahan diisi **nomor surat
keluar lengkap** dari surat keluar **pertama** (menurut `created_at`, lalu `id`)
yang merujuk arahan itu, **sejak draf dibuat**. Diubah di Go dan Express
bersamaan; keduanya aditif.

| Field | Di mana | Nilai |
|---|---|---|
| `rujukanArahanId` | `fields` surat keluar, endpoint `/urmin/registry` (create & PATCH) | `""` atau UUID kanonik huruf kecil; selain itu `400 invalid_urminregister_record` |
| `agendaSurat` | respons endpoint 91 (`GET /{id}`) saja, **kunci terakhir** sesudah `sheet` | string, `omitempty` |

- Dihitung saat dibaca, tidak disalin ke `sheet`. `sheet.agendaNo` tetap
  selalu `null` dan tetap ditolak saat dikirim.
- Surat keluar terhapus (`deleted_at`) tidak dihitung; surat berikutnya yang
  menggantikan.
- `rujukanArahan` (label teks) tetap disimpan untuk tampilan. Surat keluar
  lama yang hanya punya label **tidak** ikut terhitung.
- ID tidak divalidasi terhadap hak akses arahan: surat keluar bisa merujuk ID
  arahan yang tidak terlihat oleh pembuatnya. Dampaknya hanya isi No. Agenda.

#### R5H1 — penunjukan lewat bagian (migrasi 040, 2026-11-04)

Kabagrenmin menunjuk **bagian**, bukan orang. Siapa orangnya ditentukan sistem
saat kirim, dari pemegang jabatan yang berlaku waktu itu. **Diubah di Go dan
Express bersamaan.**

Empat bagian, daftarnya hidup di kode (`directives/sections.go` ↔
`modules/directives/sections.js`) dan **wajib identik di kedua backend**:

| `key` | `unit` | `role_key` |
|---|---|---|
| `kasubbagren` | `subbagren` | `br_kasubbagren` |
| `kasubbagsumda` | `subbagsumda` | `br_kasubbagsumda` |
| `kasubbagbinfung` | `subbagbinfung` | `br_kasubbagbinfung` |
| `kasubbagurmin` | `urmin` | **`br_ka_urmin`** — bukan `br_kasubbagurmin`; begitulah seed menamainya |

Kenapa bukan tabel: `sdl_org_units` hanya punya empat baris dan tidak bisa
membedakan `kasubbagurmin` dari `kabagrenmin`, yang sama-sama di unit `urmin`.
Peta bagian → (unit, role) adalah keputusan struktur organisasi, jadi ia
dipaksa lewat tinjauan kode, bukan lewat Role Editor.

| Endpoint | Bentuk | Catatan |
|---|---|---|
| 153 `GET /sections` | `{items:[{key,label,unit,holders:[{id,name,canReceiveBiasa,canReceivePenting}],letterBiasa,letterPenting}]}` | **Selalu empat item**, termasuk bagian tanpa pemegang jabatan (`holders:[]`) |
| 154 `GET /letters` | `{items:[{id,agendaNo,letterNumber,sender,subject,classification,derajat,letterKind,letterDate,receivedAt,directiveCount}]}` | Syaratnya SAMA PERSIS dengan `letterLinkAllowed`, supaya layar tak pernah menawarkan pilihan yang akan ditolak 400 |
| 90 `POST /` | body: `sections` string[] 1–4 | Mengisi `sections` **dan** `recipients` sekaligus → **400** |
| 81 `PUT /draft` | body: `sections` string[] 0–4 | Draf menerima keduanya terisi; gerbangnya hanya saat kirim |
| 80 `GET /draft` | respons: `draft.sections`, **selalu hadir** | Urutan kunci: **di antara `recipients` dan `incomingId`** |
| 91 `GET /{id}` | respons: `recipients[].section` **ber-`omitempty`** | `/candidates` memakai pemeta yang sama dan tidak pernah mengisinya → responsnya byte-identik seperti sebelum R5H1 |

`letterBiasa` / `letterPenting` adalah agregat **semua-atau-tidak-sama-sekali**:
`true` hanya kalau SELURUH pemegang jabatan di bagian itu boleh menerima
distribusi surat seklasifikasi tersebut. Alasannya, penolakan di `POST /`
memang membatalkan seluruh payload saat satu penerima tidak sah.

**Efek samping yang disengaja — arahan yang menyebut surat ikut menyerahkan
suratnya.** `POST /` dengan `incomingId` **dan** `sections` terisi juga menulis
satu baris `sdl_urmin_distributions` per penerima, di transaksi yang sama,
berikut `sdl_urmin_distribution_events('sent')` dan audit
`urmin.distribution.sent` (metadata `{section, via:'arahan'}`). Tanpa baris itu
penerima tahu ada surat tapi tidak bisa membukanya — seluruh pembacaan surat
masuk disaring di level SQL lewat tabel tersebut — dan rantai disposisi ke
dalam unitnya tetap putus karena `sdl_urmin_disposition_tasks.distribution_id`
NOT NULL.

- `ON CONFLICT (incoming_id,recipient_user) WHERE status='sent' DO NOTHING`
  mengacu ke indeks unik **parsial** `sdl_urmin_delivery_one_pending_idx`;
  klausa `WHERE`-nya wajib ditulis ulang persis atau Postgres melempar error.
- Penerima yang tidak berwenang atas klasifikasi surat → **400**, dan seluruh
  arahan batal. Arahan yang sampai tanpa suratnya adalah instruksi yang tidak
  bisa dikerjakan.
- Jalur `recipients` (lama) **tidak pernah** membuat distribusi: di sana tidak
  ada unit penerima yang bisa dipertanggungjawabkan.

#### R5G2 — `incomingId` (migrasi 035, 2026-11-03)

Tautan opsional dari arahan ke surat masuk yang memicunya. **Diubah di Go dan
Express bersamaan** dan golden direkam ulang dalam satu siklus.

| Endpoint | Bentuk | Catatan |
|---|---|---|
| 90 `POST /` | body: `incomingId` UUID \| `null` \| absen | Absen dan `null` sama artinya: tidak ada surat asal |
| 81 `PUT /draft` | body: idem | Draf hanya diperiksa **bentuknya**, bukan izinnya |
| 80 `GET /draft` | respons: `draft.incomingId`, **selalu hadir**, `null` kalau kosong | Field draf lain pun selalu hadir, jadi tanpa `omitempty` |
| 87, 88, 91 | respons: `incomingId` **ber-`omitempty`** | Arahan tanpa surat asal terserialisasi persis seperti sebelum R5G2 |

> **Koreksi 2026-11-04 (ditemukan tahap 7 `verify/r5h1-flow.js`).** Express
> menempatkan `incomingId` pada **posisi kunci yang salah** di endpoint 87 dan
> 91: tepat sesudah `acknowledged`. Go menserialisasi mengikuti urutan
> deklarasi struct dan menaruhnya **sesudah** `myReadAt`, `myAcknowledgedAt`,
> dan `recipients`. Golden file yang basi sejak R5G tidak menangkapnya.
> Diperbaiki dengan memisahkan `appendIncomingId()` dari `mapSummary()` di
> `shared.js`; pemanggil wajib memanggilnya **paling akhir**. Endpoint 88
> (`/sent`) tidak pernah terpengaruh — ia tidak mengisi `my*` maupun
> `recipients`.

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

> **Diperbarui R5G8 (2026-11-03).** Kriteria arsip disposisi **tidak lagi umur
> surat, melainkan status**. Lihat blok R5G8 di §5.15. Rentang ±30 hari tetap
> ada pada endpoint 116 tapi perannya berubah: menjaga daftar aktif tidak
> membengkak, bukan menentukan keanggotaan arsip.

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

#### R5G8 — arsip otomatis saat telaah disetujui (2026-11-03)

Menggantikan kriteria R5G3. Disposisi masuk arsip karena **pekerjaannya selesai
dan disahkan**, bukan karena suratnya sudah tua.

**Endpoint 116 — arti `window` berubah:**

| Nilai | Sebelum (R5G3) | Sejak R5G8 |
|---|---|---|
| `active` | surat dalam ±30 hari | surat dalam ±30 hari **DAN** `rev.decision<>'approved'` |
| `archive` | surat di luar ±30 hari | `rev.decision='approved'`, **tanpa memandang tanggal** |
| `all` | semua | semua (tidak berubah) |

> **R5H5 — bukti tindak lanjut di arsip (endpoint 145 & 146, GET saja).**
> Selain pihak tugas, pembaca **entri arsip disposisi** di register Urmin kini
> boleh mendaftar dan mengunduh bukti tindak lanjut: syaratnya tugas sudah
> `approved` dan aktor lolos Engine B (`read`) atas berkas kerja entri arsip
> yang `fields.dispositionId`-nya menunjuk tugas itu. Unggah (144) tetap hanya
> pelaksana. Penolakan tetap `404 not_found`. Go: `urmin.archiveReader` lewat
> `unitwork.PermitRead`; Express: `archiveReader` lewat `permit()`.

> **R5H5 (2026-11-05), keputusan pemilik sistem:** rentang `active` menjadi
> **±15 hari** (`CURRENT_DATE - 15 AND CURRENT_DATE + 15`), diubah di Go
> (`r3c.go`) dan Express bersamaan. Hanya batas daftar aktif; keanggotaan
> `archive` tetap ditentukan status, bukan tanggal. Angka ±30 di bagian lain
> dokumen ini adalah catatan historis.

Keduanya tetap saling melengkapi di arti yang penting: yang sudah disahkan
selalu terjangkau lewat `archive` berapa pun umurnya, yang belum selalu
terjangkau lewat `active` selama suratnya masih baru, dan `all` menampilkan
semuanya.

**Endpoint 120 (`review`) kini menulis entri arsip** ketika `decision='approved'`,
di **transaksi yang sama** dengan telaahnya. `revision_requested` tidak.

**Endpoint 143 berganti syarat:** dulu menolak `409 still_active` kalau surat
masih dalam rentang; kini menolak **`409 not_approved`** kalau telaahnya belum
disetujui. Perannya turun menjadi cadangan — untuk tugas yang terlanjur selesai
sebelum R5G8 dan karenanya tidak punya entri arsip.

Tiga hal yang mudah salah diporting:

- **Pengarsipan otomatis di endpoint 120 SENGAJA tidak digerbangi
  `archiveRegisterAllowed`**, berbeda dari endpoint 143. Penerbit yang menelaah
  hampir selalu berada di `subbagren`/`subbagsumda`/`subbagbinfung` dan tidak
  punya grant di unit `urmin`; menggerbanginya akan membuat jalur otomatis ini
  **tidak pernah berjalan** untuk kasus paling lazim — bentuk kegagalan B9 lagi.
  Di sini entri arsip adalah **akibat** dari aksi yang sudah berwenang, bukan
  aksi tersendiri, persis seperti antrean email di baris sebelumnya yang juga
  tidak digerbangi. Siapa yang boleh **membaca** entri itu tetap ditentukan
  Engine B seperti biasa.
- **Keberadaan `ref_code` diperiksa LEBIH DULU, bukan diserahkan ke
  `ON CONFLICT`.** Baris register selalu berpasangan dengan satu berkas kerja;
  menyisipkan berkas kerjanya dulu lalu membiarkan register-nya bentrok akan
  meninggalkan **berkas kerja yatim** pada transaksi telaah yang tetap di-commit.
- **Menelaah dua kali mustahil**, jadi tidak ada balapan: `INSERT ... ON CONFLICT
  (disposition_id) DO NOTHING` plus pemeriksaan `RowsAffected` memastikan satu
  tugas hanya pernah disetujui sekali.

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

**Paur** (`internal/users/paur.go` ↔ `modules/users/paur.js`), R5H4, guard dan
pembawa actor yang sama dengan `/users`:

| # | Method | Path | Catatan |
|---|---|---|---|
| 156 | GET | `/paur` | `{items:[{key,label,unit}], members:[{userId,paurKey,isHead}]}` |
| 157 | PUT | `/users/{userID}/paur` | body `{paurKey: string\|null, isHead: bool, reason}` → `{isHead,paurKey}` |

157: field asing/tipe salah → 400 `invalid_request`; alasan < 8, pola kunci
salah, atau `isHead` tanpa Paur → 400 `invalid_input`; Paur tak dikenal atau
pengguna bukan anggota unit Paur itu → 400 `paur_unit_mismatch`; diri sendiri
→ 403 `self_change_denied`; Superadmin → 403 `protected_user`; tidak ada → 404
`user_missing`. Audit `identity.user_paur_updated`. Keanggotaan Paur **tidak
memberi akses apa pun** dan tidak mencabut sesi.

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

---

## R5H3 — isian tambahan Surat Keluar (2026-11-04)

Allowlist `fields` untuk `kind=surat_keluar` di `/api/v1/urmin/register`
bertambah delapan kunci, di Go (`unitwork/urmin_register.go`) dan Express
(`modules/unitwork/urmin-register.js`) bersamaan:

`rujukanSurat` · `rujukanArahan` · `jalurSurat` · `penandatangan` ·
`pemberiNomor` · `verifikator` · `tembusan` · `tipeSurat`

Aturannya sama dengan kunci lain: teks bebas ≤ 200 karakter (setelah trim),
boleh kosong, kunci di luar allowlist → 400.

### Pilihan dropdown dari master data (migrasi `042_surat_keluar_opsi.sql`)

Enam tabel baru berbentuk identik dengan `sdl_surat_jenis`
(`code` `^[A-Z][A-Z0-9_]{1,23}$`, `name` 2–120, nama unik tanpa beda huruf),
diisi data dummy dan dikelola Superadmin:

| Set Master Data | Tabel | Kunci `fields` | Pilih |
|---|---|---|---|
| `jalur-surat` | `sdl_surat_jalur` | `jalurSurat` | satu |
| `penandatangan` | `sdl_surat_penandatangan` | `penandatangan` | satu |
| `pemberi-nomor` | `sdl_surat_pemberi_nomor` | `pemberiNomor` | satu |
| `verifikator` | `sdl_surat_verifikator` | `verifikator` | banyak |
| `tembusan` | `sdl_surat_tembusan` | `tembusan` | banyak |
| `tipe-surat` | `sdl_surat_tipe` | `tipeSurat` | satu |

* Surat menyimpan **nama** pilihan (pilih-banyak: nama digabung `", "`).
  Karena itu nama pada `verifikator`/`tembusan` tidak boleh memuat koma →
  400 `invalid_name` (juga dijaga CHECK di tabel).
* `DELETE /api/v1/admin/master/{set}/{code}` → 409 `code_in_use` selama ada
  surat keluar aktif yang isiannya memuat nama kode itu saat ini.

**Endpoint baru** — `GET /api/v1/urmin/surat-opsi/` · guard `AuthorizeOperational`
saja (alasan sama dengan `/urmin/jenis-surat`) · 200, kunci berurutan:

```json
{"jalurSurat":[{"code":"…","name":"…"}],"penandatangan":[…],"pemberiNomor":[…],
 "verifikator":[…],"tembusan":[…],"tipeSurat":[…]}
```

Tiap larik diurut `name`; larik kosong `[]`, bukan `null`. Gagal DB → 503
`database_unavailable`.

`rujukanSurat` dan `rujukanArahan` **tidak** punya master data: layar mengisi
pilihannya dari `GET /urmin/surat-masuk/` dan `GET /leadership/directives/inbox`
(+ `/sent` untuk Kabagrenmin), yaitu data nyata yang sudah disaring backend.

## R5H7 — tanda tangan Kabagrenmin pada surat keluar (2026-11-10, EXPRESS SAJA)

Tambahan, **tidak punya padanan Go** dan tidak diliput golden harness. Tidak
mengubah satu pun endpoint lama. Rancangan: `docs/R5H7-TTD-KABAG-SURAT-KELUAR.md`;
uji: `verify/r5h7-flow.js`, `verify/r5h7-pdf-sign.js`. Migrasi `045_ttd_kabag.sql`.

| Method | Path | Guard | Catatan |
|---|---|---|---|
| GET | `/api/v1/urmin/ttd/me` | O + `canManageOutgoing` | `{saved:false}` atau `{saved:true,image,updatedAt}` |
| PUT | `/api/v1/urmin/ttd/me` | O + `canManageOutgoing` | `{image:"data:image/png;base64,..."}` ≤ 200 KB, didekode ulang `sharp` |
| DELETE | `/api/v1/urmin/ttd/me` | O + `canManageOutgoing` | `{saved:false}` |
| POST | `/api/v1/urmin/registry/:id/sign-approve` | O + Engine B read + `canManageOutgoing` | `{version,note?,useSaved,image?,saveAsMine?,placements:{fileId:[{page,x,y,w,h}]}}` → `{ok,status:"approved",signedFiles}` |
| GET | `/api/v1/urmin/registry/:id/signed-files` | O + Engine B read | `{items:[{id,sourceFileId,name,size,signedAt,signer,marks}]}` |
| GET | `/api/v1/urmin/registry/:id/signed-files/:fileID` | O + Engine B read | PDF, `attachment`, sha256 diverifikasi saat unduh |

Galat `sign-approve`: 400 `invalid_input` / `invalid_placements` /
`placements_mismatch` / `invalid_signature_image`; 403 `access_denied`; 409
`workflow_state_changed` / `document_integrity_changed` / `already_signed` /
`no_saved_signature` / `pdf_required_before_submit`; 422 `{error:pdf_unreadable|pdf_encrypted|page_out_of_range,file}`;
503 `signature_key_unavailable`.

`POST /:id/approve` lama tetap ada (Go masih jalur rollback); layar tidak
memakainya lagi untuk Kabagrenmin.

### Pesan Kode Register saat "Tambah" (migrasi 046, Express saja)

| Method | Path | Guard | Catatan |
|---|---|---|---|
| POST | `/api/v1/urmin/registry/nomor-urut` | O + Engine B `create` urmin | `{id,urut,tahun}`. Pesanan terbuka milik akun yang sama pada tahun yang sama DIKEMBALIKAN lagi (tidak membakar deret) |
| POST | `/api/v1/urmin/registry/?reservasi=<uuid>` | sama dengan `POST /` | Query opsional; body TIDAK berubah. Nomor surat memakai `urut` pesanan. 400 `invalid_reservation` (bukan UUID); 409 `reservation_invalid` (bukan milik aktor / terpakai / tahun lain) |

Tanpa `?reservasi` perilakunya identik dengan sebelumnya (nomor diambil saat
draf disimpan) -- yang dipakai Go bila `/urmin` di-rollback.


## R5H8 — pilihan dropdown umum sebagai master data (2026-11-11, EXPRESS SAJA)

Sepuluh pilihan dropdown yang tadinya tertulis di kode frontend kini dikelola
Superadmin. Tidak mengubah satu pun endpoint lama. Rancangan:
`docs/R5H8-MASTER-DATA-DROPDOWN.md`. Migrasi `047_opsi_dropdown.sql`.

| Metode | Path | Guard | Isi |
|---|---|---|---|
| GET | `/api/v1/urmin/opsi-dropdown/` | O | `{"arsip-jenis":[{code,name}],"arsip-status":[...],"agenda-hadir":[...]}` urut `seq` (`agenda-hadir`: migrasi 048, nama tanpa koma) |
| GET | `/api/v1/subbagsumda/opsi-dropdown/` | O | `personel-status`, `kondisi-barang` |
| GET | `/api/v1/subbagbinfung/opsi-dropdown/` | O | `sop-jenis`, `sop-status`, `pid-kategori`, `pid-tingkat-akses`, `pid-status`, `rb-status` |
| GET/POST/PATCH/DELETE | `/api/v1/admin/master/{set}` untuk 11 `set` di atas | RE | Bentuk sama dengan himpunan lama (`{code,name}`; 409 `duplicate`, `code_in_use`; 400 `code_immutable`). Daftar Superadmin diurut `seq`, bukan `code` |

`/api/v1/admin/master/*` masih dilayani Go di produksi; Go menjawab 404 untuk
sepuluh `set` baru. Di server, tambahkan `/api/v1/admin/master/*` ke
`SDL_EXPRESS_PATHS` (atau langkah 5 `/api/*`). Formulir yang tidak bisa membaca
`opsi-dropdown` memakai daftar bawaannya sendiri.

## R5H9 — Arsip "Dari Surat Keluar"; pengarsipan disposisi dihentikan (2026-11-11, EXPRESS SAJA)

Keputusan pemilik sistem 2026-11-11. Go tidak diubah (prefix `/api/v1/urmin/*`
sudah dilayani Express di server).

- `GET /api/v1/urmin/registry/?kind=arsip` — `source` menerima nilai baru
  **`surat_keluar`**: surat keluar dengan `stage='approved'` dan
  `approved_at <= now()-7 hari`. Barisnya adalah register surat keluar itu
  sendiri (`kind:"surat_keluar"`, bukan salinan), plus field tambahan
  `archivedAt` = `approved_at + 7 hari`. `source=''` (Semua Arsip) memuat
  arsip register **dan** surat keluar tersebut, diurutkan menurut
  `archivedAt`/`createdAt`. `manual` dan `disposisi` tidak berubah. Nilai lain
  tetap `400 invalid_source`. Hak baca tetap Engine B per baris.
  `?kind=surat_keluar` tidak berubah (tanpa `archivedAt`).
- Endpoint 120 (`POST /dispositions/{id}/review`, `approved`) **tidak lagi**
  membuat entri arsip. Entri `sumber:'disposisi'` yang sudah ada tidak disentuh.
- Endpoint 143 (`POST /dispositions/{id}/archive`) — setelah gerbang 404/403
  yang sama, menjawab **`409 disposition_archive_disabled`**. Tombolnya sudah
  tidak ada di UI sejak 2026-11-05.
- Konsekuensi: pembaca arsip Urmin (R5H5 `archiveReader`) hanya bisa membaca
  bukti tindak lanjut disposisi yang **sudah punya** entri arsip lama.
  `verify/r5h5-flow.js` bagian 5 cek "pembaca arsip MEMBACA daftar bukti"
  kini gagal karena hal ini. Golden 143 (`already_archived`) juga berubah.
- Uji: `verify/r5h9-flow.js`.
