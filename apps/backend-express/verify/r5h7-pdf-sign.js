// R5H7: uji penempelan tanda tangan ke PDF (src/modules/unitwork/pdf-sign.js).
//
//   node verify/r5h7-pdf-sign.js [folder-keluaran]
//
// Memeriksa: pemetaan koordinat layar -> PDF untuk keempat rotasi dan CropBox
// yang bergeser, validasi penempatan, penolakan PDF terenkripsi/rusak/halaman
// di luar jangkauan, dan bahwa hasilnya PDF yang bisa dibuka ulang. Kalau
// folder keluaran diberikan, PDF hasil ditulis ke sana untuk dilihat mata.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib'
import sharp from 'sharp'

import { PdfUnreadableError, cleanPlacement, signPdf, toUser } from '../src/modules/unitwork/pdf-sign.js'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'LULUS' : 'GAGAL'}  ${name}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures++
}
const near = (a, b) => Math.abs(a - b) < 1e-6

// 1. Pemetaan sudut: sudut kiri-atas TAMPIL harus jatuh di sudut PDF yang benar.
const box = { x: 10, y: 20, width: 600, height: 800 }
const cases = [
  // rotation, titik layar kiri-atas, kanan-bawah (dalam pt layar) -> user
  [0, [0, 0], { x: 10, y: 820 }, [600, 800], { x: 610, y: 20 }],
  [90, [0, 0], { x: 10, y: 20 }, [800, 600], { x: 610, y: 820 }],
  [180, [0, 0], { x: 610, y: 20 }, [600, 800], { x: 10, y: 820 }],
  [270, [0, 0], { x: 610, y: 820 }, [800, 600], { x: 10, y: 20 }],
]
for (const [rot, a, ua, b, ub] of cases) {
  const p = toUser(box, rot, a[0], a[1])
  const q = toUser(box, rot, b[0], b[1])
  check(`toUser rotasi ${rot}`, near(p.x, ua.x) && near(p.y, ua.y) && near(q.x, ub.x) && near(q.y, ub.y),
    `${JSON.stringify(p)} ${JSON.stringify(q)}`)
}

// 2. Validasi penempatan.
check('placement sah', cleanPlacement({ page: 1, x: 0.5, y: 0.7, w: 0.3, h: 0.1 }) !== null)
for (const [label, bad] of [
  ['kunci asing', { page: 1, x: 0, y: 0, w: 0.3, h: 0.1, z: 1 }],
  ['halaman 0', { page: 0, x: 0, y: 0, w: 0.3, h: 0.1 }],
  ['keluar kanan', { page: 1, x: 0.8, y: 0, w: 0.3, h: 0.1 }],
  ['terlalu kecil', { page: 1, x: 0, y: 0, w: 0.001, h: 0.1 }],
  ['bukan angka', { page: 1, x: '0', y: 0, w: 0.3, h: 0.1 }],
  ['NaN', { page: 1, x: NaN, y: 0, w: 0.3, h: 0.1 }],
  ['halaman pecahan', { page: 1.5, x: 0, y: 0, w: 0.3, h: 0.1 }],
]) check(`placement ditolak: ${label}`, cleanPlacement(bad) === null)

// 3. PDF uji: 4 halaman, masing-masing rotasi berbeda, halaman 2 CropBox bergeser.
async function samplePdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const [i, rot] of [0, 90, 180, 270].entries()) {
    const page = doc.addPage([595, 842])
    if (i === 1) page.setCropBox(30, 40, 535, 760)
    page.setRotation(degrees(rot))
    page.drawText(`Halaman ${i + 1} -- rotasi ${rot}`, { x: 60, y: 760, size: 18, font })
    page.drawText('Kotak merah = tempat tanda tangan seharusnya', { x: 60, y: 730, size: 11, font, color: rgb(0.7, 0, 0) })
  }
  return Buffer.from(await doc.save())
}
const signature = await sharp({ create: { width: 400, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: Buffer.from('<svg width="400" height="160"><path d="M20 120 C 80 20, 140 20, 180 110 S 300 150, 380 40" stroke="#123b8a" stroke-width="8" fill="none"/></svg>'), top: 0, left: 0 }])
  .png().toBuffer()

const input = await samplePdf()
const placements = [1, 2, 3, 4].flatMap((page) => [
  { page, x: 0.6, y: 0.75, w: 0.3, h: 0.1 },
  { page, x: 0.08, y: 0.4, w: 0.25, h: 0.08 },
])
const label = { signer: 'Kabag Renmin Ujicoba (Ä)', when: '10 Nov 2026 14.05 WIB', code: 'ABCD1234' }
let output
try {
  output = await signPdf(input, signature, placements.map(cleanPlacement), label)
  const again = await PDFDocument.load(output)
  check('hasil bisa dibuka ulang', again.getPageCount() === 4)
  check('hasil lebih besar dari asli', output.length > input.length)
} catch (error) {
  check('penandatanganan PDF contoh', false, String(error))
}

// 4. Penolakan.
async function rejects(name, bytes, plc, expected) {
  try {
    await signPdf(bytes, signature, plc, label)
    check(name, false, 'tidak ditolak')
  } catch (error) {
    check(name, error instanceof PdfUnreadableError && error.message === expected, error.message)
  }
}
await rejects('PDF rusak ditolak', Buffer.from('%PDF-1.4 bukan pdf'), [cleanPlacement(placements[0])], 'pdf_unreadable')
await rejects('halaman di luar jangkauan ditolak', input, [cleanPlacement({ page: 9, x: 0, y: 0, w: 0.2, h: 0.1 })], 'page_out_of_range')
const plain = Buffer.from(await (await PDFDocument.create()).save({ useObjectStreams: false })).toString('latin1')
const encrypted = Buffer.from(plain.replace('trailer\n<<', 'trailer\n<<\n/Encrypt << /Filter /Standard /V 1 /R 2 >>'), 'latin1')
await rejects('PDF terenkripsi ditolak', encrypted, [cleanPlacement(placements[0])], 'pdf_encrypted')

const outDir = process.argv[2]
if (outDir && output) {
  mkdirSync(outDir, { recursive: true })
  // Versi rujukan: kotak merah di posisi yang sama, digambar dengan
  // pemetaan yang sama, untuk dibandingkan dengan tanda tangannya.
  writeFileSync(join(outDir, 'r5h7-asli.pdf'), input)
  writeFileSync(join(outDir, 'r5h7-ttd.pdf'), output)
  console.log(`PDF ditulis ke ${outDir}`)
}

console.log(failures === 0 ? '\nSEMUA LULUS' : `\n${failures} GAGAL`)
process.exit(failures === 0 ? 0 : 1)
