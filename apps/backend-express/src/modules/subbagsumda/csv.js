import { disposisi } from './lampiran.js'

/**
 * R5H32 K20/K44: penulis CSV ekspor Subbagsumda, tanpa dependensi.
 * UTF-8 + BOM (dibuka benar oleh Excel), pemisah `;`, baris CRLF, SEMUA sel berkutip, `"` → `""`.
 * Penangkal formula/CSV injection: sel teks yang diawali `= + - @`, tab, CR — atau padanan lebar penuhnya — diberi
 * awalan `'` supaya Excel/LibreOffice tidak menjalankannya (=HYPERLINK, DDE). Bilangan dari kode tidak diberi awalan.
 * Tanpa baris `sep=` (memicu perilaku berbeda di tiap aplikasi).
 */

export const BOM = Buffer.from([0xef, 0xbb, 0xbf])
// eslint-disable-next-line no-control-regex
const AWAL_FORMULA = /^[=+\-@\t\r\n＝＋－＠]/
// Review S4: data lama (salinan registry/impor) tidak lewat teks() — spasi, NBSP, atau baris baru di depan, dan padanan
// Unicode (﹦ U+FE66 dst.) dinormalisasi NFKC lalu diperiksa lagi.
const berawalFormula = (s) => AWAL_FORMULA.test(s) || AWAL_FORMULA.test(s.normalize('NFKC').replace(/^[\s​﻿]+/u, ''))

/** Satu sel CSV yang sudah berkutip. */
export function sel(v) {
  if (v === null || v === undefined) return '""'
  if (typeof v === 'number' || typeof v === 'bigint') return `"${String(v)}"`
  if (typeof v === 'boolean') return v ? '"Ya"' : '"Tidak"'
  let s = String(v)
  if (berawalFormula(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export const barisCsv = (cells) => cells.map(sel).join(';')

/** Seluruh berkas: BOM + header + baris, dipisah CRLF (termasuk setelah baris terakhir). */
export function berkasCsv(header, rows) {
  const teks = [barisCsv(header), ...rows.map(barisCsv)].map((l) => `${l}\r\n`).join('')
  return Buffer.concat([BOM, Buffer.from(teks, 'utf8')])
}

/** Header unduhan CSV. `nama` selalu ASCII dari daftar putih modul + tanggal, tidak pernah dari request. */
export function pasangHeaderCsv(res, nama) {
  res.set('Content-Type', 'text/csv; charset=utf-8')
  res.set('Content-Disposition', disposisi(nama))
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Content-Security-Policy', 'sandbox')
  res.set('Cache-Control', 'no-store')
}
