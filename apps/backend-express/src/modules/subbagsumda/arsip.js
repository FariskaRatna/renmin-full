import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { HARI_INI, HttpError, UUID_RE, body, idParam, makeHandle, permit, pilihan, tanggal, teks } from './umum.js'
import { MAKS_LAMPIRAN, bacaPdf, bukaPdf, pasangHeaderUnduh } from './lampiran.js'

/**
 * R5H32: Subbagsumda — Persuratan & Arsip (register arsip dokumen). Migrasi 073. EXPRESS SAJA.
 * Dokumen: docs/R5H32-SUMDA-ARSIP-LAPORAN.md (K1–K49).
 *
 *   GET    /api/v1/subbagsumda/arsip/capabilities
 *   GET    /api/v1/subbagsumda/arsip?q=&jenis=&status=&tahun=&kerahasiaan=&retensi=&page=&size=
 *   GET    /api/v1/subbagsumda/arsip/surat-tertaut                          (K30, Ma + Ps)
 *   POST   /api/v1/subbagsumda/arsip                    field K8 + suratId?
 *   GET    /api/v1/subbagsumda/arsip/:id
 *   PATCH  /api/v1/subbagsumda/arsip/:id                field K8 + suratId? + version
 *   POST   /api/v1/subbagsumda/arsip/:id/aksi           {aksi:inaktifkan|aktifkan|musnahkan,catatan,version}
 *   POST · GET · DELETE  /api/v1/subbagsumda/arsip/:id/lampiran[/:lid]   (POST ?peran=DOKUMEN|BA_MUSNAH)
 *
 * Hak: Ra arsip.read · Ma arsip.manage · Xa arsip.restricted · Ps persuratan.read (grant subbagsumda).
 *
 * K29: arsip TERBATAS hanya ada bagi pencatatnya dan pemegang Xa. Semua jalur baca/mutasi memakai SATU predikat
 * `bolehArsip` di SQL; baris yang tidak boleh tidak tampil, tidak dihitung, tidak bisa dicari, dan detail/mutasinya
 * 404 identik dengan UUID fiktif (kunci dicek SEBELUM status/versi/isian).
 * K27: aturan bisnis (peta status, Musnah hanya dari Inaktif, BA wajib, satu surat satu arsip) di sini, bukan di migrasi.
 * KUNCI (urutan tetap): arsip (FOR UPDATE) → surat (FOR NO KEY UPDATE) → personel (FOR SHARE).
 * Modul persuratan R5H21 tidak disentuh; arsip hanya membaca sdl_surat_antar(_tujuan).
 * JANGAN mengimpor personel.js dari sini (siklus impor; personel.js mengimpor berkas ini).
 */

export const JENIS_ARSIP = Object.freeze(['SURAT_MASUK', 'SURAT_KELUAR', 'NOTA_DINAS', 'SURAT_KEPUTUSAN', 'BERITA_ACARA', 'LAINNYA'])
export const STATUS_ARSIP = Object.freeze(['Aktif', 'Inaktif', 'Musnah'])
export const KERAHASIAAN = Object.freeze(['BIASA', 'TERBATAS'])
export const PERAN_LAMPIRAN = Object.freeze(['DOKUMEN', 'BA_MUSNAH'])
export const TAHAP_RETENSI = Object.freeze(['H-30', 'JATUH_TEMPO'])
const UKURAN_HALAMAN = new Set([5, 10, 50, 100])
const MAKS_SURAT = 200 // K48
const MAKS_ARSIP_PERSONEL = 50 // K45
const FIELD = ['nomor', 'jenis', 'perihal', 'tanggal', 'asalTujuan', 'kodeKlasifikasi', 'lokasiSimpan', 'retensiSampai',
  'kerahasiaan', 'catatan', 'personelId', 'suratId']

const P = {
  read: 'subbagsumda.arsip.read',
  manage: 'subbagsumda.arsip.manage',
  restricted: 'subbagsumda.arsip.restricted',
  surat: 'persuratan.read',
}

const handle = makeHandle()

/**
 * K29: SATU-SATUNYA predikat visibilitas arsip. `actor`/`xa` = nomor parameter SQL (xa = boolean hasil PERMIT Xa).
 * Dipakai juga oleh personel.js (detail, dashboard) dan laporan/ekspor.
 */
export const bolehArsip = (actor, xa, a = 'a') => `(${a}.kerahasiaan='BIASA' OR ${a}.created_by=${actor}::uuid OR ${xa}::boolean)`

const sisaRetensiSql = (a = 'a', hari = HARI_INI) => `(${a}.retensi_sampai - ${hari})`
/** K35: satu-satunya rumus tahap retensi (WIB); hanya Aktif/Inaktif bertanggal retensi. */
export function tahapRetensiSql(a = 'a', hari = HARI_INI) {
  const sisa = sisaRetensiSql(a, hari)
  return `CASE WHEN ${a}.status IN ('Aktif','Inaktif') AND ${a}.retensi_sampai IS NOT NULL THEN
    CASE WHEN ${sisa} <= 0 THEN 'JATUH_TEMPO' WHEN ${sisa} <= 30 THEN 'H-30' END END`
}
/** K25/K36: jumlah arsip TERLIHAT dengan retensi ≤ 30 hari atau terlewat (dashboard). Parameter $1 actor, $2 xa. */
export const arsipRetensi30Sql = (actor = '$1', xa = '$2') =>
  `SELECT count(*)::int AS n FROM sdl_sumda_arsip a WHERE ${bolehArsip(actor, xa)} AND ${tahapRetensiSql()} IS NOT NULL`

/**
 * K30: surat R5H21 yang sah ditautkan — sudah dikirim, dan dikirim oleh Sumda ATAU ditujukan ke Sumda dan sudah
 * ditandai diterima. Alias surat `s`.
 */
export const SURAT_SAH_SQL = `(s.status='dikirim' AND (s.unit_pengirim='subbagsumda' OR EXISTS(
  SELECT 1 FROM sdl_surat_antar_tujuan t WHERE t.surat_id=s.id AND t.unit_key='subbagsumda' AND t.diterima_at IS NOT NULL)))`

export const KOLOM_ARSIP = `a.id::text,a.nomor,a.jenis,a.perihal,a.tanggal::text AS tanggal,a.asal_tujuan,a.kode_klasifikasi,a.lokasi_simpan,
  a.retensi_sampai::text AS retensi_sampai,${sisaRetensiSql()} AS sisa_retensi,${tahapRetensiSql()} AS tahap_retensi,a.kerahasiaan,a.catatan,
  a.personel_id::text,p.nama AS personel_nama,p.nrp AS personel_nrp,p.deleted_at IS NOT NULL AS personel_terarsip,
  a.surat_id::text,a.status,mu.display_name AS musnah_name,a.musnah_at,a.created_by::text,cu.display_name AS created_name,
  a.version,a.created_at,a.updated_at,a.updated_by::text`
export const DARI_ARSIP = `FROM sdl_sumda_arsip a
  LEFT JOIN sdl_sumda_personel p ON p.id=a.personel_id
  LEFT JOIN sdl_users cu ON cu.id=a.created_by
  LEFT JOIN sdl_users mu ON mu.id=a.musnah_by`

function mapArsip(r) {
  return {
    id: r.id, nomor: r.nomor, jenis: r.jenis, perihal: r.perihal, tanggal: r.tanggal, asalTujuan: r.asal_tujuan,
    kodeKlasifikasi: r.kode_klasifikasi, lokasiSimpan: r.lokasi_simpan, retensiSampai: r.retensi_sampai ?? '',
    sisaRetensi: r.tahap_retensi ? r.sisa_retensi : null, tahapRetensi: r.tahap_retensi ?? null,
    kerahasiaan: r.kerahasiaan, catatan: r.catatan,
    personel: r.personel_id ? { id: r.personel_id, nama: r.personel_nama, nrp: r.personel_nrp, terarsip: r.personel_terarsip } : null,
    suratId: r.surat_id ?? null, status: r.status,
    musnah: r.musnah_at ? { olehNama: r.musnah_name ?? '', pada: r.musnah_at } : null,
    createdBy: r.created_by, createdByName: r.created_name ?? '', version: r.version,
    createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by,
  }
}

async function ambil(c, id, actor, xa) {
  const r = await c.query(`SELECT ${KOLOM_ARSIP} ${DARI_ARSIP} WHERE a.id=$1::uuid AND ${bolehArsip('$2', '$3')}`, [id, actor, xa])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return mapArsip(r.rows[0])
}

/** K24/K45: arsip yang menautkan seorang personel — hanya baris terlihat, maks. 50, tanpa catatan. */
export async function arsipPersonel(db, personelId, actor, xa) {
  const r = await db.query(
    `SELECT a.id::text,a.nomor,a.jenis,a.perihal,a.tanggal::text AS tanggal,a.status,a.kerahasiaan,
            a.retensi_sampai::text AS retensi_sampai,${tahapRetensiSql()} AS tahap_retensi
       FROM sdl_sumda_arsip a WHERE a.personel_id=$1::uuid AND ${bolehArsip('$2', '$3')}
      ORDER BY a.tanggal DESC, a.created_at DESC, a.id LIMIT ${MAKS_ARSIP_PERSONEL}`, [personelId, actor, xa])
  return r.rows.map((a) => ({
    id: a.id, nomor: a.nomor, jenis: a.jenis, perihal: a.perihal, tanggal: a.tanggal, status: a.status,
    kerahasiaan: a.kerahasiaan, retensiSampai: a.retensi_sampai ?? '', tahapRetensi: a.tahap_retensi ?? null,
  }))
}

/** Audit tanpa data pribadi (K49): tanpa nomor, perihal, personel, nama berkas, atau catatan. */
async function audit(c, actor, event, subject, meta = {}) {
  const out = {}
  for (const k of ['status', 'jenis', 'kerahasiaan', 'fields', 'version']) if (Object.hasOwn(meta, k)) out[k] = meta[k]
  await c.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, event, 'subbagsumda.arsip', subject, out])
}

async function riwayat(c, id, dari, ke, catatan, oleh) {
  await c.query('INSERT INTO sdl_sumda_arsip_riwayat(arsip_id,dari,ke,catatan,oleh) VALUES($1,$2,$3,$4,$5)', [id, dari, ke, catatan, oleh])
}

function versi(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}

/** Kunci arsip yang TERLIHAT (K29): tidak terlihat → 404 sebelum hak/status/versi lain. */
async function kunci(c, id, actor, xa) {
  const r = await c.query(
    `SELECT a.id::text,a.nomor,a.jenis,a.perihal,a.tanggal::text AS tanggal,a.asal_tujuan,a.kode_klasifikasi,a.lokasi_simpan,
            a.retensi_sampai::text AS retensi_sampai,a.kerahasiaan,a.catatan,a.personel_id::text,a.surat_id::text,a.status,a.version
       FROM sdl_sumda_arsip a WHERE a.id=$1::uuid AND ${bolehArsip('$2', '$3')} FOR UPDATE`, [id, actor, xa])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return r.rows[0]
}

async function naikVersi(c, id, actor) {
  await c.query('UPDATE sdl_sumda_arsip SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, actor])
}

const uuidOpsional = (v) => {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, 'invalid_input')
  return v.toLowerCase()
}

/** Isian K8. */
function nilaiArsip(b) {
  const tgl = tanggal(b.tanggal, 1950, 2100)
  if (!tgl) throw new HttpError(400, 'invalid_input')
  const retensi = tanggal(b.retensiSampai, 1950, 2100)
  if (retensi && retensi < tgl) throw new HttpError(400, 'invalid_input') // K35
  return {
    nomor: teks(b.nomor, 0, 120), jenis: pilihan(b.jenis, JENIS_ARSIP), perihal: teks(b.perihal, 3, 240), tanggal: tgl,
    asalTujuan: teks(b.asalTujuan, 0, 200), kodeKlasifikasi: teks(b.kodeKlasifikasi, 0, 60), lokasiSimpan: teks(b.lokasiSimpan, 0, 200),
    retensiSampai: retensi, kerahasiaan: pilihan(b.kerahasiaan, KERAHASIAAN), catatan: teks(b.catatan, 0, 2000, { multiline: true }),
    personelId: uuidOpsional(b.personelId), suratId: uuidOpsional(b.suratId),
  }
}

/** K30/K31: surat dikunci, harus sah, dan belum ditautkan ke arsip lain (termasuk arsip Musnah). */
async function cekSurat(c, suratId, kecuali) {
  const s = (await c.query(`SELECT ${SURAT_SAH_SQL} AS sah FROM sdl_surat_antar s WHERE s.id=$1::uuid FOR NO KEY UPDATE OF s`, [suratId])).rows[0]
  if (!s || !s.sah) throw new HttpError(400, 'surat_tidak_berlaku')
  const ada = (await c.query(
    'SELECT EXISTS(SELECT 1 FROM sdl_sumda_arsip WHERE surat_id=$1::uuid AND ($2::uuid IS NULL OR id<>$2::uuid)) AS ok', [suratId, kecuali])).rows[0].ok
  if (ada) throw new HttpError(409, 'surat_sudah_diarsip')
}

/** K47: personel harus ada; yang sudah terarsip hanya boleh dipertahankan, bukan dipilih baru. */
async function cekPersonel(c, personelId, lama) {
  if (!personelId) return
  const p = (await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR SHARE', [personelId])).rows[0]
  if (!p) throw new HttpError(400, 'invalid_input')
  if (p.terarsip && personelId !== lama) throw new HttpError(409, 'personel_terarsip')
}

const KOLOM_UBAH = [
  ['nomor', 'nomor'], ['jenis', 'jenis'], ['perihal', 'perihal'], ['tanggal', 'tanggal'], ['asalTujuan', 'asal_tujuan'],
  ['kodeKlasifikasi', 'kode_klasifikasi'], ['lokasiSimpan', 'lokasi_simpan'], ['retensiSampai', 'retensi_sampai'],
  ['kerahasiaan', 'kerahasiaan'], ['catatan', 'catatan'], ['personelId', 'personel_id'], ['suratId', 'surat_id'],
]

export function createSumdaArsipRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.SUMDA)
  const { can, need } = permit(pool)

  router.get('/capabilities', handle(async (req, res) => {
    const [read, manage, restricted, surat] = await Promise.all([P.read, P.manage, P.restricted, P.surat].map((k) => can(req.actor, k)))
    respond(res, 200, { canRead: read, canManage: manage, canRestricted: restricted, canTautSurat: surat })
  }))

  router.get('/', handle(async (req, res) => {
    await need(req, P.read)
    const q = teks(req.query.q ?? '', 0, 100)
    const jenis = String(req.query.jenis ?? '')
    const status = String(req.query.status ?? '')
    const kerahasiaan = String(req.query.kerahasiaan ?? '')
    const retensi = String(req.query.retensi ?? '')
    if (jenis !== '' && !JENIS_ARSIP.includes(jenis)) throw new HttpError(400, 'invalid_input')
    if (status !== '' && !STATUS_ARSIP.includes(status)) throw new HttpError(400, 'invalid_input')
    if (kerahasiaan !== '' && !KERAHASIAAN.includes(kerahasiaan)) throw new HttpError(400, 'invalid_input')
    if (!['', '1'].includes(retensi)) throw new HttpError(400, 'invalid_input')
    let tahun = null
    if (req.query.tahun !== undefined && req.query.tahun !== '') {
      tahun = parseGoInt(String(req.query.tahun))
      if (tahun === undefined || tahun < 1950 || tahun > 2100) throw new HttpError(400, 'invalid_input')
    }
    const page = req.query.page === undefined ? 1 : parseGoInt(String(req.query.page))
    const size = req.query.size === undefined ? 10 : parseGoInt(String(req.query.size))
    if (page === undefined || page < 1 || page > 100000 || !UKURAN_HALAMAN.has(size)) throw new HttpError(400, 'invalid_input')
    const xa = await can(req.actor, P.restricted)
    // K29/K36: semua filter, urutan, dan hitungan atas baris yang TERLIHAT (CTE v).
    const args = [req.actor, xa]
    const where = ['TRUE']
    if (q !== '') {
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      const n = args.length
      where.push(`(v.nomor ILIKE $${n} OR v.perihal ILIKE $${n} OR v.asal_tujuan ILIKE $${n} OR v.kode_klasifikasi ILIKE $${n})`)
    }
    if (jenis !== '') { args.push(jenis); where.push(`v.jenis=$${args.length}`) }
    if (status !== '') { args.push(status); where.push(`v.status=$${args.length}`) }
    if (kerahasiaan !== '') { args.push(kerahasiaan); where.push(`v.kerahasiaan=$${args.length}`) }
    if (tahun !== null) { args.push(tahun); where.push(`extract(year FROM v.tanggal::date)=$${args.length}`) }
    if (retensi === '1') where.push('v.tahap_retensi IS NOT NULL')
    const w = where.join(' AND ')
    const cte = `WITH v AS (SELECT ${KOLOM_ARSIP} ${DARI_ARSIP} WHERE ${bolehArsip('$1', '$2')})`
    const total = Number((await pool.query(`${cte} SELECT count(*) FROM v WHERE ${w}`, args)).rows[0].count)
    const rows = (await pool.query(
      `${cte} SELECT * FROM v WHERE ${w} ORDER BY v.tanggal DESC, v.created_at DESC, v.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args)).rows
    respond(res, 200, { items: rows.map(mapArsip), total, page, size })
  }))

  router.get('/surat-tertaut', handle(async (req, res) => {
    await need(req, P.manage)
    await need(req, P.surat)
    const rows = (await pool.query(
      `SELECT s.id::text,s.nomor,s.tanggal::text AS tanggal,s.perihal,s.unit_pengirim,s.kode_arsip,s.tujuan_eksternal,s.sent_at,
              (SELECT string_agg(t.unit_key, ',' ORDER BY t.unit_key) FROM sdl_surat_antar_tujuan t WHERE t.surat_id=s.id) AS tujuan
         FROM sdl_surat_antar s
        WHERE ${SURAT_SAH_SQL} AND NOT EXISTS(SELECT 1 FROM sdl_sumda_arsip a WHERE a.surat_id=s.id)
        ORDER BY s.sent_at DESC, s.id LIMIT ${MAKS_SURAT}`)).rows
    respond(res, 200, {
      items: rows.map((s) => ({
        id: s.id, arah: s.unit_pengirim === 'subbagsumda' ? 'keluar' : 'masuk', nomor: s.nomor, tanggal: s.tanggal ?? '',
        perihal: s.perihal, unitPengirim: s.unit_pengirim, kodeArsip: s.kode_arsip,
        tujuan: [...(s.tujuan ? s.tujuan.split(',') : []), ...(s.tujuan_eksternal ? [s.tujuan_eksternal] : [])],
        dikirimPada: s.sent_at,
      })),
    })
  }))

  router.post('/', json, handle(async (req, res) => {
    await need(req, P.manage)
    const v = nilaiArsip(body(req, FIELD))
    if (v.suratId) await need(req, P.surat) // K30
    const item = await withTransaction(pool, async (c) => {
      if (v.suratId) await cekSurat(c, v.suratId, null)
      await cekPersonel(c, v.personelId, null)
      const id = (await c.query(
        `INSERT INTO sdl_sumda_arsip(nomor,jenis,perihal,tanggal,asal_tujuan,kode_klasifikasi,lokasi_simpan,retensi_sampai,kerahasiaan,
                                     catatan,personel_id,surat_id,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$12::uuid,$13,$13) RETURNING id::text`,
        [v.nomor, v.jenis, v.perihal, v.tanggal, v.asalTujuan, v.kodeKlasifikasi, v.lokasiSimpan, v.retensiSampai, v.kerahasiaan,
          v.catatan, v.personelId, v.suratId, req.actor])).rows[0].id
      await riwayat(c, id, null, 'Aktif', '', req.actor)
      await audit(c, req.actor, 'subbagsumda.arsip.create', id, { status: 'Aktif', jenis: v.jenis, kerahasiaan: v.kerahasiaan })
      return ambil(c, id, req.actor, false)
    })
    respond(res, 201, { item })
  }))

  router.get('/:id', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id)
    const xa = await can(req.actor, P.restricted)
    const item = await ambil(pool, id, req.actor, xa)
    // Ikut disaring bolehArsip di SQL (pertahanan berlapis), walau item sudah dipastikan terlihat.
    const lampiran = (await pool.query(
      `SELECT l.id::text,l.peran,l.filename,l.size_bytes,l.uploaded_by::text,u.display_name,l.uploaded_at
         FROM sdl_sumda_arsip_lampiran l JOIN sdl_sumda_arsip a ON a.id=l.arsip_id LEFT JOIN sdl_users u ON u.id=l.uploaded_by
        WHERE l.arsip_id=$1::uuid AND ${bolehArsip('$2', '$3')} ORDER BY l.uploaded_at, l.id`, [id, req.actor, xa])).rows
    const hist = (await pool.query(
      `SELECT h.dari,h.ke,h.catatan,u.display_name,h.pada
         FROM sdl_sumda_arsip_riwayat h JOIN sdl_sumda_arsip a ON a.id=h.arsip_id LEFT JOIN sdl_users u ON u.id=h.oleh
        WHERE h.arsip_id=$1::uuid AND ${bolehArsip('$2', '$3')} ORDER BY h.id`, [id, req.actor, xa])).rows
    let surat = null
    if (item.suratId) {
      if (!(await can(req.actor, P.surat))) surat = { dibatasi: true } // K30: info surat hanya bagi Ps
      else {
        const s = (await pool.query(
          'SELECT s.id::text,s.nomor,s.tanggal::text AS tanggal,s.perihal,s.unit_pengirim FROM sdl_surat_antar s WHERE s.id=$1::uuid', [item.suratId])).rows[0]
        surat = s
          ? { id: s.id, arah: s.unit_pengirim === 'subbagsumda' ? 'keluar' : 'masuk', nomor: s.nomor, tanggal: s.tanggal ?? '', perihal: s.perihal, unitPengirim: s.unit_pengirim }
          : { hilang: true } // R11: surat_id tanpa FK bisa yatim
      }
    }
    respond(res, 200, {
      item,
      surat,
      lampiran: lampiran.map((l) => ({ id: l.id, peran: l.peran, filename: l.filename, size: l.size_bytes, uploadedBy: l.uploaded_by, uploadedByName: l.display_name ?? '', uploadedAt: l.uploaded_at })),
      riwayat: hist.map((h) => ({ dari: h.dari, ke: h.ke, catatan: h.catatan, oleh: h.display_name ?? '', pada: h.pada })),
    })
  }))

  router.patch('/:id', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const b = body(req, [...FIELD, 'version'])
    const version = versi(b.version)
    const xa = await can(req.actor, P.restricted)
    const ps = await can(req.actor, P.surat)
    const hasil = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id, req.actor, xa)
      const v = nilaiArsip(b)
      // Hak dulu (403), baru versi/status (409) — pelajaran R5H31.
      if (k.kerahasiaan === 'TERBATAS' && v.kerahasiaan === 'BIASA' && !xa) throw new HttpError(403, 'access_denied') // K13/K34
      const suratBerubah = v.suratId !== k.surat_id
      if (suratBerubah && !ps) throw new HttpError(403, 'access_denied') // K30
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      if (k.status === 'Musnah') throw new HttpError(409, 'status_tidak_sesuai') // K9: final
      if (suratBerubah && v.suratId) await cekSurat(c, v.suratId, id)
      if (v.personelId !== k.personel_id) await cekPersonel(c, v.personelId, k.personel_id)
      const fields = KOLOM_UBAH.filter(([f, kol]) => (v[f] ?? null) !== (k[kol] ?? null)).map(([f]) => f)
      await c.query(
        `UPDATE sdl_sumda_arsip SET nomor=$2,jenis=$3,perihal=$4,tanggal=$5,asal_tujuan=$6,kode_klasifikasi=$7,lokasi_simpan=$8,
                retensi_sampai=$9,kerahasiaan=$10,catatan=$11,personel_id=$12::uuid,surat_id=$13::uuid,
                updated_by=$14,updated_at=now(),version=version+1 WHERE id=$1::uuid`,
        [id, v.nomor, v.jenis, v.perihal, v.tanggal, v.asalTujuan, v.kodeKlasifikasi, v.lokasiSimpan, v.retensiSampai, v.kerahasiaan,
          v.catatan, v.personelId, v.suratId, req.actor])
      await audit(c, req.actor, 'subbagsumda.arsip.update', id, { jenis: v.jenis, kerahasiaan: v.kerahasiaan, fields, version: version + 1 })
      // K34: menaikkan ke Terbatas arsip milik orang lain tanpa Xa membuatnya tak terlihat lagi bagi pengubah.
      const r = await c.query(`SELECT ${bolehArsip('$2', '$3')} AS ok FROM sdl_sumda_arsip a WHERE a.id=$1::uuid`, [id, req.actor, xa])
      if (!r.rows[0].ok) return { item: null, tersembunyi: true }
      return { item: await ambil(c, id, req.actor, xa) }
    })
    respond(res, 200, hasil)
  }))

  router.post('/:id/aksi', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const b = body(req, ['aksi', 'catatan', 'version'])
    const aksi = pilihan(b.aksi, ['inaktifkan', 'aktifkan', 'musnahkan'])
    if (aksi === 'musnahkan') await need(req, P.restricted) // K32: Ma + Xa
    const version = versi(b.version)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    if (aksi === 'musnahkan' && [...catatan].length < 8) throw new HttpError(400, 'invalid_input')
    const xa = await can(req.actor, P.restricted)
    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id, req.actor, xa)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      const dari = k.status
      const { syarat, ke } = { inaktifkan: { syarat: 'Aktif', ke: 'Inaktif' }, aktifkan: { syarat: 'Inaktif', ke: 'Aktif' }, musnahkan: { syarat: 'Inaktif', ke: 'Musnah' } }[aksi]
      if (dari !== syarat) throw new HttpError(409, 'status_tidak_sesuai')
      if (aksi === 'musnahkan') {
        const ada = (await c.query(
          "SELECT EXISTS(SELECT 1 FROM sdl_sumda_arsip_lampiran WHERE arsip_id=$1::uuid AND peran='BA_MUSNAH') AS ok", [id])).rows[0].ok
        if (!ada) throw new HttpError(409, 'lampiran_wajib')
        await c.query(
          `UPDATE sdl_sumda_arsip SET status='Musnah',musnah_by=$2::uuid,musnah_at=now(),updated_by=$2::uuid,updated_at=now(),version=version+1
            WHERE id=$1::uuid`, [id, req.actor])
      } else {
        await c.query('UPDATE sdl_sumda_arsip SET status=$2,updated_by=$3,updated_at=now(),version=version+1 WHERE id=$1::uuid', [id, ke, req.actor])
      }
      await riwayat(c, id, dari, ke, catatan, req.actor)
      await audit(c, req.actor, `subbagsumda.arsip.${aksi}`, id, { status: ke })
      return ambil(c, id, req.actor, xa)
    })
    respond(res, 200, { item })
  }))

  /* ------------------------------------------------------------ Lampiran (K12/K33) */

  async function cekUnggah(c, id, actor, xa, lock) {
    const r = await c.query(
      `SELECT a.status FROM sdl_sumda_arsip a WHERE a.id=$1::uuid AND ${bolehArsip('$2', '$3')}${lock ? ' FOR UPDATE' : ''}`, [id, actor, xa])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    if (r.rows[0].status === 'Musnah') throw new HttpError(409, 'status_tidak_sesuai')
  }

  router.post('/:id/lampiran', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const peran = req.query.peran === undefined || req.query.peran === '' ? 'DOKUMEN' : String(req.query.peran)
    if (!PERAN_LAMPIRAN.includes(peran)) throw new HttpError(400, 'invalid_input')
    const xa = await can(req.actor, P.restricted)
    await cekUnggah(pool, id, req.actor, xa, false)
    const { blob, filename, sealed, digest } = await bacaPdf(req, evidenceKey)
    const row = await withTransaction(pool, async (c) => {
      await cekUnggah(c, id, req.actor, xa, true)
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_arsip_lampiran WHERE arsip_id=$1::uuid', [id])).rows[0].n
      if (n >= MAKS_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_sumda_arsip_lampiran(arsip_id,peran,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7) RETURNING id::text`, [id, peran, filename, blob.length, digest, sealed, req.actor])).rows[0]
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.arsip.lampiran.add', id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const xa = await can(req.actor, P.restricted)
    await withTransaction(pool, async (c) => {
      await cekUnggah(c, id, req.actor, xa, true)
      const r = await c.query(
        'DELETE FROM sdl_sumda_arsip_lampiran WHERE id=$1::uuid AND arsip_id=$2::uuid AND (uploaded_by=$3::uuid OR $4::boolean)',
        [lid, id, req.actor, xa])
      if (r.rowCount !== 1) {
        const ada = await c.query('SELECT 1 FROM sdl_sumda_arsip_lampiran WHERE id=$1::uuid AND arsip_id=$2::uuid', [lid, id])
        throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
      }
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.arsip.lampiran.delete', id)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const xa = await can(req.actor, P.restricted)
    const r = await pool.query(
      `SELECT l.filename,l.sha256,l.body FROM sdl_sumda_arsip_lampiran l JOIN sdl_sumda_arsip a ON a.id=l.arsip_id
        WHERE l.id=$1::uuid AND l.arsip_id=$2::uuid AND ${bolehArsip('$3', '$4')}`, [lid, id, req.actor, xa])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    const plain = bukaPdf(r.rows[0], evidenceKey)
    pasangHeaderUnduh(res, r.rows[0].filename)
    await withTransaction(pool, (c) => audit(c, req.actor, 'subbagsumda.arsip.lampiran.download', id))
    res.status(200).end(plain)
  }))

  return router
}
