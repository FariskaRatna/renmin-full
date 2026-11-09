#!/usr/bin/env bash
# Uji integrasi keamanan untuk backend EXPRESS.
#
# Padanan security-test-r2d5.sh, yang menguji backend Go. Keduanya perlu ada
# selama dua backend hidup: yang satu menjaga backend yang sekarang melayani
# trafik, yang satu lagi menjaga backend yang akan menggantikannya.
#
# Seperti versi Go-nya, skrip ini TIDAK punya penjaga nama folder — ia aman
# dijalankan dari checkout mana pun karena seluruh state-nya ephemeral.
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

[[ -f "$ROOT/infra/compose.security-test-express.yaml" && -f "$ROOT/apps/backend-express/security/index.js" ]] \
  || { echo 'ERROR: berkas uji keamanan Express tidak lengkap.' >&2; exit 1; }
[[ -d "$ROOT/apps/backend/internal/migrations/sql" ]] \
  || { echo 'ERROR: direktori migrasi SQL tidak ditemukan; skema dipakai bersama dengan backend Go.' >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  export PATH="$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi
command -v docker >/dev/null 2>&1 || { echo 'ERROR: Docker CLI tidak ada.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'ERROR: daemon Docker belum siap.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'ERROR: Docker Compose tidak ada.' >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo 'ERROR: openssl diperlukan untuk kredensial terisolasi.' >&2; exit 1; }

TEMP="$(mktemp -d "${TMPDIR:-/tmp}/sdl-sec-express.XXXXXXXX")"
chmod 700 "$TEMP"
ENVFILE="$TEMP/isolated.env"
# Password dibuat per-run dan hanya pernah ada di berkas mode 600 di dalam
# direktori sementara yang dihapus saat keluar.
printf 'SDL_SECURITY_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > "$ENVFILE"

PROJECT="sdlsecexpress-$(date +%Y%m%d%H%M%S)-$$"
REPORT_DIR="$ROOT/0.sekerips/reports"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/sdl-security-express-$(date +%Y%m%d-%H%M%S)-$$.log"

COMPOSE=(docker compose --env-file "$ENVFILE" -f "$ROOT/infra/compose.security-test-express.yaml" -p "$PROJECT")
cleanup() {
  "${COMPOSE[@]}" down --remove-orphans --volumes >/dev/null 2>&1 || true
  rm -rf "$TEMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '============================================================\n SIERA DELTA LIMA | UJI KEAMANAN INTEGRASI — BACKEND EXPRESS\n============================================================\n'
printf 'AMAN   : PostgreSQL ephemeral terisolasi; tanpa port host, tanpa volume SDL.\n'
printf 'PROJECT: %s\n' "$PROJECT"
printf 'LAPORAN: %s\n\n' "$REPORT"

set +e
"${COMPOSE[@]}" run --build --rm -T test 2>&1 | tee "$REPORT"
rc=${PIPESTATUS[0]}
set -e

if [[ "$rc" -eq 0 ]]; then
  echo 'STATUS : UJI KEAMANAN EXPRESS LULUS (cakupan di docs/R2D5-SECURITY-TESTS.md)'
else
  echo "STATUS : UJI KEAMANAN EXPRESS GAGAL (exit $rc). Periksa $REPORT; jangan alihkan trafik." >&2
fi
exit "$rc"
