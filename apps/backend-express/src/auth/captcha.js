import { newRandom, signature, tokenHash } from '../crypto/tokens.js'
import { proofIsValid } from '../crypto/captcha.js'
import { remoteIp } from './throttle.js'
import { withTransaction } from '../db.js'

/**
 * CAPTCHA lokal berbasis database, padanan internal/auth/captcha.go.
 *
 * Challenge sekali pakai, dikonsumsi TRANSAKSIONAL sebelum query kredensial
 * mana pun. Replay dan request konkuren sama-sama gagal tertutup.
 */
const DIFFICULTY = 16
const LIFETIME_SECONDS = 120
const MAX_PER_MINUTE = 60

/** Padanan captchaChallenge. Mengembalikan {status, body}. */
export async function issueChallenge(pool, req, secret) {
  const ipDigest = signature(secret, 'captcha-peer', remoteIp(req))

  let count
  try {
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS n FROM sdl_captcha_challenges WHERE client_hash=$1 AND created_at>NOW()-INTERVAL '1 minute'",
      [ipDigest],
    )
    count = rows[0].n
  } catch {
    return { status: 503, body: { error: 'unavailable' } }
  }
  if (count >= MAX_PER_MINUTE) return { status: 429, body: { error: 'try_later' } }

  const id = newRandom(32)
  const nonce = newRandom(18)
  try {
    await pool.query(
      "INSERT INTO sdl_captcha_challenges(challenge_hash,client_hash,nonce,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '2 minutes')",
      [tokenHash(id), ipDigest, nonce],
    )
  } catch {
    return { status: 503, body: { error: 'unavailable' } }
  }

  return {
    status: 200,
    body: { id, nonce, difficulty: DIFFICULTY, expiresInSeconds: LIFETIME_SECONDS },
  }
}

/**
 * Padanan consumeCaptcha. Mengembalikan { verified, failed } — `failed` berarti
 * error infrastruktur (503), bukan proof yang salah.
 *
 * Perhatikan urutannya: baris dikunci FOR UPDATE, lalu UPDATE ... WHERE
 * consumed_at IS NULL, lalu RowsAffected diperiksa harus tepat 1. Itu yang
 * membuat dua request bersamaan dengan challenge sama tidak bisa dua-duanya lolos.
 */
export async function consumeCaptcha(pool, req, secret, submission) {
  const id = submission?.id
  const counter = submission?.counter

  if (typeof id !== 'string' || id.length !== 43) return { verified: false }
  if (!Number.isInteger(counter) || counter < 0 || counter > 5_000_000) return { verified: false }

  try {
    return await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        'SELECT nonce,client_hash,expires_at,consumed_at FROM sdl_captcha_challenges WHERE challenge_hash=$1 FOR UPDATE',
        [tokenHash(id)],
      )
      if (rows.length === 0) return { verified: false }

      const row = rows[0]
      const expectedPeer = signature(secret, 'captcha-peer', remoteIp(req))
      if (
        row.consumed_at !== null ||
        new Date(row.expires_at).getTime() <= Date.now() ||
        row.client_hash.toLowerCase() !== expectedPeer.toLowerCase() ||
        !proofIsValid(row.nonce, counter)
      ) {
        return { verified: false }
      }

      const result = await client.query(
        'UPDATE sdl_captcha_challenges SET consumed_at=NOW() WHERE challenge_hash=$1 AND consumed_at IS NULL',
        [tokenHash(id)],
      )
      if (result.rowCount !== 1) return { verified: false }

      return { verified: true }
    })
  } catch {
    return { verified: false, failed: true }
  }
}
