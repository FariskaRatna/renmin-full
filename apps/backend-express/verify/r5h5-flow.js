/**
 * Verifikasi R5H5 dari ujung ke ujung, lewat HTTP ke backend yang ditunjuk
 * SDL_HARNESS_API_BASE (jalankan sekali untuk Go, sekali untuk Express):
 *
 *   1. Seluruh Disposisi — op-urmin (scope unit) melihat surat ke Kabagrenmin
 *   2. No. Agenda arahan — agendaSurat dari surat keluar PERTAMA yang merujuk
 *   3. Berkas pendukung — lolos kunci surat keluar, tidak memengaruhi
 *      persetujuan, lampiran tetap terkunci
 *   4. Rentang aktif disposisi ±15 hari
 *   5. Sumber berkas arsip disposisi dapat dibaca
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node harness verify/r5h5-flow.js
 *   docker compose $CLI run --rm --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h5-flow.js
 *
 * MENULIS KE DATABASE (surat keluar uji + berkas kecil). Hanya untuk database
 * pengembangan, bukan produksi.
 */
import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'
import pg from 'pg'

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
async function call(a, method, path, body, extra = {}) {
  const res = await a.client.request(method, path, { withCsrf: method !== 'GET', ...(body !== undefined ? { body } : {}), ...extra })
  const text = Buffer.from(res.bytes).toString('utf8')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text }
}
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 160)}`
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const tag = Date.now().toString().slice(-6)

function upload(a, workId, name, purpose) {
  const parts = [{ name: 'file', filename: name, contentType: 'application/pdf', bytes: PDF }]
  if (purpose !== undefined) parts.push({ name: 'purpose', value: purpose })
  return a.client.request('POST', `/api/v1/unit-work/urmin/records/${workId}/files`, { withCsrf: true, multipart: parts })
    .then((res) => { const text = Buffer.from(res.bytes).toString('utf8'); let body = null; try { body = JSON.parse(text) } catch {} ; return { status: res.status, body, text } })
}
async function createSuratKeluar(a, title, rujukanArahanId) {
  const fields = {
    tujuan: 'Kepala Bagian Uji', tanggalSurat: new Date().toISOString().slice(0, 10), perihal: title,
    sifatSurat: 'Biasa', statusAdministrasi: 'Draft', jenisSurat: 'ND', kodeArsip: 'HUM.1.2.', unitNomor: 'Bagrenmin',
  }
  if (rujukanArahanId !== undefined) fields.rujukanArahanId = rujukanArahanId
  return call(a, 'POST', '/api/v1/urmin/registry/', { kind: 'surat_keluar', code: `R5H5-${tag}-${title.length}${Math.floor(Math.random() * 1e4)}`, title, classification: 'biasa', fields })
}

async function main() {
  await db.ping()
  log(`\nBackend: ${config.apiBase}`)
  const A = {}
  for (const u of ['ka-urmin', 'op-urmin', 'kabagrenmin', 'kasubbagren', 'op-subbagren', 'staf-subbagsumda']) A[u] = await actorFor(u)

  // ---------------------------------------------------------------- 1
  log('\n1. Seluruh Disposisi (register Surat Masuk)')
  const toKabag = new Set(['awaiting_kabag', 'read_kabag', 'directive_issued', 'dispatched', 'in_progress', 'awaiting_review'])
  const count = async (a) => {
    const r = await call(a, 'GET', '/api/v1/urmin/surat-masuk/')
    return { r, n: Object.values(r.body?.workflowStatuses ?? {}).filter((s) => toKabag.has(s)).length }
  }
  const op = await count(A['op-urmin'])
  const ka = await count(A['ka-urmin'])
  check('op-urmin membaca register', op.r.status === 200, short(op.r))
  check('op-urmin (scope unit) melihat surat ke Kabagrenmin sebanyak ka-urmin', op.n === ka.n && op.n > 3, `op-urmin ${op.n}, ka-urmin ${ka.n}`)

  // ---------------------------------------------------------------- 2
  log('\n2. No. Agenda arahan dari surat keluar')
  const inbox = await call(A['ka-urmin'], 'GET', '/api/v1/leadership/directives/inbox')
  let directive = null
  for (const d of inbox.body?.items ?? []) {
    const det = await call(A['ka-urmin'], 'GET', `/api/v1/leadership/directives/${d.id}`)
    if (det.status === 200 && det.body.agendaSurat === undefined) { directive = det.body; break }
  }
  check('ada arahan ka-urmin yang belum punya No. Agenda', directive !== null)
  let sk1 = null
  if (directive) {
    check('detail arahan tanpa surat keluar TIDAK memuat kunci agendaSurat', !('agendaSurat' in directive))
    const c1 = await createSuratKeluar(A['ka-urmin'], `Uji agenda pertama ${tag}`, directive.id)
    check('buat surat keluar #1 dengan rujukanArahanId', c1.status === 201, short(c1))
    sk1 = c1.body
    const r1 = await call(A['ka-urmin'], 'GET', `/api/v1/urmin/registry/${sk1.id}`)
    const nomor1 = r1.body?.fields?.nomorSurat
    const c2 = await createSuratKeluar(A['ka-urmin'], `Uji agenda kedua ${tag}`, directive.id)
    check('buat surat keluar #2 merujuk arahan yang sama', c2.status === 201, short(c2))
    const det = await call(A['ka-urmin'], 'GET', `/api/v1/leadership/directives/${directive.id}`)
    check('agendaSurat = nomor surat keluar PERTAMA', det.body?.agendaSurat === nomor1, `agendaSurat=${det.body?.agendaSurat} nomor#1=${nomor1}`)
    const keys = Object.keys(det.body ?? {})
    check('agendaSurat kunci terakhir sesudah sheet', keys[keys.length - 1] === 'agendaSurat', keys.slice(-3).join(','))
    const bad = await createSuratKeluar(A['ka-urmin'], `Uji agenda salah ${tag}`, 'bukan-uuid')
    check('rujukanArahanId bukan UUID ditolak 400', bad.status === 400, short(bad))
  }

  // ---------------------------------------------------------------- 3
  log('\n3. Berkas pendukung surat keluar')
  const sk = sk1 ?? (await createSuratKeluar(A['ka-urmin'], `Uji pendukung ${tag}`)).body
  const reg = await call(A['ka-urmin'], 'GET', `/api/v1/urmin/registry/${sk.id}`)
  const workId = reg.body?.workRecordId
  let r = await upload(A['ka-urmin'], workId, 'naskah.pdf')
  check('draf: unggah lampiran (tanpa purpose)', r.status === 201, short(r))
  r = await upload(A['ka-urmin'], workId, 'pendukung-1.pdf', 'pendukung')
  check('draf: unggah pendukung', r.status === 201, short(r))
  r = await upload(A['ka-urmin'], workId, 'x.pdf', 'lain')
  check('purpose tidak dikenal → 400 invalid_purpose', r.status === 400 && r.body?.error === 'invalid_purpose', short(r))
  let work = await call(A['ka-urmin'], 'GET', `/api/v1/unit-work/urmin/records/${workId}`)
  const files = work.body?.files ?? []
  const pend = files.filter((f) => f.purpose === 'pendukung')
  const lamp = files.filter((f) => !('purpose' in f))
  check('daftar berkas: purpose hanya pada pendukung', pend.length === 1 && lamp.length === 1, `pendukung ${pend.length}, lampiran ${lamp.length}`)

  const wf = await call(A['ka-urmin'], 'GET', `/api/v1/urmin/registry/${sk.id}/workflow`)
  r = await call(A['ka-urmin'], 'POST', `/api/v1/urmin/registry/${sk.id}/submit`, { version: wf.body?.version, note: 'Uji R5H5' })
  check('ajukan surat keluar', r.status === 200, short(r))
  r = await upload(A['ka-urmin'], workId, 'lampiran-telat.pdf')
  check('sesudah diajukan: lampiran DITOLAK 409 outgoing_locked', r.status === 409 && r.body?.error === 'outgoing_locked', short(r))
  r = await upload(A['ka-urmin'], workId, 'pendukung-2.pdf', 'pendukung')
  check('sesudah diajukan: pendukung DITERIMA', r.status === 201, short(r))
  const pend2 = r.body?.id
  r = await call(A['ka-urmin'], 'DELETE', `/api/v1/unit-work/urmin/records/${workId}/files/${pend2}`, {})
  check('sesudah diajukan: hapus pendukung DITERIMA', r.status === 200, short(r))
  r = await call(A['ka-urmin'], 'DELETE', `/api/v1/unit-work/urmin/records/${workId}/files/${lamp[0]?.id}`, {})
  check('sesudah diajukan: hapus lampiran DITOLAK 409', r.status === 409, short(r))
  r = await upload(A['ka-urmin'], workId, 'pendukung-3.pdf', 'pendukung')
  const wf2 = await call(A['kabagrenmin'], 'GET', `/api/v1/urmin/registry/${sk.id}/workflow`)
  r = await call(A['kabagrenmin'], 'POST', `/api/v1/urmin/registry/${sk.id}/approve`, { version: wf2.body?.version, note: 'Disetujui uji R5H5' })
  check('Kabagrenmin menyetujui walau pendukung berubah sesudah diajukan', r.status === 200, short(r))
  r = await upload(A['ka-urmin'], workId, 'bukti-kirim.pdf', 'pendukung')
  check('sesudah disetujui: pendukung tetap bisa ditambah', r.status === 201, short(r))

  // ---------------------------------------------------------------- 4
  log('\n4. Rentang aktif disposisi ±15 hari (data uji: surat -10 dan -20 hari)')
  const dayOffset = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  const taskFor = async (offset) => {
    const letterDate = dayOffset(offset)
    const res = await A['op-urmin'].client.request('POST', '/api/v1/urmin/surat-masuk/intake', {
      withCsrf: true,
      multipart: [{ name: 'payload', value: JSON.stringify({
        letterNumber: `R5H5/${offset}/${tag}`, sender: 'Biro Uji', letterDate, receivedDate: dayOffset(0),
        subject: `Uji rentang ${offset} hari ${tag}`, classification: 'biasa', derajat: 'biasa',
        reason: 'Pengujian rentang aktif disposisi', letterKind: 'pemberitahuan', needsDisposition: true, mode: 'submit',
      }) }],
    })
    const incoming = JSON.parse(Buffer.from(res.bytes).toString('utf8'))?.item?.id
    if (!incoming) return { error: `intake HTTP ${res.status} ${Buffer.from(res.bytes).toString('utf8').slice(0, 120)}` }
    // Surat intake hanya boleh diteruskan lewat Kabagrenmin: ia menerima
    // kirimannya dulu, baru meneruskan ke Kasubbagren.
    const { rows: kd } = await sql.query('SELECT id::text AS id FROM sdl_urmin_distributions WHERE incoming_id=$1 AND recipient_user=$2', [incoming, A.kabagrenmin.id])
    const kr = await call(A.kabagrenmin, 'POST', `/api/v1/urmin/distribution-inbox/${kd[0]?.id}/receive`, { reason: 'Diterima saat membuka detail' })
    if (kr.status !== 200) return { error: `Kabagrenmin menerima ${short(kr)}` }
    const dist = await call(A.kabagrenmin, 'POST', `/api/v1/urmin/surat-masuk/${incoming}/distributions`,
      { unit: 'subbagren', recipientId: A.kasubbagren.id, reason: 'Diteruskan untuk pengujian rentang aktif.' })
    if (dist.status !== 201 && dist.status !== 200) return { error: `distribusi ${short(dist)}` }
    const { rows } = await sql.query('SELECT id::text AS id FROM sdl_urmin_distributions WHERE incoming_id=$1 AND recipient_user=$2', [incoming, A.kasubbagren.id])
    const distId = rows[0]?.id
    const rcv = await call(A.kasubbagren, 'POST', `/api/v1/urmin/distribution-inbox/${distId}/receive`, { reason: 'Diterima untuk pengujian rentang.' })
    if (rcv.status !== 200) return { error: `terima ${short(rcv)}` }
    const iss = await call(A.kasubbagren, 'POST', `/api/v1/urmin/distribution-inbox/${distId}/dispositions`,
      { assigneeId: A['op-subbagren'].id, instruction: 'Mohon tindak lanjuti untuk pengujian rentang aktif.', dueDate: dayOffset(20) })
    if (iss.status !== 201 && iss.status !== 200) return { error: `disposisi ${short(iss)}` }
    const { rows: t } = await sql.query('SELECT id::text AS id FROM sdl_urmin_disposition_tasks WHERE incoming_id=$1', [incoming])
    return { id: t[0]?.id, letterDate }
  }
  const near = await taskFor(-10)
  const far = await taskFor(-20)
  check('data uji: tugas untuk surat -10 hari dibuat', Boolean(near.id), near.error ?? near.letterDate)
  check('data uji: tugas untuk surat -20 hari dibuat', Boolean(far.id), far.error ?? far.letterDate)
  if (near.id && far.id) {
    const active = await call(A['op-subbagren'], 'GET', '/api/v1/urmin/dispositions/?window=active')
    const all = await call(A['op-subbagren'], 'GET', '/api/v1/urmin/dispositions/?window=all')
    const inActive = new Set((active.body?.items ?? []).map((t) => t.id))
    const inAll = new Set((all.body?.items ?? []).map((t) => t.id))
    check('surat -10 hari TAMPIL di daftar aktif', inActive.has(near.id))
    check('surat -20 hari TIDAK tampil di daftar aktif (dulu tampil, batas ±30)', !inActive.has(far.id))
    check('surat -20 hari tetap ada di window=all', inAll.has(far.id))
  }

  // ---------------------------------------------------------------- 5
  log('\n5. Bukti tindak lanjut di arsip: pembaca arsip Urmin boleh membaca')
  if (!near.id || !far.id) log('  LEWAT  data uji bagian 4 tidak tersedia')
  else {
    const files = (a, id) => call(a, 'GET', `/api/v1/urmin/dispositions/${id}/attachments`)
    let r = await files(A['ka-urmin'], near.id)
    check('sebelum disetujui: ka-urmin (bukan pihak) DITOLAK 404', r.status === 404, short(r))

    const hist = async (a, id) => (await call(a, 'GET', `/api/v1/urmin/dispositions/${id}/history`)).body?.item
    let t = await hist(A['op-subbagren'], near.id)
    r = await call(A['op-subbagren'], 'POST', `/api/v1/urmin/dispositions/${near.id}/accept`, { reason: 'Diterima untuk uji arsip.', version: t.version })
    check('pelaksana menerima tugas', r.status === 200, short(r))
    const up = await A['op-subbagren'].client.request('POST', `/api/v1/urmin/dispositions/${near.id}/attachments`, {
      withCsrf: true,
      multipart: [{ name: 'file', filename: 'bukti-uji.pdf', contentType: 'application/pdf', bytes: PDF }, { name: 'reason', value: 'Bukti tindak lanjut uji arsip' }],
    })
    check('pelaksana mengunggah bukti', up.status === 201 || up.status === 200, `HTTP ${up.status}`)
    t = await hist(A['op-subbagren'], near.id)
    r = await call(A['op-subbagren'], 'POST', `/api/v1/urmin/dispositions/${near.id}/complete`, { reason: 'Selesai, bukti terlampir.', version: t.version })
    check('pelaksana menyelesaikan tugas', r.status === 200, short(r))
    t = await hist(A.kasubbagren, near.id)
    r = await call(A.kasubbagren, 'POST', `/api/v1/urmin/dispositions/${near.id}/review`, { decision: 'approved', reason: 'Hasil sesuai, disetujui.', version: t.version })
    check('penerbit menyetujui (arsip otomatis dibuat)', r.status === 200, short(r))

    r = await files(A['ka-urmin'], near.id)
    check('sesudah disetujui: ka-urmin (pembaca arsip) MEMBACA daftar bukti', r.status === 200 && r.body?.items?.length === 1, short(r))
    const fileId = r.body?.items?.[0]?.id
    if (fileId) {
      const dl = await A['ka-urmin'].client.request('GET', `/api/v1/urmin/dispositions/${near.id}/attachments/${fileId}/download`)
      check('sesudah disetujui: ka-urmin MENGUNDUH bukti', dl.status === 200 && Buffer.from(dl.bytes).subarray(0, 5).toString() === '%PDF-', `HTTP ${dl.status}`)
    }
    r = await files(A['staf-subbagsumda'], near.id)
    check('akun tanpa akses arsip Urmin tetap DITOLAK 404', r.status === 404, short(r))
    r = await files(A['ka-urmin'], far.id)
    check('tugas yang belum disetujui tetap DITOLAK untuk ka-urmin', r.status === 404, short(r))
    const up2 = await A['ka-urmin'].client.request('POST', `/api/v1/urmin/dispositions/${near.id}/attachments`, {
      withCsrf: true,
      multipart: [{ name: 'file', filename: 'x.pdf', contentType: 'application/pdf', bytes: PDF }, { name: 'reason', value: 'Mencoba unggah sebagai pembaca arsip' }],
    })
    check('pembaca arsip TIDAK bisa mengunggah (tetap 404)', up2.status === 404, `HTTP ${up2.status}`)
  }

  await db.revokeMintedSessions()
  log(`\n${fail === 0 ? 'LULUS' : `GAGAL — ${fail} pemeriksaan`}`)
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await db.close(); await sql.end(); process.exit(fail === 0 ? 0 : 1) })
