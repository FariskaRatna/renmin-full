import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { parseGoInt, respond } from '../subbagren/shared.js'
import { KONDISI, STATUS_ASET, tahapAsetSql } from './aset.js'
import { JENIS_ARSIP, bolehArsip, tahapRetensiSql } from './arsip.js'
import { berkasCsv, pasangHeaderCsv } from './csv.js'
import { BATAS_EKSPOR, MODUL_EKSPOR } from './ekspor.js'
import { KATEGORI } from './kinerja.js'
import { tahapKompetensiSql } from './kompetensi.js'
import { proyeksiPensiunSql, tahapSql } from './personel.js'
import { GOLONGAN_PNS, HARI_INI, HttpError, makeHandle, permit } from './umum.js'

/**
 * R5H32: Subbagsumda — Laporan & Analitik + ekspor CSV. EXPRESS SAJA. Dokumen: docs/R5H32-SUMDA-ARSIP-LAPORAN.md.
 *
 *   GET /api/v1/subbagsumda/laporan/capabilities
 *   GET /api/v1/subbagsumda/laporan/ringkasan?tahun=
 *   GET /api/v1/subbagsumda/laporan/ekspor/:modul?<filter modul>        → text/csv (K18–K22, K41–K44)
 *
 * Hak: R personel.read (halaman) · E laporan.export · Rk kinerja.read · Ri inventaris.read · Ra arsip.read · Xa arsip.restricted.
 * K37: setiap blok agregat hanya dihitung bila pemanggil memegang hak modulnya; selain itu `null` (bukan nol).
 * K36/R2: angka arsip atas baris TERLIHAT (bolehArsip); rincian per kerahasiaan hanya untuk Xa.
 * Satu koneksi per ringkasan dalam transaksi REPEATABLE READ READ ONLY (angka kartu = grafik) + statement_timeout 5s.
 * Rumus tahap (pensiun, kompetensi, aset, retensi) dan predikat visibilitas DIIMPOR dari modul asal — tidak disalin.
 * Berkas ini boleh mengimpor modul lain; tidak ada modul yang mengimpor berkas ini.
 */

const P = {
  read: 'subbagsumda.personel.read',
  export: 'subbagsumda.laporan.export',
  kinerja: 'subbagsumda.kinerja.read',
  inventaris: 'subbagsumda.inventaris.read',
  arsip: 'subbagsumda.arsip.read',
  restricted: 'subbagsumda.arsip.restricted',
}
const MAKS_UNIT = 15 // K38
const FINAL = "('Selesai','Ditolak','Dibatalkan')"
const handle = makeHandle()

const tahunSah = (raw) => {
  const t = parseGoInt(String(raw))
  if (t === undefined || t < 1950 || t > 2100) throw new HttpError(400, 'invalid_input')
  return t
}

/** K38: 15 unit kerja teratas + "Lainnya (n unit)"; teks kosong → "Belum diisi". */
function ringkasUnit(rows) {
  const atas = rows.slice(0, MAKS_UNIT).map((r) => ({ label: r.label === '' ? 'Belum diisi' : r.label, jumlah: r.n }))
  const sisa = rows.slice(MAKS_UNIT)
  if (sisa.length) atas.push({ label: `Lainnya (${sisa.length} unit)`, jumlah: sisa.reduce((s, r) => s + r.n, 0) })
  return atas
}

/** Ringkasan K15/K37–K40. `c` = klien dalam transaksi baca; `hak` = hasil PERMIT. */
async function ringkasan(c, tahun, actor, hak) {
  const q = async (text, args = []) => (await c.query(text, args)).rows
  const satu = async (text, args = []) => (await q(text, args))[0]
  const AKTIF = "p.deleted_at IS NULL AND p.status IN ('Aktif','MPP')"

  const per = await satu(`SELECT count(*) FILTER (WHERE status='Aktif')::int AS aktif, count(*) FILTER (WHERE status='MPP')::int AS mpp,
    count(*)::int AS total FROM sdl_sumda_personel p WHERE p.deleted_at IS NULL`)
  const perUnit = ringkasUnit(await q(`SELECT p.unit_kerja AS label, count(*)::int AS n FROM sdl_sumda_personel p WHERE ${AKTIF}
    GROUP BY p.unit_kerja ORDER BY n DESC, p.unit_kerja`))
  const polri = (await q(`SELECT coalesce(rm.short_name, nullif(p.pangkat,''), 'Belum diisi') AS label, count(*)::int AS n, min(rm.sort_order) AS urut
      FROM sdl_sumda_personel p LEFT JOIN sdl_polri_rank_master rm ON rm.code=p.pangkat
     WHERE ${AKTIF} AND p.jenis IS DISTINCT FROM 'PNS' GROUP BY 1 ORDER BY urut NULLS LAST, label`)).map((r) => ({ label: r.label, jumlah: r.n }))
  const pnsRows = await q(`SELECT coalesce(nullif(p.pangkat,''), 'Belum diisi') AS label, count(*)::int AS n FROM sdl_sumda_personel p
     WHERE ${AKTIF} AND p.jenis='PNS' GROUP BY 1`)
  const urutPns = (l) => { const i = GOLONGAN_PNS.indexOf(l); return i < 0 ? 999 : i }
  const pns = pnsRows.sort((a, b) => urutPns(a.label) - urutPns(b.label) || a.label.localeCompare(b.label)).map((r) => ({ label: r.label, jumlah: r.n }))
  const proyeksi = await q(proyeksiPensiunSql(12))
  // K37: pensiun ≤ 30 hari = tahap H-30 s.d. JATUH_TEMPO (termasuk terlewat), sama dengan alert R5H27.
  const pensiun30 = (await satu(`SELECT count(*)::int AS n FROM sdl_sumda_personel p WHERE p.deleted_at IS NULL
    AND ${tahapSql()} IN ('H-30','H-14','H-7','JATUH_TEMPO')`)).n
  const layanan = await satu(`SELECT
     (SELECT count(*)::int FROM sdl_sumda_karier x JOIN sdl_sumda_personel p ON p.id=x.personel_id AND p.deleted_at IS NULL WHERE x.status NOT IN ${FINAL}) AS karier,
     (SELECT count(*)::int FROM sdl_sumda_cuti x JOIN sdl_sumda_personel p ON p.id=x.personel_id AND p.deleted_at IS NULL WHERE x.status NOT IN ${FINAL}) AS cuti,
     (SELECT count(*)::int FROM sdl_sumda_kesejahteraan x JOIN sdl_sumda_personel p ON p.id=x.personel_id AND p.deleted_at IS NULL WHERE x.status NOT IN ${FINAL}) AS kesejahteraan`)
  const bulan = `generate_series(make_date($1,1,1), make_date($1,12,1), interval '1 month') AS b(m)`
  const cuti = await q(`SELECT to_char(b.m,'YYYY-MM') AS bulan, count(c.id)::int AS pengajuan, coalesce(sum(c.jumlah_hari),0)::int AS hari
      FROM ${bulan} LEFT JOIN sdl_sumda_cuti c ON c.status IN ('Disetujui','Selesai')
           AND c.tanggal_mulai >= b.m::date AND c.tanggal_mulai < (b.m + interval '1 month')::date
     GROUP BY b.m ORDER BY b.m`, [tahun])
  const diklat = await q(`SELECT to_char(b.m,'YYYY-MM') AS bulan, count(DISTINCT d.id)::int AS kegiatan, count(ps.id)::int AS peserta
      FROM ${bulan} LEFT JOIN sdl_sumda_diklat d ON d.deleted_at IS NULL AND d.status<>'Dibatalkan'
           AND d.tanggal_mulai >= b.m::date AND d.tanggal_mulai < (b.m + interval '1 month')::date
      LEFT JOIN sdl_sumda_diklat_peserta ps ON ps.diklat_id=d.id
     GROUP BY b.m ORDER BY b.m`, [tahun])
  // K40: register — `jumlah` = tahun terpilih, `diproses` = keadaan saat ini.
  const reg = await satu(`SELECT
     (SELECT count(*)::int FROM sdl_sumda_karier WHERE extract(year FROM tanggal_usulan)=$1) AS karier_j,
     (SELECT count(*)::int FROM sdl_sumda_karier WHERE status NOT IN ${FINAL}) AS karier_p,
     (SELECT count(*)::int FROM sdl_sumda_diklat WHERE deleted_at IS NULL AND extract(year FROM tanggal_mulai)=$1) AS diklat_j,
     (SELECT count(*)::int FROM sdl_sumda_diklat WHERE deleted_at IS NULL AND status IN ('Terjadwal','Berjalan')) AS diklat_p,
     (SELECT count(*)::int FROM sdl_sumda_kompetensi k JOIN sdl_sumda_personel p ON p.id=k.personel_id
       WHERE k.deleted_at IS NULL AND p.deleted_at IS NULL AND extract(year FROM k.tanggal_terbit)=$1) AS kompetensi_j,
     (SELECT count(*)::int FROM sdl_sumda_kompetensi k JOIN sdl_sumda_personel p ON p.id=k.personel_id WHERE ${tahapKompetensiSql()} IS NOT NULL) AS kompetensi_p,
     (SELECT count(*)::int FROM sdl_sumda_cuti WHERE extract(year FROM tanggal_mulai)=$1) AS cuti_j,
     (SELECT count(*)::int FROM sdl_sumda_cuti WHERE status NOT IN ${FINAL}) AS cuti_p,
     (SELECT count(*)::int FROM sdl_sumda_kesejahteraan WHERE extract(year FROM (created_at AT TIME ZONE 'Asia/Jakarta'))=$1) AS kesejahteraan_j,
     (SELECT count(*)::int FROM sdl_sumda_kesejahteraan WHERE status NOT IN ${FINAL}) AS kesejahteraan_p`, [tahun])
  const register = ['karier', 'diklat', 'kompetensi', 'cuti', 'kesejahteraan'].map((m) => ({ modul: m, jumlah: reg[`${m}_j`], diproses: reg[`${m}_p`] }))

  let kinerja = null
  if (hak.kinerja) {
    const rows = await q(`SELECT kategori, count(*)::int AS n FROM sdl_sumda_kinerja WHERE tahun=$1 AND status IN ('Disetujui','Selesai') GROUP BY 1`, [tahun])
    const r = await satu(`SELECT count(*) FILTER (WHERE tahun=$1 AND status<>'Dibatalkan')::int AS j,
      count(*) FILTER (WHERE status IN ('Draft','Diajukan'))::int AS p FROM sdl_sumda_kinerja`, [tahun])
    kinerja = { perKategori: KATEGORI.map((k) => ({ kategori: k, jumlah: rows.find((x) => x.kategori === k)?.n ?? 0 })) }
    register.push({ modul: 'kinerja', jumlah: r.j, diproses: r.p })
  }
  let aset = null
  if (hak.inventaris) {
    const kondisi = await q(`SELECT kondisi, count(*)::int AS n FROM sdl_sumda_aset WHERE status<>'Dihapus' GROUP BY 1`)
    const status = await q('SELECT status, count(*)::int AS n FROM sdl_sumda_aset GROUP BY 1')
    const r = await satu(`SELECT count(*) FILTER (WHERE a.status<>'Dihapus')::int AS aktif,
      count(*) FILTER (WHERE ${tahapAsetSql()} IS NOT NULL)::int AS jt, count(*) FILTER (WHERE a.status IN ('Pemeliharaan','Usulan Penghapusan'))::int AS p
      FROM sdl_sumda_aset a`)
    aset = {
      terdaftar: r.aktif, pemeliharaan14: r.jt,
      perKondisi: KONDISI.map((k) => ({ label: k, jumlah: kondisi.find((x) => x.kondisi === k)?.n ?? 0 })),
      perStatus: STATUS_ASET.map((s) => ({ label: s, jumlah: status.find((x) => x.status === s)?.n ?? 0 })),
    }
    register.push({ modul: 'aset', jumlah: r.aktif, diproses: r.p })
  }
  let arsip = null
  if (hak.arsip) {
    // K36: hanya baris TERLIHAT — TERBATAS milik orang lain tidak pernah menggerakkan angka.
    const v = `FROM sdl_sumda_arsip a WHERE ${bolehArsip('$1', '$2')}`
    const r = await satu(`SELECT count(*) FILTER (WHERE a.status='Aktif')::int AS aktif, count(*) FILTER (WHERE a.status='Inaktif')::int AS inaktif,
      count(*) FILTER (WHERE a.status='Musnah')::int AS musnah, count(*) FILTER (WHERE ${tahapRetensiSql()} IS NOT NULL)::int AS retensi,
      count(*) FILTER (WHERE extract(year FROM a.tanggal)=$3)::int AS tahun,
      count(*) FILTER (WHERE a.kerahasiaan='TERBATAS')::int AS terbatas ${v}`, [actor, hak.restricted, tahun])
    const jenis = await q(`SELECT a.jenis, count(*)::int AS n ${v} AND extract(year FROM a.tanggal)=$3 GROUP BY 1`, [actor, hak.restricted, tahun])
    arsip = {
      aktif: r.aktif, inaktif: r.inaktif, musnah: r.musnah, retensi30: r.retensi,
      perJenis: JENIS_ARSIP.map((j) => ({ label: j, jumlah: jenis.find((x) => x.jenis === j)?.n ?? 0 })),
      // K36: rincian kerahasiaan hanya bagi pemegang arsip.restricted.
      terbatas: hak.restricted ? r.terbatas : null,
    }
    register.push({ modul: 'arsip', jumlah: r.tahun, diproses: r.retensi })
  }

  return {
    personel: { aktif: per.aktif, mpp: per.mpp, total: per.total, perUnit, perPangkat: { polri, pns }, proyeksi },
    pensiun30,
    layananBerjalan: { ...layanan, total: layanan.karier + layanan.cuti + layanan.kesejahteraan },
    cuti: { perBulan: cuti },
    diklat: { perBulan: diklat },
    register,
    kinerja,
    aset,
    arsip,
  }
}

/** Audit ekspor (K22/K49): hanya modul, jumlah baris, dan filter enum/bilangan yang lolos validasi. */
async function auditEkspor(c, actor, modul, jumlah, filter) {
  await c.query(
    'INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,$3,$4,$5)',
    [actor, 'subbagsumda.laporan.export', 'subbagsumda.laporan', modul, { modul, jumlah, filter }])
}

export function createSumdaLaporanRouter({ pool }) {
  const router = Router()
  const { can, need } = permit(pool)

  router.get('/capabilities', handle(async (req, res) => {
    const [read, exp, inventaris, arsip] = await Promise.all([P.read, P.export, P.inventaris, P.arsip].map((k) => can(req.actor, k)))
    const hakModul = { 'subbagsumda.personel.read': read, 'subbagsumda.inventaris.read': inventaris, 'subbagsumda.arsip.read': arsip }
    respond(res, 200, {
      canRead: read, canExport: exp,
      modul: Object.fromEntries(Object.entries(MODUL_EKSPOR).map(([m, d]) => [m, exp && hakModul[d.hak] === true])),
    })
  }))

  router.get('/ringkasan', handle(async (req, res) => {
    await need(req, P.read)
    for (const k of Object.keys(req.query)) if (k !== 'tahun') throw new HttpError(400, 'invalid_input')
    const tahunIni = (await pool.query(`SELECT extract(year FROM ${HARI_INI})::int AS t, (${HARI_INI})::text AS d`)).rows[0]
    const tahun = req.query.tahun === undefined || req.query.tahun === '' ? tahunIni.t : tahunSah(req.query.tahun)
    const [kinerja, inventaris, arsip, restricted] = await Promise.all([P.kinerja, P.inventaris, P.arsip, P.restricted].map((k) => can(req.actor, k)))
    const isi = await withTransaction(pool, async (c) => {
      await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
      await c.query("SET LOCAL statement_timeout = '5s'")
      return ringkasan(c, tahun, req.actor, { kinerja, inventaris, arsip, restricted: restricted && arsip })
    })
    respond(res, 200, { tahun, tahunIni: tahunIni.t, hariIni: tahunIni.d, ...isi })
  }))

  router.get('/ekspor/:modul', handle(async (req, res) => {
    await need(req, P.export)
    const modul = String(req.params.modul)
    if (!Object.hasOwn(MODUL_EKSPOR, modul)) throw new HttpError(404, 'not_found')
    const m = MODUL_EKSPOR[modul]
    await need(req, m.hak)
    // K42: hanya kunci filter modul ini; nilai dari daftar tetap atau bilangan tahun.
    const filter = {}
    for (const [k, raw] of Object.entries(req.query)) {
      if (!Object.hasOwn(m.filter, k) || typeof raw !== 'string') throw new HttpError(400, 'invalid_input')
      if (raw === '') continue
      if (m.filter[k] === 'tahun') filter[k] = tahunSah(raw)
      else if (m.filter[k].includes(raw)) filter[k] = raw
      else throw new HttpError(400, 'invalid_input')
    }
    const ctx = { actor: req.actor }
    if (modul === 'kinerja') ctx.rk = await can(req.actor, P.kinerja)
    if (modul === 'arsip') ctx.xa = await can(req.actor, P.restricted)
    const { text, args } = m.sql(filter, ctx)
    const rows = (await pool.query(text, args)).rows
    if (rows.length > BATAS_EKSPOR) throw new HttpError(413, 'terlalu_banyak') // K21: sebelum satu byte pun dikirim, tidak diaudit
    const buf = berkasCsv(m.header, rows.map(m.baris))
    const tgl = (await pool.query(`SELECT to_char(${HARI_INI},'YYYYMMDD') AS d`)).rows[0].d
    // K43: audit LEBIH DULU dalam transaksi sendiri; gagal → 503 JSON tanpa data. Nama berkas ASCII dari daftar putih
    // modul + tanggal, jadi header tidak bisa melempar setelah audit (alasan urutan header-dulu di R5H28 S1).
    try { await withTransaction(pool, (c) => auditEkspor(c, req.actor, modul, rows.length, filter)) } catch { throw new HttpError(503, 'database_unavailable') }
    pasangHeaderCsv(res, `sumda-${modul}-${tgl}.csv`)
    res.status(200).end(buf)
  }))

  return router
}
