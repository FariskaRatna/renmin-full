import { createServer } from 'node:http'

import { createApp } from '../../src/app.js'
import { Mailer } from '../../src/auth/mailer.js'
import { contains, equal, status } from '../assert.js'
import { Browser } from '../browser.js'

/**
 * R5H31 — Subbagsumda Kinerja & Pembinaan + Inventaris/BMN (migrasi 072). EXPRESS SAJA: `x6_`, setelah x5.
 *
 * Yang dibuktikan: guard kedua prefix (anonim 401, Superadmin 403 termasuk workspace demo; UUID fiktif 403) ·
 * capabilities unit lain kosong · matriks · K1 PENYAMARAN KINERJA (daftar, detail, filter kategori/lewat tenggat/status,
 * detail personel, lampiran, riwayat) · mutasi oleh bukan-pencatat tanpa kinerja.read → 403 sebelum 409 ·
 * maker-checker "pernah mengubah" (tindak lanjut/lampiran) · aset: pengusul tidak memutus, lampiran sejak usulan ·
 * CSRF/Origin JSON + multipart · id silang antar-modul · bentuk · pencabutan · kunci evidence kosong fail-closed.
 */
const K = '/api/v1/subbagsumda/kinerja'
const A = '/api/v1/subbagsumda/aset'
const C = '/api/v1/subbagsumda/cuti'
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

export async function verifyR5H31SumdaKinerjaAset({ env }) {
  const BACA = 'subbagsumda.personel.read'
  const INV = 'subbagsumda.inventaris.read'
  const roles = {
    br_r5h31_penuh: [BACA, INV, 'subbagsumda.personel.create', 'subbagsumda.personel.archive', 'subbagsumda.kinerja.read',
      'subbagsumda.kinerja.manage', 'subbagsumda.kinerja.approve', 'subbagsumda.aset.manage', 'subbagsumda.aset.approve'],
    br_r5h31_op: [BACA, INV, 'subbagsumda.kinerja.manage', 'subbagsumda.aset.manage'],
    br_r5h31_apr: [BACA, INV, 'subbagsumda.kinerja.read', 'subbagsumda.kinerja.approve', 'subbagsumda.aset.approve'],
    br_r5h31_akbuta: [BACA, 'subbagsumda.kinerja.approve'],
    br_r5h31_baca: [BACA, INV],
  }
  for (const [role, perms] of Object.entries(roles)) { await env.createRole(role, role); await env.grantPermissions(role, perms) }
  // Batas CAPTCHA 60/menit per IP dihitung lintas skenario (suite berjalan < 1 menit). Baris skenario sebelumnya
  // dimundurkan di DB uji sekali pakai (pola core.js) supaya x6 punya jatah login sendiri; batas di kode tidak diubah.
  await env.pool.query("UPDATE sdl_captcha_challenges SET created_at=created_at-interval '2 minutes'")
  const users = {}
  for (const [name, role, scope] of [['ka_r5h31', 'br_r5h31_penuh', 'unit'], ['op_r5h31', 'br_r5h31_op', 'assigned'], ['op2_r5h31', 'br_r5h31_op', 'own'],
    ['apr_r5h31', 'br_r5h31_apr', 'unit'], ['buta_r5h31', 'br_r5h31_akbuta', 'unit'], ['baca_r5h31', 'br_r5h31_baca', 'unit']]) {
    users[name] = await env.createUser(name)
    await env.attachUnit(users[name].id, 'subbagsumda')
    await env.grant(users[name].id, role, 'subbagsumda', scope, { reason: 'Isolated R5H31 grant only' })
  }
  const luar = await env.createUser('luar_r5h31')
  await env.attachUnit(luar.id, 'subbagren')
  await env.grant(luar.id, 'br_r5h31_penuh', 'subbagren', 'unit', { reason: 'Isolated R5H31 grant only' })

  const anon = await env.newBrowser()
  const [ka, op, op2, apr, buta, baca, sLuar] = await Promise.all(['ka_r5h31', 'op_r5h31', 'op2_r5h31', 'apr_r5h31', 'buta_r5h31', 'baca_r5h31', 'luar_r5h31'].map((u) => env.newSession(u)))
  const sa = await env.loginSuperadmin()
  const item = (r) => { const j = JSON.parse(r.text); if (!j.item) throw new Error(`tanpa item: HTTP ${r.status} ${r.text.slice(0, 160)}`); return j.item }
  const json = (r) => JSON.parse(r.text)
  const personel = async (nrp) => item(await ka.call('POST', PER, { nrp, nama: `Personel ${nrp}`, jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '' }, true))
  const per = await personel('SEC-KN-001')
  const isiK = (extra = {}) => ({ personelId: per.id, tahun: 2027, periode: 'TAHUNAN', kategori: 'BAIK', penilai: '', tanggalPenilaian: '', catatan: '', ...extra })
  const aksi = (s, base, it, act, extra = {}) => s.call('POST', `${base}/${it.id}/aksi`, { aksi: act, catatan: '', version: it.version, ...extra }, true)

  // ---- 1. Guard ----
  for (const path of [K, `${K}/capabilities`, A, `${A}/capabilities`, `${A}/jadwal`]) status(await anon.call('GET', path), 401, `anonim GET ${path}`)
  for (const [m, path, b] of [['GET', K], ['POST', K, isiK()], ['POST', `${K}/${PALSU}/aksi`, { aksi: 'ajukan', catatan: '', version: 1 }],
    ['GET', A], ['POST', `${A}/${PALSU}/aksi`, { aksi: 'aktifkan', catatan: '', version: 1 }]]) {
    status(await sa.call(m, path, b ?? null, m !== 'GET'), 403, `Superadmin ${m} ${path}`)
  }
  const demo = await appLain(env, { demoSuperadminWorkspace: true })
  try {
    const b = await new Browser(demo.base).bootstrap()
    const { challenge, code } = await env.setOTPChallenge(env.users.get('sa_r2d5'))
    status(await b.call('POST', '/api/v1/auth/verify-otp', { challenge, code }, true), 200, 'login Superadmin di app demo')
    status(await b.call('GET', K), 403, 'Superadmin demo GET kinerja')
    status(await b.call('POST', K, isiK(), true), 403, 'Superadmin demo POST kinerja')
    status(await b.call('GET', `${K}/${PALSU}/lampiran/${PALSU}`), 403, 'Superadmin demo unduh kinerja')
    status(await b.call('GET', A), 403, 'Superadmin demo GET aset')
    contains(await b.call('GET', `${K}/capabilities`), '"canRead":false,"canReadDetail":false,"canManage":false,"canApprove":false', 'Superadmin demo capabilities kinerja kosong')
    contains(await b.call('GET', `${A}/capabilities`), '"canRead":false,"canManage":false,"canApprove":false', 'Superadmin demo capabilities aset kosong')
  } finally { await demo.close() }
  contains(await sLuar.call('GET', `${K}/capabilities`), '"canRead":false,"canReadDetail":false,"canManage":false,"canApprove":false', 'grant unit lain capabilities kinerja')
  status(await sLuar.call('GET', K), 403, 'grant unit lain GET kinerja')

  // ---- 2. Kinerja: K1 + matriks ----
  status(await baca.call('POST', K, isiK(), true), 403, 'baca saja catat penilaian')
  status(await apr.call('POST', K, isiK(), true), 403, 'setuju-saja catat penilaian')
  let k1 = item(await op.call('POST', K, isiK({ kategori: 'PERLU_PEMBINAAN', catatan: 'Isi rahasia kinerja' }), true))
  k1 = item(await op.call('POST', `${K}/${k1.id}/tindak-lanjut`, { bentuk: 'KONSELING', uraian: 'Konseling rahasia', tenggat: '2020-01-01', version: k1.version }, true))
  const upK = await op.upload(`${K}/${k1.id}/lampiran`, { filename: 'skp.pdf', data: PDF }); status(upK, 201, 'pencatat unggah lampiran kinerja')
  const lidK = json(upK).id
  k1 = item(await op.call('GET', `${K}/${k1.id}`)) // unggah menaikkan versi
  for (const [s, label] of [[op2, 'kelola bukan pencatat'], [baca, 'baca saja'], [buta, 'setuju tanpa kinerja.read']]) {
    const d = await s.call('GET', `${K}/${k1.id}`)
    equal(json(d).item.kategori, null, `${label}: kategori tidak terkirim`)
    equal(json(d).item.status, null, `${label}: status asli tidak terkirim`)
    equal(json(d).tindakLanjut, null, `${label}: tindak lanjut tidak terkirim`)
    equal(/Isi rahasia kinerja|Konseling rahasia|PERLU_PEMBINAAN|skp\.pdf/.test(d.text), false, `${label}: detail tanpa isi`)
    const l = await s.call('GET', `${K}?size=100`)
    equal(/Isi rahasia kinerja|PERLU_PEMBINAAN/.test(l.text), false, `${label}: daftar tanpa isi`)
    for (const qs of ['kategori=PERLU_PEMBINAAN', 'lewatTenggat=1']) equal(json(await s.call('GET', `${K}?size=100&${qs}`)).items.some((x) => x.id === k1.id), false, `${label}: filter ${qs} tidak menemukan`)
    status(await s.call('GET', `${K}/${k1.id}/lampiran/${lidK}`), 403, `${label}: unduh lampiran kinerja`)
    equal(/Isi rahasia kinerja|PERLU_PEMBINAAN/.test((await s.call('GET', `${PER}/${per.id}`)).text), false, `${label}: detail personel tanpa isi`)
  }
  // K34: bukan pencatat tanpa kinerja.read → 403 (bukan 409 yang membocorkan kategori).
  status(await op2.call('POST', `${K}/${k1.id}/tindak-lanjut`, { bentuk: 'KONSELING', uraian: 'Coba tambah', tenggat: '2027-01-01', version: k1.version }, true), 403, 'bukan pencatat tambah tindak lanjut')
  status(await op2.call('PATCH', `${K}/${k1.id}`, { ...isiK(), personelId: undefined, version: k1.version }, true), 403, 'bukan pencatat PATCH')
  status(await aksi(op2, K, k1, 'ajukan'), 403, 'bukan pencatat ajukan')
  status(await op2.upload(`${K}/${k1.id}/lampiran`, { filename: 'x.pdf', data: PDF }), 403, 'bukan pencatat unggah')
  k1 = item(await aksi(op, K, k1, 'ajukan'))
  status(await aksi(buta, K, k1, 'setujui'), 403, 'setuju tanpa kinerja.read tidak boleh memutus')
  status(await aksi(op2, K, k1, 'setujui'), 403, 'kelola tanpa setuju: setujui')
  // Maker-checker: Kasubbag pernah menambah tindak lanjut → tidak boleh memutus; apr boleh.
  k1 = item(await ka.call('POST', `${K}/${k1.id}/tindak-lanjut`, { bentuk: 'PELATIHAN', uraian: 'Pelatihan tambahan', tenggat: '2027-02-01', version: k1.version }, true))
  contains(await aksi(ka, K, k1, 'setujui'), 'self_review_forbidden', 'pernah menambah tindak lanjut tidak boleh memutus')
  status(await aksi(apr, K, k1, 'setujui'), 200, 'pemutus yang tidak pernah mengubah boleh memutus')

  // ---- 3. CSRF / Origin / bentuk (kinerja) ----
  status(await op.call('POST', K, isiK({ periode: 'SEMESTER_I' }), false), 403, 'catat penilaian tanpa CSRF')
  status(await op.call('POST', K, isiK({ periode: 'SEMESTER_I' }), true, { origin: 'https://evil.example' }), 403, 'catat penilaian Origin asing')
  status(await op.upload(`${K}/${k1.id}/lampiran`, { filename: 'a.pdf', data: PDF, csrf: false }), 403, 'unggah kinerja tanpa CSRF')
  status(await op.call('POST', K, { ...isiK(), x: 1 }, true), 400, 'field asing kinerja')
  status(await op.call('POST', K, raw('{"__proto__":{"polluted":1},"tahun":2027}'), true), 400, 'kunci __proto__')
  status(await op.call('POST', K, isiK({ catatan: 'nilai​baik', periode: 'SEMESTER_II' }), true), 400, 'catatan zero-width')
  status(await op.call('POST', K, isiK({ tahun: '2027' }), true), 400, 'tahun bukan bilangan')
  status(await op.call('POST', K, isiK({ catatan: 'x'.repeat(33000) }), true), 400, 'body JSON > 32 KB')
  for (const qs of ['size=7', 'page=0', 'tahun=abc', 'periode=X', 'kategori=JELEK', 'status=Aktif', 'lewatTenggat=true', 'q=a&q=b']) status(await op.call('GET', `${K}?${qs}`), 400, `query kinerja ${qs}`)
  equal(Object.getOwnPropertyNames(Object.prototype).filter((x) => !PROTO_ASLI.has(x)).join(','), '', 'prototipe Object tidak tercemar')
  for (const path of [K, `${K}/${k1.id}`]) equal((await op.call('GET', path)).headers.get('cache-control'), 'no-store', `no-store ${path}`)
  status(await ka.call('GET', `${C}/${PALSU}/lampiran/${lidK}`), 404, 'lampiran kinerja via jalur cuti')

  // ---- 4. Aset (irisan B) ----
  await bagianAset({ env, ka, op, op2, apr, baca, item, json, aksi, lidK })

  // ---- 5. Pencabutan ----
  const opId = users.op_r5h31.id
  await env.pool.query("UPDATE sdl_access_grants SET granted_at=now()-interval '2 hours', expires_at=now()-interval '1 minute' WHERE user_id=$1", [opId])
  try { status(await op.call('GET', K), 403, 'grant kedaluwarsa') } finally { await env.pool.query('UPDATE sdl_access_grants SET expires_at=NULL WHERE user_id=$1', [opId]) }
  await env.pool.query("UPDATE sdl_roles SET is_active=FALSE WHERE role_key='br_r5h31_op'")
  try { status(await op.call('GET', K), 403, 'role nonaktif') } finally { await env.pool.query("UPDATE sdl_roles SET is_active=TRUE WHERE role_key='br_r5h31_op'") }
  await env.pool.query('UPDATE sdl_users SET must_change_password=TRUE WHERE id=$1', [opId])
  try { status(await op.call('POST', K, isiK({ periode: 'SEMESTER_II' }), true), 403, 'must_change_password POST') } finally { await env.pool.query('UPDATE sdl_users SET must_change_password=FALSE WHERE id=$1', [opId]) }
  status(await op.call('GET', K), 200, 'operator pulih')

  // ---- 6. Kunci evidence kosong: fail-closed ----
  const tanpaKunci = await appLain(env, { evidenceKey: null })
  try {
    const b = await new Browser(tanpaKunci.base).bootstrap()
    await b.login('op_r5h31', 200)
    const k2 = item(await b.call('POST', K, isiK({ periode: 'SEMESTER_II', personelId: (await personel('SEC-KN-002')).id }), true))
    const r = await b.upload(`${K}/${k2.id}/lampiran`, { filename: 'c.pdf', data: PDF })
    status(r, 503, 'unggah tanpa kunci evidence'); contains(r, 'evidence_encryption_unavailable', 'kode enkripsi tidak tersedia')
    status(await b.call('GET', `${K}/${k1.id}/lampiran/${lidK}`), 503, 'pencatat unduh tanpa kunci evidence (fail-closed)')
  } finally { await tanpaKunci.close() }

  await env.revokeGrants(opId, 'br_r5h31_op')
  status(await op.call('GET', K), 403, 'grant dicabut')
}

/** Irisan B: aset — matriks, maker-checker penghapusan (pengusul, sejak usulan), lampiran wajib, bentuk, id silang. */
async function bagianAset({ ka, op, op2, apr, baca, item, json, aksi, lidK }) {
  const isiA = (kode, extra = {}) => ({ kodeBmn: kode, nama: 'Aset Uji Keamanan', kategori: 'Elektronik', merekTipe: '', tahunPerolehan: null, jumlah: 1, satuan: 'unit', lokasi: 'Gudang', kondisi: 'Baik', penanggungJawabId: null, penanggungJawabTeks: '', jadwalPemeliharaan: '', catatan: '', ...extra })
  contains(await baca.call('GET', `${A}/capabilities`), '"canRead":true,"canManage":false,"canApprove":false', 'baca saja capabilities aset')
  status(await baca.call('POST', A, isiA('SEC-A-000'), true), 403, 'baca saja catat aset')
  status(await apr.call('POST', A, isiA('SEC-A-000'), true), 403, 'setuju-saja catat aset')
  status(await op.call('POST', A, isiA('SEC-A-000'), false), 403, 'catat aset tanpa CSRF')
  status(await op.call('POST', A, isiA('SEC-A-000'), true, { origin: 'https://evil.example' }), 403, 'catat aset Origin asing')
  // Penghapusan: lampiran wajib sejak usulan, pemutus bukan pengusul.
  let a1 = item(await op.call('POST', A, isiA('SEC-A-001'), true))
  a1 = item(await aksi(op, A, a1, 'usulkan_hapus', { catatan: 'Rusak total uji keamanan' }))
  contains(await aksi(apr, A, a1, 'setujui_hapus'), 'lampiran_wajib', 'setujui tanpa lampiran sejak usulan')
  status(await aksi(op2, A, a1, 'setujui_hapus'), 403, 'kelola tanpa setuju: setujui hapus')
  status(await op.upload(`${A}/${a1.id}/lampiran`, { filename: 'ba.pdf', data: PDF }), 201, 'pengusul unggah BA')
  a1 = item(await op.call('GET', `${A}/${a1.id}`))
  status(await aksi(apr, A, a1, 'setujui_hapus'), 200, 'pemutus lain menyetujui penghapusan')
  let a2 = item(await ka.call('POST', A, isiA('SEC-A-002'), true))
  a2 = item(await aksi(ka, A, a2, 'usulkan_hapus', { catatan: 'Usulan oleh Kasubbag uji' }))
  status(await op.upload(`${A}/${a2.id}/lampiran`, { filename: 'ba2.pdf', data: PDF }), 201, 'op unggah BA usulan Kasubbag')
  a2 = item(await ka.call('GET', `${A}/${a2.id}`))
  contains(await aksi(ka, A, a2, 'setujui_hapus'), 'self_review_forbidden', 'pengusul tidak boleh memutus usulannya')
  let a3 = item(await op.call('POST', A, isiA('SEC-A-003'), true))
  a3 = item(await aksi(op, A, a3, 'usulkan_hapus', { catatan: 'Usulan op untuk diuji' }))
  status(await apr.upload(`${A}/${a3.id}/lampiran`, { filename: 'x.pdf', data: PDF }), 403, 'setuju-saja tidak bisa unggah (tanpa kelola)')
  status(await ka.upload(`${A}/${a3.id}/lampiran`, { filename: 'ka.pdf', data: PDF }), 201, 'Kasubbag unggah sejak usulan')
  a3 = item(await ka.call('GET', `${A}/${a3.id}`))
  contains(await aksi(ka, A, a3, 'setujui_hapus'), 'self_review_forbidden', 'yang mengunggah sejak usulan tidak boleh memutus')
  // Id silang antar-modul dan bentuk.
  status(await ka.call('GET', `${A}/${a1.id}/lampiran/${lidK}`), 404, 'lampiran kinerja via jalur aset')
  status(await op.call('POST', A, { ...isiA('SEC-A-004'), x: 1 }, true), 400, 'field asing aset')
  status(await op.call('POST', A, isiA('SEC-A-004', { jumlah: '1' }), true), 400, 'jumlah bukan bilangan')
  // K43: titik dan garis miring sah (kode BMN 3.05.01/2024); kode hanya pengenal, tidak pernah dipakai sebagai path.
  status(await op.call('POST', A, isiA('SEC-A-004', { kodeBmn: 'SEC<A>"004' }), true), 400, 'kode BMN berkarakter tak sah')
  status(await op.call('POST', A, isiA('SEC-A-004', { lokasi: 'Gudang‮A' }), true), 400, 'lokasi pembalik arah')
  status(await op.call('POST', A, isiA('SEC-A-004', { penanggungJawabId: 'x' }), true), 400, 'PJ bukan UUID')
  for (const qs of ['size=7', 'status=Hilang', 'kategori=Mobil', 'kondisi=X', 'tahap=H-90', 'q=a&q=b']) status(await op.call('GET', `${A}?${qs}`), 400, `query aset ${qs}`)
  status(await op.call('GET', `${A}/jadwal?tahap=X`), 400, 'query jadwal tahap=X')
  equal((await op.call('GET', A)).headers.get('cache-control'), 'no-store', 'no-store aset')
  const dl = await baca.call('GET', `${A}/${a1.id}/lampiran/${json(await ka.call('GET', `${A}/${a1.id}`)).lampiran[0].id}`)
  status(dl, 200, 'baca saja unduh lampiran aset (Dihapus tetap terbaca)')
  for (const [h, want] of [['x-content-type-options', 'nosniff'], ['content-security-policy', 'sandbox'], ['cache-control', 'no-store']]) equal(dl.headers.get(h), want, `header ${h}`)
}
