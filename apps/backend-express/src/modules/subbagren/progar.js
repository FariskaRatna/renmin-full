import { Router } from 'express'

import { createHash } from 'node:crypto'

import { openEvidence, sealEvidence } from '../../crypto/evidence.js'
import { withTransaction } from '../../db.js'
import { contentDisposition, readSingleFile } from '../../http/multipart.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { validateEvidence } from './budget.js'
import { fail, parseDateOnly, parseGoInt, respond, textOk } from './shared.js'

/**
 * R5H11: Program Anggaran (PROGAR) -> Kegiatan -> Pagu Anggaran.
 * Migrasi 049. EXPRESS SAJA; Go tidak mengenal tabel ini.
 *
 *   GET    /api/v1/subbagren/progar/capabilities
 *   GET    /api/v1/subbagren/progar/?tahun=2027          pohon program + kegiatan + pagu
 *   POST   /api/v1/subbagren/progar/program               {tahun,kode,nama,keterangan}
 *   PUT    /api/v1/subbagren/progar/program/:id           {kode,nama,keterangan,version}
 *   DELETE /api/v1/subbagren/progar/program/:id           hanya bila tanpa kegiatan
 *   POST   /api/v1/subbagren/progar/program/:id/kegiatan  {kode,nama,keterangan}
 *   PUT    /api/v1/subbagren/progar/kegiatan/:id          {kode,nama,keterangan,version}
 *   DELETE /api/v1/subbagren/progar/kegiatan/:id          hanya bila tanpa pagu hidup
 *   POST   /api/v1/subbagren/progar/pagu                  {kegiatanId,jumlah,dasar,keterangan}
 *   PUT    /api/v1/subbagren/progar/pagu/:id              {jumlah,dasar,keterangan,version}  (draft saja)
 *   POST   /api/v1/subbagren/progar/pagu/:id/review       {keputusan,catatan,version}
 *
 * R5H12 -- realisasi per kegiatan (migrasi 050), memotong pagu yang disetujui:
 *   GET    /api/v1/subbagren/progar/realisasi?tahun=2027
 *   POST   /api/v1/subbagren/progar/realisasi             {paguId,tanggal,uraian,nomorBukti,jumlah}
 *   PUT    /api/v1/subbagren/progar/realisasi/:id         {tanggal,uraian,nomorBukti,jumlah,version} (draft)
 *   POST   /api/v1/subbagren/progar/realisasi/:id/bukti   multipart `file` (draft; menimpa bukti lama)
 *   GET    /api/v1/subbagren/progar/realisasi/:id/bukti   unduh (attachment)
 *   POST   /api/v1/subbagren/progar/realisasi/:id/review  {keputusan:"terverifikasi"|"ditolak",catatan,version}
 *
 * Hak akses (permission pada grant unit 'subbagren', scope tidak dipakai --
 * lihat 049_progar_pagu.sql):
 *   subbagren.progar.read    baca semuanya
 *   subbagren.progar.manage  catat/ubah program, kegiatan, pagu draft
 *   subbagren.pagu.approve   setujui/tolak pagu yang dicatat ORANG LAIN
 *   subbagren.realisasi.manage  catat realisasi + unggah bukti bayar
 *   subbagren.realisasi.verify  verifikasi/tolak realisasi yang dicatat ORANG LAIN
 *
 * `jumlah` dikirim dan dikembalikan sebagai string digit (rupiah, tanpa
 * pecahan), sama seperti modul anggaran lama, supaya tidak ada pembulatan
 * float di nilai besar.
 */

const UNIT = 'subbagren'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KODE_RE = /^[A-Za-z0-9][A-Za-z0-9.\-/ ]{0,39}$/
const MAX_JUMLAH = 10n ** 15n
const MAX_BUKTI = 5 << 20

const PERMIT_SQL = `SELECT EXISTS(
  SELECT 1 FROM sdl_users u
    JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key='${UNIT}'
    JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key='${UNIT}'
         AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
    JOIN sdl_roles r ON r.role_key=g.role_key AND r.is_active AND r.role_key<>'superadmin'
    JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key=$2
   WHERE u.id::text=$1 AND u.is_active AND NOT u.must_change_password
     AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
) AS ok`

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code }
}

/** Satu pembungkus: HttpError -> status-nya, pelanggaran unik -> 409, lainnya -> 503. */
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res)
    } catch (error) {
      if (error instanceof HttpError) { fail(res, error.status, error.code); return }
      if (error?.code === '23505') { fail(res, 409, 'duplicate'); return }
      if (error?.code === '23514') { fail(res, 400, 'invalid_input'); return }
      fail(res, 503, 'database_unavailable')
    }
  }
}

function body(req, keys) {
  const p = parsePayload(req, keys)
  if (!p.ok) throw new HttpError(400, 'invalid_body')
  return p.value
}

function text(v, min, max) {
  if (v === undefined || v === null) v = ''
  if (!textOk(v, min, max)) throw new HttpError(400, 'invalid_input')
  return v.trim()
}

function kode(v) {
  const k = text(v, 1, 40)
  if (!KODE_RE.test(k)) throw new HttpError(400, 'invalid_input')
  return k
}

function jumlah(v) {
  if (typeof v !== 'string' || !/^[1-9][0-9]{0,15}$/.test(v)) throw new HttpError(400, 'invalid_input')
  if (BigInt(v) > MAX_JUMLAH) throw new HttpError(400, 'invalid_input')
  return v
}

function version(v) {
  if (!Number.isSafeInteger(v) || v < 1) throw new HttpError(400, 'invalid_input')
  return v
}

function id(raw) {
  if (!UUID_RE.test(raw)) throw new HttpError(404, 'not_found')
  return raw
}

async function audit(client, actor, event, type, subject) {
  await client.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,$3,$4)',
    [actor, `subbagren.progar.${event}`, `subbagren.${type}`, subject],
  )
}

const PAGU_COLUMNS = `p.id::text,p.kegiatan_id::text,p.jumlah::text,p.dasar,p.keterangan,p.status,p.version,
  p.created_at,p.reviewed_at,p.review_note,p.created_by::text,
  cu.display_name AS created_name, ru.display_name AS reviewed_name`

function mapPagu(r) {
  return {
    id: r.id, jumlah: r.jumlah, dasar: r.dasar, keterangan: r.keterangan, status: r.status,
    version: r.version, createdBy: r.created_by, createdByName: r.created_name, createdAt: r.created_at,
    reviewedByName: r.reviewed_name ?? null, reviewedAt: r.reviewed_at ?? null, reviewNote: r.review_note,
  }
}

export function createProgarRouter({ pool, config }) {
  const evidenceKey = config?.evidenceKey
  const router = Router()
  const json = rawBody(BODY_LIMITS.USULAN)

  const can = async (actor, permission) => (await pool.query(PERMIT_SQL, [actor, permission])).rows[0].ok === true
  const need = async (req, permission) => {
    if (!(await can(req.actor, permission))) throw new HttpError(403, 'access_denied')
  }

  router.get('/capabilities', handle(async (req, res) => {
    const [read, manage, approve, realisasi, verify] = await Promise.all([
      can(req.actor, 'subbagren.progar.read'),
      can(req.actor, 'subbagren.progar.manage'),
      can(req.actor, 'subbagren.pagu.approve'),
      can(req.actor, 'subbagren.realisasi.manage'),
      can(req.actor, 'subbagren.realisasi.verify'),
    ])
    respond(res, 200, { canRead: read, canManage: manage, canApprove: approve, canRecordRealisasi: realisasi, canVerifyRealisasi: verify })
  }))

  router.get('/', handle(async (req, res) => {
    await need(req, 'subbagren.progar.read')
    const raw = String(req.query.tahun ?? '')
    const tahun = raw === '' ? new Date().getFullYear() : parseGoInt(raw)
    if (tahun === undefined || tahun < 2000 || tahun > 2100) throw new HttpError(400, 'invalid_year')

    const programs = (await pool.query(
      `SELECT id::text,tahun,kode,nama,keterangan,version,created_at FROM sdl_ren_program
        WHERE tahun=$1 AND deleted_at IS NULL ORDER BY lower(kode),id`, [tahun])).rows
    const kegiatan = (await pool.query(
      `SELECT k.id::text,k.program_id::text,k.kode,k.nama,k.keterangan,k.version FROM sdl_ren_kegiatan k
         JOIN sdl_ren_program pr ON pr.id=k.program_id AND pr.deleted_at IS NULL AND pr.tahun=$1
        WHERE k.deleted_at IS NULL ORDER BY lower(k.kode),k.id`, [tahun])).rows
    // Semua pagu kegiatan tahun ini, terbaru dulu: yang hidup (draft/disetujui)
    // jadi `pagu`, penolakan terakhir jadi `ditolak` supaya catatannya terbaca.
    const pagu = (await pool.query(
      `SELECT ${PAGU_COLUMNS} FROM sdl_ren_pagu p
         JOIN sdl_ren_kegiatan k ON k.id=p.kegiatan_id AND k.deleted_at IS NULL
         JOIN sdl_ren_program pr ON pr.id=k.program_id AND pr.deleted_at IS NULL AND pr.tahun=$1
         JOIN sdl_users cu ON cu.id=p.created_by
         LEFT JOIN sdl_users ru ON ru.id=p.reviewed_by
        ORDER BY p.created_at DESC,p.id DESC`, [tahun])).rows

    const live = new Map(); const rejected = new Map()
    for (const p of pagu) {
      if (p.status === 'ditolak') { if (!rejected.has(p.kegiatan_id)) rejected.set(p.kegiatan_id, mapPagu(p)) }
      else live.set(p.kegiatan_id, mapPagu(p))
    }
    let disetujui = 0n; let draft = 0n
    const byProgram = new Map(programs.map((p) => [p.id, []]))
    for (const k of kegiatan) {
      const lp = live.get(k.id) ?? null
      if (lp?.status === 'disetujui') disetujui += BigInt(lp.jumlah)
      if (lp?.status === 'draft') draft += BigInt(lp.jumlah)
      byProgram.get(k.program_id)?.push({
        id: k.id, kode: k.kode, nama: k.nama, keterangan: k.keterangan, version: k.version,
        pagu: lp, ditolak: lp ? null : (rejected.get(k.id) ?? null),
      })
    }
    respond(res, 200, {
      tahun,
      programs: programs.map((p) => ({
        id: p.id, tahun: p.tahun, kode: p.kode, nama: p.nama, keterangan: p.keterangan,
        version: p.version, createdAt: p.created_at, kegiatan: byProgram.get(p.id),
      })),
      totals: { disetujui: disetujui.toString(), draft: draft.toString() },
    })
  }))

  // ---- Program ----
  router.post('/program', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const v = body(req, ['tahun', 'kode', 'nama', 'keterangan'])
    if (!Number.isSafeInteger(v.tahun) || v.tahun < 2000 || v.tahun > 2100) throw new HttpError(400, 'invalid_input')
    const row = await withTransaction(pool, async (c) => {
      const r = (await c.query(
        `INSERT INTO sdl_ren_program(tahun,kode,nama,keterangan,created_by) VALUES($1,$2,$3,$4,$5)
         RETURNING id::text`, [v.tahun, kode(v.kode), text(v.nama, 3, 240), text(v.keterangan, 0, 1000), req.actor])).rows[0]
      await audit(c, req.actor, 'program.create', 'program', r.id)
      return r
    })
    respond(res, 201, { id: row.id })
  }))

  router.put('/program/:id', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const pid = id(req.params.id)
    const v = body(req, ['kode', 'nama', 'keterangan', 'version'])
    const args = [pid, kode(v.kode), text(v.nama, 3, 240), text(v.keterangan, 0, 1000), version(v.version)]
    await withTransaction(pool, async (c) => {
      const r = await c.query(
        `UPDATE sdl_ren_program SET kode=$2,nama=$3,keterangan=$4,version=version+1,updated_at=now()
          WHERE id=$1::uuid AND deleted_at IS NULL AND version=$5`, args)
      if (r.rowCount !== 1) throw await conflictOrMissing(c, 'sdl_ren_program', pid)
      await audit(c, req.actor, 'program.update', 'program', pid)
    })
    respond(res, 200, { ok: true })
  }))

  router.delete('/program/:id', handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const pid = id(req.params.id)
    await withTransaction(pool, async (c) => {
      const found = await c.query('SELECT 1 FROM sdl_ren_program WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE', [pid])
      if (found.rowCount !== 1) throw new HttpError(404, 'not_found')
      const used = await c.query('SELECT 1 FROM sdl_ren_kegiatan WHERE program_id=$1::uuid AND deleted_at IS NULL LIMIT 1', [pid])
      if (used.rowCount) throw new HttpError(409, 'program_has_kegiatan')
      await c.query('UPDATE sdl_ren_program SET deleted_at=now(),updated_at=now() WHERE id=$1::uuid', [pid])
      await audit(c, req.actor, 'program.delete', 'program', pid)
    })
    respond(res, 200, { ok: true })
  }))

  // ---- Kegiatan ----
  router.post('/program/:id/kegiatan', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const pid = id(req.params.id)
    const v = body(req, ['kode', 'nama', 'keterangan'])
    const args = [pid, kode(v.kode), text(v.nama, 3, 240), text(v.keterangan, 0, 1000), req.actor]
    const row = await withTransaction(pool, async (c) => {
      const found = await c.query('SELECT 1 FROM sdl_ren_program WHERE id=$1::uuid AND deleted_at IS NULL FOR SHARE', [pid])
      if (found.rowCount !== 1) throw new HttpError(404, 'not_found')
      const r = (await c.query(
        `INSERT INTO sdl_ren_kegiatan(program_id,kode,nama,keterangan,created_by) VALUES($1::uuid,$2,$3,$4,$5)
         RETURNING id::text`, args)).rows[0]
      await audit(c, req.actor, 'kegiatan.create', 'kegiatan', r.id)
      return r
    })
    respond(res, 201, { id: row.id })
  }))

  router.put('/kegiatan/:id', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const kid = id(req.params.id)
    const v = body(req, ['kode', 'nama', 'keterangan', 'version'])
    const args = [kid, kode(v.kode), text(v.nama, 3, 240), text(v.keterangan, 0, 1000), version(v.version)]
    await withTransaction(pool, async (c) => {
      const r = await c.query(
        `UPDATE sdl_ren_kegiatan SET kode=$2,nama=$3,keterangan=$4,version=version+1,updated_at=now()
          WHERE id=$1::uuid AND deleted_at IS NULL AND version=$5`, args)
      if (r.rowCount !== 1) throw await conflictOrMissing(c, 'sdl_ren_kegiatan', kid)
      await audit(c, req.actor, 'kegiatan.update', 'kegiatan', kid)
    })
    respond(res, 200, { ok: true })
  }))

  router.delete('/kegiatan/:id', handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const kid = id(req.params.id)
    await withTransaction(pool, async (c) => {
      const found = await c.query('SELECT 1 FROM sdl_ren_kegiatan WHERE id=$1::uuid AND deleted_at IS NULL FOR UPDATE', [kid])
      if (found.rowCount !== 1) throw new HttpError(404, 'not_found')
      const used = await c.query(`SELECT 1 FROM sdl_ren_pagu WHERE kegiatan_id=$1::uuid AND status IN ('draft','disetujui') LIMIT 1`, [kid])
      if (used.rowCount) throw new HttpError(409, 'kegiatan_has_pagu')
      await c.query('UPDATE sdl_ren_kegiatan SET deleted_at=now(),updated_at=now() WHERE id=$1::uuid', [kid])
      await audit(c, req.actor, 'kegiatan.delete', 'kegiatan', kid)
    })
    respond(res, 200, { ok: true })
  }))

  // ---- Pagu ----
  router.post('/pagu', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const v = body(req, ['kegiatanId', 'jumlah', 'dasar', 'keterangan'])
    if (typeof v.kegiatanId !== 'string' || !UUID_RE.test(v.kegiatanId)) throw new HttpError(400, 'invalid_input')
    const args = [v.kegiatanId, jumlah(v.jumlah), text(v.dasar, 3, 240), text(v.keterangan, 0, 1000), req.actor]
    const row = await withTransaction(pool, async (c) => {
      const found = await c.query(
        `SELECT 1 FROM sdl_ren_kegiatan k JOIN sdl_ren_program p ON p.id=k.program_id AND p.deleted_at IS NULL
          WHERE k.id=$1::uuid AND k.deleted_at IS NULL FOR SHARE OF k`, [v.kegiatanId])
      if (found.rowCount !== 1) throw new HttpError(404, 'not_found')
      let r
      try {
        r = (await c.query(
          `INSERT INTO sdl_ren_pagu(kegiatan_id,jumlah,dasar,keterangan,created_by) VALUES($1::uuid,$2::numeric,$3,$4,$5)
           RETURNING id::text`, args)).rows[0]
      } catch (error) {
        // Indeks unik parsial: kegiatan ini sudah punya pagu draft/disetujui.
        if (error?.code === '23505') throw new HttpError(409, 'pagu_exists')
        throw error
      }
      await audit(c, req.actor, 'pagu.create', 'pagu', r.id)
      return r
    })
    respond(res, 201, { id: row.id })
  }))

  router.put('/pagu/:id', json, handle(async (req, res) => {
    await need(req, 'subbagren.progar.manage')
    const gid = id(req.params.id)
    const v = body(req, ['jumlah', 'dasar', 'keterangan', 'version'])
    const args = [gid, jumlah(v.jumlah), text(v.dasar, 3, 240), text(v.keterangan, 0, 1000), version(v.version)]
    await withTransaction(pool, async (c) => {
      const cur = await c.query('SELECT status,version FROM sdl_ren_pagu WHERE id=$1::uuid FOR UPDATE', [gid])
      if (cur.rowCount !== 1) throw new HttpError(404, 'not_found')
      if (cur.rows[0].status !== 'draft') throw new HttpError(409, 'pagu_not_draft')
      if (cur.rows[0].version !== args[4]) throw new HttpError(409, 'version_conflict')
      await c.query(
        `UPDATE sdl_ren_pagu SET jumlah=$2::numeric,dasar=$3,keterangan=$4,version=version+1,updated_at=now()
          WHERE id=$1::uuid`, args.slice(0, 4))
      await audit(c, req.actor, 'pagu.update', 'pagu', gid)
    })
    respond(res, 200, { ok: true })
  }))

  router.post('/pagu/:id/review', json, handle(async (req, res) => {
    await need(req, 'subbagren.pagu.approve')
    const gid = id(req.params.id)
    const v = body(req, ['keputusan', 'catatan', 'version'])
    if (v.keputusan !== 'disetujui' && v.keputusan !== 'ditolak') throw new HttpError(400, 'invalid_input')
    // Menolak wajib beralasan supaya pencatat tahu apa yang harus diperbaiki.
    const catatan = text(v.catatan, v.keputusan === 'ditolak' ? 8 : 0, 500)
    const ver = version(v.version)
    await withTransaction(pool, async (c) => {
      const cur = await c.query('SELECT status,version,created_by::text FROM sdl_ren_pagu WHERE id=$1::uuid FOR UPDATE', [gid])
      if (cur.rowCount !== 1) throw new HttpError(404, 'not_found')
      const p = cur.rows[0]
      if (p.status !== 'draft') throw new HttpError(409, 'pagu_not_draft')
      if (p.version !== ver) throw new HttpError(409, 'version_conflict')
      if (p.created_by === req.actor) throw new HttpError(403, 'self_review_forbidden')
      await c.query(
        `UPDATE sdl_ren_pagu SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now(),
                version=version+1,updated_at=now() WHERE id=$1::uuid`, [gid, v.keputusan, catatan, req.actor])
      await audit(c, req.actor, v.keputusan === 'disetujui' ? 'pagu.approve' : 'pagu.reject', 'pagu', gid)
    })
    respond(res, 200, { ok: true, status: v.keputusan })
  }))

  // ---- Realisasi per kegiatan (R5H12) ----
  router.get('/realisasi', handle(async (req, res) => {
    await need(req, 'subbagren.progar.read')
    const raw = String(req.query.tahun ?? '')
    const tahun = raw === '' ? new Date().getFullYear() : parseGoInt(raw)
    if (tahun === undefined || tahun < 2000 || tahun > 2100) throw new HttpError(400, 'invalid_year')
    const pagu = (await pool.query(
      `SELECT g.id::text,g.jumlah::text,pr.kode AS program_kode,pr.nama AS program_nama,
              k.id::text AS kegiatan_id,k.kode AS kegiatan_kode,k.nama AS kegiatan_nama
         FROM sdl_ren_pagu g
         JOIN sdl_ren_kegiatan k ON k.id=g.kegiatan_id AND k.deleted_at IS NULL
         JOIN sdl_ren_program pr ON pr.id=k.program_id AND pr.deleted_at IS NULL AND pr.tahun=$1
        WHERE g.status='disetujui' ORDER BY lower(pr.kode),lower(k.kode)`, [tahun])).rows
    const real = (await pool.query(
      `SELECT r.id::text,r.pagu_id::text,r.tanggal::text,r.uraian,r.nomor_bukti,r.jumlah::text,r.status,r.version,
              r.created_by::text,cu.display_name AS created_name,r.created_at,r.reviewed_at,r.review_note,
              ru.display_name AS reviewed_name,b.filename,b.mime_type,b.size_bytes
         FROM sdl_ren_realisasi r
         JOIN sdl_users cu ON cu.id=r.created_by
         LEFT JOIN sdl_users ru ON ru.id=r.reviewed_by
         LEFT JOIN sdl_ren_realisasi_bukti b ON b.realisasi_id=r.id
        WHERE r.pagu_id=ANY($1::uuid[]) ORDER BY r.tanggal DESC,r.created_at DESC`, [pagu.map((g) => g.id)])).rows
    const byPagu = new Map(pagu.map((g) => [g.id, []]))
    for (const r of real) byPagu.get(r.pagu_id)?.push(r)
    const tot = { pagu: 0n, terverifikasi: 0n, menunggu: 0n }
    const items = pagu.map((g) => {
      const rows = byPagu.get(g.id)
      const sum = (st) => rows.filter((r) => r.status === st).reduce((n, r) => n + BigInt(r.jumlah), 0n)
      const ver = sum('terverifikasi')
      const wait = sum('draft')
      const pg = BigInt(g.jumlah)
      tot.pagu += pg; tot.terverifikasi += ver; tot.menunggu += wait
      return {
        paguId: g.id, pagu: g.jumlah, terverifikasi: ver.toString(), menunggu: wait.toString(), sisa: (pg - ver).toString(),
        program: { kode: g.program_kode, nama: g.program_nama },
        kegiatan: { id: g.kegiatan_id, kode: g.kegiatan_kode, nama: g.kegiatan_nama },
        realisasi: rows.map((r) => ({
          id: r.id, tanggal: r.tanggal, uraian: r.uraian, nomorBukti: r.nomor_bukti, jumlah: r.jumlah, status: r.status,
          version: r.version, createdBy: r.created_by, createdByName: r.created_name, createdAt: r.created_at,
          reviewedByName: r.reviewed_name ?? null, reviewedAt: r.reviewed_at ?? null, reviewNote: r.review_note,
          bukti: r.filename ? { filename: r.filename, mimeType: r.mime_type, size: r.size_bytes } : null,
        })),
      }
    })
    respond(res, 200, {
      tahun,
      items,
      totals: {
        pagu: tot.pagu.toString(), terverifikasi: tot.terverifikasi.toString(),
        menunggu: tot.menunggu.toString(), sisa: (tot.pagu - tot.terverifikasi).toString(),
      },
    })
  }))

  /** Pagu yang disetujui beserta tahun programnya; dikunci sesuai mode. */
  async function lockPagu(c, paguId, mode) {
    const r = await c.query(
      `SELECT g.jumlah::text,g.status,pr.tahun FROM sdl_ren_pagu g
         JOIN sdl_ren_kegiatan k ON k.id=g.kegiatan_id AND k.deleted_at IS NULL
         JOIN sdl_ren_program pr ON pr.id=k.program_id AND pr.deleted_at IS NULL
        WHERE g.id=$1::uuid FOR ${mode === 'UPDATE' ? 'UPDATE' : 'SHARE'} OF g`, [paguId])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    if (r.rows[0].status !== 'disetujui') throw new HttpError(409, 'pagu_not_approved')
    return r.rows[0]
  }

  async function verifiedSum(c, paguId) {
    const r = await c.query(
      `SELECT COALESCE(sum(jumlah),0)::text AS s FROM sdl_ren_realisasi
        WHERE pagu_id=$1::uuid AND status='terverifikasi'`, [paguId])
    return BigInt(r.rows[0].s)
  }

  function realisasiInput(v) {
    if (typeof v.tanggal !== 'string' || !parseDateOnly(v.tanggal)) throw new HttpError(400, 'invalid_input')
    return { tanggal: v.tanggal, uraian: text(v.uraian, 3, 240), nomorBukti: text(v.nomorBukti, 3, 120), jumlah: jumlah(v.jumlah) }
  }

  /**
   * Tanggal harus di tahun anggaran pagunya, dan jumlahnya muat di sisa pagu.
   * Ini pemeriksaan awal supaya salah ketik terlihat saat mencatat; yang
   * mengikat tetap pemeriksaan saat verifikasi (dengan kunci FOR UPDATE).
   */
  async function checkFits(c, paguId, input) {
    const p = await lockPagu(c, paguId, 'SHARE')
    if (Number(input.tanggal.slice(0, 4)) !== p.tahun) throw new HttpError(400, 'tahun_tidak_cocok')
    if (BigInt(input.jumlah) + await verifiedSum(c, paguId) > BigInt(p.jumlah)) throw new HttpError(409, 'melebihi_sisa_pagu')
  }

  router.post('/realisasi', json, handle(async (req, res) => {
    await need(req, 'subbagren.realisasi.manage')
    const v = body(req, ['paguId', 'tanggal', 'uraian', 'nomorBukti', 'jumlah'])
    if (typeof v.paguId !== 'string' || !UUID_RE.test(v.paguId)) throw new HttpError(400, 'invalid_input')
    const input = realisasiInput(v)
    const row = await withTransaction(pool, async (c) => {
      await checkFits(c, v.paguId, input)
      const r = (await c.query(
        `INSERT INTO sdl_ren_realisasi(pagu_id,tanggal,uraian,nomor_bukti,jumlah,created_by)
         VALUES($1::uuid,$2::date,$3,$4,$5::numeric,$6) RETURNING id::text`,
        [v.paguId, input.tanggal, input.uraian, input.nomorBukti, input.jumlah, req.actor])).rows[0]
      await audit(c, req.actor, 'realisasi.create', 'realisasi', r.id)
      return r
    })
    respond(res, 201, { id: row.id })
  }))

  router.put('/realisasi/:id', json, handle(async (req, res) => {
    await need(req, 'subbagren.realisasi.manage')
    const rid = id(req.params.id)
    const v = body(req, ['tanggal', 'uraian', 'nomorBukti', 'jumlah', 'version'])
    const input = realisasiInput(v)
    const ver = version(v.version)
    await withTransaction(pool, async (c) => {
      const cur = await c.query('SELECT status,version,pagu_id::text FROM sdl_ren_realisasi WHERE id=$1::uuid FOR UPDATE', [rid])
      if (cur.rowCount !== 1) throw new HttpError(404, 'not_found')
      if (cur.rows[0].status !== 'draft') throw new HttpError(409, 'realisasi_not_draft')
      if (cur.rows[0].version !== ver) throw new HttpError(409, 'version_conflict')
      await checkFits(c, cur.rows[0].pagu_id, input)
      await c.query(
        `UPDATE sdl_ren_realisasi SET tanggal=$2::date,uraian=$3,nomor_bukti=$4,jumlah=$5::numeric,
                version=version+1,updated_at=now() WHERE id=$1::uuid`,
        [rid, input.tanggal, input.uraian, input.nomorBukti, input.jumlah])
      await audit(c, req.actor, 'realisasi.update', 'realisasi', rid)
    })
    respond(res, 200, { ok: true })
  }))

  router.post('/realisasi/:id/bukti', handle(async (req, res) => {
    await need(req, 'subbagren.realisasi.manage')
    const rid = id(req.params.id)
    const cur = await pool.query('SELECT status FROM sdl_ren_realisasi WHERE id=$1::uuid', [rid])
    if (cur.rowCount !== 1) throw new HttpError(404, 'not_found')
    if (cur.rows[0].status !== 'draft') throw new HttpError(409, 'realisasi_not_draft')
    // Body baru dibaca setelah otorisasi dan status lolos.
    const upload = await readSingleFile(req, { fieldName: 'file', maxBodyBytes: MAX_BUKTI + 65536, maxFileBytes: MAX_BUKTI, maxFiles: 2 })
    if (upload.bodyExceeded || upload.error === 'too_large') throw new HttpError(413, 'file_too_large')
    if (upload.fileCount !== 1 || !upload.file) throw new HttpError(400, 'one_file_required')
    const blob = upload.file.buffer
    const filename = upload.file.filename.trim()
    const media = await validateEvidence(filename, blob)
    if (!media) throw new HttpError(400, 'invalid_file_type')
    let sealed
    try { sealed = sealEvidence(evidenceKey, blob) } catch { throw new HttpError(503, 'evidence_encryption_unavailable') }
    const digest = createHash('sha256').update(blob).digest('hex')
    await withTransaction(pool, async (c) => {
      const lock = await c.query('SELECT status FROM sdl_ren_realisasi WHERE id=$1::uuid FOR UPDATE', [rid])
      if (lock.rows[0]?.status !== 'draft') throw new HttpError(409, 'realisasi_not_draft')
      await c.query(
        `INSERT INTO sdl_ren_realisasi_bukti(realisasi_id,filename,mime_type,size_bytes,sha256,body,uploaded_by)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (realisasi_id) DO UPDATE SET filename=EXCLUDED.filename,mime_type=EXCLUDED.mime_type,
           size_bytes=EXCLUDED.size_bytes,sha256=EXCLUDED.sha256,body=EXCLUDED.body,
           uploaded_by=EXCLUDED.uploaded_by,uploaded_at=now()`,
        [rid, filename, media, blob.length, digest, sealed, req.actor])
      // Versi naik: peninjau yang memegang versi lama harus memuat ulang dan
      // melihat bukti yang baru, bukan memverifikasi berdasarkan bukti lama.
      await c.query('UPDATE sdl_ren_realisasi SET version=version+1,updated_at=now() WHERE id=$1::uuid', [rid])
      await audit(c, req.actor, 'realisasi.bukti.upload', 'realisasi', rid)
    })
    respond(res, 201, { ok: true, sha256: digest })
  }))

  router.get('/realisasi/:id/bukti', handle(async (req, res) => {
    await need(req, 'subbagren.progar.read')
    const rid = id(req.params.id)
    const r = await pool.query('SELECT filename,sha256,body FROM sdl_ren_realisasi_bukti WHERE realisasi_id=$1::uuid', [rid])
    if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
    let plain
    try { plain = openEvidence(evidenceKey, r.rows[0].body) } catch { throw new HttpError(503, 'evidence_integrity_failure') }
    if (createHash('sha256').update(plain).digest('hex') !== r.rows[0].sha256) throw new HttpError(503, 'evidence_integrity_failure')
    await withTransaction(pool, (c) => audit(c, req.actor, 'realisasi.bukti.download', 'realisasi', rid))
    res.set('Content-Type', 'application/octet-stream')
    res.set('Content-Disposition', contentDisposition('attachment', r.rows[0].filename))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Security-Policy', 'sandbox')
    res.set('Cache-Control', 'no-store')
    res.status(200).end(plain)
  }))

  router.post('/realisasi/:id/review', json, handle(async (req, res) => {
    await need(req, 'subbagren.realisasi.verify')
    const rid = id(req.params.id)
    const v = body(req, ['keputusan', 'catatan', 'version'])
    if (v.keputusan !== 'terverifikasi' && v.keputusan !== 'ditolak') throw new HttpError(400, 'invalid_input')
    const catatan = text(v.catatan, v.keputusan === 'ditolak' ? 8 : 0, 500)
    const ver = version(v.version)
    await withTransaction(pool, async (c) => {
      const cur = await c.query(
        'SELECT status,version,created_by::text,pagu_id::text,jumlah::text FROM sdl_ren_realisasi WHERE id=$1::uuid FOR UPDATE', [rid])
      if (cur.rowCount !== 1) throw new HttpError(404, 'not_found')
      const r = cur.rows[0]
      if (r.status !== 'draft') throw new HttpError(409, 'realisasi_not_draft')
      if (r.version !== ver) throw new HttpError(409, 'version_conflict')
      if (r.created_by === req.actor) throw new HttpError(403, 'self_review_forbidden')
      if (v.keputusan === 'terverifikasi') {
        const b = await c.query('SELECT sha256,body FROM sdl_ren_realisasi_bukti WHERE realisasi_id=$1::uuid', [rid])
        if (b.rowCount !== 1) throw new HttpError(409, 'bukti_required')
        let plain
        try { plain = openEvidence(evidenceKey, b.rows[0].body) } catch { throw new HttpError(503, 'evidence_integrity_failure') }
        if (createHash('sha256').update(plain).digest('hex') !== b.rows[0].sha256) throw new HttpError(503, 'evidence_integrity_failure')
        // Kunci baris pagu: dua verifikasi bersamaan diserialkan, sehingga
        // jumlah terverifikasi tidak pernah melampaui pagu.
        const p = await lockPagu(c, r.pagu_id, 'UPDATE')
        if (BigInt(r.jumlah) + await verifiedSum(c, r.pagu_id) > BigInt(p.jumlah)) throw new HttpError(409, 'melebihi_sisa_pagu')
      }
      await c.query(
        `UPDATE sdl_ren_realisasi SET status=$2,review_note=$3,reviewed_by=$4,reviewed_at=now(),
                version=version+1,updated_at=now() WHERE id=$1::uuid`, [rid, v.keputusan, catatan, req.actor])
      await audit(c, req.actor, v.keputusan === 'terverifikasi' ? 'realisasi.verify' : 'realisasi.reject', 'realisasi', rid)
    })
    respond(res, 200, { ok: true, status: v.keputusan })
  }))

  return router
}

/** Setelah UPDATE ... AND version=$n gagal: barisnya hilang (404) atau versinya basi (409). */
async function conflictOrMissing(client, table, rowId) {
  const r = await client.query(`SELECT 1 FROM ${table} WHERE id=$1::uuid AND deleted_at IS NULL`, [rowId])
  return r.rowCount ? new HttpError(409, 'version_conflict') : new HttpError(404, 'not_found')
}

/** R5H13: dipakai ulang oleh perencanaan.js (Dokumen Perencanaan, Kinerja & LKIP). */
export { HttpError, PERMIT_SQL, audit, body, handle, id, text, version }
