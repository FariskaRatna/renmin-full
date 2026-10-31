import { Router } from 'express'
import { createHash } from 'node:crypto'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { contentDisposition, detectFileType, readSingleFile, safeName } from '../../http/multipart.js'
import { isDemoSuperadmin } from '../../access/devdemo.js'
import { isAllowedUnit, permit } from './permit.js'
import {
  AccessDeniedError,
  NotFoundError,
  OutgoingLockedError,
  VALID_CLASSIFICATIONS,
  fail,
  isIsoDate,
  lengthOk,
  lockOutgoingEditing,
  respond,
  sqlError,
} from './shared.js'

/**
 * CRUD kerja unit lintas empat unit, port dari
 * apps/backend/internal/unitwork/work.go.
 *
 * Satu router melayani keempat unit lewat parameter :unit. Unit di luar
 * daftar yang diizinkan menghasilkan 404 unknown_unit — bukan 400, karena
 * dari sudut pandang klien path itu memang tidak ada.
 *
 * Unit 'urmin' diperlakukan khusus di empat tempat: update, delete, upload,
 * dan hapus berkas semuanya menolak kalau surat keluar pasangannya sudah
 * melewati tahap draft.
 */

const MAX_FILES_PER_RECORD = 10
const MAX_FILE_BYTES = 5 * 1024 * 1024
const RECORD_COLUMNS = `
  SELECT id::text AS id,unit_key,category,title,description,classification,
         created_by::text AS owner,version,created_at
    FROM sdl_unit_work_records`

const RECORD_FIELDS = ['category', 'title', 'description', 'classification', 'version']

/**
 * Query otorisasi yang gagal menghasilkan 503, BUKAN 403. Keduanya berbeda
 * makna: yang satu "tidak boleh", yang lain "belum bisa dipastikan". Go
 * memisahkannya secara konsisten, dan menyamakan keduanya akan membuat
 * gangguan database terbaca sebagai penolakan akses.
 */
class AuthorizationUnavailableError extends Error {
  constructor() {
    super('authorization_unavailable')
    this.name = 'AuthorizationUnavailableError'
  }
}

function toRecord(row) {
  return {
    id: row.id,
    unit: row.unit_key,
    category: row.category,
    title: row.title,
    description: row.description,
    classification: row.classification,
    owner: row.owner,
    version: Number(row.version),
    createdAt: row.created_at,
  }
}

function validRecordInput(input) {
  return (
    lengthOk(input.category, 2, 100) &&
    lengthOk(input.title, 3, 240) &&
    typeof input.description === 'string' &&
    [...input.description].length <= 4000 &&
    VALID_CLASSIFICATIONS.has(input.classification)
  )
}

export function createUnitWorkRouter({ pool }) {
  const router = Router({ mergeParams: true })
  const json = rawBody(BODY_LIMITS.UNIT_WORK)

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        fail(res, 403, 'access_denied')
        return
      }
      if (error instanceof AuthorizationUnavailableError) {
        fail(res, 503, 'authorization_unavailable')
        return
      }
      if (error instanceof OutgoingLockedError) {
        fail(res, 409, 'outgoing_locked')
        return
      }
      if (error instanceof NotFoundError) {
        sqlError(res, error)
        return
      }
      next(error)
    }
  }

  /** Padanan routeUnit: unit tak dikenal -> 404, bukan 400. */
  function routeUnit(req, res) {
    const unit = req.params.unit
    if (!isAllowedUnit(unit)) {
      fail(res, 404, 'unknown_unit')
      return undefined
    }
    return unit
  }

  /** Padanan visible(): muat record lalu periksa hak untuk aksi tertentu. */
  async function visible(actorId, unit, id, action) {
    const { rows } = await pool.query(
      `${RECORD_COLUMNS} WHERE id::text=$1 AND unit_key=$2 AND deleted_at IS NULL`,
      [id, unit],
    )
    if (rows.length === 0) throw new NotFoundError()

    const record = toRecord(rows[0])
    let allowed
    try {
      allowed = await permit(pool, actorId, {
        unit,
        classification: record.classification,
        owner: record.owner,
        recordId: record.id,
        action,
      })
    } catch {
      throw new AuthorizationUnavailableError()
    }
    if (!allowed) throw new AccessDeniedError()
    return record
  }

  // ---- GET /:unit/people ----
  router.get('/:unit/people', handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return

    let allowed
    try {
      allowed = await permit(pool, req.actor, { unit, classification: 'biasa', owner: '', recordId: '', action: 'create' })
    } catch {
      fail(res, 503, 'authorization_unavailable')
      return
    }
    if (!allowed) {
      fail(res, 403, 'access_denied')
      return
    }

    try {
      const { rows } = await pool.query(
        `SELECT DISTINCT u.id::text AS id,u.display_name
           FROM sdl_users u
           JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$1
           JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=$1
                AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
           JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
          WHERE u.is_active AND NOT u.must_change_password
            AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr
                            WHERE sr.user_id=u.id AND sr.role_key='superadmin')
          ORDER BY u.display_name LIMIT 100`,
        [unit],
      )
      // Pemanggil tidak pernah muncul sebagai calon penerima tugasnya sendiri.
      const items = rows
        .filter((row) => row.id !== req.actor)
        .map((row) => ({ id: row.id, name: row.display_name }))
      respond(res, 200, { items })
    } catch {
      fail(res, 503, 'database_unavailable')
    }
  }))

  // ---- GET /:unit/records ----
  router.get('/:unit/records', handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return

    const search = String(req.query.q ?? '').trim()
    if (search.length > 120) {
      fail(res, 400, 'invalid_search')
      return
    }

    try {
      const { rows } = await pool.query(
        `${RECORD_COLUMNS} WHERE unit_key=$1 AND deleted_at IS NULL
            AND ($2='' OR title ILIKE '%'||$2||'%' OR category ILIKE '%'||$2||'%')
          ORDER BY created_at DESC LIMIT 201`,
        [unit, search],
      )

      const items = []
      for (const row of rows) {
        const record = toRecord(row)
        const allowed = await permit(pool, req.actor, {
          unit,
          classification: record.classification,
          owner: record.owner,
          recordId: record.id,
          action: 'read',
        })
        if (allowed && items.length < 200) items.push(record)
      }
      respond(res, 200, { items, limited: items.length >= 200 })
    } catch {
      fail(res, 503, 'database_unavailable')
    }
  }))

  // ---- POST /:unit/records ----
  router.post('/:unit/records', json, handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return

    const payload = parsePayload(req, RECORD_FIELDS)
    if (!payload.ok) {
      fail(res, 400, 'invalid_input')
      return
    }
    const input = payload.value
    if (!validRecordInput(input)) {
      fail(res, 400, 'invalid_record')
      return
    }

    let allowed
    try {
      allowed = await permit(pool, req.actor, {
        unit,
        classification: input.classification,
        owner: req.actor,
        recordId: '',
        action: 'create',
      })
    } catch {
      fail(res, 503, 'authorization_unavailable')
      return
    }
    if (!allowed) {
      fail(res, 403, 'access_denied')
      return
    }

    try {
      const id = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO sdl_unit_work_records(unit_key,category,title,description,classification,created_by,updated_by)
           VALUES($1,$2,$3,$4,$5,$6::uuid,$6::uuid) RETURNING id::text AS id`,
          [unit, input.category.trim(), input.title.trim(), input.description.trim(), input.classification, req.actor],
        )
        const recordId = rows[0].id
        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,'created','Register dibuat')`,
          [recordId, req.actor],
        )
        return recordId
      })
      respond(res, 201, { id })
    } catch (error) {
      sqlError(res, error)
    }
  }))

  // ---- GET /:unit/records/:id ----
  router.get('/:unit/records/:id', handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return
    const id = req.params.id
    const record = await visible(req.actor, unit, id, 'read')

    try {
      const files = await pool.query(
        `SELECT id::text AS id,file_name,media_type,byte_size,created_at
           FROM sdl_unit_work_files WHERE record_id::text=$1 AND removed_at IS NULL
          ORDER BY created_at DESC`,
        [id],
      )
      const tasks = await pool.query(
        `SELECT t.id::text AS id,t.from_user::text AS from_user,t.to_user::text AS to_user,
                u.display_name,t.instruction,t.due_date::text AS due_date,t.status,t.response,t.created_at
           FROM sdl_unit_work_tasks t
           JOIN sdl_users u ON u.id=t.to_user
          WHERE t.record_id::text=$1 ORDER BY t.created_at DESC LIMIT 100`,
        [id],
      )
      const events = await pool.query(
        `SELECT e.action,e.note,u.display_name,
                to_char(e.created_at AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD HH24:MI') AS at
           FROM sdl_unit_work_events e
           JOIN sdl_users u ON u.id=e.actor_id
          WHERE e.record_id::text=$1 ORDER BY e.id DESC LIMIT 80`,
        [id],
      )

      respond(res, 200, {
        record,
        files: files.rows.map((row) => ({
          id: row.id,
          name: row.file_name,
          mediaType: row.media_type,
          size: row.byte_size,
          createdAt: row.created_at,
        })),
        tasks: tasks.rows.map((row) => ({
          id: row.id,
          from: row.from_user,
          to: row.to_user,
          toName: row.display_name,
          instruction: row.instruction,
          dueDate: row.due_date,
          status: row.status,
          response: row.response,
          createdAt: row.created_at,
        })),
        events: events.rows.map((row) => ({
          action: row.action,
          note: row.note,
          user: row.display_name,
          at: row.at,
        })),
      })
    } catch (error) {
      sqlError(res, error)
    }
  }))

  // ---- PATCH /:unit/records/:id ----
  router.patch('/:unit/records/:id', json, handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return
    const id = req.params.id
    const record = await visible(req.actor, unit, id, 'edit')

    const payload = parsePayload(req, RECORD_FIELDS)
    if (!payload.ok) {
      fail(res, 400, 'invalid_input')
      return
    }
    const input = payload.value
    if (!validRecordInput(input) || !Number.isInteger(input.version) || input.version < 1) {
      fail(res, 400, 'invalid_record')
      return
    }

    let allowed
    try {
      allowed = await permit(pool, req.actor, {
        unit,
        classification: input.classification,
        owner: record.owner,
        recordId: record.id,
        action: 'edit',
      })
    } catch {
      fail(res, 503, 'authorization_unavailable')
      return
    }
    if (!allowed) {
      fail(res, 403, 'access_denied')
      return
    }

    try {
      const outcome = await withTransaction(pool, async (client) => {
        if (unit === 'urmin') await lockOutgoingEditing(client, id)

        const updated = await client.query(
          `UPDATE sdl_unit_work_records
              SET category=$3,title=$4,description=$5,classification=$6,
                  updated_by=$7::uuid,version=version+1,updated_at=now()
            WHERE id::text=$1 AND unit_key=$2 AND deleted_at IS NULL AND version=$8`,
          [id, unit, input.category.trim(), input.title.trim(), input.description.trim(), input.classification, req.actor, input.version],
        )
        if (updated.rowCount !== 1) return 'stale_version'

        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,'updated','Register diperbarui')`,
          [id, req.actor],
        )
        return 'ok'
      })

      if (outcome === 'stale_version') {
        fail(res, 409, 'stale_version')
        return
      }
      respond(res, 200, { ok: true })
    } catch (error) {
      if (error instanceof OutgoingLockedError) {
        fail(res, 409, 'outgoing_locked')
        return
      }
      sqlError(res, error)
    }
  }))

  // ---- DELETE /:unit/records/:id ----
  router.delete('/:unit/records/:id', handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return
    const id = req.params.id
    await visible(req.actor, unit, id, 'delete')

    try {
      const open = await pool.query(
        `SELECT count(*)::int AS n FROM sdl_unit_work_tasks
          WHERE record_id::text=$1 AND status IN ('pending','received')`,
        [id],
      )
      if (open.rows[0].n > 0) {
        fail(res, 409, 'active_disposition')
        return
      }

      const outcome = await withTransaction(pool, async (client) => {
        if (unit === 'urmin') await lockOutgoingEditing(client, id)

        const archived = await client.query(
          'UPDATE sdl_unit_work_records SET deleted_at=now(),updated_by=$2::uuid,updated_at=now() WHERE id::text=$1 AND deleted_at IS NULL',
          [id, req.actor],
        )
        if (archived.rowCount !== 1) return 'already_removed'

        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,'deleted','Arsip soft-delete')`,
          [id, req.actor],
        )
        return 'ok'
      })

      if (outcome === 'already_removed') {
        fail(res, 409, 'already_removed')
        return
      }
      respond(res, 200, { ok: true })
    } catch (error) {
      if (error instanceof OutgoingLockedError) {
        fail(res, 409, 'outgoing_locked')
        return
      }
      sqlError(res, error)
    }
  }))

  // ---- POST /:unit/records/:id/files ----
  router.post('/:unit/records/:id/files', handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return
    const id = req.params.id
    await visible(req.actor, unit, id, 'upload')

    const upload = await readSingleFile(req, {
      fieldName: 'file',
      maxBodyBytes: BODY_LIMITS.UNIT_WORK_UPLOAD,
      maxFileBytes: MAX_FILE_BYTES,
    })
    if (upload.error === 'missing') {
      fail(res, 400, 'file_required_or_too_large')
      return
    }
    if (upload.error === 'too_large') {
      fail(res, 400, 'file_limit_5mib')
      return
    }

    // Tipe ditentukan dari magic bytes, bukan dari Content-Type kiriman klien.
    const media = detectFileType(upload.file.buffer)
    if (media === '') {
      fail(res, 400, 'unsupported_file_type')
      return
    }

    try {
      const count = await pool.query(
        'SELECT count(*)::int AS n FROM sdl_unit_work_files WHERE record_id::text=$1 AND removed_at IS NULL',
        [id],
      )
      if (count.rows[0].n >= MAX_FILES_PER_RECORD) {
        fail(res, 409, 'max_10_files')
        return
      }

      const name = safeName(upload.file.filename)
      const digest = createHash('sha256').update(upload.file.buffer).digest('hex')

      const fileId = await withTransaction(pool, async (client) => {
        if (unit === 'urmin') await lockOutgoingEditing(client, id)

        const { rows } = await client.query(
          `INSERT INTO sdl_unit_work_files(record_id,file_name,media_type,byte_size,sha256,file_data,uploaded_by)
           VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid) RETURNING id::text AS id`,
          [id, name, media, upload.file.buffer.length, digest, upload.file.buffer, req.actor],
        )
        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,'uploaded',$3)`,
          [id, req.actor, name],
        )
        return rows[0].id
      })
      respond(res, 201, { id: fileId })
    } catch (error) {
      if (error instanceof OutgoingLockedError) {
        fail(res, 409, 'outgoing_locked')
        return
      }
      sqlError(res, error)
    }
  }))

  // ---- GET /:unit/records/:id/files/:fileID ----
  router.get('/:unit/records/:id/files/:fileID', handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return
    const id = req.params.id
    await visible(req.actor, unit, id, 'read')

    let row
    try {
      const { rows } = await pool.query(
        `SELECT file_name,media_type,sha256,file_data FROM sdl_unit_work_files
          WHERE id::text=$1 AND record_id::text=$2 AND removed_at IS NULL`,
        [req.params.fileID, id],
      )
      if (rows.length === 0) throw new NotFoundError()
      row = rows[0]
    } catch (error) {
      sqlError(res, error)
      return
    }

    // Integritas diverifikasi SETIAP kali diunduh, bukan hanya saat diunggah.
    const digest = createHash('sha256').update(row.file_data).digest('hex')
    if (digest !== row.sha256) {
      fail(res, 503, 'integrity_mismatch')
      return
    }

    // PDF diunduh sebagai lampiran; gambar ditampilkan inline.
    const kind = row.media_type === 'application/pdf' ? 'attachment' : 'inline'
    res.set('Content-Disposition', contentDisposition(kind, row.file_name))
    res.set('Content-Type', row.media_type)
    res.set('Content-Length', String(row.file_data.length))
    res.set('Cache-Control', 'private, no-store')
    res.status(200).send(row.file_data)
  }))

  // ---- DELETE /:unit/records/:id/files/:fileID ----
  router.delete('/:unit/records/:id/files/:fileID', handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return
    const id = req.params.id
    await visible(req.actor, unit, id, 'edit')

    try {
      const outcome = await withTransaction(pool, async (client) => {
        if (unit === 'urmin') await lockOutgoingEditing(client, id)

        // Berkas hanya ditandai terhapus; datanya dipertahankan.
        const removed = await client.query(
          'UPDATE sdl_unit_work_files SET removed_at=now() WHERE id::text=$1 AND record_id::text=$2 AND removed_at IS NULL',
          [req.params.fileID, id],
        )
        if (removed.rowCount !== 1) return 'not_found'

        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,'file_removed','Lampiran dihapus dari tampilan')`,
          [id, req.actor],
        )
        return 'ok'
      })

      if (outcome === 'not_found') {
        fail(res, 404, 'not_found')
        return
      }
      respond(res, 200, { ok: true })
    } catch (error) {
      if (error instanceof OutgoingLockedError) {
        fail(res, 409, 'outgoing_locked')
        return
      }
      sqlError(res, error)
    }
  }))

  // ---- POST /:unit/records/:id/tasks ----
  router.post('/:unit/records/:id/tasks', json, handle(async (req, res) => {
    const unit = routeUnit(req, res)
    if (!unit) return
    const id = req.params.id
    const record = await visible(req.actor, unit, id, 'assign')

    const payload = parsePayload(req, ['to', 'instruction', 'dueDate'])
    if (!payload.ok) {
      fail(res, 400, 'invalid_input')
      return
    }
    const input = payload.value
    // Tidak ada yang bisa menugaskan dirinya sendiri.
    if (!lengthOk(input.instruction, 5, 1000) || input.to === req.actor) {
      fail(res, 400, 'invalid_assignment')
      return
    }

    const dueDate = input.dueDate ?? ''
    if (dueDate !== '' && !isIsoDate(dueDate)) {
      fail(res, 400, 'invalid_date')
      return
    }

    try {
      // Penerima harus anggota unit yang sama, aktif, bukan Superadmin, dan
      // batas klasifikasinya mencukupi untuk dokumen ini.
      const eligible = await pool.query(
        `SELECT EXISTS(SELECT 1 FROM sdl_users u
            JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2
            JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=$2
                 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
            JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
           WHERE u.id::text=$1 AND u.is_active AND NOT u.must_change_password
             AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr
                             WHERE sr.user_id=u.id AND sr.role_key='superadmin')
             AND (g.classification_limit='penting' OR $3='biasa')) AS ok`,
        [input.to, unit, record.classification],
      )
      if (!eligible.rows[0].ok) {
        fail(res, 403, 'recipient_not_allowed')
        return
      }

      const taskId = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO sdl_unit_work_tasks(record_id,from_user,to_user,instruction,due_date)
           VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5) RETURNING id::text AS id`,
          [id, req.actor, input.to, input.instruction.trim(), dueDate === '' ? null : dueDate],
        )
        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,task_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,$3::uuid,'assigned',$4)`,
          [id, rows[0].id, req.actor, input.instruction.trim()],
        )
        return rows[0].id
      })
      respond(res, 201, { id: taskId })
    } catch (error) {
      sqlError(res, error)
    }
  }))

  /**
   * Tiga transisi tugas berbagi satu implementasi, padanan taskAction(next).
   *
   * Aturan transisinya ketat dan terikat kepemilikan:
   *   received  : pending  -> penerima tugas
   *   completed : received -> penerima tugas, wajib disertai respons
   *   cancelled : pending/received -> pemberi tugas
   */
  function taskAction(nextStatus) {
    return handle(async (req, res) => {
      const unit = routeUnit(req, res)
      if (!unit) return
      const id = req.params.id
      await visible(req.actor, unit, id, 'read')

      const payload = parsePayload(req, ['response'])
      if (!payload.ok) {
        fail(res, 400, 'invalid_input')
        return
      }
      const response = typeof payload.value.response === 'string' ? payload.value.response : ''
      if ([...response].length > 1000) {
        fail(res, 400, 'invalid_response')
        return
      }
      if (nextStatus === 'completed' && !lengthOk(response, 3, 1000)) {
        fail(res, 400, 'response_required')
        return
      }

      // Superadmin tidak boleh menggerakkan tugas, bahkan di mode demo.
      try {
        if (await isDemoSuperadmin(pool, req.actor)) {
          fail(res, 403, 'access_denied')
          return
        }
      } catch {
        fail(res, 503, 'authorization_unavailable')
        return
      }

      try {
        const outcome = await withTransaction(pool, async (client) => {
          const { rows } = await client.query(
            `SELECT status,from_user::text AS from_user,to_user::text AS to_user
               FROM sdl_unit_work_tasks WHERE id::text=$1 AND record_id::text=$2 FOR UPDATE`,
            [req.params.taskID, id],
          )
          if (rows.length === 0) throw new NotFoundError()

          const { status, from_user: fromUser, to_user: toUser } = rows[0]
          const allowed =
            (nextStatus === 'received' && status === 'pending' && req.actor === toUser) ||
            (nextStatus === 'completed' && status === 'received' && req.actor === toUser) ||
            (nextStatus === 'cancelled' && (status === 'pending' || status === 'received') && req.actor === fromUser)
          if (!allowed) return 'invalid_task_transition'

          await client.query(
            'UPDATE sdl_unit_work_tasks SET status=$2,response=$3,updated_at=now() WHERE id::text=$1',
            [req.params.taskID, nextStatus, response.trim()],
          )
          await client.query(
            `INSERT INTO sdl_unit_work_events(record_id,task_id,actor_id,action,note)
             VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5)`,
            [id, req.params.taskID, req.actor, nextStatus, response.trim()],
          )
          return 'ok'
        })

        if (outcome === 'invalid_task_transition') {
          fail(res, 409, 'invalid_task_transition')
          return
        }
        respond(res, 200, { ok: true })
      } catch (error) {
        sqlError(res, error)
      }
    })
  }

  router.post('/:unit/records/:id/tasks/:taskID/receive', json, taskAction('received'))
  router.post('/:unit/records/:id/tasks/:taskID/complete', json, taskAction('completed'))
  router.post('/:unit/records/:id/tasks/:taskID/cancel', json, taskAction('cancelled'))

  return router
}

