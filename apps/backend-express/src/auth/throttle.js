import { signature } from '../crypto/tokens.js'

/**
 * Throttle login, padanan internal/auth/service.go:177-196.
 *
 * Kunci disimpan sebagai HMAC, bukan nilai mentah — username dan IP tidak
 * pernah tersimpan plaintext di sdl_login_limits.
 *
 * Aturan: jendela 15 menit · kunci setelah 5 kegagalan · durasi kunci 15 menit ·
 * counter di-cap 20 · sukses login menghapus counter.
 */

/** Padanan throttleKeys: [kunci-per-username, kunci-per-IP]. */
export function throttleKeys(secret, remoteIp, login) {
  return [
    signature(secret, 'limit-user', login.toLowerCase()),
    signature(secret, 'limit-ip', remoteIp),
  ]
}

export async function isLocked(pool, keys) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM sdl_login_limits WHERE throttle_key=ANY($1::char(64)[]) AND locked_until>NOW()',
    [keys],
  )
  return rows[0].n > 0
}

/**
 * Mencatat kegagalan. SQL ini disalin verbatim dari service.go:191 — logikanya
 * (reset jendela vs increment vs kunci) rumit dan mudah salah kalau ditulis
 * ulang dengan kata-kata sendiri.
 *
 * Seperti di Go, error diabaikan: throttle yang gagal mencatat tidak boleh
 * menggagalkan permintaan.
 */
export async function recordFailure(pool, keys) {
  for (const key of keys) {
    try {
      await pool.query(
        `INSERT INTO sdl_login_limits(throttle_key,failures,window_started_at,locked_until)
         VALUES($1,1,NOW(),NULL)
         ON CONFLICT(throttle_key) DO UPDATE SET
           failures=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes'
                         THEN 1 ELSE LEAST(sdl_login_limits.failures+1,20) END,
           window_started_at=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes'
                         THEN NOW() ELSE sdl_login_limits.window_started_at END,
           locked_until=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN NULL
                             WHEN sdl_login_limits.failures>=4 THEN NOW()+INTERVAL '15 minutes'
                             ELSE sdl_login_limits.locked_until END`,
        [key],
      )
    } catch {
      // sengaja diabaikan, sama seperti `_, _ = s.db.Exec(...)` di Go
    }
  }
}

export async function clearFailures(pool, keys) {
  try {
    await pool.query('DELETE FROM sdl_login_limits WHERE throttle_key=ANY($1::char(64)[])', [keys])
  } catch {
    // idem
  }
}

/**
 * Padanan remoteIP (captcha.go:26). Header X-Forwarded-For SENGAJA tidak
 * dipercaya — ia dikendalikan klien. Konsekuensinya di balik reverse proxy
 * seluruh LAN terlihat sebagai satu IP; itu perilaku Go yang sekarang, dan
 * sudah dicatat sebagai B1 di DEVIATIONS.md.
 */
export function remoteIp(req) {
  const address = req.socket?.remoteAddress ?? ''
  // Node menuliskan alamat IPv4 di soket dual-stack sebagai ::ffff:1.2.3.4
  return address.startsWith('::ffff:') ? address.slice(7) : address
}
