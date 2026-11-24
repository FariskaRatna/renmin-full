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
    const pCount = (await sql.query(`SELECT n FROM (${pembinaanLewatTenggatSql()}) x`)).rows[0].n
    check('dashboard pembinaanLewatTenggat = rumus SQL', d0 === pCount, `${d0} vs ${pCount}`)
    const tutupPP = await patTL(kPP, { hasil: 'Sudah membaik' })
    check('tutup tindak lanjut dengan hasil → 200', tutupPP.status === 200, short(tutupPP)); kPP = tutupPP.body?.item ?? kPP
    check('dashboard turun setelah tindak lanjut ditutup', (await call(kabag, 'GET', DASH)).body.totals.pembinaanLewatTenggat === d0 - 1)
    const sel = await aksi(op, kPP, 'selesai')
    check('semua tindak lanjut tuntas → Selesai', sel.body?.item?.status === 'Selesai', short(sel))
    const pC = await personel()
    let kBaik = (await nilai(op, pC.id)).body.item
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

/** Irisan B (aset) — diisi bersama aset.js. */
async function bagianAset() {}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await sql.end(); await db.close(); process.exit(fail ? 1 : 0) })
