import { createHash } from 'node:crypto'

import { Router } from 'express'

import { openEvidence, sealEvidence } from '../../crypto/evidence.js'
import { withTransaction } from '../../db.js'
import { contentDisposition, detectFileType, readSingleFile } from '../../http/multipart.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { parseDateOnly, respond, fail, textOk } from '../subbagren/shared.js'
import { zipNames } from '../subbagren/myinterest-xlsx.js'
import { rakitNomorSurat } from '../unitwork/nomor-surat.js'
import { EvidenceKeyError } from '../../crypto/evidence.js'
import { cleanSignatureImage, jakartaStamp, loadSavedSignature, signedName, storeSignature } from '../unitwork/outgoing-sign.js'
import { MAX_PLACEMENTS_PER_FILE, PdfUnreadableError, cleanPlacement, signPdf } from '../unitwork/pdf-sign.js'
import { permit } from '../unitwork/permit.js'

/**
 * R5H21 (migrasi 064): persuratan antar-unit. EXPRESS SAJA.
 * Dipasang di /api/v1/persuratan. Tidak menyentuh endpoint Urmin yang ada (kontrak beku).
 *
 * Izin per unit lewat grant: role ber-izin `persuratan.read|manage` DI unit X membaca/
 * mengelola persuratan unit X. `persuratan.approve` (Kabagrenmin) menyetujui semua unit.
 *
 *   GET    /capabilities                         izin per unit + canApprove
 *   GET    /:unit/keluar                         surat keluar unit (read)
 *   POST   /:unit/keluar                         buat draf + nomor surat (manage; bukan urmin)
 *   PUT    /:unit/keluar/:id                     ubah draf/ditolak {perihal,tanggal,ringkasan,tujuanUnit[],tujuanEksternal,version}
 *   DELETE /:unit/keluar/:id                     hapus draf yang belum pernah diajukan
 *   POST   /:unit/keluar/:id/berkas?peran=naskah|lampiran   multipart `file` (naskah PDF; lampiran PDF/.xlsx/.docx)
 *   DELETE /:unit/keluar/:id/berkas/:bid
 *   GET    /:unit/keluar/:id/berkas/:bid         unduh (read unit pengirim)
 *   POST   /:unit/keluar/:id/ajukan              {version} butuh naskah + minimal satu tujuan
 *   GET    /persetujuan                          antrean diajukan (approve)
 *   POST   /keluar/:id/ttd-setujui               {version,note,image|useSaved,saveAsMine,placements} tanda tangan +
 *          setujui dalam SATU transaksi (pakai ulang R5H7: pdf-sign, tanda tangan tersimpan)  (approve)
 *   POST   /keluar/:id/tolak                     {catatan,version}  (approve)
 *   GET    /dari-urmin/:registryId               status kiriman internal surat keluar Urmin (read urmin)
 *   POST   /dari-urmin/:registryId               {tujuanUnit[]} surat keluar Urmin yang sudah DISETUJUI dikirim ke
 *          Surat Masuk subbag; naskah (bertanda tangan bila ada) disalin. Akses registry tetap lewat permit() Urmin.
 *   POST   /:unit/keluar/:id/kirim               {version} disetujui -> dikirim (manage)
 *   GET    /:unit/masuk                          surat dikirim ke unit ini (read)
 *   POST   /:unit/masuk/:id/terima               tandai diterima untuk unit ini (manage)
 *   GET    /:unit/masuk/:id/berkas/:bid          unduh (read unit penerima)
 */

const UNITS = ['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung']
const UNIT_LABEL = { urmin: 'Urmin', subbagren: 'Subbagren', subbagsumda: 'Subbagsumda', subbagbinfung: 'Subbagbinfung' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SAFE_NAME = /^[\p{L}\p{N} ._()\-,]{1,150}\.(pdf|xlsx|docx)$/iu
const MAX_FILE = 20 << 20
const MAX_LAMPIRAN = 10

const PERMIT_SQL = `SELECT EXISTS(
  SELECT 1 FROM sdl_users u
    JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$3
    JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=$3
         AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
    JOIN sdl_roles r ON r.role_key=g.role_key AND r.is_active AND r.role_key<>'superadmin'
    JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key=$2
   WHERE u.id::text=$1 AND u.is_active AND NOT u.must_change_password
     AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
) AS ok`

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}
function handle(fn) {
  return async (req, res) => {
    try { await fn(req, res) } catch (error) {
      if (error instanceof HttpError) { fail(res, error.status, error.code); return }
      if (error?.code === '23505') { fail(res, 409, 'duplicate'); return }
      if (error?.code === '23514') { fail(res, 400, 'invalid_input'); return }
      fail(res, 503, 'database_unavailable')
    }
  }
}
function body(req, keys) {
  const p = parsePayload(req, keys)
  if (!p.ok) throw new HttpError(400, 'invalid_body')
  return p.value
}
function text(v, min, max) {
  if (v === undefined || v === null) v = ''
  if (!textOk(v, min, max)) throw new HttpError(400, 'invalid_input')
  return v.trim()
}
function version(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}
function uid(raw) {
  if (!UUID_RE.test(String(raw))) throw new HttpError(404, 'not_found')
  return String(raw)
}
function unitOf(raw) {
  if (!UNITS.includes(raw)) throw new HttpError(404, 'not_found')
  return raw
}
function optDate(v) {
  if (v === undefined || v === null || v === '') return null
  const d = parseDateOnly(v)
  if (!d) throw new HttpError(400, 'invalid_input')
  return v
}
/** Daftar unit tujuan internal: unik, sah, bukan unit pengirim. */
function tujuanUnit(v, pengirim) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > UNITS.length) throw new HttpError(400, 'invalid_input')
  const out = [...new Set(v)]
  for (const u of out) if (!UNITS.includes(u) || u === pengirim) throw new HttpError(400, 'tujuan_tidak_sah')
  return out
}
async function audit(c, actor, event, subject) {
  await c.query('INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,$3,$4)',
    [actor, `persuratan.${event}`, 'persuratan.surat', subject])
}

const SURAT_COLS = `s.id::text,s.unit_pengirim,s.sumber,s.nomor,s.tanggal::text,s.perihal,s.sifat,s.jenis_surat,s.kode_arsip,s.ringkasan,
  s.tujuan_eksternal,s.status,s.review_note,s.version,s.created_at,s.updated_at,s.submitted_at,s.reviewed_at,s.sent_at,s.created_by::text,
  cu.display_name AS created_name,ru.display_name AS reviewed_name,su.display_name AS sent_name,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('unit',t.unit_key,'diterimaAt',t.diterima_at,'diterimaByName',tu.display_name) ORDER BY t.unit_key)
              FROM sdl_surat_antar_tujuan t LEFT JOIN sdl_users tu ON tu.id=t.diterima_by WHERE t.surat_id=s.id),'[]'::jsonb) AS tujuan,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',b.id::text,'peran',b.peran,'jenis',b.jenis,'filename',b.filename,'size',b.size_bytes,'uploadedAt',b.uploaded_at) ORDER BY b.peran,b.uploaded_at)
              FROM sdl_surat_antar_berkas b WHERE b.surat_id=s.id),'[]'::jsonb) AS berkas`
const SURAT_FROM = `FROM sdl_surat_antar s JOIN sdl_users cu ON cu.id=s.created_by
  LEFT JOIN sdl_users ru ON ru.id=s.reviewed_by LEFT JOIN sdl_users su ON su.id=s.sent_by`

function mapSurat(r) {
  return {
    id: r.id, unitPengirim: r.unit_pengirim, unitPengirimLabel: UNIT_LABEL[r.unit_pengirim], sumber: r.sumber,
    nomor: r.nomor, tanggal: r.tanggal, perihal: r.perihal, sifat: r.sifat, jenisSurat: r.jenis_surat, kodeArsip: r.kode_arsip,
    ringkasan: r.ringkasan, tujuanEksternal: r.tujuan_eksternal, status: r.status, reviewNote: r.review_note, version: r.version,
    createdAt: r.created_at, updatedAt: r.updated_at, submittedAt: r.submitted_at ?? null, reviewedAt: r.reviewed_at ?? null, sentAt: r.sent_at ?? null,
    createdBy: r.created_by, createdByName: r.created_name, reviewedByName: r.reviewed_name ?? null, sentByName: r.sent_name ?? null,
    tujuan: r.tujuan.map((t) => ({ ...t, label: UNIT_LABEL[t.unit] })), berkas: r.berkas,
  }
}

export function createPersuratanRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.USULAN)

  const can = async (actor, perm, unit) => (await pool.query(PERMIT_SQL, [actor, perm, unit])).rows[0].ok === true
  const canApprove = async (actor) => {
    for (const u of UNITS) if (await can(actor, 'persuratan.approve', u)) return true
    return false
  }
  const need = async (req, perm, unit) => { if (!(await can(req.actor, perm, unit))) throw new HttpError(403, 'access_denied') }

  /** Surat keluar milik unit, dikunci; 404 bila milik unit lain (cegah IDOR). */
  async function suratKeluar(c, unit, id, lock = true) {
    const r = await c.query(`SELECT id::text,unit_pengirim,status,version,submitted_at FROM sdl_surat_antar WHERE id=$1::uuid AND unit_pengirim=$2${lock ? ' FOR UPDATE' : ''}`, [id, unit])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    return r.rows[0]
  }
  const bisaDiubah = (s) => s.status === 'draft' || s.status === 'ditolak'
  async function bump(c, id, actor) {
    await c.query('UPDATE sdl_surat_antar SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, actor])
  }

  async function bacaBerkas(req, peran) {
    const up = await readSingleFile(req, { fieldName: 'file', maxBodyBytes: MAX_FILE + 65536, maxFileBytes: MAX_FILE, maxFiles: 2 })
    if (up.bodyExceeded || up.error === 'too_large') throw new HttpError(413, 'file_too_large')
    if (up.fileCount !== 1 || !up.file) throw new HttpError(400, 'one_file_required')
    const blob = up.file.buffer
    const filename = up.file.filename.trim()
    const m = SAFE_NAME.exec(filename)
    if (!m || blob.length === 0) throw new HttpError(400, 'invalid_file_type')
    const jenis = m[1].toLowerCase()
    if (peran === 'naskah' && jenis !== 'pdf') throw new HttpError(400, 'naskah_harus_pdf')
    let ok
    if (jenis === 'pdf') {
      const tail = blob.subarray(Math.max(0, blob.length - 2048))
      ok = detectFileType(blob) === 'application/pdf' && blob.subarray(0, 5).toString('latin1') === '%PDF-' && tail.includes('%%EOF')
    } else {
      const names = zipNames(blob)
      ok = Boolean(names) && names.has('[Content_Types].xml') && names.has(jenis === 'xlsx' ? 'xl/workbook.xml' : 'word/document.xml') &&
        ![...names].some((n) => /vbaProject\.bin$/i.test(n))
    }
    if (!ok) throw new HttpError(400, 'invalid_file_type')
    let sealed
    try { sealed = sealEvidence(evidenceKey, blob) } catch { throw new HttpError(503, 'evidence_encryption_unavailable') }
    return { blob, filename, jenis, sealed, digest: createHash('sha256').update(blob).digest('hex') }
  }
  async function kirimBerkas(res, row) {
    let plain
    try { plain = openEvidence(evidenceKey, row.body) } catch { throw new HttpError(503, 'evidence_integrity_failure') }
    if (createHash('sha256').update(plain).digest('hex') !== row.sha256) throw new HttpError(503, 'evidence_integrity_failure')
    res.set('Content-Type', 'application/octet-stream')
    res.set('Content-Disposition', contentDisposition('attachment', row.filename))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Security-Policy', 'sandbox')
    res.set('Cache-Control', 'no-store')
    res.status(200).end(plain)
  }

  router.get('/capabilities', handle(async (req, res) => {
    const units = {}
    for (const u of UNITS) {
      const [read, manage] = await Promise.all([can(req.actor, 'persuratan.read', u), can(req.actor, 'persuratan.manage', u)])
      units[u] = { read, manage }
    }
    respond(res, 200, { units, canApprove: await canApprove(req.actor) })
  }))

  // ---------------- Surat keluar ----------------
  router.get('/:unit/keluar', handle(async (req, res) => {
    const unit = unitOf(req.params.unit)
    await need(req, 'persuratan.read', unit)
    const rows = (await pool.query(`SELECT ${SURAT_COLS} ${SURAT_FROM} WHERE s.unit_pengirim=$1 ORDER BY s.created_at DESC LIMIT 500`, [unit])).rows
    respond(res, 200, { unit, items: rows.map(mapSurat) })
  }))

  router.post('/:unit/keluar', json, handle(async (req, res) => {
    const unit = unitOf(req.params.unit)
    await need(req, 'persuratan.manage', unit)
    // Urmin memakai Surat Keluar miliknya sendiri lalu "Kirim ke unit internal" (langkah 4).
    if (unit === 'urmin') throw new HttpError(409, 'pakai_surat_keluar_urmin')
    const v = body(req, ['perihal', 'tanggal', 'sifat', 'jenisSurat', 'kodeArsip', 'ringkasan', 'tujuanUnit', 'tujuanEksternal'])
    const perihal = text(v.perihal, 3, 240)
    const tanggal = optDate(v.tanggal)
    const sifat = v.sifat === 'Kilat' ? 'Kilat' : v.sifat === 'Biasa' || v.sifat === undefined ? 'Biasa' : null
    if (!sifat) throw new HttpError(400, 'invalid_input')
    const jenisSurat = text(v.jenisSurat, 1, 12); const kodeArsip = text(v.kodeArsip, 1, 16)
    const ringkasan = text(v.ringkasan, 0, 2000); const eksternal = text(v.tujuanEksternal, 0, 500)
    const tujuan = tujuanUnit(v.tujuanUnit, unit)
    const row = await withTransaction(pool, async (c) => {
      if (!(await c.query('SELECT 1 FROM sdl_surat_jenis WHERE code=$1', [jenisSurat])).rowCount) throw new HttpError(400, 'jenis_surat_tidak_dikenal')
      if (!(await c.query('SELECT 1 FROM sdl_surat_kode_arsip WHERE code=$1', [kodeArsip])).rowCount) throw new HttpError(400, 'kode_arsip_tidak_dikenal')
      // Nomor diberikan saat draf dibuat (keputusan penomoran Bagrenmin, docs/PENOMORAN-SURAT-KELUAR.md).
      const nomor = await rakitNomorSurat(c, { sifatSurat: sifat, jenisSurat, kodeArsip, unitNomor: UNIT_LABEL[unit] }, new Date())
      const r = (await c.query(
        `INSERT INTO sdl_surat_antar(unit_pengirim,nomor,tanggal,perihal,sifat,jenis_surat,kode_arsip,ringkasan,tujuan_eksternal,created_by,updated_by)
         VALUES($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id::text,nomor`,
        [unit, nomor, tanggal, perihal, sifat, jenisSurat, kodeArsip, ringkasan, eksternal, req.actor])).rows[0]
      for (const t of tujuan) await c.query('INSERT INTO sdl_surat_antar_tujuan(surat_id,unit_key) VALUES($1::uuid,$2)', [r.id, t])
      await audit(c, req.actor, 'create', r.id)
      return r
    })
    respond(res, 201, { id: row.id, nomor: row.nomor })
  }))

  router.put('/:unit/keluar/:id', json, handle(async (req, res) => {
    const unit = unitOf(req.params.unit); const id = uid(req.params.id)
    await need(req, 'persuratan.manage', unit)
    const v = body(req, ['perihal', 'tanggal', 'ringkasan', 'tujuanUnit', 'tujuanEksternal', 'version'])
    const perihal = text(v.perihal, 3, 240); const tanggal = optDate(v.tanggal)
    const ringkasan = text(v.ringkasan, 0, 2000); const eksternal = text(v.tujuanEksternal, 0, 500)
    const tujuan = tujuanUnit(v.tujuanUnit, unit); const ver = version(v.version)
    await withTransaction(pool, async (c) => {
      const s = await suratKeluar(c, unit, id)
      if (s.version !== ver) throw new HttpError(409, 'version_conflict')
      if (!bisaDiubah(s)) throw new HttpError(409, 'surat_terkunci')
      await c.query('UPDATE sdl_surat_antar SET perihal=$2,tanggal=$3::date,ringkasan=$4,tujuan_eksternal=$5 WHERE id=$1::uuid', [id, perihal, tanggal, ringkasan, eksternal])
      await c.query('DELETE FROM sdl_surat_antar_tujuan WHERE surat_id=$1::uuid', [id])
      for (const t of tujuan) await c.query('INSERT INTO sdl_surat_antar_tujuan(surat_id,unit_key) VALUES($1::uuid,$2)', [id, t])
      await bump(c, id, req.actor)
      await audit(c, req.actor, 'update', id)
    })
    respond(res, 200, { ok: true })
  }))

  router.delete('/:unit/keluar/:id', handle(async (req, res) => {
    const unit = unitOf(req.params.unit); const id = uid(req.params.id)
    await need(req, 'persuratan.manage', unit)
    await withTransaction(pool, async (c) => {
      const s = await suratKeluar(c, unit, id)
      // Surat yang pernah diajukan tetap ada sebagai jejak; hanya draf murni yang boleh dihapus.
      if (s.status !== 'draft' || s.submitted_at !== null) throw new HttpError(409, 'surat_terkunci')
      await c.query('DELETE FROM sdl_surat_antar WHERE id=$1::uuid', [id])
      await audit(c, req.actor, 'delete', id)
    })
    respond(res, 200, { ok: true })
  }))

  router.post('/:unit/keluar/:id/berkas', handle(async (req, res) => {
    const unit = unitOf(req.params.unit); const id = uid(req.params.id)
    const peran = String(req.query.peran ?? '')
    if (peran !== 'naskah' && peran !== 'lampiran') throw new HttpError(400, 'invalid_input')
    await need(req, 'persuratan.manage', unit)
    // Periksa keberadaan & kunci SEBELUM membaca berkas besar.
    await withTransaction(pool, async (c) => { if (!bisaDiubah(await suratKeluar(c, unit, id))) throw new HttpError(409, 'surat_terkunci') })
    const f = await bacaBerkas(req, peran)
    const row = await withTransaction(pool, async (c) => {
      if (!bisaDiubah(await suratKeluar(c, unit, id))) throw new HttpError(409, 'surat_terkunci')
      if (peran === 'naskah') {
        // Satu naskah per surat: unggahan baru menggantikan yang lama.
        await c.query("DELETE FROM sdl_surat_antar_berkas WHERE surat_id=$1::uuid AND peran='naskah'", [id])
      } else {
        const n = await c.query("SELECT count(*)::int AS n FROM sdl_surat_antar_berkas WHERE surat_id=$1::uuid AND peran='lampiran'", [id])
        if (n.rows[0].n >= MAX_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      }
      const r = (await c.query(
        `INSERT INTO sdl_surat_antar_berkas(surat_id,peran,jenis,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`,
        [id, peran, f.jenis, f.filename, f.blob.length, f.digest, f.sealed, req.actor])).rows[0]
      await bump(c, id, req.actor)
      await audit(c, req.actor, `berkas.${peran}`, id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: f.digest })
  }))

  router.delete('/:unit/keluar/:id/berkas/:bid', handle(async (req, res) => {
    const unit = unitOf(req.params.unit); const id = uid(req.params.id); const bid = uid(req.params.bid)
    await need(req, 'persuratan.manage', unit)
    await withTransaction(pool, async (c) => {
      if (!bisaDiubah(await suratKeluar(c, unit, id))) throw new HttpError(409, 'surat_terkunci')
      const r = await c.query("DELETE FROM sdl_surat_antar_berkas WHERE id=$1::uuid AND surat_id=$2::uuid AND peran<>'naskah_ttd'", [bid, id])
      if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
      await bump(c, id, req.actor)
      await audit(c, req.actor, 'berkas.delete', id)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/:unit/keluar/:id/berkas/:bid', handle(async (req, res) => {
    const unit = unitOf(req.params.unit); const id = uid(req.params.id); const bid = uid(req.params.bid)
    await need(req, 'persuratan.read', unit)
    const r = await pool.query(
      `SELECT b.filename,b.sha256,b.body FROM sdl_surat_antar_berkas b JOIN sdl_surat_antar s ON s.id=b.surat_id
        WHERE b.id=$1::uuid AND s.id=$2::uuid AND s.unit_pengirim=$3`, [bid, id, unit])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    await withTransaction(pool, (c) => audit(c, req.actor, 'berkas.download', id))
    await kirimBerkas(res, r.rows[0])
  }))

  router.post('/:unit/keluar/:id/ajukan', json, handle(async (req, res) => {
    const unit = unitOf(req.params.unit); const id = uid(req.params.id)
    await need(req, 'persuratan.manage', unit)
    const ver = version(body(req, ['version']).version)
    await withTransaction(pool, async (c) => {
      const s = await suratKeluar(c, unit, id)
      if (s.version !== ver) throw new HttpError(409, 'version_conflict')
      if (!bisaDiubah(s)) throw new HttpError(409, 'surat_terkunci')
      const cek = (await c.query(
        `SELECT EXISTS(SELECT 1 FROM sdl_surat_antar_berkas WHERE surat_id=$1::uuid AND peran='naskah') AS naskah,
                EXISTS(SELECT 1 FROM sdl_surat_antar_tujuan WHERE surat_id=$1::uuid) OR (SELECT tujuan_eksternal<>'' FROM sdl_surat_antar WHERE id=$1::uuid) AS tujuan`, [id])).rows[0]
      if (!cek.naskah) throw new HttpError(409, 'naskah_belum_ada')
      if (!cek.tujuan) throw new HttpError(409, 'tujuan_belum_ada')
      await c.query("UPDATE sdl_surat_antar SET status='diajukan',review_note='',submitted_by=$2,submitted_at=now() WHERE id=$1::uuid", [id, req.actor])
      await bump(c, id, req.actor)
      await audit(c, req.actor, 'ajukan', id)
    })
    respond(res, 200, { ok: true, status: 'diajukan' })
  }))

  router.get('/persetujuan', handle(async (req, res) => {
    if (!(await canApprove(req.actor))) throw new HttpError(403, 'access_denied')
    const rows = (await pool.query(`SELECT ${SURAT_COLS} ${SURAT_FROM} WHERE s.status='diajukan' ORDER BY s.submitted_at`)).rows
    respond(res, 200, { items: rows.map(mapSurat) })
  }))

  async function putuskan(req, res, keputusan) {
    if (!(await canApprove(req.actor))) throw new HttpError(403, 'access_denied')
    const id = uid(req.params.id)
    const v = body(req, ['catatan', 'version'])
    const catatan = text(v.catatan, 8, 500)
    const ver = version(v.version)
    await withTransaction(pool, async (c) => {
      const r = await c.query('SELECT status,version FROM sdl_surat_antar WHERE id=$1::uuid FOR UPDATE', [id])
      if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
      if (r.rows[0].version !== ver) throw new HttpError(409, 'version_conflict')
      if (r.rows[0].status !== 'diajukan') throw new HttpError(409, 'surat_bukan_diajukan')
      await c.query('UPDATE sdl_surat_antar SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1::uuid', [id, keputusan, catatan, req.actor])
      await bump(c, id, req.actor)
      await audit(c, req.actor, 'tolak', id)
    })
    respond(res, 200, { ok: true, status: keputusan })
  }
  router.post('/keluar/:id/tolak', json, handle((req, res) => putuskan(req, res, 'ditolak')))

  // R5H21 langkah 3: persetujuan SELALU dengan tanda tangan Kabagrenmin (seperti Urmin R5H7).
  const ttdJson = rawBody(BODY_LIMITS.TTD)
  router.post('/keluar/:id/ttd-setujui', ttdJson, handle(async (req, res) => {
    if (!(await canApprove(req.actor))) throw new HttpError(403, 'access_denied')
    const id = uid(req.params.id)
    const v = body(req, ['version', 'note', 'image', 'useSaved', 'saveAsMine', 'placements'])
    const ver = version(v.version)
    const note = v.note === undefined ? '' : text(v.note, 0, 500)
    if (typeof v.useSaved !== 'boolean' || (v.saveAsMine !== undefined && typeof v.saveAsMine !== 'boolean')) throw new HttpError(400, 'invalid_input')
    if (v.placements === null || typeof v.placements !== 'object' || Array.isArray(v.placements)) throw new HttpError(400, 'invalid_input')
    const plan = new Map()
    for (const [fileId, list] of Object.entries(v.placements)) {
      if (!UUID_RE.test(fileId) || !Array.isArray(list) || list.length === 0 || list.length > MAX_PLACEMENTS_PER_FILE) throw new HttpError(400, 'invalid_placements')
      const clean = list.map(cleanPlacement)
      if (clean.some((x) => x === null)) throw new HttpError(400, 'invalid_placements')
      plan.set(fileId.toLowerCase(), clean)
    }
    if (plan.size === 0) throw new HttpError(400, 'invalid_placements')
    let image
    try {
      if (v.useSaved) {
        if (v.image !== undefined) throw new HttpError(400, 'invalid_input')
        const saved = await loadSavedSignature(pool, evidenceKey, req.actor)
        if (!saved) throw new HttpError(409, 'no_saved_signature')
        image = saved.image
      } else {
        image = await cleanSignatureImage(v.image)
        if (!image) throw new HttpError(400, 'invalid_signature_image')
      }
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, error instanceof EvidenceKeyError ? 'signature_key_unavailable' : 'signature_unavailable')
    }
    const signer = (await pool.query('SELECT display_name FROM sdl_users WHERE id::text=$1', [req.actor])).rows[0]?.display_name ?? 'Kabagrenmin'
    const out = await withTransaction(pool, async (c) => {
      const r = await c.query('SELECT status,version FROM sdl_surat_antar WHERE id=$1::uuid FOR UPDATE', [id])
      if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
      if (r.rows[0].version !== ver) throw new HttpError(409, 'version_conflict')
      if (r.rows[0].status !== 'diajukan') throw new HttpError(409, 'surat_bukan_diajukan')
      const naskah = (await c.query("SELECT id::text,filename,sha256,body FROM sdl_surat_antar_berkas WHERE surat_id=$1::uuid AND peran='naskah' ORDER BY uploaded_at", [id])).rows
      if (naskah.length === 0) throw new HttpError(409, 'naskah_belum_ada')
      // Setiap naskah wajib bertanda tangan; tidak boleh ada penempatan untuk berkas lain.
      if (plan.size !== naskah.length || naskah.some((n) => !plan.has(n.id))) throw new HttpError(400, 'placements_mismatch')
      const when = jakartaStamp(new Date())
      const hasil = []
      for (const n of naskah) {
        let plain
        try { plain = openEvidence(evidenceKey, n.body) } catch { throw new HttpError(503, 'evidence_integrity_failure') }
        if (createHash('sha256').update(plain).digest('hex') !== n.sha256) throw new HttpError(503, 'evidence_integrity_failure')
        let signed
        try { signed = await signPdf(plain, image, plan.get(n.id), { signer, when, code: n.sha256.slice(0, 8).toUpperCase() }) } catch (error) {
          if (error instanceof PdfUnreadableError) throw new HttpError(422, error.message)
          throw error
        }
        if (signed.length > MAX_FILE) throw new HttpError(413, 'file_too_large')
        let sealed
        try { sealed = sealEvidence(evidenceKey, signed) } catch { throw new HttpError(503, 'evidence_encryption_unavailable') }
        hasil.push({ n, signed, sealed })
      }
      // Semua naskah ditandatangani di memori dulu, baru ditulis (tidak ada hasil setengah jadi).
      for (const { n, signed, sealed } of hasil) {
        await c.query(
          `INSERT INTO sdl_surat_antar_berkas(surat_id,peran,jenis,filename,size_bytes,sha256,body,uploaded_by)
           VALUES($1::uuid,'naskah_ttd','pdf',$2,$3,$4,$5,$6)`,
          [id, signedName(n.filename).slice(-160), signed.length, createHash('sha256').update(signed).digest('hex'), sealed, req.actor])
      }
      if (!v.useSaved && v.saveAsMine === true) await storeSignature(c, evidenceKey, req.actor, image)
      await c.query("UPDATE sdl_surat_antar SET status='disetujui',review_note=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1::uuid", [id, note, req.actor])
      await bump(c, id, req.actor)
      await audit(c, req.actor, 'ttd-setujui', id)
      return { signedFiles: hasil.length }
    })
    respond(res, 200, { ok: true, status: 'disetujui', signedFiles: out.signedFiles })
  }))

  // ---------------- R5H21 langkah 4: surat keluar Urmin -> unit internal ----------------
  async function registryUrmin(c, actor, rid, action = 'read') {
    const r = await c.query(
      `SELECT s.id::text,s.title,s.fields,w.classification,w.created_by::text AS owner,s.work_record_id::text AS work_record_id,
              COALESCE(o.stage,'draft') AS stage
         FROM sdl_urmin_registry s JOIN sdl_unit_work_records w ON w.id=s.work_record_id
         LEFT JOIN sdl_outgoing_workflows o ON o.register_id=s.id
        WHERE s.id=$1::uuid AND s.kind='surat_keluar' AND s.deleted_at IS NULL AND w.deleted_at IS NULL AND w.unit_key='urmin'`, [rid])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    const x = r.rows[0]
    // Hak baca registry tetap ditentukan Engine B Urmin (scope own/unit), bukan oleh modul ini.
    const ok = await permit(pool, actor, { unit: 'urmin', classification: x.classification, owner: x.owner, recordId: x.work_record_id, action })
    if (!ok) throw new HttpError(404, 'not_found')
    return x
  }

  router.get('/dari-urmin/:rid', handle(async (req, res) => {
    await need(req, 'persuratan.read', 'urmin')
    const rid = uid(req.params.rid)
    await registryUrmin(pool, req.actor, rid)
    const rows = (await pool.query(`SELECT ${SURAT_COLS} ${SURAT_FROM} WHERE s.urmin_registry_id=$1::uuid`, [rid])).rows
    respond(res, 200, { item: rows[0] ? mapSurat(rows[0]) : null })
  }))

  router.post('/dari-urmin/:rid', json, handle(async (req, res) => {
    await need(req, 'persuratan.manage', 'urmin')
    const rid = uid(req.params.rid)
    const v = body(req, ['tujuanUnit'])
    const tujuan = tujuanUnit(v.tujuanUnit, 'urmin')
    if (tujuan.length === 0) throw new HttpError(400, 'tujuan_belum_ada')
    const row = await withTransaction(pool, async (c) => {
      // Mengirim atas nama Urmin = mengelola surat itu: butuh hak 'edit' (pemilik atau scope unit).
      const x = await registryUrmin(c, req.actor, rid, 'edit')
      await c.query('SELECT 1 FROM sdl_urmin_registry WHERE id=$1::uuid FOR UPDATE', [rid])
      if (x.stage !== 'approved') throw new HttpError(409, 'surat_belum_disetujui')
      // Surat berklasifikasi Rahasia tidak disebar ke seluruh staf unit tujuan.
      if (x.classification === 'penting') throw new HttpError(409, 'surat_rahasia')
      if ((await c.query('SELECT 1 FROM sdl_surat_antar WHERE urmin_registry_id=$1::uuid', [rid])).rowCount) throw new HttpError(409, 'sudah_dikirim')
      const f = x.fields ?? {}
      const signed = (await c.query('SELECT file_name,sha256,file_data FROM sdl_outgoing_signed_files WHERE register_id=$1::uuid ORDER BY signed_at,id', [rid])).rows
      const naskah = signed.length ? signed : (await c.query(
        `SELECT file_name,sha256,file_data FROM sdl_unit_work_files
          WHERE record_id=$1::uuid AND removed_at IS NULL AND purpose='lampiran' AND media_type='application/pdf' ORDER BY created_at,id`, [x.work_record_id])).rows
      if (naskah.length === 0) throw new HttpError(409, 'naskah_belum_ada')
      const perihal = String(f.perihal || x.title || 'Surat keluar Urmin').trim().slice(0, 240)
      const tanggal = typeof f.tanggalSurat === 'string' && parseDateOnly(f.tanggalSurat) ? f.tanggalSurat : null
      const r = (await c.query(
        `INSERT INTO sdl_surat_antar(unit_pengirim,sumber,urmin_registry_id,nomor,tanggal,perihal,sifat,jenis_surat,kode_arsip,ringkasan,status,
                                     created_by,updated_by,sent_by,sent_at)
         VALUES('urmin','urmin_registry',$1::uuid,$2,$3::date,$4,$5,$6,$7,$8,'dikirim',$9,$9,$9,now()) RETURNING id::text`,
        [rid, String(f.nomorSurat ?? '').slice(0, 120), tanggal, perihal.length >= 3 ? perihal : 'Surat keluar Urmin',
          f.sifatSurat === 'Kilat' ? 'Kilat' : 'Biasa', String(f.jenisSurat ?? '').slice(0, 40), String(f.kodeArsip ?? '').slice(0, 60),
          f.tujuan ? `Kepada: ${String(f.tujuan).slice(0, 1900)}` : '', req.actor])).rows[0]
      for (const t of tujuan) await c.query('INSERT INTO sdl_surat_antar_tujuan(surat_id,unit_key) VALUES($1::uuid,$2)', [r.id, t])
      for (const n of naskah) {
        if (createHash('sha256').update(n.file_data).digest('hex') !== n.sha256) throw new HttpError(503, 'evidence_integrity_failure')
        if (n.file_data.length > MAX_FILE) throw new HttpError(413, 'file_too_large')
        let sealed
        try { sealed = sealEvidence(evidenceKey, n.file_data) } catch { throw new HttpError(503, 'evidence_encryption_unavailable') }
        await c.query(
          `INSERT INTO sdl_surat_antar_berkas(surat_id,peran,jenis,filename,size_bytes,sha256,body,uploaded_by)
           VALUES($1::uuid,$2,'pdf',$3,$4,$5,$6,$7)`,
          [r.id, signed.length ? 'naskah_ttd' : 'naskah', String(n.file_name).slice(-160), n.file_data.length, n.sha256, sealed, req.actor])
      }
      await audit(c, req.actor, 'dari-urmin', r.id)
      return r
    })
    respond(res, 201, { id: row.id })
  }))

  router.post('/:unit/keluar/:id/kirim', json, handle(async (req, res) => {
    const unit = unitOf(req.params.unit); const id = uid(req.params.id)
    await need(req, 'persuratan.manage', unit)
    const ver = version(body(req, ['version']).version)
    await withTransaction(pool, async (c) => {
      const s = await suratKeluar(c, unit, id)
      if (s.version !== ver) throw new HttpError(409, 'version_conflict')
      if (s.status !== 'disetujui') throw new HttpError(409, 'surat_belum_disetujui')
      await c.query("UPDATE sdl_surat_antar SET status='dikirim',sent_by=$2,sent_at=now() WHERE id=$1::uuid", [id, req.actor])
      await bump(c, id, req.actor)
      await audit(c, req.actor, 'kirim', id)
    })
    respond(res, 200, { ok: true, status: 'dikirim' })
  }))

  // ---------------- Surat masuk ----------------
  router.get('/:unit/masuk', handle(async (req, res) => {
    const unit = unitOf(req.params.unit)
    await need(req, 'persuratan.read', unit)
    const rows = (await pool.query(
      `SELECT ${SURAT_COLS},t.diterima_at AS saya_diterima_at,tu.display_name AS saya_diterima_name ${SURAT_FROM}
         JOIN sdl_surat_antar_tujuan t ON t.surat_id=s.id AND t.unit_key=$1 LEFT JOIN sdl_users tu ON tu.id=t.diterima_by
        WHERE s.status='dikirim' ORDER BY s.sent_at DESC LIMIT 500`, [unit])).rows
    respond(res, 200, {
      unit,
      items: rows.map((r) => {
        const m = mapSurat(r)
        // Penerima hanya melihat naskah final (bertanda tangan bila ada) dan lampiran.
        const ttd = m.berkas.some((b) => b.peran === 'naskah_ttd')
        return { ...m, berkas: m.berkas.filter((b) => b.peran === 'lampiran' || b.peran === (ttd ? 'naskah_ttd' : 'naskah')), diterimaAt: r.saya_diterima_at ?? null, diterimaByName: r.saya_diterima_name ?? null }
      }),
    })
  }))

  router.post('/:unit/masuk/:id/terima', json, handle(async (req, res) => {
    const unit = unitOf(req.params.unit); const id = uid(req.params.id)
    await need(req, 'persuratan.manage', unit)
    await withTransaction(pool, async (c) => {
      const r = await c.query(
        `SELECT t.diterima_at FROM sdl_surat_antar_tujuan t JOIN sdl_surat_antar s ON s.id=t.surat_id AND s.status='dikirim'
          WHERE t.surat_id=$1::uuid AND t.unit_key=$2 FOR UPDATE OF t`, [id, unit])
      if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
      if (r.rows[0].diterima_at) throw new HttpError(409, 'sudah_diterima')
      await c.query('UPDATE sdl_surat_antar_tujuan SET diterima_at=now(),diterima_by=$3 WHERE surat_id=$1::uuid AND unit_key=$2', [id, unit, req.actor])
      await audit(c, req.actor, `terima.${unit}`, id)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/:unit/masuk/:id/berkas/:bid', handle(async (req, res) => {
    const unit = unitOf(req.params.unit); const id = uid(req.params.id); const bid = uid(req.params.bid)
    await need(req, 'persuratan.read', unit)
    const r = await pool.query(
      `SELECT b.filename,b.sha256,b.body FROM sdl_surat_antar_berkas b
         JOIN sdl_surat_antar s ON s.id=b.surat_id AND s.status='dikirim'
         JOIN sdl_surat_antar_tujuan t ON t.surat_id=s.id AND t.unit_key=$3
        WHERE b.id=$1::uuid AND s.id=$2::uuid
          -- Penerima hanya mendapat naskah final: naskah asli disembunyikan bila versi bertanda tangan ada.
          AND (b.peran<>'naskah' OR NOT EXISTS(SELECT 1 FROM sdl_surat_antar_berkas x WHERE x.surat_id=s.id AND x.peran='naskah_ttd'))`, [bid, id, unit])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    await withTransaction(pool, (c) => audit(c, req.actor, 'masuk.download', id))
    await kirimBerkas(res, r.rows[0])
  }))

  return router
}
