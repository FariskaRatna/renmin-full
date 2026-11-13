import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { fail, parseGoInt, respond, textOk } from './shared.js'

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
 * Hak akses (permission pada grant unit 'subbagren', scope tidak dipakai --
 * lihat 049_progar_pagu.sql):
 *   subbagren.progar.read    baca semuanya
 *   subbagren.progar.manage  catat/ubah program, kegiatan, pagu draft
 *   subbagren.pagu.approve   setujui/tolak pagu yang dicatat ORANG LAIN
 *
 * `jumlah` dikirim dan dikembalikan sebagai string digit (rupiah, tanpa
 * pecahan), sama seperti modul anggaran lama, supaya tidak ada pembulatan
 * float di nilai besar.
 */

const UNIT = 'subbagren'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KODE_RE = /^[A-Za-z0-9][A-Za-z0-9.\-/ ]{0,39}$/
const MAX_JUMLAH = 10n ** 15n

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

export function createProgarRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.USULAN)

  const can = async (actor, permission) => (await pool.query(PERMIT_SQL, [actor, permission])).rows[0].ok === true
  const need = async (req, permission) => {
    if (!(await can(req.actor, permission))) throw new HttpError(403, 'access_denied')
  }

  router.get('/capabilities', handle(async (req, res) => {
    const [read, manage, approve] = await Promise.all([
      can(req.actor, 'subbagren.progar.read'),
      can(req.actor, 'subbagren.progar.manage'),
      can(req.actor, 'subbagren.pagu.approve'),
    ])
    respond(res, 200, { canRead: read, canManage: manage, canApprove: approve })
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

  return router
}

/** Setelah UPDATE ... AND version=$n gagal: barisnya hilang (404) atau versinya basi (409). */
async function conflictOrMissing(client, table, rowId) {
  const r = await client.query(`SELECT 1 FROM ${table} WHERE id=$1::uuid AND deleted_at IS NULL`, [rowId])
  return r.rowCount ? new HttpError(409, 'version_conflict') : new HttpError(404, 'not_found')
}
