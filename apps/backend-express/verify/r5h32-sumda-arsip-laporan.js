/**
 * Verifikasi R5H32: Subbagsumda Persuratan & Arsip + Laporan & Analitik (migrasi 073). EXPRESS SAJA:
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h32-sumda-arsip-laporan.js
 *
 * Arsip: rumus retensi WIB (K35) · hak & capabilities (K6/K30) · isian K8 · K29 TERBATAS tersembunyi utuh (daftar, cari,
 * filter, hitungan, detail/mutasi/lampiran 404 byte-identik, detail personel, dashboard) · naik/turun kerahasiaan
 * (K13/K34) · Aktif ⇄ Inaktif → Musnah (K32) · tautan surat R5H21 (K30/K31, balapan) · lampiran (K33) · aditif R5H27
 * (K24/K25) · audit tanpa PII (K49).
 * Laporan (irisan B): angka cocok dengan SQL/endpoint acuan · blok null tanpa hak (K37) · selisih 0 arsip TERBATAS (K36)
 *   · unit kerja 15 + Lainnya (K38) · pangkat terurut (K39). Ekspor: matriks hak (K4) · format K20/K44 · formula injection
 *   · jumlah = total daftar · tanpa UUID · filter K42 · audit {modul,jumlah,filter} (K22/K49).
 * Akun tanpa arsip.read/inventaris.read/kinerja.read (role uji) diuji di skenario keamanan x7 (DB sekali pakai).
 *
 * MENULIS KE DATABASE (arsip/surat/personel berawalan UJI-R5H32-, dihapus di awal dan di akhir beserta turunannya
 * dan auditnya). Hanya untuk database pengembangan.
 */
import pg from 'pg'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'
import { tahapRetensiSql } from '../src/modules/subbagsumda/arsip.js'
import { BOM, sel } from '../src/modules/subbagsumda/csv.js'
import { MODUL_EKSPOR } from '../src/modules/subbagsumda/ekspor.js'
import { proyeksiPensiunSql } from '../src/modules/subbagsumda/personel.js'
import { hariDari } from '../src/modules/subbagsumda/umum.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2, options: '-c timezone=UTC' })
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }
const AR = '/api/v1/subbagsumda/arsip'
const PER = '/api/v1/subbagsumda/personel'
const DASH = '/api/v1/subbagsumda/dashboard'
const LAP = '/api/v1/subbagsumda/laporan'
const MULAI = new Date().toISOString()
const PREFIX = 'UJI-R5H32-'
const PALSU = '00000000-0000-4000-8000-000000000000'
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
const unggah = (a, path, bytes = PDF, filename = 'dokumen.pdf') => call(a, 'POST', path, undefined, { multipart: [{ name: 'file', filename, contentType: 'application/pdf', bytes }] })
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 180)}`
const tambah = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

async function bersihkan() {
  const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
  const sids = (await sql.query(`SELECT id::text FROM sdl_surat_antar WHERE perihal LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
  const aids = (await sql.query(`SELECT id::text FROM sdl_sumda_arsip WHERE perihal LIKE '${PREFIX}%' OR nomor LIKE '${PREFIX}%' OR personel_id = ANY($1::uuid[])`, [pids])).rows.map((r) => r.id)
  await sql.query('DELETE FROM sdl_sumda_arsip_lampiran WHERE arsip_id = ANY($1::uuid[])', [aids])
  await sql.query('DELETE FROM sdl_sumda_arsip WHERE id = ANY($1::uuid[])', [aids]) // riwayat CASCADE
  await sql.query(`DELETE FROM sdl_audit_events WHERE (subject_type='subbagsumda.arsip' AND subject_id = ANY($1::text[]))
    OR (subject_type='subbagsumda.personel' AND subject_id = ANY($2::text[])) OR (subject_type='subbagsumda.laporan' AND created_at >= $3::timestamptz)`, [aids, pids, MULAI])
  await sql.query('DELETE FROM sdl_surat_antar WHERE id = ANY($1::uuid[])', [sids]) // tujuan CASCADE
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
  const hari = (await sql.query("SELECT ((now() AT TIME ZONE 'Asia/Jakarta')::date)::text AS d")).rows[0].d
  let urut = 0
  const personel = async (extra = {}) => {
    const s = String(++urut).padStart(2, '0')
    const r = await call(ka, 'POST', PER, { nrp: `${PREFIX}${s}`, nama: `Uji Arsip ${s}`, jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '', ...extra })
    if (r.status !== 201) throw new Error(`buat personel ${s}: ${short(r)}`)
    return r.body.item
  }
  let nomor = 0
  const isi = (extra = {}) => ({ nomor: `${PREFIX}N${++nomor}`, jenis: 'SURAT_KEPUTUSAN', perihal: `${PREFIX}Arsip uji ${nomor}`, tanggal: '2026-11-01', asalTujuan: 'Biro SDM',
    kodeKlasifikasi: 'KP.01', lokasiSimpan: 'Lemari A rak 2', retensiSampai: '', kerahasiaan: 'BIASA', catatan: '', personelId: null, suratId: null, ...extra })
  const buat = (a, extra = {}) => call(a, 'POST', AR, isi(extra))
  const ubah = (a, it, extra = {}) => call(a, 'PATCH', `${AR}/${it.id}`, {
    nomor: it.nomor, jenis: it.jenis, perihal: it.perihal, tanggal: it.tanggal, asalTujuan: it.asalTujuan, kodeKlasifikasi: it.kodeKlasifikasi,
    lokasiSimpan: it.lokasiSimpan, retensiSampai: it.retensiSampai, kerahasiaan: it.kerahasiaan, catatan: it.catatan,
    personelId: it.personel?.id ?? null, suratId: it.suratId, version: it.version, ...extra })
  const aksi = (a, it, act, extra = {}) => call(a, 'POST', `${AR}/${it.id}/aksi`, { aksi: act, catatan: '', version: it.version, ...extra })
  const detail = async (a, id) => (await call(a, 'GET', `${AR}/${id}`)).body
  const ada = async (a, qs = '') => (await call(a, 'GET', `${AR}?q=${encodeURIComponent(PREFIX)}&size=100${qs ? `&${qs}` : ''}`)).body
  const surat = async (pengirim, status, tujuan = [], extra = {}) => {
    const s = (await sql.query(
      `INSERT INTO sdl_surat_antar(unit_pengirim,nomor,tanggal,perihal,status,sent_at,created_by,updated_by)
       VALUES($1,$2,'2026-11-10',$3,$4::text,CASE WHEN $4::text='dikirim' THEN now() END,$5,$5) RETURNING id::text`,
      [pengirim, `${PREFIX}S-${pengirim}`, `${PREFIX}Surat ${pengirim} ${status} ${tujuan.map((t) => t.unit).join('+')}`, status, ka.id])).rows[0].id
    for (const t of tujuan) {
      await sql.query('INSERT INTO sdl_surat_antar_tujuan(surat_id,unit_key,diterima_at,diterima_by) VALUES($1,$2,$3,$4)',
        [s, t.unit, t.diterima ? new Date() : null, t.diterima ? ka.id : null])
    }
    return s
  }

  try {
    log('\n0. Rumus tahap retensi menurut WIB (K35)')
    const tahap = async (retensi, ts, status = 'Aktif') => (await sql.query(
      `SELECT ${tahapRetensiSql('a', hariDari('$1'))} AS t FROM (SELECT $2::date AS retensi_sampai, $3::text AS status) a`, [ts, retensi, status])).rows[0].t
    const ts = '2026-11-23T17:00:00Z' // = 24 Nov 00:00 WIB
    check('retensi 24 Nov → JATUH_TEMPO; 23 Nov (terlewat) → JATUH_TEMPO', (await tahap('2026-11-24', ts)) === 'JATUH_TEMPO' && (await tahap('2026-11-23', ts)) === 'JATUH_TEMPO')
    check('25 Nov dan 24 Des → H-30; 25 Des → null', (await tahap('2026-11-25', ts)) === 'H-30' && (await tahap('2026-12-24', ts)) === 'H-30' && (await tahap('2026-12-25', ts)) === null)
    check('UTC 23 Nov 16:59 (= 23 Nov WIB): retensi 24 Nov masih H-30', (await tahap('2026-11-24', '2026-11-23T16:59:59Z')) === 'H-30')
    check('Inaktif ikut dihitung; Musnah tidak', (await tahap('2026-11-24', ts, 'Inaktif')) === 'JATUH_TEMPO' && (await tahap('2026-11-24', ts, 'Musnah')) === null)

    log('\n1. Hak & capabilities (K6/K30)')
    const cap = {}
    for (const a of [op, staf, ka, kabag]) cap[a.username] = (await call(a, 'GET', `${AR}/capabilities`)).body
    check('op/staf: baca + kelola + tautan surat, tanpa Terbatas', ['op-subbagsumda', 'staf-subbagsumda'].every((u) => cap[u].canRead && cap[u].canManage && !cap[u].canRestricted && cap[u].canTautSurat), JSON.stringify(cap['op-subbagsumda']))
    check('Kasubbag: semua', Object.values(cap.kasubbagsumda).every(Boolean), JSON.stringify(cap.kasubbagsumda))
    check('Kabagrenmin: baca + Terbatas, tanpa kelola', cap.kabagrenmin.canRead && cap.kabagrenmin.canRestricted && !cap.kabagrenmin.canManage, JSON.stringify(cap.kabagrenmin))
    check('Superadmin GET → 403', (await call(await actorFor('superadmin'), 'GET', AR)).status === 403)
    check('Kabagrenmin POST → 403', (await buat(kabag)).status === 403)

    log('\n2. Isian K8')
    const a1r = await buat(op)
    check('op catat arsip Biasa → 201 Aktif', a1r.status === 201 && a1r.body.item.status === 'Aktif' && a1r.body.item.version === 1, short(a1r))
    const a1 = a1r.body.item
    for (const [label, extra] of [['perihal 2 karakter', { perihal: 'ab' }], ['perihal 241 karakter', { perihal: 'x'.repeat(241) }],
      ['nomor 121 karakter', { nomor: 'n'.repeat(121) }], ['jenis di luar daftar', { jenis: 'MEMO' }], ['tanpa tanggal', { tanggal: '' }],
      ['tanggal tidak ada (31 Feb)', { tanggal: '2026-02-31' }], ['retensi < tanggal', { retensiSampai: '2026-10-31' }],
      ['kerahasiaan di luar daftar', { kerahasiaan: 'RAHASIA' }], ['personelId bukan UUID', { personelId: 'x' }], ['karakter Cf', { perihal: 'Arsip‮uji' }]]) {
      check(`${label} → 400`, (await buat(op, extra)).status === 400)
    }
    check('field asing → 400', (await call(op, 'POST', AR, { ...isi(), asing: 1 })).status === 400)
    check('personel fiktif → 400', (await buat(op, { personelId: PALSU })).status === 400)
    check('nomor ganda boleh (K48)', (await buat(op, { nomor: a1.nomor })).status === 201)
    const pA = await personel()
    const pB = await personel()
    const aP = (await buat(op, { personelId: pB.id })).body.item
    await call(ka, 'DELETE', `${PER}/${pB.id}?version=${pB.version}`)
    check('personel terarsip baru dipilih → 409 personel_terarsip', (await buat(op, { personelId: pB.id })).body?.error === 'personel_terarsip')
    const aPu = await ubah(op, aP, { lokasiSimpan: 'Lemari B' })
    check('personel terarsip lama dipertahankan → 200 (ditandai terarsip)', aPu.status === 200 && aPu.body.item.personel.terarsip === true, short(aPu))

    log('\n3. K29: TERBATAS tersembunyi utuh')
    const dash0 = { staf: (await call(staf, 'GET', DASH)).body.totals.arsipRetensi30, ka: (await call(ka, 'GET', DASH)).body.totals.arsipRetensi30 }
    const total0 = (await ada(staf)).total
    const tR = await buat(op, { kerahasiaan: 'TERBATAS', perihal: `${PREFIX}SK pribadi rahasia`, personelId: pA.id, retensiSampai: tambah(hari, 5), tanggal: '2026-01-02' })
    check('op catat TERBATAS → 201 dan terlihat bagi pencatat', tR.status === 201 && tR.body.item.kerahasiaan === 'TERBATAS', short(tR))
    const t1 = tR.body.item
    const lt = await unggah(op, `${AR}/${t1.id}/lampiran`, PDF, 'sk-pribadi.pdf')
    const t1v = (await detail(op, t1.id)).item
    check('staf: tidak di daftar, total tidak berubah', !(await ada(staf)).items.some((x) => x.id === t1.id) && (await ada(staf)).total === total0)
    for (const qs of [`q=${encodeURIComponent('SK pribadi rahasia')}`, 'kerahasiaan=TERBATAS', 'retensi=1', 'jenis=SURAT_KEPUTUSAN', 'tahun=2026']) {
      const r = await call(staf, 'GET', `${AR}?${qs}&size=100`)
      check(`staf: ?${qs} tidak menemukan`, r.status === 200 && !r.body.items.some((x) => x.id === t1.id) && !r.text.includes('SK pribadi rahasia'), short(r))
    }
    const palsu = await call(staf, 'GET', `${AR}/${PALSU}`)
    for (const [label, r, rp] of [
      ['detail', await call(staf, 'GET', `${AR}/${t1.id}`), palsu],
      ['unduh lampiran', await call(staf, 'GET', `${AR}/${t1.id}/lampiran/${lt.body.id}`), await call(staf, 'GET', `${AR}/${PALSU}/lampiran/${lt.body.id}`)],
      ['PATCH', await ubah(staf, t1v), await ubah(staf, { ...t1v, id: PALSU })],
      ['aksi', await aksi(staf, t1v, 'inaktifkan'), await aksi(staf, { ...t1v, id: PALSU }, 'inaktifkan')],
      ['unggah', await unggah(staf, `${AR}/${t1.id}/lampiran`), await unggah(staf, `${AR}/${PALSU}/lampiran`)],
      ['hapus lampiran', await call(staf, 'DELETE', `${AR}/${t1.id}/lampiran/${lt.body.id}`), await call(staf, 'DELETE', `${AR}/${PALSU}/lampiran/${lt.body.id}`)],
    ]) check(`staf: ${label} → 404 byte-identik dengan UUID fiktif`, r.status === 404 && r.bytes.equals(rp.bytes), `${short(r)} vs ${short(rp)}`)
    const perStaf = (await call(staf, 'GET', `${PER}/${pA.id}`)).body.item
    check('staf: detail personel arsip[] tanpa TERBATAS', Array.isArray(perStaf.arsip) && !perStaf.arsip.some((x) => x.id === t1.id), JSON.stringify(perStaf.arsip))
    check('staf: dashboard arsipRetensi30 tidak berubah (selisih 0)', (await call(staf, 'GET', DASH)).body.totals.arsipRetensi30 === dash0.staf)
    check('Kasubbag: dashboard arsipRetensi30 +1', (await call(ka, 'GET', DASH)).body.totals.arsipRetensi30 === dash0.ka + 1)
    check('pencatat, Kasubbag, Kabag menerima detail', (await detail(op, t1.id))?.item?.id === t1.id && (await detail(ka, t1.id))?.item?.id === t1.id && (await detail(kabag, t1.id))?.lampiran?.length === 1)
    check('Kasubbag/Kabag: detail personel memuat TERBATAS', (await call(ka, 'GET', `${PER}/${pA.id}`)).body.item.arsip.some((x) => x.id === t1.id) && (await call(kabag, 'GET', `${PER}/${pA.id}`)).body.item.arsip.some((x) => x.id === t1.id))
    check('Kabag: unduh lampiran TERBATAS byte-identik', (await call(kabag, 'GET', `${AR}/${t1.id}/lampiran/${lt.body.id}`)).bytes.equals(PDF))
    check('Kabag: tidak bisa memutasi (403)', (await ubah(kabag, t1v)).status === 403 && (await aksi(kabag, t1v, 'inaktifkan')).status === 403)
    const bR = await buat(op, { retensiSampai: tambah(hari, 3), tanggal: '2026-01-02' })
    check('arsip BIASA beretensi dekat menggerakkan angka staf (+1)', bR.status === 201 && (await call(staf, 'GET', DASH)).body.totals.arsipRetensi30 === dash0.staf + 1)

    log('\n4. Naik/turun kerahasiaan (K13/K34)')
    const a2 = (await buat(op)).body.item
    const naik = await ubah(staf, a2, { kerahasiaan: 'TERBATAS' })
    check('staf menaikkan BIASA milik op → 200 {item:null,tersembunyi:true}', naik.status === 200 && naik.body.item === null && naik.body.tersembunyi === true, short(naik))
    check('sesudahnya staf → 404', (await call(staf, 'GET', `${AR}/${a2.id}`)).status === 404)
    const a2v = (await detail(op, a2.id)).item
    check('pencatat tanpa Xa menurunkan → 403', (await ubah(op, a2v, { kerahasiaan: 'BIASA' })).status === 403)
    const turun = await ubah(ka, a2v, { kerahasiaan: 'BIASA' })
    check('Kasubbag menurunkan → 200 dan staf melihatnya lagi', turun.status === 200 && turun.body.item.kerahasiaan === 'BIASA' && (await call(staf, 'GET', `${AR}/${a2.id}`)).status === 200, short(turun))
    check('versi lama → 409 version_conflict', (await ubah(op, a2v, { lokasiSimpan: 'Lemari C' })).body?.error === 'version_conflict')

    log('\n5. Status Aktif ⇄ Inaktif → Musnah (K9/K32)')
    let a3 = (await buat(op)).body.item
    check('musnahkan dari Aktif → 409 status_tidak_sesuai', (await aksi(ka, a3, 'musnahkan', { catatan: 'Retensi habis sesuai JRA' })).body?.error === 'status_tidak_sesuai')
    const in1 = await aksi(staf, a3, 'inaktifkan', { catatan: 'Pindah ke arsip inaktif' })
    check('staf inaktifkan → Inaktif', in1.body?.item?.status === 'Inaktif', short(in1)); a3 = in1.body.item
    const ak1 = await aksi(op, a3, 'aktifkan')
    check('aktifkan kembali → Aktif', ak1.body?.item?.status === 'Aktif', short(ak1)); a3 = ak1.body.item
    a3 = (await aksi(op, a3, 'inaktifkan')).body.item
    check('staf (tanpa Xa) musnahkan → 403', (await aksi(staf, a3, 'musnahkan', { catatan: 'Retensi habis sesuai JRA' })).status === 403)
    check('alasan < 8 → 400', (await aksi(ka, a3, 'musnahkan', { catatan: 'pendek' })).status === 400)
    check('tanpa BA → 409 lampiran_wajib', (await aksi(ka, a3, 'musnahkan', { catatan: 'Retensi habis sesuai JRA' })).body?.error === 'lampiran_wajib')
    await unggah(op, `${AR}/${a3.id}/lampiran`, PDF, 'dokumen.pdf')
    a3 = (await detail(op, a3.id)).item
    check('lampiran DOKUMEN tidak memenuhi syarat BA → 409 lampiran_wajib', (await aksi(ka, a3, 'musnahkan', { catatan: 'Retensi habis sesuai JRA' })).body?.error === 'lampiran_wajib')
    check('?peran=X → 400', (await unggah(op, `${AR}/${a3.id}/lampiran?peran=FOTO`)).status === 400)
    const ba = await unggah(op, `${AR}/${a3.id}/lampiran?peran=BA_MUSNAH`, PDF, 'ba-pemusnahan.pdf')
    check('unggah BA_MUSNAH → 201, peran tersimpan', ba.status === 201 && (await sql.query('SELECT peran FROM sdl_sumda_arsip_lampiran WHERE id=$1::uuid', [ba.body.id])).rows[0].peran === 'BA_MUSNAH', short(ba))
    a3 = (await detail(op, a3.id)).item
    const mus = await aksi(ka, a3, 'musnahkan', { catatan: 'Retensi habis sesuai JRA' })
    check('Kasubbag musnahkan dengan BA → Musnah + musnah.olehNama', mus.body?.item?.status === 'Musnah' && mus.body.item.musnah?.olehNama, short(mus)); a3 = mus.body.item
    check('Musnah final: PATCH/aksi/unggah/hapus lampiran → 409',
      (await ubah(ka, a3, { lokasiSimpan: 'X' })).status === 409 && (await aksi(ka, a3, 'aktifkan')).status === 409
      && (await unggah(ka, `${AR}/${a3.id}/lampiran`)).status === 409 && (await call(ka, 'DELETE', `${AR}/${a3.id}/lampiran/${ba.body.id}`)).status === 409)
    check('Musnah: lampiran tetap bisa diunduh', (await call(staf, 'GET', `${AR}/${a3.id}/lampiran/${ba.body.id}`)).status === 200)
    check('Musnah tetap tampil (filter status=Musnah)', (await ada(staf, 'status=Musnah')).items.some((x) => x.id === a3.id))
    const hist = (await detail(ka, a3.id)).riwayat.map((h) => `${h.dari ?? '-'}>${h.ke}`).join(',')
    check('riwayat lengkap', hist === '->Aktif,Aktif>Inaktif,Inaktif>Aktif,Aktif>Inaktif,Inaktif>Musnah', hist)
    let dbErr = ''
    try { await sql.query("UPDATE sdl_sumda_arsip SET status='Musnah' WHERE id=$1::uuid", [a1.id]) } catch (e) { dbErr = e.code }
    check('CHECK DB: Musnah tanpa musnah_by → 23514', dbErr === '23514', dbErr)

    log('\n6. Tautan surat R5H21 (K30/K31)')
    const sKeluar = await surat('subbagsumda', 'dikirim', [{ unit: 'subbagren', diterima: false }])
    const sMasuk = await surat('subbagren', 'dikirim', [{ unit: 'subbagsumda', diterima: true }])
    const sBelum = await surat('subbagbinfung', 'dikirim', [{ unit: 'subbagsumda', diterima: false }])
    const sDraf = await surat('subbagsumda', 'disetujui', [{ unit: 'subbagren', diterima: false }])
    const sLain = await surat('subbagren', 'dikirim', [{ unit: 'subbagbinfung', diterima: true }])
    const sMasuk2 = await surat('urmin', 'dikirim', [{ unit: 'subbagsumda', diterima: true }])
    const pilih = (await call(op, 'GET', `${AR}/surat-tertaut`)).body
    const pid = new Set(pilih.items.map((x) => x.id))
    check('surat-tertaut: keluar Sumda dikirim + masuk diterima ada', pid.has(sKeluar) && pid.has(sMasuk) && pid.has(sMasuk2), JSON.stringify(pilih).slice(0, 200))
    check('surat-tertaut: belum diterima / belum dikirim / unit lain tidak ada', !pid.has(sBelum) && !pid.has(sDraf) && !pid.has(sLain))
    check('surat-tertaut: arah keluar/masuk', pilih.items.find((x) => x.id === sKeluar)?.arah === 'keluar' && pilih.items.find((x) => x.id === sMasuk)?.arah === 'masuk')
    check('Kabag (tanpa kelola) surat-tertaut → 403', (await call(kabag, 'GET', `${AR}/surat-tertaut`)).status === 403)
    for (const [label, sid] of [['masuk belum diterima', sBelum], ['belum dikirim', sDraf], ['unit lain', sLain], ['fiktif', PALSU]]) {
      check(`tautkan surat ${label} → 400 surat_tidak_berlaku`, (await buat(op, { suratId: sid })).body?.error === 'surat_tidak_berlaku')
    }
    const tk = await buat(op, { suratId: sKeluar, jenis: 'SURAT_KELUAR' })
    check('tautkan surat keluar Sumda → 201', tk.status === 201 && tk.body.item.suratId === sKeluar, short(tk))
    check('surat sama lagi → 409 surat_sudah_diarsip', (await buat(staf, { suratId: sKeluar })).body?.error === 'surat_sudah_diarsip')
    const [r1, r2] = await Promise.all([buat(op, { suratId: sMasuk, jenis: 'SURAT_MASUK' }), buat(staf, { suratId: sMasuk, jenis: 'SURAT_MASUK' })])
    check('balapan dua POST surat sama → satu 201, satu 409', [r1.status, r2.status].sort().join(',') === '201,409', `${short(r1)} | ${short(r2)}`)
    check('surat-tertaut tidak lagi memuat surat yang sudah diarsip', !(await call(op, 'GET', `${AR}/surat-tertaut`)).body.items.some((x) => [sKeluar, sMasuk].includes(x.id)))
    const dtk = await detail(kabag, tk.body.item.id)
    check('detail: info surat (Ps) arah keluar', dtk.surat?.id === sKeluar && dtk.surat.arah === 'keluar' && dtk.surat.perihal.startsWith(PREFIX), JSON.stringify(dtk.surat))
    let tki = tk.body.item
    const ganti = await ubah(op, tki, { suratId: sMasuk2 })
    check('PATCH ganti tautan ke surat sah → 200', ganti.status === 200 && ganti.body.item.suratId === sMasuk2, short(ganti)); tki = ganti.body.item
    check('PATCH ke surat yang sudah diarsip lain → 409', (await ubah(op, tki, { suratId: sMasuk })).body?.error === 'surat_sudah_diarsip')
    check('PATCH ke surat tidak sah → 400', (await ubah(op, tki, { suratId: sDraf })).body?.error === 'surat_tidak_berlaku')
    const lepas = await ubah(op, tki, { suratId: null })
    check('PATCH lepas tautan → 200 suratId null, surat kembali bisa dipilih', lepas.status === 200 && lepas.body.item.suratId === null && (await call(op, 'GET', `${AR}/surat-tertaut`)).body.items.some((x) => x.id === sMasuk2))
    const yatim = (await buat(op, { suratId: sMasuk2 })).body.item
    await sql.query('DELETE FROM sdl_surat_antar WHERE id=$1::uuid', [sMasuk2])
    check('surat dihapus (tanpa FK) → detail surat.hilang', (await detail(op, yatim.id)).surat?.hilang === true)

    log('\n7. Lampiran (K12/K33)')
    const a4 = (await buat(op)).body.item
    const up = await unggah(op, `${AR}/${a4.id}/lampiran`, PDF, 'surat-asli.pdf')
    const row = (await sql.query("SELECT substring(body FROM 1 FOR 4) AS head, position('%PDF'::bytea IN body) AS pos, peran FROM sdl_sumda_arsip_lampiran WHERE id=$1::uuid", [up.body?.id])).rows[0]
    check('body diawali SDL1 tanpa %PDF, peran bawaan DOKUMEN', row?.head?.toString('latin1') === 'SDL1' && row.pos === 0 && row.peran === 'DOKUMEN')
    const dl = await call(staf, 'GET', `${AR}/${a4.id}/lampiran/${up.body.id}`)
    check('unduh byte-identik + header aman', dl.bytes.equals(PDF) && /no-store/.test(dl.headers.get?.('cache-control') ?? dl.headers['cache-control'] ?? ''), short(dl))
    check('id silang antar-arsip → 404', (await call(staf, 'GET', `${AR}/${a1.id}/lampiran/${up.body.id}`)).status === 404)
    check('PDF palsu → 400', (await unggah(op, `${AR}/${a4.id}/lampiran`, Buffer.from('bukan pdf'), 'x.pdf')).status === 400)
    check('hapus lampiran milik orang lain tanpa Xa → 403', (await call(staf, 'DELETE', `${AR}/${a4.id}/lampiran/${up.body.id}`)).status === 403)
    for (let i = 0; i < 9; i++) await unggah(op, `${AR}/${a4.id}/lampiran`, PDF, `isi-${i}.pdf`)
    check('lampiran ke-11 → 409 batas_lampiran', (await unggah(op, `${AR}/${a4.id}/lampiran`)).body?.error === 'batas_lampiran')
    check('Kasubbag (Xa) boleh menghapus lampiran orang lain', (await call(ka, 'DELETE', `${AR}/${a4.id}/lampiran/${up.body.id}`)).status === 200)
    const up2 = await unggah(op, `${AR}/${a4.id}/lampiran`, PDF, 'rusak.pdf')
    await sql.query("UPDATE sdl_sumda_arsip_lampiran SET body=overlay(body PLACING '\\xff'::bytea FROM length(body)) WHERE id=$1::uuid", [up2.body.id])
    check('body dirusak → 503', (await call(staf, 'GET', `${AR}/${a4.id}/lampiran/${up2.body.id}`)).status === 503)

    log('\n8. Aditif R5H27 (K24/K25)')
    const pC = await personel()
    check('POST personel tidak membawa arsip', pC && !Object.hasOwn(pC, 'arsip'))
    const pd0 = (await call(op, 'GET', `${PER}/${pC.id}`)).body.item.arsip
    await buat(op, { personelId: pC.id, catatan: 'Catatan arsip personel' })
    const pd1 = (await call(op, 'GET', `${PER}/${pC.id}`)).body.item.arsip
    check('detail personel arsip[] bertambah 1, tanpa catatan', pd0.length === 0 && pd1.length === 1 && !Object.hasOwn(pd1[0], 'catatan'), JSON.stringify(pd1))
    const pu = await call(ka, 'PATCH', `${PER}/${pC.id}`, { nrp: pC.nrp, nama: pC.nama, jenis: 'Polri', pangkat: '', jabatan: 'Baru', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '', version: pC.version })
    check('PATCH personel tidak membawa arsip', pu.status === 200 && !Object.hasOwn(pu.body.item, 'arsip'), short(pu))
    check('dashboard: arsipRetensi30 berupa bilangan bagi pemegang arsip.read', typeof (await call(staf, 'GET', DASH)).body.totals.arsipRetensi30 === 'number')

    log('\n9. Laporan & Analitik (K15/K36–K40)')
    const lap = async (a, qs = '') => call(a, 'GET', `${LAP}/ringkasan${qs}`)
    const lcap = {}
    for (const a of [op, staf, ka, kabag]) lcap[a.username] = (await call(a, 'GET', `${LAP}/capabilities`)).body
    check('capabilities: op/staf baca tanpa ekspor, semua modul false', ['op-subbagsumda', 'staf-subbagsumda'].every((u) => lcap[u].canRead && !lcap[u].canExport && Object.values(lcap[u].modul).every((x) => x === false)), JSON.stringify(lcap['staf-subbagsumda']))
    check('capabilities: Kasubbag/Kabag ekspor 10 modul', ['kasubbagsumda', 'kabagrenmin'].every((u) => lcap[u].canExport && Object.keys(lcap[u].modul).length === 10 && Object.values(lcap[u].modul).every(Boolean)), JSON.stringify(lcap.kabagrenmin))
    const rs = await lap(staf)
    const rk = await lap(ka)
    check('ringkasan staf → 200, kinerja null (bukan nol), aset & arsip ada', rs.status === 200 && rs.body.kinerja === null && rs.body.aset !== null && rs.body.arsip !== null, short(rs))
    check('ringkasan Kasubbag: blok kinerja 4 kategori', Array.isArray(rk.body.kinerja?.perKategori) && rk.body.kinerja.perKategori.length === 4)
    check('register: kinerja hanya bagi Rk', !rs.body.register.some((r) => r.modul === 'kinerja') && rk.body.register.some((r) => r.modul === 'kinerja'))
    check('arsip.terbatas null bagi staf (tanpa Xa), bilangan bagi Kasubbag', rs.body.arsip.terbatas === null && typeof rk.body.arsip.terbatas === 'number')
    check('tahun bawaan = tahun WIB', rs.body.tahun === Number(hari.slice(0, 4)) && rs.body.tahunIni === rs.body.tahun && rs.body.hariIni === hari)
    const acuan = (await sql.query(`SELECT count(*) FILTER (WHERE status='Aktif')::int AS aktif, count(*) FILTER (WHERE status='MPP')::int AS mpp
      FROM sdl_sumda_personel WHERE deleted_at IS NULL`)).rows[0]
    check('kartu personel aktif/MPP = SQL acuan', rs.body.personel.aktif === acuan.aktif && rs.body.personel.mpp === acuan.mpp, `${JSON.stringify(acuan)} vs ${rs.body.personel.aktif}/${rs.body.personel.mpp}`)
    const alert = (await call(staf, 'GET', '/api/v1/subbagsumda/pensiun/alert')).body
    const n30 = (alert.items ?? []).filter((x) => ['H-30', 'H-14', 'H-7', 'JATUH_TEMPO'].includes(x.tahap)).length
    check('pensiun ≤ 30 hari = jumlah alert H-30..JATUH_TEMPO', rs.body.pensiun30 === n30, `${rs.body.pensiun30} vs ${n30}`)
    const lay = (await sql.query(`SELECT (SELECT count(*) FROM sdl_sumda_karier x JOIN sdl_sumda_personel p ON p.id=x.personel_id WHERE p.deleted_at IS NULL AND x.status IN ('Diajukan','Diproses','Disetujui'))::int
      + (SELECT count(*) FROM sdl_sumda_cuti x JOIN sdl_sumda_personel p ON p.id=x.personel_id WHERE p.deleted_at IS NULL AND x.status IN ('Diajukan','Diproses','Disetujui'))::int
      + (SELECT count(*) FROM sdl_sumda_kesejahteraan x JOIN sdl_sumda_personel p ON p.id=x.personel_id WHERE p.deleted_at IS NULL AND x.status IN ('Diajukan','Diproses','Disetujui'))::int AS n`)).rows[0].n
    check('layanan berjalan = SQL acuan', rs.body.layananBerjalan.total === lay, `${rs.body.layananBerjalan.total} vs ${lay}`)
    const dashP = (await call(staf, 'GET', DASH)).body.proyeksi
    check('proyeksi 12 bulan; 6 bulan pertama = dashboard', rs.body.personel.proyeksi.length === 12 && JSON.stringify(rs.body.personel.proyeksi.slice(0, 6)) === JSON.stringify(dashP))
    check('proyeksiPensiunSql(12) dimulai bulan berjalan WIB', (await sql.query(proyeksiPensiunSql(12))).rows[0].bulan === hari.slice(0, 7))
    const cutiAcuan = (await sql.query(`SELECT count(*)::int AS n, coalesce(sum(jumlah_hari),0)::int AS h FROM sdl_sumda_cuti
      WHERE status IN ('Disetujui','Selesai') AND extract(year FROM tanggal_mulai)=$1`, [rs.body.tahun])).rows[0]
    check('cuti per bulan: jumlah & hari = SQL acuan', rs.body.cuti.perBulan.length === 12 && rs.body.cuti.perBulan.reduce((s, b) => s + b.pengajuan, 0) === cutiAcuan.n
      && rs.body.cuti.perBulan.reduce((s, b) => s + b.hari, 0) === cutiAcuan.h, JSON.stringify(cutiAcuan))
    for (let i = 1; i <= 16; i++) await personel({ unitKerja: `${PREFIX}Unit ${String(i).padStart(2, '0')}` })
    const ru = (await lap(staf)).body.personel
    const jUnit = (await sql.query("SELECT count(DISTINCT unit_kerja)::int AS n FROM sdl_sumda_personel WHERE deleted_at IS NULL AND status IN ('Aktif','MPP')")).rows[0].n
    check('unit kerja: 15 teratas + "Lainnya (n unit)", jumlah = aktif + MPP', ru.perUnit.length === 16 && ru.perUnit[15].label === `Lainnya (${jUnit - 15} unit)`
      && ru.perUnit.reduce((s, u) => s + u.jumlah, 0) === ru.aktif + ru.mpp && !ru.perUnit.some((u) => u.label === ''), JSON.stringify(ru.perUnit.slice(-2)))
    const urut = (await sql.query('SELECT short_name, sort_order FROM sdl_polri_rank_master')).rows
    const so = (l) => urut.find((r) => r.short_name === l)?.sort_order ?? 1e9
    check('pangkat Polri terurut sort_order; jumlah Polri+PNS = aktif + MPP', ru.perPangkat.polri.every((x, i, a) => i === 0 || so(a[i - 1].label) <= so(x.label))
      && [...ru.perPangkat.polri, ...ru.perPangkat.pns].reduce((s, x) => s + x.jumlah, 0) === ru.aktif + ru.mpp)
    const arsS0 = (await lap(staf)).body.arsip
    const arsK0 = (await lap(ka)).body.arsip
    await buat(op, { kerahasiaan: 'TERBATAS', retensiSampai: tambah(hari, 4), tanggal: `${hari.slice(0, 4)}-01-03`, jenis: 'NOTA_DINAS' })
    const arsS1 = (await lap(staf)).body.arsip
    const arsK1 = (await lap(ka)).body.arsip
    check('arsip TERBATAS milik op: blok arsip staf selisih 0', JSON.stringify(arsS0) === JSON.stringify(arsS1), `${JSON.stringify(arsS0)} → ${JSON.stringify(arsS1)}`)
    check('arsip TERBATAS: blok arsip Kasubbag bertambah (aktif, retensi, terbatas)', arsK1.aktif === arsK0.aktif + 1 && arsK1.retensi30 === arsK0.retensi30 + 1 && arsK1.terbatas === arsK0.terbatas + 1)
    check('blok arsip retensi30 = dashboard arsipRetensi30', arsS1.retensi30 === (await call(staf, 'GET', DASH)).body.totals.arsipRetensi30)
    check('?tahun=abc / kunci asing → 400; ?tahun=2027 diterima', (await lap(staf, '?tahun=abc')).status === 400 && (await lap(staf, '?x=1')).status === 400 && (await lap(staf, '?tahun=2027')).body.tahun === 2027)

    log('\n10. Ekspor CSV (K4/K18–K22/K41–K44)')
    const eks = (a, modul, qs = '') => call(a, 'GET', `${LAP}/ekspor/${modul}${qs}`)
    const nAudit = async () => (await sql.query("SELECT count(*)::int AS n FROM sdl_audit_events WHERE event_key='subbagsumda.laporan.export'")).rows[0].n
    const au0 = await nAudit()
    check('op/staf → 403 (tidak diaudit)', (await eks(op, 'personel')).status === 403 && (await eks(staf, 'arsip')).status === 403 && (await nAudit()) === au0)
    check('modul tak dikenal → 404 JSON; __proto__ → 404', (await eks(ka, 'gaji')).body?.error === 'not_found' && (await eks(ka, '__proto__')).status === 404)
    check('param asing / nilai di luar daftar / tahun=abc → 400', (await eks(ka, 'personel', '?tahun=2026')).status === 400
      && (await eks(ka, 'cuti', '?status=Hilang')).status === 400 && (await eks(ka, 'arsip', '?tahun=abc')).status === 400 && (await eks(ka, 'aset', '?kondisi=Baru')).status === 400)
    check('404/400 tidak diaudit', (await nAudit()) === au0)
    const tgl = hari.replaceAll('-', '')
    const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    const hdr = (r, k) => r.headers.get?.(k) ?? r.headers[k] ?? ''
    for (const modul of Object.keys(MODUL_EKSPOR)) {
      const r = await eks(kabag, modul)
      const isi = r.bytes.subarray(3).toString('utf8')
      const baris = isi.split('\r\n')
      check(`${modul}: 200 text/csv, BOM, header konstanta, CRLF, nama berkas, no-store, nosniff, tanpa UUID`,
        r.status === 200 && r.bytes.subarray(0, 3).equals(BOM) && /^text\/csv; charset=utf-8/.test(hdr(r, 'content-type'))
        && baris[0] === MODUL_EKSPOR[modul].header.map(sel).join(';') && baris.at(-1) === '' && !/[^\r]\n/.test(isi)
        && hdr(r, 'content-disposition') === `attachment; filename=sumda-${modul}-${tgl}.csv` && hdr(r, 'cache-control') === 'no-store'
        && hdr(r, 'x-content-type-options') === 'nosniff' && !UUID.test(isi), `${short(r)} ${hdr(r, 'content-disposition')}`)
    }
    const fx = await buat(op, { perihal: '=1+1 rumus', nomor: '+62 telepon', asalTujuan: '-x minus', kodeKlasifikasi: '@SUM(A1)', lokasiSimpan: '＝ lebar penuh', tanggal: `${hari.slice(0, 4)}-02-02`, jenis: 'BERITA_ACARA', catatan: `${PREFIX}catatan rahasia` })
    check('arsip berisi awalan formula tersimpan', fx.status === 201, short(fx))
    await sql.query('UPDATE sdl_sumda_arsip SET perihal=$2 WHERE id=$1::uuid', [fx.body.item.id, `${PREFIX}=HYPERLINK("http://x")`])
    const fy = await buat(op, { perihal: '=1+1 rumus', tanggal: `${hari.slice(0, 4)}-02-02`, jenis: 'BERITA_ACARA' })
    await sql.query("UPDATE sdl_sumda_arsip SET nomor=$2 WHERE id=$1::uuid", [fy.body.item.id, `${PREFIX}FY`])
    const ex = (await eks(ka, 'arsip', `?jenis=BERITA_ACARA&tahun=${hari.slice(0, 4)}`)).bytes.toString('utf8')
    check('formula injection: = + - @ ＝ diberi awalan \', " digandakan', ex.includes(`"'=1+1 rumus"`) && ex.includes(`"'+62 telepon"`) && ex.includes(`"'-x minus"`) && ex.includes(`"'@SUM(A1)"`)
      && ex.includes(`"'＝ lebar penuh"`) && ex.includes(`"${PREFIX}=HYPERLINK(""http://x"")"`), ex.split('\r\n').find((l) => l.includes('telepon')))
    check('catatan arsip tidak pernah diekspor (K41)', !ex.includes('catatan rahasia'))
    const qs = `?tahun=${hari.slice(0, 4)}&jenis=NOTA_DINAS`
    const jml = (await eks(ka, 'arsip', qs)).bytes.toString('utf8').split('\r\n').length - 2
    check('jumlah baris ekspor arsip = total daftar dengan filter sama', jml === (await call(ka, 'GET', `${AR}${qs}&size=5`)).body.total, `${jml}`)
    const jmlP = (await eks(ka, 'personel', '?status=Aktif')).bytes.toString('utf8').split('\r\n').length - 2
    check('jumlah baris ekspor personel Aktif = SQL acuan', jmlP === (await sql.query("SELECT count(*)::int AS n FROM sdl_sumda_personel WHERE deleted_at IS NULL AND status='Aktif'")).rows[0].n)
    check('arsip TERBATAS ikut bagi pemegang arsip.restricted', (await eks(ka, 'arsip')).bytes.toString('utf8').includes('SK pribadi rahasia'))
    const kinR = (await eks(kabag, 'kinerja')).bytes.toString('utf8').split('\r\n').length - 2
    check('kinerja lengkap bagi Kabag (kinerja.read) = SQL acuan', kinR === (await sql.query('SELECT count(*)::int AS n FROM sdl_sumda_kinerja')).rows[0].n)
    const au1 = await nAudit()
    const re = await eks(ka, 'cuti', '?tahun=2026&status=Disetujui')
    const evE = (await sql.query("SELECT actor_id::text, subject_type, subject_id, metadata FROM sdl_audit_events WHERE event_key='subbagsumda.laporan.export' ORDER BY created_at DESC, id DESC LIMIT 1")).rows[0]
    check('audit ekspor tepat {modul,jumlah,filter}', re.status === 200 && (await nAudit()) === au1 + 1 && evE.actor_id === ka.id && evE.subject_type === 'subbagsumda.laporan' && evE.subject_id === 'cuti'
      && Object.keys(evE.metadata).sort().join() === 'filter,jumlah,modul' && evE.metadata.modul === 'cuti'
      && evE.metadata.jumlah === re.bytes.toString('utf8').split('\r\n').length - 2
      && Object.keys(evE.metadata.filter).sort().join() === 'status,tahun' && evE.metadata.filter.tahun === 2026 && evE.metadata.filter.status === 'Disetujui', JSON.stringify(evE))

    log('\n11. Audit tanpa PII (K49)')
    const aids = (await sql.query(`SELECT id::text FROM sdl_sumda_arsip WHERE perihal LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
    const ev = (await sql.query("SELECT event_key, metadata::text AS m FROM sdl_audit_events WHERE subject_type='subbagsumda.arsip' AND subject_id = ANY($1::text[])", [aids])).rows
    const keys = new Set(ev.map((e) => e.event_key.replace('subbagsumda.arsip.', '')))
    check('event arsip tercatat', ['create', 'update', 'inaktifkan', 'aktifkan', 'musnahkan', 'lampiran.add', 'lampiran.delete', 'lampiran.download'].every((k) => keys.has(k)), [...keys].join(','))
    check('metadata tanpa nomor/perihal/catatan/nama berkas', ev.every((e) => !e.m.includes(PREFIX) && !e.m.includes('Retensi habis') && !e.m.includes('.pdf') && !e.m.includes('Lemari')))
    check('metadata update memuat daftar fields', ev.some((e) => e.event_key.endsWith('.update') && e.m.includes('"fields"') && e.m.includes('kerahasiaan')))
  } finally {
    await bersihkan()
  }
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await sql.end(); await db.close(); process.exit(fail ? 1 : 0) })
