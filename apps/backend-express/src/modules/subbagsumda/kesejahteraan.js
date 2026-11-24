import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { HARI_INI, HttpError, UUID_RE, body, idParam, makeHandle, permit, pernahMengubahSql, pilihan, tanggal, teks } from './umum.js'
import { MAKS_LAMPIRAN, bacaPdf, bukaPdf, pasangHeaderUnduh } from './lampiran.js'

/**
 * R5H30: Subbagsumda — Kesejahteraan (layanan personel & pensiun). Migrasi 071. EXPRESS SAJA.
 * Dokumen: docs/R5H30-SUMDA-CUTI-KESEJAHTERAAN.md (K1–K43; K25–K42 sementara untuk paparan).
 *
 *   GET    /api/v1/subbagsumda/kesejahteraan/capabilities
 *   GET    /api/v1/subbagsumda/kesejahteraan?q=&status=&jenis=&personelId=&lewatTarget=&page=&size=
 *   POST   /api/v1/subbagsumda/kesejahteraan        {personelId,jenis,nomorReferensi,targetSelesai,catatan}
 *   GET    /api/v1/subbagsumda/kesejahteraan/:id
 *   PATCH  /api/v1/subbagsumda/kesejahteraan/:id    {nomorReferensi,targetSelesai,catatan,version} (Diajukan, K29)
 *   POST   /api/v1/subbagsumda/kesejahteraan/:id/aksi  {aksi,catatan,version[,terapkan:{status,personelVersion}]}
 *   POST · GET · DELETE  /api/v1/subbagsumda/kesejahteraan/:id/lampiran[/:lid]
 *
 * Hak: R subbagsumda.personel.read · M subbagsumda.kesejahteraan.manage · A subbagsumda.kesejahteraan.approve ·
 * Selesai + terapkan juga butuh subbagsumda.personel.update (mengubah status Master Personel, K3/K33).
 *
 * K43: "satu layanan terbuka per jenis kecuali LAINNYA" (K16/K37) ada di sini, bukan indeks unik, dijaga
 * dengan mengunci baris personel FOR NO KEY UPDATE di POST (dua POST untuk personel yang sama berurutan).
 * KUNCI: POST: personel. Route lain: layanan (FOR UPDATE) dulu, baru personel.
 */

export const JENIS_LAYANAN = Object.freeze(['PERSIAPAN_PENSIUN', 'MPP', 'ASABRI', 'KARTU_IDENTITAS', 'LAINNYA'])
export const STATUS_LAYANAN = Object.freeze(['Diajukan', 'Diproses', 'Disetujui', 'Ditolak', 'Selesai', 'Dibatalkan'])
/** K3: status personel yang ditawarkan saat Selesai. */
export const PETA_TERAPKAN = Object.freeze({ MPP: 'MPP', PERSIAPAN_PENSIUN: 'Pensiun' })
/** K33: status asal yang boleh. */
const ASAL_TERAPKAN = Object.freeze({ MPP: ['Aktif'], Pensiun: ['Aktif', 'MPP'] })
const TERBUKA = ['Diajukan', 'Diproses', 'Disetujui']
const UKURAN_HALAMAN = new Set([5, 10, 50, 100])

const P = {
  read: 'subbagsumda.personel.read',
  manage: 'subbagsumda.kesejahteraan.manage',
  approve: 'subbagsumda.kesejahteraan.approve',
  personelUpdate: 'subbagsumda.personel.update',
}

const handle = makeHandle()

function versi(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}

/** Audit tanpa data pribadi: hanya kunci daftar putih. */
async function audit(c, actor, event, type, subject, meta = {}) {
  const out = {}
  for (const k of ['jenis', 'status', 'fields', 'version']) if (Object.hasOwn(meta, k)) out[k] = meta[k]
  await c.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, event, type, subject, out])
}
const auditL = (c, actor, event, id, meta) => audit(c, actor, event, 'subbagsumda.kesejahteraan', id, meta)

async function riwayat(c, id, dari, ke, catatan, oleh) {
  await c.query('INSERT INTO sdl_sumda_kesejahteraan_riwayat(kesejahteraan_id,dari,ke,catatan,oleh) VALUES($1,$2,$3,$4,$5)', [id, dari, ke, catatan, oleh])
}

const KOLOM = `k.id::text,k.personel_id::text,k.jenis,k.nomor_referensi,k.target_selesai::text AS target_selesai,
  (k.target_selesai < ${HARI_INI} AND k.status IN ('Diajukan','Diproses','Disetujui')) AS lewat_target,
  k.status,k.catatan,k.diterapkan,k.version,k.created_at,k.updated_at,
  k.created_by::text,cu.display_name AS created_name,k.updated_by::text,du.display_name AS decided_name,k.decided_at,k.selesai_at,
  p.nrp,p.nama,p.status AS personel_status,p.tanggal_pensiun::text AS personel_tanggal_pensiun,p.version AS personel_version,
  p.deleted_at IS NOT NULL AS personel_terarsip`
const DARI = `FROM sdl_sumda_kesejahteraan k
  JOIN sdl_sumda_personel p ON p.id=k.personel_id
  LEFT JOIN sdl_users cu ON cu.id=k.created_by
  LEFT JOIN sdl_users du ON du.id=k.decided_by`

function mapLayanan(r) {
  return {
    id: r.id, jenis: r.jenis, nomorReferensi: r.nomor_referensi, targetSelesai: r.target_selesai ?? '',
    lewatTarget: r.lewat_target === true, status: r.status, catatan: r.catatan, diterapkan: r.diterapkan ?? null,
    statusUsulan: PETA_TERAPKAN[r.jenis] ?? null, version: r.version,
    createdBy: r.created_by, createdByName: r.created_name ?? '', updatedBy: r.updated_by,
    decidedByName: r.decided_name ?? null, decidedAt: r.decided_at ?? null, selesaiAt: r.selesai_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
    personel: {
      id: r.personel_id, nrp: r.nrp, nama: r.nama, status: r.personel_status, tanggalPensiun: r.personel_tanggal_pensiun ?? '',
      version: r.personel_version, terarsip: r.personel_terarsip,
    },
  }
}

async function ambil(c, id) {
  const r = await c.query(`SELECT ${KOLOM} ${DARI} WHERE k.id=$1::uuid`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return mapLayanan(r.rows[0])
}

async function kunci(c, id) {
  const r = await c.query(
    'SELECT id::text,personel_id::text,jenis,status,version FROM sdl_sumda_kesejahteraan WHERE id=$1::uuid FOR UPDATE', [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return r.rows[0]
}

async function naikVersi(c, id, actor) {
  await c.query('UPDATE sdl_sumda_kesejahteraan SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, actor])
}

/** K32: aksi selain batalkan ditolak bila personel terarsip. FOR SHARE, setelah layanan dikunci. */
async function tolakBilaTerarsip(c, personelId) {
  const r = await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR SHARE', [personelId])
  if (r.rows[0]?.terarsip) throw new HttpError(409, 'personel_terarsip')
}

/** Riwayat layanan untuk detail Master Personel (K20/K41, aditif R5H27). */
export async function kesejahteraanPersonel(db, personelId) {
  const rows = (await db.query(
    `SELECT id::text,jenis,status,target_selesai::text AS target_selesai,nomor_referensi,selesai_at
       FROM sdl_sumda_kesejahteraan WHERE personel_id=$1::uuid ORDER BY created_at DESC, id LIMIT 50`, [personelId])).rows
  return rows.map((x) => ({ id: x.id, jenis: x.jenis, status: x.status, targetSelesai: x.target_selesai ?? '', nomorReferensi: x.nomor_referensi, selesaiAt: x.selesai_at ?? null }))
}

/** K21/K40: cuti + kesejahteraan berstatus Diproses milik personel belum terarsip. */
export const LAYANAN_MENUNGGU_SQL = `SELECT
  (SELECT count(*) FROM sdl_sumda_cuti c JOIN sdl_sumda_personel p ON p.id=c.personel_id AND p.deleted_at IS NULL WHERE c.status='Diproses')
  + (SELECT count(*) FROM sdl_sumda_kesejahteraan k JOIN sdl_sumda_personel p ON p.id=k.personel_id AND p.deleted_at IS NULL WHERE k.status='Diproses')
  AS n`

export function createSumdaKesejahteraanRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.SUMDA)
  const { can, need } = permit(pool)

  router.get('/capabilities', handle(async (req, res) => {
    const [read, manage, approve] = await Promise.all([P.read, P.manage, P.approve].map((k) => can(req.actor, k)))
    respond(res, 200, { canRead: read, canManage: manage, canApprove: approve })
  }))

  router.get('/', handle(async (req, res) => {
    await need(req, P.read)
    const q = teks(req.query.q ?? '', 0, 100)
    const status = String(req.query.status ?? '')
    const jenis = String(req.query.jenis ?? '')
    const personelId = String(req.query.personelId ?? '')
    const lewat = String(req.query.lewatTarget ?? '')
    if (status !== '' && !STATUS_LAYANAN.includes(status)) throw new HttpError(400, 'invalid_input')
    if (jenis !== '' && !JENIS_LAYANAN.includes(jenis)) throw new HttpError(400, 'invalid_input')
    if (personelId !== '' && !UUID_RE.test(personelId)) throw new HttpError(400, 'invalid_input')
    if (!['', '1'].includes(lewat)) throw new HttpError(400, 'invalid_input')
    const page = req.query.page === undefined ? 1 : parseGoInt(String(req.query.page))
    const size = req.query.size === undefined ? 10 : parseGoInt(String(req.query.size))
    if (page === undefined || page < 1 || page > 100000 || !UKURAN_HALAMAN.has(size)) throw new HttpError(400, 'invalid_input')
    const where = ['TRUE']
    const args = []
    if (q !== '') {
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      where.push(`(p.nama ILIKE $${args.length} OR p.nrp ILIKE $${args.length} OR k.nomor_referensi ILIKE $${args.length})`)
    }
    if (status !== '') { args.push(status); where.push(`k.status=$${args.length}`) }
    if (jenis !== '') { args.push(jenis); where.push(`k.jenis=$${args.length}`) }
    if (personelId !== '') { args.push(personelId); where.push(`k.personel_id=$${args.length}::uuid`) }
    if (lewat === '1') where.push(`k.target_selesai < ${HARI_INI} AND k.status IN ('Diajukan','Diproses','Disetujui')`)
    const w = where.join(' AND ')
    const total = Number((await pool.query(`SELECT count(*) ${DARI} WHERE ${w}`, args)).rows[0].count)
    const rows = (await pool.query(
      `SELECT ${KOLOM} ${DARI} WHERE ${w} ORDER BY k.created_at DESC, k.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args)).rows
    respond(res, 200, { items: rows.map(mapLayanan), total, page, size })
  }))

  router.post('/', json, handle(async (req, res) => {
    await need(req, P.manage)
    const b = body(req, ['personelId', 'jenis', 'nomorReferensi', 'targetSelesai', 'catatan'])
    if (typeof b.personelId !== 'string' || !UUID_RE.test(b.personelId)) throw new HttpError(400, 'invalid_input')
    const jenis = pilihan(b.jenis, JENIS_LAYANAN)
    const nomor = teks(b.nomorReferensi, 0, 100)
    const target = tanggal(b.targetSelesai, 2000, 2100)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    const item = await withTransaction(pool, async (c) => {
      // K16/K43: serialisasi per personel (pengganti indeks unik parsial).
      const p = (await c.query(
        'SELECT status,deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR NO KEY UPDATE', [b.personelId])).rows[0]
      if (!p) throw new HttpError(404, 'not_found')
      if (p.terarsip) throw new HttpError(409, 'personel_terarsip')
      if (!['Aktif', 'MPP'].includes(p.status)) throw new HttpError(409, 'personel_tidak_aktif') // K13
      if (jenis !== 'LAINNYA') { // K37
        const ada = (await c.query(
          'SELECT id::text FROM sdl_sumda_kesejahteraan WHERE personel_id=$1::uuid AND jenis=$2 AND status = ANY($3::text[]) ORDER BY created_at LIMIT 1',
          [b.personelId, jenis, TERBUKA])).rows[0]
        if (ada) throw new HttpError(409, 'pengajuan_ganda', { id: ada.id }) // K35
      }
      const id = (await c.query(
        `INSERT INTO sdl_sumda_kesejahteraan(personel_id,jenis,nomor_referensi,target_selesai,catatan,created_by,updated_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$6) RETURNING id::text`, [b.personelId, jenis, nomor, target, catatan, req.actor])).rows[0].id
      await riwayat(c, id, null, 'Diajukan', '', req.actor)
      await auditL(c, req.actor, 'subbagsumda.kesejahteraan.create', id, { jenis, status: 'Diajukan' })
      return ambil(c, id)
    })
    respond(res, 201, { item })
  }))

  router.get('/:id', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id)
    const item = await ambil(pool, id)
    const lampiran = (await pool.query(
      `SELECT l.id::text,l.filename,l.size_bytes,l.uploaded_by::text,u.display_name,l.uploaded_at
         FROM sdl_sumda_kesejahteraan_lampiran l LEFT JOIN sdl_users u ON u.id=l.uploaded_by
        WHERE l.kesejahteraan_id=$1::uuid ORDER BY l.uploaded_at, l.id`, [id])).rows
    const hist = (await pool.query(
      `SELECT h.dari,h.ke,h.catatan,u.display_name,h.pada FROM sdl_sumda_kesejahteraan_riwayat h
         LEFT JOIN sdl_users u ON u.id=h.oleh WHERE h.kesejahteraan_id=$1::uuid ORDER BY h.id`, [id])).rows
    respond(res, 200, {
      item,
      lampiran: lampiran.map((l) => ({ id: l.id, filename: l.filename, size: l.size_bytes, uploadedBy: l.uploaded_by, uploadedByName: l.display_name ?? '', uploadedAt: l.uploaded_at })),
      riwayat: hist.map((h) => ({ dari: h.dari, ke: h.ke, catatan: h.catatan, oleh: h.display_name ?? '', pada: h.pada })),
    })
  }))

  router.patch('/:id', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    // K29: personelId dan jenis tidak bisa diubah.
    const b = body(req, ['nomorReferensi', 'targetSelesai', 'catatan', 'version'])
    const version = versi(b.version)
    const nomor = teks(b.nomorReferensi, 0, 100)
    const target = tanggal(b.targetSelesai, 2000, 2100)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      if (k.status !== 'Diajukan') throw new HttpError(409, 'status_tidak_sesuai')
      await tolakBilaTerarsip(c, k.personel_id)
      await c.query(
        `UPDATE sdl_sumda_kesejahteraan SET nomor_referensi=$2,target_selesai=$3,catatan=$4,updated_by=$5,updated_at=now(),version=version+1
          WHERE id=$1::uuid`, [id, nomor, target, catatan, req.actor])
      await auditL(c, req.actor, 'subbagsumda.kesejahteraan.update', id, { jenis: k.jenis, version: version + 1 })
      return ambil(c, id)
    })
    respond(res, 200, { item })
  }))

  router.post('/:id/aksi', json, handle(async (req, res) => {
    const id = idParam(req.params.id)
    const b = body(req, ['aksi', 'catatan', 'version', 'terapkan'])
    const aksi = pilihan(b.aksi, ['proses', 'setujui', 'tolak', 'batalkan', 'selesai'])
    if (aksi === 'setujui' || aksi === 'tolak') await need(req, P.approve)
    else await need(req, P.manage)
    const terapkan = b.terapkan === undefined || b.terapkan === null ? null : b.terapkan
    if (terapkan !== null) {
      if (aksi !== 'selesai') throw new HttpError(400, 'invalid_input')
      await need(req, P.personelUpdate) // K3: mengubah Master Personel
    }
    const version = versi(b.version)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    if ((aksi === 'tolak' || aksi === 'batalkan') && [...catatan].length < 8) throw new HttpError(400, 'invalid_input') // K17
    const isApprover = aksi === 'batalkan' ? await can(req.actor, P.approve) : false

    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      const dari = k.status
      const syarat = { proses: ['Diajukan'], setujui: ['Diproses'], tolak: ['Diproses'], batalkan: TERBUKA, selesai: ['Disetujui'] }[aksi]
      if (!syarat.includes(dari)) throw new HttpError(409, 'status_tidak_sesuai')
      if (aksi !== 'batalkan' && aksi !== 'selesai') await tolakBilaTerarsip(c, k.personel_id) // K32

      if (aksi === 'proses') {
        await c.query(`UPDATE sdl_sumda_kesejahteraan SET status='Diproses',updated_at=now(),version=version+1 WHERE id=$1::uuid`, [id])
        await riwayat(c, id, dari, 'Diproses', catatan, req.actor)
        await auditL(c, req.actor, 'subbagsumda.kesejahteraan.proses', id, { jenis: k.jenis, status: 'Diproses' })
      } else if (aksi === 'setujui' || aksi === 'tolak') {
        const ke = aksi === 'setujui' ? 'Disetujui' : 'Ditolak'
        const r = await c.query(
          `UPDATE sdl_sumda_kesejahteraan SET status=$3,decided_by=$2::uuid,decided_at=now(),updated_at=now(),version=version+1
            WHERE id=$1::uuid AND status='Diproses' AND version=$4 AND created_by<>$2::uuid AND updated_by<>$2::uuid
              AND NOT ${pernahMengubahSql('subbagsumda.kesejahteraan', '$5', '$2')}`, // review S2
          [id, req.actor, ke, version, id.toLowerCase()])
        if (r.rowCount !== 1) throw new HttpError(403, 'self_review_forbidden')
        await riwayat(c, id, dari, ke, catatan, req.actor)
        await auditL(c, req.actor, `subbagsumda.kesejahteraan.${aksi}`, id, { jenis: k.jenis, status: ke })
      } else if (aksi === 'batalkan') {
        const r = await c.query(
          `UPDATE sdl_sumda_kesejahteraan SET status='Dibatalkan',updated_at=now(),version=version+1
            WHERE id=$1::uuid AND status IN ('Diajukan','Diproses','Disetujui') AND (created_by=$2::uuid OR $3::boolean)`,
          [id, req.actor, isApprover])
        if (r.rowCount !== 1) throw new HttpError(403, 'access_denied')
        await riwayat(c, id, dari, 'Dibatalkan', catatan, req.actor)
        await auditL(c, req.actor, 'subbagsumda.kesejahteraan.batalkan', id, { jenis: k.jenis, status: 'Dibatalkan' })
      } else {
        await selesai(c, req, k, terapkan, catatan)
      }
      return ambil(c, id)
    })
    respond(res, 200, { item })
  }))

  /** Selesai; bila `terapkan` diisi, status Master Personel diubah dalam transaksi yang sama (K3/K33). */
  async function selesai(c, req, k, terapkan, catatan) {
    const p = (await c.query(
      `SELECT id::text,status,tanggal_pensiun,version,deleted_at IS NOT NULL AS terarsip
         FROM sdl_sumda_personel WHERE id=$1::uuid FOR NO KEY UPDATE`, [k.personel_id])).rows[0]
    if (!p) throw new HttpError(404, 'not_found')
    if (p.terarsip) throw new HttpError(409, 'personel_terarsip') // K32
    let diterapkan = {}
    let fields = []
    if (terapkan !== null) {
      const target = PETA_TERAPKAN[k.jenis]
      if (!target || typeof terapkan !== 'object' || Array.isArray(terapkan)) throw new HttpError(400, 'invalid_input')
      for (const key of Object.keys(terapkan)) if (!['status', 'personelVersion'].includes(key)) throw new HttpError(400, 'invalid_input')
      if (terapkan.status !== target) throw new HttpError(400, 'invalid_input')
      if (versi(terapkan.personelVersion) !== p.version) throw new HttpError(409, 'personel_berubah')
      if (!ASAL_TERAPKAN[target].includes(p.status)) throw new HttpError(409, 'personel_tidak_aktif')
      if (target === 'MPP' && !p.tanggal_pensiun) throw new HttpError(409, 'personel_belum_lengkap') // R5H27 K1
      const r = await c.query(
        `UPDATE sdl_sumda_personel SET status=$3,updated_by=$4,updated_at=now(),version=version+1
          WHERE id=$1::uuid AND version=$2 AND deleted_at IS NULL`, [p.id, p.version, target, req.actor])
      if (r.rowCount !== 1) throw new HttpError(409, 'personel_berubah')
      fields = ['status']
      diterapkan = { fields: { status: { lama: p.status, baru: target } }, personelVersion: { lama: p.version, baru: p.version + 1 } }
    }
    await c.query(
      `UPDATE sdl_sumda_kesejahteraan SET status='Selesai',diterapkan=$2,selesai_by=$3::uuid,selesai_at=now(),updated_by=$3::uuid,
              updated_at=now(),version=version+1 WHERE id=$1::uuid AND status='Disetujui'`, [k.id, diterapkan, req.actor])
    await riwayat(c, k.id, 'Disetujui', 'Selesai', catatan, req.actor)
    await auditL(c, req.actor, 'subbagsumda.kesejahteraan.selesai', k.id, { jenis: k.jenis, status: 'Selesai', fields })
    // Perubahan master juga tercatat sebagai perubahan personel (Aktivitas terakhir R5H27).
    if (fields.length) await audit(c, req.actor, 'subbagsumda.personel.update', 'subbagsumda.personel', p.id, { fields, version: p.version + 1 })
  }

  /* ------------------------------------------------------------ Lampiran */

  const BOLEH_UNGGAH = ['Diajukan', 'Diproses', 'Disetujui', 'Selesai'] // K36

  async function cekUnggah(c, id, lock) {
    const r = await c.query(`SELECT status,personel_id::text FROM sdl_sumda_kesejahteraan WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`, [id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    if (!BOLEH_UNGGAH.includes(r.rows[0].status)) throw new HttpError(409, 'status_tidak_sesuai')
    if (lock) await tolakBilaTerarsip(c, r.rows[0].personel_id)
    else {
      const p = await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid', [r.rows[0].personel_id])
      if (p.rows[0]?.terarsip) throw new HttpError(409, 'personel_terarsip')
    }
  }

  router.post('/:id/lampiran', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    await cekUnggah(pool, id, false)
    const { blob, filename, sealed, digest } = await bacaPdf(req, evidenceKey)
    const row = await withTransaction(pool, async (c) => {
      await cekUnggah(c, id, true)
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_kesejahteraan_lampiran WHERE kesejahteraan_id=$1::uuid', [id])).rows[0].n
      if (n >= MAKS_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_sumda_kesejahteraan_lampiran(kesejahteraan_id,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text`, [id, filename, blob.length, digest, sealed, req.actor])).rows[0]
      await naikVersi(c, id, req.actor)
      await auditL(c, req.actor, 'subbagsumda.kesejahteraan.lampiran.add', id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const isApprover = await can(req.actor, P.approve)
    await withTransaction(pool, async (c) => {
      const r0 = await c.query('SELECT status,personel_id::text FROM sdl_sumda_kesejahteraan WHERE id=$1::uuid FOR UPDATE', [id])
      if (r0.rowCount !== 1) throw new HttpError(404, 'not_found')
      if (!['Diajukan', 'Diproses'].includes(r0.rows[0].status)) throw new HttpError(409, 'status_tidak_sesuai')
      await tolakBilaTerarsip(c, r0.rows[0].personel_id)
      const r = await c.query(
        'DELETE FROM sdl_sumda_kesejahteraan_lampiran WHERE id=$1::uuid AND kesejahteraan_id=$2::uuid AND (uploaded_by=$3::uuid OR $4::boolean)',
        [lid, id, req.actor, isApprover])
      if (r.rowCount !== 1) {
        const ada = await c.query('SELECT 1 FROM sdl_sumda_kesejahteraan_lampiran WHERE id=$1::uuid AND kesejahteraan_id=$2::uuid', [lid, id])
        throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
      }
      await naikVersi(c, id, req.actor)
      await auditL(c, req.actor, 'subbagsumda.kesejahteraan.lampiran.delete', id)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const r = await pool.query('SELECT filename,sha256,body FROM sdl_sumda_kesejahteraan_lampiran WHERE id=$1::uuid AND kesejahteraan_id=$2::uuid', [lid, id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    const plain = bukaPdf(r.rows[0], evidenceKey)
    pasangHeaderUnduh(res, r.rows[0].filename)
    await withTransaction(pool, (c) => auditL(c, req.actor, 'subbagsumda.kesejahteraan.lampiran.download', id))
    res.status(200).end(plain)
  }))

  return router
}
