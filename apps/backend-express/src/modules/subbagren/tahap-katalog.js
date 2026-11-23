import { parseDateOnly } from './shared.js'

/**
 * R5H16: katalog Tahap Pekerjaan dokumen Subbagren.
 *
 * Sumber: "Alur Pekerjaan Perencanaan dan Pelaporan Densus 88 AT Polri"
 * (docs/Alur_Pekerjaan_Densus88_Format_Kolom.docx, 2026-11-16). Setiap baris
 * "Tahapan pekerjaan" di dokumen itu dipetakan ke satu PEKERJAAN; pekerjaan
 * yang bentuk isiannya sama memakai satu FORM. Katalog ini satu-satunya
 * sumber: frontend memintanya lewat GET /tahap-katalog dan menggambar
 * formulir dari situ, backend memvalidasi isian dengan daftar yang sama.
 *
 * Isian disimpan sebagai objek JSON berisi string saja (sdl_ren_dokumen_tahap.isian).
 */

/** Label jenis dokumen Subbagren (dipindah dari perencanaan.js untuk Master Data R5H25). */
export const JENIS_LABEL = {
  rancangan_renstra: 'Rancangan Renstra', renstra: 'Renstra', rancangan_renja: 'Rancangan Renja', renja: 'Renja', iku: 'IKU',
  rkks_renbut: 'RKKS Renbut', rkks_pagu_indikatif: 'RKKS Pagu Indikatif', rkks_pagu_anggaran: 'RKKS Pagu Anggaran', rkks_pagu_alokasi: 'RKKS Pagu Alokasi',
  rka_kl: 'RKA-K/L', dipa: 'DIPA', revisi_dipa: 'Revisi DIPA', pok: 'POK',
  rendisgar: 'Rendisgar', rengiat: 'Rengiat', renaksi: 'Renaksi', perjanjian_kinerja: 'Perjanjian Kinerja',
  lap_lra: 'LRA', lap_penggunaan_anggaran: 'Laporan Penggunaan Anggaran', lap_eka_pn: 'Laporan EKA PN',
  lap_capaian_kinerja: 'Laporan Capaian Kinerja', lap_lkip: 'LKIP', lap_hibah: 'Laporan Hibah',
  revisi_pok: 'Revisi POK', revisi_rpd: 'Revisi RPD',
  tor_kak: 'TOR/KAK', rab: 'RAB', lainnya: 'Lainnya',
}

const f = (key, label, type, max, extra = {}) => ({ key, label, type, max, ...extra })
const CARA = ['Fisik (dijilid)', 'Surat dinas', 'Elektronik']
const APLIKASI = ['SAKTI', 'e-jakstra', 'SAKTI dan e-jakstra', 'Lainnya']

const pemeriksaanFields = [
  f('tanggal', 'Tanggal', 'date', 10, { required: true, half: true }),
  f('pihak', 'Bersama', 'text', 160, { half: true }),
]
const catatanPemeriksaan = f('catatan', 'Catatan hasil', 'textarea', 2000)
const berkasPemeriksaan = [{ slot: 'ba', label: 'Berita Acara / Catatan Hasil Reviu', utama: true }]

export const FORMS = {
  undangan: {
    fields: [
      f('undanganNomor', 'Nomor surat undangan', 'text', 120, { half: true }),
      f('undanganTanggal', 'Tanggal surat undangan', 'date', 10, { half: true }),
      f('penyelenggara', 'Penyelenggara', 'text', 120, { default: 'Stamarena Polri' }),
      f('rapatTanggal', 'Tanggal rapat', 'date', 10, { required: true, half: true }),
      f('tempat', 'Tempat rapat', 'text', 160, { half: true }),
      f('perwakilan', 'Perwakilan yang hadir', 'textarea', 1000, { hint: 'Satu nama/jabatan per baris.' }),
    ],
    berkas: [{ slot: 'undangan', label: 'Surat undangan', utama: true }],
  },
  pokja: {
    fields: [
      f('sprinNomor', 'Nomor Sprin', 'text', 120, { required: true, half: true }),
      f('sprinTanggal', 'Tanggal Sprin', 'date', 10, { required: true, half: true }),
      f('penandatangan', 'Penandatangan', 'text', 120, { default: 'Kadensus' }),
      f('ketua', 'Ketua Tim Pokja', 'text', 160),
      f('anggota', 'Anggota Tim Pokja', 'textarea', 2000, { hint: 'Satu nama/jabatan per baris.' }),
    ],
    berkas: [{ slot: 'sprin', label: 'Sprin Kadensus', utama: true }],
  },
  rapat: {
    fields: [
      f('tanggal', 'Tanggal rapat', 'date', 10, { required: true, half: true }),
      f('tempat', 'Tempat rapat', 'text', 160, { half: true }),
      f('pimpinan', 'Pimpinan rapat', 'text', 160, { half: true }),
      f('peserta', 'Jumlah peserta', 'number', 5, { half: true }),
      f('kesimpulan', 'Pokok bahasan / kesimpulan', 'textarea', 2000),
      f('tindakLanjut', 'Tindak lanjut', 'textarea', 1000),
    ],
    berkas: [
      { slot: 'notulen', label: 'Notulen rapat', utama: true },
      { slot: 'draf', label: 'Draf dokumen', utama: true },
      { slot: 'daftar_hadir', label: 'Daftar hadir' },
    ],
  },
  pengesahan: {
    fields: [
      f('suratNomor', 'Nomor surat pengajuan', 'text', 120, { half: true }),
      f('suratTanggal', 'Tanggal pengajuan', 'date', 10, { half: true }),
      f('diajukanKepada', 'Diajukan kepada', 'text', 120, { default: 'Kadensus' }),
      f('ttdTanggal', 'Tanggal ditandatangani', 'date', 10, { half: true }),
      f('keputusanNomor', 'Nomor keputusan / pengesahan', 'text', 120, { half: true }),
    ],
    berkas: [
      { slot: 'surat_pengajuan', label: 'Surat pengajuan pengesahan' },
      { slot: 'dokumen_sah', label: 'Dokumen yang sudah ditandatangani', utama: true },
    ],
  },
  distribusi: {
    fields: [
      f('tanggal', 'Tanggal distribusi', 'date', 10, { required: true, half: true }),
      f('cara', 'Cara distribusi', 'select', 40, { options: CARA, half: true }),
      f('tujuan', 'Tujuan distribusi', 'textarea', 1000, { hint: 'Subsatker/jajaran penerima, satu per baris.' }),
      f('pengantarNomor', 'Nomor surat pengantar', 'text', 120),
    ],
    berkas: [{ slot: 'bukti', label: 'Bukti distribusi / tanda terima', utama: true }],
  },
  surat_masuk: {
    fields: [
      f('nomor', 'Nomor surat', 'text', 120, { half: true }),
      f('tanggal', 'Tanggal surat', 'date', 10, { half: true }),
      f('dari', 'Dari', 'text', 120, { default: 'Stamarena Polri' }),
      f('perihal', 'Perihal', 'text', 240),
      f('tenggat', 'Batas waktu', 'date', 10, { half: true }),
    ],
    berkas: [{ slot: 'surat', label: 'Surat yang diterima', utama: true }],
  },
  surat_keluar: {
    fields: [
      f('nomor', 'Nomor surat', 'text', 120, { half: true }),
      f('tanggal', 'Tanggal surat', 'date', 10, { half: true }),
      f('tujuan', 'Tujuan', 'textarea', 1000),
      f('tenggat', 'Batas waktu jawaban', 'date', 10, { half: true }),
    ],
    berkas: [
      { slot: 'surat', label: 'Surat yang dikirim', utama: true },
      { slot: 'bukti_kirim', label: 'Bukti pengiriman' },
    ],
  },
  kompilasi: {
    fields: [
      f('tanggal', 'Tanggal kompilasi', 'date', 10, { half: true }),
      f('subsatker', 'Usulan yang sudah masuk', 'textarea', 2000, { hint: 'Subsatker yang usulannya sudah diterima, satu per baris.' }),
      f('catatan', 'Catatan', 'textarea', 1000),
    ],
    berkas: [
      { slot: 'rekap', label: 'Rekap / dokumen gabungan', utama: true },
      { slot: 'rab', label: 'RAB' },
      { slot: 'kak', label: 'KAK' },
      { slot: 'rpd', label: 'RPD' },
      { slot: 'kajian_teknis', label: 'Kajian Teknis (belanja modal)' },
    ],
  },
  input_aplikasi: {
    fields: [
      f('aplikasi', 'Aplikasi', 'select', 40, { options: APLIKASI, required: true, half: true }),
      f('tanggal', 'Tanggal input', 'date', 10, { half: true }),
      f('operator', 'Operator', 'text', 160),
    ],
    berkas: [{ slot: 'hasil', label: 'Hasil unduhan (mis. RKKS dari SAKTI)', utama: true }],
  },
  pemeriksaan: {
    fields: [
      ...pemeriksaanFields,
      f('baNomor', 'Nomor Berita Acara / CHR', 'text', 120),
      catatanPemeriksaan,
    ],
    berkas: berkasPemeriksaan,
  },
  pemeriksaan_progar: {
    fields: [...pemeriksaanFields, catatanPemeriksaan],
    berkas: berkasPemeriksaan,
  },
  rapat_pemeriksaan: {
    fields: [...pemeriksaanFields, catatanPemeriksaan],
    berkas: [{ slot: 'ba', label: 'Berita Acara Penelitian', utama: true }],
  },
  draf: {
    fields: [
      f('tanggal', 'Tanggal', 'date', 10, { half: true }),
      f('catatan', 'Catatan', 'textarea', 1000),
    ],
    berkas: [{ slot: 'draf', label: 'Draf dokumen', utama: true }],
  },
  // ---- R5H17: laporan DALGAR (alur no. 14-19) dan revisi anggaran (no. 20) ----
  laporan: {
    fields: [
      f('tanggal', 'Tanggal selesai disusun', 'date', 10, { required: true, half: true }),
      f('pengantarNomor', 'Nomor surat pengantar', 'text', 120, { half: true }),
      f('koordinasi', 'Berkoordinasi dengan', 'text', 240, { hint: 'mis. Subsatker pelaksana PN, Paur Log, Direktorat.' }),
      f('sumberData', 'Sumber data', 'text', 240, { hint: 'mis. myinterest, SAKTI, laporan Direktorat.' }),
      f('catatan', 'Catatan', 'textarea', 1000),
    ],
    berkas: [
      { slot: 'laporan', label: 'Draf laporan', utama: true },
      { slot: 'pengantar', label: 'Draf surat pengantar', utama: true },
      { slot: 'data_dukung', label: 'Data dukung' },
    ],
  },
  // LRA (2026-11-18, terakhir): mengunduh realisasi dari myinterest dicatat sebagai tahap
  // biasa; hasil unduhannya hanya LAMPIRAN (tidak diimpor). Angka LRA/dashboard tetap dari
  // menu Data myinterest. Slot berjenis 'office' menerima PDF, Excel (.xlsx), atau Word (.docx).
  unduh_myinterest: {
    fields: [
      f('tanggal', 'Tanggal unduh', 'date', 10, { half: true }),
      f('dasar', 'Dasar penyusunan', 'text', 240, { default: 'Surat arahan penyusunan LRA pengganti aplikasi SMAP', hint: 'Surat arahan yang menjadi dasar LRA bulanan.' }),
      f('catatan', 'Catatan', 'textarea', 1000),
    ],
    berkas: [
      { slot: 'unduhan', label: 'Hasil unduhan myinterest (Excel atau PDF)', utama: true, jenis: 'office' },
    ],
  },
  ttd: {
    fields: [
      f('ajuTanggal', 'Tanggal diajukan', 'date', 10, { half: true }),
      f('ttdTanggal', 'Tanggal ditandatangani', 'date', 10, { required: true, half: true }),
      f('penandatangan', 'Penandatangan', 'text', 120, { default: 'Kadensus' }),
      f('pengantarNomor', 'Nomor surat pengantar', 'text', 120),
      f('catatan', 'Catatan / koreksi pimpinan', 'textarea', 1000),
    ],
    berkas: [{ slot: 'ditandatangani', label: 'Surat pengantar dan laporan yang ditandatangani', utama: true }],
  },
  kirim: {
    fields: [
      f('tanggal', 'Tanggal kirim', 'date', 10, { required: true, half: true }),
      f('cara', 'Cara kirim', 'select', 40, { options: ['Surat dinas (fisik)', 'Elektronik / e-mail', 'Aplikasi', 'Diantar langsung'], half: true }),
      f('tujuan', 'Tujuan', 'text', 240, { default: 'Astamarena Kapolri' }),
      f('nomor', 'Nomor surat', 'text', 120),
    ],
    berkas: [
      { slot: 'surat', label: 'Surat dan laporan yang dikirim', utama: true },
      { slot: 'bukti_kirim', label: 'Bukti pengiriman / tanda terima', utama: true },
    ],
  },
  data_dukung: {
    fields: [
      f('tanggal', 'Tanggal', 'date', 10, { required: true, half: true }),
      f('pengantarNomor', 'Nomor surat pengantar', 'text', 120, { half: true }),
      f('uraian', 'Uraian revisi', 'textarea', 2000, { required: true, hint: 'Pos yang direvisi, nilai semula dan menjadi.' }),
      f('sakti', 'Sudah disesuaikan di SAKTI', 'select', 10, { options: ['Sudah', 'Belum'], half: true }),
    ],
    berkas: [
      { slot: 'data_dukung', label: 'Data dukung revisi', utama: true },
      { slot: 'pengantar', label: 'Draf surat pengantar', utama: true },
      { slot: 'sakti', label: 'Tangkapan layar / cetakan SAKTI' },
    ],
  },
  unggah_aplikasi: {
    fields: [
      f('tanggal', 'Tanggal unggah', 'date', 10, { required: true, half: true }),
      f('aplikasi', 'Aplikasi', 'select', 40, { options: ['SAKTI', 'SatuDJA', 'Lainnya'], half: true, default: 'SAKTI' }),
      f('pihak', 'Diajukan kepada', 'text', 160),
      f('status', 'Status / nomor tiket', 'text', 160),
      f('catatan', 'Catatan koordinasi', 'textarea', 1000),
    ],
    berkas: [{ slot: 'bukti', label: 'Bukti unggah / approval', utama: true }],
  },
  dipa_baru: {
    fields: [
      f('nomor', 'Nomor DIPA', 'text', 120, { required: true, half: true }),
      f('tanggal', 'Tanggal DIPA', 'date', 10, { required: true, half: true }),
      f('revisiKe', 'Revisi ke-', 'number', 3, { half: true }),
      f('catatan', 'Catatan', 'textarea', 1000),
    ],
    berkas: [
      { slot: 'dipa', label: 'DIPA baru (unduhan SatuDJA)', utama: true },
      { slot: 'rka', label: 'RKA baru' },
    ],
  },
}

/** label: teks di dropdown; form: kunci FORMS; defaults: menimpa default isian. */
export const PEKERJAAN = {
  rakor: { label: 'Rapat koordinasi bersama Stamarena Polri', form: 'undangan' },
  pokja: { label: 'Menyusun Tim Pokja', form: 'pokja' },
  rapat: { label: 'Rapat penyusunan', form: 'rapat' },
  pengesahan: { label: 'Mengajukan pengesahan', form: 'pengesahan' },
  pengesahan_kapolri: { label: 'Pengesahan dan tanda tangan Kapolri', form: 'pengesahan', defaults: { diajukanKepada: 'Kapolri' } },
  distribusi: { label: 'Mendistribusikan kepada jajaran', form: 'distribusi' },
  terima_permintaan: { label: 'Menerima surat permintaan dari Stamarena', form: 'surat_masuk' },
  terima_undangan: { label: 'Menerima undangan dan pagu dari Stamarena', form: 'surat_masuk' },
  terima_dipa: { label: 'Menerima DIPA dari Kemenkeu/Stamarena', form: 'surat_masuk', defaults: { dari: 'Kemenkeu / Stamarena Polri' } },
  permintaan_subsatker: { label: 'Surat permintaan kepada subsatker', form: 'surat_keluar' },
  kompilasi: { label: 'Mengompilasi usulan subsatker', form: 'kompilasi' },
  penggabungan: { label: 'Menggabungkan usulan menjadi dokumen satker', form: 'draf' },
  penyusunan_draf: { label: 'Menyusun draf dokumen', form: 'draf' },
  surat_usulan: { label: 'Surat usulan kepada Astamarena Kapolri', form: 'surat_keluar' },
  pengiriman: { label: 'Mengirim dokumen kepada Stamarena', form: 'surat_keluar' },
  input_aplikasi: { label: 'Input ke aplikasi SAKTI / e-jakstra', form: 'input_aplikasi' },
  penelitian: { label: 'Penelitian dokumen bersama Stamarena', form: 'pemeriksaan_progar', defaults: { pihak: 'Stamarena Polri' } },
  reviu_apip: { label: 'Reviu bersama Tim APIP Itwasum', form: 'pemeriksaan_progar', defaults: { pihak: 'APIP Itwasum Polri' } },
  penjabaran: { label: 'Surat penjabaran kepada Astamarena Kapolri', form: 'surat_keluar' },
  terima_dipa_petikan: { label: 'Menerima DIPA Petikan dari Kemenkeu', form: 'surat_masuk', defaults: { dari: 'Kementerian Keuangan' } },
  // R5H17: laporan DALGAR dan revisi anggaran.
  terima_undangan_rapat: { label: 'Menerima undangan rapat penyusunan', form: 'surat_masuk' },
  terima_permintaan_laporan: { label: 'Menerima surat permintaan / undangan penyusunan laporan', form: 'surat_masuk' },
  permintaan_direktorat: { label: 'Surat permintaan laporan kepada subsatker / Direktorat', form: 'surat_keluar' },
  kompilasi_laporan: { label: 'Mengompilasi laporan subsatker / Direktorat', form: 'kompilasi' },
  susun_laporan: { label: 'Menyusun laporan dan surat pengantar', form: 'laporan' },
  unduh_myinterest: { label: 'Mengunduh realisasi dari myinterest', form: 'unduh_myinterest' },
  ttd_kadensus: { label: 'Mengajukan persetujuan dan tanda tangan Kadensus', form: 'ttd' },
  rapat_pemeriksaan: { label: 'Rapat dan pemeriksaan bersama Stamarena Polri', form: 'rapat_pemeriksaan', defaults: { pihak: 'Stamarena Polri' } },
  kirim_laporan: { label: 'Mengirim surat dan laporan kepada Astamarena Kapolri', form: 'kirim' },
  rapat_bahan: { label: 'Menghadiri rapat penyusunan tingkat Polri (membawa laporan satker)', form: 'rapat' },
  terima_permintaan_revisi: { label: 'Menerima disposisi Kadensus atas permintaan revisi dari subsatker', form: 'surat_masuk', defaults: { dari: 'Sub Satker' } },
  data_dukung_revisi: { label: 'Menyusun data dukung revisi dan menyesuaikan di SAKTI', form: 'data_dukung' },
  approval_eselon1: { label: 'Unggah ke SAKTI dan approval Eselon 1 Stamarena (kode satker 654691)', form: 'unggah_aplikasi', defaults: { pihak: 'Eselon 1 Stamarena Polri' } },
  unggah_kanwil: { label: 'Unggah surat dan data dukung ke Kanwil DJPB', form: 'unggah_aplikasi', defaults: { pihak: 'Kanwil DJPB' } },
  penelaahan_djpb: { label: 'Penelitian, penelaahan dan penetapan Kanwil DJPB', form: 'pemeriksaan', defaults: { pihak: 'Kanwil DJPB' } },
  dipa_baru: { label: 'DIPA baru terbit (unduh DIPA dan RKA dari SatuDJA)', form: 'dipa_baru' },
}

/** Urutan tahap per jenis dokumen, mengikuti dokumen alur. Jenis lain: tanpa tahap. */
export const JENIS_TAHAP = {
  rancangan_renstra: ['pokja', 'rapat', 'pengesahan', 'distribusi'],
  renstra: ['rakor', 'pokja', 'rapat', 'pengesahan', 'distribusi'],
  rancangan_renja: ['pokja', 'rapat', 'pengesahan', 'distribusi'],
  renja: ['rakor', 'pokja', 'rapat', 'pengesahan', 'distribusi'],
  iku: ['rakor', 'pokja', 'rapat', 'pengesahan', 'distribusi'],
  rkks_renbut: ['terima_permintaan', 'permintaan_subsatker', 'kompilasi', 'surat_usulan', 'input_aplikasi', 'distribusi'],
  rkks_pagu_indikatif: ['terima_undangan', 'permintaan_subsatker', 'kompilasi', 'penggabungan', 'input_aplikasi', 'penelitian', 'penjabaran'],
  rkks_pagu_anggaran: ['terima_undangan', 'permintaan_subsatker', 'kompilasi', 'penggabungan', 'input_aplikasi', 'penelitian', 'reviu_apip', 'penjabaran'],
  rkks_pagu_alokasi: ['terima_undangan', 'permintaan_subsatker', 'kompilasi', 'penggabungan', 'input_aplikasi', 'penelitian', 'reviu_apip', 'penjabaran', 'terima_dipa_petikan'],
  rendisgar: ['terima_dipa', 'penyusunan_draf', 'pengesahan', 'distribusi'],
  rengiat: ['terima_dipa', 'penyusunan_draf', 'pengesahan', 'distribusi'],
  renaksi: ['terima_dipa', 'permintaan_subsatker', 'kompilasi', 'pengesahan', 'distribusi'],
  perjanjian_kinerja: ['terima_permintaan', 'penyusunan_draf', 'pengiriman', 'pengesahan_kapolri', 'distribusi'],
  // R5H17 -- DALGAR: Laporan (no. 14-19) dan Revisi Anggaran (no. 20).
  lap_lra: ['terima_permintaan_laporan', 'unduh_myinterest', 'susun_laporan', 'ttd_kadensus', 'kirim_laporan'],
  lap_penggunaan_anggaran: ['terima_undangan_rapat', 'susun_laporan', 'ttd_kadensus', 'rapat_pemeriksaan', 'kirim_laporan'],
  lap_eka_pn: ['terima_undangan_rapat', 'susun_laporan', 'rapat_pemeriksaan'],
  lap_capaian_kinerja: ['terima_permintaan_laporan', 'permintaan_direktorat', 'kompilasi_laporan', 'susun_laporan', 'ttd_kadensus', 'kirim_laporan', 'rapat_bahan'],
  lap_lkip: ['terima_permintaan_laporan', 'susun_laporan', 'ttd_kadensus', 'kirim_laporan', 'rapat_bahan'],
  lap_hibah: ['terima_undangan_rapat', 'susun_laporan', 'ttd_kadensus', 'rapat_pemeriksaan', 'kirim_laporan'],
  // Revisi POK selesai setelah TTD Kadensus; revisi RPD berlanjut sampai DIPA baru.
  revisi_pok: ['terima_permintaan_revisi', 'data_dukung_revisi', 'ttd_kadensus'],
  revisi_rpd: ['terima_permintaan_revisi', 'data_dukung_revisi', 'ttd_kadensus', 'approval_eselon1', 'unggah_kanwil', 'penelaahan_djpb', 'dipa_baru'],
}

/** Jenis berperiode di bawah tahun anggaran (R5H17): LRA bulanan, Capaian Kinerja triwulanan. */
export const PERIODE = { lap_lra: 'bulan', lap_capaian_kinerja: 'triwulan' }
const PERIODE_RE = { bulan: /^B(0[1-9]|1[0-2])$/, triwulan: /^TW[1-4]$/ }
/** periode sah untuk jenis ini: wajib sesuai pola bila jenisnya berperiode, selain itu kosong. */
export function cleanPeriode(jenis, v) {
  const kind = PERIODE[jenis]
  const s = v === undefined || v === null ? '' : v
  if (typeof s !== 'string') return null
  if (!kind) return s === '' ? '' : null
  return PERIODE_RE[kind].test(s) ? s : null
}

/** Katalog siap kirim ke frontend: field sudah digabung dengan default per pekerjaan. */
/**
 * Jenis yang TIDAK disahkan (keputusan pemilik 2026-11-17): siklus RKKS dan pagu
 * (no. 5-8 alur pekerjaan Densus 88) adalah proses usulan ke Stamarena/SAKTI tanpa
 * pengesahan internal. Dokumen ini langsung ditandai SELESAI setelah semua tahap
 * diterima Kasubbagren.
 */
export const TANPA_SAH = new Set(['rkks_renbut', 'rkks_pagu_indikatif', 'rkks_pagu_anggaran', 'rkks_pagu_alokasi',
  // R5H17: laporan dan revisi anggaran DALGAR juga berakhir "Selesai".
  'lap_lra', 'lap_penggunaan_anggaran', 'lap_eka_pn', 'lap_capaian_kinerja', 'lap_lkip', 'lap_hibah', 'revisi_pok', 'revisi_rpd'])

/**
 * R5H25: tahap yang menjadi syarat aturan lain sehingga tidak boleh dinonaktifkan di
 * Master Data. Nilai = alasan yang ditampilkan ke Superadmin.
 */
export const TAHAP_WAJIB = {
  revisi_rpd: { dipa_baru: 'Revisi RPD baru bisa ditandai Selesai setelah tahap ini diterima dengan PDF DIPA.' },
}
export const tahapTerkunci = (jenis, pekerjaan) => Boolean(TAHAP_WAJIB[jenis]?.[pekerjaan])

/**
 * Katalog untuk frontend. `nonaktif` (R5H25) = { jenis: [tahap…] } dari Master Data; `jenis`
 * tetap daftar lengkap supaya tahap lama yang sudah dinonaktifkan tetap terbaca label/urutannya.
 */
export function katalog(nonaktif = {}) {
  const pekerjaan = {}
  for (const [key, p] of Object.entries(PEKERJAAN)) {
    const form = FORMS[p.form]
    pekerjaan[key] = {
      label: p.label, form: p.form,
      fields: form.fields.map((x) => (p.defaults?.[x.key] !== undefined ? { ...x, default: p.defaults[x.key] } : x)),
      berkas: form.berkas,
    }
  }
  return { jenis: JENIS_TAHAP, pekerjaan, tanpaSah: [...TANPA_SAH], periode: PERIODE, sumber: SUMBER_FORM, nonaktif }
}

/**
 * R5H22 (migrasi 065): form tahap yang bisa menautkan sumber surat (disposisi Kabagrenmin
 * atau Surat Masuk antar-unit). Nilai = kunci isian yang diisi dari sumbernya.
 */
export const SUMBER_FORM = {
  surat_masuk: { nomor: 'nomor', tanggal: 'tanggal', dari: 'dari', perihal: 'perihal' },
  undangan: { nomor: 'undanganNomor', tanggal: 'undanganTanggal', dari: 'penyelenggara' },
}
export function bisaSumber(pekerjaan) {
  const p = PEKERJAAN[pekerjaan]
  return Boolean(p && SUMBER_FORM[p.form])
}

export function slotOf(pekerjaan, slot) {
  const p = PEKERJAAN[pekerjaan]
  return p ? FORMS[p.form].berkas.find((b) => b.slot === slot) ?? null : null
}

/** Abaikan nomor berita acara lama pada formulir yang sudah menghapus kolomnya. */
export function isianTahapAktif(pekerjaan, isian) {
  const form = PEKERJAAN[pekerjaan]?.form
  if ((form !== 'pemeriksaan_progar' && form !== 'rapat_pemeriksaan') || !Object.hasOwn(isian, 'baNomor')) return isian
  const { baNomor, ...aktif } = isian
  return aktif
}

/**
 * Validasi isian: hanya kunci yang dikenal, semua string, panjang dibatasi,
 * tanggal sah, angka bulat 0..99999, pilihan dari daftar, wajib terisi.
 * Mengembalikan objek bersih (string kosong dibuang) atau null bila tidak sah.
 */
export function cleanIsian(pekerjaan, raw) {
  const p = PEKERJAAN[pekerjaan]
  if (!p || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const isian = isianTahapAktif(pekerjaan, raw)
  const fields = FORMS[p.form].fields
  const known = new Set(fields.map((x) => x.key))
  for (const k of Object.keys(isian)) if (!known.has(k)) return null
  const out = {}
  for (const fd of fields) {
    const v = isian[fd.key]
    if (v === undefined || v === null || v === '') { if (fd.required) return null; continue }
    if (typeof v !== 'string') return null
    const s = v.trim()
    if (s === '') { if (fd.required) return null; continue }
    if (s.length > fd.max) return null
    if (fd.type === 'date' && !parseDateOnly(s)) return null
    if (fd.type === 'number' && !/^(0|[1-9][0-9]{0,4})$/.test(s)) return null
    if (fd.type === 'select' && !fd.options.includes(s)) return null
    out[fd.key] = s
  }
  return out
}
