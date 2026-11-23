import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { MAKS_LAMPIRAN, bacaPdf, bukaPdf, pasangHeaderUnduh } from './lampiran.js'
import { HttpError, UUID_RE, body, idParam, makeHandle, permit, pilihan, tanggal, teks } from './umum.js'

/**
 * R5H29: Subbagsumda — Diklat (kegiatan + peserta + lampiran). Migrasi 070. EXPRESS SAJA.
 * Dokumen: docs/R5H29-SUMDA-DIKLAT-KOMPETENSI.md (K1–K36). Kompetensi ada di kompetensi.js.
 *
 *   GET    /api/v1/subbagsumda/diklat/capabilities
 *   GET    /api/v1/subbagsumda/diklat?q=&status=&jenis=&tahun=&page=&size=
 *   POST   /api/v1/subbagsumda/diklat                         {nama,jenis,penyelenggara,lokasi,nomorSurat,tanggalMulai,tanggalSelesai,catatan}
 *   GET    /api/v1/subbagsumda/diklat/:id
 *   PATCH  /api/v1/subbagsumda/diklat/:id                     badan penuh + version (K7/K29)
 *   POST   /api/v1/subbagsumda/diklat/:id/status              {status,catatan,version[,tanggalSelesai]} (K8/K27)
 *   DELETE /api/v1/subbagsumda/diklat/:id?version=            arsip (A)
 *   POST   /api/v1/subbagsumda/diklat/:id/peserta             {personelIds,version} (K9/K22)
 *   PATCH  /api/v1/subbagsumda/diklat/:id/peserta/:pid        {hasil,nomorSertifikat,keterangan,version} (K10/K23/K26)
 *   DELETE /api/v1/subbagsumda/diklat/:id/peserta/:pid?version=
 *   POST|GET|DELETE /api/v1/subbagsumda/diklat/:id/lampiran[/:lid]
 *   POST|GET|DELETE /api/v1/subbagsumda/diklat/:id/peserta/:pid/lampiran[/:lid]
 *
 * Hak: R subbagsumda.personel.read · M subbagsumda.diklat.manage · A subbagsumda.diklat.archive.
 * Tanpa maker-checker (K3). Kegiatan terarsip: semua sub-endpoint 404 (K33).
 * KUNCI tetap: kegiatan -> peserta -> personel (FOR SHARE). Batch personel dikunci ORDER BY id.
 */

export const JENIS_DIKLAT = Object.freeze(['Pendidikan', 'Pelatihan', 'Kursus', 'Seminar/Lokakarya', 'Sertifikasi', 'Lainnya'])
export const STATUS_DIKLAT = Object.freeze(['Terjadwal', 'Berjalan', 'Selesai', 'Dibatalkan'])
export const HASIL = Object.freeze(['Belum', 'Lulus', 'Tidak lulus', 'Tidak hadir'])
const BERJALAN = ['Terjadwal', 'Berjalan']
const UKURAN_HALAMAN = new Set([5, 10, 50, 100])
const MAKS_PESERTA = 200
const MAKS_PER_KIRIM = 50
const TRANSISI = { Berjalan: ['Terjadwal'], Selesai: ['Berjalan'], Dibatalkan: ['Terjadwal', 'Berjalan'] }

const P = { read: 'subbagsumda.personel.read', manage: 'subbagsumda.diklat.manage', archive: 'subbagsumda.diklat.archive' }

const handle = makeHandle({
  sdl_sumda_diklat_peserta_uq: 'peserta_ganda',
  sdl_sumda_kompetensi_dari_uq: 'kompetensi_ganda',
})

function versi(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}

/** Audit tanpa data pribadi: hanya kunci daftar putih (K36). */
export async function auditSumda(c, actor, event, type, subject, meta = {}) {
  const out = {}
  for (const k of ['jenis', 'kategori', 'status', 'fields', 'version', 'jumlah']) if (Object.hasOwn(meta, k)) out[k] = meta[k]
  await c.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, event, type, subject, out])
}

const FIELD_KEGIATAN = ['nama', 'jenis', 'penyelenggara', 'lokasi', 'nomorSurat', 'tanggalMulai', 'tanggalSelesai', 'catatan']
function nilaiKegiatan(b) {
  const v = {
    nama: teks(b.nama, 3, 200),
    jenis: pilihan(b.jenis, JENIS_DIKLAT),
    penyelenggara: teks(b.penyelenggara, 0, 200),
    lokasi: teks(b.lokasi, 0, 200),
    nomorSurat: teks(b.nomorSurat, 0, 100),
    tanggalMulai: tanggal(b.tanggalMulai, 2000, 2100),
    tanggalSelesai: tanggal(b.tanggalSelesai, 2000, 2100),
    catatan: teks(b.catatan, 0, 2000, { multiline: true }),
  }
  if (v.tanggalSelesai && v.tanggalMulai && v.tanggalSelesai < v.tanggalMulai) throw new HttpError(400, 'invalid_input')
  return v
}

const KOLOM = `d.id::text,d.nama,d.jenis,d.penyelenggara,d.lokasi,d.nomor_surat,d.tanggal_mulai::text AS tanggal_mulai,
  d.tanggal_selesai::text AS tanggal_selesai,d.status,d.catatan,d.version,d.source_registry_id IS NOT NULL AS salinan,
  d.created_at,d.updated_at,cu.display_name AS created_name,
  (SELECT count(*)::int FROM sdl_sumda_diklat_peserta x WHERE x.diklat_id=d.id) AS jumlah_peserta`
const DARI = 'FROM sdl_sumda_diklat d LEFT JOIN sdl_users cu ON cu.id=d.created_by'

function mapKegiatan(r) {
  return {
    id: r.id, nama: r.nama, jenis: r.jenis, penyelenggara: r.penyelenggara, lokasi: r.lokasi, nomorSurat: r.nomor_surat,
    tanggalMulai: r.tanggal_mulai ?? '', tanggalSelesai: r.tanggal_selesai ?? '', status: r.status, catatan: r.catatan,
    version: r.version, salinan: r.salinan, jumlahPeserta: r.jumlah_peserta, createdByName: r.created_name ?? '',
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

async function ambil(c, id) {
  const r = await c.query(`SELECT ${KOLOM} ${DARI} WHERE d.id=$1::uuid AND d.deleted_at IS NULL`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return mapKegiatan(r.rows[0])
}

/** Kunci kegiatan yang belum terarsip (selalu lebih dulu dari peserta/personel). */
async function kunciKegiatan(c, id, mode = 'FOR UPDATE') {
  const r = await c.query(
    `SELECT id::text,status,version,tanggal_mulai::text AS tanggal_mulai,tanggal_selesai::text AS tanggal_selesai
       FROM sdl_sumda_diklat WHERE id=$1::uuid AND deleted_at IS NULL ${mode}`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return r.rows[0]
}

/** Peserta milik kegiatan ini (id silang -> 404), dikunci; personel dikunci FOR SHARE sesudahnya. */
async function kunciPeserta(c, id, pid) {
  const r = await c.query(
    `SELECT id::text,personel_id::text,hasil,version FROM sdl_sumda_diklat_peserta
      WHERE id=$1::uuid AND diklat_id=$2::uuid FOR UPDATE`, [pid, id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  const p = (await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR SHARE', [r.rows[0].personel_id])).rows[0]
  return { ...r.rows[0], terarsip: Boolean(p?.terarsip) }
}

async function naikVersiKegiatan(c, id, actor) {
  await c.query('UPDATE sdl_sumda_diklat SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, actor])
}
async function naikVersiPeserta(c, pid, actor) {
  await c.query('UPDATE sdl_sumda_diklat_peserta SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [pid, actor])
}

/** Riwayat diklat seorang personel untuk detail Master Personel (K18, aditif R5H27). */
export async function riwayatDiklatPersonel(db, personelId) {
  const r = await db.query(
    `SELECT d.id::text AS diklat_id,ps.id::text AS peserta_id,d.nama,d.jenis,d.status,d.tanggal_mulai::text AS tanggal_mulai,
            d.tanggal_selesai::text AS tanggal_selesai,ps.hasil,ps.nomor_sertifikat
       FROM sdl_sumda_diklat_peserta ps JOIN sdl_sumda_diklat d ON d.id=ps.diklat_id AND d.deleted_at IS NULL
      WHERE ps.personel_id=$1::uuid ORDER BY coalesce(d.tanggal_mulai,d.tanggal_selesai) DESC NULLS LAST, d.created_at DESC LIMIT 50`, [personelId])
  return r.rows.map((x) => ({
    diklatId: x.diklat_id, pesertaId: x.peserta_id, nama: x.nama, jenis: x.jenis, status: x.status,
    tanggalMulai: x.tanggal_mulai ?? '', tanggalSelesai: x.tanggal_selesai ?? '', hasil: x.hasil, nomorSertifikat: x.nomor_sertifikat,
  }))
}

export function createSumdaDiklatRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.SUMDA)
  const { can, need } = permit(pool)

  router.get('/capabilities', handle(async (req, res) => {
    const [read, manage, archive] = await Promise.all([P.read, P.manage, P.archive].map((k) => can(req.actor, k)))
    respond(res, 200, { canRead: read, canManage: manage, canArchive: archive })
  }))

  router.get('/', handle(async (req, res) => {
    await need(req, P.read)
    const q = teks(req.query.q ?? '', 0, 100)
    const status = String(req.query.status ?? '')
    const jenis = String(req.query.jenis ?? '')
    const tahunRaw = String(req.query.tahun ?? '')
    if (status !== '' && !STATUS_DIKLAT.includes(status)) throw new HttpError(400, 'invalid_input')
    if (jenis !== '' && !JENIS_DIKLAT.includes(jenis)) throw new HttpError(400, 'invalid_input')
    const tahun = tahunRaw === '' ? null : parseGoInt(tahunRaw)
    if (tahunRaw !== '' && (tahun === undefined || tahun < 2000 || tahun > 2100)) throw new HttpError(400, 'invalid_input')
    const page = req.query.page === undefined ? 1 : parseGoInt(String(req.query.page))
    const size = req.query.size === undefined ? 10 : parseGoInt(String(req.query.size))
    if (page === undefined || page < 1 || page > 100000 || !UKURAN_HALAMAN.has(size)) throw new HttpError(400, 'invalid_input')

    const where = ['d.deleted_at IS NULL']
    const args = []
    if (q !== '') {
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      const n = `$${args.length}`
      where.push(`(d.nama ILIKE ${n} OR d.penyelenggara ILIKE ${n} OR d.nomor_surat ILIKE ${n})`)
    }
    if (status !== '') { args.push(status); where.push(`d.status=$${args.length}`) }
    if (jenis !== '') { args.push(jenis); where.push(`d.jenis=$${args.length}`) }
    // K21: tahun dari tanggal mulai (atau selesai); salinan tanpa tanggal hanya di "semua tahun".
    if (tahun !== null) { args.push(tahun); where.push(`EXTRACT(YEAR FROM coalesce(d.tanggal_mulai,d.tanggal_selesai))=$${args.length}`) }
    const w = where.join(' AND ')
    const total = Number((await pool.query(`SELECT count(*) FROM sdl_sumda_diklat d WHERE ${w}`, args)).rows[0].count)
    const rows = (await pool.query(
      `SELECT ${KOLOM} ${DARI} WHERE ${w} ORDER BY coalesce(d.tanggal_mulai,d.tanggal_selesai) DESC NULLS LAST, d.created_at DESC, d.id
        LIMIT ${size} OFFSET ${(page - 1) * size}`, args)).rows
    respond(res, 200, { items: rows.map(mapKegiatan), total, page, size })
  }))

  router.post('/', json, handle(async (req, res) => {
    await need(req, P.manage)
    const v = nilaiKegiatan(body(req, FIELD_KEGIATAN))
    if (!v.tanggalMulai) throw new HttpError(400, 'invalid_input')
    const item = await withTransaction(pool, async (c) => {
      const r = await c.query(
        `INSERT INTO sdl_sumda_diklat(nama,jenis,penyelenggara,lokasi,nomor_surat,tanggal_mulai,tanggal_selesai,catatan,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id::text`,
        [v.nama, v.jenis, v.penyelenggara, v.lokasi, v.nomorSurat, v.tanggalMulai, v.tanggalSelesai, v.catatan, req.actor])
      const id = r.rows[0].id
      await c.query("INSERT INTO sdl_sumda_diklat_riwayat(diklat_id,dari,ke,oleh) VALUES($1,NULL,'Terjadwal',$2)", [id, req.actor])
      await auditSumda(c, req.actor, 'subbagsumda.diklat.create', 'subbagsumda.diklat', id, { jenis: v.jenis, status: 'Terjadwal' })
      return ambil(c, id)
    })
    respond(res, 201, { item })
  }))

  router.get('/:id', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id)
    const item = await ambil(pool, id)
    const peserta = (await pool.query(
      `SELECT ps.id::text,ps.personel_id::text,p.nrp,p.nama,p.status AS personel_status,p.deleted_at IS NOT NULL AS terarsip,
              coalesce(rm.short_name,p.pangkat) AS pangkat_label,p.unit_kerja,ps.hasil,ps.nomor_sertifikat,ps.keterangan,ps.version,
              (SELECT count(*)::int FROM sdl_sumda_diklat_lampiran l WHERE l.peserta_id=ps.id) AS jumlah_lampiran,
              (SELECT k.id::text FROM sdl_sumda_kompetensi k WHERE k.dari_peserta_id=ps.id AND k.deleted_at IS NULL) AS kompetensi_id
         FROM sdl_sumda_diklat_peserta ps JOIN sdl_sumda_personel p ON p.id=ps.personel_id
         LEFT JOIN sdl_polri_rank_master rm ON p.jenis IS DISTINCT FROM 'PNS' AND rm.code=p.pangkat
        WHERE ps.diklat_id=$1::uuid ORDER BY lower(p.nama), ps.id`, [id])).rows
    const lampiran = (await pool.query(
      `SELECT l.id::text,l.peserta_id::text,l.filename,l.size_bytes,l.uploaded_by::text,u.display_name,l.uploaded_at
         FROM sdl_sumda_diklat_lampiran l LEFT JOIN sdl_users u ON u.id=l.uploaded_by
        WHERE l.diklat_id=$1::uuid OR l.peserta_id IN (SELECT id FROM sdl_sumda_diklat_peserta WHERE diklat_id=$1::uuid)
        ORDER BY l.uploaded_at, l.id`, [id])).rows
    const riwayat = (await pool.query(
      `SELECT h.dari,h.ke,h.catatan,u.display_name,h.pada FROM sdl_sumda_diklat_riwayat h
         LEFT JOIN sdl_users u ON u.id=h.oleh WHERE h.diklat_id=$1::uuid ORDER BY h.id`, [id])).rows
    const mapL = (l) => ({ id: l.id, filename: l.filename, size: l.size_bytes, uploadedBy: l.uploaded_by, uploadedByName: l.display_name ?? '', uploadedAt: l.uploaded_at })
    respond(res, 200, {
      item,
      peserta: peserta.map((p) => ({
        id: p.id, personelId: p.personel_id, nrp: p.nrp, nama: p.nama, personelStatus: p.personel_status, terarsip: p.terarsip,
        pangkatLabel: p.pangkat_label, unitKerja: p.unit_kerja, hasil: p.hasil, nomorSertifikat: p.nomor_sertifikat,
        keterangan: p.keterangan, version: p.version, kompetensiId: p.kompetensi_id ?? null,
        lampiran: lampiran.filter((l) => l.peserta_id === p.id).map(mapL),
      })),
      lampiran: lampiran.filter((l) => !l.peserta_id).map(mapL),
      riwayat: riwayat.map((h) => ({ dari: h.dari, ke: h.ke, catatan: h.catatan, oleh: h.display_name ?? '', pada: h.pada })),
    })
  }))

  router.patch('/:id', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const b = body(req, [...FIELD_KEGIATAN, 'version'])
    const version = versi(b.version)
    const v = nilaiKegiatan(b)
    const item = await withTransaction(pool, async (c) => {
      const cur = (await c.query(
        `SELECT nama,jenis,penyelenggara,lokasi,nomor_surat,tanggal_mulai::text AS tanggal_mulai,tanggal_selesai::text AS tanggal_selesai,
                status,catatan,version,source_registry_id IS NOT NULL AS salinan
           FROM sdl_sumda_diklat WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0]
      if (!cur) throw new HttpError(404, 'not_found')
      if (cur.version !== version) throw new HttpError(409, 'version_conflict')
      const lama = {
        nama: cur.nama, jenis: cur.jenis, penyelenggara: cur.penyelenggara, lokasi: cur.lokasi, nomorSurat: cur.nomor_surat,
        tanggalMulai: cur.tanggal_mulai, tanggalSelesai: cur.tanggal_selesai, catatan: cur.catatan,
      }
      const berubah = FIELD_KEGIATAN.filter((k) => (lama[k] ?? null) !== (v[k] ?? null))
      // K7/K29: setelah Selesai/Dibatalkan hanya catatan yang boleh berubah.
      if (!BERJALAN.includes(cur.status) && berubah.some((k) => k !== 'catatan')) throw new HttpError(409, 'status_tidak_sesuai')
      // Tanggal mulai wajib, kecuali salinan registry yang memang tidak punya (K17).
      if (!v.tanggalMulai && !(cur.salinan && !lama.tanggalMulai)) throw new HttpError(400, 'invalid_input')
      if (cur.status === 'Selesai' && !v.tanggalSelesai && !cur.salinan) throw new HttpError(400, 'invalid_input')
      await c.query(
        `UPDATE sdl_sumda_diklat SET nama=$2,jenis=$3,penyelenggara=$4,lokasi=$5,nomor_surat=$6,tanggal_mulai=$7,tanggal_selesai=$8,
                catatan=$9,updated_by=$10,updated_at=now(),version=version+1 WHERE id=$1::uuid`,
        [id, v.nama, v.jenis, v.penyelenggara, v.lokasi, v.nomorSurat, v.tanggalMulai, v.tanggalSelesai, v.catatan, req.actor])
      await auditSumda(c, req.actor, 'subbagsumda.diklat.update', 'subbagsumda.diklat', id, { fields: berubah, version: version + 1 })
      return ambil(c, id)
    })
    respond(res, 200, { item })
  }))

  router.post('/:id/status', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const b = body(req, ['status', 'catatan', 'version', 'tanggalSelesai'])
    const ke = pilihan(b.status, ['Berjalan', 'Selesai', 'Dibatalkan'])
    if (ke !== 'Selesai' && b.tanggalSelesai !== undefined) throw new HttpError(400, 'invalid_input')
    const version = versi(b.version)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    if (ke === 'Dibatalkan' && [...catatan].length < 8) throw new HttpError(400, 'invalid_input')
    const tglSelesai = tanggal(b.tanggalSelesai, 2000, 2100)
    const item = await withTransaction(pool, async (c) => {
      const k = await kunciKegiatan(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      if (!TRANSISI[ke].includes(k.status)) throw new HttpError(409, 'status_tidak_sesuai')
      let selesai = k.tanggal_selesai
      if (ke === 'Selesai') {
        selesai = tglSelesai ?? k.tanggal_selesai
        if (!selesai) throw new HttpError(400, 'invalid_input') // K8/K27
        if (k.tanggal_mulai && selesai < k.tanggal_mulai) throw new HttpError(400, 'invalid_input')
      }
      const r = await c.query(
        `UPDATE sdl_sumda_diklat SET status=$2,tanggal_selesai=$3,updated_by=$4,updated_at=now(),version=version+1
          WHERE id=$1::uuid AND status=$5 AND version=$6 AND deleted_at IS NULL`,
        [id, ke, selesai, req.actor, k.status, version])
      if (r.rowCount !== 1) throw new HttpError(409, 'version_conflict')
      await c.query('INSERT INTO sdl_sumda_diklat_riwayat(diklat_id,dari,ke,catatan,oleh) VALUES($1,$2,$3,$4,$5)', [id, k.status, ke, catatan, req.actor])
      const ev = { Berjalan: 'mulai', Selesai: 'selesai', Dibatalkan: 'batalkan' }[ke]
      await auditSumda(c, req.actor, `subbagsumda.diklat.${ev}`, 'subbagsumda.diklat', id, { status: ke })
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
      const k = await kunciKegiatan(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      await c.query('UPDATE sdl_sumda_diklat SET deleted_at=now(),updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1::uuid', [id, req.actor])
      await auditSumda(c, req.actor, 'subbagsumda.diklat.archive', 'subbagsumda.diklat', id, { version: version + 1 })
    })
    res.set('Cache-Control', 'no-store')
    res.status(204).end()
  }))

  /* ------------------------------------------------------------- Peserta */

  router.post('/:id/peserta', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const b = body(req, ['personelIds', 'version'])
    const version = versi(b.version)
    const ids = b.personelIds
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAKS_PER_KIRIM) throw new HttpError(400, 'invalid_input')
    if (ids.some((x) => typeof x !== 'string' || !UUID_RE.test(x))) throw new HttpError(400, 'invalid_input')
    const unik = [...new Set(ids.map((x) => x.toLowerCase()))]
    if (unik.length !== ids.length) throw new HttpError(400, 'invalid_input') // K22: ganda dalam kiriman
    const item = await withTransaction(pool, async (c) => {
      const k = await kunciKegiatan(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      if (!BERJALAN.includes(k.status)) throw new HttpError(409, 'status_tidak_sesuai')
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_diklat_peserta WHERE diklat_id=$1::uuid', [id])).rows[0].n
      if (n + unik.length > MAKS_PESERTA) throw new HttpError(409, 'batas_peserta')
      // Personel dikunci berurutan (ORDER BY id) supaya kiriman yang beririsan tidak saling menunggu.
      const ps = (await c.query(
        `SELECT id::text,status,deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel
          WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE`, [unik])).rows
      if (ps.length !== unik.length) throw new HttpError(404, 'not_found')
      if (ps.some((p) => p.terarsip)) throw new HttpError(409, 'personel_terarsip') // K16
      if (ps.some((p) => !['Aktif', 'MPP'].includes(p.status))) throw new HttpError(409, 'personel_tidak_aktif') // K9
      await c.query(
        `INSERT INTO sdl_sumda_diklat_peserta(diklat_id,personel_id,created_by,updated_by)
         SELECT $1::uuid, x::uuid, $2, $2 FROM unnest($3::text[]) AS x`, [id, req.actor, unik])
      await naikVersiKegiatan(c, id, req.actor) // K28
      await auditSumda(c, req.actor, 'subbagsumda.diklat.peserta.add', 'subbagsumda.diklat', id, { jumlah: unik.length })
      return ambil(c, id)
    })
    respond(res, 201, { item })
  }))

  router.patch('/:id/peserta/:pid', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const pid = idParam(req.params.pid)
    const b = body(req, ['hasil', 'nomorSertifikat', 'keterangan', 'version'])
    const version = versi(b.version)
    const hasil = pilihan(b.hasil, HASIL)
    const nomor = teks(b.nomorSertifikat, 0, 100)
    const keterangan = teks(b.keterangan, 0, 500, { multiline: true })
    if (nomor !== '' && hasil !== 'Lulus') throw new HttpError(400, 'invalid_input') // K23
    await withTransaction(pool, async (c) => {
      const k = await kunciKegiatan(c, id, 'FOR SHARE')
      if (k.status !== 'Selesai') throw new HttpError(409, 'hasil_belum_boleh') // K3/K10
      const p = await kunciPeserta(c, id, pid)
      if (p.version !== version) throw new HttpError(409, 'version_conflict')
      if (p.terarsip) throw new HttpError(409, 'personel_terarsip') // K16
      if (p.hasil === 'Lulus' && hasil !== 'Lulus') {
        // K26: kompetensi turunan aktif mengikat hasil Lulus.
        const kt = await c.query('SELECT 1 FROM sdl_sumda_kompetensi WHERE dari_peserta_id=$1::uuid AND deleted_at IS NULL', [pid])
        if (kt.rowCount) throw new HttpError(409, 'kompetensi_terkait')
      }
      await c.query(
        `UPDATE sdl_sumda_diklat_peserta SET hasil=$2,nomor_sertifikat=$3,keterangan=$4,updated_by=$5,updated_at=now(),version=version+1
          WHERE id=$1::uuid`, [pid, hasil, nomor, keterangan, req.actor])
      await auditSumda(c, req.actor, 'subbagsumda.diklat.peserta.update', 'subbagsumda.diklat', id, { version: version + 1 })
    })
    respond(res, 200, await detailPeserta(pool, id, pid))
  }))

  router.delete('/:id/peserta/:pid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const pid = idParam(req.params.pid)
    const version = parseGoInt(String(req.query.version ?? ''))
    if (version === undefined || version < 1) throw new HttpError(400, 'invalid_input')
    await withTransaction(pool, async (c) => {
      const k = await kunciKegiatan(c, id)
      if (!BERJALAN.includes(k.status)) throw new HttpError(409, 'status_tidak_sesuai') // K14
      const p = await kunciPeserta(c, id, pid)
      if (p.version !== version) throw new HttpError(409, 'version_conflict')
      await c.query('DELETE FROM sdl_sumda_diklat_peserta WHERE id=$1::uuid AND diklat_id=$2::uuid', [pid, id])
      await naikVersiKegiatan(c, id, req.actor)
      await auditSumda(c, req.actor, 'subbagsumda.diklat.peserta.delete', 'subbagsumda.diklat', id, { jumlah: 1 })
    })
    res.set('Cache-Control', 'no-store')
    res.status(204).end()
  }))

  async function detailPeserta(db, id, pid) {
    const r = await db.query(
      `SELECT ps.id::text,ps.hasil,ps.nomor_sertifikat,ps.keterangan,ps.version FROM sdl_sumda_diklat_peserta ps
        WHERE ps.id=$1::uuid AND ps.diklat_id=$2::uuid`, [pid, id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    const x = r.rows[0]
    return { peserta: { id: x.id, hasil: x.hasil, nomorSertifikat: x.nomor_sertifikat, keterangan: x.keterangan, version: x.version } }
  }

  /* ------------------------------------------------ Lampiran kegiatan */

  // K15: lampiran kegiatan selama belum Dibatalkan.
  async function cekKegiatanLampiran(c, id, lock) {
    const k = await kunciKegiatan(c, id, lock ? 'FOR UPDATE' : '')
    if (k.status === 'Dibatalkan') throw new HttpError(409, 'status_tidak_sesuai')
    return k
  }

  router.post('/:id/lampiran', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    await cekKegiatanLampiran(pool, id, false) // sebelum membaca berkas besar
    const { blob, filename, sealed, digest } = await bacaPdf(req, evidenceKey)
    const row = await withTransaction(pool, async (c) => {
      await cekKegiatanLampiran(c, id, true)
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_diklat_lampiran WHERE diklat_id=$1::uuid', [id])).rows[0].n
      if (n >= MAKS_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_sumda_diklat_lampiran(diklat_id,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text`, [id, filename, blob.length, digest, sealed, req.actor])).rows[0]
      await naikVersiKegiatan(c, id, req.actor) // K28
      await auditSumda(c, req.actor, 'subbagsumda.diklat.lampiran.add', 'subbagsumda.diklat', id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const isArchive = await can(req.actor, P.archive)
    await withTransaction(pool, async (c) => {
      await cekKegiatanLampiran(c, id, true)
      const r = await c.query(
        'DELETE FROM sdl_sumda_diklat_lampiran WHERE id=$1::uuid AND diklat_id=$2::uuid AND (uploaded_by=$3::uuid OR $4::boolean)',
        [lid, id, req.actor, isArchive])
      if (r.rowCount !== 1) {
        const ada = await c.query('SELECT 1 FROM sdl_sumda_diklat_lampiran WHERE id=$1::uuid AND diklat_id=$2::uuid', [lid, id])
        throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
      }
      await naikVersiKegiatan(c, id, req.actor)
      await auditSumda(c, req.actor, 'subbagsumda.diklat.lampiran.delete', 'subbagsumda.diklat', id)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const r = await pool.query(
      `SELECT l.filename,l.sha256,l.body FROM sdl_sumda_diklat_lampiran l
         JOIN sdl_sumda_diklat d ON d.id=l.diklat_id AND d.deleted_at IS NULL
        WHERE l.id=$1::uuid AND l.diklat_id=$2::uuid`, [lid, id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    const plain = bukaPdf(r.rows[0], evidenceKey)
    pasangHeaderUnduh(res, r.rows[0].filename)
    await withTransaction(pool, (c) => auditSumda(c, req.actor, 'subbagsumda.diklat.lampiran.download', 'subbagsumda.diklat', id))
    res.status(200).end(plain)
  }))

  /* ------------------------------------------------- Lampiran peserta */

  // K15/K16: sertifikat peserta hanya saat kegiatan Selesai dan personelnya belum terarsip.
  async function cekPesertaLampiran(c, id, pid) {
    const k = await kunciKegiatan(c, id, 'FOR SHARE')
    if (k.status !== 'Selesai') throw new HttpError(409, 'status_tidak_sesuai')
    const p = await kunciPeserta(c, id, pid)
    if (p.terarsip) throw new HttpError(409, 'personel_terarsip')
    return p
  }

  router.post('/:id/peserta/:pid/lampiran', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const pid = idParam(req.params.pid)
    await withTransaction(pool, (c) => cekPesertaLampiran(c, id, pid)) // sebelum membaca berkas besar
    const { blob, filename, sealed, digest } = await bacaPdf(req, evidenceKey)
    const row = await withTransaction(pool, async (c) => {
      await cekPesertaLampiran(c, id, pid)
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_diklat_lampiran WHERE peserta_id=$1::uuid', [pid])).rows[0].n
      if (n >= MAKS_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_sumda_diklat_lampiran(peserta_id,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text`, [pid, filename, blob.length, digest, sealed, req.actor])).rows[0]
      await naikVersiPeserta(c, pid, req.actor) // K28
      await auditSumda(c, req.actor, 'subbagsumda.diklat.peserta.lampiran.add', 'subbagsumda.diklat', id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/peserta/:pid/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const pid = idParam(req.params.pid); const lid = idParam(req.params.lid)
    const isArchive = await can(req.actor, P.archive)
    await withTransaction(pool, async (c) => {
      await cekPesertaLampiran(c, id, pid)
      const r = await c.query(
        'DELETE FROM sdl_sumda_diklat_lampiran WHERE id=$1::uuid AND peserta_id=$2::uuid AND (uploaded_by=$3::uuid OR $4::boolean)',
        [lid, pid, req.actor, isArchive])
      if (r.rowCount !== 1) {
        const ada = await c.query('SELECT 1 FROM sdl_sumda_diklat_lampiran WHERE id=$1::uuid AND peserta_id=$2::uuid', [lid, pid])
        throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
      }
      await naikVersiPeserta(c, pid, req.actor)
      await auditSumda(c, req.actor, 'subbagsumda.diklat.peserta.lampiran.delete', 'subbagsumda.diklat', id)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/:id/peserta/:pid/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id); const pid = idParam(req.params.pid); const lid = idParam(req.params.lid)
    // Rantai penuh: lampiran milik peserta ini, peserta milik kegiatan ini, kegiatan belum terarsip (K33).
    const r = await pool.query(
      `SELECT l.filename,l.sha256,l.body FROM sdl_sumda_diklat_lampiran l
         JOIN sdl_sumda_diklat_peserta ps ON ps.id=l.peserta_id AND ps.diklat_id=$3::uuid
         JOIN sdl_sumda_diklat d ON d.id=ps.diklat_id AND d.deleted_at IS NULL
        WHERE l.id=$1::uuid AND l.peserta_id=$2::uuid`, [lid, pid, id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    const plain = bukaPdf(r.rows[0], evidenceKey)
    pasangHeaderUnduh(res, r.rows[0].filename)
    await withTransaction(pool, (c) => auditSumda(c, req.actor, 'subbagsumda.diklat.peserta.lampiran.download', 'subbagsumda.diklat', id))
    res.status(200).end(plain)
  }))

  return router
}
