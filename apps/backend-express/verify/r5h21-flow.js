/**
 * Verifikasi R5H21 dari ujung ke ujung: persuratan antar-unit (migrasi 064).
 * EXPRESS SAJA (tidak ada padanan Go):
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h21-flow.js
 *
 * Yang dijaga: izin per unit (read/manage/approve), IDOR lintas unit, status yang tidak bisa
 * dilompati, naskah wajib PDF + OOXML bermakro ditolak, persetujuan SELALU dengan TTD,
 * penerima hanya melihat naskah bertanda tangan, terima sekali, dan kiriman dari Urmin lewat
 * permit() Urmin (aksi edit, Rahasia ditolak, sekali kirim).
 *
 * MENULIS KE DATABASE (surat uji "[VERIFY R5H21]", surat keluar Urmin uji). Hanya untuk database
 * pengembangan, bukan produksi.
 */
import { crc32 } from 'node:zlib'

import pg from 'pg'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import sharp from 'sharp'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2 })
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }
const P = '/api/v1/persuratan'
const tag = Date.now().toString().slice(-6)

async function actorFor(username) {
  const id = username === 'superadmin' ? await db.superadminUserId() : await db.userIdByUsername(username)
  const client = new HttpClient({ ...config })
  client.setCookie('sdl_session', await db.mintSession(id))
  await client.ensureCsrf()
  return { id, username, client }
}
async function call(a, method, path, body, extra = {}) {
  const res = await a.client.request(method, path, { withCsrf: method !== 'GET', ...(body !== undefined ? { body } : {}), ...extra })
  const bytes = Buffer.from(res.bytes)
  const text = bytes.toString('utf8')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text, bytes }
}
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 140)}`
async function upload(a, path, name, bytes, contentType = 'application/octet-stream') {
  return call(a, 'POST', path, undefined, { multipart: [{ name: 'file', filename: name, contentType, bytes }] })
}

async function realPdf(title) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([595, 842]).drawText(title, { x: 60, y: 780, size: 16, font })
  return Buffer.from(await doc.save())
}
/** Zip "stored" minimal (tanpa kompresi) untuk membuat .docx/.xlsx uji. */
function zip(entries) {
  const locals = []; const centrals = []; let off = 0
  for (const [name, data] of entries) {
    const n = Buffer.from(name); const d = Buffer.from(data); const crc = crc32(d) >>> 0
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42)
    locals.push(lh, n, d); centrals.push(ch, n); off += 30 + n.length + d.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...locals, cd, end])
}
const CT = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
const DOCX = zip([['[Content_Types].xml', CT], ['word/document.xml', '<w:document xmlns:w="x"/>']])
const XLSX = zip([['[Content_Types].xml', CT], ['xl/workbook.xml', '<workbook/>']])
const MACRO = zip([['[Content_Types].xml', CT], ['word/document.xml', '<w:document xmlns:w="x"/>'], ['word/vbaProject.bin', 'x']])

async function main() {
  await db.ping()
  log(`\nBackend: ${config.apiBase}`)
  const A = {}
  for (const u of ['op-subbagren', 'staf-subbagren', 'kasubbagren', 'op-subbagsumda', 'op-subbagbinfung', 'op-urmin', 'kabagrenmin', 'superadmin']) A[u] = await actorFor(u)
  const ren = A['op-subbagren']; const sumda = A['op-subbagsumda']; const binfung = A['op-subbagbinfung']; const urmin = A['op-urmin']; const kabag = A.kabagrenmin
  const sig = await sharp({ create: { width: 360, height: 140, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="360" height="140"><path d="M20 110 C 80 10, 140 10, 170 100 S 280 130, 340 30" stroke="#123b8a" stroke-width="7" fill="none"/></svg>') }]).png().toBuffer()
  const image = `data:image/png;base64,${sig.toString('base64')}`
  const box = [{ page: 1, x: 0.6, y: 0.7, w: 0.25, h: 0.1 }]

  log('\n1. Akses dasar')
  let r = await call(A.superadmin, 'GET', `${P}/capabilities`)
  check('Superadmin ditolak (guard operasional) 403', r.status === 403, short(r))
  r = await call(ren, 'GET', `${P}/capabilities`)
  check('operator Subbagren: read+manage hanya di subbagren', r.body?.units?.subbagren?.manage === true && !r.body?.units?.subbagsumda?.read && !r.body?.units?.urmin?.read && r.body?.canApprove === false, short(r))
  r = await call(kabag, 'GET', `${P}/capabilities`)
  check('Kabagrenmin: baca semua unit, approve, tanpa manage', ['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung'].every((u) => r.body?.units?.[u]?.read && !r.body?.units?.[u]?.manage) && r.body?.canApprove === true, short(r))
  r = await call(ren, 'GET', `${P}/bukanunit/keluar`)
  check('unit tidak dikenal → 404', r.status === 404, short(r))

  log('\n2. Draf surat keluar')
  const draf = { perihal: `[VERIFY R5H21] Permintaan data ${tag}`, sifat: 'Biasa', jenisSurat: 'ND', kodeArsip: 'BIN.1.', ringkasan: 'uji', tujuanUnit: ['subbagsumda', 'subbagbinfung'], tujuanEksternal: 'Biro Renmin Polri' }
  r = await call(ren, 'POST', `${P}/subbagren/keluar`, draf)
  check('buat draf → 201 + nomor bersufiks Subbagren', r.status === 201 && /\/Subbagren$/.test(r.body?.nomor ?? ''), short(r))
  const id = r.body?.id
  r = await call(sumda, 'POST', `${P}/subbagren/keluar`, draf)
  check('unit lain membuat atas nama Subbagren → 403', r.status === 403, short(r))
  r = await call(urmin, 'POST', `${P}/urmin/keluar`, draf)
  check('Urmin membuat di modul ini → 409 pakai_surat_keluar_urmin', r.status === 409 && r.body?.error === 'pakai_surat_keluar_urmin', short(r))
  r = await call(ren, 'POST', `${P}/subbagren/keluar`, { ...draf, tujuanUnit: ['subbagren'] })
  check('tujuan unit sendiri → 400 tujuan_tidak_sah', r.status === 400 && r.body?.error === 'tujuan_tidak_sah', short(r))
  r = await call(ren, 'POST', `${P}/subbagren/keluar`, { ...draf, jenisSurat: 'ZZZ' })
  check('jenis surat tidak dikenal → 400', r.status === 400 && r.body?.error === 'jenis_surat_tidak_dikenal', short(r))
  r = await call(ren, 'POST', `${P}/subbagren/keluar`, { ...draf, asing: 1 })
  check('field asing ditolak → 400', r.status === 400, short(r))
  const ver = async () => (await call(ren, 'GET', `${P}/subbagren/keluar`)).body.items.find((x) => x.id === id).version

  log('\n3. Berkas')
  r = await call(ren, 'POST', `${P}/subbagren/keluar/${id}/ajukan`, { version: await ver() })
  check('ajukan tanpa naskah → 409 naskah_belum_ada', r.status === 409 && r.body?.error === 'naskah_belum_ada', short(r))
  r = await upload(ren, `${P}/subbagren/keluar/${id}/berkas?peran=naskah`, 'naskah.xlsx', XLSX)
  check('naskah .xlsx → 400 naskah_harus_pdf', r.status === 400 && r.body?.error === 'naskah_harus_pdf', short(r))
  r = await upload(ren, `${P}/subbagren/keluar/${id}/berkas?peran=naskah`, 'naskah.pdf', Buffer.from('bukan pdf'))
  check('naskah bukan PDF → 400 invalid_file_type', r.status === 400 && r.body?.error === 'invalid_file_type', short(r))
  r = await upload(ren, `${P}/subbagren/keluar/${id}/berkas?peran=lampiran`, 'makro.docx', MACRO)
  check('lampiran .docx bermakro → 400', r.status === 400, short(r))
  r = await upload(ren, `${P}/subbagren/keluar/${id}/berkas?peran=lampiran`, 'data.exe', DOCX)
  check('ekstensi .exe → 400', r.status === 400, short(r))
  r = await upload(ren, `${P}/subbagren/keluar/${id}/berkas?peran=naskah`, 'naskah.pdf', await realPdf(`Naskah ${tag}`), 'application/pdf')
  check('naskah PDF → 201', r.status === 201, short(r))
  r = await upload(ren, `${P}/subbagren/keluar/${id}/berkas?peran=lampiran`, 'data.xlsx', XLSX)
  check('lampiran .xlsx → 201', r.status === 201, short(r))
  r = await upload(ren, `${P}/subbagren/keluar/${id}/berkas?peran=lampiran`, 'kajian.docx', DOCX)
  check('lampiran .docx → 201', r.status === 201, short(r))
  const list = (await call(ren, 'GET', `${P}/subbagren/keluar`)).body.items.find((x) => x.id === id)
  const naskahId = list.berkas.find((b) => b.peran === 'naskah').id
  r = await call(sumda, 'GET', `${P}/subbagsumda/keluar/${id}/berkas/${naskahId}`)
  check('IDOR: berkas Subbagren lewat jalur Sumda → 404', r.status === 404, short(r))
  r = await call(sumda, 'GET', `${P}/subbagren/keluar`)
  check('Sumda membaca surat keluar Subbagren → 403', r.status === 403, short(r))
  r = await call(A['staf-subbagren'], 'GET', `${P}/subbagren/keluar`)
  check('staf Subbagren membaca surat keluar unitnya → 200', r.status === 200 && r.body.items.some((x) => x.id === id), short(r))

  log('\n4. Ajukan, tolak, TTD')
  r = await call(ren, 'POST', `${P}/subbagren/keluar/${id}/ajukan`, { version: await ver() })
  check('ajukan → 200', r.status === 200, short(r))
  r = await call(ren, 'PUT', `${P}/subbagren/keluar/${id}`, { perihal: 'ubah', tujuanUnit: [], version: await ver() })
  check('ubah setelah diajukan → 409 surat_terkunci', r.status === 409 && r.body?.error === 'surat_terkunci', short(r))
  r = await call(ren, 'POST', `${P}/subbagren/keluar/${id}/kirim`, { version: await ver() })
  check('kirim sebelum disetujui → 409', r.status === 409 && r.body?.error === 'surat_belum_disetujui', short(r))
  r = await call(kabag, 'POST', `${P}/keluar/${id}/setujui`, { version: await ver() })
  check('setujui tanpa TTD tidak ada lagi → 404', r.status === 404, short(r))
  r = await call(A.kasubbagren, 'POST', `${P}/keluar/${id}/ttd-setujui`, { version: await ver(), useSaved: false, image, placements: { [naskahId]: box } })
  check('Kasubbag menandatangani → 403', r.status === 403, short(r))
  r = await call(ren, 'POST', `${P}/keluar/${id}/tolak`, { catatan: 'Lengkapi data rincian', version: await ver() })
  check('operator menolak → 403', r.status === 403, short(r))
  r = await call(kabag, 'POST', `${P}/keluar/${id}/tolak`, { catatan: 'pendek', version: await ver() })
  check('catatan tolak < 8 karakter → 400', r.status === 400, short(r))
  r = await call(kabag, 'POST', `${P}/keluar/${id}/tolak`, { catatan: 'Lengkapi data rincian', version: await ver() })
  check('Kabagrenmin mengembalikan → 200', r.status === 200, short(r))
  r = await call(ren, 'POST', `${P}/subbagren/keluar/${id}/ajukan`, { version: await ver() })
  check('ajukan ulang → 200', r.status === 200, short(r))
  r = await call(kabag, 'POST', `${P}/keluar/${id}/ttd-setujui`, { version: await ver(), useSaved: false, image, placements: { '00000000-0000-4000-8000-000000000000': box } })
  check('penempatan untuk berkas lain → 400 placements_mismatch', r.status === 400 && r.body?.error === 'placements_mismatch', short(r))
  r = await call(kabag, 'POST', `${P}/keluar/${id}/ttd-setujui`, { version: await ver(), useSaved: false, image: 'data:image/png;base64,AAAA', placements: { [naskahId]: box } })
  check('gambar tanda tangan rusak → 400', r.status === 400, short(r))
  r = await call(kabag, 'POST', `${P}/keluar/${id}/ttd-setujui`, { version: 1, useSaved: false, image, placements: { [naskahId]: box } })
  check('versi basi → 409 version_conflict', r.status === 409 && r.body?.error === 'version_conflict', short(r))
  r = await call(kabag, 'POST', `${P}/keluar/${id}/ttd-setujui`, { version: await ver(), useSaved: false, image, placements: { [naskahId]: box } })
  check('TTD + setujui → 200, 1 naskah', r.status === 200 && r.body?.signedFiles === 1, short(r))
  r = await call(kabag, 'POST', `${P}/keluar/${id}/ttd-setujui`, { version: await ver(), useSaved: false, image, placements: { [naskahId]: box } })
  check('TTD dua kali → 409 surat_bukan_diajukan', r.status === 409 && r.body?.error === 'surat_bukan_diajukan', short(r))

  log('\n5. Kirim & Surat Masuk')
  r = await call(sumda, 'GET', `${P}/subbagsumda/masuk`)
  check('sebelum dikirim, Surat Masuk Sumda belum memuatnya', r.status === 200 && !r.body.items.some((x) => x.id === id), short(r))
  r = await call(sumda, 'POST', `${P}/subbagren/keluar/${id}/kirim`, { version: await ver() })
  check('unit lain menekan Kirim → 403', r.status === 403, short(r))
  r = await call(ren, 'POST', `${P}/subbagren/keluar/${id}/kirim`, { version: await ver() })
  check('kirim → 200', r.status === 200, short(r))
  r = await call(sumda, 'GET', `${P}/subbagsumda/masuk`)
  const masuk = r.body?.items?.find((x) => x.id === id)
  check('Sumda menerima; penerima hanya melihat naskah_ttd + lampiran', Boolean(masuk) && masuk.berkas.every((b) => b.peran !== 'naskah') && masuk.berkas.some((b) => b.peran === 'naskah_ttd') && masuk.berkas.filter((b) => b.peran === 'lampiran').length === 2,
    JSON.stringify(masuk?.berkas?.map((b) => b.peran)))
  const ttdId = masuk?.berkas?.find((b) => b.peran === 'naskah_ttd')?.id
  r = await call(sumda, 'GET', `${P}/subbagsumda/masuk/${id}/berkas/${ttdId}`)
  check('unduh naskah bertanda tangan → PDF utuh', r.status === 200 && r.bytes.subarray(0, 5).toString('latin1') === '%PDF-', short(r))
  r = await call(sumda, 'GET', `${P}/subbagsumda/masuk/${id}/berkas/${naskahId}`)
  check('naskah asli (belum TTD) tidak bisa diunduh penerima', r.status === 200 ? false : true, short(r))
  r = await call(urmin, 'GET', `${P}/urmin/masuk/${id}/berkas/${ttdId}`)
  check('unit bukan tujuan mengunduh → 404', r.status === 404, short(r))
  r = await call(sumda, 'GET', `${P}/subbagbinfung/masuk`)
  check('Sumda membaca Surat Masuk Binfung → 403', r.status === 403, short(r))
  r = await call(kabag, 'POST', `${P}/subbagsumda/masuk/${id}/terima`, {})
  check('Kabagrenmin menandai diterima → 403', r.status === 403, short(r))
  r = await call(sumda, 'POST', `${P}/subbagsumda/masuk/${id}/terima`, {})
  check('Sumda menandai diterima → 200', r.status === 200, short(r))
  r = await call(sumda, 'POST', `${P}/subbagsumda/masuk/${id}/terima`, {})
  check('terima ulang → 409 sudah_diterima', r.status === 409, short(r))
  r = await call(ren, 'GET', `${P}/subbagren/keluar`)
  const t = r.body.items.find((x) => x.id === id).tujuan
  check('pengirim melihat 1/2 unit menerima', t.filter((x) => x.diterimaAt).length === 1 && t.length === 2, JSON.stringify(t))
  r = await call(ren, 'DELETE', `${P}/subbagren/keluar/${id}`)
  check('hapus surat terkirim → 409', r.status === 409, short(r))

  log('\n6. Surat keluar Urmin → unit internal')
  const fields = { tujuan: 'Para Kasubbag', tanggalSurat: new Date().toISOString().slice(0, 10), perihal: `[VERIFY R5H21] Urmin ${tag}`, sifatSurat: 'Biasa', statusAdministrasi: 'Draft', jenisSurat: 'ND', kodeArsip: 'HUM.1.2.', unitNomor: 'Urmin' }
  const c = await call(urmin, 'POST', '/api/v1/urmin/registry/', { kind: 'surat_keluar', code: `R5H21-${tag}`, title: fields.perihal, classification: 'biasa', fields })
  check('surat keluar Urmin uji dibuat', c.status === 201, short(c))
  const rid = c.body?.id
  const work = (await call(urmin, 'GET', `/api/v1/urmin/registry/${rid}`)).body.workRecordId
  r = await upload(urmin, `/api/v1/unit-work/urmin/records/${work}/files`, 'naskah-urmin.pdf', await realPdf(`Urmin ${tag}`), 'application/pdf')
  check('naskah Urmin diunggah', r.status === 201, short(r))
  r = await call(urmin, 'POST', `${P}/dari-urmin/${rid}`, { tujuanUnit: ['subbagren'] })
  check('kirim sebelum disetujui → 409', r.status === 409 && r.body?.error === 'surat_belum_disetujui', short(r))
  let wf = (await call(urmin, 'GET', `/api/v1/urmin/registry/${rid}/workflow`)).body
  r = await call(urmin, 'POST', `/api/v1/urmin/registry/${rid}/submit`, { version: wf.version, note: 'verify' })
  check('Urmin mengajukan', r.status === 200, short(r))
  wf = (await call(urmin, 'GET', `/api/v1/urmin/registry/${rid}/workflow`)).body
  const files = (await call(urmin, 'GET', `/api/v1/unit-work/urmin/records/${work}`)).body.files
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${rid}/sign-approve`, { version: wf.version, useSaved: false, image, placements: Object.fromEntries(files.map((f) => [f.id, box])) })
  check('Kabagrenmin menandatangani surat Urmin (R5H7)', r.status === 200, short(r))
  r = await call(ren, 'POST', `${P}/dari-urmin/${rid}`, { tujuanUnit: ['subbagren'] })
  check('subbag mengirim atas nama Urmin → 403', r.status === 403, short(r))
  r = await call(urmin, 'POST', `${P}/dari-urmin/${rid}`, { tujuanUnit: [] })
  check('tanpa tujuan → 400 tujuan_belum_ada', r.status === 400 && r.body?.error === 'tujuan_belum_ada', short(r))
  r = await call(urmin, 'POST', `${P}/dari-urmin/${rid}`, { tujuanUnit: ['urmin'] })
  check('tujuan Urmin sendiri → 400', r.status === 400, short(r))
  r = await call(urmin, 'POST', `${P}/dari-urmin/00000000-0000-4000-8000-000000000000`, { tujuanUnit: ['subbagren'] })
  check('registry tidak ada → 404', r.status === 404, short(r))
  r = await call(urmin, 'POST', `${P}/dari-urmin/${rid}`, { tujuanUnit: ['subbagren', 'subbagbinfung'] })
  check('kirim ke Subbagren + Binfung → 201', r.status === 201, short(r))
  r = await call(urmin, 'POST', `${P}/dari-urmin/${rid}`, { tujuanUnit: ['subbagsumda'] })
  check('kirim ulang → 409 sudah_dikirim', r.status === 409 && r.body?.error === 'sudah_dikirim', short(r))
  r = await call(ren, 'GET', `${P}/subbagren/masuk`)
  const dariUrmin = r.body?.items?.find((x) => x.perihal === fields.perihal)
  check('Subbagren menerima naskah bertanda tangan dari Urmin', dariUrmin?.unitPengirim === 'urmin' && dariUrmin.berkas.length > 0 && dariUrmin.berkas.every((b) => b.peran === 'naskah_ttd'), JSON.stringify(dariUrmin?.berkas?.map((b) => b.peran)))
  r = await call(sumda, 'GET', `${P}/subbagsumda/masuk`)
  check('Sumda (bukan tujuan) tidak menerimanya', !r.body?.items?.some((x) => x.perihal === fields.perihal), short(r))
  r = await call(urmin, 'GET', `${P}/dari-urmin/${rid}`)
  check('status kiriman terbaca dari Urmin', r.status === 200 && r.body?.item?.tujuan?.length === 2, short(r))

  await db.revokeMintedSessions?.()
  await sql.end(); await db.close()
  log(fail === 0 ? '\nR5H21 LULUS' : `\nR5H21: ${fail} GAGAL`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (error) => { console.error(error); try { await sql.end(); await db.close() } catch {} ; process.exit(1) })
