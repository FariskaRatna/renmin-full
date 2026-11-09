import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import {
  audit,
  AuthzUnavailable,
  createDecision,
  decodeTyped,
  DELIVERY_SELECT,
  enqueueUrminEmail,
  fail,
  loadIncoming,
  mapDelivery,
  mapRecipient,
  recipientEligible,
  respond,
  UUID_RE,
  validDate,
  validReason,
  validText,
} from './shared.js'
import { currentIssuer, dispositionEligible } from './tasks.js'

/**
 * Kotak masuk distribusi, port dari bagian inbox r3b.go (574–730) dan dua
 * handler penerbitan disposisi di r3c.go (202–360).
 *
 * Mount ini adalah ENGSEL antara surat masuk dan disposisi: sebuah distribusi
 * harus berstatus `received` sebelum penerimanya boleh menerbitkan disposisi
 * apa pun. Itu bukan sekadar urutan UI — `currentIssuer()` benar-benar
 * memeriksanya, dan seluruh rantai disposisi berjenjang nanti bersandar pada
 * pemeriksaan yang sama.
 *
 * Otorisasinya BUKAN Engine A untuk penerima. Hak baca di sini lahir dari
 * relasi distribusi (`recipientEligible`), bukan dari hak baca atas register
 * surat Urmin. Seorang operator Subbagren boleh membaca surat yang
 * didistribusikan kepadanya tanpa pernah boleh membuka register Urmin.
 */

const RECEIVE_SCHEMA = { reason: 'string' }

const DISPOSITION_SCHEMA = { assigneeId: 'string', instruction: 'string', dueDate: 'string' }

/**
 * Padanan validDispositionDue (r3c.go:261): tanggal sah, tidak di masa lalu,
 * dan tidak lebih dari satu tahun ke depan. Dihitung terhadap HARI INI UTC.
 */
function validDispositionDue(value) {
  if (!validDate(value)) return false
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const due = new Date(`${value}T00:00:00Z`).getTime()
  if (due < todayUtc) return false
  const limit = new Date(todayUtc)
  limit.setUTCFullYear(limit.getUTCFullYear() + 1)
  return due <= limit.getTime()
}

export function createDistributionInboxRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.URMIN_INCOMING)
  const decision = createDecision(pool)

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      if (error instanceof AuthzUnavailable) {
        fail(res, 503, 'authorization_unavailable')
        return
      }
      next(error)
    }
  }

  // ---- 111. GET / ----
  router.get('/', handle(async (req, res) => {
    let rows
    try {
      ;({ rows } = await pool.query(
        `${DELIVERY_SELECT} WHERE d.recipient_user=$1 ORDER BY d.sent_at DESC,d.id DESC LIMIT 100`,
        [req.actor],
      ))
    } catch {
      fail(res, 503, 'unavailable')
      return
    }

    // Kelayakan diperiksa ULANG per baris, bukan sekali di awal: grant bisa
    // dicabut setelah distribusinya terkirim, dan surat yang sudah mendarat di
    // kotak masuk tidak boleh tetap terbaca karenanya.
    const items = []
    for (const row of rows) {
      const item = mapDelivery(row)
      try {
        if (await recipientEligible(pool, req.actor, item.unit, item.classification)) {
          items.push(item)
        }
      } catch {
        fail(res, 503, 'authorization_unavailable')
        return
      }
    }

    const pending = items.filter((item) => item.status === 'sent').length
    // `limited` dihitung dari jumlah SESUDAH penyaringan, bukan dari jumlah
    // baris mentah — disalin apa adanya dari Go meski itu berarti 100 baris
    // yang separuhnya tersaring tidak pernah ditandai terpotong.
    respond(res, 200, { items, pending, limited: items.length === 100 })
  }))

  // ---- 112. POST /:distributionId/receive ----
  router.post('/:distributionId/receive', json, handle(async (req, res) => {
    const decoded = decodeTyped(req, RECEIVE_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    if (!validReason(decoded.value.reason)) {
      fail(res, 400, 'invalid_reason')
      return
    }
    const id = req.params.distributionId
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        // FOR UPDATE OF d mengunci barisan distribusi saja, bukan surat
        // induknya — dua penerima berbeda boleh menerima serentak.
        const { rows } = await client.query(
          `SELECT d.recipient_unit,i.classification,d.status
             FROM sdl_urmin_distributions d JOIN sdl_urmin_incoming i ON i.id=d.incoming_id
            WHERE d.id=$1 AND d.recipient_user=$2 FOR UPDATE OF d`,
          [id, req.actor],
        )
        // Distribusi milik orang lain tidak dibedakan dari yang tidak ada.
        if (rows.length === 0) return { status: 404, code: 'not_found' }
        const { recipient_unit: unit, classification, status } = rows[0]

        if (!(await recipientEligible(pool, req.actor, unit, classification))) {
          return { status: 403, code: 'access_denied' }
        }
        if (status !== 'sent') return { status: 409, code: 'already_received' }

        await client.query(
          "UPDATE sdl_urmin_distributions SET status='received',received_at=now() WHERE id=$1",
          [id],
        )
        await client.query(
          `INSERT INTO sdl_urmin_distribution_events(distribution_id,actor_id,event_key,reason)
           VALUES($1,$2,'received',$3)`,
          [id, req.actor, decoded.value.reason.trim()],
        )
        await audit(client, req.actor, 'urmin.distribution.received', id)
        return { status: 200 }
      })
    } catch (error) {
      if (error instanceof AuthzUnavailable) throw error
      fail(res, 503, 'unavailable')
      return
    }

    if (outcome.status !== 200) {
      fail(res, outcome.status, outcome.code)
      return
    }
    respond(res, 200, { id, status: 'received' })
  }))

  // ---- 113. GET /:distributionId/events ----
  router.get('/:distributionId/events', handle(async (req, res) => {
    const id = req.params.distributionId
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return
    }

    let head
    try {
      const { rows } = await pool.query(
        `SELECT d.incoming_id::text AS incoming_id,d.recipient_unit,d.recipient_user::text AS recipient_user,
           i.classification
         FROM sdl_urmin_distributions d JOIN sdl_urmin_incoming i ON i.id=d.incoming_id WHERE d.id=$1`,
        [id],
      )
      head = rows[0]
    } catch {
      fail(res, 503, 'unavailable')
      return
    }
    if (!head) {
      fail(res, 404, 'not_found')
      return
    }

    // Dua jalur yang saling eksklusif: penerima dinilai lewat relasi
    // distribusinya, siapa pun selain penerima dinilai lewat Engine A atas
    // surat induknya. Pengirim karena itu tetap bisa melihat jejaknya.
    let authorized = false
    try {
      if (req.actor === head.recipient_user) {
        authorized = await recipientEligible(pool, req.actor, head.recipient_unit, head.classification)
      } else {
        const doc = await loadIncoming(pool, head.incoming_id)
        if (doc) authorized = await decision(req.actor, 'urmin.surat_masuk.read', doc)
      }
    } catch {
      fail(res, 503, 'authorization_unavailable')
      return
    }
    if (!authorized) {
      fail(res, 404, 'not_found')
      return
    }

    let items
    try {
      const { rows } = await pool.query(
        `SELECT e.event_key,u.display_name,e.reason,e.created_at
           FROM sdl_urmin_distribution_events e JOIN sdl_users u ON u.id=e.actor_id
          WHERE e.distribution_id=$1 ORDER BY e.created_at,e.id`,
        [id],
      )
      items = rows.map((row) => ({
        action: row.event_key,
        actor: row.display_name,
        reason: row.reason,
        at: row.created_at,
      }))
    } catch {
      fail(res, 503, 'unavailable')
      return
    }
    respond(res, 200, { items })
  }))

  // ---- 114. GET /:distributionId/disposition-candidates ----
  router.get('/:distributionId/disposition-candidates', handle(async (req, res) => {
    const id = req.params.distributionId
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return
    }

    let head
    try {
      // Status 'received' ikut di klausa WHERE: distribusi yang belum diterima
      // menjadi 404, bukan 409. Keberadaannya tidak dibocorkan sebelum
      // penerimanya benar-benar mengambilnya.
      const { rows } = await pool.query(
        `SELECT d.incoming_id::text AS incoming_id,d.recipient_unit,i.classification
           FROM sdl_urmin_distributions d JOIN sdl_urmin_incoming i ON i.id=d.incoming_id
          WHERE d.id=$1 AND d.recipient_user=$2 AND d.status='received'`,
        [id, req.actor],
      )
      head = rows[0]
    } catch {
      fail(res, 503, 'unavailable')
      return
    }
    if (!head) {
      fail(res, 404, 'not_found')
      return
    }
    const unit = head.recipient_unit
    const classification = head.classification

    try {
      if (!(await currentIssuer(pool, id, req.actor, unit, classification))) {
        fail(res, 403, 'access_denied')
        return
      }
    } catch {
      fail(res, 503, 'authorization_unavailable')
      return
    }

    let rows
    try {
      ;({ rows } = await pool.query(
        `SELECT DISTINCT u.id::text AS id,u.display_name AS name FROM sdl_users u
         JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$1
         WHERE u.id<>$2 AND u.is_active AND NOT u.must_change_password
           AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
         ORDER BY u.display_name LIMIT 100`,
        [unit, req.actor],
      ))
    } catch {
      fail(res, 503, 'unavailable')
      return
    }

    const items = []
    for (const row of rows) {
      try {
        if (await dispositionEligible(pool, row.id, unit, classification, 'urmin.disposisi.execute')) {
          items.push(mapRecipient(row, unit))
        }
      } catch {
        fail(res, 503, 'authorization_unavailable')
        return
      }
    }
    respond(res, 200, { items, unit, incomingId: head.incoming_id })
  }))

  // ---- 115. POST /:distributionId/dispositions ----
  router.post('/:distributionId/dispositions', json, handle(async (req, res) => {
    const decoded = decodeTyped(req, DISPOSITION_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const p = decoded.value
    if (!UUID_RE.test(p.assigneeId) || !validText(p.instruction, 8, 1000) || !validDispositionDue(p.dueDate)) {
      fail(res, 400, 'invalid_input')
      return
    }
    const id = req.params.distributionId
    // Menugasi diri sendiri ditolak sebagai 400, bukan 403: ia kesalahan
    // bentuk permintaan, bukan kekurangan wewenang.
    if (!UUID_RE.test(id) || p.assigneeId === req.actor) {
      fail(res, 400, 'invalid_input')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT d.incoming_id::text AS incoming_id,d.recipient_unit,i.classification,d.status,
             d.recipient_user::text AS owner
           FROM sdl_urmin_distributions d JOIN sdl_urmin_incoming i ON i.id=d.incoming_id
            WHERE d.id=$1 FOR UPDATE OF d`,
          [id],
        )
        if (rows.length === 0) return { status: 404, code: 'not_found' }
        const { incoming_id: incoming, recipient_unit: unit, classification, status, owner } = rows[0]

        if (owner !== req.actor) return { status: 404, code: 'not_found' }
        if (status !== 'received') return { status: 409, code: 'distribution_not_received' }

        if (!(await currentIssuer(pool, id, req.actor, unit, classification))) {
          return { status: 403, code: 'access_denied' }
        }
        if (!(await dispositionEligible(pool, p.assigneeId, unit, classification, 'urmin.disposisi.execute'))) {
          return { status: 403, code: 'assignee_not_eligible' }
        }

        // Satu tugas terbuka per penerima per distribusi. Tugas yang sudah
        // selesai tidak menghalangi penugasan baru.
        const existing = await client.query(
          `SELECT EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks
             WHERE distribution_id=$1 AND assigned_to=$2 AND status IN ('pending','in_progress')) AS ok`,
          [id, p.assigneeId],
        )
        if (existing.rows[0].ok === true) return { status: 409, code: 'open_task_exists' }

        let taskId
        try {
          const inserted = await client.query(
            `INSERT INTO sdl_urmin_disposition_tasks(distribution_id,incoming_id,unit_key,issued_by,assigned_to,instruction,due_date)
             VALUES($1,$2,$3,$4,$5,$6,$7::date) RETURNING id::text AS id`,
            [id, incoming, unit, req.actor, p.assigneeId, p.instruction.trim(), p.dueDate],
          )
          taskId = inserted.rows[0].id
        } catch {
          // Go memetakan SETIAP kegagalan insert di sini ke 409, bukan 503 —
          // constraint tabel itulah yang menjadi penjaga terakhirnya.
          return { status: 409, code: 'disposition_conflict' }
        }

        await client.query(
          `INSERT INTO sdl_urmin_disposition_events(disposition_id,actor_id,event_key,reason)
           VALUES($1,$2,'issued',$3)`,
          [taskId, req.actor, p.instruction.trim()],
        )
        await audit(client, req.actor, 'urmin.disposisi.issued', taskId)
        await enqueueUrminEmail(client, taskId, p.assigneeId, 'assigned')
        return { status: 201, id: taskId }
      })
    } catch (error) {
      if (error instanceof AuthzUnavailable) throw error
      fail(res, 503, 'unavailable')
      return
    }

    if (outcome.status !== 201) {
      fail(res, outcome.status, outcome.code)
      return
    }
    respond(res, 201, { id: outcome.id, status: 'pending' })
  }))

  return router
}
