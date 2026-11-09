/**
 * Pembacaan body JSON, padanan readPayload() di internal/auth/service.go:88.
 *
 * Go melakukan tiga hal yang express.json() TIDAK lakukan:
 *
 *   1. http.MaxBytesReader membatasi ukuran body per endpoint (4096 byte untuk
 *      auth, 512 untuk email verify, 16000 untuk profil).
 *   2. DisallowUnknownFields menolak field asing dengan 400, bukan mengabaikannya.
 *   3. Decode kedua memastikan tidak ada data menyusul setelah objek JSON —
 *      body seperti `{"a":1}{"b":2}` ditolak.
 *
 * Ketiganya direplikasi. Nomor 2 yang paling mudah terlewat dan paling jelas
 * mengubah perilaku: tanpa itu, payload asing diterima diam-diam.
 */

/** Mengumpulkan body mentah dengan batas keras. */
export function rawBody(limit) {
  return (req, res, next) => {
    const chunks = []
    let size = 0
    let aborted = false

    req.on('data', (chunk) => {
      if (aborted) return
      size += chunk.length
      if (size > limit) {
        aborted = true
        req.rawBodyTooLarge = true
        req.removeAllListeners('data')
        req.rawBodyBuffer = Buffer.alloc(0)
        next()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (aborted) return
      req.rawBodyBuffer = Buffer.concat(chunks)
      next()
    })
    req.on('error', () => {
      if (aborted) return
      aborted = true
      req.rawBodyInvalid = true
      req.rawBodyBuffer = Buffer.alloc(0)
      next()
    })
  }
}

/**
 * Mem-parse body yang sudah dikumpulkan rawBody().
 *
 * @param {import('express').Request} req
 * @param {string[]} allowedKeys daftar field yang dikenal; selainnya ditolak
 * @returns {{ok: true, value: object} | {ok: false}}
 */
export function parsePayload(req, allowedKeys) {
  if (req.rawBodyTooLarge || req.rawBodyInvalid) return { ok: false }

  const text = (req.rawBodyBuffer ?? Buffer.alloc(0)).toString('utf8')
  if (text.trim() === '') return { ok: false }

  let value
  try {
    // JSON.parse menolak data menyusul setelah nilai pertama, jadi perilaku
    // "decode kedua" milik Go sudah tercakup.
    value = JSON.parse(text)
  } catch {
    return { ok: false }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false }

  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) return { ok: false }
  }

  return { ok: true, value }
}

/**
 * Batas ukuran body yang dipakai Go, diverifikasi satu per satu dari
 * pemanggilan http.MaxBytesReader beserta nama filenya.
 *
 * SELURUH endpoint JSON di /api/v1/auth/* memakai readPayload, jadi batasnya
 * seragam 4096 — termasuk PATCH /profile dan POST /profile/email/verify.
 * Batas 512 dan 16000 milik directives/draft.go dan portal/api.go, bukan auth.
 */
export const BODY_LIMITS = Object.freeze({
  AUTH: 4096, // auth/service.go:89 — readPayload, dipakai 11 endpoint auth
  AVATAR: 2 * 1024 * 1024 + 1, // auth/profile.go:143 — maxAvatarUpload+1
  ROADMAP: 8192, // roadmap/api.go:129
  USULAN: 8192, // subbagren/usulan.go:89
  URMIN_INCOMING: 8192, // urmin/incoming.go:84
  DIRECTIVE_CREATE: 14000, // directives/api.go:181
  DIRECTIVE_DRAFT: 14000, // directives/draft.go:110
  DIRECTIVE_DRAFT_SMALL: 512, // directives/draft.go:152
  PORTAL: 16000, // portal/api.go:139
  ROLES: 16384, // roles/service.go:19 — maxBody
  UNIT_WORK: 16384, // unitwork/work.go:42
  UNIT_WORK_UPLOAD: 6 * 1024 * 1024, // unitwork/work.go:579
  USERS: 32768, // users/service.go:88
  EVIDENCE_UPLOAD: 5 * 1024 * 1024 + 65536, // subbagren/evidence.go:130
  ATTACHMENT_UPLOAD: 10 * 1024 * 1024 + 65536, // urmin/r3b.go:244
  INTAKE: 10 * (10 * 1024 * 1024) + 1024 * 1024, // urmin/r5f7.go:165
  DIRECTIVE_FILE: 100 * 1024 * 1024 + 1, // directives/attachments.go:26
})
