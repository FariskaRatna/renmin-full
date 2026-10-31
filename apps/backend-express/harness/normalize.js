import { createHash } from 'node:crypto'

/**
 * Respons SDL penuh nilai yang berubah tiap run: UUID, timestamp, token sesi,
 * digest. Membandingkan mentah-mentah akan selalu merah. Normalisasi mengganti
 * nilai volatil dengan placeholder, TAPI menjaga relasinya: UUID yang sama di
 * dua tempat tetap jadi placeholder yang sama, sehingga perubahan keterkaitan
 * data tetap tertangkap.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/
const HEX64_RE = /^[0-9a-f]{64}$/i

/**
 * Nilai acak base64url yang muncul di respons. Go memakai dua ukuran:
 *   newRandom(32) -> 43 char  (token sesi, token CSRF, challenge, id captcha)
 *   newRandom(18) -> 24 char  (nonce captcha)
 *
 * Keduanya berubah di setiap panggilan dan harus dinormalkan, kalau tidak
 * GET /auth/captcha selalu terbaca sebagai perbedaan.
 *
 * Risiko yang disadari: string 24 karakter tanpa spasi yang kebetulan hanya
 * berisi [A-Za-z0-9_-] juga ikut dinormalkan. Efeknya adalah perbedaan yang
 * TIDAK terdeteksi, bukan perbedaan palsu — jadi ia menyembunyikan, bukan
 * mengarang. Kalau suatu saat ada field data yang terkena, ganti aturan ini
 * dengan normalisasi per-nama-field.
 */
const TOKEN43_RE = /^[A-Za-z0-9_-]{43}$/
const TOKEN24_RE = /^[A-Za-z0-9_-]{24}$/

/** Header yang direkam. Sisanya (Date, Content-Length, dll.) diabaikan. */
const HEADER_ALLOWLIST = [
  'content-type',
  'content-disposition',
  'cache-control',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'location',
  'allow',
]

export class Normalizer {
  #uuids = new Map()

  #placeholderFor(uuid) {
    const key = uuid.toLowerCase()
    let existing = this.#uuids.get(key)
    if (!existing) {
      existing = `<uuid:${this.#uuids.size + 1}>`
      this.#uuids.set(key, existing)
    }
    return existing
  }

  value(input) {
    if (typeof input === 'string') return this.#string(input)
    if (Array.isArray(input)) return input.map((item) => this.value(item))
    if (input && typeof input === 'object') {
      // Kunci diurutkan supaya perbedaan urutan serialisasi antara Go dan
      // Express tidak terbaca sebagai perbedaan isi.
      const out = {}
      for (const key of Object.keys(input).sort()) out[key] = this.value(input[key])
      return out
    }
    return input
  }

  #string(value) {
    if (UUID_RE.test(value)) return this.#placeholderFor(value)
    if (TIMESTAMP_RE.test(value)) return '<timestamp>'
    if (HEX64_RE.test(value)) return '<hex64>'
    if (TOKEN43_RE.test(value)) return '<token43>'
    if (TOKEN24_RE.test(value)) return '<token24>'
    return value
  }

  headers(raw) {
    const out = {}
    for (const name of HEADER_ALLOWLIST) {
      const value = raw.get(name)
      if (value !== null) out[name] = value
    }
    // Set-Cookie dicatat sebagai atributnya saja; nilai token selalu berubah.
    const cookies = typeof raw.getSetCookie === 'function' ? raw.getSetCookie() : []
    if (cookies.length > 0) {
      out['set-cookie'] = cookies
        .map((cookie) => {
          const [pair, ...attrs] = cookie.split(';')
          const name = pair?.split('=')[0]?.trim() ?? ''
          const normalizedAttrs = attrs.map((a) => a.trim()).sort()
          return [`${name}=<value>`, ...normalizedAttrs].join('; ')
        })
        .sort()
        .join(' || ')
    }
    return out
  }

  /** Body non-JSON (unduhan berkas) direkam sebagai sidik jari, bukan isi. */
  binary(bytes) {
    return {
      kind: 'binary',
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }
  }
}
