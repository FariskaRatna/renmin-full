import { createHash } from 'node:crypto'

import { Router } from 'express'
import sharp from 'sharp'

import { EvidenceKeyError, openEvidence, sealEvidence } from '../../crypto/evidence.js'
import { withTransaction } from '../../db.js'
import { contentDisposition } from '../../http/multipart.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { canManageOutgoing, contentHash } from './outgoing-review.js'
import { MAX_PLACEMENTS_PER_FILE, PdfUnreadableError, cleanPlacement, signPdf } from './pdf-sign.js'
import { AccessDeniedError, NotFoundError, fail, respond, sqlError } from './shared.js'

/**
 * R5H7: tanda tangan Kabagrenmin pada naskah surat keluar. EXPRESS SAJA --
 * tidak punya padanan Go; lihat docs/R5H7-TTD-KABAG-SURAT-KELUAR.md.
 *
 *   GET    /urmin/ttd/me                          tanda tangan tersimpan
 *   PUT    /urmin/ttd/me                          simpan/ganti
 *   DELETE /urmin/ttd/me                          hapus
 *   POST   /urmin/registry/:id/sign-approve       tanda tangani + setujui
 *   GET    /urmin/registry/:id/signed-files       daftar hasil
 *   GET    /urmin/registry/:id/signed-files/:fid  unduh hasil
 *
 * Tanda tangan dan persetujuan SATU transaksi: tidak pernah ada surat
 * "disetujui tapi belum ditandatangani" atau sebaliknya. Yang ditandatangani
 * hanya naskah yang sidik jarinya sama dengan saat diajukan.
 *
 * Tanpa ketik ulang password maupun OTP -- keputusan pemilik 2026-11-10.
 * Tanda tangannya visual, bukan TTE tersertifikasi.
 */

const MAX_SIGNATURE_BYTES = 200 * 1024
const DATA_URL_PREFIX = 'data:image/png;base64,'

/**
 * Gambar tanda tangan dari layar: data URL PNG. Didekode ulang lewat sharp
 * (bukan dipercaya apa adanya) dan dibatasi ukurannya; hasilnya PNG bersih
 * tanpa metadata.
 */
async function cleanSignatureImage(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(DATA_URL_PREFIX)) return null
  const b64 = dataUrl.slice(DATA_URL_PREFIX.length)
  if (b64.length === 0 || b64.length > Math.ceil(MAX_SIGNATURE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null
  const raw = Buffer.from(b64, 'base64')
  if (raw.length === 0 || raw.length > MAX_SIGNATURE_BYTES) return null
  try {
    const meta = await sharp(raw).metadata()
    const width = meta.width ?? 0
    const height = meta.height ?? 0
    if (meta.format !== 'png' || width < 40 || height < 20 || width > 2000 || height > 1200) return null
    return await sharp(raw).png({ compressionLevel: 9 }).toBuffer()
  } catch {
    return null
  }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function loadSavedSignature(pool, key, userId) {
  const { rows } = await pool.query(
    'SELECT image_seal,sha256,updated_at FROM sdl_user_signatures WHERE user_id::text=$1',
    [userId],
  )
  if (rows.length === 0) return null
  const image = openEvidence(key, rows[0].image_seal) // EvidenceKeyError / gagal dekripsi -> dilempar
  if (sha256(image) !== rows[0].sha256) throw new Error('signature integrity mismatch')
  return { image, updatedAt: rows[0].updated_at }
}

async function storeSignature(runner, key, userId, image) {
  const sealed = sealEvidence(key, image)
  await runner.query(
    `INSERT INTO sdl_user_signatures(user_id,image_seal,sha256,updated_at)
     VALUES($1::uuid,$2,$3,now())
     ON CONFLICT (user_id) DO UPDATE SET image_seal=EXCLUDED.image_seal,sha256=EXCLUDED.sha256,updated_at=now()`,
    [userId, sealed, sha256(image)],
  )
}

/** Router /urmin/ttd -- tanda tangan tersimpan milik akun yang login. */
export function createTtdRouter({ pool, config }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.TTD)

  // Hanya penyetuju surat keluar (Kabagrenmin) yang punya tanda tangan.
  async function guard(req, res) {
    try {
      if (await canManageOutgoing(pool, req.actor, 'biasa')) return true
      fail(res, 403, 'access_denied')
    } catch {
      fail(res, 503, 'authorization_unavailable')
    }
    return false
  }

  router.get('/me', async (req, res) => {
    if (!(await guard(req, res))) return
    try {
      const saved = await loadSavedSignature(pool, config.evidenceKey, req.actor)
      if (!saved) return respond(res, 200, { saved: false })
      respond(res, 200, {
        saved: true,
        image: DATA_URL_PREFIX + saved.image.toString('base64'),
        updatedAt: saved.updatedAt,
      })
    } catch (error) {
      fail(res, 503, error instanceof EvidenceKeyError ? 'signature_key_unavailable' : 'signature_unavailable')
    }
  })

  router.put('/me', json, async (req, res) => {
    if (!(await guard(req, res))) return
    const payload = parsePayload(req, ['image'])
    const image = payload.ok ? await cleanSignatureImage(payload.value.image) : null
    if (!image) return fail(res, 400, 'invalid_signature_image')
    try {
      await storeSignature(pool, config.evidenceKey, req.actor, image)
      respond(res, 200, { saved: true })
    } catch (error) {
      fail(res, 503, error instanceof EvidenceKeyError ? 'signature_key_unavailable' : 'database_unavailable')
    }
  })

  router.delete('/me', async (req, res) => {
    if (!(await guard(req, res))) return
    try {
      await pool.query('DELETE FROM sdl_user_signatures WHERE user_id::text=$1', [req.actor])
      respond(res, 200, { saved: false })
    } catch {
      fail(res, 503, 'database_unavailable')
    }
  })

  return router
}

function jakartaStamp(date) {
  const text = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
  return `${text} WIB`
}

function signedName(original) {
  const base = String(original).replace(/\.pdf$/i, '')
  return `${base}-ttd.pdf`.slice(-200)
}

/**
 * Rute tanda tangan pada router registry Urmin. Dipanggil dari
 * urmin-register.js SEBELUM '/:id' polos, seperti rute workflow.
 */
export function registerOutgoingSignRoutes(router, { pool, config, handle, loadOwned }) {
  const json = rawBody(BODY_LIMITS.TTD)

  async function loadOutgoing(actorId, id, action) {
    const record = await loadOwned(actorId, id, action)
    if (record.kind !== 'surat_keluar') throw new NotFoundError()
    return record
  }

  // ---- POST /:id/sign-approve ----
  router.post('/:id/sign-approve', json, handle(async (req, res) => {
    const id = req.params.id
    const record = await loadOutgoing(req.actor, id, 'read')

    let authorized
    try {
      authorized = await canManageOutgoing(pool, req.actor, record.classification)
    } catch {
      fail(res, 503, 'authorization_unavailable')
      return
    }
    if (!authorized) throw new AccessDeniedError()

    const payload = parsePayload(req, ['version', 'note', 'image', 'useSaved', 'saveAsMine', 'placements'])
    if (!payload.ok) return fail(res, 400, 'invalid_input')
    const { version, note: rawNote, image: rawImage, useSaved, saveAsMine, placements } = payload.value
    const note = typeof rawNote === 'string' ? rawNote.trim() : ''
    if (!Number.isInteger(version) || version < 1 || (rawNote !== undefined && typeof rawNote !== 'string') || [...note].length > 500) {
      return fail(res, 400, 'invalid_input')
    }
    if (typeof useSaved !== 'boolean' || (saveAsMine !== undefined && typeof saveAsMine !== 'boolean')) {
      return fail(res, 400, 'invalid_input')
    }
    if (placements === null || typeof placements !== 'object' || Array.isArray(placements)) {
      return fail(res, 400, 'invalid_input')
    }
    const plan = new Map()
    for (const [fileId, list] of Object.entries(placements)) {
      if (!/^[0-9a-f-]{36}$/.test(fileId) || !Array.isArray(list) || list.length === 0 || list.length > MAX_PLACEMENTS_PER_FILE) {
        return fail(res, 400, 'invalid_placements')
      }
      const clean = list.map(cleanPlacement)
      if (clean.some((p) => p === null)) return fail(res, 400, 'invalid_placements')
      plan.set(fileId, clean)
    }
    if (plan.size === 0) return fail(res, 400, 'invalid_placements')

    // Sumber gambar: tersimpan, atau coretan baru (opsional disimpan).
    let image
    try {
      if (useSaved) {
        if (rawImage !== undefined) return fail(res, 400, 'invalid_input')
        const saved = await loadSavedSignature(pool, config.evidenceKey, req.actor)
        if (!saved) return fail(res, 409, 'no_saved_signature')
        image = saved.image
      } else {
        image = await cleanSignatureImage(rawImage)
        if (!image) return fail(res, 400, 'invalid_signature_image')
      }
    } catch (error) {
      return fail(res, 503, error instanceof EvidenceKeyError ? 'signature_key_unavailable' : 'signature_unavailable')
    }

    let signerName
    try {
      const { rows } = await pool.query('SELECT display_name FROM sdl_users WHERE id::text=$1', [req.actor])
      signerName = rows[0]?.display_name ?? 'Kabagrenmin'
    } catch (error) {
      sqlError(res, error)
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const locked = await client.query(
          'SELECT id::text AS id FROM sdl_unit_work_records WHERE id::text=$1 AND deleted_at IS NULL FOR UPDATE',
          [record.workRecordId],
        )
        if (locked.rows.length === 0) throw new NotFoundError()

        const workflow = await client.query(
          `SELECT stage,version,COALESCE(content_sha256,'') AS content_sha256
             FROM sdl_outgoing_workflows WHERE register_id::text=$1 FOR UPDATE`,
          [id],
        )
        if (workflow.rows.length === 0) throw new NotFoundError()
        const { stage, content_sha256: storedHash } = workflow.rows[0]
        if (stage !== 'submitted' || Number(workflow.rows[0].version) !== version) {
          return { kind: 'workflow_state_changed' }
        }
        const currentHash = await contentHash(client, id, record.workRecordId)
        if (currentHash !== storedHash) return { kind: 'document_integrity_changed' }

        const already = await client.query(
          'SELECT 1 FROM sdl_outgoing_signed_files WHERE register_id::text=$1 LIMIT 1',
          [id],
        )
        if (already.rows.length > 0) return { kind: 'already_signed' }

        // Naskah = lampiran PDF aktif. SETIAP PDF wajib ditandatangani, dan
        // tidak boleh ada penempatan untuk berkas lain.
        const files = await client.query(
          `SELECT id::text AS id,file_name,sha256,file_data FROM sdl_unit_work_files
            WHERE record_id::text=$1 AND removed_at IS NULL AND purpose='lampiran'
              AND media_type='application/pdf' ORDER BY id`,
          [record.workRecordId],
        )
        const pdfIds = new Set(files.rows.map((f) => f.id))
        if (files.rows.length === 0) return { kind: 'pdf_required' }
        if (plan.size !== pdfIds.size || [...plan.keys()].some((k) => !pdfIds.has(k))) {
          return { kind: 'placements_mismatch' }
        }

        // SEMUA naskah ditandatangani di memori lebih dulu; baru ditulis kalau
        // seluruhnya berhasil. withTransaction meng-COMMIT setiap nilai yang
        // dikembalikan (hanya error yang di-rollback), jadi menulis di dalam
        // loop lalu "return" saat naskah berikutnya gagal akan menyimpan
        // sebagian -- tertangkap oleh verify/r5h7-flow.js.
        const when = jakartaStamp(new Date())
        const code = storedHash.slice(0, 8).toUpperCase()
        const results = []
        for (const file of files.rows) {
          if (sha256(file.file_data) !== file.sha256) return { kind: 'integrity_mismatch' }
          try {
            results.push({ file, signed: await signPdf(file.file_data, image, plan.get(file.id), { signer: signerName, when, code }) })
          } catch (error) {
            if (error instanceof PdfUnreadableError) return { kind: 'pdf_unreadable', file: file.file_name, reason: error.message }
            throw error
          }
        }
        for (const { file, signed } of results) {
          await client.query(
            `INSERT INTO sdl_outgoing_signed_files
               (register_id,source_file_id,source_sha256,file_name,byte_size,sha256,file_data,placements,signed_by)
             VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8::jsonb,$9::uuid)`,
            [id, file.id, file.sha256, signedName(file.file_name), signed.length, sha256(signed), signed,
              JSON.stringify(plan.get(file.id)), req.actor],
          )
        }

        if (!useSaved && saveAsMine === true) await storeSignature(client, config.evidenceKey, req.actor, image)

        const eventNote = (note || `Ditandatangani dan disetujui (${files.rows.length} naskah).`).slice(0, 500)
        await client.query(
          `UPDATE sdl_outgoing_workflows
              SET stage='approved',version=version+1,approved_at=now(),
                  last_actor=$2::uuid,last_note=$3,updated_at=now()
            WHERE register_id::text=$1`,
          [id, req.actor, eventNote],
        )
        await client.query(
          `INSERT INTO sdl_outgoing_events(register_id,actor_id,event_key,note)
           VALUES($1::uuid,$2::uuid,'approved',$3)`,
          [id, req.actor, eventNote],
        )
        return { kind: 'ok', signed: files.rows.length }
      })
    } catch (error) {
      if (error instanceof EvidenceKeyError) return fail(res, 503, 'signature_key_unavailable')
      sqlError(res, error)
      return
    }

    switch (outcome.kind) {
      case 'ok': return respond(res, 200, { ok: true, status: 'approved', signedFiles: outcome.signed })
      case 'workflow_state_changed':
      case 'document_integrity_changed':
      case 'already_signed':
      case 'pdf_required':
        return fail(res, 409, outcome.kind === 'pdf_required' ? 'pdf_required_before_submit' : outcome.kind)
      case 'placements_mismatch': return fail(res, 400, 'placements_mismatch')
      case 'integrity_mismatch': return fail(res, 503, 'integrity_mismatch')
      case 'pdf_unreadable': return respond(res, 422, { error: outcome.reason, file: outcome.file })
      default: return fail(res, 503, 'database_unavailable')
    }
  }))

  // ---- GET /:id/signed-files ----
  router.get('/:id/signed-files', handle(async (req, res) => {
    const id = req.params.id
    await loadOutgoing(req.actor, id, 'read')
    try {
      const { rows } = await pool.query(
        `SELECT s.id::text AS id,s.source_file_id::text AS source_file_id,s.file_name,s.byte_size,
                s.signed_at,u.display_name AS signer,jsonb_array_length(s.placements) AS marks
           FROM sdl_outgoing_signed_files s JOIN sdl_users u ON u.id=s.signed_by
          WHERE s.register_id::text=$1 ORDER BY s.signed_at,s.id`,
        [id],
      )
      respond(res, 200, {
        items: rows.map((r) => ({
          id: r.id, sourceFileId: r.source_file_id, name: r.file_name, size: r.byte_size,
          signedAt: r.signed_at, signer: r.signer, marks: r.marks,
        })),
      })
    } catch (error) {
      sqlError(res, error)
    }
  }))

  // ---- GET /:id/signed-files/:fileID ----
  router.get('/:id/signed-files/:fileID', handle(async (req, res) => {
    const id = req.params.id
    await loadOutgoing(req.actor, id, 'read')
    let row
    try {
      const { rows } = await pool.query(
        `SELECT file_name,sha256,file_data FROM sdl_outgoing_signed_files
          WHERE id::text=$1 AND register_id::text=$2`,
        [req.params.fileID, id],
      )
      if (rows.length === 0) throw new NotFoundError()
      row = rows[0]
    } catch (error) {
      sqlError(res, error)
      return
    }
    if (sha256(row.file_data) !== row.sha256) return fail(res, 503, 'integrity_mismatch')
    res.set('Content-Disposition', contentDisposition('attachment', row.file_name))
    res.set('Content-Type', 'application/pdf')
    res.set('Content-Length', String(row.file_data.length))
    res.set('Cache-Control', 'private, no-store')
    res.status(200).send(row.file_data)
  }))
}
