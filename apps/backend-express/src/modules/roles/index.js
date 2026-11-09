import { Router } from 'express'

import { isUniqueViolation, withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { problem, writeJson } from '../../http/respond.js'

/**
 * Editor role dan permission, port dari apps/backend/internal/roles/service.go.
 * Dipasang di bawah /api/v1/admin, jadi seluruhnya sudah dilindungi
 * AuthorizeRoleEditor (Superadmin + identity.roles.manage).
 */

const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,63}$/
const PERMISSION_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,99}$/

/**
 * Kemampuan ini tidak bisa didelegasikan dari editor dan tidak bisa dicabut
 * dari definisi Superadmin yang bersifat tetap.
 */
const SEALED_PERMISSION = 'identity.roles.manage'

const PAYLOAD_FIELDS = ['reason', 'key', 'name', 'description', 'active', 'version', 'permissions']

/**
 * Padanan validate(). Mengembalikan { code } saat gagal, atau { keys } saat
 * lolos — keys sudah terurut, sama seperti slices.Sort di Go.
 */
function validatePayload(payload, { creating }) {
  const key = typeof payload.key === 'string' ? payload.key : ''
  const name = typeof payload.name === 'string' ? payload.name : ''
  const description = typeof payload.description === 'string' ? payload.description : ''
  const reason = typeof payload.reason === 'string' ? payload.reason : ''
  const permissions = Array.isArray(payload.permissions) ? payload.permissions : []
  const version = Number.isInteger(payload.version) ? payload.version : 0

  if (creating && !ROLE_KEY_PATTERN.test(key)) return { code: 'invalid_role_key' }

  if (
    name.trim().length < 3 ||
    [...name].length > 120 ||
    [...description].length > 500 ||
    reason.trim().length < 8 ||
    [...reason].length > 500
  ) {
    return { code: 'invalid_metadata' }
  }

  if (permissions.length > 200) return { code: 'too_many_permissions' }

  const keys = [...permissions].sort()
  for (let i = 0; i < keys.length; i++) {
    const current = keys[i]
    if (typeof current !== 'string' || !PERMISSION_KEY_PATTERN.test(current) || current === SEALED_PERMISSION) {
      return { code: 'reserved_or_invalid_permission' }
    }
    if (i > 0 && current === keys[i - 1]) return { code: 'duplicate_permission' }
  }

  if (!creating && version < 1) return { code: 'missing_version' }

  return { keys, name: name.trim(), description: description.trim(), reason: reason.trim(), version, active: payload.active === true }
}

/** Menolak permission yang tidak terdaftar di sdl_permissions. */
async function assertKnownPermissions(client, permissions) {
  if (permissions.length === 0) return
  const { rows } = await client.query(
    'SELECT count(*)::int AS n FROM sdl_permissions WHERE permission_key=ANY($1::text[])',
    [permissions],
  )
  if (rows[0].n !== permissions.length) throw new UnknownPermissionError()
}

class UnknownPermissionError extends Error {}

async function insertPermissions(client, roleKey, permissions) {
  for (const permission of permissions) {
    await client.query('INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES($1,$2)', [
      roleKey,
      permission,
    ])
  }
}

async function writeAudit(client, actor, event, roleKey, metadata) {
  await client.query(
    `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
     VALUES($1,$2,'role',$3,$4::jsonb)`,
    [actor, event, roleKey, JSON.stringify(metadata)],
  )
}

export function createRolesRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.ROLES)

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      next(error)
    }
  }

  // ---- GET /permissions ----
  router.get('/permissions', handle(async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT permission_key,description FROM sdl_permissions ORDER BY permission_key',
      )
      writeJson(res, 200, {
        permissions: rows.map((row) => ({ key: row.permission_key, description: row.description })),
      })
    } catch {
      problem(res, 503, 'unavailable')
    }
  }))

  // ---- GET /roles ----
  router.get('/roles', handle(async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT ro.role_key,ro.display_name,ro.description,ro.is_system,ro.is_active,ro.version,
                COALESCE(array_agg(rp.permission_key::text ORDER BY rp.permission_key)
                         FILTER (WHERE rp.permission_key IS NOT NULL),'{}'::text[]) AS permissions
           FROM sdl_roles ro
           LEFT JOIN sdl_role_permissions rp ON rp.role_key=ro.role_key
          GROUP BY ro.role_key ORDER BY ro.is_system DESC,ro.role_key`,
      )
      writeJson(res, 200, {
        roles: rows.map((row) => ({
          key: row.role_key,
          name: row.display_name,
          description: row.description,
          system: row.is_system,
          active: row.is_active,
          version: Number(row.version),
          permissions: row.permissions,
        })),
      })
    } catch {
      problem(res, 503, 'unavailable')
    }
  }))

  // ---- POST /roles ----
  router.post('/roles', json, handle(async (req, res) => {
    const payload = parsePayload(req, PAYLOAD_FIELDS)
    if (!payload.ok) {
      problem(res, 400, 'invalid_request')
      return
    }
    const validated = validatePayload(payload.value, { creating: true })
    if (validated.code) {
      problem(res, 400, validated.code)
      return
    }
    const actor = req.actor
    if (!actor) {
      problem(res, 401, 'unauthenticated')
      return
    }

    const roleKey = payload.value.key
    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        try {
          await assertKnownPermissions(client, validated.keys)
        } catch (error) {
          if (error instanceof UnknownPermissionError) return 'unknown_permission'
          throw error
        }

        try {
          await client.query(
            `INSERT INTO sdl_roles(role_key,display_name,description,is_active,updated_by)
             VALUES($1,$2,$3,$4,$5)`,
            [roleKey, validated.name, validated.description, validated.active, actor],
          )
        } catch (error) {
          if (isUniqueViolation(error)) return 'role_exists'
          throw error
        }

        await insertPermissions(client, roleKey, validated.keys)
        await writeAudit(client, actor, 'identity.role_created', roleKey, {
          name: payload.value.name,
          permissions: validated.keys,
          active: validated.active,
          reason: validated.reason,
        })
        return 'ok'
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    if (outcome === 'unknown_permission') {
      problem(res, 400, 'unknown_permission')
      return
    }
    if (outcome === 'role_exists') {
      problem(res, 409, 'role_exists')
      return
    }
    writeJson(res, 201, { key: roleKey, version: 1 })
  }))

  // ---- PUT /roles/:roleKey ----
  router.put('/roles/:roleKey', json, handle(async (req, res) => {
    const key = req.params.roleKey
    if (!ROLE_KEY_PATTERN.test(key)) {
      problem(res, 400, 'invalid_role_key')
      return
    }
    // Definisi Superadmin bersifat tetap dan tidak bisa diedit dari sini.
    if (key === 'superadmin') {
      problem(res, 403, 'protected_system_role')
      return
    }

    const payload = parsePayload(req, PAYLOAD_FIELDS)
    if (!payload.ok) {
      problem(res, 400, 'invalid_request')
      return
    }
    const validated = validatePayload(payload.value, { creating: false })
    if (validated.code) {
      problem(res, 400, validated.code)
      return
    }
    if (payload.value.key && payload.value.key !== key) {
      problem(res, 400, 'immutable_role_key')
      return
    }
    const actor = req.actor
    if (!actor) {
      problem(res, 401, 'unauthenticated')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const existing = await client.query('SELECT version FROM sdl_roles WHERE role_key=$1 FOR UPDATE', [key])
        if (existing.rows.length === 0) return { kind: 'role_missing' }

        const version = Number(existing.rows[0].version)
        // Optimistic locking: versi di payload harus sama dengan yang tersimpan.
        if (version !== validated.version) return { kind: 'role_changed_reload' }

        try {
          await assertKnownPermissions(client, validated.keys)
        } catch (error) {
          if (error instanceof UnknownPermissionError) return { kind: 'unknown_permission' }
          throw error
        }

        const before = await client.query(
          `SELECT COALESCE(array_agg(permission_key::text ORDER BY permission_key),'{}'::text[]) AS permissions
             FROM sdl_role_permissions WHERE role_key=$1`,
          [key],
        )

        await client.query(
          `UPDATE sdl_roles SET display_name=$2,description=$3,is_active=$4,
                  version=version+1,updated_at=NOW(),updated_by=$5
            WHERE role_key=$1`,
          [key, validated.name, validated.description, validated.active, actor],
        )
        await client.query('DELETE FROM sdl_role_permissions WHERE role_key=$1', [key])
        await insertPermissions(client, key, validated.keys)
        await writeAudit(client, actor, 'identity.role_updated', key, {
          versionBefore: version,
          permissionsBefore: before.rows[0].permissions,
          permissionsAfter: validated.keys,
          active: validated.active,
          reason: validated.reason,
        })

        // Kebijakan role dievaluasi ulang dari database di setiap request, tapi
        // sesi yang sudah berjalan tetap dicabut supaya perubahan permission
        // langsung berlaku. Superadmin yang sedang bertindak dikecualikan agar
        // ia tidak mengunci dirinya sendiri di tengah pekerjaan.
        await client.query(
          `UPDATE sdl_sessions SET revoked_at=NOW() WHERE revoked_at IS NULL
             AND user_id IN (SELECT user_id FROM sdl_user_roles WHERE role_key=$1
                             UNION
                             SELECT user_id FROM sdl_access_grants WHERE role_key=$1 AND revoked_at IS NULL)
             AND user_id<>$2`,
          [key, actor],
        )

        return { kind: 'ok', version: version + 1 }
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    if (outcome.kind === 'role_missing') {
      problem(res, 404, 'role_missing')
      return
    }
    if (outcome.kind === 'role_changed_reload') {
      problem(res, 409, 'role_changed_reload')
      return
    }
    if (outcome.kind === 'unknown_permission') {
      problem(res, 400, 'unknown_permission')
      return
    }
    writeJson(res, 200, { key, version: outcome.version })
  }))

  return router
}
