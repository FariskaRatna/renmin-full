import { Router } from 'express'

import { isUniqueViolation, withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { permit } from './permit.js'
import { registerOutgoingRoutes } from './outgoing-review.js'
import {
  AccessDeniedError,
  NotFoundError,
  OutgoingLockedError,
  VALID_CLASSIFICATIONS,
  fail,
  isIsoDate,
  isTimeOfDay,
  lengthOk,
  lockOutgoingEditing,
  respond,
  sqlError,
} from './shared.js'

/**
 * Registry Urmin (surat keluar, agenda, arsip), port dari
 * apps/backend/internal/unitwork/urmin_register.go.
 *
 * SENGAJA tidak memakai registry-crud.js yang dipakai Sumda dan Binfung.
 * Modul ini punya siklus hidup workflow yang mereka tidak punya: pembuatan
 * baris sdl_outgoing_workflows, kolom status hasil LEFT JOIN, validasi
 * statusAdministrasi, dan penguncian penyuntingan begitu surat disubmit.
 * Menjejalkan empat kait itu ke factory bersama membuat factory-nya lebih
 * sulit dibaca daripada manfaat yang didapat.
 */

const UNIT = 'urmin'

const FIELDS_BY_KIND = Object.freeze({
  surat_keluar: ['nomorSurat', 'tujuan', 'tanggalSurat', 'perihal', 'sifatSurat', 'statusAdministrasi', 'keterangan'],
  // R5G4 menambah 'pimpinan' dan BERHENTI menampilkan jenisAgenda, hasil, dan
  // statusAgenda di UI. Ketiganya sengaja TETAP di sini: daftar ini allowlist,
  // dan payload yang memuat kunci di luarnya ditolak. Mencabutnya akan membuat
  // setiap agenda LAMA gagal disunting dengan 400, karena form mengirim balik
  // kunci yang sudah tersimpan di JSONB-nya.
  agenda: ['jenisAgenda', 'tanggal', 'waktu', 'lokasi', 'penyelenggara', 'peserta', 'hasil', 'statusAgenda', 'pimpinan', 'yangMenghadiri'],
  arsip: ['jenisArsip', 'tanggalDokumen', 'lokasiSimpan', 'retensi', 'penanggungJawab', 'statusArsip', 'keterangan'],
})

const DATE_FIELDS = new Set(['tanggalSurat', 'tanggal', 'tanggalDokumen'])
const PAYLOAD_FIELDS = ['kind', 'code', 'title', 'classification', 'fields', 'version']

/** Status workflow diambil lewat LEFT JOIN; tanpa baris workflow nilainya 'draft'. */
const SELECT = `
  SELECT s.id::text AS id,s.kind,s.ref_code,s.title,w.classification,s.fields,
         s.work_record_id::text AS work_record_id,w.created_by::text AS owner,
         s.version,s.created_at,COALESCE(o.stage,'draft') AS workflow_status
    FROM sdl_urmin_registry s
    JOIN sdl_unit_work_records w ON w.id=s.work_record_id
    LEFT JOIN sdl_outgoing_workflows o ON o.register_id=s.id`

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
    workflowStatus: row.workflow_status,
  }
}

/** Padanan urminregisterValid (urmin_register.go:45). */
function validInput(input) {
  const allowed = FIELDS_BY_KIND[input.kind]
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
    if (DATE_FIELDS.has(key) && value !== '' && !isIsoDate(value)) return false
    if (key === 'waktu' && value !== '' && !isTimeOfDay(value)) return false
  }
  return true
}

/**
 * Status administrasi surat keluar hanya boleh kosong atau "Draft" lewat jalur
 * CRUD. Status lanjutan ditentukan oleh workflow persetujuan, bukan oleh
 * pengisian field bebas.
 */
function administrativeStatusAllowed(input) {
  if (input.kind !== 'surat_keluar') return true
  const status = input.fields?.statusAdministrasi ?? ''
  return status === '' || status === 'Draft'
}

export function createUrminRegisterRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.UNIT_WORK)

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      if (error instanceof AccessDeniedError) {
        fail(res, 403, 'access_denied')
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

  async function loadOwned(actorId, id, action) {
    const { rows } = await pool.query(
      `${SELECT} WHERE s.id::text=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL
                   AND w.unit_key='${UNIT}'`,
      [id],
    )
    if (rows.length === 0) throw new NotFoundError()

    const record = toRow(rows[0])
    const allowed = await permit(pool, actorId, {
      unit: UNIT,
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

  // Rute workflow didaftarkan lebih dulu. Semuanya memakai segmen statis
  // setelah /:id, jadi Express mencocokkannya sebelum '/:id' polos.
  registerOutgoingRoutes(router, { pool, json, handle, loadOwned })

  // ---- GET / ----
  router.get('/', handle(async (req, res) => {
    const kind = req.query.kind ?? ''
    if (!FIELDS_BY_KIND[kind]) {
      fail(res, 400, 'invalid_kind')
      return
    }
    const search = String(req.query.q ?? '').trim()
    if ([...search].length > 100) {
      fail(res, 400, 'invalid_search')
      return
    }
    // R5G7: arsip terbagi dua — yang diinput manual, dan yang lahir dari
    // pengarsipan disposisi (endpoint 143). Pembedanya `fields->>'sumber'`,
    // yang hanya ditulis oleh endpoint 143.
    //
    // Disaring di SQL, bukan sesudahnya: daftar ini memotong di 100 baris
    // SETELAH penyaringan izin, jadi arsip manual bisa terdorong keluar jendela
    // begitu entri disposisi menumpuk. Menyaring di sini membuat tiap kategori
    // punya 100 barisnya sendiri.
    //
    // Entri lama tidak punya kunci 'sumber' sama sekali, dan IS DISTINCT FROM
    // memperlakukan NULL itu sebagai manual — tanpa backfill apa pun.
    const source = String(req.query.source ?? '').trim()
    if (source !== '' && source !== 'manual' && source !== 'disposisi') {
      fail(res, 400, 'invalid_source')
      return
    }

    let rows
    try {
      const result = await pool.query(
        `${SELECT} WHERE s.kind=$1 AND s.deleted_at IS NULL AND w.deleted_at IS NULL
                     AND w.unit_key='${UNIT}'
                     AND ($2='' OR s.title ILIKE '%'||$2||'%' OR s.ref_code ILIKE '%'||$2||'%')
                     AND ($3='' OR ($3='disposisi') = (s.fields->>'sumber' IS NOT DISTINCT FROM 'disposisi'))
                   ORDER BY s.created_at DESC,s.id DESC LIMIT 251`,
        [kind, search, source],
      )
      rows = result.rows
    } catch (error) {
      sqlError(res, error)
      return
    }

    const items = []
    let limited = false
    try {
      for (const row of rows) {
        const record = toRow(row)
        const allowed = await permit(pool, req.actor, {
          unit: UNIT,
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
    if (!validInput(input) || !administrativeStatusAllowed(input)) {
      fail(res, 400, 'invalid_urminregister_record')
      return
    }

    let allowed
    try {
      allowed = await permit(pool, req.actor, {
        unit: UNIT,
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
           VALUES('${UNIT}',$1,$2,'',$3,$4::uuid,$4::uuid) RETURNING id::text AS id`,
          [`Register Urmin ${input.kind}`, input.title.trim(), input.classification, req.actor],
        )
        const workId = work.rows[0].id

        const registry = await client.query(
          `INSERT INTO sdl_urmin_registry(kind,ref_code,title,fields,work_record_id,created_by,updated_by)
           VALUES($1,$2,$3,$4::jsonb,$5::uuid,$6::uuid,$6::uuid) RETURNING id::text AS id`,
          [input.kind, input.code.trim(), input.title.trim(), JSON.stringify(input.fields), workId, req.actor],
        )
        const id = registry.rows[0].id

        // Hanya surat keluar yang punya siklus persetujuan.
        if (input.kind === 'surat_keluar') {
          await client.query('INSERT INTO sdl_outgoing_workflows(register_id) VALUES($1::uuid)', [id])
        }

        await client.query(
          `INSERT INTO sdl_unit_work_events(record_id,actor_id,action,note)
           VALUES($1::uuid,$2::uuid,'created',$3)`,
          [workId, req.actor, `Register Urmin: ${input.kind}`],
        )
        return { id, workRecordId: workId }
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
    if (
      !validInput(input) ||
      input.kind !== record.kind ||
      !Number.isInteger(input.version) || input.version < 1 ||
      !administrativeStatusAllowed(input)
    ) {
      fail(res, 400, 'invalid_urminregister_record')
      return
    }

    let allowed
    try {
      allowed = await permit(pool, req.actor, {
        unit: UNIT,
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
        // Surat yang sudah disubmit atau disetujui tidak boleh diubah lagi.
        if (input.kind === 'surat_keluar') {
          await lockOutgoingEditing(client, record.workRecordId)
        }

        const updated = await client.query(
          `UPDATE sdl_urmin_registry
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
           VALUES($1::uuid,$2::uuid,'updated','Register Urmin diperbarui')`,
          [record.workRecordId, req.actor],
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
      writeError(res, error)
    }
  }))

  // ---- DELETE /:id ----
  router.delete('/:id', handle(async (req, res) => {
    const id = req.params.id
    const record = await loadOwned(req.actor, id, 'delete')

    try {
      const outcome = await withTransaction(pool, async (client) => {
        if (record.kind === 'surat_keluar') {
          await lockOutgoingEditing(client, record.workRecordId)
        }

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
          `UPDATE sdl_urmin_registry SET deleted_at=now(),updated_by=$2::uuid,updated_at=now()
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
           VALUES($1::uuid,$2::uuid,'deleted','Register Urmin diarsipkan')`,
          [record.workRecordId, req.actor],
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
      if (error instanceof OutgoingLockedError) {
        fail(res, 409, 'outgoing_locked')
        return
      }
      sqlError(res, error)
    }
  }))

  return router
}
