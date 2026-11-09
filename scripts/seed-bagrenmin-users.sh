#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
if [[ "$(basename "$ROOT")" != '1.siera-delta-lima' || ! -s .env ]]; then
  echo 'REFUSED: run in 1.siera-delta-lima with existing .env' >&2; exit 1
fi
for cmd in docker; do command -v "$cmd" >/dev/null || { echo 'Docker unavailable' >&2; exit 1; }; done
docker info >/dev/null || { echo 'Docker daemon not running' >&2; exit 1; }
if ! grep -qx 'SDL_DB_NAME=sdl_root_dev' .env; then
  echo 'REFUSED: only sdl_root_dev database supported; no changes made.' >&2; exit 1
fi
if ! docker compose --env-file .env -f infra/compose.dev.yaml exec -T db sh -ec 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
  echo 'REFUSED: existing SDL database container must already be healthy.' >&2; exit 1
fi
cat <<'INFO'
============================================================
 SIERA DELTA LIMA | BAGRENMIN LOCAL ACCOUNT PROVISIONING
============================================================
 12 NEW ACCOUNTS + 1 EXISTING op-urmin (grant Urmin only)
 Role & grant scope: Own / Assigned / Unit; Kabagrenmin read across 4 units.
 OTP: OFF for 12 new accounts; existing op-urmin OTP preserved.
 Password: prompted privately; change required at first login.
 Email: @siera.invalid placeholders; cannot receive OTP emails.
 Safety: atomic transaction; refuses unexpected user/role/grant collisions.
 Existing Superadmin untouched; op-urmin only gets Urmin role/unit grant.
 Existing op-urmin email/password/OTP/profile unchanged.
============================================================
INFO
if [[ ! -r /dev/tty ]]; then echo 'REFUSED: interactive terminal required' >&2; exit 1; fi
IFS= read -r -p 'Superadmin username [sasdl]: ' admin_username </dev/tty || true
admin_username="${admin_username:-sasdl}"
if [[ ! "$admin_username" =~ ^[a-z][a-z0-9._-]{2,63}$ ]]; then echo 'Invalid Superadmin username' >&2; exit 1; fi
IFS= read -r -p 'Type CREATE-12-LINK-1 to create 12 and grant existing op-urmin: ' confirm </dev/tty
if [[ "$confirm" != CREATE-12-LINK-1 ]]; then echo 'Cancelled, database unchanged.';exit 1; fi
IFS= read -r -s -p 'Superadmin CURRENT password (hidden): ' sa_password </dev/tty; printf '\n'
IFS= read -r -s -p 'Initial password for 12 NEW users (hidden): ' initial </dev/tty; printf '\n'
IFS= read -r -s -p 'Confirm initial password (hidden): ' initial_confirm </dev/tty; printf '\n'
if [[ ${#initial} -lt 14 || ${#initial} -gt 256 || "$initial" != "$initial_confirm" || -z "$sa_password" ]]; then
 echo 'Password check failed; database unchanged.' >&2;unset sa_password initial initial_confirm;exit 1
fi
export SDL_SEED_SUPERADMIN_USERNAME="$admin_username"
# Secrets go through stdin only: NOT CLI arguments, environment variables or files.
# Bash history never contains the passwords; neither container nor stdout logs print them.
printf '%s\n%s\n%s\n' "$sa_password" "$initial" "$initial_confirm" | docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.seed-bagrenmin.yaml run --build --rm --no-deps -T seed-bagrenmin -apply
unset sa_password initial initial_confirm
