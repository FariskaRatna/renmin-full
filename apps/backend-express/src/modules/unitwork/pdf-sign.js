import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'

/**
 * R5H7: penempelan tanda tangan VISUAL ke naskah PDF surat keluar.
 *
 * Bukan TTE tersertifikasi -- hanya gambar + keterangan. Lihat
 * docs/R5H7-TTD-KABAG-SURAT-KELUAR.md.
 *
 * Koordinat penempatan datang dari layar (pdf.js): relatif 0..1, diukur dari
 * KIRI-ATAS halaman SEBAGAIMANA TAMPIL, termasuk /Rotate. PDF sendiri diukur
 * dari kiri-bawah halaman SEBELUM rotasi, di dalam CropBox (yang juga dipakai
 * pdf.js sebagai area tampil). toUser() menerjemahkan antara keduanya.
 *
 * Gambar digambar dengan rotate = /Rotate halaman (berlawanan arah jarum jam
 * di ruang PDF), sehingga setelah penampil memutar halaman searah jarum jam
 * ia tampil tegak, menempati persis kotak yang dipilih di layar.
 */

export class PdfUnreadableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'PdfUnreadableError'
  }
}

/** Batas penempatan per berkas; cukup untuk paraf tiap halaman surat panjang. */
export const MAX_PLACEMENTS_PER_FILE = 20

const MIN_SIZE = 0.02

/**
 * Validasi bentuk satu penempatan. Mengembalikan salinan bersih atau null.
 * Halaman diperiksa terhadap jumlah halaman sebenarnya di signPdf().
 */
export function cleanPlacement(p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return null
  const keys = Object.keys(p)
  if (keys.length !== 5 || !['page', 'x', 'y', 'w', 'h'].every((k) => keys.includes(k))) return null
  const { page, x, y, w, h } = p
  if (!Number.isInteger(page) || page < 1 || page > 2000) return null
  for (const v of [x, y, w, h]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
  }
  if (x < 0 || y < 0 || w < MIN_SIZE || h < MIN_SIZE) return null
  // Toleransi kecil untuk pembulatan float dari layar.
  if (x + w > 1.0005 || y + h > 1.0005) return null
  const r = (v) => Math.round(v * 1e5) / 1e5
  return { page, x: r(x), y: r(y), w: r(w), h: r(h) }
}

function normRotation(page) {
  const r = ((page.getRotation().angle % 360) + 360) % 360
  return r === 90 || r === 180 || r === 270 ? r : 0
}

/**
 * Titik layar (dx,dy dalam pt, kiri-atas halaman tampil) -> titik ruang PDF.
 * box = CropBox {x,y,width,height} sebelum rotasi.
 */
export function toUser(box, rotation, dx, dy) {
  const { x: bx, y: by, width: w, height: h } = box
  switch (rotation) {
    case 90: return { x: bx + dy, y: by + dx }
    case 180: return { x: bx + w - dx, y: by + dy }
    case 270: return { x: bx + w - dy, y: by + h - dx }
    default: return { x: bx + dx, y: by + h - dy }
  }
}

/** Font standar PDF hanya WinAnsi; huruf di luar itu diganti, bukan dibuang diam-diam. */
function winAnsi(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
}

/**
 * Menempel tanda tangan ke satu PDF.
 *
 * @param {Buffer} pdfBytes naskah asli
 * @param {Buffer} pngBytes gambar tanda tangan (PNG, sudah divalidasi)
 * @param {Array} placements hasil cleanPlacement()
 * @param {{signer:string, when:string, code:string}} label teks keterangan
 * @returns {Promise<Buffer>}
 */
export async function signPdf(pdfBytes, pngBytes, placements, label) {
  let doc
  let pages
  try {
    // PDF terenkripsi DITOLAK: menulis ulangnya tanpa kunci menghasilkan berkas
    // rusak. pdf-lib melemparnya sebagai Error biasa saat load, jadi dimuat
    // dengan ignoreEncryption lalu diperiksa eksplisit lewat isEncrypted.
    // pdf-lib juga longgar saat load; struktur rusak baru ketahuan saat
    // halaman dibaca, jadi keduanya di dalam satu blok.
    doc = await PDFDocument.load(pdfBytes, { updateMetadata: false, ignoreEncryption: true })
    if (doc.isEncrypted) throw new PdfUnreadableError('pdf_encrypted')
    pages = doc.getPages()
  } catch (error) {
    if (error instanceof PdfUnreadableError) throw error
    throw new PdfUnreadableError('pdf_unreadable')
  }
  if (pages.length === 0) throw new PdfUnreadableError('pdf_unreadable')
  for (const p of placements) {
    if (p.page > pages.length) throw new PdfUnreadableError('page_out_of_range')
  }

  const image = await doc.embedPng(pngBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const caption = winAnsi(`Ditandatangani ${label.signer} - ${label.when}`)
  const ink = rgb(0.25, 0.3, 0.38)

  for (const p of placements) {
    const page = pages[p.page - 1]
    const box = page.getCropBox()
    const rotation = normRotation(page)
    const viewW = rotation % 180 === 0 ? box.width : box.height
    const viewH = rotation % 180 === 0 ? box.height : box.width

    // Kotak di layar, dalam pt.
    const dx = p.x * viewW
    const dy = p.y * viewH
    const dw = p.w * viewW
    const dh = p.h * viewH

    // Gambar dipertahankan proporsinya di dalam kotak, rata tengah-bawah.
    const scale = Math.min(dw / image.width, dh / image.height)
    const iw = image.width * scale
    const ih = image.height * scale
    const ix = dx + (dw - iw) / 2
    const iy = dy + (dh - ih) // tepi atas gambar, dari atas
    const anchor = toUser(box, rotation, ix, iy + ih) // kiri-bawah gambar di layar
    page.drawImage(image, { x: anchor.x, y: anchor.y, width: iw, height: ih, rotate: degrees(rotation) })

    // Keterangan kecil tepat di bawah kotak; dipotong agar tidak melebar.
    const size = Math.max(4, Math.min(6.5, dh * 0.12))
    const maxWidth = Math.max(dw, 60) * 1.6
    let text = caption
    if (font.widthOfTextAtSize(text, size) > maxWidth) {
      while (text.length > 8 && font.widthOfTextAtSize(`${text}...`, size) > maxWidth) text = text.slice(0, -1)
      text = `${text.trimEnd()}...`
    }
    const tAnchor = toUser(box, rotation, dx, Math.min(viewH - 1, dy + dh + size + 1))
    page.drawText(text, { x: tAnchor.x, y: tAnchor.y, size, font, color: ink, rotate: degrees(rotation) })
  }

  // Satu baris kaki di halaman terakhir: pernyataan jenis tanda tangan + kode.
  const last = pages[pages.length - 1]
  const lbox = last.getCropBox()
  const lrot = normRotation(last)
  const lviewH = lrot % 180 === 0 ? lbox.height : lbox.width
  const foot = winAnsi(`Tanda tangan visual SIERA DELTA LIMA, bukan TTE tersertifikasi - kode ${label.code}`)
  const fAnchor = toUser(lbox, lrot, 14, lviewH - 8)
  last.drawText(foot, { x: fAnchor.x, y: fAnchor.y, size: 6, font, color: ink, rotate: degrees(lrot) })

  return Buffer.from(await doc.save({ useObjectStreams: false }))
}
