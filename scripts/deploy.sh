#!/usr/bin/env bash
# Deploy otomatis ke server produksi — dipanggil oleh GitHub Actions
# (.github/workflows/deploy.yml) di self-hosted runner, BUKAN dijalankan manual.
# Panduan lengkap: docs/CICD.md. Prosedur manual yang diotomasi:
# docs/DEPLOY-SERVER.md "Deploy ulang".
#
# Masukan (environment):
#   SDL_APP           folder instalasi, mis. /home/devops/renmin/1.siera-delta-lima
#   SDL_SOURCE        checkout repo milik runner ($GITHUB_WORKSPACE), sumber kode baru
#   SDL_MIGRATE       "yes" = izinkan -migrate kalau ada SQL baru. Selain itu,
#                     adanya migrasi tertunda membuat deploy BERHENTI sebelum
#                     menyentuh apa pun (migrasi tidak pernah otomatis).
#   SDL_COMPOSE_EXTRA tambahan -f, mis. "-f infra/compose.email-express.yaml"
#                     setelah Fase 3. Kosong = susunan sekarang.
#   SDL_DRY_RUN       "1" = hanya pemeriksaan + rencana, tanpa perubahan.
#
# Urutan: periksa → backup → ganti kode → server-check pre → build → migrasi
# → up → server-check post. Gagal setelah kode diganti = rollback otomatis ke
# commit dan image sebelumnya. Database TIDAK di-rollback: migrasi hanya
# menambah, dan backend lama tetap mau start di atas skema baru.
set -euo pipefail

APP="${SDL_APP:?SDL_APP wajib diisi}"
SRC="${SDL_SOURCE:?SDL_SOURCE wajib diisi}"
MIGRATE="${SDL_MIGRATE:-no}"
DRY="${SDL_DRY_RUN:-0}"
SERVICES=(api api-express frontend)
PROJECT=sdl-foundation-r1

# shellcheck disable=SC2206
CF=(--env-file .env -f infra/compose.dev.yaml -f infra/compose.proxy.yaml
    -f infra/compose.express.yaml -f infra/compose.db-local.yaml ${SDL_COMPOSE_EXTRA:-})

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
die()  { printf '\n\033[31mGAGAL:\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1. Pemeriksaan awal (belum ada yang diubah) ──────────────────────────────
step "1. Pemeriksaan awal"
[ -d "$APP" ] || die "folder instalasi $APP tidak ada"
[ -f "$APP/.env" ] || die "$APP/.env tidak ada"
[ -f "$APP/infra/certs/sdl.crt" ] || die "$APP/infra/certs/sdl.crt tidak ada"
NEW="$(git -C "$SRC" rev-parse HEAD)"
PREV="$(git -C "$APP" rev-parse -q --verify HEAD 2>/dev/null || true)"
echo "kode baru      : $NEW ($(git -C "$SRC" log -1 --format=%s))"
echo "kode terpasang : ${PREV:-belum dikelola git (deploy pertama lewat CI)}"
docker info >/dev/null 2>&1 || die "daemon Docker tidak bisa dihubungi oleh user $(id -un)"
if [ -n "$PREV" ] && [ "$PREV" = "$NEW" ]; then
  echo "Commit ini sudah terpasang. Tetap dilanjutkan (build memakai cache)."
fi

# ── 2. Migrasi tertunda: dihitung dari SQL kode BARU vs ledger DB ────────────
step "2. Migrasi database"
DB_CTR="$(docker ps --filter "label=com.docker.compose.project=$PROJECT" \
                    --filter 'label=com.docker.compose.service=db' --format '{{.Names}}' | head -1)"
[ -n "$DB_CTR" ] || die "container db $PROJECT tidak berjalan"
APPLIED="$(docker exec "$DB_CTR" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT filename FROM sdl_schema_migrations ORDER BY filename"' | sed 's#^sql/##')"
[ -n "$APPLIED" ] || die "sdl_schema_migrations tidak terbaca"
PENDING=""
for f in "$SRC"/apps/backend/internal/migrations/sql/*.sql; do
  printf '%s\n' "$APPLIED" | grep -qxF "$(basename "$f")" || PENDING="$PENDING $(basename "$f")"
done
for a in $APPLIED; do
  [ -f "$SRC/apps/backend/internal/migrations/sql/$a" ] || die "DB punya migrasi $a yang TIDAK ada di kode ini — kode lebih tua dari DB?"
done
echo "terakhir di DB : $(printf '%s\n' "$APPLIED" | tail -1)"
if [ -z "$PENDING" ]; then
  echo "tidak ada migrasi tertunda"
elif [ "$MIGRATE" = "yes" ]; then
  echo "AKAN diterapkan (diizinkan):$PENDING"
else
  cat >&2 <<EOF

Ada migrasi baru:$PENDING

Deploy dihentikan SEBELUM menyentuh server. Migrasi database tidak pernah
otomatis. Kalau memang siap: GitHub → Actions → "CI/CD" → Run workflow →
centang "Izinkan migrasi database" → Run. Backup DB dibuat otomatis lebih dulu.
EOF
  exit 1
fi

if [ "$DRY" = "1" ]; then
  step "DRY RUN selesai — tidak ada yang diubah"
  echo "Rencana: backup → ganti kode ke ${NEW:0:7} → build ${SERVICES[*]}${PENDING:+ → -migrate} → up → server-check post"
  exit 0
fi

# ── 3. Backup (DB + folder termasuk .env) ────────────────────────────────────
step "3. Backup"
( cd "$APP" && bash "$SRC/scripts/server-backup.sh" )

# ── 4. Ganti kode di folder instalasi ────────────────────────────────────────
step "4. Ganti kode"
cd "$APP"
if [ -z "$PREV" ]; then
  # Deploy pertama: folder hasil ekstrak tarball diubah jadi checkout git.
  # .env, infra/certs dan berkas lain yang di-.gitignore TIDAK disentuh;
  # berkas yang tidak dikenal repo dibiarkan dan dicetak di bawah.
  git init -q -b main
fi
git fetch -q "$SRC" HEAD
[ "$(git rev-parse FETCH_HEAD)" = "$NEW" ] || die "commit hasil fetch tidak sama dengan $NEW"
CADDY_CHANGED=yes
[ -n "$PREV" ] && git diff --quiet "$PREV" "$NEW" -- infra/Caddyfile && CADDY_CHANGED=no
git reset -q --hard "$NEW"
UNKNOWN="$(git ls-files --others --exclude-standard)"
[ -z "$UNKNOWN" ] || { echo "Berkas di server yang tidak ada di repo (dibiarkan):"; printf '  %s\n' $UNKNOWN; }
echo "kode sekarang  : $(git log -1 --format='%h %s')"

# Mulai di sini kegagalan apa pun memicu rollback.
TAGGED=no
rollback() {
  local rc=$?
  trap - ERR
  set +e   # rollback harus berjalan sampai habis walau satu langkahnya gagal
  printf '\n\033[31m== ROLLBACK\033[0m (exit %s)\n' "$rc" >&2
  cd "$APP"
  if [ -n "$PREV" ]; then
    git reset -q --hard "$PREV" && echo "kode dikembalikan ke ${PREV:0:7}" >&2
  else
    echo "Deploy pertama: tidak ada commit sebelumnya. Folder lama ada di backup ~/sdl-backup/<terbaru>/folder.tar.gz" >&2
  fi
  if [ "$TAGGED" = yes ]; then
    for s in "${SERVICES[@]}"; do docker tag "$PROJECT-$s:prev" "$PROJECT-$s:latest"; done
    docker compose "${CF[@]}" up -d --no-deps --no-build --force-recreate --wait "${SERVICES[@]}" || true
    docker compose "${CF[@]}" up -d --no-deps --force-recreate caddy || true
    echo "image sebelumnya dipasang lagi" >&2
  fi
  exit "$rc"
}
trap rollback ERR

# ── 5. Pemeriksaan .env / sertifikat / compose dengan kode baru ─────────────
step "5. server-check pre"
bash scripts/server-check.sh pre

# ── 6. Build (container lama tetap melayani) ─────────────────────────────────
step "6. Build ${SERVICES[*]}"
for s in "${SERVICES[@]}"; do
  docker image inspect "$PROJECT-$s:latest" >/dev/null 2>&1 && docker tag "$PROJECT-$s:latest" "$PROJECT-$s:prev"
done
TAGGED=yes
docker compose "${CF[@]}" build "${SERVICES[@]}"

# ── 7. Migrasi ───────────────────────────────────────────────────────────────
if [ -n "$PENDING" ]; then
  step "7. Migrasi:$PENDING"
  docker compose "${CF[@]}" run --rm --no-deps api -migrate
else
  step "7. Migrasi: tidak ada"
fi

# ── 8. Nyalakan (db tidak disentuh) ──────────────────────────────────────────
step "8. Up"
docker compose "${CF[@]}" up -d --no-deps --wait "${SERVICES[@]}"
if [ "$CADDY_CHANGED" = yes ]; then
  # Caddyfile di-bind-mount per berkas: tanpa dibuat ulang Caddy terus
  # membaca berkas lama (inode lama) setelah git menggantinya.
  docker compose "${CF[@]}" up -d --no-deps --force-recreate --wait caddy
else
  echo "Caddyfile tidak berubah — caddy tidak dibuat ulang"
fi

# ── 9. Pemeriksaan sesudah deploy ────────────────────────────────────────────
step "9. server-check post"
sleep 5
bash scripts/server-check.sh post

trap - ERR
step "SELESAI — $(git log -1 --format='%h %s')"
echo "Pengguna perlu memuat ulang halaman (F5) untuk tampilan baru."
