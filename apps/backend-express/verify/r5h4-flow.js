/**
 * Verifikasi R5H4 dari ujung ke ujung: arahan ke jabatan / seluruh bagian /
 * Paur, keanggotaan Paur lewat admin, dan paritas byte dua backend.
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_PEER_BASE=http://api-express:8080 harness verify/r5h4-flow.js
 *
 * MENULIS KE DATABASE (surat, arahan, distribusi, keanggotaan Paur dua akun
 * Subbagsumda). Jalankan terhadap database pengembangan, bukan produksi.
 */
import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }

async function actorFor(base, username) {
  const id = username === 'superadmin' ? await db.superadminUserId() : await db.userIdByUsername(username)
  const client = new HttpClient({ ...config, apiBase: base })
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
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 140)}`
const today = new Date().toISOString().slice(0, 10)
const tag = Date.now()

async function intake(author, classification) {
  const res = await author.client.request('POST', '/api/v1/urmin/surat-masuk/intake', {
    withCsrf: true,
    multipart: [{ name: 'payload', value: JSON.stringify({
      letterNumber: `R5H4/${classification}/${tag}`, sender: 'Biro SDM Polda', letterDate: today, receivedDate: today,
      subject: `Uji R5H4 ${classification} ${tag}`, classification, derajat: 'biasa', reason: 'Pengujian arahan ke bagian dan Paur',
      letterKind: 'pemberitahuan', needsDisposition: true, mode: 'submit',
    }) }],
  })
  const body = JSON.parse(Buffer.from(res.bytes).toString('utf8'))
  return { status: res.status, id: body?.item?.id }
}

async function main() {
  await db.ping()
  const base = config.apiBase
  const A = {}
  for (const u of ['superadmin', 'kabagrenmin', 'ka-urmin', 'staf-urmin', 'op-urmin', 'kasubbagren', 'op-subbagren',
    'staf-subbagren', 'kasubbagsumda', 'op-subbagsumda', 'staf-subbagsumda', 'staf-subbagbinfung']) A[u] = await actorFor(base, u)
  const name = {}; for (const [u, a] of Object.entries(A)) name[a.id] = u

  log(`\n1. Keanggotaan Paur (admin) · ${base}`)
  let r = await call(A.superadmin, 'GET', '/api/v1/admin/paur')
  check('GET /admin/paur: tiga Paur', r.status === 200 && JSON.stringify(r.body.items.map((i) => i.key)) === '["paur_ada","paur_log","paur_sumda"]', short(r))
  r = await call(A.kabagrenmin, 'GET', '/api/v1/admin/paur')
  check('Kabagrenmin ditolak dari /admin/paur', r.status === 403, `HTTP ${r.status}`)
  r = await call(A.superadmin, 'PUT', `/api/v1/admin/users/${A['staf-subbagsumda'].id}/paur`, { paurKey: 'paur_sumda', isHead: false, reason: 'Penempatan uji R5H4' })
  check('staf-subbagsumda -> Paur Sumda', r.status === 200, short(r))
  r = await call(A.superadmin, 'PUT', `/api/v1/admin/users/${A['op-subbagsumda'].id}/paur`, { paurKey: 'paur_log', isHead: true, reason: 'Penempatan uji R5H4' })
  check('op-subbagsumda -> kepala Paur Log', r.status === 200 && r.body.isHead === true, short(r))
  r = await call(A.superadmin, 'PUT', `/api/v1/admin/users/${A.kasubbagren.id}/paur`, { paurKey: 'paur_log', isHead: false, reason: 'Salah unit, harus ditolak' })
  check('anggota unit lain ditolak (paur_unit_mismatch)', r.status === 400 && r.body?.error === 'paur_unit_mismatch', short(r))
  r = await call(A.superadmin, 'PUT', `/api/v1/admin/users/${A['staf-subbagsumda'].id}/paur`, { paurKey: null, isHead: true, reason: 'Kepala tanpa Paur' })
  check('isHead tanpa Paur ditolak 400', r.status === 400, short(r))
  r = await call(A.superadmin, 'PUT', `/api/v1/admin/users/${A['staf-subbagsumda'].id}/paur`, { paurKey: 'paur_sarpras', isHead: false, reason: 'Paur tidak dikenal' })
  check('Paur tak dikenal ditolak 400', r.status === 400, short(r))
  r = await call(A.superadmin, 'PUT', `/api/v1/admin/users/${A['staf-subbagsumda'].id}/paur`, { paurKey: 'paur_sumda', reason: 'Penempatan uji R5H4', extra: 1 })
  check('field asing ditolak 400 invalid_request', r.status === 400 && r.body?.error === 'invalid_request', short(r))

  log('\n2. Daftar pilihan tujuan (GET /sections)')
  r = await call(A.kabagrenmin, 'GET', '/api/v1/leadership/directives/sections')
  const sec = Object.fromEntries((r.body?.items ?? []).map((i) => [i.key, i]))
  const who = (k) => (sec[k]?.holders ?? []).map((h) => name[h.id] ?? h.name).sort().join(',')
  check('sebelas pilihan, urutan tetap', (r.body?.items ?? []).map((i) => i.key).join(',') ===
    'kasubbagren,kasubbagsumda,kasubbagbinfung,kasubbagurmin,subbagren,subbagsumda,subbagbinfung,urmin,paur_sumda,paur_log,paur_ada')
  check('jabatan Kasubbagren = kepalanya saja', who('kasubbagren') === 'kasubbagren', who('kasubbagren'))
  check('bagian Subbagren = kepala + operator + staf', who('subbagren') === 'kasubbagren,op-subbagren,staf-subbagren', who('subbagren'))
  check('bagian Urmin = Ka Urmin + operator + staf (tanpa Kabagrenmin)', who('urmin') === 'ka-urmin,op-urmin,staf-urmin', who('urmin'))
  check('Paur Sumda = anggotanya', who('paur_sumda') === 'staf-subbagsumda', who('paur_sumda'))
  check('Paur Log = kepalanya', who('paur_log') === 'op-subbagsumda', who('paur_log'))
  check('Paur ADA kosong', who('paur_ada') === '', who('paur_ada') || '(kosong)')
  check('kind tercantum', sec.kasubbagren?.kind === 'jabatan' && sec.urmin?.kind === 'bagian' && sec.paur_log?.kind === 'paur')

  log('\n3. Arahan + surat BIASA ke seluruh Subbagren DAN jabatan Kasubbagren (duplikat disaring)')
  const L1 = await intake(A['staf-urmin'], 'biasa')
  check('surat biasa tercatat', L1.status === 201)
  let inbox = await call(A.kabagrenmin, 'GET', '/api/v1/urmin/distribution-inbox/')
  let d = inbox.body.items.find((x) => x.incomingId === L1.id)
  await call(A.kabagrenmin, 'POST', `/api/v1/urmin/distribution-inbox/${d.id}/receive`, { reason: 'Diterima untuk arahan' })
  r = await call(A.kabagrenmin, 'POST', '/api/v1/leadership/directives', {
    title: `Arahan seluruh Subbagren ${tag}`, body: 'Seluruh personel Subbagren mohon menindaklanjuti.', kind: 'persuratan', priority: 'biasa',
    sections: ['kasubbagren', 'subbagren'], incomingId: L1.id,
  })
  check('arahan terkirim', r.status === 201, short(r))
  const dir1 = r.body?.id
  r = await call(A.kabagrenmin, 'GET', `/api/v1/leadership/directives/${dir1}`)
  const rec1 = (r.body?.recipients ?? []).map((x) => `${name[x.id]}[${x.section}]`).sort().join(' ')
  check('tiga penerima, Kasubbagren tercatat sekali lewat jabatan', rec1 === 'kasubbagren[kasubbagren] op-subbagren[subbagren] staf-subbagren[subbagren]', rec1)
  for (const u of ['kasubbagren', 'op-subbagren', 'staf-subbagren']) {
    const ib = await call(A[u], 'GET', '/api/v1/leadership/directives/inbox')
    const di = await call(A[u], 'GET', '/api/v1/urmin/distribution-inbox/')
    check(`${u}: arahan masuk & surat diserahkan`, ib.body.items.some((x) => x.id === dir1) && di.body.items.some((x) => x.incomingId === L1.id))
  }
  const other = await call(A['staf-subbagbinfung'], 'GET', '/api/v1/leadership/directives/inbox')
  check('staf bagian lain tidak menerima', !other.body.items.some((x) => x.id === dir1))

  log('\n4. Surat RAHASIA ke seluruh Subbagren: arahan ke semua, naskah hanya ke yang berwenang')
  const L2 = await intake(A['ka-urmin'], 'penting')
  check('surat rahasia tercatat (Ka Urmin)', L2.status === 201, `HTTP ${L2.status}`)
  inbox = await call(A.kabagrenmin, 'GET', '/api/v1/urmin/distribution-inbox/')
  d = inbox.body.items.find((x) => x.incomingId === L2.id)
  await call(A.kabagrenmin, 'POST', `/api/v1/urmin/distribution-inbox/${d.id}/receive`, { reason: 'Diterima untuk arahan' })
  r = await call(A.kabagrenmin, 'POST', '/api/v1/leadership/directives', {
    title: `Arahan rahasia Subbagren ${tag}`, body: 'Tindak lanjuti surat rahasia terlampir.', kind: 'persuratan', priority: 'penting',
    sections: ['subbagren'], incomingId: L2.id,
    sheet: { letterFrom: 'Biro SDM Polda', letterNumber: `R5H4/penting/${tag}`, directiveDate: today, letterDate: today, subject: 'Rahasia',
      classification: 'penting', derajat: 'biasa', dispositions: [], dispositionNote: '', agendaNo: null },
  })
  check('arahan rahasia TERKIRIM (dulu 400)', r.status === 201, short(r))
  const dir2 = r.body?.id
  for (const [u, letter] of [['kasubbagren', true], ['op-subbagren', false], ['staf-subbagren', false]]) {
    const ib = await call(A[u], 'GET', '/api/v1/leadership/directives/inbox')
    const di = await call(A[u], 'GET', '/api/v1/urmin/distribution-inbox/')
    const att = await call(A[u], 'GET', `/api/v1/urmin/surat-masuk/${L2.id}/attachments`)
    const hasLetter = di.body.items.some((x) => x.incomingId === L2.id)
    check(`${u}: arahan ada; naskah ${letter ? 'terbuka' : 'TERTUTUP'}`,
      ib.body.items.some((x) => x.id === dir2) && hasLetter === letter && (letter ? att.status === 200 : att.status !== 200),
      `distribusi=${hasLetter}, lampiran HTTP ${att.status}`)
  }

  log('\n5. Bagian Urmin & Paur')
  r = await call(A.kabagrenmin, 'POST', '/api/v1/leadership/directives', {
    title: `Arahan seluruh Urmin dan Paur Sumda ${tag}`, body: 'Siapkan rekap agenda minggu depan.', kind: 'umum', priority: 'biasa',
    sections: ['urmin', 'paur_sumda'],
  })
  check('arahan ke Urmin + Paur Sumda terkirim', r.status === 201, short(r))
  const dir3 = r.body?.id
  r = await call(A.kabagrenmin, 'GET', `/api/v1/leadership/directives/${dir3}`)
  const rec3 = (r.body?.recipients ?? []).map((x) => name[x.id]).sort().join(',')
  check('penerima = Ka Urmin, op-urmin, staf-urmin, staf-subbagsumda', rec3 === 'ka-urmin,op-urmin,staf-subbagsumda,staf-urmin', rec3)
  const notPaur = await call(A['op-subbagsumda'], 'GET', '/api/v1/leadership/directives/inbox')
  check('anggota Paur lain tidak menerima', !notPaur.body.items.some((x) => x.id === dir3))
  r = await call(A.kabagrenmin, 'POST', '/api/v1/leadership/directives', {
    title: 'Arahan Paur kosong', body: 'Pilihan tanpa anggota harus ditolak.', kind: 'umum', priority: 'biasa', sections: ['paur_ada'],
  })
  check('Paur tanpa anggota ditolak 400', r.status === 400, `HTTP ${r.status}`)

  const peer = process.env.SDL_HARNESS_PEER_BASE?.trim()
  if (peer) {
    log(`\n6. Paritas byte terhadap ${peer}`)
    const P = { kabagrenmin: await actorFor(peer, 'kabagrenmin'), superadmin: await actorFor(peer, 'superadmin'), 'staf-subbagren': await actorFor(peer, 'staf-subbagren') }
    for (const [u, path] of [['kabagrenmin', '/api/v1/leadership/directives/sections'], ['superadmin', '/api/v1/admin/paur'],
      ['kabagrenmin', `/api/v1/leadership/directives/${dir1}`], ['staf-subbagren', '/api/v1/leadership/directives/inbox']]) {
      const a = await call(A[u], 'GET', path); const b = await call(P[u], 'GET', path)
      check(`${path} byte-identik`, a.status === b.status && a.text === b.text, a.text === b.text ? '' : `${a.text.slice(0, 100)}\n            vs ${b.text.slice(0, 100)}`)
    }
  }
  log(`\n${fail === 0 ? 'SEMUA LULUS' : `${fail} GAGAL`} · ${base}`)
}

try { await main() } catch (e) { fail++; console.error('ERROR', e.stack) } finally { await db.revokeMintedSessions(); await db.close() }
process.exit(fail === 0 ? 0 : 1)
