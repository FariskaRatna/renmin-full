/**
 * R5H2: lembar disposisi yang menempel pada arahan (migrasi 041), port dari
 * apps/backend/internal/directives/sheet.go.
 *
 * Seluruh isiannya opsional dan dikirim sebagai SATU objek `sheet`. Klien lama
 * yang tidak mengenal field ini tidak mengirimnya, dan arahan tanpa lembar
 * diserialisasi persis seperti sebelum 041 (omitempty di summary dan draft).
 *
 * URUTAN KUNCI DI SHEET_FIELDS ADALAH URUTAN DEKLARASI struct `sheet` di Go,
 * dan karena itu urutan kunci di respons JSON. Jangan diurutkan ulang.
 */

/** [nama kunci, jenis decode]; urutan = urutan field struct Go. */
const SHEET_FIELDS = [
  ['letterFrom', 'string'],
  ['letterNumber', 'string'],
  ['directiveDate', 'string'],
  ['letterDate', 'string'],
  ['subject', 'string'],
  ['classification', 'string'],
  ['derajat', 'string'],
  ['dispositions', 'string[]'],
  ['dispositionNote', 'string'],
  ['agendaNo', 'int?'],
]
const SHEET_KEYS = SHEET_FIELDS.map(([key]) => key)

const DISPOSITION_CODE_RE = /^[A-Z][A-Z0-9_]{1,23}$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_DISPOSITIONS = 20

/**
 * Padanan decode json Go untuk `Sheet *sheet` dengan DisallowUnknownFields,
 * yang BERLAKU JUGA untuk objek bersarang.
 *
 *   absen / null   -> undefined (pointer nil, "tanpa lembar")
 *   bukan objek    -> {ok:false}
 *   kunci asing    -> {ok:false}
 *   kunci absen    -> zero value Go: '' / nil slice (undefined) / nil
 *   null per kunci -> sama dengan absen (Go membiarkan zero value)
 *   tipe salah     -> {ok:false}
 *
 * Elemen null di dalam `dispositions` menjadi '' seperti di Go (null ke string
 * adalah no-op), lalu gugur di validSheet karena tidak cocok pola kode.
 * agendaNo: Go menolak bilangan pecahan/di luar int64 saat decode, dan
 * validSheet menolak bilangan bulat apa pun; keduanya 400, jadi di sini cukup
 * dibedakan null dan bukan-null-yang-bertipe-angka.
 *
 * toWellFormed(): decoder Go mengganti escape surrogate tunggal dengan U+FFFD.
 * JSON.parse mempertahankannya, lalu JSON.stringify menulisnya kembali sebagai
 * escape surrogate tunggal yang DITOLAK jsonb Postgres -- 503 di Express, 201
 * di Go. Jumlah rune-nya sama (satu), jadi validasi panjang tidak berubah.
 */
export function decodeSheetInput(raw) {
  if (raw === undefined || raw === null) return { ok: true, value: undefined }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false }
  for (const key of Object.keys(raw)) {
    if (!SHEET_KEYS.includes(key)) return { ok: false }
  }
  const out = {}
  for (const [key, kind] of SHEET_FIELDS) {
    const v = raw[key]
    const absent = v === undefined || v === null
    if (kind === 'string') {
      if (absent) { out[key] = ''; continue }
      if (typeof v !== 'string') return { ok: false }
      out[key] = v.toWellFormed()
    } else if (kind === 'string[]') {
      if (absent) { out[key] = undefined; continue }
      if (!Array.isArray(v)) return { ok: false }
      const items = []
      for (const item of v) {
        if (item === null) { items.push(''); continue }
        if (typeof item !== 'string') return { ok: false }
        items.push(item.toWellFormed())
      }
      out[key] = items
    } else {
      if (absent) { out[key] = null; continue }
      if (typeof v !== 'number') return { ok: false }
      out[key] = v
    }
  }
  return { ok: true, value: out }
}

function isLeap(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

/**
 * Padanan validDate (sheet.go): '' atau tanggal kalender YYYY-MM-DD yang
 * sungguhan. Dihitung manual, bukan lewat Date: Date.UTC memetakan tahun
 * 0-99 ke 1900-an dan menggulung 2026-02-30 menjadi 2 Maret.
 */
export function validDate(s) {
  if (s === '') return true
  if (!ISO_DATE_RE.test(s)) return false
  const year = Number(s.slice(0, 4))
  const month = Number(s.slice(5, 7))
  const day = Number(s.slice(8, 10))
  if (month < 1 || month > 12 || day < 1) return false
  const days = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
  return day <= days
}

/** Padanan shortText: jumlah rune (code point), atas string MENTAH. */
function shortText(s, max) {
  return [...s].length <= max
}

/**
 * Padanan validSheet (sheet.go). Bentuk saja, dipakai oleh draf maupun kirim;
 * pertanyaan yang butuh database dijawab sheetAllowed di transaksi kirim.
 */
export function validSheet(s) {
  if (s === undefined || s === null) return true
  if (s.agendaNo !== null && s.agendaNo !== undefined) return false
  if (!shortText(s.letterFrom, 200) || !shortText(s.letterNumber, 100) ||
      !shortText(s.subject, 250) || !shortText(s.dispositionNote, 1000)) return false
  if (!validDate(s.directiveDate) || !validDate(s.letterDate)) return false
  if (s.classification !== 'biasa' && s.classification !== 'penting') return false
  if (s.derajat !== 'biasa' && s.derajat !== 'kilat') return false
  const list = s.dispositions ?? []
  if (list.length > MAX_DISPOSITIONS) return false
  const seen = new Set()
  for (const code of list) {
    if (!DISPOSITION_CODE_RE.test(code) || seen.has(code)) return false
    seen.add(code)
  }
  return true
}

/**
 * Padanan strings.TrimSpace: whitespace menurut unicode.IsSpace milik Go,
 * BUKAN String.prototype.trim -- trim() JS ikut membuang U+FEFF (bagi Go bukan
 * spasi) dan tidak membuang U+0085 (bagi Go spasi).
 */
const GO_SPACE = '\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000'
const GO_TRIM_RE = new RegExp(`^[${GO_SPACE}]+|[${GO_SPACE}]+$`, 'gu')
export function goTrimSpace(s) {
  return s.replace(GO_TRIM_RE, '')
}

/**
 * Padanan normalizeSheet: empat teks bebas di-trim, dispositions tidak pernah
 * null, agendaNo dipaksa null. Objek baru disusun dengan urutan kunci Go.
 */
export function normalizeSheet(s) {
  if (s === undefined || s === null) return undefined
  return {
    letterFrom: goTrimSpace(s.letterFrom),
    letterNumber: goTrimSpace(s.letterNumber),
    directiveDate: s.directiveDate,
    letterDate: s.letterDate,
    subject: goTrimSpace(s.subject),
    classification: s.classification,
    derajat: s.derajat,
    dispositions: s.dispositions ?? [],
    dispositionNote: goTrimSpace(s.dispositionNote),
    agendaNo: null,
  }
}

/** Padanan sheetArg: undefined menjadi SQL NULL, selain itu teks JSON. */
export function sheetArg(s) {
  return s === undefined || s === null ? null : JSON.stringify(s)
}

/** Dilempar decodeSheet saat isi kolom tidak bisa di-unmarshal Go. */
export class SheetCorrupt extends Error {}

/**
 * Padanan decodeSheet untuk kolom JSONB yang sudah di-parse node-postgres.
 * SQL NULL -> undefined (kunci `sheet` lalu tidak ditulis). Kunci yang tidak
 * ada menjadi zero value Go; kunci asing diabaikan (Unmarshal tanpa
 * DisallowUnknownFields); tipe yang salah adalah baris rusak -> 503 di Go.
 */
export function decodeSheet(raw) {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new SheetCorrupt()
  const out = {}
  for (const [key, kind] of SHEET_FIELDS) {
    const v = raw[key]
    const absent = v === undefined || v === null
    if (kind === 'string') {
      if (absent) { out[key] = ''; continue }
      if (typeof v !== 'string') throw new SheetCorrupt()
      out[key] = v
    } else if (kind === 'string[]') {
      if (absent) { out[key] = []; continue }
      if (!Array.isArray(v)) throw new SheetCorrupt()
      out[key] = v.map((item) => {
        if (item === null) return ''
        if (typeof item !== 'string') throw new SheetCorrupt()
        return item
      })
    } else {
      if (absent) { out[key] = null; continue }
      if (!Number.isInteger(v)) throw new SheetCorrupt()
      out[key] = v
    }
  }
  return out
}

/**
 * Menambahkan `sheet` sebagai kunci TERAKHIR summary -- sesudah incomingId,
 * sesuai urutan deklarasi struct summary Go. Bersyarat (omitempty): arahan
 * tanpa lembar terserialisasi persis seperti sebelum 041. Panggil SESUDAH
 * appendIncomingId.
 */
export function appendSheet(item, row) {
  const sheet = decodeSheet(row.sheet)
  if (sheet !== undefined) item.sheet = sheet
  return item
}

/**
 * Padanan sheetAllowed: gerbang lembar saat kirim, di dalam transaksi.
 * false berarti 400; galat database dilempar dan menjadi 503 di pemanggil.
 *
 * `s` harus SUDAH dinormalisasi (dispositions tidak pernah undefined).
 */
export async function sheetAllowed(client, s, incoming, _targets) {
  if (s === undefined || s === null) return true
  if (s.dispositions.length > 0) {
    const known = await client.query(
      'SELECT count(*)::int AS n FROM sdl_disposisi_opsi WHERE code=ANY($1::text[])',
      [s.dispositions],
    )
    if (known.rows[0].n !== s.dispositions.length) return false
  }
  // Lembar tidak boleh menurunkan klasifikasi surat yang ditautkan: surat
  // Rahasia yang diberi lembar 'biasa' akan tampil sebagai dokumen biasa.
  if (incoming !== undefined && s.classification !== 'penting') {
    const letter = await client.query(
      'SELECT classification FROM sdl_urmin_incoming WHERE id=$1::uuid',
      [incoming],
    )
    // Go: Scan atas nol baris = pgx.ErrNoRows = galat -> 503, bukan 400.
    if (letter.rows.length === 0 || typeof letter.rows[0].classification !== 'string') {
      throw new Error('incoming letter classification unreadable')
    }
    if (letter.rows[0].classification === 'penting') return false
  }
  // R5H4 (padanan sheet.go): lembar 'penting' TIDAK lagi menuntut setiap
  // penerima memegang grant 'penting'. Klasifikasi tidak membatasi siapa
  // menerima arahan; naskah suratnya tetap hanya diserahkan kepada yang berhak.
  return true
}

/** SQL dispositionOptions, disalin verbatim. */
export const DISPOSITION_OPTIONS_SQL = 'SELECT code,name FROM sdl_disposisi_opsi ORDER BY name'
