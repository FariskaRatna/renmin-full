/**
 * Verifikasi R5H9: kategori Arsip "Dari Surat Keluar" (surat keluar disetujui
 * > 7 hari) dan penghentian pengarsipan disposisi. EXPRESS SAJA:
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h9-flow.js
 *
 * Memundurkan approved_at satu surat keluar yang sudah disetujui selama uji,
 * lalu MENGEMBALIKANNYA. Hanya untuk database pengembangan.
 */
import pg from 'pg'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2 })
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }

async function actorFor(username) {
  const id = await db.userIdByUsername(username)
  const client = new HttpClient({ ...config })
  client.setCookie('sdl_session', await db.mintSession(id))
  await client.ensureCsrf()
  return { id, username, client }
}
async function call(a, method, path, body) {
  const res = await a.client.request(method, path, { withCsrf: method !== 'GET', ...(body !== undefined ? { body } : {}) })
  const text = Buffer.from(res.bytes).toString('utf8')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text }
}
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 160)}`
const list = (a, q) => call(a, 'GET', `/api/v1/urmin/registry/?${q}`)

const { rows: picked } = await sql.query(
  `SELECT s.id::text AS id,o.approved_at FROM sdl_urmin_registry s JOIN sdl_outgoing_workflows o ON o.register_id=s.id
    WHERE s.kind='surat_keluar' AND s.deleted_at IS NULL AND o.stage='approved'
    ORDER BY o.approved_at DESC LIMIT 2`,
)
if (picked.length < 2) {
  log('Butuh minimal 2 surat keluar berstatus disetujui di database pengembangan.')
  process.exit(1)
}
const [old, recent] = picked
await sql.query(`UPDATE sdl_outgoing_workflows SET approved_at=now()-interval '8 days' WHERE register_id=$1`, [old.id])
await sql.query(`UPDATE sdl_outgoing_workflows SET approved_at=now()-interval '6 days' WHERE register_id=$1`, [recent.id])

try {
  const ka = await actorFor('ka-urmin')
  const luar = await actorFor('staf-subbagsumda')

  log('\n1. Kategori "Dari Surat Keluar"')
  let r = await list(ka, 'kind=arsip&source=surat_keluar')
  const ids = (r.body?.items ?? []).map((i) => i.id)
  check('200 untuk source=surat_keluar', r.status === 200, short(r))
  check('surat keluar disetujui 8 hari lalu MASUK', ids.includes(old.id))
  check('surat keluar disetujui 6 hari lalu BELUM masuk', !ids.includes(recent.id))
  check('semua baris kind=surat_keluar', (r.body?.items ?? []).every((i) => i.kind === 'surat_keluar'))
  const row = (r.body?.items ?? []).find((i) => i.id === old.id)
  const expectAt = Date.now() - 1 * 24 * 3600 * 1000
  check('archivedAt = disetujui + 7 hari', row && Math.abs(new Date(row.archivedAt).getTime() - expectAt) < 120000, row?.archivedAt)

  log('\n2. Kategori lain')
  r = await list(ka, 'kind=arsip')
  check('Semua Arsip memuat surat keluar lama', (r.body?.items ?? []).some((i) => i.id === old.id), short(r))
  check('Semua Arsip tetap memuat arsip register (kind=arsip)', (r.body?.items ?? []).some((i) => i.kind === 'arsip'))
  r = await list(ka, 'kind=arsip&source=manual')
  check('Input Manual tanpa surat keluar', r.status === 200 && (r.body?.items ?? []).every((i) => i.kind === 'arsip' && i.fields?.sumber !== 'disposisi'), short(r))
  r = await list(ka, 'kind=arsip&source=disposisi')
  check('Dari Disposisi (lama) tanpa surat keluar', r.status === 200 && (r.body?.items ?? []).every((i) => i.kind === 'arsip' && i.fields?.sumber === 'disposisi'), short(r))
  r = await list(ka, 'kind=arsip&source=lainnya')
  check('source tak dikenal 400 invalid_source', r.status === 400 && r.body?.error === 'invalid_source', short(r))

  log('\n3. Daftar Surat Keluar tidak berubah')
  r = await list(ka, 'kind=surat_keluar')
  const sk = r.body?.items ?? []
  check('kedua surat tetap di daftar Surat Keluar', sk.some((i) => i.id === old.id) && sk.some((i) => i.id === recent.id), short(r))
  check('tanpa archivedAt di daftar Surat Keluar', sk.every((i) => i.archivedAt === undefined))
  r = await list(ka, 'kind=agenda&source=surat_keluar')
  check('kind lain + source=surat_keluar tidak memuat surat keluar', r.status === 200 && (r.body?.items ?? []).every((i) => i.kind === 'agenda'), short(r))

  log('\n4. Hak baca tetap berlaku')
  r = await list(luar, 'kind=arsip&source=surat_keluar')
  check('akun di luar Urmin tidak melihat surat keluar itu', r.status !== 200 || !(r.body?.items ?? []).some((i) => i.id === old.id), short(r))

  log('\n5. Pengarsipan disposisi dihentikan')
  const { rows: tasks } = await sql.query(
    `SELECT rv.disposition_id::text AS id FROM sdl_urmin_disposition_reviews rv
      WHERE rv.decision='approved' ORDER BY rv.created_at DESC LIMIT 1`,
  ).catch(() => ({ rows: [] }))
  if (!tasks.length) log('  LEWAT  tidak ada disposisi yang disetujui')
  else {
    r = await call(ka, 'POST', `/api/v1/urmin/dispositions/${tasks[0].id}/archive`)
    check('endpoint 143 tidak menulis arsip (409 disposition_archive_disabled, atau gerbang 403/404)',
      (r.status === 409 && r.body?.error === 'disposition_archive_disabled') || r.status === 403 || r.status === 404, short(r))
  }
} finally {
  await sql.query('UPDATE sdl_outgoing_workflows SET approved_at=$2 WHERE register_id=$1', [old.id, old.approved_at])
  await sql.query('UPDATE sdl_outgoing_workflows SET approved_at=$2 WHERE register_id=$1', [recent.id, recent.approved_at])
  log('\n(approved_at kedua surat dikembalikan)')
  await sql.end()
  await db.close?.()
}

log(fail ? `\nR5H9 GAGAL: ${fail} cek` : '\nR5H9 LULUS')
process.exit(fail ? 1 : 0)
