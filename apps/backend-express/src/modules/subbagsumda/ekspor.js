import { KONDISI, STATUS_ASET, tahapAsetSql } from './aset.js'
import { JENIS_ARSIP, STATUS_ARSIP, bolehArsip, tahapRetensiSql } from './arsip.js'
import { JENIS_CUTI, STATUS_CUTI } from './cuti.js'
import { STATUS_DIKLAT } from './diklat.js'
import { JENIS_LAYANAN, STATUS_LAYANAN } from './kesejahteraan.js'
import { STATUS_KINERJA, boleh as bolehKinerja } from './kinerja.js'
import { TAHAP_KOMPETENSI, tahapKompetensiSql } from './kompetensi.js'
import { JENIS_KARIER, STATUS_KARIER } from './karier.js'
import { STATUS, TAHAP, sisaSql, tahapSql } from './personel.js'

/**
 * R5H32 K18/K41/K42: peta modul ekspor CSV Subbagsumda. Satu entri per modul:
 *   hak    — permission baca modul (selain laporan.export), dicek di laporan.js
 *   filter — kunci query yang diterima dan nilai sahnya ('tahun' = bilangan 1950–2100); kunci lain → 400
 *   header — kolom CSV (sama dengan tabel daftar di layar); TANPA catatan/alasan/teks bebas selain nama/judul/perihal,
 *            tanpa nama petugas, id, hash, atau nama berkas (K41)
 *   sql(f, ctx) — {text, args}; selalu dengan LIMIT BATAS_EKSPOR+1 (K21/K43)
 *   baris(r) — urutan sel sesuai header
 * Penyaringan baris yang dibatasi (kinerja K1, arsip K29) memakai fragmen modul asal — tidak ada salinan predikat.
 */

export const BATAS_EKSPOR = 10000
const LIMIT = `LIMIT ${BATAS_EKSPOR + 1}`
const PANGKAT = `LEFT JOIN sdl_polri_rank_master rm ON p.jenis IS DISTINCT FROM 'PNS' AND rm.code=p.pangkat`
const PANGKAT_LABEL = 'coalesce(rm.short_name,p.pangkat) AS pangkat_label'
const WIB = (kol) => `(${kol} AT TIME ZONE 'Asia/Jakarta')::date`

/** Susun WHERE dari filter yang sudah divalidasi. `peta` = kunci filter → (nomorParam) => ekspresi SQL. */
function where(f, peta, args, dasar = []) {
  const w = [...dasar]
  for (const [k, expr] of Object.entries(peta)) {
    if (f[k] === undefined) continue
    args.push(f[k])
    w.push(expr(`$${args.length}`))
  }
  return w.length ? w.join(' AND ') : 'TRUE'
}

export const MODUL_EKSPOR = Object.freeze({
  personel: {
    hak: 'subbagsumda.personel.read',
    filter: { status: STATUS },
    header: ['NRP/NIP', 'Nama', 'Jenis', 'Pangkat/Golongan', 'Jabatan', 'Unit kerja', 'TMT dinas', 'Tanggal pensiun', 'Status'],
    sql: (f) => {
      const args = []
      const w = where(f, { status: (n) => `p.status=${n}` }, args, ['p.deleted_at IS NULL'])
      return { text: `SELECT p.nrp,p.nama,p.jenis,${PANGKAT_LABEL},p.jabatan,p.unit_kerja,p.tmt_dinas::text AS tmt,p.tanggal_pensiun::text AS tp,p.status
        FROM sdl_sumda_personel p ${PANGKAT} WHERE ${w} ORDER BY lower(p.nama), p.nrp, p.id ${LIMIT}`, args }
    },
    baris: (r) => [r.nrp, r.nama, r.jenis ?? '', r.pangkat_label ?? '', r.jabatan, r.unit_kerja, r.tmt ?? '', r.tp ?? '', r.status],
  },
  pensiun: {
    hak: 'subbagsumda.personel.read',
    filter: { tahap: TAHAP },
    header: ['NRP/NIP', 'Nama', 'Pangkat/Golongan', 'Unit kerja', 'Tanggal pensiun', 'Sisa hari', 'Tahap', 'Sudah ditinjau'],
    sql: (f) => {
      const args = []
      const w = where(f, { tahap: (n) => `${tahapSql()}=${n}` }, args, ['p.deleted_at IS NULL', `${tahapSql()} IS NOT NULL`])
      return { text: `SELECT p.nrp,p.nama,${PANGKAT_LABEL},p.unit_kerja,p.tanggal_pensiun::text AS tp,${sisaSql()} AS sisa,${tahapSql()} AS tahap,
          t.reviewed_at IS NOT NULL AS ditinjau
        FROM sdl_sumda_personel p ${PANGKAT}
        LEFT JOIN sdl_sumda_pensiun_tinjau t ON t.personel_id=p.id AND t.tahap=${tahapSql()} AND t.tanggal_pensiun=p.tanggal_pensiun
        WHERE ${w} ORDER BY ${sisaSql()}, lower(p.nama), p.id ${LIMIT}`, args }
    },
    baris: (r) => [r.nrp, r.nama, r.pangkat_label ?? '', r.unit_kerja, r.tp, r.sisa, r.tahap, r.ditinjau],
  },
  karier: {
    hak: 'subbagsumda.personel.read',
    filter: { tahun: 'tahun', status: STATUS_KARIER, jenis: JENIS_KARIER },
    header: ['NRP/NIP', 'Nama', 'Jenis', 'Nomor referensi', 'Tanggal usulan', 'Tanggal efektif', 'Usulan pangkat', 'Usulan jabatan', 'Usulan unit kerja', 'Status'],
    sql: (f) => {
      const args = []
      const w = where(f, { tahun: (n) => `extract(year FROM k.tanggal_usulan)=${n}`, status: (n) => `k.status=${n}`, jenis: (n) => `k.jenis=${n}` }, args)
      return { text: `SELECT p.nrp,p.nama,k.jenis,k.nomor_referensi,k.tanggal_usulan::text AS tu,k.tanggal_efektif::text AS te,
          coalesce(ur.short_name,k.usulan_pangkat) AS up,k.usulan_jabatan,k.usulan_unit_kerja,k.status
        FROM sdl_sumda_karier k JOIN sdl_sumda_personel p ON p.id=k.personel_id
        LEFT JOIN sdl_polri_rank_master ur ON p.jenis IS DISTINCT FROM 'PNS' AND ur.code=k.usulan_pangkat
        WHERE ${w} ORDER BY k.tanggal_usulan DESC, lower(p.nama), k.id ${LIMIT}`, args }
    },
    baris: (r) => [r.nrp, r.nama, r.jenis, r.nomor_referensi, r.tu, r.te ?? '', r.up ?? '', r.usulan_jabatan, r.usulan_unit_kerja, r.status],
  },
  diklat: {
    hak: 'subbagsumda.personel.read',
    filter: { tahun: 'tahun', status: STATUS_DIKLAT },
    header: ['Kegiatan', 'Jenis', 'Penyelenggara', 'Lokasi', 'Tanggal mulai', 'Tanggal selesai', 'Status', 'NRP/NIP peserta', 'Nama peserta', 'Hasil', 'Nomor sertifikat'],
    sql: (f) => {
      const args = []
      const w = where(f, { tahun: (n) => `extract(year FROM d.tanggal_mulai)=${n}`, status: (n) => `d.status=${n}` }, args, ['d.deleted_at IS NULL'])
      return { text: `SELECT d.nama,d.jenis,d.penyelenggara,d.lokasi,d.tanggal_mulai::text AS tm,d.tanggal_selesai::text AS ts,d.status,
          p.nrp,p.nama AS peserta,ps.hasil,ps.nomor_sertifikat
        FROM sdl_sumda_diklat d LEFT JOIN sdl_sumda_diklat_peserta ps ON ps.diklat_id=d.id LEFT JOIN sdl_sumda_personel p ON p.id=ps.personel_id
        WHERE ${w} ORDER BY d.tanggal_mulai DESC, lower(d.nama), d.id, lower(p.nama), ps.id ${LIMIT}`, args }
    },
    baris: (r) => [r.nama, r.jenis, r.penyelenggara, r.lokasi, r.tm ?? '', r.ts ?? '', r.status, r.nrp ?? '', r.peserta ?? '', r.hasil ?? '', r.nomor_sertifikat ?? ''],
  },
  kompetensi: {
    hak: 'subbagsumda.personel.read',
    filter: { tahap: TAHAP_KOMPETENSI },
    header: ['NRP/NIP', 'Nama', 'Kompetensi', 'Kategori', 'Nomor', 'Penerbit', 'Tanggal terbit', 'Berlaku sampai', 'Tahap'],
    sql: (f) => {
      const args = []
      const w = where(f, { tahap: (n) => `${tahapKompetensiSql()}=${n}` }, args, ['k.deleted_at IS NULL', 'p.deleted_at IS NULL'])
      return { text: `SELECT p.nrp,p.nama,k.nama AS kompetensi,k.kategori,k.nomor,k.penerbit,k.tanggal_terbit::text AS tt,k.berlaku_sampai::text AS bs,
          ${tahapKompetensiSql()} AS tahap
        FROM sdl_sumda_kompetensi k JOIN sdl_sumda_personel p ON p.id=k.personel_id
        WHERE ${w} ORDER BY lower(p.nama), lower(k.nama), k.id ${LIMIT}`, args }
    },
    baris: (r) => [r.nrp, r.nama, r.kompetensi, r.kategori, r.nomor, r.penerbit, r.tt ?? '', r.bs ?? '', r.tahap ?? ''],
  },
  cuti: {
    hak: 'subbagsumda.personel.read',
    filter: { tahun: 'tahun', status: STATUS_CUTI, jenis: JENIS_CUTI },
    // K41: tanpa catatan (catatan Sakit, R5H30 S3, tidak pernah diekspor).
    header: ['NRP/NIP', 'Nama', 'Jenis cuti', 'Tanggal mulai', 'Tanggal selesai', 'Tanggal kembali', 'Jumlah hari', 'Status'],
    sql: (f) => {
      const args = []
      const w = where(f, { tahun: (n) => `extract(year FROM c.tanggal_mulai)=${n}`, status: (n) => `c.status=${n}`, jenis: (n) => `c.jenis=${n}` }, args)
      return { text: `SELECT p.nrp,p.nama,c.jenis,c.tanggal_mulai::text AS tm,c.tanggal_selesai::text AS ts,c.tanggal_kembali::text AS tk,c.jumlah_hari,c.status
        FROM sdl_sumda_cuti c JOIN sdl_sumda_personel p ON p.id=c.personel_id
        WHERE ${w} ORDER BY c.tanggal_mulai DESC, lower(p.nama), c.id ${LIMIT}`, args }
    },
    baris: (r) => [r.nrp, r.nama, r.jenis, r.tm, r.ts, r.tk ?? '', r.jumlah_hari, r.status],
  },
  kesejahteraan: {
    hak: 'subbagsumda.personel.read',
    filter: { tahun: 'tahun', status: STATUS_LAYANAN, jenis: JENIS_LAYANAN },
    header: ['NRP/NIP', 'Nama', 'Jenis layanan', 'Nomor referensi', 'Tanggal diajukan', 'Target selesai', 'Status'],
    sql: (f) => {
      const args = []
      const w = where(f, { tahun: (n) => `extract(year FROM ${WIB('k.created_at')})=${n}`, status: (n) => `k.status=${n}`, jenis: (n) => `k.jenis=${n}` }, args)
      return { text: `SELECT p.nrp,p.nama,k.jenis,k.nomor_referensi,${WIB('k.created_at')}::text AS diajukan,k.target_selesai::text AS target,k.status
        FROM sdl_sumda_kesejahteraan k JOIN sdl_sumda_personel p ON p.id=k.personel_id
        WHERE ${w} ORDER BY k.created_at DESC, k.id ${LIMIT}`, args }
    },
    baris: (r) => [r.nrp, r.nama, r.jenis, r.nomor_referensi, r.diajukan, r.target ?? '', r.status],
  },
  kinerja: {
    hak: 'subbagsumda.personel.read',
    filter: { tahun: 'tahun', status: STATUS_KINERJA },
    header: ['NRP/NIP', 'Nama', 'Tahun', 'Periode', 'Kategori', 'Penilai', 'Tanggal penilaian', 'Status'],
    // K1/K42: hanya baris yang boleh dibaca isinya (pencatat atau kinerja.read) — fragmen `boleh` kinerja.js.
    sql: (f, { actor, rk }) => {
      const args = [actor, rk]
      const w = where(f, { tahun: (n) => `k.tahun=${n}`, status: (n) => `k.status=${n}` }, args, [bolehKinerja('$1', '$2')])
      return { text: `SELECT p.nrp,p.nama,k.tahun,k.periode,k.kategori,k.penilai,k.tanggal_penilaian::text AS tp,k.status
        FROM sdl_sumda_kinerja k JOIN sdl_sumda_personel p ON p.id=k.personel_id
        WHERE ${w} ORDER BY k.tahun DESC, k.periode DESC, lower(p.nama), k.id ${LIMIT}`, args }
    },
    baris: (r) => [r.nrp, r.nama, r.tahun, r.periode, r.kategori, r.penilai, r.tp ?? '', r.status],
  },
  aset: {
    hak: 'subbagsumda.inventaris.read',
    filter: { status: STATUS_ASET, kondisi: KONDISI },
    header: ['Kode BMN', 'Nama', 'Kategori', 'Merek/tipe', 'Tahun perolehan', 'Jumlah', 'Satuan', 'Lokasi', 'Kondisi', 'Penanggung jawab', 'Jadwal pemeliharaan', 'Tahap pemeliharaan', 'Status'],
    sql: (f) => {
      const args = []
      // Sama dengan layar (K41 R5H31): tanpa filter status, aset Dihapus tidak ikut.
      const w = where(f, { status: (n) => `a.status=${n}`, kondisi: (n) => `a.kondisi=${n}` }, args, f.status === undefined ? ["a.status<>'Dihapus'"] : [])
      return { text: `SELECT a.kode_bmn,a.nama,a.kategori,a.merek_tipe,a.tahun_perolehan,a.jumlah,a.satuan,a.lokasi,a.kondisi,
          coalesce(pj.nama,a.penanggung_jawab_teks) AS pj,a.jadwal_pemeliharaan::text AS jadwal,${tahapAsetSql()} AS tahap,a.status
        FROM sdl_sumda_aset a LEFT JOIN sdl_sumda_personel pj ON pj.id=a.penanggung_jawab_id
        WHERE ${w} ORDER BY lower(a.nama), a.kode_bmn, a.id ${LIMIT}`, args }
    },
    baris: (r) => [r.kode_bmn, r.nama, r.kategori, r.merek_tipe, r.tahun_perolehan ?? '', r.jumlah, r.satuan, r.lokasi, r.kondisi, r.pj ?? '', r.jadwal ?? '', r.tahap ?? '', r.status],
  },
  arsip: {
    hak: 'subbagsumda.arsip.read',
    filter: { tahun: 'tahun', status: STATUS_ARSIP, jenis: JENIS_ARSIP },
    header: ['Nomor', 'Jenis', 'Perihal', 'Tanggal', 'Asal/tujuan', 'Kode klasifikasi', 'Lokasi simpan', 'Retensi sampai', 'Tahap retensi', 'Kerahasiaan', 'Status', 'NRP/NIP personel', 'Nama personel'],
    // K29: hanya arsip TERLIHAT (TERBATAS ikut bila pengekspor pencatat atau pemegang arsip.restricted).
    sql: (f, { actor, xa }) => {
      const args = [actor, xa]
      const w = where(f, { tahun: (n) => `extract(year FROM a.tanggal)=${n}`, status: (n) => `a.status=${n}`, jenis: (n) => `a.jenis=${n}` }, args, [bolehArsip('$1', '$2')])
      return { text: `SELECT a.nomor,a.jenis,a.perihal,a.tanggal::text AS tgl,a.asal_tujuan,a.kode_klasifikasi,a.lokasi_simpan,a.retensi_sampai::text AS retensi,
          ${tahapRetensiSql()} AS tahap,a.kerahasiaan,a.status,p.nrp,p.nama
        FROM sdl_sumda_arsip a LEFT JOIN sdl_sumda_personel p ON p.id=a.personel_id
        WHERE ${w} ORDER BY a.tanggal DESC, a.created_at DESC, a.id ${LIMIT}`, args }
    },
    baris: (r) => [r.nomor, r.jenis, r.perihal, r.tgl, r.asal_tujuan, r.kode_klasifikasi, r.lokasi_simpan, r.retensi ?? '', r.tahap ?? '', r.kerahasiaan, r.status, r.nrp ?? '', r.nama ?? ''],
  },
})
