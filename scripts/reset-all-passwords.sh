#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export LC_ALL=C
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

fail() { printf 'BREEE ADA YANG MASALAH: %s\n' "$*" >&2; exit 1; }
[[ "$(basename "$ROOT")" == '1.siera-delta-lima' ]] || fail 'Project root salah.'
[[ -s .env ]] || fail 'File .env tidak ditemukan.'
[[ -r /dev/tty && -w /dev/tty ]] || fail 'Wajib terminal interaktif; jangan jalankan via CI.'
command -v docker >/dev/null 2>&1 || fail 'Docker CLI tidak tersedia.'
docker info >/dev/null 2>&1 || fail 'Docker Desktop belum berjalan.'
docker compose version >/dev/null 2>&1 || fail 'Docker Compose v2 tidak tersedia.'
command -v shasum >/dev/null 2>&1 || fail 'shasum tidak tersedia.'
# Bound to the project's existing isolated development database. No production reset.
grep -qx 'SDL_DB_NAME=sdl_root_dev' .env || fail 'Hanya database development sdl_root_dev yang diizinkan.'
for f in apps/backend/cmd/reset-all-passwords/main.go apps/backend/Dockerfile.reset-all-passwords infra/compose.reset-all-passwords.yaml; do
  [[ -s "$f" ]] || fail "Utility belum terpasang: $f"
done
COMPOSE=(docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.reset-all-passwords.yaml)
"${COMPOSE[@]}" exec -T db sh -ec 'test "$POSTGRES_DB" = sdl_root_dev && pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 || fail 'Database SDL yang berjalan tidak siap / identitas DB salah.'

printf '\n============================================================\n'
printf ' SIERA DELTA LIMA | RESET PASSWORD SEMUA AKUN (LOCAL DEV)\n'
printf '============================================================\n'
printf 'AKSI    : Semua akun termasuk Superadmin dan akun inactive\n'
printf 'AMAN    : Role, grant, unit, data kerja, dan pengaturan OTP tetap\n'
printf 'SESI    : Seluruh sesi akan dicabut (logout paksa)\n'
printf 'LANJUT  : Ganti password wajib saat login pertama\n'
printf 'CATATAN : Superadmin tetap perlu email OTP/SMTP yang aktif\n'
printf 'DATABASE: sdl_root_dev (existing, bukan reset database)\n'

# Read-only roster inspection before requesting secrets.
COUNT="$("${COMPOSE[@]}" exec -T db sh -ec 'psql -X -A -t -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) FROM sdl_users"' | tr -d '\r\n[:space:]')" || fail 'Gagal membaca jumlah akun.'
[[ "$COUNT" =~ ^[1-9][0-9]*$ ]] || fail 'Jumlah akun tidak valid / kosong.'
[[ "$COUNT" -le 5000 ]] || fail 'Lebih dari 5000 akun: perlu review manual.'
printf 'Jumlah akun yang akan di-reset: %s\n' "$COUNT"
"${COMPOSE[@]}" exec -T db sh -ec 'psql -X -A -F " | " -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT username,CASE WHEN is_active THEN '\''ACTIVE'\'' ELSE '\''INACTIVE'\'' END FROM sdl_users ORDER BY username"' || fail 'Gagal membaca roster.'

printf '\nPERHATIAN: Password sementara sama untuk semua akun. Gunakan hanya pada development,\nkemudian wajib diganti dengan password berbeda untuk masing-masing akun.\n'
printf 'Ketik RESET-ALL-%s untuk konfirmasi: ' "$COUNT"
IFS= read -r CONFIRM </dev/tty || fail 'Konfirmasi tidak terbaca.'
[[ "$CONFIRM" == "RESET-ALL-$COUNT" ]] || { printf 'Dibatalkan; tidak ada perubahan database.\n'; exit 2; }
IFS= read -r -s -p 'Password sementara (14-256 byte; hidden): ' PASSWORD </dev/tty || fail 'Gagal membaca password.'
printf '\n'
IFS= read -r -s -p 'Ulangi password sementara (hidden): ' REPEAT </dev/tty || fail 'Gagal membaca konfirmasi password.'
printf '\n'
if [[ "$PASSWORD" != "$REPEAT" || ${#PASSWORD} -lt 14 || ${#PASSWORD} -gt 256 || "$PASSWORD" == *$'\r'* || "$PASSWORD" == *$'\n'* ]]; then
  unset PASSWORD REPEAT
  fail 'Password tidak cocok atau di luar panjang 14-256 byte.'
fi
unset REPEAT
printf 'Memproses reset atomik seluruh akun ... (password tidak ditampilkan)\n'
# Password is only on stdin, never in argv/env/files, and never echoed to the shell.
set +e
printf '%s\n%s\n' "$COUNT" "$PASSWORD" | "${COMPOSE[@]}" run --build --rm --no-deps -T reset-all-passwords -apply
RESULT=$?
set -e
unset PASSWORD CONFIRM COUNT
if [[ $RESULT -ne 0 ]]; then
  fail 'Reset gagal/ditolak; transaksi database akan rollback. Periksa output tanpa membagikan rahasia.'
fi
printf '============================================================\n'
printf ' OKE AMAN BRE BISA LANJUT\n'
printf ' Semua password sementara diganti. Login ulang, ubah password masing-masing.\n'
printf '============================================================\n'
