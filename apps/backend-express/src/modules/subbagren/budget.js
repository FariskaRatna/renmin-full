import { Router } from 'express'
import { createHash } from 'node:crypto'
import sharp from 'sharp'

import { withTransaction } from '../../db.js'
import { openEvidence, sealEvidence } from '../../crypto/evidence.js'
import { contentDisposition, detectFileType, readSingleFile } from '../../http/multipart.js'
import { BODY_LIMITS, rawBody } from '../../http/payload.js'
import {
  amountOk,
  createPermitted,
  fail,
  failFrom,
  loadReviewCase,
  mapProposal,
  parseDateOnly,
  parseGoInt,
  PROPOSAL_COLUMNS,
  respond,
  textOk,
  typedDecode,
  validReason,
} from './shared.js'

/**
 * Pagu, realisasi, dan bukti keuangan Subbagren — port dari budget.go dan
 * evidence.go.
 *
 * Polanya maker-checker: yang mencatat tidak boleh yang memverifikasi, dan
 * angka keuangan HANYA berasal dari record berstatus 'verified'. Tiga aturan
 * yang menopang itu dan tidak boleh dilonggarkan:
 *
 *   1. Setiap endpoint memeriksa TIGA izin berurutan (budgetAuth): usulan.read,
 *      anggaran.read, lalu izin spesifik. Gagal di mana pun menjadi 404 yang
 *      sama, supaya keberadaan record tidak bocor lewat selisih status code.
 *   2. Verifikasi realisasi menuntut bukti ber-status 'approved' yang lolos
 *      pemeriksaan integritas AES-GCM + SHA-256 — dicek ulang saat verifikasi,
 *      bukan dipercaya dari saat unggah.
 *   3. Urutan penguncian selalu pagu -> realisasi -> bukti. Dibalik, dua
 *      reviewer yang berjalan bersamaan bisa saling menunggu.
 *
 * Kunci bukti yang tidak ada atau tidak valid membuat operasi berkas
 * fail-closed; tidak pernah ada fallback plaintext.
 */

const MAX_EVIDENCE_BYTES = 5 << 20

/** Padanan safeEvidenceName (evidence.go:29). */
const SAFE_EVIDENCE_NAME = /^[a-zA-Z0-9 _().-]{1,160}$/

const PAGU_COLUMNS = `SELECT b.id::text,b.proposal_id::text,p.title,p.fiscal_year,p.classification,b.amount,b.authorization_number,b.authorization_issuer,b.authorization_date::text,b.status,b.created_by::text,b.version FROM sdl_subbagren_pagu b JOIN sdl_subbagren_proposals p ON p.id=b.proposal_id`

const REALISASI_COLUMNS = `SELECT t.id::text,t.pagu_id::text,t.amount,t.transaction_date::text,t.evidence_reference,t.description,t.status,t.created_by::text,t.version FROM sdl_subbagren_realisasi t`

/** Urutan field mengikuti struct Pagu (budget.go:20). Amount tetap string. */
function mapPagu(row) {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    proposalTitle: row.title,
    fiscalYear: row.fiscal_year,
    classification: row.classification,
    amount: String(row.amount),
    authorizationNumber: row.authorization_number,
    authorizationIssuer: row.authorization_issuer,
    authorizationDate: row.authorization_date,
    status: row.status,
    createdBy: row.created_by,
    version: Number(row.version),
    verifiedRealization: '',
    remaining: '',
  }
}

/** Urutan field mengikuti struct Realisasi (budget.go:36). */
function mapRealisasi(row) {
  return {
    id: row.id,
    paguId: row.pagu_id,
    amount: String(row.amount),
    transactionDate: row.transaction_date,
    evidenceReference: row.evidence_reference,
    description: row.description,
    status: row.status,
    createdBy: row.created_by,
    version: Number(row.version),
  }
}

/** Urutan field mengikuti struct Evidence (evidence.go:31). */
function mapEvidence(row) {
  return {
    id: row.id,
    realisasiId: row.realisasi_id,
    filename: row.filename,
    mime: row.mime_type,
    size: row.size_bytes,
    sha256: row.sha256,
    status: row.status,
    uploadedBy: row.uploaded_by,
    reviewerId: row.reviewer_id,
    reviewReason: row.review_reason,
    version: Number(row.version),
    createdAt: row.created_at,
  }
}

const PAGU_SCHEMA = {
  proposalId: 'string',
  amount: 'int',
  authorizationNumber: 'string',
  authorizationIssuer: 'string',
  authorizationDate: 'string',
  reason: 'string',
}

const REALISASI_SCHEMA = {
  paguId: 'string',
  amount: 'int',
  transactionDate: 'string',
  evidenceReference: 'string',
  description: 'string',
  reason: 'string',
}

const CHECK_SCHEMA = { version: 'int', decision: 'string', reason: 'string' }

const EVIDENCE_REVIEW_SCHEMA = { version: 'int', decision: 'string', reason: 'string' }

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Padanan validateEvidence (evidence.go:46). Tipe ditentukan dari magic bytes,
 * BUKAN dari Content-Type kiriman klien, dan ekstensi nama berkas harus cocok
 * dengan tipe sebenarnya — berkas .pdf yang isinya JPEG ditolak.
 *
 * @returns {Promise<string|undefined>} media type kalau sah
 */
// R5H12: dipakai ulang oleh progar.js untuk bukti realisasi per kegiatan.
export async function validateEvidence(rawName, blob) {
  const filename = rawName.trim()
  if (!SAFE_EVIDENCE_NAME.test(filename) || blob.length === 0 || blob.length > MAX_EVIDENCE_BYTES) {
    return undefined
  }
  const lower = filename.toLowerCase()
  const detected = detectFileType(blob)

  if (lower.endsWith('.pdf')) {
    // Penanda akhir dicari di 2048 byte terakhir saja, seperti di Go.
    const tail = blob.subarray(Math.max(0, blob.length - 2048))
    const valid = detected === 'application/pdf' &&
      blob.subarray(0, 5).toString('latin1') === '%PDF-' &&
      tail.includes('%%EOF')
    return valid ? 'application/pdf' : undefined
  }

  const isPng = lower.endsWith('.png') && detected === 'image/png'
  const isJpeg = (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) && detected === 'image/jpeg'
  if (!isPng && !isJpeg) return undefined

  try {
    // Padanan image.DecodeConfig: hanya header yang dibaca, bukan seluruh
    // piksel. Batas 20 juta piksel mencegah decompression bomb.
    const meta = await sharp(blob).metadata()
    if (!(meta.width > 0 && meta.height > 0)) return undefined
    if (meta.width * meta.height > 20000000) return undefined
    if (isPng && meta.format !== 'png') return undefined
    if (isJpeg && meta.format !== 'jpeg') return undefined
    return detected
  } catch {
    return undefined
  }
}

export function createBudgetRouter({ pool, config }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.USULAN)
  const evidenceKey = config?.evidenceKey

  const permitted = createPermitted(pool)

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      next(error)
    }
  }

  /**
   * Padanan budgetAuth (budget.go:119). Tiga izin berurutan; satu pun gagal
   * berarti 404 — bukan 403. Lihat catatan modul.
   */
  async function budgetAuth(user, permission, proposal) {
    for (const key of ['subbagren.usulan.read', 'subbagren.anggaran.read', permission]) {
      if (!(await permitted(user, key, proposal))) return false
    }
    return true
  }

  async function budgetProposal(id) {
    const { rows } = await pool.query(`${PROPOSAL_COLUMNS} WHERE id::text=$1`, [id])
    return rows.length > 0 ? mapProposal(rows[0]) : undefined
  }

  async function paguById(id) {
    const { rows } = await pool.query(`${PAGU_COLUMNS} WHERE b.id::text=$1`, [id])
    return rows.length > 0 ? mapPagu(rows[0]) : undefined
  }

  async function budgetEvent(client, subjectType, id, user, action, reason) {
    await client.query(
      `INSERT INTO sdl_subbagren_budget_events(subject_type,subject_id,actor_id,action,reason)
       VALUES($1,$2,$3,$4,$5)`,
      [subjectType, id, user, action, reason.trim()],
    )
    await client.query(
      `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,$2,$3,$4)`,
      [user, `subbagren.anggaran.${action}`, `subbagren.${subjectType}`, id],
    )
  }

  async function evidenceEvent(client, id, user, action, reason) {
    await client.query(
      `INSERT INTO sdl_subbagren_evidence_events(evidence_id,actor_id,action,reason) VALUES($1,$2,$3,$4)`,
      [id, user, action, reason.trim()],
    )
    await client.query(
      `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id)
       VALUES($1,$2,'subbagren.evidence',$3)`,
      [user, `subbagren.anggaran.bukti.${action}`, id],
    )
  }

  /**
   * Padanan evidenceAuth (evidence.go:79): menelusuri realisasi -> pagu ->
   * usulan, lalu memeriksa izin terhadap usulannya. Melindungi record keuangan
   * dan identitas berkas sekaligus dari penyisiran.
   *
   * @returns {Promise<{ok: true, item: object} | {ok: false, status: number, code: string}>}
   */
  async function evidenceAuth(user, permission, realisasiId) {
    const found = await pool.query(`${REALISASI_COLUMNS} WHERE t.id::text=$1`, [realisasiId])
    if (found.rows.length === 0) return { ok: false, status: 404, code: 'not_found' }
    const item = mapRealisasi(found.rows[0])

    const parent = await pool.query(
      'SELECT proposal_id::text AS proposal_id FROM sdl_subbagren_pagu WHERE id=$1',
      [item.paguId],
    )
    if (parent.rows.length === 0) return { ok: false, status: 503, code: 'unavailable' }

    const proposal = await budgetProposal(parent.rows[0].proposal_id)
    if (!proposal) return { ok: false, status: 503, code: 'unavailable' }

    if (!(await budgetAuth(user, permission, proposal))) {
      return { ok: false, status: 404, code: 'not_found' }
    }
    return { ok: true, item }
  }

  /** Tahun wajib ada dan masuk akal; tanpa itu seluruh angka tak bermakna. */
  function readYear(req, res) {
    const year = parseGoInt(String(req.query.year ?? ''))
    if (year === undefined || year < 2020 || year > 2100) {
      fail(res, 400, 'invalid_year')
      return undefined
    }
    return year
  }

  // ---- 63. GET /capabilities ----
  // Kunci disisipkan terurut alfabetis: Go menserialkan map dengan kunci
  // terurut, sedangkan JSON.stringify memakai urutan penyisipan.
  const CAPABILITY_KEYS = [
    ['read', 'subbagren.anggaran.read'],
    ['readEvidence', 'subbagren.anggaran.bukti.read'],
    ['reconcile', 'subbagren.anggaran.reconcile'],
    ['record', 'subbagren.anggaran.realisasi.record'],
    ['register', 'subbagren.anggaran.pagu.register'],
    ['reviewEvidence', 'subbagren.anggaran.bukti.verify'],
    ['uploadEvidence', 'subbagren.anggaran.bukti.upload'],
    ['verifyPagu', 'subbagren.anggaran.pagu.verify'],
    ['verifyRealization', 'subbagren.anggaran.realisasi.verify'],
  ]

  router.get('/capabilities', handle(async (req, res) => {
    const user = req.actor
    const sample = { createdBy: user, classification: 'biasa', status: 'submitted' }
    try {
      const result = {}
      for (const [label, key] of CAPABILITY_KEYS) {
        result[label] = await permitted(user, key, sample)
      }
      respond(res, 200, result)
    } catch (error) {
      if (!failFrom(res, error)) throw error
    }
  }))

  // ---- 72. GET /reconciliation ----
  router.get('/reconciliation', handle(async (req, res) => {
    const year = readYear(req, res)
    if (year === undefined) return
    const user = req.actor

    try {
      const sentinel = { createdBy: user, classification: 'biasa', status: 'submitted' }
      if (!(await budgetAuth(user, 'subbagren.anggaran.reconcile', sentinel))) {
        fail(res, 404, 'not_found')
        return
      }

      let pagus
      try {
        const { rows } = await pool.query(
          `${PAGU_COLUMNS} WHERE p.fiscal_year=$1 ORDER BY b.created_at DESC,b.id DESC LIMIT 201`,
          [year],
        )
        pagus = rows.map(mapPagu)
      } catch {
        fail(res, 503, 'unavailable')
        return
      }

      const totals = new Map()
      let limited = pagus.length > 200

      for (let i = 0; i < pagus.length && i < 200; i += 1) {
        const b = pagus[i]
        const proposal = await budgetProposal(b.proposalId)
        if (!proposal) {
          fail(res, 503, 'unavailable')
          return
        }
        if (!(await permitted(user, 'subbagren.usulan.read', proposal))) continue
        if (!(await permitted(user, 'subbagren.anggaran.read', proposal))) continue

        const unit = proposal.sourceUnit
        let counters = totals.get(unit)
        if (!counters) {
          counters = { pagu: 0n, verified: 0n, pending: 0, rejected: 0, missing: 0, waiting: 0, declined: 0 }
          totals.set(unit, counters)
        }
        if (b.status === 'verified') counters.pagu += BigInt(b.amount)

        let rows
        try {
          const result = await pool.query(
            `SELECT t.amount,t.status,
                    COALESCE((SELECT ee.status FROM sdl_subbagren_evidence ee
                               WHERE ee.realisasi_id=t.id ORDER BY ee.created_at DESC,ee.id DESC LIMIT 1),'missing') AS proof
               FROM sdl_subbagren_realisasi t WHERE t.pagu_id=$1
              ORDER BY t.created_at DESC,t.id DESC LIMIT 201`,
            [b.id],
          )
          rows = result.rows
        } catch {
          fail(res, 503, 'unavailable')
          return
        }

        for (let n = 0; n < rows.length; n += 1) {
          // Baris ke-201 hanya menandai bahwa data terpotong; ia tidak dihitung.
          if (n + 1 > 200) {
            limited = true
            break
          }
          const row = rows[n]
          if (row.status === 'verified') counters.verified += BigInt(row.amount)
          if (row.status === 'pending') counters.pending += 1
          if (row.status === 'rejected') counters.rejected += 1
          if (row.proof === 'missing') counters.missing += 1
          if (row.proof === 'pending') counters.waiting += 1
          if (row.proof === 'rejected') counters.declined += 1
        }
      }

      const units = [...totals.keys()].sort().map((unit) => {
        const c = totals.get(unit)
        return {
          unit,
          paguVerified: String(c.pagu),
          realizationVerified: String(c.verified),
          pendingTransactions: c.pending,
          rejectedTransactions: c.rejected,
          missingEvidence: c.missing,
          pendingEvidence: c.waiting,
          rejectedEvidence: c.declined,
        }
      })

      respond(res, 200, {
        basis: 'verified_only_scoped',
        limited,
        note: 'Requires original-source reconciliation and external DIPA/SP2D validation',
        officialLRA: false,
        units,
        year,
      })
    } catch (error) {
      if (!failFrom(res, error)) {
        fail(res, 503, 'unavailable')
      }
    }
  }))

  // ---- 62. GET / ----
  router.get('/', handle(async (req, res) => {
    const year = readYear(req, res)
    if (year === undefined) return
    const user = req.actor

    try {
      // Gagal tertutup bahkan saat tidak ada record: dasbor kosong tidak boleh
      // jadi cara menyimpulkan apa pun bagi aktor yang tidak berhak.
      const sentinel = { createdBy: user, classification: 'biasa', status: 'submitted' }
      if (!(await permitted(user, 'subbagren.anggaran.read', sentinel))) {
        fail(res, 403, 'access_denied')
        return
      }

      let pagus
      try {
        const { rows } = await pool.query(
          `${PAGU_COLUMNS} WHERE p.fiscal_year=$1 ORDER BY b.created_at DESC LIMIT 201`,
          [year],
        )
        pagus = rows.map(mapPagu)
      } catch {
        fail(res, 503, 'unavailable')
        return
      }

      const items = []
      const realizations = []
      let totalPagu = 0n
      let totalUsed = 0n

      for (const pagu of pagus) {
        const proposal = await budgetProposal(pagu.proposalId)
        if (!proposal) {
          fail(res, 503, 'unavailable')
          return
        }
        if (!(await permitted(user, 'subbagren.usulan.read', proposal))) continue
        if (!(await permitted(user, 'subbagren.anggaran.read', proposal))) continue

        let used
        let children
        try {
          const sum = await pool.query(
            "SELECT COALESCE(SUM(amount),0)::bigint AS used FROM sdl_subbagren_realisasi WHERE pagu_id=$1 AND status='verified'",
            [pagu.id],
          )
          used = BigInt(sum.rows[0].used)
          const result = await pool.query(
            `${REALISASI_COLUMNS} WHERE t.pagu_id=$1 ORDER BY t.created_at DESC LIMIT 201`,
            [pagu.id],
          )
          children = result.rows
        } catch {
          fail(res, 503, 'unavailable')
          return
        }

        for (const row of children) {
          if (realizations.length < 200) realizations.push(mapRealisasi(row))
        }

        pagu.verifiedRealization = String(used)
        pagu.remaining = '0'
        if (pagu.status === 'verified') {
          const amount = BigInt(pagu.amount)
          pagu.remaining = String(amount - used)
          totalPagu += amount
          totalUsed += used
        }
        items.push(pagu)
      }

      respond(res, 200, {
        basis: 'verified_only',
        limited: pagus.length === 201 || realizations.length >= 200,
        note: 'evidence_files_require_independent_review; reconciliation_not_official_LRA',
        pagus: items,
        realizations,
        totals: {
          paguVerified: String(totalPagu),
          realizationVerified: String(totalUsed),
          remaining: String(totalPagu - totalUsed),
        },
        year,
      })
    } catch (error) {
      if (!failFrom(res, error)) {
        fail(res, 503, 'unavailable')
      }
    }
  }))

  // ---- 64. POST /pagu ----
  router.post('/pagu', json, handle(async (req, res) => {
    const decoded = typedDecode(req, PAGU_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const input = decoded.value
    const date = parseDateOnly(input.authorizationDate)
    const tomorrow = Date.now() + 24 * 60 * 60 * 1000
    if (
      !amountOk(input.amount) ||
      !textOk(input.authorizationNumber, 6, 160) ||
      !textOk(input.authorizationIssuer, 5, 160) ||
      !validReason(input.reason) ||
      date === undefined || date.getTime() > tomorrow
    ) {
      fail(res, 400, 'invalid_input')
      return
    }

    const user = req.actor
    try {
      const proposal = await budgetProposal(input.proposalId)
      if (!proposal) {
        fail(res, 404, 'not_found')
        return
      }
      if (!(await budgetAuth(user, 'subbagren.anggaran.pagu.register', proposal))) {
        fail(res, 404, 'not_found')
        return
      }
      if (proposal.status !== 'submitted') {
        fail(res, 409, 'proposal_not_submitted')
        return
      }
      // Pagu hanya boleh berdiri di atas usulan yang sudah lolos review internal.
      const review = await loadReviewCase(pool, proposal.id)
      if (review.status !== 'approved') {
        fail(res, 409, 'internal_review_required')
        return
      }

      let outcome
      try {
        outcome = await withTransaction(pool, async (client) => {
          const inserted = await client.query(
            `INSERT INTO sdl_subbagren_pagu(proposal_id,amount,authorization_number,authorization_issuer,authorization_date,created_by)
             VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(proposal_id) DO NOTHING RETURNING id::text AS id`,
            [proposal.id, input.amount, input.authorizationNumber.trim(),
              input.authorizationIssuer.trim(), input.authorizationDate, user],
          )
          // ON CONFLICT DO NOTHING tidak mengembalikan baris: satu usulan hanya
          // boleh punya satu pagu.
          if (inserted.rows.length === 0) return { kind: 'duplicate' }

          const id = inserted.rows[0].id
          await budgetEvent(client, 'pagu', id, user, 'registered', input.reason)
          return { kind: 'ok', id }
        })
      } catch {
        fail(res, 503, 'unavailable')
        return
      }

      if (outcome.kind === 'duplicate') {
        fail(res, 409, 'pagu_already_registered')
        return
      }
      respond(res, 201, {
        id: outcome.id,
        note: 'requires_independent_document_verification',
        status: 'pending',
      })
    } catch (error) {
      if (!failFrom(res, error)) throw error
    }
  }))

  // ---- 65. POST /pagu/:id/review ----
  router.post('/pagu/:id/review', json, handle(async (req, res) => {
    const decoded = typedDecode(req, CHECK_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const input = decoded.value
    if (
      input.version < 1 || !validReason(input.reason) ||
      (input.decision !== 'verified' && input.decision !== 'rejected')
    ) {
      fail(res, 400, 'invalid_input')
      return
    }

    const id = req.params.id
    const user = req.actor

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const locked = await client.query(
          `SELECT proposal_id::text AS proposal_id,created_by::text AS created_by,status,version
             FROM sdl_subbagren_pagu WHERE id::text=$1 FOR UPDATE`,
          [id],
        )
        if (locked.rows.length === 0) return { kind: 'not_found' }
        const row = locked.rows[0]

        const proposal = await budgetProposal(row.proposal_id)
        if (!proposal) return { kind: 'unavailable' }
        if (!(await budgetAuth(user, 'subbagren.anggaran.pagu.verify', proposal))) {
          return { kind: 'not_found' }
        }
        // Maker-checker: pendaftar pagu tidak boleh memverifikasi pagunya sendiri.
        if (row.created_by === user) return { kind: 'self' }

        const version = Number(row.version)
        if (row.status !== 'pending' || version !== input.version) return { kind: 'conflict' }

        await client.query(
          `UPDATE sdl_subbagren_pagu SET status=$1,reviewed_by=$2,review_reason=$3,reviewed_at=now(),version=version+1
            WHERE id::text=$4`,
          [input.decision, user, input.reason.trim(), id],
        )
        await budgetEvent(client, 'pagu', id, user, input.decision, input.reason)
        return { kind: 'ok', version: version + 1 }
      })
    } catch (error) {
      if (!failFrom(res, error)) {
        fail(res, 503, 'unavailable')
      }
      return
    }

    if (outcome.kind === 'not_found') {
      fail(res, 404, 'not_found')
      return
    }
    if (outcome.kind === 'unavailable') {
      fail(res, 503, 'unavailable')
      return
    }
    if (outcome.kind === 'self') {
      fail(res, 403, 'self_verification_denied')
      return
    }
    if (outcome.kind === 'conflict') {
      fail(res, 409, 'version_or_status_conflict')
      return
    }
    respond(res, 200, { id, status: input.decision, version: outcome.version })
  }))

  // ---- 66. POST /realisasi ----
  router.post('/realisasi', json, handle(async (req, res) => {
    const decoded = typedDecode(req, REALISASI_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const input = decoded.value
    const date = parseDateOnly(input.transactionDate)
    if (
      !amountOk(input.amount) ||
      date === undefined || date.getTime() > Date.now() ||
      !textOk(input.evidenceReference, 8, 200) ||
      !textOk(input.description, 8, 500) ||
      !validReason(input.reason)
    ) {
      fail(res, 400, 'invalid_input')
      return
    }

    const user = req.actor
    try {
      const pagu = await paguById(input.paguId)
      if (!pagu) {
        fail(res, 404, 'not_found')
        return
      }
      const proposal = await budgetProposal(pagu.proposalId)
      if (!proposal) {
        fail(res, 503, 'unavailable')
        return
      }
      if (!(await budgetAuth(user, 'subbagren.anggaran.realisasi.record', proposal))) {
        fail(res, 404, 'not_found')
        return
      }
      if (pagu.status !== 'verified') {
        fail(res, 409, 'pagu_not_verified')
        return
      }
      // Transaksi harus jatuh di tahun anggaran pagunya.
      if (date.getUTCFullYear() !== pagu.fiscalYear) {
        fail(res, 400, 'transaction_year_mismatch')
        return
      }

      let id
      try {
        id = await withTransaction(pool, async (client) => {
          const inserted = await client.query(
            `INSERT INTO sdl_subbagren_realisasi(pagu_id,amount,transaction_date,evidence_reference,description,created_by)
             VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text AS id`,
            [pagu.id, input.amount, input.transactionDate, input.evidenceReference.trim(),
              input.description.trim(), user],
          )
          const newId = inserted.rows[0].id
          await budgetEvent(client, 'realisasi', newId, user, 'recorded', input.reason)
          return newId
        })
      } catch {
        fail(res, 503, 'unavailable')
        return
      }

      respond(res, 201, { id, note: 'not_in_verified_realization', status: 'pending' })
    } catch (error) {
      if (!failFrom(res, error)) throw error
    }
  }))

  // ---- 67. POST /realisasi/:id/review ----
  router.post('/realisasi/:id/review', json, handle(async (req, res) => {
    const decoded = typedDecode(req, CHECK_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const input = decoded.value
    if (
      input.version < 1 || !validReason(input.reason) ||
      (input.decision !== 'verified' && input.decision !== 'rejected')
    ) {
      fail(res, 400, 'invalid_input')
      return
    }

    const id = req.params.id
    const user = req.actor

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const parent = await client.query(
          'SELECT pagu_id::text AS pagu_id FROM sdl_subbagren_realisasi WHERE id::text=$1',
          [id],
        )
        if (parent.rows.length === 0) return { kind: 'not_found' }
        const paguId = parent.rows[0].pagu_id

        // Pagu dikunci LEBIH DULU. Reviewer yang berjalan bersamaan menyerialkan
        // diri pada baris itu, dan urutan ini sama dengan evidenceReview.
        const paguRow = await client.query(
          'SELECT proposal_id::text AS proposal_id,status,amount FROM sdl_subbagren_pagu WHERE id::text=$1 FOR UPDATE',
          [paguId],
        )
        if (paguRow.rows.length === 0) return { kind: 'unavailable' }
        const paguStatus = paguRow.rows[0].status
        const paguAmount = BigInt(paguRow.rows[0].amount)

        const proposal = await budgetProposal(paguRow.rows[0].proposal_id)
        if (!proposal) return { kind: 'unavailable' }
        if (!(await budgetAuth(user, 'subbagren.anggaran.realisasi.verify', proposal))) {
          return { kind: 'not_found' }
        }

        const locked = await client.query(
          'SELECT amount,status,created_by::text AS created_by,version FROM sdl_subbagren_realisasi WHERE id::text=$1 FOR UPDATE',
          [id],
        )
        if (locked.rows.length === 0) return { kind: 'unavailable' }
        const row = locked.rows[0]
        const amount = BigInt(row.amount)
        const version = Number(row.version)

        if (row.created_by === user) return { kind: 'self' }
        if (row.status !== 'pending' || version !== input.version) return { kind: 'conflict' }
        if (paguStatus !== 'verified') return { kind: 'pagu_unverified' }

        if (input.decision === 'verified') {
          // Bukti yang disetujui secara independen wajib ada. Transaksi yang
          // sudah terverifikasi sebelumnya tidak pernah diubah surut.
          const approved = await client.query(
            "SELECT body,sha256 FROM sdl_subbagren_evidence WHERE realisasi_id=$1 AND status='approved'",
            [id],
          )
          if (approved.rows.length === 0) return { kind: 'evidence_required' }

          // Integritas diperiksa ULANG di sini, tidak dipercaya dari saat unggah.
          let plain
          try {
            plain = openEvidence(evidenceKey, approved.rows[0].body)
          } catch {
            return { kind: 'integrity' }
          }
          if (sha256Hex(plain) !== approved.rows[0].sha256) return { kind: 'integrity' }

          const sum = await client.query(
            "SELECT COALESCE(SUM(amount),0)::bigint AS used FROM sdl_subbagren_realisasi WHERE pagu_id=$1 AND status='verified'",
            [paguId],
          )
          const used = BigInt(sum.rows[0].used)
          if (used > paguAmount || amount > paguAmount - used) return { kind: 'insufficient' }
        }

        await client.query(
          `UPDATE sdl_subbagren_realisasi SET status=$1,reviewed_by=$2,review_reason=$3,reviewed_at=now(),version=version+1
            WHERE id::text=$4`,
          [input.decision, user, input.reason.trim(), id],
        )
        await budgetEvent(client, 'realisasi', id, user, input.decision, input.reason)
        return { kind: 'ok', version: version + 1 }
      })
    } catch (error) {
      if (!failFrom(res, error)) {
        fail(res, 503, 'unavailable')
      }
      return
    }

    const conflicts = {
      conflict: 'version_or_status_conflict',
      pagu_unverified: 'pagu_not_verified',
      evidence_required: 'approved_evidence_required',
      integrity: 'evidence_integrity_failure',
      insufficient: 'insufficient_remaining_pagu',
    }
    if (outcome.kind === 'not_found') {
      fail(res, 404, 'not_found')
      return
    }
    if (outcome.kind === 'unavailable') {
      fail(res, 503, 'unavailable')
      return
    }
    if (outcome.kind === 'self') {
      fail(res, 403, 'self_verification_denied')
      return
    }
    if (conflicts[outcome.kind]) {
      fail(res, 409, conflicts[outcome.kind])
      return
    }
    respond(res, 200, { id, status: input.decision, version: outcome.version })
  }))

  // ---- 68. GET /realisasi/:id/evidence ----
  router.get('/realisasi/:id/evidence', handle(async (req, res) => {
    const id = req.params.id
    try {
      const auth = await evidenceAuth(req.actor, 'subbagren.anggaran.bukti.read', id)
      if (!auth.ok) {
        fail(res, auth.status, auth.code)
        return
      }

      const { rows } = await pool.query(
        `SELECT id::text AS id,realisasi_id::text AS realisasi_id,filename,mime_type,size_bytes,sha256,status,
                uploaded_by::text AS uploaded_by,reviewer_id::text AS reviewer_id,review_reason,version,created_at
           FROM sdl_subbagren_evidence WHERE realisasi_id=$1 ORDER BY created_at DESC,id DESC LIMIT 11`,
        [id],
      )
      // Go mengembalikan ke-11 baris apa adanya dan hanya MENANDAI bahwa
      // daftarnya terpotong; ia tidak memangkas ke 10.
      const items = rows.map(mapEvidence)
      respond(res, 200, { items, limited: items.length > 10 })
    } catch (error) {
      if (!failFrom(res, error)) {
        fail(res, 503, 'unavailable')
      }
    }
  }))

  // ---- 69. POST /realisasi/:id/evidence ----
  router.post('/realisasi/:id/evidence', handle(async (req, res) => {
    const id = req.params.id
    const user = req.actor

    let parent
    try {
      const auth = await evidenceAuth(user, 'subbagren.anggaran.bukti.upload', id)
      if (!auth.ok) {
        fail(res, auth.status, auth.code)
        return
      }
      parent = auth.item
    } catch (error) {
      if (!failFrom(res, error)) {
        fail(res, 503, 'unavailable')
      }
      return
    }

    if (parent.status !== 'pending') {
      fail(res, 409, 'realization_not_pending')
      return
    }

    // Body baru dibaca SETELAH otorisasi lolos, sama seperti di Go.
    const upload = await readSingleFile(req, {
      fieldName: 'file',
      maxBodyBytes: MAX_EVIDENCE_BYTES + 65536,
      maxFileBytes: MAX_EVIDENCE_BYTES,
      maxFiles: 2,
    })

    if (upload.bodyExceeded) {
      fail(res, 413, 'invalid_upload')
      return
    }

    const reason = upload.fields?.reason ?? ''
    if (!validReason(reason)) {
      fail(res, 400, 'invalid_reason')
      return
    }
    if (upload.fileCount !== 1) {
      fail(res, 400, 'one_file_required')
      return
    }
    if (upload.error === 'too_large') {
      fail(res, 413, 'file_too_large')
      return
    }
    if (!upload.file) {
      fail(res, 400, 'file_required')
      return
    }

    const blob = upload.file.buffer
    const filename = upload.file.filename.trim()
    const media = await validateEvidence(filename, blob)
    if (!media) {
      fail(res, 400, 'invalid_file_type')
      return
    }

    const digest = sha256Hex(blob)
    let sealed
    try {
      sealed = sealEvidence(evidenceKey, blob)
    } catch {
      fail(res, 503, 'evidence_encryption_unavailable')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const locked = await client.query(
          'SELECT status FROM sdl_subbagren_realisasi WHERE id=$1 FOR UPDATE',
          [id],
        )
        if (locked.rows.length === 0) return { kind: 'unavailable' }
        if (locked.rows[0].status !== 'pending') return { kind: 'not_pending' }

        // Dua unggahan bersamaan tidak boleh sama-sama menjadi bukti aktif.
        const active = await client.query(
          "SELECT EXISTS(SELECT 1 FROM sdl_subbagren_evidence WHERE realisasi_id=$1 AND status IN ('pending','approved')) AS active",
          [id],
        )
        if (active.rows[0].active) return { kind: 'active_exists' }

        const inserted = await client.query(
          `INSERT INTO sdl_subbagren_evidence(realisasi_id,uploaded_by,filename,mime_type,size_bytes,sha256,body)
           VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text AS id`,
          [id, user, filename, media, blob.length, digest, sealed],
        )
        const proofId = inserted.rows[0].id
        await evidenceEvent(client, proofId, user, 'uploaded', reason)
        return { kind: 'ok', id: proofId }
      })
    } catch {
      fail(res, 503, 'unavailable')
      return
    }

    if (outcome.kind === 'unavailable') {
      fail(res, 503, 'unavailable')
      return
    }
    if (outcome.kind === 'not_pending') {
      fail(res, 409, 'realization_not_pending')
      return
    }
    if (outcome.kind === 'active_exists') {
      fail(res, 409, 'active_evidence_exists')
      return
    }
    respond(res, 201, {
      id: outcome.id,
      note: 'file_private_independent_review_required',
      sha256: digest,
      status: 'pending',
    })
  }))

  // ---- 70. GET /realisasi/:id/evidence/:proofId/download ----
  router.get('/realisasi/:id/evidence/:proofId/download', handle(async (req, res) => {
    const { id, proofId } = req.params
    const user = req.actor

    try {
      const auth = await evidenceAuth(user, 'subbagren.anggaran.bukti.read', id)
      if (!auth.ok) {
        fail(res, auth.status, auth.code)
        return
      }
    } catch (error) {
      if (!failFrom(res, error)) {
        fail(res, 503, 'unavailable')
      }
      return
    }

    let row
    try {
      const { rows } = await pool.query(
        'SELECT filename,mime_type,sha256,body FROM sdl_subbagren_evidence WHERE id=$1 AND realisasi_id=$2',
        [proofId, id],
      )
      if (rows.length === 0) {
        fail(res, 404, 'not_found')
        return
      }
      row = rows[0]
    } catch {
      // id yang bukan UUID membuat pembandingan gagal di Postgres, bukan 404.
      fail(res, 503, 'unavailable')
      return
    }

    let plain
    try {
      plain = openEvidence(evidenceKey, row.body)
    } catch {
      fail(res, 503, 'evidence_integrity_failure')
      return
    }
    if (sha256Hex(plain) !== row.sha256) {
      fail(res, 503, 'evidence_integrity_failure')
      return
    }

    // Setiap unduhan tercatat. Tidak ada URL publik untuk berkas ini.
    try {
      await withTransaction(pool, async (client) => {
        await evidenceEvent(client, proofId, user, 'downloaded', 'Authorized file download')
      })
    } catch {
      fail(res, 503, 'unavailable')
      return
    }

    res.set('Content-Type', 'application/octet-stream')
    res.set('Content-Disposition', contentDisposition('attachment', row.filename))
    res.set('X-Content-Type-Options', 'nosniff')
    res.set('Content-Security-Policy', 'sandbox')
    res.set('Cache-Control', 'no-store')
    res.status(200).end(plain)
  }))

  // ---- 71. POST /realisasi/:id/evidence/:proofId/review ----
  router.post('/realisasi/:id/evidence/:proofId/review', json, handle(async (req, res) => {
    const decoded = typedDecode(req, EVIDENCE_REVIEW_SCHEMA)
    if (!decoded.ok) {
      fail(res, 400, 'invalid_body')
      return
    }
    const input = decoded.value
    if (
      input.version < 1 ||
      (input.decision !== 'approved' && input.decision !== 'rejected') ||
      !validReason(input.reason)
    ) {
      fail(res, 400, 'invalid_input')
      return
    }

    const { id, proofId } = req.params
    const user = req.actor

    // Otorisasi SEBELUM penguncian; grant diperiksa hidup untuk setiap mutasi.
    try {
      const auth = await evidenceAuth(user, 'subbagren.anggaran.bukti.verify', id)
      if (!auth.ok) {
        fail(res, auth.status, auth.code)
        return
      }
    } catch (error) {
      if (!failFrom(res, error)) {
        fail(res, 503, 'unavailable')
      }
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const parent = await client.query(
          'SELECT pagu_id::text AS pagu_id FROM sdl_subbagren_realisasi WHERE id=$1',
          [id],
        )
        if (parent.rows.length === 0) return { kind: 'unavailable' }

        // Urutan kunci sama dengan verifikasi realisasi: pagu -> realisasi -> bukti.
        const pagu = await client.query(
          'SELECT status FROM sdl_subbagren_pagu WHERE id=$1 FOR UPDATE',
          [parent.rows[0].pagu_id],
        )
        if (pagu.rows.length === 0) return { kind: 'unavailable' }

        const realisasi = await client.query(
          'SELECT status,created_by::text AS created_by FROM sdl_subbagren_realisasi WHERE id=$1 FOR UPDATE',
          [id],
        )
        if (realisasi.rows.length === 0) return { kind: 'unavailable' }

        if (realisasi.rows[0].status !== 'pending' || pagu.rows[0].status !== 'verified') {
          return { kind: 'not_pending' }
        }

        const locked = await client.query(
          `SELECT status,uploaded_by::text AS uploaded_by,version,sha256,body
             FROM sdl_subbagren_evidence WHERE id=$1 AND realisasi_id=$2 FOR UPDATE`,
          [proofId, id],
        )
        if (locked.rows.length === 0) return { kind: 'not_found' }
        const row = locked.rows[0]
        const version = Number(row.version)

        // Pengunggah bukti DAN pencatat realisasinya sama-sama tidak boleh
        // menjadi pemeriksa.
        if (row.uploaded_by === user || realisasi.rows[0].created_by === user) return { kind: 'self' }
        if (row.status !== 'pending' || version !== input.version) return { kind: 'conflict' }

        if (input.decision === 'approved') {
          let plain
          try {
            plain = openEvidence(evidenceKey, row.body)
          } catch {
            return { kind: 'integrity' }
          }
          if (sha256Hex(plain) !== row.sha256) return { kind: 'integrity' }
        }

        await client.query(
          `UPDATE sdl_subbagren_evidence SET status=$1,reviewer_id=$2,review_reason=$3,reviewed_at=now(),version=version+1
            WHERE id=$4`,
          [input.decision, user, input.reason.trim(), proofId],
        )
        await evidenceEvent(client, proofId, user, input.decision, input.reason)
        return { kind: 'ok', version: version + 1 }
      })
    } catch (error) {
      if (!failFrom(res, error)) {
        fail(res, 503, 'unavailable')
      }
      return
    }

    if (outcome.kind === 'unavailable') {
      fail(res, 503, 'unavailable')
      return
    }
    if (outcome.kind === 'not_found') {
      fail(res, 404, 'not_found')
      return
    }
    if (outcome.kind === 'self') {
      fail(res, 403, 'self_verification_denied')
      return
    }
    if (outcome.kind === 'not_pending') {
      fail(res, 409, 'realization_not_pending')
      return
    }
    if (outcome.kind === 'conflict') {
      fail(res, 409, 'version_or_status_conflict')
      return
    }
    if (outcome.kind === 'integrity') {
      fail(res, 409, 'evidence_integrity_failure')
      return
    }
    respond(res, 200, { id: proofId, status: input.decision, version: outcome.version })
  }))

  return router
}
