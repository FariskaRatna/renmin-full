#!/usr/bin/env bash
# R3E READ-ONLY configuration readiness for manual Browser E2E on the existing Mac.
set -Eeuo pipefail
umask 077
export TZ=Asia/Jakarta
ROOT="$(pwd -P)"
if [[ "$(basename "$ROOT")" != '1.siera-delta-lima' || ! -f .env || ! -f infra/compose.dev.yaml || ! -f sdl-run.sh ]]; then
  echo 'BREEE ADA YANG MASALAH: Jalankan dari ~/Downloads/1.siera-delta-lima, project lengkap + .env wajib ada.' >&2
  exit 1
fi
command -v docker >/dev/null || { echo 'BREEE ADA YANG MASALAH: Docker CLI tidak ditemukan.' >&2; exit 1; }
mkdir -p 0.sekerips/reports
REPORT="${ROOT}/0.sekerips/reports/sdl-r3e-readiness-$(date +%Y%m%d-%H%M%S)-$$.log"
printf '============================================================\n SIERA DELTA LIMA | R3E BROWSER E2E READINESS (READ-ONLY)\n============================================================\n'
printf 'Database : existing SDL (READ ONLY; no writes)\nReport   : %s\n' "$REPORT"
# Read-only transaction. No real letter subject, email, passwords, or secrets are printed.
# The output includes only account usernames, role keys, required access and aggregate counts.
if ! RESULT="$(docker compose --env-file .env -f infra/compose.dev.yaml exec -T db sh -c 'exec psql -X -q -v ON_ERROR_STOP=1 -P pager=off -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN READ ONLY;
SELECT CASE WHEN EXISTS (
 SELECT 1 FROM sdl_schema_migrations
 WHERE filename='sql/014_leadership_approval.sql'
) THEN 'PASS' ELSE 'BLOCKED: MIGRATION_014_NOT_APPLIED' END AS r3d3_migration;
WITH required(step, username, unit_key, role_key, permission_key) AS (
 VALUES
 ('01_register', 'op-urmin','urmin','br_op_urmin','urmin.surat_masuk.read'),
 ('01_register', 'op-urmin','urmin','br_op_urmin','urmin.surat_masuk.create'),
 ('01_register', 'op-urmin','urmin','br_op_urmin','urmin.surat_masuk.update'),
 ('01_distribute', 'op-urmin','urmin','br_op_urmin','urmin.surat_masuk.distribute'),
 ('02_receive', 'kasubbagren','subbagren','br_kasubbagren','urmin.distribusi.receive'),
 ('02_issue', 'kasubbagren','subbagren','br_kasubbagren','urmin.disposisi.issue'),
 ('02_review', 'kasubbagren','subbagren','br_kasubbagren','urmin.disposisi.review'),
 ('02_final_submit', 'kasubbagren','subbagren','br_kasubbagren','urmin.disposisi.final.submit'),
 ('03_execute', 'staf-subbagren','subbagren','br_staf_subbagren','urmin.disposisi.execute'),
 ('03_forward', 'staf-subbagren','subbagren','br_staf_subbagren','urmin.disposisi.forward'),
 ('03_review_child', 'staf-subbagren','subbagren','br_staf_subbagren','urmin.disposisi.review'),
 ('04_execute_child', 'op-subbagren','subbagren','br_op_subbagren','urmin.disposisi.execute'),
 ('05_lead_monitor', 'kabagrenmin','subbagren','br_kabagrenmin','urmin.disposisi.final.monitor'),
 ('05_lead_approve', 'kabagrenmin','subbagren','br_kabagrenmin','urmin.disposisi.final.approve')
), verified AS (
 SELECT req.*, u.id, u.is_active, u.must_change_password,
 EXISTS(SELECT 1 FROM sdl_access_grants g
 JOIN sdl_roles role ON role.role_key=g.role_key AND role.is_active
 JOIN sdl_org_units unit ON unit.unit_key=g.unit_key AND unit.is_active
 WHERE g.user_id=u.id AND g.role_key=req.role_key AND g.unit_key=req.unit_key
 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())) AS grant_ok,
 EXISTS(SELECT 1 FROM sdl_role_permissions rp WHERE rp.role_key=req.role_key AND rp.permission_key=req.permission_key) AS permission_ok
 FROM required req LEFT JOIN sdl_users u ON lower(u.username)=req.username
), findings AS (
 SELECT step,username,unit_key,role_key,permission_key,
 CASE WHEN id IS NULL THEN 'BLOCKED:USER_MISSING'
 WHEN NOT is_active THEN 'BLOCKED:USER_DISABLED'
 WHEN must_change_password THEN 'BLOCKED:CHANGE_PASSWORD_FIRST'
 WHEN NOT grant_ok THEN 'BLOCKED:GRANT_MISSING_OR_EXPIRED'
 WHEN NOT permission_ok THEN 'BLOCKED:PERMISSION_OFF'
 ELSE 'READY' END AS result
 FROM verified
)
SELECT step, username, unit_key, permission_key, result FROM findings ORDER BY step,username,permission_key;
SELECT
 (SELECT COUNT(*) FROM sdl_urmin_disposition_tasks WHERE parent_task_id IS NULL) AS root_dispositions,
 (SELECT COUNT(*) FROM sdl_urmin_disposition_tasks WHERE parent_task_id IS NOT NULL) AS child_dispositions,
 (SELECT COUNT(*) FROM sdl_urmin_final_approvals WHERE status='pending') AS final_pending,
 (SELECT COUNT(*) FROM sdl_urmin_final_approvals WHERE status='approved') AS final_approved;
COMMIT;
SQL
)"; then
  echo 'BREEE ADA YANG MASALAH: Pemeriksaan SQL gagal. Tidak ada perubahan data.' >&2
  exit 1
fi
printf '%s\n' "$RESULT" | tee "$REPORT"
if printf '%s\n' "$RESULT" | grep -q 'BLOCKED:'; then
  printf '\nBREEE ADA YANG MASALAH: Ada konfigurasi belum siap. Lihat kolom BLOCKED. Jangan mulai Browser E2E dulu.\n'
  printf 'Ubah permission lewat Superadmin Role Editor, atau lakukan first-login password change (tidak ada auto-grant).\n'
  exit 2
fi
printf '\nOKE AMAN BRE BISA LANJUT\nREADINESS: Akun/grant/permission dasar siap untuk BROWSER E2E MANUAL. Belum berarti E2E PASS.\n'
