import { randomBytes } from 'node:crypto'
import sharp from 'sharp'

import { verifyPassword } from '../crypto/password.js'
import { constantTimeEquals, newRandom, signature, tokenHash } from '../crypto/tokens.js'
import { isUniqueViolation, withTransaction } from '../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../http/payload.js'
import { noContent, problem, writeJson } from '../http/respond.js'
import { SESSION_COOKIE, readCookie } from './cookies.js'
import { audit, currentUser, revokeOtherSessions } from './session.js'
import { clearFailures, isLocked, recordFailure } from './throttle.js'

/**
 * Tujuh endpoint profil, padanan internal/auth/profile.go.
 */
const PHONE_PATTERN = /^[+0-9() .-]{0,40}$/
const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/
const AVATAR_SIDE = 256
const AVATAR_QUALITY = 85

function validProfileName(name) {
  const trimmed = String(name ?? '').trim()
  const runes = [...trimmed].length
  return runes >= 3 && runes <= 160 && !/[\r\n\0]/.test(trimmed)
}

function validProfilePhone(phone) {
  return typeof phone === 'string' && PHONE_PATTERN.test(phone)
}

function validProfileEmail(email) {
  if (typeof email !== 'string' || email.length < 5 || email.length > 254) return false
  if (/[\r\n\0]/.test(email)) return false
  return EMAIL_PATTERN.test(email)
}

/**
 * Padanan avatarJPEG (profile.go:90): hanya menerima JPEG/PNG, memeriksa
 * dimensi SEBELUM decode penuh untuk membatasi pemakaian memori, memotong
 * tengah jadi bujur sangkar, lalu mengkodekan ulang jadi JPEG 256x256 tanpa
 * metadata.
 *
 * Byte JPEG hasilnya TIDAK identik dengan Go — encoder-nya berbeda (libvips
 * vs image/jpeg). Itu deviasi yang tidak bisa dihindari; yang dipertahankan
 * adalah format, dimensi, dan hilangnya metadata.
 */
async function renderAvatar(raw) {
  if (!raw || raw.length === 0 || raw.length > BODY_LIMITS.AVATAR - 1) {
    throw new Error('invalid avatar size')
  }

  const meta = await sharp(raw).metadata()
  const format = meta.format
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (
    (format !== 'jpeg' && format !== 'png') ||
    width < 32 || height < 32 || width > 4096 || height > 4096 ||
    width * height > 12_000_000
  ) {
    throw new Error('invalid avatar format or dimensions')
  }

  return sharp(raw)
    // Piksel transparan diratakan jadi putih, sama seperti Go, supaya tidak
    // ada artefak transparansi yang ikut terbawa.
    .flatten({ background: '#ffffff' })
    .resize(AVATAR_SIDE, AVATAR_SIDE, { fit: 'cover', position: 'centre' })
    .jpeg({ quality: AVATAR_QUALITY, mozjpeg: false })
    .toBuffer()
}

export function registerProfileRoutes(router, { pool, config, mailer, requireCsrf, guard }) {
  const json = rawBody(BODY_LIMITS.AUTH)
  const avatarBody = rawBody(BODY_LIMITS.AVATAR)

  // ---- GET /profile ----
  router.get('/profile', guard(async (req, res) => {
    const userId = await currentUser(pool, req)
    if (!userId) {
      problem(res, 401, 'unauthenticated')
      return
    }
    let row
    try {
      const result = await pool.query(
        `SELECT display_name,email,username,COALESCE(profile_phone,'') AS phone,
                avatar_jpeg IS NOT NULL AS has_avatar
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
      username: row.username,
      displayName: row.display_name,
      email: row.email,
      phone: row.phone,
      hasAvatar: row.has_avatar,
    })
  }))

  // ---- PATCH /profile ----
  router.patch('/profile', json, requireCsrf(async (req, res) => {
    const payload = parsePayload(req, ['displayName', 'phone'])
    if (!payload.ok || !validProfileName(payload.value.displayName) || !validProfilePhone(payload.value.phone)) {
      problem(res, 400, 'invalid_request')
      return
    }
    const userId = await currentUser(pool, req)
    if (!userId) {
      problem(res, 401, 'unauthenticated')
      return
    }

    const displayName = payload.value.displayName.trim()
    const phone = payload.value.phone.trim()
    try {
      await withTransaction(pool, async (client) => {
        await client.query(
          'UPDATE sdl_users SET display_name=$2,profile_phone=$3,updated_at=NOW(),version=version+1 WHERE id=$1',
          [userId, displayName, phone],
        )
        await audit(client, userId, 'identity.profile_updated', 'user', userId)
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }
    writeJson(res, 200, { displayName, phone })
  }))

  // ---- GET /profile/avatar ----
  router.get('/profile/avatar', guard(async (req, res) => {
    const userId = await currentUser(pool, req)
    if (!userId) {
      problem(res, 401, 'unauthenticated')
      return
    }
    let blob
    try {
      const { rows } = await pool.query('SELECT avatar_jpeg FROM sdl_users WHERE id=$1', [userId])
      if (!rows[0]) throw new Error('missing user')
      blob = rows[0].avatar_jpeg
    } catch {
      problem(res, 503, 'unavailable')
      return
    }
    if (!blob || blob.length === 0) {
      // http.NotFound menulis teks polos, bukan JSON.
      res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('404 page not found\n')
      return
    }
    res.set('Content-Type', 'image/jpeg')
    res.set('Cache-Control', 'no-store, private')
    res.status(200).send(blob)
  }))

  // ---- PUT /profile/avatar ----
  router.put('/profile/avatar', avatarBody, requireCsrf(async (req, res) => {
    const userId = await currentUser(pool, req)
    if (!userId) {
      problem(res, 401, 'unauthenticated')
      return
    }
    if (req.rawBodyTooLarge) {
      problem(res, 413, 'avatar_too_large')
      return
    }

    let jpeg
    try {
      jpeg = await renderAvatar(req.rawBodyBuffer)
    } catch {
      problem(res, 400, 'invalid_avatar')
      return
    }

    try {
      await withTransaction(pool, async (client) => {
        await client.query('UPDATE sdl_users SET avatar_jpeg=$2,updated_at=NOW() WHERE id=$1', [userId, jpeg])
        await audit(client, userId, 'identity.avatar_changed', 'user', userId)
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }
    noContent(res)
  }))

  // ---- DELETE /profile/avatar ----
  router.delete('/profile/avatar', requireCsrf(async (req, res) => {
    const userId = await currentUser(pool, req)
    if (!userId) {
      problem(res, 401, 'unauthenticated')
      return
    }
    try {
      await withTransaction(pool, async (client) => {
        await client.query('UPDATE sdl_users SET avatar_jpeg=NULL,updated_at=NOW() WHERE id=$1', [userId])
        await audit(client, userId, 'identity.avatar_removed', 'user', userId)
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }
    noContent(res)
  }))

  // ---- POST /profile/email/start ----
  router.post('/profile/email/start', json, requireCsrf(async (req, res) => {
    const payload = parsePayload(req, ['email', 'password'])
    const email = payload.ok && typeof payload.value.email === 'string' ? payload.value.email : ''
    const password = payload.ok && typeof payload.value.password === 'string' ? payload.value.password : ''
    if (!payload.ok || !validProfileEmail(email) || password.length === 0 || password.length > 256) {
      problem(res, 400, 'invalid_request')
      return
    }
    const userId = await currentUser(pool, req)
    if (!userId) {
      problem(res, 401, 'unauthenticated')
      return
    }
    if (!mailer.ready()) {
      problem(res, 503, 'smtp_unavailable')
      return
    }

    const limitKey = signature(config.secret, 'profile-email-start', userId)
    try {
      if (await isLocked(pool, [limitKey])) {
        problem(res, 429, 'try_later')
        return
      }
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    let account
    try {
      const { rows } = await pool.query(
        'SELECT password_hash,email FROM sdl_users WHERE id=$1 AND is_active=TRUE',
        [userId],
      )
      account = rows[0]
      if (!account) throw new Error('missing user')
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    if (!(await verifyPassword(account.password_hash, password))) {
      await recordFailure(pool, [limitKey])
      problem(res, 401, 'invalid_credentials')
      return
    }
    if (email.toLowerCase() === String(account.email).toLowerCase()) {
      problem(res, 400, 'same_email')
      return
    }

    try {
      const taken = await pool.query(
        'SELECT EXISTS(SELECT 1 FROM sdl_users WHERE lower(email)=lower($1) AND id<>$2) AS ok',
        [email, userId],
      )
      if (taken.rows[0].ok) {
        problem(res, 409, 'email_in_use')
        return
      }
      const sent = await pool.query(
        "SELECT count(*)::int AS n FROM sdl_profile_email_challenges WHERE user_id=$1 AND created_at>NOW()-INTERVAL '15 minutes'",
        [userId],
      )
      if (sent.rows[0].n >= 3) {
        problem(res, 429, 'try_later')
        return
      }
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    const challenge = newRandom(32)
    const code = (randomBytes(4).readUInt32BE(0) % 1000000).toString().padStart(6, '0')

    try {
      await withTransaction(pool, async (client) => {
        await client.query(
          'UPDATE sdl_profile_email_challenges SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL',
          [userId],
        )
        await client.query(
          "INSERT INTO sdl_profile_email_challenges(challenge_hash,user_id,new_email,otp_code_hash,expires_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '5 minutes')",
          [tokenHash(challenge), userId, email, signature(config.secret, 'profile-email-otp', `${challenge}:${code}`)],
        )
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    try {
      await mailer.sendOtp(email, code)
    } catch {
      await pool
        .query('UPDATE sdl_profile_email_challenges SET consumed_at=NOW() WHERE challenge_hash=$1', [tokenHash(challenge)])
        .catch(() => {})
      problem(res, 503, 'smtp_unavailable')
      return
    }

    writeJson(res, 202, { challenge })
  }))

  // ---- POST /profile/email/verify ----
  router.post('/profile/email/verify', json, requireCsrf(async (req, res) => {
    const payload = parsePayload(req, ['challenge', 'code'])
    const challenge = payload.ok && typeof payload.value.challenge === 'string' ? payload.value.challenge : ''
    const code = payload.ok && typeof payload.value.code === 'string' ? payload.value.code : ''
    if (!payload.ok || challenge.length !== 43 || code.length !== 6 || !/^[0-9]{6}$/.test(code)) {
      problem(res, 400, 'invalid_request')
      return
    }
    const userId = await currentUser(pool, req)
    if (!userId) {
      problem(res, 401, 'unauthenticated')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT new_email,otp_code_hash,attempts FROM sdl_profile_email_challenges
            WHERE challenge_hash=$1 AND user_id=$2 AND expires_at>NOW() AND consumed_at IS NULL FOR UPDATE`,
          [tokenHash(challenge), userId],
        )
        const row = rows[0]
        if (!row || row.attempts >= 5) return { kind: 'invalid' }

        const expected = signature(config.secret, 'profile-email-otp', `${challenge}:${code}`)
        if (!constantTimeEquals(expected, row.otp_code_hash)) {
          await client.query(
            'UPDATE sdl_profile_email_challenges SET attempts=attempts+1,consumed_at=CASE WHEN attempts>=4 THEN NOW() ELSE consumed_at END WHERE challenge_hash=$1',
            [tokenHash(challenge)],
          )
          return { kind: 'invalid' }
        }

        try {
          await client.query(
            'UPDATE sdl_users SET email=$2,updated_at=NOW(),version=version+1 WHERE id=$1',
            [userId, row.new_email],
          )
        } catch (error) {
          if (isUniqueViolation(error)) return { kind: 'email_in_use' }
          throw error
        }

        await client.query('UPDATE sdl_profile_email_challenges SET consumed_at=NOW() WHERE challenge_hash=$1', [
          tokenHash(challenge),
        ])
        await revokeOtherSessions(client, userId, readCookie(req, SESSION_COOKIE))
        await audit(client, userId, 'identity.email_changed', 'user', userId)
        return { kind: 'ok', email: row.new_email }
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    if (outcome.kind === 'invalid') {
      problem(res, 400, 'invalid_or_expired_code')
      return
    }
    if (outcome.kind === 'email_in_use') {
      problem(res, 409, 'email_in_use')
      return
    }
    writeJson(res, 200, { email: outcome.email })
  }))
}
