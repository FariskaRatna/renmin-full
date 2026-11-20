import { createHash } from 'node:crypto'

import { openEvidence, sealEvidence } from '../../crypto/evidence.js'
import { withTransaction } from '../../db.js'
import { contentDisposition, detectFileType, readSingleFile } from '../../http/multipart.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { zipNames } from '../subbagren/myinterest-xlsx.js'
import { UUID_RE, isKabag, respond } from './shared.js'

/**
 * R5H23 (migrasi 066): tindak lanjut arahan/disposisi oleh penerima. EXPRESS SAJA;
 * rute baru di router /leadership/directives, kontrak #87-#97 tidak berubah.
 *
 *   GET    /:id/tindak-lanjut                    semua laporan tindak lanjut arahan ini
 *   PUT    /:id/tindak-lanjut                    {isi,version} laporan milik penerima (version 0 = baru)
 *   POST   /:id/tindak-lanjut/berkas             multipart `file` (PDF/PNG/JPG/.xlsx/.docx <= 20 MB, maks 10)
 *   DELETE /:id/tindak-lanjut/berkas/:fid        hapus lampiran milik sendiri
 *   GET    /:id/tindak-lanjut/berkas/:fid        unduh
 *
 * Keputusan pemilik (2026-11-19): satu laporan per penerima yang bisa diubah; baru bisa
 * diisi SETELAH arahan diterima; terlihat oleh pemberi arahan (selama masih Kabagrenmin,
 * sama dengan aturan GET /:id) dan semua penerima arahan yang sama; tanpa status Selesai.
 */

const MAX_FILE = 20 << 20
const MAX_FILES = 10
const SAFE_NAME = /^[\p{L}\p{N} ._()\-,]{1,170}\.(pdf|png|jpe?g|xlsx|docx)$/iu

class Fail extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}
function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res) } catch (error) {
      if (error instanceof Fail) { res.set('Cache-Control', 'no-store'); res.status(error.status).json({ error: error.code }); return }
      if (error?.code === '23514') { res.status(400).json({ error: 'invalid_input' }); return }
      res.status(503).json({ error: 'database_unavailable' })
    }
  }
}
function uid(raw) {
  if (!UUID_RE.test(String(raw))) throw new Fail(404, 'not_found')
  return String(raw)
}
async function audit(c, actor, event, subject) {
  await c.query('INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,$3,$4)',
    [actor, `leadership.directive.tindak_lanjut.${event}`, 'leadership.directive', subject])
}

export function registerTindakLanjut(router, { pool, config }) {
  const evidenceKey = config?.evidenceKey
  const json = rawBody(BODY_LIMITS.USULAN)

  /** Peran aktor pada arahan: 'penerima' (+ sudah diterima?), 'penerbit', atau 404. */
  async function peran(runner, actor, did) {
    const r = await runner.query(
      `SELECT d.issuer_id::text AS issuer,
              (SELECT acknowledged_at FROM sdl_leadership_directive_recipients WHERE directive_id=d.id AND recipient_id=$2::uuid) AS ack,
              EXISTS(SELECT 1 FROM sdl_leadership_directive_recipients WHERE directive_id=d.id AND recipient_id=$2::uuid) AS penerima
         FROM sdl_leadership_directives d WHERE d.id=$1::uuid`, [did, actor])
    if (r.rowCount !== 1) throw new Fail(404, 'not_found')
    const x = r.rows[0]
    if (x.penerima) return { penerima: true, diterima: x.ack !== null }
    // Penerbit hanya selama masih Kabagrenmin -- sama dengan GET /:id.
    if (x.issuer === actor) {
      let kabag
      try { kabag = await isKabag(runner, actor) } catch { throw new Fail(503, 'authorization_unavailable') }
      if (kabag) return { penerima: false, diterima: false }
    }
    throw new Fail(404, 'not_found')
  }
  const bolehTulis = (p) => { if (!p.penerima) throw new Fail(403, 'access_denied'); if (!p.diterima) throw new Fail(409, 'belum_diterima') }

  router.get('/:id/tindak-lanjut', wrap(async (req, res) => {
    const did = uid(req.params.id)
    const p = await peran(pool, req.actor, did)
    const rows = (await pool.query(
      `SELECT r.recipient_id::text AS recipient_id,u.display_name AS name,r.section_key,r.acknowledged_at,
              f.isi,f.version,f.updated_at,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id::text,'jenis',b.jenis,'filename',b.filename,'size',b.size_bytes,'uploadedAt',b.uploaded_at) ORDER BY b.uploaded_at,b.id)
                          FROM sdl_leadership_directive_followup_files b WHERE b.directive_id=r.directive_id AND b.recipient_id=r.recipient_id),'[]'::jsonb) AS berkas
         FROM sdl_leadership_directive_recipients r JOIN sdl_users u ON u.id=r.recipient_id
         LEFT JOIN sdl_leadership_directive_followups f ON f.directive_id=r.directive_id AND f.recipient_id=r.recipient_id
        WHERE r.directive_id=$1::uuid ORDER BY f.updated_at DESC NULLS LAST,u.display_name`, [did])).rows
    respond(res, 200, {
      bisaTulis: p.penerima && p.diterima,
      items: rows.map((r) => ({
        recipientId: r.recipient_id, name: r.name, section: r.section_key ?? null, acknowledgedAt: r.acknowledged_at ?? null,
        milikSaya: r.recipient_id === req.actor, isi: r.isi ?? '', version: r.version ?? 0, updatedAt: r.updated_at ?? null, berkas: r.berkas,
      })),
    })
  }))

  router.put('/:id/tindak-lanjut', json, wrap(async (req, res) => {
    const did = uid(req.params.id)
    const p0 = parsePayload(req, ['isi', 'version'])
    if (!p0.ok) throw new Fail(400, 'invalid_body')
    const { isi, version } = p0.value
    if (typeof isi !== 'string' || [...isi.trim()].length > 4000 || !Number.isSafeInteger(version) || version < 0) throw new Fail(400, 'invalid_input')
    const out = await withTransaction(pool, async (c) => {
      bolehTulis(await peran(c, req.actor, did))
      const cur = await c.query('SELECT version FROM sdl_leadership_directive_followups WHERE directive_id=$1::uuid AND recipient_id=$2::uuid FOR UPDATE', [did, req.actor])
      if ((cur.rows[0]?.version ?? 0) !== version) throw new Fail(409, 'version_conflict')
      const r = await c.query(
        `INSERT INTO sdl_leadership_directive_followups(directive_id,recipient_id,isi) VALUES($1::uuid,$2::uuid,$3)
         ON CONFLICT (directive_id,recipient_id) DO UPDATE SET isi=EXCLUDED.isi,version=sdl_leadership_directive_followups.version+1,updated_at=now()
         RETURNING version`, [did, req.actor, isi.trim()])
      await audit(c, req.actor, 'simpan', did)
      return r.rows[0]
    })
    respond(res, 200, { ok: true, version: out.version })
  }))

  router.post('/:id/tindak-lanjut/berkas', wrap(async (req, res) => {
    const did = uid(req.params.id)
    // Periksa hak SEBELUM membaca berkas besar.
    bolehTulis(await peran(pool, req.actor, did))
    const up = await readSingleFile(req, { fieldName: 'file', maxBodyBytes: MAX_FILE + 65536, maxFileBytes: MAX_FILE, maxFiles: 2 })
    if (up.bodyExceeded || up.error === 'too_large') throw new Fail(413, 'file_too_large')
    if (up.fileCount !== 1 || !up.file) throw new Fail(400, 'one_file_required')
    const blob = up.file.buffer
    const filename = up.file.filename.trim()
    const m = SAFE_NAME.exec(filename)
    if (!m || blob.length === 0) throw new Fail(400, 'invalid_file_type')
    const ext = m[1].toLowerCase()
    const jenis = ext === 'jpeg' ? 'jpg' : ext
    let ok
    if (jenis === 'pdf') {
      const tail = blob.subarray(Math.max(0, blob.length - 4096))
      ok = detectFileType(blob) === 'application/pdf' && blob.subarray(0, 5).toString('latin1') === '%PDF-' && tail.includes('%%EOF')
    } else if (jenis === 'png' || jenis === 'jpg') {
      ok = detectFileType(blob) === (jenis === 'png' ? 'image/png' : 'image/jpeg')
    } else {
      const names = zipNames(blob)
      ok = Boolean(names) && names.has('[Content_Types].xml') && names.has(jenis === 'xlsx' ? 'xl/workbook.xml' : 'word/document.xml') &&
        ![...names].some((n) => /vbaProject\.bin$/i.test(n))
    }
    if (!ok) throw new Fail(400, 'invalid_file_type')
    let sealed
    try { sealed = sealEvidence(evidenceKey, blob) } catch { throw new Fail(503, 'evidence_encryption_unavailable') }
    const digest = createHash('sha256').update(blob).digest('hex')
    const row = await withTransaction(pool, async (c) => {
      bolehTulis(await peran(c, req.actor, did))
      // Laporan dibuat kosong bila penerima mengunggah lampiran sebelum menulis teks.
      await c.query(`INSERT INTO sdl_leadership_directive_followups(directive_id,recipient_id) VALUES($1::uuid,$2::uuid) ON CONFLICT DO NOTHING`, [did, req.actor])
      await c.query('SELECT 1 FROM sdl_leadership_directive_followups WHERE directive_id=$1::uuid AND recipient_id=$2::uuid FOR UPDATE', [did, req.actor])
      const n = await c.query('SELECT count(*)::int AS n FROM sdl_leadership_directive_followup_files WHERE directive_id=$1::uuid AND recipient_id=$2::uuid', [did, req.actor])
      if (n.rows[0].n >= MAX_FILES) throw new Fail(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_leadership_directive_followup_files(directive_id,recipient_id,jenis,filename,size_bytes,sha256,body)
         VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7) RETURNING id::text`, [did, req.actor, jenis, filename, blob.length, digest, sealed])).rows[0]
      await c.query('UPDATE sdl_leadership_directive_followups SET updated_at=now() WHERE directive_id=$1::uuid AND recipient_id=$2::uuid', [did, req.actor])
      await audit(c, req.actor, 'berkas.upload', did)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/tindak-lanjut/berkas/:fid', wrap(async (req, res) => {
    const did = uid(req.params.id); const fid = uid(req.params.fid)
    await withTransaction(pool, async (c) => {
      bolehTulis(await peran(c, req.actor, did))
      const r = await c.query('DELETE FROM sdl_leadership_directive_followup_files WHERE id=$1::uuid AND directive_id=$2::uuid AND recipient_id=$3::uuid', [fid, did, req.actor])
      if (r.rowCount !== 1) throw new Fail(404, 'not_found')
      await c.query('UPDATE sdl_leadership_directive_followups SET updated_at=now() WHERE directive_id=$1::uuid AND recipient_id=$2::uuid', [did, req.actor])
      await audit(c, req.actor, 'berkas.delete', did)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/:id/tindak-lanjut/berkas/:fid', wrap(async (req, res) => {
    const did = uid(req.params.id); const fid = uid(req.params.fid)
    await peran(pool, req.actor, did)
    const r = await pool.query('SELECT filename,sha256,body FROM sdl_leadership_directive_followup_files WHERE id=$1::uuid AND directive_id=$2::uuid', [fid, did])
    if (r.rowCount !== 1) throw new Fail(404, 'not_found')
    let plain
    try { plain = openEvidence(evidenceKey, r.rows[0].body) } catch { throw new Fail(503, 'evidence_integrity_failure') }
    if (createHash('sha256').update(plain).digest('hex') !== r.rows[0].sha256) throw new Fail(503, 'evidence_integrity_failure')
    await withTransaction(pool, (c) => audit(c, req.actor, 'berkas.download', did))
    res.set('Content-Type', 'application/octet-stream')
    res.set('Content-Disposition', contentDisposition('attachment', r.rows[0].filename))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Security-Policy', 'sandbox')
    res.set('Cache-Control', 'no-store')
    res.status(200).end(plain)
  }))
}
