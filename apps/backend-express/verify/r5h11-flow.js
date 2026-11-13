/**
 * R5H11: uji alur Program Anggaran -> Kegiatan -> Pagu (migrasi 049).
 *
 * Dijalankan di jaringan Docker (image harness), terhadap Express:
 *   docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml \
 *     -f infra/compose.harness.yaml run --rm --build -e SDL_HARNESS_API_BASE=http://api-express:8080 \
 *     --entrypoint node harness verify/r5h11-flow.js
 *
 * Memakai tahun 2099 supaya tidak bercampur dengan data uji coba manual, dan
 * menghapus data ujinya sendiri di akhir (database pengembangan saja).
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
async function call(a, method, path, body) {
  const res = await a.client.request(method, `/api/v1/subbagren/progar${path}`, { withCsrf: method !== 'GET', ...(body !== undefined ? { body } : {}) })
  const text = Buffer.from(res.bytes).toString('utf8')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text }
}
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 160)}`

async function cleanup() {
  await sql.query(`DELETE FROM sdl_ren_pagu WHERE kegiatan_id IN (SELECT k.id FROM sdl_ren_kegiatan k JOIN sdl_ren_program p ON p.id=k.program_id WHERE p.tahun=$1)`, [TAHUN])
  await sql.query(`DELETE FROM sdl_ren_kegiatan WHERE program_id IN (SELECT id FROM sdl_ren_program WHERE tahun=$1)`, [TAHUN])
  await sql.query('DELETE FROM sdl_ren_program WHERE tahun=$1', [TAHUN])
}

await cleanup()
try {
  const op = await actorFor('op-subbagren')
  const staf = await actorFor('staf-subbagren')
  const ka = await actorFor('kasubbagren')
  const kabag = await actorFor('kabagrenmin')
  const luar = await actorFor('staf-subbagsumda')

  log('\n1. Kewenangan per jabatan')
  const capsOf = async (a) => (await call(a, 'GET', '/capabilities')).body
  const expect = {
    'op-subbagren': [true, true, false], 'staf-subbagren': [true, false, false], kasubbagren: [true, true, true],
    kabagrenmin: [true, false, false], 'staf-subbagsumda': [false, false, false],
  }
  for (const a of [op, staf, ka, kabag, luar]) {
    const c = await capsOf(a)
    const got = c ? [c.canRead, c.canManage, c.canApprove] : null
    check(`${a.username} read/manage/approve = ${expect[a.username]}`, JSON.stringify(got) === JSON.stringify(expect[a.username]), JSON.stringify(c))
  }
  check('unit lain tidak bisa membaca', (await call(luar, 'GET', `/?tahun=${TAHUN}`)).status === 403)
  check('Kabagrenmin bisa membaca', (await call(kabag, 'GET', `/?tahun=${TAHUN}`)).status === 200)
  check('Staf tidak bisa menambah program', (await call(staf, 'POST', '/program', { tahun: TAHUN, kode: 'X', nama: 'Program X' })).status === 403)

  log('\n2. Program dan Kegiatan')
  let r = await call(op, 'POST', '/program', { tahun: TAHUN, kode: '060.01.WA', nama: 'Program Dukungan Manajemen', keterangan: '' })
  check('Operator menambah program', r.status === 201, short(r))
  const progId = r.body?.id
  r = await call(op, 'POST', '/program', { tahun: TAHUN, kode: '060.01.wa', nama: 'Duplikat', keterangan: '' })
  check('kode program ganda (beda huruf besar) ditolak 409', r.status === 409, short(r))
  r = await call(op, 'POST', '/program', { tahun: TAHUN, kode: 'A', nama: 'X', keterangan: '' })
  check('nama terlalu pendek ditolak 400', r.status === 400, short(r))
  r = await call(op, 'POST', '/program', { tahun: TAHUN, kode: 'B', nama: 'Program B', keterangan: '', ekstra: 1 })
  check('field asing ditolak 400', r.status === 400, short(r))

  const keg = []
  for (const [kode, nama] of [['3074', 'Dukungan Manajemen dan Teknis'], ['3075', 'Pengadaan Sarana'], ['3076', 'Pelatihan']]) {
    r = await call(op, 'POST', `/program/${progId}/kegiatan`, { kode, nama, keterangan: '' })
    check(`kegiatan ${kode} ditambahkan`, r.status === 201, short(r))
    keg.push(r.body?.id)
  }
  r = await call(op, 'POST', `/program/${progId}/kegiatan`, { kode: '3074', nama: 'Ganda', keterangan: '' })
  check('kode kegiatan ganda dalam satu program ditolak 409', r.status === 409, short(r))

  let tree = (await call(op, 'GET', `/?tahun=${TAHUN}`)).body
  const prog = tree?.programs?.find((p) => p.id === progId)
  check('pohon: 1 program, 3 kegiatan, belum ada pagu', prog?.kegiatan?.length === 3 && prog.kegiatan.every((k) => k.pagu === null), JSON.stringify(prog?.kegiatan?.map((k) => k.kode)))
  r = await call(op, 'PUT', `/program/${progId}`, { kode: '060.01.WA', nama: 'Program Dukungan Manajemen Polri', keterangan: '', version: prog.version + 5 })
  check('ubah program dengan versi basi ditolak 409', r.status === 409 && r.body?.error === 'version_conflict', short(r))
  r = await call(op, 'PUT', `/program/${progId}`, { kode: '060.01.WA', nama: 'Program Dukungan Manajemen Polri', keterangan: '', version: prog.version })
  check('ubah program dengan versi benar', r.status === 200, short(r))

  log('\n3. Pagu: catat -> setujui')
  r = await call(op, 'POST', '/pagu', { kegiatanId: keg[0], jumlah: '1500000000', dasar: 'DIPA 2099 No. 1', keterangan: '' })
  check('Operator mencatat pagu (draft)', r.status === 201, short(r))
  const pagu1 = r.body?.id
  r = await call(op, 'POST', '/pagu', { kegiatanId: keg[0], jumlah: '1', dasar: 'DIPA 2099 No. 2', keterangan: '' })
  check('pagu kedua untuk kegiatan yang sama ditolak 409', r.status === 409 && r.body?.error === 'pagu_exists', short(r))
  r = await call(op, 'POST', '/pagu', { kegiatanId: keg[1], jumlah: '1.5', dasar: 'DIPA', keterangan: '' })
  check('jumlah bukan bilangan bulat ditolak 400', r.status === 400, short(r))
  r = await call(op, 'POST', '/pagu', { kegiatanId: keg[1], jumlah: 1500, dasar: 'DIPA', keterangan: '' })
  check('jumlah berupa number (bukan string) ditolak 400', r.status === 400, short(r))
  r = await call(op, 'PUT', `/pagu/${pagu1}`, { jumlah: '1750000000', dasar: 'DIPA 2099 No. 1 (revisi)', keterangan: '', version: 1 })
  check('pagu draft bisa diubah', r.status === 200, short(r))
  r = await call(op, 'POST', `/pagu/${pagu1}/review`, { keputusan: 'disetujui', catatan: '', version: 2 })
  check('Operator tidak bisa menyetujui (tanpa wewenang) 403', r.status === 403, short(r))
  r = await call(ka, 'POST', `/pagu/${pagu1}/review`, { keputusan: 'disetujui', catatan: '', version: 1 })
  check('persetujuan dengan versi basi ditolak 409', r.status === 409, short(r))
  r = await call(ka, 'POST', `/pagu/${pagu1}/review`, { keputusan: 'disetujui', catatan: '', version: 2 })
  check('Kasubbagren menyetujui pagu Operator', r.status === 200, short(r))
  r = await call(op, 'PUT', `/pagu/${pagu1}`, { jumlah: '1', dasar: 'Ubah', keterangan: '', version: 3 })
  check('pagu yang disetujui tidak bisa diubah 409', r.status === 409 && r.body?.error === 'pagu_not_draft', short(r))

  log('\n4. Pencatat tidak boleh menyetujui inputannya sendiri')
  r = await call(ka, 'POST', '/pagu', { kegiatanId: keg[1], jumlah: '250000000', dasar: 'DIPA 2099 No. 3', keterangan: '' })
  check('Kasubbagren mencatat pagu sendiri', r.status === 201, short(r))
  r = await call(ka, 'POST', `/pagu/${r.body?.id}/review`, { keputusan: 'disetujui', catatan: '', version: 1 })
  check('Kasubbagren menyetujui pagunya sendiri ditolak 403', r.status === 403 && r.body?.error === 'self_review_forbidden', short(r))

  log('\n5. Tolak lalu catat ulang')
  r = await call(op, 'POST', '/pagu', { kegiatanId: keg[2], jumlah: '99000000', dasar: 'DIPA 2099 No. 4', keterangan: '' })
  const pagu3 = r.body?.id
  r = await call(ka, 'POST', `/pagu/${pagu3}/review`, { keputusan: 'ditolak', catatan: 'kurang', version: 1 })
  check('penolakan tanpa alasan cukup ditolak 400', r.status === 400, short(r))
  r = await call(ka, 'POST', `/pagu/${pagu3}/review`, { keputusan: 'ditolak', catatan: 'Nilai tidak sesuai DIPA halaman 3', version: 1 })
  check('Kasubbagren menolak pagu dengan alasan', r.status === 200, short(r))
  tree = (await call(staf, 'GET', `/?tahun=${TAHUN}`)).body
  let k3 = tree?.programs?.[0]?.kegiatan?.find((k) => k.id === keg[2])
  check('pohon: kegiatan 3 tanpa pagu hidup, alasan penolakan terbaca', k3?.pagu === null && k3?.ditolak?.reviewNote === 'Nilai tidak sesuai DIPA halaman 3', JSON.stringify(k3))
  r = await call(op, 'POST', '/pagu', { kegiatanId: keg[2], jumlah: '90000000', dasar: 'DIPA 2099 No. 4 (perbaikan)', keterangan: '' })
  check('setelah ditolak, pagu baru boleh dicatat', r.status === 201, short(r))

  log('\n6. Total dan perlindungan hapus')
  tree = (await call(kabag, 'GET', `/?tahun=${TAHUN}`)).body
  check('total disetujui = 1.750.000.000', tree?.totals?.disetujui === '1750000000', JSON.stringify(tree?.totals))
  check('total menunggu = 250.000.000 + 90.000.000', tree?.totals?.draft === '340000000', JSON.stringify(tree?.totals))
  r = await call(op, 'DELETE', `/kegiatan/${keg[0]}`)
  check('kegiatan berpagu tidak bisa dihapus 409', r.status === 409 && r.body?.error === 'kegiatan_has_pagu', short(r))
  r = await call(op, 'DELETE', `/program/${progId}`)
  check('program berisi kegiatan tidak bisa dihapus 409', r.status === 409 && r.body?.error === 'program_has_kegiatan', short(r))

  log('\n7. Jejak audit')
  const audit = await sql.query(
    `SELECT event_key,count(*)::int AS n FROM sdl_audit_events WHERE event_key LIKE 'subbagren.progar.%' AND created_at>now()-interval '10 minutes' GROUP BY 1`)
  const keys = Object.fromEntries(audit.rows.map((x) => [x.event_key, x.n]))
  check('audit mencatat create/approve/reject', keys['subbagren.progar.program.create'] >= 1 && keys['subbagren.progar.pagu.approve'] >= 1 && keys['subbagren.progar.pagu.reject'] >= 1, JSON.stringify(keys))
} finally {
  await cleanup()
  await db.revokeMintedSessions()
  await db.close?.()
  await sql.end()
}

log(fail ? `\n${fail} cek GAGAL` : '\nSemua cek LULUS')
process.exit(fail ? 1 : 0)
