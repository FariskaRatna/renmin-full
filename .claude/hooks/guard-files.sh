#!/usr/bin/env bash
# PreToolUse untuk Edit/Write/MultiEdit.
#  - BLOKIR  : migrasi SQL yang sudah di-commit, .env, sertifikat/kunci, golden file harness.
#  - TANYA   : zona berisiko (kripto, otorisasi, proxy/infra, deploy, workflow CI).
# Exit 2 = diblokir, pesannya dikirim ke Claude. JSON "ask" = minta konfirmasi manusia.
INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).tool_input?.file_path||"")}catch{}})' 2>/dev/null)
[ -z "$FILE" ] && exit 0

# Normalisasi path Windows -> slash, supaya pola di bawah berlaku di Git Bash maupun Linux.
P="/${FILE//\\//}"
ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"

block() { echo "DIBLOKIR: $1" >&2; exit 2; }
ask() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"%s"}}\n' "$1"
  exit 0
}

case "$P" in
  */.env.example) ;;
  */.env|*/.env.*) block "file .env berisi secret produksi; tidak boleh disentuh Claude." ;;
  */infra/certs/*|*.pem|*.key|*.p12) block "sertifikat/kunci privat tidak boleh disentuh Claude." ;;
  */apps/backend-express/harness/golden/*)
    block "golden file hanya boleh direkam ulang lewat harness capture oleh manusia (lihat MIGRATION-PLAN.md)." ;;
  */apps/backend/internal/migrations/sql/*.sql)
    if git -C "$ROOT" ls-files --error-unmatch "$FILE" >/dev/null 2>&1; then
      block "file migrasi ini sudah di-commit. Runner menolak checksum yang berubah. Buat file migrasi BARU dengan nomor berikutnya dan perbarui manifes di migrate_test.go."
    fi ;;
esac

case "$P" in
  */apps/backend/internal/auth/*|*/apps/backend-express/src/auth/*|*/apps/backend-express/src/crypto/*|*evidence_crypto*)
    ask "Zona kripto/auth (argon2, HMAC, sesi, CSRF, OTP, AES-GCM evidence). Kesalahan di sini bisa mengunci semua user atau membuat evidence lama tak terbaca. Setujui perubahan ini?" ;;
  */apps/backend/internal/access/*|*/apps/backend-express/src/access/*|*/unitwork/*)
    ask "Engine otorisasi (A atau B). Penyaringan harus tetap di level SQL. Setujui perubahan ini?" ;;
  */apps/frontend/vite.config.ts|*/infra/Caddyfile|*/infra/compose*.yaml|*/scripts/deploy.sh|*/.github/workflows/*)
    ask "File ini memengaruhi produksi/deploy (proxy Vite & Caddy ikut jalur produksi). Setujui perubahan ini?" ;;
esac
exit 0
