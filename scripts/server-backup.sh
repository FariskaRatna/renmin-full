#!/usr/bin/env bash
# Backup SEBELUM deploy (docs/DEPLOY-SERVER.md, Langkah 3). Dijalankan di SERVER
# dari folder instalasi yang SEDANG berjalan:
#   cd ~/1.siera-delta-lima && bash scripts/server-backup.sh
#
# Menghasilkan di ~/sdl-backup/<waktu>/ :
#   db.dump          pg_dump format custom (pulihkan dengan pg_restore)
#   folder.tar.gz    seluruh folder instalasi, TERMASUK .env dan infra/certs
#   SHA256SUMS
#
# Hanya membaca. Database tidak dikunci; pg_dump memakai snapshot konsisten.
# Berkas berisi secret -> mode 600, folder 700.
set -euo pipefail

INSTALL_DIR="$(pwd)"
[ -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/infra/compose.dev.yaml" ] || {
  echo "GAGAL: jalankan dari folder instalasi (yang berisi .env dan infra/)." >&2; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST="${SDL_BACKUP_DIR:-$HOME/sdl-backup}/$STAMP"
umask 077
mkdir -p "$DEST"

DB_CTR="$(docker ps --filter 'label=com.docker.compose.project=sdl-foundation-r1' \
                    --filter 'label=com.docker.compose.service=db' --format '{{.Names}}' | head -1)"
[ -n "$DB_CTR" ] || { echo "GAGAL: container database sdl-foundation-r1 tidak berjalan." >&2; exit 1; }

echo "1/3 pg_dump dari $DB_CTR ..."
docker exec "$DB_CTR" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DEST/db.dump"
TABLES="$(docker exec -i "$DB_CTR" sh -c 'pg_restore -l' < "$DEST/db.dump" | grep -c ' TABLE DATA ' || true)"
[ "${TABLES:-0}" -gt 0 ] || { echo "GAGAL: dump kosong / tidak terbaca." >&2; exit 1; }
echo "    ok: $(du -h "$DEST/db.dump" | cut -f1), $TABLES tabel berisi data"

echo "2/3 tar folder $INSTALL_DIR ..."
tar -czf "$DEST/folder.tar.gz" -C "$(dirname "$INSTALL_DIR")" \
  --exclude='node_modules' "$(basename "$INSTALL_DIR")"
echo "    ok: $(du -h "$DEST/folder.tar.gz" | cut -f1)"

echo "3/3 checksum + catatan migrasi ..."
docker exec "$DB_CTR" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT filename || chr(32) || applied_at FROM sdl_schema_migrations ORDER BY filename"' \
  > "$DEST/migrations-before.txt"
( cd "$DEST" && sha256sum db.dump folder.tar.gz migrations-before.txt > SHA256SUMS )
chmod 600 "$DEST"/*

echo
echo "Backup selesai: $DEST"
echo "  Migrasi terakhir di DB: $(tail -1 "$DEST/migrations-before.txt" | cut -d' ' -f1)"
echo
echo "Pulihkan DB (hanya kalau perlu rollback data):"
echo "  docker exec -i $DB_CTR sh -c 'pg_restore -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\" --clean --if-exists' < $DEST/db.dump"
