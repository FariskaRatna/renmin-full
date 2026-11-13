/**
 * R5H13: uji Dokumen Perencanaan + Monitoring Kinerja & LKIP (migrasi 051).
 *
 *   docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml \
 *     -f infra/compose.harness.yaml run --rm --build -e SDL_HARNESS_API_BASE=http://api-express:8080 \
 *     --entrypoint node harness verify/r5h13-flow.js
 *
 * Tahun 2099; data ujinya dihapus di akhir (database pengembangan saja).
 */
import { inflateRawSync } from 'node:zlib'

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
  const base = path.startsWith('/api/') ? '' : '/api/v1/subbagren/perencanaan'
  const res = await a.client.request(method, `${base}${path}`, { withCsrf: method !== 'GET', ...(body !== undefined ? { body } : {}), ...extra })
  const bytes = Buffer.from(res.bytes)
  const text = bytes.toString('utf8')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text, bytes, headers: res.headers }
}
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 160)}`
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')
const upload = (a, did, bytes, filename) => call(a, 'POST', `/dokumen/${did}/berkas`, undefined, { multipart: [{ name: 'file', filename, contentType: 'application/pdf', bytes }] })

/** Ambil satu berkas dari ZIP (cukup untuk XLSX buatan kita: deflate, tanpa data descriptor). */
function unzipEntry(buf, name) {
  let off = 0
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const csize = buf.readUInt32LE(off + 18); const nlen = buf.readUInt16LE(off + 26); const xlen = buf.readUInt16LE(off + 28)
    const n = buf.subarray(off + 30, off + 30 + nlen).toString('utf8')
    const start = off + 30 + nlen + xlen
    if (n === name) return inflateRawSync(buf.subarray(start, start + csize)).toString('utf8')
    off = start + csize
  }
  return null
}

async function cleanup() {
  const prog = `SELECT id FROM sdl_ren_program WHERE tahun=${TAHUN}`
  const keg = `SELECT id FROM sdl_ren_kegiatan WHERE program_id IN (${prog})`
  await sql.query(`DELETE FROM sdl_ren_dokumen_berkas WHERE dokumen_id IN (SELECT id FROM sdl_ren_dokumen WHERE tahun=${TAHUN})`)
  // Revisi menunjuk dokumen lama: hapus revisi dulu.
  await sql.query(`DELETE FROM sdl_ren_dokumen WHERE tahun=${TAHUN} AND pengganti_dari IS NOT NULL`)
  await sql.query(`DELETE FROM sdl_ren_dokumen WHERE tahun=${TAHUN}`)
  await sql.query(`DELETE FROM sdl_ren_capaian WHERE indikator_id IN (SELECT id FROM sdl_ren_indikator WHERE kegiatan_id IN (${keg}))`)
  await sql.query(`DELETE FROM sdl_ren_indikator WHERE kegiatan_id IN (${keg})`)
  await sql.query(`DELETE FROM sdl_ren_realisasi_bukti WHERE realisasi_id IN (SELECT id FROM sdl_ren_realisasi WHERE pagu_id IN (SELECT id FROM sdl_ren_pagu WHERE kegiatan_id IN (${keg})))`)
  await sql.query(`DELETE FROM sdl_ren_realisasi WHERE pagu_id IN (SELECT id FROM sdl_ren_pagu WHERE kegiatan_id IN (${keg}))`)
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
  const progar = (a, m, p, b) => call(a, m, `/api/v1/subbagren/progar${p}`, b)

  const progId = (await progar(op, 'POST', '/program', { tahun: TAHUN, kode: 'R13', nama: 'Program Uji Kinerja', keterangan: '' })).body?.id
  const kegId = (await progar(op, 'POST', `/program/${progId}/kegiatan`, { kode: '1', nama: 'Kegiatan Uji Kinerja', keterangan: '' })).body?.id
  const paguId = (await progar(op, 'POST', '/pagu', { kegiatanId: kegId, jumlah: '200000000', dasar: 'DIPA uji', keterangan: '' })).body?.id
  await progar(ka, 'POST', `/pagu/${paguId}/review`, { keputusan: 'disetujui', catatan: '', version: 1 })

  log('\n1. Kewenangan')
  const caps = async (a) => { const c = (await call(a, 'GET', '/capabilities')).body; return [c?.canRead, c?.canManage, c?.canSahkan] }
  check('op: baca+kelola, tidak mengesahkan', JSON.stringify(await caps(op)) === '[true,true,false]')
  check('staf: baca saja', JSON.stringify(await caps(staf)) === '[true,false,false]')
  check('kasubbagren: ketiganya', JSON.stringify(await caps(ka)) === '[true,true,true]')
  check('kabagrenmin membaca kinerja', (await call(kabag, 'GET', `/kinerja?tahun=${TAHUN}`)).status === 200)
  check('unit lain tidak bisa membaca dokumen 403', (await call(luar, 'GET', `/dokumen?tahun=${TAHUN}`)).status === 403)
  check('staf tidak bisa mengunggah dokumen 403', (await call(staf, 'POST', '/dokumen', { tahun: TAHUN, jenis: 'dipa', judul: 'X Y Z', nomor: '', tanggal: '', programId: '', kegiatanId: '', keterangan: '' })).status === 403)

  log('\n2. Dokumen Perencanaan')
  const doc = { tahun: TAHUN, jenis: 'dipa', judul: 'DIPA Uji 2099', nomor: 'SP DIPA-001/2099', tanggal: `${TAHUN}-01-02`, programId: progId, kegiatanId: '', keterangan: '' }
  let r = await call(op, 'POST', '/dokumen', { ...doc, tahun: TAHUN - 1 })
  check('program dari tahun lain ditolak 400', r.status === 400 && r.body?.error === 'invalid_link', short(r))
  r = await call(op, 'POST', '/dokumen', { ...doc, jenis: 'surat' })
  check('jenis tak dikenal ditolak 400', r.status === 400, short(r))
  r = await call(op, 'POST', '/dokumen', doc)
  check('Operator mengunggah DIPA (draft)', r.status === 201, short(r))
  const d1 = r.body?.id
  r = await call(ka, 'POST', `/dokumen/${d1}/review`, { keputusan: 'disahkan', catatan: '', version: 1 })
  check('pengesahan tanpa PDF ditolak 409', r.status === 409 && r.body?.error === 'berkas_required', short(r))
  check('berkas bukan PDF ditolak 400', (await upload(op, d1, Buffer.from('bukan pdf'), 'dipa.pdf')).status === 400)
  check('lampirkan PDF', (await upload(op, d1, pdf, 'DIPA-2099.pdf')).status === 201)
  const enc = await sql.query('SELECT body FROM sdl_ren_dokumen_berkas WHERE dokumen_id=$1', [d1])
  check('berkas tersimpan terenkripsi', enc.rows[0] && !Buffer.from(enc.rows[0].body).includes(Buffer.from('%PDF')))
  r = await call(staf, 'GET', `/dokumen/${d1}/berkas`)
  check('staf mengunduh, isi sama persis', r.status === 200 && r.bytes.equals(pdf), `HTTP ${r.status}`)
  r = await call(ka, 'POST', `/dokumen/${d1}/review`, { keputusan: 'disahkan', catatan: '', version: 1 })
  check('versi basi (sebelum PDF) ditolak 409', r.status === 409 && r.body?.error === 'version_conflict', short(r))
  r = await call(ka, 'POST', `/dokumen/${d1}/review`, { keputusan: 'disahkan', catatan: '', version: 2 })
  check('Kasubbagren mengesahkan DIPA', r.status === 200, short(r))
  check('dokumen sah terkunci (unggah ulang 409)', (await upload(op, d1, pdf, 'x.pdf')).status === 409)

  r = await call(ka, 'POST', '/dokumen', { ...doc, jenis: 'tor_kak', judul: 'TOR Kasubbag', programId: '', kegiatanId: kegId })
  const d2 = r.body?.id
  await upload(ka, d2, pdf, 'TOR.pdf')
  r = await call(ka, 'POST', `/dokumen/${d2}/review`, { keputusan: 'disahkan', catatan: '', version: 2 })
  check('mengesahkan unggahan sendiri ditolak 403', r.status === 403 && r.body?.error === 'self_review_forbidden', short(r))

  log('\n3. Revisi')
  r = await call(op, 'POST', '/dokumen', { ...doc, judul: 'Revisi dari draft', penggantiDari: d2 })
  check('revisi dari dokumen yang belum sah ditolak 409', r.status === 409, short(r))
  r = await call(op, 'POST', '/dokumen', { ...doc, judul: 'DIPA Uji 2099 Revisi 1', nomor: 'SP DIPA-001/2099 Rev.1', penggantiDari: d1 })
  check('revisi DIPA dibuat', r.status === 201, short(r))
  const d3 = r.body?.id
  r = await call(op, 'POST', '/dokumen', { ...doc, judul: 'Revisi ganda', penggantiDari: d1 })
  check('revisi kedua untuk dokumen yang sama ditolak 409', r.status === 409 && r.body?.error === 'revisi_sudah_ada', short(r))
  await upload(op, d3, pdf, 'DIPA-2099-rev1.pdf')
  check('revisi disahkan', (await call(ka, 'POST', `/dokumen/${d3}/review`, { keputusan: 'disahkan', catatan: '', version: 2 })).status === 200)
  const list = (await call(staf, 'GET', `/dokumen?tahun=${TAHUN}`)).body?.items ?? []
  check('dokumen lama ditandai digantikan', list.find((x) => x.id === d1)?.digantikan === true && list.find((x) => x.id === d3)?.digantikan === false)
  check('DIPA lama tetap bisa diunduh', (await call(staf, 'GET', `/dokumen/${d1}/berkas`)).status === 200)

  log('\n4. Indikator dan capaian')
  const ind = { kegiatanId: kegId, nama: 'Persentase laporan keuangan tepat waktu', satuan: '%', target: ['25', '50', '75', '100'] }
  r = await call(op, 'POST', '/kinerja/indikator', { ...ind, target: ['50', '25', '75', '100'] })
  check('target tidak kumulatif ditolak 400', r.status === 400 && r.body?.error === 'target_tidak_kumulatif', short(r))
  r = await call(op, 'POST', '/kinerja/indikator', { ...ind, target: ['1', '2', '3', '0'] })
  check('target tahunan 0 ditolak 400', r.status === 400, short(r))
  r = await call(op, 'POST', '/kinerja/indikator', ind)
  check('Operator menambah indikator', r.status === 201, short(r))
  const i1 = r.body?.id
  const i2 = (await call(op, 'POST', '/kinerja/indikator', { kegiatanId: kegId, nama: 'Jumlah dokumen perencanaan sah', satuan: 'dokumen', target: ['1', '2', '3', '4'] })).body?.id
  check('staf tidak bisa mengisi capaian 403', (await call(staf, 'PUT', `/kinerja/indikator/${i1}/capaian/1`, { nilai: '20', catatan: '' })).status === 403)
  check('capaian TW I disimpan', (await call(op, 'PUT', `/kinerja/indikator/${i1}/capaian/1`, { nilai: '20', catatan: 'Satu laporan terlambat' })).status === 200)
  check('capaian TW II disimpan (desimal)', (await call(op, 'PUT', `/kinerja/indikator/${i1}/capaian/2`, { nilai: '47.5', catatan: '' })).status === 200)
  check('capaian TW I bisa dikoreksi', (await call(ka, 'PUT', `/kinerja/indikator/${i1}/capaian/1`, { nilai: '22.5', catatan: 'Koreksi' })).status === 200)
  check('triwulan 5 ditolak 404', (await call(op, 'PUT', `/kinerja/indikator/${i1}/capaian/5`, { nilai: '1', catatan: '' })).status === 404)
  check('nilai bukan angka ditolak 400', (await call(op, 'PUT', `/kinerja/indikator/${i1}/capaian/3`, { nilai: '12,5', catatan: '' })).status === 400)
  check('indikator bercapaian tidak bisa dihapus 409', (await call(op, 'DELETE', `/kinerja/indikator/${i1}`)).status === 409)
  check('indikator tanpa capaian bisa dihapus', (await call(op, 'DELETE', `/kinerja/indikator/${i2}`)).status === 200)

  await progar(op, 'POST', '/realisasi', { paguId, tanggal: `${TAHUN}-04-01`, uraian: 'Belanja uji', nomorBukti: 'SPM-9/2099', jumlah: '50000000' })
  const rid = (await sql.query('SELECT id::text FROM sdl_ren_realisasi WHERE pagu_id=$1', [paguId])).rows[0]?.id
  await call(op, 'POST', `/api/v1/subbagren/progar/realisasi/${rid}/bukti`, undefined, { multipart: [{ name: 'file', filename: 'spm.pdf', contentType: 'application/pdf', bytes: pdf }] })
  await progar(ka, 'POST', `/realisasi/${rid}/review`, { keputusan: 'terverifikasi', catatan: '', version: 2 })

  const k = (await call(kabag, 'GET', `/kinerja?tahun=${TAHUN}`)).body?.kegiatan?.find((x) => x.id === kegId)
  check('kinerja: satu indikator, capaian TW I 22.5 dan TW II 47.5', k?.indikator?.length === 1 && Number(k.indikator[0].capaian[0]?.nilai) === 22.5 && Number(k.indikator[0].capaian[1]?.nilai) === 47.5, JSON.stringify(k?.indikator?.[0]?.capaian?.map((c) => c?.nilai)))
  check('kinerja: pagu 200 jt, realisasi terverifikasi 50 jt', k?.pagu === '200000000' && k?.realisasi === '50000000', `${k?.pagu} / ${k?.realisasi}`)

  log('\n5. Excel LKIP')
  r = await call(staf, 'GET', `/kinerja/lkip.xlsx?tahun=${TAHUN}`)
  check('unduh Excel 200 + tipe xlsx', r.status === 200 && String(r.headers?.get?.('content-type') ?? r.headers?.['content-type'] ?? '').includes('spreadsheetml'), `HTTP ${r.status}`)
  const sheet = unzipEntry(r.bytes, 'xl/worksheets/sheet1.xml') ?? ''
  check('sheet Capaian berisi kegiatan, indikator, dan angka', sheet.includes('Kegiatan Uji Kinerja') && sheet.includes('Persentase laporan keuangan tepat waktu') && sheet.includes('<v>47.5</v>') && sheet.includes('<v>200000000</v>'))
  check('% capaian tahunan = 47.5/100 = 0.475', sheet.includes('<v>0.475</v>'))
  const sheet2 = unzipEntry(r.bytes, 'xl/worksheets/sheet2.xml') ?? ''
  check('sheet Dokumen Sah hanya berisi versi terbaru', sheet2.includes('DIPA Uji 2099 Revisi 1') && !sheet2.includes('SP DIPA-001/2099<'))
  check('unit lain tidak bisa mengunduh Excel 403', (await call(luar, 'GET', `/kinerja/lkip.xlsx?tahun=${TAHUN}`)).status === 403)
} finally {
  await cleanup()
  await db.revokeMintedSessions()
  await db.close?.()
  await sql.end()
}

log(fail ? `\n${fail} cek GAGAL` : '\nSemua cek LULUS')
process.exit(fail ? 1 : 0)
