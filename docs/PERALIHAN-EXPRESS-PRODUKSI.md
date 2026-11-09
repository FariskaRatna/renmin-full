# Peralihan produksi Go → Express (172.16.173.34)

Runbook Tahap 6 `apps/backend-express/docs/MIGRATION-PLAN.md`. Disusun dan
**digladi di lokal 2026-11-04** dengan Caddy HTTPS yang sama persis dengan
server. Semua perintah di bawah sudah dijalankan sekali; yang berbeda di server
hanya alamatnya.

## Prinsip

- **Go tetap hidup sepanjang peralihan.** Express ditambahkan di sampingnya,
  satu database. `apps/backend/` tidak dihapus sampai Express stabil.
- **Peralihan per prefix di Caddy** lewat satu variabel `.env`:
  `SDL_EXPRESS_PATHS`. Rollback = kosongkan baris itu + restart Caddy.
- **Satu worker email aktif.** Dipindah PALING AKHIR, lewat
  `infra/compose.email-express.yaml`, Go dimatikan lebih dulu.
- Sesi login ada di database bersama, jadi **pengguna tidak perlu login ulang**
  saat prefix berpindah backend.

## Bukti gladi lokal (2026-11-04)

| Pemeriksaan | Hasil |
|---|---|
| Harness golden-file, golden direkam ulang dari Go lalu dibandingkan dengan Express | **431/431 cocok**, 152 endpoint |
| Endpoint 153–157 (di luar harness) | `verify/r5h1-flow.js`, `r5h4-flow.js` lulus di kedua backend, respons byte-identik |
| Suite keamanan Express / Go | 21/21 · 21/21 |
| Login HTTPS sungguhan (CAPTCHA → ganti password → portal) lewat Caddy | lulus via Go, lalu lulus via Express **dengan Go dimatikan** |
| 25 langkah UI (surat masuk, lembar disposisi, surat keluar, arahan bagian/Paur) | 25/25 lulus **dengan Go dimatikan** |
| Peralihan sebagian (`portal`, `executive` ke Express) | prefix terpilih 200 dari Express, sisanya tetap ke Go |
| Pindah worker email + rollback-nya | sesuai log yang diharapkan, dua arah |

## Dua jebakan yang sudah ditangani di konfigurasi

1. **Worker email Go tidak bisa dimatikan lewat `.env`.** Service `api` di
   `compose.dev.yaml` tidak meneruskan `SDL_EMAIL_NOTIFICATIONS_ENABLED`,
   sedangkan Express membacanya. Mengisi `false` di `.env` mematikan worker
   yang SALAH. Karena itu dipakai overlay tersendiri.
2. **Caddy dulu tidak pernah melihat `/api`** (semua ke Vite). Caddyfile kini
   punya blok `@express` yang membaca `SDL_EXPRESS_PATHS`; tanpa variabel itu
   nilainya sentinel yang tidak pernah cocok, jadi perilakunya identik dengan
   sebelumnya.

Caddyfile memakai `admin off`, sehingga perubahan berlaku lewat
`--force-recreate caddy` (jeda 1–2 detik), bukan reload panas.

---

## Fase 1 — Deploy kode + Express berdampingan (trafik tetap Go)

Di server, dari folder `1.siera-delta-lima`. Backup dan cara memasang kode:
lihat **`docs/DEPLOY-SERVER.md`** (pg_dump + tar folder lama, ekstrak tarball tanpa menimpa
`.env` dan `infra/certs`).

```bash
CF="--env-file .env -f infra/compose.dev.yaml -f infra/compose.proxy.yaml -f infra/compose.express.yaml"

docker compose $CF build api api-express frontend      # unit test Go ikut jalan
docker compose $CF run --rm --no-deps api -migrate      # migrasi baru (mis. 043)
docker compose $CF up -d --wait                         # api-express ikut menyala
```

Periksa:

```bash
docker ps --format '{{.Names}}  {{.Status}}'            # api-express: healthy
docker logs sdl-foundation-r1-api-express-1 2>&1 | grep -i "email notification worker"
#  -> reason "worker_owned_by_go_backend"   (BENAR: Express belum mengirim email)
grep -c SDL_EXPRESS_PATHS .env                          # 0 = belum ada prefix yang dialihkan
```

Sampai di sini pengguna masih 100% dilayani Go.

## Fase 2 — Alihkan prefix bertahap

Tambahkan baris ini di `.env`, lalu perluas daftarnya di setiap langkah:

```bash
# Langkah 1 — jarang dipakai, risiko terendah
SDL_EXPRESS_PATHS=/api/v1/portal/* /api/v1/executive/*
```

Terapkan:

```bash
docker compose $CF up -d --no-deps --force-recreate caddy
```

Lalu amati minimal beberapa jam kerja sebelum langkah berikutnya:

```bash
docker logs -f --since 10m sdl-foundation-r1-api-express-1   # error 5xx?
```

Urutan langkah yang disarankan (nilai baru **menggantikan** yang lama):

| Langkah | `SDL_EXPRESS_PATHS` |
|---|---|
| 1 | `/api/v1/portal/* /api/v1/executive/*` |
| 2 | langkah 1 + `/api/v1/subbagren/* /api/v1/subbagsumda/* /api/v1/subbagbinfung/*` |
| 3 | langkah 2 + `/api/v1/unit-work/* /api/v1/urmin/*` |
| 4 | langkah 3 + `/api/v1/leadership/*` |
| 5 | `/api/*` — semuanya, termasuk login (`/auth`) dan admin |

Uji tiap langkah dari browser lewat `https://172.16.173.34` dengan akun
sungguhan untuk prefix yang baru dipindah. Pada langkah 5 wajib login ulang
sekali dari jendela penyamaran: CAPTCHA, password, dan OTP Superadmin.

**Rollback kapan saja:** kembalikan baris `SDL_EXPRESS_PATHS` ke nilai
sebelumnya (atau hapus barisnya), lalu jalankan lagi perintah `--force-recreate
caddy`. Tidak ada data yang perlu dipulihkan karena kedua backend memakai
database yang sama.

## Fase 3 — Pindahkan worker email (setelah langkah 5 stabil)

```bash
CE="$CF -f infra/compose.email-express.yaml"
docker compose $CE up -d --no-deps --wait api            # 1. Go BERHENTI mengirim
docker exec sdl-foundation-r1-api-1 env | grep EMAIL     #    -> ...=false
docker compose $CE up -d --no-deps --wait api-express    # 2. Express MULAI
docker logs sdl-foundation-r1-api-express-1 2>&1 | grep -i "email notification worker" | tail -1
#  -> "urmin email notification worker enabled"
```

**Mulai saat ini, setiap perintah `up` di server WAJIB menyertakan
`-f infra/compose.email-express.yaml`** (pakai `$CE`, bukan `$CF`). Kalau
overlay itu terlupa, worker kembali ke Go. Tidak sampai mengirim ganda, karena
Express ikut kembali mati, tetapi kepemilikannya berpindah tanpa disadari.

Rollback (urutan dibalik):

```bash
docker compose $CF up -d --no-deps --wait api-express    # Express berhenti dulu
docker compose $CF up -d --no-deps --wait api            # Go mengirim lagi
```

## Fase 4 — Sesudahnya

- Biarkan Go tetap berjalan beberapa minggu sebagai jalur rollback.
- Mematikan service Go dan menghapus `apps/backend/` adalah keputusan
  terpisah, setelah Express stabil (lihat checklist Tahap 6 di
  MIGRATION-PLAN).
- Suite yang relevan sejak langkah 5 adalah `scripts/security-test-express.sh`;
  suite Go tetap hijau tetapi tidak lagi menguji backend yang melayani.

## Catatan gladi

- `harness seed-docs` menambahkan izin disposisi **khusus harness** ke role di
  database lokal. Itu bukan konfigurasi produksi dan tidak ikut terdeploy.
  Jangan jalankan harness terhadap database server.
- Gladi memakai sertifikat self-signed untuk `127.0.0.1` dan variabel shell;
  `.env` lokal tidak diubah, dan stack lokal sudah dikembalikan ke mode dev.
