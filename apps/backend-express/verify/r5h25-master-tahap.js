/**
 * Verifikasi R5H25: Master Data tahap pekerjaan aktif/nonaktif (migrasi 067).
 * EXPRESS SAJA (tidak ada padanan Go):
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h25-master-tahap.js
 *
 * Yang dijaga: hanya Superadmin (AuthorizeRoleEditor) yang membaca/mengubah saklar; alasan wajib,
 * field asing ditolak, versi basi ditolak; tahap terkunci dan "minimal satu aktif" ditegakkan server;
 * tahap nonaktif tidak bisa DITAMBAHKAN tetapi tahap lama tetap bisa diubah, dilampiri, dan dicek;
 * baris yatim/terkunci di database diabaikan; jejak audit; Superadmin tetap ditolak di menu kerja.
 *
 * MENULIS KE DATABASE (dokumen uji tahun 2093, dihapus di akhir). Pengaturan saklar yang ada
 * sebelum uji dipotret dan dipulihkan. Hanya untuk database pengembangan.
 */
import pg from 'pg'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'
import { PDF_UJI, cleanupRen } from './_ren-tahun-uji.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2 })
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }
const M = '/api/v1/admin/master/tahap-pekerjaan'
const R = '/api/v1/subbagren/perencanaan'
const TAHUN = 2093
const REASON = 'Uji verifikasi R5H25 otomatis'

async function actorFor(username) {
  const id = username === 'superadmin' ? await db.superadminUserId() : await db.userIdByUsername(username)
  const client = new HttpClient({ ...config })
  client.setCookie('sdl_session', await db.mintSession(id))
  await client.ensureCsrf()
  return { id, username, client }
}
async function call(a, method, path, body, extra = {}) {
  const res = await a.client.request(method, path, { withCsrf: method !== 'GET', ...(body !== undefined ? { body } : {}), ...extra })
  const text = Buffer.from(res.bytes).toString('utf8')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text }
}
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 140)}`
const anon = () => ({ client: new HttpClient({ ...config }) })

async function bersihkan() {
  await sql.query(`DELETE FROM sdl_ren_dokumen_tahap WHERE dokumen_id IN (SELECT id FROM sdl_ren_dokumen WHERE tahun=${TAHUN})`)
  await cleanupRen(sql, TAHUN)
}

async function main() {
  await db.ping()
  log(`\nBackend: ${config.apiBase}`)
  const sa = await actorFor('superadmin')
  const mcp = (await sql.query('SELECT must_change_password FROM sdl_users WHERE id=$1', [sa.id])).rows[0]?.must_change_password
  if (mcp) throw new Error('Superadmin lokal masih must_change_password; ganti password dulu lewat browser.')
  const op = await actorFor('op-subbagren')
  const staf = await actorFor('staf-subbagren')
  const ka = await actorFor('kasubbagren')

  const potret = (await sql.query('SELECT jenis,pekerjaan,updated_by FROM sdl_ren_tahap_nonaktif')).rows
  await sql.query('DELETE FROM sdl_ren_tahap_nonaktif')
  await bersihkan()
  try {
    log('\n1. Hak akses Master Data')
    check('anonim GET → 401', (await call(anon(), 'GET', M)).status === 401)
    for (const a of [op, staf, ka]) {
      check(`${a.username} GET → 403`, (await call(a, 'GET', M)).status === 403)
      check(`${a.username} PUT → 403`, (await call(a, 'PUT', `${M}/lap_lra`, { aktif: { unduh_myinterest: false }, reason: REASON, version: 0 })).status === 403)
    }
    const g = await call(sa, 'GET', M)
    check('Superadmin GET → 200', g.status === 200, short(g))
    const jenis = g.body?.jenis ?? []
    check('21 jenis, semua aktif', jenis.length === 21 && jenis.every((j) => j.tahap.every((t) => t.aktif)), `${jenis.length} jenis`)
    const rpd = jenis.find((j) => j.key === 'revisi_rpd')
    const dipaBaru = rpd?.tahap.find((t) => t.key === 'dipa_baru')
    check('revisi_rpd.dipa_baru terkunci + alasan', dipaBaru?.terkunci === true && Boolean(dipaBaru.alasanKunci))
    check('kelompok progar/dalgar', jenis.find((j) => j.key === 'renstra')?.kelompok === 'progar' && jenis.find((j) => j.key === 'lap_lra')?.kelompok === 'dalgar')
    check('Superadmin tetap 403 di katalog operasional', (await call(sa, 'GET', `${R}/tahap-katalog`)).status === 403)
    let ver = g.body?.version ?? 0

    log('\n2. Dokumen LRA dengan tahap yang dicatat SEBELUM dinonaktifkan')
    const doc = await call(op, 'POST', `${R}/dokumen`, { tahun: TAHUN, jenis: 'lap_lra', periode: 'B01', judul: '[VERIFY R5H25] LRA Januari', nomor: '', tanggal: '', programId: '', kegiatanId: '', keterangan: '', penggantiDari: '' })
    check('buat dokumen LRA uji', doc.status === 201, short(doc))
    const did = doc.body?.id
    const t1 = await call(op, 'POST', `${R}/dokumen/${did}/tahap`, { pekerjaan: 'unduh_myinterest', isian: { tanggal: `${TAHUN}-02-01` } })
    check('tambah tahap unduh_myinterest (masih aktif) → 201', t1.status === 201, short(t1))
    const tid = t1.body?.id

    log('\n3. Validasi PUT')
    const bad = [
      ['tanpa alasan', { aktif: { unduh_myinterest: false }, version: ver }, 400],
      ['alasan < 8', { aktif: { unduh_myinterest: false }, reason: 'pendek', version: ver }, 400],
      ['field asing', { aktif: { unduh_myinterest: false }, reason: REASON, version: ver, x: 1 }, 400],
      ['pasangan tidak dikenal', { aktif: { pokja: false }, reason: REASON, version: ver }, 400],
      ['nilai bukan boolean', { aktif: { unduh_myinterest: 'off' }, reason: REASON, version: ver }, 400],
      ['aktif kosong', { aktif: {}, reason: REASON, version: ver }, 400],
      ['versi basi', { aktif: { unduh_myinterest: false }, reason: REASON, version: ver + 7 }, 409],
    ]
    for (const [label, body, want] of bad) {
      const r = await call(sa, 'PUT', `${M}/lap_lra`, body)
      check(`${label} → ${want}`, r.status === want, short(r))
    }
    check('jenis palsu → 400', (await call(sa, 'PUT', `${M}/palsu`, { aktif: { pokja: false }, reason: REASON, version: ver })).status === 400)
    const terkunci = await call(sa, 'PUT', `${M}/revisi_rpd`, { aktif: { dipa_baru: false }, reason: REASON, version: ver })
    check('matikan tahap terkunci → 409 tahap_terkunci', terkunci.status === 409 && terkunci.body?.error === 'tahap_terkunci', short(terkunci))
    const semua = Object.fromEntries(jenis.find((j) => j.key === 'lap_eka_pn').tahap.map((t) => [t.key, false]))
    const min = await call(sa, 'PUT', `${M}/lap_eka_pn`, { aktif: semua, reason: REASON, version: ver })
    check('matikan semua tahap satu jenis → 409 minimal_satu_tahap', min.status === 409 && min.body?.error === 'minimal_satu_tahap', short(min))
    const tanpaCsrf = await sa.client.request('PUT', `${M}/lap_lra`, { withCsrf: false, body: { aktif: { unduh_myinterest: false }, reason: REASON, version: ver } })
    check('PUT tanpa CSRF → 403', tanpaCsrf.status === 403)

    log('\n4. Nonaktifkan unduh_myinterest pada LRA')
    const off = await call(sa, 'PUT', `${M}/lap_lra`, { aktif: { unduh_myinterest: false }, reason: REASON, version: ver })
    check('PUT → 200, versi naik', off.status === 200 && off.body?.version === ver + 1 && off.body?.changed === 1, short(off))
    ver = off.body?.version ?? ver
    const sama = await call(sa, 'PUT', `${M}/lap_lra`, { aktif: { unduh_myinterest: false }, reason: REASON, version: ver })
    check('PUT tanpa perubahan → 200, versi tetap', sama.status === 200 && sama.body?.version === ver && sama.body?.changed === 0, short(sama))
    const aud = (await sql.query(`SELECT metadata FROM sdl_audit_events WHERE event_key='master.tahap.update' AND subject_id='lap_lra' ORDER BY id DESC LIMIT 2`)).rows
    check('audit tercatat sekali, berisi alasan & perubahan', aud.length >= 1 && aud[0].metadata.reason === REASON && aud[0].metadata.dimatikan?.[0] === 'unduh_myinterest' && aud[0].metadata.versionBefore === ver - 1)
    const kat = await call(op, 'GET', `${R}/tahap-katalog`)
    check('katalog operasional memuat nonaktif', kat.status === 200 && JSON.stringify(kat.body?.nonaktif) === JSON.stringify({ lap_lra: ['unduh_myinterest'] }), JSON.stringify(kat.body?.nonaktif))
    check('katalog tetap memuat daftar lengkap', kat.body?.jenis?.lap_lra?.includes('unduh_myinterest'))
    const g2 = await call(sa, 'GET', M)
    check('GET Superadmin menampilkan nonaktif', g2.body?.jenis.find((j) => j.key === 'lap_lra')?.tahap.find((t) => t.key === 'unduh_myinterest')?.aktif === false)

    log('\n5. Penegakan di menu kerja')
    const t2 = await call(op, 'POST', `${R}/dokumen/${did}/tahap`, { pekerjaan: 'unduh_myinterest', isian: {} })
    check('tambah tahap nonaktif → 409 tahap_nonaktif', t2.status === 409 && t2.body?.error === 'tahap_nonaktif', short(t2))
    const t3 = await call(op, 'POST', `${R}/dokumen/${did}/tahap`, { pekerjaan: 'susun_laporan', isian: { tanggal: `${TAHUN}-02-03` } })
    check('tahap berikutnya menunggu persetujuan → 409 tahap_belum_diterima', t3.status === 409 && t3.body?.error === 'tahap_belum_diterima', short(t3))
    const list = async () => (await call(op, 'GET', `${R}/dokumen?tahun=${TAHUN}`)).body?.items?.find((d) => d.id === did)?.tahap?.find((t) => t.id === tid)
    const put = await call(op, 'PUT', `${R}/dokumen/${did}/tahap/${tid}`, { isian: { tanggal: `${TAHUN}-02-02`, catatan: 'dikoreksi' }, version: (await list())?.version })
    check('ubah tahap lama yang nonaktif → 200', put.status === 200, short(put))
    const lamp = await call(op, 'POST', `${R}/dokumen/${did}/tahap/${tid}/lampiran/unduhan`, undefined, { multipart: [{ name: 'file', filename: 'unduhan.pdf', contentType: 'application/pdf', bytes: PDF_UJI }] })
    check('lampiran ke tahap lama yang nonaktif → 201', lamp.status === 201, short(lamp))
    const cek = await call(ka, 'POST', `${R}/dokumen/${did}/tahap/${tid}/cek`, { keputusan: 'diterima', catatan: '', version: (await list())?.version })
    check('Kasubbagren mengecek tahap lama yang nonaktif → 200', cek.status === 200, short(cek))

    log('\n6. Baris yatim & terkunci di database diabaikan')
    await sql.query(`INSERT INTO sdl_ren_tahap_nonaktif(jenis,pekerjaan,updated_by) VALUES('lap_lra','pokja',$1),('revisi_rpd','dipa_baru',$1)`, [sa.id])
    const kat2 = await call(op, 'GET', `${R}/tahap-katalog`)
    check('katalog mengabaikan yatim & terkunci', JSON.stringify(kat2.body?.nonaktif) === JSON.stringify({ lap_lra: ['unduh_myinterest'] }), JSON.stringify(kat2.body?.nonaktif))
    const rpdDoc = await call(op, 'POST', `${R}/dokumen`, { tahun: TAHUN, jenis: 'revisi_rpd', periode: '', judul: '[VERIFY R5H25] Revisi RPD', nomor: '', tanggal: '', programId: '', kegiatanId: '', keterangan: '', penggantiDari: '' })
    const tk = await call(op, 'POST', `${R}/dokumen/${rpdDoc.body?.id}/tahap`, { pekerjaan: 'dipa_baru', isian: { nomor: 'DIPA-UJI-R5H25', tanggal: `${TAHUN}-03-01` } })
    check('tahap terkunci tetap bisa ditambah walau ada barisnya → 201', tk.status === 201, short(tk))
    const sisa = Object.fromEntries(jenis.find((j) => j.key === 'lap_lra').tahap.filter((t) => t.key !== 'unduh_myinterest').map((t) => [t.key, false]))
    const minYatim = await call(sa, 'PUT', `${M}/lap_lra`, { aktif: sisa, reason: REASON, version: ver })
    check('yatim tidak dihitung: matikan sisa LRA → 409 minimal_satu_tahap', minYatim.status === 409 && minYatim.body?.error === 'minimal_satu_tahap', short(minYatim))

    log('\n7. Nyalakan kembali')
    const on = await call(sa, 'PUT', `${M}/lap_lra`, { aktif: { unduh_myinterest: true }, reason: REASON, version: ver })
    check('PUT nyalakan → 200', on.status === 200 && on.body?.changed === 1, short(on))
    const t4 = await call(op, 'POST', `${R}/dokumen/${did}/tahap`, { pekerjaan: 'unduh_myinterest', isian: {} })
    check('tahap bisa ditambah lagi → 201', t4.status === 201, short(t4))
    const kat3 = await call(op, 'GET', `${R}/tahap-katalog`)
    check('katalog nonaktif kosong', JSON.stringify(kat3.body?.nonaktif) === '{}', JSON.stringify(kat3.body?.nonaktif))
  } finally {
    await bersihkan()
    await sql.query('DELETE FROM sdl_ren_tahap_nonaktif')
    for (const r of potret) await sql.query('INSERT INTO sdl_ren_tahap_nonaktif(jenis,pekerjaan,updated_by) VALUES($1,$2,$3)', [r.jenis, r.pekerjaan, r.updated_by])
    await db.revokeMintedSessions().catch(() => {})
  }

  log(`\n${fail ? `GAGAL: ${fail} pemeriksaan` : 'LULUS: semua pemeriksaan'}\n`)
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await sql.end(); await db.close(); process.exit(fail ? 1 : 0) })
