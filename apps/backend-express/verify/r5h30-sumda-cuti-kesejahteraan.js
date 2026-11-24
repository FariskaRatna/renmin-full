/**
 * Verifikasi R5H30: Subbagsumda Cuti & Perizinan + Kesejahteraan (migrasi 071). EXPRESS SAJA:
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h30-sumda-cuti-kesejahteraan.js
 *
 * Yang dijaga: hari kerja vs oracle SQL (K9/K25) · jatah + peringatan (K2/K10/K30) · rentang (K26–K28) ·
 * alur + maker-checker di SQL dan CHECK DB (K1) · cuti bertumpuk termasuk balapan (K11) · Selesai &
 * tanggal kembali (K31) · personel tidak aktif/terarsip (K13/K32) · kalender & dashboard WIB (K18/K39/K40) ·
 * lampiran tersegel + lampiran Sakit dibatasi (K4/K38) · audit tanpa PII (K19) · aditif R5H27 (K20/K41).
 * Kesejahteraan: alur, satu terbuka per jenis + balapan (K16/K37), Selesai menerapkan status (K3/K33),
 * "Proses Pensiun" (K34/K35).
 *
 * MENULIS KE DATABASE (personel berawalan UJI-R5H30-, dihapus di awal dan di akhir beserta pengajuan,
 * lampiran, riwayat, dan auditnya). Hanya untuk database pengembangan.
 */
import pg from 'pg'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'
import { cutiHariIniSql, hariKerja } from '../src/modules/subbagsumda/cuti.js'
import { hariDari } from '../src/modules/subbagsumda/umum.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2, options: '-c timezone=UTC' })
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }
const C = '/api/v1/subbagsumda/cuti'
const KS = '/api/v1/subbagsumda/kesejahteraan'
const PER = '/api/v1/subbagsumda/personel'
const DASH = '/api/v1/subbagsumda/dashboard'
const PREFIX = 'UJI-R5H30-'
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n', 'latin1')

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
const unggah = (a, path, bytes = PDF, filename = 'surat.pdf') => call(a, 'POST', path, undefined, { multipart: [{ name: 'file', filename, contentType: 'application/pdf', bytes }] })
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 180)}`
const tambah = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
/** Senin terdekat pada/sebelum tanggal d — membuat uji hari kerja tidak bergantung hari ini. */
const senin = (d) => tambah(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))

async function bersihkan() {
  const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
  if (!pids.length) return
  const cids = (await sql.query('SELECT id::text FROM sdl_sumda_cuti WHERE personel_id = ANY($1::uuid[])', [pids])).rows.map((r) => r.id)
  const kids = (await sql.query('SELECT id::text FROM sdl_sumda_kesejahteraan WHERE personel_id = ANY($1::uuid[])', [pids])).rows.map((r) => r.id)
  await sql.query('DELETE FROM sdl_sumda_cuti_lampiran WHERE cuti_id = ANY($1::uuid[])', [cids])
  await sql.query('DELETE FROM sdl_sumda_kesejahteraan_lampiran WHERE kesejahteraan_id = ANY($1::uuid[])', [kids])
  await sql.query('DELETE FROM sdl_sumda_cuti WHERE id = ANY($1::uuid[])', [cids]) // riwayat CASCADE
  await sql.query('DELETE FROM sdl_sumda_kesejahteraan WHERE id = ANY($1::uuid[])', [kids])
  await sql.query(`DELETE FROM sdl_audit_events WHERE (subject_type='subbagsumda.cuti' AND subject_id = ANY($1::text[]))
    OR (subject_type='subbagsumda.kesejahteraan' AND subject_id = ANY($2::text[])) OR (subject_type='subbagsumda.personel' AND subject_id = ANY($3::text[]))`, [cids, kids, pids])
  await sql.query('DELETE FROM sdl_sumda_pensiun_tinjau WHERE personel_id = ANY($1::uuid[])', [pids])
  await sql.query('DELETE FROM sdl_sumda_personel WHERE id = ANY($1::uuid[])', [pids])
}

async function main() {
  await db.ping()
  log(`\nBackend: ${config.apiBase}`)
  const nama = ['op-subbagsumda', 'staf-subbagsumda', 'kasubbagsumda', 'kabagrenmin']
  const mcp = (await sql.query('SELECT username FROM sdl_users WHERE username = ANY($1) AND must_change_password', [nama])).rows
  if (mcp.length) throw new Error(`Masih must_change_password: ${mcp.map((r) => r.username).join(', ')}`)
  const [op, staf, ka, kabag] = await Promise.all(nama.map(actorFor))
  await bersihkan()
  const hari = (await sql.query("SELECT ((now() AT TIME ZONE 'Asia/Jakarta')::date)::text AS d")).rows[0].d
  const tahun = Number(hari.slice(0, 4))
  let urut = 0
  const personel = async (extra = {}) => {
    const s = String(++urut).padStart(2, '0')
    const r = await call(ka, 'POST', PER, { nrp: `${PREFIX}${s}`, nama: `Uji Cuti ${s}`, jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '', ...extra })
    if (r.status !== 201) throw new Error(`buat personel ${s}: ${short(r)}`)
    return r.body.item
  }
  const cuti = (a, pid, jenis, mulai, selesai, extra = {}) => call(a, 'POST', C, { personelId: pid, jenis, tanggalMulai: mulai, tanggalSelesai: selesai, catatan: '', ...extra })
  const aksi = (a, base, item, act, extra = {}) => call(a, 'POST', `${base}/${item.id}/aksi`, { aksi: act, catatan: '', version: item.version, ...extra })
  const disetujui = async (base, item) => { const p = await aksi(op, base, item, 'proses'); return (await aksi(ka, base, p.body.item, 'setujui')).body?.item }

  try {
    log('\n0. Hari kerja: JS vs oracle SQL (K9/K25)')
    let beda = 0
    const kasus = [['2026-11-23', '2026-11-29'], ['2026-11-28', '2026-11-29'], ['2024-02-28', '2024-03-01'], ['2026-12-31', '2027-01-01']]
    for (let i = 0; i < 200; i++) {
      const a = tambah('2025-01-01', Math.floor(Math.random() * 900)); kasus.push([a, tambah(a, Math.floor(Math.random() * 40))])
    }
    for (const [a, b] of kasus) {
      const o = (await sql.query("SELECT count(*)::int AS n FROM generate_series($1::date,$2::date,'1 day') d WHERE extract(isodow FROM d) < 6", [a, b])).rows[0].n
      if (o !== hariKerja(a, b)) beda++
    }
    check(`${kasus.length} rentang: hariKerja() sama dengan SQL`, beda === 0, `${beda} beda`)

    log('\n1. Hak akses & capabilities')
    const cap = {}
    for (const a of [op, staf, ka, kabag]) cap[a.username] = (await call(a, 'GET', `${C}/capabilities`)).body
    check('op/staf: baca + kelola, tanpa setuju', ['op-subbagsumda', 'staf-subbagsumda'].every((u) => cap[u].canRead && cap[u].canManage && !cap[u].canApprove), JSON.stringify(cap['op-subbagsumda']))
    check('kasubbag: semua', cap.kasubbagsumda.canRead && cap.kasubbagsumda.canManage && cap.kasubbagsumda.canApprove)
    check('kabagrenmin: baca saja', cap.kabagrenmin.canRead && !cap.kabagrenmin.canManage && !cap.kabagrenmin.canApprove)
    const sa = await actorFor('superadmin')
    check('Superadmin GET → 403', (await call(sa, 'GET', C)).status === 403)

    log('\n2. Rentang, jumlah hari, jatah (K2/K10/K26–K30)')
    const pA = await personel()
    const t = (bln, tgl) => `${tahun}-${bln}-${tgl}`
    const c1 = await cuti(op, pA.id, 'TAHUNAN', t('01', '05'), t('01', '09'))
    check('Tahunan Senin–Jumat → 201, 5 hari kerja, tanpa peringatan', c1.status === 201 && c1.body.item.jumlahHari === 5 && c1.body.peringatan.length === 0, short(c1))
    check('kabagrenmin catat → 403', (await cuti(kabag, pA.id, 'SAKIT', t('02', '02'), t('02', '02'))).status === 403)
    check('selesai < mulai → 400', (await cuti(op, pA.id, 'SAKIT', t('02', '10'), t('02', '09'))).status === 400)
    check('Tahunan lintas tahun → 400 (K28)', (await cuti(op, pA.id, 'TAHUNAN', `${tahun}-12-30`, `${tahun + 1}-01-02`)).status === 400)
    const lintas = await cuti(op, pA.id, 'SAKIT', `${tahun}-12-30`, `${tahun + 1}-01-02`)
    check('Sakit lintas tahun boleh', lintas.status === 201, short(lintas))
    check('> 366 hari kalender → 400 (K27)', (await cuti(op, pA.id, 'BESAR', `${tahun - 3}-01-01`, `${tahun - 2}-01-02`)).status === 400)
    const sabtu = t('03', '07') === '2026-03-07' ? '2026-03-07' : null
    if (sabtu) {
      check('hanya Sabtu–Minggu → 400 (K26)', (await cuti(op, pA.id, 'ALASAN_PENTING', '2026-03-07', '2026-03-08')).status === 400)
      const man = await cuti(op, pA.id, 'ALASAN_PENTING', '2026-03-07', '2026-03-08', { jumlahHari: 2 })
      check('Sabtu–Minggu dengan jumlahHari manual → 201, hariDisesuaikan', man.status === 201 && man.body.item.hariDisesuaikan && man.body.item.jumlahHari === 2, short(man))
    }
    check('jumlahHari > hari kalender → 400', (await cuti(op, pA.id, 'LAINNYA', t('04', '06'), t('04', '07'), { jumlahHari: 3 })).status === 400)
    check('jumlahHari 0 / bukan bilangan → 400', (await cuti(op, pA.id, 'LAINNYA', t('04', '06'), t('04', '07'), { jumlahHari: 0 })).status === 400 && (await cuti(op, pA.id, 'LAINNYA', t('04', '06'), t('04', '07'), { jumlahHari: '2' })).status === 400)
    const c2 = await cuti(op, pA.id, 'TAHUNAN', t('05', '04'), t('05', '15'))
    check('Tahunan 10 hari: 5 dalam proses + 10 > 12 → peringatan melebihi_jatah, tetap 201', c2.status === 201 && c2.body.peringatan.includes('melebihi_jatah'), short(c2))
    const jat = (await call(kabag, 'GET', `${C}/jatah?personelId=${pA.id}&tahun=${tahun}`)).body
    check('jatah: terpakai 0, dalam proses 15, sisa 12', jat.jatah === 12 && jat.terpakai === 0 && jat.dalamProses === 15 && jat.sisa === 12, JSON.stringify(jat))
    const c1ok = await disetujui(C, c1.body.item)
    const jat2 = (await call(kabag, 'GET', `${C}/jatah?personelId=${pA.id}`)).body
    check('setelah disetujui: terpakai 5, dalam proses 10, sisa 7', c1ok?.status === 'Disetujui' && jat2.terpakai === 5 && jat2.dalamProses === 10 && jat2.sisa === 7, JSON.stringify(jat2))
    check('jatah: personelId bukan UUID / tahun 1999 → 400', (await call(kabag, 'GET', `${C}/jatah?personelId=x`)).status === 400 && (await call(kabag, 'GET', `${C}/jatah?personelId=${pA.id}&tahun=1999`)).status === 400)

    log('\n3. Cuti bertumpuk (K11) + balapan')
    check('beririsan dengan yang Disetujui → 409 cuti_bertumpuk', (await cuti(op, pA.id, 'SAKIT', t('01', '09'), t('01', '12'))).body?.error === 'cuti_bertumpuk')
    const nempel = await cuti(op, pA.id, 'SAKIT', t('01', '10'), t('01', '10'), { jumlahHari: 1 }) // 10 Jan bisa jatuh akhir pekan
    check('berbatasan (mulai = sehari sesudah selesai) → 201', nempel.status === 201, short(nempel))
    const pR = await personel()
    const [r1, r2] = await Promise.all([cuti(op, pR.id, 'SAKIT', t('06', '01'), t('06', '05')), cuti(staf, pR.id, 'LAINNYA', t('06', '03'), t('06', '08'))])
    check('dua POST beririsan bersamaan → tepat satu 201 + satu 409', [r1.status, r2.status].sort().join(',') === '201,409', `${r1.status},${r2.status}`)
    const c3 = (await cuti(op, pR.id, 'SAKIT', t('07', '06'), t('07', '07'))).body.item
    const patchTumpuk = await call(op, 'PATCH', `${C}/${c3.id}`, { tanggalMulai: t('06', '04'), tanggalSelesai: t('07', '07'), catatan: '', version: c3.version })
    check('PATCH ke rentang beririsan → 409', patchTumpuk.body?.error === 'cuti_bertumpuk', short(patchTumpuk))
    const patchOk = await call(op, 'PATCH', `${C}/${c3.id}`, { tanggalMulai: t('07', '06'), tanggalSelesai: t('07', '08'), catatan: 'diubah', version: c3.version })
    check('PATCH sah → 200, versi naik', patchOk.status === 200 && patchOk.body.item.version === c3.version + 1, short(patchOk))
    check('PATCH jenis/personelId → 400 (K29)', (await call(op, 'PATCH', `${C}/${c3.id}`, { jenis: 'TAHUNAN', tanggalMulai: t('07', '06'), tanggalSelesai: t('07', '08'), catatan: '', version: c3.version + 1 })).status === 400)

    log('\n4. Alur, maker-checker, Selesai (K1/K17/K31)')
    const pB = await personel()
    const lalu = senin(tambah(hari, -20))
    const c4 = (await cuti(ka, pB.id, 'TAHUNAN', lalu, tambah(lalu, 4))).body.item
    const c4p = (await aksi(op, C, c4, 'proses')).body.item
    const self = await aksi(ka, C, c4p, 'setujui')
    check('Kasubbag memutus cuti yang ia catat → 403 self_review_forbidden', self.body?.error === 'self_review_forbidden', short(self))
    check('op setujui (tanpa approve) → 403', (await aksi(op, C, c4p, 'setujui')).status === 403)
    let dbErr = ''
    try { await sql.query('UPDATE sdl_sumda_cuti SET status=$2,decided_by=created_by,decided_at=now() WHERE id=$1::uuid', [c4.id, 'Disetujui']) } catch (e) { dbErr = e.code }
    check('CHECK DB: pemutus = pencatat → 23514', dbErr === '23514', dbErr)
    check('tolak tanpa alasan 8 karakter → 400', (await aksi(ka, C, c4p, 'tolak', { catatan: 'pendek' })).status === 400)
    check('transisi tidak sah (selesai dari Diproses) → 409', (await aksi(op, C, c4p, 'selesai')).status === 409)
    const batal = await aksi(ka, C, c4p, 'batalkan', { catatan: 'Salah catat oleh Kasubbag' })
    check('batalkan oleh pemegang approve → Dibatalkan', batal.body?.item?.status === 'Dibatalkan', short(batal))

    const c5 = (await cuti(op, pB.id, 'TAHUNAN', lalu, tambah(lalu, 6))).body.item
    const c5p = (await aksi(op, C, c5, 'proses')).body.item
    await unggah(ka, `${C}/${c5.id}/lampiran`)
    const c5x = (await call(ka, 'GET', `${C}/${c5.id}`)).body.item
    check('pengubah terakhir (unggah lampiran) tidak boleh memutus → 403', (await aksi(ka, C, c5x, 'setujui')).body?.error === 'self_review_forbidden')
    check('batalkan oleh bukan pencatat tanpa approve → 403', (await aksi(staf, C, c5x, 'batalkan', { catatan: 'staf mencoba batal' })).status === 403)
    void c5p
    const c6 = (await cuti(op, pB.id, 'SAKIT', tambah(lalu, 8), tambah(lalu, 12))).body.item
    const c6ok = await disetujui(C, c6)
    check('setujui oleh Kasubbag (bukan pencatat) → Disetujui', c6ok?.status === 'Disetujui')
    check('tanggalKembali pada aksi selain selesai → 400', (await aksi(ka, C, c6ok, 'batalkan', { catatan: 'alasan panjang', tanggalKembali: lalu })).status === 400)
    check('tanggalKembali lewat tanggal selesai → 400', (await aksi(op, C, c6ok, 'selesai', { tanggalKembali: tambah(lalu, 13) })).status === 400)
    const kembali = tambah(lalu, 9)
    check('review S1: jumlahHari saat Selesai tanpa tanggalKembali → 400', (await aksi(op, C, c6ok, 'selesai', { jumlahHari: 1 })).status === 400)
    check('review S1: jumlahHari melebihi yang disetujui → 400', (await aksi(op, C, c6ok, 'selesai', { tanggalKembali: kembali, jumlahHari: c6ok.jumlahHari + 1 })).status === 400)
    const s6 = await aksi(op, C, c6ok, 'selesai', { tanggalKembali: kembali })
    check('Selesai dengan kembali lebih awal → jumlah hari dihitung ulang', s6.status === 200 && s6.body.item.status === 'Selesai' && s6.body.item.tanggalKembali === kembali && s6.body.item.jumlahHari === hariKerja(tambah(lalu, 8), kembali), short(s6))
    const bebas = await cuti(op, pB.id, 'LAINNYA', tambah(lalu, 11), tambah(lalu, 12))
    check('sisa rentang setelah kembali lebih awal bebas dipakai', bebas.status === 201, short(bebas))
    const depan = tambah(senin(tambah(hari, 30)), 7)
    const c7ok = await disetujui(C, (await cuti(op, pB.id, 'ALASAN_PENTING', depan, tambah(depan, 1))).body.item)
    check('Selesai sebelum hari pertama cuti → 409', (await aksi(op, C, c7ok, 'selesai')).status === 409)
    const b7 = await aksi(op, C, c7ok, 'batalkan', { catatan: 'Batal berangkat dinas' })
    check('cuti Disetujui bisa dibatalkan pencatat (K17)', b7.body?.item?.status === 'Dibatalkan', short(b7))
    const rw = (await call(ka, 'GET', `${C}/${c6.id}`)).body.riwayat.map((h) => h.ke).join('>')
    check('riwayat Diajukan>Diproses>Disetujui>Selesai', rw === 'Diajukan>Diproses>Disetujui>Selesai', rw)

    log('\n5. Personel tidak aktif / terarsip (K13/K32)')
    const pP = await personel({ status: 'Pensiun' })
    check('personel Pensiun → 409 personel_tidak_aktif', (await cuti(op, pP.id, 'SAKIT', t('08', '03'), t('08', '04'))).body?.error === 'personel_tidak_aktif')
    const pX = await personel()
    const cx = (await cuti(op, pX.id, 'SAKIT', t('08', '03'), t('08', '04'))).body.item
    const px = (await call(ka, 'GET', `${PER}/${pX.id}`)).body.item
    await call(ka, 'DELETE', `${PER}/${pX.id}?version=${px.version}`)
    check('personel terarsip: POST → 409', (await cuti(op, pX.id, 'SAKIT', t('09', '01'), t('09', '01'))).body?.error === 'personel_terarsip')
    check('personel terarsip: proses → 409', (await aksi(op, C, cx, 'proses')).body?.error === 'personel_terarsip')
    check('personel terarsip: unggah → 409', (await unggah(op, `${C}/${cx.id}/lampiran`)).body?.error === 'personel_terarsip')
    check('personel terarsip: batalkan tetap boleh', (await aksi(op, C, cx, 'batalkan', { catatan: 'Personel sudah diarsipkan' })).status === 200)

    log('\n6. Kalender & dashboard menurut WIB (K18/K39/K40)')
    const stempel = (await sql.query(`SELECT (${hariDari('$1')})::text AS d`, ['2026-11-23T17:00:00Z'])).rows[0].d
    check('stempel 2026-11-23T17:00Z = 24 Nov WIB', stempel === '2026-11-24', stempel)
    const pK = await personel()
    const ck = (await cuti(op, pK.id, 'SAKIT', '2026-11-24', '2026-11-24')).body.item
    const ckOk = await disetujui(C, ck)
    // Dibatasi ke personel uji ini (kalimat WHERE rumus asli + satu syarat), supaya cuti lain di database tidak ikut terhitung.
    const n = async (ts) => (await sql.query(`SELECT n FROM (${cutiHariIniSql(hariDari('$1'))} AND c.personel_id=$2::uuid) x`, [ts, pK.id])).rows[0].n
    const nWib = await n('2026-11-23T17:00:00Z'); const nUtcSebelum = await n('2026-11-23T16:59:59Z')
    check('cutiHariIni menghitung 24 Nov mulai 00:00 WIB, bukan UTC', nUtcSebelum === 0 && nWib === 1, `${nUtcSebelum}→${nWib}`)
    void ckOk
    const kal = await call(kabag, 'GET', `${C}/kalender?bulan=2026-11`)
    const h24 = kal.body?.hari?.find((h) => h.tanggal === '2026-11-24')
    check('kalender: 30 hari, 24 Nov memuat cuti Disetujui', kal.status === 200 && kal.body.hari.length === 30 && h24?.items.some((x) => x.id === ck.id), short(kal))
    check('kalender: tanpa NRP', !kal.text.includes(PREFIX))
    const kalJan = (await call(kabag, 'GET', `${C}/kalender?bulan=${tahun}-01`)).body
    check('kalender: Diajukan tidak tampil, Disetujui tampil', !JSON.stringify(kalJan).includes(c2.body.item.id) && JSON.stringify(kalJan).includes(c1.body.item.id))
    check('kalender: bulan tidak sah / param asing → 400', (await call(kabag, 'GET', `${C}/kalender?bulan=2026-13`)).status === 400 && (await call(kabag, 'GET', `${C}/kalender?bulan=2026-11&x=1`)).status === 400)
    const d0 = (await call(kabag, 'GET', DASH)).body.totals.cutiHariIni
    const pH = await personel()
    await disetujui(C, (await cuti(op, pH.id, 'BESAR', tambah(hari, -1), tambah(hari, 1), { jumlahHari: 3 })).body.item)
    check('dashboard cutiHariIni +1', (await call(kabag, 'GET', DASH)).body.totals.cutiHariIni === d0 + 1)
    const lst = await call(kabag, 'GET', `${C}?q=${encodeURIComponent(PREFIX)}&bulan=${tahun}-01&size=50`)
    check('daftar: filter bulan + q', lst.status === 200 && lst.body.items.every((x) => x.tanggalMulai <= `${tahun}-01-31`), short(lst))
    check('daftar: status/jenis/bulan/size tidak sah → 400', (await call(kabag, 'GET', `${C}?status=X`)).status === 400 && (await call(kabag, 'GET', `${C}?jenis=X`)).status === 400 && (await call(kabag, 'GET', `${C}?bulan=26-1`)).status === 400 && (await call(kabag, 'GET', `${C}?size=7`)).status === 400)

    log('\n7. Lampiran (K4/K36/K38)')
    const pL = await personel()
    const cs = (await cuti(op, pL.id, 'SAKIT', t('10', '05'), t('10', '06'))).body.item
    const up = await unggah(op, `${C}/${cs.id}/lampiran`, PDF, 'surat-dokter.pdf')
    check('unggah lampiran Sakit → 201', up.status === 201, short(up))
    const row = (await sql.query("SELECT substring(body FROM 1 FOR 4) AS head, position('%PDF'::bytea IN body) AS pos FROM sdl_sumda_cuti_lampiran WHERE id=$1::uuid", [up.body?.id])).rows[0]
    check('body diawali SDL1 tanpa %PDF', row?.head?.toString('latin1') === 'SDL1' && row.pos === 0)
    const dSt = (await call(staf, 'GET', `${C}/${cs.id}`)).body.lampiran[0]
    check('staf (bukan pengunggah, tanpa approve): nama berkas null + dibatasi', dSt?.filename === null && dSt.dibatasi === true, JSON.stringify(dSt))
    check('staf unduh lampiran Sakit → 403', (await call(staf, 'GET', `${C}/${cs.id}/lampiran/${up.body.id}`)).status === 403)
    check('kabagrenmin unduh lampiran Sakit → 403', (await call(kabag, 'GET', `${C}/${cs.id}/lampiran/${up.body.id}`)).status === 403)
    const dlOp = await call(op, 'GET', `${C}/${cs.id}/lampiran/${up.body.id}`)
    check('pengunggah unduh → 200 byte-identik', dlOp.status === 200 && dlOp.bytes.equals(PDF))
    check('Kasubbag unduh → 200', (await call(ka, 'GET', `${C}/${cs.id}/lampiran/${up.body.id}`)).status === 200)
    check('Kasubbag melihat nama berkas', (await call(ka, 'GET', `${C}/${cs.id}`)).body.lampiran[0]?.filename === 'surat-dokter.pdf')
    const ct = (await cuti(op, pL.id, 'TAHUNAN', t('10', '12'), t('10', '13'))).body.item
    const upT = await unggah(op, `${C}/${ct.id}/lampiran`)
    check('lampiran Tahunan terbuka untuk kabagrenmin', (await call(kabag, 'GET', `${C}/${ct.id}/lampiran/${upT.body.id}`)).status === 200)
    check('id silang → 404', (await call(ka, 'GET', `${C}/${ct.id}/lampiran/${up.body.id}`)).status === 404 && (await call(ka, 'DELETE', `${C}/${ct.id}/lampiran/${up.body.id}`)).status === 404)
    check('PDF palsu → 400', (await unggah(op, `${C}/${ct.id}/lampiran`, Buffer.from('bukan pdf'), 'x.pdf')).status === 400)
    check('hapus milik orang lain tanpa approve → 403', (await call(staf, 'DELETE', `${C}/${ct.id}/lampiran/${upT.body.id}`)).status === 403)
    for (let i = 0; i < 9; i++) await unggah(op, `${C}/${ct.id}/lampiran`)
    check('lampiran ke-11 → 409 batas_lampiran', (await unggah(op, `${C}/${ct.id}/lampiran`)).body?.error === 'batas_lampiran')
    const ctOk = await disetujui(C, (await call(ka, 'GET', `${C}/${ct.id}`)).body.item)
    check('hapus setelah Disetujui → 409', (await call(op, 'DELETE', `${C}/${ct.id}/lampiran/${upT.body.id}`)).status === 409)
    void ctOk
    await sql.query("UPDATE sdl_sumda_cuti_lampiran SET body = overlay(body PLACING '\\x00'::bytea FROM 40 FOR 1) WHERE id=$1::uuid", [upT.body.id])
    check('body dirusak → 503 evidence_integrity_failure', (await call(ka, 'GET', `${C}/${ct.id}/lampiran/${upT.body.id}`)).body?.error === 'evidence_integrity_failure')

    log('\n7b. Review: maker-checker "pernah mengubah" (S2), catatan Sakit (S3), PATCH personel tidak aktif (C5)')
    const pS = await personel()
    let c8 = (await cuti(op, pS.id, 'LAINNYA', t('11', '02'), t('11', '03'))).body.item
    const p8 = await call(ka, 'PATCH', `${C}/${c8.id}`, { tanggalMulai: t('11', '02'), tanggalSelesai: t('11', '04'), catatan: 'diubah Kasubbag', version: c8.version })
    check('Kasubbag mengubah isian cuti orang lain → 200', p8.status === 200, short(p8))
    await unggah(op, `${C}/${c8.id}/lampiran`) // op kini pengubah TERAKHIR
    c8 = (await call(op, 'GET', `${C}/${c8.id}`)).body.item
    c8 = (await aksi(op, C, c8, 'proses')).body.item
    const s8 = await aksi(ka, C, c8, 'setujui')
    check('S2: Kasubbag yang PERNAH mengubah isian tidak boleh memutus walau bukan pengubah terakhir → 403', s8.body?.error === 'self_review_forbidden', short(s8))
    let up8 = (await call(ka, 'GET', `${C}/${c8.id.toUpperCase()}`)).body?.item
    check('S2: id huruf besar di URL tidak meloloskan cek', up8 && (await call(ka, 'POST', `${C}/${c8.id.toUpperCase()}/aksi`, { aksi: 'setujui', catatan: '', version: up8.version })).body?.error === 'self_review_forbidden')
    const cs2 = (await cuti(op, pS.id, 'SAKIT', t('11', '09'), t('11', '10'), { catatan: 'Demam tinggi uji' })).body.item
    const lihat = async (a) => (await call(a, 'GET', `${C}/${cs2.id}`)).body
    const dSt2 = await lihat(staf)
    check('S3: staf (bukan pencatat, tanpa approve) — catatan Sakit null + dibatasi', dSt2.item.catatan === null && dSt2.item.catatanDibatasi === true, JSON.stringify({ c: dSt2.item.catatan, d: dSt2.item.catatanDibatasi }))
    check('S3: kabagrenmin — catatan Sakit null', (await lihat(kabag)).item.catatan === null)
    check('S3: pencatat dan Kasubbag melihat catatan', (await lihat(op)).item.catatan === 'Demam tinggi uji' && (await lihat(ka)).item.catatan === 'Demam tinggi uji')
    const lstSt = await call(staf, 'GET', `${C}?personelId=${pS.id}&size=50`)
    check('S3: daftar juga menyamarkan catatan Sakit', lstSt.status === 200 && lstSt.body.items.find((x) => x.id === cs2.id)?.catatan === null && !lstSt.text.includes('Demam tinggi uji'), short(lstSt))
    const pt2 = await call(staf, 'PATCH', `${C}/${cs2.id}`, { tanggalMulai: t('11', '09'), tanggalSelesai: t('11', '11'), catatan: null, version: cs2.version })
    check('S3: PATCH dengan catatan null tidak menimpa catatan', pt2.status === 200 && (await lihat(op)).item.catatan === 'Demam tinggi uji', short(pt2))
    const cs2p = (await aksi(op, C, (await lihat(op)).item, 'proses')).body.item
    await aksi(ka, C, cs2p, 'tolak', { catatan: 'Alasan medis rahasia uji' })
    const rwSt = (await lihat(staf)).riwayat.find((h) => h.ke === 'Ditolak')
    const rwOp = (await lihat(op)).riwayat.find((h) => h.ke === 'Ditolak')
    check('S3: alasan tolak cuti Sakit tersamar bagi staf, terbaca pencatat', rwSt?.catatan === null && rwOp?.catatan === 'Alasan medis rahasia uji', JSON.stringify({ st: rwSt?.catatan, op: rwOp?.catatan }))
    const cs3 = (await cuti(op, pS.id, 'TAHUNAN', t('11', '16'), t('11', '17'), { catatan: 'Liburan keluarga' })).body.item
    check('S3: catatan cuti selain Sakit tetap terbuka', (await call(staf, 'GET', `${C}/${cs3.id}`)).body.item.catatan === 'Liburan keluarga')
    await sql.query("UPDATE sdl_sumda_personel SET status='Pensiun' WHERE id=$1::uuid", [pS.id])
    check('C5: PATCH cuti personel yang sudah Pensiun → 409 personel_tidak_aktif', (await call(op, 'PATCH', `${C}/${cs3.id}`, { tanggalMulai: t('11', '16'), tanggalSelesai: t('11', '18'), catatan: '', version: cs3.version })).body?.error === 'personel_tidak_aktif')
    await sql.query("UPDATE sdl_sumda_personel SET status='Aktif' WHERE id=$1::uuid", [pS.id])
    void up8

    log('\n8. Audit tanpa PII (K19) & aditif R5H27 (K20/K41)')
    const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
    const cids = (await sql.query('SELECT id::text FROM sdl_sumda_cuti WHERE personel_id = ANY($1::uuid[])', [pids])).rows.map((r) => r.id)
    const ev = (await sql.query("SELECT event_key, metadata::text AS m FROM sdl_audit_events WHERE subject_type='subbagsumda.cuti' AND subject_id = ANY($1::text[])", [cids])).rows
    const keys = new Set(ev.map((e) => e.event_key.replace('subbagsumda.cuti.', '')))
    check('event cuti tercatat', ['create', 'update', 'proses', 'setujui', 'batalkan', 'selesai', 'lampiran.add', 'lampiran.download'].every((k) => keys.has(k)), [...keys].join(','))
    check('metadata tanpa NRP/nama/catatan/tanggal/nama berkas', ev.every((e) => !e.m.includes(PREFIX) && !e.m.includes('Uji ') && !e.m.includes('.pdf') && !e.m.includes(`${tahun}-`) && !e.m.includes('diubah')))
    const det = (await call(kabag, 'GET', `${PER}/${pA.id}`)).body.item
    check('GET /personel/:id memuat cutiTahunIni (jatah + items)', det.cutiTahunIni?.jatah === 12 && det.cutiTahunIni.terpakai === 5 && det.cutiTahunIni.items.length >= 3, JSON.stringify({ ...det.cutiTahunIni, items: det.cutiTahunIni?.items?.length }))
    const pr = await call(ka, 'PATCH', `${PER}/${pA.id}`, { nrp: pA.nrp, nama: pA.nama, jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '', version: det.version })
    check('respons PATCH personel tanpa cutiTahunIni', pr.status === 200 && !('cutiTahunIni' in pr.body.item), short(pr))

    await bagianKesejahteraan({ op, staf, ka, kabag, personel, aksi, disetujui, hari })
  } finally {
    await bersihkan()
    await db.revokeMintedSessions().catch(() => {})
  }

  log(`\n${fail ? `GAGAL: ${fail} pemeriksaan` : 'LULUS: semua pemeriksaan'}\n`)
}

/** Irisan B: Kesejahteraan (K3/K14–K17/K33–K37). */
async function bagianKesejahteraan({ op, staf, ka, kabag, personel, aksi, disetujui, hari }) {
  const baru = (a, pid, jenis, extra = {}) => call(a, 'POST', KS, { personelId: pid, jenis, nomorReferensi: '', targetSelesai: '', catatan: '', ...extra })
  const pers = async (id) => (await call(ka, 'GET', `${PER}/${id}`)).body.item

  log('\n9. Kesejahteraan: hak & satu terbuka per jenis (K16/K35/K37)')
  const cap = {}
  for (const a of [op, ka, kabag]) cap[a.username] = (await call(a, 'GET', `${KS}/capabilities`)).body
  check('op: kelola tanpa setuju; Kasubbag: semua; kabagrenmin: baca saja',
    cap['op-subbagsumda'].canManage && !cap['op-subbagsumda'].canApprove && cap.kasubbagsumda.canApprove && cap.kabagrenmin.canRead && !cap.kabagrenmin.canManage, JSON.stringify(cap))
  const pA = await personel()
  const pp = await baru(op, pA.id, 'PERSIAPAN_PENSIUN', { targetSelesai: '2040-01-01' })
  check('Persiapan Pensiun → 201 Diajukan, statusUsulan Pensiun', pp.status === 201 && pp.body.item.status === 'Diajukan' && pp.body.item.statusUsulan === 'Pensiun', short(pp))
  const ganda = await baru(staf, pA.id, 'PERSIAPAN_PENSIUN')
  check('kedua kali (masih terbuka) → 409 pengajuan_ganda + id yang terbuka (K35)', ganda.status === 409 && ganda.body?.error === 'pengajuan_ganda' && ganda.body.id === pp.body.item.id, short(ganda))
  const l1 = await baru(op, pA.id, 'LAINNYA'); const l2 = await baru(op, pA.id, 'LAINNYA')
  check('LAINNYA boleh lebih dari satu terbuka (K37)', l1.status === 201 && l2.status === 201)
  check('jenis lain (ASABRI) tetap boleh', (await baru(op, pA.id, 'ASABRI')).status === 201)
  const pR = await personel()
  const [r1, r2] = await Promise.all([baru(op, pR.id, 'KARTU_IDENTITAS'), baru(staf, pR.id, 'KARTU_IDENTITAS')])
  check('balapan dua POST jenis sama → tepat satu 201 + satu 409', [r1.status, r2.status].sort().join(',') === '201,409', `${r1.status},${r2.status}`)
  check('kabagrenmin catat → 403', (await baru(kabag, pA.id, 'MPP')).status === 403)
  check('jenis tidak sah / target bukan tanggal → 400', (await baru(op, pA.id, 'BONUS')).status === 400 && (await baru(op, pA.id, 'MPP', { targetSelesai: '2026-02-30' })).status === 400)

  log('\n10. Alur, maker-checker, Selesai + terapkan status (K3/K15/K33)')
  const sendiri = (await baru(ka, pR.id, 'ASABRI')).body.item
  const sendiriP = (await aksi(op, KS, sendiri, 'proses')).body.item
  check('Kasubbag memutus layanan yang ia catat → 403', (await aksi(ka, KS, sendiriP, 'setujui')).body?.error === 'self_review_forbidden')
  check('tolak tanpa alasan → 400', (await aksi(ka, KS, sendiriP, 'tolak', { catatan: 'x' })).status === 400)
  const ppOk = await disetujui(KS, pp.body.item)
  check('Persiapan Pensiun disetujui', ppOk?.status === 'Disetujui')
  check('terapkan pada aksi selain selesai → 400', (await aksi(ka, KS, ppOk, 'batalkan', { catatan: 'alasan yang cukup', terapkan: { status: 'Pensiun', personelVersion: 1 } })).status === 400)
  const v0 = (await pers(pA.id)).version
  check('terapkan status bukan hasil pemetaan → 400', (await aksi(op, KS, ppOk, 'selesai', { terapkan: { status: 'MPP', personelVersion: v0 } })).status === 400)
  check('terapkan kunci asing → 400', (await aksi(op, KS, ppOk, 'selesai', { terapkan: { status: 'Pensiun', personelVersion: v0, x: 1 } })).status === 400)
  check('versi personel lama → 409 personel_berubah', (await aksi(op, KS, ppOk, 'selesai', { terapkan: { status: 'Pensiun', personelVersion: v0 - 1 < 1 ? 999 : v0 - 1 } })).body?.error === 'personel_berubah')
  const sPP = await aksi(op, KS, ppOk, 'selesai', { terapkan: { status: 'Pensiun', personelVersion: v0 } })
  const pA2 = await pers(pA.id)
  check('Selesai + terapkan → personel Pensiun, versi +1', sPP.status === 200 && pA2.status === 'Pensiun' && pA2.version === v0 + 1, short(sPP))
  check('diterapkan memuat status lama→baru', sPP.body?.item?.diterapkan?.fields?.status?.lama === 'Aktif' && sPP.body.item.diterapkan.fields.status.baru === 'Pensiun')
  const pu = (await sql.query("SELECT metadata FROM sdl_audit_events WHERE event_key='subbagsumda.personel.update' AND subject_id=$1 ORDER BY id DESC LIMIT 1", [pA.id])).rows[0]
  check('audit personel.update {fields:[status]}', JSON.stringify(pu?.metadata?.fields) === '["status"]', JSON.stringify(pu?.metadata))
  check('personel sudah Pensiun: layanan baru → 409 personel_tidak_aktif', (await baru(op, pA.id, 'PERSIAPAN_PENSIUN')).body?.error === 'personel_tidak_aktif')

  const pM = await personel()
  const mpp = await disetujui(KS, (await baru(op, pM.id, 'MPP')).body.item)
  const sM = await aksi(staf, KS, mpp, 'selesai', { terapkan: { status: 'MPP', personelVersion: (await pers(pM.id)).version } })
  check('MPP selesai + terapkan → status MPP', sM.status === 200 && (await pers(pM.id)).status === 'MPP', short(sM))
  const pN = await personel()
  const mpp2 = await disetujui(KS, (await baru(op, pN.id, 'MPP')).body.item)
  await sql.query('UPDATE sdl_sumda_personel SET tanggal_pensiun=NULL WHERE id=$1::uuid', [pN.id]) // meniru salinan registry yang belum lengkap
  const vN = (await sql.query('SELECT version FROM sdl_sumda_personel WHERE id=$1::uuid', [pN.id])).rows[0].version
  check('MPP tanpa tanggal pensiun → 409 personel_belum_lengkap', (await aksi(op, KS, mpp2, 'selesai', { terapkan: { status: 'MPP', personelVersion: vN } })).body?.error === 'personel_belum_lengkap')
  const sTanpa = await aksi(op, KS, mpp2, 'selesai')
  check('Selesai tanpa terapkan → master tetap, diterapkan {}', sTanpa.status === 200 && JSON.stringify(sTanpa.body.item.diterapkan) === '{}' && (await sql.query('SELECT status FROM sdl_sumda_personel WHERE id=$1::uuid', [pN.id])).rows[0].status === 'Aktif', short(sTanpa))
  const asabri = await disetujui(KS, (await baru(op, pM.id, 'ASABRI')).body.item)
  check('terapkan pada ASABRI → 400', (await aksi(op, KS, asabri, 'selesai', { terapkan: { status: 'Pensiun', personelVersion: (await pers(pM.id)).version } })).status === 400)
  const rw = (await call(ka, 'GET', `${KS}/${pp.body.item.id}`)).body.riwayat.map((h) => h.ke).join('>')
  check('riwayat Diajukan>Diproses>Disetujui>Selesai', rw === 'Diajukan>Diproses>Disetujui>Selesai', rw)

  log('\n11. PATCH, lewat target, lampiran, aditif R5H27')
  const pL = await personel()
  const lt = (await baru(op, pL.id, 'KARTU_IDENTITAS', { targetSelesai: '2020-01-01' })).body.item
  const lst = await call(kabag, 'GET', `${KS}?lewatTarget=1&q=${encodeURIComponent(PREFIX)}&size=50`)
  check('filter lewatTarget memuat layanan lewat target', lst.status === 200 && lst.body.items.some((x) => x.id === lt.id && x.lewatTarget), short(lst))
  check('lewatTarget=2 → 400', (await call(kabag, 'GET', `${KS}?lewatTarget=2`)).status === 400)
  const pt = await call(op, 'PATCH', `${KS}/${lt.id}`, { nomorReferensi: 'KTA-1', targetSelesai: '2030-01-01', catatan: 'diubah', version: lt.version })
  check('PATCH saat Diajukan → 200', pt.status === 200 && pt.body.item.nomorReferensi === 'KTA-1', short(pt))
  check('PATCH jenis → 400 (K29)', (await call(op, 'PATCH', `${KS}/${lt.id}`, { jenis: 'MPP', nomorReferensi: '', targetSelesai: '', catatan: '', version: lt.version + 1 })).status === 400)
  const up = await unggah(op, `${KS}/${lt.id}/lampiran`, PDF, 'kta.pdf')
  check('unggah lampiran → 201; kabagrenmin unduh byte-identik', up.status === 201 && (await call(kabag, 'GET', `${KS}/${lt.id}/lampiran/${up.body.id}`)).bytes.equals(PDF), short(up))
  const cutiLain = (await sql.query('SELECT l.id::text FROM sdl_sumda_cuti_lampiran l LIMIT 1')).rows[0]?.id
  if (cutiLain) check('lampiran cuti via jalur kesejahteraan → 404', (await call(ka, 'GET', `${KS}/${lt.id}/lampiran/${cutiLain}`)).status === 404)
  const d0 = (await call(kabag, 'GET', DASH)).body.totals.layananMenunggu
  await aksi(op, KS, (await call(op, 'GET', `${KS}/${lt.id}`)).body.item, 'proses')
  check('dashboard layananMenunggu +1', (await call(kabag, 'GET', DASH)).body.totals.layananMenunggu === d0 + 1)
  const det = (await call(kabag, 'GET', `${PER}/${pM.id}`)).body.item
  check('GET /personel/:id memuat riwayatKesejahteraan', det.riwayatKesejahteraan?.length === 2 && det.riwayatKesejahteraan.every((x) => ['MPP', 'ASABRI'].includes(x.jenis)), JSON.stringify(det.riwayatKesejahteraan))
  const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
  const kids = (await sql.query('SELECT id::text FROM sdl_sumda_kesejahteraan WHERE personel_id = ANY($1::uuid[])', [pids])).rows.map((r) => r.id)
  const ev = (await sql.query("SELECT event_key, metadata::text AS m FROM sdl_audit_events WHERE subject_type='subbagsumda.kesejahteraan' AND subject_id = ANY($1::text[])", [kids])).rows
  const keys = new Set(ev.map((e) => e.event_key.replace('subbagsumda.kesejahteraan.', '')))
  check('event kesejahteraan tercatat', ['create', 'update', 'proses', 'setujui', 'selesai', 'lampiran.add', 'lampiran.download'].every((k) => keys.has(k)), [...keys].join(','))
  check('metadata tanpa NRP/nama/catatan/nomor', ev.every((e) => !e.m.includes(PREFIX) && !e.m.includes('Uji ') && !e.m.includes('KTA-1') && !e.m.includes('diubah')))
  void hari
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await sql.end(); await db.close(); process.exit(fail ? 1 : 0) })
