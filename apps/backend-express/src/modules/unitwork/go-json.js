/**
 * Serialisasi JSON yang kompatibel byte-per-byte dengan encoding/json milik Go.
 *
 * Dibutuhkan oleh outgoingContentHash (outgoing_review.go:291), yang membuat
 * SHA-256 dari hasil json.Marshal lalu menyimpannya sebagai sidik jari dokumen.
 * Saat surat disetujui, sidik jari dihitung ulang dan dibandingkan; selisih
 * sekecil apa pun menghasilkan 409 document_integrity_changed.
 *
 * Selama masa transisi, Go dan Express melayani endpoint yang sama di atas
 * database yang sama. Surat yang di-submit lewat Go bisa disetujui lewat
 * Express. Kalau serialisasinya berbeda, setiap surat semacam itu ditolak
 * dengan alasan integritas — padahal tidak ada yang berubah.
 *
 * Dua perbedaan yang JSON.stringify tidak tangani:
 *
 *   1. Go mengurutkan kunci map[string]any secara alfabetis.
 *      JSON.stringify mempertahankan urutan penyisipan.
 *   2. Go meng-escape '<', '>', dan '&' menjadi <, >, &
 *      (SetEscapeHTML aktif secara default), ditambah U+2028 dan U+2029.
 *      JSON.stringify membiarkan semuanya apa adanya.
 */

/**
 * Tabel escape dibangun dari titik kode, bukan ditulis sebagai karakter
 * literal di source. U+2028 dan U+2029 tidak terlihat di editor dan mudah
 * berubah menjadi spasi biasa saat berpindah encoding — kalau itu terjadi,
 * setiap spasi akan ikut ter-escape dan seluruh sidik jari dokumen meleset.
 */
const ESCAPES = new Map([
  [0x22, '\\"'], // "
  [0x5c, '\\\\'], // \
  [0x0a, '\\n'],
  [0x0d, '\\r'],
  [0x09, '\\t'],
  [0x08, '\\b'],
  [0x0c, '\\f'],
  // Escape HTML, aktif secara default di encoding/json.
  [0x3c, '\\u003c'], // <
  [0x3e, '\\u003e'], // >
  [0x26, '\\u0026'], // &
  // Pemisah baris dan paragraf Unicode.
  [0x2028, '\\u2028'],
  [0x2029, '\\u2029'],
])

export function marshalGoString(value) {
  let out = '"'
  for (const char of String(value)) {
    const code = char.codePointAt(0)
    const escaped = ESCAPES.get(code)
    if (escaped !== undefined) {
      out += escaped
      continue
    }
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`
      continue
    }
    out += char
  }
  return `${out}"`
}

/**
 * Serialisasi nilai apa pun dengan aturan Go. Objek diperlakukan sebagai map:
 * kuncinya diurutkan. Array mempertahankan urutan.
 */
export function marshalGo(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') return marshalGoString(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('nilai numerik tidak terhingga tidak bisa diserialkan')
    return String(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => marshalGo(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const parts = Object.keys(value)
      .sort()
      .map((key) => `${marshalGoString(key)}:${marshalGo(value[key])}`)
    return `{${parts.join(',')}}`
  }
  throw new Error(`tipe tidak didukung: ${typeof value}`)
}

/**
 * Serialisasi struct dengan urutan field TETAP, bukan terurut — Go memakai
 * urutan deklarasi field untuk struct, berbeda dari perlakuannya pada map.
 *
 * @param {Array<[string, unknown]>} entries pasangan [namaField, nilai] berurutan
 */
export function marshalGoStruct(entries) {
  const parts = entries.map(([key, value]) => `${marshalGoString(key)}:${marshalGo(value)}`)
  return `{${parts.join(',')}}`
}
