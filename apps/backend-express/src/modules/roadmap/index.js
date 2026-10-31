import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { writeJson } from '../../http/respond.js'

/**
 * Dasbor roadmap proyek, port dari apps/backend/internal/roadmap/api.go.
 *
 * Dipasang di bawah /api/v1/admin, tapi TETAP memeriksa role Superadmin lagi
 * di dalam handler. Pemeriksaan ganda itu disengaja di Go dan dipertahankan:
 * guard router bisa saja dipindah suatu saat, dan endpoint ini tidak boleh
 * ikut terbuka karenanya.
 */

const ID_PATTERN = /^SDL-[0-9]{3}$/

const VALID_STATUSES = new Set([
  'Teruji',
  'Terpasang - perlu uji',
  'Berjalan sebagian',
  'Perlu keputusan',
  'Belum mulai',
])

const TARGET_DATE = '2026-12-31'
const BASELINE_DATE = '2026-10-23'

/** Semua respons modul ini memakai Cache-Control: no-store (reply(), api.go:44). */
function reply(res, status, body) {
  res.set('Cache-Control', 'no-store')
  writeJson(res, status, body)
}

async function isSuperadmin(pool, userId) {
  if (!userId) return false
  try {
    const { rows } = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM sdl_users u
          JOIN sdl_user_roles ur ON ur.user_id=u.id
         WHERE u.id=$1 AND u.is_active=TRUE AND NOT u.must_change_password
           AND ur.role_key='superadmin') AS ok`,
      [userId],
    )
    return rows[0].ok
  } catch {
    return false
  }
}

export function createRoadmapRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.ROADMAP)

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      next(error)
    }
  }

  // ---- GET /project-roadmap ----
  router.get('/project-roadmap', handle(async (req, res) => {
    if (!(await isSuperadmin(pool, req.actor))) {
      reply(res, 403, { error: 'access_denied' })
      return
    }

    try {
      const records = await pool.query(
        `SELECT id,section,sort_order,payload,status,management_note,version,updated_at
           FROM sdl_project_roadmap_records ORDER BY sort_order,id`,
      )
      const snapshots = await pool.query(
        'SELECT (day)::text AS day,completed,total FROM sdl_project_roadmap_snapshots ORDER BY day',
      )

      reply(res, 200, {
        records: records.rows.map((row) => ({
          id: row.id,
          section: row.section,
          order: row.sort_order,
          data: row.payload,
          status: row.status,
          managementNote: row.management_note,
          version: Number(row.version),
          updatedAt: row.updated_at,
        })),
        snapshots: snapshots.rows.map((row) => ({
          day: row.day,
          completed: row.completed,
          total: row.total,
        })),
        targetDate: TARGET_DATE,
        baselineDate: BASELINE_DATE,
      })
    } catch {
      reply(res, 503, { error: 'unavailable' })
    }
  }))

  // ---- PATCH /project-roadmap/:id ----
  router.patch('/project-roadmap/:id', json, handle(async (req, res) => {
    if (!(await isSuperadmin(pool, req.actor))) {
      reply(res, 403, { error: 'access_denied' })
      return
    }

    const id = req.params.id
    if (!ID_PATTERN.test(id)) {
      reply(res, 400, { error: 'invalid_request' })
      return
    }

    const payload = parsePayload(req, ['status', 'managementNote', 'version'])
    if (!payload.ok) {
      reply(res, 400, { error: 'invalid_request' })
      return
    }
    const { status, managementNote, version } = payload.value
    if (
      !VALID_STATUSES.has(status) ||
      !Number.isInteger(version) || version < 1 ||
      typeof managementNote !== 'string' || [...managementNote].length > 1500
    ) {
      reply(res, 400, { error: 'invalid_request' })
      return
    }

    const note = managementNote.trim()
    const actor = req.actor

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const existing = await client.query(
          "SELECT status,version FROM sdl_project_roadmap_records WHERE id=$1 AND section='roadmap' FOR UPDATE",
          [id],
        )
        if (existing.rows.length === 0) return { kind: 'not_found' }

        const previous = existing.rows[0].status
        const currentVersion = Number(existing.rows[0].version)
        if (currentVersion !== version) return { kind: 'version_conflict' }

        await client.query(
          `UPDATE sdl_project_roadmap_records
              SET status=$2,management_note=$3,version=version+1,updated_by=$4::uuid,updated_at=now()
            WHERE id=$1`,
          [id, status, note, actor],
        )
        await client.query(
          `INSERT INTO sdl_project_roadmap_updates(record_id,actor_id,status_before,status_after,note)
           VALUES($1,$2::uuid,$3,$4,$5)`,
          [id, actor, previous, status, note],
        )
        // Snapshot harian dihitung ulang dari keadaan terkini, bukan
        // ditambahkan secara inkremental — satu baris per hari waktu Jakarta.
        await client.query(
          `INSERT INTO sdl_project_roadmap_snapshots(day,completed,total)
           SELECT (now() AT TIME ZONE 'Asia/Jakarta')::date,
                  count(*) FILTER(WHERE status='Teruji')::integer,
                  count(*)::integer
             FROM sdl_project_roadmap_records WHERE section='roadmap'
           ON CONFLICT(day) DO UPDATE SET completed=EXCLUDED.completed,total=EXCLUDED.total`,
        )

        return { kind: 'ok', version: currentVersion + 1 }
      })
    } catch {
      reply(res, 503, { error: 'unavailable' })
      return
    }

    if (outcome.kind === 'not_found') {
      reply(res, 404, { error: 'not_found' })
      return
    }
    if (outcome.kind === 'version_conflict') {
      reply(res, 409, { error: 'version_conflict' })
      return
    }
    reply(res, 200, { status, version: outcome.version })
  }))

  return router
}
