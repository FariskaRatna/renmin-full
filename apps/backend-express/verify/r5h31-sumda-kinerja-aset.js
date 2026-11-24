/**
 * Verifikasi R5H31: Subbagsumda Kinerja & Pembinaan + Inventaris/BMN (migrasi 072). EXPRESS SAJA:
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h31-sumda-kinerja-aset.js
 *
 * Kinerja: rumus tenggat WIB (K38) · hak & capabilities (K6) · K1/K31/K32 penyamaran di daftar/detail/filter/detail
 * personel · alur + kembalikan + Selesai otomatis non-PP (K10) · maker-checker "pernah mengubah" (K36) · satu penilaian
 * per periode + balapan (K8) · tindak lanjut (K35/K37/K38) · dashboard (K15/K33) · lampiran dibatasi (K13) · audit
 * tanpa kategori (K26/K48) · aditif R5H27 (K16).
 * Aset: lihat bagian kedua (irisan B).
 *
 * MENULIS KE DATABASE (personel/aset berawalan UJI-R5H31-, dihapus di awal dan di akhir beserta turunannya dan
 * auditnya). Hanya untuk database pengembangan.
 */
import pg from 'pg'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'
import { lewatTenggatSql, pembinaanLewatTenggatSql } from '../src/modules/subbagsumda/kinerja.js'
import { hariDari } from '../src/modules/subbagsumda/umum.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2, options: '-c timezone=UTC' })
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }
const K = '/api/v1/subbagsumda/kinerja'
const A = '/api/v1/subbagsumda/aset'
const PER = '/api/v1/subbagsumda/personel'
const DASH = '/api/v1/subbagsumda/dashboard'
const PREFIX = 'UJI-R5H31-'
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
const unggah = (a, path, bytes = PDF, filename = 'dokumen.pdf') => call(a, 'POST', path, undefined, { multipart: [{ name: 'file', filename, contentType: 'application/pdf', bytes }] })
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 180)}`
const tambah = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

async function bersihkan() {
  const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
  const kids = (await sql.query('SELECT id::text FROM sdl_sumda_kinerja WHERE personel_id = ANY($1::uuid[])', [pids])).rows.map((r) => r.id)
  const aids = (await sql.query(`SELECT id::text FROM sdl_sumda_aset WHERE kode_bmn LIKE '${PREFIX}%' OR penanggung_jawab_id = ANY($1::uuid[])`, [pids])).rows.map((r) => r.id)
  await sql.query('DELETE FROM sdl_sumda_kinerja_lampiran WHERE kinerja_id = ANY($1::uuid[])', [kids])
  await sql.query('DELETE FROM sdl_sumda_kinerja_tindak_lanjut WHERE kinerja_id = ANY($1::uuid[])', [kids])
  await sql.query('DELETE FROM sdl_sumda_kinerja WHERE id = ANY($1::uuid[])', [kids]) // riwayat CASCADE
  await sql.query('DELETE FROM sdl_sumda_aset_lampiran WHERE aset_id = ANY($1::uuid[])', [aids])
  await sql.query('UPDATE sdl_sumda_aset_pemeliharaan SET koreksi_dari=NULL WHERE aset_id = ANY($1::uuid[])', [aids])
  await sql.query('DELETE FROM sdl_sumda_aset_pemeliharaan WHERE aset_id = ANY($1::uuid[])', [aids])
  await sql.query('DELETE FROM sdl_sumda_aset WHERE id = ANY($1::uuid[])', [aids]) // riwayat CASCADE
  await sql.query(`DELETE FROM sdl_audit_events WHERE (subject_type='subbagsumda.kinerja' AND subject_id = ANY($1::text[]))
    OR (subject_type='subbagsumda.aset' AND subject_id = ANY($2::text[])) OR (subject_type='subbagsumda.personel' AND subject_id = ANY($3::text[]))`, [kids, aids, pids])
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
  let urut = 0
  const personel = async (extra = {}) => {
    const s = String(++urut).padStart(2, '0')
    const r = await call(ka, 'POST', PER, { nrp: `${PREFIX}${s}`, nama: `Uji Kinerja ${s}`, jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '', ...extra })
    if (r.status !== 201) throw new Error(`buat personel ${s}: ${short(r)}`)
    return r.body.item
  }
  const nilai = (a, pid, extra = {}) => call(a, 'POST', K, { personelId: pid, tahun: 2026, periode: 'TAHUNAN', kategori: 'BAIK', penilai: 'Kabag Uji', tanggalPenilaian: '2026-11-20', catatan: '', ...extra })
  const aksi = (a, it, act, extra = {}) => call(a, 'POST', `${K}/${it.id}/aksi`, { aksi: act, catatan: '', version: it.version, ...extra })
  const lihat = async (a, id) => (await call(a, 'GET', `${K}/${id}`)).body
  const tl = (a, it, extra = {}) => call(a, 'POST', `${K}/${it.id}/tindak-lanjut`, { bentuk: 'KONSELING', uraian: 'Konseling kinerja', tenggat: tambah(hari, 14), version: it.version, ...extra })

  try {
    log('\n0. Rumus tenggat tindak lanjut menurut WIB (K38)')
    const lewat = async (tenggat, ts, status = 'Rencana') => (await sql.query(
      `SELECT ${lewatTenggatSql('t', hariDari('$1'))} AS x FROM (SELECT $2::date AS tenggat, $3::text AS status) t`, [ts, tenggat, status])).rows[0].x
    check('stempel 24 Nov WIB: tenggat 23 Nov lewat, 24 Nov belum', (await lewat('2026-11-23', '2026-11-23T17:00:00Z')) === true && (await lewat('2026-11-24', '2026-11-23T17:00:00Z')) === false)
    check('UTC 23 Nov 16:59 (= 23 Nov WIB): tenggat 23 Nov belum lewat', (await lewat('2026-11-23', '2026-11-23T16:59:59Z')) === false)
    check('status Selesai tidak pernah lewat tenggat', (await lewat('2020-01-01', '2026-11-23T17:00:00Z', 'Selesai')) === false)

    log('\n1. Hak & capabilities (K6)')
    const cap = {}
    for (const a of [op, staf, ka, kabag]) cap[a.username] = (await call(a, 'GET', `${K}/capabilities`)).body
    check('op/staf: baca ringkas + kelola, tanpa isi/setuju', ['op-subbagsumda', 'staf-subbagsumda'].every((u) => cap[u].canRead && !cap[u].canReadDetail && cap[u].canManage && !cap[u].canApprove), JSON.stringify(cap['op-subbagsumda']))
    check('Kasubbag: semua', Object.values(cap.kasubbagsumda).every(Boolean), JSON.stringify(cap.kasubbagsumda))
    check('Kabagrenmin: baca + isi, tanpa kelola/setuju', cap.kabagrenmin.canRead && cap.kabagrenmin.canReadDetail && !cap.kabagrenmin.canManage && !cap.kabagrenmin.canApprove, JSON.stringify(cap.kabagrenmin))
    check('Superadmin GET → 403', (await call(await actorFor('superadmin'), 'GET', K)).status === 403)

    log('\n2. K1: penyamaran isi kinerja (K31/K32)')
    const pA = await personel()
    const k1r = await nilai(op, pA.id, { kategori: 'PERLU_PEMBINAAN', catatan: 'Rahasia kinerja uji' })
    check('op catat Perlu Pembinaan → 201 Draft', k1r.status === 201 && k1r.body.item.status === 'Draft' && k1r.body.item.kategori === 'PERLU_PEMBINAAN', short(k1r))
    let k1 = k1r.body.item
    const t1 = await tl(op, k1, { tenggat: tambah(hari, -3) })
    check('tindak lanjut saat Draft (K35) → 201', t1.status === 201, short(t1)); k1 = t1.body.item
    const dSt = await lihat(staf, k1.id)
    check('staf: kategori/catatan/penilai/status/versi null, ringkas BELUM_DINILAI, dibatasi',
      dSt.item.kategori === null && dSt.item.catatan === null && dSt.item.penilai === null && dSt.item.status === null && dSt.item.version === null && dSt.item.statusRingkas === 'BELUM_DINILAI' && dSt.item.dibatasi === true, JSON.stringify(dSt.item))
    check('staf: tindak lanjut/lampiran/riwayat null', dSt.tindakLanjut === null && dSt.lampiran === null && dSt.riwayat === null)
    const lst = await call(staf, 'GET', `${K}?q=${encodeURIComponent(PREFIX)}&size=50`)
    check('staf: daftar tanpa teks catatan/kategori', lst.status === 200 && !lst.text.includes('Rahasia kinerja uji') && !lst.text.includes('PERLU_PEMBINAAN'), short(lst))
    const ada = async (a, qs) => (await call(a, 'GET', `${K}?q=${encodeURIComponent(PREFIX)}&size=50&${qs}`)).body.items.some((x) => x.id === k1.id)
    check('staf: filter kategori=PERLU_PEMBINAAN tidak mengembalikan baris op', !(await ada(staf, 'kategori=PERLU_PEMBINAAN')))
    check('staf: filter lewatTenggat=1 tidak mengembalikan baris op', !(await ada(staf, 'lewatTenggat=1')))
    check('staf: filter status=Draft cocok lewat status ringkas', await ada(staf, 'status=Draft'))
    check('Kasubbag: filter kategori & lewat tenggat menemukannya', (await ada(ka, 'kategori=PERLU_PEMBINAAN')) && (await ada(ka, 'lewatTenggat=1')))
    check('pencatat & Kasubbag & Kabag menerima isi lengkap', (await lihat(op, k1.id)).item.catatan === 'Rahasia kinerja uji' && (await lihat(ka, k1.id)).item.kategori === 'PERLU_PEMBINAAN' && (await lihat(kabag, k1.id)).tindakLanjut?.length === 1)
    const isi = { tahun: 2026, periode: 'TAHUNAN', kategori: 'BAIK', penilai: '', tanggalPenilaian: '', catatan: '', version: k1.version }
    check('staf PATCH/aksi/tindak lanjut pada milik op → 403 (bukan 409)',
      (await call(staf, 'PATCH', `${K}/${k1.id}`, isi)).status === 403 && (await aksi(staf, k1, 'ajukan')).status === 403 && (await tl(staf, k1)).status === 403)
    check('Kabagrenmin (tanpa kelola) PATCH → 403', (await call(kabag, 'PATCH', `${K}/${k1.id}`, isi)).status === 403)

    log('\n3. Alur, tindak lanjut, maker-checker (K10/K35–K37)')
    check('tindak lanjut tanpa tenggat → 400', (await tl(op, k1, { tenggat: '' })).status === 400)
    const k1Baik = await call(op, 'PATCH', `${K}/${k1.id}`, { ...isi, kategori: 'BAIK' })
    check('PATCH PP → BAIK dengan tindak lanjut terbuka → 409 tindak_lanjut_terbuka', k1Baik.body?.error === 'tindak_lanjut_terbuka', short(k1Baik))
    k1 = (await aksi(op, k1, 'ajukan')).body.item
    check('ajukan → Diajukan', k1.status === 'Diajukan')
    const t2 = await tl(ka, k1)
    check('Kasubbag menambah tindak lanjut (jadi pernah mengubah)', t2.status === 201, short(t2)); k1 = t2.body.item
    check('Kasubbag yang pernah mengubah tidak boleh memutus → 403', (await aksi(ka, k1, 'setujui')).body?.error === 'self_review_forbidden')
    check('… juga lewat id berhuruf besar', (await call(ka, 'POST', `${K}/${k1.id.toUpperCase()}/aksi`, { aksi: 'setujui', catatan: '', version: k1.version })).body?.error === 'self_review_forbidden')
    const pB = await personel()
    let kPP = (await nilai(op, pB.id, { kategori: 'PERLU_PEMBINAAN' })).body.item
    kPP = (await aksi(op, kPP, 'ajukan')).body.item
    check('PP tanpa tindak lanjut disetujui → 409 tindak_lanjut_wajib', (await aksi(ka, kPP, 'setujui')).body?.error === 'tindak_lanjut_wajib')
    check('kembalikan alasan < 8 → 400', (await aksi(ka, kPP, 'kembalikan', { catatan: 'kurang' })).status === 400)
    const kb = await aksi(ka, kPP, 'kembalikan', { catatan: 'Lengkapi tindak lanjut dulu' })
    check('kembalikan → Draft', kb.body?.item?.status === 'Draft', short(kb)); kPP = kb.body.item
    kPP = (await tl(op, kPP, { tenggat: tambah(hari, -1) })).body.item
    kPP = (await aksi(op, kPP, 'ajukan')).body.item
    const sPP = await aksi(ka, kPP, 'setujui')
    check('pemutus yang mengembalikan (tanpa mengubah) boleh memutus pengajuan ulang → Disetujui', sPP.body?.item?.status === 'Disetujui', short(sPP)); kPP = sPP.body.item
    check('Selesai dengan tindak lanjut terbuka → 409', (await aksi(op, kPP, 'selesai')).body?.error === 'tindak_lanjut_terbuka')
    const tid = (await lihat(op, kPP.id)).tindakLanjut[0].id
    const patTL = (it, extra) => call(op, 'PATCH', `${K}/${it.id}/tindak-lanjut/${tid}`, { bentuk: 'KONSELING', uraian: 'Konseling kinerja', tenggat: tambah(hari, -1), status: 'Selesai', hasil: '', version: it.version, ...extra })
    check('tindak lanjut Selesai tanpa hasil → 400', (await patTL(kPP)).status === 400)
    const d0 = (await call(kabag, 'GET', DASH)).body.totals.pembinaanLewatTenggat
    check('review S1: staf menerima pembinaanLewatTenggat null; Kabagrenmin angka', (await call(staf, 'GET', DASH)).body.totals.pembinaanLewatTenggat === null && typeof d0 === 'number')
    const pCount = (await sql.query(`SELECT n FROM (${pembinaanLewatTenggatSql()}) x`)).rows[0].n
    check('dashboard pembinaanLewatTenggat = rumus SQL', d0 === pCount, `${d0} vs ${pCount}`)
    const tutupPP = await patTL(kPP, { hasil: 'Sudah membaik' })
    check('tutup tindak lanjut dengan hasil → 200', tutupPP.status === 200, short(tutupPP)); kPP = tutupPP.body?.item ?? kPP
    check('dashboard turun setelah tindak lanjut ditutup', (await call(kabag, 'GET', DASH)).body.totals.pembinaanLewatTenggat === d0 - 1)
    const sel = await aksi(op, kPP, 'selesai')
    check('semua tindak lanjut tuntas → Selesai', sel.body?.item?.status === 'Selesai', short(sel))
    const pC = await personel()
    let kBaik = (await nilai(op, pC.id)).body.item
    check('review C3: Kasubbag mengajukan draf milik op → 403', (await aksi(ka, kBaik, 'ajukan')).status === 403)
    check('tindak lanjut untuk kategori non-PP → 409', (await tl(op, kBaik)).body?.error === 'status_tidak_sesuai')
    kBaik = (await aksi(op, kBaik, 'ajukan')).body.item
    const sB = await aksi(ka, kBaik, 'setujui')
    check('non-PP disetujui → langsung Selesai', sB.body?.item?.status === 'Selesai', short(sB))
    let dbErr = ''
    try { await sql.query("UPDATE sdl_sumda_kinerja SET decided_by=created_by,decided_at=now() WHERE id=$1::uuid", [k1.id]) } catch (e) { dbErr = e.code }
    check('CHECK DB: pemutus = pencatat → 23514', dbErr === '23514', dbErr)
    const kSendiri = (await nilai(ka, (await personel()).id)).body.item
    check('Kasubbag memutus penilaian yang ia catat → 403', (await aksi(ka, (await aksi(ka, kSendiri, 'ajukan')).body.item, 'setujui')).body?.error === 'self_review_forbidden')
    check('batalkan dari Draft oleh pencatat', (await aksi(op, (await nilai(op, pC.id, { periode: 'SEMESTER_I' })).body.item, 'batalkan', { catatan: 'Salah periode uji' })).body?.item?.status === 'Dibatalkan')

    log('\n4. Satu penilaian per periode (K8)')
    const pD = await personel()
    const g1 = (await nilai(op, pD.id)).body.item
    const g2 = await nilai(staf, pD.id)
    check('ganda → 409 penilaian_ganda + id', g2.body?.error === 'penilaian_ganda' && g2.body.id === g1.id, short(g2))
    await aksi(op, g1, 'batalkan', { catatan: 'Diganti penilaian baru' })
    check('setelah dibatalkan boleh membuat baru', (await nilai(op, pD.id)).status === 201)
    const s1 = (await nilai(op, pD.id, { periode: 'SEMESTER_I' })).body.item
    check('PATCH ke periode yang terpakai → 409', (await call(op, 'PATCH', `${K}/${s1.id}`, { tahun: 2026, periode: 'TAHUNAN', kategori: 'BAIK', penilai: '', tanggalPenilaian: '', catatan: '', version: s1.version })).body?.error === 'penilaian_ganda')
    const okP = await call(op, 'PATCH', `${K}/${s1.id}`, { tahun: 2026, periode: 'SEMESTER_II', kategori: 'CUKUP', penilai: 'Kabag Uji', tanggalPenilaian: '2026-11-21', catatan: 'diubah', version: s1.version })
    check('PATCH sah saat Draft → 200, versi naik', okP.status === 200 && okP.body.item.version === s1.version + 1 && okP.body.item.periode === 'SEMESTER_II', short(okP))
    const pR = await personel()
    const [r1, r2] = await Promise.all([nilai(op, pR.id), nilai(staf, pR.id)])
    check('balapan dua POST → tepat satu 201 + satu 409', [r1.status, r2.status].sort().join(',') === '201,409', `${r1.status},${r2.status}`)
    const pP = await personel({ status: 'Pensiun' })
    check('personel Pensiun → 409 personel_tidak_aktif', (await nilai(op, pP.id)).body?.error === 'personel_tidak_aktif')

    log('\n5. Personel terarsip (K14/K37)')
    const pX = await personel()
    let kX = (await nilai(op, pX.id, { kategori: 'PERLU_PEMBINAAN' })).body.item
    kX = (await tl(op, kX)).body.item
    kX = (await aksi(ka, (await aksi(op, kX, 'ajukan')).body.item, 'setujui')).body.item
    const px = (await call(ka, 'GET', `${PER}/${pX.id}`)).body.item
    await call(ka, 'DELETE', `${PER}/${pX.id}?version=${px.version}`)
    check('terarsip: tambah tindak lanjut → 409', (await tl(op, kX)).body?.error === 'personel_terarsip')
    const tidX = (await lihat(op, kX.id)).tindakLanjut[0].id
    const tutup = await call(op, 'PATCH', `${K}/${kX.id}/tindak-lanjut/${tidX}`, { bentuk: 'KONSELING', uraian: 'Konseling kinerja', tenggat: tambah(hari, 14), status: 'Selesai', hasil: 'Ditutup karena arsip', version: kX.version })
    check('terarsip: menutup tindak lanjut boleh', tutup.status === 200, short(tutup))
    check('terarsip: Selesai boleh', (await aksi(op, tutup.body.item, 'selesai')).body?.item?.status === 'Selesai')

    log('\n6. Lampiran kinerja (K13)')
    const up = await unggah(op, `${K}/${k1.id}/lampiran`, PDF, 'skp.pdf')
    check('pencatat unggah → 201', up.status === 201, short(up))
    check('staf unduh → 403', (await call(staf, 'GET', `${K}/${k1.id}/lampiran/${up.body.id}`)).status === 403)
    const dlKa = await call(kabag, 'GET', `${K}/${k1.id}/lampiran/${up.body.id}`)
    check('Kabagrenmin unduh → 200 byte-identik', dlKa.status === 200 && dlKa.bytes.equals(PDF))
    check('id silang (penilaian lain) → 404', (await call(ka, 'GET', `${K}/${kPP.id}/lampiran/${up.body.id}`)).status === 404)
    check('staf unggah ke milik op → 403', (await unggah(staf, `${K}/${k1.id}/lampiran`)).status === 403)

    log('\n7. Audit tanpa kategori & aditif R5H27 (K16/K26/K48)')
    const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
    const kids = (await sql.query('SELECT id::text FROM sdl_sumda_kinerja WHERE personel_id = ANY($1::uuid[])', [pids])).rows.map((r) => r.id)
    const ev = (await sql.query("SELECT event_key, metadata::text AS m FROM sdl_audit_events WHERE subject_type='subbagsumda.kinerja' AND subject_id = ANY($1::text[])", [kids])).rows
    const keys = new Set(ev.map((e) => e.event_key.replace('subbagsumda.kinerja.', '')))
    check('event kinerja tercatat', ['create', 'update', 'ajukan', 'setujui', 'kembalikan', 'batalkan', 'selesai', 'tindak_lanjut.add', 'tindak_lanjut.update', 'lampiran.add', 'lampiran.download'].every((k) => keys.has(k)), [...keys].join(','))
    check('metadata tanpa kategori/nama/catatan; setujui tanpa status', ev.every((e) => !/PERLU_PEMBINAAN|BAIK|CUKUP|Rahasia|Uji /.test(e.m)) && ev.filter((e) => e.event_key.endsWith('.setujui')).every((e) => !e.m.includes('status')))
    const detSt = (await call(staf, 'GET', `${PER}/${pB.id}`)).body.item.kinerja
    const detKa = (await call(ka, 'GET', `${PER}/${pB.id}`)).body.item.kinerja
    check('detail personel: staf hanya DINILAI tanpa kategori; Kasubbag dengan kategori', detSt.length === 1 && detSt[0].statusRingkas === 'DINILAI' && detSt[0].kategori === null && detKa[0].kategori === 'PERLU_PEMBINAAN', JSON.stringify({ detSt, detKa }))
    const detA = (await call(staf, 'GET', `${PER}/${pA.id}`)).body.item.kinerja
    check('detail personel: penilaian Diajukan milik orang lain tidak tampil bagi staf', detA.length === 0, JSON.stringify(detA))
    const pr = await call(ka, 'PATCH', `${PER}/${pA.id}`, { nrp: pA.nrp, nama: pA.nama, jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '', version: (await call(ka, 'GET', `${PER}/${pA.id}`)).body.item.version })
    check('respons PATCH personel tanpa field kinerja', pr.status === 200 && !('kinerja' in pr.body.item), short(pr))

    await bagianAset({ op, staf, ka, kabag, personel, hari })
  } finally {
    await bersihkan()
    await db.revokeMintedSessions().catch(() => {})
  }

  log(`\n${fail ? `GAGAL: ${fail} pemeriksaan` : 'LULUS: semua pemeriksaan'}\n`)
}

/** Irisan B: Inventaris & BMN (K3/K4/K17–K22/K39–K47). */
async function bagianAset({ op, staf, ka, kabag, personel, hari }) {
  const isi = (extra = {}) => ({ kodeBmn: `${PREFIX}A1`, nama: 'Laptop Uji', kategori: 'Komputer', merekTipe: 'Merek X', tahunPerolehan: 2024, jumlah: 1, satuan: 'unit', lokasi: 'Ruang Sumda', kondisi: 'Baik', penanggungJawabId: null, penanggungJawabTeks: '', jadwalPemeliharaan: '', catatan: '', ...extra })
  const buat = (a, extra) => call(a, 'POST', A, isi(extra))
  const aksiA = (a, it, act, extra = {}) => call(a, 'POST', `${A}/${it.id}/aksi`, { aksi: act, catatan: '', version: it.version, ...extra })
  const detailA = async (id) => (await call(ka, 'GET', `${A}/${id}`)).body
  const entri = (a, it, extra = {}) => call(a, 'POST', `${A}/${it.id}/pemeliharaan`, { tanggal: hari, jenis: 'PERBAIKAN', uraian: 'Ganti komponen', pelaksana: 'Teknisi', kondisi: 'Baik', jadwalBerikutnya: '', version: it.version, ...extra })
  const { tahapAsetSql } = await import('../src/modules/subbagsumda/aset.js')

  log('\n8. Aset: rumus tahap pemeliharaan WIB (K20)')
  const tahap = async (jadwal, status = 'Aktif') => (await sql.query(
    `SELECT ${tahapAsetSql('a', hariDari('$1'))} AS t FROM (SELECT $2::date AS jadwal_pemeliharaan, $3::text AS status) a`, ['2026-11-23T17:00:00Z', jadwal, status])).rows[0].t
  check('24 Nov → JATUH_TEMPO; 25 Nov & 8 Des → H-14; 9 Des → null', (await tahap('2026-11-24')) === 'JATUH_TEMPO' && (await tahap('2026-11-25')) === 'H-14' && (await tahap('2026-12-08')) === 'H-14' && (await tahap('2026-12-09')) === null)
  check('Usulan Penghapusan/Dihapus tidak bertahap', (await tahap('2026-11-24', 'Usulan Penghapusan')) === null && (await tahap('2026-11-24', 'Dihapus')) === null)

  log('\n9. Aset: hak, CRUD, kode BMN, penanggung jawab (K7/K17/K43/K45)')
  const cap = {}
  for (const a of [op, ka, kabag]) cap[a.username] = (await call(a, 'GET', `${A}/capabilities`)).body
  check('op: baca + kelola; Kasubbag: semua; Kabag: baca saja', cap['op-subbagsumda'].canManage && !cap['op-subbagsumda'].canApprove && cap.kasubbagsumda.canApprove && cap.kabagrenmin.canRead && !cap.kabagrenmin.canManage, JSON.stringify(cap))
  const a1r = await buat(op)
  check('buat aset → 201 Aktif', a1r.status === 201 && a1r.body.item.status === 'Aktif', short(a1r))
  let a1 = a1r.body.item
  check('kode ganda beda huruf besar → 409 kode_bmn_ganda', (await buat(staf, { kodeBmn: `${PREFIX}a1`.toLowerCase() })).body?.error === 'kode_bmn_ganda')
  check('kode berspasi di tepi (di-trim) → 409', (await buat(staf, { kodeBmn: `  ${PREFIX}A1  ` })).body?.error === 'kode_bmn_ganda')
  check('kode berkarakter tak sah → 400', (await buat(op, { kodeBmn: `${PREFIX}<x>` })).status === 400)
  check('kabagrenmin buat → 403', (await buat(kabag, { kodeBmn: `${PREFIX}K1` })).status === 403)
  const pj = await personel()
  check('PJ id + teks sekaligus → 400', (await buat(op, { kodeBmn: `${PREFIX}A2`, penanggungJawabId: pj.id, penanggungJawabTeks: 'Budi' })).status === 400)
  const a2r = await buat(op, { kodeBmn: `${PREFIX}A2`, penanggungJawabId: pj.id })
  check('PJ dari Master Personel → 201', a2r.status === 201 && a2r.body.item.penanggungJawab.id === pj.id, short(a2r))
  let a2 = a2r.body.item
  const pjx = (await call(ka, 'GET', `${PER}/${pj.id}`)).body.item
  await call(ka, 'DELETE', `${PER}/${pj.id}?version=${pjx.version}`)
  const pt2 = await call(op, 'PATCH', `${A}/${a2.id}`, { ...isi({ kodeBmn: `${PREFIX}A2`, penanggungJawabId: pj.id, lokasi: 'Gudang' }), version: a2.version })
  check('PJ yang kemudian terarsip tetap boleh dipertahankan saat PATCH', pt2.status === 200 && pt2.body.item.penanggungJawab.terarsip === true, short(pt2)); a2 = pt2.body.item
  check('PJ terarsip dipilih baru → 409 personel_terarsip', (await buat(op, { kodeBmn: `${PREFIX}A3`, penanggungJawabId: pj.id })).body?.error === 'personel_terarsip')

  log('\n10. Aset: status & penghapusan BMN (K4/K18/K39–K41)')
  a1 = (await aksiA(op, a1, 'pemeliharaan')).body.item
  check('Aktif → Pemeliharaan', a1.status === 'Pemeliharaan')
  const fak = await unggah(op, `${A}/${a1.id}/lampiran`, PDF, 'faktur.pdf')
  check('unggah faktur → 201', fak.status === 201, short(fak))
  a1 = (await call(op, 'GET', `${A}/${a1.id}`)).body.item
  check('usulkan hapus alasan < 8 → 400', (await aksiA(op, a1, 'usulkan_hapus', { catatan: 'rusak' })).status === 400)
  const us = await aksiA(op, a1, 'usulkan_hapus', { catatan: 'Rusak berat tidak ekonomis' })
  check('usulkan hapus → Usulan Penghapusan, status sebelum tersimpan', us.body?.item?.status === 'Usulan Penghapusan' && us.body.item.statusSebelum === 'Pemeliharaan', short(us)); a1 = us.body.item
  check('Usulan membekukan PATCH dan entri (K40)', (await call(op, 'PATCH', `${A}/${a1.id}`, { ...isi(), version: a1.version })).status === 409 && (await entri(op, a1)).status === 409)
  check('setujui tanpa lampiran SEJAK usulan (faktur lama) → 409 lampiran_wajib', (await aksiA(ka, a1, 'setujui_hapus')).body?.error === 'lampiran_wajib')
  check('op (tanpa approve) setujui → 403', (await aksiA(op, a1, 'setujui_hapus')).status === 403)
  const tolak = await aksiA(ka, a1, 'tolak_hapus', { catatan: 'Masih bisa diperbaiki' })
  check('tolak → kembali ke status sebelumnya', tolak.body?.item?.status === 'Pemeliharaan' && tolak.body.item.usulan === null, short(tolak)); a1 = tolak.body.item
  a1 = (await aksiA(op, a1, 'usulkan_hapus', { catatan: 'Rusak berat tidak ekonomis' })).body.item
  await unggah(ka, `${A}/${a1.id}/lampiran`, PDF, 'ba-ka.pdf')
  a1 = (await call(op, 'GET', `${A}/${a1.id}`)).body.item
  check('pemutus yang mengunggah sejak usulan → 403 self_review_forbidden', (await aksiA(ka, a1, 'setujui_hapus')).body?.error === 'self_review_forbidden')
  const a4 = (await buat(ka, { kodeBmn: `${PREFIX}A4` })).body.item
  let a4u = (await aksiA(ka, a4, 'usulkan_hapus', { catatan: 'Usulan oleh Kasubbag' })).body.item
  await unggah(op, `${A}/${a4.id}/lampiran`, PDF, 'ba.pdf')
  a4u = (await call(ka, 'GET', `${A}/${a4.id}`)).body.item
  check('pengusul tidak boleh memutus usulannya → 403', (await aksiA(ka, a4u, 'setujui_hapus')).body?.error === 'self_review_forbidden')
  let dbErr = ''
  try { await sql.query("UPDATE sdl_sumda_aset SET status='Dihapus',decided_by=usulan_by,decided_at=now() WHERE id=$1::uuid", [a4.id]) } catch (e) { dbErr = e.code }
  check('CHECK DB: pemutus = pengusul → 23514', dbErr === '23514', dbErr)
  const a5 = (await buat(op, { kodeBmn: `${PREFIX}A5` })).body.item
  let a5u = (await aksiA(op, a5, 'usulkan_hapus', { catatan: 'Hilang saat pindahan' })).body.item
  const ba = await unggah(op, `${A}/${a5.id}/lampiran`, PDF, 'berita-acara.pdf')
  a5u = (await call(ka, 'GET', `${A}/${a5.id}`)).body.item
  const hapus = await aksiA(ka, a5u, 'setujui_hapus')
  check('lampiran BA dari op sejak usulan → Kasubbag setujui → Dihapus', hapus.body?.item?.status === 'Dihapus' && hapus.body.item.decidedByName, short(hapus))
  const a5d = hapus.body.item
  check('Dihapus final: PATCH/aksi/entri/unggah/hapus lampiran → 409',
    (await call(op, 'PATCH', `${A}/${a5.id}`, { ...isi({ kodeBmn: `${PREFIX}A5` }), version: a5d.version })).status === 409 && (await aksiA(op, a5d, 'aktifkan')).status === 409
    && (await entri(op, a5d)).status === 409 && (await unggah(op, `${A}/${a5.id}/lampiran`)).status === 409 && (await call(ka, 'DELETE', `${A}/${a5.id}/lampiran/${ba.body.id}`)).status === 409)
  check('Dihapus: lampiran tetap bisa diunduh', (await call(kabag, 'GET', `${A}/${a5.id}/lampiran/${ba.body.id}`)).status === 200)
  check('kode milik aset Dihapus boleh dipakai lagi (K41)', (await buat(op, { kodeBmn: `${PREFIX}A5` })).status === 201)
  const lst = await call(kabag, 'GET', `${A}?q=${encodeURIComponent(PREFIX)}&size=50`)
  check('daftar bawaan tanpa Dihapus; filter status=Dihapus menemukannya', !lst.body.items.some((x) => x.id === a5.id) && (await call(kabag, 'GET', `${A}?q=${encodeURIComponent(PREFIX)}&status=Dihapus&size=50`)).body.items.some((x) => x.id === a5.id), short(lst))

  log('\n11. Aset: entri pemeliharaan & jadwal (K19/K42/K47)')
  let a6 = (await buat(op, { kodeBmn: `${PREFIX}A6`, kondisi: 'Rusak Ringan' })).body.item
  check('RUTIN tanpa jadwal berikutnya → 400', (await entri(op, a6, { jenis: 'RUTIN' })).status === 400)
  check('tanggal di masa depan (WIB) → 400', (await entri(op, a6, { tanggal: tambah(hari, 1) })).status === 400)
  check('jadwal berikutnya ≤ tanggal → 400', (await entri(op, a6, { jadwalBerikutnya: hari })).status === 400)
  const d0 = (await call(kabag, 'GET', DASH)).body.totals.pemeliharaanJatuhTempo14
  const e1 = await entri(op, a6, { jenis: 'RUTIN', kondisi: 'Baik', jadwalBerikutnya: tambah(hari, 5) })
  check('entri memperbarui kondisi + jadwal aset dalam satu transaksi', e1.status === 201 && e1.body.item.kondisi === 'Baik' && e1.body.item.jadwalPemeliharaan === tambah(hari, 5) && e1.body.item.tahap === 'H-14', short(e1)); a6 = e1.body.item
  check('dashboard pemeliharaanJatuhTempo14 +1', (await call(kabag, 'GET', DASH)).body.totals.pemeliharaanJatuhTempo14 === d0 + 1)
  const jd = (await call(kabag, 'GET', `${A}/jadwal`)).body
  check('/jadwal memuat aset H-14 + ringkas', jd.items.some((x) => x.id === a6.id) && jd.ringkas['H-14'] >= 1, JSON.stringify(jd.ringkas))
  const eid = (await detailA(a6.id)).pemeliharaan[0].id
  const a7 = (await buat(op, { kodeBmn: `${PREFIX}A7` })).body.item
  check('koreksiDari dari aset lain → 400 (FK komposit)', (await entri(op, a7, { koreksiDari: eid })).status === 400)
  check('koreksiDari dari aset sendiri → 201', (await entri(op, a6, { koreksiDari: eid, uraian: 'Koreksi entri sebelumnya' })).status === 201)
  check('aset Pemeliharaan tetap boleh menerima entri; tahap tetap dihitung', (await sql.query(`SELECT ${tahapAsetSql()} AS t FROM sdl_sumda_aset a WHERE id=$1::uuid`, [a6.id])).rows[0].t === 'H-14')

  log('\n12. Aset: lampiran & audit')
  const up = await unggah(op, `${A}/${a6.id}/lampiran`, PDF, 'sk.pdf')
  const row = (await sql.query("SELECT substring(body FROM 1 FOR 4) AS head, position('%PDF'::bytea IN body) AS pos FROM sdl_sumda_aset_lampiran WHERE id=$1::uuid", [up.body?.id])).rows[0]
  check('body diawali SDL1 tanpa %PDF', row?.head?.toString('latin1') === 'SDL1' && row.pos === 0)
  check('kabag unduh byte-identik; id silang → 404', (await call(kabag, 'GET', `${A}/${a6.id}/lampiran/${up.body.id}`)).bytes.equals(PDF) && (await call(kabag, 'GET', `${A}/${a7.id}/lampiran/${up.body.id}`)).status === 404)
  check('PDF palsu → 400', (await unggah(op, `${A}/${a6.id}/lampiran`, Buffer.from('bukan pdf'), 'x.pdf')).status === 400)
  check('hapus lampiran milik orang lain tanpa approve → 403', (await call(staf, 'DELETE', `${A}/${a6.id}/lampiran/${up.body.id}`)).status === 403)
  const aids = (await sql.query(`SELECT id::text FROM sdl_sumda_aset WHERE kode_bmn LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
  const ev = (await sql.query("SELECT event_key, metadata::text AS m FROM sdl_audit_events WHERE subject_type='subbagsumda.aset' AND subject_id = ANY($1::text[])", [aids])).rows
  const keys = new Set(ev.map((e) => e.event_key.replace('subbagsumda.aset.', '')))
  check('event aset tercatat', ['create', 'update', 'pemeliharaan_status', 'usulkan_hapus', 'tolak_hapus', 'setujui_hapus', 'pemeliharaan.add', 'lampiran.add', 'lampiran.download'].every((k) => keys.has(k)), [...keys].join(','))
  check('metadata tanpa kode/nama/alasan', ev.every((e) => !e.m.includes(PREFIX) && !e.m.includes('Laptop') && !e.m.includes('Rusak berat tidak')))
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await sql.end(); await db.close(); process.exit(fail ? 1 : 0) })
