import { createServer } from 'node:http'

import { createApp } from '../../src/app.js'
import { Mailer } from '../../src/auth/mailer.js'
import { contains, equal, status } from '../assert.js'
import { Browser } from '../browser.js'

/**
 * R5H30 — Subbagsumda Cuti & Perizinan + Kesejahteraan (migrasi 071). EXPRESS SAJA: `x5_`, setelah x4.
 *
 * Yang dibuktikan: guard kedua prefix (anonim 401, Superadmin 403 termasuk workspace demo; UUID fiktif 403) ·
 * capabilities unit lain kosong · matriks baca saja / kelola tanpa setuju / setuju tanpa kelola · maker-checker
 * lewat API · pencabutan hak · CSRF/Origin JSON + multipart · LAMPIRAN CUTI SAKIT DIBATASI (K4) · id silang
 * antar-pengajuan dan antar-modul · bentuk (field asing, __proto__, Cf, > 32 KB, isian aksi yang tidak
 * berlaku, probe query) · kunci evidence kosong fail-closed.
 */
const C = '/api/v1/subbagsumda/cuti'
const KS = '/api/v1/subbagsumda/kesejahteraan'
const PER = '/api/v1/subbagsumda/personel'
const raw = (s) => Buffer.from(s, 'utf8')
const PROTO_ASLI = new Set(Object.getOwnPropertyNames(Object.prototype))
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n' +
  '3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n', 'latin1')
const PALSU = '00000000-0000-4000-8000-000000000000'

async function appLain(env, configLain) {
  const server = createServer(createApp({
    pool: env.pool,
    config: { ...env.config, ...configLain },
    mailer: new Mailer({ host: '', port: 587, username: '', password: '', from: '' }),
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

export async function verifyR5H30SumdaLayanan({ env }) {
  const BACA = 'subbagsumda.personel.read'
  const roles = {
    br_r5h30_penuh: [BACA, 'subbagsumda.personel.create', 'subbagsumda.personel.update', 'subbagsumda.personel.archive',
      'subbagsumda.cuti.manage', 'subbagsumda.cuti.approve', 'subbagsumda.kesejahteraan.manage', 'subbagsumda.kesejahteraan.approve'],
    br_r5h30_op: [BACA, 'subbagsumda.cuti.manage', 'subbagsumda.kesejahteraan.manage'],
    br_r5h30_apr: [BACA, 'subbagsumda.cuti.approve', 'subbagsumda.kesejahteraan.approve'],
    br_r5h30_baca: [BACA],
  }
  for (const [role, perms] of Object.entries(roles)) { await env.createRole(role, role); await env.grantPermissions(role, perms) }
  const users = {}
  for (const [name, role, scope] of [['ka_r5h30', 'br_r5h30_penuh', 'unit'], ['op_r5h30', 'br_r5h30_op', 'assigned'], ['op2_r5h30', 'br_r5h30_op', 'own'],
    ['apr_r5h30', 'br_r5h30_apr', 'unit'], ['baca_r5h30', 'br_r5h30_baca', 'unit']]) {
    users[name] = await env.createUser(name)
    await env.attachUnit(users[name].id, 'subbagsumda')
    await env.grant(users[name].id, role, 'subbagsumda', scope, { reason: 'Isolated R5H30 grant only' })
  }
  const luar = await env.createUser('luar_r5h30')
  await env.attachUnit(luar.id, 'subbagren')
  await env.grant(luar.id, 'br_r5h30_penuh', 'subbagren', 'unit', { reason: 'Isolated R5H30 grant only' })

  const anon = await env.newBrowser()
  const [ka, op, op2, apr, baca, sLuar] = await Promise.all(['ka_r5h30', 'op_r5h30', 'op2_r5h30', 'apr_r5h30', 'baca_r5h30', 'luar_r5h30'].map((u) => env.newSession(u)))
  const sa = await env.loginSuperadmin()
  const item = (r) => JSON.parse(r.text).item
  const json = (r) => JSON.parse(r.text)

  const per = item(await ka.call('POST', PER, { nrp: 'SEC-C-001', nama: 'Personel Uji Cuti', jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '' }, true))
  const isiC = (extra = {}) => ({ personelId: per.id, jenis: 'TAHUNAN', tanggalMulai: '2027-02-01', tanggalSelesai: '2027-02-02', catatan: '', ...extra })
  const aksi = (s, base, it, act, extra = {}) => s.call('POST', `${base}/${it.id}/aksi`, { aksi: act, catatan: '', version: it.version, ...extra }, true)

  // ---- 1. Guard ----
  for (const path of [C, `${C}/capabilities`, `${C}/kalender?bulan=2027-02`, KS, `${KS}/capabilities`]) status(await anon.call('GET', path), 401, `anonim GET ${path}`)
  for (const [m, path, b] of [['GET', C], ['POST', C, isiC()], ['GET', `${C}/kalender?bulan=2027-02`], ['POST', `${C}/${PALSU}/aksi`, { aksi: 'proses', catatan: '', version: 1 }],
    ['GET', KS], ['POST', `${KS}/${PALSU}/aksi`, { aksi: 'proses', catatan: '', version: 1 }]]) {
    status(await sa.call(m, path, b ?? null, m !== 'GET'), 403, `Superadmin ${m} ${path}`)
  }
  const demo = await appLain(env, { demoSuperadminWorkspace: true })
  try {
    const b = await new Browser(demo.base).bootstrap()
    const { challenge, code } = await env.setOTPChallenge(env.users.get('sa_r2d5'))
    status(await b.call('POST', '/api/v1/auth/verify-otp', { challenge, code }, true), 200, 'login Superadmin di app demo')
    status(await b.call('GET', C), 403, 'Superadmin demo GET cuti')
    status(await b.call('POST', C, isiC(), true), 403, 'Superadmin demo POST cuti')
    status(await b.upload(`${C}/${PALSU}/lampiran`, { filename: 'a.pdf', data: PDF }), 403, 'Superadmin demo unggah cuti')
    status(await b.call('GET', `${C}/${PALSU}/lampiran/${PALSU}`), 403, 'Superadmin demo unduh cuti')
    contains(await b.call('GET', `${C}/capabilities`), '"canRead":false,"canManage":false,"canApprove":false', 'Superadmin demo capabilities cuti kosong')
    contains(await b.call('GET', `${KS}/capabilities`), '"canRead":false,"canManage":false,"canApprove":false', 'Superadmin demo capabilities kesejahteraan kosong')
  } finally { await demo.close() }
  for (const base of [C, KS]) {
    contains(await sLuar.call('GET', `${base}/capabilities`), '"canRead":false,"canManage":false,"canApprove":false', `grant unit lain capabilities ${base}`)
    status(await sLuar.call('GET', base), 403, `grant unit lain GET ${base}`)
  }

  // ---- 2. Matriks + maker-checker (cuti) ----
  status(await baca.call('POST', C, isiC(), true), 403, 'baca saja catat cuti')
  status(await apr.call('POST', C, isiC(), true), 403, 'setuju-saja catat cuti')
  let c1 = item(await op.call('POST', C, isiC(), true))
  status(await baca.call('POST', `${C}/${c1.id}/aksi`, { aksi: 'proses', catatan: '', version: c1.version }, true), 403, 'baca saja proses')
  status(await baca.upload(`${C}/${c1.id}/lampiran`, { filename: 'a.pdf', data: PDF }), 403, 'baca saja unggah')
  status(await apr.call('POST', `${C}/${c1.id}/aksi`, { aksi: 'proses', catatan: '', version: c1.version }, true), 403, 'setuju-saja proses')
  c1 = item(await aksi(op, C, c1, 'proses'))
  status(await aksi(op2, C, c1, 'setujui'), 403, 'kelola tanpa setuju: setujui')
  status(await aksi(op2, C, c1, 'batalkan', { catatan: 'bukan pencatat, tanpa setuju' }), 403, 'batalkan oleh bukan pencatat tanpa setuju')
  let c2 = item(await ka.call('POST', C, isiC({ tanggalMulai: '2027-03-01', tanggalSelesai: '2027-03-02' }), true))
  c2 = item(await aksi(op, C, c2, 'proses'))
  contains(await aksi(ka, C, c2, 'setujui'), 'self_review_forbidden', 'pencatat yang punya setuju tidak boleh memutus')
  status(await op.upload(`${C}/${c1.id}/lampiran`, { filename: 'p.pdf', data: PDF }), 201, 'op unggah (op jadi pengubah terakhir)')
  c1 = item(await op.call('GET', `${C}/${c1.id}`))
  const s1 = await aksi(apr, C, c1, 'setujui')
  status(s1, 200, 'setuju-saja memutus pengajuan orang lain'); c1 = item(s1)
  status(await aksi(apr, C, c1, 'selesai'), 403, 'setuju-saja tandai selesai')
  // Pengubah terakhir (lewat lampiran) tidak boleh memutus, walau bukan pencatat.
  let c3 = item(await op.call('POST', C, isiC({ tanggalMulai: '2027-03-15', tanggalSelesai: '2027-03-16' }), true))
  c3 = item(await aksi(op, C, c3, 'proses'))
  status(await ka.upload(`${C}/${c3.id}/lampiran`, { filename: 'k.pdf', data: PDF }), 201, 'Kasubbag unggah (jadi pengubah terakhir)')
  c3 = item(await ka.call('GET', `${C}/${c3.id}`))
  contains(await aksi(ka, C, c3, 'setujui'), 'self_review_forbidden', 'pengubah terakhir tidak boleh memutus cuti')

  // ---- 3. CSRF / Origin ----
  status(await op.call('POST', C, isiC({ tanggalMulai: '2027-04-05', tanggalSelesai: '2027-04-05' }), false), 403, 'catat cuti tanpa CSRF')
  status(await op.call('POST', C, isiC({ tanggalMulai: '2027-04-05', tanggalSelesai: '2027-04-05' }), true, { origin: 'https://evil.example' }), 403, 'catat cuti Origin asing')
  status(await op.call('POST', `${C}/${c2.id}/aksi`, { aksi: 'batalkan', catatan: 'tanpa csrf sama sekali', version: c2.version }, false), 403, 'aksi tanpa CSRF')
  status(await op.upload(`${C}/${c2.id}/lampiran`, { filename: 'a.pdf', data: PDF, csrf: false }), 403, 'unggah tanpa CSRF')

  // ---- 4. Lampiran cuti Sakit dibatasi (K4) + berkas ----
  const sakit = item(await op.call('POST', C, isiC({ jenis: 'SAKIT', tanggalMulai: '2027-05-03', tanggalSelesai: '2027-05-04' }), true))
  const upS = await op.upload(`${C}/${sakit.id}/lampiran`, { filename: 'surat-dokter-diagnosis.pdf', data: PDF }); status(upS, 201, 'unggah lampiran Sakit')
  const lidS = json(upS).id
  for (const [s, label] of [[op2, 'kelola bukan pengunggah'], [baca, 'baca saja']]) {
    status(await s.call('GET', `${C}/${sakit.id}/lampiran/${lidS}`), 403, `${label} unduh lampiran Sakit`)
    const d = json(await s.call('GET', `${C}/${sakit.id}`))
    equal(d.lampiran[0].filename, null, `${label}: nama berkas Sakit tidak terkirim`)
    equal(d.lampiran[0].dibatasi, true, `${label}: lampiran ditandai dibatasi`)
  }
  for (const [s, label] of [[op, 'pengunggah'], [apr, 'pemegang setuju'], [ka, 'Kasubbag']]) {
    const dl = await s.call('GET', `${C}/${sakit.id}/lampiran/${lidS}`)
    status(dl, 200, `${label} unduh lampiran Sakit`); equal(dl.body.equals(PDF), true, `${label}: byte-identik`)
  }
  status(await op2.call('PATCH', `${C}/${sakit.id}`, { jenis: 'TAHUNAN', tanggalMulai: '2027-05-03', tanggalSelesai: '2027-05-04', catatan: '', version: sakit.version + 1 }, true), 400, 'jenis Sakit tidak bisa diubah (K29)')
  const tahunan = item(await op.call('POST', C, isiC({ tanggalMulai: '2027-06-07', tanggalSelesai: '2027-06-08' }), true))
  const upT = await op.upload(`${C}/${tahunan.id}/lampiran`, { filename: 'jadwal.pdf', data: PDF }); status(upT, 201, 'unggah lampiran Tahunan')
  const lidT = json(upT).id
  const dlT = await baca.call('GET', `${C}/${tahunan.id}/lampiran/${lidT}`)
  status(dlT, 200, 'lampiran Tahunan terbuka untuk pembaca')
  for (const [h, want] of [['x-content-type-options', 'nosniff'], ['content-security-policy', 'sandbox'], ['cache-control', 'no-store']]) equal(dlT.headers.get(h), want, `header ${h}`)
  status(await ka.call('GET', `${C}/${tahunan.id}/lampiran/${lidS}`), 404, 'lampiran Sakit via cuti lain (id silang)')
  status(await ka.call('DELETE', `${C}/${tahunan.id}/lampiran/${lidS}`, null, true), 404, 'hapus lampiran via cuti lain')
  status(await baca.call('GET', `${C}/${tahunan.id}/lampiran/${lidS}`), 404, 'pembaca: lampiran Sakit via cuti Tahunan tetap 404, bukan terbuka')
  status(await op.upload(`${C}/${tahunan.id}/lampiran`, { filename: 'a.pdf', data: raw('bukan pdf') }), 400, 'bukan PDF')
  for (const nama of ['<script>.pdf', 'a.exe', 'a.pdf.html']) status(await op.upload(`${C}/${tahunan.id}/lampiran`, { filename: nama, data: PDF }), 400, `nama ${nama}`)
  // Parser multipart mengambil basename (padanan safeName Go): 201 boleh asal nama tersimpan tanpa / atau .. (pola x3).
  const trav = await op.upload(`${C}/${tahunan.id}/lampiran`, { filename: '../../x.pdf', data: PDF })
  if (trav.status === 201) {
    const nama = json(await ka.call('GET', `${C}/${tahunan.id}`)).lampiran.find((l) => l.id === json(trav).id)?.filename ?? ''
    equal(/[/\\]|\.\./.test(nama), false, 'path traversal: tersimpan tanpa / atau ..')
  } else status(trav, 400, 'path traversal ditolak')
  const besar = Buffer.concat([PDF.subarray(0, 9), Buffer.alloc(5 * 1024 * 1024 + 10, 0x20), raw('\n%%EOF\n')])
  status(await op.upload(`${C}/${tahunan.id}/lampiran`, { filename: 'b.pdf', data: besar }), 413, 'lampiran > 5 MB')
  status(await op2.call('DELETE', `${C}/${tahunan.id}/lampiran/${lidT}`, null, true), 403, 'hapus lampiran milik orang lain tanpa setuju')

  // ---- 5. Bentuk ----
  status(await op.call('POST', C, { ...isiC(), x: 1 }, true), 400, 'field asing cuti')
  status(await op.call('POST', C, raw('{"__proto__":{"polluted":1},"jenis":"SAKIT"}'), true), 400, 'kunci __proto__')
  status(await op.call('POST', C, isiC({ catatan: 'izin​keluarga', tanggalMulai: '2027-07-05', tanggalSelesai: '2027-07-05' }), true), 400, 'catatan zero-width')
  status(await op.call('POST', C, isiC({ catatan: 'x'.repeat(33000) }), true), 400, 'body JSON > 32 KB')
  status(await op.call('POST', C, isiC({ personelId: 'x' }), true), 400, 'personelId bukan UUID')
  status(await op.call('POST', C, isiC({ jumlahHari: 1.5 }), true), 400, 'jumlahHari pecahan')
  status(await aksi(op, C, c2, 'batalkan', { catatan: 'alasan cukup panjang', tanggalKembali: '2027-03-01' }), 400, 'tanggalKembali pada aksi batalkan')
  status(await aksi(op, C, c2, 'batalkan', { catatan: 'alasan cukup panjang', terapkan: { status: 'MPP' } }), 400, 'terapkan pada cuti')
  for (const qs of ['size=7', 'page=0', 'status=Aktif', 'jenis=CUTI', 'bulan=2027-13', 'q=a&q=b', 'personelId=x']) status(await op.call('GET', `${C}?${qs}`), 400, `query cuti ${qs}`)
  for (const qs of ['bulan=1999-01', 'bulan=', 'bulan=2027-02&tahun=1']) status(await op.call('GET', `${C}/kalender?${qs}`), 400, `query kalender ${qs}`)
  status(await op.call('GET', `${C}/jatah?personelId=${per.id}&tahun=abc`), 400, 'query jatah tahun abc')
  equal(Object.getOwnPropertyNames(Object.prototype).filter((x) => !PROTO_ASLI.has(x)).join(','), '', 'prototipe Object tidak tercemar')
  for (const path of [C, `${C}/${c1.id}`, `${C}/kalender?bulan=2027-02`, `${C}/jatah?personelId=${per.id}`]) equal((await op.call('GET', path)).headers.get('cache-control'), 'no-store', `no-store ${path}`)

  // ---- 6. Kesejahteraan (irisan B) ----
  await bagianKesejahteraan({ env, ka, op, op2, apr, baca, per, aksi, item, json, lidS, sakit })

  // ---- 7. Pencabutan ----
  const opId = users.op_r5h30.id
  await env.pool.query("UPDATE sdl_access_grants SET granted_at=now()-interval '2 hours', expires_at=now()-interval '1 minute' WHERE user_id=$1", [opId])
  try { status(await op.call('GET', C), 403, 'grant kedaluwarsa') } finally { await env.pool.query('UPDATE sdl_access_grants SET expires_at=NULL WHERE user_id=$1', [opId]) }
  await env.pool.query("UPDATE sdl_roles SET is_active=FALSE WHERE role_key='br_r5h30_op'")
  try { status(await op.call('GET', KS), 403, 'role nonaktif') } finally { await env.pool.query("UPDATE sdl_roles SET is_active=TRUE WHERE role_key='br_r5h30_op'") }
  await env.pool.query('UPDATE sdl_users SET must_change_password=TRUE WHERE id=$1', [opId])
  try { status(await op.call('POST', C, isiC({ tanggalMulai: '2027-08-02', tanggalSelesai: '2027-08-02' }), true), 403, 'must_change_password POST') } finally { await env.pool.query('UPDATE sdl_users SET must_change_password=FALSE WHERE id=$1', [opId]) }
  status(await op.call('GET', C), 200, 'operator pulih')

  // ---- 8. Kunci evidence kosong: fail-closed ----
  const tanpaKunci = await appLain(env, { evidenceKey: null })
  try {
    const b = await new Browser(tanpaKunci.base).bootstrap()
    await b.login('op_r5h30', 200)
    const sebelum = Number((await env.pool.query('SELECT count(*) FROM sdl_sumda_cuti_lampiran')).rows[0].count)
    const r = await b.upload(`${C}/${tahunan.id}/lampiran`, { filename: 'c.pdf', data: PDF })
    status(r, 503, 'unggah tanpa kunci evidence'); contains(r, 'evidence_encryption_unavailable', 'kode enkripsi tidak tersedia')
    equal(Number((await env.pool.query('SELECT count(*) FROM sdl_sumda_cuti_lampiran')).rows[0].count), sebelum, 'tidak ada lampiran tersimpan')
    status(await b.call('GET', `${C}/${tahunan.id}/lampiran/${lidT}`), 503, 'unduh tanpa kunci evidence')
  } finally { await tanpaKunci.close() }

  await env.revokeGrants(opId, 'br_r5h30_op')
  status(await op.call('GET', C), 403, 'grant dicabut')
}

/** Irisan B: kesejahteraan — matriks, maker-checker, terapkan butuh personel.update, id silang antar-modul, bentuk. */
async function bagianKesejahteraan({ ka, op, op2, apr, baca, aksi, item, json, lidS }) {
  const p2 = item(await ka.call('POST', PER, { nrp: 'SEC-C-002', nama: 'Personel Uji Kesejahteraan', jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '' }, true))
  const isiK = (extra = {}) => ({ personelId: p2.id, jenis: 'PERSIAPAN_PENSIUN', nomorReferensi: '', targetSelesai: '', catatan: '', ...extra })
  status(await baca.call('POST', KS, isiK(), true), 403, 'baca saja catat layanan')
  status(await apr.call('POST', KS, isiK(), true), 403, 'setuju-saja catat layanan')
  status(await op.call('POST', KS, isiK(), false), 403, 'catat layanan tanpa CSRF')
  status(await op.call('POST', KS, isiK(), true, { origin: 'https://evil.example' }), 403, 'catat layanan Origin asing')
  let k1 = item(await op.call('POST', KS, isiK(), true))
  const ganda = await op2.call('POST', KS, isiK(), true)
  status(ganda, 409, 'layanan terbuka ganda'); equal(json(ganda).id, k1.id, 'pengajuan_ganda membawa id yang terbuka')
  status(await baca.call('POST', `${KS}/${k1.id}/aksi`, { aksi: 'proses', catatan: '', version: k1.version }, true), 403, 'baca saja proses layanan')
  k1 = item(await aksi(op, KS, k1, 'proses'))
  status(await aksi(op2, KS, k1, 'setujui'), 403, 'kelola tanpa setuju: setujui layanan')
  const s = await aksi(apr, KS, k1, 'setujui'); status(s, 200, 'setuju-saja memutus layanan'); k1 = item(s)
  const v = item(await ka.call('GET', `${PER}/${p2.id}`)).version
  status(await aksi(op, KS, k1, 'selesai', { terapkan: { status: 'Pensiun', personelVersion: v } }), 403, 'terapkan status tanpa personel.update')
  equal(item(await ka.call('GET', `${PER}/${p2.id}`)).status, 'Aktif', 'status personel tidak berubah setelah ditolak')
  status(await aksi(op, KS, k1, 'proses', { terapkan: { status: 'Pensiun', personelVersion: v } }), 400, 'terapkan pada aksi proses (sesudah cek hak)')
  const sel = await aksi(ka, KS, k1, 'selesai', { terapkan: { status: 'Pensiun', personelVersion: v } })
  status(sel, 200, 'Kasubbag (punya personel.update) selesai + terapkan')
  equal(item(await ka.call('GET', `${PER}/${p2.id}`)).status, 'Pensiun', 'status personel menjadi Pensiun')

  const p3 = item(await ka.call('POST', PER, { nrp: 'SEC-C-003', nama: 'Personel Uji Layanan Lain', jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '' }, true))
  let k2 = item(await ka.call('POST', KS, isiK({ personelId: p3.id, jenis: 'ASABRI' }), true))
  k2 = item(await aksi(op, KS, k2, 'proses'))
  contains(await aksi(ka, KS, k2, 'setujui'), 'self_review_forbidden', 'pencatat yang punya setuju tidak boleh memutus layanan')
  const up = await op.upload(`${KS}/${k2.id}/lampiran`, { filename: 'asabri.pdf', data: PDF }); status(up, 201, 'unggah lampiran layanan')
  const lidK = json(up).id
  status(await ka.call('GET', `${KS}/${k2.id}/lampiran/${lidS}`), 404, 'lampiran cuti via jalur kesejahteraan')
  status(await ka.call('GET', `${C}/${PALSU}/lampiran/${lidK}`), 404, 'lampiran kesejahteraan via jalur cuti (UUID fiktif)')
  status(await ka.call('DELETE', `${KS}/${k1.id}/lampiran/${lidK}`, null, true), 409, 'hapus lampiran via layanan lain yang sudah Selesai ditolak')
  status(await ka.call('GET', `${KS}/${k1.id}/lampiran/${lidK}`), 404, 'lampiran via layanan lain (id silang)')
  status(await op2.call('DELETE', `${KS}/${k2.id}/lampiran/${lidK}`, null, true), 403, 'hapus lampiran layanan milik orang lain tanpa setuju')
  status(await baca.upload(`${KS}/${k2.id}/lampiran`, { filename: 'a.pdf', data: PDF }), 403, 'baca saja unggah layanan')
  status(await op.upload(`${KS}/${k2.id}/lampiran`, { filename: 'a.pdf', data: PDF, csrf: false }), 403, 'unggah layanan tanpa CSRF')

  status(await op.call('POST', KS, { ...isiK({ personelId: p3.id, jenis: 'LAINNYA' }), x: 1 }, true), 400, 'field asing layanan')
  status(await op.call('POST', KS, isiK({ personelId: p3.id, jenis: 'LAINNYA', nomorReferensi: 'KTA‮1' }), true), 400, 'nomor pembalik arah')
  status(await op.call('PATCH', `${KS}/${k2.id}`, { personelId: p2.id, nomorReferensi: '', targetSelesai: '', catatan: '', version: k2.version }, true), 400, 'PATCH personelId layanan')
  for (const qs of ['size=7', 'status=Aktif', 'jenis=BONUS', 'lewatTarget=true', 'personelId=x']) status(await op.call('GET', `${KS}?${qs}`), 400, `query kesejahteraan ${qs}`)
  equal((await op.call('GET', KS)).headers.get('cache-control'), 'no-store', 'no-store kesejahteraan')
}
