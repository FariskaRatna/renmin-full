import { Router } from 'express'
import { randomBytes } from 'node:crypto'

import { hashPassword, verifyPassword } from '../crypto/password.js'
import { constantTimeEquals, newRandom, signature, tokenHash } from '../crypto/tokens.js'
import { withTransaction } from '../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../http/payload.js'
import { noContent, problem, writeJson } from '../http/respond.js'
import {
  CSRF_COOKIE,
  CSRF_LIFETIME_SECONDS,
  SESSION_COOKIE,
  SESSION_LIFETIME_SECONDS,
  clearCookie,
  readCookie,
  setCookie,
} from './cookies.js'
import { allowMutation } from './csrf.js'
import { consumeCaptcha, issueChallenge } from './captcha.js'
import { audit, currentUser, insertSession, revokeOtherSessions } from './session.js'
import { clearFailures, isLocked, recordFailure, remoteIp, throttleKeys } from './throttle.js'
import { registerProfileRoutes } from './profile.js'

const OTP_LIFETIME_SECONDS = 300

/**
 * Padanan Service.mustUseOTP (service.go:345).
 *
 * Superadmin SELALU wajib OTP, apa pun nilai otp_enabled di database. Tidak ada
 * jalan untuk mematikannya, termasuk lewat PATCH /admin/users/{id}/otp.
 */
export function mustUseOtp(otpEnabled, isSuperadmin) {
  return isSuperadmin || otpEnabled
}

/**
 * 15 endpoint /api/v1/auth/*, urutan deklarasi mengikuti Service.Routes
 * (service.go:150).
 */
export function createAuthRouter({ pool, config, mailer }) {
  const router = Router()

  /** Padanan wrapMutation: semua mutation auth wajib lolos Origin + CSRF. */
  const requireCsrf = (handler) => async (req, res, next) => {
    if (!allowMutation(req, config.allowedOrigins)) {
      problem(res, 403, 'csrf_invalid')
      return
    }
    try {
      await handler(req, res)
    } catch (error) {
      next(error)
    }
  }

  const guard = (handler) => async (req, res, next) => {
    try {
      await handler(req, res)
    } catch (error) {
      next(error)
    }
  }

  const json = rawBody(BODY_LIMITS.AUTH)

  // ---- GET /csrf ----
  router.get('/csrf', guard(async (req, res) => {
    const token = newRandom(32)
    setCookie(res, CSRF_COOKIE, token, false, CSRF_LIFETIME_SECONDS, config.secureCookie)
    writeJson(res, 200, { csrfToken: token })
  }))

  // ---- GET /bootstrap-status ----
  router.get('/bootstrap-status', guard(async (req, res) => {
    let configured
    try {
      const { rows } = await pool.query(
        "SELECT EXISTS(SELECT 1 FROM sdl_user_roles WHERE role_key='superadmin') AS ok",
      )
      configured = rows[0].ok
    } catch {
      problem(res, 503, 'unavailable')
      return
    }
    writeJson(res, 200, { hasSuperadmin: configured, smtpConfigured: mailer.ready() })
  }))

  // ---- GET /captcha ----
  router.get('/captcha', guard(async (req, res) => {
    // captchaGet menyetel ulang Cache-Control sebelum menyerahkan ke
    // captchaChallenge; middleware global sudah memasang nilai yang sama.
    res.set('Cache-Control', 'no-store')
    const result = await issueChallenge(pool, req, config.secret)
    writeJson(res, result.status, result.body)
  }))

  // ---- POST /login ----
  router.post('/login', json, requireCsrf(async (req, res) => {
    const payload = parsePayload(req, ['username', 'password', 'captcha'])
    const body = payload.ok ? payload.value : undefined
    const username = typeof body?.username === 'string' ? body.username : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    if (!payload.ok || username.length < 3 || username.length > 254 || password.length === 0 || password.length > 256) {
      problem(res, 400, 'invalid_request')
      return
    }

    // CAPTCHA baru, terpecahkan, sekali pakai WAJIB untuk setiap percobaan,
    // dan dikonsumsi sebelum query kredensial apa pun.
    const captcha = await consumeCaptcha(pool, req, config.secret, body.captcha)
    if (captcha.failed) {
      problem(res, 503, 'unavailable')
      return
    }
    if (!captcha.verified) {
      problem(res, 403, 'captcha_invalid')
      return
    }

    const login = username.trim().toLowerCase()
    const keys = throttleKeys(config.secret, remoteIp(req), login)

    let locked
    try {
      locked = await isLocked(pool, keys)
    } catch {
      problem(res, 503, 'unavailable')
      return
    }
    if (locked) {
      problem(res, 429, 'try_later')
      return
    }

    let account
    try {
      const { rows } = await pool.query(
        `SELECT u.id::text AS id,u.email,u.password_hash,u.is_active,u.otp_enabled,
                EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin') AS is_superadmin
           FROM sdl_users u WHERE lower(u.username)=$1 OR lower(u.email)=$1 LIMIT 1`,
        [login],
      )
      account = rows[0]
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    if (!account) {
      // Hash dummy yang mahal supaya waktu respons tidak membocorkan
      // keberadaan akun. Menghapusnya mengembalikan celah enumerasi.
      await hashPassword('sdl-dummy-password-with-sufficient-length')
      await recordFailure(pool, keys)
      problem(res, 401, 'invalid_credentials')
      return
    }

    const passwordOk = await verifyPassword(account.password_hash, password)
    if (!passwordOk || !account.is_active) {
      await recordFailure(pool, keys)
      problem(res, 401, 'invalid_credentials')
      return
    }

    // ---- Jalur tanpa OTP: hanya untuk kebijakan per-user non-admin ----
    if (!mustUseOtp(account.otp_enabled, account.is_superadmin)) {
      const token = newRandom(32)
      let policyChanged = false
      try {
        await withTransaction(pool, async (client) => {
          // FOR SHARE mencegah balapan dengan admin yang menyalakan OTP
          // di tengah proses login.
          const { rows } = await client.query(
            `SELECT u.otp_enabled,u.is_active,
                    EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin') AS is_superadmin
               FROM sdl_users u WHERE u.id=$1 FOR SHARE`,
            [account.id],
          )
          const fresh = rows[0]
          if (!fresh || !fresh.is_active || mustUseOtp(fresh.otp_enabled, fresh.is_superadmin)) {
            policyChanged = true
            throw new Error('policy changed')
          }
          await insertSession(client, token, account.id)
          await audit(client, account.id, 'auth.login_without_otp')
        })
      } catch {
        if (policyChanged) {
          problem(res, 403, 'policy_changed_retry_login')
          return
        }
        problem(res, 503, 'unavailable')
        return
      }
      await clearFailures(pool, keys)
      setCookie(res, SESSION_COOKIE, token, true, SESSION_LIFETIME_SECONDS, config.secureCookie)
      writeJson(res, 200, { authenticated: true, otpRequired: false })
      return
    }

    // ---- Jalur OTP ----
    const otpKeys = [
      signature(config.secret, 'otp-send-user', account.id),
      signature(config.secret, 'otp-send-peer', keys[1]),
    ]
    let sendLocked
    try {
      sendLocked = await isLocked(pool, otpKeys)
    } catch {
      problem(res, 503, 'unavailable')
      return
    }
    if (sendLocked) {
      problem(res, 429, 'try_later')
      return
    }

    if (!mailer.ready()) {
      problem(res, 503, 'email_delivery_unavailable')
      return
    }

    const challenge = newRandom(32)
    const code = (randomBytes(4).readUInt32BE(0) % 1000000).toString().padStart(6, '0')
    const digest = signature(config.secret, 'otp', `${challenge}:${code}`)
    const challengeHash = signature(config.secret, 'challenge', challenge)

    try {
      await withTransaction(pool, async (client) => {
        // Menerbitkan challenge baru membatalkan seluruh challenge lama akun ini.
        await client.query(
          'UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL',
          [account.id],
        )
        await client.query(
          "INSERT INTO sdl_login_challenges(challenge_hash,user_id,otp_code_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes')",
          [challengeHash, account.id, digest],
        )
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    try {
      await mailer.sendOtp(account.email, code)
    } catch {
      await pool.query('UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE challenge_hash=$1', [challengeHash]).catch(() => {})
      await pool.query("INSERT INTO sdl_audit_events(actor_id,event_key) VALUES($1,'auth.otp_delivery_failed')", [account.id]).catch(() => {})
      problem(res, 503, 'email_delivery_unavailable')
      return
    }

    await clearFailures(pool, keys)
    // Membatasi penerbitan OTP berulang, sekalipun passwordnya benar.
    await recordFailure(pool, otpKeys)
    await pool.query("INSERT INTO sdl_audit_events(actor_id,event_key) VALUES($1,'auth.otp_requested')", [account.id]).catch(() => {})

    writeJson(res, 200, { challenge, otpRequired: true, expiresInSeconds: OTP_LIFETIME_SECONDS })
  }))

  // ---- POST /verify-otp ----
  router.post('/verify-otp', json, requireCsrf(async (req, res) => {
    const payload = parsePayload(req, ['challenge', 'code'])
    const challenge = payload.ok && typeof payload.value.challenge === 'string' ? payload.value.challenge : ''
    const code = payload.ok && typeof payload.value.code === 'string' ? payload.value.code : ''
    if (!payload.ok || challenge.length !== 43 || code.length !== 6 || !/^[0-9]{6}$/.test(code)) {
      problem(res, 400, 'invalid_request')
      return
    }

    const challengeHash = signature(config.secret, 'challenge', challenge)
    const token = newRandom(32)
    let outcome

    try {
      outcome = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          'SELECT user_id::text AS user_id,otp_code_hash,attempts,expires_at,consumed_at FROM sdl_login_challenges WHERE challenge_hash=$1 FOR UPDATE',
          [challengeHash],
        )
        const row = rows[0]
        if (!row) return 'invalid_otp'
        if (row.consumed_at !== null || new Date(row.expires_at).getTime() <= Date.now() || row.attempts >= 5) {
          return 'invalid_otp'
        }

        const expected = signature(config.secret, 'otp', `${challenge}:${code}`)
        if (!constantTimeEquals(expected, row.otp_code_hash)) {
          await client.query(
            'UPDATE sdl_login_challenges SET attempts=LEAST(attempts+1,5) WHERE challenge_hash=$1',
            [challengeHash],
          )
          return 'invalid_otp'
        }

        const active = await client.query('SELECT is_active FROM sdl_users WHERE id=$1 FOR UPDATE', [row.user_id])
        if (!active.rows[0]?.is_active) return 'invalid_otp'

        await client.query('UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE challenge_hash=$1', [challengeHash])
        await insertSession(client, token, row.user_id)
        await audit(client, row.user_id, 'auth.login_success')
        return 'ok'
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    if (outcome !== 'ok') {
      problem(res, 401, 'invalid_otp')
      return
    }
    setCookie(res, SESSION_COOKIE, token, true, SESSION_LIFETIME_SECONDS, config.secureCookie)
    writeJson(res, 200, { authenticated: true })
  }))

  // ---- GET /me ----
  router.get('/me', guard(async (req, res) => {
    const userId = await currentUser(pool, req)
    if (!userId) {
      problem(res, 401, 'unauthenticated')
      return
    }

    let row
    try {
      // Role digabung dari DUA sumber: sdl_user_roles (langsung) UNION
      // sdl_access_grants (grant aktif dan belum kedaluwarsa). Menyederhanakan
      // query ini mengubah role yang terlihat oleh user.
      const result = await pool.query(
        `SELECT username,email,display_name,must_change_password,
                ARRAY(SELECT role_key FROM sdl_user_roles WHERE user_id=$1
                      UNION
                      SELECT g.role_key FROM sdl_access_grants g
                        JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active=TRUE
                       WHERE g.user_id=$1 AND g.revoked_at IS NULL
                         AND (g.expires_at IS NULL OR g.expires_at>NOW())
                       ORDER BY role_key) AS roles,
                ARRAY(SELECT DISTINCT g.unit_key FROM sdl_access_grants g
                        JOIN sdl_org_units un ON un.unit_key=g.unit_key AND un.is_active=TRUE
                       WHERE g.user_id=$1 AND g.revoked_at IS NULL
                         AND (g.expires_at IS NULL OR g.expires_at>NOW())
                       ORDER BY g.unit_key) AS units
           FROM sdl_users WHERE id=$1`,
        [userId],
      )
      row = result.rows[0]
      if (!row) throw new Error('missing user')
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    writeJson(res, 200, {
      id: userId,
      username: row.username,
      email: row.email,
      displayName: row.display_name,
      roles: row.roles,
      units: row.units,
      mustChangePassword: row.must_change_password,
    })
  }))

  // ---- POST /logout ----
  router.post('/logout', requireCsrf(async (req, res) => {
    const userId = await currentUser(pool, req)
    let failed = false
    if (userId) {
      const token = readCookie(req, SESSION_COOKIE)
      try {
        await pool.query(
          'UPDATE sdl_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL',
          [tokenHash(token ?? '')],
        )
        await pool.query("INSERT INTO sdl_audit_events(actor_id,event_key) VALUES($1,'auth.logout')", [userId])
      } catch {
        failed = true
      }
    }
    clearCookie(res, SESSION_COOKIE, true, config.secureCookie)
    if (failed) {
      problem(res, 503, 'unavailable')
      return
    }
    noContent(res)
  }))

  // ---- POST /change-password ----
  router.post('/change-password', json, requireCsrf(async (req, res) => {
    const payload = parsePayload(req, ['current', 'new'])
    const current = payload.ok && typeof payload.value.current === 'string' ? payload.value.current : ''
    const next = payload.ok && typeof payload.value.new === 'string' ? payload.value.new : ''
    if (!payload.ok || next.length < 14 || next.length > 256 || next === current) {
      problem(res, 400, 'invalid_request')
      return
    }

    const userId = await currentUser(pool, req)
    if (!userId) {
      problem(res, 401, 'unauthenticated')
      return
    }

    const key = signature(config.secret, 'password-change-user', userId)
    let locked
    try {
      locked = await isLocked(pool, [key])
    } catch {
      problem(res, 503, 'unavailable')
      return
    }
    if (locked) {
      problem(res, 429, 'try_later')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          'SELECT password_hash FROM sdl_users WHERE id=$1 AND is_active=TRUE FOR UPDATE',
          [userId],
        )
        if (!rows[0]) return 'unauthenticated'
        if (!(await verifyPassword(rows[0].password_hash, current))) return 'invalid_credentials'

        const encoded = await hashPassword(next)
        await client.query(
          'UPDATE sdl_users SET password_hash=$2,must_change_password=FALSE,password_changed_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1',
          [userId, encoded],
        )
        await revokeOtherSessions(client, userId, readCookie(req, SESSION_COOKIE))
        await audit(client, userId, 'identity.password_changed', 'user', userId)
        return 'ok'
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    if (outcome === 'unauthenticated') {
      problem(res, 401, 'unauthenticated')
      return
    }
    if (outcome === 'invalid_credentials') {
      await recordFailure(pool, [key])
      problem(res, 401, 'invalid_credentials')
      return
    }

    await clearFailures(pool, [key])
    noContent(res)
  }))

  registerProfileRoutes(router, { pool, config, mailer, requireCsrf, guard })

  return router
}
