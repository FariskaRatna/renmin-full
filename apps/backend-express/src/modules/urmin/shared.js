import sharp from 'sharp'

import { evaluateForUser } from '../../access/database.js'
import { isDemoSuperadmin } from '../../access/devdemo.js'
import { detectFileType } from '../../http/multipart.js'
import { parsePayload } from '../../http/payload.js'
import { writeJson } from '../../http/respond.js'

/**
 * Helper bersama paket urmin, port dari internal/urmin/.
 *
 * Di Go incoming.go, r3b.go, r3c.go, r3d*.go, dan r5f7.go satu package, dan
 * helper di bawah ini dipakai lintas berkas tanpa perantara. Di sini berkasnya
 * terpisah per mount (`surat-masuk`, `distribution-inbox`, `dispositions`),
 * jadi bagian bersamanya dikumpulkan di sini — terutama `decision()` dan
 * `recipientEligible()`, yang menentukan hasil di tiga mount sekaligus dan
 * tidak boleh punya dua salinan.
 */

export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/** safeFilePattern (r3b.go:28). Jauh lebih ketat daripada modul lain. */
const SAFE_FILENAME_RE = /^[a-zA-Z0-9 _().-]{1,160}$/

export const MAX_ATTACHMENT_SIZE = 10 << 20

export function respond(res, status, body) {
  res.set('Cache-Control', 'no-store')
  writeJson(res, status, body)
}

export function fail(res, status, code) {
  respond(res, status, { error: code })
}

export function validText(value, min, max) {
  if (typeof value !== 'string') return false
  const length = [...value.trim()].length
  return length >= min && length <= max
}

export function validReason(value) {
  return validText(value, 8, 500)
}

/**
 * Padanan validDate: time.Parse("2006-01-02") plus format ulang yang harus
 * sama persis. Langkah kedua itu yang menolak tanggal bergulir seperti
 * 2026-02-31, yang justru diterima Date milik JS dengan digeser ke Maret.
 *
 * Berbeda dari parseDateOnly() di subbagren: di sini TIDAK ada batas tahun.
 */
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.toISOString().slice(0, 10) === value
}

/** Padanan validDateTimeLocal (r5f7.go:67): kosong sah, selain itu ketat. */
export function validDateTimeLocal(value) {
  if (value === '') return true
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false
  const [date, time] = value.split('T')
  if (!validDate(date)) return false
  const [hour, minute] = time.split(':').map(Number)
  return hour <= 23 && minute <= 59
}

export function validPayload(p) {
  return (
    validText(p.letterNumber, 3, 120) &&
    validText(p.sender, 3, 240) &&
    validText(p.subject, 3, 1000) &&
    validDate(p.letterDate) &&
    validDate(p.receivedDate) &&
    validReason(p.reason) &&
    (p.classification === 'biasa' || p.classification === 'penting') &&
    validDerajat(p.derajat)
  )
}

/**
 * Padanan validDerajat/normalizeDerajat (incoming.go:109).
 *
 * Kosong diterima dan berarti 'biasa', bukan 400: field ini baru, dan pemanggil
 * yang belum mengenalnya tidak boleh mendadak gagal. Normalisasi wajib sebelum
 * SQL karena string kosong melanggar CHECK constraint di migrasi 034.
 */
export function validDerajat(s) {
  return s === '' || s === 'biasa' || s === 'kilat'
}
export function normalizeDerajat(s) {
  return s === '' ? 'biasa' : s
}

/**
 * Decode bertipe, padanan readJSON ber-DisallowUnknownFields (incoming.go:83).
 * Hanya 'string' dan 'int' yang dibutuhkan paket ini.
 */
export function decodeTyped(req, schema) {
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
    if (typeof raw !== 'number' || !Number.isInteger(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) {
      return { ok: false }
    }
    out[field] = raw
  }
  return { ok: true, value: out }
}

export const INCOMING_COLUMNS = `SELECT id::text,agenda_no,letter_number,sender,letter_date::text AS letter_date,received_date::text AS received_date,subject,classification,derajat,status,created_by::text AS created_by,version,created_at,updated_at FROM sdl_urmin_incoming`

export const INCOMING_RETURNING = `RETURNING id::text,agenda_no,letter_number,sender,letter_date::text AS letter_date,received_date::text AS received_date,subject,classification,derajat,status,created_by::text AS created_by,version,created_at,updated_at`

/** Padanan struct Incoming (incoming.go:26). */
export function mapIncoming(row) {
  return {
    id: row.id,
    agendaNo: Number(row.agenda_no),
    letterNumber: row.letter_number,
    sender: row.sender,
    letterDate: row.letter_date,
    receivedDate: row.received_date,
    subject: row.subject,
    classification: row.classification,
    derajat: row.derajat,
    status: row.status,
    createdBy: row.created_by,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export const DELIVERY_SELECT = `SELECT d.id::text AS id,d.incoming_id::text AS incoming_id,i.agenda_no,
  i.letter_number,i.subject,i.classification,d.recipient_unit,d.recipient_user::text AS recipient_user,
  u.display_name,d.status,d.sent_at,d.received_at,d.reason
 FROM sdl_urmin_distributions d
 JOIN sdl_urmin_incoming i ON i.id=d.incoming_id
 JOIN sdl_users u ON u.id=d.recipient_user`

/** Padanan struct delivery (r3b.go:39). Dipakai mount surat-masuk DAN inbox. */
export function mapDelivery(row) {
  return {
    id: row.id,
    incomingId: row.incoming_id,
    agendaNo: Number(row.agenda_no),
    letterNumber: row.letter_number,
    subject: row.subject,
    classification: row.classification,
    unit: row.recipient_unit,
    recipient: row.recipient_user,
    recipientName: row.display_name,
    status: row.status,
    sentAt: row.sent_at,
    receivedAt: row.received_at ?? null,
    reason: row.reason,
  }
}

/** Padanan struct recipient (r3b.go:60). */
export function mapRecipient(row, unit) {
  return { id: row.id, name: row.name, unit }
}

/**
 * Padanan enqueueUrminEmail (r5f12_email.go:11).
 *
 * Perhatikan `t.unit_key='urmin'` di dalam SELECT: tugas disposisi di unit
 * LAIN tidak pernah menghasilkan email, dan itu bukan kelalaian — notifikasi
 * sengaja tidak bisa menyeberang unit. Tidak pernah menyimpan alamat email
 * maupun isi pesan, hanya rujukan.
 */
export async function enqueueUrminEmail(client, taskId, recipientId, event) {
  await client.query(
    `INSERT INTO sdl_urmin_email_outbox(task_id,recipient_user,event_key)
     SELECT t.id,$2::uuid,$3 FROM sdl_urmin_disposition_tasks t
      WHERE t.id=$1::uuid AND t.unit_key='urmin'
     ON CONFLICT(task_id,recipient_user,event_key) DO NOTHING`,
    [taskId, recipientId, event],
  )
}

/** Dilempar supaya kegagalan izin menjadi 503, bukan diam-diam "tidak boleh". */
export class AuthzUnavailable extends Error {}

/** Dilempar untuk kegagalan database biasa; dipetakan ke 503 unavailable. */
export class Unavailable extends Error {}

/**
 * Engine A untuk seluruh resource urmin. Unit selalu 'urmin': grant berprefiks
 * urmin tidak pernah berlaku untuk unit lain (policy.js).
 */
export function createDecision(pool) {
  return async function decision(user, permission, doc) {
    try {
      const result = await evaluateForUser(
        pool, user, permission,
        { unit: 'urmin', creatorId: doc.createdBy, classification: doc.classification, status: doc.status },
        new Date(),
      )
      return result.allow
    } catch {
      throw new AuthzUnavailable()
    }
  }
}

export async function loadIncoming(runner, id, forUpdate = false) {
  const { rows } = await runner.query(
    `${INCOMING_COLUMNS} WHERE id::text=$1${forUpdate ? ' FOR UPDATE' : ''}`,
    [id],
  )
  return rows.length === 0 ? undefined : mapIncoming(rows[0])
}

export async function addHistory(client, id, actor, action, from, to, reason, version) {
  await client.query(
    `INSERT INTO sdl_urmin_incoming_history(incoming_id,actor_id,action,from_status,to_status,reason,version)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [id, actor, action, from, to, reason, version],
  )
}

export async function audit(client, actor, event, id) {
  await client.query(
    `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id)
     VALUES($1,$2,'urmin.surat_masuk',$3)`,
    [actor, event, id],
  )
}

/**
 * Padanan recipientEligible (r3b.go:70).
 *
 * Distribusi beralamat BUKAN akses umum ke Urmin: penerima wajib punya grant
 * se-unit yang masih hidup DAN permission `urmin.distribusi.receive`. Scope
 * 'own' sengaja tidak diterima — hanya 'unit' dan 'assigned'.
 *
 * Superadmin ditolak dua kali: lewat devdemo di awal dan lewat NOT EXISTS di
 * SQL. Keduanya disengaja (R5F20B).
 */
const RECIPIENT_ELIGIBLE_SQL = `SELECT EXISTS(
 SELECT 1 FROM sdl_users u
 JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2
 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=uu.unit_key AND g.revoked_at IS NULL
   AND (g.expires_at IS NULL OR g.expires_at>now()) AND g.scope IN ('unit','assigned')
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active AND ro.role_key<>'superadmin'
 JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key='urmin.distribusi.receive'
 JOIN sdl_org_units ou ON ou.unit_key=uu.unit_key AND ou.is_active
 WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
 AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
 AND ($3='biasa' OR g.classification_limit='penting')
) AS ok`

export async function recipientEligible(pool, userId, unit, classification) {
  if (await isDemoSuperadmin(pool, userId)) return false
  if (!UUID_RE.test(userId ?? '') || !unit) return false
  const { rows } = await pool.query(RECIPIENT_ELIGIBLE_SQL, [userId, unit, classification])
  return rows[0].ok === true
}

/** Padanan recipientOf (r3b.go:90): distribusi TERAKHIR yang dialamatkan ke user. */
export async function recipientOf(pool, user, letterId, classification) {
  const { rows } = await pool.query(
    `SELECT recipient_unit FROM sdl_urmin_distributions
      WHERE incoming_id=$1 AND recipient_user=$2 ORDER BY sent_at DESC LIMIT 1`,
    [letterId, user],
  )
  if (rows.length === 0) return false
  return recipientEligible(pool, user, rows[0].recipient_unit, classification)
}

/**
 * Padanan validateFile (r3b.go:127).
 *
 * Tiga angka yang berbeda dari modul lain dan mudah tertukar: nama berkas
 * harus cocok pola ketat `[a-zA-Z0-9 _().-]{1,160}`, ekor PDF dicari di 2048
 * byte terakhir, dan batas piksel 20 juta.
 */
export async function validateFile(filename, blob) {
  const name = String(filename ?? '').trim()
  if (!SAFE_FILENAME_RE.test(name) || blob.length === 0 || blob.length > MAX_ATTACHMENT_SIZE) {
    return undefined
  }
  const detected = detectFileType(blob)
  const lower = name.toLowerCase()

  if (lower.endsWith('.pdf')) {
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

/**
 * Padanan kabagForIntake (r5f7.go:110).
 *
 * Menolak kalau Kabagrenmin yang memenuhi syarat BUKAN tepat satu orang —
 * nol maupun dua sama-sama gagal. Itu disengaja: intake tidak boleh menebak
 * ke siapa surat diajukan.
 */
export async function kabagForIntake(pool, classification) {
  const { rows } = await pool.query(
    `SELECT DISTINCT u.id::text AS id FROM sdl_users u
     JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key='urmin'
     JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key='urmin' AND g.role_key='br_kabagrenmin'
       AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
     JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
     WHERE u.is_active AND NOT u.must_change_password
       AND NOT EXISTS (SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
       AND ($1='biasa' OR g.classification_limit='penting') LIMIT 3`,
    [classification],
  )
  if (rows.length !== 1) return undefined
  const eligible = await recipientEligible(pool, rows[0].id, 'urmin', classification)
  return eligible ? rows[0].id : undefined
}

/**
 * Padanan r5f7DistributionAllowed (r5f7.go:505).
 *
 * Surat warisan R3B (tanpa baris intake) tetap boleh didistribusikan seperti
 * dulu — itu arti `return true` saat baris tidak ditemukan. Surat ber-intake
 * hanya boleh diteruskan oleh Kabagrenmin yang ditunjuk, dan hanya SESUDAH ia
 * menerima distribusinya. Surat berstatus 'recorded' atau 'draft' tidak pernah
 * boleh dipromosikan menjadi disposisi lewat UI distribusi lama.
 */
export async function distributionAllowed(pool, id, user, classification) {
  const { rows } = await pool.query(
    'SELECT route_status,kabag_recipient::text AS kabag FROM sdl_urmin_incoming_intake WHERE incoming_id=$1',
    [id],
  )
  if (rows.length === 0) return true
  const { route_status: status, kabag } = rows[0]
  if (status === 'recorded' || status === 'draft') return false
  if (status !== 'awaiting_kabag' || kabag === null || kabag !== user) return false

  const current = await kabagForIntake(pool, classification)
  if (current !== user) return false

  const received = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM sdl_urmin_distributions
       WHERE incoming_id=$1 AND recipient_user=$2 AND status='received') AS ok`,
    [id, user],
  )
  return received.rows[0].ok === true
}
