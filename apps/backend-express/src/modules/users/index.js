import { Router } from 'express'
import { createHash, randomBytes } from 'node:crypto'

import { hashPassword, verifyPassword } from '../../crypto/password.js'
import { isUniqueViolation, withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { problem, writeJson } from '../../http/respond.js'

/**
 * Administrasi identitas, port dari apps/backend/internal/users/
 * (service.go + otp.go). Dipasang di bawah /api/v1/admin.
 *
 * Tiga aturan yang berulang di hampir setiap handler dan tidak boleh hilang:
 *
 *   1. Akun ber-role superadmin DILINDUNGI — tidak bisa diubah dari sini
 *      (403 protected_user).
 *   2. Admin tidak bisa mengubah akunnya sendiri (403 self_change_denied).
 *   3. Optimistic locking lewat kolom version; selisih versi menghasilkan
 *      409 user_changed_reload.
 */

const USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,63}$/
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_.-]{2,63}$/
const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

const VALID_SCOPES = new Set(['own', 'assigned', 'unit'])
const VALID_CLASSIFICATIONS = new Set(['biasa', 'penting'])
const MAX_GRANTS = 30

function validReason(reason) {
  if (typeof reason !== 'string') return false
  const trimmed = [...reason.trim()].length
  return trimmed >= 8 && [...reason].length <= 500
}

function validEmail(email) {
  if (typeof email !== 'string' || email.length < 6 || email.length > 254) return false
  if (email !== email.toLowerCase().trim()) return false
  return EMAIL_PATTERN.test(email)
}

function validDisplayName(name) {
  if (typeof name !== 'string') return false
  return [...name.trim()].length >= 3 && [...name].length <= 160
}

async function audit(client, actor, event, subject, metadata) {
  await client.query(
    `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
     VALUES($1,$2,'user',$3,$4::jsonb)`,
    [actor, event, subject, JSON.stringify(metadata)],
  )
}

/** Padanan validateGrants (service.go:317). */
function validateGrants(grants) {
  if (!Array.isArray(grants) || grants.length > MAX_GRANTS) return false
  const seen = new Set()
  const cutoff = Date.now() + 60_000 // harus kedaluwarsa lebih dari semenit lagi

  for (const grant of grants) {
    if (!grant || typeof grant !== 'object') return false
    if (!ROLE_KEY_PATTERN.test(grant.roleKey ?? '')) return false
    if (!USERNAME_PATTERN.test(grant.unitKey ?? '')) return false
    if (grant.roleKey === 'superadmin') return false
    if (!VALID_SCOPES.has(grant.scope)) return false
    if (!VALID_CLASSIFICATIONS.has(grant.classificationLimit)) return false
    if (grant.expiresAt != null && new Date(grant.expiresAt).getTime() <= cutoff) return false

    const key = `${grant.unitKey}:${grant.roleKey}`
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

export function createUsersRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.USERS)

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      next(error)
    }
  }

  // ---- GET /users ----
  router.get('/users', handle(async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id::text AS id,u.username,u.email,u.display_name,u.is_active,
                u.must_change_password,u.version,u.otp_enabled,
                EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin') AS protected,
                COALESCE((SELECT unit_key FROM sdl_user_units WHERE user_id=u.id AND is_primary LIMIT 1),'') AS primary_unit
           FROM sdl_users u ORDER BY u.created_at DESC LIMIT 500`,
      )

      // Grant TIDAK PERNAH direpresentasikan sebagai role global. Yang
      // dikembalikan adalah tuple role-unit-scope yang masih aktif.
      const users = []
      for (const row of rows) {
        const grants = await pool.query(
          `SELECT g.role_key,g.unit_key,g.scope,g.classification_limit,g.expires_at
             FROM sdl_access_grants g
             JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active=TRUE
             JOIN sdl_org_units un ON un.unit_key=g.unit_key AND un.is_active=TRUE
            WHERE g.user_id=$1 AND g.revoked_at IS NULL
              AND (g.expires_at IS NULL OR g.expires_at>NOW())
            ORDER BY g.unit_key,g.role_key`,
          [row.id],
        )
        users.push({
          id: row.id,
          username: row.username,
          email: row.email,
          displayName: row.display_name,
          active: row.is_active,
          forcePasswordChange: row.must_change_password,
          version: Number(row.version),
          protected: row.protected,
          otpEnabled: row.otp_enabled,
          primaryUnit: row.primary_unit,
          grants: grants.rows.map((g) => ({
            roleKey: g.role_key,
            unitKey: g.unit_key,
            scope: g.scope,
            classificationLimit: g.classification_limit,
            expiresAt: g.expires_at,
          })),
        })
      }
      writeJson(res, 200, { users })
    } catch {
      problem(res, 503, 'unavailable')
    }
  }))

  // ---- GET /units ----
  router.get('/units', handle(async (req, res) => {
    try {
      const { rows } = await pool.query(
        'SELECT unit_key,display_name,is_active FROM sdl_org_units ORDER BY unit_key',
      )
      writeJson(res, 200, {
        units: rows.map((row) => ({ key: row.unit_key, name: row.display_name, active: row.is_active })),
      })
    } catch {
      problem(res, 503, 'unavailable')
    }
  }))

  // ---- GET /audit ----
  router.get('/audit', handle(async (req, res) => {
    try {
      // Hanya router admin terlindungi ini yang mengekspos pratinjau audit.
      const { rows } = await pool.query(
        `SELECT ev.id,ev.event_key,COALESCE(ev.subject_type,'') AS subject_type,
                COALESCE(ev.subject_id,'') AS subject_id,ev.created_at,
                COALESCE(au.username,'system') AS actor,
                LEFT(COALESCE(ev.metadata->>'reason',''),500) AS reason
           FROM sdl_audit_events ev
           LEFT JOIN sdl_users au ON au.id=ev.actor_id
          ORDER BY ev.id DESC LIMIT 100`,
      )
      writeJson(res, 200, {
        events: rows.map((row) => ({
          id: Number(row.id),
          key: row.event_key,
          type: row.subject_type,
          subject: row.subject_id,
          at: row.created_at,
          actor: row.actor,
          reason: row.reason,
        })),
      })
    } catch {
      problem(res, 503, 'unavailable')
    }
  }))

  // ---- POST /users ----
  router.post('/users', json, handle(async (req, res) => {
    const payload = parsePayload(req, ['username', 'email', 'displayName', 'reason'])
    if (!payload.ok) {
      problem(res, 400, 'invalid_request')
      return
    }

    const username = String(payload.value.username ?? '').trim().toLowerCase()
    const email = String(payload.value.email ?? '').trim().toLowerCase()
    const displayName = String(payload.value.displayName ?? '').trim()
    const reason = payload.value.reason

    if (!USERNAME_PATTERN.test(username) || !validEmail(email) || !validDisplayName(displayName) || !validReason(reason)) {
      problem(res, 400, 'invalid_input')
      return
    }

    // 27 byte acak -> 36 karakter base64url. Password sementara ini hanya
    // dikembalikan sekali di respons ini, tidak pernah disimpan atau dicatat
    // dalam bentuk plaintext.
    const temporary = randomBytes(27).toString('base64url')
    const passwordHash = await hashPassword(temporary)

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        let userId
        try {
          const { rows } = await client.query(
            `INSERT INTO sdl_users(username,email,display_name,password_hash,must_change_password,is_active)
             VALUES($1,$2,$3,$4,TRUE,TRUE) RETURNING id::text AS id`,
            [username, email, displayName, passwordHash],
          )
          userId = rows[0].id
        } catch (error) {
          if (isUniqueViolation(error)) return { kind: 'user_exists' }
          throw error
        }
        await audit(client, req.actor, 'identity.user_created', userId, {
          username,
          reason: reason.trim(),
          requiresPasswordChange: true,
        })
        return { kind: 'ok', userId }
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    if (outcome.kind === 'user_exists') {
      problem(res, 409, 'user_exists')
      return
    }
    writeJson(res, 201, { id: outcome.userId, temporaryPassword: temporary })
  }))

  // ---- PATCH /users/:userID ----
  router.patch('/users/:userID', json, handle(async (req, res) => {
    const id = req.params.userID
    const payload = parsePayload(req, ['email', 'displayName', 'active', 'version', 'reason'])
    if (!payload.ok) {
      problem(res, 400, 'invalid_request')
      return
    }

    const email = String(payload.value.email ?? '').trim().toLowerCase()
    const displayName = String(payload.value.displayName ?? '').trim()
    const version = payload.value.version
    const active = payload.value.active === true

    if (!validEmail(email) || !validDisplayName(displayName) || !Number.isInteger(version) || version < 1 || !validReason(payload.value.reason)) {
      problem(res, 400, 'invalid_input')
      return
    }
    if (id === req.actor) {
      problem(res, 403, 'self_change_denied')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT u.version,
                  EXISTS(SELECT 1 FROM sdl_user_roles WHERE user_id=u.id AND role_key='superadmin') AS protected
             FROM sdl_users u WHERE u.id=$1 FOR UPDATE`,
          [id],
        )
        if (rows.length === 0) return { kind: 'user_missing' }
        if (rows[0].protected) return { kind: 'protected_user' }

        const current = Number(rows[0].version)
        if (current !== version) return { kind: 'user_changed_reload' }

        try {
          await client.query(
            'UPDATE sdl_users SET email=$2,display_name=$3,is_active=$4,version=version+1,updated_at=NOW() WHERE id=$1',
            [id, email, displayName, active],
          )
        } catch (error) {
          if (isUniqueViolation(error)) return { kind: 'email_exists' }
          throw error
        }

        // Perubahan identitas langsung mencabut seluruh sesi akun itu.
        await client.query('UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [id])
        await audit(client, req.actor, 'identity.user_updated', id, {
          active,
          reason: payload.value.reason.trim(),
          versionBefore: current,
        })
        return { kind: 'ok', version: current + 1 }
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    const failures = {
      user_missing: [404, 'user_missing'],
      protected_user: [403, 'protected_user'],
      user_changed_reload: [409, 'user_changed_reload'],
      email_exists: [409, 'email_exists'],
    }
    if (failures[outcome.kind]) {
      problem(res, failures[outcome.kind][0], failures[outcome.kind][1])
      return
    }
    writeJson(res, 200, { version: outcome.version })
  }))

  // ---- PUT /users/:userID/access ----
  router.put('/users/:userID/access', json, handle(async (req, res) => {
    const id = req.params.userID
    const payload = parsePayload(req, ['version', 'reason', 'primaryUnit', 'grants'])
    if (!payload.ok) {
      problem(res, 400, 'invalid_request')
      return
    }
    if (id === req.actor) {
      problem(res, 403, 'self_change_denied')
      return
    }

    const { version, reason, grants } = payload.value
    const primaryUnit = payload.value.primaryUnit ?? ''
    if (!Number.isInteger(version) || version < 1 || !validReason(reason) || !validateGrants(grants)) {
      problem(res, 400, 'invalid_grants')
      return
    }

    // Unit utama wajib ada kalau ada grant, dan wajib kosong kalau tidak ada.
    if (grants.length > 0 && primaryUnit === '') {
      problem(res, 400, 'primary_unit_required')
      return
    }
    if (grants.length === 0 && primaryUnit !== '') {
      problem(res, 400, 'invalid_primary_unit')
      return
    }
    const hasPrimary = grants.length === 0 || grants.some((g) => g.unitKey === primaryUnit)
    if (!hasPrimary) {
      problem(res, 400, 'primary_unit_not_assigned')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT u.version,
                  EXISTS(SELECT 1 FROM sdl_user_roles WHERE user_id=u.id AND role_key='superadmin') AS protected
             FROM sdl_users u WHERE u.id=$1 FOR UPDATE`,
          [id],
        )
        if (rows.length === 0) return { kind: 'user_missing' }
        if (rows[0].protected) return { kind: 'protected_user' }

        const current = Number(rows[0].version)
        if (current !== version) return { kind: 'user_changed_reload' }

        // Tidak ada kekuasaan administratif identity/audit yang boleh
        // disebarkan lewat jalur ini.
        for (const grant of grants) {
          const safe = await client.query(
            `SELECT EXISTS(SELECT 1 FROM sdl_roles ro
                JOIN sdl_org_units un ON un.unit_key=$2 AND un.is_active=TRUE
               WHERE ro.role_key=$1 AND ro.is_active=TRUE AND ro.role_key<>'superadmin'
                 AND NOT EXISTS(SELECT 1 FROM sdl_role_permissions rp
                                 WHERE rp.role_key=ro.role_key
                                   AND (rp.permission_key LIKE 'identity.%' OR rp.permission_key LIKE 'audit.%'))) AS ok`,
            [grant.roleKey, grant.unitKey],
          )
          if (!safe.rows[0].ok) return { kind: 'privileged_or_inactive_role' }
        }

        // Riwayat dipertahankan: grant lama DICABUT, bukan dihapus.
        await client.query('UPDATE sdl_access_grants SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [id])
        await client.query('DELETE FROM sdl_user_units WHERE user_id=$1', [id])

        const seenUnit = new Set()
        for (const grant of grants) {
          if (!seenUnit.has(grant.unitKey)) {
            await client.query('INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,$2,$3)', [
              id,
              grant.unitKey,
              grant.unitKey === primaryUnit,
            ])
            seenUnit.add(grant.unitKey)
          }
          await client.query(
            `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,expires_at,grant_reason,granted_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id, grant.roleKey, grant.unitKey, grant.scope, grant.classificationLimit, grant.expiresAt ?? null, reason.trim(), req.actor],
          )
        }

        await client.query('UPDATE sdl_users SET version=version+1,updated_at=NOW() WHERE id=$1', [id])
        await client.query('UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [id])
        await audit(client, req.actor, 'identity.user_access_changed', id, {
          reason: reason.trim(),
          grants,
          primaryUnit,
          versionBefore: current,
        })
        return { kind: 'ok', version: current + 1 }
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    const failures = {
      user_missing: [404, 'user_missing'],
      protected_user: [403, 'protected_user'],
      user_changed_reload: [409, 'user_changed_reload'],
      privileged_or_inactive_role: [400, 'privileged_or_inactive_role'],
    }
    if (failures[outcome.kind]) {
      problem(res, failures[outcome.kind][0], failures[outcome.kind][1])
      return
    }
    writeJson(res, 200, { version: outcome.version })
  }))

  // ---- PATCH /users/:userID/otp ----
  router.patch('/users/:userID/otp', json, handle(async (req, res) => {
    const payload = parsePayload(req, ['enabled', 'version', 'reason', 'confirmPassword'])
    const confirmPassword = payload.ok ? payload.value.confirmPassword : undefined
    if (
      !payload.ok ||
      !Number.isInteger(payload.value.version) || payload.value.version < 1 ||
      !validReason(payload.value.reason) ||
      // Byte, mengikuti len() di users/otp.go:28.
      typeof confirmPassword !== 'string' ||
      Buffer.byteLength(confirmPassword, 'utf8') < 14 ||
      Buffer.byteLength(confirmPassword, 'utf8') > 256
    ) {
      problem(res, 400, 'invalid_request')
      return
    }

    const target = req.params.userID
    const admin = req.actor
    if (target === admin) {
      problem(res, 403, 'self_change_denied')
      return
    }

    // Throttle di sini memakai sha256 polos, BUKAN HMAC seperti di auth —
    // skemanya memang berbeda dan harus dipertahankan agar baris yang sudah
    // ada di sdl_login_limits tetap cocok.
    const throttleKey = createHash('sha256').update(`otp-admin-confirm:${admin}`).digest('hex')

    try {
      const { rows } = await pool.query(
        'SELECT EXISTS(SELECT 1 FROM sdl_login_limits WHERE throttle_key=$1 AND locked_until>NOW()) AS blocked',
        [throttleKey],
      )
      if (rows[0].blocked) {
        problem(res, 429, 'try_later')
        return
      }
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const adminRow = await client.query(
          'SELECT password_hash FROM sdl_users WHERE id=$1 AND is_active=TRUE FOR UPDATE',
          [admin],
        )
        if (adminRow.rows.length === 0) return { kind: 'access_denied' }

        // Menonaktifkan MFA adalah perubahan akses sensitif, jadi admin wajib
        // mengotentikasi ulang dengan password-nya sendiri.
        if (!(await verifyPassword(adminRow.rows[0].password_hash, confirmPassword))) {
          return { kind: 'reauthentication_failed' }
        }

        const targetRow = await client.query(
          `SELECT u.version,
                  EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin') AS protected
             FROM sdl_users u WHERE u.id=$1 FOR UPDATE`,
          [target],
        )
        if (targetRow.rows.length === 0) return { kind: 'user_missing' }
        if (targetRow.rows[0].protected) return { kind: 'protected_user' }

        const currentVersion = Number(targetRow.rows[0].version)
        if (currentVersion !== payload.value.version) return { kind: 'user_changed_reload' }

        const enabled = payload.value.enabled === true
        await client.query('UPDATE sdl_users SET otp_enabled=$2,version=version+1,updated_at=NOW() WHERE id=$1', [target, enabled])
        await client.query('UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL', [target])
        await client.query('UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL', [target])
        await audit(client, admin, 'identity.user_otp_policy_changed', target, {
          enabled,
          reason: payload.value.reason.trim(),
          versionBefore: currentVersion,
        })
        return { kind: 'ok', version: currentVersion + 1, enabled }
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    if (outcome.kind === 'reauthentication_failed') {
      // Throttle ditulis di luar transaksi supaya tidak ikut ter-rollback.
      await pool
        .query(
          `INSERT INTO sdl_login_limits(throttle_key,failures,window_started_at,locked_until)
           VALUES($1,1,NOW(),NULL)
           ON CONFLICT(throttle_key) DO UPDATE SET
             failures=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN 1
                           ELSE LEAST(sdl_login_limits.failures+1,20) END,
             window_started_at=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN NOW()
                           ELSE sdl_login_limits.window_started_at END,
             locked_until=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN NULL
                               WHEN sdl_login_limits.failures>=4 THEN NOW()+INTERVAL '15 minutes'
                               ELSE sdl_login_limits.locked_until END`,
          [throttleKey],
        )
        .catch(() => {})
      problem(res, 403, 'reauthentication_failed')
      return
    }

    const failures = {
      access_denied: [403, 'access_denied'],
      user_missing: [404, 'user_missing'],
      protected_user: [403, 'protected_user'],
      user_changed_reload: [409, 'user_changed_reload'],
    }
    if (failures[outcome.kind]) {
      problem(res, failures[outcome.kind][0], failures[outcome.kind][1])
      return
    }

    await pool.query('DELETE FROM sdl_login_limits WHERE throttle_key=$1', [throttleKey]).catch(() => {})
    writeJson(res, 200, { version: outcome.version, otpEnabled: outcome.enabled })
  }))

  return router
}
