import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { writeJson } from '../../http/respond.js'
import { authorizeOperational, authorizeRoleEditor } from '../../auth/guards.js'

/**
 * Portal publikasi, port dari apps/backend/internal/portal/api.go.
 *
 * Guard-nya UNIK dan tidak memakai salah satu dari dua engine: router mencoba
 * AuthorizeOperational dulu; kalau gagal DAN method-nya GET, ia mencoba
 * AuthorizeRoleEditor. Artinya Superadmin boleh MEMBACA publikasi yang sudah
 * terbit, tapi tidak pernah menulis.
 *
 * Hak menulis terpisah lagi: hanya pemegang grant Subbagbinfung yang aktif.
 */

const VALID_KINDS = new Set(['berita', 'pengumuman', 'sop', 'peraturan', 'agenda'])
const VALID_UNITS = new Set(['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung'])

const PAYLOAD_FIELDS = [
  'id', 'kind', 'title', 'summary', 'body', 'ownerUnit',
  'coverUrl', 'referenceNo', 'startsAt', 'pinned', 'published', 'version',
]

const COLUMNS = `id::text AS id,kind,title,summary,body,owner_unit,cover_url,
                 reference_no,starts_at,pinned,published,version,created_at,updated_at`

function send(res, status, body) {
  res.set('Cache-Control', 'no-store')
  writeJson(res, status, body)
}

function validLength(value, min, max) {
  if (typeof value !== 'string') return false
  const length = [...value].length
  return length >= min && length <= max
}

/** Padanan valid() (api.go:60). */
function validInput(input) {
  if (!VALID_KINDS.has(input.kind)) return false
  if (!VALID_UNITS.has(input.ownerUnit)) return false

  if (
    !validLength(String(input.title ?? '').trim(), 3, 160) ||
    !validLength(input.summary ?? '', 0, 600) ||
    !validLength(input.body ?? '', 0, 8000) ||
    !validLength(input.referenceNo ?? '', 0, 160) ||
    !validLength(input.coverUrl ?? '', 0, 1000)
  ) {
    return false
  }

  // Sampul wajib HTTPS, berhost, dan tanpa kredensial di URL.
  if (input.coverUrl) {
    let parsed
    try {
      parsed = new URL(input.coverUrl)
    } catch {
      return false
    }
    if (parsed.protocol !== 'https:' || parsed.host === '') return false
    if (parsed.username !== '' || parsed.password !== '') return false
  }

  // Agenda tanpa waktu mulai tidak berarti apa-apa.
  if (input.kind === 'agenda' && input.startsAt == null) return false

  return true
}

function toPost(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    body: row.body,
    ownerUnit: row.owner_unit,
    coverUrl: row.cover_url,
    referenceNo: row.reference_no,
    startsAt: row.starts_at,
    pinned: row.pinned,
    published: row.published,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Hak sunting: hanya pemegang grant Subbagbinfung yang masih aktif.
 * Superadmin selalu dikecualikan, termasuk di mode demo lokal.
 */
async function isEditor(pool, actorId) {
  try {
    const { rows } = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM sdl_users u
           JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key='subbagbinfung'
           JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key='subbagbinfung'
                AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
           JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
          WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password
            AND NOT EXISTS (SELECT 1 FROM sdl_user_roles sr
                             WHERE sr.user_id=u.id AND sr.role_key='superadmin')) AS ok`,
      [actorId],
    )
    return rows[0].ok
  } catch {
    return false
  }
}

/**
 * Guard ad-hoc portal, padanan portalAuth (router.go:155).
 * Dipasang sebagai middleware karena ia menentukan req.actor untuk handler.
 */
function portalGuard(pool, config) {
  return async (req, res, next) => {
    let result
    try {
      result = await authorizeOperational(pool, req, config)
      if (result.status !== 200 && req.method === 'GET') {
        // Superadmin hanya boleh membaca informasi yang sudah terbit.
        result = await authorizeRoleEditor(pool, req, config)
      }
    } catch {
      send(res, 503, { error: 'access_denied' })
      return
    }
    if (result.status !== 200) {
      send(res, result.status, { error: 'access_denied' })
      return
    }
    req.actor = result.userId
    next()
  }
}

export function createPortalRouter({ pool, config }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.PORTAL)

  router.use(portalGuard(pool, config))

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      next(error)
    }
  }

  // ---- GET / ----
  router.get('/', handle(async (req, res) => {
    const managing = req.query.manage === '1'
    const canEdit = await isEditor(pool, req.actor)
    if (managing && !canEdit) {
      send(res, 403, { error: 'access_denied' })
      return
    }

    try {
      // Draft TIDAK PERNAH terlihat oleh pembaca portal biasa maupun Superadmin.
      const { rows } = managing
        ? await pool.query(`SELECT ${COLUMNS} FROM sdl_portal_posts ORDER BY updated_at DESC LIMIT 300`)
        : await pool.query(
            `SELECT ${COLUMNS} FROM sdl_portal_posts WHERE published=TRUE
              ORDER BY pinned DESC,updated_at DESC LIMIT 300`,
          )
      send(res, 200, { items: rows.map(toPost), editor: canEdit })
    } catch {
      send(res, 503, { error: 'unavailable' })
    }
  }))

  /** POST dan PUT memakai handler yang sama, persis seperti di Go. */
  const save = handle(async (req, res) => {
    if (!(await isEditor(pool, req.actor))) {
      send(res, 403, { error: 'access_denied' })
      return
    }

    const payload = parsePayload(req, PAYLOAD_FIELDS)
    if (!payload.ok || !validInput(payload.value)) {
      send(res, 400, { error: 'invalid_request' })
      return
    }
    const input = payload.value
    const creating = req.method === 'POST'

    let id = creating ? undefined : req.params.id
    if (!creating && (String(id).length !== 36 || !Number.isInteger(input.version) || input.version < 1)) {
      send(res, 400, { error: 'invalid_request' })
      return
    }

    const values = [
      input.kind,
      String(input.title).trim(),
      input.summary ?? '',
      input.body ?? '',
      input.ownerUnit,
      input.coverUrl ?? '',
      input.referenceNo ?? '',
      input.startsAt ?? null,
      input.pinned === true,
      input.published === true,
      req.actor,
    ]

    try {
      const outcome = await withTransaction(pool, async (client) => {
        let version
        if (creating) {
          const inserted = await client.query(
            `INSERT INTO sdl_portal_posts(kind,title,summary,body,owner_unit,cover_url,reference_no,
                                          starts_at,pinned,published,created_by,updated_by)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::uuid,$11::uuid)
             RETURNING id::text AS id,version`,
            values,
          )
          id = inserted.rows[0].id
          version = inserted.rows[0].version
        } else {
          const updated = await client.query(
            `UPDATE sdl_portal_posts
                SET kind=$1,title=$2,summary=$3,body=$4,owner_unit=$5,cover_url=$6,reference_no=$7,
                    starts_at=$8,pinned=$9,published=$10,updated_by=$11::uuid,updated_at=NOW(),version=version+1
              WHERE id=$12::uuid AND version=$13 RETURNING version`,
            [...values, id, input.version],
          )
          // Tidak ada baris terpengaruh berarti versinya sudah bergeser.
          if (updated.rows.length === 0) return { kind: 'version_conflict' }
          version = updated.rows[0].version
        }

        await client.query(
          `INSERT INTO sdl_portal_publication_events(post_id,actor_id,action,old_version,new_version)
           VALUES($1::uuid,$2::uuid,$3,$4,$5)`,
          [id, req.actor, creating ? 'create' : 'update', creating ? null : input.version, version],
        )
        return { kind: 'ok', version: Number(version) }
      })

      if (outcome.kind === 'version_conflict') {
        send(res, 409, { error: 'version_conflict' })
        return
      }
      send(res, 200, { id, version: outcome.version })
    } catch {
      send(res, 503, { error: 'unavailable' })
    }
  })

  router.post('/', json, save)
  router.put('/:id', json, save)

  return router
}
