import { createServer } from 'node:http'

import { createApp } from '../../src/app.js'
import { Mailer } from '../../src/auth/mailer.js'
import { contains, equal, status } from '../assert.js'
import { Browser } from '../browser.js'

/**
 * R5H28 — Subbagsumda Karier & Mutasi (migrasi 069). EXPRESS SAJA: `x3_`, setelah x2.
 *
 * Yang dibuktikan (harness golden tidak merekam endpoint ini):
 *   - guard: anonim 401; Superadmin 403 di semua metode, TERMASUK app kedua dengan workspace demo
 *     menyala; UUID fiktif 403 (izin diperiksa sebelum baris dicari);
 *   - matriks permission: baca saja; tanpa approve; pencatat yang punya approve tidak bisa memutus
 *     (self_review_forbidden); approver-saja tidak bisa memproses/menyelesaikan; Selesai butuh
 *     personel.update;
 *   - pencabutan: kedaluwarsa, role nonaktif, must_change_password, grant dicabut;
 *   - CSRF/Origin untuk JSON dan multipart;
 *   - lampiran: bukan PDF, nama berbahaya, path traversal, > 5 MB, dua berkas, id silang, header unduhan;
 *   - bentuk: field asing, __proto__, Cf, terapkan pada aksi lain;
 *   - kunci evidence kosong → unggah 503 tanpa plaintext tersimpan (fail-closed).
 */
const K = '/api/v1/subbagsumda/karier'
const PER = '/api/v1/subbagsumda/personel'
const raw = (s) => Buffer.from(s, 'utf8')
const PROTO_ASLI = new Set(Object.getOwnPropertyNames(Object.prototype))
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n', 'latin1')
const PALSU = '00000000-0000-4000-8000-000000000000'

async function appLain(env, configLain) {
  const server = createServer(createApp({
    pool: env.pool,
    config: { ...env.config, ...configLain },
    mailer: new Mailer({ host: '', port: 587, username: '', password: '', from: '' }),
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

export async function verifyR5H28SumdaKarier({ env }) {
  const BACA = 'subbagsumda.personel.read'
  const roles = {
    br_r5h28_penuh: [BACA, 'subbagsumda.personel.create', 'subbagsumda.personel.update', 'subbagsumda.personel.archive', 'subbagsumda.karier.manage', 'subbagsumda.karier.approve'],
    br_r5h28_op: [BACA, 'subbagsumda.personel.update', 'subbagsumda.karier.manage'],
    br_r5h28_optanpaupd: [BACA, 'subbagsumda.karier.manage'],
    br_r5h28_baca: [BACA],
    br_r5h28_approver: [BACA, 'subbagsumda.karier.approve'],
  }
  for (const [role, perms] of Object.entries(roles)) {
    await env.createRole(role, role)
    await env.grantPermissions(role, perms)
  }
  const users = {}
  for (const [name, role, scope] of [
    ['ka_r5h28', 'br_r5h28_penuh', 'unit'], ['op_r5h28', 'br_r5h28_op', 'assigned'],
    ['opx_r5h28', 'br_r5h28_optanpaupd', 'assigned'], ['baca_r5h28', 'br_r5h28_baca', 'unit'],
    ['appr_r5h28', 'br_r5h28_approver', 'unit'],
  ]) {
    users[name] = await env.createUser(name)
    await env.attachUnit(users[name].id, 'subbagsumda')
    await env.grant(users[name].id, role, 'subbagsumda', scope, { reason: 'Isolated R5H28 grant only' })
  }
  const luar = await env.createUser('luar_r5h28')
  await env.attachUnit(luar.id, 'subbagren')
  await env.grant(luar.id, 'br_r5h28_penuh', 'subbagren', 'unit', { reason: 'Isolated R5H28 grant only' })

  const anon = await env.newBrowser()
  const [ka, op, opx, baca, appr, sLuar] = await Promise.all(
    ['ka_r5h28', 'op_r5h28', 'opx_r5h28', 'baca_r5h28', 'appr_r5h28', 'luar_r5h28'].map((u) => env.newSession(u)))
  const sa = await env.loginSuperadmin()

  const per = await ka.call('POST', PER, { nrp: 'SEC-K-001', nama: 'Personel Uji Karier', jenis: 'Polri', pangkat: '', jabatan: 'Staf', unitKerja: 'Unit', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '' }, true)
  status(per, 201, 'Kasubbag buat personel uji')
  const pid = JSON.parse(per.text).item.id
  const isi = (jenis = 'KGB', extra = {}) => ({ personelId: pid, jenis, nomorReferensi: '', tanggalUsulan: '2026-11-01', tanggalEfektif: '', usulan: {}, catatan: '', ...extra })
  const aksi = (b, item, act, extra = {}) => b.call('POST', `${K}/${item.id}/aksi`, { aksi: act, catatan: '', version: item.version, ...extra }, true)
  const item = (r) => JSON.parse(r.text).item

  // ---- 1. Guard ----
  for (const path of [K, `${K}/capabilities`, `${K}/${PALSU}`]) status(await anon.call('GET', path), 401, `anonim GET ${path}`)
  status(await anon.call('POST', K, isi(), true), 401, 'anonim POST')
  for (const [m, path, body] of [['GET', K], ['POST', K, isi()], ['PATCH', `${K}/${PALSU}`, { version: 1 }], ['POST', `${K}/${PALSU}/aksi`, { aksi: 'proses', version: 1 }], ['GET', `${K}/${PALSU}/lampiran/${PALSU}`], ['DELETE', `${K}/${PALSU}/lampiran/${PALSU}`]]) {
    status(await sa.call(m, path, body ?? null, m !== 'GET'), 403, `Superadmin ${m} ${path}`)
  }
  const demo = await appLain(env, { demoSuperadminWorkspace: true })
  try {
    const b = await new Browser(demo.base).bootstrap()
    const { challenge, code } = await env.setOTPChallenge(env.users.get('sa_r2d5'))
    status(await b.call('POST', '/api/v1/auth/verify-otp', { challenge, code }, true), 200, 'login Superadmin di app demo')
    status(await b.call('GET', K), 403, 'Superadmin demo GET')
    status(await b.call('POST', K, isi(), true), 403, 'Superadmin demo POST')
    status(await b.call('POST', `${K}/${PALSU}/aksi`, { aksi: 'setujui', version: 1 }, true), 403, 'Superadmin demo aksi (UUID fiktif tetap 403)')
    status(await b.upload(`${K}/${PALSU}/lampiran`, { filename: 'a.pdf', data: PDF }), 403, 'Superadmin demo unggah')
    contains(await b.call('GET', `${K}/capabilities`), '"canRead":false,"canManage":false,"canApprove":false', 'Superadmin demo capabilities kosong')
  } finally { await demo.close() }
  contains(await sLuar.call('GET', `${K}/capabilities`), '"canRead":false,"canManage":false,"canApprove":false', 'grant unit lain capabilities kosong')
  status(await sLuar.call('GET', K), 403, 'grant unit lain GET')
  status(await sLuar.call('POST', K, isi(), true), 403, 'grant unit lain POST')

  // ---- 2. Matriks ----
  status(await baca.call('POST', K, isi(), true), 403, 'baca saja POST')
  const r1 = await op.call('POST', K, isi(), true); status(r1, 201, 'operator buat KGB')
  let k1 = item(r1)
  status(await baca.call('POST', `${K}/${k1.id}/aksi`, { aksi: 'proses', catatan: '', version: k1.version }, true), 403, 'baca saja aksi')
  status(await baca.upload(`${K}/${k1.id}/lampiran`, { filename: 'a.pdf', data: PDF }), 403, 'baca saja unggah')
  status(await appr.call('POST', `${K}/${k1.id}/aksi`, { aksi: 'proses', catatan: '', version: k1.version }, true), 403, 'approver-saja proses')
  k1 = item(await aksi(op, k1, 'proses'))
  status(await op.call('POST', `${K}/${k1.id}/aksi`, { aksi: 'setujui', catatan: '', version: k1.version }, true), 403, 'operator tanpa approve setujui')
  const r2 = await ka.call('POST', K, isi('MUTASI', { usulan: { unitKerja: 'Unit Baru' } }), true); status(r2, 201, 'Kasubbag buat MUTASI')
  let k2 = item(await aksi(op, item(r2), 'proses'))
  const self = await aksi(ka, k2, 'setujui')
  status(self, 403, 'pencatat dengan approve menyetujui sendiri'); contains(self, 'self_review_forbidden', 'kode self_review')
  k2 = item(await aksi(appr, k2, 'setujui')); equal(k2.status, 'Disetujui', 'approver lain menyetujui')
  status(await appr.call('POST', `${K}/${k2.id}/aksi`, { aksi: 'selesai', catatan: '', version: k2.version, tanggalEfektif: '2026-12-01', terapkan: { unitKerja: 'Unit Baru', personelVersion: 1 } }, true), 403, 'approver-saja selesai')
  status(await opx.call('POST', `${K}/${k2.id}/aksi`, { aksi: 'selesai', catatan: '', version: k2.version, tanggalEfektif: '2026-12-01', terapkan: { unitKerja: 'Unit Baru', personelVersion: 1 } }, true), 403, 'selesai tanpa personel.update')

  // ---- 3. CSRF / Origin ----
  const r3 = await op.call('POST', K, isi('PENYESUAIAN_JABATAN', { usulan: { jabatan: 'Kaur' } }), true)
  const k3 = item(r3)
  status(await op.call('POST', K, isi('UKP'), false), 403, 'POST tanpa CSRF')
  status(await op.call('POST', K, isi('UKP'), true, { origin: 'https://evil.example' }), 403, 'POST Origin asing')
  status(await op.call('PATCH', `${K}/${k3.id}`, { nomorReferensi: '', tanggalUsulan: '2026-11-01', tanggalEfektif: '', usulan: { jabatan: 'X' }, catatan: '', version: k3.version }, false), 403, 'PATCH tanpa CSRF')
  status(await op.call('POST', `${K}/${k3.id}/aksi`, { aksi: 'proses', catatan: '', version: k3.version }, false), 403, 'aksi tanpa CSRF')
  status(await op.call('POST', `${K}/${k3.id}/aksi`, { aksi: 'proses', catatan: '', version: k3.version }, true, { origin: 'https://evil.example' }), 403, 'aksi Origin asing')
  status(await op.upload(`${K}/${k3.id}/lampiran`, { filename: 'a.pdf', data: PDF, csrf: false }), 403, 'unggah tanpa CSRF')
  const up = await op.upload(`${K}/${k3.id}/lampiran`, { filename: 'sk.pdf', data: PDF })
  status(up, 201, 'unggah PDF sah')
  const lid = JSON.parse(up.text).id
  status(await op.call('DELETE', `${K}/${k3.id}/lampiran/${lid}`, null, false), 403, 'hapus lampiran tanpa CSRF')

  // ---- 4. Lampiran ----
  status(await op.upload(`${K}/${k3.id}/lampiran`, { filename: 'a.pdf', data: raw('bukan pdf') }), 400, 'bukan PDF')
  for (const nama of ['<script>.pdf', 'a.exe', 'a.pdf.html']) status(await op.upload(`${K}/${k3.id}/lampiran`, { filename: nama, data: PDF }), 400, `nama ${nama}`)
  const trav = await op.upload(`${K}/${k3.id}/lampiran`, { filename: '../../x.pdf', data: PDF })
  if (trav.status === 201) {
    const nama = (await env.pool.query('SELECT filename FROM sdl_sumda_karier_lampiran WHERE id=$1::uuid', [JSON.parse(trav.text).id])).rows[0].filename
    equal(/[/\\]|\.\./.test(nama), false, 'path traversal: tersimpan tanpa / atau ..')
  } else status(trav, 400, 'path traversal ditolak')
  const besar = Buffer.concat([PDF.subarray(0, 9), Buffer.alloc(5 * 1024 * 1024 + 10, 0x20), raw('\n%%EOF\n')])
  status(await op.upload(`${K}/${k3.id}/lampiran`, { filename: 'b.pdf', data: besar }), 413, 'lampiran > 5 MB')
  status(await op.call('GET', `${K}/${k1.id}/lampiran/${lid}`), 404, 'unduh lampiran via id pengajuan lain')
  status(await op.call('DELETE', `${K}/${k1.id}/lampiran/${lid}`, null, true), 404, 'hapus lampiran via id pengajuan lain')
  const dl = await baca.call('GET', `${K}/${k3.id}/lampiran/${lid}`)
  status(dl, 200, 'baca saja unduh')
  equal(dl.body.equals(PDF), true, 'unduhan byte-identik')
  for (const [h, want] of [['x-content-type-options', 'nosniff'], ['content-security-policy', 'sandbox'], ['cache-control', 'no-store']]) equal(dl.headers.get(h), want, `header ${h}`)
  equal(/^attachment/.test(dl.headers.get('content-disposition') ?? ''), true, 'Content-Disposition attachment')

  // ---- 5. Bentuk ----
  status(await op.call('POST', K, { ...isi(), x: 1 }, true), 400, 'field asing')
  status(await op.call('POST', K, raw(`{"__proto__":{"polluted":1},"personelId":"${pid}"}`), true), 400, 'kunci __proto__')
  status(await op.call('POST', K, isi('KGB', { nomorReferensi: 'SK​1' }), true), 400, 'nomor referensi zero-width')
  status(await op.call('POST', K, isi('PENYESUAIAN_JABATAN', { usulan: { jabatan: 'Ka‮ur' } }), true), 400, 'jabatan pembalik arah')
  status(await op.call('POST', `${K}/${k3.id}/aksi`, { aksi: 'proses', catatan: '', version: k3.version, terapkan: {} }, true), 400, 'terapkan pada aksi proses')
  status(await op.call('POST', `${K}/${k3.id}/aksi`, raw(`{"aksi":"proses","version":${k3.version},"__proto__":{}}`), true), 400, 'aksi berkunci __proto__')
  status(await op.call('POST', K, { ...isi(), catatan: 'x'.repeat(33000) }, true), 400, 'body JSON > 32 KB')
  for (const qs of ['size=7', 'page=0', 'status=Aktif', 'jenis=X', 'personelId=x', 'q=a&q=b']) status(await op.call('GET', `${K}?${qs}`), 400, `query ${qs}`)
  equal(Object.getOwnPropertyNames(Object.prototype).filter((k) => !PROTO_ASLI.has(k)).join(','), '', 'prototipe Object tidak tercemar')
  for (const path of [K, `${K}/${k3.id}`, `${K}/capabilities`]) equal((await op.call('GET', path)).headers.get('cache-control'), 'no-store', `no-store ${path}`)

  // ---- 5b. Perbaikan review R5H28 ----
  // Tiap kasus memakai personel sendiri supaya tidak bentrok dengan K11 (satu pengajuan terbuka per jenis).
  let urut = 0
  const perBaru = async () => {
    urut += 1
    const r = await ka.call('POST', PER, { nrp: `SEC-K-1${String(urut).padStart(2, '0')}`, nama: `Personel Uji Review ${urut}`, jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '' }, true)
    status(r, 201, `buat personel uji review ${urut}`)
    return JSON.parse(r.text).item
  }
  const ambil = async (id) => JSON.parse((await op.call('GET', `${K}/${id}`)).text).item

  // K19 lewat PATCH: Kasubbag menyunting pengajuan operator, lalu tidak boleh memutusnya.
  const pA = await perBaru()
  const a0 = item(await op.call('POST', K, isi('MUTASI', { personelId: pA.id, usulan: { unitKerja: 'Unit A' } }), true))
  const a1 = item(await ka.call('PATCH', `${K}/${a0.id}`, { nomorReferensi: 'EDIT', tanggalUsulan: '2026-11-01', tanggalEfektif: '', usulan: { unitKerja: 'Unit B' }, catatan: '', version: a0.version }, true))
  const a2 = item(await aksi(op, a1, 'proses'))
  const sA = await aksi(ka, a2, 'setujui'); status(sA, 403, 'K19: pengubah via PATCH menyetujui'); contains(sA, 'self_review_forbidden', 'kode K19 PATCH')
  equal((await ambil(a0.id)).status, 'Diproses', 'status tetap Diproses setelah K19 ditolak')

  // W1: approver mengganti lampiran operator lalu menyetujui → harus ditolak.
  const pB = await perBaru()
  const b0 = item(await op.call('POST', K, isi('MUTASI', { personelId: pB.id, usulan: { unitKerja: 'Unit W1' } }), true))
  const lB = JSON.parse((await op.upload(`${K}/${b0.id}/lampiran`, { filename: 'bukti.pdf', data: PDF })).text).id
  await aksi(op, await ambil(b0.id), 'proses')
  status(await ka.call('DELETE', `${K}/${b0.id}/lampiran/${lB}`, null, true), 200, 'approver menghapus lampiran operator')
  status(await ka.upload(`${K}/${b0.id}/lampiran`, { filename: 'pengganti.pdf', data: PDF }), 201, 'approver mengunggah lampiran pengganti')
  const sB = await aksi(ka, await ambil(b0.id), 'setujui'); status(sB, 403, 'W1: pengubah lampiran menyetujui'); contains(sB, 'self_review_forbidden', 'kode W1')
  const bOk = item(await aksi(appr, await ambil(b0.id), 'setujui')); equal(bOk.status, 'Disetujui', 'approver lain tetap bisa menyetujui')

  // terapkan strict pada selesai (bOk: MUTASI Disetujui).
  const pvB = JSON.parse((await op.call('GET', `${PER}/${pB.id}`)).text).item.version
  const selesai = (t) => op.call('POST', `${K}/${b0.id}/aksi`, raw(`{"aksi":"selesai","catatan":"","version":${bOk.version},"tanggalEfektif":"2026-12-01","terapkan":${t}}`), true)
  for (const [label, t] of [
    ['terapkan __proto__', `{"__proto__":{"x":1},"unitKerja":"U","personelVersion":${pvB}}`],
    ['terapkan kunci asing (pangkat pada MUTASI)', `{"pangkat":"X","unitKerja":"U","personelVersion":${pvB}}`],
    ['terapkan nilai angka', `{"unitKerja":123,"personelVersion":${pvB}}`],
    ['terapkan nilai objek', `{"unitKerja":{"a":1},"personelVersion":${pvB}}`],
    ['personelVersion string', '{"unitKerja":"U","personelVersion":"1"}'],
    ['personelVersion pecahan', '{"unitKerja":"U","personelVersion":1.5}'],
    ['terapkan array', '[1,2]'],
  ]) status(await selesai(t), 400, label)
  equal(Object.getOwnPropertyNames(Object.prototype).filter((k) => !PROTO_ASLI.has(k)).join(','), '', 'prototipe bersih setelah probe terapkan')
  equal((await ambil(b0.id)).status, 'Disetujui', 'probe terapkan tidak mengubah status')
  // Koreksi saat selesai ditandai (review S4).
  const dB = item(await selesai(`{"unitKerja":"Unit W1 Dikoreksi","personelVersion":${pvB}}`))
  equal(JSON.stringify(dB.diterapkan.dikoreksi), '["unitKerja"]', 'diterapkan.dikoreksi saat nilai berbeda dari usulan')

  // KGB tidak menerima terapkan.
  const pC = await perBaru()
  const c0 = item(await op.call('POST', K, isi('KGB', { personelId: pC.id }), true))
  await aksi(op, c0, 'proses')
  const c2 = item(await aksi(appr, await ambil(c0.id), 'setujui'))
  status(await op.call('POST', `${K}/${c0.id}/aksi`, { aksi: 'selesai', catatan: '', version: c2.version, tanggalEfektif: '2026-12-01', terapkan: { personelVersion: 1 } }, true), 400, 'KGB dengan terapkan')

  // K26 untuk lampiran (review S2): personel terarsip → unggah, hapus, proses 409.
  const pD = await perBaru()
  const d0 = item(await op.call('POST', K, isi('KGB', { personelId: pD.id }), true))
  const lD = JSON.parse((await op.upload(`${K}/${d0.id}/lampiran`, { filename: 'a.pdf', data: PDF })).text).id
  status(await ka.call('DELETE', `${PER}/${pD.id}?version=${pD.version}`, null, true), 204, 'arsipkan personel uji')
  const uD = await op.upload(`${K}/${d0.id}/lampiran`, { filename: 'b.pdf', data: PDF }); status(uD, 409, 'unggah untuk personel terarsip'); contains(uD, 'personel_terarsip', 'kode terarsip unggah')
  status(await op.call('DELETE', `${K}/${d0.id}/lampiran/${lD}`, null, true), 409, 'hapus lampiran untuk personel terarsip')
  status(await aksi(op, await ambil(d0.id), 'proses'), 409, 'proses untuk personel terarsip')

  // Review S1: nama berkas non-ASCII tidak boleh berujung 503. busboy membaca nama multipart sebagai
  // Latin-1, jadi nama UTF-8 biasanya tertolak di validasi nama (400); bila lolos, unduhan wajib 200.
  const pE = await perBaru()
  const e0 = item(await op.call('POST', K, isi('KGB', { personelId: pE.id }), true))
  for (const nama of ['Surat ğ 文件.pdf', 'Laporan é.pdf']) {
    const uE = await op.upload(`${K}/${e0.id}/lampiran`, { filename: nama, data: PDF })
    if (uE.status === 201) status(await op.call('GET', `${K}/${e0.id}/lampiran/${JSON.parse(uE.text).id}`), 200, `unduh ${nama}`)
    else status(uE, 400, `unggah ${nama} ditolak rapi`)
  }

  // ---- 6. Pencabutan ----
  const opId = users.op_r5h28.id
  await env.pool.query("UPDATE sdl_access_grants SET granted_at=now()-interval '2 hours', expires_at=now()-interval '1 minute' WHERE user_id=$1", [opId])
  try { status(await op.call('GET', K), 403, 'grant kedaluwarsa') } finally { await env.pool.query('UPDATE sdl_access_grants SET expires_at=NULL WHERE user_id=$1', [opId]) }
  await env.pool.query("UPDATE sdl_roles SET is_active=FALSE WHERE role_key='br_r5h28_op'")
  try { status(await op.call('GET', K), 403, 'role nonaktif') } finally { await env.pool.query("UPDATE sdl_roles SET is_active=TRUE WHERE role_key='br_r5h28_op'") }
  await env.pool.query('UPDATE sdl_users SET must_change_password=TRUE WHERE id=$1', [opId])
  try { status(await op.call('POST', K, isi('UKP'), true), 403, 'must_change_password POST') } finally { await env.pool.query('UPDATE sdl_users SET must_change_password=FALSE WHERE id=$1', [opId]) }
  status(await op.call('GET', K), 200, 'operator pulih')

  // ---- 7. Kunci evidence kosong: fail-closed ----
  const tanpaKunci = await appLain(env, { evidenceKey: null })
  try {
    const b = await new Browser(tanpaKunci.base).bootstrap()
    await b.login('op_r5h28', 200)
    const sebelum = Number((await env.pool.query('SELECT count(*) FROM sdl_sumda_karier_lampiran')).rows[0].count)
    const r = await b.upload(`${K}/${k3.id}/lampiran`, { filename: 'c.pdf', data: PDF })
    status(r, 503, 'unggah tanpa kunci evidence'); contains(r, 'evidence_encryption_unavailable', 'kode enkripsi tidak tersedia')
    equal(Number((await env.pool.query('SELECT count(*) FROM sdl_sumda_karier_lampiran')).rows[0].count), sebelum, 'tidak ada lampiran tersimpan')
    status(await b.call('GET', `${K}/${k3.id}/lampiran/${lid}`), 503, 'unduh tanpa kunci evidence')
  } finally { await tanpaKunci.close() }

  await env.revokeGrants(opId, 'br_r5h28_op')
  status(await op.call('GET', K), 403, 'grant dicabut')
}
