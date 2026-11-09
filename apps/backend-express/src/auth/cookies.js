/**
 * Cookie sesi dan CSRF, padanan Service.cookie/clearCookie
 * (internal/auth/service.go:100-106).
 *
 * Set-Cookie dirakit manual, BUKAN lewat res.cookie(). Alasannya: res.cookie()
 * menambahkan atribut `Expires` saat maxAge diberikan, sedangkan Go hanya
 * menulis `Max-Age`. Selisih itu terlihat di golden file sebagai perbedaan
 * header, padahal perilakunya setara — dan kontrak sedang dibekukan, jadi
 * yang dikejar adalah bentuk yang sama persis.
 *
 * Go menulis atribut dengan urutan: Path, Max-Age, HttpOnly, Secure, SameSite.
 */
export const SESSION_COOKIE = 'sdl_session'
export const CSRF_COOKIE = 'sdl_csrf'

export const SESSION_LIFETIME_SECONDS = 8 * 60 * 60
export const CSRF_LIFETIME_SECONDS = 60 * 60

function serialize(name, value, { httpOnly, secure, maxAge }) {
  const parts = [`${name}=${value}`, 'Path=/']
  // Go menulis "Max-Age=0" untuk MaxAge negatif (penghapusan) dan nilai detik
  // apa adanya untuk MaxAge positif.
  parts.push(`Max-Age=${maxAge < 0 ? 0 : maxAge}`)
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  parts.push('SameSite=Strict')
  return parts.join('; ')
}

export function setCookie(res, name, value, httpOnly, maxAgeSeconds, secure) {
  res.append('Set-Cookie', serialize(name, value, { httpOnly, secure, maxAge: maxAgeSeconds }))
}

export function clearCookie(res, name, httpOnly, secure) {
  res.append('Set-Cookie', serialize(name, '', { httpOnly, secure, maxAge: -1 }))
}

/**
 * Mem-parse header Cookie. Tidak memakai cookie-parser supaya tidak ada
 * decoding tambahan: Go membaca nilai cookie apa adanya, dan token sesi
 * base64url tidak boleh di-decodeURIComponent.
 */
export function readCookies(req) {
  const header = req.get('Cookie')
  const jar = new Map()
  if (!header) return jar
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=')
    if (index <= 0) continue
    jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  }
  return jar
}

export function readCookie(req, name) {
  return readCookies(req).get(name)
}
