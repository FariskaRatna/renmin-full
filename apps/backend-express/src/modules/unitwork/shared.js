import { writeJson } from '../../http/respond.js'

/**
 * Helper bersama paket unitwork, port dari work.go:32-59.
 *
 * Semua respons modul ini memakai Cache-Control: no-store — berbeda dari
 * helper global, jadi tidak bisa dipakai bergantian.
 */
export function respond(res, status, body) {
  res.set('Cache-Control', 'no-store')
  writeJson(res, status, body)
}

export function fail(res, status, code) {
  respond(res, status, { error: code })
}

/**
 * Padanan sqlerr (work.go:67). pgx.ErrNoRows menjadi 404; error lain menjadi
 * 503. Di node-postgres "tidak ada baris" bukan error, jadi pemanggil harus
 * meneruskan NotFoundError secara eksplisit.
 */
export class NotFoundError extends Error {
  constructor() {
    super('not_found')
    this.name = 'NotFoundError'
  }
}

export class AccessDeniedError extends Error {
  constructor() {
    super('access_denied')
    this.name = 'AccessDeniedError'
  }
}

export function sqlError(res, error) {
  if (error instanceof NotFoundError) {
    fail(res, 404, 'not_found')
    return
  }
  fail(res, 503, 'database_unavailable')
}

/** Padanan lenOK: panjang setelah trim, dihitung per rune. */
export function lengthOk(value, min, max) {
  if (typeof value !== 'string') return false
  const length = [...value.trim()].length
  return length >= min && length <= max
}

export const VALID_CLASSIFICATIONS = new Set(['biasa', 'penting'])

/** Format tanggal yang diterima Go: time.Parse("2006-01-02", v). */
export function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  // Menolak tanggal yang bergulir, mis. 2026-02-31.
  return parsed.toISOString().slice(0, 10) === value
}

/** Padanan pemeriksaan digit polos di binfung/sumda: maks 8 digit, hanya 0-9. */
export function isPlainDigits(value, maxLength = 8) {
  return value.length <= maxLength && /^[0-9]+$/.test(value)
}

/** Format jam yang diterima Go: time.Parse("15:04", v). */
export function isTimeOfDay(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return false
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
}

export class OutgoingLockedError extends Error {
  constructor() {
    super('outgoing_locked')
    this.name = 'OutgoingLockedError'
  }
}

/**
 * Padanan lockOutgoingEditing (outgoing_review.go:272).
 *
 * Mengunci baris work-record, lalu menolak penyuntingan kalau surat keluar
 * pasangannya sudah melewati tahap draft/rejected. Record tanpa workflow
 * (agenda, arsip) dibiarkan lewat.
 *
 * Penguncian baris itu bukan formalitas: ia menyerialkan penyuntingan terhadap
 * submit yang berjalan bersamaan, sehingga tidak ada celah di antara
 * pemeriksaan tahap dan penulisan.
 */
export async function lockOutgoingEditing(client, workRecordId) {
  const locked = await client.query(
    'SELECT id::text AS id FROM sdl_unit_work_records WHERE id::text=$1 AND deleted_at IS NULL FOR UPDATE',
    [workRecordId],
  )
  if (locked.rows.length === 0) throw new NotFoundError()

  const { rows } = await client.query(
    `SELECT o.stage FROM sdl_urmin_registry s
       JOIN sdl_outgoing_workflows o ON o.register_id=s.id
      WHERE s.work_record_id::text=$1 AND s.kind='surat_keluar' AND s.deleted_at IS NULL`,
    [workRecordId],
  )
  if (rows.length === 0) return

  const stage = rows[0].stage
  if (stage !== 'draft' && stage !== 'rejected') throw new OutgoingLockedError()
}
