import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { HARI_INI, HttpError, UUID_RE, body, idParam, makeHandle, permit, pilihan, tanggal, teks } from './umum.js'
import { MAKS_LAMPIRAN, bacaPdf, bukaPdf, pasangHeaderUnduh } from './lampiran.js'

/**
 * R5H30: Subbagsumda — Cuti & Perizinan. Migrasi 071. EXPRESS SAJA.
 * Dokumen: docs/R5H30-SUMDA-CUTI-KESEJAHTERAAN.md (K1–K43; K25–K42 sementara untuk paparan).
 *
 *   GET    /api/v1/subbagsumda/cuti/capabilities
 *   GET    /api/v1/subbagsumda/cuti?q=&status=&jenis=&bulan=&personelId=&page=&size=
 *   GET    /api/v1/subbagsumda/cuti/kalender?bulan=YYYY-MM                         (K18/K39)
 *   GET    /api/v1/subbagsumda/cuti/jatah?personelId=&tahun=                       (K2/K10)
 *   POST   /api/v1/subbagsumda/cuti        {personelId,jenis,tanggalMulai,tanggalSelesai,jumlahHari?,catatan}
 *   GET    /api/v1/subbagsumda/cuti/:id
 *   PATCH  /api/v1/subbagsumda/cuti/:id    {tanggalMulai,tanggalSelesai,jumlahHari?,catatan,version} (Diajukan, K29)
 *   POST   /api/v1/subbagsumda/cuti/:id/aksi  {aksi,catatan,version[,tanggalKembali,jumlahHari]}
 *   POST · GET · DELETE  /api/v1/subbagsumda/cuti/:id/lampiran[/:lid]
 *
 * Hak: R subbagsumda.personel.read · M subbagsumda.cuti.manage · A subbagsumda.cuti.approve.
 * Lampiran cuti SAKIT hanya untuk A dan pengunggahnya (K4), diputus di SQL.
 *
 * K43: aturan bisnis (Tahunan tidak lintas tahun, batas rentang, cuti bertumpuk) ada di sini, bukan di
 * migrasi. Cuti bertumpuk (K11) dijaga dengan mengunci baris personel FOR NO KEY UPDATE di POST/PATCH,
 * sehingga dua pengajuan untuk personel yang sama berjalan berurutan.
 * KUNCI: POST: personel. Route lain: cuti (FOR UPDATE) dulu, baru personel. Tidak ada jalur yang
 * mengunci personel lalu cuti lain, jadi tidak membentuk siklus.
 */

export const JENIS_CUTI = Object.freeze(['TAHUNAN', 'SAKIT', 'ALASAN_PENTING', 'BESAR', 'LAINNYA'])
export const STATUS_CUTI = Object.freeze(['Diajukan', 'Diproses', 'Disetujui', 'Ditolak', 'Selesai', 'Dibatalkan'])
export const JATAH_TAHUNAN = 12 // K2
const MAKS_HARI_KALENDER = 366 // K27
const MAKS_KALENDER = 1000 // K39
const AKTIF = ['Diajukan', 'Diproses', 'Disetujui', 'Selesai'] // ikut cek bertumpuk (K11)
const UKURAN_HALAMAN = new Set([5, 10, 50, 100])
const BULAN_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

const P = {
  read: 'subbagsumda.personel.read',
  manage: 'subbagsumda.cuti.manage',
  approve: 'subbagsumda.cuti.approve',
}

const handle = makeHandle()
const HARI_MS = 86400000

/** K9/K25: hari kerja Senin–Jumat, inklusif, dari string YYYY-MM-DD (tanpa zona waktu). */
export function hariKerja(mulai, selesai) {
  const a = Date.parse(`${mulai}T00:00:00Z`)
  const b = Date.parse(`${selesai}T00:00:00Z`)
  let n = 0
  for (let t = a; t <= b; t += HARI_MS) {
    const d = new Date(t).getUTCDay()
    if (d !== 0 && d !== 6) n++
  }
  return n
}

export function hariKalender(mulai, selesai) {
  return Math.round((Date.parse(`${selesai}T00:00:00Z`) - Date.parse(`${mulai}T00:00:00Z`)) / HARI_MS) + 1
}

/** Rentang + jumlah hari sesuai K26–K28. `manual` = jumlahHari dari isian (boleh kosong). */
function rentang(jenis, mulaiRaw, selesaiRaw, manual) {
  const mulai = tanggal(mulaiRaw, 2000, 2100)
  const selesai = tanggal(selesaiRaw, 2000, 2100)
  if (!mulai || !selesai || selesai < mulai) throw new HttpError(400, 'invalid_input')
  const kalender = hariKalender(mulai, selesai)
  if (kalender > MAKS_HARI_KALENDER) throw new HttpError(400, 'invalid_input') // K27
  if (jenis === 'TAHUNAN' && mulai.slice(0, 4) !== selesai.slice(0, 4)) throw new HttpError(400, 'invalid_input') // K28
  const hari = jumlahManual(manual, kalender)
  const jumlah = hari ?? hariKerja(mulai, selesai)
  if (jumlah < 1) throw new HttpError(400, 'invalid_input') // K26: hanya akhir pekan, tanpa penyesuaian
  return { mulai, selesai, jumlah, disesuaikan: hari !== null }
}

function jumlahManual(v, kalender) {
  if (v === undefined || v === null) return null
  if (!Number.isSafeInteger(v) || v < 1 || v > kalender) throw new HttpError(400, 'invalid_input')
  return v
}

function versi(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}

/** Audit tanpa data pribadi (K19): hanya kunci daftar putih — tanpa catatan, nama, NRP, tanggal, nama berkas. */
async function audit(c, actor, event, subject, meta = {}) {
  const out = {}
  for (const k of ['jenis', 'status', 'fields', 'version']) if (Object.hasOwn(meta, k)) out[k] = meta[k]
  await c.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, event, 'subbagsumda.cuti', subject, out])
}

async function riwayat(c, id, dari, ke, catatan, oleh) {
  await c.query('INSERT INTO sdl_sumda_cuti_riwayat(cuti_id,dari,ke,catatan,oleh) VALUES($1,$2,$3,$4,$5)', [id, dari, ke, catatan, oleh])
}

const KOLOM = `c.id::text,c.personel_id::text,c.jenis,c.tanggal_mulai::text AS tanggal_mulai,c.tanggal_selesai::text AS tanggal_selesai,
  c.tanggal_kembali::text AS tanggal_kembali,c.jumlah_hari,c.hari_disesuaikan,c.status,c.catatan,c.version,c.created_at,c.updated_at,
  c.created_by::text,cu.display_name AS created_name,c.updated_by::text,du.display_name AS decided_name,c.decided_at,c.selesai_at,
  p.nrp,p.nama,p.status AS personel_status,p.deleted_at IS NOT NULL AS personel_terarsip`
const DARI = `FROM sdl_sumda_cuti c
  JOIN sdl_sumda_personel p ON p.id=c.personel_id
  LEFT JOIN sdl_users cu ON cu.id=c.created_by
  LEFT JOIN sdl_users du ON du.id=c.decided_by`

function mapCuti(r) {
  return {
    id: r.id, jenis: r.jenis, tanggalMulai: r.tanggal_mulai, tanggalSelesai: r.tanggal_selesai,
    tanggalKembali: r.tanggal_kembali ?? '', jumlahHari: r.jumlah_hari, hariDisesuaikan: r.hari_disesuaikan,
    status: r.status, catatan: r.catatan, version: r.version,
    createdBy: r.created_by, createdByName: r.created_name ?? '', updatedBy: r.updated_by,
    decidedByName: r.decided_name ?? null, decidedAt: r.decided_at ?? null, selesaiAt: r.selesai_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
    personel: { id: r.personel_id, nrp: r.nrp, nama: r.nama, status: r.personel_status, terarsip: r.personel_terarsip },
  }
}

async function ambil(c, id) {
  const r = await c.query(`SELECT ${KOLOM} ${DARI} WHERE c.id=$1::uuid`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return mapCuti(r.rows[0])
}

async function tahunIni(db) {
  return (await db.query(`SELECT date_part('year', ${HARI_INI})::int AS y`)).rows[0].y
}

/** K10: terpakai = Tahunan Disetujui+Selesai bertanggal mulai di tahun itu; dalam proses dihitung terpisah. */
export async function jatahCuti(db, personelId, tahun, kecuali = null) {
  const r = (await db.query(
    `SELECT coalesce(sum(jumlah_hari) FILTER (WHERE status IN ('Disetujui','Selesai')),0)::int AS terpakai,
            coalesce(sum(jumlah_hari) FILTER (WHERE status IN ('Diajukan','Diproses')),0)::int AS proses
       FROM sdl_sumda_cuti WHERE personel_id=$1::uuid AND jenis='TAHUNAN'
        AND date_part('year', tanggal_mulai)=$2 AND ($3::uuid IS NULL OR id<>$3::uuid)`,
    [personelId, tahun, kecuali])).rows[0]
  return { tahun, jatah: JATAH_TAHUNAN, terpakai: r.terpakai, dalamProses: r.proses, sisa: JATAH_TAHUNAN - r.terpakai }
}

/** K30: peringatan, bukan galat. Pengajuan itu sendiri tidak ikut dihitung (`kecuali`). */
async function peringatanJatah(c, personelId, jenis, mulai, jumlah, kecuali) {
  if (jenis !== 'TAHUNAN') return []
  const j = await jatahCuti(c, personelId, Number(mulai.slice(0, 4)), kecuali)
  return jumlah > j.jatah - j.terpakai - j.dalamProses ? ['melebihi_jatah'] : []
}

/** K11: rentang efektif (sampai tanggal kembali bila sudah Selesai) tidak boleh beririsan. */
async function tolakBertumpuk(c, personelId, mulai, selesai, kecuali) {
  const r = await c.query(
    `SELECT EXISTS(SELECT 1 FROM sdl_sumda_cuti WHERE personel_id=$1::uuid AND ($2::uuid IS NULL OR id<>$2::uuid)
        AND status = ANY($3::text[]) AND tanggal_mulai <= $5::date AND coalesce(tanggal_kembali,tanggal_selesai) >= $4::date) AS ada`,
    [personelId, kecuali, AKTIF, mulai, selesai])
  if (r.rows[0].ada) throw new HttpError(409, 'cuti_bertumpuk')
}

/** Kunci personel (FOR NO KEY UPDATE) untuk serialisasi K11; terarsip -> 409. */
async function kunciPersonel(c, personelId) {
  const p = (await c.query(
    'SELECT status,deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR NO KEY UPDATE', [personelId])).rows[0]
  if (!p) throw new HttpError(404, 'not_found')
  if (p.terarsip) throw new HttpError(409, 'personel_terarsip')
  return p
}

/** K32: aksi selain batalkan ditolak bila personel terarsip. FOR SHARE, setelah cuti dikunci. */
async function tolakBilaTerarsip(c, personelId) {
  const r = await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR SHARE', [personelId])
  if (r.rows[0]?.terarsip) throw new HttpError(409, 'personel_terarsip')
}

async function kunci(c, id) {
  const r = await c.query(
    `SELECT id::text,personel_id::text,jenis,status,version,tanggal_mulai::text AS tanggal_mulai,tanggal_selesai::text AS tanggal_selesai
       FROM sdl_sumda_cuti WHERE id=$1::uuid FOR UPDATE`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return r.rows[0]
}

/** K36 + perluasan maker-checker: lampiran menaikkan versi dan mencatat pengubahnya. */
async function naikVersi(c, id, actor) {
  await c.query('UPDATE sdl_sumda_cuti SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, actor])
}

function halaman(req) {
  const page = req.query.page === undefined ? 1 : parseGoInt(String(req.query.page))
  const size = req.query.size === undefined ? 10 : parseGoInt(String(req.query.size))
  if (page === undefined || page < 1 || page > 100000 || !UKURAN_HALAMAN.has(size)) throw new HttpError(400, 'invalid_input')
  return { page, size }
}

function bulanParam(raw) {
  const m = BULAN_RE.exec(String(raw ?? ''))
  if (!m || Number(m[1]) < 2000 || Number(m[1]) > 2100) throw new HttpError(400, 'invalid_input')
  return `${m[1]}-${m[2]}-01`
}

/** Riwayat cuti tahun berjalan (WIB) untuk detail Master Personel (K20/K41, aditif R5H27). */
export async function cutiTahunIni(db, personelId) {
  const tahun = await tahunIni(db)
  const items = (await db.query(
    `SELECT id::text,jenis,status,tanggal_mulai::text AS tanggal_mulai,tanggal_selesai::text AS tanggal_selesai,
            tanggal_kembali::text AS tanggal_kembali,jumlah_hari
       FROM sdl_sumda_cuti WHERE personel_id=$1::uuid AND date_part('year', tanggal_mulai)=$2
      ORDER BY tanggal_mulai DESC, created_at DESC LIMIT 50`, [personelId, tahun])).rows
  return {
    ...(await jatahCuti(db, personelId, tahun)),
    items: items.map((x) => ({ id: x.id, jenis: x.jenis, status: x.status, tanggalMulai: x.tanggal_mulai, tanggalSelesai: x.tanggal_selesai, tanggalKembali: x.tanggal_kembali ?? '', jumlahHari: x.jumlah_hari })),
  }
}

/** K40: personel berbeda yang sedang cuti hari ini (Disetujui/Selesai, belum terarsip). */
export const cutiHariIniSql = (hari = HARI_INI) => `SELECT count(DISTINCT c.personel_id)::int AS n FROM sdl_sumda_cuti c
  JOIN sdl_sumda_personel p ON p.id=c.personel_id AND p.deleted_at IS NULL
  WHERE c.status IN ('Disetujui','Selesai') AND ${hari} BETWEEN c.tanggal_mulai AND coalesce(c.tanggal_kembali,c.tanggal_selesai)`
export const CUTI_HARI_INI_SQL = cutiHariIniSql()

export function createSumdaCutiRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.SUMDA)
  const { can, need } = permit(pool)

  router.get('/capabilities', handle(async (req, res) => {
    const [read, manage, approve] = await Promise.all([P.read, P.manage, P.approve].map((k) => can(req.actor, k)))
    respond(res, 200, { canRead: read, canManage: manage, canApprove: approve })
  }))

  router.get('/kalender', handle(async (req, res) => {
    await need(req, P.read)
    for (const k of Object.keys(req.query)) if (k !== 'bulan') throw new HttpError(400, 'invalid_input')
    const awal = bulanParam(req.query.bulan)
    const rows = (await pool.query(
      `SELECT c.id::text,c.jenis,c.status,c.tanggal_mulai::text AS mulai,coalesce(c.tanggal_kembali,c.tanggal_selesai)::text AS akhir,p.nama
         FROM sdl_sumda_cuti c JOIN sdl_sumda_personel p ON p.id=c.personel_id AND p.deleted_at IS NULL
        WHERE c.status IN ('Diproses','Disetujui','Selesai')
          AND c.tanggal_mulai < ($1::date + interval '1 month') AND coalesce(c.tanggal_kembali,c.tanggal_selesai) >= $1::date
        ORDER BY c.tanggal_mulai, lower(p.nama), c.id LIMIT ${MAKS_KALENDER + 1}`, [awal])).rows
    const terpotong = rows.length > MAKS_KALENDER
    const items = rows.slice(0, MAKS_KALENDER)
    const hari = []
    const n = new Date(Date.UTC(Number(awal.slice(0, 4)), Number(awal.slice(5, 7)), 0)).getUTCDate()
    for (let d = 1; d <= n; d++) {
      const t = `${awal.slice(0, 8)}${String(d).padStart(2, '0')}`
      hari.push({ tanggal: t, items: items.filter((x) => x.mulai <= t && x.akhir >= t).map((x) => ({ id: x.id, nama: x.nama, jenis: x.jenis, status: x.status })) })
    }
    respond(res, 200, { bulan: awal.slice(0, 7), hari, terpotong })
  }))

  router.get('/jatah', handle(async (req, res) => {
    await need(req, P.read)
    const personelId = String(req.query.personelId ?? '')
    if (!UUID_RE.test(personelId)) throw new HttpError(400, 'invalid_input')
    let tahun = await tahunIni(pool)
    if (req.query.tahun !== undefined) {
      tahun = parseGoInt(String(req.query.tahun))
      if (tahun === undefined || tahun < 2000 || tahun > 2100) throw new HttpError(400, 'invalid_input')
    }
    respond(res, 200, await jatahCuti(pool, personelId, tahun))
  }))

  router.get('/', handle(async (req, res) => {
    await need(req, P.read)
    const q = teks(req.query.q ?? '', 0, 100)
    const status = String(req.query.status ?? '')
    const jenis = String(req.query.jenis ?? '')
    const personelId = String(req.query.personelId ?? '')
    if (status !== '' && !STATUS_CUTI.includes(status)) throw new HttpError(400, 'invalid_input')
    if (jenis !== '' && !JENIS_CUTI.includes(jenis)) throw new HttpError(400, 'invalid_input')
    if (personelId !== '' && !UUID_RE.test(personelId)) throw new HttpError(400, 'invalid_input')
    const bulan = req.query.bulan === undefined || req.query.bulan === '' ? null : bulanParam(req.query.bulan)
    const { page, size } = halaman(req)
    const where = ['TRUE']
    const args = []
    if (q !== '') {
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      where.push(`(p.nama ILIKE $${args.length} OR p.nrp ILIKE $${args.length})`)
    }
    if (status !== '') { args.push(status); where.push(`c.status=$${args.length}`) }
    if (jenis !== '') { args.push(jenis); where.push(`c.jenis=$${args.length}`) }
    if (personelId !== '') { args.push(personelId); where.push(`c.personel_id=$${args.length}::uuid`) }
    if (bulan) {
      args.push(bulan)
      where.push(`c.tanggal_mulai < ($${args.length}::date + interval '1 month') AND coalesce(c.tanggal_kembali,c.tanggal_selesai) >= $${args.length}::date`)
    }
    const w = where.join(' AND ')
    const total = Number((await pool.query(`SELECT count(*) ${DARI} WHERE ${w}`, args)).rows[0].count)
    const rows = (await pool.query(
      `SELECT ${KOLOM} ${DARI} WHERE ${w} ORDER BY c.tanggal_mulai DESC, c.created_at DESC, c.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args)).rows
    respond(res, 200, { items: rows.map(mapCuti), total, page, size })
  }))

  router.post('/', json, handle(async (req, res) => {
    await need(req, P.manage)
    const b = body(req, ['personelId', 'jenis', 'tanggalMulai', 'tanggalSelesai', 'jumlahHari', 'catatan'])
    if (typeof b.personelId !== 'string' || !UUID_RE.test(b.personelId)) throw new HttpError(400, 'invalid_input')
    const jenis = pilihan(b.jenis, JENIS_CUTI)
    const r = rentang(jenis, b.tanggalMulai, b.tanggalSelesai, b.jumlahHari)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    const out = await withTransaction(pool, async (c) => {
      const p = await kunciPersonel(c, b.personelId) // K11: serialisasi per personel
      if (!['Aktif', 'MPP'].includes(p.status)) throw new HttpError(409, 'personel_tidak_aktif') // K13
      await tolakBertumpuk(c, b.personelId, r.mulai, r.selesai, null)
      const peringatan = await peringatanJatah(c, b.personelId, jenis, r.mulai, r.jumlah, null)
      const id = (await c.query(
        `INSERT INTO sdl_sumda_cuti(personel_id,jenis,tanggal_mulai,tanggal_selesai,jumlah_hari,hari_disesuaikan,catatan,created_by,updated_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id::text`,
        [b.personelId, jenis, r.mulai, r.selesai, r.jumlah, r.disesuaikan, catatan, req.actor])).rows[0].id
      await riwayat(c, id, null, 'Diajukan', '', req.actor)
      await audit(c, req.actor, 'subbagsumda.cuti.create', id, { jenis, status: 'Diajukan' })
      return { item: await ambil(c, id), peringatan }
    })
    respond(res, 201, out)
  }))

  router.get('/:id', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id)
    const item = await ambil(pool, id)
    const approver = await can(req.actor, P.approve)
    // K4/K38: nama berkas cuti Sakit tidak keluar ke pembaca tanpa hak (bisa memuat diagnosis).
    const lampiran = (await pool.query(
      `SELECT l.id::text,(c.jenis<>'SAKIT' OR l.uploaded_by=$2::uuid OR $3::boolean) AS boleh,l.filename,l.size_bytes,
              l.uploaded_by::text,u.display_name,l.uploaded_at
         FROM sdl_sumda_cuti_lampiran l JOIN sdl_sumda_cuti c ON c.id=l.cuti_id LEFT JOIN sdl_users u ON u.id=l.uploaded_by
        WHERE l.cuti_id=$1::uuid ORDER BY l.uploaded_at, l.id`, [id, req.actor, approver])).rows
    const hist = (await pool.query(
      `SELECT h.dari,h.ke,h.catatan,u.display_name,h.pada FROM sdl_sumda_cuti_riwayat h
         LEFT JOIN sdl_users u ON u.id=h.oleh WHERE h.cuti_id=$1::uuid ORDER BY h.id`, [id])).rows
    respond(res, 200, {
      item,
      jatah: await jatahCuti(pool, item.personel.id, Number(item.tanggalMulai.slice(0, 4))),
      lampiran: lampiran.map((l) => ({ id: l.id, filename: l.boleh ? l.filename : null, dibatasi: !l.boleh, size: l.size_bytes, uploadedBy: l.uploaded_by, uploadedByName: l.display_name ?? '', uploadedAt: l.uploaded_at })),
      riwayat: hist.map((h) => ({ dari: h.dari, ke: h.ke, catatan: h.catatan, oleh: h.display_name ?? '', pada: h.pada })),
    })
  }))

  router.patch('/:id', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    // K29: personelId dan jenis tidak bisa diubah (juga menjaga K4 lampiran Sakit).
    const b = body(req, ['tanggalMulai', 'tanggalSelesai', 'jumlahHari', 'catatan', 'version'])
    const version = versi(b.version)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    const out = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      if (k.status !== 'Diajukan') throw new HttpError(409, 'status_tidak_sesuai')
      const r = rentang(k.jenis, b.tanggalMulai, b.tanggalSelesai, b.jumlahHari)
      await kunciPersonel(c, k.personel_id)
      await tolakBertumpuk(c, k.personel_id, r.mulai, r.selesai, id)
      const peringatan = await peringatanJatah(c, k.personel_id, k.jenis, r.mulai, r.jumlah, id)
      await c.query(
        `UPDATE sdl_sumda_cuti SET tanggal_mulai=$2,tanggal_selesai=$3,jumlah_hari=$4,hari_disesuaikan=$5,catatan=$6,
                updated_by=$7,updated_at=now(),version=version+1 WHERE id=$1::uuid`,
        [id, r.mulai, r.selesai, r.jumlah, r.disesuaikan, catatan, req.actor])
      await audit(c, req.actor, 'subbagsumda.cuti.update', id, { jenis: k.jenis, version: version + 1 })
      return { item: await ambil(c, id), peringatan }
    })
    respond(res, 200, out)
  }))

  router.post('/:id/aksi', json, handle(async (req, res) => {
    const id = idParam(req.params.id)
    const b = body(req, ['aksi', 'catatan', 'version', 'tanggalKembali', 'jumlahHari'])
    const aksi = pilihan(b.aksi, ['proses', 'setujui', 'tolak', 'batalkan', 'selesai'])
    // Hak diperiksa sebelum isian lain divalidasi (review R5H28 S8).
    if (aksi === 'setujui' || aksi === 'tolak') await need(req, P.approve)
    else await need(req, P.manage)
    if (aksi !== 'selesai' && (b.tanggalKembali !== undefined || b.jumlahHari !== undefined)) throw new HttpError(400, 'invalid_input')
    const version = versi(b.version)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    if ((aksi === 'tolak' || aksi === 'batalkan') && [...catatan].length < 8) throw new HttpError(400, 'invalid_input') // K17
    const isApprover = aksi === 'batalkan' ? await can(req.actor, P.approve) : false

    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      const dari = k.status
      const syarat = { proses: ['Diajukan'], setujui: ['Diproses'], tolak: ['Diproses'], batalkan: ['Diajukan', 'Diproses', 'Disetujui'], selesai: ['Disetujui'] }[aksi]
      if (!syarat.includes(dari)) throw new HttpError(409, 'status_tidak_sesuai')
      if (aksi !== 'batalkan') await tolakBilaTerarsip(c, k.personel_id) // K32

      if (aksi === 'proses') {
        await c.query(`UPDATE sdl_sumda_cuti SET status='Diproses',updated_at=now(),version=version+1 WHERE id=$1::uuid`, [id])
        await riwayat(c, id, dari, 'Diproses', catatan, req.actor)
        await audit(c, req.actor, 'subbagsumda.cuti.proses', id, { jenis: k.jenis, status: 'Diproses' })
      } else if (aksi === 'setujui' || aksi === 'tolak') {
        const ke = aksi === 'setujui' ? 'Disetujui' : 'Ditolak'
        // Maker-checker diputus di SQL (K1): pencatat dan pengubah terakhir tidak boleh memutus.
        const r = await c.query(
          `UPDATE sdl_sumda_cuti SET status=$3,decided_by=$2::uuid,decided_at=now(),updated_at=now(),version=version+1
            WHERE id=$1::uuid AND status='Diproses' AND version=$4 AND created_by<>$2::uuid AND updated_by<>$2::uuid`,
          [id, req.actor, ke, version])
        if (r.rowCount !== 1) throw new HttpError(403, 'self_review_forbidden')
        await riwayat(c, id, dari, ke, catatan, req.actor)
        await audit(c, req.actor, `subbagsumda.cuti.${aksi}`, id, { jenis: k.jenis, status: ke })
      } else if (aksi === 'batalkan') {
        const r = await c.query(
          `UPDATE sdl_sumda_cuti SET status='Dibatalkan',updated_at=now(),version=version+1
            WHERE id=$1::uuid AND status IN ('Diajukan','Diproses','Disetujui') AND (created_by=$2::uuid OR $3::boolean)`,
          [id, req.actor, isApprover])
        if (r.rowCount !== 1) throw new HttpError(403, 'access_denied')
        await riwayat(c, id, dari, 'Dibatalkan', catatan, req.actor)
        await audit(c, req.actor, 'subbagsumda.cuti.batalkan', id, { jenis: k.jenis, status: 'Dibatalkan' })
      } else {
        // K31: Selesai mulai hari pertama cuti (WIB); tanggalKembali = hari terakhir yang benar-benar dijalani.
        const hari = (await c.query(`SELECT (${HARI_INI})::text AS d`)).rows[0].d
        if (hari < k.tanggal_mulai) throw new HttpError(409, 'status_tidak_sesuai')
        let kembali = null
        if (b.tanggalKembali !== undefined && b.tanggalKembali !== null && b.tanggalKembali !== '') {
          kembali = tanggal(b.tanggalKembali, 2000, 2100)
          const batas = k.tanggal_selesai < hari ? k.tanggal_selesai : hari
          if (kembali < k.tanggal_mulai || kembali > batas) throw new HttpError(400, 'invalid_input')
        }
        const akhir = kembali ?? k.tanggal_selesai
        const manual = jumlahManual(b.jumlahHari, hariKalender(k.tanggal_mulai, akhir))
        const set = []
        const args = [id, req.actor, kembali]
        if (manual !== null) { args.push(manual); set.push(`jumlah_hari=$${args.length}`, 'hari_disesuaikan=TRUE') } else if (kembali) {
          const n = hariKerja(k.tanggal_mulai, kembali)
          if (n < 1) throw new HttpError(400, 'invalid_input')
          args.push(n); set.push(`jumlah_hari=$${args.length}`, 'hari_disesuaikan=FALSE')
        }
        await c.query(
          `UPDATE sdl_sumda_cuti SET status='Selesai',tanggal_kembali=$3::date,${set.length ? `${set.join(',')},` : ''}
                  selesai_by=$2::uuid,selesai_at=now(),updated_by=$2::uuid,updated_at=now(),version=version+1
            WHERE id=$1::uuid AND status='Disetujui'`, args)
        await riwayat(c, id, dari, 'Selesai', catatan, req.actor)
        await audit(c, req.actor, 'subbagsumda.cuti.selesai', id, { jenis: k.jenis, status: 'Selesai', fields: set.length || kembali ? ['jumlahHari'] : [] })
      }
      return ambil(c, id)
    })
    respond(res, 200, { item })
  }))

  /* ------------------------------------------------------------ Lampiran */

  // K36: unggah selama Diajukan/Diproses/Disetujui/Selesai; hapus hanya sebelum Disetujui.
  const BOLEH_UNGGAH = ['Diajukan', 'Diproses', 'Disetujui', 'Selesai']

  async function cekUnggah(c, id, lock) {
    const r = await c.query(`SELECT status,personel_id::text FROM sdl_sumda_cuti WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`, [id])
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
    await cekUnggah(pool, id, false) // sebelum membaca berkas besar
    const { blob, filename, sealed, digest } = await bacaPdf(req, evidenceKey)
    const row = await withTransaction(pool, async (c) => {
      await cekUnggah(c, id, true)
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_cuti_lampiran WHERE cuti_id=$1::uuid', [id])).rows[0].n
      if (n >= MAKS_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_sumda_cuti_lampiran(cuti_id,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text`, [id, filename, blob.length, digest, sealed, req.actor])).rows[0]
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.cuti.lampiran.add', id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const isApprover = await can(req.actor, P.approve)
    await withTransaction(pool, async (c) => {
      const r0 = await c.query('SELECT status,personel_id::text FROM sdl_sumda_cuti WHERE id=$1::uuid FOR UPDATE', [id])
      if (r0.rowCount !== 1) throw new HttpError(404, 'not_found')
      if (!['Diajukan', 'Diproses'].includes(r0.rows[0].status)) throw new HttpError(409, 'status_tidak_sesuai')
      await tolakBilaTerarsip(c, r0.rows[0].personel_id)
      const r = await c.query(
        'DELETE FROM sdl_sumda_cuti_lampiran WHERE id=$1::uuid AND cuti_id=$2::uuid AND (uploaded_by=$3::uuid OR $4::boolean)',
        [lid, id, req.actor, isApprover])
      if (r.rowCount !== 1) {
        const ada = await c.query('SELECT 1 FROM sdl_sumda_cuti_lampiran WHERE id=$1::uuid AND cuti_id=$2::uuid', [lid, id])
        throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
      }
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.cuti.lampiran.delete', id)
    })
    respond(res, 200, { ok: true })
  }))

  // K4: lampiran cuti Sakit hanya untuk pemegang approve dan pengunggahnya — diputus di SQL.
  router.get('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const approver = await can(req.actor, P.approve)
    const r = await pool.query(
      `SELECT l.filename,l.sha256,l.body FROM sdl_sumda_cuti_lampiran l JOIN sdl_sumda_cuti c ON c.id=l.cuti_id
        WHERE l.id=$1::uuid AND l.cuti_id=$2::uuid AND (c.jenis<>'SAKIT' OR l.uploaded_by=$3::uuid OR $4::boolean)`,
      [lid, id, req.actor, approver])
    if (r.rowCount !== 1) {
      const ada = await pool.query('SELECT 1 FROM sdl_sumda_cuti_lampiran WHERE id=$1::uuid AND cuti_id=$2::uuid', [lid, id])
      throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
    }
    const plain = bukaPdf(r.rows[0], evidenceKey)
    pasangHeaderUnduh(res, r.rows[0].filename)
    await withTransaction(pool, (c) => audit(c, req.actor, 'subbagsumda.cuti.lampiran.download', id))
    res.status(200).end(plain)
  }))

  return router
}
