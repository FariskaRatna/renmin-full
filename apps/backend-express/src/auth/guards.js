import { allowMutation } from './csrf.js'
import { currentUser } from './session.js'
import { writeJson } from '../http/respond.js'

/**
 * Dua guard tingkat router, padanan AuthorizeOperational dan
 * AuthorizeRoleEditor (internal/auth/service.go:467 dan :487).
 *
 * Keduanya SENGAJA dipisah dan tidak boleh digabung jadi satu requireAuth
 * generik. Pemisahannya dua arah: Superadmin ditolak dari seluruh modul
 * operasional, dan non-Superadmin ditolak dari modul identitas.
 *
 * Satu syarat yang mudah terlewat dan sering salah didiagnosis sebagai
 * "RBAC rusak": NOT must_change_password. User yang belum merotasi password
 * sementara ditolak oleh KEDUA guard.
 *
 * Mengembalikan { userId, status } dengan status HTTP ala Go — 200 berarti lolos.
 */

export async function authorizeOperational(pool, req, config) {
  const userId = await currentUser(pool, req)
  if (!userId) return { status: 401 }
  if (req.method !== 'GET' && !allowMutation(req, config.allowedOrigins)) return { status: 403 }

  let eligible
  try {
    const { rows } = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM sdl_users u
          WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
            AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur
                            WHERE ur.user_id=u.id AND ur.role_key='superadmin')) AS ok`,
      [userId],
    )
    eligible = rows[0].ok
  } catch {
    return { status: 503 }
  }

  if (!eligible) {
    // Workspace demo lokal yang harus mati di produksi (devdemo.Superadmin).
    if (!config.demoSuperadminWorkspace) return { status: 403 }
    let demo
    try {
      const { rows } = await pool.query(
        `SELECT EXISTS(SELECT 1 FROM sdl_users u
            JOIN sdl_user_roles ur ON ur.user_id=u.id AND ur.role_key='superadmin'
           WHERE u.id=$1 AND u.is_active) AS ok`,
        [userId],
      )
      demo = rows[0].ok
    } catch {
      return { status: 503 }
    }
    if (!demo) return { status: 403 }
  }

  return { userId, status: 200 }
}

export async function authorizeRoleEditor(pool, req, config) {
  const userId = await currentUser(pool, req)
  if (!userId) return { status: 401 }
  if (req.method !== 'GET' && !allowMutation(req, config.allowedOrigins)) return { status: 403 }

  try {
    const { rows } = await pool.query(
      `SELECT (NOT u.must_change_password) AND EXISTS (
          SELECT 1 FROM sdl_user_roles ur
            JOIN sdl_roles ro ON ro.role_key=ur.role_key AND ro.is_active=TRUE
            JOIN sdl_role_permissions rp ON rp.role_key=ur.role_key
           WHERE ur.user_id=$1 AND ur.role_key='superadmin'
             AND rp.permission_key='identity.roles.manage'
        ) AS allowed
        FROM sdl_users u WHERE u.id=$1`,
      [userId],
    )
    if (!rows[0]?.allowed) return { status: 403 }
  } catch {
    return { status: 503 }
  }

  return { userId, status: 200 }
}

/**
 * Middleware Express untuk kedua guard, padanan rr.Use(...) di router.go.
 *
 * Identitas pemanggil disimpan di req.actor — padanan context.WithValue di Go.
 * Semua handler domain membacanya dari sana, tidak pernah dari body atau query.
 *
 * Respons penolakan seragam { "error": "access_denied" } dengan status dari
 * guard (401 / 403 / 503), persis seperti router.go:69.
 */
function guardMiddleware(authorize, pool, config) {
  return async (req, res, next) => {
    let result
    try {
      result = await authorize(pool, req, config)
    } catch {
      writeJson(res, 503, { error: 'access_denied' })
      return
    }
    if (result.status !== 200) {
      writeJson(res, result.status, { error: 'access_denied' })
      return
    }
    req.actor = result.userId
    next()
  }
}

export function requireOperational(pool, config) {
  return guardMiddleware(authorizeOperational, pool, config)
}

export function requireRoleEditor(pool, config) {
  return guardMiddleware(authorizeRoleEditor, pool, config)
}
