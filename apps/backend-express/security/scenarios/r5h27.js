import { createServer } from 'node:http'

import { createApp } from '../../src/app.js'
import { Mailer } from '../../src/auth/mailer.js'
import { contains, equal, status } from '../assert.js'
import { Browser } from '../browser.js'

/**
 * R5H27 — Subbagsumda Master Personel + Monitoring Pensiun (migrasi 068). EXPRESS SAJA:
 * tidak ada padanan di suite Go, jadi namanya berawalan `x2_` dan diletakkan SETELAH x1.
 *
 * Yang dibuktikan, karena harness golden tidak bisa melihatnya (endpoint ini tidak direkam):
 *   - guard operasional: anonim 401, Superadmin 403 — TERMASUK saat workspace demo
 *     Superadmin menyala (guard meloloskan, PERMIT_SQL tetap menolak);
 *   - izin per permission pada grant unit subbagsumda: role baca saja hanya GET; tanpa
 *     `archive` DELETE 403 dan barisnya tetap ada; tanpa `review` tinjau 403;
 *   - grant dicabut, kedaluwarsa, tanpa keanggotaan unit, role nonaktif, grant di unit lain,
 *     dan must_change_password semuanya 403;
 *   - scope `assigned` TIDAK menyembunyikan baris (K2), jadi data tidak hilang diam-diam;
 *   - mutasi wajib CSRF + Origin sah;
 *   - validasi bentuk body: field asing, __proto__, NUL, surrogate tunggal, tinjau > 200.
 */
const PER = '/api/v1/subbagsumda/personel'
const ALERT = '/api/v1/subbagsumda/pensiun/alert'
const DASH = '/api/v1/subbagsumda/dashboard'
const raw = (s) => Buffer.from(s, 'utf8')
const PROTO_ASLI = new Set(Object.getOwnPropertyNames(Object.prototype))
const ALL = ['subbagsumda.personel.read', 'subbagsumda.personel.create', 'subbagsumda.personel.update',
  'subbagsumda.personel.archive', 'subbagsumda.pensiun.review']

export async function verifyR5H27SumdaPersonel({ env }) {
  // Tiga role terisolasi: penuh (Kasubbag), operator (tanpa archive), baca saja (Kabagrenmin).
  await env.createRole('br_r5h27_penuh', 'R5H27 Penuh')
  await env.grantPermissions('br_r5h27_penuh', ALL)
  await env.createRole('br_r5h27_op', 'R5H27 Operator')
  await env.grantPermissions('br_r5h27_op', ALL.filter((p) => p !== 'subbagsumda.personel.archive'))
  await env.createRole('br_r5h27_baca', 'R5H27 Baca')
  await env.grantPermissions('br_r5h27_baca', ['subbagsumda.personel.read'])

  const users = {}
  for (const [name, role, scope] of [
    ['ka_r5h27', 'br_r5h27_penuh', 'unit'],
    ['op_r5h27', 'br_r5h27_op', 'assigned'],
    ['baca_r5h27', 'br_r5h27_baca', 'unit'],
  ]) {
    users[name] = await env.createUser(name)
    await env.attachUnit(users[name].id, 'subbagsumda')
    await env.grant(users[name].id, role, 'subbagsumda', scope, { reason: 'Isolated R5H27 grant only' })
  }
  // Grant SAH tetapi di unit lain: permission yang sama tidak boleh berlaku di subbagsumda.
  const luar = await env.createUser('luar_r5h27')
  await env.attachUnit(luar.id, 'subbagren')
  await env.grant(luar.id, 'br_r5h27_penuh', 'subbagren', 'unit', { reason: 'Isolated R5H27 grant only' })
  // Grant subbagsumda TANPA keanggotaan sdl_user_units.
  const tanpaUnit = await env.createUser('tanpaunit_r5h27')
  await env.attachUnit(tanpaUnit.id, 'subbagren')
  await env.grant(tanpaUnit.id, 'br_r5h27_penuh', 'subbagsumda', 'unit', { reason: 'Isolated R5H27 grant only' })

  const anon = await env.newBrowser()
  const ka = await env.newSession('ka_r5h27')
  const op = await env.newSession('op_r5h27')
  const baca = await env.newSession('baca_r5h27')
  const sLuar = await env.newSession('luar_r5h27')
  const sTanpa = await env.newSession('tanpaunit_r5h27')
  const sa = await env.loginSuperadmin()
  const isi = (nrp, extra = {}) => ({
    nrp, nama: 'Personel Uji Keamanan', jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '',
    tmtDinas: '', tanggalPensiun: '2030-01-01', status: 'Aktif', catatan: '', ...extra,
  })

  // ---- 1. Guard ----
  for (const path of [PER, `${PER}/capabilities`, ALERT, DASH]) status(await anon.call('GET', path), 401, `anonim GET ${path}`)
  status(await anon.call('POST', PER, isi('SEC-ANON'), true), 401, 'anonim POST')
  for (const path of [PER, ALERT, DASH]) status(await sa.call('GET', path), 403, `Superadmin GET ${path}`)
  status(await sa.call('POST', PER, isi('SEC-SA'), true), 403, 'Superadmin POST')

  // Workspace demo Superadmin: app kedua dengan flag menyala. Guard operasional meloloskan
  // Superadmin di mode ini, jadi 403 di bawah membuktikan PERMIT_SQL menolak sendiri.
  const demoServer = createServer(createApp({
    pool: env.pool,
    config: { ...env.config, demoSuperadminWorkspace: true },
    mailer: new Mailer({ host: '', port: 587, username: '', password: '', from: '' }),
  }))
  await new Promise((resolve) => demoServer.listen(0, '127.0.0.1', resolve))
  try {
    const demo = await new Browser(`http://127.0.0.1:${demoServer.address().port}`).bootstrap()
    const { challenge, code } = await env.setOTPChallenge(env.users.get('sa_r2d5'))
    status(await demo.call('POST', '/api/v1/auth/verify-otp', { challenge, code }, true), 200, 'login Superadmin di app demo')
    for (const path of [PER, ALERT, DASH]) status(await demo.call('GET', path), 403, `Superadmin demo GET ${path}`)
    status(await demo.call('POST', PER, isi('SEC-DEMO'), true), 403, 'Superadmin demo POST')
    // Izin diperiksa SEBELUM baris dicari: UUID fiktif pun harus 403, bukan 404.
    const palsu = '00000000-0000-4000-8000-000000000000'
    status(await demo.call('PATCH', `${PER}/${palsu}`, { ...isi('SEC-DEMO'), version: 1 }, true), 403, 'Superadmin demo PATCH')
    status(await demo.call('DELETE', `${PER}/${palsu}?version=1`, null, true), 403, 'Superadmin demo DELETE')
    status(await demo.call('POST', `${ALERT}/tinjau`, { items: [{ personelId: palsu, tahap: 'H-7', tanggalPensiun: '2030-01-01' }] }, true), 403, 'Superadmin demo tinjau')
    contains(await demo.call('GET', `${PER}/capabilities`), '"canRead":false', 'Superadmin demo capabilities kosong')
  } finally {
    await new Promise((resolve) => demoServer.close(resolve))
  }

  for (const [b, label] of [[sLuar, 'grant di unit lain'], [sTanpa, 'tanpa keanggotaan unit']]) {
    contains(await b.call('GET', `${PER}/capabilities`), '"canRead":false,"canCreate":false,"canUpdate":false,"canArchive":false,"canReview":false', `${label} capabilities kosong`)
    status(await b.call('GET', PER), 403, `${label} GET`)
    status(await b.call('POST', PER, isi('SEC-LUAR'), true), 403, `${label} POST`)
  }

  // ---- 2. Matriks izin ----
  const buat = await op.call('POST', PER, isi('SEC-001'), true)
  status(buat, 201, 'operator (scope assigned) tambah')
  const item = JSON.parse(buat.text).item
  status(await op.call('POST', PER, isi('SEC-002'), false), 403, 'tambah tanpa CSRF')
  status(await op.call('POST', PER, isi('SEC-002'), true, { origin: 'https://evil.example' }), 403, 'tambah dengan Origin asing')
  // K2: scope assigned tidak menyaring baris — dibuat oleh op, terlihat oleh baca, dan sebaliknya.
  contains(await baca.call('GET', PER), 'SEC-001', 'role baca saja melihat baris')
  status(await baca.call('POST', PER, isi('SEC-003'), true), 403, 'baca saja POST')
  status(await baca.call('PATCH', `${PER}/${item.id}`, { ...isi('SEC-001'), version: item.version }, true), 403, 'baca saja PATCH')
  status(await baca.call('DELETE', `${PER}/${item.id}?version=${item.version}`, null, true), 403, 'baca saja DELETE')
  const tinjau = { items: [{ personelId: item.id, tahap: 'H-60', tanggalPensiun: '2030-01-01' }] }
  status(await baca.call('POST', `${ALERT}/tinjau`, tinjau, true), 403, 'baca saja tinjau')
  status(await op.call('DELETE', `${PER}/${item.id}?version=${item.version}`, null, true), 403, 'operator tanpa archive DELETE')
  status(await op.call('GET', `${PER}/${item.id}`), 200, 'baris tetap ada setelah DELETE ditolak')
  status(await ka.call('DELETE', `${PER}/${item.id}?version=${item.version}`, null, false), 403, 'DELETE tanpa CSRF')
  const patchBody = { ...isi('SEC-001'), version: item.version }
  status(await op.call('PATCH', `${PER}/${item.id}`, patchBody, false), 403, 'PATCH tanpa CSRF')
  status(await op.call('PATCH', `${PER}/${item.id}`, patchBody, true, { origin: 'https://evil.example' }), 403, 'PATCH dengan Origin asing')
  status(await op.call('POST', `${ALERT}/tinjau`, tinjau, false), 403, 'tinjau tanpa CSRF')
  status(await op.call('POST', `${ALERT}/tinjau`, tinjau, true, { origin: 'https://evil.example' }), 403, 'tinjau dengan Origin asing')

  // ---- 2b. Query dan header ----
  const total = () => op.call('GET', `${PER}?size=100`).then((r) => JSON.parse(r.text).total)
  const semua = await total()
  for (const q of ["%' OR 1=1 --", '\\', '%_', "SEC-001' --"]) {
    const r = await op.call('GET', `${PER}?q=${encodeURIComponent(q)}`)
    status(r, 200, `pencarian harfiah ${JSON.stringify(q)}`)
    equal(JSON.parse(r.text).total, 0, `pencarian ${JSON.stringify(q)} tidak mencocokkan semua baris`)
  }
  // Parser query Express 5 ("simple") tidak mengenal `q[]=`; array muncul dari parameter ganda.
  for (const qs of ['size=10;DROP', 'size=7', 'page=0', 'page=1e3', 'q=a&q=b', 'unitKerja=a&unitKerja=b', 'status=Aktif&status=MPP']) {
    status(await op.call('GET', `${PER}?${qs}`), 400, `query ${qs}`)
  }
  equal(await total(), semua, 'jumlah baris tidak berubah setelah probe')
  for (const [label, r] of [
    ['daftar', await op.call('GET', PER)], ['detail', await op.call('GET', `${PER}/${item.id}`)],
    ['capabilities', await op.call('GET', `${PER}/capabilities`)], ['alert', await op.call('GET', ALERT)],
    ['dashboard', await op.call('GET', DASH)],
  ]) equal(r.headers.get('cache-control'), 'no-store', `Cache-Control ${label}`)
  const besar = await op.call('POST', PER, { ...isi('SEC-BESAR'), catatan: 'x'.repeat(33000) }, true)
  status(besar, 400, 'body > 32 KB'); contains(besar, 'invalid_body', 'body > 32 KB ditolak di batas ukuran')
  for (const [label, nrp] of [['zero-width', 'SEC​001'], ['pembalik arah', 'SEC‮100'], ['huruf non-ASCII', 'SЕC-001']]) {
    status(await op.call('POST', PER, isi(nrp), true), 400, `NRP ${label}`)
  }
  status(await op.call('POST', PER, isi('SEC-NAMA', { nama: 'Nama​Tersembunyi' }), true), 400, 'nama zero-width')

  // ---- 3. Pencabutan hak di tengah jalan ----
  const opId = users.op_r5h27.id
  // grant_expiry mensyaratkan expires_at > granted_at, jadi granted_at ikut dimundurkan.
  await env.pool.query("UPDATE sdl_access_grants SET granted_at=now()-interval '2 hours', expires_at=now()-interval '1 minute' WHERE user_id=$1", [opId])
  try {
    status(await op.call('GET', PER), 403, 'grant kedaluwarsa GET')
  } finally {
    await env.pool.query('UPDATE sdl_access_grants SET expires_at=NULL WHERE user_id=$1', [opId])
  }
  await env.pool.query("UPDATE sdl_roles SET is_active=FALSE WHERE role_key='br_r5h27_op'")
  try {
    status(await op.call('GET', PER), 403, 'role nonaktif GET')
  } finally {
    await env.pool.query("UPDATE sdl_roles SET is_active=TRUE WHERE role_key='br_r5h27_op'")
  }
  await env.pool.query('UPDATE sdl_users SET must_change_password=TRUE WHERE id=$1', [opId])
  try {
    status(await op.call('GET', PER), 403, 'must_change_password GET')
    status(await op.call('POST', PER, isi('SEC-MCP'), true), 403, 'must_change_password POST')
  } finally {
    await env.pool.query('UPDATE sdl_users SET must_change_password=FALSE WHERE id=$1', [opId])
  }
  status(await op.call('GET', PER), 200, 'operator pulih')
  await env.revokeGrants(opId, 'br_r5h27_op')
  status(await op.call('GET', PER), 403, 'grant dicabut GET')
  status(await op.call('POST', `${ALERT}/tinjau`, tinjau, true), 403, 'grant dicabut tinjau')

  // ---- 4. Validasi bentuk ----
  status(await ka.call('POST', PER, { ...isi('SEC-004'), x: 1 }, true), 400, 'field asing')
  status(await ka.call('POST', PER, raw('bukan json'), true), 400, 'body bukan JSON')
  status(await ka.call('POST', PER, raw('{"__proto__":{"polluted":1},"nrp":"SEC-005"}'), true), 400, 'kunci __proto__')
  status(await ka.call('POST', PER, raw(JSON.stringify(isi('SEC-006')).replace('"SEC-006"', '"SEC\\u0000006"')), true), 400, 'NRP berisi NUL')
  status(await ka.call('POST', PER, raw(JSON.stringify(isi('SEC-007')).replace('"Personel Uji Keamanan"', '"Uji \\ud800 tunggal"')), true), 400, 'nama surrogate tunggal')
  const banyak = { items: Array.from({ length: 201 }, () => tinjau.items[0]) }
  status(await ka.call('POST', `${ALERT}/tinjau`, banyak, true), 400, 'tinjau 201 butir')
  status(await ka.call('POST', `${ALERT}/tinjau`, raw(`{"items":[{"personelId":"${item.id}","tahap":"H-60","tanggalPensiun":"2030-01-01","__proto__":{}}]}`), true), 400, 'butir tinjau berkunci __proto__')
  equal(Object.getOwnPropertyNames(Object.prototype).filter((k) => !PROTO_ASLI.has(k)).join(','), '', 'prototipe Object tidak tercemar')
  // Alert tahun 2030 tidak sedang aktif → tinjau ditolak utuh, bukan diterima diam-diam.
  const basi = await ka.call('POST', `${ALERT}/tinjau`, tinjau, true)
  status(basi, 409, 'tinjau alert yang tidak aktif'); contains(basi, 'alert_berubah', 'kode alert_berubah')
  equal(Number((await env.pool.query('SELECT count(*) FROM sdl_sumda_pensiun_tinjau')).rows[0].count), 0, 'tidak ada tinjau tersimpan')

  // ---- 5. Arsip oleh yang berhak, dan audit tanpa data pribadi ----
  status(await ka.call('DELETE', `${PER}/${item.id}?version=${item.version}`, null, true), 204, 'Kasubbag arsip')
  status(await ka.call('GET', `${PER}/${item.id}`), 404, 'terarsip tidak terbaca')
  const meta = (await env.pool.query(
    "SELECT metadata::text AS m FROM sdl_audit_events WHERE subject_type='subbagsumda.personel' AND subject_id=$1", [item.id])).rows
  equal(meta.length, 2, 'audit create + archive')
  equal(meta.some((r) => r.m.includes('SEC-001') || r.m.includes('Personel Uji')), false, 'audit tanpa NRP/nama')
}
