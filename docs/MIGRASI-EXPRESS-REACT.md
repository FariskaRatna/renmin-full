# SIERA DELTA LIMA | Rencana Migrasi ke Stack Express + React

Dokumen perencanaan, bukan catatan implementasi. Disusun 2026-10-27 berdasarkan
penelusuran langsung atas source yang berjalan di server LAN `172.16.40.6`.

---

## 1. Temuan yang mengubah bentuk pekerjaan

**Frontend sudah React.** `apps/frontend` berjalan di React 19.3.1 + Vite 8.3.4 +
Tailwind 4.3.3 (`apps/frontend/package.json`). Tidak ada yang perlu "dimigrasikan
ke React" — ia sudah di sana.

Artinya permintaan "ganti ke stack Express + React.js" pada praktiknya berarti
**satu pekerjaan saja: menulis ulang backend Go menjadi Express (Node.js).**
Frontend nyaris tidak tersentuh, karena ia berbicara ke backend lewat HTTP JSON
dan proxy `/api` (`apps/frontend/vite.config.ts`). Selama kontrak API dipertahankan,
frontend tidak tahu bedanya.

**Sebutan "prototype" meremehkan isinya.** Angka hasil pengukuran:

| Aspek | Ukuran |
|---|---|
| Kode Go (non-test) | 13.516 baris |
| Kode test Go | 3.048 baris |
| Endpoint HTTP | 174 |
| Tabel database | 56 |
| File migrasi SQL | 33 (`001_core.sql` … `033_leadership_directive_files.sql`) |
| Paket domain | 19 (`internal/urmin`, `internal/subbagren`, `internal/auth`, …) |
| Kode frontend | 4.761 baris TSX/TS |

Ini bukan prototipe sekali pakai. Di dalamnya ada lapisan keamanan yang sudah
jadi dan sudah diuji: Argon2id, OTP email, CAPTCHA proof-of-work, CSRF,
sesi ber-hash, RBAC berskop, audit trail, dan enkripsi AES-GCM untuk evidence.

**Konsekuensi yang harus diterima di muka:** menulis ulang 174 endpoint berarti
menulis ulang 174 peluang untuk menghilangkan satu pemeriksaan otorisasi tanpa
ada yang menyadarinya. Rencana di bawah disusun untuk menekan risiko itu, bukan
untuk mempercepat pekerjaan.

---

## 2. Apa yang tetap, apa yang ditulis ulang

### Tetap, tidak disentuh

| Aset | Alasan |
|---|---|
| PostgreSQL 18.6 + 56 tabel | Skema adalah aset paling matang; Express bicara ke DB yang sama |
| 33 file migrasi SQL | SQL murni, tidak terikat Go. Pindahkan runner-nya saja |
| `apps/frontend` (4.761 baris) | Sudah React. Perubahan hanya jika kontrak API berubah |
| Argon2id password hash | Format PHC standar — hash lama tetap valid (lihat §4) |
| Docker Compose + Postgres | Hanya service `api` yang diganti isinya |

### Ditulis ulang

| Komponen Go | Menjadi |
|---|---|
| `cmd/api/main.go` | `src/server.ts` — bootstrap Express |
| `internal/httpapi/router.go` (chi) | Express Router + middleware stack |
| `internal/auth` (15 file) | Modul auth Express — **paling kritis** |
| `internal/urmin` (15 file) | Modul persuratan |
| `internal/unitwork` (10 file) | Modul kerja unit (sumda, binfung, register) |
| `internal/subbagren` (8 file) | Modul perencanaan + anggaran + evidence |
| `internal/directives` (7 file) | Modul direktif pimpinan |
| `internal/access`, `roles`, `users`, `delegations` | Modul identitas & RBAC |
| `internal/migrations/migrate.go` | Runner migrasi Node |
| `internal/securitytest` (9 file) | **Porting pertama**, jadi alat ukur (lihat §5) |

---

## 3. Peta padanan teknologi

| Go sekarang | Padanan Node | Catatan |
|---|---|---|
| `go-chi/chi v5` | `express` 5.x | Routing + middleware setara |
| `jackc/pgx/v5` | `pg` (node-postgres) | Pakai parameterized query, **jangan ORM** di tahap awal |
| `golang.org/x/crypto/argon2` | `argon2` (npm) | Parameter wajib identik, lihat §4 |
| `net/smtp` + TLS manual | `nodemailer` | Kunci ke port 465/587 saja |
| `crypto/aes` + GCM | `node:crypto` `aes-256-gcm` | Envelope & nonce harus byte-identik |
| `crypto/rand` | `node:crypto.randomBytes` | Jangan `Math.random()` |
| `crypto/subtle.ConstantTimeCompare` | `crypto.timingSafeEqual` | Wajib, bukan `===` |
| `net/http` timeout & limit | `express` + `body-parser` limit | Batas 10MB lampiran harus dipertahankan |
| Migrasi embedded (`embed`) | `node-pg-migrate` atau runner sendiri | SQL-nya tidak berubah |

**Rekomendasi bahasa: TypeScript, bukan JavaScript polos.** Go memberi jaminan
tipe yang selama ini menahan banyak kesalahan diam-diam. Pindah ke JS polos
berarti melepas jaring itu tepat saat kode sedang paling rapuh. TypeScript
mengembalikan sebagian besarnya dengan biaya kecil.

---

## 4. Lapisan keamanan — bagian paling berisiko

Ini daftar hal yang **harus dipindahkan utuh**. Setiap baris di bawah sudah
diverifikasi di source dan masing-masing punya konsekuensi nyata jika meleset.

### 4.1 Argon2id — hash lama bisa diselamatkan

`internal/auth/password.go:15-20` memakai parameter:

```
m = 65536 (64 MiB), t = 3, p = 2, keyLen = 32, salt = 16 byte
format: $argon2id$v=19$m=65536,t=3,p=2$<salt>$<hash>   (base64 RawStdEncoding, tanpa padding)
```

Paket `argon2` di npm menghasilkan format PHC yang sama. **Jika parameter
disamakan persis, seluruh password pengguna tetap berlaku** dan tidak ada reset
massal. Jika meleset satu angka saja, semua orang terkunci dan satu-satunya jalan
adalah `reset-all-passwords.sh`.

`VerifyPassword` juga menolak parameter di luar batas `m∈[32768,131072]`,
`t∈[1,5]`, `p∈[1,4]` (`password.go:61`) — pertahanan terhadap parameter yang
dikendalikan penyerang. Jangan dibuang saat porting.

### 4.2 OTP dan SMTP

- `smtp.go:21` — `Ready()` menuntut Host, Username, Password, From terisi dan port **tepat** 465 atau 587.
- `smtp.go:29` — OTP **tidak pernah** dicetak ke log. Tidak ada fallback dev.
- `service.go:345` — `mustUseOTP(enabled, isSuperadmin) = isSuperadmin || enabled`. Superadmin **selalu** OTP, tidak bisa dimatikan.
- OTP 6 digit, kedaluwarsa 5 menit, disimpan sebagai hash di `sdl_login_challenges`, challenge lama di-invalidasi transaksional (`service.go:320-322`).

### 4.3 CAPTCHA proof-of-work

`LocalCaptcha.tsx` + validator Go. Difficulty 16 bit (dua byte nol pertama dari
SHA-256), challenge sekali pakai, tanpa skrip pihak ketiga. Browser butuh
**secure context** — `crypto.subtle` hanya ada di HTTPS atau `localhost`.
Validasi sisi server tidak boleh dilonggarkan hanya karena sisi klien direkayasa ulang.

### 4.4 Pemisahan Superadmin — aturan yang mudah hilang saat rewrite

`service.go:488` `AuthorizeOperational` **menolak superadmin** dari seluruh modul
operasional:

```sql
AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur
               WHERE ur.user_id=u.id AND ur.role_key='superadmin')
```

Dan sebaliknya, `AuthorizeIdentity` menuntut role `superadmin` dengan permission
`identity.roles.manage`. Pemisahan dua arah ini adalah keputusan desain, bukan
kebetulan. Di Express ini harus jadi dua middleware berbeda yang eksplisit —
jangan digabung jadi satu `requireAuth` generik.

### 4.5 Skop data berjenjang

Tiga scope: `own`, `assigned`, `unit` (lihat `cmd/seed-bagrenmin/main.go:29-44`).
Setiap endpoint operasional menyaring baris berdasarkan scope role **di level
query**, bukan di level aplikasi. Memindahkannya ke filter JavaScript setelah
`SELECT *` akan membocorkan data lintas unit. Pertahankan penyaringan di SQL.

### 4.6 Sesi dan CSRF

- Token sesi disimpan **ter-hash** (`tokenHash(c.Value)`, `service.go:420`), bukan plaintext.
- Mutasi menuntut Origin + CSRF (`allowMutation`).
- `AllowedOrigins` di-hardcode ke `http://127.0.0.1:5174` dan `http://localhost:5174` (`main.go:115`). Saat produksi, ini harus jadi konfigurasi — tapi tetap allowlist, jangan `*`.
- `SDL_COOKIE_SECURE` wajib `true` di luar development; `main.go:105` sengaja mematikan proses jika dilanggar.

### 4.7 Enkripsi evidence

`internal/subbagren/evidence_crypto.go` — AES-256-GCM dengan envelope ber-versi
dan nonce acak per record, kunci dari `SDL_EVIDENCE_KEY` (64 hex = 32 byte,
divalidasi di `httpapi/router.go:119`). **Data lama hanya bisa dibaca jika
envelope, urutan nonce, dan additional-data direproduksi byte-identik.** Ini
titik di mana rewrite paling mudah merusak data secara diam-diam.

### 4.8 Pengerasan container

`infra/compose.dev.yaml` service `api`: `read_only: true`, `cap_drop: ["ALL"]`,
`security_opt: ["no-new-privileges:true"]`, tmpfs 16m. Image Node harus
mempertahankan profil yang sama — Node butuh direktori tulis yang lebih banyak
daripada binary Go statis, jadi ini perlu penyesuaian sadar, bukan pelonggaran malas.

---

## 5. Strategi: strangler, bukan big bang

Menulis ulang 174 endpoint lalu mengganti semuanya sekaligus berarti tidak ada
titik aman untuk mundur. Rekomendasi: **jalankan Go dan Express berdampingan**,
pindahkan per modul, dengan reverse proxy yang mengarahkan path tertentu ke
backend baru.

```
            ┌───────────────┐
 Browser ──►│ proxy / Vite  │
            └───┬───────┬───┘
     /api/v1/auth/*     │ sisanya
                │       │
         ┌──────▼──┐  ┌─▼────────┐
         │ Express │  │ Go (lama)│
         └────┬────┘  └────┬─────┘
              └─── Postgres ┘   (satu database, dipakai bersama)
```

Keduanya menulis ke database yang sama. Yang sudah dipindah dilayani Express,
sisanya tetap Go. Jika satu modul bermasalah, kembalikan path-nya ke Go tanpa
menyentuh yang lain.

**Syarat agar ini bekerja:** format sesi dan cookie harus kompatibel sejak hari
pertama, karena pengguna akan berpindah-pindah antara kedua backend dalam satu
sesi login. Itulah sebabnya modul auth dipindahkan paling awal dan paling hati-hati.

---

## 6. Fase pekerjaan

### Fase 0 — Fondasi dan alat ukur

- Siapkan `apps/backend-express` (TypeScript, Express 5, `pg`, `argon2`, `nodemailer`).
- **Porting `internal/securitytest` (9 file) lebih dulu**, sebelum satu endpoint pun ditulis. Suite ini menjadi alat ukur netral: ia harus lulus melawan backend Go sekarang, lalu melawan Express nanti.
- Tambah service `api-express` di Compose, berbagi network dan database.
- Runner migrasi Node yang membaca 33 SQL yang sama, diverifikasi menghasilkan skema identik.

**Selesai jika:** suite keamanan hasil porting lulus melawan backend Go yang sedang berjalan.

### Fase 1 — Auth dan sesi

Modul `internal/auth` (15 file): login, Argon2id, OTP, CAPTCHA, sesi, CSRF, ganti password.

**Selesai jika:** login di Express menghasilkan cookie yang diterima backend Go, dan sebaliknya. Hash password lama terverifikasi tanpa reset. Superadmin tetap wajib OTP.

### Fase 2 — Identitas dan RBAC

`internal/users`, `roles`, `access`, `delegations`. Termasuk dua middleware otorisasi terpisah (§4.4) dan penyaringan scope di SQL (§4.5).

**Selesai jika:** superadmin tetap tertolak dari modul operasional, dan `kabagrenmin` tetap hanya bisa membaca empat unit tanpa hak tulis.

### Fase 3 — Urmin

`internal/urmin` (15 file) — surat masuk, lampiran, distribusi, disposisi. Lampiran `BYTEA` dengan batas 10MB.

### Fase 4 — Subbagren

`internal/subbagren` (8 file) — usulan, konsolidasi, anggaran, evidence. **Enkripsi AES-GCM (§4.7) diverifikasi dengan data lama, bukan data uji baru.**

### Fase 5 — Unit kerja dan direktif

`internal/unitwork` (10 file), `internal/directives` (7 file), `notifications`, `portal`, `roadmap`.

### Fase 6 — Pemadaman Go

- Semua path dialihkan ke Express.
- `cmd/seed-bagrenmin` dan `cmd/reset-all-passwords` diporting (dipakai operasional, bukan opsional).
- Service `api` lama dihapus dari Compose; profil keamanan container diverifikasi ulang (§4.8).
- `docs/ARCHITECTURE.md` diperbarui.

---

## 7. Risiko utama

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Satu pemeriksaan otorisasi hilang saat porting | Kebocoran data lintas unit, sunyi tanpa error | Security test suite diporting **sebelum** endpoint (Fase 0) |
| Parameter Argon2id meleset | Seluruh pengguna terkunci | Verifikasi hash lama di Fase 1 sebelum lanjut |
| Envelope AES-GCM tidak identik | Evidence lama tak terbaca, kerusakan senyap | Uji dekripsi record lama, bukan record baru |
| Scope `own`/`assigned`/`unit` dipindah ke filter JS | Data unit lain ikut terkirim | Pertahankan penyaringan di SQL |
| Sesi tak kompatibel antar backend | Pengguna ter-logout acak selama transisi | Fase 1 wajib tuntas sebelum fase lain dimulai |
| Node butuh filesystem tulis | `read_only: true` dilonggarkan diam-diam | Tetapkan tmpfs eksplisit, jangan buang `read_only` |
| Ekosistem npm | Permukaan serangan dependensi jauh lebih luas dari 3 dependensi Go | `npm ci`, lockfile terkunci, audit berkala |

---

## 8. Keputusan yang perlu diambil sebelum mulai

1. **TypeScript atau JavaScript?** Rekomendasi: TypeScript (§3).
2. **ORM atau SQL langsung?** Rekomendasi: `pg` dengan SQL langsung. 56 tabel dengan penyaringan berskop akan lebih aman dan lebih mudah diaudit dalam SQL eksplisit daripada melalui abstraksi Prisma/TypeORM.
3. **Strangler atau big bang?** Rekomendasi: strangler (§5). Big bang hanya masuk akal jika aplikasi belum dipakai siapa pun.
4. **Apakah 3.048 baris test Go ikut diporting?** Rekomendasi: minimal `securitytest` wajib; sisanya menyusul per fase.
5. **Apa alasan bisnis migrasi ini?** Pertanyaan ini bukan basa-basi. Jika alasannya ketersediaan SDM Node, rencana ini masuk akal. Jika alasannya performa atau fitur, Go sekarang kemungkinan besar sudah lebih unggul dan migrasi justru merugikan.

---

## 9. Estimasi

Asumsi: satu pengembang berpengalaman Node + SQL, bekerja penuh waktu, dengan
backend Go tersedia sebagai referensi hidup.

| Fase | Perkiraan |
|---|---|
| Fase 0 — fondasi & test harness | 1–2 minggu |
| Fase 1 — auth & sesi | 2–3 minggu |
| Fase 2 — identitas & RBAC | 2–3 minggu |
| Fase 3 — Urmin | 3–4 minggu |
| Fase 4 — Subbagren | 2–3 minggu |
| Fase 5 — unit kerja & direktif | 3–4 minggu |
| Fase 6 — pemadaman & dokumentasi | 1–2 minggu |
| **Total** | **14–21 minggu (≈3,5–5 bulan)** |

Dua pengembang paralel setelah Fase 2 selesai dapat memangkas menjadi sekitar
9–13 minggu. Fase 0 sampai 2 **tidak boleh diparalelkan** — semuanya bertumpu
pada fondasi auth yang sama.

Angka ini perkiraan berbasis volume kode (13.5k baris, 174 endpoint) dan belum
memperhitungkan pekerjaan lain yang berjalan bersamaan.

---

## 10. Referensi silang

- `docs/ARCHITECTURE.md` — arsitektur saat ini
- `docs/R2B-AUTH.md` — rancangan autentikasi
- `docs/R2C1-ROLE-PERMISSION.md` — model role & permission
- `docs/R2D1-CAPTCHA-OTP-POLICY.md` — kebijakan CAPTCHA & OTP
- `docs/R2D5-SECURITY-TESTS.md` — cakupan pengujian keamanan
- `docs/LOCAL-BAGRENMIN-USERS.md` — 13 akun operasional
