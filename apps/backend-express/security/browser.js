import { solveCaptcha } from '../harness/captcha.js'
import { FIXTURE_PASSWORD, ORIGIN } from './constants.js'

/**
 * Klien HTTP untuk suite keamanan, padanan tipe `browser` di
 * `internal/securitytest/security_integration_test.go:48`.
 *
 * SENGAJA tidak memakai `harness/client.js`. Klien harness selalu mengirim
 * header `Origin` dan mengambil token CSRF sendiri — perilaku yang benar untuk
 * mengukur bentuk respons, tapi justru menghapus hal yang diuji di sini.
 * Separuh suite ini membuktikan permintaan DITOLAK ketika Origin hilang, ketika
 * Origin berasal dari domain asing, atau ketika header CSRF tidak dikirim.
 * Klien yang "membantu" melengkapinya akan membuat seluruh pemeriksaan itu
 * lulus tanpa menguji apa pun.
 *
 * Karena itu `mutation` di sini adalah saklar eksplisit, sama seperti parameter
 * `mutation bool` di Go:
 *
 *   mutation=true   kirim Origin + X-CSRF-Token
 *   mutation=false  JANGAN kirim keduanya
 */
export class Browser {
  #cookies = new Map()
  #base
  token = ''

  constructor(base) {
    this.#base = base
  }

  get base() {
    return this.#base
  }

  #cookieHeader() {
    if (this.#cookies.size === 0) return undefined
    return [...this.#cookies].map(([k, v]) => `${k}=${v}`).join('; ')
  }

  absorb(headers) {
    const list = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
    for (const cookie of list) {
      const pair = cookie.split(';')[0] ?? ''
      const index = pair.indexOf('=')
      if (index <= 0) continue
      const name = pair.slice(0, index).trim()
      const value = pair.slice(index + 1).trim()
      if (value === '') this.#cookies.delete(name)
      else this.#cookies.set(name, value)
    }
  }

  /**
   * Padanan browser.call().
   *
   * Satu detail yang kelihatan seperti cacat tapi WAJIB direplikasi: Go
   * menyetel `Content-Type: application/json` untuk SETIAP payload bukan-nil,
   * termasuk saat payload berupa byte mentah PNG pada unggah avatar
   * (security_integration_test.go:180 dan :443). Endpoint avatar menyimpulkan
   * tipe dari magic byte dan mengabaikan header itu. Kalau di sini
   * Content-Type-nya "dibetulkan" menjadi image/png, yang diuji bukan lagi
   * jalur kode yang sama.
   *
   * @param {string} method
   * @param {string} path
   * @param {object|Buffer|null} payload  Buffer dikirim mentah; objek di-JSON
   * @param {boolean} mutation            sertakan Origin + X-CSRF-Token
   * @param {{origin?: string}} [options] origin palsu untuk uji lintas situs
   */
  async call(method, path, payload = null, mutation = false, options = {}) {
    const headers = {}
    let body
    if (payload !== null && payload !== undefined) {
      body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload), 'utf8')
      // `contentType: null` menghilangkan header sepenuhnya. Dibutuhkan kasus
      // 03, yang di Go merakit requestnya sendiri dan karena itu TIDAK
      // menyetel Content-Type sama sekali.
      if (options.contentType !== null) headers['Content-Type'] = options.contentType ?? 'application/json'
    }
    if (mutation) {
      headers.Origin = options.origin ?? ORIGIN
      headers['X-CSRF-Token'] = this.token
    } else if (options.origin !== undefined) {
      // Dipakai kasus 03: Origin asing DIKIRIM, token CSRF tetap benar — yang
      // diuji penolakan berdasarkan allowlist Origin, bukan berdasarkan token.
      headers.Origin = options.origin
      if (options.csrf !== false) headers['X-CSRF-Token'] = this.token
    }
    const cookie = this.#cookieHeader()
    if (cookie) headers.Cookie = cookie

    const response = await fetch(this.#base + path, {
      method,
      headers,
      body,
      redirect: 'manual',
    })
    this.absorb(response.headers)
    const bytes = Buffer.from(await response.arrayBuffer())
    return {
      status: response.status,
      headers: response.headers,
      body: bytes,
      text: bytes.toString('utf8'),
      json: () => JSON.parse(bytes.toString('utf8')),
    }
  }

  /** Kiriman multipart; `csrf=false` membuktikan multipart tidak melewati gerbang CSRF. */
  async upload(path, { fields = {}, fileField = 'file', filename, data, csrf = true, fieldsFirst = false }) {
    const boundary = 'sdlSecurityBoundary3f90ab7c214d6e85'
    const parts = []
    const push = (head, payload) => {
      parts.push(Buffer.from(head, 'utf8'))
      if (payload !== undefined) parts.push(payload, Buffer.from('\r\n', 'utf8'))
    }
    const fileHead =
      `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\n` +
      'Content-Type: application/octet-stream\r\n\r\n'
    const fieldParts = Object.entries(fields).map(([name, value]) => [
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n`,
      Buffer.from(String(value), 'utf8'),
    ])

    // Urutan bagian ikut diuji: sebagian handler membaca berkas sebelum field
    // teks, jadi kiriman yang salah di dua tempat menghasilkan kode error dari
    // pemeriksaan yang lebih dulu dijalankan.
    if (fieldsFirst) for (const [h, v] of fieldParts) push(h, v)
    push(fileHead, data)
    if (!fieldsFirst) for (const [h, v] of fieldParts) push(h, v)
    parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'))

    const headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}` }
    if (csrf) {
      headers.Origin = ORIGIN
      headers['X-CSRF-Token'] = this.token
    }
    const cookie = this.#cookieHeader()
    if (cookie) headers.Cookie = cookie

    const response = await fetch(this.#base + path, {
      method: 'POST',
      headers,
      body: Buffer.concat(parts),
      redirect: 'manual',
    })
    this.absorb(response.headers)
    const bytes = Buffer.from(await response.arrayBuffer())
    return { status: response.status, headers: response.headers, body: bytes, text: bytes.toString('utf8') }
  }

  /** Mengambil cookie CSRF dan token-nya; padanan newBrowser(). */
  async bootstrap() {
    const r = await this.call('GET', '/api/v1/auth/csrf')
    if (r.status !== 200) throw new Error(`CSRF bootstrap ${r.status}: ${r.text}`)
    const parsed = r.json()
    if (typeof parsed.csrfToken !== 'string' || parsed.csrfToken.length < 24) {
      throw new Error('token CSRF tidak ada di respons')
    }
    this.token = parsed.csrfToken
    return this
  }

  /** Memecahkan proof-of-work CAPTCHA; difficulty WAJIB 16, seperti di Go. */
  async captcha() {
    const r = await this.call('GET', '/api/v1/auth/captcha')
    if (r.status !== 200) throw new Error(`captcha HTTP ${r.status}: ${r.text}`)
    const c = r.json()
    if (!c.id || !c.nonce || c.difficulty !== 16) {
      throw new Error(`tantangan CAPTCHA tidak sesuai: ${r.text}`)
    }
    return { id: c.id, counter: solveCaptcha(c.nonce) }
  }

  async login(username, expected) {
    const captcha = await this.captcha()
    const r = await this.call(
      'POST',
      '/api/v1/auth/login',
      { username, password: FIXTURE_PASSWORD, captcha },
      true,
    )
    if (r.status !== expected) {
      throw new Error(`login ${username}: HTTP ${r.status} diharapkan ${expected}: ${r.text}`)
    }
    return r
  }
}
