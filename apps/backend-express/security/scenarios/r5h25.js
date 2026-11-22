import { contains, equal, status } from '../assert.js'

/**
 * R5H25 — Master Data tahap pekerjaan (migrasi 067). EXPRESS SAJA: tidak ada padanan
 * di suite Go, jadi namanya berawalan `x1_` dan diletakkan SETELAH skenario 1:1.
 *
 * Yang dibuktikan, karena harness golden tidak bisa melihatnya:
 *   - saklar hanya bisa dibaca/diubah lewat AuthorizeRoleEditor: anonim 401, akun
 *     operasional Subbagren yang sah 403, Superadmin 200; mutasi wajib CSRF + Origin sah;
 *     Superadmin yang belum merotasi password, role nonaktif, atau tanpa
 *     identity.roles.manage ditolak;
 *   - seluruh validasi PUT ditegakkan server (bentuk body, jenis/tahap, prototype
 *     pollution, tipe, alasan termasuk karakter kendali, versi, tahap terkunci, minimal satu);
 *   - penegakan di menu kerja: tahap nonaktif tidak bisa DITAMBAHKAN, tahap lama tetap bisa
 *     diubah/dihapus;
 *   - jejak audit hanya memuat alasan dan daftar tahap;
 *   - pemisahan Superadmin <-> operasional tidak bocor: katalog menu kerja tetap 403 bagi
 *     Superadmin, padahal ia bisa mengatur saklarnya.
 */
const ADMIN = '/api/v1/admin/master/tahap-pekerjaan'
const R = '/api/v1/subbagren/perencanaan'
const KATALOG = `${R}/tahap-katalog`
const REASON = 'Uji keamanan R5H25 terisolasi'
const raw = (s) => Buffer.from(s, 'utf8')
const PROTO_ASLI = new Set(Object.getOwnPropertyNames(Object.prototype))

export async function verifyR5H25MasterTahap({ env }) {
  const ren = await env.createUser('ren_r5h25')
  await env.attachUnit(ren.id, 'subbagren')
  await env.createRole('br_r5h25_test', 'R5H25 Test Role')
  await env.grantPermissions('br_r5h25_test', ['subbagren.progar.read', 'subbagren.progar.manage'])
  await env.grant(ren.id, 'br_r5h25_test', 'subbagren', 'unit', { reason: 'Isolated R5H25 grant only' })

  const anon = await env.newBrowser()
  const op = await env.newSession('ren_r5h25')
  const sa = await env.loginSuperadmin()
  const saId = env.users.get('sa_r2d5').id
  const body = (version, aktif = { unduh_myinterest: true }, reason = REASON) => ({ aktif, reason, version })
  const ver = async () => JSON.parse((await sa.call('GET', ADMIN)).text).version
  const put = (jenis, payload, mutation = true, options = {}) => sa.call('PUT', `${ADMIN}/${jenis}`, payload, mutation, options)

  // ---- 1. Guard ----
  status(await anon.call('GET', ADMIN), 401, 'anonim baca saklar')
  status(await anon.call('PUT', `${ADMIN}/lap_lra`, body(0), true), 401, 'anonim ubah saklar')
  // Akun operasional ini SAH di menu kerja (katalog 200), jadi 403 di bawah murni dari guard admin.
  status(await op.call('GET', KATALOG), 200, 'operator baca katalog menu kerja')
  status(await op.call('GET', ADMIN), 403, 'operator baca saklar')
  status(await op.call('PUT', `${ADMIN}/lap_lra`, body(0), true), 403, 'operator ubah saklar')

  const list = await sa.call('GET', ADMIN)
  status(list, 200, 'Superadmin baca saklar')
  let version = JSON.parse(list.text).version
  status(await put('lap_lra', body(version), false), 403, 'Superadmin ubah tanpa CSRF')
  status(await put('lap_lra', body(version), true, { origin: 'https://evil.example' }), 403, 'Superadmin ubah dengan Origin asing')
  const noop = await put('lap_lra', body(version))
  status(noop, 200, 'Superadmin ubah dengan CSRF')
  equal(JSON.parse(noop.text).changed, 0, 'PUT tanpa perubahan nyata')
  equal(await ver(), version, 'PUT tanpa perubahan tidak menaikkan versi')
  status(await sa.call('GET', KATALOG), 403, 'Superadmin tetap ditolak di katalog menu kerja')

  await env.pool.query('UPDATE sdl_users SET must_change_password=TRUE WHERE id=$1', [saId])
  try {
    status(await sa.call('GET', ADMIN), 403, 'Superadmin must_change_password baca saklar')
    status(await put('lap_lra', body(version)), 403, 'Superadmin must_change_password ubah saklar')
  } finally {
    await env.pool.query('UPDATE sdl_users SET must_change_password=FALSE WHERE id=$1', [saId])
  }
  await env.pool.query("UPDATE sdl_roles SET is_active=FALSE WHERE role_key='superadmin'")
  try {
    status(await sa.call('GET', ADMIN), 403, 'role superadmin nonaktif baca saklar')
    status(await put('lap_lra', body(version)), 403, 'role superadmin nonaktif ubah saklar')
  } finally {
    await env.pool.query("UPDATE sdl_roles SET is_active=TRUE WHERE role_key='superadmin'")
  }
  await env.pool.query("DELETE FROM sdl_role_permissions WHERE role_key='superadmin' AND permission_key='identity.roles.manage'")
  try {
    status(await sa.call('GET', ADMIN), 403, 'tanpa identity.roles.manage baca saklar')
    status(await put('lap_lra', body(version)), 403, 'tanpa identity.roles.manage ubah saklar')
  } finally {
    await env.pool.query("INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('superadmin','identity.roles.manage') ON CONFLICT DO NOTHING")
  }
  status(await sa.call('GET', ADMIN), 200, 'Superadmin pulih setelah uji guard')

  // ---- 2. Validasi PUT ----
  const off = { unduh_myinterest: false }
  const bad400 = [
    ['jenis __proto__', '__proto__', body(version, { pokja: false })],
    ['jenis constructor', 'constructor', body(version, { pokja: false })],
    ['jenis tidak dikenal', 'palsu', body(version, { pokja: false })],
    ['tahap bukan milik jenis', 'lap_lra', body(version, { pokja: false })],
    ['aktif string', 'lap_lra', { aktif: 'x', reason: REASON, version }],
    ['aktif angka', 'lap_lra', { aktif: 1, reason: REASON, version }],
    ['aktif array', 'lap_lra', { aktif: [false], reason: REASON, version }],
    ['aktif null', 'lap_lra', { aktif: null, reason: REASON, version }],
    ['aktif kosong', 'lap_lra', body(version, {})],
    ['nilai bukan boolean', 'lap_lra', body(version, { unduh_myinterest: 'false' })],
    ['version -1', 'lap_lra', body(-1, off)],
    ['version 1.5', 'lap_lra', body(1.5, off)],
    ['version string', 'lap_lra', body('0', off)],
    ['alasan 7 karakter', 'lap_lra', body(version, off, '1234567')],
    ['alasan 501 karakter', 'lap_lra', body(version, off, 'a'.repeat(501))],
    ['alasan berisi NUL', 'lap_lra', body(version, off, 'alasan\u0000sah sekali')],
    ['alasan berisi karakter kendali', 'lap_lra', body(version, off, 'alasan\u0007sah sekali')],
  ]
  for (const [label, jenis, payload] of bad400) status(await put(jenis, payload), 400, label)
  // Kunci "__proto__"/"constructor" harus dikirim sebagai JSON mentah: literal objek JS akan
  // mengubah prototipe, bukan membuat kunci.
  for (const k of ['__proto__', 'constructor']) {
    status(await put('lap_lra', raw(`{"aktif":{"${k}":false},"reason":"${REASON}","version":${version}}`)), 400, `kunci aktif ${k}`)
  }
  status(await put('lap_lra', raw(`{"aktif":{"unduh_myinterest":false},"reason":"alasan \\ud800 tunggal","version":${version}}`)), 400, 'alasan surrogate tunggal')
  // Server berjalan di proses yang sama dengan suite ini: prototipe Object harus tetap bersih.
  equal(Object.getOwnPropertyNames(Object.prototype).filter((k) => !PROTO_ASLI.has(k)).join(','), '', 'prototipe Object tidak tercemar')
  status(await put('lap_lra', { ...body(version, off), x: 1 }), 400, 'field asing')
  status(await put('lap_lra', raw('bukan json')), 400, 'body bukan JSON')
  const kunci = await put('revisi_rpd', body(version, { dipa_baru: false }))
  status(kunci, 409, 'tahap terkunci'); contains(kunci, 'tahap_terkunci', 'kode tahap terkunci')
  const semua = Object.fromEntries(['terima_undangan_rapat', 'susun_laporan', 'rapat_pemeriksaan'].map((p) => [p, false]))
  const min = await put('lap_eka_pn', body(version, semua))
  status(min, 409, 'matikan semua tahap satu jenis'); contains(min, 'minimal_satu_tahap', 'kode minimal satu')
  const stale = await put('lap_lra', body(version + 5, off))
  status(stale, 409, 'versi basi'); contains(stale, 'version_conflict', 'kode versi basi')
  equal(await ver(), version, 'penolakan tidak menaikkan versi')

  // ---- 3. Penegakan di menu kerja ----
  const doc = await op.call('POST', `${R}/dokumen`, { tahun: 2027, jenis: 'lap_lra', periode: 'B01', judul: 'Uji R5H25', nomor: '', tanggal: '', programId: '', kegiatanId: '', keterangan: '', penggantiDari: '' }, true)
  status(doc, 201, 'operator buat dokumen LRA')
  const did = JSON.parse(doc.text).id
  const lama = await op.call('POST', `${R}/dokumen/${did}/tahap`, { pekerjaan: 'unduh_myinterest', isian: { tanggal: '2027-02-01' } }, true)
  status(lama, 201, 'tahap dicatat sebelum dinonaktifkan')
  const tid = JSON.parse(lama.text).id

  const auditSebelum = Number((await env.pool.query("SELECT count(*) FROM sdl_audit_events WHERE event_key='master.tahap.update'")).rows[0].count)
  const mati = await put('lap_lra', body(version, off))
  status(mati, 200, 'Superadmin nonaktifkan tahap')
  equal(JSON.parse(mati.text).changed, 1, 'satu perubahan')
  version = JSON.parse(mati.text).version
  const aud = (await env.pool.query("SELECT actor_id::text, metadata FROM sdl_audit_events WHERE event_key='master.tahap.update' ORDER BY id DESC LIMIT 1")).rows[0]
  equal(Number((await env.pool.query("SELECT count(*) FROM sdl_audit_events WHERE event_key='master.tahap.update'")).rows[0].count), auditSebelum + 1, 'satu baris audit')
  equal(aud.actor_id, saId, 'audit dicatat atas nama Superadmin')
  equal(Object.keys(aud.metadata).sort().join(','), 'dimatikan,dinyalakan,nonaktifAfter,nonaktifBefore,reason,versionBefore', 'metadata audit hanya alasan & daftar tahap')
  status(await put('lap_lra', body(version, off)), 200, 'PUT ulang nilai sama')
  equal(Number((await env.pool.query("SELECT count(*) FROM sdl_audit_events WHERE event_key='master.tahap.update'")).rows[0].count), auditSebelum + 1, 'PUT tanpa perubahan tidak menambah audit')

  contains(await op.call('GET', KATALOG), '"nonaktif":{"lap_lra":["unduh_myinterest"]}', 'katalog menu kerja memuat nonaktif')
  const tolak = await op.call('POST', `${R}/dokumen/${did}/tahap`, { pekerjaan: 'unduh_myinterest', isian: {} }, true)
  status(tolak, 409, 'tambah tahap nonaktif'); contains(tolak, 'tahap_nonaktif', 'kode tahap nonaktif')
  const tahapLama = () => op.call('GET', `${R}/dokumen?tahun=2027`).then((r) => JSON.parse(r.text).items.find((d) => d.id === did).tahap.find((t) => t.id === tid))
  status(await op.call('PUT', `${R}/dokumen/${did}/tahap/${tid}`, { isian: { tanggal: '2027-02-02' }, version: (await tahapLama()).version }, true), 200, 'ubah tahap lama yang nonaktif')
  status(await op.call('DELETE', `${R}/dokumen/${did}/tahap/${tid}`, null, true), 200, 'hapus tahap lama yang nonaktif')

  // Pulihkan: semua aktif kembali.
  status(await put('lap_lra', body(version)), 200, 'nyalakan kembali')
  status(await op.call('POST', `${R}/dokumen/${did}/tahap`, { pekerjaan: 'unduh_myinterest', isian: {} }, true), 201, 'tahap bisa ditambah lagi')
}
