import { SESSION_TOKEN_LENGTH, tokenHash } from '../crypto/tokens.js'
import { SESSION_COOKIE, readCookie } from './cookies.js'

/**
 * Padanan Service.currentUser (internal/auth/service.go:412).
 *
 * Mengembalikan id user, atau undefined kalau sesi tidak sah. Panjang token
 * diperiksa SEBELUM menyentuh database — token dengan panjang lain tidak
 * pernah menghasilkan query.
 *
 * Syarat di SQL-nya padat dan semuanya penting: sesi belum kedaluwarsa, belum
 * dicabut, DAN usernya masih aktif. Mencabut satu akun otomatis mematikan
 * seluruh sesinya tanpa perlu menyentuh tabel sesi.
 */
export async function currentUser(pool, req) {
  const token = readCookie(req, SESSION_COOKIE)
  if (!token || token.length !== SESSION_TOKEN_LENGTH) return undefined

  const { rows } = await pool.query(
    `SELECT u.id::text AS id
       FROM sdl_sessions sess
       JOIN sdl_users u ON u.id=sess.user_id
      WHERE sess.token_hash=$1
        AND sess.expires_at>NOW()
        AND sess.revoked_at IS NULL
        AND u.is_active=TRUE`,
    [tokenHash(token)],
  )
  return rows[0]?.id
}

/** Menyimpan sesi baru. Yang masuk database adalah sha256(token), bukan tokennya. */
export async function insertSession(client, token, userId) {
  await client.query(
    "INSERT INTO sdl_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '8 hours')",
    [tokenHash(token), userId],
  )
}

/** Mencabut semua sesi lain milik user — dipakai setelah ganti password/email. */
export async function revokeOtherSessions(client, userId, currentToken) {
  await client.query(
    'UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND token_hash<>$2 AND revoked_at IS NULL',
    [userId, tokenHash(currentToken ?? '')],
  )
}

/** Mencatat jejak audit. Tabelnya sama dipakai seluruh domain. */
export async function audit(client, actorId, eventKey, subjectType, subjectId) {
  if (subjectType === undefined) {
    await client.query('INSERT INTO sdl_audit_events(actor_id,event_key) VALUES($1,$2)', [actorId, eventKey])
    return
  }
  await client.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,$3,$4)',
    [actorId, eventKey, subjectType, subjectId],
  )
}
