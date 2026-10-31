import { constantTimeEquals } from '../crypto/tokens.js'
import { CSRF_COOKIE, readCookie } from './cookies.js'

/**
 * Padanan Service.allowMutation (internal/auth/service.go:108).
 *
 * Pola double-submit: cookie sdl_csrf harus sama persis dengan header
 * X-CSRF-Token, DAN Origin harus ada di allowlist. Ketiganya wajib lolos.
 *
 * Catatan operasional yang sudah memakan waktu nyata: kalau
 * SDL_ALLOWED_ORIGINS tidak diisi saat di balik reverse proxy HTTPS, browser
 * mengirim Origin berisi alamat publik, pemeriksaan pertama gagal, dan UI
 * menampilkannya sebagai pesan CAPTCHA gagal — bukan pesan CSRF. Gejalanya
 * menyesatkan, jadi jangan melonggarkan pemeriksaan ini saat mendiagnosis.
 */
export function allowMutation(req, allowedOrigins) {
  const origin = req.get('Origin')
  if (!origin || !allowedOrigins.includes(origin)) return false

  const cookie = readCookie(req, CSRF_COOKIE)
  if (cookie === undefined) return false

  const supplied = req.get('X-CSRF-Token') ?? ''
  if (cookie.length < 24 || cookie.length > 128 || cookie.length !== supplied.length) return false

  return constantTimeEquals(cookie, supplied)
}
