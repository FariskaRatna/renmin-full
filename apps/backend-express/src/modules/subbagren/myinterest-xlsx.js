import { inflateRawSync } from 'node:zlib'

/**
 * R5H20: pembaca "Realisasi Belanja per Jenis Kegiatan" (unduhan Excel myinterest).
 * Tanpa dependensi: zip dibaca langsung (central directory + inflate), XML lembar
 * pertama dibaca dengan pola terbatas. Semua ukuran dibatasi (anti zip bomb), dan
 * angka diperiksa silang dengan kolom Total dan baris GRAND TOTAL file itu sendiri.
 */

export const MAX_FILE = 2 << 20
const MAX_ENTRY = 16 << 20
const MAX_KEGIATAN = 500

export class FormatError extends Error {
  constructor(code) { super(code); this.code = code }
}
const fail = (code) => { throw new FormatError(code) }

/** Isi beberapa entri zip (nama -> Buffer). Entri yang tidak ada dilewati. */
function readZip(buf, wanted) {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) fail('bukan_xlsx')
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) fail('bukan_xlsx')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map()
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) fail('bukan_xlsx')
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20); const usize = buf.readUInt32LE(p + 24)
    const nlen = buf.readUInt16LE(p + 28); const xlen = buf.readUInt16LE(p + 30); const clen = buf.readUInt16LE(p + 32)
    const off = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nlen)
    p += 46 + nlen + xlen + clen
    if (!wanted.has(name)) continue
    if (usize > MAX_ENTRY || off + 30 > buf.length || buf.readUInt32LE(off) !== 0x04034b50) fail('bukan_xlsx')
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28)
    if (start + csize > buf.length) fail('bukan_xlsx')
    const raw = buf.subarray(start, start + csize)
    let data
    try {
      data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_ENTRY }) : fail('bukan_xlsx')
    } catch (e) { if (e instanceof FormatError) throw e; fail('bukan_xlsx') }
    out.set(name, data.toString('utf8'))
  }
  return out
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unxml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()])
const textOf = (xml) => unxml([...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''))

function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0]
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/** Lembar pertama sebagai Map(baris -> Map(kolom -> {v, num})) . */
function readSheet(buf) {
  const first = readZip(buf, new Set(['xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/sharedStrings.xml']))
  const wb = first.get('xl/workbook.xml') ?? fail('bukan_xlsx')
  const rid = wb.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1] ?? fail('bukan_xlsx')
  const rels = first.get('xl/_rels/workbook.xml.rels') ?? fail('bukan_xlsx')
  const rel = [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`)) ?? fail('bukan_xlsx')
  let target = rel.match(/Target="([^"]+)"/)?.[1] ?? fail('bukan_xlsx')
  target = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  if (!/^xl\/worksheets\/[A-Za-z0-9_]+\.xml$/.test(target)) fail('bukan_xlsx')
  const sheet = readZip(buf, new Set([target])).get(target) ?? fail('bukan_xlsx')
  const shared = [...(first.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]))
  const rows = new Map()
  for (const m of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = m[1].match(/\br="([A-Z]+)(\d+)"/)
    if (!ref || !m[2]) continue
    const type = m[1].match(/\bt="(\w+)"/)?.[1] ?? 'n'
    const raw = m[2].match(/<v>([\s\S]*?)<\/v>/)?.[1]
    let v
    if (type === 's') v = shared[Number(raw)] ?? ''
    else if (type === 'inlineStr') v = textOf(m[2])
    else if (raw === undefined) continue
    else v = unxml(raw)
    const r = Number(ref[2])
    if (!rows.has(r)) rows.set(r, new Map())
    rows.get(r).set(colIndex(ref[1]), { v: String(v).trim(), num: type === 'n' })
  }
  return rows
}

/**
 * "16-11-2026 12:34:02 WIB (+0700 GMT)" (format myinterest) atau "2026-11-16 12:34:02 WIB"
 * -> { unduhTanggal: '2026-11-16', unduhJam: '12:34:02 WIB' }; null bila tidak terbaca.
 */
export function waktuUnduhOf(s) {
  const m = String(s ?? '').match(/^(?:(\d{2})-(\d{2})-(\d{4})|(\d{4})-(\d{2})-(\d{2}))\s+(\d{2}:\d{2}(?::\d{2})?)(?:\s+([A-Z]{3,4}))?/)
  if (!m) return { unduhTanggal: null, unduhJam: null }
  const iso = m[1] ? `${m[3]}-${m[2]}-${m[1]}` : `${m[4]}-${m[5]}-${m[6]}`
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return { unduhTanggal: null, unduhJam: null }
  return { unduhTanggal: iso, unduhJam: `${m[7]}${m[8] ? ` ${m[8]}` : ''}` }
}

const JENIS = { pegawai: 'pegawai', barang: 'barang', modal: 'modal', 'beban bunga': 'bunga', bunga: 'bunga', subsidi: 'subsidi', hibah: 'hibah', bansos: 'bansos', 'lain-lain': 'lain', lainnya: 'lain', transfer: 'transfer' }

/** "220.556.769.000" / 220556769000 / "1.234,56" -> BigInt rupiah bulat. */
function rupiah(cell) {
  if (!cell || cell.v === '') return 0n
  let s = cell.v.replace(/\s/g, '')
  if (cell.num) {
    if (!/^-?\d+(\.\d+)?(E[+-]?\d+)?$/i.test(s)) fail('nilai_tidak_valid')
    const n = Math.round(Number(s))
    if (!Number.isSafeInteger(n)) fail('nilai_tidak_valid')
    s = String(n)
  } else {
    if (!/^-?[\d.]+(,\d+)?$/.test(s)) fail('nilai_tidak_valid')
    s = s.split(',')[0].replace(/\./g, '')
  }
  const b = BigInt(s)
  if (b < 0n || b >= 10n ** 18n) fail('nilai_tidak_valid')
  return b
}

/**
 * Hasil: { tanggalAwal, tanggalAkhir, waktuUnduh, kegiatan:[{kode,nama,jenis:{key:{pagu,realisasi}}}],
 *          totalPagu, totalRealisasi } dengan angka BigInt.
 */
export function parseMyinterest(buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0 || buf.length > MAX_FILE) fail('bukan_xlsx')
  const rows = readSheet(buf)
  const nums = [...rows.keys()].sort((a, b) => a - b)
  const all = (r) => [...(rows.get(r)?.values() ?? [])].map((c) => c.v)
  if (!nums.some((r) => all(r).some((v) => /realisasi belanja per jenis kegiatan/i.test(v)))) fail('format_tidak_dikenali')
  let tanggalAwal = null; let tanggalAkhir = null; let waktuUnduh = ''
  for (const r of nums) for (const v of all(r)) {
    const t = v.match(/(\d{4}-\d{2}-\d{2})\s*s\.?\s*d\.?\s*(\d{4}-\d{2}-\d{2})/i)
    if (t && !tanggalAwal) { tanggalAwal = t[1]; tanggalAkhir = t[2] }
    const w = v.match(/^waktu unduh[^:]*:\s*(.+)$/i)
    if (w && !waktuUnduh) waktuUnduh = w[1].slice(0, 80)
  }
  if (!tanggalAwal) fail('tanggal_tidak_ditemukan')
  const { unduhTanggal, unduhJam } = waktuUnduhOf(waktuUnduh)
  // Header: baris dengan "Keterangan" dan baris berikutnya berisi nama jenis belanja.
  const hdr = nums.find((r) => all(r).some((v) => /^keterangan$/i.test(v)))
  if (!hdr) fail('format_tidak_dikenali')
  const head = rows.get(hdr); const sub = rows.get(hdr + 1) ?? new Map()
  const colOf = (re, map) => [...map.entries()].find(([, c]) => re.test(c.v))?.[0]
  const ketCol = colOf(/^keterangan$/i, head)
  const kodeCol = colOf(/kode/i, head)
  const totalCol = colOf(/^total$/i, head) ?? colOf(/^total$/i, sub)
  const jenisCols = [...sub.entries()].map(([col, c]) => [col, JENIS[c.v.toLowerCase()]]).filter(([, k]) => k)
  if (!ketCol || !kodeCol || !totalCol || !jenisCols.length) fail('format_tidak_dikenali')

  const kegiatan = []; let grand = null; let cur = null
  for (const r of nums.filter((x) => x > hdr + 1)) {
    const row = rows.get(r)
    const ket = (row.get(ketCol)?.v ?? '').toUpperCase()
    if (ket !== 'PAGU' && ket !== 'REALISASI') continue
    const vals = Object.fromEntries(jenisCols.map(([col, k]) => [k, rupiah(row.get(col))]))
    const total = rupiah(row.get(totalCol))
    const sum = Object.values(vals).reduce((a, b) => a + b, 0n)
    if (sum !== total) fail('total_tidak_cocok')
    if (ket === 'PAGU') {
      const label = [...row.entries()].filter(([col]) => col < ketCol).map(([, c]) => c.v).join(' | ')
      if (/grand\s*total/i.test(label)) { grand = { pagu: total }; cur = grand; continue }
      const kn = (row.get(kodeCol)?.v ?? '').split('|')
      const kode = kn[0].trim(); const nama = kn.slice(1).join('|').trim()
      if (!/^[0-9A-Za-z.]{1,20}$/.test(kode) || !nama || nama.length > 300) fail('kegiatan_tidak_valid')
      if (kegiatan.some((k) => k.kode === kode)) fail('kegiatan_ganda')
      cur = { kode, nama, pagu: vals, realisasi: null }
      kegiatan.push(cur)
      if (kegiatan.length > MAX_KEGIATAN) fail('format_tidak_dikenali')
    } else {
      if (!cur || cur.realisasi !== null && cur !== grand) fail('format_tidak_dikenali')
      if (cur === grand) grand.realisasi = total; else cur.realisasi = vals
    }
  }
  if (!kegiatan.length || kegiatan.some((k) => !k.realisasi)) fail('format_tidak_dikenali')
  const totalPagu = kegiatan.reduce((n, k) => n + Object.values(k.pagu).reduce((a, b) => a + b, 0n), 0n)
  const totalRealisasi = kegiatan.reduce((n, k) => n + Object.values(k.realisasi).reduce((a, b) => a + b, 0n), 0n)
  if (grand && (grand.pagu !== totalPagu || grand.realisasi !== totalRealisasi)) fail('total_tidak_cocok')
  return {
    tanggalAwal, tanggalAkhir, waktuUnduh, unduhTanggal, unduhJam, totalPagu, totalRealisasi,
    kegiatan: kegiatan.map((k) => ({
      kode: k.kode, nama: k.nama,
      jenis: Object.fromEntries(jenisCols.map(([, j]) => [j, { pagu: k.pagu[j], realisasi: k.realisasi[j] }])),
    })),
  }
}
