/**
 * Verifikasi R5H27: Subbagsumda Master Personel + Monitoring Pensiun + Dashboard (migrasi 068).
 * EXPRESS SAJA (tidak ada padanan Go):
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h27-sumda-personel.js
 *
 * Yang dijaga: salinan registry (K3) · CRUD + versi + NRP ganda + validasi · rumus tahap
 * H-60/H-30/H-14/H-7/JATUH_TEMPO tepat di batas (K6) dan menurut WIB, bukan UTC (R5) · status
 * MPP ikut, Pensiun/Nonaktif tidak (K7) · tinjau bersama unit + reset saat tanggal dikoreksi (K8)
 * + payload basi ditolak utuh · matriks hak (K2/K5) · dashboard (K10/K19) · audit tanpa PII.
 *
 * MENULIS KE DATABASE (NRP berawalan UJI-R5H27-, dihapus di awal dan di akhir beserta auditnya).
 * Hanya untuk database pengembangan. Akun op/staf/kasubbagsumda, kabagrenmin, kasubbagren harus
 * sudah mengganti password.
 */
import pg from 'pg'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'
import { hariDari, tahapSql } from '../src/modules/subbagsumda/personel.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
// Sama dengan pool aplikasi (src/db.js:45): sesi UTC. Itulah sebabnya rumus WIB wajib eksplisit.
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2, options: '-c timezone=UTC' })
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }
const PER = '/api/v1/subbagsumda/personel'
const ALERT = '/api/v1/subbagsumda/pensiun/alert'
const DASH = '/api/v1/subbagsumda/dashboard'
const PREFIX = 'UJI-R5H27-'

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
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 160)}`
const anon = () => ({ client: new HttpClient({ ...config }) })

async function bersihkan() {
  const ids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
  if (!ids.length) return
  await sql.query('DELETE FROM sdl_sumda_pensiun_tinjau WHERE personel_id = ANY($1::uuid[])', [ids])
  await sql.query("DELETE FROM sdl_audit_events WHERE subject_type='subbagsumda.personel' AND subject_id = ANY($1::text[])", [ids])
  await sql.query('DELETE FROM sdl_sumda_personel WHERE id = ANY($1::uuid[])', [ids])
}

const hariIni = async () => (await sql.query("SELECT ((now() AT TIME ZONE 'Asia/Jakarta')::date)::text AS d")).rows[0].d
const tambahHari = async (d, n) => (await sql.query('SELECT ($1::date + $2::int)::text AS d', [d, n])).rows[0].d
const dasar = (nrp, nama, extra = {}) => ({
  nrp, nama, jenis: 'Polri', pangkat: '', jabatan: 'Staf Uji', unitKerja: 'Unit Uji R5H27',
  tmtDinas: '', tanggalPensiun: '', status: 'Aktif', catatan: '', ...extra,
})

async function main() {
  await db.ping()
  log(`\nBackend: ${config.apiBase}`)
  const nama = ['op-subbagsumda', 'staf-subbagsumda', 'kasubbagsumda', 'kabagrenmin', 'kasubbagren']
  const mcp = (await sql.query('SELECT username FROM sdl_users WHERE username = ANY($1) AND must_change_password', [nama])).rows
  if (mcp.length) throw new Error(`Masih must_change_password: ${mcp.map((r) => r.username).join(', ')}; ganti password dulu.`)
  const [op, staf, ka, kabag, ren, sa] = await Promise.all([...nama, 'superadmin'].map(actorFor))
  await bersihkan()
  const today = await hariIni()

  try {
    log('\n0. Rumus tahap menurut WIB, bukan UTC (stempel tetap, tanpa memalsukan jam)')
    const z = (await sql.query(`SELECT ${hariDari('$1')}::text AS a, ${hariDari('$2')}::text AS b`,
      ['2026-11-22T16:59:59Z', '2026-11-22T17:00:00Z'])).rows[0]
    check('16:59:59Z = 2026-11-22 WIB, 17:00:00Z = 2026-11-23 WIB', z.a === '2026-11-22' && z.b === '2026-11-23', JSON.stringify(z))
    const tz = (await sql.query(
      `SELECT ${tahapSql('p', hariDari('$1'))} AS t FROM (SELECT 'Aktif'::text AS status, '2026-11-30'::date AS tanggal_pensiun) p`,
      ['2026-11-22T17:00:00Z'])).rows[0].t
    check('pensiun 2026-11-30, jam 00:00 WIB 23 Nov → H-7 (UTC masih 22 Nov → H-14)', tz === 'H-7', tz)

    log('\n1. Salinan registry (K3) — invarian pada data yang ada')
    const inv = (await sql.query(`
      SELECT count(*) FILTER (WHERE s.id IS NULL OR s.kind<>'personel' OR btrim(s.ref_code)<>p.nrp) AS rusak,
             count(*) FILTER (WHERE p.jenis IS NULL AND EXISTS(SELECT 1 FROM sdl_polri_rank_master m WHERE m.code=p.pangkat)) AS jenis_salah,
             count(*) AS n
        FROM sdl_sumda_personel p LEFT JOIN sdl_sumda_registry s ON s.id=p.source_registry_id
       WHERE p.source_registry_id IS NOT NULL`)).rows[0]
    check('setiap salinan punya registry personel asal dengan NRP sama', Number(inv.rusak) === 0, JSON.stringify(inv))
    check('pangkat di rank master → jenis Polri', Number(inv.jenis_salah) === 0)
    const sal = (await sql.query("SELECT metadata FROM sdl_audit_events WHERE event_key='subbagsumda.personel.salin_registry'")).rows
    check('audit salin_registry: maks. satu baris, sumber ≥ disalin', sal.length <= 1 && sal.every((r) => r.metadata.sumber >= r.metadata.disalin), JSON.stringify(sal.map((r) => r.metadata)))
    const st = (await sql.query(`
      SELECT count(*) AS n FROM sdl_sumda_personel p JOIN sdl_sumda_registry s ON s.id=p.source_registry_id
       WHERE p.status <> CASE lower(btrim(coalesce(s.fields->>'status',''))) WHEN 'aktif' THEN 'Aktif'
             WHEN 'pensiun' THEN 'Pensiun' WHEN 'mpp' THEN 'MPP' ELSE 'Nonaktif' END
         AND p.version = 1`)).rows[0]
    check('pemetaan status salinan (yang belum disunting) benar', Number(st.n) === 0)

    log('\n2. Hak akses')
    check('anonim GET → 401', (await call(anon(), 'GET', PER)).status === 401)
    for (const [a, path] of [[sa, PER], [sa, ALERT], [sa, DASH], [ren, PER], [ren, ALERT], [ren, DASH]]) {
      check(`${a.username} GET ${path.split('/').pop()} → 403`, (await call(a, 'GET', path)).status === 403)
    }
    check('Superadmin POST → 403', (await call(sa, 'POST', PER, dasar(`${PREFIX}SA`, 'Uji Superadmin', { tanggalPensiun: today }))).status === 403)
    const caps = {}
    for (const a of [op, staf, ka, kabag]) caps[a.username] = (await call(a, 'GET', `${PER}/capabilities`)).body
    const capOk = (u, c, up, ar, rv) => caps[u]?.canRead === true && caps[u]?.canCreate === c && caps[u]?.canUpdate === up && caps[u]?.canArchive === ar && caps[u]?.canReview === rv
    check('capabilities op: baca/tambah/ubah/tinjau, tanpa arsip', capOk('op-subbagsumda', true, true, false, true), JSON.stringify(caps['op-subbagsumda']))
    check('capabilities staf: sama dengan op (K5)', capOk('staf-subbagsumda', true, true, false, true), JSON.stringify(caps['staf-subbagsumda']))
    check('capabilities kasubbag: semua', capOk('kasubbagsumda', true, true, true, true), JSON.stringify(caps.kasubbagsumda))
    check('capabilities kabagrenmin: baca saja', capOk('kabagrenmin', false, false, false, false), JSON.stringify(caps.kabagrenmin))
    for (const a of [op, staf, ka, kabag]) check(`${a.username} GET daftar/alert/dashboard → 200`,
      (await call(a, 'GET', PER)).status === 200 && (await call(a, 'GET', ALERT)).status === 200 && (await call(a, 'GET', DASH)).status === 200)
    check('kabagrenmin POST → 403', (await call(kabag, 'POST', PER, dasar(`${PREFIX}KB`, 'Uji Kabag', { tanggalPensiun: today }))).status === 403)

    log('\n3. Validasi tambah')
    const dashAwal = (await call(ka, 'GET', DASH)).body
    const bad = [
      ['field asing', { ...dasar(`${PREFIX}V1`, 'Uji Validasi'), x: 1 }, 400, 'invalid_body'],
      ['Aktif tanpa tanggal pensiun (K1)', dasar(`${PREFIX}V1`, 'Uji Validasi'), 400, 'invalid_input'],
      ['MPP tanpa tanggal pensiun', dasar(`${PREFIX}V1`, 'Uji Validasi', { status: 'MPP' }), 400, 'invalid_input'],
      ['jenis kosong', dasar(`${PREFIX}V1`, 'Uji Validasi', { jenis: '', tanggalPensiun: today }), 400, 'invalid_input'],
      ['status asing', dasar(`${PREFIX}V1`, 'Uji Validasi', { status: 'Mutasi', tanggalPensiun: today }), 400, 'invalid_input'],
      ['tanggal tidak ada (2027-02-30)', dasar(`${PREFIX}V1`, 'Uji Validasi', { tanggalPensiun: '2027-02-30' }), 400, 'invalid_input'],
      ['tanggal pensiun < 2000 (K16)', dasar(`${PREFIX}V1`, 'Uji Validasi', { tanggalPensiun: '1999-12-31' }), 400, 'invalid_input'],
      ['TMT < 1950 (K16)', dasar(`${PREFIX}V1`, 'Uji Validasi', { tanggalPensiun: today, tmtDinas: '1949-12-31' }), 400, 'invalid_input'],
      ['NRP berisi NUL', dasar(`${PREFIX}V1\u0000`, 'Uji Validasi', { tanggalPensiun: today }), 400, 'invalid_input'],
      ['nama surrogate tunggal', dasar(`${PREFIX}V1`, 'Uji \ud800 Val', { tanggalPensiun: today }), 400, 'invalid_input'],
      ['unitKerja 201 karakter (K15)', dasar(`${PREFIX}V1`, 'Uji Validasi', { tanggalPensiun: today, unitKerja: 'u'.repeat(201) }), 400, 'invalid_input'],
      ['pangkat Polri bukan master', dasar(`${PREFIX}V1`, 'Uji Validasi', { tanggalPensiun: today, pangkat: 'JENDERAL-PALSU' }), 400, 'invalid_rank'],
      ['golongan PNS asing', dasar(`${PREFIX}V1`, 'Uji Validasi', { jenis: 'PNS', tanggalPensiun: today, pangkat: 'V/a' }), 400, 'invalid_rank'],
    ]
    for (const [label, b, want, code] of bad) {
      const r = await call(op, 'POST', PER, b)
      check(`${label} → ${want} ${code}`, r.status === want && r.body?.error === code, short(r))
    }
    const rank = (await sql.query('SELECT code FROM sdl_polri_rank_master WHERE is_active ORDER BY sort_order LIMIT 1')).rows[0].code
    const pol = await call(op, 'POST', PER, dasar(`${PREFIX}RANK`, 'Uji Pangkat Polri', { pangkat: rank, status: 'Pensiun' }))
    check('pangkat Polri dari master → 201 + pangkatLabel', pol.status === 201 && pol.body?.item?.pangkatLabel !== '', short(pol))
    const pns = await call(op, 'POST', PER, dasar(`${PREFIX}PNS`, 'Uji Golongan PNS', { jenis: 'PNS', pangkat: 'III/a', status: 'Nonaktif', unitKerja: 'u'.repeat(200) }))
    check('golongan PNS III/a + unitKerja 200 → 201', pns.status === 201, short(pns))

    log('\n4. Batas tahap (K6/K7)')
    const kasus = [[61, null], [60, 'H-60'], [31, 'H-60'], [30, 'H-30'], [15, 'H-30'], [14, 'H-14'], [8, 'H-14'],
      [7, 'H-7'], [1, 'H-7'], [0, 'JATUH_TEMPO'], [-3, 'JATUH_TEMPO']]
    const dibuat = []
    for (const [n, want] of kasus) {
      const tgl = await tambahHari(today, n)
      const r = await call(op, 'POST', PER, dasar(`${PREFIX}T${n}`, `Uji Tahap ${n}`, { tanggalPensiun: tgl }))
      const it = r.body?.item
      check(`sisa ${n} hari → ${want ?? 'tanpa tahap'}`, r.status === 201 && it?.tahap === want && it?.sisaHari === n, short(r))
      dibuat.push({ n, want, tgl, ...it })
    }
    const mppTgl = await tambahHari(today, 10)
    const mpp = await call(op, 'POST', PER, dasar(`${PREFIX}MPP`, 'Uji Status MPP', { status: 'MPP', tanggalPensiun: mppTgl }))
    check('MPP sisa 10 → H-14 (K7)', mpp.body?.item?.tahap === 'H-14', short(mpp))
    for (const s of ['Pensiun', 'Nonaktif']) {
      const r = await call(op, 'POST', PER, dasar(`${PREFIX}${s.toUpperCase()}`, `Uji Status ${s}`, { status: s, tanggalPensiun: await tambahHari(today, 5) }))
      check(`${s} sisa 5 → tanpa tahap`, r.status === 201 && r.body?.item?.tahap === null, short(r))
    }

    log('\n5. Dashboard (selisih sebelum/sesudah data uji)')
    const d2 = (await call(ka, 'GET', DASH)).body
    const delta = (k) => d2.totals[k] - dashAwal.totals[k]
    const bulanIni = today.slice(0, 7)
    const offsetBulan = (t) => (Number(t.slice(0, 4)) - Number(bulanIni.slice(0, 4))) * 12 + Number(t.slice(5, 7)) - Number(bulanIni.slice(5, 7))
    const dipantau = [...dibuat.map((x) => x.tgl), mppTgl]
    const enam = dipantau.filter((t) => offsetBulan(t) >= 0 && offsetBulan(t) <= 5).length
    check('personel +16', delta('personel') === 16, `${delta('personel')}`)
    check('aktif +11, mpp +1', delta('aktif') === 11 && delta('mpp') === 1, `${delta('aktif')}/${delta('mpp')}`)
    check('alert +11 dan belum ditinjau +11', delta('alert') === 11 && delta('belumDitinjau') === 11, `${delta('alert')}/${delta('belumDitinjau')}`)
    check('belum lengkap tidak bertambah', delta('belumLengkap') === 0, `${delta('belumLengkap')}`)
    check(`pensiun 6 bulan +${enam} dan = jumlah proyeksi (K19)`, delta('enamBulan') === enam
      && d2.totals.enamBulan === d2.proyeksi.reduce((s, b) => s + b.jumlah, 0) && d2.proyeksi.length === 6 && d2.proyeksi[0].bulan === bulanIni,
    `${delta('enamBulan')} vs ${enam}`)
    check('alertTerdekat ≤ 5 urut sisa hari', d2.alertTerdekat.length <= 5 && d2.alertTerdekat.every((a, i, arr) => i === 0 || arr[i - 1].sisaHari <= a.sisaHari))
    check('terdekat ≤ 5, semua sisa ≥ 0', d2.terdekat.length <= 5 && d2.terdekat.every((p) => p.sisaHari >= 0))
    check('aktivitas ≤ 5 dengan nama aktor', d2.aktivitas.length <= 5 && d2.aktivitas.every((a) => a.oleh))

    log('\n6. Daftar: cari, filter, paginasi')
    const cari = await call(staf, 'GET', `${PER}?q=${encodeURIComponent('Uji Tahap')}&size=5&page=2`)
    check('q + size 5 halaman 2', cari.status === 200 && cari.body.total === 11 && cari.body.items.length === 5 && cari.body.page === 2, short(cari))
    check('q dengan % diperlakukan harfiah', (await call(staf, 'GET', `${PER}?q=${encodeURIComponent('%')}`)).body?.total === 0)
    check('size 7 → 400', (await call(staf, 'GET', `${PER}?size=7`)).status === 400)
    check('status asing → 400', (await call(staf, 'GET', `${PER}?status=Mutasi`)).status === 400)
    const fu = await call(staf, 'GET', `${PER}?unitKerja=${encodeURIComponent('Unit Uji R5H27')}&status=MPP&size=100`)
    check('filter unit + status', fu.body?.total === 1 && fu.body.unitKerja.includes('Unit Uji R5H27'), short(fu))

    log('\n7. Ubah, versi, NRP ganda, arsip')
    const t30 = dibuat.find((x) => x.n === 30)
    const dup = await call(op, 'POST', PER, dasar(` ${PREFIX.toLowerCase()}t30 `, 'Uji NRP Ganda', { tanggalPensiun: today }))
    check('NRP sama beda huruf/spasi → 409 duplicate_nrp', dup.status === 409 && dup.body?.error === 'duplicate_nrp', short(dup))
    const isi = (x, extra) => ({ ...dasar(x.nrp, x.nama, { tanggalPensiun: x.tanggalPensiun }), ...extra })
    const ubah = await call(op, 'PATCH', `${PER}/${t30.id}`, { ...isi(t30, { jabatan: 'Analis Uji' }), version: t30.version })
    check('op PATCH → 200, versi naik', ubah.status === 200 && ubah.body?.item?.version === t30.version + 1 && ubah.body.item.jabatan === 'Analis Uji', short(ubah))
    const basi = await call(staf, 'PATCH', `${PER}/${t30.id}`, { ...isi(t30, {}), version: t30.version })
    check('versi basi → 409 version_conflict', basi.status === 409 && basi.body?.error === 'version_conflict', short(basi))
    check('PATCH tanpa version → 400', (await call(staf, 'PATCH', `${PER}/${t30.id}`, isi(t30, {}))).status === 400)
    check('kabagrenmin PATCH → 403', (await call(kabag, 'PATCH', `${PER}/${t30.id}`, { ...isi(t30, {}), version: 2 })).status === 403)
    check('GET id palsu → 404', (await call(staf, 'GET', `${PER}/bukan-uuid`)).status === 404)
    const tPns = pns.body.item
    check('op DELETE → 403', (await call(op, 'DELETE', `${PER}/${tPns.id}?version=${tPns.version}`)).status === 403)
    check('staf DELETE → 403', (await call(staf, 'DELETE', `${PER}/${tPns.id}?version=${tPns.version}`)).status === 403)
    check('DELETE versi basi → 409', (await call(ka, 'DELETE', `${PER}/${tPns.id}?version=${tPns.version + 5}`)).status === 409)
    const del = await call(ka, 'DELETE', `${PER}/${tPns.id}?version=${tPns.version}`)
    check('kasubbag DELETE → 204', del.status === 204, short(del))
    check('setelah arsip GET → 404', (await call(ka, 'GET', `${PER}/${tPns.id}`)).status === 404)
    const ulang = await call(op, 'POST', PER, dasar(`${PREFIX}PNS`, 'Uji NRP Dipakai Ulang', { status: 'Nonaktif' }))
    check('NRP yang diarsip boleh dipakai lagi → 201', ulang.status === 201, short(ulang))

    log('\n8. Tinjau alert (K4/K8/K9)')
    const a1 = await call(op, 'GET', `${ALERT}?tahap=H-30`)
    const uji30 = a1.body?.items?.filter((a) => a.personel.nrp.startsWith(PREFIX)) ?? []
    check('filter tahap H-30 → dua personel uji', uji30.length === 2 && uji30.every((a) => a.tahap === 'H-30' && a.ditinjau === null), short(a1))
    check('tahap asing → 400', (await call(op, 'GET', `${ALERT}?tahap=H-90`)).status === 400)
    const item = (x, extra = {}) => ({ personelId: x.personel?.id ?? x.id, tahap: x.tahap, tanggalPensiun: x.personel?.tanggalPensiun ?? x.tanggalPensiun, ...extra })
    check('kabagrenmin tinjau → 403', (await call(kabag, 'POST', `${ALERT}/tinjau`, { items: [item(uji30[0])] })).status === 403)
    const t7 = dibuat.find((x) => x.n === 7)
    const basiT = await call(op, 'POST', `${ALERT}/tinjau`, { items: [item(uji30[0]), item(t7, { tahap: 'H-14' })] })
    check('satu butir basi → 409 alert_berubah', basiT.status === 409 && basiT.body?.error === 'alert_berubah', short(basiT))
    const nol = (await sql.query('SELECT count(*) FROM sdl_sumda_pensiun_tinjau WHERE personel_id=$1', [uji30[0].personel.id])).rows[0].count
    check('… dan tidak ada yang tersimpan', Number(nol) === 0)
    const kosong = await call(op, 'POST', `${ALERT}/tinjau`, { items: [] })
    check('items kosong → 400', kosong.status === 400)
    check('> 200 butir → 400', (await call(op, 'POST', `${ALERT}/tinjau`, { items: Array(201).fill(item(uji30[0])) })).status === 400)
    check('kunci asing di butir → 400', (await call(op, 'POST', `${ALERT}/tinjau`, { items: [{ ...item(uji30[0]), x: 1 }] })).status === 400)
    const ok = await call(staf, 'POST', `${ALERT}/tinjau`, { items: uji30.map((a) => item(a)) })
    check('staf tinjau dua alert → 200 ditinjau 2', ok.status === 200 && ok.body?.ditinjau === 2, short(ok))
    const lagi = await call(op, 'POST', `${ALERT}/tinjau`, { items: [item(uji30[0])] })
    check('tinjau ulang idempoten → ditinjau 0', lagi.status === 200 && lagi.body?.ditinjau === 0, short(lagi))
    const a2 = await call(ka, 'GET', `${ALERT}?tahap=H-30`)
    const sudah = a2.body.items.filter((a) => a.personel.nrp.startsWith(PREFIX))
    check('terlihat ditinjau oleh staf, untuk seluruh unit', sudah.every((a) => a.ditinjau && a.ditinjau.oleh), JSON.stringify(sudah.map((a) => a.ditinjau)))
    // Koreksi tanggal → kunci (personel, tahap, tanggal) berubah → belum ditinjau lagi (K8).
    const cur30 = (await call(op, 'GET', `${PER}/${t30.id}`)).body.item
    const geser = await call(op, 'PATCH', `${PER}/${t30.id}`, { ...isi(cur30, { tanggalPensiun: await tambahHari(today, 29) }), version: cur30.version })
    check('koreksi tanggal masih H-30', geser.status === 200 && geser.body.item.tahap === 'H-30', short(geser))
    const a3 = (await call(op, 'GET', `${ALERT}?tahap=H-30`)).body.items.find((a) => a.personel.id === t30.id)
    check('… kembali belum ditinjau', a3 && a3.ditinjau === null, JSON.stringify(a3?.ditinjau))
    const g2 = await call(op, 'PATCH', `${PER}/${t30.id}`, { ...isi(geser.body.item, { tanggalPensiun: await tambahHari(today, 12) }), version: geser.body.item.version })
    check('tahap bergeser ke H-14 → belum ditinjau', g2.body?.item?.tahap === 'H-14'
      && (await call(op, 'GET', `${ALERT}?tahap=H-14`)).body.items.find((a) => a.personel.id === t30.id)?.ditinjau === null)

    log('\n9. Audit tanpa data pribadi')
    const ids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
    const ev = (await sql.query(
      "SELECT event_key, metadata::text AS m FROM sdl_audit_events WHERE subject_type='subbagsumda.personel' AND subject_id = ANY($1::text[])", [ids])).rows
    const keys = new Set(ev.map((e) => e.event_key))
    check('audit create/update/archive/review tercatat', ['create', 'update', 'archive'].every((k) => keys.has(`subbagsumda.personel.${k}`)) && keys.has('subbagsumda.pensiun.review'), [...keys].join(','))
    check('metadata tanpa NRP/nama/tanggal', ev.every((e) => !e.m.includes(PREFIX) && !e.m.includes('Uji ') && !/\d{4}-\d{2}-\d{2}/.test(e.m)))
    const upd = ev.filter((e) => e.event_key === 'subbagsumda.personel.update').map((e) => JSON.parse(e.m).fields)
    check('update mencatat nama field yang berubah', upd.some((f) => f?.includes('jabatan')) && upd.some((f) => f?.includes('tanggalPensiun')), JSON.stringify(upd))

    const hariAkhir = await hariIni()
    if (hariAkhir !== today) { fail++; log('  GAGAL  tanggal WIB berganti selama uji (lewat tengah malam) — ulangi') }
  } finally {
    await bersihkan()
    await db.revokeMintedSessions().catch(() => {})
  }

  log(`\n${fail ? `GAGAL: ${fail} pemeriksaan` : 'LULUS: semua pemeriksaan'}\n`)
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await sql.end(); await db.close(); process.exit(fail ? 1 : 0) })
