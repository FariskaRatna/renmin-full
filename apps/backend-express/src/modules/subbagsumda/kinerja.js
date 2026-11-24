import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { HARI_INI, HttpError, UUID_RE, body, idParam, makeHandle, permit, pernahMengubahSql, pilihan, tanggal, teks } from './umum.js'
import { MAKS_LAMPIRAN, bacaPdf, bukaPdf, pasangHeaderUnduh } from './lampiran.js'

/**
 * R5H31: Subbagsumda — Kinerja & Pembinaan. Migrasi 072. EXPRESS SAJA.
 * Dokumen: docs/R5H31-SUMDA-KINERJA-INVENTARIS.md (K1–K49).
 *
 *   GET    /api/v1/subbagsumda/kinerja/capabilities
 *   GET    /api/v1/subbagsumda/kinerja?q=&tahun=&periode=&status=&kategori=&lewatTenggat=&page=&size=
 *   POST   /api/v1/subbagsumda/kinerja                {personelId,tahun,periode,kategori,penilai,tanggalPenilaian,catatan}
 *   GET    /api/v1/subbagsumda/kinerja/:id
 *   PATCH  /api/v1/subbagsumda/kinerja/:id            {tahun,periode,kategori,penilai,tanggalPenilaian,catatan,version} (Draft)
 *   POST   /api/v1/subbagsumda/kinerja/:id/aksi       {aksi:ajukan|setujui|kembalikan|batalkan|selesai,catatan,version}
 *   POST   /api/v1/subbagsumda/kinerja/:id/tindak-lanjut       {bentuk,uraian,tenggat,version}
 *   PATCH  /api/v1/subbagsumda/kinerja/:id/tindak-lanjut/:tid  {bentuk,uraian,tenggat,status,hasil,version}
 *   POST · GET · DELETE  /api/v1/subbagsumda/kinerja/:id/lampiran[/:lid]
 *
 * Hak: R personel.read (daftar ringkas) · Rk kinerja.read (isi) · Mk kinerja.manage · Ak kinerja.approve.
 *
 * K1/K31: isi penilaian (kategori, catatan, penilai, status asli, versi, tindak lanjut, lampiran, riwayat) hanya untuk
 * pencatat dan pemegang Rk. Penyamaran SELALU di SQL lewat `kolomKinerja`; filter/urutan/hitungan memakai kolom yang
 * sudah tersamar (K32). Mutasi memeriksa hak (pencatat atau Rk) SEBELUM status/kategori, supaya kode galat 409 tidak
 * bisa dipakai menebak kategori (K34).
 * K43 R5H30: satu penilaian aktif per (personel, tahun, periode) dijaga di sini dengan kunci personel FOR NO KEY UPDATE.
 * KUNCI: POST: personel. Route lain: kinerja (FOR UPDATE) dulu, lalu tindak lanjut, lalu personel.
 */

export const PERIODE = Object.freeze(['SEMESTER_I', 'SEMESTER_II', 'TAHUNAN'])
export const KATEGORI = Object.freeze(['BAIK_SEKALI', 'BAIK', 'CUKUP', 'PERLU_PEMBINAAN'])
export const STATUS_KINERJA = Object.freeze(['Draft', 'Diajukan', 'Disetujui', 'Selesai', 'Dibatalkan'])
export const BENTUK_TL = Object.freeze(['KONSELING', 'PELATIHAN', 'PENDAMPINGAN', 'TEGURAN', 'LAINNYA'])
export const STATUS_TL = Object.freeze(['Rencana', 'Berjalan', 'Selesai', 'Dibatalkan'])
const PP = 'PERLU_PEMBINAAN'
const MAKS_TL = 20 // K35
const UKURAN_HALAMAN = new Set([5, 10, 50, 100])
const RINGKAS_DARI_STATUS = { Draft: 'BELUM_DINILAI', Diajukan: 'DIAJUKAN', Disetujui: 'DINILAI', Selesai: 'DINILAI' }
const TL_EVENT = ['tindak_lanjut.add', 'tindak_lanjut.update'] // K36

const P = {
  read: 'subbagsumda.personel.read',
  detail: 'subbagsumda.kinerja.read',
  manage: 'subbagsumda.kinerja.manage',
  approve: 'subbagsumda.kinerja.approve',
}

const handle = makeHandle()

/** K38: satu-satunya rumus tindak lanjut lewat tenggat (WIB). */
export const lewatTenggatSql = (t = 't', hari = HARI_INI) => `(${t}.tenggat < ${hari} AND ${t}.status IN ('Rencana','Berjalan'))`

/** K1: syarat melihat isi — pencatat atau pemegang Rk. `actor`/`detail` = nomor parameter SQL. Diekspor untuk ekspor R5H32. */
export const boleh = (actor, detail) => `(k.created_by=${actor}::uuid OR ${detail}::boolean)`

/** K1/K31: SATU-SATUNYA sumber kolom kinerja; selain pencatat/Rk menerima NULL + status ringkas. */
export function kolomKinerja(actor, detail) {
  const b = boleh(actor, detail)
  const s = (expr, as) => `CASE WHEN ${b} THEN ${expr} END AS ${as}`
  return [
    'k.id::text', 'k.personel_id::text', 'k.tahun', 'k.periode',
    s('k.kategori', 'kategori'), s('k.catatan', 'catatan'), s('k.penilai', 'penilai'),
    s('k.tanggal_penilaian::text', 'tanggal_penilaian'), s('k.status', 'status'), s('k.version', 'version'),
    s('k.created_by::text', 'created_by'), s('cu.display_name', 'created_name'), s('k.updated_by::text', 'updated_by'),
    s('du.display_name', 'decided_name'), s('k.decided_at', 'decided_at'), s('k.selesai_at', 'selesai_at'),
    s('k.created_at', 'created_at'), s('k.updated_at', 'updated_at'),
    `CASE WHEN k.status IN ('Disetujui','Selesai') THEN 'DINILAI' WHEN k.status='Diajukan' THEN 'DIAJUKAN' ELSE 'BELUM_DINILAI' END AS status_ringkas`,
    `NOT ${b} AS dibatasi`,
    s(`EXISTS(SELECT 1 FROM sdl_sumda_kinerja_tindak_lanjut t WHERE t.kinerja_id=k.id AND ${lewatTenggatSql('t')})`, 'lewat_tenggat'),
    'p.nrp', 'p.nama', 'coalesce(rm.short_name,p.pangkat) AS pangkat_label', 'p.status AS personel_status',
    'p.deleted_at IS NOT NULL AS terarsip',
  ].join(',')
}
const DARI = `FROM sdl_sumda_kinerja k
  JOIN sdl_sumda_personel p ON p.id=k.personel_id
  LEFT JOIN sdl_polri_rank_master rm ON p.jenis IS DISTINCT FROM 'PNS' AND rm.code=p.pangkat
  LEFT JOIN sdl_users cu ON cu.id=k.created_by
  LEFT JOIN sdl_users du ON du.id=k.decided_by`
/** Penilaian Dibatalkan hanya tampil bagi yang boleh melihat isinya (K31). */
const TAMPAK = (actor, detail) => `(${boleh(actor, detail)} OR k.status<>'Dibatalkan')`

function mapKinerja(r) {
  return {
    id: r.id, tahun: r.tahun, periode: r.periode, statusRingkas: r.status_ringkas, dibatasi: r.dibatasi,
    kategori: r.kategori ?? null, catatan: r.catatan ?? null, penilai: r.penilai ?? null,
    tanggalPenilaian: r.dibatasi ? null : (r.tanggal_penilaian ?? ''), status: r.status ?? null, version: r.version ?? null,
    lewatTenggat: r.dibatasi ? null : r.lewat_tenggat === true,
    createdBy: r.created_by ?? null, createdByName: r.created_name ?? null, updatedBy: r.updated_by ?? null,
    decidedByName: r.decided_name ?? null, decidedAt: r.decided_at ?? null, selesaiAt: r.selesai_at ?? null,
    createdAt: r.created_at ?? null, updatedAt: r.updated_at ?? null,
    personel: { id: r.personel_id, nrp: r.nrp, nama: r.nama, pangkatLabel: r.pangkat_label ?? '', status: r.personel_status, terarsip: r.terarsip },
  }
}

async function ambil(c, id, actor, detail) {
  const r = await c.query(`SELECT ${kolomKinerja('$2', '$3')} ${DARI} WHERE k.id=$1::uuid AND ${TAMPAK('$2', '$3')}`, [id, actor, detail])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return mapKinerja(r.rows[0])
}

/** Audit tanpa data pribadi dan TANPA kategori (K26/K48). */
async function audit(c, actor, event, subject, meta = {}) {
  const out = {}
  for (const k of ['status', 'fields', 'version']) if (Object.hasOwn(meta, k)) out[k] = meta[k]
  await c.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, event, 'subbagsumda.kinerja', subject, out])
}

async function riwayat(c, id, dari, ke, catatan, oleh) {
  await c.query('INSERT INTO sdl_sumda_kinerja_riwayat(kinerja_id,dari,ke,catatan,oleh) VALUES($1,$2,$3,$4,$5)', [id, dari, ke, catatan, oleh])
}

function versi(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}

/** Kunci penilaian (selalu lebih dulu dari tindak lanjut/personel). */
async function kunci(c, id) {
  const r = await c.query(
    `SELECT id::text,personel_id::text,tahun,periode,kategori,status,version,created_by::text
       FROM sdl_sumda_kinerja WHERE id=$1::uuid FOR UPDATE`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return r.rows[0]
}

/** K34: mutasi isi hanya oleh pencatat atau pemegang Rk — diperiksa sebelum status/kategori. */
function syaratIsi(k, actor, rk) {
  if (k.created_by !== actor && !rk) throw new HttpError(403, 'access_denied')
}

async function terarsip(c, personelId) {
  const r = await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR SHARE', [personelId])
  return r.rows[0]?.terarsip === true
}

async function naikVersi(c, id, actor) {
  await c.query('UPDATE sdl_sumda_kinerja SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, actor])
}

/** K8: satu penilaian aktif per (personel, tahun, periode). Dipanggil di bawah kunci personel. */
async function tolakGanda(c, personelId, tahun, periode, kecuali) {
  const r = await c.query(
    `SELECT id::text FROM sdl_sumda_kinerja WHERE personel_id=$1::uuid AND tahun=$2 AND periode=$3 AND status<>'Dibatalkan'
        AND ($4::uuid IS NULL OR id<>$4::uuid) ORDER BY created_at LIMIT 1`, [personelId, tahun, periode, kecuali])
  if (r.rowCount) throw new HttpError(409, 'penilaian_ganda', { id: r.rows[0].id })
}

function nilaiIsi(b) {
  const tahun = b.tahun
  if (!Number.isSafeInteger(tahun) || tahun < 2000 || tahun > 2100) throw new HttpError(400, 'invalid_input')
  return {
    tahun,
    periode: pilihan(b.periode, PERIODE),
    kategori: pilihan(b.kategori, KATEGORI),
    penilai: teks(b.penilai, 0, 200),
    tanggalPenilaian: tanggal(b.tanggalPenilaian, 2000, 2100),
    catatan: teks(b.catatan, 0, 2000, { multiline: true }),
  }
}

/** Riwayat kinerja di detail Master Personel (K16): bagi non-K1 hanya entri DINILAI, tanpa kategori. */
export async function kinerjaPersonel(db, personelId, actor, detail) {
  const rows = (await db.query(
    `SELECT ${kolomKinerja('$2', '$3')} ${DARI}
      WHERE k.personel_id=$1::uuid AND ${TAMPAK('$2', '$3')}
        AND (${boleh('$2', '$3')} OR k.status IN ('Disetujui','Selesai'))
      ORDER BY k.tahun DESC, k.periode DESC, k.id LIMIT 50`, [personelId, actor, detail])).rows
  return rows.map((r) => ({ id: r.id, tahun: r.tahun, periode: r.periode, statusRingkas: r.status_ringkas, dibatasi: r.dibatasi, status: r.status ?? null, kategori: r.kategori ?? null }))
}

/** K15/K33: jumlah penilaian Perlu Pembinaan (Disetujui) dengan tindak lanjut lewat tenggat; personel belum terarsip. */
export const pembinaanLewatTenggatSql = (hari = HARI_INI) => `SELECT count(*)::int AS n FROM sdl_sumda_kinerja k
  JOIN sdl_sumda_personel p ON p.id=k.personel_id AND p.deleted_at IS NULL
  WHERE k.kategori='${PP}' AND k.status='Disetujui'
    AND EXISTS(SELECT 1 FROM sdl_sumda_kinerja_tindak_lanjut t WHERE t.kinerja_id=k.id AND ${lewatTenggatSql('t', hari)})`
export const PEMBINAAN_LEWAT_TENGGAT_SQL = pembinaanLewatTenggatSql()

function mapTL(t) {
  return {
    id: t.id, bentuk: t.bentuk, uraian: t.uraian, tenggat: t.tenggat ?? '', status: t.status, hasil: t.hasil,
    lewatTenggat: t.lewat === true, selesaiAt: t.selesai_at ?? null, updatedByName: t.display_name ?? '', updatedAt: t.updated_at,
  }
}

export function createSumdaKinerjaRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.SUMDA)
  const { can, need } = permit(pool)

  router.get('/capabilities', handle(async (req, res) => {
    const [read, detail, manage, approve] = await Promise.all([P.read, P.detail, P.manage, P.approve].map((k) => can(req.actor, k)))
    respond(res, 200, { canRead: read, canReadDetail: detail, canManage: manage, canApprove: approve })
  }))

  router.get('/', handle(async (req, res) => {
    await need(req, P.read)
    const q = teks(req.query.q ?? '', 0, 100)
    const periode = String(req.query.periode ?? '')
    const status = String(req.query.status ?? '')
    const kategori = String(req.query.kategori ?? '')
    const lewat = String(req.query.lewatTenggat ?? '')
    if (periode !== '' && !PERIODE.includes(periode)) throw new HttpError(400, 'invalid_input')
    if (status !== '' && !STATUS_KINERJA.includes(status)) throw new HttpError(400, 'invalid_input')
    if (kategori !== '' && !KATEGORI.includes(kategori)) throw new HttpError(400, 'invalid_input')
    if (!['', '1'].includes(lewat)) throw new HttpError(400, 'invalid_input')
    let tahun = null
    if (req.query.tahun !== undefined && req.query.tahun !== '') {
      tahun = parseGoInt(String(req.query.tahun))
      if (tahun === undefined || tahun < 2000 || tahun > 2100) throw new HttpError(400, 'invalid_input')
    }
    const page = req.query.page === undefined ? 1 : parseGoInt(String(req.query.page))
    const size = req.query.size === undefined ? 10 : parseGoInt(String(req.query.size))
    if (page === undefined || page < 1 || page > 100000 || !UKURAN_HALAMAN.has(size)) throw new HttpError(400, 'invalid_input')
    const detail = await can(req.actor, P.detail)
    // K32: semua filter, urutan, dan hitungan atas kolom yang SUDAH tersamar (CTE `terlihat`).
    const args = [req.actor, detail]
    const where = ['TRUE']
    if (q !== '') {
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      where.push(`(v.nama ILIKE $${args.length} OR v.nrp ILIKE $${args.length})`)
    }
    if (tahun !== null) { args.push(tahun); where.push(`v.tahun=$${args.length}`) }
    if (periode !== '') { args.push(periode); where.push(`v.periode=$${args.length}`) }
    if (status !== '') {
      args.push(status)
      const ringkas = RINGKAS_DARI_STATUS[status] ?? null
      args.push(ringkas)
      where.push(`((NOT v.dibatasi AND v.status=$${args.length - 1}) OR (v.dibatasi AND v.status_ringkas=$${args.length}::text))`)
    }
    if (kategori !== '') { args.push(kategori); where.push(`v.kategori=$${args.length}`) }
    if (lewat === '1') where.push('v.lewat_tenggat IS TRUE')
    const w = where.join(' AND ')
    const cte = `WITH v AS (SELECT ${kolomKinerja('$1', '$2')} ${DARI} WHERE ${TAMPAK('$1', '$2')})`
    const total = Number((await pool.query(`${cte} SELECT count(*) FROM v WHERE ${w}`, args)).rows[0].count)
    const rows = (await pool.query(
      `${cte} SELECT * FROM v WHERE ${w} ORDER BY v.tahun DESC, v.periode DESC, lower(v.nama), v.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args)).rows
    respond(res, 200, { items: rows.map(mapKinerja), total, page, size })
  }))

  router.post('/', json, handle(async (req, res) => {
    await need(req, P.manage)
    const b = body(req, ['personelId', 'tahun', 'periode', 'kategori', 'penilai', 'tanggalPenilaian', 'catatan'])
    if (typeof b.personelId !== 'string' || !UUID_RE.test(b.personelId)) throw new HttpError(400, 'invalid_input')
    const v = nilaiIsi(b)
    const item = await withTransaction(pool, async (c) => {
      const p = (await c.query(
        'SELECT status,deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR NO KEY UPDATE', [b.personelId])).rows[0]
      if (!p) throw new HttpError(404, 'not_found')
      if (p.terarsip) throw new HttpError(409, 'personel_terarsip')
      if (!['Aktif', 'MPP'].includes(p.status)) throw new HttpError(409, 'personel_tidak_aktif') // K14
      await tolakGanda(c, b.personelId, v.tahun, v.periode, null)
      const id = (await c.query(
        `INSERT INTO sdl_sumda_kinerja(personel_id,tahun,periode,kategori,penilai,tanggal_penilaian,catatan,created_by,updated_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING id::text`,
        [b.personelId, v.tahun, v.periode, v.kategori, v.penilai, v.tanggalPenilaian, v.catatan, req.actor])).rows[0].id
      await riwayat(c, id, null, 'Draft', '', req.actor)
      await audit(c, req.actor, 'subbagsumda.kinerja.create', id, { status: 'Draft' })
      return ambil(c, id, req.actor, false)
    })
    respond(res, 201, { item })
  }))

  router.get('/:id', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id)
    const detail = await can(req.actor, P.detail)
    const item = await ambil(pool, id, req.actor, detail)
    if (item.dibatasi) { respond(res, 200, { item, tindakLanjut: null, lampiran: null, riwayat: null }); return }
    // Ikut disaring `boleh` di SQL (pertahanan berlapis), walau item sudah dipastikan boleh.
    const tl = (await pool.query(
      `SELECT t.id::text,t.bentuk,t.uraian,t.tenggat::text AS tenggat,t.status,t.hasil,t.selesai_at,t.updated_at,u.display_name,
              ${lewatTenggatSql('t')} AS lewat
         FROM sdl_sumda_kinerja_tindak_lanjut t JOIN sdl_sumda_kinerja k ON k.id=t.kinerja_id LEFT JOIN sdl_users u ON u.id=t.updated_by
        WHERE t.kinerja_id=$1::uuid AND ${boleh('$2', '$3')} ORDER BY t.created_at, t.id`, [id, req.actor, detail])).rows
    const lampiran = (await pool.query(
      `SELECT l.id::text,l.filename,l.size_bytes,l.uploaded_by::text,u.display_name,l.uploaded_at
         FROM sdl_sumda_kinerja_lampiran l JOIN sdl_sumda_kinerja k ON k.id=l.kinerja_id LEFT JOIN sdl_users u ON u.id=l.uploaded_by
        WHERE l.kinerja_id=$1::uuid AND ${boleh('$2', '$3')} ORDER BY l.uploaded_at, l.id`, [id, req.actor, detail])).rows
    const hist = (await pool.query(
      `SELECT h.dari,h.ke,h.catatan,u.display_name,h.pada
         FROM sdl_sumda_kinerja_riwayat h JOIN sdl_sumda_kinerja k ON k.id=h.kinerja_id LEFT JOIN sdl_users u ON u.id=h.oleh
        WHERE h.kinerja_id=$1::uuid AND ${boleh('$2', '$3')} ORDER BY h.id`, [id, req.actor, detail])).rows
    respond(res, 200, {
      item,
      tindakLanjut: tl.map(mapTL),
      lampiran: lampiran.map((l) => ({ id: l.id, filename: l.filename, size: l.size_bytes, uploadedBy: l.uploaded_by, uploadedByName: l.display_name ?? '', uploadedAt: l.uploaded_at })),
      riwayat: hist.map((h) => ({ dari: h.dari, ke: h.ke, catatan: h.catatan, oleh: h.display_name ?? '', pada: h.pada })),
    })
  }))

  router.patch('/:id', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const rk = await can(req.actor, P.detail)
    const b = body(req, ['tahun', 'periode', 'kategori', 'penilai', 'tanggalPenilaian', 'catatan', 'version'])
    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      syaratIsi(k, req.actor, rk) // K34: sebelum validasi lain
      const version = versi(b.version)
      const v = nilaiIsi(b)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      if (k.status !== 'Draft') throw new HttpError(409, 'status_tidak_sesuai')
      if (k.kategori === PP && v.kategori !== PP) {
        const tl = (await c.query("SELECT count(*)::int AS n FROM sdl_sumda_kinerja_tindak_lanjut WHERE kinerja_id=$1::uuid AND status<>'Dibatalkan'", [id])).rows[0].n
        if (tl > 0) throw new HttpError(409, 'tindak_lanjut_terbuka') // K35
      }
      const p = (await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR NO KEY UPDATE', [k.personel_id])).rows[0]
      if (p?.terarsip) throw new HttpError(409, 'personel_terarsip')
      if (v.tahun !== k.tahun || v.periode !== k.periode) await tolakGanda(c, k.personel_id, v.tahun, v.periode, id)
      const fields = ['tahun', 'periode', 'kategori', 'penilai', 'tanggalPenilaian', 'catatan']
      await c.query(
        `UPDATE sdl_sumda_kinerja SET tahun=$2,periode=$3,kategori=$4,penilai=$5,tanggal_penilaian=$6,catatan=$7,
                updated_by=$8,updated_at=now(),version=version+1 WHERE id=$1::uuid`,
        [id, v.tahun, v.periode, v.kategori, v.penilai, v.tanggalPenilaian, v.catatan, req.actor])
      await audit(c, req.actor, 'subbagsumda.kinerja.update', id, { fields, version: version + 1 })
      return ambil(c, id, req.actor, rk)
    })
    respond(res, 200, { item })
  }))

  router.post('/:id/aksi', json, handle(async (req, res) => {
    const id = idParam(req.params.id)
    const b = body(req, ['aksi', 'catatan', 'version'])
    const aksi = pilihan(b.aksi, ['ajukan', 'setujui', 'kembalikan', 'batalkan', 'selesai'])
    const rk = await can(req.actor, P.detail)
    const ak = await can(req.actor, P.approve)
    if (aksi === 'setujui' || aksi === 'kembalikan') {
      if (!ak || !rk) throw new HttpError(403, 'access_denied') // pemutus harus bisa membaca isinya (K34)
    } else if (aksi === 'batalkan') {
      if (!ak) await need(req, P.manage)
    } else await need(req, P.manage)
    const version = versi(b.version)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })

    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      // Review C1: batalkan oleh bukan-pencatat butuh approve DAN kinerja.read (pemutus harus bisa membaca isinya).
      // Review C3: ajukan hanya oleh pencatat (Kasubbag tidak bisa mengajukan draf orang lain lalu langsung memutusnya).
      if (aksi === 'batalkan') { if (k.created_by !== req.actor && !(ak && rk)) throw new HttpError(403, 'access_denied') }
      else if (aksi === 'ajukan') { if (k.created_by !== req.actor) throw new HttpError(403, 'access_denied') }
      else if (aksi !== 'setujui' && aksi !== 'kembalikan') syaratIsi(k, req.actor, rk)
      if ((aksi === 'kembalikan' || aksi === 'batalkan') && [...catatan].length < 8) throw new HttpError(400, 'invalid_input')
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      const dari = k.status
      const syarat = { ajukan: ['Draft'], setujui: ['Diajukan'], kembalikan: ['Diajukan'], batalkan: ['Draft', 'Diajukan'], selesai: ['Disetujui'] }[aksi]
      if (!syarat.includes(dari)) throw new HttpError(409, 'status_tidak_sesuai')
      const arsip = await terarsip(c, k.personel_id)
      if (arsip && ['ajukan', 'setujui', 'kembalikan'].includes(aksi)) throw new HttpError(409, 'personel_terarsip') // K14/K37

      if (aksi === 'ajukan') {
        await c.query(`UPDATE sdl_sumda_kinerja SET status='Diajukan',updated_at=now(),version=version+1 WHERE id=$1::uuid`, [id])
        await riwayat(c, id, dari, 'Diajukan', catatan, req.actor)
        await audit(c, req.actor, 'subbagsumda.kinerja.ajukan', id, { status: 'Diajukan' })
      } else if (aksi === 'setujui' || aksi === 'kembalikan') {
        if (aksi === 'setujui' && k.kategori === PP) {
          const n = (await c.query("SELECT count(*)::int AS n FROM sdl_sumda_kinerja_tindak_lanjut WHERE kinerja_id=$1::uuid AND status<>'Dibatalkan'", [id])).rows[0].n
          if (n === 0) throw new HttpError(409, 'tindak_lanjut_wajib') // K2
        }
        const ke = aksi === 'kembalikan' ? 'Draft' : k.kategori === PP ? 'Disetujui' : 'Selesai'
        // Maker-checker di SQL (K36): bukan pencatat dan tidak pernah mengubah isi/lampiran/tindak lanjut.
        const set = aksi === 'kembalikan' ? 'status=$3'
          : `status=$3,decided_by=$2::uuid,decided_at=now()${ke === 'Selesai' ? ',selesai_by=$2::uuid,selesai_at=now()' : ''}`
        const r = await c.query(
          `UPDATE sdl_sumda_kinerja SET ${set},updated_at=now(),version=version+1
            WHERE id=$1::uuid AND status='Diajukan' AND version=$4 AND created_by<>$2::uuid
              AND NOT ${pernahMengubahSql('subbagsumda.kinerja', '$5', '$2', { tambahan: TL_EVENT })}`,
          [id, req.actor, ke, version, id.toLowerCase()])
        if (r.rowCount !== 1) throw new HttpError(403, 'self_review_forbidden')
        await riwayat(c, id, dari, ke, catatan, req.actor)
        // K48: setujui tanpa status hasil (Disetujui vs Selesai membocorkan Perlu Pembinaan).
        await audit(c, req.actor, `subbagsumda.kinerja.${aksi}`, id, aksi === 'kembalikan' ? { status: 'Draft' } : {})
      } else if (aksi === 'batalkan') {
        await c.query(`UPDATE sdl_sumda_kinerja SET status='Dibatalkan',updated_at=now(),version=version+1 WHERE id=$1::uuid`, [id])
        await riwayat(c, id, dari, 'Dibatalkan', catatan, req.actor)
        await audit(c, req.actor, 'subbagsumda.kinerja.batalkan', id, { status: 'Dibatalkan' })
      } else {
        const t = (await c.query(
          `SELECT count(*) FILTER (WHERE status IN ('Rencana','Berjalan'))::int AS buka, count(*) FILTER (WHERE status='Selesai')::int AS selesai
             FROM sdl_sumda_kinerja_tindak_lanjut WHERE kinerja_id=$1::uuid`, [id])).rows[0]
        if (t.buka > 0 || t.selesai === 0) throw new HttpError(409, 'tindak_lanjut_terbuka') // K37
        await c.query(
          `UPDATE sdl_sumda_kinerja SET status='Selesai',selesai_by=$2::uuid,selesai_at=now(),updated_by=$2::uuid,updated_at=now(),version=version+1
            WHERE id=$1::uuid`, [id, req.actor])
        await riwayat(c, id, dari, 'Selesai', catatan, req.actor)
        await audit(c, req.actor, 'subbagsumda.kinerja.selesai', id, { status: 'Selesai' })
      }
      return ambil(c, id, req.actor, rk)
    })
    respond(res, 200, { item })
  }))

  /* ---------------------------------------------------------- Tindak lanjut */

  function nilaiTL(b) {
    const tenggat = tanggal(b.tenggat, 2000, 2100)
    if (!tenggat) throw new HttpError(400, 'invalid_input') // K38: tenggat wajib
    return { bentuk: pilihan(b.bentuk, BENTUK_TL), uraian: teks(b.uraian, 3, 1000, { multiline: true }), tenggat }
  }

  router.post('/:id/tindak-lanjut', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const rk = await can(req.actor, P.detail)
    const b = body(req, ['bentuk', 'uraian', 'tenggat', 'version'])
    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      syaratIsi(k, req.actor, rk) // K34: sebelum kategori/status
      const v = nilaiTL(b)
      if (k.version !== versi(b.version)) throw new HttpError(409, 'version_conflict')
      if (k.kategori !== PP || !['Draft', 'Diajukan', 'Disetujui'].includes(k.status)) throw new HttpError(409, 'status_tidak_sesuai') // K35
      if (await terarsip(c, k.personel_id)) throw new HttpError(409, 'personel_terarsip') // K37: tidak boleh menambah
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_kinerja_tindak_lanjut WHERE kinerja_id=$1::uuid', [id])).rows[0].n
      if (n >= MAKS_TL) throw new HttpError(409, 'batas_tindak_lanjut')
      await c.query(
        `INSERT INTO sdl_sumda_kinerja_tindak_lanjut(kinerja_id,bentuk,uraian,tenggat,created_by,updated_by)
         VALUES($1::uuid,$2,$3,$4,$5,$5)`, [id, v.bentuk, v.uraian, v.tenggat, req.actor])
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.kinerja.tindak_lanjut.add', id, { version: k.version + 1 })
      return ambil(c, id, req.actor, rk)
    })
    respond(res, 201, { item })
  }))

  router.patch('/:id/tindak-lanjut/:tid', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const tid = idParam(req.params.tid)
    const rk = await can(req.actor, P.detail)
    const b = body(req, ['bentuk', 'uraian', 'tenggat', 'status', 'hasil', 'version'])
    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      syaratIsi(k, req.actor, rk)
      const v = nilaiTL(b)
      const status = pilihan(b.status, STATUS_TL)
      const hasil = teks(b.hasil, 0, 1000, { multiline: true })
      if (status === 'Selesai' && [...hasil].length < 3) throw new HttpError(400, 'invalid_input') // K38
      if (k.version !== versi(b.version)) throw new HttpError(409, 'version_conflict')
      if (!['Draft', 'Diajukan', 'Disetujui'].includes(k.status)) throw new HttpError(409, 'status_tidak_sesuai')
      const t = (await c.query('SELECT status FROM sdl_sumda_kinerja_tindak_lanjut WHERE id=$1::uuid AND kinerja_id=$2::uuid FOR UPDATE', [tid, id])).rows[0]
      if (!t) throw new HttpError(404, 'not_found')
      if (['Selesai', 'Dibatalkan'].includes(t.status)) throw new HttpError(409, 'status_tidak_sesuai')
      await terarsip(c, k.personel_id) // FOR SHARE; menutup tindak lanjut tetap boleh untuk personel terarsip (K37)
      await c.query(
        `UPDATE sdl_sumda_kinerja_tindak_lanjut SET bentuk=$3,uraian=$4,tenggat=$5,status=$6::text,hasil=$7,
                selesai_at=CASE WHEN $6::text='Selesai' THEN now() END,updated_by=$8,updated_at=now()
          WHERE id=$1::uuid AND kinerja_id=$2::uuid`, [tid, id, v.bentuk, v.uraian, v.tenggat, status, hasil, req.actor])
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.kinerja.tindak_lanjut.update', id, { status, version: k.version + 1 })
      return ambil(c, id, req.actor, rk)
    })
    respond(res, 200, { item })
  }))

  /* ------------------------------------------------------------ Lampiran */

  const BOLEH_LAMPIRAN = ['Draft', 'Diajukan', 'Disetujui'] // K46

  async function cekLampiran(c, id, actor, rk, lock) {
    const r = await c.query(`SELECT status,personel_id::text,created_by::text FROM sdl_sumda_kinerja WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`, [id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    syaratIsi(r.rows[0], actor, rk)
    if (!BOLEH_LAMPIRAN.includes(r.rows[0].status)) throw new HttpError(409, 'status_tidak_sesuai')
    if (lock && await terarsip(c, r.rows[0].personel_id)) throw new HttpError(409, 'personel_terarsip')
  }

  router.post('/:id/lampiran', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const rk = await can(req.actor, P.detail)
    await cekLampiran(pool, id, req.actor, rk, false) // sebelum membaca berkas besar
    const { blob, filename, sealed, digest } = await bacaPdf(req, evidenceKey)
    const row = await withTransaction(pool, async (c) => {
      await cekLampiran(c, id, req.actor, rk, true)
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_kinerja_lampiran WHERE kinerja_id=$1::uuid', [id])).rows[0].n
      if (n >= MAKS_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_sumda_kinerja_lampiran(kinerja_id,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text`, [id, filename, blob.length, digest, sealed, req.actor])).rows[0]
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.kinerja.lampiran.add', id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const rk = await can(req.actor, P.detail)
    const ak = await can(req.actor, P.approve)
    await withTransaction(pool, async (c) => {
      await cekLampiran(c, id, req.actor, rk, true)
      const r = await c.query(
        'DELETE FROM sdl_sumda_kinerja_lampiran WHERE id=$1::uuid AND kinerja_id=$2::uuid AND (uploaded_by=$3::uuid OR $4::boolean)',
        [lid, id, req.actor, ak])
      if (r.rowCount !== 1) {
        const ada = await c.query('SELECT 1 FROM sdl_sumda_kinerja_lampiran WHERE id=$1::uuid AND kinerja_id=$2::uuid', [lid, id])
        throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
      }
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.kinerja.lampiran.delete', id)
    })
    respond(res, 200, { ok: true })
  }))

  // K1/K13: unduh hanya pencatat atau Rk — penilaian dicek dulu (403), baru lampiran (404).
  router.get('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const rk = await can(req.actor, P.detail)
    const k = (await pool.query('SELECT created_by::text FROM sdl_sumda_kinerja WHERE id=$1::uuid', [id])).rows[0]
    if (!k) throw new HttpError(404, 'not_found')
    const r = await pool.query(
      `SELECT l.filename,l.sha256,l.body FROM sdl_sumda_kinerja_lampiran l JOIN sdl_sumda_kinerja k ON k.id=l.kinerja_id
        WHERE l.id=$1::uuid AND l.kinerja_id=$2::uuid AND (k.created_by=$3::uuid OR $4::boolean)`, [lid, id, req.actor, rk])
    if (r.rowCount !== 1) {
      if (k.created_by !== req.actor && !rk) throw new HttpError(403, 'access_denied')
      throw new HttpError(404, 'not_found')
    }
    const plain = bukaPdf(r.rows[0], evidenceKey)
    pasangHeaderUnduh(res, r.rows[0].filename)
    await withTransaction(pool, (c) => audit(c, req.actor, 'subbagsumda.kinerja.lampiran.download', id))
    res.status(200).end(plain)
  }))

  return router
}
