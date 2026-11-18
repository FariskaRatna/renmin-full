import { createHash } from 'node:crypto'

import { withTransaction } from '../../db.js'
import { readSingleFile } from '../../http/multipart.js'
import { parseGoInt, respond } from './shared.js'
import { FormatError, MAX_FILE, parseMyinterest } from './myinterest-xlsx.js'

/**
 * R5H20 (migrasi 062): data resmi myinterest "Realisasi Belanja per Jenis Kegiatan".
 * EXPRESS SAJA. Dipasang di router progar (/api/v1/subbagren/progar):
 *   GET    /myinterest?tahun=2026|terbaru   daftar impor + potret terbaru per kegiatan/jenis + seri bulanan
 *   POST   /myinterest                      multipart `file` .xlsx <= 2 MB (subbagren.realisasi.manage)
 *          impor ulang tanggal data yang sama menggantikan potret lama (yang lama dihapus lunak)
 *   DELETE /myinterest/:id                  hapus lunak (salah file)
 * Keputusan pemilik 2026-11-18 (terakhir): impor di menu sendiri "Data myinterest (LRA)",
 * bukan di tahap LRA; LRA kembali ke alur semula dan membaca potret dari menu ini.
 * Baca: subbagren.progar.read (termasuk Kabagrenmin untuk dashboard pimpinan).
 * Angka dikirim sebagai string digit (rupiah bulat).
 */

const SAFE_NAME = /^[\p{L}\p{N} ._()\-,]{1,150}\.xlsx$/iu
const JENIS = ['pegawai', 'barang', 'modal', 'bunga', 'subsidi', 'hibah', 'bansos', 'lain', 'transfer']

/** Potret aktif terakhir dengan tanggal_akhir dalam [awal, akhir]. */
export async function potretDalam(c, awal, akhir) {
  const r = await c.query(
    `SELECT id::text,tanggal_akhir::text,waktu_unduh FROM sdl_ren_myinterest_impor
      WHERE deleted_at IS NULL AND tanggal_akhir BETWEEN $1::date AND $2::date ORDER BY tanggal_akhir DESC LIMIT 1`, [awal, akhir])
  return r.rows[0] ?? null
}

/** Pagu & realisasi kumulatif per kegiatan satu potret: Map(kode -> {nama,pagu,realisasi}). */
export async function kegiatanPotret(c, imporId) {
  const rows = (await c.query(
    `SELECT kode,max(nama) AS nama,sum(pagu)::text AS pagu,sum(realisasi)::text AS realisasi
       FROM sdl_ren_myinterest_baris WHERE impor_id=$1::uuid GROUP BY kode ORDER BY kode`, [imporId])).rows
  return new Map(rows.map((r) => [r.kode, { nama: r.nama, pagu: r.pagu, realisasi: r.realisasi }]))
}

/**
 * Simpan satu hasil parseMyinterest sebagai potret aktif (dipakai POST /myinterest). Potret aktif bertanggal
 * sama digantikan (dihapus lunak). Dipanggil di dalam transaksi pemanggil.
 */
export async function simpanPotret(c, data, { filename, digest, actor, audit }) {
  const tahun = Number(data.tanggalAkhir.slice(0, 4))
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`myinterest:${data.tanggalAkhir}`])
  const lama = (await c.query(
    `UPDATE sdl_ren_myinterest_impor SET deleted_at=now(),deleted_by=$2 WHERE tanggal_akhir=$1::date AND deleted_at IS NULL RETURNING id::text`,
    [data.tanggalAkhir, actor])).rows
  for (const l of lama) await audit(c, actor, 'myinterest.replace', 'myinterest', l.id)
  const r = (await c.query(
    `INSERT INTO sdl_ren_myinterest_impor(tahun,tanggal_awal,tanggal_akhir,waktu_unduh,filename,sha256,total_pagu,total_realisasi,imported_by)
     VALUES($1,$2::date,$3::date,$4,$5,$6,$7::numeric,$8::numeric,$9) RETURNING id::text`,
    [tahun, data.tanggalAwal, data.tanggalAkhir, data.waktuUnduh, filename, digest, data.totalPagu.toString(), data.totalRealisasi.toString(), actor])).rows[0]
  for (const k of data.kegiatan) {
    for (const [jenis, v] of Object.entries(k.jenis)) {
      if (v.pagu === 0n && v.realisasi === 0n) continue
      await c.query(
        'INSERT INTO sdl_ren_myinterest_baris(impor_id,kode,nama,jenis,pagu,realisasi) VALUES($1::uuid,$2,$3,$4,$5::numeric,$6::numeric)',
        [r.id, k.kode, k.nama, jenis, v.pagu.toString(), v.realisasi.toString()])
    }
  }
  await audit(c, actor, 'myinterest.import', 'myinterest', r.id)
  return { id: r.id, menggantikan: lama.length > 0 }
}

export function registerMyinterest(router, { pool, need, HttpError, audit, handle, id }) {
  router.get('/myinterest', handle(async (req, res) => {
    await need(req, 'subbagren.progar.read')
    const raw = String(req.query.tahun ?? '')
    let tahun
    if (raw === 'terbaru') {
      tahun = (await pool.query('SELECT max(tahun)::int AS t FROM sdl_ren_myinterest_impor WHERE deleted_at IS NULL')).rows[0].t ?? new Date().getFullYear()
    } else {
      tahun = raw === '' ? new Date().getFullYear() : parseGoInt(raw)
      if (tahun === undefined || tahun < 2000 || tahun > 2100) throw new HttpError(400, 'invalid_year')
    }
    const impor = (await pool.query(
      `SELECT i.id::text,i.tanggal_awal::text,i.tanggal_akhir::text,i.waktu_unduh,i.filename,i.total_pagu::text,i.total_realisasi::text,
              i.imported_at,u.display_name AS imported_name
         FROM sdl_ren_myinterest_impor i JOIN sdl_users u ON u.id=i.imported_by
        WHERE i.deleted_at IS NULL AND i.tahun=$1 ORDER BY i.tanggal_akhir DESC`, [tahun])).rows
    let terbaru = null
    if (impor.length) {
      const top = impor[0]
      const rows = (await pool.query(
        `SELECT kode,nama,jenis,pagu::text,realisasi::text FROM sdl_ren_myinterest_baris WHERE impor_id=$1::uuid ORDER BY kode,jenis`, [top.id])).rows
      const keg = new Map(); const perJenis = {}
      for (const r of rows) {
        if (!keg.has(r.kode)) keg.set(r.kode, { kode: r.kode, nama: r.nama, pagu: 0n, realisasi: 0n, jenis: {} })
        const k = keg.get(r.kode)
        k.pagu += BigInt(r.pagu); k.realisasi += BigInt(r.realisasi); k.jenis[r.jenis] = { pagu: r.pagu, realisasi: r.realisasi }
        const pj = perJenis[r.jenis] ?? (perJenis[r.jenis] = { pagu: 0n, realisasi: 0n })
        pj.pagu += BigInt(r.pagu); pj.realisasi += BigInt(r.realisasi)
      }
      terbaru = {
        imporId: top.id, tanggalAkhir: top.tanggal_akhir, waktuUnduh: top.waktu_unduh, totalPagu: top.total_pagu, totalRealisasi: top.total_realisasi,
        kegiatan: [...keg.values()].map((k) => ({ ...k, pagu: k.pagu.toString(), realisasi: k.realisasi.toString() })),
        perJenis: Object.fromEntries(JENIS.filter((j) => perJenis[j]).map((j) => [j, { pagu: perJenis[j].pagu.toString(), realisasi: perJenis[j].realisasi.toString() }])),
      }
    }
    // Seri bulanan: potret terakhir di tiap bulan; realisasi bulan = selisih dengan bulan sebelumnya.
    const perBulan = new Map()
    for (const i of [...impor].reverse()) perBulan.set(Number(i.tanggal_akhir.slice(5, 7)), i)
    const bulanan = []
    for (let m = 1; m <= 12; m++) {
      const i = perBulan.get(m)
      if (!i) continue
      const prev = m === 1 ? null : perBulan.get(m - 1)
      const kum = BigInt(i.total_realisasi)
      bulanan.push({
        bulan: m, tanggalAkhir: i.tanggal_akhir, pagu: i.total_pagu, kumulatif: kum.toString(),
        bulanIni: m === 1 ? kum.toString() : prev ? (kum - BigInt(prev.total_realisasi)).toString() : null,
      })
    }
    respond(res, 200, {
      tahun, terbaru, bulanan,
      impor: impor.map((i) => ({
        id: i.id, tanggalAwal: i.tanggal_awal, tanggalAkhir: i.tanggal_akhir, waktuUnduh: i.waktu_unduh, filename: i.filename,
        totalPagu: i.total_pagu, totalRealisasi: i.total_realisasi, importedAt: i.imported_at, importedByName: i.imported_name,
      })),
    })
  }))

  router.post('/myinterest', handle(async (req, res) => {
    await need(req, 'subbagren.realisasi.manage')
    const up = await readSingleFile(req, { fieldName: 'file', maxBodyBytes: MAX_FILE + 65536, maxFileBytes: MAX_FILE, maxFiles: 2 })
    if (up.bodyExceeded || up.error === 'too_large') throw new HttpError(413, 'file_too_large')
    if (up.fileCount !== 1 || !up.file) throw new HttpError(400, 'one_file_required')
    const filename = up.file.filename.trim()
    if (!SAFE_NAME.test(filename)) throw new HttpError(400, 'invalid_file_type')
    let data
    try { data = parseMyinterest(up.file.buffer) } catch (e) {
      if (e instanceof FormatError) throw new HttpError(400, e.code)
      throw new HttpError(400, 'bukan_xlsx')
    }
    const tahun = Number(data.tanggalAkhir.slice(0, 4))
    // Angka myinterest kumulatif sejak 1 Januari; rentang lain tidak bisa dibandingkan antarbulan.
    if (data.tanggalAwal !== `${tahun}-01-01` || tahun < 2000 || tahun > 2100) throw new HttpError(400, 'rentang_tidak_didukung')
    const digest = createHash('sha256').update(up.file.buffer).digest('hex')
    const out = await withTransaction(pool, (c) => simpanPotret(c, data, { filename, digest, actor: req.actor, audit }))
    respond(res, 201, {
      ...out, tahun, tanggalAkhir: data.tanggalAkhir, kegiatan: data.kegiatan.length,
      totalPagu: data.totalPagu.toString(), totalRealisasi: data.totalRealisasi.toString(),
    })
  }))

  router.delete('/myinterest/:id', handle(async (req, res) => {
    await need(req, 'subbagren.realisasi.manage')
    const iid = id(req.params.id)
    await withTransaction(pool, async (c) => {
      const r = await c.query('UPDATE sdl_ren_myinterest_impor SET deleted_at=now(),deleted_by=$2 WHERE id=$1::uuid AND deleted_at IS NULL RETURNING 1', [iid, req.actor])
      if (!r.rowCount) throw new HttpError(404, 'not_found')
      await audit(c, req.actor, 'myinterest.delete', 'myinterest', iid)
    })
    respond(res, 200, { ok: true })
  }))
}
