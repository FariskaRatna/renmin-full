import { parsePayload } from '../../http/payload.js'
import { writeJson } from '../../http/respond.js'

/**
 * Helper bersama paket directives, port dari apps/backend/internal/directives/.
 * Di Go api.go, draft.go, dan attachments.go satu package sehingga helper-nya
 * dipakai bersama begitu saja; di sini berkasnya terpisah, jadi bagian bersama
 * dikumpulkan di satu tempat — terutama isKabag(), yang menentukan lolos atau
 * tidaknya 10 dari 18 endpoint dan tidak boleh punya dua salinan.
 */

export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

export function respond(res, status, body) {
  res.set('Cache-Control', 'no-store')
  writeJson(res, status, body)
}

/**
 * Padanan deny() (api.go:63). Kode error dipetakan dari status lewat map
 * literal, dan **peta itu tidak memuat 413**.
 *
 * Di Go, kunci yang tidak ada mengembalikan zero value, jadi `deny(w, 413)`
 * pada unggahan berkas yang kebesaran menghasilkan body `{"error":""}` —
 * error string kosong, bukan "payload_too_large". Itu terlihat seperti
 * kelalaian, tapi ia bagian kontrak yang sedang beku. Direplikasi apa adanya;
 * catat di DEVIATIONS.md, jangan diperbaiki di sini.
 */
const DENY_CODES = {
  400: 'invalid_request',
  403: 'access_denied',
  404: 'not_found',
  409: 'conflict',
  503: 'unavailable',
}

export function deny(res, status) {
  respond(res, status, { error: DENY_CODES[status] ?? '' })
}

/** draft_conflict punya bentuk sendiri, di luar peta deny(). */
export function draftConflict(res) {
  respond(res, 409, { error: 'draft_conflict' })
}

/**
 * Padanan validText (api.go:85). Perhatikan ketidaksimetrisannya, dan ia
 * disengaja: batas BAWAH dihitung dari string yang sudah di-trim, batas ATAS
 * dari string aslinya. Judul berisi 200 spasi lalu "abc" karena itu ditolak
 * oleh batas atas, bukan lolos karena trim-nya pendek.
 */
export function validText(value, min, max) {
  if (typeof value !== 'string') return false
  return [...value.trim()].length >= min && [...value].length <= max
}

const KINDS = ['umum', 'persuratan', 'sprint', 'lainnya']
const PRIORITIES = ['biasa', 'penting', 'kilat']

export function validKind(value) {
  return KINDS.includes(value)
}

export function validPriority(value) {
  return PRIORITIES.includes(value)
}

/**
 * Padanan uniqueRecipients (api.go:88): 1–10 UUID, tanpa duplikat, dibanding
 * setelah di-lowercase sehingga UUID yang sama dengan beda kapitalisasi tetap
 * terhitung ganda.
 */
export function uniqueRecipients(ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 10) return false
  const seen = new Set()
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return false
    const key = id.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

/** Padanan uniqueRecipients untuk draf: 0–10 diperbolehkan (draft.go:46). */
export function uniqueDraftRecipients(ids) {
  if (!Array.isArray(ids) || ids.length > 10) return false
  const seen = new Set()
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) return false
    const key = id.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
  }
  return true
}

/**
 * SQL isKabag (api.go:125), disalin verbatim.
 *
 * Ia TIDAK memakai Engine A maupun Engine B — ini pemeriksaan ad-hoc ketiga,
 * dan satu-satunya di seluruh codebase yang menuntut grant `br_kabagrenmin`
 * aktif secara langsung. Superadmin dikecualikan secara eksplisit di baris
 * terakhir, jadi ia tidak pernah mewarisi wewenang menerbitkan arahan bahkan
 * dalam mode demo.
 */
const IS_KABAG_SQL = `SELECT EXISTS(
  SELECT 1 FROM sdl_users u
    JOIN sdl_access_grants g ON g.user_id=u.id AND g.role_key='br_kabagrenmin'
      AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
    JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
    JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=g.unit_key
    JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active
   WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password
     AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sa WHERE sa.user_id=u.id AND sa.role_key='superadmin')
) AS yes`

/**
 * Kegagalan memeriksa wewenang tidak pernah menjadi "boleh". Dilempar supaya
 * pemanggil memetakannya ke 503, bukan ke 403 yang akan terbaca sebagai
 * keputusan kebijakan.
 */
export class KabagUnavailable extends Error {}

export async function isKabag(runner, userId) {
  try {
    const { rows } = await runner.query(IS_KABAG_SQL, [userId])
    return rows[0].yes === true
  } catch {
    throw new KabagUnavailable()
  }
}

/**
 * SQL letterLinkAllowed (api.go), disalin verbatim.
 *
 * Sebuah arahan boleh menyebut surat masuk yang memicunya, tapi hanya surat
 * yang memang dirutekan ke Kabagrenmin ini DAN sudah ia terima. Dua fakta itu
 * sama persis dengan yang menjaga penerusan di distributionAllowed, sehingga
 * "boleh meneruskan surat ini" dan "boleh menulis arahannya" tidak pernah bisa
 * berbeda jawaban.
 *
 * Surat tanpa baris intake (sebelum R5F7) SENGAJA tidak bisa ditautkan: di sana
 * tidak ada penerima tercatat untuk dicocokkan, jadi menerimanya berarti
 * Kabagrenmin mana pun boleh mengaku atas id surat mana pun.
 */
export const LETTER_LINK_SQL = `SELECT EXISTS(
  SELECT 1 FROM sdl_urmin_incoming_intake it
    JOIN sdl_urmin_distributions d ON d.incoming_id=it.incoming_id
      AND d.recipient_user=$2::uuid AND d.status='received'
   WHERE it.incoming_id=$1::uuid AND it.kabag_recipient=$2::uuid
     AND it.route_status='awaiting_kabag'
) AS ok`

/**
 * Padanan draftPermission (draft.go:70): 503 kalau pemeriksaan gagal,
 * 403 kalau bukan Kabagrenmin. Mengembalikan false saat respons sudah ditulis.
 */
export async function draftPermission(res, runner, userId) {
  let allowed
  try {
    allowed = await isKabag(runner, userId)
  } catch {
    deny(res, 503)
    return false
  }
  if (!allowed) {
    deny(res, 403)
    return false
  }
  return true
}

/**
 * Decode body JSON bertipe untuk directives.
 *
 * typedDecode milik subbagren hanya mengenal 'string' dan 'int'; directives
 * butuh array, pointer yang boleh null, dan time.Time RFC3339. Spesifikasi
 * kind yang didukung di sini:
 *
 *   string    wajib string; absen/null -> ''
 *   int       wajib bilangan bulat; absen/null -> 0
 *   int?      pointer *int64; absen/null -> undefined
 *   time?     pointer *time.Time; absen/null -> undefined, selain itu RFC3339
 *   string[]  []string; absen/null -> undefined (Go membiarkannya nil)
 *
 * Tipe yang tidak cocok mengembalikan {ok:false}, padanan error decode Go.
 * Keduanya bermuara ke 400 invalid_request, jadi perbedaan jalurnya tidak
 * terlihat dari luar — tapi tetap dibedakan supaya alasannya terbaca di sini.
 */
export function decodeTyped(req, schema) {
  const payload = parsePayload(req, Object.keys(schema))
  if (!payload.ok) return { ok: false }

  const out = {}
  for (const [field, kind] of Object.entries(schema)) {
    const raw = payload.value[field]
    const absent = raw === undefined || raw === null

    if (kind === 'string') {
      if (absent) { out[field] = ''; continue }
      if (typeof raw !== 'string') return { ok: false }
      out[field] = raw
      continue
    }
    // Padanan *string di Go: absen DAN null sama-sama menjadi undefined,
    // dibedakan dari 'string' yang memadatkan keduanya menjadi ''. Dibutuhkan
    // incomingId, yang harus bisa mengatakan "tidak ada surat asal".
    if (kind === 'string?') {
      if (absent) { out[field] = undefined; continue }
      if (typeof raw !== 'string') return { ok: false }
      out[field] = raw
      continue
    }
    if (kind === 'int' || kind === 'int?') {
      if (absent) {
        out[field] = kind === 'int' ? 0 : undefined
        continue
      }
      if (typeof raw !== 'number' || !Number.isInteger(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER) {
        return { ok: false }
      }
      out[field] = raw
      continue
    }
    if (kind === 'time?') {
      if (absent) { out[field] = undefined; continue }
      if (typeof raw !== 'string') return { ok: false }
      const parsed = parseRfc3339(raw)
      if (!parsed) return { ok: false }
      out[field] = parsed
      continue
    }
    if (kind === 'string[]') {
      if (absent) { out[field] = undefined; continue }
      if (!Array.isArray(raw)) return { ok: false }
      for (const item of raw) if (typeof item !== 'string') return { ok: false }
      out[field] = raw
      continue
    }
    return { ok: false }
  }
  return { ok: true, value: out }
}

/**
 * Padanan time.Time.UnmarshalJSON, yang menuntut RFC3339 — bukan sembarang
 * tanggal yang bisa dicerna Date.parse(). Tanpa pemeriksaan pola ini,
 * `"dueAt":"besok pagi"` akan lolos decode di Node dan ditolak di Go.
 */
export function parseRfc3339(value) {
  if (!/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(value)) {
    return undefined
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export const LIST_SQL = `SELECT d.id::text,d.title,d.body,d.kind,d.priority,d.issuer_id::text,u.display_name,d.due_at,d.created_at,
  (SELECT COUNT(*) FROM sdl_leadership_directive_recipients x WHERE x.directive_id=d.id)::int AS total,
  (SELECT COUNT(*) FROM sdl_leadership_directive_recipients x WHERE x.directive_id=d.id AND x.read_at IS NOT NULL)::int AS read,
  (SELECT COUNT(*) FROM sdl_leadership_directive_recipients x WHERE x.directive_id=d.id AND x.acknowledged_at IS NOT NULL)::int AS acknowledged,
  d.incoming_id::text AS incoming_id
 FROM sdl_leadership_directives d JOIN sdl_users u ON u.id=d.issuer_id`

/**
 * Padanan struct summary (api.go:38).
 *
 * myReadAt, myAcknowledgedAt, dan recipients bertanda `omitempty` di Go dan
 * karena itu **hilang sama sekali** dari respons saat kosong — bukan muncul
 * sebagai null. Ketiganya sengaja TIDAK diisi di sini; pemanggil yang
 * menambahkannya hanya kalau memang ada nilainya.
 *
 * incomingId (R5G2) mengikuti aturan omitempty yang sama, dan itulah sebabnya
 * ia ditulis bersyarat alih-alih `?? null`: arahan tanpa surat asal harus
 * terserialisasi persis seperti sebelum R5G2.
 */
export function mapSummary(row) {
  const out = {
    id: row.id,
    title: row.title,
    body: row.body,
    kind: row.kind,
    priority: row.priority,
    issuerId: row.issuer_id,
    issuerName: row.display_name,
    dueAt: row.due_at,
    createdAt: row.created_at,
    total: row.total,
    read: row.read,
    acknowledged: row.acknowledged,
  }
  if (row.incoming_id !== null && row.incoming_id !== undefined) {
    out.incomingId = row.incoming_id
  }
  return out
}

/** Padanan struct recipient (api.go:31); readAt/acknowledgedAt tanpa omitempty. */
export function mapRecipient(row) {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    readAt: row.read_at ?? null,
    acknowledgedAt: row.acknowledged_at ?? null,
  }
}

/** Padanan struct directiveFile (attachments.go:29). */
export function mapFile(row) {
  return {
    id: row.id,
    name: row.filename,
    mime: row.mime_type,
    size: Number(row.size_bytes),
    createdAt: row.created_at,
  }
}
