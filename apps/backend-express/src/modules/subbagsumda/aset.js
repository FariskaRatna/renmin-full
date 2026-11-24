import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { HARI_INI, HttpError, UUID_RE, body, idParam, makeHandle, permit, pernahMengubahSql, pilihan, tanggal, teks } from './umum.js'
import { MAKS_LAMPIRAN, bacaPdf, bukaPdf, pasangHeaderUnduh } from './lampiran.js'

/**
 * R5H31: Subbagsumda — Inventaris & BMN (menggantikan registry R5B inventaris + menu Pemeliharaan Logistik).
 * Migrasi 072. EXPRESS SAJA. Dokumen: docs/R5H31-SUMDA-KINERJA-INVENTARIS.md (K1–K49).
 *
 *   GET    /api/v1/subbagsumda/aset/capabilities
 *   GET    /api/v1/subbagsumda/aset?q=&kategori=&kondisi=&status=&tahap=&page=&size=
 *   GET    /api/v1/subbagsumda/aset/jadwal?tahap=                           (K20)
 *   POST   /api/v1/subbagsumda/aset                    field K17
 *   GET    /api/v1/subbagsumda/aset/:id
 *   PATCH  /api/v1/subbagsumda/aset/:id                field K17 + version (tidak saat Usulan/Dihapus)
 *   POST   /api/v1/subbagsumda/aset/:id/aksi           {aksi:pemeliharaan|aktifkan|usulkan_hapus|setujui_hapus|tolak_hapus,catatan,version}
 *   POST   /api/v1/subbagsumda/aset/:id/pemeliharaan   {tanggal,jenis,uraian,pelaksana,kondisi,jadwalBerikutnya,koreksiDari?,version}
 *   POST · GET · DELETE  /api/v1/subbagsumda/aset/:id/lampiran[/:lid]
 *
 * Hak: Ri subbagsumda.inventaris.read (semua aset, K24) · Ma aset.manage · Aa aset.approve.
 * Registry R5B (`/subbagsumda/registry/*`, 142 endpoint beku) TIDAK disentuh.
 * KUNCI: POST: personel PJ (FOR SHARE). Route lain: aset (FOR UPDATE) dulu, baru personel PJ.
 */

export const KATEGORI_ASET = Object.freeze(['Komputer', 'Perangkat Jaringan', 'Perabot', 'Elektronik', 'Kendaraan', 'Lainnya'])
export const KONDISI = Object.freeze(['Baik', 'Perlu Pemeriksaan', 'Rusak Ringan', 'Rusak Berat'])
export const STATUS_ASET = Object.freeze(['Aktif', 'Pemeliharaan', 'Usulan Penghapusan', 'Dihapus'])
export const JENIS_PEMELIHARAAN = Object.freeze(['RUTIN', 'PERBAIKAN', 'PEMERIKSAAN'])
export const TAHAP_ASET = Object.freeze(['H-14', 'JATUH_TEMPO'])
const KODE_RE = /^[A-Za-z0-9 ._/()-]+$/ // K43
const UKURAN_HALAMAN = new Set([5, 10, 50, 100])
const MAKS_JADWAL = 500
const MAKS_ENTRI = 200

const P = {
  read: 'subbagsumda.inventaris.read',
  manage: 'subbagsumda.aset.manage',
  approve: 'subbagsumda.aset.approve',
}

const handle = makeHandle({ sdl_sumda_aset_kode_uq: 'kode_bmn_ganda' })

const sisaAsetSql = (a = 'a', hari = HARI_INI) => `(${a}.jadwal_pemeliharaan - ${hari})`
/** K20: satu-satunya rumus tahap pemeliharaan (WIB); hanya Aktif/Pemeliharaan. */
export function tahapAsetSql(a = 'a', hari = HARI_INI) {
  const sisa = sisaAsetSql(a, hari)
  return `CASE WHEN ${a}.status IN ('Aktif','Pemeliharaan') AND ${a}.jadwal_pemeliharaan IS NOT NULL THEN
    CASE WHEN ${sisa} <= 0 THEN 'JATUH_TEMPO' WHEN ${sisa} <= 14 THEN 'H-14' END END`
}
/** K47: jumlah aset dengan tahap H-14/Jatuh tempo (dashboard Sumda). */
export const PEMELIHARAAN_14_SQL = `SELECT count(*)::int AS n FROM sdl_sumda_aset a WHERE ${tahapAsetSql()} IS NOT NULL`

const KOLOM = `a.id::text,a.kode_bmn,a.nama,a.kategori,a.merek_tipe,a.tahun_perolehan,a.jumlah,a.satuan,a.lokasi,a.kondisi,
  a.penanggung_jawab_id::text,a.penanggung_jawab_teks,pj.nama AS pj_nama,pj.nrp AS pj_nrp,pj.deleted_at IS NOT NULL AS pj_terarsip,
  a.jadwal_pemeliharaan::text AS jadwal,${sisaAsetSql()} AS sisa_hari,${tahapAsetSql()} AS tahap,a.status,a.status_sebelum,
  a.usulan_alasan,uu.display_name AS usulan_name,a.usulan_by::text,a.usulan_at,du.display_name AS decided_name,a.decided_at,a.catatan,
  a.source_registry_id IS NOT NULL AS salinan,a.version,a.created_at,a.updated_at,a.updated_by::text`
const DARI = `FROM sdl_sumda_aset a
  LEFT JOIN sdl_sumda_personel pj ON pj.id=a.penanggung_jawab_id
  LEFT JOIN sdl_users uu ON uu.id=a.usulan_by
  LEFT JOIN sdl_users du ON du.id=a.decided_by`

function mapAset(r) {
  return {
    id: r.id, kodeBmn: r.kode_bmn, nama: r.nama, kategori: r.kategori, merekTipe: r.merek_tipe, tahunPerolehan: r.tahun_perolehan ?? null,
    jumlah: r.jumlah, satuan: r.satuan, lokasi: r.lokasi, kondisi: r.kondisi,
    penanggungJawab: r.penanggung_jawab_id
      ? { id: r.penanggung_jawab_id, nama: r.pj_nama, nrp: r.pj_nrp, terarsip: r.pj_terarsip, teks: '' }
      : { id: null, nama: null, nrp: null, terarsip: false, teks: r.penanggung_jawab_teks },
    jadwalPemeliharaan: r.jadwal ?? '', sisaHari: r.sisa_hari ?? null, tahap: r.tahap ?? null,
    status: r.status, statusSebelum: r.status_sebelum ?? null,
    usulan: r.usulan_at ? { alasan: r.usulan_alasan, oleh: r.usulan_by, olehNama: r.usulan_name ?? '', pada: r.usulan_at } : null,
    decidedByName: r.decided_name ?? null, decidedAt: r.decided_at ?? null,
    catatan: r.catatan, salinan: r.salinan, version: r.version, createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by,
  }
}

async function ambil(c, id) {
  const r = await c.query(`SELECT ${KOLOM} ${DARI} WHERE a.id=$1::uuid`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return mapAset(r.rows[0])
}

/** Audit tanpa data pribadi: hanya kunci daftar putih. */
async function audit(c, actor, event, subject, meta = {}) {
  const out = {}
  for (const k of ['status', 'kondisi', 'fields', 'version']) if (Object.hasOwn(meta, k)) out[k] = meta[k]
  await c.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, event, 'subbagsumda.aset', subject, out])
}

async function riwayat(c, id, dari, ke, catatan, oleh) {
  await c.query('INSERT INTO sdl_sumda_aset_riwayat(aset_id,dari,ke,catatan,oleh) VALUES($1,$2,$3,$4,$5)', [id, dari, ke, catatan, oleh])
}

function versi(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}

async function kunci(c, id) {
  const r = await c.query(
    `SELECT id::text,kode_bmn,status,status_sebelum,version,usulan_by::text,usulan_at,penanggung_jawab_id::text
       FROM sdl_sumda_aset WHERE id=$1::uuid FOR UPDATE`, [id])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  return r.rows[0]
}

async function naikVersi(c, id, actor) {
  await c.query('UPDATE sdl_sumda_aset SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1::uuid', [id, actor])
}

/** Isian K17. `kodeLama`: kode salinan di luar format boleh dipertahankan (pola NRP R5H27). */
function nilaiAset(b, kodeLama = null) {
  const kode = teks(b.kodeBmn, 2, 64)
  if (!KODE_RE.test(kode) && kode !== kodeLama) throw new HttpError(400, 'invalid_input')
  let tahunPerolehan = null
  if (b.tahunPerolehan !== undefined && b.tahunPerolehan !== null && b.tahunPerolehan !== '') {
    if (!Number.isSafeInteger(b.tahunPerolehan) || b.tahunPerolehan < 1900 || b.tahunPerolehan > 2100) throw new HttpError(400, 'invalid_input')
    tahunPerolehan = b.tahunPerolehan
  }
  if (!Number.isSafeInteger(b.jumlah) || b.jumlah < 1 || b.jumlah > 1000000) throw new HttpError(400, 'invalid_input') // K46
  let pjId = null
  if (b.penanggungJawabId !== undefined && b.penanggungJawabId !== null && b.penanggungJawabId !== '') {
    if (typeof b.penanggungJawabId !== 'string' || !UUID_RE.test(b.penanggungJawabId)) throw new HttpError(400, 'invalid_input')
    pjId = b.penanggungJawabId.toLowerCase()
  }
  const pjTeks = teks(b.penanggungJawabTeks, 0, 200)
  if (pjId && pjTeks) throw new HttpError(400, 'invalid_input')
  return {
    kode, nama: teks(b.nama, 3, 200), kategori: pilihan(b.kategori, KATEGORI_ASET), merekTipe: teks(b.merekTipe, 0, 200),
    tahunPerolehan, jumlah: b.jumlah, satuan: teks(b.satuan, 0, 32), lokasi: teks(b.lokasi, 0, 200), kondisi: pilihan(b.kondisi, KONDISI),
    pjId, pjTeks, jadwal: tanggal(b.jadwalPemeliharaan, 2000, 2100), catatan: teks(b.catatan, 0, 2000, { multiline: true }),
  }
}
const FIELD_ASET = ['kodeBmn', 'nama', 'kategori', 'merekTipe', 'tahunPerolehan', 'jumlah', 'satuan', 'lokasi', 'kondisi',
  'penanggungJawabId', 'penanggungJawabTeks', 'jadwalPemeliharaan', 'catatan']

/** K45: PJ baru harus personel yang ada dan belum terarsip. FOR SHARE (urutan: setelah aset). */
async function cekPJ(c, pjId, lama) {
  if (!pjId) return
  const p = (await c.query('SELECT deleted_at IS NOT NULL AS terarsip FROM sdl_sumda_personel WHERE id=$1::uuid FOR SHARE', [pjId])).rows[0]
  if (!p) throw new HttpError(400, 'invalid_input')
  if (p.terarsip && pjId !== lama) throw new HttpError(409, 'personel_terarsip')
}

export function createSumdaAsetRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.SUMDA)
  const { can, need } = permit(pool)

  router.get('/capabilities', handle(async (req, res) => {
    const [read, manage, approve] = await Promise.all([P.read, P.manage, P.approve].map((k) => can(req.actor, k)))
    respond(res, 200, { canRead: read, canManage: manage, canApprove: approve })
  }))

  router.get('/jadwal', handle(async (req, res) => {
    await need(req, P.read)
    const tahap = String(req.query.tahap ?? '')
    if (tahap !== '' && !TAHAP_ASET.includes(tahap)) throw new HttpError(400, 'invalid_input')
    const hitung = (await pool.query(`SELECT ${tahapAsetSql()} AS tahap, count(*)::int AS n FROM sdl_sumda_aset a WHERE ${tahapAsetSql()} IS NOT NULL GROUP BY 1`)).rows
    const rows = (await pool.query(
      `SELECT ${KOLOM} ${DARI} WHERE ${tahapAsetSql()} IS NOT NULL AND ($1 = '' OR ${tahapAsetSql()} = $1)
        ORDER BY a.jadwal_pemeliharaan, lower(a.nama), a.id LIMIT ${MAKS_JADWAL}`, [tahap])).rows
    respond(res, 200, {
      ringkas: Object.fromEntries(TAHAP_ASET.map((t) => [t, hitung.find((h) => h.tahap === t)?.n ?? 0])),
      items: rows.map(mapAset),
    })
  }))

  router.get('/', handle(async (req, res) => {
    await need(req, P.read)
    const q = teks(req.query.q ?? '', 0, 100)
    const kategori = String(req.query.kategori ?? '')
    const kondisi = String(req.query.kondisi ?? '')
    const status = String(req.query.status ?? '')
    const tahap = String(req.query.tahap ?? '')
    if (kategori !== '' && !KATEGORI_ASET.includes(kategori)) throw new HttpError(400, 'invalid_input')
    if (kondisi !== '' && !KONDISI.includes(kondisi)) throw new HttpError(400, 'invalid_input')
    if (status !== '' && !STATUS_ASET.includes(status)) throw new HttpError(400, 'invalid_input')
    if (tahap !== '' && !TAHAP_ASET.includes(tahap)) throw new HttpError(400, 'invalid_input')
    const page = req.query.page === undefined ? 1 : parseGoInt(String(req.query.page))
    const size = req.query.size === undefined ? 10 : parseGoInt(String(req.query.size))
    if (page === undefined || page < 1 || page > 100000 || !UKURAN_HALAMAN.has(size)) throw new HttpError(400, 'invalid_input')
    const where = []
    const args = []
    if (q !== '') {
      args.push(`%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`)
      where.push(`(a.kode_bmn ILIKE $${args.length} OR a.nama ILIKE $${args.length} OR a.lokasi ILIKE $${args.length})`)
    }
    if (kategori !== '') { args.push(kategori); where.push(`a.kategori=$${args.length}`) }
    if (kondisi !== '') { args.push(kondisi); where.push(`a.kondisi=$${args.length}`) }
    if (status !== '') { args.push(status); where.push(`a.status=$${args.length}`) } else where.push("a.status<>'Dihapus'") // K41
    if (tahap !== '') { args.push(tahap); where.push(`${tahapAsetSql()}=$${args.length}`) }
    const w = where.join(' AND ')
    const total = Number((await pool.query(`SELECT count(*) ${DARI} WHERE ${w}`, args)).rows[0].count)
    const rows = (await pool.query(
      `SELECT ${KOLOM} ${DARI} WHERE ${w} ORDER BY lower(a.nama), a.kode_bmn, a.id LIMIT ${size} OFFSET ${(page - 1) * size}`, args)).rows
    respond(res, 200, { items: rows.map(mapAset), total, page, size })
  }))

  router.post('/', json, handle(async (req, res) => {
    await need(req, P.manage)
    const v = nilaiAset(body(req, FIELD_ASET))
    const item = await withTransaction(pool, async (c) => {
      await cekPJ(c, v.pjId, null)
      const id = (await c.query(
        `INSERT INTO sdl_sumda_aset(kode_bmn,nama,kategori,merek_tipe,tahun_perolehan,jumlah,satuan,lokasi,kondisi,
                                    penanggung_jawab_id,penanggung_jawab_teks,jadwal_pemeliharaan,catatan,created_by,updated_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid,$11,$12,$13,$14,$14) RETURNING id::text`,
        [v.kode, v.nama, v.kategori, v.merekTipe, v.tahunPerolehan, v.jumlah, v.satuan, v.lokasi, v.kondisi, v.pjId, v.pjTeks, v.jadwal, v.catatan, req.actor])).rows[0].id
      await riwayat(c, id, null, 'Aktif', '', req.actor)
      await audit(c, req.actor, 'subbagsumda.aset.create', id, { status: 'Aktif', kondisi: v.kondisi })
      return ambil(c, id)
    })
    respond(res, 201, { item })
  }))

  router.get('/:id', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id)
    const item = await ambil(pool, id)
    const entri = (await pool.query(
      `SELECT e.id::text,e.tanggal::text AS tanggal,e.jenis,e.uraian,e.pelaksana,e.kondisi,e.jadwal_berikutnya::text AS jadwal_berikutnya,
              e.koreksi_dari::text,u.display_name,e.created_at
         FROM sdl_sumda_aset_pemeliharaan e LEFT JOIN sdl_users u ON u.id=e.created_by
        WHERE e.aset_id=$1::uuid ORDER BY e.tanggal DESC, e.created_at DESC LIMIT ${MAKS_ENTRI + 1}`, [id])).rows
    const lampiran = (await pool.query(
      `SELECT l.id::text,l.filename,l.size_bytes,l.uploaded_by::text,u.display_name,l.uploaded_at
         FROM sdl_sumda_aset_lampiran l LEFT JOIN sdl_users u ON u.id=l.uploaded_by WHERE l.aset_id=$1::uuid ORDER BY l.uploaded_at, l.id`, [id])).rows
    const hist = (await pool.query(
      `SELECT h.dari,h.ke,h.catatan,u.display_name,h.pada FROM sdl_sumda_aset_riwayat h
         LEFT JOIN sdl_users u ON u.id=h.oleh WHERE h.aset_id=$1::uuid ORDER BY h.id`, [id])).rows
    respond(res, 200, {
      item,
      pemeliharaan: entri.slice(0, MAKS_ENTRI).map((e) => ({
        id: e.id, tanggal: e.tanggal, jenis: e.jenis, uraian: e.uraian, pelaksana: e.pelaksana, kondisi: e.kondisi,
        jadwalBerikutnya: e.jadwal_berikutnya ?? '', koreksiDari: e.koreksi_dari ?? null, olehNama: e.display_name ?? '', pada: e.created_at,
      })),
      pemeliharaanTerpotong: entri.length > MAKS_ENTRI,
      lampiran: lampiran.map((l) => ({ id: l.id, filename: l.filename, size: l.size_bytes, uploadedBy: l.uploaded_by, uploadedByName: l.display_name ?? '', uploadedAt: l.uploaded_at })),
      riwayat: hist.map((h) => ({ dari: h.dari, ke: h.ke, catatan: h.catatan, oleh: h.display_name ?? '', pada: h.pada })),
    })
  }))

  router.patch('/:id', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const b = body(req, [...FIELD_ASET, 'version'])
    const version = versi(b.version)
    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      const v = nilaiAset(b, k.kode_bmn)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      if (!['Aktif', 'Pemeliharaan'].includes(k.status)) throw new HttpError(409, 'status_tidak_sesuai') // K40/K41
      await cekPJ(c, v.pjId, k.penanggung_jawab_id)
      await c.query(
        `UPDATE sdl_sumda_aset SET kode_bmn=$2,nama=$3,kategori=$4,merek_tipe=$5,tahun_perolehan=$6,jumlah=$7,satuan=$8,lokasi=$9,
                kondisi=$10,penanggung_jawab_id=$11::uuid,penanggung_jawab_teks=$12,jadwal_pemeliharaan=$13,catatan=$14,
                updated_by=$15,updated_at=now(),version=version+1 WHERE id=$1::uuid`,
        [id, v.kode, v.nama, v.kategori, v.merekTipe, v.tahunPerolehan, v.jumlah, v.satuan, v.lokasi, v.kondisi, v.pjId, v.pjTeks, v.jadwal, v.catatan, req.actor])
      await audit(c, req.actor, 'subbagsumda.aset.update', id, { kondisi: v.kondisi, version: version + 1 })
      return ambil(c, id)
    })
    respond(res, 200, { item })
  }))

  router.post('/:id/aksi', json, handle(async (req, res) => {
    const id = idParam(req.params.id)
    const b = body(req, ['aksi', 'catatan', 'version'])
    const aksi = pilihan(b.aksi, ['pemeliharaan', 'aktifkan', 'usulkan_hapus', 'setujui_hapus', 'tolak_hapus'])
    if (aksi === 'setujui_hapus' || aksi === 'tolak_hapus') await need(req, P.approve)
    else await need(req, P.manage)
    const version = versi(b.version)
    const catatan = teks(b.catatan, 0, 1000, { multiline: true })
    if (['usulkan_hapus', 'tolak_hapus'].includes(aksi) && [...catatan].length < 8) throw new HttpError(400, 'invalid_input')

    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      const dari = k.status
      const syarat = { pemeliharaan: ['Aktif'], aktifkan: ['Pemeliharaan'], usulkan_hapus: ['Aktif', 'Pemeliharaan'], setujui_hapus: ['Usulan Penghapusan'], tolak_hapus: ['Usulan Penghapusan'] }[aksi]
      if (!syarat.includes(dari)) throw new HttpError(409, 'status_tidak_sesuai')

      if (aksi === 'pemeliharaan' || aksi === 'aktifkan') {
        const ke = aksi === 'pemeliharaan' ? 'Pemeliharaan' : 'Aktif'
        await c.query('UPDATE sdl_sumda_aset SET status=$2,updated_by=$3,updated_at=now(),version=version+1 WHERE id=$1::uuid', [id, ke, req.actor])
        await riwayat(c, id, dari, ke, catatan, req.actor)
        await audit(c, req.actor, aksi === 'pemeliharaan' ? 'subbagsumda.aset.pemeliharaan_status' : 'subbagsumda.aset.aktifkan', id, { status: ke })
      } else if (aksi === 'usulkan_hapus') {
        await c.query(
          `UPDATE sdl_sumda_aset SET status='Usulan Penghapusan',status_sebelum=$2,usulan_alasan=$3,usulan_by=$4::uuid,usulan_at=now(),
                  updated_by=$4::uuid,updated_at=now(),version=version+1 WHERE id=$1::uuid`, [id, dari, catatan, req.actor])
        await riwayat(c, id, dari, 'Usulan Penghapusan', catatan, req.actor)
        await audit(c, req.actor, 'subbagsumda.aset.usulkan_hapus', id, { status: 'Usulan Penghapusan' })
      } else {
        if (aksi === 'setujui_hapus') {
          // K4/K39: wajib ≥ 1 lampiran yang diunggah SEJAK usulan (faktur lama tidak dihitung).
          const ada = (await c.query('SELECT EXISTS(SELECT 1 FROM sdl_sumda_aset_lampiran WHERE aset_id=$1::uuid AND uploaded_at >= $2::timestamptz) AS ok', [id, k.usulan_at])).rows[0].ok
          if (!ada) throw new HttpError(409, 'lampiran_wajib')
        }
        const ke = aksi === 'setujui_hapus' ? 'Dihapus' : k.status_sebelum
        // Maker-checker (K39): bukan pengusul dan tidak mengubah lampiran SEJAK usulan; diputus di WHERE + CHECK DB.
        const set = aksi === 'setujui_hapus' ? `status='Dihapus',decided_by=$2::uuid,decided_at=now()`
          : `status=status_sebelum,status_sebelum=NULL,usulan_alasan='',usulan_by=NULL,usulan_at=NULL`
        const r = await c.query(
          `UPDATE sdl_sumda_aset SET ${set},updated_at=now(),version=version+1
            WHERE id=$1::uuid AND status='Usulan Penghapusan' AND version=$3 AND usulan_by<>$2::uuid
              AND NOT ${pernahMengubahSql('subbagsumda.aset', '$4', '$2', { sejak: '$5' })}`,
          [id, req.actor, version, id.toLowerCase(), k.usulan_at])
        if (r.rowCount !== 1) throw new HttpError(403, 'self_review_forbidden')
        await riwayat(c, id, dari, ke, catatan, req.actor)
        await audit(c, req.actor, `subbagsumda.aset.${aksi}`, id, { status: ke })
      }
      return ambil(c, id)
    })
    respond(res, 200, { item })
  }))

  router.post('/:id/pemeliharaan', json, handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    const b = body(req, ['tanggal', 'jenis', 'uraian', 'pelaksana', 'kondisi', 'jadwalBerikutnya', 'koreksiDari', 'version'])
    const version = versi(b.version)
    const tgl = tanggal(b.tanggal, 2000, 2100)
    if (!tgl) throw new HttpError(400, 'invalid_input')
    const jenis = pilihan(b.jenis, JENIS_PEMELIHARAAN)
    const uraian = teks(b.uraian, 3, 1000, { multiline: true })
    const pelaksana = teks(b.pelaksana, 0, 200)
    const kondisi = pilihan(b.kondisi, KONDISI)
    const jadwal = tanggal(b.jadwalBerikutnya, 2000, 2100)
    if (jenis === 'RUTIN' && !jadwal) throw new HttpError(400, 'invalid_input') // K42
    if (jadwal && jadwal <= tgl) throw new HttpError(400, 'invalid_input')
    let koreksi = null
    if (b.koreksiDari !== undefined && b.koreksiDari !== null && b.koreksiDari !== '') {
      if (typeof b.koreksiDari !== 'string' || !UUID_RE.test(b.koreksiDari)) throw new HttpError(400, 'invalid_input')
      koreksi = b.koreksiDari
    }
    const item = await withTransaction(pool, async (c) => {
      const k = await kunci(c, id)
      if (k.version !== version) throw new HttpError(409, 'version_conflict')
      if (!['Aktif', 'Pemeliharaan'].includes(k.status)) throw new HttpError(409, 'status_tidak_sesuai') // K40/K41
      const hari = (await c.query(`SELECT (${HARI_INI})::text AS d`)).rows[0].d
      if (tgl > hari) throw new HttpError(400, 'invalid_input') // K42: tidak di masa depan (WIB)
      // FK komposit (koreksi_dari, aset_id): entri aset lain -> 23503 -> 400.
      await c.query(
        `INSERT INTO sdl_sumda_aset_pemeliharaan(aset_id,tanggal,jenis,uraian,pelaksana,kondisi,jadwal_berikutnya,koreksi_dari,created_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7,$8::uuid,$9)`, [id, tgl, jenis, uraian, pelaksana, kondisi, jadwal, koreksi, req.actor])
      await c.query(
        `UPDATE sdl_sumda_aset SET kondisi=$2,jadwal_pemeliharaan=coalesce($3::date,jadwal_pemeliharaan),updated_by=$4,updated_at=now(),
                version=version+1 WHERE id=$1::uuid`, [id, kondisi, jadwal, req.actor])
      await audit(c, req.actor, 'subbagsumda.aset.pemeliharaan.add', id, { kondisi, version: version + 1 })
      return ambil(c, id)
    })
    respond(res, 201, { item })
  }))

  /* ------------------------------------------------------------ Lampiran */

  const BOLEH_UNGGAH = ['Aktif', 'Pemeliharaan', 'Usulan Penghapusan'] // K22/K40/K41

  async function cekUnggah(c, id, lock) {
    const r = await c.query(`SELECT status FROM sdl_sumda_aset WHERE id=$1::uuid${lock ? ' FOR UPDATE' : ''}`, [id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    if (!BOLEH_UNGGAH.includes(r.rows[0].status)) throw new HttpError(409, 'status_tidak_sesuai')
  }

  router.post('/:id/lampiran', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id)
    await cekUnggah(pool, id, false)
    const { blob, filename, sealed, digest } = await bacaPdf(req, evidenceKey)
    const row = await withTransaction(pool, async (c) => {
      await cekUnggah(c, id, true)
      const n = (await c.query('SELECT count(*)::int AS n FROM sdl_sumda_aset_lampiran WHERE aset_id=$1::uuid', [id])).rows[0].n
      if (n >= MAKS_LAMPIRAN) throw new HttpError(409, 'batas_lampiran')
      const r = (await c.query(
        `INSERT INTO sdl_sumda_aset_lampiran(aset_id,filename,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6) RETURNING id::text`, [id, filename, blob.length, digest, sealed, req.actor])).rows[0]
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.aset.lampiran.add', id)
      return r
    })
    respond(res, 201, { id: row.id, sha256: digest })
  }))

  router.delete('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.manage)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const isApprover = await can(req.actor, P.approve)
    await withTransaction(pool, async (c) => {
      await cekUnggah(c, id, true)
      const r = await c.query(
        'DELETE FROM sdl_sumda_aset_lampiran WHERE id=$1::uuid AND aset_id=$2::uuid AND (uploaded_by=$3::uuid OR $4::boolean)',
        [lid, id, req.actor, isApprover])
      if (r.rowCount !== 1) {
        const ada = await c.query('SELECT 1 FROM sdl_sumda_aset_lampiran WHERE id=$1::uuid AND aset_id=$2::uuid', [lid, id])
        throw ada.rowCount ? new HttpError(403, 'access_denied') : new HttpError(404, 'not_found')
      }
      await naikVersi(c, id, req.actor)
      await audit(c, req.actor, 'subbagsumda.aset.lampiran.delete', id)
    })
    respond(res, 200, { ok: true })
  }))

  router.get('/:id/lampiran/:lid', handle(async (req, res) => {
    await need(req, P.read)
    const id = idParam(req.params.id); const lid = idParam(req.params.lid)
    const r = await pool.query('SELECT filename,sha256,body FROM sdl_sumda_aset_lampiran WHERE id=$1::uuid AND aset_id=$2::uuid', [lid, id])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    const plain = bukaPdf(r.rows[0], evidenceKey)
    pasangHeaderUnduh(res, r.rows[0].filename)
    await withTransaction(pool, (c) => audit(c, req.actor, 'subbagsumda.aset.lampiran.download', id))
    res.status(200).end(plain)
  }))

  return router
}
