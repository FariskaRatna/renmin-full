#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"
if [[ "$(basename "$ROOT")" != "1.siera-delta-lima" ]]; then echo 'ERROR: unexpected project root' >&2; exit 1; fi
if ! command -v docker >/dev/null; then echo 'ERROR: Docker CLI not found' >&2; exit 1; fi
if ! docker info >/dev/null 2>&1; then echo 'ERROR: Docker not running' >&2; exit 1; fi
if [[ ! -s .env ]]; then echo 'ERROR: project .env missing' >&2; exit 1; fi
printf 'SIERA DELTA LIMA | One-time Superadmin bootstrap\n'
printf 'Only permitted when user table is empty. No default password.\n\n'
IFS= read -r -p 'Username (lowercase, min 3 chars): ' username
IFS= read -r -p 'Email for OTP: ' email
IFS= read -r -p 'Display name: ' display_name
IFS= read -r -s -p 'Password (14-256 characters): ' password
printf '\n'
IFS= read -r -s -p 'Repeat password: ' confirmation
printf '\n'
if [[ "$password" != "$confirmation" ]]; then echo 'ERROR: passwords do not match' >&2; exit 1; fi
if [[ -z "$username" || -z "$email" || -z "$display_name" || ${#password} -lt 14 ]]; then echo 'ERROR: invalid input' >&2; exit 1; fi
if [[ "$username" == *$'\n'* || "$email" == *$'\n'* || "$display_name" == *$'\n'* || "$password" == *$'\n'* ]]; then echo 'ERROR: multiline input prohibited' >&2;exit 1; fi
printf '%s\n%s\n%s\n%s\n' "$username" "$email" "$display_name" "$password" | docker compose --env-file .env -f infra/compose.dev.yaml run --rm -T --no-deps api -bootstrap-superadmin
unset password confirmation username email display_name
