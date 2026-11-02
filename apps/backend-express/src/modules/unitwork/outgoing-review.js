import { createHash } from 'node:crypto'

import { withTransaction } from '../../db.js'
import { parsePayload } from '../../http/payload.js'
import { marshalGoStruct } from './go-json.js'
import { permit } from './permit.js'
import { NotFoundError, fail, respond, sqlError } from './shared.js'

/**
 * Alur persetujuan surat keluar, port dari
 * apps/backend/internal/unitwork/outgoing_review.go.
 *
 * Persetujuan di sini adalah KEPUTUSAN MANAJERIAL YANG TERCATAT, bukan tanda
 * tangan elektronik. Tidak ada endpoint untuk menyetel "signed" atau "sent"
 * sampai hasil penandatanganan PSrE dan transport pengiriman terverifikasi
 * benar-benar terintegrasi. Itu sebabnya respons selalu memuat
 * signingAvailable: false dan emailDeliveryAvailable: false.
 *
 * Tahapan: draft -> submitted -> approved | rejected -> (submit ulang).
 */

const SUBMITTABLE_STAGES = new Set(['draft', 'rejected'])
const REVIEWABLE_STAGES = new Set(['submitted'])

const PAYLOAD_FIELDS = ['version', 'note']

/**
 * Hak menyetujui surat keluar: grant `br_kabagrenmin` ber-scope unit di urmin,
 * masih hidup, dengan permission `urmin.surat_keluar.approve`. Surat "penting"
 * menuntut grant yang batas klasifikasinya juga "penting".
 *
 * Sampai 2026-11-01 query padanannya di Go juga menuntut baris
 * `sdl_user_roles` — peran LANGSUNG — padahal tabel itu hanya pernah diisi
 * bootstrap Superadmin. Akibatnya fungsi ini false untuk siapa pun dan
 * endpoint approve/reject tidak terjangkau. Lihat B9 di DEVIATIONS.md;
 * diperbaiki di kedua backend bersamaan. `sdl_user_roles` tetap dibaca di
 * bawah, tapi hanya untuk apa yang memang jadi tugasnya: menolak Superadmin.
 */
async function canManageOutgoing(pool, actorId, classification) {
  const { rows } = await pool.query(
    `SELECT EXISTS(
       SELECT 1 FROM sdl_users u
         JOIN sdl_access_grants g ON g.user_id=u.id AND g.role_key='br_kabagrenmin'
         JOIN sdl_roles role ON role.role_key=g.role_key AND role.is_active
         JOIN sdl_role_permissions rp ON rp.role_key=g.role_key
              AND rp.permission_key='urmin.surat_keluar.approve'
         JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key='urmin'
        WHERE u.id::text=$1 AND u.is_active AND NOT u.must_change_password
          AND g.unit_key='urmin' AND g.scope='unit' AND g.revoked_at IS NULL
          AND (g.expires_at IS NULL OR g.expires_at>now())
          AND (g.classification_limit='penting' OR $2='biasa')
          AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr
                          WHERE sr.user_id=u.id AND sr.role_key='superadmin')) AS ok`,
    [actorId, classification],
  )
  return rows[0].ok
}

/**
 * Sidik jari dokumen, padanan outgoingContentHash (outgoing_review.go:291).
 *
 * Dihitung saat submit dan dibandingkan saat approve. Kalau isi surat atau
 * daftar berkasnya berubah di antara keduanya, persetujuan ditolak dengan
 * 409 document_integrity_changed — supaya yang disetujui benar-benar dokumen
 * yang ditinjau.
 *
 * Serialisasinya WAJIB memakai marshalGoStruct, bukan JSON.stringify: Go
 * mengurutkan kunci map dan meng-escape <, >, &. Lihat go-json.js, dan
 * `npm run verify:gojson` yang membuktikan paritasnya.
 */
async function contentHash(client, registerId, workRecordId) {
  const registry = await client.query(
    'SELECT ref_code,title,fields FROM sdl_urmin_registry WHERE id::text=$1 AND deleted_at IS NULL',
    [registerId],
  )
  if (registry.rows.length === 0) throw new NotFoundError()
  const { ref_code: code, title, fields } = registry.rows[0]

  const files = await client.query(
    'SELECT id::text AS id,sha256 FROM sdl_unit_work_files WHERE record_id::text=$1 AND removed_at IS NULL ORDER BY id',
    [workRecordId],
  )

  // Urutan field mengikuti deklarasi struct di Go: code, title, fields, files.
  const payload = marshalGoStruct([
    ['code', code],
    ['title', title],
    ['fields', fields],
    ['files', files.rows.map((row) => ({ id: row.id, sha256: row.sha256 }))],
  ])

  return createHash('sha256').update(payload, 'utf8').digest('hex')
}

function parseDecisionPayload(req) {
  const payload = parsePayload(req, PAYLOAD_FIELDS)
  if (!payload.ok) return undefined
  const version = payload.value.version
  const note = typeof payload.value.note === 'string' ? payload.value.note : ''
  if (!Number.isInteger(version) || version < 1) return undefined
  return { version, note: note.trim() }
}

/**
 * Mendaftarkan 4 endpoint workflow ke router registry Urmin.
 * Dipanggil SEBELUM '/:id' polos supaya Express mencocokkan segmen statisnya.
 */
export function registerOutgoingRoutes(router, { pool, json, handle, loadOwned }) {
  /** Semua endpoint di sini hanya berlaku untuk surat keluar. */
  async function loadOutgoing(actorId, id, action) {
    const record = await loadOwned(actorId, id, action)
    if (record.kind !== 'surat_keluar') throw new NotFoundError()
    return record
  }

  // ---- GET /:id/workflow ----
  router.get('/:id/workflow', handle(async (req, res) => {
    const id = req.params.id
    const record = await loadOutgoing(req.actor, id, 'read')

    let stage
    let version
    try {
      const { rows } = await pool.query(
        'SELECT stage,version FROM sdl_outgoing_workflows WHERE register_id::text=$1',
        [id],
      )
      if (rows.length === 0) throw new NotFoundError()
      stage = rows[0].stage
      version = Number(rows[0].version)
    } catch (error) {
      sqlError(res, error)
      return
    }

    let canApprove
    let canEdit
    try {
      canApprove = await canManageOutgoing(pool, req.actor, record.classification)
      canEdit = await permit(pool, req.actor, {
        unit: 'urmin',
        classification: record.classification,
        owner: record.owner,
        recordId: record.workRecordId,
        action: 'edit',
      })
    } catch {
      fail(res, 503, 'authorization_unavailable')
      return
    }

    let events
    try {
      const { rows } = await pool.query(
        `SELECT e.id::text AS id,e.event_key,u.display_name,e.note,e.created_at
           FROM sdl_outgoing_events e
           JOIN sdl_users u ON u.id=e.actor_id
          WHERE e.register_id::text=$1
          ORDER BY e.created_at DESC,e.id DESC LIMIT 100`,
        [id],
      )
      events = rows.map((row) => ({
        id: row.id,
        action: row.event_key,
        actor: row.display_name,
        note: row.note,
        at: row.created_at,
      }))
    } catch (error) {
      sqlError(res, error)
      return
    }

    respond(res, 200, {
      status: stage,
      version,
      canSubmit: canEdit && SUBMITTABLE_STAGES.has(stage),
      canReview: canApprove && REVIEWABLE_STAGES.has(stage),
      events,
      // Keduanya tetap false sampai PSrE dan transport pengiriman terintegrasi.
      signingAvailable: false,
      emailDeliveryAvailable: false,
    })
  }))

  // ---- POST /:id/submit ----
  router.post('/:id/submit', json, handle(async (req, res) => {
    const id = req.params.id
    const record = await loadOutgoing(req.actor, id, 'edit')

    const input = parseDecisionPayload(req)
    if (!input || [...input.note].length > 500) {
      fail(res, 400, 'invalid_input')
      return
    }

    try {
      const outcome = await withTransaction(pool, async (client) => {
        // Semua penulis berkas mengunci baris work yang sama, sehingga submit
        // dan perubahan berkas terserialkan.
        const locked = await client.query(
          'SELECT id::text AS id FROM sdl_unit_work_records WHERE id::text=$1 AND deleted_at IS NULL FOR UPDATE',
          [record.workRecordId],
        )
        if (locked.rows.length === 0) throw new NotFoundError()

        const recipient = await client.query(
          "SELECT COALESCE(fields->>'tujuan','') AS tujuan FROM sdl_urmin_registry WHERE id::text=$1 AND deleted_at IS NULL",
          [id],
        )
        if (recipient.rows.length === 0) throw new NotFoundError()
        if (recipient.rows[0].tujuan.trim() === '') return { kind: 'recipient_required' }

        const workflow = await client.query(
          'SELECT stage,version FROM sdl_outgoing_workflows WHERE register_id::text=$1 FOR UPDATE',
          [id],
        )
        if (workflow.rows.length === 0) throw new NotFoundError()

        const stage = workflow.rows[0].stage
        const version = Number(workflow.rows[0].version)
        if (version !== input.version || !SUBMITTABLE_STAGES.has(stage)) {
          return { kind: 'workflow_state_changed' }
        }

        // Surat keluar tidak boleh disubmit tanpa lampiran PDF.
        const pdf = await client.query(
          `SELECT count(*)::int AS n FROM sdl_unit_work_files
            WHERE record_id::text=$1 AND removed_at IS NULL AND media_type='application/pdf'`,
          [record.workRecordId],
        )
        if (pdf.rows[0].n === 0) return { kind: 'pdf_required_before_submit' }

        const hash = await contentHash(client, id, record.workRecordId)
        await client.query(
          `UPDATE sdl_outgoing_workflows
              SET stage='submitted',version=version+1,content_sha256=$4,submitted_at=now(),
                  approved_at=NULL,last_actor=$2::uuid,last_note=$3,updated_at=now()
            WHERE register_id::text=$1`,
          [id, req.actor, input.note, hash],
        )
        await client.query(
          `INSERT INTO sdl_outgoing_events(register_id,actor_id,event_key,note)
           VALUES($1::uuid,$2::uuid,'submitted',$3)`,
          [id, req.actor, input.note],
        )
        return { kind: 'ok' }
      })

      const conflicts = {
        recipient_required: 'recipient_required',
        workflow_state_changed: 'workflow_state_changed',
        pdf_required_before_submit: 'pdf_required_before_submit',
      }
      if (conflicts[outcome.kind]) {
        fail(res, 409, conflicts[outcome.kind])
        return
      }
      respond(res, 200, { ok: true, status: 'submitted' })
    } catch (error) {
      sqlError(res, error)
    }
  }))

  /** POST /:id/approve dan /:id/reject berbagi satu implementasi. */
  function decision(approved) {
    return handle(async (req, res) => {
      const id = req.params.id
      const record = await loadOutgoing(req.actor, id, 'read')

      let authorized
      try {
        authorized = await canManageOutgoing(pool, req.actor, record.classification)
      } catch {
        fail(res, 503, 'authorization_unavailable')
        return
      }
      if (!authorized) {
        fail(res, 403, 'access_denied')
        return
      }

      const input = parseDecisionPayload(req)
      // Penolakan WAJIB disertai alasan minimal 8 karakter; persetujuan tidak.
      if (!input || [...input.note].length > 500 || (!approved && [...input.note].length < 8)) {
        fail(res, 400, 'invalid_input')
        return
      }

      const nextStage = approved ? 'approved' : 'rejected'

      try {
        const outcome = await withTransaction(pool, async (client) => {
          const locked = await client.query(
            'SELECT id::text AS id FROM sdl_unit_work_records WHERE id::text=$1 AND deleted_at IS NULL FOR UPDATE',
            [record.workRecordId],
          )
          if (locked.rows.length === 0) throw new NotFoundError()

          const workflow = await client.query(
            `SELECT stage,version,COALESCE(content_sha256,'') AS content_sha256
               FROM sdl_outgoing_workflows WHERE register_id::text=$1 FOR UPDATE`,
            [id],
          )
          if (workflow.rows.length === 0) return { kind: 'not_found' }

          const { stage, content_sha256: storedHash } = workflow.rows[0]
          const version = Number(workflow.rows[0].version)
          if (!REVIEWABLE_STAGES.has(stage) || version !== input.version) {
            return { kind: 'workflow_state_changed' }
          }

          // Yang disetujui harus dokumen yang sama dengan yang ditinjau.
          const currentHash = await contentHash(client, id, record.workRecordId)
          if (currentHash !== storedHash) return { kind: 'document_integrity_changed' }

          // Kedua pemakaian $2 WAJIB di-cast seragam — lihat komentar padanannya
          // di outgoing_review.go:255. Tanpa cast, Postgres mendeduksi varchar
          // dari `stage=$2` dan text dari perbandingan di dalam CASE, lalu
          // menolak statement-nya dengan "inconsistent types deduced for
          // parameter $2". Keduanya diperbaiki bersamaan supaya paritas tetap
          // utuh; golden 50/51 direkam ulang pada perubahan yang sama.
          await client.query(
            `UPDATE sdl_outgoing_workflows
                SET stage=$2::varchar,version=version+1,
                    approved_at=CASE WHEN $2::varchar='approved' THEN now() ELSE NULL END,
                    last_actor=$3::uuid,last_note=$4,updated_at=now()
              WHERE register_id::text=$1`,
            [id, nextStage, req.actor, input.note],
          )
          await client.query(
            `INSERT INTO sdl_outgoing_events(register_id,actor_id,event_key,note)
             VALUES($1::uuid,$2::uuid,$3,$4)`,
            [id, req.actor, nextStage, input.note],
          )
          return { kind: 'ok' }
        })

        if (outcome.kind === 'not_found') {
          fail(res, 404, 'not_found')
          return
        }
        if (outcome.kind === 'workflow_state_changed') {
          fail(res, 409, 'workflow_state_changed')
          return
        }
        if (outcome.kind === 'document_integrity_changed') {
          fail(res, 409, 'document_integrity_changed')
          return
        }
        respond(res, 200, { ok: true, status: nextStage })
      } catch (error) {
        sqlError(res, error)
      }
    })
  }

  router.post('/:id/approve', json, decision(true))
  router.post('/:id/reject', json, decision(false))
}
