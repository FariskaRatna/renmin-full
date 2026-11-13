# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SIERA DELTA LIMA (SDL) — workspace digital internal BagRenmin. Empat modul unit
(Urmin/persuratan, Subbagren/perencanaan-anggaran, Subbagsumda, Subbagbinfung)
di atas satu lapisan identitas, RBAC berskop, dan audit trail.

Aplikasi ini **sudah dipakai di produksi** di server colo `172.16.173.34` dengan
akun operasional nyata. Perubahan yang memutus login atau otorisasi punya korban
sungguhan, bukan sekadar test merah.

---

## Status repositori: dua backend hidup bersamaan

| Direktori | Stack | Peran |
|---|---|---|
| `apps/backend/` | Go 1.27 + chi + pgx | **Produksi.** Sumber kebenaran perilaku |
| `apps/backend-express/` | Node/Express (JavaScript, ESM) | Migrasi. **142/142 endpoint diporting, 382/382 kasus harness cocok** dengan baseline Go (2026-11-01). Trafik belum dialihkan |
| `apps/frontend/` | React 19 + Vite 8 + Tailwind 4 | Dipakai keduanya, tidak disentuh |

Migrasi Go → Express sedang berjalan. Aturan yang mengikat selama masa ini ada di
bagian [Aturan migrasi](#aturan-migrasi). **`apps/backend/` tidak boleh dihapus**
sampai Express melayani seluruh 142 endpoint dengan stabil.

Satu PostgreSQL dipakai bersama. Tidak ada dual-write, tidak ada sinkronisasi.

---

## Perintah

### Menjalankan (Docker, bukan Node/Go lokal)

Seluruh stack berjalan di Docker: tidak ada Go toolchain maupun PostgreSQL yang
perlu dipasang di host. Yang dibutuhkan hanya Docker Desktop yang **sedang
berjalan** — CLI terpasang tidak cukup, daemon-nya harus hidup.

`.env` di root wajib ada; semua perintah compose memakai `${VAR:?}` dan gagal
tanpanya. Ia tidak ikut repo (berisi secret, mode 600). Lihat `.env.example`.

```bash
docker compose --env-file .env -f infra/compose.dev.yaml build
docker compose --env-file .env -f infra/compose.dev.yaml up -d --wait db
docker compose --env-file .env -f infra/compose.dev.yaml run --rm --no-deps api -migrate
docker compose --env-file .env -f infra/compose.dev.yaml up -d --wait
```

Frontend di `http://127.0.0.1:5174`. API **tidak pernah** diekspos ke host —
Vite dev server mem-proxy `/api` → `http://api:8080` di dalam network Docker
(`apps/frontend/vite.config.ts`). Jadi `curl` ke port 8080 dari host selalu gagal;
uji lewat `http://127.0.0.1:5174/api/v1/system/status`.

Backend Express berjalan berdampingan sebagai service `api-express`, berbagi
database yang sama dengan Go. Trafik belum dialihkan ke sana:

```bash
docker compose --env-file .env \
  -f infra/compose.dev.yaml -f infra/compose.express.yaml \
  up -d --build --wait api-express
```

Mode HTTPS (wajib untuk login, lihat [Batasan keras](#batasan-keras)):

```bash
docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.proxy.yaml up -d --wait
```

### Lima script asli gagal di checkout ini

`start-dev.sh`, `bootstrap-superadmin.sh`, `seed-bagrenmin-users.sh`,
`reset-all-passwords.sh`, dan `r3e-readiness.sh` semuanya menolak jalan kecuali
nama folder root persis `1.siera-delta-lima`. Folder ini bernama `sdl`, jadi
kelimanya **keluar dengan error sebelum bekerja** — termasuk `./sdl-run.sh` yang
hanya membungkus `start-dev.sh`.

Jangan "perbaiki" pemeriksaan itu tanpa diminta; ia mencegah installer menimpa
instalasi lain. Pakai `scripts/local-setup.sh` — padanan tanpa penjaga nama
folder, dengan penjaga substantif tetap utuh (Docker hidup, `.env` ada,
`SDL_DB_NAME=sdl_root_dev`):

```bash
bash scripts/local-setup.sh up          # build + migrasi + jalankan
bash scripts/local-setup.sh bootstrap   # Superadmin pertama (interaktif)
bash scripts/local-setup.sh seed        # 13 akun operasional (interaktif)
bash scripts/local-setup.sh harness     # rekam golden file
bash scripts/local-setup.sh status
bash scripts/local-setup.sh down
```

Dari CMD atau PowerShell, pakai pembungkus `local-setup.cmd` dengan argumen yang
sama (`local-setup.cmd up`, dst.). **Jangan panggil `bash` langsung dari CMD** —
`bash` di PATH Windows menunjuk ke `C:\WINDOWS\system32\bash.exe`, yaitu bash
**WSL**, lingkungan Linux terpisah yang tidak melihat Docker Desktop. Pembungkus
itu memaksa Git Bash di `%ProgramFiles%\Git\bin\bash.exe`.

### Database kosong setelah `up` pertama

Volume `sdl_root_r1_pgdata` baru hanya berisi skema, tanpa satu pun user.
Urutannya wajib: `up` → `bootstrap` → `seed`. Tanpa `seed`, harness hanya punya
aktor `anon` dan `superadmin`, dan sebagian besar kasus akan dilewati.

Seed membuat akun dengan `must_change_password=TRUE`, yang **memblokir kedua
guard**. Harness membersihkannya otomatis saat mutasi diizinkan; untuk login
lewat browser, password harus diganti dulu di layar pertama.

### Test

```bash
# Unit test Go — juga dijalankan otomatis saat `docker compose build`
# (apps/backend/Dockerfile:7). Build gagal kalau test merah.
docker run --rm -v "$PWD/apps/backend:/src" -w /src \
  -e GOTOOLCHAIN=local golang:1.27.2-alpine3.24 go test ./...

# Satu paket
... go test ./internal/auth/

# Satu test
... go test ./internal/access/ -run TestDenyByDefaultAndUnitScoped -v
```

**Suite keamanan terpisah — ADA DUA, dan keduanya wajib selama dua backend
hidup.** Masing-masing menjalankan Postgres ephemeral sendiri di jaringan
terisolasi, dan laporannya jatuh ke `0.sekerips/reports/`:

```bash
bash scripts/security-test-r2d5.sh      # backend Go (9 file, tag r2d5integration,
                                        #   TIDAK ikut `go test ./...`)
bash scripts/security-test-express.sh   # backend Express (21/21 per 2026-11-01)
```

Port Express-nya satu-lawan-satu dengan nama skenario yang identik. Ia ada
karena **suite Go tetap hijau sambil berhenti relevan** begitu Caddy
mengalihkan satu prefix ke Express — ia tidak akan merah, ia hanya tidak lagi
menguji backend yang melayani. Harness golden-file bukan penggantinya: ia
mengukur bentuk respons, bukan siapa yang boleh mendapatkannya.

Frontend: `npm run build` menjalankan `tsc --noEmit && vite build`. Tidak ada
test runner frontend dan tidak ada linter di repo ini.

### Operasional

Script asli di bawah ini **hanya jalan kalau folder root bernama
`1.siera-delta-lima`** (lihat di atas). Untuk dua yang pertama, pakai
`scripts/local-setup.sh bootstrap` / `seed`.

```bash
bash scripts/bootstrap-superadmin.sh     # sekali, kredensial lewat stdin saja
bash scripts/seed-bagrenmin-users.sh     # 13 akun operasional
bash scripts/reset-all-passwords.sh      # darurat; password lama tidak bisa dipulihkan
bash scripts/r3e-readiness.sh
```

Kedua script uji keamanan tidak punya penjaga nama folder dan bisa langsung
jalan — seluruh state-nya ephemeral.

Flag biner API Go: `-migrate`, `-bootstrap-superadmin`, `-healthcheck`.
Migrasi **tidak pernah** jalan otomatis — saat start normal server hanya
menjalankan `migrations.Verify()` dan menolak start kalau skema tidak konsisten.

### Perkakas siklus hidup: Express sudah punya keempatnya (2026-11-01)

Express menerima flag yang sama (`--migrate`, `--bootstrap-superadmin`,
`--healthcheck`) dengan **urutan yang sama**: keduanya berjalan sebelum
`SDL_AUTH_SECRET` dibaca, jadi bisa dipakai di lingkungan yang belum punya
secret sama sekali — justru keadaan database yang baru dibuat. Dua perkakas
lain ada di `src/cli/`, dijalankan lewat `infra/compose.express-cli.yaml`:

```bash
CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.express-cli.yaml"
docker compose $CLI run --rm --no-deps migrate-express
printf 'user\nemail\nNama\nPassword\n' | docker compose $CLI run --rm --no-deps -T bootstrap-express
SDL_SEED_SUPERADMIN_USERNAME=sasdl docker compose $CLI run --rm --no-deps -T seed-bagrenmin-express
# reset-all-passwords-express: destruktif, lewat pembungkus interaktif saja
```

Keempatnya **diuji A/B terhadap Go**, bukan sekadar dijalankan: dua database
identik, satu diproses Go dan satu Express, lalu keadaan akhirnya dibandingkan
baris per baris — seed 171/171 baris cocok, reset 7/7 cocok, dan hash yang
ditulis Express diterima `auth.VerifyPassword` Go.

33 berkas SQL ikut masuk image lewat `additional_contexts` di
`compose.express.yaml` (padanan `//go:embed`), sehingga `--migrate` berguna di
dalam container, bukan hanya dari checkout source. Skema tetap satu sumber.

---

## Arsitektur

### Jalur request

```
Browser ──HTTPS──► Caddy :443 ──► Vite :5173 ──/api──► api:8080 ──► Postgres
                   (infra/Caddyfile)   (satu-satunya upstream)
```

Caddy mem-proxy **ke Vite**, bukan ke API. Vite yang memecah `/api`. Konsekuensinya:
mengubah konfigurasi proxy Vite memengaruhi produksi, bukan cuma dev.

### Database

57 tabel, semua berprefiks `sdl_`. Skema dibangun dari **33 file SQL ter-embed**
di `apps/backend/internal/migrations/sql/` (`001_core.sql` … `033_*.sql`).

Runner (`migrations/migrate.go`) menerapkan secara transaksional, memegang advisory
lock, mencatat SHA-256 per file di `sdl_schema_migrations`, dan **menolak kalau
checksum berubah**. Artinya: **jangan pernah mengedit file migrasi yang sudah
diterapkan** — tambahkan file baru. `migrate_test.go` menegaskan urutan manifes
secara eksplisit; menambah file tanpa memperbarui daftar itu akan menggagalkan test.

### Dua engine otorisasi — jangan disatukan

Ini hal yang paling sering salah dipahami di codebase ini.

**Engine A — `internal/access/policy.go`** (fungsi murni, 73 baris).
Dipakai `urmin/*`, `subbagren/*`, `directives`, `executive/v2`.
Deny-by-default; butuh RBAC permission **dan** grant berskop yang cocok:
prefix permission harus cocok dengan unit · klasifikasi ∈ {biasa, penting} ·
`*.update` hanya saat status `draft` · `*.approve` hanya saat status `review` ·
scope `unit`/`own`/`assigned` · grant belum kedaluwarsa · dokumen `penting`
butuh `classification_limit='penting'`.

**Engine B — `unitwork.permit()`**. Dipakai `unit-work`, dan registry
`subbagsumda`/`subbagbinfung`/`urmin`. **Tidak memakai `permission_key` sama
sekali** — mencocokkan scope grant langsung dengan verb (`create`/`read`/…).

Keduanya menyaring **di level SQL**. Memindahkan penyaringan scope ke JavaScript/Go
setelah `SELECT` akan membocorkan data lintas unit.

### Dua guard tingkat router

| Guard | Aturan |
|---|---|
| `AuthorizeOperational` | authenticated · non-GET wajib CSRF · aktif · `NOT must_change_password` · **bukan Superadmin** |
| `AuthorizeRoleEditor` | authenticated · non-GET wajib CSRF · **harus** Superadmin + `identity.roles.manage` · `NOT must_change_password` |

Dua perilaku kontra-intuitif yang **disengaja**:

- **Superadmin ditolak dari semua endpoint operasional.** Ia administrator
  identitas, bukan pengguna. Satu-satunya pengecualian: `GET /api/v1/executive/v2/*`
  (read-only) dan jalur demo `devdemo.Superadmin()` yang harus mati di produksi.
- **`must_change_password = true` memblokir hampir semua hal.** User yang belum
  merotasi password sementara hanya bisa mengakses endpoint auth. Ini sering salah
  didiagnosis sebagai "RBAC rusak".

Detail lengkap: `docs/SUPERADMIN-ACCESS-POLICY.md`.

### Lapisan kripto (zona paling berisiko)

| Hal | Spesifikasi |
|---|---|
| Password | argon2id `m=65536, t=3, p=2`, keyLen 32, salt 16, base64 **raw** tanpa padding |
| HMAC | `HMAC-SHA256(SDL_AUTH_SECRET, purpose ‖ 0x00 ‖ value)` — byte nol pemisah wajib |
| Token sesi | 32 byte acak → base64url raw (43 char); DB menyimpan `sha256(token)` |
| CSRF | double-submit: allowlist `Origin` + cookie `sdl_csrf` == header `X-CSRF-Token` |
| CAPTCHA | proof-of-work SHA-256 lokal, 2 byte nol pertama, sekali pakai |
| OTP | 6 digit, 5 menit, maks 5 percobaan, hash di DB, tidak pernah masuk log |
| Evidence | **AES-256-GCM**, envelope ber-versi `"SDL1"` + nonce 96-bit acak, envelope dipakai sebagai AAD (`subbagren/evidence_crypto.go`) |

Perbandingan rahasia selalu konstan-waktu (`subtle.ConstantTimeCompare`).
Saat username tidak ditemukan, login tetap menjalankan hash dummy agar waktu
respons tidak membocorkan keberadaan akun.

### Latar belakang

`notifications.Run()` — ticker 10 detik, memproses `sdl_urmin_email_outbox` dan
`sdl_urmin_intake_mail_outbox` dengan pola claim → deliver → retry.
Aktif kecuali `SDL_EMAIL_NOTIFICATIONS_ENABLED="false"`.

Express punya padanannya di `src/notifications/` sejak 2026-11-01, tapi
**default MATI**: ia menuntut `SDL_EMAIL_WORKER_ENABLED=true`. Itu penegakan
aturan 7 di kode, bukan di prosedur — dua worker atas satu database berarti
email ganda ke pengguna nyata. Peralihannya bersisi dua: matikan di Go dulu,
baru nyalakan di Express. Alasan worker tidak menyala selalu dicatat di log
saat start.

### Pengerasan container

Service `api`: `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges`,
tmpfs 16 MB. Node butuh direktori tulis lebih banyak daripada binary Go statis —
saat migrasi, sesuaikan tmpfs secara sadar, **jangan buang `read_only`**.

---

## Aturan migrasi

Berlaku sampai Express melayani 100% trafik.

1. **Kontrak API beku.** Tidak ada rename field, perubahan status code, atau
   perbaikan desain — sekalipun yang sekarang terasa keliru. Rujukan:
   `apps/backend-express/docs/API-CONTRACT.md` (142 endpoint bernomor).
   Kalau Express berbeda dari dokumen itu, Express yang salah.
2. **Go adalah oracle.** Saat ragu bentuk respons, panggil backend Go dan bandingkan.
   Jangan menebak dari nama fungsi.
3. **Temuan aneh direplikasi apa adanya**, dicatat di
   `apps/backend-express/docs/DEVIATIONS.md`, dikerjakan setelah paritas.
   Memperbaiki sambil memporting menghilangkan kemampuan membandingkan.
   Dua pengecualian sudah diambil (B8 dan B9, 2026-11-01), keduanya karena
   **tidak ada perilaku benar yang bisa dibandingkan**: SQL yang tidak sah
   (selalu 503) dan pemeriksaan wewenang yang menolak setiap akun yang mungkin
   ada (selalu 403). Syaratnya persetujuan pemilik sistem, **kedua backend
   diperbaiki bersamaan**, dan golden direkam ulang dalam satu siklus penuh.
   Bukan preseden untuk entri lain di `DEVIATIONS.md`.
4. **Potong per domain, bukan per layer.** Satu domain tuntas (route → authz →
   handler → test) sebelum domain berikutnya.
5. **Peralihan lewat Caddy per prefix**, bukan feature flag di kode. Rollback =
   satu baris config + reload.
6. **Skema database tidak ikut bermigrasi.** Runner Express membaca 33 SQL yang
   sama dari `apps/backend/internal/migrations/sql/` — jangan disalin.
7. **Satu worker email aktif.** Selama transisi kedua backend hidup; kalau keduanya
   memproses outbox, email terkirim dua kali ke pengguna nyata.

Keputusan teknologi yang sudah diambil: **JavaScript polos (ESM)** · `pg` dengan
SQL mentah (**bukan ORM** — query Go penuh `FOR UPDATE`, `ON CONFLICT`, array
Postgres; menerjemahkannya ke ORM adalah penulisan ulang kedua di dalam yang
pertama) · validasi mode strict (Go menolak field asing) · paket `argon2` ·
nodemailer · sesi tetap di DB, **bukan JWT**.

Karena tanpa TypeScript tidak ada pemeriksa bentuk di waktu tulis, **harness
golden-file memikul beban itu sendirian**. Jalankan `compare` setiap selesai satu
potongan domain, bukan sekali di akhir tahap.

---

## Batasan keras

Tujuh hal yang sudah memakan waktu nyata saat deployment. Verifikasi dulu sebelum
mendiagnosis hal lain.

1. **Login wajib HTTPS.** CAPTCHA memakai `crypto.subtle`, yang hanya ada di
   *secure context*. `http://<ip>:5174` **tidak akan pernah bisa login** — gejalanya
   terlihat seperti CAPTCHA rusak, bukan masalah TLS.
2. **`SDL_ALLOWED_ORIGINS` wajib diisi di balik reverse proxy.** Kalau kosong,
   `allowMutation` menolak semua mutation dengan 403 — dan UI menampilkannya
   sebagai **pesan CAPTCHA gagal**. Gejalanya menyesatkan.
3. **Superadmin selalu wajib OTP**, apa pun nilai `otp_enabled` di database
   (`mustUseOTP = isSuperadmin || enabled`). Tanpa SMTP yang berfungsi,
   Superadmin tidak bisa login sama sekali → `503 email_delivery_unavailable`.
4. **`SDL_DB_NAME` harus persis `sdl_root_dev`.** `scripts/reset-all-passwords.sh:17`
   dan `scripts/seed-bagrenmin-users.sh:11` menolak jalan kalau berbeda.
5. **`SDL_COOKIE_SECURE=true` wajib di luar development** — `cmd/api/main.go:105`
   sengaja mematikan proses kalau dilanggar.
6. **Password tidak bisa dipulihkan.** Satu-satunya jalan adalah reset massal.
   Parameter argon2 yang meleset mengunci semua user secara permanen.
7. **Evidence lama hanya terbaca kalau envelope AES-GCM byte-identik.** Verifikasi
   dekripsi dengan **record lama**, bukan record uji baru — kerusakannya senyap.

`SDL_AUTH_SECRET` dan `SDL_EVIDENCE_KEY` keduanya 64 hex (32 byte) dan **harus
berbeda**. Evidence key yang invalid membuat operasi file fail-closed, bukan
fallback plaintext.

---

## Peta dokumen

`docs/` berisi ~60 dokumen per-rilis (`R2*`–`R5F*`) yang mencatat keputusan desain
tiap fitur. Berguna saat perlu tahu *kenapa* sesuatu dibuat begitu.

Yang paling sering dibutuhkan:

| Dokumen | Isi |
|---|---|
| `docs/ARCHITECTURE.md` | arsitektur saat ini |
| `docs/PERTANYAAN-KONFIGURASI-AKSES.md` | **27 endpoint tidak terjangkau akun mana pun di produksi** (usulan, anggaran, disposisi). Bukan cacat migrasi — Go dan Express sama. Dokumen keputusan untuk pemilik sistem, menunggu jawaban |
| `docs/SUPERADMIN-ACCESS-POLICY.md` | pemisahan Superadmin ↔ operasional |
| `docs/R2C1-ROLE-PERMISSION.md` | model role & permission |
| `docs/R2D1-CAPTCHA-OTP-POLICY.md` | kebijakan CAPTCHA & OTP |
| `docs/R2D5-SECURITY-TESTS.md` | cakupan suite keamanan |
| `docs/LOCAL-BAGRENMIN-USERS.md` | 13 akun operasional |
| `docs/UIUX-DESIGN-SYSTEM.md` | sistem desain frontend |

### Dua rencana migrasi — mana yang dipakai

| Dokumen | Tanggal | Status |
|---|---|---|
| `docs/MIGRASI-EXPRESS-REACT.md` | 2026-10-27 | Rencana strategis: peta padanan teknologi, analisis risiko keamanan, estimasi 14–21 minggu. **Masih berlaku** untuk §3, §4, §7, §9 |
| `apps/backend-express/docs/MIGRATION-PLAN.md` | 2026-10-30 | Rencana eksekusi: tahap, urutan domain, gerbang kelulusan. **Dipakai sehari-hari** |

Keduanya saling melengkapi, tapi ada dua angka yang berbeda — yang baru benar:

- **Jumlah endpoint: 142, bukan 174.** Angka lama adalah hitungan mentah
  pemanggilan `.Get(`/`.Post(` termasuk file `_test.go` dan handler yang tidak
  pernah dipasang.
- **Nama guard: `AuthorizeRoleEditor`, bukan `AuthorizeIdentity`.** Fungsi
  bernama `AuthorizeIdentity` tidak ada di source.

Dokumen lama juga menyebut `internal/delegations` sebagai sesuatu yang diporting.
Jangan — 411 baris itu **kode mati**: `httpapi/router.go:242` menggantinya dengan
handler yang selalu 403, dan paketnya tidak di-import. Porting perilaku 403-nya saja.
Lima paket lain berisi 0 baris: `rbac`, `config`, `audit`, `subbagsumda`, `subbagbinfung`.

---

## Alur kerja dengan Claude Code

Fitur baru mengikuti: `/fitur` → `/rencana` → `/implementasi` → `/verifikasi` → `/review`,
dan setiap sesi ditutup dengan `/catat-sesi`. Setiap tahap yang menghasilkan keputusan
berhenti untuk persetujuan pemilik sebelum lanjut.

Pengaman otomatis (`.claude/settings.json` + `.claude/hooks/`):
- Diblokir: mengedit migrasi yang sudah di-commit, `.env`, sertifikat/kunci, golden file harness;
  `git push`, `deploy.sh`, `reset-all-passwords.sh`, `bootstrap`/`seed`, `ssh`.
- Minta konfirmasi: zona kripto/auth, engine otorisasi, `vite.config.ts`, Caddyfile,
  compose, workflow CI, merekam ulang golden file.
- Sebelum selesai: tsc frontend, `node --check` file Express yang berubah, dan build image Go
  (go test) dijalankan otomatis sesuai area yang berubah. Suite keamanan dan harness
  dijalankan lewat `/verifikasi`.

Gaya commit: `feat(<area>): ...`, `fix(<area>): ...`. Branch fitur: `feat/<kode-rilis>-<nama>`.
