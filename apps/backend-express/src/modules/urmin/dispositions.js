import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import { goTime } from '../../time.js'
import {
  audit,
  AuthzUnavailable,
  decodeTyped,
  enqueueUrminEmail,
  fail,
  mapRecipient,
  respond,
  Unavailable,
  UUID_RE,
  validText,
} from './shared.js'
import {
  ChainInactive,
  dispositionEligible,
  dispositionReviewEligible,
  finalState,
  forwardingAllowed,
  dispositionPathUsers,
  leadershipAllowed,
  loadTask,
  mapTask,
  markSimpleDispositionComplete,
  notSubmitted,
  TASK_SELECT,
  taskChainValid,
  taskParty,
  taskProgress,
  validDispositionDue,
} from './tasks.js'

/**
 * Mount disposisi, port dari internal/urmin/r3c.go (364–624), r3d.go,
 * r3d2.go, dan r3d3.go. Sebelas endpoint, domain terakhir dalam migrasi.
 *
 * Seluruh helper rantainya sudah hidup di `tasks.js` sejak porting
 * `surat-masuk` dan `distribution-inbox` — berkas ini hanya merangkai, tidak
 * memutuskan. Itu disengaja: `taskChainValid` menentukan hasil di tiga mount
 * sekaligus dan dua salinannya akan terpisah begitu aturan rantainya berubah.
 *
 * Tiga hal yang menentukan bentuk berkas ini:
 *
 * 1. **Tiga lapis otorisasi yang tidak saling menggantikan.** `taskParty`
 *    (pihak dalam tugas), `dispositionEligible` (permission per verb), dan
 *    `leadershipAllowed` (grant `br_kabagrenmin` hidup di unit DAN klasifikasi
 *    yang sama). Endpoint 125 menuntut dua permission sekaligus, dan 126
 *    menolak pimpinan yang pernah menyentuh rantainya sendiri.
 * 2. **Penolakan menjadi 404, bukan 403, saat yang gagal adalah kepemilikan.**
 *    Bukan hanya kerapian: 403 atas tugas orang lain membocorkan bahwa tugas
 *    itu ada. 403 disediakan untuk kasus "kamu pihaknya, tapi wewenangmu kurang".
 * 3. **Urutan pemeriksaan ikut kontrak.** Pada 118–122 UUID diperiksa SEBELUM
 *    body, jadi taskId sampah menjawab 404 walau body-nya juga cacat.
 *    Pada 125/126 sebaliknya: `rootForFinal` jalan lebih dulu, sehingga tugas
 *    anak menjawab 404 walau body-nya kosong.
 */

const REASON_SCHEMA = { reason: 'string', version: 'int' }

const REVIEW_SCHEMA = { decision: 'string', reason: 'string', version: 'int' }

const FORWARD_SCHEMA = {
  assigneeId: 'string',
  instruction: 'string',
  dueDate: 'string',
  version: 'int',
}

const LEADERSHIP_UNITS = ['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung']

/**
 * Membungkus pemeriksaan izin supaya kegagalannya menjadi
 * 503 `authorization_unavailable`, bukan 503 `unavailable`. Go membedakan
 * keduanya di hampir setiap handler, dan perbedaannya ikut terekam golden file.
 */
async function authz(fn) {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ChainInactive) throw error
    throw new AuthzUnavailable()
  }
}

/** Idem untuk query biasa: kegagalannya 503 `unavailable`. */
async function data(fn) {
  try {
    return await fn()
  } catch {
    throw new Unavailable()
  }
}

export function createDispositionsRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.URMIN_INCOMING)

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      if (error instanceof AuthzUnavailable) {
        fail(res, 503, 'authorization_unavailable')
        return
      }
      if (error instanceof Unavailable) {
        fail(res, 503, 'unavailable')
        return
      }
      next(error)
    }
  }

  /**
   * Padanan rootForFinal (r3d3.go:278). Mengembalikan undefined kalau sudah
   * menjawab sendiri. Tugas ANAK menjawab 404, bukan 409: persetujuan final
   * hanya dikenal pada akar, dan menjawab 409 akan mengonfirmasi keberadaan
   * tugas yang pemanggilnya belum tentu berhak tahu.
   */
  async function rootForFinal(req, res) {
    const id = req.params.taskId
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return undefined
    }
    const task = await data(() => loadTask(pool, id))
    if (!task) {
      fail(res, 404, 'not_found')
      return undefined
    }
    if (task.parentTaskId !== null || task.depth !== 0) {
      fail(res, 404, 'not_found')
      return undefined
    }
    return task
  }

  // ---- 123. GET /leadership ----
  //
  // Didaftarkan paling awal. chi mencocokkan rute statis lebih dulu tanpa
  // peduli urutan pendaftaran; Express mencocokkan menurut urutan, jadi rute
  // statis yang kalah cepat akan tertelan pola ber-parameter.
  router.get('/leadership', handle(async (req, res) => {
    // Daftar akar diambil utuh lebih dulu lalu disaring per baris. Jumlah
    // kasus global maupun daftar id surat tidak boleh bocor ke pemanggil yang
    // tidak berwenang — itu sebabnya `items` kosong dan 403 dibedakan di bawah.
    const roots = await data(async () => {
      const { rows } = await pool.query(
        `${TASK_SELECT} WHERE t.parent_task_id IS NULL ORDER BY t.created_at DESC,t.id DESC LIMIT 151`,
      )
      return rows.map((row) => mapTask(row))
    })

    const items = []
    for (const task of roots) {
      const allowed = await authz(() =>
        leadershipAllowed(pool, req.actor, task.unit, task.classification, 'urmin.disposisi.final.monitor'),
      )
      if (!allowed) continue

      const state = (await data(() => finalState(pool, task.id))) ?? notSubmitted()

      let progress
      try {
        progress = await authz(() => taskProgress(pool, task, state.status))
      } catch (error) {
        // Satu mata rantai yang grant-nya dicabut membuat kasusnya tidak bisa
        // dilaporkan sama sekali; ia hilang dari dasbor, bukan menggagalkannya.
        if (error instanceof ChainInactive) continue
        throw error
      }
      await authz(() => markSimpleDispositionComplete(pool, task, state, progress))

      items.push({
        rootTaskId: task.id,
        letterNumber: task.letterNumber,
        subject: task.subject,
        unit: task.unit,
        classification: task.classification,
        issuerName: task.issuerName,
        assigneeName: task.assigneeName,
        dueDate: task.dueDate,
        slaStatus: task.slaStatus,
        approvalStatus: state.status,
        progress,
        version: state.version,
      })
    }

    // Dasbor kosong karena tidak ada kasus harus terbaca berbeda dari dasbor
    // kosong karena tidak berwenang. Tanpa pemeriksaan kedua ini, keduanya
    // sama-sama `items: []` dan penolakan menjadi tak terlihat.
    let eligible = false
    for (const unit of LEADERSHIP_UNITS) {
      for (const classification of ['biasa', 'penting']) {
        if (await authz(() => leadershipAllowed(pool, req.actor, unit, classification, 'urmin.disposisi.final.monitor'))) {
          eligible = true
        }
      }
    }
    if (!eligible) {
      fail(res, 403, 'access_denied')
      return
    }

    let pending = 0
    let late = 0
    let approved = 0
    for (const item of items) {
      if (item.approvalStatus === 'pending') pending += 1
      if (item.approvalStatus === 'approved') approved += 1
      if (item.slaStatus === 'overdue') late += 1
    }

    respond(res, 200, {
      items,
      pendingApproval: pending,
      overdue: late,
      approved,
      limited: roots.length === 151,
      // r3d3.go:275 memakai time.Now().UTC(), yang diserialkan RFC3339Nano.
      // `new Date()` begitu saja menghasilkan tiga desimal tetap — format yang
      // berbeda, dan satu-satunya field jam-permintaan di mount ini.
      updatedAt: goTime(),
    })
  }))

  // ---- 116. GET / ----
  router.get('/', handle(async (req, res) => {
    const tasks = await data(async () => {
      const { rows } = await pool.query(
        `${TASK_SELECT} WHERE t.issued_by=$1 OR t.assigned_to=$1 ORDER BY t.created_at DESC,t.id DESC LIMIT 200`,
        [req.actor],
      )
      return rows.map((row) => mapTask(row))
    })

    const today = new Date().toISOString().slice(0, 10)
    const items = []
    let pending = 0
    let overdue = 0
    for (const task of tasks) {
      if (!(await authz(() => taskParty(pool, req.actor, task)))) continue
      items.push(task)
      // Hitungan hanya untuk tugas yang DIKERJAKAN pemanggil. Tugas yang ia
      // terbitkan muncul di daftar tapi tidak pernah menambah bebannya.
      if (task.assigneeId === req.actor && task.status !== 'completed') {
        pending += 1
        if (task.dueDate < today) overdue += 1
      }
    }

    // `limited` dihitung dari jumlah baris MENTAH, berbeda dari kotak masuk
    // distribusi yang menghitungnya sesudah penyaringan. Disalin apa adanya.
    respond(res, 200, { items, pending, overdue, limited: tasks.length === 200 })
  }))

  // ---- 117. GET /:taskId/history ----
  router.get('/:taskId/history', handle(async (req, res) => {
    const id = req.params.taskId
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return
    }
    const task = await data(() => loadTask(pool, id))
    if (!task) {
      fail(res, 404, 'not_found')
      return
    }
    if (!(await authz(() => taskParty(pool, req.actor, task)))) {
      fail(res, 404, 'not_found')
      return
    }

    const events = await data(async () => {
      const { rows } = await pool.query(
        `SELECT e.event_key,u.display_name,e.reason,e.created_at
           FROM sdl_urmin_disposition_events e JOIN sdl_users u ON u.id=e.actor_id
          WHERE e.disposition_id=$1 ORDER BY e.created_at,e.id LIMIT 100`,
        [id],
      )
      return rows.map((row) => ({
        action: row.event_key,
        actor: row.display_name,
        reason: row.reason,
        at: row.created_at,
      }))
    })

    // Telaah TIDAK disimpan sebagai event; ia baris tersendiri yang disusulkan
    // di ekor riwayat. Akibatnya ia selalu muncul terakhir, bahkan kalau ada
    // event yang dicatat sesudahnya.
    if (task.reviewedAt !== null && task.reviewReason !== null && task.reviewerName !== null) {
      events.push({
        action: task.reviewStatus,
        actor: task.reviewerName,
        reason: task.reviewReason,
        at: task.reviewedAt,
      })
    }

    respond(res, 200, { item: task, events })
  }))

  /** Padanan changeDisposition (r3c.go:456): menerima dan menyelesaikan. */
  const changeDisposition = (complete) => handle(async (req, res) => {
    const id = req.params.taskId
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return
    }
    const decoded = decodeTyped(req, REASON_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const p = decoded.value
    if (!validText(p.reason, 8, 1000) || p.version < 1) {
      fail(res, 400, 'invalid_input')
      return
    }

    const [action, from, to] = complete
      ? ['completed', 'in_progress', 'completed']
      : ['accepted', 'pending', 'in_progress']

    const outcome = await withTransaction(pool, async (client) => {
      const { rows } = await data(() =>
        client.query(`${TASK_SELECT} WHERE t.id=$1 FOR UPDATE OF t`, [id]),
      )
      if (rows.length === 0) return { status: 404, code: 'not_found' }
      const task = mapTask(rows[0])

      // Hanya pelaksana yang menggerakkan tugasnya. Penerbit yang mencoba
      // menerima tugas orang lain mendapat 404, bukan 403.
      if (req.actor !== task.assigneeId) return { status: 404, code: 'not_found' }
      if (!(await authz(() => taskParty(pool, req.actor, task)))) {
        return { status: 403, code: 'access_denied' }
      }
      if (task.version !== p.version) return { status: 409, code: 'version_conflict' }
      if (task.status !== from) return { status: 409, code: 'invalid_workflow_transition' }

      if (complete) {
        // Induk dikunci selama penyelesaian supaya anak baru tidak bisa
        // diselipkan antara pemeriksaan ini dan perubahan statusnya.
        const { rows: dependents } = await data(() =>
          client.query(
            `SELECT EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks child
               LEFT JOIN sdl_urmin_disposition_reviews rev ON rev.disposition_id=child.id
              WHERE child.parent_task_id=$1 AND (child.status<>'completed' OR rev.id IS NULL)) AS ok`,
            [id],
          ),
        )
        if (dependents[0].ok === true) return { status: 409, code: 'child_tasks_unreviewed' }

        await data(() =>
          client.query(
            `UPDATE sdl_urmin_disposition_tasks
                SET status='completed',completion_note=$1,completed_at=now(),updated_at=now(),version=version+1
              WHERE id=$2`,
            [p.reason.trim(), id],
          ),
        )
      } else {
        await data(() =>
          client.query(
            `UPDATE sdl_urmin_disposition_tasks
                SET status='in_progress',accepted_at=now(),updated_at=now(),version=version+1 WHERE id=$1`,
            [id],
          ),
        )
      }

      await data(() =>
        client.query(
          `INSERT INTO sdl_urmin_disposition_events(disposition_id,actor_id,event_key,reason)
           VALUES($1,$2,$3,$4)`,
          [id, req.actor, action, p.reason.trim()],
        ),
      )
      await data(() => audit(client, req.actor, `urmin.disposisi.${action}`, id))
      if (complete) {
        await data(() => enqueueUrminEmail(client, id, task.issuerId, 'completed'))
      }
      return { status: 200, version: task.version + 1 }
    })

    if (outcome.status !== 200) {
      fail(res, outcome.status, outcome.code)
      return
    }
    respond(res, 200, { id, status: to, version: outcome.version })
  })

  // ---- 118. POST /:taskId/accept ----
  router.post('/:taskId/accept', json, changeDisposition(false))

  // ---- 119. POST /:taskId/complete ----
  router.post('/:taskId/complete', json, changeDisposition(true))

  // ---- 120. POST /:taskId/review ----
  //
  // Satu keputusan permanen per tugas selesai. Permintaan revisi TIDAK
  // membuka kembali tugas yang sudah selesai: penerbit harus menerbitkan
  // tugas susulan yang teraudit sendiri.
  router.post('/:taskId/review', json, handle(async (req, res) => {
    const id = req.params.taskId
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return
    }
    const decoded = decodeTyped(req, REVIEW_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const p = decoded.value
    if (
      (p.decision !== 'approved' && p.decision !== 'revision_requested') ||
      !validText(p.reason, 8, 1000) ||
      p.version < 1
    ) {
      fail(res, 400, 'invalid_input')
      return
    }

    const outcome = await withTransaction(pool, async (client) => {
      const { rows } = await data(() =>
        client.query(`${TASK_SELECT} WHERE t.id=$1 FOR UPDATE OF t`, [id]),
      )
      if (rows.length === 0) return { status: 404, code: 'not_found' }
      const task = mapTask(rows[0])

      if (task.issuerId !== req.actor) return { status: 404, code: 'not_found' }
      if (!(await authz(() => taskChainValid(pool, task)))) {
        return { status: 403, code: 'access_denied' }
      }
      const permitted = await authz(() =>
        dispositionEligible(pool, req.actor, task.unit, task.classification, 'urmin.disposisi.review'),
      )
      if (!permitted) return { status: 403, code: 'access_denied' }

      // Versi basi dan tugas yang belum siap ditelaah dijawab kode yang SAMA:
      // keduanya berarti keadaan tugasnya sudah bukan yang dilihat pemanggil.
      if (task.version !== p.version || !dispositionReviewEligible(task, req.actor)) {
        return { status: 409, code: 'review_state_conflict' }
      }

      const inserted = await data(() =>
        client.query(
          `INSERT INTO sdl_urmin_disposition_reviews(disposition_id,reviewed_by,decision,reason)
           VALUES($1,$2,$3,$4) ON CONFLICT (disposition_id) DO NOTHING`,
          [id, req.actor, p.decision, p.reason.trim()],
        ),
      )
      if ((inserted.rowCount ?? 0) !== 1) return { status: 409, code: 'review_already_exists' }

      await data(() => audit(client, req.actor, `urmin.disposisi.review.${p.decision}`, id))
      const event = p.decision === 'revision_requested' ? 'review_revision' : 'review_approved'
      await data(() => enqueueUrminEmail(client, id, task.assigneeId, event))
      return { status: 200 }
    })

    if (outcome.status !== 200) {
      fail(res, outcome.status, outcome.code)
      return
    }
    respond(res, 200, { id, reviewStatus: p.decision })
  }))

  // ---- 121. GET /:taskId/forward-candidates ----
  router.get('/:taskId/forward-candidates', handle(async (req, res) => {
    const id = req.params.taskId
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return
    }
    const parent = await data(() => loadTask(pool, id))
    if (!parent) {
      fail(res, 404, 'not_found')
      return
    }
    if (parent.assigneeId !== req.actor) {
      fail(res, 404, 'not_found')
      return
    }
    if (!(await authz(() => forwardingAllowed(pool, req.actor, parent)))) {
      fail(res, 403, 'access_denied')
      return
    }

    // Seluruh orang di sepanjang jalur diblokir, bukan hanya penerbit
    // langsung: itu yang mencegah tugas berputar kembali ke kakeknya.
    const blocked = await data(() => dispositionPathUsers(pool, parent))

    const candidates = await data(async () => {
      const { rows } = await pool.query(
        `SELECT DISTINCT u.id::text AS id,u.display_name AS name FROM sdl_users u
         JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$1
         WHERE u.is_active AND NOT u.must_change_password
           AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
         ORDER BY u.display_name LIMIT 150`,
        [parent.unit],
      )
      return rows
    })

    const items = []
    for (const row of candidates) {
      if (blocked.has(row.id)) continue
      const permitted = await authz(() =>
        dispositionEligible(pool, row.id, parent.unit, parent.classification, 'urmin.disposisi.execute'),
      )
      if (permitted) items.push(mapRecipient(row, parent.unit))
    }

    respond(res, 200, {
      items,
      parentTaskId: parent.id,
      nextDepth: parent.depth + 1,
      latestDueDate: parent.dueDate,
    })
  }))

  // ---- 122. POST /:taskId/forward ----
  router.post('/:taskId/forward', json, handle(async (req, res) => {
    const id = req.params.taskId
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return
    }
    const decoded = decodeTyped(req, FORWARD_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const p = decoded.value
    if (
      !UUID_RE.test(p.assigneeId) ||
      !validText(p.instruction, 8, 1000) ||
      !validDispositionDue(p.dueDate) ||
      p.version < 1 ||
      p.assigneeId === req.actor
    ) {
      fail(res, 400, 'invalid_input')
      return
    }

    const outcome = await withTransaction(pool, async (client) => {
      const { rows } = await data(() =>
        client.query(`${TASK_SELECT} WHERE t.id=$1 FOR UPDATE OF t`, [id]),
      )
      if (rows.length === 0) return { status: 404, code: 'not_found' }
      const parent = mapTask(rows[0])

      if (parent.assigneeId !== req.actor) return { status: 404, code: 'not_found' }
      if (!(await authz(() => forwardingAllowed(pool, req.actor, parent)))) {
        return { status: 403, code: 'access_denied' }
      }
      if (parent.version !== p.version) return { status: 409, code: 'version_conflict' }
      // Tenggat anak tidak boleh melewati tenggat induk: rantai tidak pernah
      // bisa memperpanjang umur kasusnya sendiri dengan meneruskan.
      if (p.dueDate > parent.dueDate) return { status: 409, code: 'child_due_after_parent' }

      const blocked = await data(() => dispositionPathUsers(pool, parent))
      if (blocked.has(p.assigneeId)) return { status: 403, code: 'route_loop_denied' }

      const eligible = await authz(() =>
        dispositionEligible(pool, p.assigneeId, parent.unit, parent.classification, 'urmin.disposisi.execute'),
      )
      if (!eligible) return { status: 403, code: 'assignee_not_eligible' }

      const { rows: duplicate } = await data(() =>
        client.query(
          `SELECT EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks
             WHERE parent_task_id=$1 AND assigned_to=$2 AND status IN ('pending','in_progress')) AS ok`,
          [id, p.assigneeId],
        ),
      )
      if (duplicate[0].ok === true) return { status: 409, code: 'open_task_exists' }

      let childId
      try {
        const inserted = await client.query(
          `INSERT INTO sdl_urmin_disposition_tasks(parent_task_id,depth,distribution_id,incoming_id,unit_key,issued_by,assigned_to,instruction,due_date)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::date) RETURNING id::text AS id`,
          [id, parent.depth + 1, parent.distributionId, parent.incomingId, parent.unit,
            req.actor, p.assigneeId, p.instruction.trim(), p.dueDate],
        )
        childId = inserted.rows[0].id
      } catch {
        // Seperti pada penerbitan: constraint tabel adalah penjaga terakhir,
        // dan setiap kegagalannya dibaca sebagai konflik, bukan gangguan.
        return { status: 409, code: 'disposition_conflict' }
      }

      await data(() =>
        client.query(
          `INSERT INTO sdl_urmin_disposition_events(disposition_id,actor_id,event_key,reason)
           VALUES($1,$2,'issued',$3)`,
          [childId, req.actor, p.instruction.trim()],
        ),
      )
      // Versi INDUK ikut naik. Meneruskan mengubah keadaan induk juga, jadi
      // permintaan lain yang memegang versi lama harus kalah.
      await data(() =>
        client.query(
          'UPDATE sdl_urmin_disposition_tasks SET version=version+1,updated_at=now() WHERE id=$1',
          [id],
        ),
      )
      await data(() => audit(client, req.actor, 'urmin.disposisi.forwarded', childId))
      await data(() => enqueueUrminEmail(client, childId, p.assigneeId, 'forwarded'))
      return { status: 201, id: childId, depth: parent.depth + 1 }
    })

    if (outcome.status !== 201) {
      fail(res, outcome.status, outcome.code)
      return
    }
    respond(res, 201, {
      id: outcome.id,
      parentTaskId: id,
      depth: outcome.depth,
      status: 'pending',
    })
  }))

  // ---- 124. GET /:taskId/final-status ----
  router.get('/:taskId/final-status', handle(async (req, res) => {
    const task = await rootForFinal(req, res)
    if (!task) return

    if (!(await authz(() => taskChainValid(pool, task)))) {
      fail(res, 403, 'access_denied')
      return
    }

    // Dua jalur baca: pimpinan yang berwenang, atau penerbit akar yang masih
    // pihak dalam rantainya. Pelaksana tidak termasuk — ia melihat tugasnya,
    // bukan status persetujuan kasusnya.
    const lead = await authz(() =>
      leadershipAllowed(pool, req.actor, task.unit, task.classification, 'urmin.disposisi.final.monitor'),
    )
    const party = await authz(() => taskParty(pool, req.actor, task))
    if (!lead && !(party && req.actor === task.issuerId)) {
      fail(res, 404, 'not_found')
      return
    }

    const state = (await data(() => finalState(pool, task.id))) ?? notSubmitted()
    // Berbeda dari dasbor: di sini rantai yang basi TIDAK dilewati diam-diam,
    // melainkan menjadi 503 — pemanggil meminta satu kasus tertentu.
    const progress = await authz(() => taskProgress(pool, task, state.status))
    await authz(() => markSimpleDispositionComplete(pool, task, state, progress))

    respond(res, 200, { rootTaskId: task.id, approval: state, progress })
  }))

  // ---- 125. POST /:taskId/submit-final ----
  router.post('/:taskId/submit-final', json, handle(async (req, res) => {
    const task = await rootForFinal(req, res)
    if (!task) return

    const decoded = decodeTyped(req, REASON_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const p = decoded.value
    if (!validText(p.reason, 8, 1000) || p.version < 1) {
      fail(res, 400, 'invalid_input')
      return
    }

    if (req.actor !== task.issuerId) {
      fail(res, 404, 'not_found')
      return
    }
    if (!(await authz(() => taskParty(pool, req.actor, task)))) {
      fail(res, 403, 'access_denied')
      return
    }
    // DUA permission sekaligus: mengajukan persetujuan final adalah menelaah
    // seluruh kasus, bukan sekadar menandatangani rekapnya.
    for (const permission of ['urmin.disposisi.review', 'urmin.disposisi.final.submit']) {
      const allowed = await authz(() =>
        dispositionEligible(pool, req.actor, task.unit, task.classification, permission),
      )
      if (!allowed) {
        fail(res, 403, 'access_denied')
        return
      }
    }

    const outcome = await withTransaction(pool, async (client) => {
      const { rows } = await data(() =>
        client.query(`${TASK_SELECT} WHERE t.id=$1 FOR UPDATE OF t`, [task.id]),
      )
      if (rows.length === 0) return { status: 503, code: 'unavailable' }
      const locked = mapTask(rows[0])

      if (locked.version !== p.version) return { status: 409, code: 'version_conflict' }

      const progress = await authz(() => taskProgress(pool, locked, ''))
      if (!progress.readyForSubmission) {
        return { status: 409, code: 'disposition_chain_incomplete' }
      }

      // Kasus pendek Kabagrenmin sudah tertutup oleh telaahnya sendiri.
      // Pengajuan kedua atas kasus itu adalah pengulangan, bukan langkah baru.
      const state = { status: 'not_submitted', version: 0 }
      await authz(() => markSimpleDispositionComplete(pool, locked, state, progress))
      if (progress.autoClosed === true) return { status: 409, code: 'already_completed' }

      try {
        await client.query(
          `INSERT INTO sdl_urmin_final_approvals(root_task_id,submitted_by,submission_reason)
           VALUES($1,$2,$3)`,
          [task.id, req.actor, p.reason.trim()],
        )
      } catch {
        return { status: 409, code: 'already_submitted' }
      }
      await data(() => audit(client, req.actor, 'urmin.disposisi.final.submitted', task.id))
      return { status: 201 }
    })

    if (outcome.status !== 201) {
      fail(res, outcome.status, outcome.code)
      return
    }
    respond(res, 201, { rootTaskId: task.id, approvalStatus: 'pending', progressPercent: 90 })
  }))

  // ---- 126. POST /:taskId/decide-final ----
  router.post('/:taskId/decide-final', json, handle(async (req, res) => {
    const task = await rootForFinal(req, res)
    if (!task) return

    const decoded = decodeTyped(req, REVIEW_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const p = decoded.value
    if (
      (p.decision !== 'approved' && p.decision !== 'revision_requested') ||
      !validText(p.reason, 8, 1000) ||
      p.version < 1
    ) {
      fail(res, 400, 'invalid_input')
      return
    }

    const allowed = await authz(() =>
      leadershipAllowed(pool, req.actor, task.unit, task.classification, 'urmin.disposisi.final.approve'),
    )
    if (!allowed) {
      fail(res, 403, 'access_denied')
      return
    }

    const outcome = await withTransaction(pool, async (client) => {
      const { rows } = await data(() =>
        client.query(`${TASK_SELECT} WHERE t.id=$1 FOR UPDATE OF t`, [task.id]),
      )
      if (rows.length === 0) return { status: 503, code: 'unavailable' }
      const locked = mapTask(rows[0])

      const progress = await authz(() => taskProgress(pool, locked, ''))
      if (!progress.readyForSubmission) {
        return { status: 409, code: 'disposition_chain_incomplete' }
      }

      // Pimpinan yang pernah menyentuh SATU tugas mana pun di rantai ini tidak
      // boleh menyetujuinya — diperiksa atas seluruh pohon, bukan akarnya saja.
      const { rows: conflicts } = await data(() =>
        client.query(
          `WITH RECURSIVE chain AS (
             SELECT id,issued_by,assigned_to FROM sdl_urmin_disposition_tasks WHERE id=$1
             UNION ALL
             SELECT c.id,c.issued_by,c.assigned_to FROM sdl_urmin_disposition_tasks c
               JOIN chain p ON c.parent_task_id=p.id
           ) SELECT EXISTS(SELECT 1 FROM chain WHERE issued_by=$2 OR assigned_to=$2) AS ok`,
          [task.id, req.actor],
        ),
      )
      if (conflicts[0].ok === true) return { status: 403, code: 'self_approval_denied' }

      const { rows: approval } = await data(() =>
        client.query(
          `SELECT status,submitted_by::text AS submitted_by,version
             FROM sdl_urmin_final_approvals WHERE root_task_id=$1 FOR UPDATE`,
          [task.id],
        ),
      )
      if (approval.length === 0) return { status: 409, code: 'not_submitted' }
      const current = approval[0]

      if (current.status !== 'pending' || Number(current.version) !== p.version) {
        return { status: 409, code: 'approval_state_conflict' }
      }
      if (current.submitted_by === req.actor) return { status: 403, code: 'self_approval_denied' }

      await data(() =>
        client.query(
          `UPDATE sdl_urmin_final_approvals
              SET status=$1,decided_by=$2,decision_reason=$3,decided_at=now(),version=version+1
            WHERE root_task_id=$4`,
          [p.decision, req.actor, p.reason.trim(), task.id],
        ),
      )
      await data(() => audit(client, req.actor, `urmin.disposisi.final.${p.decision}`, task.id))
      return { status: 200 }
    })

    if (outcome.status !== 200) {
      fail(res, outcome.status, outcome.code)
      return
    }
    respond(res, 200, {
      rootTaskId: task.id,
      approvalStatus: p.decision,
      progressPercent: p.decision === 'approved' ? 100 : 90,
    })
  }))

  return router
}
