#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ -f "$ROOT/infra/compose.security-test.yaml" && -f "$ROOT/apps/backend/internal/securitytest/security_integration_test.go" ]] || { echo 'ERROR: R2D5 files missing.' >&2; exit 1; }
if ! command -v docker >/dev/null 2>&1; then
  export PATH="$HOME/.docker/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
fi
command -v docker >/dev/null 2>&1 || { echo 'ERROR: Docker CLI missing.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'ERROR: Docker daemon is not ready.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo 'ERROR: Docker Compose missing.' >&2; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo 'ERROR: openssl is required for isolated credentials.' >&2; exit 1; }

TEMP="$(mktemp -d "${TMPDIR:-/tmp}/sdl-r2d5.XXXXXXXX")"
chmod 700 "$TEMP"
ENVFILE="$TEMP/isolated.env"
TEST_PASSWORD="$(openssl rand -hex 24)"
printf 'SDL_SECURITY_DB_PASSWORD=%s\n' "$TEST_PASSWORD" > "$ENVFILE"
unset TEST_PASSWORD
PROJECT="sdlr2d5_$(date +%Y%m%d%H%M%S)_$$"
PROJECT="${PROJECT//_/-}"
REPORT_DIR="$ROOT/0.sekerips/reports"
mkdir -p "$REPORT_DIR"
REPORT="$REPORT_DIR/sdl-r2d5-$(date +%Y%m%d-%H%M%S)-$$.log"
COMPOSE=(docker compose --env-file "$ENVFILE" -f "$ROOT/infra/compose.security-test.yaml" -p "$PROJECT")
cleanup(){
  "${COMPOSE[@]}" down --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$TEMP"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '============================================================\n SIERA DELTA LIMA | R2D5 SECURITY INTEGRATION TESTS\n============================================================\n'
printf 'SAFETY : Isolated ephemeral PostgreSQL; no host DB ports or existing SDL volumes.\n'
printf 'PROJECT: %s\n' "$PROJECT"
printf 'REPORT : %s\n' "$REPORT"
set +e
"${COMPOSE[@]}" run --build --rm -T test 2>&1 | tee "$REPORT"
rc=${PIPESTATUS[0]}
set -e
if [[ "$rc" -eq 0 ]]; then
 echo 'STATUS : SECURITY TEST SUITE PASS (scope described in docs/R2D5-SECURITY-TESTS.md)'
else
 echo "STATUS : SECURITY TEST SUITE FAILED (exit $rc). Review $REPORT; do not deploy changes." >&2
fi
exit "$rc"
