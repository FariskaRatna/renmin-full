import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Primitif token dan HMAC, padanan apps/backend/internal/auth/service.go.
 */

/**
 * Padanan Service.signature (service.go:68).
 *
 *   HMAC-SHA256(secret, purpose || 0x00 || value)
 *
 * Byte pemisah 0x00 itu WAJIB. Tanpa itu hasilnya berbeda, dan seluruh baris
 * sdl_login_limits, sdl_login_challenges, serta sdl_captcha_challenges yang
 * sudah ada di database menjadi tidak cocok — throttle dan OTP lama langsung
 * tidak terbaca.
 *
 * Dipakai untuk: kunci throttle (limit-user, limit-ip, otp-send-user,
 * otp-send-peer, password-change-user), hash challenge OTP, digest kode OTP,
 * dan digest IP pada captcha.
 */
export function signature(secret, purpose, value) {
  const mac = createHmac('sha256', secret)
  mac.update(Buffer.from(purpose, 'utf8'))
  mac.update(Buffer.from([0]))
  mac.update(Buffer.from(value, 'utf8'))
  return mac.digest('hex')
}

/**
 * Padanan tokenHash (service.go:76). Yang disimpan di sdl_sessions adalah
 * sha256(token) hex, bukan tokennya.
 */
export function tokenHash(token) {
  return createHash('sha256').update(Buffer.from(token, 'utf8')).digest('hex')
}

/**
 * Padanan newRandom (service.go:60). base64.RawURLEncoding di Go identik
 * dengan 'base64url' di Node: alfabet -_ TANPA padding.
 *
 * size=32 menghasilkan tepat 43 karakter, dan panjang itu diperiksa di
 * currentUser (service.go:414) serta verifyOTP (service.go:349).
 */
export function newRandom(size) {
  return randomBytes(size).toString('base64url')
}

/** Perbandingan konstan-waktu, padanan subtle.ConstantTimeCompare. */
export function constantTimeEquals(a, b) {
  const left = Buffer.from(String(a), 'utf8')
  const right = Buffer.from(String(b), 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export const SESSION_TOKEN_LENGTH = 43
