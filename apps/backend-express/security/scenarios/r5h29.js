import { createServer } from 'node:http'

import { createApp } from '../../src/app.js'
import { Mailer } from '../../src/auth/mailer.js'
import { contains, equal, status } from '../assert.js'
import { Browser } from '../browser.js'

/**
 * R5H29 — Subbagsumda Diklat & Kompetensi (migrasi 070). EXPRESS SAJA: `x4_`, setelah x3.
 *
 * Yang dibuktikan: guard (anonim 401, Superadmin 403 termasuk workspace demo; UUID fiktif 403) · matriks
 * baca saja / kelola tanpa arsip · pencabutan hak · CSRF/Origin JSON + multipart · lampiran tiga pemilik
 * (bukan PDF, nama berbahaya, > 5 MB, dua berkas, id silang, header unduhan, nama non-ASCII tanpa 503) ·
 * bentuk (field asing, __proto__, Cf, personelIds tidak sah, tanggalSelesai pada status lain) · kunci
 * evidence kosong fail-closed.
 */
const D = '/api/v1/subbagsumda/diklat'
const KP = '/api/v1/subbagsumda/kompetensi'
const PER = '/api/v1/subbagsumda/personel'
const raw = (s) => Buffer.from(s, 'utf8')
const PROTO_ASLI = new Set(Object.getOwnPropertyNames(Object.prototype))
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n', 'latin1')
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

export async function verifyR5H29SumdaDiklat({ env }) {
  const BACA = 'subbagsumda.personel.read'
  const roles = {
    br_r5h29_penuh: [BACA, 'subbagsumda.personel.create', 'subbagsumda.personel.archive', 'subbagsumda.diklat.manage', 'subbagsumda.diklat.archive'],
    br_r5h29_op: [BACA, 'subbagsumda.diklat.manage'],
    br_r5h29_baca: [BACA],
  }
  for (const [role, perms] of Object.entries(roles)) { await env.createRole(role, role); await env.grantPermissions(role, perms) }
  const users = {}
  for (const [name, role, scope] of [['ka_r5h29', 'br_r5h29_penuh', 'unit'], ['op_r5h29', 'br_r5h29_op', 'assigned'], ['op2_r5h29', 'br_r5h29_op', 'assigned'], ['baca_r5h29', 'br_r5h29_baca', 'unit']]) {
    users[name] = await env.createUser(name)
    await env.attachUnit(users[name].id, 'subbagsumda')
    await env.grant(users[name].id, role, 'subbagsumda', scope, { reason: 'Isolated R5H29 grant only' })
  }
  const luar = await env.createUser('luar_r5h29')
  await env.attachUnit(luar.id, 'subbagren')
  await env.grant(luar.id, 'br_r5h29_penuh', 'subbagren', 'unit', { reason: 'Isolated R5H29 grant only' })

  const anon = await env.newBrowser()
  const [ka, op, op2, baca, sLuar] = await Promise.all(['ka_r5h29', 'op_r5h29', 'op2_r5h29', 'baca_r5h29', 'luar_r5h29'].map((u) => env.newSession(u)))
  const sa = await env.loginSuperadmin()
  const item = (r) => JSON.parse(r.text).item

  const per = item(await ka.call('POST', PER, { nrp: 'SEC-D-001', nama: 'Personel Uji Diklat', jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '' }, true))
  const isiK = (extra = {}) => ({ nama: 'Pelatihan Uji Keamanan', jenis: 'Pelatihan', penyelenggara: '', lokasi: '', nomorSurat: '', tanggalMulai: '2026-11-01', tanggalSelesai: '', catatan: '', ...extra })
  const isiKo = (extra = {}) => ({ personelId: per.id, nama: 'Sertifikat Uji', kategori: 'Kursus', nomor: '', penerbit: '', tanggalTerbit: '', berlakuSampai: '', catatan: '', ...extra })

  // ---- 1. Guard ----
  for (const path of [D, `${D}/capabilities`, KP, `${KP}/alert`]) status(await anon.call('GET', path), 401, `anonim GET ${path}`)
  for (const [m, path, b] of [['GET', D], ['POST', D, isiK()], ['GET', KP], ['POST', KP, isiKo()], ['POST', `${D}/${PALSU}/status`, { status: 'Berjalan', version: 1 }], ['DELETE', `${KP}/${PALSU}?version=1`]]) {
    status(await sa.call(m, path, b ?? null, m !== 'GET'), 403, `Superadmin ${m} ${path}`)
  }
  const demo = await appLain(env, { demoSuperadminWorkspace: true })
  try {
    const b = await new Browser(demo.base).bootstrap()
    const { challenge, code } = await env.setOTPChallenge(env.users.get('sa_r2d5'))
    status(await b.call('POST', '/api/v1/auth/verify-otp', { challenge, code }, true), 200, 'login Superadmin di app demo')
    status(await b.call('GET', D), 403, 'Superadmin demo GET diklat')
    status(await b.call('POST', KP, isiKo(), true), 403, 'Superadmin demo POST kompetensi')
    status(await b.call('POST', `${D}/${PALSU}/peserta`, { personelIds: [per.id], version: 1 }, true), 403, 'Superadmin demo peserta (UUID fiktif tetap 403)')
    status(await b.upload(`${D}/${PALSU}/lampiran`, { filename: 'a.pdf', data: PDF }), 403, 'Superadmin demo unggah')
    contains(await b.call('GET', `${D}/capabilities`), '"canRead":false,"canManage":false,"canArchive":false', 'Superadmin demo capabilities kosong')
  } finally { await demo.close() }
  contains(await sLuar.call('GET', `${KP}/capabilities`), '"canRead":false,"canManage":false,"canArchive":false', 'grant unit lain capabilities kosong')
  status(await sLuar.call('GET', D), 403, 'grant unit lain GET')

  // ---- 2. Matriks ----
  status(await baca.call('POST', D, isiK(), true), 403, 'baca saja buat kegiatan')
  status(await baca.call('POST', KP, isiKo(), true), 403, 'baca saja buat kompetensi')
  let k = item(await op.call('POST', D, isiK(), true))
  status(await baca.call('POST', `${D}/${k.id}/status`, { status: 'Berjalan', catatan: '', version: k.version }, true), 403, 'baca saja ubah status')
  status(await baca.upload(`${D}/${k.id}/lampiran`, { filename: 'a.pdf', data: PDF }), 403, 'baca saja unggah')
  status(await op.call('DELETE', `${D}/${k.id}?version=${k.version}`, null, true), 403, 'kelola tanpa arsip: arsip kegiatan')
  const ko = item(await op.call('POST', KP, isiKo(), true))
  status(await op.call('DELETE', `${KP}/${ko.id}?version=${ko.version}`, null, true), 403, 'kelola tanpa arsip: arsip kompetensi')

  // ---- 3. CSRF / Origin ----
  status(await op.call('POST', D, isiK(), false), 403, 'buat kegiatan tanpa CSRF')
  status(await op.call('POST', D, isiK(), true, { origin: 'https://evil.example' }), 403, 'buat kegiatan Origin asing')
  status(await op.call('PATCH', `${D}/${k.id}`, { ...isiK(), version: k.version }, false), 403, 'PATCH tanpa CSRF')
  status(await op.call('POST', `${D}/${k.id}/peserta`, { personelIds: [per.id], version: k.version }, true, { origin: 'https://evil.example' }), 403, 'peserta Origin asing')
  status(await op.upload(`${D}/${k.id}/lampiran`, { filename: 'a.pdf', data: PDF, csrf: false }), 403, 'unggah tanpa CSRF')
  status(await op.call('PATCH', `${KP}/${ko.id}`, { ...isiKo(), personelId: undefined, version: ko.version }, false), 403, 'PATCH kompetensi tanpa CSRF')

  // ---- 4. Lampiran ----
  const up = await op.upload(`${D}/${k.id}/lampiran`, { filename: 'sprin.pdf', data: PDF }); status(up, 201, 'unggah lampiran kegiatan')
  const lid = JSON.parse(up.text).id
  status(await op.upload(`${D}/${k.id}/lampiran`, { filename: 'a.pdf', data: raw('bukan pdf') }), 400, 'bukan PDF')
  for (const nama of ['<script>.pdf', 'a.exe', 'a.pdf.html']) status(await op.upload(`${D}/${k.id}/lampiran`, { filename: nama, data: PDF }), 400, `nama ${nama}`)
  const besar = Buffer.concat([PDF.subarray(0, 9), Buffer.alloc(5 * 1024 * 1024 + 10, 0x20), raw('\n%%EOF\n')])
  status(await op.upload(`${D}/${k.id}/lampiran`, { filename: 'b.pdf', data: besar }), 413, 'lampiran > 5 MB')
  for (const nama of ['Surat ğ 文件.pdf']) {
    const u = await op.upload(`${D}/${k.id}/lampiran`, { filename: nama, data: PDF })
    if (u.status === 201) status(await op.call('GET', `${D}/${k.id}/lampiran/${JSON.parse(u.text).id}`), 200, `unduh ${nama}`)
    else status(u, 400, `unggah ${nama} ditolak rapi`)
  }
  const k2 = item(await op.call('POST', D, isiK({ nama: 'Pelatihan Lain' }), true))
  status(await op.call('GET', `${D}/${k2.id}/lampiran/${lid}`), 404, 'unduh lampiran via kegiatan lain')
  status(await op.call('DELETE', `${D}/${k2.id}/lampiran/${lid}`, null, true), 404, 'hapus lampiran via kegiatan lain')
  status(await op.call('GET', `${KP}/${ko.id}/lampiran/${lid}`), 404, 'unduh lampiran kegiatan via kompetensi')
  status(await op2.call('DELETE', `${D}/${k.id}/lampiran/${lid}`, null, true), 403, 'hapus lampiran milik orang lain tanpa arsip')
  const dl = await baca.call('GET', `${D}/${k.id}/lampiran/${lid}`)
  status(dl, 200, 'baca saja unduh'); equal(dl.body.equals(PDF), true, 'unduhan byte-identik')
  for (const [h, want] of [['x-content-type-options', 'nosniff'], ['content-security-policy', 'sandbox'], ['cache-control', 'no-store']]) equal(dl.headers.get(h), want, `header ${h}`)

  // ---- 4b. Review R5H29: PDF terenkripsi/rusak, rantai silang tiga pemilik, personel terarsip (K16) ----
  const PDF_ENC = Buffer.from('%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n' +
    '3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>> endobj\n4 0 obj <</Filter/Standard/V 1/R 2/O(x)/U(y)/P -4>> endobj\n' +
    'trailer <</Root 1 0 R/Encrypt 4 0 R>>\n%%EOF\n', 'latin1')
  for (const [label, data] of [['PDF terenkripsi', PDF_ENC], ['PDF sampah ber-%%EOF', raw('%PDF-1.4\nsampah\n%%EOF\n')]]) {
    const r = await op.upload(`${D}/${k.id}/lampiran`, { filename: 'x.pdf', data })
    status(r, 400, label); contains(r, 'invalid_file_type', `${label} kode`)
  }
  const per2 = item(await ka.call('POST', PER, { nrp: 'SEC-D-002', nama: 'Personel Uji Arsip', jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '' }, true))
  let k3 = item(await op.call('POST', D, isiK({ nama: 'Pelatihan Rantai', tanggalSelesai: '2026-11-05' }), true))
  k3 = item(await op.call('POST', `${D}/${k3.id}/peserta`, { personelIds: [per2.id], version: k3.version }, true))
  k3 = item(await op.call('POST', `${D}/${k3.id}/status`, { status: 'Berjalan', catatan: '', version: k3.version }, true))
  k3 = item(await op.call('POST', `${D}/${k3.id}/status`, { status: 'Selesai', catatan: '', version: k3.version }, true))
  equal(k3.status, 'Selesai', 'kegiatan rantai Selesai')
  const pid = JSON.parse((await op.call('GET', `${D}/${k3.id}`)).text).peserta[0].id
  const upP = await op.upload(`${D}/${k3.id}/peserta/${pid}/lampiran`, { filename: 'sert.pdf', data: PDF }); status(upP, 201, 'unggah sertifikat peserta')
  const plid = JSON.parse(upP.text).id
  const ko2 = item(await op.call('POST', KP, isiKo({ personelId: per2.id, nama: 'Sertifikat Arsip' }), true))
  const upK = await op.upload(`${KP}/${ko2.id}/lampiran`, { filename: 'k.pdf', data: PDF }); status(upK, 201, 'unggah lampiran kompetensi')
  const klid = JSON.parse(upK.text).id
  for (const [label, m, path] of [
    ['lampiran peserta via kegiatan lain', 'GET', `${D}/${k.id}/peserta/${pid}/lampiran/${plid}`],
    ['lampiran kegiatan via jalur peserta', 'GET', `${D}/${k3.id}/peserta/${pid}/lampiran/${lid}`],
    ['lampiran peserta via jalur kegiatan', 'GET', `${D}/${k3.id}/lampiran/${plid}`],
    ['lampiran kompetensi via kompetensi lain', 'GET', `${KP}/${ko.id}/lampiran/${klid}`],
    ['hapus lampiran kompetensi via kompetensi lain', 'DELETE', `${KP}/${ko.id}/lampiran/${klid}`],
    ['lampiran kompetensi via jalur peserta', 'GET', `${D}/${k3.id}/peserta/${pid}/lampiran/${klid}`],
  ]) status(await ka.call(m, path, null, m !== 'GET'), 404, label)
  // Kegiatan lain belum Selesai: pemeriksaan status kegiatan (409) jalan sebelum rantai peserta; yang penting tidak terhapus.
  const hapusSilang = await ka.call('DELETE', `${D}/${k.id}/peserta/${pid}/lampiran/${plid}`, null, true)
  equal([404, 409].includes(hapusSilang.status), true, `hapus lampiran peserta via kegiatan lain ditolak (HTTP ${hapusSilang.status})`)
  status(await ka.call('GET', `${D}/${k3.id}/peserta/${pid}/lampiran/${plid}`), 200, 'lampiran peserta masih ada setelah hapus silang')
  let k4 = item(await op.call('POST', D, isiK({ nama: 'Pelatihan Terarsip' }), true))
  k4 = item(await op.call('POST', `${D}/${k4.id}/peserta`, { personelIds: [per2.id], version: k4.version }, true))
  const ps4 = JSON.parse((await op.call('GET', `${D}/${k4.id}`)).text).peserta[0]
  const per2Kini = item(await ka.call('GET', `${PER}/${per2.id}`))
  status(await ka.call('DELETE', `${PER}/${per2.id}?version=${per2Kini.version}`, null, true), 204, 'arsipkan personel peserta')
  const keluar = await op.call('DELETE', `${D}/${k4.id}/peserta/${ps4.id}?version=${ps4.version}`, null, true)
  status(keluar, 409, 'keluarkan peserta terarsip'); contains(keluar, 'personel_terarsip', 'kode keluarkan peserta terarsip')
  const ko2Kini = JSON.parse((await ka.call('GET', `${KP}/${ko2.id}`)).text).item
  const arsipKo = await ka.call('DELETE', `${KP}/${ko2.id}?version=${ko2Kini.version}`, null, true)
  status(arsipKo, 409, 'arsip kompetensi personel terarsip'); contains(arsipKo, 'personel_terarsip', 'kode arsip kompetensi terarsip')
  status(await baca.call('GET', `${D}/${k3.id}/peserta/${pid}/lampiran/${plid}`), 200, 'unduh sertifikat personel terarsip tetap boleh')

  // ---- 5. Bentuk ----
  status(await op.call('POST', D, { ...isiK(), x: 1 }, true), 400, 'field asing kegiatan')
  status(await op.call('POST', D, raw('{"__proto__":{"polluted":1},"nama":"Proto Uji"}'), true), 400, 'kunci __proto__')
  status(await op.call('POST', D, isiK({ nama: 'Pela​tihan' }), true), 400, 'nama zero-width')
  status(await op.call('POST', KP, isiKo({ nomor: 'SK‮1' }), true), 400, 'nomor pembalik arah')
  k = JSON.parse((await op.call('GET', `${D}/${k.id}`)).text).item
  for (const [label, ids] of [['bukan array', 'x'], ['kosong', []], ['bukan UUID', ['x']], ['ganda', [per.id, per.id]], ['> 50', Array.from({ length: 51 }, () => crypto.randomUUID())]]) {
    status(await op.call('POST', `${D}/${k.id}/peserta`, { personelIds: ids, version: k.version }, true), 400, `personelIds ${label}`)
  }
  status(await op.call('POST', `${D}/${k.id}/status`, { status: 'Berjalan', catatan: '', version: k.version, tanggalSelesai: '2026-12-01' }, true), 400, 'tanggalSelesai pada status Berjalan')
  status(await op.call('POST', KP, isiKo({ dariPesertaId: 'x' }), true), 400, 'dariPesertaId bukan UUID')
  status(await op.call('POST', D, { ...isiK(), catatan: 'x'.repeat(33000) }, true), 400, 'body JSON > 32 KB')
  for (const qs of ['size=7', 'page=0', 'status=Aktif', 'tahun=1999', 'q=a&q=b']) status(await op.call('GET', `${D}?${qs}`), 400, `query diklat ${qs}`)
  for (const qs of ['tahap=H-90', 'personelId=x', 'kategori=X']) status(await op.call('GET', `${KP}?${qs}`), 400, `query kompetensi ${qs}`)
  equal(Object.getOwnPropertyNames(Object.prototype).filter((x) => !PROTO_ASLI.has(x)).join(','), '', 'prototipe Object tidak tercemar')
  for (const path of [D, `${D}/${k.id}`, KP, `${KP}/alert`]) equal((await op.call('GET', path)).headers.get('cache-control'), 'no-store', `no-store ${path}`)

  // ---- 6. Pencabutan ----
  const opId = users.op_r5h29.id
  await env.pool.query("UPDATE sdl_access_grants SET granted_at=now()-interval '2 hours', expires_at=now()-interval '1 minute' WHERE user_id=$1", [opId])
  try { status(await op.call('GET', D), 403, 'grant kedaluwarsa') } finally { await env.pool.query('UPDATE sdl_access_grants SET expires_at=NULL WHERE user_id=$1', [opId]) }
  await env.pool.query("UPDATE sdl_roles SET is_active=FALSE WHERE role_key='br_r5h29_op'")
  try { status(await op.call('GET', KP), 403, 'role nonaktif') } finally { await env.pool.query("UPDATE sdl_roles SET is_active=TRUE WHERE role_key='br_r5h29_op'") }
  await env.pool.query('UPDATE sdl_users SET must_change_password=TRUE WHERE id=$1', [opId])
  try { status(await op.call('POST', D, isiK(), true), 403, 'must_change_password POST') } finally { await env.pool.query('UPDATE sdl_users SET must_change_password=FALSE WHERE id=$1', [opId]) }
  status(await op.call('GET', D), 200, 'operator pulih')

  // ---- 7. Kunci evidence kosong: fail-closed ----
  const tanpaKunci = await appLain(env, { evidenceKey: null })
  try {
    const b = await new Browser(tanpaKunci.base).bootstrap()
    await b.login('op_r5h29', 200)
    const sebelum = Number((await env.pool.query('SELECT count(*) FROM sdl_sumda_diklat_lampiran')).rows[0].count)
    const r = await b.upload(`${D}/${k.id}/lampiran`, { filename: 'c.pdf', data: PDF })
    status(r, 503, 'unggah tanpa kunci evidence'); contains(r, 'evidence_encryption_unavailable', 'kode enkripsi tidak tersedia')
    equal(Number((await env.pool.query('SELECT count(*) FROM sdl_sumda_diklat_lampiran')).rows[0].count), sebelum, 'tidak ada lampiran tersimpan')
    status(await b.call('GET', `${D}/${k.id}/lampiran/${lid}`), 503, 'unduh tanpa kunci evidence')
  } finally { await tanpaKunci.close() }

  await env.revokeGrants(opId, 'br_r5h29_op')
  status(await op.call('GET', D), 403, 'grant dicabut')
}
