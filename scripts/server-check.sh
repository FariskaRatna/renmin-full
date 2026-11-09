#!/usr/bin/env bash
# Pemeriksaan server, HANYA MEMBACA (docs/DEPLOY-SERVER.md).
#
#   bash scripts/server-check.sh pre    # sebelum build: .env, sertifikat, Docker, migrasi tertunda
#   bash scripts/server-check.sh post   # sesudah up: container, Express, worker email, HTTPS
#
# Dijalankan dari folder instalasi di server. Keluaran: OK / PERINGATAN / GAGAL.
# Exit 1 kalau ada GAGAL. Tidak ada yang diubah, tidak ada nilai secret dicetak.
set -uo pipefail

MODE="${1:-pre}"
FAILS=0; WARNS=0
ok()   { printf '  \033[32mOK\033[0m          %s\n' "$*"; }
warn() { printf '  \033[33mPERINGATAN\033[0m  %s\n' "$*"; WARNS=$((WARNS+1)); }
fail() { printf '  \033[31mGAGAL\033[0m       %s\n' "$*"; FAILS=$((FAILS+1)); }
hdr()  { printf '\n== %s\n' "$*"; }

[ -f infra/compose.dev.yaml ] || { echo "Jalankan dari folder instalasi (berisi infra/)." >&2; exit 2; }
CF="--env-file .env -f infra/compose.dev.yaml -f infra/compose.proxy.yaml -f infra/compose.express.yaml"

# Membaca .env tanpa mengeksekusinya (nilai bisa berisi karakter shell).
envget() { [ -f .env ] && grep -E "^[[:space:]]*$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' -e 's/[[:space:]]*$//'; }

db_ctr() { docker ps --filter 'label=com.docker.compose.project=sdl-foundation-r1' \
                     --filter "label=com.docker.compose.service=$1" --format '{{.Names}}' 2>/dev/null | head -1; }

check_docker() {
  hdr "Docker"
  if docker info >/dev/null 2>&1; then ok "daemon hidup"; else fail "daemon Docker tidak bisa dihubungi"; return; fi
  local v; v="$(docker compose version --short 2>/dev/null | sed 's/^v//')"
  if [ -z "$v" ]; then fail "plugin 'docker compose' (v2) tidak ada"; else
    # additional_contexts (dipakai api-express untuk SQL migrasi) butuh Compose >= 2.17
    if [ "$(printf '%s\n2.17.0\n' "$v" | sort -V | head -1)" = "2.17.0" ]; then ok "docker compose $v"
    else fail "docker compose $v terlalu lama; api-express butuh >= 2.17 (additional_contexts)"; fi
  fi
  docker buildx version >/dev/null 2>&1 && ok "buildx tersedia" || fail "buildx tidak ada (dibutuhkan additional_contexts)"
  local free; free="$(df -Pk /var/lib/docker 2>/dev/null | awk 'NR==2{print int($4/1048576)}')"
  [ -z "$free" ] && free="$(df -Pk . | awk 'NR==2{print int($4/1048576)}')"
  if [ "${free:-0}" -ge 5 ]; then ok "ruang disk bebas ${free} GB"; else fail "ruang disk bebas ${free:-?} GB (< 5 GB; build Node butuh ruang)"; fi
}

check_env() {
  hdr ".env"
  [ -f .env ] || { fail ".env tidak ada — salin dari folder lama"; return; }
  local perm; perm="$(stat -c %a .env 2>/dev/null)"
  [ "$perm" = "600" ] && ok "mode 600" || warn ".env bermode $perm (sebaiknya: chmod 600 .env)"

  [ "$(envget SDL_DB_NAME)" = "sdl_root_dev" ] && ok "SDL_DB_NAME=sdl_root_dev" || fail "SDL_DB_NAME harus persis sdl_root_dev"
  for k in SDL_DB_USER SDL_DB_PASSWORD; do [ -n "$(envget $k)" ] && ok "$k terisi" || fail "$k kosong"; done

  local a e; a="$(envget SDL_AUTH_SECRET)"; e="$(envget SDL_EVIDENCE_KEY)"
  [[ "$a" =~ ^[0-9a-fA-F]{64}$ ]] && ok "SDL_AUTH_SECRET 64 hex" || fail "SDL_AUTH_SECRET bukan 64 hex"
  [[ "$e" =~ ^[0-9a-fA-F]{64}$ ]] && ok "SDL_EVIDENCE_KEY 64 hex" || fail "SDL_EVIDENCE_KEY bukan 64 hex"
  [ -n "$a" ] && [ "$a" = "$e" ] && fail "SDL_AUTH_SECRET dan SDL_EVIDENCE_KEY SAMA — harus berbeda"

  local origin host; origin="$(envget SDL_PUBLIC_ORIGIN)"; host="$(envget SDL_PUBLIC_HOST)"
  [ -n "$origin" ] && ok "SDL_PUBLIC_ORIGIN=$origin" || fail "SDL_PUBLIC_ORIGIN kosong"
  if [ -n "$host" ]; then ok "SDL_PUBLIC_HOST=$host"
  else fail "SDL_PUBLIC_HOST kosong — compose.proxy.yaml menolak jalan (isi: ${origin#https://})"; fi
  [ -n "$host" ] && [ "https://$host" != "$origin" ] && warn "SDL_PUBLIC_HOST ($host) tidak cocok dengan SDL_PUBLIC_ORIGIN ($origin)"

  local ao; ao="$(envget SDL_ALLOWED_ORIGINS)"
  if [ -z "$ao" ]; then fail "SDL_ALLOWED_ORIGINS kosong — semua mutation 403 (tampil sebagai 'CAPTCHA gagal')"
  elif printf '%s' ",$ao," | tr -d ' ' | grep -qF ",$origin,"; then ok "SDL_ALLOWED_ORIGINS memuat $origin"
  else fail "SDL_ALLOWED_ORIGINS ($ao) tidak memuat $origin"; fi

  local ah; ah="$(envget SDL_ALLOWED_HOSTS)"
  printf '%s' ",$ah," | tr -d ' ' | grep -qF ",${host:-${origin#https://}}," \
    && ok "SDL_ALLOWED_HOSTS memuat host publik" || fail "SDL_ALLOWED_HOSTS ($ah) tidak memuat host publik"

  [ "$(envget SDL_COOKIE_SECURE)" = "true" ] && ok "SDL_COOKIE_SECURE=true" || fail "SDL_COOKIE_SECURE harus true"
  local miss=""; for k in SDL_SMTP_HOST SDL_SMTP_PORT SDL_SMTP_USER SDL_SMTP_PASSWORD SDL_SMTP_FROM; do
    [ -n "$(envget $k)" ] || miss="$miss $k"; done
  [ -z "$miss" ] && ok "SMTP lima field terisi" || fail "SMTP kosong:$miss (Superadmin tidak bisa login tanpa OTP email)"

  # Bukan GAGAL: produksi per 2026-11-04 memang menyalakannya. Mematikannya
  # keputusan pemilik sistem (jalur demo Superadmin ke modul operasional).
  [ "$(envget SDL_DEV_SUPERADMIN_WORKSPACE)" = "true" ] && warn "SDL_DEV_SUPERADMIN_WORKSPACE=true — jalur demo Superadmin aktif; CLAUDE.md: harus mati di produksi (keputusan pemilik)"
  [ "$(envget SDL_EMAIL_WORKER_ENABLED)" = "true" ] && fail "SDL_EMAIL_WORKER_ENABLED=true di .env — worker email ganda. Hapus; pemindahan worker lewat compose.email-express.yaml"
  [ "$(envget SDL_EMAIL_NOTIFICATIONS_ENABLED)" = "false" ] && warn "SDL_EMAIL_NOTIFICATIONS_ENABLED=false di .env tidak mematikan Go (lihat compose.email-express.yaml); hapus barisnya"
  [ -n "$(envget SDL_API_UPSTREAM)" ] && warn "SDL_API_UPSTREAM terisi — Vite mengarah ke $(envget SDL_API_UPSTREAM); peralihan seharusnya lewat SDL_EXPRESS_PATHS"
  local ep; ep="$(envget SDL_EXPRESS_PATHS)"
  [ -z "$ep" ] && ok "SDL_EXPRESS_PATHS belum diisi (semua trafik ke Go)" || warn "SDL_EXPRESS_PATHS=$ep (prefix ini dilayani Express)"
}

check_certs() {
  hdr "Sertifikat TLS (infra/certs)"
  if [ -f infra/certs/sdl.crt ] && [ -f infra/certs/sdl.key ]; then ok "sdl.crt dan sdl.key ada"
  else fail "infra/certs/sdl.crt atau sdl.key tidak ada — salin dari folder lama"; return; fi
  command -v openssl >/dev/null || { warn "openssl tidak ada, isi sertifikat tidak diperiksa"; return; }
  local host; host="$(envget SDL_PUBLIC_HOST)"; host="${host:-$(envget SDL_PUBLIC_ORIGIN | sed 's#https://##')}"
  openssl x509 -in infra/certs/sdl.crt -noout -text 2>/dev/null | grep -q "IP Address:$host" \
    && ok "SAN memuat IP $host" || fail "sertifikat tidak memuat 'IP Address:$host' di SAN"
  openssl x509 -in infra/certs/sdl.crt -noout -checkend $((30*86400)) >/dev/null \
    && ok "berlaku > 30 hari ($(openssl x509 -in infra/certs/sdl.crt -noout -enddate | cut -d= -f2))" \
    || warn "sertifikat kedaluwarsa dalam 30 hari ($(openssl x509 -in infra/certs/sdl.crt -noout -enddate | cut -d= -f2))"
}

check_compose() {
  hdr "Konfigurasi compose"
  docker compose $CF config -q 2>/tmp/sdl-compose-err.$$ && ok "compose.dev + proxy + express valid" \
    || { fail "docker compose config gagal:"; sed 's/^/              /' /tmp/sdl-compose-err.$$; }
  rm -f /tmp/sdl-compose-err.$$
  case "$(basename "$(pwd)")" in
    1.siera-delta-lima) ok "nama folder 1.siera-delta-lima (skrip operasional asli bisa jalan)";;
    *) warn "nama folder $(basename "$(pwd)") — bootstrap/seed/reset asli menolak jalan di luar 1.siera-delta-lima";;
  esac
}

check_migrations() {
  hdr "Migrasi database"
  local db; db="$(db_ctr db)"
  [ -n "$db" ] || { warn "container db tidak berjalan; status migrasi tidak bisa dibaca"; return; }
  local applied; applied="$(docker exec "$db" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT filename FROM sdl_schema_migrations ORDER BY filename"' 2>/dev/null)"
  [ -n "$applied" ] || { fail "sdl_schema_migrations tidak terbaca"; return; }
  # Ledger menyimpan nama BERIKUT prefiks "sql/" (fs.Glob milik Go), mis.
  # "sql/033_x.sql"; berkas di disk tanpa prefiks. Disamakan sebelum dibanding.
  applied="$(printf '%s\n' "$applied" | sed 's#^sql/##')"
  ok "$(printf '%s\n' "$applied" | wc -l) migrasi sudah diterapkan, terakhir $(printf '%s\n' "$applied" | tail -1)"
  local pending=""
  for f in apps/backend/internal/migrations/sql/*.sql; do
    printf '%s\n' "$applied" | grep -qxF "$(basename "$f")" || pending="$pending $(basename "$f")"
  done
  if [ -z "$pending" ]; then ok "tidak ada migrasi tertunda"
  else warn "akan diterapkan oleh -migrate:$pending"; fi
  local extra=""
  for a in $applied; do [ -f "apps/backend/internal/migrations/sql/$a" ] || extra="$extra $a"; done
  [ -z "$extra" ] || fail "DB punya migrasi yang TIDAK ada di kode ini:$extra — kode lebih tua dari DB?"
}

check_post() {
  hdr "Container"
  for s in db api api-express frontend caddy; do
    local c st; c="$(db_ctr $s)"
    if [ -z "$c" ]; then fail "$s tidak berjalan"; continue; fi
    st="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$c")"
    case "$st" in "running healthy"|"running ") ok "$s: $st";; *) fail "$s: $st";; esac
  done

  hdr "Backend"
  local api ex; api="$(db_ctr api)"; ex="$(db_ctr api-express)"
  [ -n "$ex" ] && docker exec "$ex" node -e "fetch('http://127.0.0.1:8080/api/v1/system/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
    && ok "Express menjawab /api/v1/system/status" || fail "Express tidak menjawab /api/v1/system/status"
  if [ -n "$ex" ]; then
    local line; line="$(docker logs "$ex" 2>&1 | grep -i 'email notification worker' | tail -1)"
    case "$line" in
      *worker_owned_by_go_backend*) ok "worker email Express mati (milik Go) — benar sebelum Fase 3";;
      *"worker enabled"*) warn "worker email Express AKTIF — benar hanya setelah Fase 3; pastikan Go mati";;
      *) warn "log worker email Express: ${line:-tidak ditemukan}";;
    esac
  fi
  if [ -n "$api" ]; then
    local ge; ge="$(docker exec "$api" env 2>/dev/null | grep '^SDL_EMAIL_NOTIFICATIONS_ENABLED=' || true)"
    [ "$ge" = "SDL_EMAIL_NOTIFICATIONS_ENABLED=false" ] && warn "worker email Go MATI (Fase 3 sudah dijalankan?)" || ok "worker email Go aktif (pemilik outbox)"
  fi
  if [ -n "$ex" ]; then
    if docker logs --since 10m "$ex" 2>&1 | grep -qE '"level":"(ERROR|FATAL)"'; then
      warn "ada baris ERROR di log Express 10 menit terakhir: docker logs --since 10m $ex"
    else ok "log Express 10 menit terakhir bersih dari ERROR"; fi
  fi

  hdr "HTTPS lewat Caddy"
  local host; host="$(envget SDL_PUBLIC_HOST)"
  if command -v curl >/dev/null; then
    local code; code="$(curl -sk -o /dev/null -w '%{http_code}' "https://$host/api/v1/system/status")"
    [ "$code" = "200" ] && ok "https://$host/api/v1/system/status -> 200" || fail "https://$host/api/v1/system/status -> $code"
    code="$(curl -sk -o /dev/null -w '%{http_code}' "https://$host/")"
    [ "$code" = "200" ] && ok "https://$host/ -> 200 (frontend)" || fail "https://$host/ -> $code"
  else warn "curl tidak ada; uji https://$host dari browser"; fi
}

case "$MODE" in
  pre)  check_docker; check_env; check_certs; check_compose; check_migrations;;
  post) check_env; check_post; check_migrations;;
  *) echo "pakai: $0 pre|post" >&2; exit 2;;
esac

printf '\nRingkasan: %d GAGAL, %d PERINGATAN\n' "$FAILS" "$WARNS"
[ "$FAILS" -eq 0 ]
