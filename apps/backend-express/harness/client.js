import { solveCaptcha } from './captcha.js'

/**
 * Boundary TETAP, bukan acak. `FormData` bawaan Node juga bisa dipakai, tapi ia
 * mengarang boundary baru di setiap panggilan sehingga panjang body berubah
 * antar-run — dan tiga endpoint multipart di SDL menimbang seluruh body
 * (`http.MaxBytesReader`), bukan hanya isi berkasnya. Boundary tetap membuat
 * ukuran body deterministik, jadi kasus yang berada dekat batas berperilaku
 * sama di capture dan di compare.
 */
const MULTIPART_BOUNDARY = 'sdlHarnessBoundary7d41e0c9a2b64f18'

/**
 * Merakit body multipart/form-data sendiri.
 *
 * Dirakit tangan dengan alasan yang sama seperti cookie jar di bawah: Go
 * membedakan hal-hal yang diabaikan pustaka tingkat tinggi — berapa KALI satu
 * nama field muncul (`len(MultipartForm.Value["payload"]) != 1`, r5f7.go:174),
 * berapa berkas dikirim pada satu nama (`len(files) != 1`, evidence.go:144),
 * dan urutan kemunculannya. Semua itu harus bisa ditulis apa adanya oleh kasus
 * uji, bukan dinormalkan diam-diam oleh pustaka.
 *
 * Content-Type per bagian ikut ditulis supaya kiriman menyerupai browser, tapi
 * ia TIDAK menentukan apa pun: ketiga handler menyimpulkan tipe dari magic byte
 * isi berkas dan mengabaikan deklarasi klien sepenuhnya.
 *
 * @param {Array<{name: string, value?: string, bytes?: Buffer,
 *                filename?: string, contentType?: string}>} parts
 */
function buildMultipartBody(parts) {
  const chunks = []
  for (const part of parts) {
    let head = `--${MULTIPART_BOUNDARY}\r\nContent-Disposition: form-data; name="${part.name}"`
    if (part.filename !== undefined) head += `; filename="${part.filename}"`
    head += '\r\n'
    if (part.contentType) head += `Content-Type: ${part.contentType}\r\n`
    chunks.push(Buffer.from(`${head}\r\n`, 'utf8'))
    chunks.push(part.bytes ?? Buffer.from(String(part.value ?? ''), 'utf8'))
    chunks.push(Buffer.from('\r\n', 'utf8'))
  }
  chunks.push(Buffer.from(`--${MULTIPART_BOUNDARY}--\r\n`, 'utf8'))
  return Buffer.concat(chunks)
}

/**
 * Klien HTTP dengan cookie jar sendiri. Tidak memakai pustaka pihak ketiga
 * supaya perilaku cookie dan header persis terkendali — terutama Origin dan
 * X-CSRF-Token, dua hal yang menentukan lolos/tidaknya setiap mutation.
 */
export class HttpClient {
  #config
  #cookies = new Map()

  constructor(config) {
    this.#config = config
  }

  setCookie(name, value) {
    this.#cookies.set(name, value)
  }

  #cookieHeader() {
    if (this.#cookies.size === 0) return undefined
    return [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  #absorbSetCookie(headers) {
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
   * options.body      payload JSON; undefined berarti tanpa body
   * options.multipart daftar bagian form-data; MENGGANTIKAN options.body
   * options.withCsrf  sertakan header X-CSRF-Token (wajib untuk semua non-GET)
   */
  async request(method, path, options = {}) {
    const headers = { Origin: this.#config.origin }

    // CSRF diselesaikan SEBELUM header Cookie dibangun. Kalau dibalik,
    // ensureCsrf() yang menaruh cookie baru tidak akan ikut terkirim pada
    // request yang sedang disusun ini.
    if (options.withCsrf) {
      const token = await this.ensureCsrf()
      if (token) headers['X-CSRF-Token'] = token
    }

    const cookie = this.#cookieHeader()
    if (cookie) headers['Cookie'] = cookie

    let payload
    if (options.multipart !== undefined) {
      payload = buildMultipartBody(options.multipart)
      headers['Content-Type'] = `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`
    } else if (options.body !== undefined) {
      payload = JSON.stringify(options.body)
      headers['Content-Type'] = 'application/json'
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.#config.requestTimeoutMs)
    try {
      const response = await fetch(`${this.#config.apiBase}${path}`, {
        method,
        headers,
        body: payload,
        redirect: 'manual', // 301 trailing-slash chi adalah bagian kontrak, jangan diikuti
        signal: controller.signal,
      })
      this.#absorbSetCookie(response.headers)
      const bytes = new Uint8Array(await response.arrayBuffer())
      const contentType = response.headers.get('content-type') ?? ''
      return {
        status: response.status,
        headers: response.headers,
        bytes,
        isJson: contentType.includes('json'),
      }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * Mengembalikan nilai cookie sdl_csrf yang BERLAKU SAAT INI, bukan yang
   * ter-cache. Pola double-submit menuntut cookie dan header sama persis
   * (service.go:108), jadi token harus selalu dibaca dari cookie jar.
   *
   * Caching terpisah pernah membuat token basi: `GET /api/v1/auth/csrf` ada di
   * dalam registry, sehingga saat kasusnya dijalankan server menerbitkan token
   * baru ke cookie sementara header masih memakai token lama. Akibatnya seluruh
   * mutation sesudahnya dijawab 403 csrf_invalid, dan golden file merekam
   * gerbang CSRF alih-alih perilaku endpoint yang dimaksud.
   */
  async ensureCsrf() {
    if (!this.#cookies.has('sdl_csrf')) {
      await this.request('GET', '/api/v1/auth/csrf')
    }
    return this.#cookies.get('sdl_csrf')
  }

  /**
   * Login lewat jalur HTTP yang sebenarnya, termasuk memecahkan proof-of-work.
   * Hanya bisa untuk akun dengan otp_enabled=FALSE dan bukan Superadmin —
   * Superadmin selalu butuh OTP via SMTP dan ditangani lewat suntikan sesi.
   */
  async loginWithPassword(username, password) {
    await this.ensureCsrf()
    const challenge = await this.request('GET', '/api/v1/auth/captcha')
    if (challenge.status !== 200) {
      return { ok: false, detail: `captcha HTTP ${challenge.status}` }
    }
    const { id, nonce } = JSON.parse(new TextDecoder().decode(challenge.bytes))
    const counter = solveCaptcha(nonce)
    const response = await this.request('POST', '/api/v1/auth/login', {
      withCsrf: true,
      body: { username, password, captcha: { id, counter } },
    })
    const text = new TextDecoder().decode(response.bytes)
    if (response.status !== 200) return { ok: false, detail: `login HTTP ${response.status}: ${text}` }
    const body = JSON.parse(text)
    if (body.otpRequired) return { ok: false, detail: 'akun ini wajib OTP; pakai suntikan sesi' }
    return { ok: true, detail: 'login password berhasil' }
  }
}
