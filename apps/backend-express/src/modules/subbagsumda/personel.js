import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { CUTI_HARI_INI_SQL, cutiTahunIni } from './cuti.js'
import { riwayatDiklatPersonel } from './diklat.js'
import { LAYANAN_MENUNGGU_SQL, kesejahteraanPersonel } from './kesejahteraan.js'
import { KOMPETENSI_60_SQL, kompetensiPersonel } from './kompetensi.js'
import { GOLONGAN_PNS, HARI_INI, HttpError, UUID_RE, hariDari, body, cekPangkat, idParam, makeHandle, permit, pilihan, tanggal, teks } from './umum.js'

/**
 * R5H27: Subbagsumda — Master Personel, Monitoring Pensiun, Dashboard.
 * Migrasi 068. EXPRESS SAJA; Go tidak mengenal tabel ini.
 * Dokumen: docs/R5H27-SUMDA-PERSONEL-PENSIUN.md (K1–K21).
 *
 *   GET    /api/v1/subbagsumda/personel/capabilities
 *   GET    /api/v1/subbagsumda/personel?q=&status=&unitKerja=&page=&size=
 *   POST   /api/v1/subbagsumda/personel                {nrp,nama,jenis,pangkat,jabatan,unitKerja,tmtDinas,tanggalPensiun,status,catatan}
 *   GET    /api/v1/subbagsumda/personel/:id
 *   PATCH  /api/v1/subbagsumda/personel/:id            badan penuh + version (K18)
 *   DELETE /api/v1/subbagsumda/personel/:id?version=   arsip (soft delete)
 *   GET    /api/v1/subbagsumda/pensiun/alert?tahap=
 *   POST   /api/v1/subbagsumda/pensiun/alert/tinjau    {items:[{personelId,tahap,tanggalPensiun}]}
 *   GET    /api/v1/subbagsumda/dashboard
 *
 * OTORISASI: bukan Engine A dan bukan Engine B. Pola R5H11 (subbagren/progar.js:71):
 * grant aktif di unit 'subbagsumda' + permission role, diputuskan seluruhnya di SQL.
 * Scope dan classification_limit sengaja TIDAK dipakai (K2: semua pemegang grant
 * Sumda melihat seluruh master; master personel bukan berkas yang didisposisikan).
 *
 *   read    subbagsumda.personel.read      op, staf, kasubbag, kabagrenmin
 *   create  subbagsumda.personel.create    op, staf, kasubbag
 *   update  subbagsumda.personel.update    op, staf, kasubbag
 *   archive subbagsumda.personel.archive   kasubbag
 *   review  subbagsumda.pensiun.review     op, staf, kasubbag
 *
 * TANGGAL: pool Express memaksa sesi UTC (db.js:45), jadi CURRENT_DATE adalah
 * tanggal UTC dan meleset sehari pukul 00:00–06:59 WIB. "Hari ini" SELALU
 * HARI_INI di bawah. Kolom DATE dibaca sebagai ::text supaya `pg` tidak
 * mengubahnya menjadi Date lokal.
 */

// NRP/NIP: ASCII sempit. NRP lama (hasil salinan registry) yang sudah tersimpan boleh dipertahankan.
const NRP_RE = /^[A-Za-z0-9 ._/()[\]-]+$/

export const STATUS = Object.freeze(['Aktif', 'MPP', 'Pensiun', 'Nonaktif'])
export const STATUS_DIPANTAU = Object.freeze(['Aktif', 'MPP']) // K7
export const JENIS = Object.freeze(['Polri', 'PNS'])
export const TAHAP = Object.freeze(['H-60', 'H-30', 'H-14', 'H-7', 'JATUH_TEMPO'])
export { GOLONGAN_PNS }
const UKURAN_HALAMAN = new Set([5, 10, 50, 100])
const MAKS_TINJAU = 200

// HARI_INI/hariDari kini tinggal di umum.js (R5H29); di-re-export supaya verify R5H27 tetap utuh.
export { HARI_INI, hariDari }

/**
 * SATU-SATUNYA rumus tahap (K6/K7): dipakai daftar, alert, dashboard, dan tinjau.
 * H-60 (31–60 hari) · H-30 (15–30) · H-14 (8–14) · H-7 (1–7) · JATUH_TEMPO (≤ 0).
 * Hanya status Aktif/MPP bertanggal pensiun; selainnya NULL.
 */
export function tahapSql(alias = 'p', hari = HARI_INI) {
  const sisa = `(${alias}.tanggal_pensiun - ${hari})`
  return `CASE WHEN ${alias}.status IN ('Aktif','MPP') AND ${alias}.tanggal_pensiun IS NOT NULL THEN
    CASE WHEN ${sisa} <= 0 THEN 'JATUH_TEMPO' WHEN ${sisa} <= 7 THEN 'H-7' WHEN ${sisa} <= 14 THEN 'H-14'
         WHEN ${sisa} <= 30 THEN 'H-30' WHEN ${sisa} <= 60 THEN 'H-60' END END`
}
export const sisaSql = (alias = 'p', hari = HARI_INI) => `(${alias}.tanggal_pensiun - ${hari})`

const P = {
  read: 'subbagsumda.personel.read',
  create: 'subbagsumda.personel.create',
  update: 'subbagsumda.personel.update',
  archive: 'subbagsumda.personel.archive',
  review: 'subbagsumda.pensiun.review',
}

const handle = makeHandle({ sdl_sumda_personel_nrp_aktif_idx: 'duplicate_nrp' })

const FIELD_INPUT = ['nrp', 'nama', 'jenis', 'pangkat', 'jabatan', 'unitKerja', 'tmtDinas', 'tanggalPensiun', 'status', 'catatan']

/**
 * Validasi badan penuh (POST dan PATCH, K18). `lama` = baris yang sudah tersimpan (PATCH):
 * NRP lama di luar NRP_RE boleh dipertahankan, begitu pula pangkat lama yang sudah tidak aktif
 * atau tidak dikenal — tetapi pangkat hanya selama `jenis` tidak diganti.
 */
async function validasi(c, b, lama = null) {
  const v = {
    nrp: teks(b.nrp, 2, 64),
    nama: teks(b.nama, 3, 200),
    jenis: pilihan(b.jenis, JENIS),
    pangkat: teks(b.pangkat, 0, 200),
    jabatan: teks(b.jabatan, 0, 200),
    unitKerja: teks(b.unitKerja, 0, 200),
    tmtDinas: tanggal(b.tmtDinas, 1950, 2100),
    tanggalPensiun: tanggal(b.tanggalPensiun, 2000, 2100),
    status: pilihan(b.status, STATUS),
    catatan: teks(b.catatan, 0, 1000, { multiline: true }),
  }
  // K1: tanggal pensiun diisi manual, wajib bagi personel yang masih dipantau.
  if (STATUS_DIPANTAU.includes(v.status) && !v.tanggalPensiun) throw new HttpError(400, 'invalid_input')
  if (!NRP_RE.test(v.nrp) && v.nrp !== lama?.nrp) throw new HttpError(400, 'invalid_input')
  const pangkatTetap = lama !== null && v.pangkat === lama.pangkat && v.jenis === lama.jenis
  if (v.pangkat !== '' && !pangkatTetap) await cekPangkat(c, v.jenis, v.pangkat)
  return v
}

const KOLOM = `p.id::text,p.nrp,p.nama,p.jenis,p.pangkat,coalesce(rm.short_name,p.pangkat) AS pangkat_label,
  p.jabatan,p.unit_kerja,p.tmt_dinas::text AS tmt_dinas,p.tanggal_pensiun::text AS tanggal_pensiun,
  p.status,p.catatan,p.version,p.source_registry_id IS NOT NULL AS salinan,p.created_at,p.updated_at,
  ${sisaSql()} AS sisa_hari,${tahapSql()} AS tahap`
const DARI = `FROM sdl_sumda_personel p
  LEFT JOIN sdl_polri_rank_master rm ON p.jenis IS DISTINCT FROM 'PNS' AND rm.code=p.pangkat`
const BELUM_LENGKAP = `(p.status IN ('Aktif','MPP') AND (p.tanggal_pensiun IS NULL OR p.jenis IS NULL))`

function mapPersonel(r) {
  return {
    id: r.id, nrp: r.nrp, nama: r.nama, jenis: r.jenis ?? '', pangkat: r.pangkat, pangkatLabel: r.pangkat_label,
    jabatan: r.jabatan, unitKerja: r.unit_kerja, tmtDinas: r.tmt_dinas ?? '', tanggalPensiun: r.tanggal_pensiun ?? '',
    status: r.status, catatan: r.catatan, version: r.version, salinan: r.salinan,
    perluDilengkapi: STATUS_DIPANTAU.includes(r.status) && (!r.tanggal_pensiun || !r.jenis),
    sisaHari: r.sisa_hari ?? null, tahap: r.tahap ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

async function audit(c, actor, event, subject, metadata = {}) {
  await c.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, event, 'subbagsumda.personel', subject, metadata],
  )
}

async function ambil(c, id) {
  const r = await c.query(`SELECT ${KOLOM} ${DARI} WHERE p.id=$1::uuid AND p.deleted_at IS NULL`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return mapPersonel(r.rows[0])
}

export function createSumdaPersonelRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.SUMDA)
  const { can, need } = permit(pool)

  // Didaftarkan SEBELUM /:id — Express mencocokkan berurutan.
  router.get('/capabilities', handle(async (req, res) => {
    const [read, create, update, archive, review] = await Promise.all(
      [P.read, P.create, P.update, P.archive, P.review].map((k) => can(req.actor, k)))
    respond(res, 200, { canRead: read, canCreate: create, canUpdate: update, canArchive: archive, canReview: review })
  }))

  router.get('/', handle(async (req, res) => {
    await need(req, P.read)
    const q = teks(req.query.q ?? '', 0, 100)
    const status = String(req.query.status ?? '')
    if (status !== '' && !STATUS.includes(status)) throw new HttpError(400, 'invalid_input')
    const unitKerja = teks(req.query.unitKerja ?? '', 0, 200)
    const lengkap = String(req.query.lengkap ?? '')
    if (lengkap !== '' && lengkap !== 'belum') throw new HttpError(400, 'invalid_input')
    const page = req.query.page === undefined ? 1 : parseGoInt(String(req.query.page))
    const size = req.query.size === undefined ? 10 : parseGoInt(String(req.query.size))
    if (page === undefined || page < 1 || page > 100000 || !UKURAN_HALAMAN.has(size)) throw new HttpError(400, 'invalid_input')

    const where = ['p.deleted_at IS NULL']
    const args = []
    if (q !== '') {
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      const n = `$${args.length}`
      where.push(`(p.nama ILIKE ${n} OR p.nrp ILIKE ${n} OR p.pangkat ILIKE ${n} OR coalesce(rm.short_name,'') ILIKE ${n}
        OR p.jabatan ILIKE ${n} OR p.unit_kerja ILIKE ${n})`)
    }
    if (status !== '') { args.push(status); where.push(`p.status=$${args.length}`) }
    if (unitKerja !== '') { args.push(unitKerja); where.push(`p.unit_kerja=$${args.length}`) }
    if (lengkap === 'belum') where.push(BELUM_LENGKAP)
    const w = where.join(' AND ')

    const total = Number((await pool.query(`SELECT count(*) ${DARI} WHERE ${w}`, args)).rows[0].count)
    const rows = (await pool.query(
      `SELECT ${KOLOM} ${DARI} WHERE ${w} ORDER BY lower(p.nama), p.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args)).rows
    const units = (await pool.query(
      `SELECT DISTINCT unit_kerja FROM sdl_sumda_personel WHERE deleted_at IS NULL AND unit_kerja<>'' ORDER BY 1`)).rows
    respond(res, 200, { items: rows.map(mapPersonel), total, page, size, unitKerja: units.map((u) => u.unit_kerja) })
  }))

  router.post('/', json, handle(async (req, res) => {
    await need(req, P.create)
    const b = body(req, FIELD_INPUT)
    const item = await withTransaction(pool, async (c) => {
      const v = await validasi(c, b)
      const r = await c.query(
        `INSERT INTO sdl_sumda_personel(nrp,nama,jenis,pangkat,jabatan,unit_kerja,tmt_dinas,tanggal_pensiun,status,catatan,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id::text`,
        [v.nrp, v.nama, v.jenis, v.pangkat, v.jabatan, v.unitKerja, v.tmtDinas, v.tanggalPensiun, v.status, v.catatan, req.actor])
      const id = r.rows[0].id
      await audit(c, req.actor, 'subbagsumda.personel.create', id, { status: v.status })
      return ambil(c, id)
    })
    respond(res, 201, { item })
  }))

  router.get('/:id', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id)
    const item = await ambil(pool, id)
    // R5H28 K13/K28 (aditif, hanya di GET ini): riwayat karier & mutasi personel, terbaru di atas.
    const rk = (await pool.query(
      `SELECT k.id::text,k.jenis,k.status,k.tanggal_usulan::text AS tanggal_usulan,k.tanggal_efektif::text AS tanggal_efektif,
              k.usulan_pangkat,coalesce(ur.short_name,k.usulan_pangkat) AS usulan_pangkat_label,k.usulan_jabatan,k.usulan_unit_kerja
         FROM sdl_sumda_karier k
         JOIN sdl_sumda_personel p ON p.id=k.personel_id
         LEFT JOIN sdl_polri_rank_master ur ON p.jenis IS DISTINCT FROM 'PNS' AND ur.code=k.usulan_pangkat
        WHERE k.personel_id=$1::uuid ORDER BY k.created_at DESC, k.id LIMIT 50`, [id])).rows
    item.riwayatKarier = rk.map((r) => ({
      id: r.id, jenis: r.jenis, status: r.status, tanggalUsulan: r.tanggal_usulan, tanggalEfektif: r.tanggal_efektif ?? '',
      ringkas: r.jenis === 'UKP' ? `Pangkat → ${r.usulan_pangkat_label}` : r.jenis === 'MUTASI' ? [r.usulan_jabatan, r.usulan_unit_kerja].filter(Boolean).join(' · ')
        : r.jenis === 'PENYESUAIAN_JABATAN' ? `Jabatan → ${r.usulan_jabatan}` : 'Kenaikan gaji berkala',
    }))
    // R5H29 K18 (aditif, hanya di GET ini): riwayat diklat dan kompetensi personel.
    item.riwayatDiklat = await riwayatDiklatPersonel(pool, id)
    item.kompetensi = await kompetensiPersonel(pool, id)
    item.cutiTahunIni = await cutiTahunIni(pool, id) // R5H30 K20/K41 (aditif)
    item.riwayatKesejahteraan = await kesejahteraanPersonel(pool, id)
    respond(res, 200, { item })
  }))

  router.patch('/:id', json, handle(async (req, res) => {
    await need(req, P.update)
    const id = idParam(req.params.id)
    const b = body(req, [...FIELD_INPUT, 'version'])
    if (!Number.isSafeInteger(b.version) || b.version < 1) throw new HttpError(400, 'invalid_input')
    const item = await withTransaction(pool, async (c) => {
      const cur = (await c.query(
        `SELECT nrp,nama,jenis,pangkat,jabatan,unit_kerja,tmt_dinas::text,tanggal_pensiun::text,status,catatan,version
           FROM sdl_sumda_personel WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0]
      if (!cur) throw new HttpError(404, 'not_found')
      if (cur.version !== b.version) throw new HttpError(409, 'version_conflict')
      const v = await validasi(c, b, cur)
      const lama = {
        nrp: cur.nrp, nama: cur.nama, jenis: cur.jenis, pangkat: cur.pangkat, jabatan: cur.jabatan, unitKerja: cur.unit_kerja,
        tmtDinas: cur.tmt_dinas, tanggalPensiun: cur.tanggal_pensiun, status: cur.status, catatan: cur.catatan,
      }
      // Audit hanya NAMA field yang berubah, tanpa nilainya (R4: data pribadi tidak masuk audit).
      const berubah = FIELD_INPUT.filter((k) => (lama[k] ?? null) !== (v[k] ?? null))
      await c.query(
        `UPDATE sdl_sumda_personel SET nrp=$2,nama=$3,jenis=$4,pangkat=$5,jabatan=$6,unit_kerja=$7,tmt_dinas=$8,
                tanggal_pensiun=$9,status=$10,catatan=$11,updated_by=$12,updated_at=now(),version=version+1
          WHERE id=$1::uuid`,
        [id, v.nrp, v.nama, v.jenis, v.pangkat, v.jabatan, v.unitKerja, v.tmtDinas, v.tanggalPensiun, v.status, v.catatan, req.actor])
      await audit(c, req.actor, 'subbagsumda.personel.update', id, { fields: berubah, version: cur.version + 1 })
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
      const cur = (await c.query(
        'SELECT version FROM sdl_sumda_personel WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE', [id])).rows[0]
      if (!cur) throw new HttpError(404, 'not_found')
      if (cur.version !== version) throw new HttpError(409, 'version_conflict')
      await c.query(
        'UPDATE sdl_sumda_personel SET deleted_at=now(),updated_by=$2,updated_at=now(),version=version+1 WHERE id=$1::uuid',
        [id, req.actor])
      await audit(c, req.actor, 'subbagsumda.personel.archive', id, { version: version + 1 })
    })
    res.set('Cache-Control', 'no-store')
    res.status(204).end()
  }))

  return router
}

const ALERT_SQL = `
  SELECT ${KOLOM}, t.reviewed_at, ru.display_name AS reviewed_name
    ${DARI}
    LEFT JOIN sdl_sumda_pensiun_tinjau t ON t.personel_id=p.id AND t.tahap=${tahapSql()} AND t.tanggal_pensiun=p.tanggal_pensiun
    LEFT JOIN sdl_users ru ON ru.id=t.reviewed_by
   WHERE p.deleted_at IS NULL AND ${tahapSql()} IS NOT NULL`

function mapAlert(r) {
  return {
    personel: mapPersonel(r), sisaHari: r.sisa_hari, tahap: r.tahap,
    ditinjau: r.reviewed_at ? { oleh: r.reviewed_name ?? '', pada: r.reviewed_at } : null,
  }
}

export function createSumdaPensiunRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.SUMDA)
  const { need } = permit(pool)

  router.get('/alert', handle(async (req, res) => {
    await need(req, P.read)
    const tahap = String(req.query.tahap ?? '')
    if (tahap !== '' && !TAHAP.includes(tahap)) throw new HttpError(400, 'invalid_input')
    const rows = (await pool.query(`${ALERT_SQL} ORDER BY sisa_hari, lower(p.nama), p.id`)).rows.map(mapAlert)
    const ringkas = Object.fromEntries(TAHAP.map((k) => [k, rows.filter((a) => a.tahap === k).length]))
    respond(res, 200, {
      ringkas,
      belumDitinjau: rows.filter((a) => !a.ditinjau).length,
      items: tahap === '' ? rows : rows.filter((a) => a.tahap === tahap),
    })
  }))

  router.post('/alert/tinjau', json, handle(async (req, res) => {
    await need(req, P.review)
    const { items } = body(req, ['items'])
    if (!Array.isArray(items) || items.length < 1 || items.length > MAKS_TINJAU) throw new HttpError(400, 'invalid_input')
    const kunci = ['personelId', 'tahap', 'tanggalPensiun']
    for (const it of items) {
      if (it === null || typeof it !== 'object' || Array.isArray(it)) throw new HttpError(400, 'invalid_input')
      const keys = Object.keys(it)
      if (keys.length !== kunci.length || !kunci.every((k) => Object.hasOwn(it, k))) throw new HttpError(400, 'invalid_input')
      if (typeof it.personelId !== 'string' || !UUID_RE.test(it.personelId)) throw new HttpError(400, 'invalid_input')
      pilihan(it.tahap, TAHAP)
      if (tanggal(it.tanggalPensiun, 2000, 2100) === null) throw new HttpError(400, 'invalid_input')
    }
    const ids = [...new Set(items.map((it) => it.personelId.toLowerCase()))]
    const n = await withTransaction(pool, async (c) => {
      // Kunci baris lalu hitung ulang tahap SEKARANG; satu saja yang berubah -> batal semua.
      const now = new Map((await c.query(
        `SELECT p.id::text, p.tanggal_pensiun::text AS tanggal_pensiun, ${tahapSql()} AS tahap
           FROM sdl_sumda_personel p WHERE p.id = ANY($1::uuid[]) AND p.deleted_at IS NULL FOR SHARE`, [ids])).rows
        .map((r) => [r.id, r]))
      for (const it of items) {
        const cur = now.get(it.personelId.toLowerCase())
        if (!cur || cur.tahap !== it.tahap || cur.tanggal_pensiun !== it.tanggalPensiun) throw new HttpError(409, 'alert_berubah')
      }
      const baru = (await c.query(
        `INSERT INTO sdl_sumda_pensiun_tinjau(personel_id,tahap,tanggal_pensiun,reviewed_by)
         SELECT x.id::uuid, x.tahap, x.tgl::date, $4 FROM unnest($1::text[],$2::text[],$3::text[]) AS x(id,tahap,tgl)
         ON CONFLICT DO NOTHING RETURNING personel_id::text, tahap`,
        [items.map((i) => i.personelId.toLowerCase()), items.map((i) => i.tahap), items.map((i) => i.tanggalPensiun), req.actor])).rows
      for (const r of baru) await audit(c, req.actor, 'subbagsumda.pensiun.review', r.personel_id, { tahap: r.tahap })
      return baru.length
    })
    respond(res, 200, { ditinjau: n })
  }))

  return router
}

/** Hanya kunci metadata tanpa data pribadi yang diteruskan ke klien (termasuk Kabagrenmin). */
const RINCIAN_KUNCI = ['fields', 'status', 'tahap', 'version', 'sumber', 'disalin']
function rincianAman(m) {
  const out = {}
  for (const k of RINCIAN_KUNCI) if (m && Object.hasOwn(m, k)) out[k] = m[k]
  return out
}

const AKTIVITAS_EVENT = [
  'subbagsumda.personel.create', 'subbagsumda.personel.update', 'subbagsumda.personel.archive',
  'subbagsumda.pensiun.review', 'subbagsumda.personel.salin_registry',
]

export function createSumdaDashboardRouter({ pool }) {
  const router = Router()
  const { need } = permit(pool)

  router.get('/', handle(async (req, res) => {
    await need(req, P.read)
    const tot = (await pool.query(`
      WITH a AS (${ALERT_SQL})
      SELECT (SELECT count(*) FROM sdl_sumda_personel WHERE deleted_at IS NULL) AS personel,
             (SELECT count(*) FROM sdl_sumda_personel WHERE deleted_at IS NULL AND status='Aktif') AS aktif,
             (SELECT count(*) FROM sdl_sumda_personel WHERE deleted_at IS NULL AND status='MPP') AS mpp,
             (SELECT count(*) FROM sdl_sumda_personel p WHERE p.deleted_at IS NULL AND ${BELUM_LENGKAP}) AS belum_lengkap,
             (SELECT count(*) FROM a) AS alert,
             (SELECT count(*) FROM a WHERE reviewed_at IS NULL) AS belum_ditinjau,
             (SELECT count(*) FROM sdl_sumda_karier k JOIN sdl_sumda_personel kp ON kp.id=k.personel_id
               WHERE k.status='Diproses' AND kp.deleted_at IS NULL) AS karier_menunggu`)).rows[0]
    // K19: kartu "Pensiun 6 bulan" = jumlah grafik proyeksi (bulan berjalan s.d. +5).
    const proyeksi = (await pool.query(`
      SELECT to_char(b.m,'YYYY-MM') AS bulan, count(p.id)::int AS jumlah
        FROM generate_series(date_trunc('month', ${HARI_INI}), date_trunc('month', ${HARI_INI}) + interval '5 months', interval '1 month') AS b(m)
        LEFT JOIN sdl_sumda_personel p ON p.deleted_at IS NULL AND p.status IN ('Aktif','MPP')
             AND p.tanggal_pensiun >= b.m::date AND p.tanggal_pensiun < (b.m + interval '1 month')::date
       GROUP BY b.m ORDER BY b.m`)).rows
    const alertTerdekat = (await pool.query(`${ALERT_SQL} ORDER BY sisa_hari, lower(p.nama), p.id LIMIT 5`)).rows.map(mapAlert)
    const terdekat = (await pool.query(
      `SELECT ${KOLOM} ${DARI} WHERE p.deleted_at IS NULL AND p.status IN ('Aktif','MPP') AND ${sisaSql()} >= 0
        ORDER BY p.tanggal_pensiun, lower(p.nama), p.id LIMIT 5`)).rows.map(mapPersonel)
    const aktivitas = (await pool.query(`
      SELECT e.event_key, e.subject_id, e.metadata, e.created_at, u.display_name, p.nama
        FROM sdl_audit_events e
        LEFT JOIN sdl_users u ON u.id=e.actor_id
        LEFT JOIN sdl_sumda_personel p ON p.id::text=e.subject_id AND p.deleted_at IS NULL
       WHERE e.subject_type='subbagsumda.personel' AND e.event_key = ANY($1::text[])
       ORDER BY e.created_at DESC, e.id DESC LIMIT 5`, [AKTIVITAS_EVENT])).rows
    respond(res, 200, {
      totals: {
        personel: Number(tot.personel), aktif: Number(tot.aktif), mpp: Number(tot.mpp),
        alert: Number(tot.alert), belumDitinjau: Number(tot.belum_ditinjau), belumLengkap: Number(tot.belum_lengkap),
        enamBulan: proyeksi.reduce((s, b) => s + b.jumlah, 0),
        karierMenunggu: Number(tot.karier_menunggu), // R5H28 K14 (aditif)
        kompetensiKedaluwarsa60: (await pool.query(KOMPETENSI_60_SQL)).rows[0].n, // R5H29 K18/K31 (aditif)
        cutiHariIni: (await pool.query(CUTI_HARI_INI_SQL)).rows[0].n, // R5H30 K21/K40 (aditif)
        layananMenunggu: Number((await pool.query(LAYANAN_MENUNGGU_SQL)).rows[0].n),
      },
      proyeksi,
      alertTerdekat,
      terdekat,
      aktivitas: aktivitas.map((a) => ({
        jenis: a.event_key.replace(/^subbagsumda\./, ''),
        personelId: a.event_key.endsWith('salin_registry') ? null : a.subject_id,
        personelNama: a.nama ?? null,
        oleh: a.display_name ?? 'Sistem (migrasi)',
        pada: a.created_at,
        rincian: rincianAman(a.metadata),
      })),
    })
  }))

  return router
}
