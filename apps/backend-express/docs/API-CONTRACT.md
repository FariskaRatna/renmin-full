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

## R5H11 — Program Anggaran → Kegiatan → Pagu (2026-11-13, EXPRESS SAJA)

Keputusan pemilik sistem 2026-11-13. Tidak mengubah endpoint lama; pagu lama
R4A3 (`/subbagren/budget`, berbasis Usulan) tetap apa adanya. Migrasi
`049_progar_pagu.sql`; rancangan `docs/R5H11-PROGAR-PAGU.md`; uji
`verify/r5h11-flow.js`.

Hak akses: permission pada grant unit `subbagren` (scope tidak dipakai).
`R` = `subbagren.progar.read`, `M` = `subbagren.progar.manage`,
`A` = `subbagren.pagu.approve`. Semua di balik guard Operasional.

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/api/v1/subbagren/progar/capabilities` | — | `{canRead,canManage,canApprove}` |
| GET | `/api/v1/subbagren/progar/?tahun=YYYY` | R | `{tahun,programs:[{id,tahun,kode,nama,keterangan,version,createdAt,kegiatan:[{id,kode,nama,keterangan,version,pagu,ditolak}]}],totals:{disetujui,draft}}`; tahun kosong = tahun berjalan; 400 `invalid_year` |
| POST | `/api/v1/subbagren/progar/program` | M | `{tahun,kode,nama,keterangan}` → 201 `{id}` |
| PUT | `/api/v1/subbagren/progar/program/:id` | M | `{kode,nama,keterangan,version}` |
| DELETE | `/api/v1/subbagren/progar/program/:id` | M | 409 `program_has_kegiatan` |
| POST | `/api/v1/subbagren/progar/program/:id/kegiatan` | M | `{kode,nama,keterangan}` → 201 `{id}` |
| PUT | `/api/v1/subbagren/progar/kegiatan/:id` | M | `{kode,nama,keterangan,version}` |
| DELETE | `/api/v1/subbagren/progar/kegiatan/:id` | M | 409 `kegiatan_has_pagu` (pagu draft/disetujui) |
| POST | `/api/v1/subbagren/progar/pagu` | M | `{kegiatanId,jumlah,dasar,keterangan}`; `jumlah` string digit rupiah ≤ 10^15; 409 `pagu_exists` |
| PUT | `/api/v1/subbagren/progar/pagu/:id` | M | `{jumlah,dasar,keterangan,version}`; hanya draft, 409 `pagu_not_draft` |
| POST | `/api/v1/subbagren/progar/pagu/:id/review` | A | `{keputusan:"disetujui"\|"ditolak",catatan,version}`; tolak wajib catatan ≥ 8; 403 `self_review_forbidden` bila peninjau = pencatat (juga CHECK di DB) |

Objek pagu: `{id,jumlah,dasar,keterangan,status,version,createdBy,createdByName,createdAt,reviewedByName,reviewedAt,reviewNote}`.
`pagu` = pagu hidup (draft/disetujui) atau `null`; `ditolak` = penolakan
terakhir bila tidak ada pagu hidup. Galat umum: 400 `invalid_body` /
`invalid_input`, 403 `access_denied`, 404 `not_found`, 409 `duplicate` /
`version_conflict`, 503 `database_unavailable`.

## R5H12 — Realisasi per kegiatan (2026-11-13, EXPRESS SAJA)

Realisasi dicatat terhadap **pagu kegiatan yang disetujui** (R5H11), bukan lagi
pagu berbasis Usulan. Endpoint R4A3 (`/subbagren/budget/*`) TIDAK diubah;
layar LRA lama hanya menyembunyikan formulir inputnya (arsip baca). Migrasi
`050_realisasi_kegiatan.sql`; rancangan `docs/R5H12-REALISASI-KEGIATAN.md`;
uji `verify/r5h12-flow.js`.

`RM` = `subbagren.realisasi.manage`, `RV` = `subbagren.realisasi.verify`,
`R` = `subbagren.progar.read`. `capabilities` kini juga mengembalikan
`canRecordRealisasi` dan `canVerifyRealisasi`.

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/api/v1/subbagren/progar/realisasi?tahun=YYYY` | R | `{tahun,items:[{paguId,pagu,terverifikasi,menunggu,sisa,program,kegiatan,realisasi:[…]}],totals:{pagu,terverifikasi,menunggu,sisa}}`; hanya pagu `disetujui` |
| POST | `/api/v1/subbagren/progar/realisasi` | RM | `{paguId,tanggal,uraian,nomorBukti,jumlah}`; 400 `tahun_tidak_cocok`; 409 `pagu_not_approved` / `melebihi_sisa_pagu` |
| PUT | `/api/v1/subbagren/progar/realisasi/:id` | RM | `{tanggal,uraian,nomorBukti,jumlah,version}`; draft saja, 409 `realisasi_not_draft` |
| POST | `/api/v1/subbagren/progar/realisasi/:id/bukti` | RM | multipart `file`, PDF/JPG/PNG ≤ 5 MB, divalidasi dari isi, disimpan AES-256-GCM (`SDL_EVIDENCE_KEY`); menimpa bukti lama dan menaikkan `version` |
| GET | `/api/v1/subbagren/progar/realisasi/:id/bukti` | R | `attachment`, `application/octet-stream`, `nosniff`, sha256 diverifikasi; setiap unduhan masuk audit |
| POST | `/api/v1/subbagren/progar/realisasi/:id/review` | RV | `{keputusan:"terverifikasi"\|"ditolak",catatan,version}`; tolak wajib catatan ≥ 8; 409 `bukti_required`; 409 `melebihi_sisa_pagu` (dicek dengan kunci baris pagu); 403 `self_review_forbidden` |

Objek realisasi: `{id,tanggal,uraian,nomorBukti,jumlah,status,version,createdBy,createdByName,createdAt,reviewedByName,reviewedAt,reviewNote,bukti:{filename,mimeType,size}|null}`.

## R5H13 — Dokumen Perencanaan + Monitoring Kinerja & LKIP (2026-11-13, EXPRESS SAJA)

Migrasi `051_dokumen_kinerja.sql`; rancangan `docs/R5H13-DOKUMEN-KINERJA.md`;
uji `verify/r5h13-flow.js`. Prefix `/api/v1/subbagren/perencanaan`.
`R` = `subbagren.progar.read`, `M` = `subbagren.progar.manage`,
`S` = `subbagren.dokumen.sahkan`.

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/capabilities` | — | `{canRead,canManage,canSahkan}` |
| GET | `/dokumen?tahun=` | R | `{tahun,items:[{id,jenis,jenisLabel,judul,nomor,tanggal,status,version,penggantiDari,digantikan,program,kegiatan,berkas,…}]}` |
| POST | `/dokumen` | M | `{tahun,jenis,judul,nomor,tanggal,programId,kegiatanId,keterangan,penggantiDari}`; jenis ∈ renstra, renja, rka_kl, dipa, revisi_dipa, pok, tor_kak, rab, lainnya; 400 `invalid_link`; 409 `revisi_hanya_dari_dokumen_sah` / `revisi_sudah_ada` |
| PUT | `/dokumen/:id` | M | tanpa `tahun`/`penggantiDari`, + `version`; draft saja |
| POST | `/dokumen/:id/berkas` | M | multipart `file`, PDF ≤ 20 MB, terenkripsi; menaikkan `version` |
| GET | `/dokumen/:id/berkas` | R | unduh `attachment`, sha256 diverifikasi, diaudit |
| POST | `/dokumen/:id/review` | S | `{keputusan:"disahkan"\|"ditolak",catatan,version}`; 409 `berkas_required`; 403 `self_review_forbidden` |
| GET | `/kinerja?tahun=` | R | `{tahun,kegiatan:[{id,kode,nama,program,pagu,realisasi,indikator:[{id,nama,satuan,version,target:[4],capaian:[4×{nilai,catatan,updatedAt,updatedByName}\|null]}]}]}` |
| POST | `/kinerja/indikator` | M | `{kegiatanId,nama,satuan,target:["tw1","tw2","tw3","tw4"]}`; desimal string; 400 `target_tidak_kumulatif` / `target_tahunan_wajib` |
| PUT | `/kinerja/indikator/:id` | M | `{nama,satuan,target,version}` |
| DELETE | `/kinerja/indikator/:id` | M | 409 `indikator_has_capaian` |
| PUT | `/kinerja/indikator/:id/capaian/:tw` | M | `{nilai,catatan}`; tw 1–4; upsert |
| GET | `/kinerja/lkip.xlsx?tahun=` | R | XLSX dua sheet: Capaian Kinerja (+ pagu/realisasi/serapan), Dokumen Sah (versi terbaru) |

## R5H14 — Dasar pagu wajib DIPA sah (2026-11-13, EXPRESS SAJA)

Migrasi `052_pagu_dasar_dipa.sql` (kolom `sdl_ren_pagu.dokumen_id`, nullable,
tanpa backfill). Rancangan `docs/R5H14-PAGU-DASAR-DIPA.md`; uji
`verify/r5h11-flow.js` bagian 3a dan 5a.

- `POST /api/v1/subbagren/progar/pagu` kini `{kegiatanId,jumlah,dokumenId,keterangan}`;
  `PUT /pagu/:id` kini `{jumlah,dokumenId,keterangan,version}`. Field `dasar`
  **tidak lagi diterima** (400 `invalid_body`); server mengisinya dari dokumen
  ("DIPA <nomor>").
- `dokumenId` wajib: dokumen `dipa`/`revisi_dipa`, berstatus `disahkan`, belum
  digantikan revisi sah, dan setahun dengan program kegiatannya.
  400 `dasar_dipa_wajib` / `dasar_dipa_tidak_sah`; 409 `dasar_dipa_digantikan`.
- `POST /pagu/:id/review` dengan `disetujui` memeriksa ulang aturan yang sama
  (DIPA bisa direvisi di antara pencatatan dan persetujuan).
- Objek pagu di `GET /` bertambah `dokumen:{id,jenis,judul,nomor,digantikan}|null`.

## R5H25 — Master Data tahap pekerjaan aktif/nonaktif (2026-11-22, EXPRESS SAJA)

Migrasi `067_master_tahap.sql` (`sdl_ren_tahap_nonaktif`, `sdl_ren_tahap_master_versi`);
rancangan `docs/R5H25-MASTER-DATA-TAHAP-PEKERJAAN.md`; uji `verify/r5h25-master-tahap.js`
dan skenario keamanan `x1_r5h25_master_tahap_admin_guard`. `RE` = AuthorizeRoleEditor
(Superadmin + `identity.roles.manage` + CSRF non-GET + bukan `must_change_password`);
`R`/`M` = `subbagren.progar.read`/`.manage` di bawah guard operasional.

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/api/v1/admin/master/tahap-pekerjaan` | RE | `{version,jenis:[{key,label,kelompok:"progar"\|"dalgar",tahap:[{key,label,aktif,terkunci,alasanKunci?}]}]}` |
| PUT | `/api/v1/admin/master/tahap-pekerjaan/:jenis` | RE | `{aktif:{<tahap>:bool},reason,version}` → `{version,changed}`. 400 `invalid_request` (field asing/bukan JSON), 400 `invalid_input` (jenis/tahap tidak dikenal, nilai bukan boolean, alasan < 8 / > 500 atau berisi karakter kendali/surrogate tunggal); 409 `tahap_terkunci` / `minimal_satu_tahap` / `version_conflict`. Tanpa perubahan nyata: 200 `changed:0`, versi & audit tidak berubah. Audit `master.tahap.update` |
| GET | `/api/v1/subbagren/perencanaan/tahap-katalog` | R | Endpoint R5H16; **aditif**: `nonaktif:{<jenis>:[<tahap>]}`. `jenis` tetap daftar lengkap |
| POST | `/api/v1/subbagren/perencanaan/dokumen/:id/tahap` | M | Endpoint R5H16; tahap nonaktif → 409 `tahap_nonaktif`. Jika masih ada tahap yang belum diterima Kasubbagren → 409 `tahap_belum_diterima` |

Didaftarkan **sebelum** router `/master/:set` (R5G12) di `app.js` supaya tidak tertangkap
sebagai himpunan tak dikenal. Path berada di bawah pola Caddy `/api/v1/admin/master/*`
(R5H8), jadi tidak perlu entri `SDL_EXPRESS_PATHS` baru.

**Rollback.** Bila `/api/v1/admin/master/*` kembali ke Go: guard Go tetap menjawab
401/403, Superadmin mendapat GET 404 `not_found` (himpunan `{set}` tak dikenal; PUT kemungkinan 405 dari chi), dan tab
Tahap Pekerjaan menampilkan galat muat. Baris nonaktif yang tersimpan tetap ditegakkan
Express selama `/api/v1/subbagren/*` di Express. Bila `/api/v1/subbagren/*` kembali ke Go,
seluruh PROGAR/DALGAR memang sudah tidak tersedia di Go; tabel 067 diabaikan. Skema tidak
perlu dibalik.

## R5H27 — Subbagsumda: Master Personel & Monitoring Pensiun (2026-11-23, EXPRESS SAJA)

Migrasi `068_sumda_personel_pensiun.sql` (`sdl_sumda_personel`, `sdl_sumda_pensiun_tinjau`,
permission `subbagsumda.personel.archive` dan `subbagsumda.pensiun.review`, salinan sekali dari
registry personel R5B); rancangan `docs/R5H27-SUMDA-PERSONEL-PENSIUN.md`; uji
`verify/r5h27-sumda-personel.js` dan skenario keamanan `x2_r5h27_sumda_personel_guard`.
Semua endpoint di bawah guard operasional (**O**). Hak = permission pada grant aktif unit
`subbagsumda` (scope apa pun; scope/klasifikasi tidak menyaring baris): `R`/`C`/`U`/`A` =
`subbagsumda.personel.read`/`.create`/`.update`/`.archive`, `V` = `subbagsumda.pensiun.review`.
Validasi strict: field asing → 400 `invalid_body`. Semua respons `Cache-Control: no-store`.

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/api/v1/subbagsumda/personel/capabilities` | O | `{canRead,canCreate,canUpdate,canArchive,canReview}` (tanpa hak → semua `false`, tetap 200) |
| GET | `/api/v1/subbagsumda/personel` | R | `?q=&status=&unitKerja=&lengkap=belum&page=&size=` (size 5/10/50/100, bawaan 10) → `{items,total,page,size,unitKerja:[…]}`. Item: `{id,nrp,nama,jenis,pangkat,pangkatLabel,jabatan,unitKerja,tmtDinas,tanggalPensiun,status,catatan,version,salinan,perluDilengkapi,sisaHari,tahap,createdAt,updatedAt}` |
| POST | `/api/v1/subbagsumda/personel` | C | `{nrp,nama,jenis,pangkat,jabatan,unitKerja,tmtDinas,tanggalPensiun,status,catatan}` → 201 `{item}` |
| GET | `/api/v1/subbagsumda/personel/:id` | R | `{item}`; id bukan UUID/terarsip → 404 `not_found`. **+R5H28:** `item.riwayatKarier[]` (lihat § R5H28). **+R5H29:** `item.riwayatDiklat[]`, `item.kompetensi[]` (lihat § R5H29). **+R5H30:** `item.cutiTahunIni`, `item.riwayatKesejahteraan[]` (lihat § R5H30). **+R5H31:** `item.kinerja[]` (lihat § R5H31). **+R5H32:** `item.arsip[]` (lihat § R5H32) |
| PATCH | `/api/v1/subbagsumda/personel/:id` | U | Badan penuh + `version` → 200 `{item}`; 409 `version_conflict` |
| DELETE | `/api/v1/subbagsumda/personel/:id?version=` | A | Arsip (soft delete) → 204; 409 `version_conflict` |
| GET | `/api/v1/subbagsumda/pensiun/alert` | R | `?tahap=H-60\|H-30\|H-14\|H-7\|JATUH_TEMPO` → `{ringkas:{<tahap>:n},belumDitinjau,items:[{personel,sisaHari,tahap,ditinjau:{oleh,pada}\|null}]}` |
| POST | `/api/v1/subbagsumda/pensiun/alert/tinjau` | V | `{items:[{personelId,tahap,tanggalPensiun}]}` (1–200 butir, kunci persis) → `{ditinjau:n}` (idempoten). Satu butir yang tahap/tanggalnya tidak cocok dengan keadaan sekarang → 409 `alert_berubah`, tidak ada yang tersimpan |
| GET | `/api/v1/subbagsumda/dashboard` | R | **+R5H28:** `totals.karierMenunggu` (lihat § R5H28). **+R5H29:** `totals.kompetensiKedaluwarsa60`. **+R5H30:** `totals.cutiHariIni`, `totals.layananMenunggu`. **+R5H31:** `totals.pembinaanLewatTenggat`, `totals.pemeliharaanJatuhTempo14`. **+R5H32:** `totals.arsipRetensi30`. `{totals:{personel,aktif,mpp,alert,belumDitinjau,belumLengkap,enamBulan},proyeksi:[{bulan:"YYYY-MM",jumlah}×6],alertTerdekat[≤5],terdekat[≤5],aktivitas[≤5]}` |

Aturan isi: `nrp` 2–64 dari `A-Z a-z 0-9 spasi . _ / ( ) [ ] -` (NRP lama yang sudah tersimpan boleh dipertahankan), `nama` 3–200, `jenis` `Polri`\|`PNS` (wajib), `pangkat` kode rank master
aktif (Polri) atau golongan `I/a`…`IV/e` (PNS) — pangkat lama yang sudah tersimpan boleh
dipertahankan selama `jenis` tidak diganti; `jabatan`/`unitKerja` ≤ 200, `catatan` ≤ 1000; `tmtDinas` 1950–2100,
`tanggalPensiun` 2000–2100, wajib bila status `Aktif`/`MPP`; karakter kendali/surrogate tunggal
ditolak, begitu pula karakter format tak terlihat (Unicode `Cf`: zero-width, pembalik arah) di semua isian. Daftar `aktivitas` dashboard tidak memuat nama personel terarsip, dan `rincian` hanya memuat kunci `fields,status,tahap,version,sumber,disalin`. Kode galat: 400 `invalid_body` / `invalid_input` / `invalid_rank`; 403 `access_denied`;
404 `not_found`; 409 `duplicate_nrp` / `version_conflict` / `alert_berubah`; 503 `database_unavailable`.
Sejak R5H28 galat FK (23503) menjadi 400 `invalid_input`, bukan 503 (helper bersama `umum.js`).

Tahap dihitung di Postgres dengan `(now() AT TIME ZONE 'Asia/Jakarta')::date` (pool Express
bersesi UTC): H-60 31–60 hari, H-30 15–30, H-14 8–14, H-7 1–7, `JATUH_TEMPO` ≤ 0; hanya status
`Aktif`/`MPP` bertanggal. Audit `subbagsumda.personel.create|update|archive`,
`subbagsumda.pensiun.review`, `subbagsumda.personel.salin_registry` (migrasi), metadata tanpa
data pribadi.

Tiga mount spesifik (`/subbagsumda/dashboard`, `/personel`, `/pensiun`), di bawah pola Caddy
`/api/v1/subbagsumda/*` yang sudah ada. Endpoint registry R5B (§5.5), `/registry/ranks`, dan
`/opsi-dropdown` tidak berubah; registry personel menjadi arsip de facto (tetap bisa ditulis
lewat API lama, tanpa sinkronisasi ke Master Personel).

**Rollback.** Bila `/api/v1/subbagsumda/*` kembali ke Go: registry dilayani Go, tiga endpoint
baru dijawab chi 404 `text/plain`. Frontend menampilkan "Master Personel tidak tersedia" dan
tombol "Buka data registry lama (darurat)". Tabel 068 diam; skema tidak perlu dibalik. Untuk
mengembalikan registry saja, ganti pola dengan `/api/v1/subbagsumda/personel*
/api/v1/subbagsumda/pensiun/* /api/v1/subbagsumda/dashboard /api/v1/subbagsumda/opsi-dropdown/*`.
**Usang sejak R5H28:** pola ini belum memuat `/api/v1/subbagsumda/karier*` — pakai pola di § R5H28.

## R5H28 — Subbagsumda: Karier & Mutasi (2026-11-23, EXPRESS SAJA)

Migrasi `069_sumda_karier_mutasi.sql` (`sdl_sumda_karier`, `sdl_sumda_karier_riwayat`, `sdl_sumda_karier_lampiran`,
permission `subbagsumda.karier.manage`/`.approve`); rancangan `docs/R5H28-SUMDA-KARIER-MUTASI.md`; uji
`verify/r5h28-sumda-karier.js` dan skenario keamanan `x3_r5h28_sumda_karier_guard`. Guard operasional (**O**). Hak =
permission pada grant aktif unit `subbagsumda` (scope apa pun): `R` = `subbagsumda.personel.read`, `M` =
`subbagsumda.karier.manage`, `A` = `subbagsumda.karier.approve`, `U` = `subbagsumda.personel.update`. Validasi strict;
semua respons `Cache-Control: no-store`.

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/api/v1/subbagsumda/karier/capabilities` | O | `{canRead,canManage,canApprove}` |
| GET | `/api/v1/subbagsumda/karier` | R | `?q=&status=&jenis=&personelId=&page=&size=` (size 5/10/50/100) → `{items,total,page,size}`. Item: `{id,jenis,nomorReferensi,tanggalUsulan,tanggalEfektif,status,catatan,version,usulan:{pangkat,pangkatLabel,jabatan,unitKerja},ringkas,diterapkan,createdBy,createdByName,updatedBy,decidedByName,decidedAt,selesaiAt,personel:{id,nrp,nama,jenis,pangkat,pangkatLabel,jabatan,unitKerja,status,version,terarsip}}` |
| POST | `/api/v1/subbagsumda/karier` | M | `{personelId,jenis,nomorReferensi,tanggalUsulan,tanggalEfektif,usulan,catatan}` → 201 `{item}`. `jenis` `UKP`\|`KGB`\|`MUTASI`\|`PENYESUAIAN_JABATAN`; `usulan` berkunci sesuai jenis (UKP `pangkat`; MUTASI `jabatan`/`unitKerja`, min. satu; PENYESUAIAN_JABATAN `jabatan`; KGB kosong) |
| GET | `/api/v1/subbagsumda/karier/:id` | R | `{item,lampiran:[{id,filename,size,uploadedBy,uploadedByName,uploadedAt}],riwayat:[{dari,ke,catatan,oleh,pada}]}` |
| PATCH | `/api/v1/subbagsumda/karier/:id` | M | `{nomorReferensi,tanggalUsulan,tanggalEfektif,usulan,catatan,version}`; hanya status Diajukan. `personelId`/`jenis` tidak diterima (400 `invalid_body`) |
| POST | `/api/v1/subbagsumda/karier/:id/aksi` | M/A(+U) | `{aksi,catatan,version}`; `selesai` juga `{tanggalEfektif,terapkan:{<field>,personelVersion}}` (KGB tanpa `terapkan`). `proses` M (Diajukan); `setujui`/`tolak` A + bukan pencatat/pengubah terakhir (Diproses); `batalkan` M + pencatat atau A (Diajukan/Diproses); `selesai` M+U (Disetujui) — menerapkan nilai ke Master Personel dalam transaksi yang sama. Tolak/batalkan: catatan ≥ 8 karakter |
| POST | `/api/v1/subbagsumda/karier/:id/lampiran` | M | multipart `file`, PDF ≤ 5 MB, maks. 10; selama Diajukan/Diproses/Disetujui; disegel SDL1 → 201 `{id,sha256}` |
| GET | `/api/v1/subbagsumda/karier/:id/lampiran/:lid` | R | unduh `application/octet-stream`, `attachment`, `nosniff`, `CSP: sandbox`; id silang → 404 |
| DELETE | `/api/v1/subbagsumda/karier/:id/lampiran/:lid` | M | pengunggah atau A; hanya Diajukan/Diproses |

Kode galat: 400 `invalid_body`/`invalid_input`/`invalid_rank`/`invalid_file_type`/`one_file_required`; 413
`file_too_large`; 403 `access_denied`/`self_review_forbidden`; 404 `not_found`; 409 `version_conflict`/
`status_tidak_sesuai`/`pengajuan_ganda`/`personel_berubah`/`personel_terarsip`/`personel_tidak_aktif`/
`personel_belum_lengkap`/`batas_lampiran`; 503 `evidence_encryption_unavailable`/`evidence_integrity_failure`/
`database_unavailable`. Menambah/menghapus lampiran menaikkan `version` dan mencatat pengubahnya sebagai
`updated_by`, sehingga orang yang mengganti lampiran tidak bisa memutus pengajuan itu (perluasan K19). Lampiran juga
ditolak (409 `personel_terarsip`) bila personelnya sudah diarsipkan. **Sejak R5H29:** PDF terenkripsi atau rusak (gagal
diparse pdf-lib / tanpa halaman) → 400 `invalid_file_type`. Nama berkas Unicode diunduh dengan
`filename*=UTF-8''…` (RFC 5987). Bila nilai yang diterapkan saat Selesai berbeda dari usulan yang disetujui,
`diterapkan.dikoreksi` memuat nama field-nya (juga di metadata audit `selesai`). Pengajuan milik personel terarsip hanya bisa
dibatalkan.

Audit `subbagsumda.karier.create|update|proses|setujui|tolak|batalkan|selesai|lampiran.add|lampiran.delete|
lampiran.download` (metadata `{jenis,status,fields,version}` saja); Selesai yang mengubah master juga menulis
`subbagsumda.personel.update {fields,version}`.

**Aditif pada R5H27:** `GET /api/v1/subbagsumda/personel/:id` → `item.riwayatKarier[]` `{id,jenis,status,
tanggalUsulan,tanggalEfektif,ringkas}` (maks. 50, terbaru di atas; tidak ada di respons POST/PATCH); `GET
/api/v1/subbagsumda/dashboard` → `totals.karierMenunggu` (status Diproses, personel belum terarsip). Galat FK (23503) di
modul Sumda kini 400 `invalid_input`, bukan 503.

**Rollback.** Bila `/api/v1/subbagsumda/*` kembali ke Go, `/karier*` dijawab chi 404 `text/plain`; layar Karier
menampilkan "tidak tersedia" (tanpa cadangan registry). Tabel 069 diam; skema tidak perlu dibalik. **Usang sejak R5H29**
(belum memuat `/diklat*`, `/kompetensi*`; pakai pola di § R5H29). Rollback sempit:
`/api/v1/subbagsumda/personel* /api/v1/subbagsumda/pensiun/* /api/v1/subbagsumda/dashboard /api/v1/subbagsumda/karier*
/api/v1/subbagsumda/opsi-dropdown/*`.

## R5H29 — Subbagsumda: Diklat & Kompetensi (2026-11-23, EXPRESS SAJA)

Migrasi `070_sumda_diklat_kompetensi.sql` (`sdl_sumda_diklat`, `sdl_sumda_diklat_peserta`, `sdl_sumda_kompetensi`,
`sdl_sumda_diklat_lampiran`, `sdl_sumda_diklat_riwayat`; permission `subbagsumda.diklat.manage`/`.archive`; salinan
sekali dari registry `kind='pendidikan'`); rancangan `docs/R5H29-SUMDA-DIKLAT-KOMPETENSI.md`; uji
`verify/r5h29-sumda-diklat.js` dan skenario `x4_r5h29_sumda_diklat_guard`. Guard operasional (**O**). Hak = permission
pada grant aktif unit `subbagsumda`: `R` = `subbagsumda.personel.read`, `M` = `subbagsumda.diklat.manage`, `A` =
`subbagsumda.diklat.archive`. Validasi strict; semua respons `Cache-Control: no-store`. Tanpa persetujuan (K3).

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/api/v1/subbagsumda/diklat/capabilities` | O | `{canRead,canManage,canArchive}` |
| GET | `/api/v1/subbagsumda/diklat` | R | `?q=&status=&jenis=&tahun=&page=&size=` → `{items,total,page,size}`. Item: `{id,nama,jenis,penyelenggara,lokasi,nomorSurat,tanggalMulai,tanggalSelesai,status,catatan,version,salinan,jumlahPeserta,createdByName,createdAt,updatedAt}` |
| POST | `/api/v1/subbagsumda/diklat` | M | `{nama,jenis,penyelenggara,lokasi,nomorSurat,tanggalMulai,tanggalSelesai,catatan}` → 201 `{item}`. `jenis` `Pendidikan`\|`Pelatihan`\|`Kursus`\|`Seminar/Lokakarya`\|`Sertifikasi`\|`Lainnya` |
| GET | `/api/v1/subbagsumda/diklat/:id` | R | `{item,peserta:[{id,personelId,nrp,nama,personelStatus,terarsip,pangkatLabel,unitKerja,hasil,nomorSertifikat,keterangan,version,kompetensiId,lampiran[]}],lampiran:[{id,filename,size,uploadedBy,uploadedByName,uploadedAt}],riwayat:[{dari,ke,catatan,oleh,pada}]}` |
| PATCH | `/api/v1/subbagsumda/diklat/:id` | M | badan penuh + `version`; setelah Selesai/Dibatalkan hanya `catatan` boleh berbeda, selain itu 409 `status_tidak_sesuai` |
| POST | `/api/v1/subbagsumda/diklat/:id/status` | M | `{status,catatan,version,tanggalSelesai?}`; Terjadwal→Berjalan→Selesai, Terjadwal/Berjalan→Dibatalkan (alasan ≥ 8 karakter); Selesai wajib tanggal selesai; `tanggalSelesai` hanya untuk Selesai |
| DELETE | `/api/v1/subbagsumda/diklat/:id?version=` | A | arsip; sesudahnya semua sub-endpoint 404; kompetensi turunan tetap |
| POST | `/api/v1/subbagsumda/diklat/:id/peserta` | M | `{personelIds:[uuid…],version}`; 1–50 per kirim, total ≤ 200, all-or-nothing; personel Aktif/MPP; hanya Terjadwal/Berjalan |
| PATCH | `/api/v1/subbagsumda/diklat/:id/peserta/:pid` | M | `{hasil,nomorSertifikat,keterangan,version}`; hanya saat Selesai; `nomorSertifikat` hanya untuk `Lulus`; Lulus→lainnya ditolak 409 `kompetensi_terkait` bila ada kompetensi turunan aktif |
| DELETE | `/api/v1/subbagsumda/diklat/:id/peserta/:pid?version=` | M | versi peserta; hanya Terjadwal/Berjalan; personel terarsip → 409 `personel_terarsip` |
| POST · GET · DELETE | `/api/v1/subbagsumda/diklat/:id/lampiran` · `…/lampiran/:lid` · `…/lampiran/:lid` | M · R · M | PDF kegiatan: POST unggah, GET `:lid` unduh, DELETE `:lid` hapus (daftar ada di `GET /:id`). ≤ 5 MB, maks. 10, SDL1; PDF terenkripsi/rusak → 400 `invalid_file_type`; hapus = pengunggah atau A |
| POST · GET · DELETE | `/api/v1/subbagsumda/diklat/:id/peserta/:pid/lampiran` · `…/:lid` · `…/:lid` | M · R · M | sertifikat peserta (sama); unggah/hapus hanya saat kegiatan Selesai dan personel belum terarsip; rantai induk penuh diperiksa (id silang → 404) |
| GET | `/api/v1/subbagsumda/kompetensi/capabilities` | O | `{canRead,canManage,canArchive}` |
| GET | `/api/v1/subbagsumda/kompetensi/alert` | R | `?tahap=` → `{ringkas:{"H-60","H-30","KEDALUWARSA"},items}`; hanya personel Aktif/MPP belum terarsip; `items` maks. 500 (terdekat dulu), `ringkas` hitungan penuh |
| GET | `/api/v1/subbagsumda/kompetensi` | R | `?q=&personelId=&kategori=&tahap=&page=&size=`. Item: `{id,personelId,nama,kategori,nomor,penerbit,tanggalTerbit,berlakuSampai,catatan,version,dariPesertaId,dariDiklat:{id,nama}\|null,personel:{id,nrp,nama,status,terarsip},sisaHari,tahap}` |
| POST | `/api/v1/subbagsumda/kompetensi` | M | `{personelId,nama,kategori,nomor,penerbit,tanggalTerbit,berlakuSampai,catatan,dariPesertaId?}` → 201; dengan `dariPesertaId`: peserta Lulus, kegiatan Selesai, personel sama (FK komposit), satu kompetensi aktif per peserta (409 `kompetensi_ganda`) |
| GET | `/api/v1/subbagsumda/kompetensi/:id` | R | `{item,lampiran[],sertifikatPeserta:[{id,filename,size}]}` (tautan, tidak disalin); bila kegiatan asal terarsip: `dariDiklat` null (`dariPesertaId` tetap) dan `sertifikatPeserta` kosong |
| PATCH | `/api/v1/subbagsumda/kompetensi/:id` | M | badan penuh + `version`; personel terarsip → 409 `personel_terarsip` |
| DELETE | `/api/v1/subbagsumda/kompetensi/:id?version=` | A | arsip; personel terarsip → 409 `personel_terarsip` |
| POST · GET · DELETE | `/api/v1/subbagsumda/kompetensi/:id/lampiran` · `…/:lid` · `…/:lid` | M · R · M | sertifikat kompetensi (sama) |

Tahap kompetensi dihitung server dari `berlaku_sampai` terhadap hari WIB: `H-60` (31–60 hari), `H-30` (1–30),
`KEDALUWARSA` (≤ 0); `null` bila tanpa batas, personel bukan Aktif/MPP/terarsip, atau ada kompetensi aktif lain dengan
nama sama (`lower(btrim)`) yang berlaku lebih akhir atau tanpa batas (K30).

Kode galat: 400 `invalid_body`/`invalid_input`/`invalid_file_type`/`one_file_required`; 413 `file_too_large`; 403
`access_denied`; 404 `not_found`; 409 `version_conflict`/`status_tidak_sesuai`/`peserta_ganda`/`batas_peserta`/
`personel_tidak_aktif`/`personel_terarsip`/`hasil_belum_boleh`/`kompetensi_ganda`/`kompetensi_terkait`/`batas_lampiran`;
503 `evidence_encryption_unavailable`/`evidence_integrity_failure`/`database_unavailable`.

Audit `subbagsumda.diklat.*` dan `subbagsumda.kompetensi.*` (metadata daftar putih `{jenis,kategori,status,fields,
version,jumlah}`; tanpa nama, NRP, atau nomor sertifikat).

**Aditif pada R5H27:** `GET /api/v1/subbagsumda/personel/:id` → `item.riwayatDiklat[]` `{diklatId,pesertaId,nama,jenis,
status,tanggalMulai,tanggalSelesai,hasil,nomorSertifikat}` dan `item.kompetensi[]` `{id,nama,kategori,nomor,penerbit,
tanggalTerbit,berlakuSampai,sisaHari,tahap}` (masing-masing maks. 50); `GET /api/v1/subbagsumda/dashboard` →
`totals.kompetensiKedaluwarsa60` (H-60 + H-30 + Kedaluwarsa).

**Rollback.** Bila `/api/v1/subbagsumda/*` kembali ke Go, `/diklat*` dan `/kompetensi*` dijawab chi 404 `text/plain`;
layar menampilkan "tidak tersedia" dengan tombol registry pendidikan lama (darurat, K35). Tabel 070 diam; skema tidak
perlu dibalik. **Usang sejak R5H30** (belum memuat `/cuti*`, `/kesejahteraan*`; pakai pola di § R5H30). Rollback sempit: `/api/v1/subbagsumda/personel* /api/v1/subbagsumda/pensiun/*
/api/v1/subbagsumda/dashboard /api/v1/subbagsumda/karier* /api/v1/subbagsumda/diklat* /api/v1/subbagsumda/kompetensi*
/api/v1/subbagsumda/opsi-dropdown/*`.

## R5H30 — Subbagsumda: Cuti & Perizinan + Kesejahteraan (2026-11-24, EXPRESS SAJA)

Migrasi `071_sumda_cuti_kesejahteraan.sql` (`sdl_sumda_cuti`, `sdl_sumda_cuti_riwayat`, `sdl_sumda_cuti_lampiran`,
`sdl_sumda_kesejahteraan`, `sdl_sumda_kesejahteraan_riwayat`, `sdl_sumda_kesejahteraan_lampiran`; permission
`subbagsumda.cuti.manage`/`.approve`, `subbagsumda.kesejahteraan.manage`/`.approve`); rancangan
`docs/R5H30-SUMDA-CUTI-KESEJAHTERAAN.md` (aturan bisnis versi sementara untuk paparan, K43); uji
`verify/r5h30-sumda-cuti-kesejahteraan.js` dan skenario `x5_r5h30_sumda_layanan_guard`. Guard operasional (**O**). Hak =
permission pada grant aktif unit `subbagsumda`: `R` = `subbagsumda.personel.read`, `Mc`/`Ac` = `cuti.manage`/`.approve`,
`Mk`/`Ak` = `kesejahteraan.manage`/`.approve`, `U` = `personel.update`. Validasi strict; semua respons `no-store`.
Alur keduanya: Diajukan → Diproses → Disetujui/Ditolak → Selesai, batalkan dari Diajukan/Diproses/Disetujui (pencatat
atau pemegang approve, alasan ≥ 8 karakter). Setujui/tolak: approve + bukan pencatat, bukan pengubah terakhir, dan
**tidak pernah** mengubah isian/lampiran pengajuan itu (dibaca dari audit; `self_review_forbidden`, CHECK DB untuk
pencatat). Personel terarsip: hanya batalkan.

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/api/v1/subbagsumda/cuti/capabilities` | O | `{canRead,canManage,canApprove}` |
| GET | `/api/v1/subbagsumda/cuti` | R | `?q=&status=&jenis=&bulan=YYYY-MM&personelId=&page=&size=` → `{items,total,page,size}`. Item: `{id,jenis,tanggalMulai,tanggalSelesai,tanggalKembali,jumlahHari,hariDisesuaikan,status,catatan,catatanDibatasi,version,createdBy,createdByName,updatedBy,decidedByName,decidedAt,selesaiAt,createdAt,updatedAt,personel:{id,nrp,nama,status,terarsip}}` |
| GET | `/api/v1/subbagsumda/cuti/kalender` | R | `?bulan=YYYY-MM` (parameter lain → 400) → `{bulan,hari:[{tanggal,items:[{id,nama,jenis,status}]}],terpotong}`; status Diproses/Disetujui/Selesai, personel belum terarsip, maks. 1000, tanpa NRP |
| GET | `/api/v1/subbagsumda/cuti/jatah` | R | `?personelId=&tahun=` (bawaan tahun WIB) → `{tahun,jatah:12,terpakai,dalamProses,sisa}`; terpakai = Tahunan Disetujui+Selesai bertanggal mulai di tahun itu |
| POST | `/api/v1/subbagsumda/cuti` | Mc | `{personelId,jenis,tanggalMulai,tanggalSelesai,jumlahHari?,catatan}` → 201 `{item,peringatan:[]\|["melebihi_jatah"]}`. `jenis` `TAHUNAN`\|`SAKIT`\|`ALASAN_PENTING`\|`BESAR`\|`LAINNYA`. Hari kerja Senin–Jumat dihitung server; `jumlahHari` manual 1…hari kalender (`hariDisesuaikan`). 0 hari kerja tanpa manual, > 366 hari kalender, Tahunan lintas tahun → 400. Personel Aktif/MPP; beririsan dengan cuti Diajukan/Diproses/Disetujui/Selesai → 409 `cuti_bertumpuk` |
| GET | `/api/v1/subbagsumda/cuti/:id` | R | `{item,jatah,lampiran:[{id,filename,dibatasi,size,uploadedBy,uploadedByName,uploadedAt}],riwayat:[{dari,ke,catatan,oleh,pada}]}`; lampiran cuti SAKIT: `filename` null + `dibatasi:true` bagi selain pengunggah dan pemegang `Ac`. Cuti SAKIT: `item.catatan` null + `item.catatanDibatasi:true` bagi selain pencatat dan `Ac` (juga di daftar); `riwayat[].catatan` null bagi selain penulisnya, pencatat cuti, dan `Ac` |
| PATCH | `/api/v1/subbagsumda/cuti/:id` | Mc | `{tanggalMulai,tanggalSelesai,jumlahHari?,catatan,version}` → `{item,peringatan}`; hanya Diajukan, personel Aktif/MPP; `personelId`/`jenis` tidak diterima; `catatan: null` = tidak diubah |
| POST | `/api/v1/subbagsumda/cuti/:id/aksi` | Mc/Ac | `{aksi,catatan,version}`; `selesai` juga `{tanggalKembali?,jumlahHari?}` (hari terakhir yang dijalani ∈ [mulai, min(selesai, hari ini WIB)]; jumlah hari dihitung ulang, tidak melebihi yang disetujui; `jumlahHari` hanya bersama `tanggalKembali` dan ≤ jumlah yang disetujui). Selesai sebelum hari pertama cuti → 409 `status_tidak_sesuai`; isian `selesai` pada aksi lain → 400 |
| POST · GET · DELETE | `/api/v1/subbagsumda/cuti/:id/lampiran` · `…/:lid` · `…/:lid` | Mc · R* · Mc | PDF ≤ 5 MB, maks. 10, SDL1, terenkripsi/rusak → 400; unggah selama Diajukan/Diproses/Disetujui/Selesai, hapus (pengunggah atau `Ac`) hanya Diajukan/Diproses. *Unduh lampiran cuti SAKIT: pengunggah atau `Ac`, selain itu 403 `access_denied` (diputus di SQL) |
| GET | `/api/v1/subbagsumda/kesejahteraan/capabilities` | O | `{canRead,canManage,canApprove}` |
| GET | `/api/v1/subbagsumda/kesejahteraan` | R | `?q=&status=&jenis=&personelId=&lewatTarget=1&page=&size=`. Item: `{id,jenis,nomorReferensi,targetSelesai,lewatTarget,status,catatan,diterapkan,statusUsulan,version,createdBy,createdByName,updatedBy,decidedByName,decidedAt,selesaiAt,createdAt,updatedAt,personel:{id,nrp,nama,status,tanggalPensiun,version,terarsip}}` |
| POST | `/api/v1/subbagsumda/kesejahteraan` | Mk | `{personelId,jenis,nomorReferensi,targetSelesai,catatan}` → 201 `{item}`. `jenis` `PERSIAPAN_PENSIUN`\|`MPP`\|`ASABRI`\|`KARTU_IDENTITAS`\|`LAINNYA`. Personel Aktif/MPP. Masih ada layanan terbuka jenis sama (kecuali `LAINNYA`) → 409 `{error:"pengajuan_ganda",id}` |
| GET | `/api/v1/subbagsumda/kesejahteraan/:id` | R | `{item,lampiran[],riwayat[]}` |
| PATCH | `/api/v1/subbagsumda/kesejahteraan/:id` | Mk | `{nomorReferensi,targetSelesai,catatan,version}`; hanya Diajukan |
| POST | `/api/v1/subbagsumda/kesejahteraan/:id/aksi` | Mk/Ak(+U) | `{aksi,catatan,version}`; `selesai` boleh `{terapkan:{status,personelVersion}}` hanya untuk MPP (`status:"MPP"`, dari Aktif, tanggal pensiun wajib → 409 `personel_belum_lengkap`) dan PERSIAPAN_PENSIUN (`status:"Pensiun"`, dari Aktif/MPP); butuh `U`. Versi personel beda → 409 `personel_berubah`; status asal lain → 409 `personel_tidak_aktif`. Tanpa `terapkan`: `diterapkan={}` |
| POST · GET · DELETE | `/api/v1/subbagsumda/kesejahteraan/:id/lampiran` · `…/:lid` · `…/:lid` | Mk · R · Mk | sama dengan lampiran cuti, tanpa pembatasan Sakit |

Kode galat: 400 `invalid_body`/`invalid_input`/`invalid_file_type`/`one_file_required`; 413 `file_too_large`; 403
`access_denied`/`self_review_forbidden`; 404 `not_found`; 409 `version_conflict`/`status_tidak_sesuai`/`cuti_bertumpuk`/
`pengajuan_ganda`/`personel_tidak_aktif`/`personel_terarsip`/`personel_berubah`/`personel_belum_lengkap`/`batas_lampiran`;
503 `evidence_encryption_unavailable`/`evidence_integrity_failure`/`database_unavailable`. "Melebihi jatah" bukan galat.

Audit `subbagsumda.cuti.*` dan `subbagsumda.kesejahteraan.*` (`create|update|proses|setujui|tolak|batalkan|selesai|
lampiran.add|lampiran.delete|lampiran.download`, metadata `{jenis,status,fields,version}` saja). Selesai yang mengubah
status personel juga menulis `subbagsumda.personel.update {fields:["status"],version}`.

**Aditif pada R5H27:** `GET /api/v1/subbagsumda/personel/:id` → `item.cutiTahunIni` `{tahun,jatah,terpakai,dalamProses,
sisa,items:[{id,jenis,status,tanggalMulai,tanggalSelesai,tanggalKembali,jumlahHari}]}` dan `item.riwayatKesejahteraan[]`
`{id,jenis,status,targetSelesai,nomorReferensi,selesaiAt}` (masing-masing maks. 50; tidak ada di POST/PATCH);
`GET /api/v1/subbagsumda/dashboard` → `totals.cutiHariIni` (personel berbeda yang sedang cuti hari ini WIB) dan
`totals.layananMenunggu` (cuti + kesejahteraan berstatus Diproses, personel belum terarsip). **Aditif umum:** badan
galat Sumda boleh membawa kunci tambahan di samping `error` (daftar putih: hanya `id`, saat ini pada `pengajuan_ganda`).

**Rollback.** Bila `/api/v1/subbagsumda/*` kembali ke Go, `/cuti*` dan `/kesejahteraan*` dijawab chi 404 `text/plain`;
layar menampilkan "tidak tersedia" (tanpa cadangan). Tabel 071 diam; skema tidak perlu dibalik. Rollback sempit:
`/api/v1/subbagsumda/personel* /api/v1/subbagsumda/pensiun/* /api/v1/subbagsumda/dashboard /api/v1/subbagsumda/karier*
/api/v1/subbagsumda/diklat* /api/v1/subbagsumda/kompetensi* /api/v1/subbagsumda/cuti* /api/v1/subbagsumda/kesejahteraan*
/api/v1/subbagsumda/opsi-dropdown/*`. **Usang sejak R5H31** (belum memuat `/kinerja*`, `/aset*`; pakai pola di § R5H31).

## R5H31 — Subbagsumda: Kinerja & Pembinaan + Inventaris/BMN (2026-11-24, EXPRESS SAJA)

Migrasi `072_sumda_kinerja_aset.sql` (`sdl_sumda_kinerja` + `_tindak_lanjut`/`_riwayat`/`_lampiran`, `sdl_sumda_aset` +
`_pemeliharaan`/`_riwayat`/`_lampiran`; permission `subbagsumda.kinerja.read|manage|approve`, `subbagsumda.aset.manage|
approve`; salinan sekali registry `kind='inventaris'`); rancangan `docs/R5H31-SUMDA-KINERJA-INVENTARIS.md`; uji
`verify/r5h31-sumda-kinerja-aset.js` dan skenario `x6_r5h31_sumda_kinerja_aset_guard`. Guard operasional (**O**).
Hak: `R` = `subbagsumda.personel.read`, `Rk`/`Mk`/`Ak` = `kinerja.read`/`.manage`/`.approve`, `Ri` =
`subbagsumda.inventaris.read` (003), `Ma`/`Aa` = `aset.manage`/`.approve`. Validasi strict; semua respons `no-store`.
Registry R5B (`/subbagsumda/registry/*`) tidak berubah.

**Kinerja — penyamaran K1 (diputus di SQL):** bagi selain pencatat dan pemegang `Rk`, item hanya membawa
`{id,tahun,periode,statusRingkas:BELUM_DINILAI|DIAJUKAN|DINILAI,dibatasi:true,personel}`; `kategori`, `catatan`,
`penilai`, `tanggalPenilaian`, `status`, `version`, `lewatTenggat`, pencatat/pemutus bernilai `null`; penilaian
Dibatalkan tidak tampil; `tindakLanjut`/`lampiran`/`riwayat` `null`; filter `kategori`/`lewatTenggat`/`status` bekerja
atas kolom tersamar. Mutasi oleh bukan-pencatat tanpa `Rk` → 403 sebelum validasi status/kategori.

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/api/v1/subbagsumda/kinerja/capabilities` | O | `{canRead,canReadDetail,canManage,canApprove}` |
| GET | `/api/v1/subbagsumda/kinerja` | R | `?q=&tahun=&periode=&status=&kategori=&lewatTenggat=1&page=&size=` → `{items,total,page,size}`. Item: `{id,tahun,periode,statusRingkas,dibatasi,kategori,catatan,penilai,tanggalPenilaian,status,version,lewatTenggat,createdBy,createdByName,updatedBy,decidedByName,decidedAt,selesaiAt,createdAt,updatedAt,personel:{id,nrp,nama,pangkatLabel,status,terarsip}}` |
| POST | `/api/v1/subbagsumda/kinerja` | Mk | `{personelId,tahun,periode,kategori,penilai,tanggalPenilaian,catatan}` → 201 Draft. `periode` `SEMESTER_I`\|`SEMESTER_II`\|`TAHUNAN`; `kategori` `BAIK_SEKALI`\|`BAIK`\|`CUKUP`\|`PERLU_PEMBINAAN`. Personel Aktif/MPP; sudah ada penilaian aktif periode itu → 409 `{error:"penilaian_ganda",id}` |
| GET | `/api/v1/subbagsumda/kinerja/:id` | R | `{item,tindakLanjut:[{id,bentuk,uraian,tenggat,status,hasil,lewatTenggat,selesaiAt,updatedByName,updatedAt}],lampiran[],riwayat[]}` (tersamar, lihat atas) |
| PATCH | `/api/v1/subbagsumda/kinerja/:id` | Mk + (pencatat\|Rk) | `{tahun,periode,kategori,penilai,tanggalPenilaian,catatan,version}`; hanya Draft; PP → kategori lain dengan tindak lanjut aktif → 409 `tindak_lanjut_terbuka` |
| POST | `/api/v1/subbagsumda/kinerja/:id/aksi` | Mk/Ak | `{aksi,catatan,version}`: `ajukan` (Draft→Diajukan; Mk + pencatat saja), `setujui` (Ak+Rk; PP → Disetujui, lainnya → Selesai; PP tanpa tindak lanjut → 409 `tindak_lanjut_wajib`), `kembalikan` (Ak+Rk, alasan ≥ 8, → Draft), `batalkan` (pencatat, atau Ak+Rk; Draft/Diajukan; alasan ≥ 8), `selesai` (Disetujui PP; semua tindak lanjut tuntas dan ≥ 1 Selesai, kalau tidak 409 `tindak_lanjut_terbuka`). Pemutus bukan pencatat dan tidak pernah mengubah isi/lampiran/tindak lanjut (`self_review_forbidden`) |
| POST | `/api/v1/subbagsumda/kinerja/:id/tindak-lanjut` | Mk + (pencatat\|Rk) | `{bentuk,uraian,tenggat,version}`; hanya PP, Draft/Diajukan/Disetujui, personel belum terarsip; maks. 20 (`batas_tindak_lanjut`). `bentuk` `KONSELING`\|`PELATIHAN`\|`PENDAMPINGAN`\|`TEGURAN`\|`LAINNYA` |
| PATCH | `/api/v1/subbagsumda/kinerja/:id/tindak-lanjut/:tid` | Mk + (pencatat\|Rk) | `{bentuk,uraian,tenggat,status,hasil,version}`; `version` = versi penilaian; Selesai wajib `hasil` ≥ 3; tindak lanjut final tidak bisa diubah |
| POST · GET · DELETE | `/api/v1/subbagsumda/kinerja/:id/lampiran` · `…/:lid` · `…/:lid` | Mk · pencatat\|Rk · Mk | PDF tersegel; unduh oleh selain pencatat/Rk → 403 |
| GET | `/api/v1/subbagsumda/aset/capabilities` | O | `{canRead,canManage,canApprove}` |
| GET | `/api/v1/subbagsumda/aset` | Ri | `?q=&kategori=&kondisi=&status=&tahap=&page=&size=`; tanpa `status` tidak memuat Dihapus. Item: `{id,kodeBmn,nama,kategori,merekTipe,tahunPerolehan,jumlah,satuan,lokasi,kondisi,penanggungJawab:{id,nama,nrp,terarsip,teks},jadwalPemeliharaan,sisaHari,tahap,status,statusSebelum,usulan,decidedByName,decidedAt,catatan,salinan,version,createdAt,updatedAt,updatedBy}` |
| GET | `/api/v1/subbagsumda/aset/jadwal` | Ri | `?tahap=` → `{ringkas:{"H-14","JATUH_TEMPO"},items}` (maks. 500; Aktif/Pemeliharaan; WIB) |
| POST | `/api/v1/subbagsumda/aset` | Ma | `{kodeBmn,nama,kategori,merekTipe,tahunPerolehan,jumlah,satuan,lokasi,kondisi,penanggungJawabId,penanggungJawabTeks,jadwalPemeliharaan,catatan}` → 201 Aktif. Kode unik tanpa peka huruf di antara aset belum Dihapus (409 `kode_bmn_ganda`); PJ id + teks sekaligus → 400; PJ terarsip baru → 409 `personel_terarsip` |
| GET | `/api/v1/subbagsumda/aset/:id` | Ri | `{item,pemeliharaan:[≤200],pemeliharaanTerpotong,lampiran[],riwayat[]}` |
| PATCH | `/api/v1/subbagsumda/aset/:id` | Ma | badan penuh + `version`; hanya Aktif/Pemeliharaan; kode salinan di luar format boleh dipertahankan |
| POST | `/api/v1/subbagsumda/aset/:id/aksi` | Ma/Aa | `{aksi,catatan,version}`: `pemeliharaan`/`aktifkan` (Ma), `usulkan_hapus` (Ma, alasan ≥ 8; membekukan aset), `setujui_hapus` (Aa; ≥ 1 lampiran diunggah sejak usulan, kalau tidak 409 `lampiran_wajib`) → Dihapus (final), `tolak_hapus` (Aa, alasan ≥ 8) → status sebelumnya. Pemutus bukan pengusul dan tidak mengubah lampiran sejak usulan (`self_review_forbidden`, CHECK DB) |
| POST | `/api/v1/subbagsumda/aset/:id/pemeliharaan` | Ma | `{tanggal,jenis,uraian,pelaksana,kondisi,jadwalBerikutnya,koreksiDari?,version}` → 201 `{item}`; tanggal ≤ hari ini WIB; RUTIN wajib jadwal berikutnya (> tanggal); memperbarui kondisi + jadwal aset; `koreksiDari` aset lain → 400 |
| POST · GET · DELETE | `/api/v1/subbagsumda/aset/:id/lampiran` · `…/:lid` · `…/:lid` | Ma · Ri · Ma | PDF tersegel; unggah/hapus tidak saat Dihapus; hapus oleh pengunggah atau Aa |

Kode galat: 400 `invalid_body`/`invalid_input`/`invalid_file_type`/`one_file_required`; 413 `file_too_large`; 403
`access_denied`/`self_review_forbidden`; 404 `not_found`; 409 `version_conflict`/`status_tidak_sesuai`/`penilaian_ganda`/
`tindak_lanjut_wajib`/`tindak_lanjut_terbuka`/`batas_tindak_lanjut`/`kode_bmn_ganda`/`lampiran_wajib`/
`personel_tidak_aktif`/`personel_terarsip`/`batas_lampiran`; 503 `evidence_*`/`database_unavailable`.

Audit `subbagsumda.kinerja.*` (metadata `{status,fields,version}`, **tanpa kategori**; `setujui` tanpa status hasil) dan
`subbagsumda.aset.*` (`{status,kondisi,fields,version}`); migrasi menulis `subbagsumda.aset.salin_registry
{sumber,disalin,riwayat}` bila ada salinan.

**Aditif pada R5H27:** `GET /api/v1/subbagsumda/personel/:id` → `item.kinerja[]` `{id,tahun,periode,statusRingkas,dibatasi,
status,kategori}` (bagi non-K1 hanya entri `DINILAI`, `kategori`/`status` null); `GET /api/v1/subbagsumda/dashboard` →
`totals.pembinaanLewatTenggat` (`null` tanpa `Rk`, review S1) dan `totals.pemeliharaanJatuhTempo14` (`null` tanpa `Ri`).

**Rollback.** Bila `/api/v1/subbagsumda/*` kembali ke Go, `/kinerja*` dan `/aset*` dijawab chi 404 `text/plain`; Kinerja
"tidak tersedia", Inventaris menampilkan tombol registry lama (darurat). Tabel 072 diam; **data yang ditulis ke registry
selama rollback tidak tersalin ke `sdl_sumda_aset`** (input ulang manual setelah kembali). Rollback sempit:
`/api/v1/subbagsumda/personel* /api/v1/subbagsumda/pensiun/* /api/v1/subbagsumda/dashboard /api/v1/subbagsumda/karier*
/api/v1/subbagsumda/diklat* /api/v1/subbagsumda/kompetensi* /api/v1/subbagsumda/cuti* /api/v1/subbagsumda/kesejahteraan*
/api/v1/subbagsumda/kinerja* /api/v1/subbagsumda/aset* /api/v1/subbagsumda/opsi-dropdown/*`. **Usang sejak R5H32** (belum memuat
`/arsip*`, `/laporan*`; pakai pola di § R5H32). Catatan: executive v2
`assets_care` tetap menghitung registry lama (kontrak beku, K49).

## R5H32 — Subbagsumda: Persuratan & Arsip + Laporan & Analitik (2026-11-24, EXPRESS SAJA)

Migrasi `073_sumda_arsip_laporan.sql` (`sdl_sumda_arsip` + `_riwayat`/`_lampiran`; `surat_id` **tanpa FK**; permission
`subbagsumda.arsip.read|manage|restricted`, `subbagsumda.laporan.export`); rancangan `docs/R5H32-SUMDA-ARSIP-LAPORAN.md`;
uji `verify/r5h32-sumda-arsip-laporan.js` dan skenario `x7_r5h32_sumda_arsip_laporan_guard`. Guard operasional (**O**).
Hak: `R` = `subbagsumda.personel.read`, `Ra`/`Ma`/`Xa` = `arsip.read`/`.manage`/`.restricted`, `E` = `laporan.export`,
`Ps` = `persuratan.read` pada grant `subbagsumda`, `Ri` = `inventaris.read`, `Rk` = `kinerja.read`. Validasi strict;
semua respons `no-store`. Persuratan R5H21 (`/api/v1/persuratan/*`) tidak berubah; arsip hanya membaca tabel 064.

**Visibilitas arsip TERBATAS (K29, diputus di SQL):** baris `kerahasiaan='TERBATAS'` hanya ada bagi pencatatnya dan
pemegang `Xa`. Bagi akun lain baris itu tidak tampil, tidak dihitung (`total`, dashboard, analitik), tidak bisa dicari
atau disaring, dan detail/unduh/PATCH/aksi/unggah/hapus lampiran → **404 `not_found` byte-identik dengan UUID fiktif**.

| Method | Path | Hak | Catatan |
|---|---|---|---|
| GET | `/api/v1/subbagsumda/arsip/capabilities` | O | `{canRead,canManage,canRestricted,canTautSurat}` (`canTautSurat` = `Ps`) |
| GET | `/api/v1/subbagsumda/arsip` | Ra | `?q=&jenis=&status=&tahun=&kerahasiaan=&retensi=1&page=&size=` → `{items,total,page,size}`. Item: `{id,nomor,jenis,perihal,tanggal,asalTujuan,kodeKlasifikasi,lokasiSimpan,retensiSampai,sisaRetensi,tahapRetensi,kerahasiaan,catatan,personel:{id,nama,nrp,terarsip}\|null,suratId,status,musnah:{olehNama,pada}\|null,createdBy,createdByName,version,createdAt,updatedAt,updatedBy,bertautSurat}` (`suratId` null tanpa Ps). `jenis` `SURAT_MASUK`\|`SURAT_KELUAR`\|`NOTA_DINAS`\|`SURAT_KEPUTUSAN`\|`BERITA_ACARA`\|`LAINNYA`; `status` `Aktif`\|`Inaktif`\|`Musnah` (tanpa saringan: semua); `tahapRetensi` `H-30`\|`JATUH_TEMPO` (WIB, Aktif/Inaktif) |
| GET | `/api/v1/subbagsumda/arsip/surat-tertaut` | Ma + Ps | `{items:[{id,arah:masuk\|keluar,nomor,tanggal,perihal,unitPengirim,kodeArsip,tujuan[],dikirimPada}]}` maks. 200: surat `dikirim` oleh Sumda atau ditujukan ke Sumda dan sudah diterima, belum diarsipkan |
| POST | `/api/v1/subbagsumda/arsip` | Ma (+Ps bila `suratId`) | `{nomor,jenis,perihal,tanggal,asalTujuan,kodeKlasifikasi,lokasiSimpan,retensiSampai,kerahasiaan,catatan,personelId,suratId}` → 201 Aktif. `retensiSampai` ≥ `tanggal`; `suratId` + `kerahasiaan:TERBATAS` tanpa Xa → 403 (K51); personel terarsip baru → 409 `personel_terarsip`; surat tidak sah → 400 `surat_tidak_berlaku`; surat sudah diarsip (termasuk arsip Musnah) → 409 `surat_sudah_diarsip` |
| GET | `/api/v1/subbagsumda/arsip/:id` | Ra | `{item,surat,lampiran:[{id,peran,filename,size,uploadedBy,uploadedByName,uploadedAt}],riwayat[]}`; `surat` = `null` \| `{id,arah,nomor,tanggal,perihal,unitPengirim}` (Ps) \| `{dibatasi:true}` (tanpa Ps) \| `{hilang:true}` (surat sudah tidak ada atau tidak lagi sah) |
| PATCH | `/api/v1/subbagsumda/arsip/:id` | Ma | badan penuh + `version` → 200 `{item}`, atau **`{item:null,tersembunyi:true}`** bila perubahan (naik ke TERBATAS oleh bukan pencatat tanpa Xa) membuat arsip tak terlihat lagi. Turun TERBATAS→BIASA butuh Xa (403); kunci `suratId` tidak dikirim = tautan dipertahankan; mengubah `suratId` butuh Ps (403); arsip bersurat menjadi TERBATAS atau tautan baru pada arsip TERBATAS tanpa Xa → 403 (K51); Musnah → 409 `status_tidak_sesuai` |
| POST | `/api/v1/subbagsumda/arsip/:id/aksi` | Ma / Ma+Xa | `{aksi,catatan,version}`: `inaktifkan` (Aktif→Inaktif), `aktifkan` (Inaktif→Aktif), `musnahkan` (Ma+Xa; hanya dari Inaktif; alasan ≥ 8; ≥ 1 lampiran `BA_MUSNAH`, kalau tidak 409 `lampiran_wajib`) → Musnah (final, hanya-baca) |
| POST · GET · DELETE | `/api/v1/subbagsumda/arsip/:id/lampiran` · `…/:lid` · `…/:lid` | Ma · Ra · Ma | PDF tersegel; POST `?peran=DOKUMEN\|BA_MUSNAH` (bawaan DOKUMEN); maks. 10 gabungan; unggah/hapus tidak saat Musnah; hapus oleh pengunggah atau Xa |
| GET | `/api/v1/subbagsumda/laporan/capabilities` | O | `{canRead,canExport,modul:{personel,pensiun,karier,diklat,kompetensi,cuti,kesejahteraan,kinerja,aset,arsip}}` (`modul` = boleh ekspor) |
| GET | `/api/v1/subbagsumda/laporan/ringkasan` | R | `?tahun=` (1950–2100; bawaan tahun WIB; kunci lain → 400) → `{tahun,tahunIni,hariIni,personel:{aktif,mpp,total,perUnit[≤16],perPangkat:{polri,pns},proyeksi[12]},pensiun30,layananBerjalan:{karier,cuti,kesejahteraan,total},cuti:{perBulan[12]},diklat:{perBulan[12]},register[],kinerja,aset,arsip}`. `kinerja` null tanpa Rk, `aset` null tanpa Ri, `arsip` null tanpa Ra (angka arsip atas baris terlihat; `arsip.terbatas` null tanpa Xa). Satu transaksi REPEATABLE READ READ ONLY, `statement_timeout` 5 s |
| GET | `/api/v1/subbagsumda/laporan/ekspor/:modul` | E + hak modul | `200 text/csv; charset=utf-8`, `Content-Disposition: attachment; filename=sumda-<modul>-<YYYYMMDD WIB>.csv`, `nosniff`, `CSP: sandbox`. Hak modul: `aset` Ri, `arsip` Ra (+ baris terlihat), `kinerja` R (+ hanya baris pencatat/Rk), lainnya R. Saringan per modul: personel `status`; pensiun `tahap`; karier `tahun,status,jenis`; diklat `tahun,status`; kompetensi `tahap`; cuti `tahun,status,jenis`; kesejahteraan `tahun,status,jenis`; kinerja `tahun,status`; aset `status,kondisi`; arsip `tahun,status,jenis`. Kunci/nilai lain → 400 JSON; modul tak dikenal → 404 JSON; > 10.000 baris → 413 `terlalu_banyak`; transaksi baca dengan `statement_timeout` 10 s (→ 503) |

**Format CSV (K20/K44):** UTF-8 + BOM, pemisah `;`, CRLF, semua sel berkutip (`"` → `""`); sel teks berawalan `=`, `+`,
`-`, `@`, tab, CR, atau padanan lebar penuhnya diberi awalan `'`. Kolom = tabel daftar di layar, **tanpa** catatan/alasan,
nama petugas, id, hash, atau nama berkas (K41; catatan cuti Sakit tidak pernah diekspor).

Kode galat: 400 `invalid_body`/`invalid_input`/`invalid_file_type`/`one_file_required`/`surat_tidak_berlaku`; 413
`file_too_large`/`terlalu_banyak`; 403 `access_denied`; 404 `not_found`; 409 `version_conflict`/`status_tidak_sesuai`/
`surat_sudah_diarsip`/`lampiran_wajib`/`personel_terarsip`/`batas_lampiran`; 503 `evidence_*`/`database_unavailable`.

Audit `subbagsumda.arsip.{create,update,inaktifkan,aktifkan,musnahkan,lampiran.add,lampiran.delete,lampiran.download}`
(metadata `{status,jenis,kerahasiaan,fields,version}`, tanpa nomor/perihal/catatan/nama berkas) dan
`subbagsumda.laporan.export` (`subject_type='subbagsumda.laporan'`, `subject_id`=modul, metadata `{modul,jumlah,filter}`),
ditulis dalam transaksi sendiri **sebelum** berkas dikirim (gagal → 503 tanpa data); 400/403/404/413 tidak diaudit.

**Aditif pada R5H27:** `GET /api/v1/subbagsumda/personel/:id` → `item.arsip[]` `{id,nomor,jenis,perihal,tanggal,status,
kerahasiaan,retensiSampai,tahapRetensi}` (maks. 50, baris terlihat; `null` tanpa Ra); `GET /api/v1/subbagsumda/dashboard` →
`totals.arsipRetensi30` (baris terlihat; `null` tanpa Ra). POST/PATCH personel tidak berubah.

**Rollback.** Bila `/api/v1/subbagsumda/*` kembali ke Go, `/arsip*` dan `/laporan*` dijawab chi 404 `text/plain`; kedua
layar menampilkan "tidak tersedia" (tanpa cadangan). Tabel 073 diam. Bila hanya `/api/v1/persuratan/*` yang
dikembalikan, arsip tetap jalan (membaca tabel 064 langsung). Rollback sempit:
`/api/v1/subbagsumda/personel* /api/v1/subbagsumda/pensiun/* /api/v1/subbagsumda/dashboard /api/v1/subbagsumda/karier*
/api/v1/subbagsumda/diklat* /api/v1/subbagsumda/kompetensi* /api/v1/subbagsumda/cuti* /api/v1/subbagsumda/kesejahteraan*
/api/v1/subbagsumda/kinerja* /api/v1/subbagsumda/aset* /api/v1/subbagsumda/arsip* /api/v1/subbagsumda/laporan*
/api/v1/subbagsumda/opsi-dropdown/*`.
