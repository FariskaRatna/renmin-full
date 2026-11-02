import { createHash } from 'node:crypto'

import sharp from 'sharp'

import { withTransaction } from '../../db.js'
import { detectFileType } from '../../http/multipart.js'
import { deny, draftPermission, isKabag, mapFile, respond, UUID_RE } from './shared.js'

/**
 * Lampiran arahan pimpinan, port dari internal/directives/attachments.go.
 *
 * Berkas disimpan sebagai bytea di PostgreSQL, bukan di folder publik, dan
 * unggahannya BUKAN multipart: body-nya byte mentah dan nama berkasnya datang
 * lewat header X-File-Name. Itu berbeda dari unit-work maupun evidence, jadi
 * readSingleFile() tidak dipakai di sini.
 *
 * Lampiran hidup dalam dua keadaan yang dibedakan oleh satu kolom:
 *   directive_id IS NULL  milik draf privat penerbit, hanya ia yang melihat
 *   directive_id terisi   sudah terkirim, penerima ikut boleh membacanya
 * Perpindahan antar keadaan hanya terjadi di dalam transaksi pengiriman
 * (api.go create), tidak pernah terpisah.
 */

const MAX_FILE_BYTES = 100 * 1024 * 1024
const MAX_FILES = 5

/**
 * Padanan url.QueryUnescape (attachments.go:99), bukan decodeURIComponent.
 *
 * Perbedaannya nyata: QueryUnescape menerjemahkan '+' menjadi spasi, sedangkan
 * decodeURIComponent membiarkannya. Nama berkas "laporan+akhir.pdf" karena itu
 * tersimpan berbeda di kedua backend kalau helper ini dilewati.
 */
function queryUnescape(raw) {
  if (/%(?![0-9a-fA-F]{2})/.test(raw)) return undefined
  try {
    return decodeURIComponent(raw.replaceAll('+', ' '))
  } catch {
    return undefined
  }
}

/**
 * Padanan validDirectiveFile (attachments.go:36).
 *
 * Dua angka di sini berbeda dari modul evidence dan mudah tertukar: ekor PDF
 * dicari di **4096** byte terakhir (evidence memakai 2048), dan batas piksel
 * **40 juta** (evidence memakai 20 juta). Menyamakannya akan menolak berkas
 * yang Go terima.
 */
async function validDirectiveFile(name, blob) {
  if (blob.length < 6 || blob.length > MAX_FILE_BYTES) return undefined
  const nameBytes = Buffer.byteLength(name, 'utf8')
  if (nameBytes === 0 || nameBytes > 180) return undefined
  // filepath.Base(name) != name menolak segala bentuk path; dicek lewat
  // karakter terlarang plus dua nama khusus.
  if (/[/\\\x00\r\n]/.test(name) || name === '.' || name === '..') return undefined

  const detected = detectFileType(blob)
  const lower = name.toLowerCase()

  if (lower.endsWith('.pdf')) {
    const tail = blob.subarray(Math.max(0, blob.length - 4096))
    const valid = detected === 'application/pdf' &&
      blob.subarray(0, 5).toString('latin1') === '%PDF-' &&
      tail.includes('%%EOF')
    return valid ? 'application/pdf' : undefined
  }

  const isPng = lower.endsWith('.png') && detected === 'image/png'
  const isJpeg = (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) && detected === 'image/jpeg'
  if (!isPng && !isJpeg) return undefined

  try {
    const meta = await sharp(blob).metadata()
    if (!(meta.width > 0 && meta.height > 0)) return undefined
    if (meta.width * meta.height > 40000000) return undefined
    if (isPng && meta.format !== 'png') return undefined
    if (isJpeg && meta.format !== 'jpeg') return undefined
    return detected
  } catch {
    return undefined
  }
}

/**
 * Padanan fmt.Sprintf("attachment; filename=%q", name) (attachments.go:310).
 *
 * SENGAJA tidak memakai contentDisposition() dari http/multipart.js: helper itu
 * meniru mime.FormatMediaType, yang membiarkan nama sederhana tanpa tanda
 * kutip. Verb %q milik Go selalu mengutip, jadi `laporan.pdf` menjadi
 * `filename="laporan.pdf"` — bukan `filename=laporan.pdf`. Memakai helper yang
 * salah membuat header berbeda untuk hampir setiap berkas.
 */
function goQuote(value) {
  let out = '"'
  for (const char of value) {
    const code = char.codePointAt(0)
    if (char === '"') out += '\\"'
    else if (char === '\\') out += '\\\\'
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`
    else out += char
  }
  return `${out}"`
}

/**
 * Padanan canReadSentFile (attachments.go:196).
 *
 * Penerbit kehilangan akses ke arahannya sendiri begitu grant Kabagrenmin-nya
 * dicabut; penerima tidak, karena aksesnya bersandar pada relasi penerima yang
 * berdiri sendiri. Dua pemeriksaan terpisah, bukan satu OR.
 */
export async function canReadSentFile(pool, actorId, directiveId) {
  const allowed = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM sdl_leadership_directives d
       WHERE d.id=$1::uuid AND (
         EXISTS(SELECT 1 FROM sdl_leadership_directive_recipients rr
                 WHERE rr.directive_id=d.id AND rr.recipient_id=$2::uuid)
         OR d.issuer_id=$2::uuid)) AS ok`,
    [directiveId, actorId],
  )
  if (allowed.rows[0].ok !== true) return false

  const issuer = await pool.query(
    'SELECT EXISTS(SELECT 1 FROM sdl_leadership_directives WHERE id=$1::uuid AND issuer_id=$2::uuid) AS ok',
    [directiveId, actorId],
  )
  if (issuer.rows[0].ok === true) return isKabag(pool, actorId)
  return true
}

const FILE_COLUMNS = 'SELECT id::text,filename,mime_type,size_bytes,created_at'

/** GET /draft/attachments — endpoint 83. */
export function listDraftFiles({ pool }) {
  return async (req, res) => {
    if (!(await draftPermission(res, pool, req.actor))) return
    let rows
    try {
      ;({ rows } = await pool.query(
        `${FILE_COLUMNS} FROM sdl_leadership_directive_files
          WHERE issuer_id=$1::uuid AND directive_id IS NULL ORDER BY created_at,id`,
        [req.actor],
      ))
    } catch {
      deny(res, 503)
      return
    }
    respond(res, 200, {
      items: rows.map(mapFile),
      maxFiles: MAX_FILES,
      maxBytesPerFile: MAX_FILE_BYTES,
    })
  }
}

/** POST /draft/attachments — endpoint 84. Body byte mentah, bukan multipart. */
export function uploadDraftFile({ pool }) {
  return async (req, res) => {
    if (!(await draftPermission(res, pool, req.actor))) return

    const raw = req.get('X-File-Name') ?? ''
    const name = queryUnescape(raw)
    if (
      name === undefined ||
      Buffer.byteLength(raw, 'utf8') > 700 ||
      Buffer.byteLength(name, 'utf8') > 180 ||
      name === ''
    ) {
      deny(res, 400)
      return
    }

    // Go menuntut panjang yang pasti: r.ContentLength bernilai -1 untuk body
    // chunked, dan nilai negatif itu ditolak bersama body yang kebesaran.
    // Jadi unggahan tanpa Content-Length tidak pernah diterima.
    const declared = Number(req.get('Content-Length'))
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_FILE_BYTES) {
      deny(res, 413)
      return
    }
    if (req.rawBodyTooLarge) {
      deny(res, 413)
      return
    }
    const data = req.rawBodyBuffer ?? Buffer.alloc(0)
    if (data.length > MAX_FILE_BYTES) {
      deny(res, 413)
      return
    }

    const mime = await validDirectiveFile(name, data)
    if (!mime) {
      deny(res, 400)
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        // Lampiran hanya boleh menempel pada draf yang sudah ada: tanpa draf,
        // berkasnya tidak akan pernah punya jalan untuk ikut terkirim.
        const draft = await client.query(
          'SELECT revision FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid FOR UPDATE',
          [req.actor],
        )
        if (draft.rows.length === 0) return { status: 409 }

        const counted = await client.query(
          `SELECT COUNT(*)::int AS n FROM sdl_leadership_directive_files
            WHERE issuer_id=$1::uuid AND directive_id IS NULL`,
          [req.actor],
        )
        if (counted.rows[0].n >= MAX_FILES) return { status: 409 }

        const digest = createHash('sha256').update(data).digest('hex')
        const inserted = await client.query(
          `INSERT INTO sdl_leadership_directive_files(issuer_id,filename,mime_type,size_bytes,sha256,file_data)
           VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text AS id`,
          [req.actor, name, mime, data.length, digest, data],
        )
        return { status: 201, id: inserted.rows[0].id }
      })
    } catch {
      deny(res, 503)
      return
    }

    if (outcome.status !== 201) {
      deny(res, outcome.status)
      return
    }
    respond(res, 201, { id: outcome.id })
  }
}

/** DELETE /draft/attachments/:fileID — endpoint 85. */
export function deleteDraftFile({ pool }) {
  return async (req, res) => {
    if (!(await draftPermission(res, pool, req.actor))) return

    const id = req.params.fileID
    if (!UUID_RE.test(id)) {
      deny(res, 404)
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        // Go menjawab 409 untuk SETIAP kegagalan di sini, termasuk draf yang
        // tidak ada — bukan 404 maupun 503 (attachments.go:166).
        let draft
        try {
          draft = await client.query(
            'SELECT revision FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid FOR UPDATE',
            [req.actor],
          )
        } catch {
          return 409
        }
        if (draft.rows.length === 0) return 409

        const removed = await client.query(
          `DELETE FROM sdl_leadership_directive_files
            WHERE id=$1::uuid AND issuer_id=$2::uuid AND directive_id IS NULL`,
          [id, req.actor],
        )
        return removed.rowCount === 0 ? 404 : 200
      })
    } catch {
      deny(res, 503)
      return
    }

    if (outcome !== 200) {
      deny(res, outcome)
      return
    }
    respond(res, 200, { deleted: true })
  }
}

/** GET /:id/attachments — endpoint 92. */
export function listSentFiles({ pool }) {
  return async (req, res) => {
    const id = req.params.id
    if (!UUID_RE.test(id)) {
      deny(res, 404)
      return
    }
    let allowed
    try {
      allowed = await canReadSentFile(pool, req.actor, id)
    } catch {
      deny(res, 503)
      return
    }
    if (!allowed) {
      deny(res, 404)
      return
    }
    let rows
    try {
      ;({ rows } = await pool.query(
        `${FILE_COLUMNS} FROM sdl_leadership_directive_files
          WHERE directive_id=$1::uuid ORDER BY created_at,id`,
        [id],
      ))
    } catch {
      deny(res, 503)
      return
    }
    respond(res, 200, { items: rows.map(mapFile) })
  }
}

/** GET /attachments/:fileID/download — endpoint 86. */
export function getDirectiveFile({ pool }) {
  return async (req, res) => {
    const id = req.params.fileID
    if (!UUID_RE.test(id)) {
      deny(res, 404)
      return
    }

    let head
    try {
      head = await pool.query(
        'SELECT directive_id::text AS directive_id FROM sdl_leadership_directive_files WHERE id=$1::uuid',
        [id],
      )
    } catch {
      deny(res, 503)
      return
    }
    if (head.rows.length === 0) {
      deny(res, 404)
      return
    }

    const directiveId = head.rows[0].directive_id
    if (directiveId === null) {
      // Berkas draf: hanya penerbitnya, dan hanya selama ia masih Kabagrenmin.
      if (!(await draftPermission(res, pool, req.actor))) return
      let owner
      try {
        owner = await pool.query(
          `SELECT EXISTS(SELECT 1 FROM sdl_leadership_directive_files
             WHERE id=$1::uuid AND issuer_id=$2::uuid AND directive_id IS NULL) AS ok`,
          [id, req.actor],
        )
      } catch {
        deny(res, 503)
        return
      }
      if (owner.rows[0].ok !== true) {
        deny(res, 404)
        return
      }
    } else {
      let allowed
      try {
        allowed = await canReadSentFile(pool, req.actor, directiveId)
      } catch {
        deny(res, 503)
        return
      }
      if (!allowed) {
        deny(res, 404)
        return
      }
    }

    let row
    try {
      const loaded = await pool.query(
        'SELECT filename,mime_type,size_bytes,sha256,file_data FROM sdl_leadership_directive_files WHERE id=$1::uuid',
        [id],
      )
      row = loaded.rows[0]
    } catch {
      deny(res, 503)
      return
    }
    if (!row) {
      deny(res, 503)
      return
    }

    // Integritas diperiksa ulang sebelum byte dikirim. Ukuran ATAU digest yang
    // tidak cocok menjadi 503, bukan unduhan yang diam-diam rusak.
    const data = row.file_data
    const digest = createHash('sha256').update(data).digest('hex')
    if (data.length !== Number(row.size_bytes) || digest !== row.sha256) {
      deny(res, 503)
      return
    }

    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Security-Policy', 'sandbox')
    res.set('Cache-Control', 'no-store, private')
    res.set('Content-Type', row.mime_type)
    res.set('Content-Disposition', `attachment; filename=${goQuote(row.filename)}`)
    res.set('Content-Length', String(data.length))
    res.status(200).end(data)
  }
}
