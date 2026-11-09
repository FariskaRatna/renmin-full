import { isDemoSuperadmin } from '../../access/devdemo.js'

/**
 * ENGINE B — otorisasi berbasis scope grant langsung.
 * Port dari fungsi permit() di apps/backend/internal/unitwork/work.go:78.
 *
 * Berbeda mendasar dari Engine A (src/access/policy.js): engine ini TIDAK
 * memakai permission_key sama sekali. Ia membaca sdl_access_grants lalu
 * mencocokkan `scope` langsung dengan kata kerja aksi.
 *
 * Dipakai oleh: unit-work, dan registry subbagsumda / subbagbinfung / urmin.
 *
 * JANGAN disatukan dengan Engine A. Keduanya memutuskan dengan cara berbeda,
 * dan menggabungkannya mengubah hak akses secara senyap.
 */

const ALLOWED_UNITS = new Set(['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung'])
const VALID_CLASSIFICATIONS = new Set(['biasa', 'penting'])

export function isAllowedUnit(unit) {
  return ALLOWED_UNITS.has(unit)
}

/**
 * Query grant yang berlaku. Syaratnya berlapis dan semuanya penting:
 * role aktif, user terdaftar di unit itu, akun aktif, sudah merotasi password,
 * grant belum dicabut dan belum kedaluwarsa, DAN bukan Superadmin.
 */
const GRANT_QUERY = `
  SELECT g.scope,g.classification_limit
    FROM sdl_access_grants g
    JOIN sdl_roles r ON r.role_key=g.role_key AND r.is_active
    JOIN sdl_user_units uu ON uu.user_id=g.user_id AND uu.unit_key=g.unit_key
    JOIN sdl_users u ON u.id=g.user_id AND u.is_active AND NOT u.must_change_password
   WHERE g.user_id::text=$1 AND g.unit_key=$2 AND g.revoked_at IS NULL
     AND (g.expires_at IS NULL OR g.expires_at>now())
     AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur
                     WHERE ur.user_id=u.id AND ur.role_key='superadmin')`

const TASK_ASSIGNED_ANY = `
  SELECT EXISTS(SELECT 1 FROM sdl_unit_work_tasks
                 WHERE record_id::text=$1 AND to_user::text=$2 AND status<>'cancelled') AS ok`

const TASK_ASSIGNED_OPEN = `
  SELECT EXISTS(SELECT 1 FROM sdl_unit_work_tasks
                 WHERE record_id::text=$1 AND to_user::text=$2
                   AND status IN ('pending','received')) AS ok`

/**
 * @param {string} action  create | read | edit | delete | assign | upload
 * @returns {Promise<boolean>}
 * @throws kalau database gagal — pemanggil memetakannya ke 503
 *         authorization_unavailable, bukan allow.
 */
export async function permit(pool, actorId, { unit, classification, owner, recordId, action }) {
  // Superadmin ditolak dari seluruh modul operasional, TERMASUK di workspace
  // demo lokal (R5F20B). Pemeriksaannya hanya berlaku untuk unit dan
  // klasifikasi yang sah, persis seperti di Go.
  if (ALLOWED_UNITS.has(unit) && VALID_CLASSIFICATIONS.has(classification)) {
    if (await isDemoSuperadmin(pool, actorId)) return false
  }

  const { rows } = await pool.query(GRANT_QUERY, [actorId, unit])

  for (const row of rows) {
    const { scope, classification_limit: limit } = row

    // Dokumen "penting" hanya terbuka untuk grant yang batasnya juga "penting".
    if (classification === 'penting' && limit !== 'penting') continue

    const ownedByActor = scope === 'own' && owner === actorId

    switch (action) {
      case 'create':
        if (scope === 'own' || scope === 'unit') return true
        break

      case 'read':
        if (scope === 'unit' || ownedByActor) return true
        // Scope 'assigned' (dan 'own') juga bisa membaca lewat penugasan.
        if ((scope === 'assigned' || scope === 'own') && recordId) {
          const task = await pool.query(TASK_ASSIGNED_ANY, [recordId, actorId])
          if (task.rows[0].ok) return true
        }
        break

      case 'edit':
      case 'delete':
      case 'assign':
        if (scope === 'unit' || ownedByActor) return true
        break

      case 'upload':
        if (scope === 'unit' || ownedByActor) return true
        // Untuk unggah, penugasannya harus masih terbuka — pending atau
        // received. Tugas yang sudah selesai tidak lagi memberi hak unggah.
        if ((scope === 'assigned' || scope === 'own') && recordId) {
          const task = await pool.query(TASK_ASSIGNED_OPEN, [recordId, actorId])
          if (task.rows[0].ok) return true
        }
        break

      default:
        break
    }
  }

  return false
}
