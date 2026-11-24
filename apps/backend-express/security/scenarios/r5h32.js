import { createServer } from 'node:http'

import { createApp } from '../../src/app.js'
import { Mailer } from '../../src/auth/mailer.js'
import { contains, equal, status } from '../assert.js'
import { Browser } from '../browser.js'

/**
 * R5H32 — Subbagsumda Persuratan & Arsip + Laporan & Analitik (migrasi 073). EXPRESS SAJA: `x7_`, setelah x6.
 *
 * Yang dibuktikan: guard kedua prefix (anonim 401, Superadmin 403 termasuk workspace demo) · capabilities unit lain
 * kosong · matriks Ra/Ma/Xa/Ps/E/Ri/Rk · K29 ARSIP TERBATAS DIBATASI (daftar, cari, filter, hitungan, detail/lampiran/
 * mutasi 404 identik UUID fiktif, detail personel, dashboard, analitik, ekspor tanpa Xa) · EKSPOR HANYA E + hak modul ·
 * formula injection · batas 10.000 baris (413, tidak diaudit) · CSRF/Origin JSON + multipart · id silang antar-modul ·
 * bentuk + probe query · pencabutan · kunci evidence kosong fail-closed.
 */
const AR = '/api/v1/subbagsumda/arsip'
const LAP = '/api/v1/subbagsumda/laporan'
const PER = '/api/v1/subbagsumda/personel'
const DASH = '/api/v1/subbagsumda/dashboard'
const K = '/api/v1/subbagsumda/kinerja'
const A = '/api/v1/subbagsumda/aset'
const raw = (s) => Buffer.from(s, 'utf8')
const PROTO_ASLI = new Set(Object.getOwnPropertyNames(Object.prototype))
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n' +
  '3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n', 'latin1')
const PALSU = '00000000-0000-4000-8000-000000000000'
const MODUL = ['personel', 'pensiun', 'karier', 'diklat', 'kompetensi', 'cuti', 'kesejahteraan', 'kinerja', 'aset', 'arsip']

async function appLain(env, configLain) {
  const server = createServer(createApp({
    pool: env.pool,
    config: { ...env.config, ...configLain },
    mailer: new Mailer({ host: '', port: 587, username: '', password: '', from: '' }),
  }))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }
}

export async function verifyR5H32SumdaArsipLaporan({ env }) {
  const R = 'subbagsumda.personel.read'
  const RA = 'subbagsumda.arsip.read'
  const MA = 'subbagsumda.arsip.manage'
  const XA = 'subbagsumda.arsip.restricted'
  const E = 'subbagsumda.laporan.export'
  const PS = 'persuratan.read'
  const RI = 'subbagsumda.inventaris.read'
  const RK = 'subbagsumda.kinerja.read'
  const roles = {
    br_r5h32_penuh: [R, RA, MA, XA, E, PS, RI, RK, 'subbagsumda.personel.create', 'subbagsumda.kinerja.manage', 'subbagsumda.aset.manage'],
    br_r5h32_op: [R, RA, MA, PS],
    br_r5h32_nops: [R, RA, MA],
    br_r5h32_kabag: [R, RA, XA, E, PS],
    br_r5h32_baca: [R, RA],
    br_r5h32_tanpa: [R, RI],
    br_r5h32_eks: [R, RA, E, 'subbagsumda.kinerja.manage'],
  }
  for (const [role, perms] of Object.entries(roles)) { await env.createRole(role, role); await env.grantPermissions(role, perms) }
  // Batas CAPTCHA 60/menit per IP lintas skenario (pola x6): baris skenario sebelumnya dimundurkan di DB uji sekali pakai.
  await env.pool.query("UPDATE sdl_captcha_challenges SET created_at=created_at-interval '2 minutes'")
  const users = {}
  for (const [name, role] of [['ka_r5h32', 'br_r5h32_penuh'], ['op_r5h32', 'br_r5h32_op'], ['op2_r5h32', 'br_r5h32_op'], ['nops_r5h32', 'br_r5h32_nops'],
    ['kabag_r5h32', 'br_r5h32_kabag'], ['baca_r5h32', 'br_r5h32_baca'], ['tanpa_r5h32', 'br_r5h32_tanpa'], ['eks_r5h32', 'br_r5h32_eks']]) {
    users[name] = await env.createUser(name)
    await env.attachUnit(users[name].id, 'subbagsumda')
    await env.grant(users[name].id, role, 'subbagsumda', 'unit', { reason: 'Isolated R5H32 grant only' })
  }
  const luar = await env.createUser('luar_r5h32')
  await env.attachUnit(luar.id, 'subbagren')
  await env.grant(luar.id, 'br_r5h32_penuh', 'subbagren', 'unit', { reason: 'Isolated R5H32 grant only' })

  const anon = await env.newBrowser()
  const [ka, op, op2, nops, kabag, baca, tanpa, eks, sLuar] = await Promise.all(
    ['ka_r5h32', 'op_r5h32', 'op2_r5h32', 'nops_r5h32', 'kabag_r5h32', 'baca_r5h32', 'tanpa_r5h32', 'eks_r5h32', 'luar_r5h32'].map((u) => env.newSession(u)))
  const sa = await env.loginSuperadmin()
  const json = (r) => JSON.parse(r.text)
  const item = (r) => { const j = JSON.parse(r.text); if (!j.item) throw new Error(`tanpa item: HTTP ${r.status} ${r.text.slice(0, 160)}`); return j.item }
  const per = item(await ka.call('POST', PER, { nrp: 'SEC-AR-001', nama: 'Personel Arsip Uji', jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '' }, true))
  const isi = (extra = {}) => ({ nomor: 'SEC/AR/1', jenis: 'SURAT_KEPUTUSAN', perihal: 'Arsip uji keamanan', tanggal: '2026-11-01', asalTujuan: '', kodeKlasifikasi: '',
    lokasiSimpan: '', retensiSampai: '', kerahasiaan: 'BIASA', catatan: '', personelId: null, suratId: null, ...extra })
  const patch = (s, it, extra = {}) => s.call('PATCH', `${AR}/${it.id}`, { ...isi(), perihal: it.perihal, kerahasiaan: it.kerahasiaan, personelId: it.personel?.id ?? null, suratId: it.suratId, version: it.version, ...extra }, true)
  const aksi = (s, it, act, extra = {}) => s.call('POST', `${AR}/${it.id}/aksi`, { aksi: act, catatan: '', version: it.version, ...extra }, true)

  // ---- 1. Guard ----
  for (const path of [AR, `${AR}/capabilities`, `${LAP}/capabilities`, `${LAP}/ringkasan`, `${LAP}/ekspor/personel`]) status(await anon.call('GET', path), 401, `anonim GET ${path}`)
  for (const [m, path, b] of [['GET', AR], ['POST', AR, isi()], ['GET', `${AR}/surat-tertaut`], ['POST', `${AR}/${PALSU}/aksi`, { aksi: 'inaktifkan', catatan: '', version: 1 }],
    ['GET', `${AR}/${PALSU}/lampiran/${PALSU}`], ['GET', `${LAP}/ringkasan`], ['GET', `${LAP}/ekspor/personel`]]) {
    status(await sa.call(m, path, b ?? null, m !== 'GET'), 403, `Superadmin ${m} ${path}`)
  }
  const demo = await appLain(env, { demoSuperadminWorkspace: true })
  try {
    const b = await new Browser(demo.base).bootstrap()
    const { challenge, code } = await env.setOTPChallenge(env.users.get('sa_r2d5'))
    status(await b.call('POST', '/api/v1/auth/verify-otp', { challenge, code }, true), 200, 'login Superadmin di app demo')
    status(await b.call('GET', AR), 403, 'Superadmin demo GET arsip')
    status(await b.call('POST', AR, isi(), true), 403, 'Superadmin demo POST arsip')
    status(await b.call('GET', `${LAP}/ekspor/personel`), 403, 'Superadmin demo ekspor')
    status(await b.call('GET', `${LAP}/ringkasan`), 403, 'Superadmin demo ringkasan')
    contains(await b.call('GET', `${AR}/capabilities`), '"canRead":false,"canManage":false,"canRestricted":false,"canTautSurat":false', 'Superadmin demo capabilities arsip kosong')
    contains(await b.call('GET', `${LAP}/capabilities`), '"canRead":false,"canExport":false', 'Superadmin demo capabilities laporan kosong')
  } finally { await demo.close() }
  contains(await sLuar.call('GET', `${AR}/capabilities`), '"canRead":false,"canManage":false,"canRestricted":false,"canTautSurat":false', 'grant unit lain capabilities arsip')
  equal(Object.values(json(await sLuar.call('GET', `${LAP}/capabilities`)).modul).some(Boolean), false, 'grant unit lain: tidak ada modul ekspor')
  status(await sLuar.call('GET', AR), 403, 'grant unit lain GET arsip')
  status(await sLuar.call('GET', `${LAP}/ekspor/personel`), 403, 'grant unit lain ekspor')

  // ---- 2. Matriks ----
  status(await baca.call('POST', AR, isi(), true), 403, 'Ra saja catat arsip')
  status(await kabag.call('POST', AR, isi(), true), 403, 'pola Kabag (Ra+Xa+E) catat arsip')
  status(await nops.call('GET', `${AR}/surat-tertaut`), 403, 'Ma tanpa persuratan.read: surat-tertaut')
  status(await nops.call('POST', AR, isi({ suratId: PALSU }), true), 403, 'Ma tanpa persuratan.read: POST suratId')
  status(await nops.call('POST', AR, isi(), true), 201, 'Ma tanpa persuratan.read: POST tanpa surat')
  let biasa = item(await op.call('POST', AR, isi(), true))
  status(await patch(baca, biasa), 403, 'Ra saja PATCH')
  status(await aksi(kabag, biasa, 'inaktifkan'), 403, 'pola Kabag aksi')
  biasa = item(await aksi(op, biasa, 'inaktifkan'))
  status(await aksi(op, biasa, 'musnahkan', { catatan: 'Retensi habis uji keamanan' }), 403, 'Ma tanpa Xa musnahkan')
  status(await tanpa.call('GET', AR), 403, 'tanpa arsip.read GET arsip')
  equal(json(await tanpa.call('GET', `${PER}/${per.id}`)).item.arsip, null, 'tanpa arsip.read: detail personel arsip null')
  equal(json(await tanpa.call('GET', DASH)).totals.arsipRetensi30, null, 'tanpa arsip.read: dashboard arsipRetensi30 null')
  const rTanpa = json(await tanpa.call('GET', `${LAP}/ringkasan`))
  equal(rTanpa.arsip, null, 'tanpa arsip.read: blok arsip null')
  equal(rTanpa.kinerja, null, 'tanpa kinerja.read: blok kinerja null')
  equal(rTanpa.aset === null, false, 'dengan inventaris.read: blok aset ada')
  equal(json(await kabag.call('GET', `${LAP}/ringkasan`)).aset, null, 'tanpa inventaris.read: blok aset null')
  status(await kabag.call('GET', `${LAP}/ekspor/aset`), 403, 'E tanpa inventaris.read: ekspor aset')
  status(await tanpa.call('GET', `${LAP}/ekspor/personel`), 403, 'tanpa E: ekspor')
  for (const m of MODUL) status(await op.call('GET', `${LAP}/ekspor/${m}`), 403, `operator tanpa E: ekspor ${m}`)

  // ---- 3. K29: arsip TERBATAS dibatasi ----
  const ringkas0 = json(await op2.call('GET', `${LAP}/ringkasan`)).arsip
  const dash0 = json(await op2.call('GET', DASH)).totals.arsipRetensi30
  const total0 = json(await op2.call('GET', `${AR}?size=100`)).total
  const tb = item(await op.call('POST', AR, isi({ kerahasiaan: 'TERBATAS', perihal: 'SK pribadi sangat rahasia', personelId: per.id, retensiSampai: '2026-11-20', tanggal: '2026-11-01' }), true))
  const upT = await op.upload(`${AR}/${tb.id}/lampiran`, { filename: 'sk-pribadi.pdf', data: PDF }); status(upT, 201, 'pencatat unggah lampiran TERBATAS')
  const lidT = json(upT).id
  for (const s of [op2, baca]) {
    const l = await s.call('GET', `${AR}?size=100`)
    equal(json(l).total, total0, 'hitungan daftar tidak bertambah')
    equal(/SK pribadi sangat rahasia|sk-pribadi/.test(l.text), false, 'daftar tanpa TERBATAS')
    for (const qs of ['q=SK%20pribadi', 'kerahasiaan=TERBATAS', 'retensi=1', 'jenis=SURAT_KEPUTUSAN', 'tahun=2026', 'status=Aktif']) {
      equal(json(await s.call('GET', `${AR}?size=100&${qs}`)).items.some((x) => x.id === tb.id), false, `filter ${qs} tidak menemukan TERBATAS`)
    }
    const palsu = await s.call('GET', `${AR}/${PALSU}`)
    for (const [label, r] of [['detail', await s.call('GET', `${AR}/${tb.id}`)], ['unduh', await s.call('GET', `${AR}/${tb.id}/lampiran/${lidT}`)],
      ['PATCH', await patch(s, tb)], ['aksi', await aksi(s, tb, 'inaktifkan')], ['unggah', await s.upload(`${AR}/${tb.id}/lampiran`, { filename: 'x.pdf', data: PDF })],
      ['hapus lampiran', await s.call('DELETE', `${AR}/${tb.id}/lampiran/${lidT}`, null, true)]]) {
      status(r, s === baca && ['PATCH', 'aksi', 'unggah', 'hapus lampiran'].includes(label) ? 403 : 404, `TERBATAS ${label}`)
      if (r.status === 404) equal(r.text, palsu.text, `TERBATAS ${label}: badan identik UUID fiktif`)
    }
    equal(/SK pribadi sangat rahasia/.test((await s.call('GET', `${PER}/${per.id}`)).text), false, 'detail personel tanpa TERBATAS')
  }
  equal(json(await op2.call('GET', DASH)).totals.arsipRetensi30, dash0, 'dashboard arsipRetensi30 tidak bergerak')
  equal(JSON.stringify(json(await op2.call('GET', `${LAP}/ringkasan`)).arsip), JSON.stringify(ringkas0), 'blok arsip analitik tidak bergerak')
  for (const s of [op, ka, kabag]) contains(await s.call('GET', `${AR}/${tb.id}`), 'SK pribadi sangat rahasia', 'pencatat/Xa melihat TERBATAS')
  equal(/SK pribadi sangat rahasia/.test((await eks.call('GET', `${LAP}/ekspor/arsip`)).text), false, 'ekspor E tanpa Xa: TERBATAS tidak ikut')
  contains(await ka.call('GET', `${LAP}/ekspor/arsip`), 'SK pribadi sangat rahasia', 'ekspor E+Xa: TERBATAS ikut')
  contains(await kabag.call('GET', `${LAP}/ekspor/arsip`), 'SK pribadi sangat rahasia', 'ekspor pola Kabag: TERBATAS ikut')
  // Naik oleh bukan pencatat tanpa Xa → tersembunyi; turun hanya Xa.
  const b2 = item(await op.call('POST', AR, isi({ perihal: 'Arsip untuk dinaikkan' }), true))
  contains(await patch(op2, b2, { kerahasiaan: 'TERBATAS' }), '"tersembunyi":true', 'naik ke TERBATAS oleh bukan pencatat')
  status(await op2.call('GET', `${AR}/${b2.id}`), 404, 'sesudah dinaikkan: tidak terlihat')
  status(await patch(op, item(await op.call('GET', `${AR}/${b2.id}`)), { kerahasiaan: 'BIASA' }), 403, 'pencatat tanpa Xa menurunkan')

  // ---- 4. Ekspor: kinerja E tanpa Rk hanya baris sendiri, formula injection, batas baris ----
  await eks.call('POST', K, { personelId: per.id, tahun: 2026, periode: 'SEMESTER_I', kategori: 'BAIK', penilai: '', tanggalPenilaian: '', catatan: '' }, true)
  await ka.call('POST', K, { personelId: per.id, tahun: 2026, periode: 'SEMESTER_II', kategori: 'PERLU_PEMBINAAN', penilai: '', tanggalPenilaian: '', catatan: '' }, true)
  const kinE = (await eks.call('GET', `${LAP}/ekspor/kinerja`)).text
  equal(kinE.split('\r\n').length - 2, 1, 'E+R tanpa kinerja.read: kinerja hanya baris sendiri')
  equal(/PERLU_PEMBINAAN/.test(kinE), false, 'E+R tanpa kinerja.read: kategori orang lain tidak ikut')
  equal((await ka.call('GET', `${LAP}/ekspor/kinerja`)).text.split('\r\n').length - 2,
    (await env.pool.query('SELECT count(*)::int AS n FROM sdl_sumda_kinerja')).rows[0].n, 'E+Rk: kinerja lengkap (= seluruh baris, termasuk x6)')
  await op.call('POST', AR, isi({ perihal: "=cmd|' /C calc'!A0", nomor: '@SUM(1+1)*cmd', asalTujuan: '+1-1', lokasiSimpan: '-2+3' }), true)
  const csv = await ka.call('GET', `${LAP}/ekspor/arsip`)
  status(csv, 200, 'ekspor arsip')
  equal(csv.text.charCodeAt(0), 0xfeff, 'CSV diawali BOM')
  for (const s of [`"'=cmd|' /C calc'!A0"`, `"'@SUM(1+1)*cmd"`, `"'+1-1"`, `"'-2+3"`]) contains(csv, s, `formula injection dinetralkan ${s}`)
  equal(/(^|;)"[=+\-@]/m.test(csv.text), false, 'tidak ada sel berawalan formula tanpa awalan')
  for (const [h, want] of [['content-type', 'text/csv; charset=utf-8'], ['x-content-type-options', 'nosniff'], ['content-security-policy', 'sandbox'], ['cache-control', 'no-store']]) equal(csv.headers.get(h), want, `header ekspor ${h}`)
  const nAudit = async () => (await env.pool.query("SELECT count(*)::int AS n FROM sdl_audit_events WHERE event_key='subbagsumda.laporan.export'")).rows[0].n
  const au0 = await nAudit()
  await env.pool.query(`INSERT INTO sdl_sumda_personel(nrp,nama,jenis,status,created_by,updated_by)
    SELECT 'SEC-BULK-'||g, 'Personel Massal '||g, 'Polri', 'Aktif', $1, $1 FROM generate_series(1,10001) g`, [users.ka_r5h32.id])
  try {
    const r = await ka.call('GET', `${LAP}/ekspor/personel`)
    status(r, 413, 'ekspor > 10.000 baris'); contains(r, 'terlalu_banyak', 'kode terlalu_banyak')
    equal(await nAudit(), au0, '413 tidak diaudit')
  } finally { await env.pool.query("DELETE FROM sdl_sumda_personel WHERE nrp LIKE 'SEC-BULK-%'") }
  status(await ka.call('GET', `${LAP}/ekspor/personel`), 200, 'ekspor pulih setelah data massal dihapus')
  equal(await nAudit(), au0 + 1, 'ekspor 200 diaudit')
  for (const qs of ['x=1', 'tahun=2026&tahun=2027', 'status=Hilang']) status(await ka.call('GET', `${LAP}/ekspor/personel?${qs}`), 400, `query ekspor ${qs}`)
  status(await ka.call('GET', `${LAP}/ekspor/gaji`), 404, 'modul ekspor tak dikenal')

  // ---- 5. CSRF / Origin / bentuk / id silang ----
  status(await op.call('POST', AR, isi(), false), 403, 'catat arsip tanpa CSRF')
  status(await op.call('POST', AR, isi(), true, { origin: 'https://evil.example' }), 403, 'catat arsip Origin asing')
  status(await op.upload(`${AR}/${biasa.id}/lampiran`, { filename: 'a.pdf', data: PDF, csrf: false }), 403, 'unggah arsip tanpa CSRF')
  status(await op.call('POST', AR, { ...isi(), x: 1 }, true), 400, 'field asing arsip')
  status(await op.call('POST', AR, raw('{"__proto__":{"polluted":1},"perihal":"abc"}'), true), 400, 'kunci __proto__')
  status(await op.call('POST', AR, isi({ perihal: 'arsip​rahasia' }), true), 400, 'perihal zero-width')
  status(await op.call('POST', AR, isi({ perihal: 'arsip\u0000nul' }), true), 400, 'perihal NUL')
  status(await op.call('POST', AR, isi({ catatan: 'x'.repeat(33000) }), true), 400, 'body JSON > 32 KB')
  status(await patch(op, biasa, { version: '1' }), 400, 'version bukan bilangan')
  for (const qs of ['size=7', 'page=0', 'tahun=abc', 'retensi=2', 'kerahasiaan=X', 'jenis=MEMO', 'status=Hilang', 'q=a&q=b']) status(await op.call('GET', `${AR}?${qs}`), 400, `query arsip ${qs}`)
  status(await op.upload(`${AR}/${biasa.id}/lampiran?peran=X`, { filename: 'a.pdf', data: PDF }), 400, 'peran lampiran di luar daftar')
  status(await op.call('GET', `${LAP}/ringkasan?tahun=abc`), 400, 'ringkasan tahun=abc')
  equal(Object.getOwnPropertyNames(Object.prototype).filter((x) => !PROTO_ASLI.has(x)).join(','), '', 'prototipe Object tidak tercemar')
  for (const path of [AR, `${AR}/${biasa.id}`, `${LAP}/ringkasan`, `${LAP}/capabilities`]) equal((await op.call('GET', path)).headers.get('cache-control'), 'no-store', `no-store ${path}`)
  const aset = item(await ka.call('POST', A, { kodeBmn: 'SEC-AR-A1', nama: 'Aset Silang', kategori: 'Elektronik', merekTipe: '', tahunPerolehan: null, jumlah: 1, satuan: 'unit', lokasi: '', kondisi: 'Baik', penanggungJawabId: null, penanggungJawabTeks: '', jadwalPemeliharaan: '', catatan: '' }, true))
  const lidA = json(await ka.upload(`${A}/${aset.id}/lampiran`, { filename: 'aset.pdf', data: PDF })).id
  status(await ka.call('GET', `${AR}/${tb.id}/lampiran/${lidA}`), 404, 'lampiran aset via jalur arsip')
  status(await ka.call('GET', `${A}/${aset.id}/lampiran/${lidT}`), 404, 'lampiran arsip via jalur aset')
  status(await ka.call('GET', `${AR}/${biasa.id}/lampiran/${lidT}`), 404, 'lampiran arsip lain via arsip ini')

  // ---- 6. Pencabutan ----
  const opId = users.op_r5h32.id
  await env.pool.query("UPDATE sdl_access_grants SET granted_at=now()-interval '2 hours', expires_at=now()-interval '1 minute' WHERE user_id=$1", [opId])
  try { status(await op.call('GET', AR), 403, 'grant kedaluwarsa') } finally { await env.pool.query('UPDATE sdl_access_grants SET expires_at=NULL WHERE user_id=$1', [opId]) }
  await env.pool.query("UPDATE sdl_roles SET is_active=FALSE WHERE role_key='br_r5h32_op'")
  try { status(await op.call('GET', AR), 403, 'role nonaktif') } finally { await env.pool.query("UPDATE sdl_roles SET is_active=TRUE WHERE role_key='br_r5h32_op'") }
  await env.pool.query('UPDATE sdl_users SET must_change_password=TRUE WHERE id=$1', [opId])
  try { status(await op.call('POST', AR, isi(), true), 403, 'must_change_password POST') } finally { await env.pool.query('UPDATE sdl_users SET must_change_password=FALSE WHERE id=$1', [opId]) }
  status(await op.call('GET', AR), 200, 'operator pulih')
  const kaId = users.ka_r5h32.id
  await env.pool.query("UPDATE sdl_access_grants SET granted_at=now()-interval '2 hours', expires_at=now()-interval '1 minute' WHERE user_id=$1", [kaId])
  try { status(await ka.call('GET', `${LAP}/ekspor/personel`), 403, 'ekspor dengan grant kedaluwarsa') } finally { await env.pool.query('UPDATE sdl_access_grants SET expires_at=NULL WHERE user_id=$1', [kaId]) }

  // ---- 7. Kunci evidence kosong: fail-closed ----
  const tanpaKunci = await appLain(env, { evidenceKey: null })
  try {
    const b = await new Browser(tanpaKunci.base).bootstrap()
    await b.login('op_r5h32', 200)
    const r = await b.upload(`${AR}/${biasa.id}/lampiran`, { filename: 'c.pdf', data: PDF })
    status(r, 503, 'unggah arsip tanpa kunci evidence'); contains(r, 'evidence_encryption_unavailable', 'kode enkripsi tidak tersedia')
    status(await b.call('GET', `${AR}/${tb.id}/lampiran/${lidT}`), 503, 'pencatat unduh tanpa kunci evidence (fail-closed)')
  } finally { await tanpaKunci.close() }

  await env.revokeGrants(opId, 'br_r5h32_op')
  status(await op.call('GET', AR), 403, 'grant dicabut')
}
