#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
if [[ "$(basename "$ROOT")" != "1.siera-delta-lima" ]]; then
  echo 'ERROR: run only from ~/Downloads/1.siera-delta-lima.' >&2; exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo 'ERROR: Docker CLI not available. Install/start Docker Desktop before proceeding.' >&2; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo 'ERROR: Docker daemon is not running. Open Docker Desktop and try again.' >&2; exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo 'ERROR: Docker Compose v2 is required.' >&2; exit 1
fi
if [[ ! -s .env ]]; then echo 'ERROR: root .env not found (no DB password will be regenerated automatically).' >&2; exit 1; fi
if ! grep -q 'golang.org/x/crypto v0.58.0' apps/backend/go.sum 2>/dev/null; then
  echo '[1/5] Resolving pinned Go dependencies (needs network)...'
  docker run --rm --user "$(id -u):$(id -g)" -e GOPATH=/tmp/gopath -e GOCACHE=/tmp/go-cache -e GOTOOLCHAIN=local     -v "$ROOT/apps/backend:/src" -w /src golang:1.27.2-alpine3.24 sh -ec 'go mod tidy; test -s go.sum'
else
  echo '[1/5] Go lockfile ready.'
fi
if [[ ! -f apps/frontend/package-lock.json ]]; then
  echo '[2/4] Generating npm dependency lock (one-time, needs network)...'
  docker run --rm --user "$(id -u):$(id -g)" -e npm_config_cache=/tmp/npm-cache -v "$ROOT/apps/frontend:/src"     -w /src node:24.22.0-alpine3.24 sh -ec 'npm install --package-lock-only --ignore-scripts --no-audit --no-fund; test -s package-lock.json'
else
  echo '[2/4] npm dependency lock already exists.'
fi
printf '[3/5] Building (Go unit tests and React TypeScript/Vite build)...\n'
docker compose --env-file .env -f infra/compose.dev.yaml build
printf '[4/5] Starting existing isolated PostgreSQL and applying all reviewed migrations through R5D (023) (previous migrations retained)...\n'
docker compose --env-file .env -f infra/compose.dev.yaml up -d --wait db
docker compose --env-file .env -f infra/compose.dev.yaml run --rm --no-deps api -migrate
printf '[5/5] Starting Go API and React frontend...\n'
docker compose --env-file .env -f infra/compose.dev.yaml up -d --wait
if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --max-time 8 http://127.0.0.1:5174/api/v1/system/status
  printf '\n'
fi
printf '\nSDL Urmin R5D workspace started at http://127.0.0.1:5174\n'
printf 'Existing PostgreSQL volume preserved; external databases untouched.\n'
