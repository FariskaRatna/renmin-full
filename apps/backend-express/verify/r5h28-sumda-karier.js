/**
 * Verifikasi R5H28: Subbagsumda Karier & Mutasi (migrasi 069). EXPRESS SAJA:
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h28-sumda-karier.js
 *
 * Yang dijaga: alur per jenis + penerapan ke Master Personel (K2/K21) · maker-checker di SQL dan CHECK
 * DB (K3/K9/K19) · transisi tidak sah · satu pengajuan terbuka per jenis (K11) · personel berubah/
 * terarsip/tidak aktif/belum lengkap (K10/K20/K26/K27) · validasi setara R5H27 · lampiran PDF
 * tersegel (K4/K12/K17/K22/K25) · audit tanpa data pribadi (K23) · aditif R5H27 (K13/K14).
 *
 * MENULIS KE DATABASE (personel berawalan UJI-R5H28-, dihapus di awal dan di akhir beserta pengajuan,
 * lampiran, riwayat, dan auditnya). Hanya untuk database pengembangan.
 */
import pg from 'pg'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2, options: '-c timezone=UTC' })
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }
const K = '/api/v1/subbagsumda/karier'
const PER = '/api/v1/subbagsumda/personel'
const DASH = '/api/v1/subbagsumda/dashboard'
const PREFIX = 'UJI-R5H28-'
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>> endobj\ntrailer <</Root 1 0 R>>\n%%EOF\n', 'latin1')

async function actorFor(username) {
  const id = username === 'superadmin' ? await db.superadminUserId() : await db.userIdByUsername(username)
  const client = new HttpClient({ ...config })
  client.setCookie('sdl_session', await db.mintSession(id))
  await client.ensureCsrf()
  return { id, username, client }
}
async function call(a, method, path, body, extra = {}) {
  const res = await a.client.request(method, path, { withCsrf: method !== 'GET', ...(body !== undefined ? { body } : {}), ...extra })
  const bytes = Buffer.from(res.bytes)
  const text = bytes.toString('utf8')
  let json = null; try { json = JSON.parse(text) } catch {}
  return { status: res.status, body: json, text, bytes, headers: res.headers }
}
const unggah = (a, id, bytes, filename = 'sk.pdf') => call(a, 'POST', `${K}/${id}/lampiran`, undefined, { multipart: [{ name: 'file', filename, contentType: 'application/pdf', bytes }] })
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 160)}`

async function bersihkan() {
  const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
  if (!pids.length) return
  const kids = (await sql.query('SELECT id::text FROM sdl_sumda_karier WHERE personel_id = ANY($1::uuid[])', [pids])).rows.map((r) => r.id)
  await sql.query('DELETE FROM sdl_sumda_karier WHERE id = ANY($1::uuid[])', [kids]) // riwayat & lampiran CASCADE
  await sql.query("DELETE FROM sdl_audit_events WHERE (subject_type='subbagsumda.karier' AND subject_id = ANY($1::text[])) OR (subject_type='subbagsumda.personel' AND subject_id = ANY($2::text[]))", [kids, pids])
  await sql.query('DELETE FROM sdl_sumda_pensiun_tinjau WHERE personel_id = ANY($1::uuid[])', [pids])
  await sql.query('DELETE FROM sdl_sumda_personel WHERE id = ANY($1::uuid[])', [pids])
}

async function main() {
  await db.ping()
  log(`\nBackend: ${config.apiBase}`)
  const nama = ['op-subbagsumda', 'staf-subbagsumda', 'kasubbagsumda', 'kabagrenmin']
  const mcp = (await sql.query('SELECT username FROM sdl_users WHERE username = ANY($1) AND must_change_password', [nama])).rows
  if (mcp.length) throw new Error(`Masih must_change_password: ${mcp.map((r) => r.username).join(', ')}`)
  const [op, staf, ka, kabag] = await Promise.all(nama.map(actorFor))
  await bersihkan()
  const rank = (await sql.query('SELECT code FROM sdl_polri_rank_master WHERE is_active ORDER BY sort_order LIMIT 2')).rows.map((r) => r.code)
  const personel = async (suffix, extra = {}) => {
    const r = await call(ka, 'POST', PER, { nrp: `${PREFIX}${suffix}`, nama: `Uji Karier ${suffix}`, jenis: 'Polri', pangkat: rank[0], jabatan: 'Staf Lama', unitKerja: 'Unit Lama', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '', ...extra })
    if (r.status !== 201) throw new Error(`buat personel ${suffix}: ${short(r)}`)
    return r.body.item
  }
  const baru = (pid, jenis, usulan = {}, extra = {}) => call(op, 'POST', K, { personelId: pid, jenis, nomorReferensi: `REF-${jenis}`, tanggalUsulan: '2026-11-01', tanggalEfektif: '', usulan, catatan: '', ...extra })
  const aksi = (a, item, act, extra = {}) => call(a, 'POST', `${K}/${item.id}/aksi`, { aksi: act, catatan: '', version: item.version, ...extra })
  const detail = async (id) => (await call(ka, 'GET', `${K}/${id}`)).body
  const sampaiDisetujui = async (item) => {
    const p1 = await aksi(op, item, 'proses'); const s = await aksi(ka, p1.body.item, 'setujui'); return s.body?.item
  }

  try {
    log('\n1. Hak akses & capabilities')
    const cap = {}
    for (const a of [op, staf, ka, kabag]) cap[a.username] = (await call(a, 'GET', `${K}/capabilities`)).body
    check('op/staf: baca + kelola, tanpa setuju', ['op-subbagsumda', 'staf-subbagsumda'].every((u) => cap[u].canRead && cap[u].canManage && !cap[u].canApprove), JSON.stringify(cap['op-subbagsumda']))
    check('kasubbag: semua', cap.kasubbagsumda.canRead && cap.kasubbagsumda.canManage && cap.kasubbagsumda.canApprove)
    check('kabagrenmin: baca saja', cap.kabagrenmin.canRead && !cap.kabagrenmin.canManage && !cap.kabagrenmin.canApprove)
    const sa = await actorFor('superadmin')
    check('Superadmin GET → 403', (await call(sa, 'GET', K)).status === 403)

    log('\n2. Alur per jenis + penerapan ke Master Personel')
    const pA = await personel('A')
    const ukp = await baru(pA.id, 'UKP', { pangkat: rank[1] })
    check('buat UKP → 201 Diajukan', ukp.status === 201 && ukp.body.item.status === 'Diajukan', short(ukp))
    check('kabagrenmin buat → 403', (await call(kabag, 'POST', K, { personelId: pA.id, jenis: 'KGB', nomorReferensi: '', tanggalUsulan: '2026-11-01', tanggalEfektif: '', usulan: {}, catatan: '' })).status === 403)
    const ukpOk = await sampaiDisetujui(ukp.body.item)
    check('UKP diproses op, disetujui Kasubbag → Disetujui', ukpOk?.status === 'Disetujui', JSON.stringify(ukpOk?.status))
    const pv = (await call(ka, 'GET', `${PER}/${pA.id}`)).body.item.version
    const sUkp = await aksi(op, ukpOk, 'selesai', { tanggalEfektif: '2026-12-01', terapkan: { pangkat: rank[1], personelVersion: pv } })
    const pA2 = (await call(ka, 'GET', `${PER}/${pA.id}`)).body.item
    check('UKP selesai → pangkat berubah, versi personel +1', sUkp.status === 200 && pA2.pangkat === rank[1] && pA2.version === pv + 1, short(sUkp))
    check('diterapkan memuat lama→baru', sUkp.body?.item?.diterapkan?.fields?.pangkat?.lama === rank[0] && sUkp.body.item.diterapkan.fields.pangkat.baru === rank[1])
    const rw = await detail(ukp.body.item.id)
    check('riwayat Diajukan→Diproses→Disetujui→Selesai', rw.riwayat.map((h) => h.ke).join('>') === 'Diajukan>Diproses>Disetujui>Selesai', rw.riwayat.map((h) => h.ke).join('>'))

    const mut = await baru(pA.id, 'MUTASI', { jabatan: 'Analis Baru', unitKerja: 'Unit Baru' })
    const mutOk = await sampaiDisetujui(mut.body.item)
    const sMut = await aksi(staf, mutOk, 'selesai', { tanggalEfektif: '2026-12-02', terapkan: { jabatan: 'Analis Baru', unitKerja: 'Unit Baru Dikoreksi', personelVersion: pA2.version } })
    const pA3 = (await call(ka, 'GET', `${PER}/${pA.id}`)).body.item
    check('MUTASI selesai (dikoreksi) → jabatan + unit berubah', sMut.status === 200 && pA3.jabatan === 'Analis Baru' && pA3.unitKerja === 'Unit Baru Dikoreksi', short(sMut))

    const pj = await baru(pA.id, 'PENYESUAIAN_JABATAN', { jabatan: 'Kaur Baru' })
    const pjOk = await sampaiDisetujui(pj.body.item)
    const sPj = await aksi(op, pjOk, 'selesai', { tanggalEfektif: '2026-12-03', terapkan: { jabatan: 'Kaur Baru', personelVersion: pA3.version } })
    check('PENYESUAIAN_JABATAN selesai → jabatan berubah', sPj.status === 200 && (await call(ka, 'GET', `${PER}/${pA.id}`)).body.item.jabatan === 'Kaur Baru', short(sPj))

    const pvKgb = (await call(ka, 'GET', `${PER}/${pA.id}`)).body.item.version
    const kgb = await baru(pA.id, 'KGB', {})
    const kgbOk = await sampaiDisetujui(kgb.body.item)
    const sKgb = await aksi(op, kgbOk, 'selesai', { tanggalEfektif: '2026-12-04' })
    check('KGB selesai → master tetap, diterapkan {}', sKgb.status === 200 && JSON.stringify(sKgb.body.item.diterapkan) === '{}' && (await call(ka, 'GET', `${PER}/${pA.id}`)).body.item.version === pvKgb, short(sKgb))
    check('KGB dengan nilai usulan → 400', (await baru(pA.id, 'KGB', { pangkat: rank[1] })).status === 400)

    log('\n3. Maker-checker')
    const pB = await personel('B')
    const kaBuat = await call(ka, 'POST', K, { personelId: pB.id, jenis: 'KGB', nomorReferensi: '', tanggalUsulan: '2026-11-01', tanggalEfektif: '', usulan: {}, catatan: '' })
    const kaProses = await aksi(op, kaBuat.body.item, 'proses')
    const self = await aksi(ka, kaProses.body.item, 'setujui')
    check('Kasubbag menyetujui catatannya sendiri → 403 self_review_forbidden', self.status === 403 && self.body?.error === 'self_review_forbidden', short(self))
    check('… status tetap Diproses', (await detail(kaBuat.body.item.id)).item.status === 'Diproses')
    const opBuat = await baru(pB.id, 'MUTASI', { unitKerja: 'Unit X' })
    const kaEdit = await call(ka, 'PATCH', `${K}/${opBuat.body.item.id}`, { nomorReferensi: 'REF-EDIT', tanggalUsulan: '2026-11-01', tanggalEfektif: '', usulan: { unitKerja: 'Unit Y' }, catatan: '', version: opBuat.body.item.version })
    const kaEditProses = await aksi(op, kaEdit.body.item, 'proses')
    const k19 = await aksi(ka, kaEditProses.body.item, 'setujui')
    check('K19: pengubah terakhir tidak bisa menyetujui → 403', k19.status === 403 && k19.body?.error === 'self_review_forbidden', short(k19))
    check('op/kabag tanpa hak setuju → 403', (await aksi(op, kaEditProses.body.item, 'setujui')).status === 403 && (await aksi(kabag, kaEditProses.body.item, 'setujui')).status === 403)
    let chk = ''
    try { await sql.query("UPDATE sdl_sumda_karier SET decided_by=created_by, decided_at=now() WHERE id=$1::uuid", [kaBuat.body.item.id]) } catch (e) { chk = e.code }
    check('CHECK DB: pemutus = pencatat → 23514', chk === '23514', chk)

    log('\n4. Transisi, K11, catatan wajib')
    const pC = await personel('C')
    const c1 = await baru(pC.id, 'UKP', { pangkat: rank[1] })
    check('setujui dari Diajukan → 409 status_tidak_sesuai', (await aksi(ka, c1.body.item, 'setujui')).body?.error === 'status_tidak_sesuai')
    check('selesai dari Diajukan → 409', (await aksi(op, c1.body.item, 'selesai', { tanggalEfektif: '2026-12-01', terapkan: { pangkat: rank[1], personelVersion: 1 } })).status === 409)
    check('terapkan pada aksi proses → 400', (await aksi(op, c1.body.item, 'proses', { terapkan: {} })).status === 400)
    const dup = await baru(pC.id, 'UKP', { pangkat: rank[1] })
    check('K11: UKP kedua terbuka → 409 pengajuan_ganda', dup.status === 409 && dup.body?.error === 'pengajuan_ganda', short(dup))
    check('jenis lain boleh → 201', (await baru(pC.id, 'KGB', {})).status === 201)
    check('tolak tanpa catatan → 400', (await aksi(ka, (await aksi(op, c1.body.item, 'proses')).body.item, 'tolak')).status === 400)
    const c1p = (await detail(c1.body.item.id)).item
    const tolak = await aksi(ka, c1p, 'tolak', { catatan: 'Berkas usulan belum lengkap' })
    check('tolak dengan catatan → Ditolak', tolak.body?.item?.status === 'Ditolak', short(tolak))
    check('aksi pada Ditolak → 409', (await aksi(op, tolak.body.item, 'batalkan', { catatan: 'Batal saja sekarang' })).status === 409)
    check('PATCH saat bukan Diajukan → 409', (await call(op, 'PATCH', `${K}/${c1.body.item.id}`, { nomorReferensi: '', tanggalUsulan: '2026-11-01', tanggalEfektif: '', usulan: { pangkat: rank[1] }, catatan: '', version: tolak.body.item.version })).status === 409)
    check('PATCH mengganti jenis → 400 invalid_body', (await call(op, 'PATCH', `${K}/${c1.body.item.id}`, { jenis: 'KGB', version: 1 })).body?.error === 'invalid_body')
    check('setelah Ditolak, UKP baru boleh → 201', (await baru(pC.id, 'UKP', { pangkat: rank[1] })).status === 201)
    const c3 = await baru(pC.id, 'MUTASI', { unitKerja: 'Unit Z' })
    check('batalkan oleh staf bukan pencatat → 403', (await aksi(staf, c3.body.item, 'batalkan', { catatan: 'Dibatalkan staf lain' })).status === 403)
    check('batalkan oleh pencatat → Dibatalkan', (await aksi(op, c3.body.item, 'batalkan', { catatan: 'Salah pilih jenis' })).body?.item?.status === 'Dibatalkan')

    log('\n5. Personel: berubah, terarsip, tidak aktif, belum lengkap')
    const pD = await personel('D')
    const d1 = await sampaiDisetujui((await baru(pD.id, 'UKP', { pangkat: rank[1] })).body.item)
    const pDv = (await call(ka, 'GET', `${PER}/${pD.id}`)).body.item
    await call(ka, 'PATCH', `${PER}/${pD.id}`, { nrp: pDv.nrp, nama: pDv.nama, jenis: 'Polri', pangkat: pDv.pangkat, jabatan: 'Diubah Sementara', unitKerja: pDv.unitKerja, tmtDinas: '', tanggalPensiun: pDv.tanggalPensiun, status: 'Aktif', catatan: '', version: pDv.version })
    const basi = await aksi(op, d1, 'selesai', { tanggalEfektif: '2026-12-01', terapkan: { pangkat: rank[1], personelVersion: pDv.version } })
    check('versi personel basi → 409 personel_berubah, tanpa sisa', basi.body?.error === 'personel_berubah' && (await detail(d1.id)).item.status === 'Disetujui', short(basi))
    check('tanggalEfektif kosong → 400', (await aksi(op, d1, 'selesai', { terapkan: { pangkat: rank[1], personelVersion: pDv.version + 1 } })).status === 400)
    check('pangkat bukan master → 400 invalid_rank', (await aksi(op, d1, 'selesai', { tanggalEfektif: '2026-12-01', terapkan: { pangkat: 'PALSU', personelVersion: pDv.version + 1 } })).body?.error === 'invalid_rank')
    const pE = await personel('E', { status: 'Pensiun' })
    check('K20: buat untuk personel Pensiun → 409 personel_tidak_aktif', (await baru(pE.id, 'KGB', {})).body?.error === 'personel_tidak_aktif')
    const pF = await personel('F')
    await sql.query('UPDATE sdl_sumda_personel SET jenis=NULL, source_registry_id=gen_random_uuid() WHERE id=$1::uuid', [pF.id])
    check('K27: UKP untuk personel tanpa jenis → 409 personel_belum_lengkap', (await baru(pF.id, 'UKP', { pangkat: rank[1] })).body?.error === 'personel_belum_lengkap')
    const pG = await personel('G')
    const g1 = await baru(pG.id, 'MUTASI', { unitKerja: 'Unit G' })
    const pGv = (await call(ka, 'GET', `${PER}/${pG.id}`)).body.item
    await call(ka, 'DELETE', `${PER}/${pG.id}?version=${pGv.version}`)
    check('K26: personel terarsip → proses 409 personel_terarsip', (await aksi(op, g1.body.item, 'proses')).body?.error === 'personel_terarsip')
    check('K26: … tetapi boleh dibatalkan', (await aksi(op, g1.body.item, 'batalkan', { catatan: 'Personel sudah diarsip' })).body?.item?.status === 'Dibatalkan')

    log('\n6. Validasi setara R5H27')
    const pH = await personel('H')
    check('nomor referensi zero-width → 400', (await baru(pH.id, 'KGB', {}, { nomorReferensi: 'SK​1' })).status === 400)
    check('jabatan pembalik arah → 400', (await baru(pH.id, 'PENYESUAIAN_JABATAN', { jabatan: 'Ka‮ur' })).status === 400)
    check('jabatan 201 karakter → 400', (await baru(pH.id, 'PENYESUAIAN_JABATAN', { jabatan: 'j'.repeat(201) })).status === 400)
    check('field asing → 400 invalid_body', (await baru(pH.id, 'KGB', {}, { x: 1 })).body?.error === 'invalid_body')
    check('usulan berkunci asing → 400', (await baru(pH.id, 'MUTASI', { unitKerja: 'U', pangkat: rank[1] })).status === 400)
    check('personelId bukan UUID → 400', (await baru('bukan-uuid', 'KGB', {})).status === 400)

    log('\n7. Lampiran PDF tersegel')
    const l1 = (await baru(pH.id, 'KGB', {})).body.item
    const up = await unggah(op, l1.id, PDF)
    check('unggah PDF → 201', up.status === 201, short(up))
    const row = (await sql.query("SELECT substring(body FROM 1 FOR 4) AS head, position('%PDF'::bytea IN body) AS pos FROM sdl_sumda_karier_lampiran WHERE id=$1::uuid", [up.body?.id])).rows[0]
    check('body diawali SDL1 dan tanpa %PDF', row?.head?.toString('latin1') === 'SDL1' && row.pos === 0)
    const dl = await call(kabag, 'GET', `${K}/${l1.id}/lampiran/${up.body?.id}`)
    check('kabag unduh → byte-identik + header aman', dl.status === 200 && dl.bytes.equals(PDF) && /attachment/.test(dl.headers.get('content-disposition') ?? '') && dl.headers.get('x-content-type-options') === 'nosniff', `HTTP ${dl.status}`)
    check('K22: unggah menaikkan versi pengajuan', (await detail(l1.id)).item.version === l1.version + 1)
    check('bukan PDF → 400 invalid_file_type', (await unggah(op, l1.id, Buffer.from('bukan pdf'), 'x.pdf')).body?.error === 'invalid_file_type')
    check('nama .exe → 400', (await unggah(op, l1.id, PDF, 'a.exe')).status === 400)
    const besar = Buffer.concat([PDF.subarray(0, 9), Buffer.alloc(5 * 1024 * 1024 + 10, 0x20), Buffer.from('\n%%EOF\n')])
    check('> 5 MB → 413 file_too_large', (await unggah(op, l1.id, besar)).status === 413)
    check('kabag unggah → 403', (await unggah(kabag, l1.id, PDF)).status === 403)
    const l2 = (await baru(pH.id, 'MUTASI', { unitKerja: 'Unit H' })).body.item
    check('lid silang (lampiran pengajuan lain) → 404', (await call(op, 'GET', `${K}/${l2.id}/lampiran/${up.body?.id}`)).status === 404)
    check('hapus oleh staf (bukan pengunggah/Kasubbag) → 403', (await call(staf, 'DELETE', `${K}/${l1.id}/lampiran/${up.body?.id}`)).status === 403)
    for (let i = 0; i < 9; i++) await unggah(op, l1.id, PDF, `sk${i}.pdf`)
    check('lampiran ke-11 → 409 batas_lampiran', (await unggah(op, l1.id, PDF)).body?.error === 'batas_lampiran')
    const l1ok = await sampaiDisetujui((await detail(l1.id)).item)
    check('hapus setelah Disetujui → 409', (await call(op, 'DELETE', `${K}/${l1.id}/lampiran/${up.body?.id}`)).status === 409, JSON.stringify(l1ok?.status))
    await sql.query("UPDATE sdl_sumda_karier_lampiran SET body = overlay(body PLACING '\\x00'::bytea FROM 40 FOR 1) WHERE id=$1::uuid", [up.body?.id])
    check('body dirusak → 503 evidence_integrity_failure', (await call(op, 'GET', `${K}/${l1.id}/lampiran/${up.body?.id}`)).body?.error === 'evidence_integrity_failure')

    log('\n8. Audit tanpa data pribadi')
    const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
    const kids = (await sql.query('SELECT id::text FROM sdl_sumda_karier WHERE personel_id = ANY($1::uuid[])', [pids])).rows.map((r) => r.id)
    const ev = (await sql.query("SELECT event_key, metadata::text AS m FROM sdl_audit_events WHERE subject_type='subbagsumda.karier' AND subject_id = ANY($1::text[])", [kids])).rows
    const keys = new Set(ev.map((e) => e.event_key.replace('subbagsumda.karier.', '')))
    check('event tercatat lengkap', ['create', 'update', 'proses', 'setujui', 'tolak', 'batalkan', 'selesai', 'lampiran.add', 'lampiran.download'].every((k) => keys.has(k)), [...keys].join(','))
    check('metadata tanpa NRP/nama/nilai/nama berkas', ev.every((e) => !e.m.includes(PREFIX) && !e.m.includes('Uji ') && !e.m.includes('Analis') && !e.m.includes('.pdf') && !e.m.includes(rank[1])))
    const pu = (await sql.query("SELECT metadata FROM sdl_audit_events WHERE event_key='subbagsumda.personel.update' AND subject_id=$1 ORDER BY id DESC LIMIT 1", [pA.id])).rows[0]
    check('K23: Selesai juga mencatat personel.update {fields}', Array.isArray(pu?.metadata?.fields), JSON.stringify(pu?.metadata))

    log('\n9. Aditif R5H27 (riwayat & dashboard)')
    const det = (await call(kabag, 'GET', `${PER}/${pA.id}`)).body.item
    check('GET /personel/:id memuat riwayatKarier terbaru di atas', det.riwayatKarier?.length === 4 && det.riwayatKarier[0].jenis === 'KGB', JSON.stringify(det.riwayatKarier?.map((r) => r.jenis)))
    const patchResp = await call(ka, 'PATCH', `${PER}/${pH.id}`, { nrp: `${PREFIX}H`, nama: 'Uji Karier H', jenis: 'Polri', pangkat: rank[0], jabatan: 'Staf Lama', unitKerja: 'Unit Lama', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '', version: (await call(ka, 'GET', `${PER}/${pH.id}`)).body.item.version })
    check('respons PATCH personel tanpa riwayatKarier', patchResp.status === 200 && !('riwayatKarier' in patchResp.body.item))
    const d0 = (await call(kabag, 'GET', DASH)).body.totals.karierMenunggu
    const pI = await personel('I')
    await aksi(op, (await baru(pI.id, 'KGB', {})).body.item, 'proses')
    check('dashboard karierMenunggu +1', (await call(kabag, 'GET', DASH)).body.totals.karierMenunggu === d0 + 1)
    const lst = await call(kabag, 'GET', `${K}?q=${encodeURIComponent(PREFIX)}&status=Selesai&size=10`)
    check('daftar: filter status + q', lst.status === 200 && lst.body.total === 4, short(lst))
    check('daftar: size 7 → 400, personelId bukan UUID → 400', (await call(kabag, 'GET', `${K}?size=7`)).status === 400 && (await call(kabag, 'GET', `${K}?personelId=x`)).status === 400)
  } finally {
    await bersihkan()
    await db.revokeMintedSessions().catch(() => {})
  }

  log(`\n${fail ? `GAGAL: ${fail} pemeriksaan` : 'LULUS: semua pemeriksaan'}\n`)
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await sql.end(); await db.close(); process.exit(fail ? 1 : 0) })
