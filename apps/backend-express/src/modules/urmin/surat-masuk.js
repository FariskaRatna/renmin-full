import { createHash } from 'node:crypto'

import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { contentDisposition, readMultipartForm, readSingleFile } from '../../http/multipart.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import {
  addHistory,
  audit,
  AuthzUnavailable,
  createDecision,
  decodeTyped,
  DELIVERY_SELECT,
  distributionAllowed,
  fail,
  INCOMING_COLUMNS,
  INCOMING_RETURNING,
  kabagForIntake,
  loadIncoming,
  mapDelivery,
  mapIncoming,
  mapRecipient,
  MAX_ATTACHMENT_SIZE,
  normalizeDerajat,
  recipientEligible,
  recipientOf,
  respond,
  UUID_RE,
  validDate,
  validDateTimeLocal,
  validPayload,
  validReason,
  validateFile,
  validText,
} from './shared.js'
import { dispositionAttachmentAccess, mapTask, TASK_SELECT } from './tasks.js'

/**
 * Surat masuk Urmin, port dari internal/urmin/incoming.go (R3A), bagian
 * surat-masuk dari r3b.go (R3B), dan r5f7.go (intake atomik).
 *
 * Memakai ENGINE A. Penolakan otorisasi di sini hampir selalu menjadi 404,
 * bukan 403: keberadaan surat milik unit lain tidak boleh bocor lewat selisih
 * status code. Pengecualiannya `create`, `upload`, `candidate-recipients`, dan
 * `send-distribution` — di situ pemanggil sudah terbukti boleh melihat
 * recordnya, jadi 403 tidak membocorkan apa pun.
 *
 * Akses lampiran punya jalur KEDUA di luar Engine A: penerima distribusi dan
 * penerima disposisi boleh mengunduh lampiran tanpa punya hak baca atas
 * register surat. Lihat canAttachment() di bawah.
 */

const UNITS = ['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung']
const LETTER_KINDS = ['undangan', 'permintaan', 'pemberitahuan', 'lainnya']

const PAYLOAD_SCHEMA = {
  letterNumber: 'string',
  sender: 'string',
  letterDate: 'string',
  receivedDate: 'string',
  subject: 'string',
  classification: 'string',
  derajat: 'string',
  reason: 'string',
  version: 'int',
}

const REGISTER_SCHEMA = { reason: 'string', version: 'int' }

const DISTRIBUTION_SCHEMA = { unit: 'string', recipientId: 'string', reason: 'string' }

/** Padanan validateFlexible (r5f7.go:72). */
function validFlexible(p) {
  if (!validPayload(p)) return false
  if (p.mode !== 'draft' && p.mode !== 'submit') return false
  if (!LETTER_KINDS.includes(p.letterKind)) return false
  if (p.responseDue !== '' && !validDate(p.responseDue)) return false
  if (!validDateTimeLocal(p.eventStart) || !validDateTimeLocal(p.eventEnd)) return false
  // Perbandingan string cukup karena formatnya tetap dan terurut secara leksikal.
  if (p.eventEnd !== '' && (p.eventStart === '' || p.eventEnd < p.eventStart)) return false
  if (!validText(p.eventLocation, 0, 240)) return false
  if (!validText(p.eventAgenda, 0, 500)) return false
  if (!validText(p.details, 0, 1000)) return false
  // Dua syarat yang hanya berlaku saat benar-benar diajukan, bukan saat draf.
  if (p.letterKind === 'undangan' && p.mode === 'submit' && p.eventStart === '') return false
  if (p.letterKind === 'permintaan' && p.mode === 'submit' && p.responseDue === '') return false
  if (p.id !== '' && (!UUID_RE.test(p.id) || p.version < 1)) return false
  return true
}

/** Kolom kosong disimpan NULL, bukan string kosong (dateArg, r5f7.go:105). */
const dateArg = (value) => (value === '' ? null : value)

export function createSuratMasukRouter({ pool }) {
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

  /**
   * Padanan canAttachment (r3b.go:104).
   *
   * Dua jalur, dan urutannya menentukan: pemegang hak baca register diuji
   * lebih dulu lewat Engine A; kalau gagal, DAN permission yang diminta hanya
   * read atau download, barulah jalur penerima dicoba. Permission `attach`
   * TIDAK pernah lolos lewat jalur kedua — penerima distribusi boleh membaca
   * lampiran, tidak boleh menambah.
   */
  const canAttachment = async (user, doc, permission) => {
    if (await decision(user, 'urmin.surat_masuk.read', doc)) {
      if (await decision(user, permission, doc)) return true
    }
    if (permission !== 'urmin.surat_masuk.download' && permission !== 'urmin.surat_masuk.read') {
      return false
    }
    if (await recipientOf(pool, user, doc.id, doc.classification)) return true
    return dispositionAttachmentAccess(pool, user, doc)
  }

  /** Memuat surat atau menulis 404; mengembalikan undefined kalau sudah ditulis. */
  const loadOr404 = async (req, res) => {
    const doc = await loadIncoming(pool, req.params.id)
    if (!doc) {
      fail(res, 404, 'not_found')
      return undefined
    }
    return doc
  }

  // ---- 96. GET /capabilities ----
  router.get('/capabilities', handle(async (req, res) => {
    const draft = { createdBy: req.actor, classification: 'biasa', status: 'draft' }
    const canCreate = await decision(req.actor, 'urmin.surat_masuk.create', draft)
    respond(res, 200, { canCreate })
  }))

  // ---- 97. GET / ----
  router.get('/', handle(async (req, res) => {
    const q = (req.query.q ?? '').toString().trim()
    // Batas dihitung dari string setelah trim, dalam BYTE seperti len() di Go.
    if (Buffer.byteLength(q, 'utf8') > 100) {
      fail(res, 400, 'invalid_query')
      return
    }

    let candidates
    try {
      const { rows } = await pool.query(
        `${INCOMING_COLUMNS} WHERE unit_key='urmin' AND ($1='' OR letter_number ILIKE '%'||$1||'%'
           OR sender ILIKE '%'||$1||'%' OR subject ILIKE '%'||$1||'%')
         ORDER BY created_at DESC,id DESC LIMIT 200`,
        [q],
      )
      candidates = rows.map(mapIncoming)
    } catch {
      fail(res, 503, 'unavailable')
      return
    }

    // Penyaringan per baris, bukan di SQL. Itu pilihan sadar R3A dan tercatat
    // di komentar Go; R3B menambah paginasi ber-otorisasi untuk data besar.
    const items = []
    for (const doc of candidates) {
      if (await decision(req.actor, 'urmin.surat_masuk.read', doc)) items.push(doc)
    }

    // Metadata hanya diminta untuk ID yang SUDAH lolos otorisasi.
    const workflowStatuses = {}
    const workflowSince = {}
    if (items.length > 0) {
      try {
        const { rows } = await pool.query(
          // R5G2 menambah dua langkah di sini, tapi SENGAJA bukan rantai tugas
          // yang dihitung intake detail (#110). Daftar memang selalu yang lebih
          // kasar dari keduanya, dan menyamakannya akan mengubah baris yang
          // tidak diniatkan tersentuh perubahan ini.
          `SELECT i.incoming_id::text AS id,i.route_status,i.kabag_recipient::text AS kabag,
             CASE WHEN i.kabag_recipient IS NULL THEN false ELSE EXISTS(
               SELECT 1 FROM sdl_urmin_distributions d
                WHERE d.incoming_id=i.incoming_id AND d.sent_by=i.kabag_recipient
                  AND d.recipient_user<>i.kabag_recipient) END AS forwarded,
             EXISTS(SELECT 1 FROM sdl_leadership_directives dir
                     WHERE dir.incoming_id=i.incoming_id) AS directed,
             CASE WHEN i.kabag_recipient IS NULL THEN false ELSE EXISTS(
               SELECT 1 FROM sdl_urmin_distributions d
                WHERE d.incoming_id=i.incoming_id AND d.recipient_user=i.kabag_recipient
                  AND d.status='received') END AS received,
             i.submitted_at
           FROM sdl_urmin_incoming_intake i
           WHERE i.incoming_id=ANY(string_to_array($1,',')::uuid[])`,
          [items.map((doc) => doc.id).join(',')],
        )
        for (const row of rows) {
          // Urutan presedensi, paling maju lebih dulu. Arahan yang sudah terbit
          // mengalahkan penerusan: begitu pimpinan menjawab suratnya, apakah ia
          // juga diteruskan bukan lagi yang ditanyakan daftar ini.
          let status = row.route_status
          if (row.route_status === 'awaiting_kabag') {
            if (row.directed) status = 'directive_issued'
            else if (row.forwarded) status = 'dispatched'
            else if (row.received) status = 'read_kabag'
          }
          workflowStatuses[row.id] = status
          // R5G5: sejak kapan surat ini berada pada keadaan sekarang. Tanpa
          // angka ini, "Menunggu Disposisi Kabagrenmin" tidak bisa dibedakan
          // antara yang baru diajukan tadi pagi dan yang menggantung dua
          // minggu — padahal justru itu yang dicari petugas Urmin.
          if (row.submitted_at !== null && row.submitted_at !== undefined) {
            workflowSince[row.id] = row.submitted_at
          }
        }
      } catch {
        fail(res, 503, 'unavailable')
        return
      }
    }

    respond(res, 200, { items, limited: candidates.length === 200, workflowStatuses, workflowSince })
  }))

  // ---- 98. POST / ----
  router.post('/', json, handle(async (req, res) => {
    const decoded = decodeTyped(req, PAYLOAD_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const p = decoded.value
    if (!validPayload(p)) {
      fail(res, 400, 'invalid_input')
      return
    }
    const draft = { createdBy: req.actor, classification: p.classification, status: 'draft' }
    if (!(await decision(req.actor, 'urmin.surat_masuk.create', draft))) {
      fail(res, 403, 'access_denied')
      return
    }

    let doc
    try {
      doc = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO sdl_urmin_incoming(letter_number,sender,letter_date,received_date,subject,classification,derajat,created_by,updated_by)
           VALUES($1,$2,$3::date,$4::date,$5,$6,$7,$8,$8) ${INCOMING_RETURNING}`,
          [p.letterNumber.trim(), p.sender.trim(), p.letterDate, p.receivedDate,
            p.subject.trim(), p.classification, normalizeDerajat(p.derajat), req.actor],
        )
        const created = mapIncoming(rows[0])
        await addHistory(client, created.id, req.actor, 'created', null, 'draft', p.reason.trim(), created.version)
        await audit(client, req.actor, 'urmin.surat_masuk.created', created.id)
        return created
      })
    } catch {
      fail(res, 503, 'unavailable')
      return
    }
    respond(res, 201, { item: doc })
  }))

  // ---- 99. GET /:id ----
  router.get('/:id', handle(async (req, res) => {
    const doc = await loadOr404(req, res)
    if (!doc) return
    if (!(await decision(req.actor, 'urmin.surat_masuk.read', doc))) {
      fail(res, 404, 'not_found')
      return
    }

    let history
    try {
      const { rows } = await pool.query(
        `SELECT h.action,h.from_status,h.to_status,h.reason,h.version,u.display_name,h.created_at
           FROM sdl_urmin_incoming_history h JOIN sdl_users u ON u.id=h.actor_id
          WHERE h.incoming_id=$1 ORDER BY h.version ASC`,
        [doc.id],
      )
      history = rows.map((row) => ({
        action: row.action,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        reason: row.reason,
        version: Number(row.version),
        actor: row.display_name,
        at: row.created_at,
      }))
    } catch {
      fail(res, 503, 'unavailable')
      return
    }

    const canEdit = await decision(req.actor, 'urmin.surat_masuk.update', doc)
    respond(res, 200, { item: doc, history, canEdit })
  }))

  /**
   * Padanan mutating() (incoming.go:313) untuk PATCH /:id dan POST /:id/register.
   *
   * Keduanya menuntut status 'draft' dan versi yang cocok. Perbedaannya hanya
   * bentuk body dan hasil akhirnya — digabung di Go, digabung juga di sini
   * supaya urutan pemeriksaannya tidak bisa menyimpang antar keduanya.
   */
  const mutating = (register) => handle(async (req, res) => {
    const decoded = decodeTyped(req, register ? REGISTER_SCHEMA : PAYLOAD_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const p = decoded.value
    if (register) {
      if (!validReason(p.reason) || p.version < 1) {
        fail(res, 400, 'invalid_input')
        return
      }
    } else if (!validPayload(p) || p.version < 1) {
      fail(res, 400, 'invalid_input')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const doc = await loadIncoming(client, req.params.id, true)
        if (!doc) return { status: 404, code: 'not_found' }

        if (!(await decision(req.actor, 'urmin.surat_masuk.update', doc))) {
          return { status: 404, code: 'not_found' }
        }
        if (doc.version !== p.version || doc.status !== 'draft') {
          return { status: 409, code: 'version_or_status_conflict' }
        }

        if (register) {
          // Draf hasil intake R5F7 WAJIB lewat alur pengajuan atomik. Endpoint
          // register lama hanya tersisa untuk draf R3A warisan.
          const flexible = await client.query(
            'SELECT EXISTS(SELECT 1 FROM sdl_urmin_incoming_intake WHERE incoming_id=$1) AS ok',
            [doc.id],
          )
          if (flexible.rows[0].ok === true) return { status: 409, code: 'use_intake_submission' }
        }

        const previous = 'draft'
        const action = register ? 'registered' : 'edited'
        const status = register ? 'registered' : 'draft'
        const reason = p.reason

        const { rows } = register
          ? await client.query(
            `UPDATE sdl_urmin_incoming SET status='registered',updated_by=$1,updated_at=NOW(),version=version+1
              WHERE id::text=$2 ${INCOMING_RETURNING}`,
            [req.actor, doc.id],
          )
          : await client.query(
            `UPDATE sdl_urmin_incoming SET letter_number=$1,sender=$2,letter_date=$3::date,received_date=$4::date,
               subject=$5,classification=$6,derajat=$7,updated_by=$8,updated_at=NOW(),version=version+1
              WHERE id::text=$9 ${INCOMING_RETURNING}`,
            [p.letterNumber.trim(), p.sender.trim(), p.letterDate, p.receivedDate,
              p.subject.trim(), p.classification, normalizeDerajat(p.derajat), req.actor, doc.id],
          )

        const updated = mapIncoming(rows[0])
        await addHistory(client, updated.id, req.actor, action, previous, status, reason.trim(), updated.version)
        await audit(client, req.actor, `urmin.surat_masuk.${action}`, updated.id)
        return { status: 200, item: updated }
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
    respond(res, 200, { item: outcome.item })
  })

  // ---- 100. PATCH /:id · 101. POST /:id/register ----
  router.patch('/:id', json, mutating(false))
  router.post('/:id/register', json, mutating(true))

  // ---- 102. GET /:id/attachments ----
  router.get('/:id/attachments', handle(async (req, res) => {
    const doc = await loadOr404(req, res)
    if (!doc) return
    if (!(await canAttachment(req.actor, doc, 'urmin.surat_masuk.read'))) {
      fail(res, 404, 'not_found')
      return
    }

    let items
    try {
      const { rows } = await pool.query(
        // Naskah surat mendahului lampiran — urutan baris sama dengan urutan
        // dua bagian di layar (r3b.go:164).
        `SELECT id::text AS id,filename,mime_type,size_bytes,sha256,uploaded_by::text AS uploaded_by,created_at,doc_kind
           FROM sdl_urmin_incoming_attachments WHERE incoming_id=$1 ORDER BY (doc_kind<>'surat'),created_at,id LIMIT 50`,
        [doc.id],
      )
      items = rows.map((row) => ({
        id: row.id,
        filename: row.filename,
        mime: row.mime_type,
        size: Number(row.size_bytes),
        sha256: row.sha256,
        uploadedBy: row.uploaded_by,
        createdAt: row.created_at,
        docKind: row.doc_kind,
      }))
    } catch {
      fail(res, 503, 'unavailable')
      return
    }

    // Ketiga kemampuan hanya dihitung untuk surat yang SUDAH terdaftar.
    // Pada draf ketiganya tetap false tanpa satu pun query otorisasi.
    let canUpload = false
    let canDownload = false
    let canDistribute = false
    if (doc.status === 'registered') {
      canUpload = await canAttachment(req.actor, doc, 'urmin.surat_masuk.attach')
      canDownload = await canAttachment(req.actor, doc, 'urmin.surat_masuk.download')
      if (await decision(req.actor, 'urmin.surat_masuk.read', doc)) {
        canDistribute = await decision(req.actor, 'urmin.surat_masuk.distribute', doc)
        if (canDistribute) {
          try {
            canDistribute = await distributionAllowed(pool, doc.id, req.actor, doc.classification)
          } catch {
            fail(res, 503, 'authorization_unavailable')
            return
          }
        }
      }
    }

    respond(res, 200, { items, canUpload, canDownload, canDistribute })
  }))

  // ---- 103. POST /:id/attachments ----
  router.post('/:id/attachments', handle(async (req, res) => {
    const doc = await loadOr404(req, res)
    if (!doc) return
    if (!(await canAttachment(req.actor, doc, 'urmin.surat_masuk.attach'))) {
      fail(res, 403, 'access_denied')
      return
    }
    if (doc.status !== 'registered') {
      fail(res, 409, 'not_registered')
      return
    }

    const form = await readSingleFile(req, {
      fieldName: 'file',
      maxBodyBytes: MAX_ATTACHMENT_SIZE + 65536,
      maxFileBytes: MAX_ATTACHMENT_SIZE,
    })
    // Tiga kegagalan yang Go bedakan, dan kode responsnya berbeda semua:
    // body bukan multipart / kebesaran -> 413 invalid_attachment,
    // tidak ada field berkas -> 400 file_required, isi berkas kebesaran -> 413.
    if (form.unparsable || form.bodyExceeded) {
      fail(res, 413, 'invalid_attachment')
      return
    }
    if (form.error === 'missing') {
      fail(res, 400, 'file_required')
      return
    }
    if (form.error === 'too_large') {
      fail(res, 413, 'file_too_large')
      return
    }

    const media = await validateFile(form.file.filename, form.file.buffer)
    if (!media) {
      fail(res, 400, 'invalid_file_type')
      return
    }
    const reason = (form.fields.reason ?? '').trim()
    if (!validReason(reason)) {
      fail(res, 400, 'invalid_reason')
      return
    }
    // Opsional; tidak dikirim berarti lampiran, sama dengan DEFAULT kolomnya.
    // Nilai lain ditolak, bukan didiamkan jadi lampiran (r3b.go:275).
    const docKind = (form.fields.docKind ?? '').trim() || 'lampiran'
    if (docKind !== 'surat' && docKind !== 'lampiran') {
      fail(res, 400, 'invalid_doc_kind')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        // Record dikunci dan dinilai ULANG terhadap keadaan database: izin yang
        // benar saat permintaan masuk bisa sudah basi saat berkasnya selesai
        // terbaca.
        const locked = await loadIncoming(client, doc.id, true)
        if (!locked) return { status: 503, code: 'unavailable' }
        if (locked.status !== 'registered' || locked.classification !== doc.classification) {
          return { status: 409, code: 'document_changed' }
        }
        if (!(await canAttachment(req.actor, locked, 'urmin.surat_masuk.attach'))) {
          return { status: 403, code: 'access_denied' }
        }

        const counted = await client.query(
          'SELECT count(*)::int AS n FROM sdl_urmin_incoming_attachments WHERE incoming_id=$1',
          [doc.id],
        )
        if (counted.rows[0].n >= 10) return { status: 409, code: 'attachment_limit' }

        const digest = createHash('sha256').update(form.file.buffer).digest('hex')
        const { rows } = await client.query(
          `INSERT INTO sdl_urmin_incoming_attachments(incoming_id,uploaded_by,filename,mime_type,size_bytes,sha256,body,doc_kind)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id::text AS id`,
          [doc.id, req.actor, form.file.filename, media, form.file.buffer.length, digest, form.file.buffer, docKind],
        )
        const id = rows[0].id
        await client.query(
          `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
           VALUES($1,'urmin.attachment.uploaded','urmin.attachment',$2,
                  jsonb_build_object('incoming_id',$3::text,'reason',$4::text))`,
          [req.actor, id, doc.id, reason],
        )
        return { status: 201, id }
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
    respond(res, 201, { id: outcome.id })
  }))

  // ---- 104. GET /:id/attachments/:attachmentId/download ----
  router.get('/:id/attachments/:attachmentId/download', handle(async (req, res) => {
    const { id, attachmentId } = req.params
    if (!UUID_RE.test(id) || !UUID_RE.test(attachmentId)) {
      fail(res, 404, 'not_found')
      return
    }
    const doc = await loadOr404(req, res)
    if (!doc) return
    if (!(await canAttachment(req.actor, doc, 'urmin.surat_masuk.download'))) {
      fail(res, 404, 'not_found')
      return
    }

    let row
    try {
      const { rows } = await pool.query(
        'SELECT filename,mime_type,body,sha256 FROM sdl_urmin_incoming_attachments WHERE id=$1 AND incoming_id=$2',
        [attachmentId, id],
      )
      row = rows[0]
    } catch {
      fail(res, 503, 'unavailable')
      return
    }
    if (!row) {
      fail(res, 404, 'not_found')
      return
    }

    // Integritas diperiksa sebelum satu byte pun dikirim.
    const digest = createHash('sha256').update(row.body).digest('hex')
    if (digest !== row.sha256) {
      fail(res, 503, 'attachment_integrity_failure')
      return
    }

    try {
      await pool.query(
        `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
         VALUES($1,'urmin.attachment.downloaded','urmin.attachment',$2,jsonb_build_object('incoming_id',$3::text))`,
        [req.actor, attachmentId, id],
      )
    } catch {
      fail(res, 503, 'unavailable')
      return
    }

    // Content-Type SELALU octet-stream, apa pun mime_type yang tersimpan —
    // berkas tidak pernah dirender browser.
    res.set('Content-Type', 'application/octet-stream')
    res.set('Content-Disposition', contentDisposition('attachment', row.filename))
    res.set('Content-Security-Policy', 'sandbox')
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Cache-Control', 'no-store')
    res.set('Content-Length', String(row.body.length))
    res.status(200).end(row.body)
  }))

  // ---- 105. GET /:id/recipient-candidates ----
  router.get('/:id/recipient-candidates', handle(async (req, res) => {
    const doc = await loadOr404(req, res)
    if (!doc) return

    const read = await decision(req.actor, 'urmin.surat_masuk.read', doc)
    const send = await decision(req.actor, 'urmin.surat_masuk.distribute', doc)
    if (!read || !send || doc.status !== 'registered') {
      fail(res, 403, 'access_denied')
      return
    }

    const unit = (req.query.unit ?? '').toString()
    if (!UNITS.includes(unit)) {
      fail(res, 400, 'invalid_unit')
      return
    }

    let rows
    try {
      ;({ rows } = await pool.query(
        `SELECT DISTINCT u.id::text AS id,u.display_name AS name FROM sdl_users u
         JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$1
         WHERE u.is_active AND NOT u.must_change_password
           AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
         ORDER BY u.display_name LIMIT 100`,
        [unit],
      ))
    } catch {
      fail(res, 503, 'unavailable')
      return
    }

    // Kelayakan diperiksa per kandidat, bukan di SQL: recipientEligible juga
    // menolak Superadmin demo, yang tidak terlihat dari query di atas.
    const items = []
    for (const row of rows) {
      try {
        if (await recipientEligible(pool, row.id, unit, doc.classification)) {
          items.push(mapRecipient(row, unit))
        }
      } catch {
        fail(res, 503, 'unavailable')
        return
      }
    }
    respond(res, 200, { items })
  }))

  // ---- 106. GET /:id/distributions ----
  router.get('/:id/distributions', handle(async (req, res) => {
    const doc = await loadOr404(req, res)
    if (!doc) return
    if (!(await decision(req.actor, 'urmin.surat_masuk.read', doc))) {
      fail(res, 404, 'not_found')
      return
    }

    let items
    try {
      const { rows } = await pool.query(
        `${DELIVERY_SELECT} WHERE d.incoming_id=$1 ORDER BY d.sent_at DESC,d.id DESC LIMIT 100`,
        [doc.id],
      )
      items = rows.map(mapDelivery)
    } catch {
      fail(res, 503, 'unavailable')
      return
    }
    respond(res, 200, { items })
  }))

  // ---- 107. GET /:id/disposition-tracking ----
  router.get('/:id/disposition-tracking', handle(async (req, res) => {
    const doc = await loadOr404(req, res)
    if (!doc) return

    const read = await decision(req.actor, 'urmin.surat_masuk.read', doc)
    const track = await decision(req.actor, 'urmin.disposisi.read', doc)
    if (!read || !track) {
      fail(res, 404, 'not_found')
      return
    }

    let items
    try {
      const { rows } = await pool.query(
        `${TASK_SELECT} WHERE t.incoming_id=$1 ORDER BY t.created_at DESC,t.id DESC LIMIT 200`,
        [doc.id],
      )
      const now = new Date()
      items = rows.map((row) => mapTask(row, now))
    } catch {
      fail(res, 503, 'unavailable')
      return
    }
    respond(res, 200, { items, limited: items.length === 200 })
  }))

  // ---- 108. POST /:id/distributions ----
  router.post('/:id/distributions', json, handle(async (req, res) => {
    const decoded = decodeTyped(req, DISTRIBUTION_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const p = decoded.value
    if (!UUID_RE.test(p.recipientId) || !validReason(p.reason) || !UNITS.includes(p.unit)) {
      fail(res, 400, 'invalid_input')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const doc = await loadIncoming(client, req.params.id, true)
        if (!doc) return { status: 404, code: 'not_found' }
        if (doc.status !== 'registered') return { status: 409, code: 'not_registered' }

        const read = await decision(req.actor, 'urmin.surat_masuk.read', doc)
        const send = await decision(req.actor, 'urmin.surat_masuk.distribute', doc)
        if (!read || !send) return { status: 403, code: 'access_denied' }

        if (!(await distributionAllowed(pool, doc.id, req.actor, doc.classification))) {
          return { status: 403, code: 'intake_route_restricted' }
        }
        if (!(await recipientEligible(pool, p.recipientId, p.unit, doc.classification))) {
          return { status: 403, code: 'invalid_recipient_permission' }
        }

        // Satu pengiriman yang belum diterima per penerima; kiriman kedua
        // ditolak alih-alih menumpuk di kotak masuk yang sama.
        const pending = await client.query(
          `SELECT EXISTS(SELECT 1 FROM sdl_urmin_distributions
             WHERE incoming_id=$1 AND recipient_user=$2 AND status='sent') AS ok`,
          [doc.id, p.recipientId],
        )
        if (pending.rows[0].ok === true) return { status: 409, code: 'pending_delivery_exists' }

        const { rows } = await client.query(
          `INSERT INTO sdl_urmin_distributions(incoming_id,sent_by,recipient_unit,recipient_user,reason)
           VALUES($1,$2,$3,$4,$5) RETURNING id::text AS id`,
          [doc.id, req.actor, p.unit, p.recipientId, p.reason.trim()],
        )
        const distId = rows[0].id
        await client.query(
          `INSERT INTO sdl_urmin_distribution_events(distribution_id,actor_id,event_key,reason)
           VALUES($1,$2,'sent',$3)`,
          [distId, req.actor, p.reason.trim()],
        )
        await audit(client, req.actor, 'urmin.distribution.sent', distId)
        return { status: 201, id: distId }
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
    respond(res, 201, { id: outcome.id, status: 'sent' })
  }))

  // ---- 109. POST /intake ----
  // Didaftarkan SESUDAH /:id/* di Go (R5F7Routes dipanggil terakhir), tapi
  // segmennya statis sehingga chi tetap memenangkannya. Di Express urutan
  // itu harus dibalik secara eksplisit — lihat pendaftaran di bawah.
  const intakeWrite = handle(async (req, res) => {
    const form = await readMultipartForm(req, {
      maxBodyBytes: 10 * MAX_ATTACHMENT_SIZE + 1024 * 1024,
      maxFileBytes: MAX_ATTACHMENT_SIZE,
      maxFiles: 10,
    })
    if (form.unparsable || form.error === 'too_large') {
      fail(res, 413, 'invalid_intake_size')
      return
    }
    if ((form.fieldValues.payload ?? []).length !== 1) {
      fail(res, 400, 'payload_required')
      return
    }
    const raw = form.fields.payload
    if (Buffer.byteLength(raw, 'utf8') > 16000) {
      fail(res, 400, 'invalid_body')
      return
    }

    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch {
      fail(res, 400, 'invalid_intake')
      return
    }
    const p = decodeIntake(parsed)
    if (!p || !validFlexible(p)) {
      fail(res, 400, 'invalid_intake')
      return
    }

    // Naskah surat lewat field 'surat' (paling banyak satu), lampiran lewat
    // 'files'. Batas gabungan tetap 10 agar maxBodyBytes di atas tidak
    // terlampaui (r5f7.go:195).
    const suratUploads = form.files.filter((f) => f.field === 'surat')
    if (suratUploads.length > 1) {
      fail(res, 400, 'too_many_files')
      return
    }
    const uploads = form.files.filter((f) => f.field === 'files')
    if (uploads.length + suratUploads.length > 10) {
      fail(res, 400, 'too_many_files')
      return
    }
    if (p.mode === 'draft' && uploads.length + suratUploads.length > 0) {
      fail(res, 400, 'draft_files_not_supported')
      return
    }

    const files = []
    // Naskah lebih dulu supaya urutan baris mengikuti urutan tampil.
    for (const group of [{ list: suratUploads, kind: 'surat' }, { list: uploads, kind: 'lampiran' }]) {
      for (const upload of group.list) {
        if (upload.truncated || upload.buffer.length < 1 || upload.buffer.length > MAX_ATTACHMENT_SIZE) {
          fail(res, 413, 'file_too_large')
          return
        }
        const media = await validateFile(upload.filename, upload.buffer)
        if (!media) {
          fail(res, 400, 'invalid_file_type')
          return
        }
        files.push({ filename: upload.filename, mime: media, body: upload.buffer, docKind: group.kind })
      }
    }

    const newDoc = { createdBy: req.actor, classification: p.classification, status: 'draft' }
    const permission = p.id === '' ? 'urmin.surat_masuk.create' : 'urmin.surat_masuk.update'
    if (!(await decision(req.actor, permission, newDoc))) {
      fail(res, 403, 'access_denied')
      return
    }
    if (files.length > 0) {
      // Izin melampirkan diuji terhadap SALINAN yang statusnya dipaksa
      // 'registered': Engine A menolak attach pada draf, sedangkan intake
      // memang melampirkan sebelum suratnya terdaftar.
      const fileDoc = { ...newDoc, status: 'registered' }
      if (!(await decision(req.actor, 'urmin.surat_masuk.attach', fileDoc))) {
        fail(res, 403, 'attachment_permission_required')
        return
      }
    }

    let kabag = ''
    if (p.mode === 'submit' && p.needsDisposition) {
      try {
        kabag = (await kabagForIntake(pool, p.classification)) ?? ''
      } catch {
        kabag = ''
      }
      if (kabag === '') {
        fail(res, 409, 'kabagrenmin_not_available_or_ambiguous')
        return
      }
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        let doc
        if (p.id === '') {
          const { rows } = await client.query(
            `INSERT INTO sdl_urmin_incoming(letter_number,sender,letter_date,received_date,subject,classification,derajat,created_by,updated_by)
             VALUES($1,$2,$3::date,$4::date,$5,$6,$7,$8,$8) ${INCOMING_RETURNING}`,
            [p.letterNumber.trim(), p.sender.trim(), p.letterDate, p.receivedDate,
              p.subject.trim(), p.classification, normalizeDerajat(p.derajat), req.actor],
          )
          doc = mapIncoming(rows[0])
          await addHistory(client, doc.id, req.actor, 'created', null, 'draft', p.reason.trim(), doc.version)
          await audit(client, req.actor, 'urmin.surat_masuk.created', doc.id)
        } else {
          const existing = await loadIncoming(client, p.id, true)
          if (!existing) return { status: 404, code: 'not_found' }
          if (!(await decision(req.actor, 'urmin.surat_masuk.update', existing))) {
            return { status: 404, code: 'not_found' }
          }
          if (existing.status !== 'draft' || existing.version !== p.version) {
            return { status: 409, code: 'version_or_status_conflict' }
          }
          if (files.length > 0) {
            const attachDoc = { ...existing, status: 'registered' }
            if (!(await canAttachment(req.actor, attachDoc, 'urmin.surat_masuk.attach'))) {
              return { status: 403, code: 'attachment_permission_required' }
            }
            const counted = await client.query(
              'SELECT count(*)::int AS n FROM sdl_urmin_incoming_attachments WHERE incoming_id=$1',
              [existing.id],
            )
            if (counted.rows[0].n + files.length > 10) {
              return { status: 409, code: 'attachment_limit' }
            }
          }
          const { rows } = await client.query(
            `UPDATE sdl_urmin_incoming SET letter_number=$1,sender=$2,letter_date=$3::date,received_date=$4::date,
               subject=$5,classification=$6,updated_by=$7,updated_at=now(),version=version+1
              WHERE id=$8 ${INCOMING_RETURNING}`,
            [p.letterNumber.trim(), p.sender.trim(), p.letterDate, p.receivedDate,
              p.subject.trim(), p.classification, req.actor, p.id],
          )
          doc = mapIncoming(rows[0])
          await addHistory(client, doc.id, req.actor, 'edited', 'draft', 'draft', p.reason.trim(), doc.version)
          await audit(client, req.actor, 'urmin.surat_masuk.edited', doc.id)
        }

        let submitted = null
        let recipient = null
        let route = 'draft'
        if (p.mode === 'submit') {
          const { rows } = await client.query(
            `UPDATE sdl_urmin_incoming SET status='registered',updated_by=$1,updated_at=now(),version=version+1
              WHERE id=$2 ${INCOMING_RETURNING}`,
            [req.actor, doc.id],
          )
          doc = mapIncoming(rows[0])
          await addHistory(client, doc.id, req.actor, 'registered', 'draft', 'registered', p.reason.trim(), doc.version)
          await audit(client, req.actor, 'urmin.surat_masuk.registered', doc.id)
          submitted = new Date()
          route = 'recorded'
          if (p.needsDisposition) {
            route = 'awaiting_kabag'
            recipient = kabag
          }
        }

        await client.query(
          `INSERT INTO sdl_urmin_incoming_intake(incoming_id,letter_kind,response_due,event_start,event_end,
             event_location,event_agenda,details,needs_disposition,route_status,kabag_recipient,submitted_at)
           VALUES($1,$2,$3::date,$4::timestamp,$5::timestamp,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT(incoming_id) DO UPDATE SET letter_kind=EXCLUDED.letter_kind,response_due=EXCLUDED.response_due,
             event_start=EXCLUDED.event_start,event_end=EXCLUDED.event_end,event_location=EXCLUDED.event_location,
             event_agenda=EXCLUDED.event_agenda,details=EXCLUDED.details,needs_disposition=EXCLUDED.needs_disposition,
             route_status=EXCLUDED.route_status,kabag_recipient=EXCLUDED.kabag_recipient,
             submitted_at=EXCLUDED.submitted_at,updated_at=now()`,
          [doc.id, p.letterKind, dateArg(p.responseDue), dateArg(p.eventStart), dateArg(p.eventEnd),
            p.eventLocation.trim(), p.eventAgenda.trim(), p.details.trim(), p.needsDisposition,
            route, recipient, submitted],
        )

        for (const f of files) {
          const digest = createHash('sha256').update(f.body).digest('hex')
          await client.query(
            `INSERT INTO sdl_urmin_incoming_attachments(incoming_id,uploaded_by,filename,mime_type,size_bytes,sha256,body,doc_kind)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
            [doc.id, req.actor, f.filename, f.mime, f.body.length, digest, f.body, f.docKind],
          )
        }
        if (files.length > 0) {
          // Endpoint ini atomik: SATU catatan audit mewakili seluruh lampiran.
          await client.query(
            `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
             VALUES($1,'urmin.intake.attachments_submitted','urmin.surat_masuk',$2,
                    jsonb_build_object('count',$3::integer))`,
            [req.actor, doc.id, files.length],
          )
        }

        if (kabag !== '') {
          // Kabagrenmin yang ditunjuk diperiksa ULANG sebelum commit: izinnya
          // bisa dicabut di antara pemilihan dan penulisan.
          if (!(await recipientEligible(pool, kabag, 'urmin', p.classification))) {
            return { status: 409, code: 'kabagrenmin_not_eligible' }
          }
          const { rows } = await client.query(
            `INSERT INTO sdl_urmin_distributions(incoming_id,sent_by,recipient_unit,recipient_user,reason)
             VALUES($1,$2,'urmin',$3,$4) RETURNING id::text AS id`,
            [doc.id, req.actor, kabag, 'Surat masuk menunggu arahan Kabagrenmin'],
          )
          const distId = rows[0].id
          await client.query(
            `INSERT INTO sdl_urmin_distribution_events(distribution_id,actor_id,event_key,reason)
             VALUES($1,$2,'sent',$3)`,
            [distId, req.actor, 'Pengajuan surat masuk memerlukan disposisi'],
          )
          await audit(client, req.actor, 'urmin.distribution.sent', distId)
          // R5F22: satu pemberitahuan Kabagrenmin masuk antrean di transaksi
          // yang sama. Draf dan surat 'recorded' tidak pernah dikirimi email.
          await client.query(
            `INSERT INTO sdl_urmin_intake_mail_outbox(distribution_id,recipient_user)
             VALUES($1::uuid,$2::uuid) ON CONFLICT(distribution_id,recipient_user) DO NOTHING`,
            [distId, kabag],
          )
        }

        return { status: 201, item: doc, routeStatus: route, filesSaved: files.length }
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
    respond(res, 201, {
      item: outcome.item,
      routeStatus: outcome.routeStatus,
      filesSaved: outcome.filesSaved,
    })
  })

  // ---- 110. GET /:id/intake ----
  const intakeRead = handle(async (req, res) => {
    const id = req.params.id
    if (!UUID_RE.test(id)) {
      fail(res, 404, 'not_found')
      return
    }
    const doc = await loadOr404(req, res)
    if (!doc) return
    if (!(await decision(req.actor, 'urmin.surat_masuk.read', doc))) {
      fail(res, 404, 'not_found')
      return
    }

    let row
    try {
      const { rows } = await pool.query(
        `SELECT letter_kind,response_due::text AS response_due,event_start::text AS event_start,
           event_end::text AS event_end,event_location,event_agenda,details,needs_disposition,
           route_status,kabag_recipient::text AS kabag_recipient,submitted_at
         FROM sdl_urmin_incoming_intake WHERE incoming_id=$1`,
        [id],
      )
      row = rows[0]
    } catch {
      fail(res, 503, 'unavailable')
      return
    }
    if (!row) {
      respond(res, 200, { intake: null })
      return
    }

    const intake = {
      letterKind: row.letter_kind,
      responseDue: row.response_due ?? null,
      eventStart: row.event_start ?? null,
      eventEnd: row.event_end ?? null,
      eventLocation: row.event_location,
      eventAgenda: row.event_agenda,
      details: row.details,
      needsDisposition: row.needs_disposition,
      routeStatus: row.route_status,
      kabagRecipient: row.kabag_recipient ?? null,
      submittedAt: row.submitted_at ?? null,
      workflowStatus: row.route_status,
    }

    // workflowStatus adalah turunan, bukan kolom: ia naik dari awaiting_kabag
    // ke dibaca, lalu ke arahan terbit atau ke rantai distribusi lama.
    //
    // R5G2 melipat dua round trip menjadi satu CASE supaya presedensi antar
    // cabang dinyatakan SEKALI, di SQL, bukan disusun ulang oleh dua backend
    // secara terpisah. Urutan: paling maju lebih dulu. Arahan yang sudah terbit
    // mengalahkan penerusan — begitu pimpinan menjawab suratnya, apakah ia juga
    // diteruskan bukan lagi yang dilaporkan field ini.
    if (intake.routeStatus === 'awaiting_kabag' && intake.kabagRecipient !== null) {
      try {
        const { rows } = await pool.query(
          `SELECT CASE
             WHEN EXISTS(SELECT 1 FROM sdl_leadership_directives dir WHERE dir.incoming_id=$1) THEN 'directive_issued'
             WHEN EXISTS(SELECT 1 FROM sdl_urmin_distributions d WHERE d.incoming_id=$1 AND d.sent_by=$2 AND d.recipient_user<>$2) THEN
               (CASE WHEN EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks t WHERE t.incoming_id=$1 AND t.status<>'completed') THEN 'in_progress'
                     WHEN EXISTS(SELECT 1 FROM sdl_urmin_disposition_tasks t WHERE t.incoming_id=$1) THEN 'awaiting_review'
                     ELSE 'dispatched' END)
             WHEN EXISTS(SELECT 1 FROM sdl_urmin_distributions d WHERE d.incoming_id=$1 AND d.recipient_user=$2 AND d.status='received') THEN 'read_kabag'
             ELSE 'awaiting_kabag' END AS status`,
          [id, intake.kabagRecipient],
        )
        intake.workflowStatus = rows[0].status
      } catch {
        fail(res, 503, 'unavailable')
        return
      }
    }

    respond(res, 200, { intake })
  })

  // Rute statis WAJIB sebelum `/:id` yang setara. chi memenangkan segmen
  // statis tanpa peduli urutan pendaftaran — Express tidak.
  router.post('/intake', intakeWrite)
  router.get('/:id/intake', intakeRead)

  return router
}

/**
 * Padanan decode struct flexibleIntake ber-DisallowUnknownFields (r5f7.go:184).
 *
 * Tidak lewat decodeTyped(): payload intake datang sebagai field multipart,
 * bukan sebagai body JSON, jadi tidak ada req.rawBodyBuffer untuk dibaca.
 */
const INTAKE_FIELDS = {
  id: 'string', version: 'int', letterNumber: 'string', sender: 'string',
  letterDate: 'string', receivedDate: 'string', subject: 'string',
  classification: 'string', derajat: 'string', reason: 'string', letterKind: 'string',
  responseDue: 'string', eventStart: 'string', eventEnd: 'string',
  eventLocation: 'string', eventAgenda: 'string', details: 'string',
  needsDisposition: 'bool', mode: 'string',
}

function decodeIntake(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  for (const key of Object.keys(raw)) if (!(key in INTAKE_FIELDS)) return undefined

  const out = {}
  for (const [field, kind] of Object.entries(INTAKE_FIELDS)) {
    const value = raw[field]
    if (value === undefined || value === null) {
      out[field] = kind === 'string' ? '' : kind === 'bool' ? false : 0
      continue
    }
    if (kind === 'string') {
      if (typeof value !== 'string') return undefined
      out[field] = value
    } else if (kind === 'bool') {
      if (typeof value !== 'boolean') return undefined
      out[field] = value
    } else {
      if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
      out[field] = value
    }
  }
  return out
}
