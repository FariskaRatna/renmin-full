#!/usr/bin/env bash
# SIERA DELTA LIMA — penyiapan pengembangan lokal.
#
# Padanan start-dev.sh / bootstrap-superadmin.sh / seed-bagrenmin-users.sh,
# TANPA penjaga nama folder. Script asli menolak jalan kecuali folder root
# bernama persis "1.siera-delta-lima"; checkout ini bernama lain, jadi ketiganya
# gagal sebelum sempat bekerja.
#
# Penjaga yang substantif tetap dipertahankan: Docker harus hidup, .env harus
# ada, dan nama database harus sdl_root_dev.
#
# Pemakaian:
#   bash scripts/local-setup.sh up            bangun image, migrasi, jalankan stack
#   bash scripts/local-setup.sh bootstrap     buat Superadmin pertama (interaktif)
#   bash scripts/local-setup.sh prepare-seed  buat akun op-urmin yang dituntut seed
#   bash scripts/local-setup.sh seed          buat 12 akun operasional (interaktif)
#   bash scripts/local-setup.sh harness       rekam golden file dari backend Go
#   bash scripts/local-setup.sh status        tampilkan kondisi stack
#   bash scripts/local-setup.sh down          hentikan stack
#
# Dari CMD/PowerShell pakai pembungkus local-setup.cmd dengan argumen sama.
set -Eeuo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

# Docker Desktop di Windows memakai credential helper "desktop". Dijalankan dari
# Git Bash (MSYS), docker.exe menerima PATH bergaya POSIX lalu mencoba menjalankan
# /usr/bin/docker-credential-desktop.exe dan gagal:
#
#   error getting credentials - err: fork/exec /usr/bin/docker-credential-desktop.exe:
#   exec format error
#
# Ini muncul saat menarik image, sekalipun image-nya publik dan tidak butuh
# kredensial sama sekali. DOCKER_CONFIG diarahkan ke config milik proyek yang
# tanpa credsStore; config global pengguna TIDAK disentuh, dan login registry
# yang sudah ada tetap utuh.
if [[ -z "${DOCKER_CONFIG:-}" && ( "${OSTYPE:-}" == msys* || "${OSTYPE:-}" == cygwin* ) ]]; then
  export DOCKER_CONFIG="$ROOT/infra/docker-config"
  # Docker mencari plugin CLI (termasuk docker-compose) di $DOCKER_CONFIG/cli-plugins.
  # Docker Desktop yang terpasang per-user menaruhnya di ~/.docker/cli-plugins,
  # sehingga begitu DOCKER_CONFIG dialihkan, "docker compose" ikut hilang.
  # Tunjuk kembali ke direktori plugin milik pengguna lewat cliPluginsExtraDirs.
  if [[ -d "$HOME/.docker/cli-plugins" ]] && command -v cygpath >/dev/null 2>&1; then
    plugins_dir="$(cygpath -m "$HOME/.docker/cli-plugins")"
    printf '{\n  "auths": {},\n  "currentContext": "default",\n  "cliPluginsExtraDirs": ["%s"]\n}\n' \
      "$plugins_dir" > "$DOCKER_CONFIG/config.json"
  fi
fi

DEV=(--env-file .env -f infra/compose.dev.yaml)

die() { printf 'GAGAL: %s\n' "$1" >&2; exit 1; }

preflight() {
  command -v docker >/dev/null 2>&1 || die 'Docker CLI tidak ditemukan.'
  docker info >/dev/null 2>&1 || die 'Docker daemon tidak berjalan. Buka Docker Desktop dulu.'
  docker compose version >/dev/null 2>&1 || die 'Docker Compose v2 dibutuhkan.'
  [[ -s .env ]] || die '.env tidak ada di root proyek.'
  [[ -f infra/compose.dev.yaml ]] || die 'infra/compose.dev.yaml tidak ditemukan.'
  grep -qx 'SDL_DB_NAME=sdl_root_dev' .env \
    || die 'SDL_DB_NAME harus persis sdl_root_dev; script seed dan reset menolak nilai lain.'
}

cmd_up() {
  preflight
  printf '[1/4] Membangun image (test Go dan typecheck/build React ikut berjalan di sini)...\n'
  docker compose "${DEV[@]}" build
  printf '[2/4] Menjalankan PostgreSQL...\n'
  docker compose "${DEV[@]}" up -d --wait db
  printf '[3/4] Menerapkan 33 migrasi SQL...\n'
  docker compose "${DEV[@]}" run --rm --no-deps api -migrate
  printf '[4/4] Menjalankan API dan frontend...\n'
  docker compose "${DEV[@]}" up -d --wait
  printf '\nSiap. Frontend: http://127.0.0.1:5174\n'
  printf 'API hanya di dalam network Docker; dari host uji lewat:\n'
  printf '  curl http://127.0.0.1:5174/api/v1/system/status\n\n'
  printf 'Database masih kosong. Lanjutkan dengan:\n'
  printf '  bash scripts/local-setup.sh bootstrap\n'
}

cmd_bootstrap() {
  preflight
  [[ -r /dev/tty ]] || die 'Butuh terminal interaktif.'
  cat <<'INFO'
============================================================
 Bootstrap Superadmin — sekali saja
============================================================
 Hanya berhasil kalau tabel user masih benar-benar kosong.
 Tidak ada password default.

 CATATAN: .env ini tidak mengisi SMTP, sedangkan OTP Superadmin
 tidak bisa dimatikan. Akun ini KARENA ITU tidak akan bisa login
 lewat browser (503 email_delivery_unavailable). Itu normal untuk
 pengembangan lokal — harness menyuntik sesi langsung, dan akun
 operasional hasil seed memakai OTP mati sehingga tetap bisa login.
============================================================
INFO
  IFS= read -r -p 'Username (huruf kecil, min 3 karakter) [sasdl]: ' username </dev/tty || true
  username="${username:-sasdl}"
  IFS= read -r -p 'Email: ' email </dev/tty
  IFS= read -r -p 'Nama tampilan: ' display_name </dev/tty
  IFS= read -r -s -p 'Password (14-256 karakter): ' password </dev/tty; printf '\n'
  IFS= read -r -s -p 'Ulangi password: ' confirmation </dev/tty; printf '\n'

  [[ "$password" == "$confirmation" ]] || die 'Password tidak sama.'
  [[ -n "$username" && -n "$email" && -n "$display_name" ]] || die 'Input tidak lengkap.'
  [[ ${#password} -ge 14 ]] || die 'Password minimal 14 karakter.'

  # Rahasia hanya lewat stdin: bukan argumen CLI, bukan environment, bukan file.
  printf '%s\n%s\n%s\n%s\n' "$username" "$email" "$display_name" "$password" \
    | docker compose "${DEV[@]}" run --rm -T --no-deps api -bootstrap-superadmin
  unset password confirmation

  printf '\nSuperadmin "%s" dibuat. Lanjutkan dengan:\n' "$username"
  printf '  bash scripts/local-setup.sh seed\n'
}

cmd_prepare_seed() {
  preflight
  command -v node >/dev/null 2>&1 || die 'Node.js dibutuhkan untuk langkah ini.'
  node scripts/create-op-urmin.js
}

cmd_seed() {
  preflight
  [[ -r /dev/tty ]] || die 'Butuh terminal interaktif.'
  docker compose "${DEV[@]}" exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 \
    || die 'Container database harus sudah sehat. Jalankan "up" dulu.'

  # seed-bagrenmin menolak jalan tanpa akun op-urmin yang sudah ada
  # (main.go:176). Di database baru akun itu belum pernah dibuat.
  local has_op_urmin
  has_op_urmin="$(docker compose "${DEV[@]}" exec -T db psql -U "${SDL_DB_USER:-sdl_app}" \
    -d "${SDL_DB_NAME:-sdl_root_dev}" -At \
    -c "SELECT EXISTS(SELECT 1 FROM sdl_users WHERE lower(username)='op-urmin')" 2>/dev/null | tr -d '[:space:]')"
  if [[ "$has_op_urmin" != "t" ]]; then
    die 'akun op-urmin belum ada, dan seed menolak jalan tanpanya.
       Jalankan dulu: local-setup.cmd prepare-seed'
  fi
  cat <<'INFO'
============================================================
 Seed 13 akun operasional BagRenmin
============================================================
 12 akun baru + op-urmin yang sudah ada diberi grant Urmin.
 Scope role: own / assigned / unit; Kabagrenmin baca lintas 4 unit.
 OTP MATI untuk 12 akun baru, sehingga bisa login dengan password saja.
 Email @siera.invalid — tidak bisa menerima email sungguhan.
 Transaksi atomik; menolak kalau ada user/role/grant yang bentrok.

 Akun hasil seed dibuat dengan must_change_password=TRUE. Harness
 membersihkannya otomatis saat mutasi diizinkan; untuk login lewat
 browser, password wajib diganti dulu di layar pertama.
============================================================
INFO
  IFS= read -r -p 'Username Superadmin [sasdl]: ' admin_username </dev/tty || true
  admin_username="${admin_username:-sasdl}"
  [[ "$admin_username" =~ ^[a-z][a-z0-9._-]{2,63}$ ]] || die 'Username Superadmin tidak valid.'
  IFS= read -r -p 'Ketik CREATE-12-LINK-1 untuk melanjutkan: ' confirm </dev/tty
  [[ "$confirm" == CREATE-12-LINK-1 ]] || die 'Dibatalkan, database tidak berubah.'
  IFS= read -r -s -p 'Password Superadmin SAAT INI (tersembunyi): ' sa_password </dev/tty; printf '\n'
  IFS= read -r -s -p 'Password awal untuk 12 akun baru (tersembunyi): ' initial </dev/tty; printf '\n'
  IFS= read -r -s -p 'Ulangi password awal: ' initial_confirm </dev/tty; printf '\n'

  if [[ ${#initial} -lt 14 || ${#initial} -gt 256 || "$initial" != "$initial_confirm" || -z "$sa_password" ]]; then
    unset sa_password initial initial_confirm
    die 'Pemeriksaan password gagal; database tidak berubah.'
  fi

  export SDL_SEED_SUPERADMIN_USERNAME="$admin_username"
  printf '%s\n%s\n%s\n' "$sa_password" "$initial" "$initial_confirm" \
    | docker compose "${DEV[@]}" -f infra/compose.seed-bagrenmin.yaml \
        run --build --rm --no-deps -T seed-bagrenmin -apply
  unset sa_password initial initial_confirm

  printf '\n13 akun siap. Lanjutkan dengan:\n'
  printf '  bash scripts/local-setup.sh harness\n'
}

cmd_harness() {
  preflight
  printf 'Harness: %s\n' "${1:-capture}"
  printf 'Mutasi: %s\n\n' "${SDL_HARNESS_ALLOW_MUTATIONS:-false}"
  mkdir -p apps/backend-express/harness/golden
  if [ "${1:-capture}" = compare ]; then
    # compare = Express terhadap golden dari Go. SDL_HARNESS_TARGET hanya label;
    # URL-nya harus ditimpa, kalau tidak compose.harness.yaml memakai api:8080
    # (Go) dan compare membandingkan Go dengan dirinya sendiri.
    SDL_HARNESS_TARGET=express docker compose "${DEV[@]}" -f infra/compose.express.yaml \
      -f infra/compose.harness.yaml run --rm --build \
      -e SDL_HARNESS_API_BASE=http://api-express:8080 harness compare
  else
    docker compose "${DEV[@]}" -f infra/compose.harness.yaml \
      run --rm --build harness "${1:-capture}"
  fi
}

cmd_status() {
  preflight
  docker compose "${DEV[@]}" ps
  printf '\nProbe API lewat proxy frontend:\n'
  curl --fail --silent --show-error --max-time 8 http://127.0.0.1:5174/api/v1/system/status \
    && printf '\n' || printf '(tidak menjawab)\n'
}

cmd_down() {
  [[ -s .env ]] || die '.env tidak ada.'
  docker compose "${DEV[@]}" down
}

case "${1:-}" in
  up)           cmd_up ;;
  bootstrap)    cmd_bootstrap ;;
  prepare-seed) cmd_prepare_seed ;;
  seed)         cmd_seed ;;
  harness)   cmd_harness "${2:-capture}" ;;
  status)    cmd_status ;;
  down)      cmd_down ;;
  *)
    sed -n '2,30p' "${BASH_SOURCE[0]}" | grep '^#' | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
