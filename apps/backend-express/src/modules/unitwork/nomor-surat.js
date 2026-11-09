/**
 * Perakitan nomor surat keluar, port dari
 * apps/backend/internal/unitwork/nomor_surat.go.
 *
 *   B/ND-157/X/HUM.1.2./2026/Bagrenmin
 *   │ │   │   │     │     │      │
 *   │ │   │   │     │     │      └─ akhiran unit, dipilih petugas
 *   │ │   │   │     │     └──────── tahun, jam sistem
 *   │ │   │   │     └────────────── kode arsip, dari master
 *   │ │   │   └──────────────────── bulan Romawi, jam sistem
 *   │ │   └──────────────────────── urut, satu deret per tahun
 *   │ └──────────────────────────── jenis surat, kodenya dari master
 *   └────────────────────────────── derajat: Biasa=B, Kilat=K
 *
 * Enam keputusan pemilik sistem yang tertanam di sini, semuanya tercatat di
 * docs/PENOMORAN-SURAT-KELUAR.md:
 *
 *   1. Deretnya SATU untuk seluruh Bagrenmin, bukan per subbag atau per jenis.
 *   2. Direset tiap 1 Januari.
 *   3. Nomor diberikan saat DRAF DIBUAT, bukan saat disetujui — konsekuensinya
 *      draf yang batal meninggalkan lubang, dan itu diterima.
 *   4. Bulan dan tahun dari JAM SISTEM saat nomor dibuat, bukan dari Tanggal
 *      Surat. Surat mundur tanggal karena itu bisa bernomor bulan yang berbeda
 *      dari tanggal di kop suratnya.
 *   5. Derajat hanya Biasa dan Kilat, sama dengan derajat surat masuk.
 *   6. Akhiran unit dipilih petugas, tidak ditebak dari isian "Kepada" yang
 *      berupa teks bebas.
 */

const DERAJAT_KODE = { Biasa: 'B', Kilat: 'K' }

// Angka Romawi 1..12. Tabel, bukan algoritma: rentangnya tetap dua belas dan
// algoritma umum hanya menambah hal yang bisa salah tanpa menambah kemampuan.
const BULAN_ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']

// Akhiran unit yang sah. 'Bagrenmin' untuk surat keluar subdit; selebihnya nama
// unit yang memang terdaftar di sdl_org_units, dengan ejaan yang dipakai di
// seluruh aplikasi.
const AKHIRAN_UNIT = new Set(['Bagrenmin', 'Urmin', 'Subbagren', 'Subbagsumda', 'Subbagbinfung'])

/**
 * Padanan nomorSuratKurang (nomor_surat.go). Alasan sebuah nomor tidak dapat
 * dirakit, dalam bentuk kode error yang siap dikirim. String kosong = lengkap.
 */
export function nomorSuratKurang(fields) {
  if (!DERAJAT_KODE[String(fields.sifatSurat ?? '').trim()]) return 'derajat_required'
  if (String(fields.jenisSurat ?? '').trim() === '') return 'jenis_surat_required'
  if (String(fields.kodeArsip ?? '').trim() === '') return 'kode_arsip_required'
  if (!AKHIRAN_UNIT.has(String(fields.unitNomor ?? '').trim())) return 'unit_nomor_required'
  return ''
}

/**
 * Padanan ambilNomorUrut (nomor_surat.go). Atomik: ON CONFLICT DO UPDATE
 * mengambil row lock, jadi dua permintaan bersamaan tidak pernah memperoleh
 * angka yang sama tanpa perlu SELECT ... FOR UPDATE terpisah.
 */
async function ambilNomorUrut(client, tahun) {
  const { rows } = await client.query(
    `INSERT INTO sdl_surat_nomor_urut(tahun) VALUES($1)
       ON CONFLICT(tahun) DO UPDATE SET nomor_terakhir=sdl_surat_nomor_urut.nomor_terakhir+1,updated_at=now()
       RETURNING nomor_terakhir`,
    [tahun],
  )
  return Number(rows[0].nomor_terakhir)
}

/**
 * Padanan rakitNomorSurat (nomor_surat.go). Dipanggil DI DALAM transaksi
 * pembuatan surat, sehingga nomor yang terlanjur diambil ikut dibatalkan kalau
 * penyimpanan suratnya gagal — tanpa itu, setiap kegagalan penyimpanan akan
 * membakar satu nomor.
 */
export async function rakitNomorSurat(client, fields, now) {
  const derajat = DERAJAT_KODE[String(fields.sifatSurat ?? '').trim()]
  const jenis = String(fields.jenisSurat ?? '').trim()
  const arsip = String(fields.kodeArsip ?? '').trim()
  const unit = String(fields.unitNomor ?? '').trim()

  const nomor = await ambilNomorUrut(client, now.getFullYear())
  return `${derajat}/${jenis}-${nomor}/${BULAN_ROMAWI[now.getMonth()]}/${arsip}/${now.getFullYear()}/${unit}`
}
