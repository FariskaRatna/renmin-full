import { Router } from 'express'

import { isUniqueViolation, withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { permit } from './permit.js'
import {
  AccessDeniedError,
  NotFoundError,
  VALID_CLASSIFICATIONS,
  fail,
  isIsoDate,
  lengthOk,
  respond,
  sqlError,
} from './shared.js'

/**
 * CRUD registry master yang dipakai bersama oleh Subbagsumda dan Subbagbinfung.
 * Port dari apps/backend/internal/unitwork/sumda.go dan binfung.go, yang di Go
 * merupakan dua berkas hampir identik.
 *
 * Yang benar-benar berbeda antara keduanya hanya: nama tabel, unit, peta field
 * per jenis, aturan validasi tambahan, teks catatan peristiwa, dan kode error.
 * Semuanya dijadikan parameter di bawah, sehingga perbedaannya terbaca sebagai
 * data — bukan tersebar sebagai dua salinan logika yang harus dijaga sinkron.
 *
 * Setiap baris registry berpasangan dengan satu baris sdl_unit_work_records
 * yang memegang klasifikasi dan kepemilikan. Otorisasi SELALU dibaca dari baris
 * pasangan itu, tidak pernah dari registry-nya sendiri.
 */

const PAYLOAD_FIELDS = ['kind', 'code', 'title', 'classification', 'fields', 'version']

/**
 * @param {object} spec
 * @param {string} spec.unit             kunci unit, mis. 'subbagsumda'
 * @param {string} spec.table            tabel registry
 * @param {object} spec.fieldsByKind     jenis -> daftar field yang diizinkan
 * @param {string} spec.invalidRecordCode kode error validasi, mis. 'invalid_sumda_record'
 * @param {string} spec.noteLabel        label catatan peristiwa, mis. 'Master Subbagsumda'
 * @param {(fields: object, kind: string) => boolean} [spec.extraValidation]
 * @param {(pool, input) => Promise<string|undefined>} [spec.extraCheck]
 *        pemeriksaan tambahan yang butuh database; mengembalikan kode error
 *        kalau gagal, atau undefined kalau lolos
 */
export function createRegistryCrudRouter({ pool, spec }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.UNIT_WORK)

  const SELECT = `
    SELECT s.id::text AS id,s.kind,s.ref_code,s.title,w.classification,s.fields,
           s.work_record_id::text AS work_record_id,w.created_by::text AS owner,
           s.version,s.created_at
      FROM ${spec.table} s
      JOIN sdl_unit_work_records w ON w.id=s.work_record_id`

  function toRow(row) {
    return {
      id: row.id,
      kind: row.kind,
      code: row.ref_code,
      title: row.title,
      classification: row.classification,
      fields: row.fields,
      workRecordId: row.work_record_id,
      owner: row.owner,
      version: Number(row.version),
      createdAt: row.created_at,
    }
  }

  function validInput(input) {
    const allowed = spec.fieldsByKind[input.kind]
    if (!allowed) return false
    if (!lengthOk(input.code, 2, 64) || !lengthOk(input.title, 3, 200)) return false
    if (!VALID_CLASSIFICATIONS.has(input.classification)) return false

    const fields = input.fields
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return false
    const keys = Object.keys(fields)
    if (keys.length > allowed.length) return false

    for (const key of keys) {
      if (!allowed.includes(key)) return false
      const value = fields[key]
      if (typeof value !== 'string') return false
      if ([...value.trim()].length > 200) return false
      if (spec.dateFields.has(key) && value !== '' && !isIsoDate(value)) return false
      if (spec.numericFields.has(key) && value !== '' && !spec.isValidNumber(value)) return false
    }

    return spec.extraValidation ? spec.extraValidation(fields, input.kind) : true
  }

  async function loadOwned(actorId, id, action) {
    const { rows } = await pool.query(
      `${SELECT} WHERE s.id::text=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL
                   AND w.unit_key=$2`,
      [id, spec.unit],
    )
    if (rows.length === 0) throw new NotFoundError()

    const record = toRow(rows[0])
    const allowed = await permit(pool, actorId, {
      unit: spec.unit,
      classification: record.classification,
      owner: record.owner,
      recordId: record.workRecordId,
      action,
    })
    if (!allowed) throw new AccessDeniedError()
    return record
  }

  function writeError(res, error) {
    if (isUniqueViolation(error)) {
      fail(res, 409, 'duplicate_code')
      return
    }
    sqlError(res, error)
  }

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        fail(res, 403, 'access_denied')
        return
      }
      if (error instanceof NotFoundError) {
        sqlError(res, error)
        return
      }
      next(error)
    }
  }

  // Rute tambahan khusus modul (mis. /ranks) WAJIB didaftarkan sebelum '/:id',
  // kalau tidak Express akan menangkapnya sebagai id.
  if (spec.extraRoutes) spec.extraRoutes(router, { pool, handle, respond, fail, sqlError })

  // ---- GET / ----
  router.get('/', handle(async (req, res) => {
    const kind = req.query.kind ?? ''
    if (!spec.fieldsByKind[kind]) {
      fail(res, 400, 'invalid_kind')
      return
    }
    const search = String(req.query.q ?? '').trim()
    if ([...search].length > 100) {
      fail(res, 400, 'invalid_search')
      return
    }

    let rows
    try {
      const result = await pool.query(
        `${SELECT} WHERE s.kind=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL
                     AND w.unit_key=$3
                     AND ($2='' OR s.title ILIKE '%'||$2||'%' OR s.ref_code ILIKE '%'||$2||'%')
                   ORDER BY s.created_at DESC,s.id DESC LIMIT 251`,
        [kind, search, spec.unit],
      )
      rows = result.rows
    } catch (error) {
      sqlError(res, error)
      return
    }

    // Otorisasi disaring PER BARIS, bukan di SQL. Lambat, tapi disengaja:
    // keputusan scope dan klasifikasi tidak bisa dinyatakan sebagai satu
    // predikat SQL tanpa menggeser semantiknya.
    const items = []
    let limited = false
    try {
      for (const row of rows) {
        const record = toRow(row)
        const allowed = await permit(pool, req.actor, {
          unit: spec.unit,
          classification: record.classification,
          owner: record.owner,
          recordId: record.workRecordId,
          action: 'read',
        })
        if (!allowed) continue
        if (items.length < 100) items.push(record)
        else limited = true
      }
    } catch (error) {
      sqlError(res, error)
      return
    }

    respond(res, 200, { items, limited })
  }))

  // ---- POST / ----
  router.post('/', json, handle(async (req, res) => {
    const payload = parsePayload(req, PAYLOAD_FIELDS)
    if (!payload.ok) {
      fail(res, 400, 'invalid_input')
      return
    }
    const input = payload.value
    if (!validInput(input)) {
      fail(res, 400, spec.invalidRecordCode)
      return
    }

    if (spec.extraCheck) {
      let code
      try {
        code = await spec.extraCheck(pool, input)
      } catch (error) {
        sqlError(res, error)
        return
      }
      if (code) {
        fail(res, 400, code)
        return
      }
    }

    let allowed
    try {
      allowed = await permit(pool, req.actor, {
        unit: spec.unit,
        classification: input.classification,
        owner: req.actor,
        recordId: '',
        action: 'create',
      })
    } catch (error) {
      sqlError(res, error)
      return
    }
    if (!allowed) {
      fail(res, 403, 'access_denied')
      return
    }

    try {
      const created = await withTransaction(pool, async (client) => {
        const work = await client.query(
          `INSERT INTO sdl_unit_work_records(unit_key,category,title,description,classification,created_by,updated_by)
           VALUES($5,$1,$2,'',$3,$4::uuid,$4::uuid) RETURNING id::text AS id`,
          [`Master ${input.kind}`, input.title.trim(), input.classification, req.actor, spec.unit],
        )
        const workId = work.rows[0].id

        const registry = await client.query(
          `INSERT INTO ${spec.table}(kind,ref_code,title,fields,work_record_id,created_by,updated_by)
           VALUES($1,$2,$3,$4::jsonb,$5::uuid,$6::uuid,$6::uuid) RETURNING id::text AS id`,
          [input.kind, input.code.trim(), input.title.trim(), JSON.stringify(input.fields), workId, req.actor],
        )

        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,'created',$3)`,
          [workId, req.actor, `${spec.noteLabel}: ${input.kind}`],
        )
        return { id: registry.rows[0].id, workRecordId: workId }
      })
      respond(res, 201, created)
    } catch (error) {
      writeError(res, error)
    }
  }))

  // ---- GET /:id ----
  router.get('/:id', handle(async (req, res) => {
    respond(res, 200, await loadOwned(req.actor, req.params.id, 'read'))
  }))

  // ---- PATCH /:id ----
  router.patch('/:id', json, handle(async (req, res) => {
    const id = req.params.id
    const record = await loadOwned(req.actor, id, 'edit')

    const payload = parsePayload(req, PAYLOAD_FIELDS)
    if (!payload.ok) {
      fail(res, 400, 'invalid_input')
      return
    }
    const input = payload.value
    if (!validInput(input) || input.kind !== record.kind || !Number.isInteger(input.version) || input.version < 1) {
      fail(res, 400, spec.invalidRecordCode)
      return
    }

    if (spec.extraCheck) {
      let code
      try {
        code = await spec.extraCheck(pool, input)
      } catch (error) {
        sqlError(res, error)
        return
      }
      if (code) {
        fail(res, 400, code)
        return
      }
    }

    // Diperiksa ULANG dengan klasifikasi BARU: menaikkan klasifikasi dokumen
    // menuntut hak atas klasifikasi itu, bukan atas yang lama.
    let allowed
    try {
      allowed = await permit(pool, req.actor, {
        unit: spec.unit,
        classification: input.classification,
        owner: record.owner,
        recordId: record.workRecordId,
        action: 'edit',
      })
    } catch (error) {
      sqlError(res, error)
      return
    }
    if (!allowed) {
      fail(res, 403, 'access_denied')
      return
    }

    try {
      const outcome = await withTransaction(pool, async (client) => {
        const updated = await client.query(
          `UPDATE ${spec.table}
              SET ref_code=$3,title=$4,fields=$5::jsonb,version=version+1,updated_by=$6::uuid,updated_at=now()
            WHERE id::text=$1 AND kind=$2 AND deleted_at IS NULL AND version=$7`,
          [id, input.kind, input.code.trim(), input.title.trim(), JSON.stringify(input.fields), req.actor, input.version],
        )
        if (updated.rowCount !== 1) return 'stale_version'

        await client.query(
          `UPDATE sdl_unit_work_records
              SET title=$2,classification=$3,updated_by=$4::uuid,version=version+1,updated_at=now()
            WHERE id::text=$1 AND deleted_at IS NULL`,
          [record.workRecordId, input.title.trim(), input.classification, req.actor],
        )
        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,'updated',$3)`,
          [record.workRecordId, req.actor, `${spec.noteLabel} diperbarui`],
        )
        return 'ok'
      })

      if (outcome === 'stale_version') {
        fail(res, 409, 'stale_version')
        return
      }
      respond(res, 200, { ok: true })
    } catch (error) {
      writeError(res, error)
    }
  }))

  // ---- DELETE /:id ----
  router.delete('/:id', handle(async (req, res) => {
    const id = req.params.id
    const record = await loadOwned(req.actor, id, 'delete')

    try {
      const outcome = await withTransaction(pool, async (client) => {
        // Dikunci lewat baris work-record induk untuk menyerialkan terhadap
        // pembuatan dan transisi tugas yang berjalan bersamaan.
        const locked = await client.query(
          'SELECT id::text AS id FROM sdl_unit_work_records WHERE id::text=$1 AND deleted_at IS NULL FOR UPDATE',
          [record.workRecordId],
        )
        if (locked.rows.length === 0) throw new NotFoundError()

        const active = await client.query(
          `SELECT EXISTS(SELECT 1 FROM sdl_unit_work_tasks
                          WHERE record_id::text=$1 AND status IN ('pending','received')) AS ok`,
          [locked.rows[0].id],
        )
        if (active.rows[0].ok) return 'active_disposition'

        const archived = await client.query(
          `UPDATE ${spec.table} SET deleted_at=now(),updated_by=$2::uuid,updated_at=now()
            WHERE id::text=$1 AND deleted_at IS NULL`,
          [id, req.actor],
        )
        if (archived.rowCount !== 1) return 'already_removed'

        await client.query(
          'UPDATE sdl_unit_work_records SET deleted_at=now(),updated_by=$2::uuid,updated_at=now() WHERE id::text=$1',
          [record.workRecordId, req.actor],
        )
        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,'deleted',$3)`,
          [record.workRecordId, req.actor, `${spec.noteLabel} diarsipkan`],
        )
        return 'ok'
      })

      if (outcome === 'active_disposition') {
        fail(res, 409, 'active_disposition')
        return
      }
      if (outcome === 'already_removed') {
        fail(res, 409, 'already_removed')
        return
      }
      respond(res, 200, { ok: true })
    } catch (error) {
      sqlError(res, error)
    }
  }))

  return router
}
