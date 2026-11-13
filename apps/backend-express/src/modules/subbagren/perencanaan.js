import { createHash } from 'node:crypto'

import { Router } from 'express'

import { openEvidence, sealEvidence } from '../../crypto/evidence.js'
import { withTransaction } from '../../db.js'
import { contentDisposition, detectFileType, readSingleFile } from '../../http/multipart.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { buildXlsx } from '../../http/xlsx.js'
import { HttpError, PERMIT_SQL, audit, body, handle, id, text, version } from './progar.js'
import { parseDateOnly, parseGoInt, respond } from './shared.js'

/**
 * R5H13: Dokumen Perencanaan + Monitoring Kinerja & LKIP (migrasi 051).
 * EXPRESS SAJA. Hak akses memakai permission yang sama dengan Program Anggaran:
 *   subbagren.progar.read     baca semuanya, unduh berkas dan Excel LKIP
 *   subbagren.progar.manage   unggah dokumen, kelola indikator, isi capaian
 *   subbagren.dokumen.sahkan  sahkan/tolak dokumen yang diunggah ORANG LAIN
 *
 * Dokumen:
 *   GET    /dokumen?tahun=             daftar + info berkas + status revisi
 *   POST   /dokumen                    {tahun,jenis,judul,nomor,tanggal,programId,kegiatanId,keterangan,penggantiDari}
 *   PUT    /dokumen/:id                sama tanpa tahun/penggantiDari, + version (draft)
 *   POST   /dokumen/:id/berkas         multipart `file` PDF <= 20 MB (draft)
 *   GET    /dokumen/:id/berkas         unduh
 *   POST   /dokumen/:id/review         {keputusan:"disahkan"|"ditolak",catatan,version}
 * Kinerja:
 *   GET    /kinerja?tahun=             kegiatan + indikator + capaian TW I-IV + pagu/realisasi
 *   POST   /kinerja/indikator          {kegiatanId,nama,satuan,target:[tw1,tw2,tw3,tw4]}
 *   PUT    /kinerja/indikator/:id      {nama,satuan,target,version}
 *   DELETE /kinerja/indikator/:id      hanya bila belum ada capaian
 *   PUT    /kinerja/indikator/:id/capaian/:tw   {nilai,catatan}
 *   GET    /kinerja/lkip.xlsx?tahun=   rekap LKIP (Excel)
 *
 * Target dan capaian KUMULATIF s.d. akhir triwulan; TW IV = setahun. Angka
 * dikirim sebagai string desimal ("12.5"), dua angka di belakang koma.
 */

const JENIS = ['renstra', 'renja', 'rka_kl', 'dipa', 'revisi_dipa', 'pok', 'tor_kak', 'rab', 'lainnya']
const JENIS_LABEL = { renstra: 'Renstra', renja: 'Renja', rka_kl: 'RKA-K/L', dipa: 'DIPA', revisi_dipa: 'Revisi DIPA', pok: 'POK', tor_kak: 'TOR/KAK', rab: 'RAB', lainnya: 'Lainnya' }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEC_RE = /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$/
const MAX_DOC = 20 << 20
const SAFE_PDF_NAME = /^[\p{L}\p{N} ._()\-,]{1,150}\.pdf$/iu

function tahunParam(req) {
  const raw = String(req.query.tahun ?? '')
  const t = raw === '' ? new Date().getFullYear() : parseGoInt(raw)
  if (t === undefined || t < 2000 || t > 2100) throw new HttpError(400, 'invalid_year')
  return t
}
function dec(v) {
  if (typeof v !== 'string' || !DEC_RE.test(v)) throw new HttpError(400, 'invalid_input')
  return v
}
function optUuid(v) {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, 'invalid_input')
  return v
}
function optDate(v) {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !parseDateOnly(v)) throw new HttpError(400, 'invalid_input')
  return v
}

export function createPerencanaanRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.USULAN)
  const can = async (actor, p) => (await pool.query(PERMIT_SQL, [actor, p])).rows[0].ok === true
  const need = async (req, p) => { if (!(await can(req.actor, p))) throw new HttpError(403, 'access_denied') }

  router.get('/capabilities', handle(async (req, res) => {
    const [read, manage, sahkan] = await Promise.all([
      can(req.actor, 'subbagren.progar.read'), can(req.actor, 'subbagren.progar.manage'), can(req.actor, 'subbagren.dokumen.sahkan'),
    ])
    respond(res, 200, { canRead: read, canManage: manage, canSahkan: sahkan })
  }))

  // ================= Dokumen Perencanaan =================
  router.get('/dokumen', handle(async (req, res) => {
    await need(req, 'subbagren.progar.read')
    const tahun = tahunParam(req)
    const rows = (await pool.query(
      `SELECT d.id::text,d.tahun,d.jenis,d.judul,d.nomor,d.tanggal::text,d.keterangan,d.status,d.version,
              d.pengganti_dari::text,d.created_by::text,cu.display_name AS created_name,d.created_at,
              ru.display_name AS reviewed_name,d.reviewed_at,d.review_note,
              p.id::text AS program_id,p.kode AS program_kode,k.id::text AS kegiatan_id,k.kode AS kegiatan_kode,k.nama AS kegiatan_nama,
              b.filename,b.size_bytes,
              EXISTS(SELECT 1 FROM sdl_ren_dokumen x WHERE x.pengganti_dari=d.id AND x.status='disahkan') AS digantikan
         FROM sdl_ren_dokumen d
         JOIN sdl_users cu ON cu.id=d.created_by
         LEFT JOIN sdl_users ru ON ru.id=d.reviewed_by
         LEFT JOIN sdl_ren_program p ON p.id=d.program_id
         LEFT JOIN sdl_ren_kegiatan k ON k.id=d.kegiatan_id
         LEFT JOIN sdl_ren_dokumen_berkas b ON b.dokumen_id=d.id
        WHERE d.tahun=$1 ORDER BY d.jenis,d.created_at DESC`, [tahun])).rows
    respond(res, 200, {
      tahun,
      items: rows.map((r) => ({
        id: r.id, tahun: r.tahun, jenis: r.jenis, jenisLabel: JENIS_LABEL[r.jenis], judul: r.judul, nomor: r.nomor,
        tanggal: r.tanggal, keterangan: r.keterangan, status: r.status, version: r.version, penggantiDari: r.pengganti_dari,
        digantikan: r.digantikan, createdBy: r.created_by, createdByName: r.created_name, createdAt: r.created_at,
        reviewedByName: r.reviewed_name ?? null, reviewedAt: r.reviewed_at ?? null, reviewNote: r.review_note,
        program: r.program_id ? { id: r.program_id, kode: r.program_kode } : null,
        kegiatan: r.kegiatan_id ? { id: r.kegiatan_id, kode: r.kegiatan_kode, nama: r.kegiatan_nama } : null,
        berkas: r.filename ? { filename: r.filename, size: r.size_bytes } : null,
      })),
    })
  }))

  /** Program/kegiatan opsional harus ada dan setahun dengan dokumennya. */
  async function checkLinks(c, tahun, programId, kegiatanId) {
    if (programId) {
      const p = await c.query('SELECT tahun FROM sdl_ren_program WHERE id=$1::uuid AND deleted_at IS NULL', [programId])
      if (p.rowCount !== 1 || p.rows[0].tahun !== tahun) throw new HttpError(400, 'invalid_link')
    }
    if (kegiatanId) {
      const k = await c.query(
        `SELECT pr.tahun,k.program_id::text FROM sdl_ren_kegiatan k JOIN sdl_ren_program pr ON pr.id=k.program_id
          WHERE k.id=$1::uuid AND k.deleted_at IS NULL AND pr.deleted_at IS NULL`, [kegiatanId])
      if (k.rowCount !== 1 || k.rows[0].tahun !== tahun || (programId && k.rows[0].program_id !== programId)) throw new HttpError(400, 'invalid_link')
    }
  }
  function dokInput(v) {
    if (!JENIS.includes(v.jenis)) throw new HttpError(400, 'invalid_input')
    return {
      jenis: v.jenis, judul: text(v.judul, 3, 240), nomor: text(v.nomor, 0, 120), tanggal: optDate(v.tanggal),
      programId: optUuid(v.programId), kegiatanId: optUuid(v.kegiatanId), keterangan: text(v.keterangan, 0, 1000),
    }
  }

  router.post('/dokumen', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const v = body(req, ['tahun', 'jenis', 'judul', 'nomor', 'tanggal', 'programId', 'kegiatanId', 'keterangan', 'penggantiDari'])
    if (!Number.isSafeInteger(v.tahun) || v.tahun < 2000 || v.tahun > 2100) throw new HttpError(400, 'invalid_input')
    const d = dokInput(v)
    const pengganti = optUuid(v.penggantiDari)
    const row = await withTransaction(pool, async (c) => {
      await checkLinks(c, v.tahun, d.programId, d.kegiatanId)
      if (pengganti) {
        const o = await c.query('SELECT tahun,jenis,status FROM sdl_ren_dokumen WHERE id=$1::uuid FOR SHARE', [pengganti])
        if (o.rowCount !== 1) throw new HttpError(404, 'not_found')
        if (o.rows[0].status !== 'disahkan') throw new HttpError(409, 'revisi_hanya_dari_dokumen_sah')
        if (o.rows[0].tahun !== v.tahun || o.rows[0].jenis !== d.jenis) throw new HttpError(400, 'invalid_link')
      }
      let r
      try {
        r = (await c.query(
          `INSERT INTO sdl_ren_dokumen(tahun,jenis,judul,nomor,tanggal,program_id,kegiatan_id,keterangan,pengganti_dari,created_by)
           VALUES($1,$2,$3,$4,$5::date,$6::uuid,$7::uuid,$8,$9::uuid,$10) RETURNING id::text`,
          [v.tahun, d.jenis, d.judul, d.nomor, d.tanggal, d.programId, d.kegiatanId, d.keterangan, pengganti, req.actor])).rows[0]
      } catch (error) {
        if (error?.code === '23505') throw new HttpError(409, 'revisi_sudah_ada')
        throw error
      }
      await audit(c, req.actor, 'dokumen.create', 'dokumen', r.id)
      return r
    })
    respond(res, 201, { id: row.id })
  }))

  router.put('/dokumen/:id', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const did = id(req.params.id)
    const v = body(req, ['jenis', 'judul', 'nomor', 'tanggal', 'programId', 'kegiatanId', 'keterangan', 'version'])
    const d = dokInput(v); const ver = version(v.version)
    await withTransaction(pool, async (c) => {
      const cur = await c.query('SELECT status,version,tahun,jenis,pengganti_dari FROM sdl_ren_dokumen WHERE id=$1::uuid FOR UPDATE', [did])
      if (cur.rowCount !== 1) throw new HttpError(404, 'not_found')
      const o = cur.rows[0]
      if (o.status !== 'draft') throw new HttpError(409, 'dokumen_not_draft')
      if (o.version !== ver) throw new HttpError(409, 'version_conflict')
      // Revisi harus tetap berjenis sama dengan dokumen yang digantikannya.
      if (o.pengganti_dari && d.jenis !== o.jenis) throw new HttpError(400, 'invalid_link')
      await checkLinks(c, o.tahun, d.programId, d.kegiatanId)
      await c.query(
        `UPDATE sdl_ren_dokumen SET jenis=$2,judul=$3,nomor=$4,tanggal=$5::date,program_id=$6::uuid,kegiatan_id=$7::uuid,
                keterangan=$8,version=version+1,updated_at=now() WHERE id=$1::uuid`,
        [did, d.jenis, d.judul, d.nomor, d.tanggal, d.programId, d.kegiatanId, d.keterangan])
      await audit(c, req.actor, 'dokumen.update', 'dokumen', did)
    })
    respond(res, 200, { ok: true })
  }))

  router.post('/dokumen/:id/berkas', handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const did = id(req.params.id)
    const cur = await pool.query('SELECT status FROM sdl_ren_dokumen WHERE id=$1::uuid', [did])
    if (cur.rowCount !== 1) throw new HttpError(404, 'not_found')
    if (cur.rows[0].status !== 'draft') throw new HttpError(409, 'dokumen_not_draft')
    const up = await readSingleFile(req, { fieldName: 'file', maxBodyBytes: MAX_DOC + 65536, maxFileBytes: MAX_DOC, maxFiles: 2 })
    if (up.bodyExceeded || up.error === 'too_large') throw new HttpError(413, 'file_too_large')
    if (up.fileCount !== 1 || !up.file) throw new HttpError(400, 'one_file_required')
    const blob = up.file.buffer
    const filename = up.file.filename.trim()
    const tail = blob.subarray(Math.max(0, blob.length - 2048))
    const isPdf = SAFE_PDF_NAME.test(filename) && blob.length > 0 && detectFileType(blob) === 'application/pdf' &&
      blob.subarray(0, 5).toString('latin1') === '%PDF-' && tail.includes('%%EOF')
    if (!isPdf) throw new HttpError(400, 'invalid_file_type')
    let sealed
    try { sealed = sealEvidence(evidenceKey, blob) } catch { throw new HttpError(503, 'evidence_encryption_unavailable') }
    const digest = createHash('sha256').update(blob).digest('hex')
    await withTransaction(pool, async (c) => {
      const lock = await c.query('SELECT status FROM sdl_ren_dokumen WHERE id=$1::uuid FOR UPDATE', [did])
      if (lock.rows[0]?.status !== 'draft') throw new HttpError(409, 'dokumen_not_draft')
      await c.query(
        `INSERT INTO sdl_ren_dokumen_berkas(dokumen_id,filename,size_bytes,sha256,body,uploaded_by) VALUES($1::uuid,$2,$3,$4,$5,$6)
         ON CONFLICT (dokumen_id) DO UPDATE SET filename=EXCLUDED.filename,size_bytes=EXCLUDED.size_bytes,
           sha256=EXCLUDED.sha256,body=EXCLUDED.body,uploaded_by=EXCLUDED.uploaded_by,uploaded_at=now()`,
        [did, filename, blob.length, digest, sealed, req.actor])
      // Versi naik supaya pengesahan atas berkas lama ditolak (version_conflict).
      await c.query('UPDATE sdl_ren_dokumen SET version=version+1,updated_at=now() WHERE id=$1::uuid', [did])
      await audit(c, req.actor, 'dokumen.berkas.upload', 'dokumen', did)
    })
    respond(res, 201, { ok: true, sha256: digest })
  }))

  async function openBerkas(runner, did) {
    const r = await runner.query('SELECT filename,sha256,body FROM sdl_ren_dokumen_berkas WHERE dokumen_id=$1::uuid', [did])
    if (r.rowCount !== 1) return null
    let plain
    try { plain = openEvidence(evidenceKey, r.rows[0].body) } catch { throw new HttpError(503, 'evidence_integrity_failure') }
    if (createHash('sha256').update(plain).digest('hex') !== r.rows[0].sha256) throw new HttpError(503, 'evidence_integrity_failure')
    return { filename: r.rows[0].filename, plain }
  }

  router.get('/dokumen/:id/berkas', handle(async (req, res) => {
    await need(req, 'subbagren.progar.read')
    const did = id(req.params.id)
    const f = await openBerkas(pool, did)
    if (!f) throw new HttpError(404, 'not_found')
    await withTransaction(pool, (c) => audit(c, req.actor, 'dokumen.berkas.download', 'dokumen', did))
    res.set('Content-Type', 'application/octet-stream')
    res.set('Content-Disposition', contentDisposition('attachment', f.filename))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Security-Policy', 'sandbox')
    res.set('Cache-Control', 'no-store')
    res.status(200).end(f.plain)
  }))

  router.post('/dokumen/:id/review', json, handle(async (req, res) => {
    await need(req, 'subbagren.dokumen.sahkan')
    const did = id(req.params.id)
    const v = body(req, ['keputusan', 'catatan', 'version'])
    if (v.keputusan !== 'disahkan' && v.keputusan !== 'ditolak') throw new HttpError(400, 'invalid_input')
    const catatan = text(v.catatan, v.keputusan === 'ditolak' ? 8 : 0, 500)
    const ver = version(v.version)
    await withTransaction(pool, async (c) => {
      const cur = await c.query('SELECT status,version,created_by::text FROM sdl_ren_dokumen WHERE id=$1::uuid FOR UPDATE', [did])
      if (cur.rowCount !== 1) throw new HttpError(404, 'not_found')
      const o = cur.rows[0]
      if (o.status !== 'draft') throw new HttpError(409, 'dokumen_not_draft')
      if (o.version !== ver) throw new HttpError(409, 'version_conflict')
      if (o.created_by === req.actor) throw new HttpError(403, 'self_review_forbidden')
      if (v.keputusan === 'disahkan' && !(await openBerkas(c, did))) throw new HttpError(409, 'berkas_required')
      await c.query(
        `UPDATE sdl_ren_dokumen SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now(),version=version+1,updated_at=now()
          WHERE id=$1::uuid`, [did, v.keputusan, catatan, req.actor])
      await audit(c, req.actor, v.keputusan === 'disahkan' ? 'dokumen.sahkan' : 'dokumen.tolak', 'dokumen', did)
    })
    respond(res, 200, { ok: true, status: v.keputusan })
  }))

  // ================= Monitoring Kinerja & LKIP =================
  async function kinerja(tahun) {
    const keg = (await pool.query(
      `SELECT k.id::text,k.kode,k.nama,pr.kode AS program_kode,pr.nama AS program_nama,
              (SELECT g.jumlah::text FROM sdl_ren_pagu g WHERE g.kegiatan_id=k.id AND g.status='disetujui') AS pagu,
              (SELECT COALESCE(sum(r.jumlah),0)::text FROM sdl_ren_realisasi r JOIN sdl_ren_pagu g ON g.id=r.pagu_id
                WHERE g.kegiatan_id=k.id AND g.status='disetujui' AND r.status='terverifikasi') AS realisasi
         FROM sdl_ren_kegiatan k JOIN sdl_ren_program pr ON pr.id=k.program_id AND pr.deleted_at IS NULL AND pr.tahun=$1
        WHERE k.deleted_at IS NULL ORDER BY lower(pr.kode),lower(k.kode)`, [tahun])).rows
    const ind = (await pool.query(
      `SELECT i.id::text,i.kegiatan_id::text,i.nama,i.satuan,i.target_tw1::text,i.target_tw2::text,i.target_tw3::text,i.target_tw4::text,i.version
         FROM sdl_ren_indikator i WHERE i.deleted_at IS NULL AND i.kegiatan_id=ANY($1::uuid[]) ORDER BY i.created_at,i.id`,
      [keg.map((k) => k.id)])).rows
    const cap = (await pool.query(
      `SELECT c.indikator_id::text,c.triwulan,c.nilai::text,c.catatan,c.updated_at,u.display_name
         FROM sdl_ren_capaian c JOIN sdl_users u ON u.id=c.updated_by WHERE c.indikator_id=ANY($1::uuid[])`,
      [ind.map((i) => i.id)])).rows
    const capBy = new Map()
    for (const c of cap) {
      if (!capBy.has(c.indikator_id)) capBy.set(c.indikator_id, [null, null, null, null])
      capBy.get(c.indikator_id)[c.triwulan - 1] = { nilai: c.nilai, catatan: c.catatan, updatedAt: c.updated_at, updatedByName: c.display_name }
    }
    const indBy = new Map(keg.map((k) => [k.id, []]))
    for (const i of ind) {
      indBy.get(i.kegiatan_id)?.push({
        id: i.id, nama: i.nama, satuan: i.satuan, version: i.version,
        target: [i.target_tw1, i.target_tw2, i.target_tw3, i.target_tw4],
        capaian: capBy.get(i.id) ?? [null, null, null, null],
      })
    }
    return keg.map((k) => ({
      id: k.id, kode: k.kode, nama: k.nama, program: { kode: k.program_kode, nama: k.program_nama },
      pagu: k.pagu, realisasi: k.realisasi, indikator: indBy.get(k.id),
    }))
  }

  router.get('/kinerja', handle(async (req, res) => {
    await need(req, 'subbagren.progar.read')
    const tahun = tahunParam(req)
    respond(res, 200, { tahun, kegiatan: await kinerja(tahun) })
  }))

  function targetInput(v) {
    if (!Array.isArray(v) || v.length !== 4) throw new HttpError(400, 'invalid_input')
    const t = v.map(dec)
    if (Number(t[3]) <= 0) throw new HttpError(400, 'target_tahunan_wajib')
    // Kumulatif: target tidak boleh turun dari triwulan ke triwulan.
    for (let i = 1; i < 4; i++) if (Number(t[i]) < Number(t[i - 1])) throw new HttpError(400, 'target_tidak_kumulatif')
    return t
  }

  router.post('/kinerja/indikator', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const v = body(req, ['kegiatanId', 'nama', 'satuan', 'target'])
    if (typeof v.kegiatanId !== 'string' || !UUID_RE.test(v.kegiatanId)) throw new HttpError(400, 'invalid_input')
    const nama = text(v.nama, 3, 240); const satuan = text(v.satuan, 1, 40); const t = targetInput(v.target)
    const row = await withTransaction(pool, async (c) => {
      const k = await c.query(
        `SELECT 1 FROM sdl_ren_kegiatan k JOIN sdl_ren_program p ON p.id=k.program_id AND p.deleted_at IS NULL
          WHERE k.id=$1::uuid AND k.deleted_at IS NULL FOR SHARE OF k`, [v.kegiatanId])
      if (k.rowCount !== 1) throw new HttpError(404, 'not_found')
      const r = (await c.query(
        `INSERT INTO sdl_ren_indikator(kegiatan_id,nama,satuan,target_tw1,target_tw2,target_tw3,target_tw4,created_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text`, [v.kegiatanId, nama, satuan, ...t, req.actor])).rows[0]
      await audit(c, req.actor, 'indikator.create', 'indikator', r.id)
      return r
    })
    respond(res, 201, { id: row.id })
  }))

  router.put('/kinerja/indikator/:id', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const iid = id(req.params.id)
    const v = body(req, ['nama', 'satuan', 'target', 'version'])
    const args = [iid, text(v.nama, 3, 240), text(v.satuan, 1, 40), ...targetInput(v.target), version(v.version)]
    await withTransaction(pool, async (c) => {
      const r = await c.query(
        `UPDATE sdl_ren_indikator SET nama=$2,satuan=$3,target_tw1=$4,target_tw2=$5,target_tw3=$6,target_tw4=$7,
                version=version+1,updated_at=now() WHERE id=$1::uuid AND deleted_at IS NULL AND version=$8`, args)
      if (r.rowCount !== 1) {
        const e = await c.query('SELECT 1 FROM sdl_ren_indikator WHERE id=$1::uuid AND deleted_at IS NULL', [iid])
        throw e.rowCount ? new HttpError(409, 'version_conflict') : new HttpError(404, 'not_found')
      }
      await audit(c, req.actor, 'indikator.update', 'indikator', iid)
    })
    respond(res, 200, { ok: true })
  }))

  router.delete('/kinerja/indikator/:id', handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const iid = id(req.params.id)
    await withTransaction(pool, async (c) => {
      const f = await c.query('SELECT 1 FROM sdl_ren_indikator WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE', [iid])
      if (f.rowCount !== 1) throw new HttpError(404, 'not_found')
      const used = await c.query('SELECT 1 FROM sdl_ren_capaian WHERE indikator_id=$1::uuid LIMIT 1', [iid])
      if (used.rowCount) throw new HttpError(409, 'indikator_has_capaian')
      await c.query('UPDATE sdl_ren_indikator SET deleted_at=now(),updated_at=now() WHERE id=$1::uuid', [iid])
      await audit(c, req.actor, 'indikator.delete', 'indikator', iid)
    })
    respond(res, 200, { ok: true })
  }))

  router.put('/kinerja/indikator/:id/capaian/:tw', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const iid = id(req.params.id)
    const tw = Number(req.params.tw)
    if (![1, 2, 3, 4].includes(tw)) throw new HttpError(404, 'not_found')
    const v = body(req, ['nilai', 'catatan'])
    const nilai = dec(v.nilai); const catatan = text(v.catatan, 0, 1000)
    await withTransaction(pool, async (c) => {
      const f = await c.query('SELECT 1 FROM sdl_ren_indikator WHERE id=$1::uuid AND deleted_at IS NULL FOR SHARE', [iid])
      if (f.rowCount !== 1) throw new HttpError(404, 'not_found')
      await c.query(
        `INSERT INTO sdl_ren_capaian(indikator_id,triwulan,nilai,catatan,updated_by) VALUES($1::uuid,$2,$3,$4,$5)
         ON CONFLICT (indikator_id,triwulan) DO UPDATE SET nilai=EXCLUDED.nilai,catatan=EXCLUDED.catatan,
           updated_by=EXCLUDED.updated_by,updated_at=now()`, [iid, tw, nilai, catatan, req.actor])
      await audit(c, req.actor, `capaian.tw${tw}`, 'indikator', iid)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/kinerja/lkip.xlsx', handle(async (req, res) => {
    await need(req, 'subbagren.progar.read')
    const tahun = tahunParam(req)
    const data = await kinerja(tahun)
    const n = (s) => (s === null || s === undefined ? null : Number(s))
    const pct = (a, b) => (a !== null && b ? a / b : null)
    const head = ['No', 'Kode Program', 'Kode Kegiatan', 'Kegiatan', 'Indikator Kinerja', 'Satuan',
      'Target TW I', 'Target TW II', 'Target TW III', 'Target Tahunan',
      'Capaian TW I', 'Capaian TW II', 'Capaian TW III', 'Capaian TW IV',
      '% Capaian Tahunan', 'Pagu (Rp)', 'Realisasi (Rp)', '% Serapan']
    const rows = [[{ v: `Rekap Capaian Kinerja dan Serapan Anggaran Subbagren — Tahun ${tahun}`, bold: true }], [], head.map((h) => ({ v: h, bold: true }))]
    let no = 0
    for (const k of data) {
      const pagu = n(k.pagu); const real = n(k.realisasi)
      const list = k.indikator.length ? k.indikator : [null]
      list.forEach((i, idx) => {
        const cap = i ? i.capaian.map((c) => n(c?.nilai)) : []
        // Capaian tahunan = capaian triwulan terakhir yang sudah diisi (kumulatif).
        const last = [...cap].reverse().find((x) => x !== null) ?? null
        rows.push([
          idx === 0 ? ++no : null, idx === 0 ? k.program.kode : null, idx === 0 ? k.kode : null, idx === 0 ? k.nama : null,
          i ? i.nama : '(belum ada indikator)', i?.satuan ?? null,
          ...(i ? i.target.map((t) => n(t)) : [null, null, null, null]),
          ...(i ? cap : [null, null, null, null]),
          i && pct(last, n(i.target[3])) !== null ? { v: pct(last, n(i.target[3])), pct: true } : null,
          idx === 0 && pagu !== null ? { v: pagu, money: true } : null,
          idx === 0 && pagu !== null ? { v: real, money: true } : null,
          idx === 0 && pagu ? { v: real / pagu, pct: true } : null,
        ])
      })
    }
    const dok = (await pool.query(
      `SELECT jenis,judul,nomor,tanggal::text FROM sdl_ren_dokumen WHERE tahun=$1 AND status='disahkan'
          AND NOT EXISTS(SELECT 1 FROM sdl_ren_dokumen x WHERE x.pengganti_dari=sdl_ren_dokumen.id AND x.status='disahkan')
        ORDER BY jenis,judul`, [tahun])).rows
    const xlsx = buildXlsx([
      { name: 'Capaian Kinerja', widths: [5, 14, 12, 34, 40, 12, 11, 11, 11, 13, 11, 11, 11, 12, 14, 18, 18, 11], rows },
      { name: 'Dokumen Sah', widths: [14, 50, 30, 14], rows: [['Jenis', 'Judul', 'Nomor', 'Tanggal'].map((h) => ({ v: h, bold: true })), ...dok.map((d) => [JENIS_LABEL[d.jenis], d.judul, d.nomor, d.tanggal ?? ''])] },
    ])
    await withTransaction(pool, (c) => audit(c, req.actor, 'lkip.export', 'lkip', String(tahun)))
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.set('Content-Disposition', contentDisposition('attachment', `LKIP-Subbagren-${tahun}.xlsx`))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Cache-Control', 'no-store')
    res.status(200).end(xlsx)
  }))

  return router
}
