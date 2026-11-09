import { evaluateForUser } from '../../access/database.js'
import { parsePayload } from '../../http/payload.js'
import { writeJson } from '../../http/respond.js'

/**
 * Helper bersama paket subbagren, padanan bagian atas usulan.go yang dipakai
 * ulang oleh budget.go dan evidence.go. Di Go ketiganya satu package; di sini
 * berkasnya terpisah, jadi yang dipakai bersama dikumpulkan di satu tempat
 * supaya logika otorisasinya tidak pernah ada dua salinan.
 */

/** Semua respons paket ini memakai Cache-Control: no-store (usulan.go:79). */
export function respond(res, status, body) {
  res.set('Cache-Control', 'no-store')
  writeJson(res, status, body)
}

export function fail(res, status, code) {
  respond(res, status, { error: code })
}

/** Padanan textOK: panjang setelah trim, dihitung per rune. */
export function textOk(value, min, max) {
  if (typeof value !== 'string') return false
  const length = [...value.trim()].length
  return length >= min && length <= max
}

export function validReason(value) {
  return textOk(value, 8, 500)
}

/**
 * Padanan strconv.Atoi. Sengaja lebih ketat daripada Number(): Atoi menolak
 * spasi di tepi, notasi heksadesimal, dan pecahan — Number() menerima
 * ketiganya dan akan membuat `?year=0x7e4` diam-diam berhasil.
 *
 * @returns {number|undefined} undefined kalau Atoi akan gagal
 */
export function parseGoInt(raw) {
  if (typeof raw !== 'string' || !/^[+-]?[0-9]+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

/**
 * Padanan validDate (budget.go:72): time.Parse("2006-01-02"), tahun 2020–2100,
 * dan hasil format ulang harus sama persis dengan masukan — yang menolak
 * tanggal bergulir seperti 2026-02-31.
 *
 * @returns {Date|undefined}
 */
export function parseDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return undefined
  if (parsed.toISOString().slice(0, 10) !== value) return undefined
  const year = parsed.getUTCFullYear()
  if (year < 2020 || year > 2100) return undefined
  return parsed
}

/** Padanan amountOK (budget.go:76). */
export function amountOk(value) {
  return value > 0 && value <= 1000000000000000
}

/**
 * Decode bertipe, padanan json.Decoder ber-DisallowUnknownFields terhadap
 * struct bertipe (usulan.go:88).
 *
 * Membedakan dua kegagalan yang Go juga bedakan, dan urutannya penting:
 *   - bentuk salah (field asing, tipe keliru)  -> 400 invalid_body
 *   - bentuk benar tapi nilainya di luar batas -> 400 invalid_input
 *
 * Field yang tidak ada atau bernilai null menjadi zero value tanpa error,
 * persis seperti encoding/json, sehingga validasilah yang menolaknya.
 */
export function typedDecode(req, schema) {
  const payload = parsePayload(req, Object.keys(schema))
  if (!payload.ok) return { ok: false }

  const out = {}
  for (const [field, kind] of Object.entries(schema)) {
    const raw = payload.value[field]
    if (raw === undefined || raw === null) {
      out[field] = kind === 'string' ? '' : 0
      continue
    }
    if (kind === 'string') {
      if (typeof raw !== 'string') return { ok: false }
      out[field] = raw
      continue
    }
    // Go menolak pecahan dan nilai di luar jangkauan int64 saat decode, bukan
    // saat validasi. MAX_SAFE_INTEGER dipakai sebagai pendekatan batas atas —
    // seluruh batas yang sesungguhnya jauh di bawahnya.
    if (typeof raw !== 'number' || !Number.isInteger(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) {
      return { ok: false }
    }
    out[field] = raw
  }
  return { ok: true, value: out }
}

export const PROPOSAL_COLUMNS = `SELECT id::text,number,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by::text,version,created_at,updated_at FROM sdl_subbagren_proposals`

export const PROPOSAL_RETURNING = `RETURNING id::text,number,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by::text,version,created_at,updated_at`

/**
 * Urutan field mengikuti deklarasi struct Proposal (usulan.go:30), bukan urutan
 * kolom SQL — encoding/json memakai urutan field untuk struct.
 *
 * reviewStatus dan revisionCount sengaja berisi nilai kosong di sini. Go hanya
 * mengisinya lewat decorateReview() pada list dan detail; create, update, dan
 * submit mengembalikan struct yang belum didekorasi, jadi "" dan 0 adalah
 * jawaban yang benar — bukan kelalaian.
 */
export function mapProposal(row) {
  return {
    id: row.id,
    number: Number(row.number),
    fiscalYear: row.fiscal_year,
    sourceUnit: row.source_unit,
    title: row.title,
    outputTarget: row.output_target,
    proposedBudget: Number(row.proposed_budget),
    classification: row.classification,
    status: row.status,
    reviewStatus: '',
    revisionCount: 0,
    createdBy: row.created_by,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * Kegagalan memastikan izin tidak pernah menjadi "boleh". Dilempar supaya
 * pemanggil memetakannya ke 503 authorization_unavailable, bukan ke 403 atau
 * 404 yang akan terbaca sebagai keputusan kebijakan.
 */
export class AuthzUnavailable extends Error {}

/** Memetakan AuthzUnavailable ke 503; selainnya dikembalikan ke pemanggil. */
export function failFrom(res, error) {
  if (error instanceof AuthzUnavailable) {
    fail(res, 503, 'authorization_unavailable')
    return true
  }
  return false
}

/**
 * Engine A untuk seluruh resource subbagren. Unit selalu 'subbagren': grant
 * berprefiks subbagren tidak pernah berlaku untuk unit lain (policy.js:47).
 */
export function createPermitted(pool) {
  return async function permitted(user, permission, p) {
    try {
      const decision = await evaluateForUser(
        pool, user, permission,
        { unit: 'subbagren', creatorId: p.createdBy, classification: p.classification, status: p.status },
        new Date(),
      )
      return decision.allow
    } catch {
      throw new AuthzUnavailable()
    }
  }
}

/** Padanan getReviewCase: baris yang belum ada berarti 'pending'. */
export async function loadReviewCase(runner, id, forUpdate = false) {
  const { rows } = await runner.query(
    `SELECT review_status,revision_count,has_revision FROM sdl_subbagren_review_cases
      WHERE proposal_id=$1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  )
  if (rows.length === 0) return { status: 'pending', revisionCount: 0, hasRevision: false }
  return {
    status: rows[0].review_status,
    revisionCount: rows[0].revision_count,
    hasRevision: rows[0].has_revision,
  }
}
