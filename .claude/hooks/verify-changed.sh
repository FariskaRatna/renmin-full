#!/usr/bin/env bash
# Stop hook: cek cepat sesuai area yang berubah sebelum Claude menyatakan selesai.
#  - apps/frontend        -> tsc --noEmit (kalau node_modules ada)
#  - apps/backend-express -> node --check tiap .js yang berubah (tanpa TS, ini jaring minimal)
#  - apps/backend         -> docker build image Go (go test ./... ikut jalan, sama seperti CI)
# Gagal -> exit 2, Claude diminta memperbaiki. Uji berat (suite keamanan, harness) ada di /verifikasi.
INPUT=$(cat)
ACTIVE=$(printf '%s' "$INPUT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(!!JSON.parse(d).stop_hook_active))}catch{process.stdout.write("false")}})' 2>/dev/null)
[ "$ACTIVE" = "true" ] && exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
CHANGED=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u )
[ -z "$CHANGED" ] && exit 0

FAIL=""
NOTE=""

if printf '%s\n' "$CHANGED" | grep -q '^apps/frontend/'; then
  if [ -e apps/frontend/node_modules/.bin/tsc ]; then
    if ! OUT=$(cd apps/frontend && ./node_modules/.bin/tsc --noEmit 2>&1); then
      FAIL+=$'\n== tsc frontend gagal ==\n'"$(printf '%s' "$OUT" | tail -n 40)"
    fi
  else
    NOTE+="tsc frontend dilewati (apps/frontend/node_modules belum ada). "
  fi
fi

for f in $(printf '%s\n' "$CHANGED" | grep -E '^apps/backend-express/.*\.js$'); do
  [ -f "$f" ] || continue
  if ! OUT=$(node --check "$f" 2>&1); then
    FAIL+=$'\n== sintaks JS gagal: '"$f"$' ==\n'"$(printf '%s' "$OUT" | tail -n 15)"
  fi
done

if printf '%s\n' "$CHANGED" | grep -qE '^apps/backend/.*\.(go|sql)$|^apps/backend/go\.(mod|sum)$'; then
  if docker info >/dev/null 2>&1; then
    if ! OUT=$(docker build -q -t sdl-ci-api apps/backend 2>&1); then
      FAIL+=$'\n== build/test backend Go gagal ==\n'"$(printf '%s' "$OUT" | tail -n 60)"
    fi
  else
    NOTE+="go test dilewati (Docker Desktop tidak berjalan). "
  fi
fi

if [ -n "$FAIL" ]; then
  echo "Pemeriksaan otomatis gagal. Perbaiki sebelum menyatakan selesai:$FAIL" >&2
  exit 2
fi
if [ -n "$NOTE" ]; then
  printf '{"systemMessage":"Catatan verifikasi: %s"}\n' "$NOTE"
fi
exit 0
