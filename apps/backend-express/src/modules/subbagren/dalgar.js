import { HttpError, audit } from './progar.js'
import { kegiatanPotret, potretDalam } from './myinterest.js'

/**
 * R5H19 (migrasi 060): sambungan menu DALGAR ke angka anggaran/realisasi.
 * EXPRESS SAJA. Dipakai perencanaan.js (ringkasan laporan, butir revisi,
 * penerapan revisi) dan progar.js (RPD awal per pos).
 *
 * Pos anggaran = dokumen Final/Selesai yang punya Anggaran (estimasi), belum
 * digantikan revisi (R5H18). Laporan/revisi DALGAR sendiri tidak pernah menjadi pos.
 */

/** Laporan yang otomatis memuat realisasi terverifikasi (keputusan 2026-11-18). */
export const RINGKASAN_JENIS = new Set(['lap_lra', 'lap_penggunaan_anggaran', 'lap_eka_pn', 'lap_hibah'])
/** Revisi anggaran yang mengubah angka pos saat ditandai Selesai. */
export const REVISI_JENIS = { revisi_pok: 'anggaran', revisi_rpd: 'rpd' }
const BUKAN_POS = ['lap_lra', 'lap_penggunaan_anggaran', 'lap_eka_pn', 'lap_capaian_kinerja', 'lap_lkip', 'lap_hibah', 'revisi_pok', 'revisi_rpd']
/**
 * Tahap pekerjaan yang dicek Kasubbagren (Menunggu dicek -> Diterima/Dikembalikan)
 * hanya milik dokumen DALGAR. Tahap PROGAR langsung berlaku tanpa pengecekan
 * (keputusan pemilik 2026-11-18).
 */
export const tahapPerluCek = (jenis) => BUKAN_POS.includes(jenis)
export const MAX_BUTIR_REVISI = 40

const DIGANTIKAN = `EXISTS(SELECT 1 FROM sdl_ren_dokumen x WHERE x.pengganti_dari=d.id AND x.status='disahkan')`

/** periode '' / 'B07' / 'TW3' -> [bulanAwal, bulanAkhir]. */
export function rentangBulan(periode) {
  if (/^B(0[1-9]|1[0-2])$/.test(periode)) { const m = Number(periode.slice(1)); return [m, m] }
  if (/^TW[1-4]$/.test(periode)) { const q = Number(periode.slice(2)); return [q * 3 - 2, q * 3] }
  return [1, 12]
}
const iso = (t, m, d) => `${t}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const akhirBulan = (t, m) => new Date(Date.UTC(t, m, 0)).getUTCDate()

/** RPD 12 bulan per pos (string digit), atau null bila belum diisi. */
export async function rpdMap(c, ids) {
  const out = new Map()
  if (!ids.length) return out
  const rows = (await c.query('SELECT dokumen_id::text,bulan,jumlah::text FROM sdl_ren_rpd WHERE dokumen_id=ANY($1::uuid[])', [ids])).rows
  for (const r of rows) {
    if (!out.has(r.dokumen_id)) out.set(r.dokumen_id, Array(12).fill('0'))
    out.get(r.dokumen_id)[r.bulan - 1] = r.jumlah
  }
  return out
}

/**
 * Ringkasan realisasi untuk satu laporan: per pos, anggaran, rencana (RPD) dan
 * realisasi terverifikasi pada periode laporan serta kumulatif s.d. akhir periode.
 * Laporan tanpa periode = setahun penuh. Laporan Hibah hanya pos bertanda hibah.
 */
/**
 * R5H20: LRA memakai data RESMI myinterest (keputusan 2026-11-18), per kegiatan.
 * Kumulatif = potret terakhir di bulan laporan; realisasi bulan itu = selisih dengan
 * potret terakhir bulan sebelumnya (Januari: kumulatif itu sendiri).
 */
async function hitungLraMyinterest(c, { tahun, periode }) {
  const [m1, m2] = rentangBulan(periode)
  const akhir = iso(tahun, m2, akhirBulan(tahun, m2))
  const kini = await potretDalam(c, iso(tahun, m2, 1), akhir)
  const sebelum = m1 === 1 ? null : await potretDalam(c, iso(tahun, m1 - 1, 1), iso(tahun, m1 - 1, akhirBulan(tahun, m1 - 1)))
  const dasar = { sumber: 'myinterest', tahun, periode, bulanAwal: m1, bulanAkhir: m2, sampai: akhir, hibahSaja: false, menunggu: 0, dibuat: new Date().toISOString(), baris: [] }
  if (!kini) return { ...dasar, potret: null, potretSebelum: null, kegiatan: [], total: null }
  const now = await kegiatanPotret(c, kini.id)
  const prev = sebelum ? await kegiatanPotret(c, sebelum.id) : null
  const adaBulan = m1 === 1 || prev !== null
  const tot = { pagu: 0n, periode: 0n, kumulatif: 0n }
  const kegiatan = [...now.entries()].map(([kode, k]) => {
    const pagu = BigInt(k.pagu); const kum = BigInt(k.realisasi)
    const per = m1 === 1 ? kum : prev ? kum - BigInt(prev.get(kode)?.realisasi ?? '0') : null
    tot.pagu += pagu; tot.kumulatif += kum; if (per !== null) tot.periode += per
    return { kode, nama: k.nama, pagu: pagu.toString(), realisasiPeriode: per === null ? null : per.toString(), realisasiKumulatif: kum.toString(), sisa: (pagu - kum).toString() }
  })
  return {
    ...dasar,
    potret: { id: kini.id, tanggalAkhir: kini.tanggal_akhir, waktuUnduh: kini.waktu_unduh },
    potretSebelum: sebelum ? { tanggalAkhir: sebelum.tanggal_akhir } : null,
    kegiatan,
    total: { pagu: tot.pagu.toString(), realisasiPeriode: adaBulan ? tot.periode.toString() : null, realisasiKumulatif: tot.kumulatif.toString(), sisa: (tot.pagu - tot.kumulatif).toString() },
  }
}

export async function hitungRingkasan(c, { tahun, jenis, periode }) {
  if (jenis === 'lap_lra') return hitungLraMyinterest(c, { tahun, periode })
  const [m1, m2] = rentangBulan(periode)
  const awal = iso(tahun, m1, 1); const akhir = iso(tahun, m2, akhirBulan(tahun, m2))
  const hibahSaja = jenis === 'lap_hibah'
  const pos = (await c.query(
    `SELECT d.id::text,d.jenis,d.judul,d.nomor,COALESCE(d.anggaran,0)::text AS anggaran,d.hibah
       FROM sdl_ren_dokumen d
      WHERE d.tahun=$1 AND d.jenis<>ALL($2::text[]) AND (NOT $3::boolean OR d.hibah)
        AND ((d.anggaran IS NOT NULL AND d.final_at IS NOT NULL AND NOT ${DIGANTIKAN})
             OR EXISTS(SELECT 1 FROM sdl_ren_realisasi_dok r WHERE r.dokumen_id=d.id AND r.status='terverifikasi'))
      ORDER BY d.jenis,lower(d.judul),d.id`, [tahun, BUKAN_POS, hibahSaja])).rows
  const ids = pos.map((p) => p.id)
  const real = new Map((await c.query(
    `SELECT dokumen_id::text,
            COALESCE(sum(jumlah) FILTER (WHERE tanggal BETWEEN $2::date AND $3::date),0)::text AS periode,
            COALESCE(sum(jumlah) FILTER (WHERE tanggal<=$3::date),0)::text AS kumulatif
       FROM sdl_ren_realisasi_dok WHERE dokumen_id=ANY($1::uuid[]) AND status='terverifikasi' GROUP BY dokumen_id`,
    [ids, awal, akhir])).rows.map((r) => [r.dokumen_id, r]))
  const menunggu = Number((await c.query(
    `SELECT count(*)::int AS n FROM sdl_ren_realisasi_dok WHERE dokumen_id=ANY($1::uuid[]) AND status='draft' AND tanggal<=$2::date`,
    [ids, akhir])).rows[0].n)
  const rpd = await rpdMap(c, ids)
  const sum = (arr, a, b) => arr.slice(a - 1, b).reduce((n, x) => n + BigInt(x), 0n)
  const tot = { anggaran: 0n, rencanaPeriode: 0n, rencanaKumulatif: 0n, realisasiPeriode: 0n, realisasiKumulatif: 0n }
  let adaRpd = false
  const baris = pos.map((p) => {
    const r = real.get(p.id); const rp = rpd.get(p.id) ?? null
    const ag = BigInt(p.anggaran); const per = BigInt(r?.periode ?? '0'); const kum = BigInt(r?.kumulatif ?? '0')
    const rPer = rp ? sum(rp, m1, m2) : null; const rKum = rp ? sum(rp, 1, m2) : null
    tot.anggaran += ag; tot.realisasiPeriode += per; tot.realisasiKumulatif += kum
    if (rp) { adaRpd = true; tot.rencanaPeriode += rPer; tot.rencanaKumulatif += rKum }
    return {
      dokumenId: p.id, jenis: p.jenis, judul: p.judul, nomor: p.nomor, hibah: p.hibah, anggaran: ag.toString(),
      rencanaPeriode: rPer === null ? null : rPer.toString(), rencanaKumulatif: rKum === null ? null : rKum.toString(),
      realisasiPeriode: per.toString(), realisasiKumulatif: kum.toString(), sisa: (ag - kum).toString(),
    }
  })
  return {
    tahun, periode, bulanAwal: m1, bulanAkhir: m2, sampai: akhir, hibahSaja, menunggu, dibuat: new Date().toISOString(), baris,
    total: {
      anggaran: tot.anggaran.toString(), realisasiPeriode: tot.realisasiPeriode.toString(), realisasiKumulatif: tot.realisasiKumulatif.toString(),
      sisa: (tot.anggaran - tot.realisasiKumulatif).toString(),
      rencanaPeriode: adaRpd ? tot.rencanaPeriode.toString() : null, rencanaKumulatif: adaRpd ? tot.rencanaKumulatif.toString() : null,
    },
  }
}

/** Kunci satu pos aktif setahun dengan `tahun` (FOR UPDATE). */
export async function lockPosAktif(c, dokumenId, tahun) {
  const r = await c.query(
    `SELECT d.id::text,d.tahun,d.jenis,d.judul,d.anggaran::text AS anggaran,d.final_at,${DIGANTIKAN} AS digantikan
       FROM sdl_ren_dokumen d WHERE d.id=$1::uuid FOR UPDATE OF d`, [dokumenId])
  if (r.rowCount !== 1) throw new HttpError(404, 'not_found')
  const d = r.rows[0]
  if (BUKAN_POS.includes(d.jenis) || d.anggaran === null || d.final_at === null || d.digantikan) throw new HttpError(409, 'pos_tidak_aktif')
  if (tahun !== undefined && d.tahun !== tahun) throw new HttpError(400, 'tahun_tidak_cocok')
  return d
}

export async function verifiedSum(c, dokumenId) {
  const r = await c.query(`SELECT COALESCE(sum(jumlah),0)::text AS s FROM sdl_ren_realisasi_dok WHERE dokumen_id=$1::uuid AND status='terverifikasi'`, [dokumenId])
  return BigInt(r.rows[0].s)
}

/** 12 string digit -> array string; total harus sama dengan anggaran pos. */
export function cleanRpd(v) {
  if (!Array.isArray(v) || v.length !== 12) throw new HttpError(400, 'invalid_input')
  return v.map((x) => {
    if (typeof x !== 'string' || !/^(0|[1-9][0-9]{0,15})$/.test(x)) throw new HttpError(400, 'invalid_input')
    return x
  })
}
export function cekTotalRpd(rpd, anggaran) {
  if (rpd.reduce((n, x) => n + BigInt(x), 0n) !== BigInt(anggaran)) throw new HttpError(409, 'rpd_tidak_sama_anggaran')
}
export async function tulisRpd(c, dokumenId, rpd, actor) {
  for (let i = 0; i < 12; i++) {
    await c.query(
      `INSERT INTO sdl_ren_rpd(dokumen_id,bulan,jumlah,updated_by) VALUES($1::uuid,$2,$3::bigint,$4)
       ON CONFLICT (dokumen_id,bulan) DO UPDATE SET jumlah=EXCLUDED.jumlah,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [dokumenId, i + 1, rpd[i], actor])
  }
}

/**
 * Terapkan butir revisi saat revisi ditandai Selesai. Pos dikunci berurutan id
 * (cegah deadlock). POK: anggaran baru >= realisasi terverifikasi. RPD: total
 * 12 bulan = anggaran pos saat itu. Nilai lama disimpan di butir untuk riwayat.
 */
export async function terapkanRevisi(c, revisi, actor) {
  const mode = REVISI_JENIS[revisi.jenis]
  const items = (await c.query(
    `SELECT id::text,dokumen_id::text,anggaran_baru::text,rpd_baru::text[] AS rpd_baru FROM sdl_ren_revisi_item
      WHERE revisi_id=$1::uuid ORDER BY dokumen_id FOR UPDATE`, [revisi.id])).rows
  if (!items.length) throw new HttpError(409, 'revisi_kosong')
  for (const it of items) {
    const pos = await lockPosAktif(c, it.dokumen_id, revisi.tahun)
    if (mode === 'anggaran') {
      if (it.anggaran_baru === null) throw new HttpError(409, 'revisi_kosong')
      if (BigInt(it.anggaran_baru) < await verifiedSum(c, it.dokumen_id)) throw new HttpError(409, 'anggaran_di_bawah_realisasi')
      await c.query(
        `UPDATE sdl_ren_dokumen SET anggaran=$2::bigint,anggaran_note=$3,anggaran_by=$4,anggaran_at=now(),version=version+1,updated_at=now()
          WHERE id=$1::uuid`, [it.dokumen_id, it.anggaran_baru, `Revisi POK: ${revisi.judul}`.slice(0, 500), actor])
      await c.query('UPDATE sdl_ren_revisi_item SET anggaran_lama=$2::bigint,diterapkan_at=now() WHERE id=$1::uuid', [it.id, pos.anggaran])
      await audit(c, actor, 'dokumen.anggaran.revisi', 'dokumen', it.dokumen_id)
    } else {
      if (!it.rpd_baru) throw new HttpError(409, 'revisi_kosong')
      cekTotalRpd(it.rpd_baru, pos.anggaran)
      const lama = (await rpdMap(c, [it.dokumen_id])).get(it.dokumen_id) ?? null
      await tulisRpd(c, it.dokumen_id, it.rpd_baru, actor)
      await c.query('UPDATE sdl_ren_dokumen SET version=version+1,updated_at=now() WHERE id=$1::uuid', [it.dokumen_id])
      await c.query('UPDATE sdl_ren_revisi_item SET rpd_lama=$2::bigint[],diterapkan_at=now() WHERE id=$1::uuid', [it.id, lama])
      await audit(c, actor, 'dokumen.rpd.revisi', 'dokumen', it.dokumen_id)
    }
  }
}
