import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { auditSumda } from './diklat.js'
import { MAKS_LAMPIRAN, bacaPdf, bukaPdf, pasangHeaderUnduh } from './lampiran.js'
import { HARI_INI, HttpError, UUID_RE, body, idParam, makeHandle, permit, pilihan, tanggal, teks } from './umum.js'

/**
 * R5H29: Subbagsumda — Kompetensi & alert kedaluwarsa. Migrasi 070. EXPRESS SAJA.
 *
 *   GET    /api/v1/subbagsumda/kompetensi/capabilities
 *   GET    /api/v1/subbagsumda/kompetensi?q=&personelId=&kategori=&tahap=&page=&size=
 *   GET    /api/v1/subbagsumda/kompetensi/alert?tahap=
 *   POST   /api/v1/subbagsumda/kompetensi             {personelId,nama,kategori,nomor,penerbit,tanggalTerbit,berlakuSampai,catatan[,dariPesertaId]}
 *   GET    /api/v1/subbagsumda/kompetensi/:id
 *   PATCH  /api/v1/subbagsumda/kompetensi/:id         badan penuh + version
 *   DELETE /api/v1/subbagsumda/kompetensi/:id?version= arsip (A)
 *   POST|GET|DELETE /api/v1/subbagsumda/kompetensi/:id/lampiran[/:lid]
 *
 * Tahap alert (K13/K25/K30): H-60 (31–60 hari), H-30 (1–30), KEDALUWARSA (≤ 0) dari `berlaku_sampai`
 * menurut Asia/Jakarta; hanya kompetensi aktif milik personel Aktif/MPP; kosong = tanpa batas (tanpa
 * tahap); keluar dari alert bila ada kompetensi aktif lain bernama sama yang berlaku lebih lama.
 * KUNCI: (kegiatan -> peserta ->) kompetensi -> personel FOR SHARE.
 */

export const KATEGORI = Object.freeze(['Sertifikasi profesi', 'Kursus', 'Lisensi', 'Keahlian', 'Lainnya'])
export const TAHAP_KOMPETENSI = Object.freeze(['H-60', 'H-30', 'KEDALUWARSA'])
const UKURAN_HALAMAN = new Set([5, 10, 50, 100])
const P = { read: 'subbagsumda.personel.read', manage: 'subbagsumda.diklat.manage', archive: 'subbagsumda.diklat.archive' }
const handle = makeHandle({ sdl_sumda_kompetensi_dari_uq: 'kompetensi_ganda' })

export const sisaKompetensiSql = (k = 'k', hari = HARI_INI) => `(${k}.berlaku_sampai - ${hari})`

/** SATU-SATUNYA rumus tahap kompetensi: dipakai daftar, alert, dashboard, dan detail personel. */
export function tahapKompetensiSql(k = 'k', p = 'p', hari = HARI_INI) {
  const sisa = sisaKompetensiSql(k, hari)
  return `CASE WHEN ${k}.deleted_at IS NULL AND ${p}.deleted_at IS NULL AND ${p}.status IN ('Aktif','MPP')
        AND ${k}.berlaku_sampai IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM sdl_sumda_kompetensi k2 WHERE k2.personel_id=${k}.personel_id AND k2.id<>${k}.id
              AND k2.deleted_at IS NULL AND lower(btrim(k2.nama))=lower(btrim(${k}.nama))
              AND (k2.berlaku_sampai IS NULL OR k2.berlaku_sampai > ${k}.berlaku_sampai)) THEN
     CASE WHEN ${sisa} <= 0 THEN 'KEDALUWARSA' WHEN ${sisa} <= 30 THEN 'H-30' WHEN ${sisa} <= 60 THEN 'H-60' END END`
}

/** K31: jumlah kompetensi bertahap (H-60, H-30, KEDALUWARSA) untuk dashboard Sumda. */
export const KOMPETENSI_60_SQL = `SELECT count(*)::int AS n FROM sdl_sumda_kompetensi k JOIN sdl_sumda_personel p ON p.id=k.personel_id
  WHERE ${tahapKompetensiSql()} IS NOT NULL`

function versi(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}

const FIELD = ['nama', 'kategori', 'nomor', 'penerbit', 'tanggalTerbit', 'berlakuSampai', 'catatan']
function nilai(b) {
  const v = {
    nama: teks(b.nama, 3, 200),
    kategori: pilihan(b.kategori, KATEGORI),
    nomor: teks(b.nomor, 0, 100),
    penerbit: teks(b.penerbit, 0, 200),
    tanggalTerbit: tanggal(b.tanggalTerbit, 1950, 2100),
    berlakuSampai: tanggal(b.berlakuSampai, 1950, 2100),
    catatan: teks(b.catatan, 0, 1000, { multiline: true }),
  }
  if (v.tanggalTerbit && v.berlakuSampai && v.berlakuSampai < v.tanggalTerbit) throw new HttpError(400, 'invalid_input')
  return v
}

const KOLOM = `k.id::text,k.personel_id::text,k.nama,k.kategori,k.nomor,k.penerbit,k.tanggal_terbit::text AS tanggal_terbit,
  k.berlaku_sampai::text AS berlaku_sampai,k.catatan,k.version,k.dari_peserta_id::text,d.id::text AS dari_diklat_id,
  d.nama AS dari_diklat_nama,p.nrp,p.nama AS personel_nama,p.status AS personel_status,p.deleted_at IS NOT NULL AS terarsip,
  ${sisaKompetensiSql()} AS sisa_hari,${tahapKompetensiSql()} AS tahap,k.created_at,k.updated_at`
const DARI = `FROM sdl_sumda_kompetensi k JOIN sdl_sumda_personel p ON p.id=k.personel_id
  LEFT JOIN sdl_sumda_diklat_peserta ps ON ps.id=k.dari_peserta_id
  LEFT JOIN sdl_sumda_diklat d ON d.id=ps.diklat_id AND d.deleted_at IS NULL`

function map(r) {
  return {
    id: r.id, personelId: r.personel_id, nama: r.nama, kategori: r.kategori, nomor: r.nomor, penerbit: r.penerbit,
    tanggalTerbit: r.tanggal_terbit ?? '', berlakuSampai: r.berlaku_sampai ?? '', catatan: r.catatan, version: r.version,
    dariPesertaId: r.dari_peserta_id ?? null, dariDiklat: r.dari_diklat_id ? { id: r.dari_diklat_id, nama: r.dari_diklat_nama } : null,
    personel: { id: r.personel_id, nrp: r.nrp, nama: r.personel_nama, status: r.personel_status, terarsip: r.terarsip },
    sisaHari: r.sisa_hari ?? null, tahap: r.tahap ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

async function ambil(c, id) {
  const r = await c.query(`SELECT ${KOLOM} ${DARI} WHERE k.id=$1::uuid AND k.deleted_at IS NULL`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return map(r.rows[0])
}

/** Kompetensi seorang personel untuk detail Master Personel (K18, aditif R5H27). */
export async function kompetensiPersonel(db, personelId) {
  const r = await db.query(`SELECT ${KOLOM} ${DARI} WHERE k.personel_id=$1::uuid AND k.deleted_at IS NULL
    ORDER BY k.berlaku_sampai NULLS LAST, lower(k.nama), k.id LIMIT 50`, [personelId])
  return r.rows.map((x) => {
    const m = map(x)
    return { id: m.id, nama: m.nama, kategori: m.kategori, nomor: m.nomor, penerbit: m.penerbit, tanggalTerbit: m.tanggalTerbit, berlakuSampai: m.berlakuSampai, sisaHari: m.sisaHari, tahap: m.tahap }
  })
}

/** Kunci kompetensi aktif lalu personelnya (FOR SHARE); personel terarsip -> 409 (K16). */
async function kunci(c, id) {
  const r = await c.query('SELECT id::text,personel_id::text,version FROM sdl_sumda_kompetensi WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE', [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  const p = (await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR SHARE', [r.rows[0].personel_id])).rows[0]
  if (p?.terarsip) throw new HttpError(409, 'personel_terarsip')
  return r.rows[0]
}

export function createSumdaKompetensiRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.SUMDA)
  const { can, need } = permit(pool)

  router.get('/capabilities', handle(async (req, res) => {
    const [read, manage, archive] = await Promise.all([P.read, P.manage, P.archive].map((k) => can(req.actor, k)))
    respond(res, 200, { canRead: read, canManage: manage, canArchive: archive })
  }))

  router.get('/alert', handle(async (req, res) => {
    await need(req, P.read)
    const tahap = String(req.query.tahap ?? '')
    if (tahap !== '' && !TAHAP_KOMPETENSI.includes(tahap)) throw new HttpError(400, 'invalid_input')
    // Review R5H29 C4: items dibatasi 500; ringkas tetap dihitung penuh di SQL.
    const tahapSql = tahapKompetensiSql()
    const hitung = (await pool.query(`SELECT ${tahapSql} AS tahap, count(*)::int AS n ${DARI} WHERE ${tahapSql} IS NOT NULL GROUP BY 1`)).rows
    const rows = (await pool.query(`SELECT ${KOLOM} ${DARI} WHERE ${tahapSql} IS NOT NULL AND ($1 = '' OR ${tahapSql} = $1)
      ORDER BY sisa_hari, lower(p.nama), k.id LIMIT 500`, [tahap])).rows.map(map)
    respond(res, 200, {
      ringkas: Object.fromEntries(TAHAP_KOMPETENSI.map((t) => [t, hitung.find((h) => h.tahap === t)?.n ?? 0])),
      items: rows,
    })
  }))

  router.get('/', handle(async (req, res) => {
    await need(req, P.read)
    const q = teks(req.query.q ?? '', 0, 100)
    const personelId = String(req.query.personelId ?? '')
    const kategori = String(req.query.kategori ?? '')
    const tahap = String(req.query.tahap ?? '')
    if (personelId !== '' && !UUID_RE.test(personelId)) throw new HttpError(400, 'invalid_input')
    if (kategori !== '' && !KATEGORI.includes(kategori)) throw new HttpError(400, 'invalid_input')
    if (tahap !== '' && !TAHAP_KOMPETENSI.includes(tahap)) throw new HttpError(400, 'invalid_input')
    const page = req.query.page === undefined ? 1 : parseGoInt(String(req.query.page))
    const size = req.query.size === undefined ? 10 : parseGoInt(String(req.query.size))
    if (page === undefined || page < 1 || page > 100000 || !UKURAN_HALAMAN.has(size)) throw new HttpError(400, 'invalid_input')
    const where = ['k.deleted_at IS NULL']
    const args = []
    if (q !== '') {
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      const n = `$${args.length}`
      where.push(`(k.nama ILIKE ${n} OR k.nomor ILIKE ${n} OR k.penerbit ILIKE ${n} OR p.nama ILIKE ${n} OR p.nrp ILIKE ${n})`)
    }
    if (personelId !== '') { args.push(personelId); where.push(`k.personel_id=$${args.length}::uuid`) }
    if (kategori !== '') { args.push(kategori); where.push(`k.kategori=$${args.length}`) }
    if (tahap !== '') { args.push(tahap); where.push(`(${tahapKompetensiSql()})=$${args.length}`) }
    const w = where.join(' AND ')
    const total = Number((await pool.query(`SELECT count(*) ${DARI} WHERE ${w}`, args)).rows[0].count)
    const rows = (await pool.query(
      `SELECT ${KOLOM} ${DARI} WHERE ${w} ORDER BY k.berlaku_sampai NULLS LAST, lower(p.nama), k.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args)).rows
    respond(res, 200, { items: rows.map(map), total, page, size })
  }))

  router.post('/', json, handle(async (req, res) => {
    await need(req, P.manage)
    const b = body(req, ['personelId', 'dariPesertaId', ...FIELD])
    if (typeof b.personelId !== 'string' || !UUID_RE.test(b.personelId)) throw new HttpError(400, 'invalid_input')
    const dari = b.dariPesertaId === undefined || b.dariPesertaId === null || b.dariPesertaId === '' ? null : b.dariPesertaId
    if (dari !== null && (typeof dari !== 'string' || !UUID_RE.test(dari))) throw new HttpError(400, 'invalid_input')
    const v = nilai(b)
    const item = await withTransaction(pool, async (c) => {
      if (dari !== null) {
        // K11/K24: kegiatan -> peserta -> personel. Peserta harus Lulus pada kegiatan Selesai yang belum terarsip.
        const ps = (await c.query(
          `SELECT ps.personel_id::text,ps.hasil,d.status FROM sdl_sumda_diklat_peserta ps
             JOIN sdl_sumda_diklat d ON d.id=ps.diklat_id AND d.deleted_at IS NULL
            WHERE ps.id=$1::uuid FOR SHARE OF d, ps`, [dari])).rows[0]
        if (!ps) throw new HttpError(404, 'not_found')
        if (ps.personel_id !== b.personelId.toLowerCase()) throw new HttpError(400, 'invalid_input')
        if (ps.status !== 'Selesai' || ps.hasil !== 'Lulus') throw new HttpError(409, 'status_tidak_sesuai')
      }
      const p = (await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR SHARE', [b.personelId])).rows[0]
      if (!p) throw new HttpError(404, 'not_found')
      if (p.terarsip) throw new HttpError(409, 'personel_terarsip') // K32: status apa pun yang belum terarsip
      const r = await c.query(
        `INSERT INTO sdl_sumda_kompetensi(personel_id,nama,kategori,nomor,penerbit,tanggal_terbit,berlaku_sampai,dari_peserta_id,catatan,created_by,updated_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id::text`,
        [b.personelId, v.nama, v.kategori, v.nomor, v.penerbit, v.tanggalTerbit, v.berlakuSampai, dari, v.catatan, req.actor])
      const id = r.rows[0].id
      await auditSumda(c, req.actor, 'subbagsumda.kompetensi.create', 'subbagsumda.kompetensi', id, { kategori: v.kategori })
      return ambil(c, id)
    })
    respond(res, 201, { item })
  }))

  router.get('/:id', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id)
    const item = await ambil(pool, id)
    const lampiran = (await pool.query(
      `SELECT l.id::text,l.filename,l.size_bytes,l.uploaded_by::text,u.display_name,l.uploaded_at FROM sdl_sumda_diklat_lampiran l
         LEFT JOIN sdl_users u ON u.id=l.uploaded_by WHERE l.kompetensi_id=$1::uuid ORDER BY l.uploaded_at, l.id`, [id])).rows
    // K24: sertifikat peserta asal ditautkan, tidak disalin.
    const sertifikat = item.dariDiklat ? (await pool.query(
      `SELECT l.id::text,l.filename,l.size_bytes FROM sdl_sumda_diklat_lampiran l WHERE l.peserta_id=$1::uuid ORDER BY l.uploaded_at, l.id`,
      [item.dariPesertaId])).rows : []
    respond(res, 200, {
      item,
      lampiran: lampiran.map((l) => ({ id: l.id, filename: l.filename, size: l.size_bytes, uploadedBy: l.uploaded_by, uploadedByName: l.display_name ?? '', uploadedAt: l.uploaded_at })),
      sertifikatPeserta: sertifikat.map((l) => ({ id: l.id, filename: l.filename, size: l.size_bytes })),
    })
  }))

  router.patch('/:id', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const b = body(req, [...FIELD, 'version'])
    const version = versi(b.version)
    const v = nilai(b)
    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      const cur = (await c.query(
        `SELECT nama,kategori,nomor,penerbit,tanggal_terbit::text AS tanggal_terbit,berlaku_sampai::text AS berlaku_sampai,catatan
           FROM sdl_sumda_kompetensi WHERE id=$1::uuid`, [id])).rows[0]
      const lama = { nama: cur.nama, kategori: cur.kategori, nomor: cur.nomor, penerbit: cur.penerbit, tanggalTerbit: cur.tanggal_terbit, berlakuSampai: cur.berlaku_sampai, catatan: cur.catatan }
      const berubah = FIELD.filter((f) => (lama[f] ?? null) !== (v[f] ?? null))
      await c.query(
        `UPDATE sdl_sumda_kompetensi SET nama=$2,kategori=$3,nomor=$4,penerbit=$5,tanggal_terbit=$6,berlaku_sampai=$7,catatan=$8,
                updated_by=$9,updated_at=now(),version=version+1 WHERE id=$1::uuid`,
        [id, v.nama, v.kategori, v.nomor, v.penerbit, v.tanggalTerbit, v.berlakuSampai, v.catatan, req.actor])
      await auditSumda(c, req.actor, 'subbagsumda.kompetensi.update', 'subbagsumda.kompetensi', id, { fields: berubah, version: version + 1 })
      return ambil(c, id)
    })
    respond(res, 200, { item })
  }))

  router.delete('/:id', handle(async (req, res) => {
    await need(req, P.archive)
    const id = idParam(req.params.id)
    const version = parseGoInt(String(req.query.version ?? ''))
    if (version === undefined || version < 1) throw new HttpError(400, 'invalid_input')
    await withTransaction(pool, async (c) => {
      const cur = await kunci(c, id) // K16, review R5H29 S1: personel terarsip -> 409
      if (cur.version !== version) throw new HttpError(409, 'version_conflict')
      await c.query('UPDATE sdl_sumda_kompetensi SET deleted_at=now(),updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1::uuid', [id, req.actor])
      await auditSumda(c, req.actor, 'subbagsumda.kompetensi.archive', 'subbagsumda.kompetensi', id, { version: version + 1 })
    })
    res.set('Cache-Control', 'no-store')
    res.status(204).end()
  }))

  /* ------------------------------------------------------------ Lampiran */

  router.post('/:id/lampiran', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    await withTransaction(pool, (c) => kunci(c, id)) // keberadaan + personel terarsip, sebelum membaca berkas
    const { blob, filename, sealed, digest } = await bacaPdf(req, evidenceKey)
    const row = await withTransaction(pool, async (c) => {
      await kunci(c, id)
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_diklat_lampiran WHERE kompetensi_id=$1::uuid', [id])).rows[0].n
      if (n >= MAKS_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_sumda_diklat_lampiran(kompetensi_id,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text`, [id, filename, blob.length, digest, sealed, req.actor])).rows[0]
      await c.query('UPDATE sdl_sumda_kompetensi SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, req.actor]) // K28
      await auditSumda(c, req.actor, 'subbagsumda.kompetensi.lampiran.add', 'subbagsumda.kompetensi', id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const isArchive = await can(req.actor, P.archive)
    await withTransaction(pool, async (c) => {
      await kunci(c, id)
      const r = await c.query(
        'DELETE FROM sdl_sumda_diklat_lampiran WHERE id=$1::uuid AND kompetensi_id=$2::uuid AND (uploaded_by=$3::uuid OR $4::boolean)',
        [lid, id, req.actor, isArchive])
      if (r.rowCount !== 1) {
        const ada = await c.query('SELECT 1 FROM sdl_sumda_diklat_lampiran WHERE id=$1::uuid AND kompetensi_id=$2::uuid', [lid, id])
        throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
      }
      await c.query('UPDATE sdl_sumda_kompetensi SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, req.actor])
      await auditSumda(c, req.actor, 'subbagsumda.kompetensi.lampiran.delete', 'subbagsumda.kompetensi', id)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const r = await pool.query(
      `SELECT l.filename,l.sha256,l.body FROM sdl_sumda_diklat_lampiran l
         JOIN sdl_sumda_kompetensi k ON k.id=l.kompetensi_id AND k.deleted_at IS NULL
        WHERE l.id=$1::uuid AND l.kompetensi_id=$2::uuid`, [lid, id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    const plain = bukaPdf(r.rows[0], evidenceKey)
    pasangHeaderUnduh(res, r.rows[0].filename)
    await withTransaction(pool, (c) => auditSumda(c, req.actor, 'subbagsumda.kompetensi.lampiran.download', 'subbagsumda.kompetensi', id))
    res.status(200).end(plain)
  }))

  return router
}
