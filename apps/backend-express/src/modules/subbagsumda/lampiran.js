import { createHash } from 'node:crypto'

import { PDFDocument } from 'pdf-lib'

import { openEvidence, sealEvidence } from '../../crypto/evidence.js'
import { contentDisposition, detectFileType, readSingleFile } from '../../http/multipart.js'
import { BODY_LIMITS } from '../../http/payload.js'
import { HttpError } from './umum.js'

/**
 * Lampiran PDF tersegel Subbagsumda (R5H28 Karier & Mutasi, R5H29 Diklat & Kompetensi).
 * Diekstrak dari karier.js tanpa mengubah perilaku, supaya logika segel/unduh — bagian paling
 * sensitif — hanya punya satu salinan. Termasuk perbaikan review R5H28 S1 (nama Unicode, header
 * sebelum audit). Otorisasi, status pemilik, dan audit tetap di modul pemanggil.
 */

export const MAKS_PDF = 5 << 20
export const MAKS_LAMPIRAN = 10
export const SAFE_PDF_NAME = /^[\p{L}\p{N} ._()\-,]{1,150}\.pdf$/iu

/**
 * Content-Disposition aman untuk nama berkas Unicode (RFC 6266/5987): `filename` ASCII sebagai cadangan,
 * `filename*` UTF-8 untuk nama asli. Nama ASCII murni tetap memakai bentuk lama (contentDisposition).
 */
export function disposisi(nama) {
  if (/^[\x20-\x7e]*$/.test(nama)) return contentDisposition('attachment', nama)
  const ascii = nama.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const utf8 = encodeURIComponent(nama).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`
}

/** Satu PDF (<= 5 MB) dari multipart `file`, sudah diperiksa dan disegel. Kunci tidak sah -> 503 (fail-closed). */
export async function bacaPdf(req, evidenceKey) {
  const up = await readSingleFile(req, { fieldName: 'file', maxBodyBytes: BODY_LIMITS.SUMDA_LAMPIRAN, maxFileBytes: MAKS_PDF, maxFiles: 2 })
  if (up.bodyExceeded || up.error === 'too_large') throw new HttpError(413, 'file_too_large')
  if (up.fileCount !== 1 || !up.file) throw new HttpError(400, 'one_file_required')
  const blob = up.file.buffer
  const filename = up.file.filename.trim()
  const tail = blob.subarray(Math.max(0, blob.length - 2048))
  const isPdf = SAFE_PDF_NAME.test(filename) && blob.length > 0 && detectFileType(blob) === 'application/pdf' &&
    blob.subarray(0, 5).toString('latin1') === '%PDF-' && tail.includes('%%EOF')
  if (!isPdf) throw new HttpError(400, 'invalid_file_type')
  // Review R5H29 S2: PDF terenkripsi atau rusak (tanpa halaman terbaca) ditolak, pola unitwork/pdf-sign.js.
  try {
    const doc = await PDFDocument.load(blob, { ignoreEncryption: true, updateMetadata: false })
    if (doc.isEncrypted || doc.getPageCount() < 1) throw new Error('pdf_tidak_terbaca')
  } catch { throw new HttpError(400, 'invalid_file_type') }
  let sealed
  try { sealed = sealEvidence(evidenceKey, blob) } catch { throw new HttpError(503, 'evidence_encryption_unavailable') }
  return { blob, filename, sealed, digest: createHash('sha256').update(blob).digest('hex') }
}

/** Buka segel baris lampiran `{body, sha256}` dan periksa keutuhannya. */
export function bukaPdf(row, evidenceKey) {
  let plain
  try { plain = openEvidence(evidenceKey, row.body) } catch { throw new HttpError(503, 'evidence_integrity_failure') }
  if (createHash('sha256').update(plain).digest('hex') !== row.sha256) throw new HttpError(503, 'evidence_integrity_failure')
  return plain
}

/**
 * Header unduhan aman. Dipasang LEBIH DULU (review R5H28 S1): nama non-Latin-1 tidak boleh membuat
 * setHeader melempar setelah audit unduhan terlanjur tercatat.
 */
export function pasangHeaderUnduh(res, filename) {
  res.set('Content-Type', 'application/octet-stream')
  res.set('Content-Disposition', disposisi(filename))
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('Content-Security-Policy', 'sandbox')
  res.set('Cache-Control', 'no-store')
}
