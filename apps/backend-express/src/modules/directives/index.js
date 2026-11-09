import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import {
  deleteDraftFile,
  getDirectiveFile,
  listDraftFiles,
  listSentFiles,
  uploadDraftFile,
} from './attachments.js'
import { deleteDraft, getDraft, putDraft } from './draft.js'
import {
  handOverLetter,
  HandOverRefused,
  LINKABLE_LETTERS_SQL,
  mapLinkableLetter,
  readSections,
  resolveSections,
  SectionVacant,
  uniqueSections,
} from './sections.js'
import {
  appendIncomingId,
  decodeTyped,
  deny,
  isKabag,
  LETTER_LINK_SQL,
  LIST_SQL,
  mapRecipient,
  mapSummary,
  respond,
  uniqueRecipients,
  UUID_RE,
  validKind,
  validPriority,
  validText,
} from './shared.js'
import {
  appendSheet,
  DISPOSITION_OPTIONS_SQL,
  normalizeSheet,
  sheetAllowed,
  sheetArg,
  validSheet,
} from './sheet.js'

/**
 * Arahan pimpinan (R5F23), port dari internal/directives/api.go.
 *
 * Bukan disposisi Urmin: ini jalur langsung Kabagrenmin ke 1–10 penerima,
 * tanpa unit dan tanpa berjenjang. Karena itu ia tidak memakai Engine A maupun
 * Engine B, melainkan pemeriksaan ad-hoc isKabag() — lihat shared.js.
 *
 * URUTAN PENDAFTARAN DI BAWAH ADALAH KONTRAK, dan di modul ini ia paling
 * berbahaya. chi memakai radix tree sehingga segmen statis selalu menang atas
 * parameter apa pun urutan deklarasinya; Express mencocokkan BERURUTAN. Enam
 * rute statis (/meta, /candidates, /draft, /draft/attachments,
 * /attachments/..., /inbox, /sent, /notifications) karena itu wajib berada di
 * atas `/:id`, kalau tidak `/meta` akan tertangkap sebagai detail arahan
 * dengan id "meta" dan dijawab 404 — gejala yang terlihat seperti rute hilang,
 * bukan seperti salah urutan.
 */

const CREATE_SCHEMA = {
  title: 'string',
  body: 'string',
  kind: 'string',
  priority: 'string',
  dueAt: 'time?',
  recipients: 'string[]',
  sections: 'string[]',
  draftRevision: 'int?',
  incomingId: 'string?',
  // R5H2: lembar disposisi, opsional. Lihat sheet.js.
  sheet: 'sheet',
}

/**
 * Padanan validTargets (api.go). Dua cara menunjuk penerima, dan tepat satu
 * yang boleh dipakai per pengiriman.
 *
 * 'sections' adalah jalur R5H1 yang dipakai layar. 'recipients' adalah jalur
 * lama; ia tetap hidup karena kontrak API beku selama migrasi, bukan karena
 * masih ada yang memanggilnya.
 *
 * Payload yang memuat KEDUANYA ditolak, bukan digabung: menggabungkannya
 * membuat "arahan ini ditujukan kepada siapa" punya dua jawaban yang sah.
 */
function validTargets(p) {
  const sections = p.sections ?? []
  if (sections.length > 0) {
    return (p.recipients ?? []).length === 0 && uniqueSections(sections)
  }
  return uniqueRecipients(p.recipients ?? [])
}

/** Padanan validate (api.go:101). */
function validCreate(p, now) {
  if (!validText(p.title, 3, 160)) return false
  if (!validText(p.body, 8, 4000)) return false
  if (!validTargets(p)) return false
  if (!validKind(p.kind) || !validPriority(p.priority)) return false
  if (p.dueAt !== undefined && p.dueAt.getTime() < now.getTime()) return false
  // Bentuk saja. Boleh-tidaknya aktor ini menautkan surat tersebut adalah
  // pertanyaan database, dijawab di dalam transaksi kirim.
  if (p.incomingId !== undefined && !UUID_RE.test(p.incomingId)) return false
  return validSheet(p.sheet)
}

/**
 * Kandidat penerima: aktif, ber-unit aktif, punya grant berlaku, BUKAN
 * Superadmin, dan BUKAN sesama Kabagrenmin. Dua pengecualian terakhir mencegah
 * arahan dialamatkan ke akun identitas maupun ke sesama pimpinan.
 */
const CANDIDATES_SQL = `SELECT DISTINCT u.id::text AS id,u.display_name AS name,
  COALESCE((SELECT uu.unit_key FROM sdl_user_units uu WHERE uu.user_id=u.id
             ORDER BY uu.is_primary DESC,uu.unit_key LIMIT 1),'') AS unit
 FROM sdl_users u
   JOIN sdl_user_units un ON un.user_id=u.id
   JOIN sdl_org_units ou ON ou.unit_key=un.unit_key AND ou.is_active
   JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=un.unit_key
     AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
   JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
 WHERE u.is_active AND NOT u.must_change_password AND u.id<>$1::uuid
   AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
   AND NOT EXISTS(SELECT 1 FROM sdl_access_grants leader WHERE leader.user_id=u.id
                   AND leader.role_key='br_kabagrenmin' AND leader.revoked_at IS NULL
                   AND (leader.expires_at IS NULL OR leader.expires_at>NOW()))
 ORDER BY u.display_name LIMIT 300`

/** Penerima yang sah untuk create, diperiksa ulang satu per satu di transaksi. */
const RECIPIENT_VALID_SQL = `SELECT EXISTS(SELECT 1 FROM sdl_users u
   JOIN sdl_user_units uu ON uu.user_id=u.id
   JOIN sdl_org_units ou ON ou.unit_key=uu.unit_key AND ou.is_active
   JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=uu.unit_key
     AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
   JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
  WHERE u.id=$1::uuid AND u.id<>$2::uuid AND u.is_active AND NOT u.must_change_password
    AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
    AND NOT EXISTS(SELECT 1 FROM sdl_access_grants gr WHERE gr.user_id=u.id
                    AND gr.role_key='br_kabagrenmin' AND gr.revoked_at IS NULL
                    AND (gr.expires_at IS NULL OR gr.expires_at>NOW()))) AS ok`

export function createDirectivesRouter({ pool, config }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.DIRECTIVE_CREATE)
  const smallJson = rawBody(BODY_LIMITS.DIRECTIVE_DRAFT_SMALL)
  const fileBody = rawBody(BODY_LIMITS.DIRECTIVE_FILE)

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      next(error)
    }
  }

  /** isKabag dengan pemetaan 503 seragam; false kalau respons sudah ditulis. */
  const kabagOrFail = async (res, actor) => {
    try {
      return { ok: true, kabag: await isKabag(pool, actor) }
    } catch {
      deny(res, 503)
      return { ok: false }
    }
  }

  // ---- 78. GET /meta ----
  router.get('/meta', handle(async (req, res) => {
    const check = await kabagOrFail(res, req.actor)
    if (!check.ok) return
    respond(res, 200, { canIssue: check.kabag })
  }))

  // ---- 79. GET /candidates ----
  router.get('/candidates', handle(async (req, res) => {
    const check = await kabagOrFail(res, req.actor)
    if (!check.ok) return
    if (!check.kabag) {
      deny(res, 403)
      return
    }
    let rows
    try {
      ;({ rows } = await pool.query(CANDIDATES_SQL, [req.actor]))
    } catch {
      deny(res, 503)
      return
    }
    // mapRecipient ikut menulis readAt/acknowledgedAt bernilai null: struct
    // recipient di Go tidak memakai omitempty, jadi keduanya tetap muncul
    // walau tidak relevan untuk daftar kandidat.
    respond(res, 200, { items: rows.map(mapRecipient) })
  }))

  // ---- 153. GET /sections (R5H1) ----
  router.get('/sections', handle(async (req, res) => {
    const check = await kabagOrFail(res, req.actor)
    if (!check.ok) return
    if (!check.kabag) {
      deny(res, 403)
      return
    }
    let items
    try {
      items = await readSections(pool, req.actor)
    } catch {
      deny(res, 503)
      return
    }
    respond(res, 200, { items })
  }))

  // ---- 154. GET /letters (R5H1) ----
  router.get('/letters', handle(async (req, res) => {
    const check = await kabagOrFail(res, req.actor)
    if (!check.ok) return
    if (!check.kabag) {
      deny(res, 403)
      return
    }
    let rows
    try {
      ;({ rows } = await pool.query(LINKABLE_LETTERS_SQL, [req.actor]))
    } catch {
      deny(res, 503)
      return
    }
    respond(res, 200, { items: rows.map(mapLinkableLetter) })
  }))

  // ---- 155. GET /disposition-options (R5H2) ----
  // TANPA isKabag: penerima arahan juga butuh nama opsi untuk menampilkan
  // lembarnya. Satu-satunya jalur gagal adalah database (503).
  router.get('/disposition-options', handle(async (req, res) => {
    let rows
    try {
      ;({ rows } = await pool.query(DISPOSITION_OPTIONS_SQL))
    } catch {
      deny(res, 503)
      return
    }
    respond(res, 200, { items: rows.map((row) => ({ code: row.code, name: row.name })) })
  }))

  // ---- 80-82. /draft ----
  // Rute /draft/attachments didaftarkan SEBELUM /draft supaya tidak tertelan.
  router.get('/draft/attachments', handle(listDraftFiles({ pool, config })))
  router.post('/draft/attachments', fileBody, handle(uploadDraftFile({ pool, config })))
  router.delete('/draft/attachments/:fileID', handle(deleteDraftFile({ pool, config })))
  router.get('/attachments/:fileID/download', handle(getDirectiveFile({ pool, config })))
  router.get('/draft', handle(getDraft({ pool, config })))
  router.put('/draft', json, handle(putDraft({ pool, config })))
  router.delete('/draft', smallJson, handle(deleteDraft({ pool, config })))

  // ---- 87. GET /inbox ----
  router.get('/inbox', handle(async (req, res) => {
    let items
    try {
      const { rows } = await pool.query(
        `${LIST_SQL} WHERE EXISTS(SELECT 1 FROM sdl_leadership_directive_recipients rr
            WHERE rr.directive_id=d.id AND rr.recipient_id=$1::uuid)
          ORDER BY d.created_at DESC LIMIT 150`,
        [req.actor],
      )
      items = rows.map(mapSummary)

      // Stempel baca/konfirmasi MILIK PEMANGGIL diambil terpisah, bukan di-join
      // ke query daftar — kalau di-join, penerima lain ikut terbaca dan setiap
      // orang akan melihat status orang lain sebagai miliknya.
      const mine = await pool.query(
        `SELECT directive_id::text AS id,read_at,acknowledged_at
           FROM sdl_leadership_directive_recipients WHERE recipient_id=$1::uuid ORDER BY directive_id`,
        [req.actor],
      )
      const byId = new Map(mine.rows.map((row) => [row.id, row]))
      for (const item of items) {
        const row = byId.get(item.id)
        if (!row) continue
        // omitempty: field hanya muncul kalau stempelnya benar-benar ada.
        if (row.read_at !== null) item.myReadAt = row.read_at
        if (row.acknowledged_at !== null) item.myAcknowledgedAt = row.acknowledged_at
      }
      // Sesudah my*, tidak sebelumnya: IncomingID dideklarasikan paling akhir
      // di struct summary Go. items dan rows sejajar indeksnya.
      // sheet (R5H2) sesudah incomingId, juga mengikuti urutan struct Go.
      items.forEach((item, index) => appendSheet(appendIncomingId(item, rows[index]), rows[index]))
    } catch {
      deny(res, 503)
      return
    }
    respond(res, 200, { items })
  }))

  // ---- 88. GET /sent ----
  router.get('/sent', handle(async (req, res) => {
    const check = await kabagOrFail(res, req.actor)
    if (!check.ok) return
    if (!check.kabag) {
      deny(res, 403)
      return
    }
    let rows
    try {
      ;({ rows } = await pool.query(
        `${LIST_SQL} WHERE d.issuer_id=$1::uuid ORDER BY d.created_at DESC LIMIT 150`,
        [req.actor],
      ))
    } catch {
      deny(res, 503)
      return
    }
    // /sent tidak pernah mengisi my* maupun recipients, jadi incomingId memang
    // kunci terakhir di sini — tetap lewat appendIncomingId supaya aturannya
    // satu, bukan dua yang kebetulan sepakat.
    let items
    try {
      items = rows.map((row) => appendSheet(appendIncomingId(mapSummary(row), row), row))
    } catch {
      // Lembar rusak di database: Go gagal di scan() dan menjawab 503.
      deny(res, 503)
      return
    }
    respond(res, 200, { items })
  }))

  // ---- 89. GET /notifications ----
  router.get('/notifications', handle(async (req, res) => {
    let unread
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS n FROM sdl_leadership_directive_recipients
          WHERE recipient_id=$1::uuid AND read_at IS NULL`,
        [req.actor],
      )
      unread = rows[0].n
    } catch {
      deny(res, 503)
      return
    }

    const check = await kabagOrFail(res, req.actor)
    if (!check.ok) return

    let ackUnseen = 0
    if (check.kabag) {
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int AS n FROM sdl_leadership_directive_recipients rr
             JOIN sdl_leadership_directives d ON d.id=rr.directive_id
            WHERE d.issuer_id=$1::uuid AND rr.acknowledged_at IS NOT NULL AND rr.issuer_seen_at IS NULL`,
          [req.actor],
        )
        ackUnseen = rows[0].n
      } catch {
        deny(res, 503)
        return
      }
    }

    respond(res, 200, {
      unread,
      newAcknowledgements: ackUnseen,
      total: unread + ackUnseen,
      canIssue: check.kabag,
    })
  }))

  // ---- 90. POST / ----
  router.post('/', json, handle(async (req, res) => {
    const check = await kabagOrFail(res, req.actor)
    if (!check.ok) return
    if (!check.kabag) {
      deny(res, 403)
      return
    }

    const decoded = decodeTyped(req, CREATE_SCHEMA)
    if (!decoded.ok || !validCreate(decoded.value, new Date())) {
      deny(res, 400)
      return
    }
    const p = decoded.value
    if (p.draftRevision !== undefined && p.draftRevision < 1) {
      deny(res, 400)
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        // Revisi draf dikunci dan dibandingkan SEBELUM pengiriman. Klien lama
        // tanpa draftRevision mempertahankan perilaku lama: kirim langsung,
        // draf dan lampirannya tidak disentuh.
        if (p.draftRevision !== undefined) {
          const draft = await client.query(
            'SELECT revision FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid FOR UPDATE',
            [req.actor],
          )
          if (draft.rows.length === 0 || Number(draft.rows[0].revision) !== p.draftRevision) {
            return { kind: 'draft_conflict' }
          }
        }

        // R5H1: bagian diterjemahkan menjadi orang DI DALAM transaksi ini,
        // bukan di layar. Jabatan bisa berpindah tangan antara saat daftar
        // bagian dimuat dan saat tombol kirim ditekan; yang tercatat adalah
        // pemegang jabatan saat COMMIT.
        let targets
        if ((p.sections ?? []).length > 0) {
          try {
            targets = await resolveSections(client, p.sections, req.actor)
          } catch (error) {
            // Bagian kosong = 400, sama seperti penerima tidak sah di bawah:
            // dari sisi pemanggil artinya sama, payload ini menyebut sesuatu
            // yang tidak bisa dikirimi. Kegagalan lain tetap naik jadi 503.
            if (error instanceof SectionVacant) return { kind: 'invalid' }
            throw error
          }
        } else {
          targets = (p.recipients ?? []).map((id) => ({ userId: id, section: null, unit: null }))
        }

        // Seluruh penerima divalidasi ulang di dalam transaksi yang sama.
        // Satu penerima tidak sah membatalkan SELURUH pengiriman — tidak ada
        // pengiriman sebagian. Jalur bagian sudah lolos saringan yang lebih
        // ketat di resolveSections; tetap dilewatkan ke sini supaya hanya ada
        // SATU gerbang yang menentukan siapa boleh menjadi penerima arahan,
        // apa pun cara memilihnya.
        for (const target of targets) {
          const valid = await client.query(RECIPIENT_VALID_SQL, [target.userId, req.actor])
          if (valid.rows[0].ok !== true) return { kind: 'invalid' }
        }

        // Ditolak sebagai 400, sama dengan jalur penerima tidak sah di atas:
        // dari sisi pemanggil keduanya berarti "payload ini menyebut sesuatu
        // yang tidak boleh kamu kirimi".
        if (p.incomingId !== undefined) {
          const linkable = await client.query(LETTER_LINK_SQL, [p.incomingId, req.actor])
          if (linkable.rows[0].ok !== true) return { kind: 'invalid' }
        }

        // R5H2: gerbang lembar disposisi, SESUDAH gerbang surat (urutan Go).
        // Galat database dilempar -> 503; penolakan -> 400.
        const sheet = normalizeSheet(p.sheet)
        if (!(await sheetAllowed(client, sheet, p.incomingId, targets))) return { kind: 'invalid' }

        const created = await client.query(
          `INSERT INTO sdl_leadership_directives(issuer_id,title,body,kind,priority,due_at,incoming_id,sheet)
           VALUES($1::uuid,$2,$3,$4,$5,$6,$7::uuid,$8::jsonb) RETURNING id::text AS id`,
          [req.actor, p.title.trim(), p.body.trim(), p.kind, p.priority, p.dueAt ?? null,
            p.incomingId ?? null, sheetArg(sheet)],
        )
        const id = created.rows[0].id

        for (const target of targets) {
          // section_key NULL pada jalur 'recipients' — di sana penerimanya
          // memang orang, dan menuliskan bagian tempat ia kebetulan bekerja
          // akan membuat arahan itu terbaca seolah ditujukan ke bagiannya.
          await client.query(
            `INSERT INTO sdl_leadership_directive_recipients(directive_id,recipient_id,section_key)
             VALUES($1::uuid,$2::uuid,$3)`,
            [id, target.userId, target.section ?? null],
          )
        }
        await client.query(
          `INSERT INTO sdl_leadership_directive_events(directive_id,actor_id,event_key)
           VALUES($1::uuid,$2::uuid,'sent')`,
          [id, req.actor],
        )

        // R5H1: arahan yang menyebut surat sekaligus MENYERAHKAN suratnya.
        // Tanpa baris distribusi, penerima tahu ada surat tapi tidak bisa
        // membukanya, dan rantai disposisi ke dalam unitnya tetap putus.
        // Hanya untuk jalur bagian: jalur 'recipients' tidak punya unit
        // penerima yang bisa dipertanggungjawabkan.
        if (p.incomingId !== undefined && (p.sections ?? []).length > 0) {
          try {
            await handOverLetter(client, {
              incoming: p.incomingId,
              actor: req.actor,
              title: p.title.trim(),
              targets,
            })
          } catch (error) {
            if (error instanceof HandOverRefused) return { kind: 'invalid' }
            throw error
          }
        }

        if (p.draftRevision !== undefined) {
          // Lampiran privat berpindah ke arahan yang baru terkirim di dalam
          // transaksi yang sama dengan daftar penerima: pengiriman adalah satu
          // aksi yang tidak bisa dibatalkan, bukan tiga aksi berurutan.
          await client.query(
            `UPDATE sdl_leadership_directive_files SET directive_id=$1::uuid
              WHERE issuer_id=$2::uuid AND directive_id IS NULL`,
            [id, req.actor],
          )
          await client.query(
            'DELETE FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid AND revision=$2',
            [req.actor, p.draftRevision],
          )
        }
        return { kind: 'created', id }
      })
    } catch {
      deny(res, 503)
      return
    }

    if (outcome.kind === 'draft_conflict') {
      respond(res, 409, { error: 'draft_conflict' })
      return
    }
    if (outcome.kind === 'invalid') {
      deny(res, 400)
      return
    }
    respond(res, 201, { id: outcome.id })
  }))

  // ---- 92. GET /:id/attachments ----
  // Tetap di atas /:id karena Express mencocokkan berurutan.
  router.get('/:id/attachments', handle(listSentFiles({ pool, config })))

  // ---- 91. GET /:id ----
  // R5H5: padanan agendaSuratSQL (api.go). Surat keluar terhapus tidak
  // dihitung; urutan created_at,id menentukan "yang pertama".
  const AGENDA_SURAT_SQL = `SELECT r.fields->>'nomorSurat' AS nomor FROM sdl_urmin_registry r
   WHERE r.kind='surat_keluar' AND r.deleted_at IS NULL
     AND r.fields->>'rujukanArahanId'=$1 AND COALESCE(r.fields->>'nomorSurat','')<>''
   ORDER BY r.created_at,r.id LIMIT 1`

  router.get('/:id', handle(async (req, res) => {
    const id = req.params.id
    if (!UUID_RE.test(id)) {
      deny(res, 404)
      return
    }
    const check = await kabagOrFail(res, req.actor)
    if (!check.ok) return

    let item
    try {
      // Penerbit melihat arahannya sendiri HANYA selama masih Kabagrenmin:
      // $3 adalah hasil isKabag, dan tanpanya cabang issuer_id gugur.
      const { rows } = await pool.query(
        `${LIST_SQL} WHERE d.id=$1::uuid AND (
            EXISTS(SELECT 1 FROM sdl_leadership_directive_recipients rr
                    WHERE rr.directive_id=d.id AND rr.recipient_id=$2::uuid)
            OR (d.issuer_id=$2::uuid AND $3::boolean))`,
        [id, req.actor, check.kabag],
      )
      if (rows.length === 0) {
        deny(res, 404)
        return
      }
      item = mapSummary(rows[0])

      const mine = await pool.query(
        `SELECT read_at,acknowledged_at FROM sdl_leadership_directive_recipients
          WHERE directive_id=$1::uuid AND recipient_id=$2::uuid`,
        [id, req.actor],
      )
      if (mine.rows.length > 0) {
        if (mine.rows[0].read_at !== null) item.myReadAt = mine.rows[0].read_at
        if (mine.rows[0].acknowledged_at !== null) item.myAcknowledgedAt = mine.rows[0].acknowledged_at
      }

      // Daftar penerima beserta statusnya hanya untuk penerbitnya sendiri.
      if (check.kabag && item.issuerId === req.actor) {
        const recipients = await pool.query(
          `SELECT rr.recipient_id::text AS id,u.display_name AS name,
             COALESCE((SELECT uu.unit_key FROM sdl_user_units uu WHERE uu.user_id=u.id
                        ORDER BY uu.is_primary DESC,uu.unit_key LIMIT 1),'') AS unit,
             rr.section_key,rr.read_at,rr.acknowledged_at
             FROM sdl_leadership_directive_recipients rr
             JOIN sdl_users u ON u.id=rr.recipient_id
            WHERE rr.directive_id=$1::uuid ORDER BY u.display_name`,
          [id],
        )
        // omitempty pada slice: daftar kosong HILANG dari respons, bukan [].
        if (recipients.rows.length > 0) {
          item.recipients = recipients.rows.map(mapRecipient)
        }
      }
      // Paling akhir, sesudah my* DAN recipients.
      appendIncomingId(item, rows[0])
      appendSheet(item, rows[0])
      // R5H5: padanan AgendaSurat (api.go). Kunci terakhir, sesudah sheet,
      // mengikuti urutan struct Go; tidak muncul sama sekali kalau tidak ada.
      const agenda = await pool.query(AGENDA_SURAT_SQL, [id])
      if (agenda.rows.length > 0) item.agendaSurat = agenda.rows[0].nomor
    } catch {
      deny(res, 503)
      return
    }
    respond(res, 200, item)
  }))

  /**
   * Padanan event() (api.go:430) untuk /read dan /acknowledge.
   *
   * Transisinya monoton: `read_at IS NULL` dan `acknowledged_at IS NULL` pada
   * klausa WHERE membuat panggilan kedua tidak mengubah apa pun dan menjawab
   * updated:false. Status tidak pernah mundur, dan event ganda tidak pernah
   * tercatat. Konfirmasi sekaligus menandai terbaca lewat COALESCE.
   */
  const event = (kind) => handle(async (req, res) => {
    const id = req.params.id
    if (!UUID_RE.test(id)) {
      deny(res, 404)
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const found = await client.query(
          `SELECT EXISTS(SELECT 1 FROM sdl_leadership_directive_recipients
             WHERE directive_id=$1::uuid AND recipient_id=$2::uuid) AS ok`,
          [id, req.actor],
        )
        // Bukan penerima berarti 404, bukan 403: keberadaan arahan milik orang
        // lain tidak boleh bocor lewat selisih status code.
        if (found.rows[0].ok !== true) return { status: 404 }

        const sql = kind === 'read'
          ? `WITH changed AS (UPDATE sdl_leadership_directive_recipients SET read_at=NOW()
               WHERE directive_id=$1::uuid AND recipient_id=$2::uuid AND read_at IS NULL RETURNING 1)
             SELECT EXISTS(SELECT 1 FROM changed) AS changed`
          : `WITH changed AS (UPDATE sdl_leadership_directive_recipients
               SET read_at=COALESCE(read_at,NOW()),acknowledged_at=NOW()
               WHERE directive_id=$1::uuid AND recipient_id=$2::uuid AND acknowledged_at IS NULL RETURNING 1)
             SELECT EXISTS(SELECT 1 FROM changed) AS changed`
        const updated = await client.query(sql, [id, req.actor])
        const changed = updated.rows[0].changed === true

        if (changed) {
          await client.query(
            `INSERT INTO sdl_leadership_directive_events(directive_id,actor_id,recipient_id,event_key)
             VALUES($1::uuid,$2::uuid,$2::uuid,$3)`,
            [id, req.actor, kind],
          )
        }
        return { status: 200, changed }
      })
    } catch {
      deny(res, 503)
      return
    }

    if (outcome.status !== 200) {
      deny(res, outcome.status)
      return
    }
    respond(res, 200, { updated: outcome.changed })
  })

  // ---- 93. POST /:id/read ----
  router.post('/:id/read', handle(event('read')))

  // ---- 94. POST /:id/acknowledge ----
  // event_key yang ditulis adalah 'acknowledged', bukan 'acknowledge'.
  router.post('/:id/acknowledge', handle(event('acknowledged')))

  // ---- 95. POST /:id/ack-seen ----
  router.post('/:id/ack-seen', handle(async (req, res) => {
    const id = req.params.id
    if (!UUID_RE.test(id)) {
      deny(res, 404)
      return
    }
    const check = await kabagOrFail(res, req.actor)
    if (!check.ok) return
    if (!check.kabag) {
      deny(res, 403)
      return
    }

    let changed
    try {
      changed = await withTransaction(pool, async (client) => {
        const seen = await client.query(
          `UPDATE sdl_leadership_directive_recipients rr SET issuer_seen_at=NOW()
             FROM sdl_leadership_directives d
            WHERE rr.directive_id=d.id AND d.id=$1::uuid AND d.issuer_id=$2::uuid
              AND rr.acknowledged_at IS NOT NULL AND rr.issuer_seen_at IS NULL`,
          [id, req.actor],
        )
        const any = seen.rowCount > 0
        if (any) {
          await client.query(
            `INSERT INTO sdl_leadership_directive_events(directive_id,actor_id,event_key)
             VALUES($1::uuid,$2::uuid,'ack_seen')`,
            [id, req.actor],
          )
        }
        return any
      })
    } catch {
      deny(res, 503)
      return
    }
    respond(res, 200, { updated: changed })
  }))

  return router
}
