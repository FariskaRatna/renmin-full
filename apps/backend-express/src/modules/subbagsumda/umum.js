import { parsePayload } from '../../http/payload.js'
import { fail, respond } from '../subbagren/shared.js'

/**
 * Helper bersama modul Subbagsumda (R5H27 Master Personel, R5H28 Karier & Mutasi).
 * Diekstrak dari personel.js (R5H28). Satu perubahan perilaku yang disengaja: galat FK (23503)
 * kini 400 invalid_input, bukan 503 — juga untuk Master Personel. Tujuannya supaya validasi dan otorisasi
 * hanya punya SATU salinan. `handle()` memakai `instanceof HttpError`, jadi semua modul
 * Sumda WAJIB memakai kelas HttpError dari berkas ini.
 *
 * OTORISASI: bukan Engine A dan bukan Engine B. Pola R5H11 (subbagren/progar.js:71):
 * grant aktif di unit 'subbagsumda' + permission role, diputuskan seluruhnya di SQL.
 * Scope dan classification_limit sengaja TIDAK dipakai (R5H27 K2, R5H28 K5).
 */

export const UNIT = 'subbagsumda'

/**
 * Tanggal hari ini menurut Asia/Jakarta, dihitung di Postgres. Pool Express bersesi UTC (db.js:45),
 * jadi CURRENT_DATE meleset sehari pukul 00:00-06:59 WIB — jangan pernah dipakai di modul Sumda.
 */
export const HARI_INI = "(now() AT TIME ZONE 'Asia/Jakarta')::date"

/** Ekspresi tanggal WIB dari parameter timestamptz — dipakai verify untuk uji batas zona. */
export const hariDari = (param) => `((${param})::timestamptz AT TIME ZONE 'Asia/Jakarta')::date`
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// eslint-disable-next-line no-control-regex
const KENDALI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
// eslint-disable-next-line no-control-regex
const KENDALI_SEBARIS = /[\u0000-\u001F\u007F]/
// Karakter format tak terlihat (zero-width, pembalik arah U+202E, BOM, …) ditolak di semua isian,
// supaya nama/NRP tidak bisa tampil sama padahal berbeda, atau tampil terbalik.
const FORMAT_TAK_TERLIHAT = /\p{Cf}/u

export const GOLONGAN_PNS = Object.freeze(['I', 'II', 'III', 'IV'].flatMap((g) =>
  (g === 'IV' ? ['a', 'b', 'c', 'd', 'e'] : ['a', 'b', 'c', 'd']).map((r) => `${g}/${r}`)))

const PERMIT_SQL = `SELECT EXISTS(
  SELECT 1 FROM sdl_users u
    JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key='${UNIT}'
    JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key='${UNIT}'
         AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
    JOIN sdl_roles r ON r.role_key=g.role_key AND r.is_active AND r.role_key<>'superadmin'
    JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key=$2
   WHERE u.id::text=$1 AND u.is_active AND NOT u.must_change_password
     AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
) AS ok`

const EXTRA_GALAT = ['id']

/**
 * Review R5H30 S2: syarat maker-checker "pernah mengubah" — pemutus tidak boleh pernah mengubah isian atau
 * lampiran pengajuan ini (bukan hanya pengubah TERAKHIR). Dibaca dari audit yang ditulis dalam transaksi
 * yang sama dengan perubahannya. `subject`/`actor` adalah nomor parameter SQL; subject dibandingkan lowercase
 * karena id di URL boleh berhuruf besar.
 */
export const pernahMengubahSql = (type, subject, actor) => `EXISTS(SELECT 1 FROM sdl_audit_events a
  WHERE a.actor_id=${actor}::uuid AND a.subject_type='${type}' AND lower(a.subject_id)=${subject}::text
    AND a.event_key IN ('${type}.update','${type}.lampiran.add','${type}.lampiran.delete'))`

export class HttpError extends Error {
  /** `extra` (R5H30 K35) ikut ke badan galat di samping `error`, mis. `{id}` pada 409 pengajuan_ganda. */
  constructor(status, code, extra = null) { super(code); this.status = status; this.code = code; this.extra = extra }
}

/**
 * Pembungkus route: HttpError -> status-nya; 23505 -> 409 (kode per constraint lewat `unik`,
 * bawaan 'duplicate'); 23514 -> 400 invalid_input; 23503 (FK) -> 400 invalid_input; lainnya 503.
 */
export function makeHandle(unik = {}) {
  return function handle(fn) {
    return async (req, res) => {
      try {
        await fn(req, res)
      } catch (error) {
        if (error instanceof HttpError) {
          // Review R5H30 C7: hanya kunci daftar putih yang boleh ikut ke badan galat.
          const extra = error.extra ? Object.fromEntries(Object.entries(error.extra).filter(([k]) => EXTRA_GALAT.includes(k))) : null
          if (extra && Object.keys(extra).length) respond(res, error.status, { ...extra, error: error.code })
          else fail(res, error.status, error.code)
          return
        }
        if (error?.code === '23505') { fail(res, 409, unik[error.constraint] ?? 'duplicate'); return }
        if (error?.code === '23514' || error?.code === '23503') { fail(res, 400, 'invalid_input'); return }
        fail(res, 503, 'database_unavailable')
      }
    }
  }
}

export function permit(pool) {
  const can = async (actor, permission) => (await pool.query(PERMIT_SQL, [actor, permission])).rows[0].ok === true
  const need = async (req, permission) => {
    if (!(await can(req.actor, permission))) throw new HttpError(403, 'access_denied')
  }
  return { can, need }
}

export function body(req, keys) {
  const p = parsePayload(req, keys)
  if (!p.ok) throw new HttpError(400, 'invalid_body')
  return p.value
}

/** Teks: null/undefined = ''. Bukan string, karakter kendali, surrogate tunggal, atau di luar panjang -> 400. */
export function teks(v, min, max, { multiline = false } = {}) {
  if (v === undefined || v === null) v = ''
  if (typeof v !== 'string') throw new HttpError(400, 'invalid_input')
  const t = v.trim()
  if ((multiline ? KENDALI : KENDALI_SEBARIS).test(t) || FORMAT_TAK_TERLIHAT.test(t) || !t.isWellFormed()) throw new HttpError(400, 'invalid_input')
  const n = [...t].length
  if (n < min || n > max) throw new HttpError(400, 'invalid_input')
  return t
}

/** Tanggal YYYY-MM-DD yang benar-benar ada, dalam rentang tahun. '' -> null. */
export function tanggal(v, minYear, maxYear) {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new HttpError(400, 'invalid_input')
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new HttpError(400, 'invalid_input')
  const y = d.getUTCFullYear()
  if (y < minYear || y > maxYear) throw new HttpError(400, 'invalid_input')
  return v
}

export function pilihan(v, list) {
  if (typeof v !== 'string' || !list.includes(v)) throw new HttpError(400, 'invalid_input')
  return v
}

export function idParam(raw) {
  if (!UUID_RE.test(raw)) throw new HttpError(404, 'not_found')
  return raw
}

/** Pangkat sesuai jenis personel: golongan PNS dari daftar, Polri dari rank master yang aktif. */
export async function cekPangkat(c, jenis, pangkat) {
  if (jenis === 'PNS') {
    if (!GOLONGAN_PNS.includes(pangkat)) throw new HttpError(400, 'invalid_rank')
    return
  }
  const r = await c.query('SELECT EXISTS(SELECT 1 FROM sdl_polri_rank_master WHERE code=$1 AND is_active) AS ok', [pangkat])
  if (!r.rows[0].ok) throw new HttpError(400, 'invalid_rank')
}
