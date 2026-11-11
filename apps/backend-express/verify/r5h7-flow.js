/**
 * Verifikasi R5H7 dari ujung ke ujung: tanda tangan Kabagrenmin pada naskah
 * surat keluar. EXPRESS SAJA (tidak ada padanan Go):
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h7-flow.js
 *
 * MENULIS KE DATABASE (surat keluar uji, berkas kecil, tanda tangan tersimpan
 * kabagrenmin). Hanya untuk database pengembangan, bukan produksi.
 */
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
  return { status: res.status, body: json, text, bytes, headers: res.headers }
}
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 160)}`
const tag = Date.now().toString().slice(-6)

async function realPdf(pages, title) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`${title} hal ${i + 1}`, { x: 60, y: 780, size: 16, font })
  return Buffer.from(await doc.save())
}
const BROKEN_PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')

async function upload(a, workId, name, bytes, purpose) {
  const parts = [{ name: 'file', filename: name, contentType: 'application/pdf', bytes }]
  if (purpose) parts.push({ name: 'purpose', value: purpose })
  const res = await a.client.request('POST', `/api/v1/unit-work/urmin/records/${workId}/files`, { withCsrf: true, multipart: parts })
  return { status: res.status, text: Buffer.from(res.bytes).toString('utf8') }
}
async function createSubmitted(a, title, files) {
  const fields = {
    tujuan: 'Kepala Bagian Uji', tanggalSurat: new Date().toISOString().slice(0, 10), perihal: title,
    sifatSurat: 'Biasa', statusAdministrasi: 'Draft', jenisSurat: 'ND', kodeArsip: 'HUM.1.2.', unitNomor: 'Bagrenmin',
  }
  const c = await call(a, 'POST', '/api/v1/urmin/registry/', { kind: 'surat_keluar', code: `R5H7-${tag}-${Math.floor(Math.random() * 1e6)}`, title, classification: 'biasa', fields })
  if (c.status !== 201) throw new Error(`buat surat keluar: ${short(c)}`)
  const reg = await call(a, 'GET', `/api/v1/urmin/registry/${c.body.id}`)
  const workId = reg.body.workRecordId
  for (const [name, bytes, purpose] of files) {
    const u = await upload(a, workId, name, bytes, purpose)
    if (u.status !== 201) throw new Error(`unggah ${name}: HTTP ${u.status} ${u.text}`)
  }
  const wf = await call(a, 'GET', `/api/v1/urmin/registry/${c.body.id}/workflow`)
  const s = await call(a, 'POST', `/api/v1/urmin/registry/${c.body.id}/submit`, { version: wf.body.version, note: 'Uji R5H7' })
  if (s.status !== 200) throw new Error(`ajukan: ${short(s)}`)
  const work = await call(a, 'GET', `/api/v1/unit-work/urmin/records/${workId}`)
  return { id: c.body.id, workId, files: work.body.files }
}
const version = async (a, id) => (await call(a, 'GET', `/api/v1/urmin/registry/${id}/workflow`)).body

async function main() {
  await db.ping()
  log(`\nBackend: ${config.apiBase}`)
  const A = {}
  for (const u of ['ka-urmin', 'kabagrenmin', 'superadmin']) A[u] = await actorFor(u)
  const staf = A['ka-urmin']
  const kabag = A.kabagrenmin

  const signature = await sharp({ create: { width: 360, height: 140, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg width="360" height="140"><path d="M20 110 C 80 10, 140 10, 170 100 S 280 130, 340 30" stroke="#123b8a" stroke-width="7" fill="none"/></svg>') }])
    .png().toBuffer()
  const dataUrl = `data:image/png;base64,${signature.toString('base64')}`
  const fake = `data:image/png;base64,${Buffer.from('bukan gambar sama sekali').toString('base64')}`

  log('\n1. Tanda tangan tersimpan')
  let r = await call(A.superadmin, 'GET', '/api/v1/urmin/ttd/me')
  check('Superadmin ditolak dari /urmin/ttd', r.status === 403, short(r))
  r = await call(staf, 'GET', '/api/v1/urmin/ttd/me')
  check('staf (bukan Kabag) ditolak 403', r.status === 403, short(r))
  r = await call(kabag, 'DELETE', '/api/v1/urmin/ttd/me', {})
  check('Kabag hapus tanda tangan tersimpan', r.status === 200 && r.body?.saved === false, short(r))
  r = await call(kabag, 'PUT', '/api/v1/urmin/ttd/me', { image: fake })
  check('PNG palsu ditolak 400', r.status === 400 && r.body?.error === 'invalid_signature_image', short(r))
  r = await call(kabag, 'PUT', '/api/v1/urmin/ttd/me', { image: dataUrl, extra: 1 })
  check('kunci asing ditolak 400', r.status === 400, short(r))

  log('\n2. Tanda tangani & setujui')
  const n1 = await realPdf(2, 'Naskah satu')
  const n2 = await realPdf(1, 'Naskah dua')
  const sk = await createSubmitted(staf, `Uji TTD ${tag}`, [['naskah-1.pdf', n1], ['naskah-2.pdf', n2], ['pendukung.pdf', n2, 'pendukung']])
  const lamp = sk.files.filter((f) => !('purpose' in f))
  const pend = sk.files.find((f) => f.purpose === 'pendukung')
  check('surat uji: 2 naskah + 1 pendukung', lamp.length === 2 && pend, `${sk.files.length} berkas`)
  const f1 = lamp.find((f) => f.name === 'naskah-1.pdf')
  const f2 = lamp.find((f) => f.name === 'naskah-2.pdf')
  const good = {
    [f1.id]: [{ page: 1, x: 0.6, y: 0.75, w: 0.3, h: 0.1 }, { page: 2, x: 0.1, y: 0.8, w: 0.25, h: 0.08 }],
    [f2.id]: [{ page: 1, x: 0.55, y: 0.7, w: 0.3, h: 0.1 }],
  }
  let wf = await version(kabag, sk.id)
  const base = { version: wf.version, note: '', useSaved: false, image: dataUrl }

  r = await call(staf, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, placements: good })
  check('staf tidak bisa menandatangani (403)', r.status === 403, short(r))
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, useSaved: true, image: undefined, placements: good })
  check('pakai tersimpan padahal belum ada → 409 no_saved_signature', r.status === 409 && r.body?.error === 'no_saved_signature', short(r))
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, image: fake, placements: good })
  check('gambar palsu → 400', r.status === 400 && r.body?.error === 'invalid_signature_image', short(r))
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, placements: { [f1.id]: good[f1.id] } })
  check('satu naskah tanpa tanda tangan → 400 placements_mismatch', r.status === 400 && r.body?.error === 'placements_mismatch', short(r))
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, placements: { ...good, [pend.id]: good[f2.id] } })
  check('penempatan pada berkas pendukung → 400 placements_mismatch', r.status === 400 && r.body?.error === 'placements_mismatch', short(r))
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, placements: { ...good, [f2.id]: [{ page: 1, x: 0.9, y: 0.5, w: 0.3, h: 0.1 }] } })
  check('kotak keluar halaman → 400 invalid_placements', r.status === 400 && r.body?.error === 'invalid_placements', short(r))
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, placements: { ...good, [f2.id]: [{ page: 5, x: 0.1, y: 0.5, w: 0.3, h: 0.1 }] } })
  check('halaman tidak ada → 422, surat tetap diajukan', r.status === 422 && r.body?.error === 'page_out_of_range' && (await version(kabag, sk.id)).status === 'submitted', short(r))
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, version: wf.version + 7, placements: good })
  check('versi kedaluwarsa → 409 workflow_state_changed', r.status === 409 && r.body?.error === 'workflow_state_changed', short(r))

  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, saveAsMine: true, placements: good })
  check('Kabag tanda tangani 2 naskah (3 tempat) dan setujui', r.status === 200 && r.body?.signedFiles === 2 && r.body?.status === 'approved', short(r))
  wf = await version(staf, sk.id)
  check('status surat: approved', wf.status === 'approved', wf.status)
  check('riwayat: event approved dengan catatan otomatis', wf.events?.[0]?.action === 'approved' && /2 naskah/.test(wf.events?.[0]?.note ?? ''), wf.events?.[0]?.note)
  r = await call(kabag, 'GET', '/api/v1/urmin/ttd/me')
  check('saveAsMine menyimpan tanda tangan', r.status === 200 && r.body?.saved === true && r.body?.image?.startsWith('data:image/png;base64,'), short(r))
  const seal = await sql.query('SELECT octet_length(image_seal) n, encode(substr(image_seal,1,4),$$escape$$) env FROM sdl_user_signatures WHERE user_id=$1', [kabag.id])
  check('tanda tangan tersimpan TERENKRIPSI (amplop SDL1)', seal.rows[0]?.env === 'SDL1', JSON.stringify(seal.rows[0]))

  log('\n3. Hasil bertanda tangan')
  r = await call(staf, 'GET', `/api/v1/urmin/registry/${sk.id}/signed-files`)
  const items = r.body?.items ?? []
  check('staf melihat 2 naskah bertanda tangan', r.status === 200 && items.length === 2, short(r))
  check('jumlah tanda tangan per naskah 2 dan 1', items.map((i) => i.marks).sort().join(',') === '1,2', items.map((i) => i.marks).join(','))
  check('nama berkas berakhiran -ttd.pdf', items.every((i) => i.name.endsWith('-ttd.pdf')), items.map((i) => i.name).join(','))
  const dl = await call(staf, 'GET', `/api/v1/urmin/registry/${sk.id}/signed-files/${items[0]?.id}`)
  let pagesOk = false
  try { pagesOk = (await PDFDocument.load(dl.bytes)).getPageCount() >= 1 } catch {}
  check('unduh: PDF valid', dl.status === 200 && dl.bytes.subarray(0, 4).toString() === '%PDF' && pagesOk, `HTTP ${dl.status} ${dl.bytes.length} byte`)
  r = await call(A.superadmin, 'GET', `/api/v1/urmin/registry/${sk.id}/signed-files`)
  check('Superadmin tidak bisa membaca hasil (403)', r.status === 403, short(r))
  r = await call(staf, 'DELETE', `/api/v1/unit-work/urmin/records/${sk.workId}/files/${items[0]?.id}`, {})
  const still = await sql.query('SELECT count(*)::int n FROM sdl_outgoing_signed_files WHERE register_id=$1', [sk.id])
  check('berkas bertanda tangan tidak bisa dihapus lewat Berkas Kerja', r.status >= 400 && still.rows[0].n === 2, `${short(r)} · tersisa ${still.rows[0].n}`)

  log('\n4. Tidak bisa diulang')
  wf = await version(kabag, sk.id)
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk.id}/sign-approve`, { ...base, version: wf.version, useSaved: true, image: undefined, placements: good })
  check('tanda tangan kedua → 409', r.status === 409, short(r))

  log('\n5. Integritas & PDF rusak')
  const sk2 = await createSubmitted(staf, `Uji TTD integritas ${tag}`, [['naskah.pdf', n2]])
  await sql.query('UPDATE sdl_urmin_registry SET title=title||$2 WHERE id=$1', [sk2.id, ' (diubah)'])
  wf = await version(kabag, sk2.id)
  const p2 = { [sk2.files[0].id]: [{ page: 1, x: 0.5, y: 0.7, w: 0.3, h: 0.1 }] }
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk2.id}/sign-approve`, { version: wf.version, useSaved: true, placements: p2 })
  check('naskah berubah setelah diajukan → 409 document_integrity_changed', r.status === 409 && r.body?.error === 'document_integrity_changed', short(r))
  const sk3 = await createSubmitted(staf, `Uji TTD rusak ${tag}`, [['rusak.pdf', BROKEN_PDF]])
  wf = await version(kabag, sk3.id)
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/${sk3.id}/sign-approve`, { version: wf.version, useSaved: true, placements: { [sk3.files[0].id]: [{ page: 1, x: 0.5, y: 0.7, w: 0.3, h: 0.1 }] } })
  const after = await version(kabag, sk3.id)
  const rows = await sql.query('SELECT count(*)::int n FROM sdl_outgoing_signed_files WHERE register_id=$1', [sk3.id])
  check('PDF rusak → 422, tidak ada yang tersimpan, surat tetap diajukan', r.status === 422 && after.status === 'submitted' && rows.rows[0].n === 0, `${short(r)} · ${after.status} · ${rows.rows[0].n}`)

  log('\n6. Pesan Kode Register saat "Tambah" (migrasi 046)')
  const fieldsOf = (title) => ({ tujuan: 'Uji', tanggalSurat: new Date().toISOString().slice(0, 10), perihal: title, sifatSurat: 'Biasa', statusAdministrasi: 'Draft', jenisSurat: 'ND', kodeArsip: 'HUM.1.2.', unitNomor: 'Urmin' })
  const urutOf = (nomor) => Number(String(nomor).split('/')[1]?.split('-')[1])
  const p1 = await call(staf, 'POST', '/api/v1/urmin/registry/nomor-urut', {})
  const pLagi = await call(staf, 'POST', '/api/v1/urmin/registry/nomor-urut', {})
  check('pesan nomor → 200 dengan urut', p1.status === 200 && Number.isInteger(p1.body?.urut), short(p1))
  check('Tambah lagi tanpa memakai → nomor SAMA (tidak membakar deret)', pLagi.body?.urut === p1.body?.urut && pLagi.body?.id === p1.body?.id, `${p1.body?.urut} vs ${pLagi.body?.urut}`)
  // Izinnya SAMA dengan membuat surat keluar (Engine B 'create' di urmin);
  // akun tanpa grant Urmin ditolak.
  const luar = await actorFor('staf-subbagsumda')
  r = await call(luar, 'POST', '/api/v1/urmin/registry/nomor-urut', {})
  check('akun tanpa akses Urmin ditolak 403', r.status === 403, short(r))
  r = await call(A.superadmin, 'POST', '/api/v1/urmin/registry/nomor-urut', {})
  check('Superadmin ditolak 403', r.status === 403, short(r))
  const t1 = `Uji pesanan ${tag}`
  r = await call(kabag, 'POST', `/api/v1/urmin/registry/?reservasi=${p1.body.id}`, { kind: 'surat_keluar', code: `R5H7R-${tag}-a`, title: t1, classification: 'biasa', fields: fieldsOf(t1) })
  check('pesanan milik orang lain tidak bisa dipakai', r.status === 403 || r.status === 409, short(r))
  r = await call(staf, 'POST', `/api/v1/urmin/registry/?reservasi=${p1.body.id}`, { kind: 'surat_keluar', code: `R5H7R-${tag}-b`, title: t1, classification: 'biasa', fields: fieldsOf(t1) })
  check('simpan draf memakai pesanan → 201', r.status === 201, short(r))
  const saved = await call(staf, 'GET', `/api/v1/urmin/registry/${r.body?.id}`)
  check('nomor surat memakai urut yang dipesan', urutOf(saved.body?.fields?.nomorSurat) === p1.body.urut, `${saved.body?.fields?.nomorSurat} vs ${p1.body.urut}`)
  r = await call(staf, 'POST', `/api/v1/urmin/registry/?reservasi=${p1.body.id}`, { kind: 'surat_keluar', code: `R5H7R-${tag}-c`, title: t1, classification: 'biasa', fields: fieldsOf(t1) })
  check('pesanan yang sudah terpakai → 409 reservation_invalid', r.status === 409 && r.body?.error === 'reservation_invalid', short(r))
  r = await call(staf, 'POST', '/api/v1/urmin/registry/?reservasi=bukan-uuid', { kind: 'surat_keluar', code: `R5H7R-${tag}-d`, title: t1, classification: 'biasa', fields: fieldsOf(t1) })
  check('reservasi bukan UUID → 400', r.status === 400, short(r))
  const p3 = await call(staf, 'POST', '/api/v1/urmin/registry/nomor-urut', {})
  check('pesanan baru setelah terpakai → nomor lebih besar', p3.body?.urut > p1.body.urut, `${p3.body?.urut} > ${p1.body.urut}`)
  r = await call(staf, 'POST', '/api/v1/urmin/registry/', { kind: 'surat_keluar', code: `R5H7R-${tag}-e`, title: t1, classification: 'biasa', fields: fieldsOf(t1) })
  const tanpa = await call(staf, 'GET', `/api/v1/urmin/registry/${r.body?.id}`)
  check('tanpa ?reservasi tetap seperti dulu (nomor baru, pesanan terbuka tidak dipakai)', r.status === 201 && urutOf(tanpa.body?.fields?.nomorSurat) > p3.body.urut, tanpa.body?.fields?.nomorSurat)

  await db.revokeMintedSessions?.()
  await sql.end(); await db.close()
  log(fail === 0 ? '\nR5H7 LULUS' : `\nR5H7: ${fail} GAGAL`)
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (error) => { console.error(error); try { await sql.end(); await db.close() } catch {} ; process.exit(1) })
