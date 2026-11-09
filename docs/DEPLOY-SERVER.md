# Deploy ke server produksi 172.16.173.34

Panduan **memasang kode baru** di server: paket, backup, pemasangan, build,
migrasi, dan pemeriksaan. Ini Fase 1 dari `PERALIHAN-EXPRESS-PRODUKSI.md`;
setelah selesai, trafik **masih 100% dilayani Go** dan Express hanya menyala di
sampingnya. Pengalihan prefix (Fase 2) dan worker email (Fase 3) ada di runbook
itu.

Isi rilis ini dibanding produksi: backend Express (`api-express`, baru pertama
kali di server), R5H4 arahan ke bagian/Paur (migrasi 043), dan migrasi 041/042
kalau server belum sampai ke sana. Caddyfile baru membaca `SDL_EXPRESS_PATHS`
tetapi tanpa variabel itu perilakunya identik dengan yang lama.

**Perkiraan waktu:** 30–60 menit, sebagian besar build. Pengguna hanya merasakan
jeda ±1 menit di Langkah 8 (container dibuat ulang). Pilih jam di luar kerja.

## Tiga skrip yang dipakai

| Skrip | Di mana | Fungsi |
|---|---|---|
| `scripts/package-release.sh` | laptop | membuat tarball tanpa `.env`, sertifikat, `node_modules` |
| `scripts/server-backup.sh` | server | `pg_dump` + tar folder lama (termasuk `.env`) + daftar migrasi |
| `scripts/server-check.sh pre\|post` | server | pemeriksaan hanya-baca; `GAGAL` = berhenti dulu |

Semua perintah server di bawah memakai dua variabel. **Sesuaikan `APP`** kalau
folder instalasi di server bukan di home:

```bash
APP=~/1.siera-delta-lima
CF="--env-file .env -f infra/compose.dev.yaml -f infra/compose.proxy.yaml -f infra/compose.express.yaml"
```

---

## Langkah 1 — Laptop: buat paket

Dari Git Bash di folder repo:

```bash
bash scripts/package-release.sh
```

Hasilnya di `release/`. Kirim keduanya (ganti `USER`):

```bash
scp release/sdl-release-*.tar.gz release/sdl-release-*.tar.gz.sha256 USER@172.16.173.34:~/
```

## Langkah 2 — Server: periksa dan ekstrak ke folder baru

Folder lama **tidak disentuh** sampai Langkah 7.

```bash
ssh USER@172.16.173.34
APP=~/1.siera-delta-lima
CF="--env-file .env -f infra/compose.dev.yaml -f infra/compose.proxy.yaml -f infra/compose.express.yaml"

cd ~ && sha256sum -c sdl-release-*.tar.gz.sha256        # harus: OK
rm -rf ~/sdl-new && mkdir ~/sdl-new
tar -xzf ~/sdl-release-*.tar.gz -C ~/sdl-new
cat ~/sdl-new/RELEASE-MANIFEST.txt
```

## Langkah 3 — Backup

Dijalankan dari folder **lama** (yang sedang melayani), memakai skrip dari
folder baru:

```bash
cd "$APP" && bash ~/sdl-new/scripts/server-backup.sh
```

Catat folder backup yang dicetak (`~/sdl-backup/<waktu>/`) dan baris
**"Migrasi terakhir di DB"**. Jangan lanjut kalau skrip ini gagal.

## Langkah 4 — Bawa `.env` dan sertifikat ke folder baru

```bash
cp -p "$APP/.env" ~/sdl-new/.env && chmod 600 ~/sdl-new/.env
cp -rp "$APP/infra/certs" ~/sdl-new/infra/certs
```

Lihat apakah ada berkas di server yang **tidak ada** di paket (misalnya
perubahan langsung di server yang tidak pernah kembali ke laptop):

```bash
diff -rq "$APP" ~/sdl-new -x node_modules -x .env -x certs | grep "Only in $APP"
```

Kosong = aman. Kalau ada isinya, **berhenti dan kirim daftarnya ke saya** dulu.

## Langkah 5 — Pemeriksaan sebelum build

```bash
cd ~/sdl-new && bash scripts/server-check.sh pre
```

Yang paling mungkin muncul sebagai `GAGAL` di server lama:

- **`SDL_PUBLIC_HOST kosong`** — tambahkan ke `.env`: `SDL_PUBLIC_HOST=172.16.173.34`
- **`SDL_ALLOWED_ORIGINS kosong`** — tambahkan: `SDL_ALLOWED_ORIGINS=https://172.16.173.34`
- **`docker compose ... terlalu lama`** / **`buildx tidak ada`** — `api-express`
  butuh Compose ≥ 2.17. Kirim keluarannya ke saya; ada jalan lain (build di
  laptop lalu `docker save`).

Edit `.env` dengan `nano ~/sdl-new/.env`, lalu ulangi sampai **0 GAGAL**.
`PERINGATAN` berisi daftar migrasi yang akan diterapkan; itu normal.

Satu `PERINGATAN` yang **sudah pasti muncul**: `/api/v1/system/status` produksi
per 2026-11-04 melaporkan `"demoSuperadminWorkspace":true`, artinya
`SDL_DEV_SUPERADMIN_WORKSPACE=true` di `.env` server. Itu jalur demo Superadmin
ke modul operasional yang menurut kebijakan harus mati di produksi. Deploy
tidak mengubahnya; mematikannya (ubah ke `false`) adalah keputusan terpisah.

## Langkah 6 — Build (Go masih melayani)

Simpan dulu image yang sedang dipakai sebagai jalur rollback cepat, lalu build:

```bash
for s in api frontend; do docker tag sdl-foundation-r1-$s:latest sdl-foundation-r1-$s:prev; done
cd ~/sdl-new && docker compose $CF build api api-express frontend
```

Unit test Go ikut jalan di dalam build; build gagal kalau test merah. Butuh
internet untuk `npm ci` dan image dasar Node/Go. Container yang berjalan tidak
terpengaruh sampai Langkah 8.

> Kalau `docker tag` menolak karena nama image berbeda, lihat namanya dengan
> `docker images | grep sdl` dan sesuaikan.

## Langkah 7 — Tukar folder

```bash
STAMP=$(date +%Y%m%d-%H%M)
mv "$APP" "$APP.prev-$STAMP" && mv ~/sdl-new "$APP" && cd "$APP"
```

Nama project compose tetap `sdl-foundation-r1` dan volume database tidak
bergantung pada nama folder, jadi data tidak ikut berpindah.

## Langkah 8 — Migrasi lalu nyalakan

```bash
cd "$APP"
docker compose $CF run --rm --no-deps api -migrate
docker compose $CF up -d --wait
docker compose $CF up -d --no-deps --force-recreate caddy
```

Baris ketiga wajib: Caddy memasang `Caddyfile` dari folder lama (yang sekarang
bernama `.prev-…`) dan tidak akan membaca yang baru tanpa dibuat ulang.

## Langkah 9 — Pemeriksaan sesudah deploy

```bash
bash scripts/server-check.sh post
```

Yang diharapkan: lima container sehat, Express menjawab, **worker email Express
mati dengan reason `worker_owned_by_go_backend`**, worker Go aktif, HTTPS 200,
dan "tidak ada migrasi tertunda".

Lalu dari browser di jaringan kantor, `https://172.16.173.34`:

1. Login sebagai satu akun operasional (mis. Kabagrenmin) — CAPTCHA, password.
2. Buka Surat Masuk dan Arahan; buat satu arahan ke **bagian** dan pastikan
   pilihan tujuan kini 11 (Kasubbag, bagian, Paur Sumda/Log/ADA).
3. Login Superadmin (wajib OTP email) → menu **Pengguna → tab Paur**. Isi
   anggota Paur Sumda, Log, ADA. Sebelum diisi, arahan ke Paur tidak sampai ke
   siapa pun.

Sampai di sini **semua masih dilayani Go**. Express baru melayani setelah
`SDL_EXPRESS_PATHS` diisi — lanjut ke Fase 2 di
`PERALIHAN-EXPRESS-PRODUKSI.md`, sebaiknya setelah satu hari kerja tanpa
keluhan.

---

## Rollback Fase 1

Migrasi 041–043 hanya **menambah**; backend Go lama hanya memeriksa migrasi yang
ia kenal, sehingga tetap mau start di atas skema baru. Jadi rollback kode tidak
perlu memulihkan database.

```bash
cd ~ && mv "$APP" "$APP.gagal-$(date +%H%M)" && mv "$APP.prev-<STAMP>" "$APP" && cd "$APP"
for s in api frontend; do docker tag sdl-foundation-r1-$s:prev sdl-foundation-r1-$s:latest; done
docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.proxy.yaml \
  up -d --no-build --force-recreate --wait api frontend caddy
docker rm -f $(docker ps -aq --filter label=com.docker.compose.service=api-express)
```

Memulihkan **database** dari backup hanya kalau datanya rusak — itu membuang
semua yang diinput pengguna sejak backup:

```bash
docker exec -i sdl-foundation-r1-db-1 sh -c \
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' \
  < ~/sdl-backup/<waktu>/db.dump
```

## Yang dikirim ke saya kalau ada masalah

Keluaran `server-check.sh pre` atau `post`, dan:

```bash
docker compose $CF ps
docker compose $CF logs --tail 80 api api-express caddy
```

Jangan kirim isi `.env`.

---

## Deploy ulang (pembaruan setelah Fase 1 selesai)

Untuk rilis berikutnya di atas instalasi yang sudah berjalan. Prinsipnya sama —
folder baru, tukar, rollback dengan menukar balik — tetapi yang di-build hanya
bagian yang berubah. `APP` di server ini: `~/renmin/1.siera-delta-lima`.

**Tentukan dulu apa yang berubah** (lihat `CATATAN-SESI-*.md` atau tanyakan):

| Yang berubah | Build | `-migrate` |
|---|---|---|
| hanya `apps/frontend` | `frontend` | tidak perlu |
| backend (Go dan/atau Express) | `api api-express` (+ `frontend` kalau ikut) | hanya kalau ada SQL baru |
| ada berkas baru di `migrations/sql` | `api api-express` | **ya**, dan backup DB wajib |

### Langkah

```bash
# Laptop
bash scripts/package-release.sh          # dari CMD: "%LOCALAPPDATA%\Programs\Git\bin\bash.exe" scripts/package-release.sh
scp release/sdl-release-*.tar.gz release/sdl-release-*.tar.gz.sha256 devops@172.16.173.34:~/

# Server
APP=~/renmin/1.siera-delta-lima
CF="--env-file .env -f infra/compose.dev.yaml -f infra/compose.proxy.yaml -f infra/compose.express.yaml -f infra/compose.db-local.yaml"
cd ~ && sha256sum -c sdl-release-<WAKTU>.tar.gz.sha256
rm -rf ~/sdl-new && mkdir ~/sdl-new && tar -xzf ~/sdl-release-<WAKTU>.tar.gz -C ~/sdl-new

cd "$APP" && bash ~/sdl-new/scripts/server-backup.sh      # cepat (<1 menit), tetap dijalankan
cp -p "$APP/.env" ~/sdl-new/.env && chmod 600 ~/sdl-new/.env
cp -rp "$APP/infra/certs" ~/sdl-new/infra/certs
cd ~/sdl-new && bash scripts/server-check.sh pre           # harus 0 GAGAL

docker tag sdl-foundation-r1-frontend:latest sdl-foundation-r1-frontend:prev
docker compose $CF build frontend                          # sesuaikan dengan tabel di atas

STAMP=$(date +%Y%m%d-%H%M); echo $STAMP
mv "$APP" "$APP.prev-$STAMP" && mv ~/sdl-new "$APP" && cd "$APP"
docker compose $CF up -d --no-deps --wait frontend
docker compose $CF up -d --no-deps --force-recreate caddy  # wajib: Caddyfile dipasang dari folder
bash scripts/server-check.sh post
```

**`compose.db-local.yaml` wajib ikut di `CF`** sejak 2026-11-06 (port Postgres
`127.0.0.1:5432` untuk DBeaver lewat SSH tunnel). Kalau terlupa, container `db`
dibuat ulang tanpa port: DBeaver berhenti tersambung, aplikasi tidak terpengaruh.

**Kalau Fase 3 (worker email ke Express) sudah dijalankan**, ganti `$CF` dengan
`$CE` (`$CF -f infra/compose.email-express.yaml`) di SEMUA perintah `up`.

Pengguna perlu memuat ulang halaman (F5) untuk mendapatkan tampilan baru.

### Rollback pembaruan frontend

```bash
cd ~ && mv "$APP" "$APP.gagal-$(date +%H%M)" && mv "$APP.prev-<STAMP>" "$APP" && cd "$APP"
docker tag sdl-foundation-r1-frontend:prev sdl-foundation-r1-frontend:latest
docker compose $CF up -d --no-deps --no-build --force-recreate --wait frontend
docker compose $CF up -d --no-deps --force-recreate caddy
```

### Bersih-bersih (sesekali)

Folder `$APP.prev-*`, `$APP.gagal-*`, tarball lama di `~`, dan `~/sdl-backup/*`
menumpuk tiap deploy. Simpan dua yang terakhir; hapus sisanya secara manual
setelah rilis baru terbukti stabil.
