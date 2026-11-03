import { withTransaction } from '../../db.js'
import {
  decodeTyped,
  deny,
  draftConflict,
  draftPermission,
  respond,
  uniqueDraftRecipients,
  UUID_RE,
  validKind,
  validPriority,
} from './shared.js'

/**
 * Draf arahan pimpinan, port dari internal/directives/draft.go.
 *
 * Satu draf privat per akun Kabagrenmin (UNIQUE issuer_id). `revision` adalah
 * compare-and-swap: tab autosave yang basi tidak boleh menimpa draf yang lebih
 * baru secara diam-diam. Nilai yang tidak cocok selalu menjadi 409
 * draft_conflict, tidak pernah penulisan yang berhasil.
 */

const DRAFT_SCHEMA = {
  title: 'string',
  body: 'string',
  kind: 'string',
  priority: 'string',
  dueAt: 'string',
  recipients: 'string[]',
  revision: 'int',
  incomingId: 'string?',
}

const DELETE_SCHEMA = { revision: 'int' }

const LOCAL_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/**
 * Padanan time.Parse("2006-01-02T15:04") plus pemeriksaan format ulang.
 *
 * Dua langkah itu di Go menolak hal yang berbeda: Parse menolak jam 25 dan
 * bulan 13, sedangkan perbandingan format ulang menolak tanggal yang bergulir
 * seperti 2026-02-31. Date milik JS justru MENERIMA keduanya dengan
 * menggulung ke bulan berikutnya, jadi komponennya diperiksa satu per satu.
 */
function validLocalDateTime(value) {
  if (!LOCAL_DATETIME_RE.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  const hour = Number(value.slice(11, 13))
  const minute = Number(value.slice(14, 16))
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

/** Padanan validDraft (draft.go:35). Judul dan isi TIDAK punya batas bawah. */
function validDraft(d) {
  if ([...d.title].length > 160) return false
  if ([...d.body].length > 4000) return false
  if (!validKind(d.kind) || !validPriority(d.priority)) return false
  if (!uniqueDraftRecipients(d.recipients ?? [])) return false
  if (d.dueAt !== '' && !validLocalDateTime(d.dueAt)) return false
  // Bentuk saja, SENGAJA bukan LETTER_LINK_SQL. Draf adalah kertas buram privat
  // yang tidak pernah dikirim, dan autosave tidak boleh mulai gagal selagi
  // penulisnya masih memilih. Gerbang sesungguhnya berjalan saat kirim.
  if (d.incomingId !== undefined && !UUID_RE.test(d.incomingId)) return false
  return true
}

/** GET /draft — endpoint 80. */
export function getDraft({ pool }) {
  return async (req, res) => {
    if (!(await draftPermission(res, pool, req.actor))) return

    let rows
    try {
      ;({ rows } = await pool.query(
        `SELECT title,body,kind,priority,due_at_local,recipient_ids,incoming_id::text AS incoming_id,
           revision,updated_at
           FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid`,
        [req.actor],
      ))
    } catch {
      deny(res, 503)
      return
    }

    // Tidak ada draf bukan kesalahan: 200 dengan draft:null, bukan 404.
    if (rows.length === 0) {
      respond(res, 200, { draft: null })
      return
    }

    const row = rows[0]
    // recipient_ids bertipe jsonb. node-postgres sudah mem-parse-nya menjadi
    // nilai JS, sedangkan Go menerimanya sebagai []byte lalu json.Unmarshal.
    // Keduanya harus menghasilkan array yang sama; bentuk lain berarti baris
    // rusak, dan Go menjawab 503 untuk itu — bukan mengarang array kosong.
    const recipients = Array.isArray(row.recipient_ids) ? row.recipient_ids : undefined
    if (!recipients) {
      deny(res, 503)
      return
    }

    respond(res, 200, {
      draft: {
        title: row.title,
        body: row.body,
        kind: row.kind,
        priority: row.priority,
        dueAt: row.due_at_local,
        recipients,
        // TANPA omitempty di Go, berbeda dari summary: field draf lainnya pun
        // selalu hadir, jadi di sini null ditulis apa adanya.
        incomingId: row.incoming_id ?? null,
      },
      revision: Number(row.revision),
      updatedAt: row.updated_at,
    })
  }
}

/** PUT /draft — endpoint 81. */
export function putDraft({ pool }) {
  return async (req, res) => {
    if (!(await draftPermission(res, pool, req.actor))) return

    const decoded = decodeTyped(req, DRAFT_SCHEMA)
    if (!decoded.ok || decoded.value.revision < 0 || !validDraft(decoded.value)) {
      deny(res, 400)
      return
    }
    const d = decoded.value
    // Go mengubah nil menjadi [] sebelum marshal, sehingga kolomnya tidak
    // pernah berisi JSON null.
    const recipients = JSON.stringify(d.recipients ?? [])

    let rows
    try {
      ;({ rows } = await pool.query(
        `INSERT INTO sdl_leadership_directive_drafts AS d(issuer_id,title,body,kind,priority,due_at_local,recipient_ids,incoming_id,revision,updated_at)
         VALUES($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8::uuid,1,NOW())
         ON CONFLICT(issuer_id) DO UPDATE SET title=EXCLUDED.title,body=EXCLUDED.body,kind=EXCLUDED.kind,
           priority=EXCLUDED.priority,due_at_local=EXCLUDED.due_at_local,recipient_ids=EXCLUDED.recipient_ids,
           incoming_id=EXCLUDED.incoming_id,revision=d.revision+1,updated_at=NOW()
         WHERE d.revision=$9 RETURNING revision,updated_at`,
        [req.actor, d.title, d.body, d.kind, d.priority, d.dueAt, recipients,
          d.incomingId ?? null, d.revision],
      ))
    } catch {
      deny(res, 503)
      return
    }

    // Nol baris berarti klausa WHERE pada DO UPDATE tidak terpenuhi: draf sudah
    // berpindah revisi sejak terakhir dibaca klien.
    if (rows.length === 0) {
      draftConflict(res)
      return
    }

    respond(res, 200, {
      revision: Number(rows[0].revision),
      updatedAt: rows[0].updated_at,
    })
  }
}

/** DELETE /draft — endpoint 82. */
export function deleteDraft({ pool }) {
  return async (req, res) => {
    if (!(await draftPermission(res, pool, req.actor))) return

    const decoded = decodeTyped(req, DELETE_SCHEMA)
    if (!decoded.ok || decoded.value.revision < 0) {
      deny(res, 400)
      return
    }
    const revision = decoded.value.revision

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        let currentRevision
        try {
          const current = await client.query(
            'SELECT revision FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid FOR UPDATE',
            [req.actor],
          )
          if (current.rows.length === 0) return 'conflict'
          currentRevision = Number(current.rows[0].revision)
        } catch {
          // Go memeriksa `rev != p.Revision` SEBELUM `err != nil` (draft.go:163).
          // Saat query gagal, rev tertinggal 0, sehingga kegagalan database
          // dengan revisi bukan-nol menjadi 409 draft_conflict — bukan 503.
          // Terlihat keliru, tapi kontraknya beku; lihat DEVIATIONS.md.
          if (revision !== 0) return 'conflict'
          throw new Error('draft lookup failed')
        }
        if (currentRevision !== revision) return 'conflict'
        // Unggahan privat ikut terhapus bersama draf — kalau tidak, berkas itu
        // menjadi yatim: tidak terlihat di draf mana pun dan tidak pernah
        // terkirim bersama arahan.
        await client.query(
          'DELETE FROM sdl_leadership_directive_files WHERE issuer_id=$1::uuid AND directive_id IS NULL',
          [req.actor],
        )
        const removed = await client.query(
          'DELETE FROM sdl_leadership_directive_drafts WHERE issuer_id=$1::uuid AND revision=$2',
          [req.actor, revision],
        )
        if (removed.rowCount !== 1) throw new DraftVanished()
        return 'deleted'
      })
    } catch (error) {
      if (error instanceof DraftVanished) {
        draftConflict(res)
        return
      }
      deny(res, 503)
      return
    }

    if (outcome === 'conflict') {
      draftConflict(res)
      return
    }
    respond(res, 200, { deleted: true })
  }
}

/**
 * Dilempar supaya transaksi ikut di-rollback saat baris draf lenyap di antara
 * SELECT FOR UPDATE dan DELETE. Go memakai `return` sesudah respond, dan
 * `defer tx.Rollback` yang membatalkannya; di sini rollback-nya dipicu lemparan.
 */
class DraftVanished extends Error {}
