# CI/CD — push ke GitHub, server ter-update

Mengganti alur lama (tarball → scp → ekstrak → tukar folder) di
`DEPLOY-SERVER.md`. Alur lama tetap berlaku sebagai jalan darurat kalau
GitHub atau runner bermasalah.

```
push ke main
  │
  ├─ Cek di mesin GitHub (paralel, ±10 menit)
  │    frontend: tsc + vite build
  │    backend Go: build image (go test ikut jalan)
  │    backend Express: build image
  │    uji keamanan r2d5 + express (Postgres sementara)
  │    → satu merah = berhenti, server tidak disentuh
  │
  └─ Deploy (runner di 172.16.173.34, menunggu tombol Approve)
       scripts/deploy.sh:
       1 periksa  2 migrasi tertunda?  3 backup  4 ganti kode
       5 server-check pre  6 build  7 -migrate (kalau diizinkan)
       8 up  9 server-check post
       → gagal di langkah 5–9 = rollback otomatis ke commit & image sebelumnya
```

Pull request hanya menjalankan cek. Deploy hanya dari `main`.

## Aturan yang tetap berlaku

- **Migrasi tidak pernah otomatis.** Kalau commit membawa SQL baru, deploy
  berhenti di langkah 2 *sebelum menyentuh apa pun*. Untuk menjalankannya:
  Actions → **CI/CD** → **Run workflow** → centang **Izinkan migrasi database**.
- **`.env` dan `infra/certs/` tidak pernah lewat GitHub.** Keduanya tetap di
  server; git mengabaikannya, jadi deploy tidak menimpanya.
- **Database tidak ikut di-rollback.** Migrasi hanya menambah; backend lama
  tetap mau start di atas skema baru. Pemulihan DB dari backup tetap manual
  (`DEPLOY-SERVER.md`, "Rollback Fase 1").
- **Fase 3 (worker email ke Express):** isi variabel repo `SDL_COMPOSE_EXTRA`
  = `-f infra/compose.email-express.yaml`. Jangan edit `deploy.sh` di server.

## Pemasangan (sekali saja)

### 1. GitHub: environment "production"

Repo → **Settings** → **Environments** → **New environment** → `production`:

- **Required reviewers**: centang, tambahkan `FariskaRatna`
- **Deployment branches and tags**: *Selected branches* → `main`

Opsional, **Settings → Secrets and variables → Actions → Variables**:
`SDL_APP` kalau folder instalasi bukan `/home/devops/renmin/1.siera-delta-lima`.

### 2. Server: pasang runner

Repo → **Settings** → **Actions** → **Runners** → **New self-hosted runner** →
**Linux**, **x64**. Halaman itu memberi perintah dengan token sekali pakai.
Jalankan sebagai `devops`, dengan **satu perubahan** di langkah `config.sh`:

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
# curl -o ... && tar xzf ...      ← salin dari halaman GitHub
./config.sh --url https://github.com/FariskaRatna/renmin-full --token <TOKEN> \
  --name sdl-prod --labels sdl-prod --unattended
```

`--labels sdl-prod` wajib: workflow hanya mau jalan di runner berlabel itu.

Jadikan service supaya hidup lagi setelah server reboot:

```bash
sudo ./svc.sh install devops
sudo ./svc.sh start
sudo ./svc.sh status        # harus: active (running)
```

Cek di GitHub → Settings → Actions → Runners: `sdl-prod` berstatus **Idle**.

Runner berjalan sebagai `devops`, user yang sama yang selama ini menjalankan
`docker compose` — tidak butuh sudo untuk deploy.

### 3. Deploy pertama

Folder instalasi sekarang hasil ekstrak tarball, belum git. Deploy pertama
mengubahnya jadi checkout git: berkas yang dikenal repo diganti versi baru,
`.env`, `infra/certs/`, `mockup/` dan berkas lain yang tidak dikenal repo
dibiarkan (dicetak di log). Backup folder lengkap dibuat lebih dulu.

Pilih jam di luar kerja (container dibuat ulang, jeda ±1 menit). Lalu:

1. Actions → **CI/CD** → **Run workflow** → branch `main`, centang
   **Izinkan migrasi database** → **Run workflow**.
   (Repo saat ini membawa `044_berkas_pendukung.sql` yang belum ada di server.)
2. Tunggu cek hijau → job **Deploy** menunggu → **Review deployments** →
   centang `production` → **Approve and deploy**.
3. Baca log job Deploy sampai `SELESAI`.

Push ke `main` sebelum langkah ini juga memicu deploy; kalau di-approve, ia
berhenti aman di langkah 2 karena migrasi belum diizinkan. Boleh di-*Reject*.

## Sehari-hari

```bash
git add ... && git commit -m "..." && git push
```

Lalu GitHub → Actions → run terbaru → **Review deployments** → Approve.
Pengguna perlu F5 untuk tampilan baru.

## Rollback manual

Rollback otomatis menangani deploy yang gagal. Untuk mundur dari deploy yang
*berhasil* tapi ternyata bermasalah, cara paling bersih: `git revert` commit-nya
di laptop lalu push — deploy berikutnya memasang keadaan sebelumnya.

Darurat tanpa GitHub, di server:

```bash
cd ~/renmin/1.siera-delta-lima
git log --oneline -5                       # pilih commit sebelumnya
git reset --hard <commit>
for s in api api-express frontend; do docker tag sdl-foundation-r1-$s:prev sdl-foundation-r1-$s:latest; done
CF="--env-file .env -f infra/compose.dev.yaml -f infra/compose.proxy.yaml -f infra/compose.express.yaml -f infra/compose.db-local.yaml"
docker compose $CF up -d --no-deps --no-build --force-recreate --wait api api-express frontend
docker compose $CF up -d --no-deps --force-recreate caddy
```

## Bersih-bersih

Tiap deploy membuat backup di `~/sdl-backup/<waktu>/` (DB + folder). Simpan
beberapa yang terakhir, hapus sisanya manual. Image lama: `docker image prune`.
