#!/usr/bin/env bash
# Membuat tarball rilis untuk server produksi (docs/DEPLOY-SERVER.md, Langkah 1).
#
# Dijalankan di LAPTOP (Git Bash), dari folder mana pun:
#   bash scripts/package-release.sh
#
# Hasil: release/sdl-release-<waktu>.tar.gz + .sha256 + MANIFEST.txt
#
# Yang SENGAJA tidak ikut: .env (secret), infra/certs (private key),
# node_modules (dibangun ulang oleh `npm ci` di image), golden cadangan,
# laporan lokal, dan sampah macOS. .env dan sertifikat di server dipakai ulang.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M)"
OUT_DIR="$ROOT/release"
NAME="sdl-release-$STAMP"
TARBALL="$OUT_DIR/$NAME.tar.gz"
mkdir -p "$OUT_DIR"
# Hanya satu rilis di release/, supaya glob di panduan tidak menangkap paket lama.
rm -f "$OUT_DIR"/sdl-release-*.tar.gz "$OUT_DIR"/sdl-release-*.tar.gz.sha256

# Sanity: berkas yang wajib ada agar build di server tidak gagal di tengah.
for f in infra/compose.dev.yaml infra/compose.proxy.yaml infra/compose.express.yaml \
         infra/compose.email-express.yaml infra/compose.db-local.yaml infra/Caddyfile \
         apps/backend/Dockerfile apps/backend-express/Dockerfile apps/frontend/Dockerfile \
         apps/backend-express/package-lock.json apps/frontend/package-lock.json \
         scripts/server-backup.sh scripts/server-check.sh docs/DEPLOY-SERVER.md; do
  [ -f "$f" ] || { echo "GAGAL: $f tidak ada" >&2; exit 1; }
done

# Skrip shell yang ber-CRLF akan gagal di Linux dengan pesan aneh ($'\r').
if grep -lI $'\r' scripts/*.sh infra/Caddyfile >/dev/null 2>&1; then
  echo "GAGAL: ada berkas ber-CRLF:" >&2
  grep -lI $'\r' scripts/*.sh infra/Caddyfile >&2
  exit 1
fi

LAST_MIG="$(ls apps/backend/internal/migrations/sql/*.sql | sort | tail -1 | xargs basename)"
MIG_COUNT="$(ls apps/backend/internal/migrations/sql/*.sql | wc -l | tr -d ' ')"

cat > "$OUT_DIR/MANIFEST.txt" <<EOF
SDL release $NAME
Dibuat     : $(date '+%Y-%m-%d %H:%M %z')
Migrasi    : $MIG_COUNT berkas, terakhir $LAST_MIG
Isi        : seluruh repo kecuali .env, infra/certs, infra/docker-config, node_modules, release/,
             golden cadangan, 0.sekerips/reports, __MACOSX, .DS_Store
EOF
cp "$OUT_DIR/MANIFEST.txt" "$ROOT/RELEASE-MANIFEST.txt"

# --exclude dipasang sebelum daftar sumber. Pola tanpa '/' cocok di level mana pun.
tar -czf "$TARBALL" \
  --exclude='./.env' \
  --exclude='./.env.*.local' \
  --exclude='./infra/certs' \
  --exclude='./infra/docker-config' \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='.git' \
  --exclude='.DS_Store' \
  --exclude='__MACOSX' \
  --exclude='*.log' \
  --exclude='./release' \
  --exclude='./sdl.tar.gz' \
  --exclude='./golden.backup-*' \
  --exclude='./0.sekerips/reports' \
  --exclude='./apps/backend;C' \
  .
rm -f "$ROOT/RELEASE-MANIFEST.txt"

# Pemeriksaan isi: tidak boleh ada secret yang lolos.
if tar -tzf "$TARBALL" | grep -E '(^|/)\.env$|infra/certs/|\.key$' >/dev/null; then
  echo "GAGAL: tarball memuat .env / sertifikat / kunci. Dihapus." >&2
  tar -tzf "$TARBALL" | grep -E '(^|/)\.env$|infra/certs/|\.key$' >&2
  rm -f "$TARBALL"; exit 1
fi

( cd "$OUT_DIR" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256" )

echo
echo "Selesai:"
echo "  $TARBALL  ($(du -h "$TARBALL" | cut -f1), $(tar -tzf "$TARBALL" | wc -l | tr -d ' ') entri)"
echo "  $TARBALL.sha256"
echo "  Migrasi terakhir di paket: $LAST_MIG"
echo
echo "Kirim ke server (ganti USER):"
echo "  scp \"$TARBALL\" \"$TARBALL.sha256\" USER@172.16.173.34:~/"
