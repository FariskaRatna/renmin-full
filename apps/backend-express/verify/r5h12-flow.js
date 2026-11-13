/**
 * R5H12: uji alur Realisasi per kegiatan (migrasi 050) terhadap Pagu R5H11.
 *
 *   docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml \
 *     -f infra/compose.harness.yaml run --rm --build -e SDL_HARNESS_API_BASE=http://api-express:8080 \
 *     --entrypoint node harness verify/r5h12-flow.js
 *
 * Tahun 2099; seluruh data ujinya dihapus di akhir (database pengembangan saja).
 * Butuh SDL_EVIDENCE_KEY yang valid di api-express (bukti dienkripsi).
 */
import pg from 'pg'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2 })
const TAHUN = 2099
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }

async function actorFor(username) {
  const id = await db.userIdByUsername(username)
  const client = new HttpClient({ ...config })
  client.setCookie('sdl_session', await db.mintSession(id))
  await client.ensureCsrf()
  return { id, username, client }
}
async function call(a, method, path, body, extra = {}) {
  const res = await a.client.request(method, `/api/v1/subbagren/progar${path}`, { withCsrf: method !== 'GET', ...(body !== undefined ? { body } : {}), ...extra })
  const bytes = Buffer.from(res.bytes)
  const text = bytes.toString('utf8')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text, bytes }
}
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 160)}`
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')
const upload = (a, rid, bytes, filename) => call(a, 'POST', `/realisasi/${rid}/bukti`, undefined,
  { multipart: [{ name: 'file', filename, contentType: 'application/pdf', bytes }] })

async function cleanup() {
  const prog = `SELECT id FROM sdl_ren_program WHERE tahun=${TAHUN}`
  const keg = `SELECT id FROM sdl_ren_kegiatan WHERE program_id IN (${prog})`
  const pagu = `SELECT id FROM sdl_ren_pagu WHERE kegiatan_id IN (${keg})`
  const real = `SELECT id FROM sdl_ren_realisasi WHERE pagu_id IN (${pagu})`
  await sql.query(`DELETE FROM sdl_ren_realisasi_bukti WHERE realisasi_id IN (${real})`)
  await sql.query(`DELETE FROM sdl_ren_realisasi WHERE pagu_id IN (${pagu})`)
  await sql.query(`DELETE FROM sdl_ren_pagu WHERE kegiatan_id IN (${keg})`)
  await sql.query(`DELETE FROM sdl_ren_kegiatan WHERE program_id IN (${prog})`)
  await sql.query(`DELETE FROM sdl_ren_program WHERE tahun=${TAHUN}`)
}

await cleanup()
try {
  const op = await actorFor('op-subbagren')
  const staf = await actorFor('staf-subbagren')
  const ka = await actorFor('kasubbagren')
  const kabag = await actorFor('kabagrenmin')
  const luar = await actorFor('staf-subbagsumda')

  log('\n0. Persiapan: program, kegiatan, pagu Rp 100.000.000 disetujui')
  const progId = (await call(op, 'POST', '/program', { tahun: TAHUN, kode: 'R12', nama: 'Program Uji Realisasi', keterangan: '' })).body?.id
  const kegA = (await call(op, 'POST', `/program/${progId}/kegiatan`, { kode: '1', nama: 'Kegiatan berpagu', keterangan: '' })).body?.id
  const kegB = (await call(op, 'POST', `/program/${progId}/kegiatan`, { kode: '2', nama: 'Kegiatan pagu draft', keterangan: '' })).body?.id
  const paguA = (await call(op, 'POST', '/pagu', { kegiatanId: kegA, jumlah: '100000000', dasar: 'DIPA uji', keterangan: '' })).body?.id
  const paguB = (await call(op, 'POST', '/pagu', { kegiatanId: kegB, jumlah: '5000000', dasar: 'DIPA uji', keterangan: '' })).body?.id
  check('pagu A disetujui', (await call(ka, 'POST', `/pagu/${paguA}/review`, { keputusan: 'disetujui', catatan: '', version: 1 })).status === 200)

  log('\n1. Kewenangan')
  const caps = async (a) => { const c = (await call(a, 'GET', '/capabilities')).body; return [c?.canRecordRealisasi, c?.canVerifyRealisasi] }
  check('op: catat ya, verifikasi tidak', JSON.stringify(await caps(op)) === '[true,false]')
  check('staf: tidak keduanya', JSON.stringify(await caps(staf)) === '[false,false]')
  check('kasubbagren: keduanya', JSON.stringify(await caps(ka)) === '[true,true]')
  const sample = { paguId: paguA, tanggal: `${TAHUN}-03-10`, uraian: 'Belanja ATK triwulan I', nomorBukti: 'SPM-001/2099', jumlah: '60000000' }
  check('staf tidak bisa mencatat 403', (await call(staf, 'POST', '/realisasi', sample)).status === 403)
  check('kabagrenmin tidak bisa mencatat 403', (await call(kabag, 'POST', '/realisasi', sample)).status === 403)
  check('unit lain tidak bisa membaca 403', (await call(luar, 'GET', `/realisasi?tahun=${TAHUN}`)).status === 403)

  log('\n2. Validasi pencatatan')
  let r = await call(op, 'POST', '/realisasi', { ...sample, tanggal: `${TAHUN - 1}-12-31` })
  check('tanggal di luar tahun anggaran ditolak 400', r.status === 400 && r.body?.error === 'tahun_tidak_cocok', short(r))
  r = await call(op, 'POST', '/realisasi', { ...sample, jumlah: '150000000' })
  check('melebihi pagu ditolak 409', r.status === 409 && r.body?.error === 'melebihi_sisa_pagu', short(r))
  r = await call(op, 'POST', '/realisasi', { ...sample, paguId: paguB, jumlah: '1000' })
  check('pagu yang belum disetujui ditolak 409', r.status === 409 && r.body?.error === 'pagu_not_approved', short(r))
  r = await call(op, 'POST', '/realisasi', sample)
  check('Operator mencatat realisasi Rp 60 jt', r.status === 201, short(r))
  const rA = r.body?.id

  log('\n3. Bukti bayar')
  r = await call(ka, 'POST', `/realisasi/${rA}/review`, { keputusan: 'terverifikasi', catatan: '', version: 1 })
  check('verifikasi tanpa bukti ditolak 409', r.status === 409 && r.body?.error === 'bukti_required', short(r))
  r = await upload(op, rA, Buffer.from('bukan pdf'), 'bukti.pdf')
  check('berkas palsu (.pdf bukan PDF) ditolak 400', r.status === 400 && r.body?.error === 'invalid_file_type', short(r))
  r = await upload(op, rA, pdf, 'SPM-001.pdf')
  check('unggah bukti PDF', r.status === 201, short(r))
  const enc = await sql.query('SELECT body FROM sdl_ren_realisasi_bukti WHERE realisasi_id=$1', [rA])
  check('bukti tersimpan TERENKRIPSI (bukan PDF mentah)', enc.rows[0] && !Buffer.from(enc.rows[0].body).includes(Buffer.from('%PDF')))
  r = await call(staf, 'GET', `/realisasi/${rA}/bukti`)
  check('staf bisa mengunduh, isinya sama persis', r.status === 200 && r.bytes.equals(pdf), `HTTP ${r.status}`)
  check('unit lain tidak bisa mengunduh 403', (await call(luar, 'GET', `/realisasi/${rA}/bukti`)).status === 403)

  log('\n4. Verifikasi')
  r = await call(ka, 'POST', `/realisasi/${rA}/review`, { keputusan: 'terverifikasi', catatan: '', version: 1 })
  check('versi basi (sebelum bukti diunggah) ditolak 409', r.status === 409 && r.body?.error === 'version_conflict', short(r))
  r = await call(op, 'POST', `/realisasi/${rA}/review`, { keputusan: 'terverifikasi', catatan: '', version: 2 })
  check('Operator tidak bisa memverifikasi 403', r.status === 403, short(r))
  r = await call(ka, 'POST', `/realisasi/${rA}/review`, { keputusan: 'terverifikasi', catatan: '', version: 2 })
  check('Kasubbagren memverifikasi Rp 60 jt', r.status === 200, short(r))
  check('bukti tidak bisa diganti setelah terverifikasi 409', (await upload(op, rA, pdf, 'x.pdf')).status === 409)

  const rB = (await call(op, 'POST', '/realisasi', { ...sample, uraian: 'Belanja jasa', nomorBukti: 'SPM-002/2099', jumlah: '40000000' })).body?.id
  const rC = (await call(op, 'POST', '/realisasi', { ...sample, uraian: 'Belanja modal', nomorBukti: 'SPM-003/2099', jumlah: '30000000' })).body?.id
  check('dua realisasi draft (40 jt + 30 jt) boleh dicatat selama masing-masing muat di sisa', Boolean(rB && rC))
  await upload(op, rB, pdf, 'SPM-002.pdf'); await upload(op, rC, pdf, 'SPM-003.pdf')
  check('verifikasi 40 jt (total 100 jt = pagu)', (await call(ka, 'POST', `/realisasi/${rB}/review`, { keputusan: 'terverifikasi', catatan: '', version: 2 })).status === 200)
  r = await call(ka, 'POST', `/realisasi/${rC}/review`, { keputusan: 'terverifikasi', catatan: '', version: 2 })
  check('verifikasi 30 jt yang melampaui pagu ditolak 409', r.status === 409 && r.body?.error === 'melebihi_sisa_pagu', short(r))
  r = await call(ka, 'POST', `/realisasi/${rC}/review`, { keputusan: 'ditolak', catatan: 'Pagu kegiatan sudah habis terserap', version: 2 })
  check('Kasubbagren menolak dengan alasan', r.status === 200, short(r))

  log('\n5. Pencatat tidak boleh memverifikasi sendiri')
  await sql.query("UPDATE sdl_ren_pagu SET jumlah=jumlah+10000000 WHERE id=$1", [paguA])
  const rD = (await call(ka, 'POST', '/realisasi', { ...sample, uraian: 'Belanja oleh Kasubbag', nomorBukti: 'SPM-004/2099', jumlah: '5000000' })).body?.id
  await upload(ka, rD, pdf, 'SPM-004.pdf')
  r = await call(ka, 'POST', `/realisasi/${rD}/review`, { keputusan: 'terverifikasi', catatan: '', version: 2 })
  check('Kasubbagren memverifikasi realisasinya sendiri ditolak 403', r.status === 403 && r.body?.error === 'self_review_forbidden', short(r))

  log('\n6. Ringkasan')
  const sum = (await call(kabag, 'GET', `/realisasi?tahun=${TAHUN}`)).body
  const item = sum?.items?.find((i) => i.paguId === paguA)
  check('Kabagrenmin bisa membaca ringkasan', Boolean(item))
  check('pagu 110 jt, terverifikasi 100 jt, menunggu 5 jt, sisa 10 jt',
    item?.pagu === '110000000' && item?.terverifikasi === '100000000' && item?.menunggu === '5000000' && item?.sisa === '10000000', JSON.stringify({ ...item, realisasi: undefined }))
  check('pagu draft (kegiatan B) tidak muncul di realisasi', !sum?.items?.some((i) => i.paguId === paguB))
  check('alasan penolakan terbaca', item?.realisasi?.find((x) => x.id === rC)?.reviewNote === 'Pagu kegiatan sudah habis terserap')
  check('info bukti ada di baris', item?.realisasi?.find((x) => x.id === rA)?.bukti?.filename === 'SPM-001.pdf')
} finally {
  await cleanup()
  await db.revokeMintedSessions()
  await db.close?.()
  await sql.end()
}

log(fail ? `\n${fail} cek GAGAL` : '\nSemua cek LULUS')
process.exit(fail ? 1 : 0)
