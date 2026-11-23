import { createHash } from 'node:crypto'
import { Router } from 'express'

import { openEvidence, sealEvidence } from '../../crypto/evidence.js'
import { withTransaction } from '../../db.js'
import { contentDisposition, detectFileType, readSingleFile } from '../../http/multipart.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { HttpError, UUID_RE, body, cekPangkat, idParam, makeHandle, permit, pilihan, tanggal, teks } from './umum.js'

/**
 * R5H28: Subbagsumda — Karier & Mutasi. Migrasi 069. EXPRESS SAJA.
 * Dokumen: docs/R5H28-SUMDA-KARIER-MUTASI.md (K1–K28).
 *
 *   GET    /api/v1/subbagsumda/karier/capabilities
 *   GET    /api/v1/subbagsumda/karier?q=&status=&jenis=&personelId=&page=&size=
 *   POST   /api/v1/subbagsumda/karier                 {personelId,jenis,nomorReferensi,tanggalUsulan,tanggalEfektif,usulan,catatan}
 *   GET    /api/v1/subbagsumda/karier/:id
 *   PATCH  /api/v1/subbagsumda/karier/:id             {nomorReferensi,tanggalUsulan,tanggalEfektif,usulan,catatan,version} (Diajukan saja, K18)
 *   POST   /api/v1/subbagsumda/karier/:id/aksi        {aksi,catatan,version[,tanggalEfektif,terapkan]}
 *   POST   /api/v1/subbagsumda/karier/:id/lampiran    multipart `file` (PDF <= 5 MB, K4/K17)
 *   GET    /api/v1/subbagsumda/karier/:id/lampiran/:lid
 *   DELETE /api/v1/subbagsumda/karier/:id/lampiran/:lid
 *
 * Hak (permission pada grant unit subbagsumda, lihat umum.js):
 *   R subbagsumda.personel.read · M subbagsumda.karier.manage · A subbagsumda.karier.approve
 *   Selesai = M + subbagsumda.personel.update (mengubah Master Personel, K2).
 *
 * Alur: Diajukan -proses-> Diproses -setujui/tolak(A, bukan pencatat/pengubah terakhir)->
 *       Disetujui -selesai-> Selesai; batalkan dari Diajukan/Diproses (pencatat atau A).
 *
 * KUNCI: selalu karier dulu (FOR UPDATE), baru personel (FOR NO KEY UPDATE). Membuat
 * pengajuan TIDAK mengunci personel — menghindari deadlock dengan indeks unik K11 + FK.
 */

export const JENIS_KARIER = Object.freeze(['UKP', 'KGB', 'MUTASI', 'PENYESUAIAN_JABATAN'])
export const STATUS_KARIER = Object.freeze(['Diajukan', 'Diproses', 'Disetujui', 'Ditolak', 'Selesai', 'Dibatalkan'])
const TERBUKA = ['Diajukan', 'Diproses', 'Disetujui']
const UKURAN_HALAMAN = new Set([5, 10, 50, 100])
const MAKS_PDF = 5 << 20
const MAKS_LAMPIRAN = 10
const SAFE_PDF_NAME = /^[\p{L}\p{N} ._()\-,]{1,150}\.pdf$/iu

const P = {
  read: 'subbagsumda.personel.read',
  manage: 'subbagsumda.karier.manage',
  approve: 'subbagsumda.karier.approve',
  personelUpdate: 'subbagsumda.personel.update',
}

const handle = makeHandle({ sdl_sumda_karier_terbuka_uq: 'pengajuan_ganda' })

/** Field usulan yang dipakai tiap jenis (K2/K7). KGB tidak mengubah Master Personel. */
const FIELD_JENIS = Object.freeze({
  UKP: ['pangkat'],
  KGB: [],
  MUTASI: ['jabatan', 'unitKerja'],
  PENYESUAIAN_JABATAN: ['jabatan'],
})
const KOLOM_MASTER = { pangkat: 'pangkat', jabatan: 'jabatan', unitKerja: 'unit_kerja' }

/** Objek usulan/terapkan: kunci strict sesuai jenis, nilai teks <= 200, minimal satu terisi (selain KGB). */
async function nilaiUsulan(c, raw, jenis, jenisPersonel) {
  const boleh = FIELD_JENIS[jenis]
  if (raw === undefined || raw === null) raw = {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'invalid_input')
  for (const k of Object.keys(raw)) if (!boleh.includes(k)) throw new HttpError(400, 'invalid_input')
  const v = { pangkat: '', jabatan: '', unitKerja: '' }
  for (const k of boleh) v[k] = teks(raw[k], 0, 200)
  if (jenis === 'KGB') return v
  if (!boleh.some((k) => v[k] !== '')) throw new HttpError(400, 'invalid_input')
  if (jenis === 'PENYESUAIAN_JABATAN' && v.jabatan === '') throw new HttpError(400, 'invalid_input')
  if (jenis === 'UKP') {
    // K27: pangkat bergantung pada jenis personel; baris salinan tanpa jenis dilengkapi dulu.
    if (!jenisPersonel) throw new HttpError(409, 'personel_belum_lengkap')
    await cekPangkat(c, jenisPersonel, v.pangkat)
  }
  return v
}

/**
 * Content-Disposition aman untuk nama berkas Unicode (RFC 6266/5987): `filename` ASCII sebagai cadangan,
 * `filename*` UTF-8 untuk nama asli. Nama ASCII murni tetap memakai bentuk lama (contentDisposition).
 */
function disposisi(nama) {
  if (/^[\x20-\x7e]*$/.test(nama)) return contentDisposition('attachment', nama)
  const ascii = nama.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const utf8 = encodeURIComponent(nama).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

function versi(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}

/** Audit tanpa data pribadi: hanya kunci daftar putih (pelajaran R5H27 S4). */
async function audit(c, actor, event, type, subject, meta = {}) {
  const out = {}
  for (const k of ['jenis', 'status', 'fields', 'version', 'dikoreksi']) if (Object.hasOwn(meta, k)) out[k] = meta[k]
  await c.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, event, type, subject, out])
}

async function riwayat(c, karierId, dari, ke, catatan, oleh) {
  await c.query('INSERT INTO sdl_sumda_karier_riwayat(karier_id,dari,ke,catatan,oleh) VALUES($1,$2,$3,$4,$5)',
    [karierId, dari, ke, catatan, oleh])
}

const KOLOM = `k.id::text,k.personel_id::text,k.jenis,k.nomor_referensi,k.tanggal_usulan::text AS tanggal_usulan,
  k.tanggal_efektif::text AS tanggal_efektif,k.usulan_pangkat,coalesce(ur.short_name,k.usulan_pangkat) AS usulan_pangkat_label,
  k.usulan_jabatan,k.usulan_unit_kerja,k.status,k.catatan,k.diterapkan,k.version,k.created_at,k.updated_at,
  k.created_by::text,cu.display_name AS created_name,k.updated_by::text,du.display_name AS decided_name,k.decided_at,k.selesai_at,
  p.nrp,p.nama,p.jenis AS personel_jenis,p.pangkat AS personel_pangkat,coalesce(pr.short_name,p.pangkat) AS personel_pangkat_label,
  p.jabatan AS personel_jabatan,p.unit_kerja AS personel_unit_kerja,p.status AS personel_status,p.version AS personel_version,
  p.deleted_at IS NOT NULL AS personel_terarsip`
const DARI = `FROM sdl_sumda_karier k
  JOIN sdl_sumda_personel p ON p.id=k.personel_id
  LEFT JOIN sdl_polri_rank_master pr ON p.jenis IS DISTINCT FROM 'PNS' AND pr.code=p.pangkat
  LEFT JOIN sdl_polri_rank_master ur ON p.jenis IS DISTINCT FROM 'PNS' AND ur.code=k.usulan_pangkat
  LEFT JOIN sdl_users cu ON cu.id=k.created_by
  LEFT JOIN sdl_users du ON du.id=k.decided_by`

function ringkas(r) {
  if (r.jenis === 'UKP') return `Pangkat → ${r.usulan_pangkat_label || r.usulan_pangkat}`
  if (r.jenis === 'MUTASI') return [r.usulan_jabatan, r.usulan_unit_kerja].filter(Boolean).join(' · ')
  if (r.jenis === 'PENYESUAIAN_JABATAN') return `Jabatan → ${r.usulan_jabatan}`
  return 'Kenaikan gaji berkala'
}

function mapKarier(r) {
  return {
    id: r.id, jenis: r.jenis, nomorReferensi: r.nomor_referensi, tanggalUsulan: r.tanggal_usulan,
    tanggalEfektif: r.tanggal_efektif ?? '', status: r.status, catatan: r.catatan, version: r.version,
    usulan: { pangkat: r.usulan_pangkat, pangkatLabel: r.usulan_pangkat_label, jabatan: r.usulan_jabatan, unitKerja: r.usulan_unit_kerja },
    ringkas: ringkas(r), diterapkan: r.diterapkan ?? null,
    createdBy: r.created_by, createdByName: r.created_name ?? '', updatedBy: r.updated_by,
    decidedByName: r.decided_name ?? null, decidedAt: r.decided_at ?? null, selesaiAt: r.selesai_at ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
    personel: {
      id: r.personel_id, nrp: r.nrp, nama: r.nama, jenis: r.personel_jenis ?? '', pangkat: r.personel_pangkat,
      pangkatLabel: r.personel_pangkat_label, jabatan: r.personel_jabatan, unitKerja: r.personel_unit_kerja,
      status: r.personel_status, version: r.personel_version, terarsip: r.personel_terarsip,
    },
  }
}

async function ambil(c, id) {
  const r = await c.query(`SELECT ${KOLOM} ${DARI} WHERE k.id=$1::uuid`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return mapKarier(r.rows[0])
}

/** Kunci pengajuan (selalu lebih dulu dari personel). */
async function kunci(c, id) {
  const r = await c.query(
    `SELECT k.id::text,k.personel_id::text,k.jenis,k.status,k.version,k.created_by::text,k.updated_by::text,k.tanggal_efektif::text,
            k.usulan_pangkat,k.usulan_jabatan,k.usulan_unit_kerja
       FROM sdl_sumda_karier k WHERE k.id=$1::uuid FOR UPDATE`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return r.rows[0]
}

/**
 * K22 + perluasan K19 (review R5H28 W1): menambah/menghapus lampiran menaikkan versi DAN mencatat
 * pengubahnya, sehingga orang yang mengganti berkas dasar keputusan tidak bisa memutus pengajuan itu.
 */
async function naikVersi(c, id, actor) {
  await c.query('UPDATE sdl_sumda_karier SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, actor])
}

/** K26: pengajuan milik personel terarsip hanya bisa dibatalkan. */
async function tolakBilaTerarsip(c, personelId) {
  // FOR SHARE: arsip personel yang berjalan bersamaan menunggu transaksi ini (review S3).
  // Urutan tetap karier (sudah dikunci pemanggil) lalu personel, jadi tidak membentuk deadlock.
  const r = await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR SHARE', [personelId])
  if (r.rows[0]?.terarsip) throw new HttpError(409, 'personel_terarsip')
}

export function createSumdaKarierRouter({ pool, config }) {
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
    if (status !== '' && !STATUS_KARIER.includes(status)) throw new HttpError(400, 'invalid_input')
    if (jenis !== '' && !JENIS_KARIER.includes(jenis)) throw new HttpError(400, 'invalid_input')
    if (personelId !== '' && !UUID_RE.test(personelId)) throw new HttpError(400, 'invalid_input')
    const page = req.query.page === undefined ? 1 : parseGoInt(String(req.query.page))
    const size = req.query.size === undefined ? 10 : parseGoInt(String(req.query.size))
    if (page === undefined || page < 1 || page > 100000 || !UKURAN_HALAMAN.has(size)) throw new HttpError(400, 'invalid_input')

    const where = ['TRUE']
    const args = []
    if (q !== '') {
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      const n = `$${args.length}`
      where.push(`(p.nama ILIKE ${n} OR p.nrp ILIKE ${n} OR k.nomor_referensi ILIKE ${n})`)
    }
    if (status !== '') { args.push(status); where.push(`k.status=$${args.length}`) }
    if (jenis !== '') { args.push(jenis); where.push(`k.jenis=$${args.length}`) }
    if (personelId !== '') { args.push(personelId); where.push(`k.personel_id=$${args.length}::uuid`) }
    const w = where.join(' AND ')
    const total = Number((await pool.query(`SELECT count(*) ${DARI} WHERE ${w}`, args)).rows[0].count)
    const rows = (await pool.query(
      `SELECT ${KOLOM} ${DARI} WHERE ${w} ORDER BY k.created_at DESC, k.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args)).rows
    respond(res, 200, { items: rows.map(mapKarier), total, page, size })
  }))

  router.post('/', json, handle(async (req, res) => {
    await need(req, P.manage)
    const b = body(req, ['personelId', 'jenis', 'nomorReferensi', 'tanggalUsulan', 'tanggalEfektif', 'usulan', 'catatan'])
    if (typeof b.personelId !== 'string' || !UUID_RE.test(b.personelId)) throw new HttpError(400, 'invalid_input')
    const jenis = pilihan(b.jenis, JENIS_KARIER)
    const nomor = teks(b.nomorReferensi, 0, 100)
    const tglUsulan = tanggal(b.tanggalUsulan, 2000, 2100)
    if (!tglUsulan) throw new HttpError(400, 'invalid_input')
    const tglEfektif = tanggal(b.tanggalEfektif, 2000, 2100)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    const item = await withTransaction(pool, async (c) => {
      // Sengaja TANPA kunci baris personel (lihat komentar berkas); FK menjamin keberadaannya.
      const p = (await c.query('SELECT status,jenis,deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid', [b.personelId])).rows[0]
      if (!p) throw new HttpError(404, 'not_found')
      if (p.terarsip) throw new HttpError(409, 'personel_terarsip')
      if (!['Aktif', 'MPP'].includes(p.status)) throw new HttpError(409, 'personel_tidak_aktif') // K20
      const u = await nilaiUsulan(c, b.usulan, jenis, p.jenis)
      const r = await c.query(
        `INSERT INTO sdl_sumda_karier(personel_id,jenis,nomor_referensi,tanggal_usulan,tanggal_efektif,usulan_pangkat,usulan_jabatan,
                                      usulan_unit_kerja,catatan,created_by,updated_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id::text`,
        [b.personelId, jenis, nomor, tglUsulan, tglEfektif, u.pangkat, u.jabatan, u.unitKerja, catatan, req.actor])
      const id = r.rows[0].id
      await riwayat(c, id, null, 'Diajukan', '', req.actor)
      await audit(c, req.actor, 'subbagsumda.karier.create', 'subbagsumda.karier', id, { jenis, status: 'Diajukan' })
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
         FROM sdl_sumda_karier_lampiran l LEFT JOIN sdl_users u ON u.id=l.uploaded_by
        WHERE l.karier_id=$1::uuid ORDER BY l.uploaded_at, l.id`, [id])).rows
    const hist = (await pool.query(
      `SELECT h.dari,h.ke,h.catatan,u.display_name,h.pada FROM sdl_sumda_karier_riwayat h
         LEFT JOIN sdl_users u ON u.id=h.oleh WHERE h.karier_id=$1::uuid ORDER BY h.id`, [id])).rows
    respond(res, 200, {
      item,
      lampiran: lampiran.map((l) => ({ id: l.id, filename: l.filename, size: l.size_bytes, uploadedBy: l.uploaded_by, uploadedByName: l.display_name ?? '', uploadedAt: l.uploaded_at })),
      riwayat: hist.map((h) => ({ dari: h.dari, ke: h.ke, catatan: h.catatan, oleh: h.display_name ?? '', pada: h.pada })),
    })
  }))

  router.patch('/:id', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    // K18: personelId dan jenis tidak bisa diubah -> tidak termasuk kunci yang diizinkan.
    const b = body(req, ['nomorReferensi', 'tanggalUsulan', 'tanggalEfektif', 'usulan', 'catatan', 'version'])
    const version = versi(b.version)
    const nomor = teks(b.nomorReferensi, 0, 100)
    const tglUsulan = tanggal(b.tanggalUsulan, 2000, 2100)
    if (!tglUsulan) throw new HttpError(400, 'invalid_input')
    const tglEfektif = tanggal(b.tanggalEfektif, 2000, 2100)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      if (k.status !== 'Diajukan') throw new HttpError(409, 'status_tidak_sesuai')
      await tolakBilaTerarsip(c, k.personel_id)
      const p = (await c.query('SELECT jenis FROM sdl_sumda_personel WHERE id=$1::uuid', [k.personel_id])).rows[0]
      const u = await nilaiUsulan(c, b.usulan, k.jenis, p?.jenis)
      await c.query(
        `UPDATE sdl_sumda_karier SET nomor_referensi=$2,tanggal_usulan=$3,tanggal_efektif=$4,usulan_pangkat=$5,usulan_jabatan=$6,
                usulan_unit_kerja=$7,catatan=$8,updated_by=$9,updated_at=now(),version=version+1 WHERE id=$1::uuid`,
        [id, nomor, tglUsulan, tglEfektif, u.pangkat, u.jabatan, u.unitKerja, catatan, req.actor])
      await audit(c, req.actor, 'subbagsumda.karier.update', 'subbagsumda.karier', id, { jenis: k.jenis, version: version + 1 })
      return ambil(c, id)
    })
    respond(res, 200, { item })
  }))

  router.post('/:id/aksi', json, handle(async (req, res) => {
    const id = idParam(req.params.id)
    const b = body(req, ['aksi', 'catatan', 'version', 'tanggalEfektif', 'terapkan'])
    const aksi = pilihan(b.aksi, ['proses', 'setujui', 'tolak', 'batalkan', 'selesai'])
    // Hak diperiksa sebelum isian lain divalidasi (konsisten dengan route lain, review S8).
    if (aksi === 'setujui' || aksi === 'tolak') await need(req, P.approve)
    else await need(req, P.manage)
    if (aksi === 'selesai') await need(req, P.personelUpdate)
    if (aksi !== 'selesai' && (b.terapkan !== undefined || b.tanggalEfektif !== undefined)) throw new HttpError(400, 'invalid_input')
    const version = versi(b.version)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    // K24: tolak/batalkan wajib beralasan.
    if ((aksi === 'tolak' || aksi === 'batalkan') && [...catatan].length < 8) throw new HttpError(400, 'invalid_input')
    const isApprover = aksi === 'batalkan' ? await can(req.actor, P.approve) : false

    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      const dari = k.status
      const syarat = { proses: ['Diajukan'], setujui: ['Diproses'], tolak: ['Diproses'], batalkan: ['Diajukan', 'Diproses'], selesai: ['Disetujui'] }[aksi]
      if (!syarat.includes(dari)) throw new HttpError(409, 'status_tidak_sesuai')
      if (aksi === 'proses' || aksi === 'setujui' || aksi === 'tolak') await tolakBilaTerarsip(c, k.personel_id)

      if (aksi === 'proses') {
        await c.query(`UPDATE sdl_sumda_karier SET status='Diproses',updated_at=now(),version=version+1 WHERE id=$1::uuid`, [id])
        await riwayat(c, id, dari, 'Diproses', catatan, req.actor)
        await audit(c, req.actor, 'subbagsumda.karier.proses', 'subbagsumda.karier', id, { jenis: k.jenis, status: 'Diproses' })
      } else if (aksi === 'setujui' || aksi === 'tolak') {
        const ke = aksi === 'setujui' ? 'Disetujui' : 'Ditolak'
        // Maker-checker diputuskan di SQL (K3/K9/K19): pencatat dan pengubah terakhir tidak boleh memutuskan.
        const r = await c.query(
          `UPDATE sdl_sumda_karier SET status=$3,decided_by=$2::uuid,decided_at=now(),updated_at=now(),version=version+1
            WHERE id=$1::uuid AND status='Diproses' AND version=$4 AND created_by<>$2::uuid AND updated_by<>$2::uuid`,
          [id, req.actor, ke, version])
        if (r.rowCount !== 1) throw new HttpError(403, 'self_review_forbidden')
        await riwayat(c, id, dari, ke, catatan, req.actor)
        await audit(c, req.actor, `subbagsumda.karier.${aksi}`, 'subbagsumda.karier', id, { jenis: k.jenis, status: ke })
      } else if (aksi === 'batalkan') {
        // Hanya pencatat atau pemegang hak setuju (K8); diputuskan di WHERE.
        const r = await c.query(
          `UPDATE sdl_sumda_karier SET status='Dibatalkan',updated_at=now(),version=version+1
            WHERE id=$1::uuid AND status IN ('Diajukan','Diproses') AND (created_by=$2::uuid OR $3::boolean)`,
          [id, req.actor, isApprover])
        if (r.rowCount !== 1) throw new HttpError(403, 'access_denied')
        await riwayat(c, id, dari, 'Dibatalkan', catatan, req.actor)
        await audit(c, req.actor, 'subbagsumda.karier.batalkan', 'subbagsumda.karier', id, { jenis: k.jenis, status: 'Dibatalkan' })
      } else {
        await selesai(c, req, k, b, catatan)
      }
      return ambil(c, id)
    })
    respond(res, 200, { item })
  }))

  /** Selesai: terapkan ke Master Personel dalam transaksi yang sama (K2/K10/K20/K21). */
  async function selesai(c, req, k, b, catatan) {
    const tglEfektif = tanggal(b.tanggalEfektif, 2000, 2100) ?? k.tanggal_efektif
    if (!tglEfektif) throw new HttpError(400, 'invalid_input')
    const p = (await c.query(
      `SELECT id::text,jenis,pangkat,jabatan,unit_kerja,version,deleted_at IS NOT NULL AS terarsip
         FROM sdl_sumda_personel WHERE id=$1::uuid FOR NO KEY UPDATE`, [k.personel_id])).rows[0]
    if (!p) throw new HttpError(404, 'not_found')
    if (p.terarsip) throw new HttpError(409, 'personel_terarsip')

    let diterapkan = {}
    let berubah = []
    let dikoreksi = []
    if (k.jenis !== 'KGB') {
      const t = b.terapkan
      if (t === null || typeof t !== 'object' || Array.isArray(t)) throw new HttpError(400, 'invalid_input')
      const { personelVersion, ...nilai } = t
      if (versi(personelVersion) !== p.version) throw new HttpError(409, 'personel_berubah')
      const v = await nilaiUsulan(c, nilai, k.jenis, p.jenis)
      const lama = { pangkat: p.pangkat, jabatan: p.jabatan, unitKerja: p.unit_kerja }
      const fields = {}
      for (const f of FIELD_JENIS[k.jenis]) if (v[f] !== '' && v[f] !== lama[f]) fields[f] = { lama: lama[f], baru: v[f] }
      berubah = Object.keys(fields)
      if (berubah.length) {
        const set = berubah.map((f, i) => `${KOLOM_MASTER[f]}=$${i + 4}`).join(',')
        const r = await c.query(
          `UPDATE sdl_sumda_personel SET ${set},updated_by=$3,updated_at=now(),version=version+1
            WHERE id=$1::uuid AND version=$2 AND deleted_at IS NULL`,
          [p.id, p.version, req.actor, ...berubah.map((f) => fields[f].baru)])
        if (r.rowCount !== 1) throw new HttpError(409, 'personel_berubah')
      }
      // Review S4: nilai yang berbeda dari usulan yang disetujui ditandai, supaya "Disetujui" tidak menyesatkan.
      const usulan = { pangkat: k.usulan_pangkat, jabatan: k.usulan_jabatan, unitKerja: k.usulan_unit_kerja }
      dikoreksi = FIELD_JENIS[k.jenis].filter((f) => v[f] !== usulan[f])
      diterapkan = { fields, personelVersion: { lama: p.version, baru: berubah.length ? p.version + 1 : p.version }, ...(dikoreksi.length ? { dikoreksi } : {}) }
    } else if (b.terapkan !== undefined) {
      throw new HttpError(400, 'invalid_input')
    }
    await c.query(
      `UPDATE sdl_sumda_karier SET status='Selesai',tanggal_efektif=$2,diterapkan=$3,selesai_by=$4::uuid,selesai_at=now(),
              updated_at=now(),version=version+1 WHERE id=$1::uuid AND status='Disetujui'`,
      [k.id, tglEfektif, diterapkan, req.actor])
    await riwayat(c, k.id, 'Disetujui', 'Selesai', catatan, req.actor)
    await audit(c, req.actor, 'subbagsumda.karier.selesai', 'subbagsumda.karier', k.id, { jenis: k.jenis, status: 'Selesai', fields: berubah, ...(dikoreksi.length ? { dikoreksi } : {}) })
    // K23: perubahan master juga tercatat sebagai perubahan personel (Aktivitas terakhir R5H27).
    if (berubah.length) await audit(c, req.actor, 'subbagsumda.personel.update', 'subbagsumda.personel', p.id, { fields: berubah, version: p.version + 1 })
  }

  /* ------------------------------------------------------------ Lampiran */

  async function cekTerbuka(c, id, lock) {
    const r = await c.query(`SELECT status,personel_id::text FROM sdl_sumda_karier WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`, [id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    if (!TERBUKA.includes(r.rows[0].status)) throw new HttpError(409, 'status_tidak_sesuai')
    // K26 juga untuk lampiran (review S2). Di dalam transaksi dengan FOR SHARE, di luar cukup baca biasa.
    if (lock) await tolakBilaTerarsip(c, r.rows[0].personel_id)
    else {
      const p = await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid', [r.rows[0].personel_id])
      if (p.rows[0]?.terarsip) throw new HttpError(409, 'personel_terarsip')
    }
    return r.rows[0].status
  }

  async function bacaPdf(req) {
    const up = await readSingleFile(req, { fieldName: 'file', maxBodyBytes: BODY_LIMITS.SUMDA_LAMPIRAN, maxFileBytes: MAKS_PDF, maxFiles: 2 })
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
    return { blob, filename, sealed, digest: createHash('sha256').update(blob).digest('hex') }
  }

  router.post('/:id/lampiran', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    // Periksa keberadaan & status SEBELUM membaca berkas besar.
    await cekTerbuka(pool, id, false)
    const { blob, filename, sealed, digest } = await bacaPdf(req)
    const row = await withTransaction(pool, async (c) => {
      await cekTerbuka(c, id, true)
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_karier_lampiran WHERE karier_id=$1::uuid', [id])).rows[0].n
      if (n >= MAKS_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_sumda_karier_lampiran(karier_id,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text`, [id, filename, blob.length, digest, sealed, req.actor])).rows[0]
      await naikVersi(c, id, req.actor) // K22 + W1
      await audit(c, req.actor, 'subbagsumda.karier.lampiran.add', 'subbagsumda.karier', id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const isApprover = await can(req.actor, P.approve)
    await withTransaction(pool, async (c) => {
      const r0 = await c.query('SELECT status,personel_id::text FROM sdl_sumda_karier WHERE id=$1::uuid FOR UPDATE', [id])
      if (r0.rowCount !== 1) throw new HttpError(404, 'not_found')
      // K12: hapus hanya sebelum Disetujui.
      if (!['Diajukan', 'Diproses'].includes(r0.rows[0].status)) throw new HttpError(409, 'status_tidak_sesuai')
      await tolakBilaTerarsip(c, r0.rows[0].personel_id) // K26 (review S2)
      const r = await c.query(
        `DELETE FROM sdl_sumda_karier_lampiran WHERE id=$1::uuid AND karier_id=$2::uuid AND (uploaded_by=$3::uuid OR $4::boolean)`,
        [lid, id, req.actor, isApprover])
      if (r.rowCount !== 1) {
        const ada = await c.query('SELECT 1 FROM sdl_sumda_karier_lampiran WHERE id=$1::uuid AND karier_id=$2::uuid', [lid, id])
        throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
      }
      await naikVersi(c, id, req.actor) // K22 + W1
      await audit(c, req.actor, 'subbagsumda.karier.lampiran.delete', 'subbagsumda.karier', id)
    })
    respond(res, 200, { ok: true })
  }))

  // Lampiran selalu dicari bersama karier_id-nya (id milik pengajuan lain -> 404).
  router.get('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const r = await pool.query('SELECT filename,sha256,body FROM sdl_sumda_karier_lampiran WHERE id=$1::uuid AND karier_id=$2::uuid', [lid, id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    let plain
    try { plain = openEvidence(evidenceKey, r.rows[0].body) } catch { throw new HttpError(503, 'evidence_integrity_failure') }
    if (createHash('sha256').update(plain).digest('hex') !== r.rows[0].sha256) throw new HttpError(503, 'evidence_integrity_failure')
    // Header dipasang LEBIH DULU (review S1): nama non-Latin-1 tidak boleh membuat setHeader melempar
    // setelah audit unduhan terlanjur tercatat.
    res.set('Content-Type', 'application/octet-stream')
    res.set('Content-Disposition', disposisi(r.rows[0].filename))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Security-Policy', 'sandbox')
    res.set('Cache-Control', 'no-store')
    await withTransaction(pool, (c) => audit(c, req.actor, 'subbagsumda.karier.lampiran.download', 'subbagsumda.karier', id))
    res.status(200).end(plain)
  }))

  return router
}
