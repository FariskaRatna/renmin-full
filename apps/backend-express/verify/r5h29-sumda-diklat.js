/**
 * Verifikasi R5H29: Subbagsumda Diklat & Kompetensi (migrasi 070). EXPRESS SAJA:
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml --profile harness"
 *   docker compose $CLI run --rm --build --entrypoint node -e SDL_HARNESS_API_BASE=http://api-express:8080 harness verify/r5h29-sumda-diklat.js
 *
 * Yang dijaga: rumus tahap kompetensi menurut WIB · salinan registry · alur status kegiatan · PATCH
 * sebelum/sesudah final · peserta · hasil hanya saat Selesai · kompetensi dari peserta Lulus dan langsung ·
 * batas tahap alert + pengganti (K30) · lampiran tiga pemilik · arsip hanya Kasubbag · audit tanpa PII ·
 * aditif R5H27.
 *
 * MENULIS KE DATABASE (personel UJI-R5H29-, kegiatan "[UJI-R5H29]"), dibersihkan di awal dan di akhir.
 */
import pg from 'pg'

import { HttpClient } from '../harness/client.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'
import { tahapKompetensiSql } from '../src/modules/subbagsumda/kompetensi.js'
import { hariDari } from '../src/modules/subbagsumda/umum.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)
const sql = new pg.Pool({ connectionString: config.databaseUrl, max: 2, options: '-c timezone=UTC' })
let fail = 0
const log = (...p) => console.log(...p)
const check = (label, ok, detail = '') => { if (!ok) fail++; log(`${ok ? '  OK    ' : '  GAGAL '} ${label}${detail ? ` — ${detail}` : ''}`) }
const D = '/api/v1/subbagsumda/diklat'
const KP = '/api/v1/subbagsumda/kompetensi'
const PER = '/api/v1/subbagsumda/personel'
const DASH = '/api/v1/subbagsumda/dashboard'
const PREFIX = 'UJI-R5H29-'
const TAG = '[UJI-R5H29]'
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n', 'latin1')

async function actorFor(username) {
  const id = await db.userIdByUsername(username)
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
  return { status: res.status, body: json, text, bytes }
}
const unggah = (a, path, bytes = PDF, filename = 'sk.pdf') => call(a, 'POST', path, undefined, { multipart: [{ name: 'file', filename, contentType: 'application/pdf', bytes }] })
const short = (r) => `HTTP ${r.status} ${r.text.slice(0, 160)}`

async function bersihkan() {
  const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
  const dids = (await sql.query('SELECT id::text FROM sdl_sumda_diklat WHERE nama LIKE $1', [`${TAG}%`])).rows.map((r) => r.id)
  const psids = (await sql.query('SELECT id::text FROM sdl_sumda_diklat_peserta WHERE diklat_id = ANY($1::uuid[]) OR personel_id = ANY($2::uuid[])', [dids, pids])).rows.map((r) => r.id)
  const kids = (await sql.query('SELECT id::text FROM sdl_sumda_kompetensi WHERE personel_id = ANY($1::uuid[])', [pids])).rows.map((r) => r.id)
  await sql.query('DELETE FROM sdl_sumda_diklat_lampiran WHERE diklat_id = ANY($1::uuid[]) OR peserta_id = ANY($2::uuid[]) OR kompetensi_id = ANY($3::uuid[])', [dids, psids, kids])
  await sql.query('DELETE FROM sdl_sumda_kompetensi WHERE id = ANY($1::uuid[])', [kids])
  await sql.query('DELETE FROM sdl_sumda_diklat_peserta WHERE id = ANY($1::uuid[])', [psids])
  await sql.query('DELETE FROM sdl_sumda_diklat WHERE id = ANY($1::uuid[])', [dids]) // riwayat CASCADE
  await sql.query(`DELETE FROM sdl_audit_events WHERE (subject_type='subbagsumda.diklat' AND subject_id = ANY($1::text[]))
     OR (subject_type='subbagsumda.kompetensi' AND subject_id = ANY($2::text[])) OR (subject_type='subbagsumda.personel' AND subject_id = ANY($3::text[]))`, [dids, kids, pids])
  await sql.query('DELETE FROM sdl_sumda_personel WHERE id = ANY($1::uuid[])', [pids])
}

const hariIni = async () => (await sql.query("SELECT ((now() AT TIME ZONE 'Asia/Jakarta')::date)::text AS d")).rows[0].d
const tambahHari = async (d, n) => (await sql.query('SELECT ($1::date + $2::int)::text AS d', [d, n])).rows[0].d

async function main() {
  await db.ping()
  log(`\nBackend: ${config.apiBase}`)
  const nama = ['op-subbagsumda', 'staf-subbagsumda', 'kasubbagsumda', 'kabagrenmin']
  const mcp = (await sql.query('SELECT username FROM sdl_users WHERE username = ANY($1) AND must_change_password', [nama])).rows
  if (mcp.length) throw new Error(`Masih must_change_password: ${mcp.map((r) => r.username).join(', ')}`)
  const [op, staf, ka, kabag] = await Promise.all(nama.map(actorFor))
  await bersihkan()
  const today = await hariIni()
  let urut = 0
  const personel = async (extra = {}) => {
    urut += 1
    const r = await call(ka, 'POST', PER, { nrp: `${PREFIX}${urut}`, nama: `Uji Diklat ${urut}`, jenis: 'Polri', pangkat: '', jabatan: '', unitKerja: '', tmtDinas: '', tanggalPensiun: '2040-01-01', status: 'Aktif', catatan: '', ...extra })
    if (r.status !== 201) throw new Error(`buat personel: ${short(r)}`)
    return r.body.item
  }
  const kegiatan = async (extra = {}) => {
    const r = await call(op, 'POST', D, { nama: `${TAG} Pelatihan ${++urut}`, jenis: 'Pelatihan', penyelenggara: 'Pusdik', lokasi: 'Jakarta', nomorSurat: 'SPRIN/1', tanggalMulai: today, tanggalSelesai: '', catatan: '', ...extra })
    if (r.status !== 201) throw new Error(`buat kegiatan: ${short(r)}`)
    return r.body.item
  }
  const status = (a, k, ke, extra = {}) => call(a, 'POST', `${D}/${k.id}/status`, { status: ke, catatan: '', version: k.version, ...extra })
  const detail = async (id) => (await call(ka, 'GET', `${D}/${id}`)).body

  try {
    log('\n0. Rumus tahap kompetensi menurut WIB (stempel tetap)')
    const t = async (berlaku, statusP = 'Aktif') => (await sql.query(
      `SELECT ${tahapKompetensiSql('k', 'p', hariDari('$1'))} AS t
         FROM (SELECT gen_random_uuid() AS id, gen_random_uuid() AS personel_id, 'Uji'::text AS nama, NULL::timestamptz AS deleted_at, $2::date AS berlaku_sampai) k,
              (SELECT NULL::timestamptz AS deleted_at, $3::text AS status) p`, ['2026-11-22T17:00:00Z', berlaku, statusP])).rows[0].t
    const kasus = [['2026-11-23', 'KEDALUWARSA'], ['2026-11-24', 'H-30'], ['2026-12-23', 'H-30'], ['2026-12-24', 'H-60'], ['2027-01-22', 'H-60'], ['2027-01-23', null], [null, null]]
    for (const [b, want] of kasus) { const got = await t(b); check(`berlaku ${b ?? 'kosong'} → ${want ?? 'tanpa tahap'}`, got === want, String(got)) }
    check('personel Pensiun → tanpa tahap', (await t('2026-11-23', 'Pensiun')) === null)

    log('\n1. Salinan registry pendidikan (invarian)')
    const inv = (await sql.query(`SELECT count(*) FILTER (WHERE d.catatan NOT LIKE 'Kode lama:%') AS tanpa_kode,
        count(*) FILTER (WHERE (SELECT count(*) FROM sdl_sumda_diklat_riwayat r WHERE r.diklat_id=d.id AND r.dari IS NULL) <> 1) AS riwayat_salah,
        count(*) AS n FROM sdl_sumda_diklat d WHERE d.source_registry_id IS NOT NULL`)).rows[0]
    check('setiap salinan berkode lama + satu riwayat awal', Number(inv.tanpa_kode) === 0 && Number(inv.riwayat_salah) === 0, JSON.stringify(inv))
    const sal = (await sql.query("SELECT metadata FROM sdl_audit_events WHERE event_key='subbagsumda.diklat.salin_registry'")).rows
    check('audit salin_registry: maks. satu, sumber ≥ disalin', sal.length <= 1 && sal.every((r) => r.metadata.sumber >= r.metadata.disalin), JSON.stringify(sal.map((r) => r.metadata)))

    log('\n2. Hak akses & alur status')
    const cap = (await call(kabag, 'GET', `${D}/capabilities`)).body
    check('kabagrenmin: baca saja', cap.canRead && !cap.canManage && !cap.canArchive, JSON.stringify(cap))
    check('kabagrenmin buat → 403', (await call(kabag, 'POST', D, { nama: `${TAG} X`, jenis: 'Kursus', penyelenggara: '', lokasi: '', nomorSurat: '', tanggalMulai: today, tanggalSelesai: '', catatan: '' })).status === 403)
    check('tanpa tanggal mulai → 400', (await call(op, 'POST', D, { nama: `${TAG} Tanpa`, jenis: 'Kursus', penyelenggara: '', lokasi: '', nomorSurat: '', tanggalMulai: '', tanggalSelesai: '', catatan: '' })).status === 400)
    let k1 = await kegiatan()
    check('buat kegiatan → Terjadwal', k1.status === 'Terjadwal')
    check('Selesai langsung dari Terjadwal → 409', (await status(op, k1, 'Selesai', { tanggalSelesai: today })).body?.error === 'status_tidak_sesuai')
    check('tanggalSelesai pada Berjalan → 400', (await status(op, k1, 'Berjalan', { tanggalSelesai: today })).status === 400)

    log('\n3. Peserta')
    const [pA, pB, pC] = [await personel(), await personel(), await personel()]
    const pPensiun = await personel({ status: 'Pensiun' })
    const add = (k, ids) => call(op, 'POST', `${D}/${k.id}/peserta`, { personelIds: ids, version: k.version })
    const r3 = await add(k1, [pA.id, pB.id, pC.id])
    check('tambah 3 peserta → 201, versi kegiatan naik', r3.status === 201 && r3.body.item.jumlahPeserta === 3 && r3.body.item.version === k1.version + 1, short(r3))
    k1 = r3.body.item
    check('peserta sudah ada → 409 peserta_ganda', (await add(k1, [pA.id])).body?.error === 'peserta_ganda')
    k1 = (await detail(k1.id)).item
    check('ganda dalam satu kiriman → 400', (await add(k1, [pPensiun.id, pPensiun.id])).status === 400)
    check('51 per kirim → 400', (await add(k1, Array.from({ length: 51 }, () => crypto.randomUUID()))).status === 400)
    check('personel Pensiun → 409 personel_tidak_aktif', (await add(k1, [pPensiun.id])).body?.error === 'personel_tidak_aktif')
    const pArsip = await personel()
    await call(ka, 'DELETE', `${PER}/${pArsip.id}?version=${pArsip.version}`)
    check('personel terarsip → 409 personel_terarsip', (await add(k1, [pArsip.id])).body?.error === 'personel_terarsip')
    const ps0 = (await detail(k1.id)).peserta
    const psC = ps0.find((p) => p.personelId === pC.id)
    check('hapus peserta saat Terjadwal → 204', (await call(op, 'DELETE', `${D}/${k1.id}/peserta/${psC.id}?version=${psC.version}`)).status === 204)

    log('\n4. Hasil hanya saat Selesai; PATCH sebelum/sesudah final')
    k1 = (await detail(k1.id)).item
    const psA = (await detail(k1.id)).peserta.find((p) => p.personelId === pA.id)
    check('hasil saat Terjadwal → 409 hasil_belum_boleh', (await call(op, 'PATCH', `${D}/${k1.id}/peserta/${psA.id}`, { hasil: 'Lulus', nomorSertifikat: '', keterangan: '', version: psA.version })).body?.error === 'hasil_belum_boleh')
    const isiK = (k, extra = {}) => ({ nama: k.nama, jenis: k.jenis, penyelenggara: k.penyelenggara, lokasi: k.lokasi, nomorSurat: k.nomorSurat, tanggalMulai: k.tanggalMulai, tanggalSelesai: k.tanggalSelesai, catatan: k.catatan, version: k.version, ...extra })
    const pt = await call(op, 'PATCH', `${D}/${k1.id}`, isiK(k1, { lokasi: 'Bandung' }))
    check('PATCH saat Terjadwal → 200', pt.status === 200 && pt.body.item.lokasi === 'Bandung', short(pt))
    k1 = pt.body.item
    check('PATCH lokasi zero-width → 400', (await call(op, 'PATCH', `${D}/${k1.id}`, isiK(k1, { lokasi: 'Ban​dung' }))).status === 400)
    k1 = (await status(op, k1, 'Berjalan')).body.item
    check('Selesai tanpa tanggal selesai → 400', (await status(op, k1, 'Selesai')).status === 400)
    const besok = await tambahHari(today, 2)
    const sel = await status(op, k1, 'Selesai', { tanggalSelesai: besok })
    check('Selesai dengan tanggal → 200', sel.status === 200 && sel.body.item.status === 'Selesai' && sel.body.item.tanggalSelesai === besok, short(sel))
    k1 = sel.body.item
    check('PATCH nama setelah Selesai → 409', (await call(op, 'PATCH', `${D}/${k1.id}`, isiK(k1, { nama: `${TAG} Ganti` }))).status === 409)
    check('PATCH catatan saja setelah Selesai → 200', (await call(op, 'PATCH', `${D}/${k1.id}`, isiK(k1, { catatan: 'Catatan akhir' }))).status === 200)
    check('Berjalan dari Selesai → 409', (await status(op, (await detail(k1.id)).item, 'Berjalan')).status === 409)
    const psList = (await detail(k1.id)).peserta
    const psB = psList.find((p) => p.personelId === pB.id)
    check('hapus peserta setelah Selesai → 409', (await call(op, 'DELETE', `${D}/${k1.id}/peserta/${psB.id}?version=${psB.version}`)).status === 409)
    const psA2 = psList.find((p) => p.personelId === pA.id)
    check('nomor sertifikat dengan Tidak lulus → 400', (await call(op, 'PATCH', `${D}/${k1.id}/peserta/${psA2.id}`, { hasil: 'Tidak lulus', nomorSertifikat: 'X1', keterangan: '', version: psA2.version })).status === 400)
    const lulus = await call(op, 'PATCH', `${D}/${k1.id}/peserta/${psA2.id}`, { hasil: 'Lulus', nomorSertifikat: 'SERT-001', keterangan: '', version: psA2.version })
    check('hasil Lulus + nomor → 200', lulus.status === 200 && lulus.body.peserta.hasil === 'Lulus', short(lulus))
    const k2 = await kegiatan()
    const bt = await status(op, k2, 'Dibatalkan', { catatan: 'pendek' })
    check('batalkan alasan < 8 → 400', bt.status === 400)
    const btOk = await status(op, k2, 'Dibatalkan', { catatan: 'Anggaran dialihkan' })
    check('batalkan dengan alasan → Dibatalkan', btOk.body?.item?.status === 'Dibatalkan', short(btOk))

    log('\n5. Kompetensi')
    const kom = (extra) => call(op, 'POST', KP, { personelId: pA.id, nama: 'Sertifikat Uji', kategori: 'Kursus', nomor: '', penerbit: '', tanggalTerbit: '', berlakuSampai: '', catatan: '', ...extra })
    const dari = await kom({ dariPesertaId: psA2.id, nama: 'Sertifikat Pelatihan', nomor: 'SERT-001' })
    check('kompetensi dari peserta Lulus → 201', dari.status === 201 && dari.body.item.dariDiklat?.id === k1.id, short(dari))
    check('kedua kali → 409 kompetensi_ganda', (await kom({ dariPesertaId: psA2.id })).body?.error === 'kompetensi_ganda')
    check('dari peserta yang belum Lulus → 409', (await call(op, 'POST', KP, { personelId: pB.id, dariPesertaId: psB.id, nama: 'X Sert', kategori: 'Kursus', nomor: '', penerbit: '', tanggalTerbit: '', berlakuSampai: '', catatan: '' })).status === 409)
    check('personelId bukan milik peserta → 400', (await call(op, 'POST', KP, { personelId: pB.id, dariPesertaId: psA2.id, nama: 'X Sert', kategori: 'Kursus', nomor: '', penerbit: '', tanggalTerbit: '', berlakuSampai: '', catatan: '' })).status === 400)
    const psA3 = (await detail(k1.id)).peserta.find((p) => p.personelId === pA.id)
    check('K26: Lulus → Tidak lulus padahal ada kompetensi → 409 kompetensi_terkait', (await call(op, 'PATCH', `${D}/${k1.id}/peserta/${psA3.id}`, { hasil: 'Tidak lulus', nomorSertifikat: '', keterangan: '', version: psA3.version })).body?.error === 'kompetensi_terkait')
    check('terbit > berlaku → 400', (await kom({ tanggalTerbit: '2026-02-01', berlakuSampai: '2026-01-01' })).status === 400)
    const batas = [[0, 'KEDALUWARSA'], [1, 'H-30'], [30, 'H-30'], [31, 'H-60'], [60, 'H-60'], [61, null]]
    const pD = await personel()
    for (const [n, want] of batas) {
      const r = await call(op, 'POST', KP, { personelId: pD.id, nama: `Sert Batas ${n}`, kategori: 'Lisensi', nomor: '', penerbit: '', tanggalTerbit: '', berlakuSampai: await tambahHari(today, n), catatan: '' })
      check(`berlaku +${n} hari → ${want ?? 'tanpa tahap'}`, r.status === 201 && r.body.item.tahap === want && r.body.item.sisaHari === n, short(r))
    }
    check('tanpa batas → tanpa tahap', (await call(op, 'POST', KP, { personelId: pD.id, nama: 'Sert Selamanya', kategori: 'Keahlian', nomor: '', penerbit: '', tanggalTerbit: '', berlakuSampai: '', catatan: '' })).body?.item?.tahap === null)
    const al = (await call(kabag, 'GET', `${KP}/alert`)).body
    const alD = al.items.filter((a) => a.personelId === pD.id)
    check('alert memuat 5 kompetensi uji dan ringkas konsisten', alD.length === 5 && al.ringkas.KEDALUWARSA === al.items.filter((a) => a.tahap === 'KEDALUWARSA').length, JSON.stringify(al.ringkas))
    await call(op, 'POST', KP, { personelId: pD.id, nama: 'sert batas 0', kategori: 'Lisensi', nomor: '', penerbit: '', tanggalTerbit: '', berlakuSampai: await tambahHari(today, 400), catatan: '' })
    const al2 = (await call(kabag, 'GET', `${KP}/alert?tahap=KEDALUWARSA`)).body.items.filter((a) => a.personelId === pD.id)
    check('K30: pengganti bernama sama menghapus kedaluwarsa dari alert', al2.length === 0, JSON.stringify(al2.map((a) => a.nama)))

    log('\n6. Lampiran tiga pemilik')
    const upK = await unggah(op, `${D}/${k1.id}/lampiran`)
    check('lampiran kegiatan → 201', upK.status === 201, short(upK))
    const row = (await sql.query("SELECT substring(body FROM 1 FOR 4) AS head, position('%PDF'::bytea IN body) AS pos FROM sdl_sumda_diklat_lampiran WHERE id=$1::uuid", [upK.body?.id])).rows[0]
    check('body diawali SDL1 tanpa %PDF', row?.head?.toString('latin1') === 'SDL1' && row.pos === 0)
    const dl = await call(kabag, 'GET', `${D}/${k1.id}/lampiran/${upK.body?.id}`)
    check('kabag unduh byte-identik', dl.status === 200 && dl.bytes.equals(PDF))
    check('lampiran kegiatan Dibatalkan → 409', (await unggah(op, `${D}/${k2.id}/lampiran`)).status === 409)
    const upP = await unggah(op, `${D}/${k1.id}/peserta/${psA3.id}/lampiran`)
    check('sertifikat peserta (kegiatan Selesai) → 201', upP.status === 201, short(upP))
    check('sertifikat peserta sebelum Selesai → 409', (await unggah(op, `${D}/${(await kegiatan()).id}/peserta/${psA3.id}/lampiran`)).status !== 201)
    check('id silang: lampiran kegiatan lewat path peserta → 404', (await call(op, 'GET', `${D}/${k1.id}/peserta/${psA3.id}/lampiran/${upK.body?.id}`)).status === 404)
    check('id silang: peserta k1 lewat kegiatan k2 → 404', (await call(op, 'GET', `${D}/${k2.id}/peserta/${psA3.id}/lampiran/${upP.body?.id}`)).status === 404)
    const kid = dari.body.item.id
    const upKo = await unggah(op, `${KP}/${kid}/lampiran`)
    check('lampiran kompetensi → 201', upKo.status === 201, short(upKo))
    check('id silang: lampiran kegiatan lewat kompetensi → 404', (await call(op, 'GET', `${KP}/${kid}/lampiran/${upK.body?.id}`)).status === 404)
    const det = (await call(ka, 'GET', `${KP}/${kid}`)).body
    check('detail kompetensi menautkan sertifikat peserta (K24)', det.sertifikatPeserta.length === 1 && det.lampiran.length === 1)
    check('staf hapus lampiran milik op → 403', (await call(staf, 'DELETE', `${D}/${k1.id}/lampiran/${upK.body?.id}`)).status === 403)
    check('PDF palsu → 400', (await unggah(op, `${D}/${k1.id}/lampiran`, Buffer.from('bukan pdf'), 'x.pdf')).status === 400)
    await sql.query("UPDATE sdl_sumda_diklat_lampiran SET body = overlay(body PLACING '\\x00'::bytea FROM 40 FOR 1) WHERE id=$1::uuid", [upKo.body?.id])
    check('body dirusak → 503 evidence_integrity_failure', (await call(op, 'GET', `${KP}/${kid}/lampiran/${upKo.body?.id}`)).body?.error === 'evidence_integrity_failure')

    log('\n7. Arsip')
    const kNow = (await detail(k1.id)).item
    check('op arsip kegiatan → 403', (await call(op, 'DELETE', `${D}/${k1.id}?version=${kNow.version}`)).status === 403)
    const pRiw = (await call(kabag, 'GET', `${PER}/${pA.id}`)).body.item
    check('aditif R5H27: riwayatDiklat & kompetensi di detail personel', pRiw.riwayatDiklat?.some((x) => x.diklatId === k1.id && x.hasil === 'Lulus') && pRiw.kompetensi?.some((x) => x.id === kid))
    check('Kasubbag arsip kegiatan → 204', (await call(ka, 'DELETE', `${D}/${k1.id}?version=${kNow.version}`)).status === 204)
    check('setelah arsip: GET 404, unduh peserta 404', (await call(op, 'GET', `${D}/${k1.id}`)).status === 404 && (await call(op, 'GET', `${D}/${k1.id}/peserta/${psA3.id}/lampiran/${upP.body?.id}`)).status === 404)
    check('kompetensi turunan tetap ada (K33)', (await call(op, 'GET', `${KP}/${kid}`)).status === 200)
    check('kegiatan terarsip tidak tampil di riwayatDiklat', !(await call(kabag, 'GET', `${PER}/${pA.id}`)).body.item.riwayatDiklat.some((x) => x.diklatId === k1.id))

    log('\n8. Dashboard & audit')
    const d0 = (await call(kabag, 'GET', DASH)).body.totals.kompetensiKedaluwarsa60
    await call(op, 'POST', KP, { personelId: pB.id, nama: 'Sert Dashboard', kategori: 'Kursus', nomor: '', penerbit: '', tanggalTerbit: '', berlakuSampai: await tambahHari(today, 10), catatan: '' })
    check('dashboard kompetensiKedaluwarsa60 +1', (await call(kabag, 'GET', DASH)).body.totals.kompetensiKedaluwarsa60 === d0 + 1)
    const pids = (await sql.query(`SELECT id::text FROM sdl_sumda_personel WHERE nrp LIKE '${PREFIX}%'`)).rows.map((r) => r.id)
    const ev = (await sql.query(`SELECT event_key, metadata::text AS m FROM sdl_audit_events
      WHERE subject_type IN ('subbagsumda.diklat','subbagsumda.kompetensi') AND created_at > now() - interval '15 minutes'`)).rows
    const keys = new Set(ev.map((e) => e.event_key))
    check('event audit tercatat', ['subbagsumda.diklat.create', 'subbagsumda.diklat.selesai', 'subbagsumda.diklat.peserta.add', 'subbagsumda.diklat.lampiran.download', 'subbagsumda.kompetensi.create', 'subbagsumda.diklat.archive'].every((k) => keys.has(k)), [...keys].join(','))
    check('metadata tanpa NRP/nama/sertifikat/berkas', ev.every((e) => !e.m.includes(PREFIX) && !e.m.includes('Uji ') && !e.m.includes('SERT-') && !e.m.includes('.pdf') && !e.m.includes(TAG)))
    void pids

    if ((await hariIni()) !== today) { fail++; log('  GAGAL  tanggal WIB berganti selama uji — ulangi') }
  } finally {
    await bersihkan()
    await db.revokeMintedSessions().catch(() => {})
  }
  log(`\n${fail ? `GAGAL: ${fail} pemeriksaan` : 'LULUS: semua pemeriksaan'}\n`)
}

main().catch((e) => { console.error(e); fail++ }).finally(async () => { await sql.end(); await db.close(); process.exit(fail ? 1 : 0) })
