import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { SUMBER_LABEL, type Sumber } from './SumberSuratR5H22'
import { LampiranPreviewR5F15 } from './LampiranPreviewR5F15'
import { FormDialog, rupiah, type Dialog } from './ProgarR5H11'
import { DokumenDialog, cekLabel, periodeLabel, ringkasTahap, tahapNonaktif, tanggalTahap, ulangKe, type Katalog, type Tahap } from './DokumenTahapR5H16'
import { confirmDialog, showToast } from './UIFeedback'
import { REVISI_ANGGARAN, RINGKASAN_JENIS, RevisiAnggaran, RingkasanRealisasi } from './DalgarR5H19'
import './ProgarR5H11.css'

/**
 * R5H13: Dokumen Perencanaan (Renstra, Renja, RKA-K/L, DIPA, POK, TOR/KAK, RAB).
 *
 * Unggah -> lampirkan PDF -> Kasubbagren MENGESAHKAN (pengunggah tidak boleh
 * mengesahkan sendiri). Revisi = dokumen baru yang menggantikan dokumen sah;
 * versi lama tetap bisa dibuka. Dokumen bisa dikaitkan ke program/kegiatan.
 *
 * Dua menu memakai komponen ini (2026-11-16):
 *   mode 'rancang' = Dokumen Perancangan: draft, menunggu pengesahan, ditolak.
 *   mode 'final'   = Dokumen Final: yang sah dan berlaku, + riwayat & Buat Revisi.
 * Data dan endpoint sama; pembagiannya hanya di layar.
 */

/** Lampiran tingkat dokumen, di luar tahap pekerjaan (migrasi 063). */
type LampiranDok = { id: string; jenis: 'pdf' | 'xlsx' | 'docx'; filename: string; size: number; uploadedAt: string; uploadedByName: string }
const LAMPIRAN_DOK_ACCEPT = '.pdf,.xlsx,.docx,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ukuran = (n: number) => n >= 1048576 ? `${(n / 1048576).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
type Doc = { id: string; tahun: number; jenis: string; jenisLabel: string; periode: string; judul: string; nomor: string; tanggal: string | null; keterangan: string; status: 'draft' | 'disahkan' | 'ditolak'; version: number; penggantiDari: string | null; digantikan: boolean; createdBy: string; createdByName: string; createdAt: string; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string; program: { id: string; kode: string } | null; kegiatan: { id: string; kode: string; nama: string } | null; berkas: { filename: string; size: number } | null; tahap: Tahap[]; final: boolean; finalAt: string | null; finalByName: string | null; anggaran: string | null; anggaranNote: string; anggaranAt: string | null; anggaranByName: string | null; hibah: boolean; dipaId: string | null; lampiran: LampiranDok[] }
type Caps = { canRead: boolean; canManage: boolean; canSahkan: boolean }
type Tree = { programs: { id: string; kode: string; nama: string; kegiatan: { id: string; kode: string; nama: string }[] }[] }

const BASE = '/api/v1/subbagren/perencanaan'
export const JENIS: [string, string][] = [['rancangan_renstra', 'Rancangan Renstra'], ['renstra', 'Renstra'], ['rancangan_renja', 'Rancangan Renja'], ['renja', 'Renja'], ['iku', 'IKU'],
  ['rkks_renbut', 'RKKS Renbut'], ['rkks_pagu_indikatif', 'RKKS Pagu Indikatif'], ['rkks_pagu_anggaran', 'RKKS Pagu Anggaran'], ['rkks_pagu_alokasi', 'RKKS Pagu Alokasi'],
  ['rka_kl', 'RKA-K/L'], ['dipa', 'DIPA'], ['revisi_dipa', 'Revisi DIPA'], ['pok', 'POK'], ['rendisgar', 'Rendisgar'], ['rengiat', 'Rengiat'], ['renaksi', 'Renaksi'],
  ['perjanjian_kinerja', 'Perjanjian Kinerja'], ['tor_kak', 'TOR/KAK'], ['rab', 'RAB'], ['lainnya', 'Lainnya'],
  // R5H17 -- DALGAR
  ['lap_lra', 'LRA'], ['lap_penggunaan_anggaran', 'Laporan Penggunaan Anggaran'], ['lap_eka_pn', 'Laporan EKA PN'],
  ['lap_capaian_kinerja', 'Laporan Capaian Kinerja'], ['lap_lkip', 'LKIP'], ['lap_hibah', 'Laporan Hibah'],
  ['revisi_pok', 'Revisi POK'], ['revisi_rpd', 'Revisi RPD']]
/** R5H17: jenis milik menu DALGAR; Dokumen Perancangan/Final tidak menampilkannya. */
const LAPORAN = ['lap_lra', 'lap_penggunaan_anggaran', 'lap_eka_pn', 'lap_capaian_kinerja', 'lap_lkip', 'lap_hibah']
const REVISI = ['revisi_pok', 'revisi_rpd']
const DALGAR = [...LAPORAN, ...REVISI]
/**
 * 2026-11-22 (keputusan pemilik): Revisi DIPA TAMPIL di menu Revisi Anggaran (DALGAR), bukan di Dokumen
 * Perancangan/Final. Hanya pindah tempat: alurnya tetap dokumen sah (unggah PDF -> disahkan Kasubbagren,
 * bisa direvisi), tetap dasar pagu dan target tautan "DIPA baru" Revisi RPD. Ia SENGAJA tidak masuk
 * DALGAR/REVISI (yang mengatur alur Selesai). DIPA awal tetap di PROGAR.
 */
const PINDAH_KE_REVISI = ['revisi_dipa']
/** Dokumen beralur sah (bukan laporan/revisi POK-RPD), di menu mana pun ia tampil. */
const alurDokumen = (d: { jenis: string }) => !DALGAR.includes(d.jenis)
const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_link: 'Program/kegiatan atau dokumen yang direvisi tidak sesuai tahun/jenisnya.',
  dokumen_not_draft: 'Dokumen ini sudah diputuskan dan tidak dapat diubah lagi.',
  version_conflict: 'Data sudah diubah (mungkin berkas baru diunggah). Muat ulang lalu coba lagi.',
  berkas_required: 'Belum ada PDF dokumen. Unggah PDF bertanda tangan ke dokumen, atau untuk jenis bertahap lampirkan "Dokumen yang sudah ditandatangani" di tahap pengesahannya.',
  tahap_nonaktif: 'Tahap ini dinonaktifkan Superadmin di Master Data, jadi tidak bisa ditambahkan lagi. Muat ulang halaman.',
  tahap_sudah_diterima: 'Tahap yang sudah diterima Kasubbagren tidak bisa dihapus.',
  pdf_sah_wajib_ada: 'Dokumen sudah sah: PDF bertanda tangan terakhir tidak boleh dihapus. Unggah penggantinya dulu.',
  tahap_belum_diterima: 'Masih ada tahap yang belum diterima Kasubbagren.',
  sumber_tidak_ditemukan: 'Disposisi/surat masuk yang dipilih tidak ditemukan atau bukan untuk Subbagren.',
  sumber_tidak_berlaku: 'Jenis pekerjaan ini tidak bisa ditautkan ke disposisi/surat masuk.',
  tahap_bukan_menunggu: 'Tahap ini sudah diperiksa. Muat ulang halaman.',
  self_review_forbidden: 'Dokumen yang Anda unggah sendiri harus disahkan oleh orang lain.',
  revisi_hanya_dari_dokumen_sah: 'Revisi hanya bisa dibuat dari dokumen yang sudah disahkan.',
  revisi_sudah_ada: 'Dokumen ini sudah punya revisi yang sedang diproses atau sudah sah.',
  pekerjaan_tidak_sesuai: 'Pekerjaan itu tidak termasuk tahap untuk jenis dokumen ini.',
  dokumen_terkunci: 'Dokumen sudah final/selesai atau sudah digantikan revisi; tidak bisa diubah lagi.',
  final_hanya_dokumen_sah: 'Hanya dokumen yang sudah disahkan (dan belum digantikan revisi) yang bisa ditandai final.',
  sudah_final: 'Dokumen ini sudah final.',
  belum_final: 'Dokumen ini belum final.',
  jenis_terkunci_tahap: 'Jenis tidak bisa diganti karena dokumen sudah punya tahap pekerjaan.',
  batas_tahap: 'Satu dokumen paling banyak 50 tahap.',
  jenis_tanpa_pengesahan: 'Jenis dokumen ini tidak disahkan; tandai Selesai setelah semua tahap diterima.',
  tahap_kosong: 'Catat minimal satu tahap pekerjaan sebelum menandai Selesai.',
  periode_tidak_sesuai: 'Pilih bulan/triwulan laporan.',
  anggaran_di_bawah_realisasi: 'Anggaran tidak boleh lebih kecil dari realisasi yang sudah terverifikasi.',
  dipa_baru_belum: 'Revisi RPD baru bisa Selesai setelah tahap "DIPA baru terbit" diterima Kasubbagren dengan PDF DIPA terlampir.',
  dipa_belum_ditautkan: 'Tautkan dulu dokumen DIPA hasil revisi ini (baris "DIPA terkait" di detail).',
  dipa_tidak_sesuai: 'Pilih DIPA/Revisi DIPA tahun yang sama, yang tidak ditolak dan belum digantikan revisi.',
  bukan_revisi_anggaran: 'Dokumen ini bukan revisi anggaran.',
  revisi_kosong: 'Atur dulu daftar perubahan (dokumen dan angka barunya) sebelum menandai Selesai.',
  revisi_sudah_diterapkan: 'Revisi ini sudah diterapkan ke anggaran/RPD dan tidak bisa dibuka kembali. Buat revisi baru untuk koreksi.',
  rpd_tidak_sama_anggaran: 'Total RPD 12 bulan harus sama dengan anggaran dokumennya. Perbarui daftar perubahan RPD.',
  pos_tidak_aktif: 'Ada dokumen di daftar perubahan yang tidak lagi Final atau sudah digantikan revisi. Perbarui daftarnya.',
  tahun_tidak_cocok: 'Dokumen di daftar perubahan harus setahun anggaran dengan revisinya.',
  jenis_beda_alur: 'Jenis RKKS/pagu tidak bisa ditukar dengan jenis yang disahkan. Buat dokumen baru.',
  batas_lampiran: 'Batas jumlah lampiran tercapai (10 per jenis lampiran tahap, 30 per dokumen).',
  invalid_body: 'Isian tidak sesuai atau terlalu panjang.',
  invalid_file_type: 'Berkas tidak valid. Lampiran tahap umumnya PDF (hasil unduhan myinterest boleh Excel/Word); lampiran dokumen boleh PDF, Excel (.xlsx), atau Word (.docx).',
  file_too_large: 'Ukuran berkas maksimal 20 MB.',
  one_file_required: 'Pilih satu berkas.',
  evidence_encryption_unavailable: 'Kunci enkripsi berkas belum dikonfigurasi di server. Hubungi administrator.',
  evidence_integrity_failure: 'Berkas gagal diperiksa keutuhannya. Unggah ulang.',
  not_found: 'Data sudah tidak ada. Muat ulang halaman.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
async function api<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') {
    const c = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!c.ok) throw Error('Sesi keamanan tidak tersedia. Silakan login kembali.')
    headers['X-CSRF-Token'] = ((await c.json()) as { csrfToken: string }).csrfToken
  }
  const form = body instanceof FormData
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  const r = await fetch(path.startsWith('/api/') ? path : `${BASE}${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}) })
  if (!r.ok) {
    const e: { error?: string } = await r.json().catch(() => ({}))
    if (r.status === 404 && !e.error) throw Error('Layanan Dokumen Perancangan/Final belum tersedia di server ini.')
    throw Error(ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}).`)
  }
  return r.json() as Promise<T>
}
/**
 * Rantai revisi: setiap dokumen dikelompokkan ke akar rantainya (dokumen pertama
 * yang tidak menunjuk dokumen lain lewat penggantiDari), urut waktu dibuat.
 * Disusun di layar dari daftar yang sudah dimuat (semua tahun), jadi tidak perlu endpoint baru.
 */
function buildChains(docs: Doc[]): Map<string, Doc[]> {
  const byId = new Map(docs.map(d => [d.id, d]))
  const rootOf = (d: Doc) => { let cur = d; const seen = new Set<string>(); while (cur.penggantiDari && byId.has(cur.penggantiDari) && !seen.has(cur.id)) { seen.add(cur.id); cur = byId.get(cur.penggantiDari)! } return cur.id }
  const chains = new Map<string, Doc[]>()
  for (const d of docs) { const r = rootOf(d); chains.set(r, [...(chains.get(r) ?? []), d]) }
  for (const list of chains.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return chains
}
const labelJenis = (j: string) => JENIS.find(([k]) => k === j)?.[1] ?? j
const tgl = (d: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

export default function DokumenR5H13({ userId, mode = 'rancang', onOpenRancang, onOpenFinal, onOpenSumber }: { userId: string; mode?: 'rancang' | 'final' | 'laporan' | 'revisi'; onOpenRancang?: () => void; onOpenFinal?: () => void; onOpenSumber?: (s: Sumber) => void }) {
  const final = mode === 'final'
  // R5H17: menu DALGAR "Laporan" / "Revisi Anggaran" memakai daftar yang sama, tanpa
  // pemisahan perancangan/final (yang selesai tetap di daftar, disaring lewat Status).
  const dalgar = mode === 'laporan' || mode === 'revisi'
  const kind = mode === 'laporan' ? 'laporan' as const : mode === 'revisi' ? 'revisi' as const : 'dokumen' as const
  const groupJenis = mode === 'laporan' ? LAPORAN : mode === 'revisi' ? [...REVISI, ...PINDAH_KE_REVISI] : null
  const inGroup = (d: { jenis: string }) => groupJenis ? groupJenis.includes(d.jenis) : !DALGAR.includes(d.jenis) && !PINDAH_KE_REVISI.includes(d.jenis)
  const jenisOptions = JENIS.filter(([k]) => inGroup({ jenis: k }))
  const [jenisF, setJenisF] = useState('')
  const [statusF, setStatusF] = useState<'' | 'proses' | 'selesai'>('')
  const thisYear = new Date().getFullYear()
  // Semua tahun dimuat sekaligus; tahun anggaran hanya filter tampilan (2026-11-16).
  const [tahun, setTahun] = useState<number | 'semua'>('semua')
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [tree, setTree] = useState<Tree | null>(null)
  const [caps, setCaps] = useState<Caps | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  // Formulir dokumen + Tahap Pekerjaan (R5H16).
  const [dokDialog, setDokDialog] = useState<{ mode: 'create' | 'edit' | 'tahap'; doc?: Doc; tahapId?: string } | null>(null)
  // Dokumen yang detailnya sedang dibuka (id; isinya diambil ulang dari daftar setiap muat).
  const [detailId, setDetailId] = useState<string | null>(null)
  const [katalog, setKatalog] = useState<Katalog | null>(null)
  // Riwayat versi yang sedang dibuka (daftar versi satu rantai), atau null.
  const [riwayat, setRiwayat] = useState<Doc[] | null>(null)
  const [uploading, setUploading] = useState('')
  // Dokumen dibuka di jendela pratinjau (bukan diunduh) supaya pemeriksa cukup melihat.
  const [preview, setPreview] = useState<{ url: string; name: string; mime: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const lampRef = useRef<HTMLInputElement | null>(null)
  const target = useRef<Doc | null>(null)

  // Nomor muat terakhir: respons tahun lama yang tiba belakangan (mis. ganti tahun
  // saat muat pertama belum selesai) dibuang supaya tidak menimpa tahun terpilih.
  const loadSeq = useRef(0)
  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true); setError('')
    try {
      const c = caps ?? await api<Caps>('/capabilities')
      if (seq !== loadSeq.current) return
      setCaps(c)
      if (!c.canRead) return
      const [d, t, k] = await Promise.all([api<{ items: Doc[] }>('/dokumen?tahun=semua'), Promise.resolve<Tree | null>(null),
        katalog ? Promise.resolve(katalog) : api<Katalog>('/tahap-katalog').catch(() => null)])
      if (seq !== loadSeq.current) return
      setDocs(d.items); setTree(t); setKatalog(k)
    } catch (e) { if (seq === loadSeq.current) setError(e instanceof Error ? e.message : 'Data tidak dapat dimuat.') } finally { if (seq === loadSeq.current) setLoading(false) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  const years = useMemo(() => [...new Set([...(docs ?? []).map(d => d.tahun), thisYear])].sort((a, b) => b - a), [docs, thisYear])
  const canManage = Boolean(caps?.canManage); const canSahkan = Boolean(caps?.canSahkan)
  const linkOptions = useMemo(() => [{ value: '', label: '— Tidak dikaitkan —' }, ...(tree?.programs ?? []).flatMap(p => [
    { value: `p:${p.id}`, label: `Program ${p.kode} — ${p.nama}` },
    ...p.kegiatan.map(k => ({ value: `k:${k.id}`, label: `    Kegiatan ${p.kode} · ${k.kode} — ${k.nama}` })),
  ])], [tree])
  const run = async (fn: () => Promise<unknown>, ok: string) => { await fn(); showToast(ok, 'success'); await load() }
  const guard = async (fn: () => Promise<void>) => { try { await fn() } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal.', 'error') } }
  const payload = (v: Record<string, string>) => ({
    jenis: v.jenis, judul: v.judul, nomor: v.nomor, tanggal: v.tanggal, keterangan: v.keterangan,
    programId: v.link.startsWith('p:') ? v.link.slice(2) : '', kegiatanId: v.link.startsWith('k:') ? v.link.slice(2) : '',
  })
  const fields = (): Dialog['fields'] => [
    { key: 'jenis', label: 'Jenis Dokumen', type: 'select', required: true, max: 20, options: JENIS.map(([value, label]) => ({ value, label })) },
    { key: 'judul', label: 'Judul Dokumen', required: true, max: 240, placeholder: 'mis. DIPA Satker Densus 88 AT Polri TA 2026' },
    { key: 'nomor', label: 'Nomor Dokumen', max: 120, half: true, placeholder: 'mis. SP DIPA-060.01.1.xxxxx/2026' },
    { key: 'tanggal', label: 'Tanggal Dokumen', type: 'date', max: 10, half: true },
    // Disembunyikan atas permintaan pemilik (2026-11-16): isian ini membingungkan
    // karena hanya cocok untuk sebagian jenis dokumen (TOR/KAK, RAB). Backend
    // tetap menerima programId/kegiatanId; nilai lama dipertahankan saat Ubah/Revisi
    // karena `values.link` tetap diisi dari linkOf(d).
    // { key: 'link', label: 'Terkait Program / Kegiatan', type: 'select', max: 80, options: linkOptions, hint: 'Opsional. Hanya program/kegiatan tahun yang sama.' },
    { key: 'keterangan', label: 'Keterangan', type: 'textarea', max: 1000 },
  ]
  const chains = useMemo(() => buildChains(docs ?? []), [docs])
  const chainOf = useMemo(() => { const m = new Map<string, Doc[]>(); for (const list of chains.values()) for (const d of list) m.set(d.id, list); return m }, [chains])
  const linkOf = (d: Doc) => d.kegiatan ? `k:${d.kegiatan.id}` : d.program ? `p:${d.program.id}` : ''

  const add = () => setDokDialog({ mode: 'create' })
  const edit = (d: Doc) => setDokDialog({ mode: 'edit', doc: d })
  const tambahTahap = (d: Doc) => setDokDialog({ mode: 'tahap', doc: d })
  const ubahTahap = (d: Doc, t: Tahap) => setDokDialog({ mode: 'tahap', doc: d, tahapId: t.id })
  const punyaTahap = (d: Doc) => (katalog?.jenis[d.jenis] ?? []).length > 0
  // Jenis RKKS/pagu (no. 5-8 alur Densus 88) tidak disahkan: langsung SELESAI (keputusan 2026-11-17).
  const tanpaSah = (d: Doc) => Boolean(katalog?.tanpaSah?.includes(d.jenis))
  const bisaSelesai = (d: Doc) => tanpaSah(d) && d.status === 'draft' && !d.final
  // Revisi RPD (2026-11-18): wajib sampai DIPA baru terbit (tahap diterima + PDF DIPA) dan DIPA ditautkan.
  const dipaTerbit = (d: Doc) => d.tahap.find(t => t.pekerjaan === 'dipa_baru' && t.cekStatus === 'diterima' && t.berkas.some(b => b.slot === 'dipa'))
  const syaratDipa = (d: Doc) => d.jenis !== 'revisi_rpd' || (Boolean(dipaTerbit(d)) && Boolean(d.dipaId))
  const siapSelesai = (d: Doc) => d.tahap.length > 0 && semuaDiterima(d) && syaratDipa(d)
  const alasanBelumSelesai = (d: Doc) => d.tahap.length === 0 ? 'Catat minimal satu tahap pekerjaan dulu' : !semuaDiterima(d) ? 'Tunggu semua tahap diterima Kasubbagren'
    : !dipaTerbit(d) ? 'Tahap "DIPA baru terbit" (dengan PDF DIPA) harus dicatat dan diterima dulu' : 'Tautkan dokumen DIPA terkait dulu'
  const dipaOptions = (d: Doc) => (docs ?? []).filter(x => (x.jenis === 'dipa' || x.jenis === 'revisi_dipa') && x.tahun === d.tahun && x.status !== 'ditolak' && !x.digantikan)
  const pilihDipa = (d: Doc) => {
    const nomorTahap = d.tahap.filter(t => t.pekerjaan === 'dipa_baru').map(t => t.isian.nomor).filter(Boolean).pop() ?? ''
    const opts = dipaOptions(d)
    const cocok = opts.find(x => nomorTahap && x.nomor.trim() === nomorTahap.trim())
    setDialog({ title: 'DIPA Terkait', eyebrow: `REVISI RPD · TA ${d.tahun}`, context: d.judul,
      fields: [{ key: 'dipaId', label: 'Dokumen DIPA hasil revisi ini', type: 'select', max: 40, options: [{ value: '', label: '— Belum ditautkan —' },
        ...opts.map(x => ({ value: x.id, label: `${x.jenisLabel} — ${x.judul}${x.nomor ? ` (${x.nomor})` : ''} · ${x.status === 'disahkan' ? 'Sah' : 'Draf'}` }))],
        hint: opts.length ? (nomorTahap ? `Nomor di tahap "DIPA baru terbit": ${nomorTahap}${cocok ? ' (cocok dengan salah satu dokumen)' : ''}.` : 'Catat Revisi DIPA di menu Revisi Anggaran bila belum ada di daftar.') : `Belum ada DIPA TA ${d.tahun}. Unggah DIPA di Dokumen Perancangan atau Revisi DIPA di menu Revisi Anggaran.` }],
      values: { dipaId: d.dipaId ?? cocok?.id ?? '' }, submitLabel: 'Simpan',
      onSubmit: v => run(() => api(`/dokumen/${d.id}/dipa`, 'PUT', { dipaId: v.dipaId, version: d.version }), v.dipaId ? 'DIPA terkait disimpan.' : 'Tautan DIPA dilepas.') })
  }
  /** Baris tautan Revisi RPD <-> DIPA di detail dokumen. */
  const tautanDipa = (d: Doc): ReactNode => {
    const buka = (x: Doc) => <button key={x.id} type="button" className="sdl-progar__file is-full" onClick={() => setDetailId(x.id)} title="Buka dokumen">{x.jenisLabel} — {x.judul}{x.nomor ? ` (${x.nomor})` : ''}</button>
    if (d.jenis === 'revisi_rpd') {
      const x = (docs ?? []).find(y => y.id === d.dipaId)
      return <><dt>DIPA terkait</dt><dd className="sdl-progar__anggaran"><span>{x ? buka(x) : <span className="sdl-progar__muted">Belum ditautkan</span>}
        {canManage && !d.final && <button type="button" className="sdl-progar__mini" onClick={() => pilihDipa(d)}>{x ? 'Ganti' : 'Pilih DIPA'}</button>}</span></dd></>
    }
    if (d.jenis === 'dipa' || d.jenis === 'revisi_dipa') {
      const rs = (docs ?? []).filter(y => y.jenis === 'revisi_rpd' && y.dipaId === d.id)
      return rs.length ? <><dt>Revisi RPD terkait</dt><dd>{rs.map(buka)}</dd></> : null
    }
    return null
  }
  // Tahap masih bisa ditambah: draft, atau sah tetapi belum final dan belum digantikan.
  // PDF utama: PDF yang diunggah langsung, atau (jenis bertahap) "Dokumen yang sudah
  // ditandatangani" dari tahap pengesahan -- keputusan pemilik 2026-11-17.
  const signedOf = (d: Doc) => d.tahap.flatMap(t => t.berkas.filter(b => b.slot === 'dokumen_sah').map(b => ({ t, b })))
  const hasPdf = (d: Doc) => Boolean(d.berkas) || signedOf(d).length > 0
  const semuaDiterima = (d: Doc) => d.tahap.every(t => t.cekStatus === 'diterima')
  // Tahap yang menunggu dicek oleh akun ini (bukan hasil ubahannya sendiri).
  const perluDicek = (d: Doc) => canSahkan && tahapTerbukaRaw(d) ? d.tahap.filter(t => t.cekStatus === 'menunggu' && t.updatedBy !== userId).length : 0
  const tahapTerbukaRaw = (d: Doc) => !d.final && (d.status === 'draft' || (d.status === 'disahkan' && !d.digantikan))
  async function cek(d: Doc, t: Tahap, keputusan: 'diterima' | 'dikembalikan', catatan = '') {
    await run(() => api(`/dokumen/${d.id}/tahap/${t.id}/cek`, 'POST', { keputusan, catatan, version: t.version }), keputusan === 'diterima' ? 'Tahap diterima.' : 'Tahap dikembalikan ke operator.')
  }
  const kembalikan = (d: Doc, t: Tahap) => setDialog({ title: 'Kembalikan Tahap', eyebrow: 'PEMERIKSAAN TAHAP', danger: true, context: `${t.pekerjaanLabel} — ${d.judul}`, fields: [{ key: 'catatan', label: 'Apa yang perlu diperbaiki?', type: 'textarea', required: true, max: 500, hint: 'Minimal 8 karakter.' }], values: { catatan: '' }, submitLabel: 'Kembalikan',
    onSubmit: v => cek(d, t, 'dikembalikan', v.catatan) })
  const [hanyaCek, setHanyaCek] = useState(false)
  const tahapTerbuka = tahapTerbukaRaw
  const ubahAnggaran = (d: Doc) => setDialog({ title: 'Anggaran (estimasi)', eyebrow: `${d.jenisLabel.toUpperCase()} · TA ${d.tahun}`, context: d.judul,
    fields: [{ key: 'anggaran', label: 'Estimasi anggaran (Rp)', type: 'rupiah', max: 16, hint: 'Kosongkan untuk menghapus estimasi.' },
      { key: 'hibah', label: 'Sumber dana', type: 'select', max: 5, options: [{ value: 'tidak', label: 'Rupiah murni / bukan hibah' }, { value: 'ya', label: 'Dana hibah' }], hint: 'Dokumen dana hibah masuk ke Laporan Hibah.' },
      { key: 'catatan', label: 'Catatan', type: 'textarea', max: 500, placeholder: 'mis. berdasarkan pagu indikatif TA 2028' }],
    values: { anggaran: d.anggaran ?? '', hibah: d.hibah ? 'ya' : 'tidak', catatan: d.anggaranNote }, submitLabel: 'Simpan',
    onSubmit: v => run(() => api(`/dokumen/${d.id}/anggaran`, 'PUT', { anggaran: v.anggaran.replace(/\D/g, '').replace(/^0+(?=\d)/, ''), catatan: v.catatan.trim(), hibah: v.hibah === 'ya', version: d.version }), 'Estimasi anggaran disimpan.') })
  const revisi = (d: Doc) => setDialog({ title: 'Buat Revisi', eyebrow: `REVISI ${d.jenisLabel.toUpperCase()}`, context: `Menggantikan: ${d.judul}${d.nomor ? ` (${d.nomor})` : ''}`, fields: fields(), values: { jenis: d.jenis, judul: d.judul, nomor: '', tanggal: '', link: linkOf(d), keterangan: '' }, submitLabel: 'Simpan Revisi (lalu lampirkan PDF)',
    onSubmit: v => run(() => api('/dokumen', 'POST', { tahun: d.tahun, ...payload({ ...v, jenis: d.jenis }), penggantiDari: d.id }), 'Revisi disimpan sebagai draft di Dokumen Perancangan. Lampirkan PDF-nya di sana lalu ajukan pengesahan.') })
  const tolak = (d: Doc) => setDialog({ title: 'Tolak Dokumen', eyebrow: 'PENGESAHAN DOKUMEN', danger: true, context: d.judul, fields: [{ key: 'catatan', label: 'Alasan penolakan', type: 'textarea', required: true, max: 500, hint: 'Minimal 8 karakter.' }], values: { catatan: '' }, submitLabel: 'Tolak',
    onSubmit: v => run(() => api(`/dokumen/${d.id}/review`, 'POST', { keputusan: 'ditolak', catatan: v.catatan, version: d.version }), 'Dokumen ditolak.') })
  async function sahkan(d: Doc) {
    if (!await confirmDialog(`Sahkan ${d.jenisLabel} "${d.judul}"? Data dan PDF utama dokumen terkunci; tahap pekerjaan masih bisa ditambah sampai dokumen ditandai final.`, { confirmLabel: 'Sahkan' })) return
    await guard(() => run(() => api(`/dokumen/${d.id}/review`, 'POST', { keputusan: 'disahkan', catatan: '', version: d.version }), 'Dokumen disahkan. Ia tetap di Dokumen Perancangan sampai ditandai final.'))
  }
  async function tandaiFinal(d: Doc, jadi: boolean) {
    const kata = tanpaSah(d) ? 'SELESAI' : 'FINAL'
    const efek = REVISI_ANGGARAN.includes(d.jenis)
      ? ` Perubahan ${d.jenis === 'revisi_pok' ? 'anggaran' : 'RPD'} di daftar langsung diterapkan ke dokumen terkait, dan revisi ini tidak bisa dibuka kembali.`
      : RINGKASAN_JENIS.includes(d.jenis) ? ' Angka ringkasan realisasi dibekukan per hari ini.' : ''
    const msg = jadi
      ? `Tandai "${d.judul}" sebagai ${kata}? ${dalgar ? 'Tahap pekerjaannya' : 'Dokumen pindah ke Dokumen Final dan tahap pekerjaannya'} tidak bisa diubah lagi.${efek}`
      : `${dalgar ? 'Buka kembali' : 'Kembalikan'} "${d.judul}"${dalgar ? '' : ' ke Dokumen Perancangan'}? Tahap pekerjaannya bisa ditambah lagi.`
    if (!await confirmDialog(msg, { confirmLabel: jadi ? (tanpaSah(d) ? 'Tandai Selesai' : 'Tandai Final') : 'Kembalikan' })) return
    await guard(() => run(() => api(`/dokumen/${d.id}/final`, 'POST', { final: jadi, version: d.version }), jadi ? (dalgar ? `Ditandai ${kata.toLowerCase()}.` : `Dokumen ditandai ${kata.toLowerCase()} dan pindah ke Dokumen Final.`) : (dalgar ? 'Dibuka kembali.' : 'Dokumen dikembalikan ke Dokumen Perancangan.')))
  }
  function pick(d: Doc) { target.current = d; fileRef.current?.click() }
  // Lampiran dokumen (di luar tahap): bisa diubah selama belum final; terkunci setelah Final (2026-11-18).
  const lampiranTerbuka = (d: Doc) => canManage && !d.final && (d.status === 'draft' || (d.status === 'disahkan' && !d.digantikan))
  function pickLampiran(d: Doc) { target.current = d; lampRef.current?.click() }
  async function onLampiran(list: FileList | null) {
    const d = target.current
    const files = list ? [...list] : []
    if (lampRef.current) lampRef.current.value = ''
    if (!files.length || !d) return
    const salah = files.find(f => !/\.(pdf|xlsx|docx)$/i.test(f.name))
    if (salah) { showToast(`"${salah.name}" bukan PDF, Excel (.xlsx), atau Word (.docx).`, 'error'); return }
    const besar = files.find(f => f.size > 20 * 1024 * 1024)
    if (besar) { showToast(`"${besar.name}" melebihi 20 MB.`, 'error'); return }
    setUploading(`lamp:${d.id}`)
    let ok = 0
    try {
      for (const f of files) {
        const form = new FormData(); form.append('file', f)
        await api(`/dokumen/${d.id}/lampiran`, 'POST', form); ok++
      }
      showToast(`${ok} lampiran ditambahkan.`, 'success')
    } catch (e) {
      showToast(`${ok ? `${ok} lampiran tersimpan; ` : ''}${e instanceof Error ? e.message : 'Gagal mengunggah.'}`, 'error')
    } finally { setUploading(''); void load() }
  }
  async function hapusLampiran(d: Doc, l: LampiranDok) {
    if (!await confirmDialog(`Hapus lampiran "${l.filename}" dari dokumen ini?`, { confirmLabel: 'Hapus' })) return
    await guard(() => run(() => api(`/dokumen/${d.id}/lampiran/${l.id}`, 'DELETE'), 'Lampiran dihapus.'))
  }
  async function onFile(file: File | undefined) {
    const d = target.current
    if (fileRef.current) fileRef.current.value = ''
    if (!file || !d) return
    if (file.size > 20 * 1024 * 1024) { showToast(ERRORS.file_too_large, 'error'); return }
    const form = new FormData(); form.append('file', file)
    setUploading(d.id)
    await guard(() => run(() => api(`/dokumen/${d.id}/berkas`, 'POST', form), 'Berkas PDF dilampirkan.'))
    setUploading('')
  }

  if (caps && !caps.canRead) return <div className="sdl-progar"><div className="panel sdl-progar__empty"><strong>Tidak ada akses</strong><p>Akun ini belum diberi kewenangan membaca dokumen perencanaan Subbagren.</p></div></div>

  // Versi yang sudah digantikan tidak tampil di daftar; ia dilihat lewat tombol
  // Riwayat pada versi terbarunya (menggantikan centang "Tampilkan versi lama").
  // Perancangan = belum final (draft, ditolak, atau sah tetapi belum ditandai final);
  // Final = sah DAN ditandai final. Keduanya tanpa versi yang sudah digantikan.
  const inYear = (d: Doc) => tahun === 'semua' || d.tahun === tahun
  const isFinal = (d: Doc) => d.final
  const visible = (docs ?? []).filter(d => inYear(d) && !d.digantikan && inGroup(d) && (dalgar
    ? (!jenisF || d.jenis === jenisF) && (!statusF || (statusF === 'selesai') === d.final)
    : (final ? isFinal(d) : !isFinal(d))))
  // Final: revisi yang sedang dirancang (draft yang menunjuk dokumen sah ini).
  const draftRevisi = (d: Doc) => (docs ?? []).find(x => x.penggantiDari === d.id && x.status === 'draft')
  const otherCount = dalgar ? 0 : (docs ?? []).filter(d => inYear(d) && !d.digantikan && inGroup(d) && (final ? !isFinal(d) : isFinal(d))).length
  const thn = tahun === 'semua' ? '' : ` tahun ${tahun}`
  // Satu tabel: urut jenis (sesuai daftar JENIS), lalu tahun terbaru, lalu terbaru dibuat.
  const tahapRingkas = (d: Doc) => {
    if (!d.tahap.length) return null
    const n = d.tahap.filter(t => t.cekStatus === 'menunggu').length, k = d.tahap.filter(t => t.cekStatus === 'dikembalikan').length
    if (!n && !k) return <small className="sdl-progar__ok">✓ Semua diterima</small>
    return <small>{n > 0 && <span className="sdl-progar__pending">{n} menunggu dicek</span>}{n > 0 && k > 0 && ' · '}{k > 0 && <span className="sdl-progar__rejected-inline">{k} dikembalikan</span>}</small>
  }
  const jenisRank = (j: string) => JENIS.findIndex(([k]) => k === j)
  const antreCek = visible.filter(d => perluDicek(d) > 0 || (canSahkan && d.status === 'draft' && !tanpaSah(d) && hasPdf(d) && d.createdBy !== userId))
  // DALGAR: terbaru di atas (tahun, lalu periode); dokumen: urut jenis dulu.
  const rows = [...(hanyaCek ? antreCek : visible)].sort((a, b) => (dalgar ? 0 : jenisRank(a.jenis) - jenisRank(b.jenis)) || b.tahun - a.tahun || b.periode.localeCompare(a.periode) || b.createdAt.localeCompare(a.createdAt))
  const status = (d: Doc) => tanpaSah(d) ? (d.final ? { cls: 'is-disetujui', label: 'Selesai' } : { cls: 'is-draft', label: 'Dalam proses' }) : d.digantikan ? { cls: 'is-kosong', label: 'Digantikan revisi' } : d.status === 'disahkan' ? (d.final ? { cls: 'is-disetujui', label: 'Final' } : { cls: 'is-disetujui', label: 'Sah · belum final' }) : d.status === 'ditolak' ? { cls: 'is-ditolak', label: 'Ditolak' } : hasPdf(d) ? { cls: 'is-draft', label: 'Menunggu pengesahan' } : { cls: 'is-draft', label: punyaTahap(d) ? 'Draf' : 'Draf · PDF belum dilampirkan' }

  return <div className="sdl-progar">
    <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => void onFile(e.target.files?.[0])} />
    <input ref={lampRef} type="file" accept={LAMPIRAN_DOK_ACCEPT} multiple hidden onChange={e => void onLampiran(e.target.files)} />
    <div className="sdl-progar__toolbar">
      <label className="sdl-progar__year">Filter Tahun Anggaran
        <select value={tahun} onChange={e => setTahun(e.target.value === 'semua' ? 'semua' : Number(e.target.value))}><option value="semua">Semua tahun</option>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
      </label>
      {dalgar && jenisOptions.length > 1 && <label className="sdl-progar__year">Jenis
        <select value={jenisF} onChange={e => setJenisF(e.target.value)}><option value="">Semua jenis</option>{jenisOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>}
      {dalgar && <label className="sdl-progar__year">Status
        <select value={statusF} onChange={e => setStatusF(e.target.value as '' | 'proses' | 'selesai')}><option value="">Semua</option><option value="proses">Dalam proses</option><option value="selesai">Selesai</option></select></label>}
      {canSahkan && !final && <label className="sdl-progar__check"><input type="checkbox" checked={hanyaCek} onChange={e => setHanyaCek(e.target.checked)} /> Perlu dicek saya <b>{antreCek.length}</b></label>}
      <span className="sdl-progar__grow" />
      <button type="button" className="btn" onClick={() => void load()} disabled={loading}>Muat ulang</button>
      {canManage && !final && <button type="button" className="btn primary" onClick={add}>{mode === 'laporan' ? '＋ Laporan Baru' : mode === 'revisi' ? '＋ Revisi Baru' : '＋ Unggah Dokumen'}</button>}
    </div>
    <p className="sdl-progar__hint">{mode === 'laporan'
      ? <>Laporan anggaran dan kinerja{thn}: LRA, Penggunaan Anggaran, EKA PN, Capaian Kinerja, LKIP, dan Hibah. Catat tiap langkah beserta buktinya, lalu tandai <strong>Selesai</strong> setelah semua langkah diterima Kasubbagren. Angka <strong>LRA</strong> diambil dari menu <strong>Data myinterest (LRA)</strong>.</>
      : mode === 'revisi'
      ? <>Revisi DIPA, POK, dan RPD{thn}. Revisi DIPA diunggah lalu disahkan Kasubbagren (menjadi dasar pagu); revisi POK selesai setelah ditandatangani Kadensus; revisi RPD berlanjut ke Eselon 1 dan Kanwil DJPB sampai DIPA baru terbit.</>
      : final
      ? <>Dokumen yang sudah disahkan dan ditandai final, serta dokumen RKKS/pagu yang sudah selesai{thn}. Perubahan dokumen sah dibuat lewat <strong>Buat Revisi</strong>.</>
      : <>Dokumen yang sedang disusun{thn}. Tekan <strong>Buka</strong> untuk melihat detail, PDF, dan tahap pekerjaan.</>}
      {otherCount > 0 && (final ? onOpenRancang : onOpenFinal) && <> <button type="button" className="sdl-progar__link" onClick={final ? onOpenRancang : onOpenFinal}>{final ? `${otherCount} dokumen sedang dirancang →` : `${otherCount} dokumen final →`}</button></>}</p>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}

    {loading && !docs ? <div className="panel sdl-progar__empty"><p>Memuat…</p></div>
      : docs && rows.length === 0 ? (dalgar
        ? <div className="panel sdl-progar__empty"><strong>Belum ada {mode === 'laporan' ? 'laporan' : 'revisi anggaran'}{thn}</strong>
            <p>{canManage ? `Tekan ${mode === 'laporan' ? '＋ Laporan Baru' : '＋ Revisi Baru'} untuk mulai mencatat.` : 'Akan tampil di sini setelah dicatat.'}</p></div>
        : final
        ? <div className="panel sdl-progar__empty"><strong>Belum ada dokumen final{thn}</strong>
            <p>Dokumen tampil di sini setelah disahkan lalu ditandai final di Dokumen Perancangan.</p></div>
        : <div className="panel sdl-progar__empty"><strong>Tidak ada dokumen yang sedang dirancang{thn}</strong>
            <p>{canManage ? 'Unggah Renstra, Renja, RKA-K/L, DIPA, POK, TOR/KAK, atau RAB. Dokumen berlaku setelah disahkan Kasubbagren.' : 'Dokumen akan tampil di sini setelah diunggah.'}</p></div>)
      : <section className="panel sdl-progar__program sdl-progar__doclist" aria-label="Daftar dokumen">
          <p className="sdl-progar__count">{rows.length} {mode === 'laporan' ? 'laporan' : mode === 'revisi' ? 'revisi' : 'dokumen'}</p>
          <div className="table-scroll"><table className="data-table sdl-progar__table">
            <thead><tr><th>Jenis</th><th>{mode === 'laporan' ? 'Laporan' : mode === 'revisi' ? 'Revisi' : 'Dokumen'}</th><th>Tahap Pekerjaan</th>{mode !== 'rancang' && <th>Status</th>}<th scope="col">Aksi</th></tr></thead>
            <tbody>{rows.map(d => {
              const st = status(d); const mine = d.createdBy === userId
              const last = d.tahap.length ? d.tahap[d.tahap.length - 1] : null
              const lastDate = last ? (last.isian.tanggal || last.isian.rapatTanggal || last.isian.sprinTanggal || last.isian.suratTanggal || last.isian.ttdTanggal || last.updatedAt.slice(0, 10)) : ''
              return <tr key={d.id}>
                <td className="sdl-progar__jenis">{d.jenisLabel}{d.periode && <small className="sdl-progar__num">{periodeLabel(d.periode)} {d.tahun}</small>}</td>
                <td><button type="button" className="sdl-progar__open" onClick={() => setDetailId(d.id)} title="Buka detail dokumen">{d.judul}</button>{d.penggantiDari && <span className="sdl-progar__tag">Revisi</span>}
                  <small className="sdl-progar__num"><span className="sdl-progar__ta">TA {d.tahun}</span> {[d.nomor, tgl(d.tanggal)].filter(Boolean).join(' · ') || 'Tanpa nomor'}</small>
                  {mode !== 'rancang' && d.anggaran && <small className="sdl-progar__num">Estimasi {rupiah(d.anggaran)}</small>}
                  {d.status === 'ditolak' && <small className="sdl-progar__rejected">Ditolak: “{d.reviewNote}”</small>}
                  {d.status === 'disahkan' && draftRevisi(d) && <small className="sdl-progar__pending">✎ Ada revisi yang sedang dirancang</small>}</td>
                <td>{last ? <><span className="sdl-progar__tahap-count">{d.tahap.length} tahap</span><small>Terakhir: {last.pekerjaanLabel}{lastDate && <span className="sdl-progar__num"> · {tgl(lastDate)}</span>}</small>{tahapRingkas(d)}</>
                  : <span className="sdl-progar__muted">{punyaTahap(d) ? 'Belum ada' : '–'}</span>}</td>
                {mode !== 'rancang' && <td><span className={`sdl-progar__badge ${st.cls}`}>{st.label}</span></td>}
                <td><div className="sdl-progar__row-actions">
                  <button type="button" className="btn" onClick={() => setDetailId(d.id)}>Buka</button>
                  {d.status === 'draft' && canSahkan && !mine && !tanpaSah(d) && <><button type="button" className="btn primary" disabled={!hasPdf(d)} title={hasPdf(d) ? undefined : (punyaTahap(d) ? 'Belum ada dokumen bertanda tangan di tahap pengesahan' : 'Belum ada PDF dokumen')} onClick={() => void sahkan(d)}>Sahkan</button>
                    <button type="button" className="btn sdl-progar__danger" onClick={() => tolak(d)}>Tolak</button></>}
                  {canManage && d.status === 'disahkan' && !d.digantikan && !d.final && <button type="button" className="btn primary" disabled={!semuaDiterima(d)} title={semuaDiterima(d) ? undefined : 'Semua tahap harus diterima Kasubbagren dulu'} onClick={() => void tandaiFinal(d, true)}>Tandai Final</button>}
                  {canManage && bisaSelesai(d) && <button type="button" className="btn primary" disabled={!siapSelesai(d)} title={siapSelesai(d) ? undefined : alasanBelumSelesai(d)} onClick={() => void tandaiFinal(d, true)}>Tandai Selesai</button>}
                  {(final || PINDAH_KE_REVISI.includes(d.jenis)) && d.status === 'disahkan' && !d.digantikan && canManage && !draftRevisi(d) && <button type="button" className="btn" onClick={() => revisi(d)}>Buat Revisi</button>}
                </div></td>
              </tr>
            })}</tbody>
          </table></div>
        </section>}

    {detailId && (docs ?? []).some(d => d.id === detailId) && (() => {
      const d = docs!.find(x => x.id === detailId)!
      const showExtras = mode !== 'rancang' && alurDokumen(d)
      return <DetailDialog key={d.id} tautan={tautanDipa(d)} doc={d} tanpaSah={tanpaSah(d)} showAnggaran={showExtras} onAnggaran={showExtras && canManage && !d.final && !d.digantikan ? () => ubahAnggaran(d) : undefined} katalog={katalog} blocked={Boolean(dialog || dokDialog || riwayat || preview)} statusOf={status} onClose={() => setDetailId(null)}
        showApprovalDetails={mode !== 'rancang'} signed={signedOf(d)} onOpenSumber={onOpenSumber} onUbahTahap={canManage && tahapTerbuka(d) ? t => ubahTahap(d, t) : undefined} tahapActions={t => canSahkan && tahapTerbukaRaw(d) && t.cekStatus === 'menunggu' ? (t.updatedBy === userId
          ? <span className="sdl-progar__muted">Diubah oleh Anda</span>
          : <span className="sdl-progar__cek-btns"><button type="button" className="sdl-progar__mini is-ok" onClick={() => void guard(() => cek(d, t, 'diterima'))}>Terima</button><button type="button" className="sdl-progar__mini" onClick={() => kembalikan(d, t)}>Kembalikan</button></span>) : null}
        extra={RINGKASAN_JENIS.includes(d.jenis) ? <RingkasanRealisasi docId={d.id} stamp={d.version} jenisLabel={labelJenis} />
          : REVISI_ANGGARAN.includes(d.jenis) ? <RevisiAnggaran doc={d} canEdit={canManage} jenisLabel={labelJenis} onChanged={() => { showToast('Daftar perubahan disimpan.', 'success'); void load() }} /> : null}
        lampiranDok={showExtras ? { canEdit: lampiranTerbuka(d), busy: uploading === `lamp:${d.id}`, onAdd: () => pickLampiran(d), onDelete: l => void hapusLampiran(d, l) } : undefined}
        onPreview={(url, name) => { if (/\.(xlsx|docx)$/i.test(name)) { const a = document.createElement('a'); a.href = url; a.download = name; a.click() } else setPreview({ url, name, mime: 'application/pdf' }) }} onRiwayat={(chainOf.get(d.id)?.length ?? 0) > 1 ? () => setRiwayat(chainOf.get(d.id)!) : undefined}
        actions={<>
          {canManage && tahapTerbuka(d) && punyaTahap(d) && <>
            <button type="button" className="btn" disabled={!semuaDiterima(d)} onClick={() => tambahTahap(d)}>＋ Tambah Tahap Pekerjaan</button>
            {!semuaDiterima(d) && <span className="sdl-progar__muted">Semua tahap sebelumnya harus diterima Kasubbagren sebelum menambah tahap.</span>}
          </>}
          {canManage && d.status === 'draft' && !punyaTahap(d) && <button type="button" className="btn" disabled={uploading === d.id} onClick={() => pick(d)}>{uploading === d.id ? 'Mengunggah…' : d.berkas ? 'Ganti PDF Dokumen' : 'Lampirkan PDF Dokumen'}</button>}
          {canManage && d.status === 'draft' && !d.final && <button type="button" className="btn" onClick={() => edit(d)}>Ubah Dokumen</button>}
          {d.status === 'draft' && canSahkan && d.createdBy !== userId && !tanpaSah(d) && <><button type="button" className="btn primary" disabled={!hasPdf(d)} title={hasPdf(d) ? undefined : (punyaTahap(d) ? 'Belum ada dokumen bertanda tangan di tahap pengesahan' : 'Belum ada PDF dokumen')} onClick={() => void sahkan(d)}>Sahkan</button>
            <button type="button" className="btn sdl-progar__danger" onClick={() => tolak(d)}>Tolak</button></>}
          {(final || PINDAH_KE_REVISI.includes(d.jenis)) && d.status === 'disahkan' && !d.digantikan && canManage && !draftRevisi(d) && <button type="button" className="btn" onClick={() => revisi(d)}>Buat Revisi</button>}
          {canManage && d.status === 'disahkan' && !d.digantikan && !d.final && <button type="button" className="btn primary" disabled={!semuaDiterima(d)} title={semuaDiterima(d) ? undefined : 'Semua tahap harus diterima Kasubbagren dulu'} onClick={() => void tandaiFinal(d, true)}>Tandai Final</button>}
          {canManage && bisaSelesai(d) && <button type="button" className="btn primary" disabled={!siapSelesai(d)} title={siapSelesai(d) ? undefined : alasanBelumSelesai(d)} onClick={() => void tandaiFinal(d, true)}>Tandai Selesai</button>}
          {canManage && tanpaSah(d) && d.final && !REVISI_ANGGARAN.includes(d.jenis) && <button type="button" className="btn" onClick={() => void tandaiFinal(d, false)}>{dalgar ? 'Buka Kembali' : 'Kembalikan ke Perancangan'}</button>}
          {canManage && d.status === 'disahkan' && !d.digantikan && d.final && <button type="button" className="btn" onClick={() => void tandaiFinal(d, false)}>{dalgar ? 'Batalkan Final' : 'Kembalikan ke Perancangan'}</button>}
        </>} />
    })()}
    {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
    {dokDialog && <DokumenDialog key={`${dokDialog.mode}:${dokDialog.tahapId ?? ''}`} mode={dokDialog.mode} kind={kind} tahun={dokDialog.doc?.tahun ?? (tahun === 'semua' ? thisYear : tahun)} doc={dokDialog.doc} tahapId={dokDialog.tahapId} katalog={katalog} jenisOptions={jenisOptions} api={api}
      onClose={() => setDokDialog(null)} onDone={(msg, ok) => { setDokDialog(null); showToast(msg, ok ? 'success' : 'error'); void load() }} />}
    {riwayat && <RiwayatDialog versions={riwayat} previewOpen={Boolean(preview)} onClose={() => setRiwayat(null)}
      onPreview={d => setPreview({ url: `${BASE}/dokumen/${d.id}/berkas`, name: d.berkas!.filename, mime: 'application/pdf' })} />}
    {preview && <LampiranPreviewR5F15 stored={preview} maxBytes={20 * 1024 * 1024} title={mode === 'laporan' ? 'Laporan' : mode === 'revisi' ? 'Revisi Anggaran' : final ? 'Dokumen Final' : 'Dokumen Perancangan'} note={final ? 'Dokumen yang berlaku.' : 'Periksa isi dokumen sebelum mengesahkan.'} onClose={() => setPreview(null)} />}
  </div>
}

/**
 * Riwayat versi satu dokumen: v1 (paling lama) sampai versi terbaru, masing-masing
 * dengan status, pengunggah, keputusan, dan PDF-nya. Baca saja -- aksi tetap di
 * baris daftar. PDF yang pernah DIGANTI saat draft tidak ada di sini: backend
 * R5H13 menimpanya (diperbaiki di R5H15).
 */
function RiwayatDialog({ versions, previewOpen, onClose, onPreview }: { versions: Doc[]; previewOpen: boolean; onClose: () => void; onPreview: (d: Doc) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !previewOpen && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [previewOpen, onClose])
  const latest = versions[versions.length - 1]
  const badge = (d: Doc) => d.digantikan ? { cls: 'is-kosong', label: 'Digantikan' } : d.status === 'disahkan' ? { cls: 'is-disetujui', label: 'Berlaku' } : d.status === 'ditolak' ? { cls: 'is-ditolak', label: 'Ditolak' } : { cls: 'is-draft', label: 'Draft' }
  return <div className="sdl-progar__shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <section className="sdl-progar__dialog sdl-progar__riwayat" role="dialog" aria-modal="true" aria-labelledby="sdl-riwayat-title">
      <header><span className="sdl-progar__eyebrow">RIWAYAT VERSI · {latest.jenisLabel.toUpperCase()} {latest.tahun}</span>
        <h2 id="sdl-riwayat-title">{latest.judul}</h2><p>{versions.length} versi, terbaru di atas.</p></header>
      <ol className="sdl-progar__versions">{[...versions].reverse().map(d => {
        const n = versions.indexOf(d) + 1; const b = badge(d)
        return <li key={d.id} className={d.digantikan ? 'is-old' : undefined}>
          <div className="sdl-progar__version-head"><strong>v{n}{n === 1 ? ' · Asli' : ` · Revisi ${n - 1}`}</strong><span className={`sdl-progar__badge ${b.cls}`}>{b.label}</span></div>
          <small>{[d.nomor, tgl(d.tanggal)].filter(Boolean).join(' · ') || 'Tanpa nomor'} · diunggah {d.createdByName}, {tgl(d.createdAt.slice(0, 10))}</small>
          {d.status === 'disahkan' && d.reviewedAt && <small>Disahkan {d.reviewedByName}, {tgl(d.reviewedAt.slice(0, 10))}</small>}
          {d.status === 'ditolak' && <small className="sdl-progar__rejected">Ditolak {d.reviewedByName}: “{d.reviewNote}”</small>}
          {d.keterangan && <small>Keterangan: {d.keterangan}</small>}
          {d.berkas ? <button type="button" className="sdl-progar__file" onClick={() => onPreview(d)} title={`Lihat ${d.berkas.filename}`}>👁 {d.berkas.filename}</button> : <small className="sdl-progar__muted">Belum ada PDF</small>}
        </li>
      })}</ol>
      <footer><button type="button" className="btn" autoFocus onClick={onClose}>Tutup</button></footer>
    </section>
  </div>
}

/**
 * Detail satu dokumen (2026-11-17): data dokumen, status, PDF utama, dan semua
 * tahap pekerjaan beserta isian dan lampirannya. Aksi (tambah tahap, ubah,
 * tandai final) dikirim pemanggil sesuai hak dan status. Esc menutup, kecuali
 * ada dialog lain di atasnya (`blocked`).
 */
/** Isian tahap dalam urutan field katalog; kunci yang tidak dikenal di belakang. */
function orderedIsian(t: Tahap, katalog: Katalog | null): [string, string][] {
  const order = katalog?.pekerjaan[t.pekerjaan]?.fields.map(f => f.key) ?? []
  const rank = (k: string) => { const i = order.indexOf(k); return i < 0 ? order.length : i }
  return Object.entries(t.isian).sort((a, b) => rank(a[0]) - rank(b[0]))
}

function DetailDialog({ doc, lampiranDok, tanpaSah, showApprovalDetails, showAnggaran, onAnggaran, katalog, blocked, statusOf, actions, extra, tautan, onClose, onPreview, onRiwayat, signed, tahapActions, onUbahTahap, onOpenSumber }: {
  doc: Doc; lampiranDok?: { canEdit: boolean; busy: boolean; onAdd: () => void; onDelete: (l: LampiranDok) => void }; tanpaSah: boolean; showAnggaran: boolean; onAnggaran?: () => void; katalog: Katalog | null; blocked: boolean; statusOf: (d: Doc) => { cls: string; label: string }; actions: ReactNode; extra?: ReactNode; tautan?: ReactNode
  showApprovalDetails: boolean; signed: { t: Tahap; b: Tahap['berkas'][number] }[]; tahapActions: (t: Tahap) => ReactNode; onUbahTahap?: (t: Tahap) => void; onOpenSumber?: (s: Sumber) => void
  onClose: () => void; onPreview: (url: string, name: string) => void; onRiwayat?: () => void
}) {
  // Register tahap (2026-11-17): satu baris per tahap; menekan pekerjaannya membuka
  // HALAMAN detail tahap di dialog yang sama (bukan baris yang melebar ke bawah).
  const [lihat, setLihat] = useState<string | null>(null)
  const [saring, setSaring] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || blocked || e.defaultPrevented) return
      e.preventDefault()
      if (lihat) setLihat(null); else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [blocked, onClose, lihat])
  const dialogRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { dialogRef.current?.scrollTo({ top: 0 }) }, [lihat])
  const st = statusOf(doc)
  const fieldLabel = (pekerjaan: string, key: string) => katalog?.pekerjaan[pekerjaan]?.fields.find(f => f.key === key)
  const jumlahPekerjaan = useMemo(() => {
    const m = new Map<string, [string, string, number]>()
    for (const t of doc.tahap) { const e = m.get(t.pekerjaan); if (e) e[2]++; else m.set(t.pekerjaan, [t.pekerjaan, t.pekerjaanLabel, 1]) }
    return [...m.values()]
  }, [doc.tahap])
  const belum = doc.tahap.filter(t => t.cekStatus !== 'diterima').length
  const shown = saring === '' ? doc.tahap : saring === 'belum' ? doc.tahap.filter(t => t.cekStatus !== 'diterima') : doc.tahap.filter(t => t.pekerjaan === saring)
  const badgeCek = (t: Tahap) => <span className={`sdl-progar__badge ${t.cekStatus === 'diterima' ? 'is-disetujui' : t.cekStatus === 'dikembalikan' ? 'is-ditolak' : 'is-draft'}`}>{cekLabel(t.cekStatus)}</span>
  const judulTahap = (t: Tahap) => { const u = ulangKe(doc.tahap, t); return `${t.pekerjaanLabel}${u.total > 1 ? ` ke-${u.ke}` : ''}` }

  // ---------- Halaman detail satu tahap ----------
  const tv = lihat ? doc.tahap.find(t => t.id === lihat) : undefined
  if (lihat && tv) {
    const nav = shown.includes(tv) ? shown : doc.tahap
    const i = nav.indexOf(tv); const prev = nav[i - 1]; const next = nav[i + 1]
    const slots = katalog?.pekerjaan[tv.pekerjaan]?.berkas ?? []
    const bySlot = [...slots.map(s => ({ s, files: tv.berkas.filter(b => b.slot === s.slot) })),
      ...[...new Set(tv.berkas.map(b => b.slot))].filter(x => !slots.some(s => s.slot === x)).map(x => ({ s: { slot: x, label: x } as { slot: string; label: string; utama?: boolean }, files: tv.berkas.filter(b => b.slot === x) }))]
    return <div className="sdl-progar__shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !blocked) onClose() }}>
      <div ref={dialogRef} className="sdl-progar__dialog sdl-progar__detail" role="dialog" aria-modal="true" aria-labelledby="sdl-tahap-title">
        <div className="sdl-progar__backbar">
          <button type="button" className="btn sdl-progar__back" onClick={() => setLihat(null)}>← Kembali</button>
          <span className="sdl-progar__muted sdl-progar__num">Tahap {doc.tahap.indexOf(tv) + 1} dari {doc.tahap.length}</span>
        </div>
        <header className="sdl-progar__tahap-head"><span className="sdl-progar__eyebrow">{doc.jenisLabel} · {doc.judul}</span>
          <h2 id="sdl-tahap-title">{judulTahap(tv)}</h2>
          <p>{badgeCek(tv)}<span className="sdl-progar__muted">Diperbarui {tv.updatedByName}, <span className="sdl-progar__num">{tgl(tv.updatedAt.slice(0, 10))}</span></span></p></header>
        {tv.cekStatus === 'dikembalikan' && tv.cekNote && <p className="sdl-progar__rejected">Dikembalikan {tv.cekByName}: “{tv.cekNote}”</p>}
        {tv.sumber && <p className="sdl-sumber-link"><span>Sumber: {SUMBER_LABEL[tv.sumber.jenis]}</span>
          {onOpenSumber ? <button type="button" className="sdl-progar__link" onClick={() => onOpenSumber(tv.sumber!)}>{tv.sumber.label}</button> : <strong>{tv.sumber.label}</strong>}
          <small className="sdl-progar__muted">PDF surat dibuka dari sumbernya.</small></p>}
        <section className="sdl-progar__detail-tahap" aria-label="Isian">
          <h3>Isian</h3>
          {Object.keys(tv.isian).length === 0 ? <p className="sdl-progar__muted">Belum ada isian.</p>
            : <dl className="sdl-progar__meta-list">{orderedIsian(tv, katalog).map(([k, v]) => { const f = fieldLabel(tv.pekerjaan, k); return <Fragment key={k}><dt>{f?.label ?? k}</dt><dd className={f?.type === 'date' || f?.type === 'number' ? 'sdl-progar__num' : 'sdl-progar__pre'}>{f?.type === 'date' ? tgl(v) : v}</dd></Fragment> })}</dl>}
        </section>
        <section className="sdl-progar__detail-tahap" aria-label="Lampiran">
          <h3>Lampiran <span className="sdl-progar__muted sdl-progar__num">({tv.berkas.length})</span></h3>
          <dl className="sdl-progar__meta-list">{bySlot.map(({ s, files }) => <Fragment key={s.slot}><dt>{s.label}{s.utama && <small className="sdl-progar__muted"> · bukti utama</small>}</dt>
            <dd>{files.length ? files.map(b => <button key={b.id} type="button" className="sdl-progar__file" title={`Lihat ${b.filename}`} onClick={() => onPreview(`${BASE}/dokumen/${doc.id}/tahap/${tv.id}/lampiran/${b.id}`, b.filename)}>👁 {b.filename}</button>)
              : <span className="sdl-progar__muted">{s.utama ? 'Belum dilampirkan' : '–'}</span>}</dd></Fragment>)}</dl>
        </section>
        <section className="sdl-progar__detail-tahap" aria-label="Pemeriksaan">
          <h3>Pemeriksaan Kasubbagren</h3>
          <p className="sdl-progar__cek-line">{badgeCek(tv)}{tv.cekByName && tv.cekStatus !== 'menunggu' && <span className="sdl-progar__muted">{tv.cekByName}, <span className="sdl-progar__num">{tgl(tv.cekAt?.slice(0, 10) ?? null)}</span></span>}{tahapActions(tv)}</p>
        </section>
        <footer className="sdl-progar__detail-actions">
          <span className="sdl-progar__footer-left sdl-progar__pager">
            <button type="button" className="btn" disabled={!prev} onClick={() => prev && setLihat(prev.id)} title={prev ? judulTahap(prev) : undefined}>‹ Sebelumnya</button>
            <button type="button" className="btn" disabled={!next} onClick={() => next && setLihat(next.id)} title={next ? judulTahap(next) : undefined}>Berikutnya ›</button>
          </span>
          {onUbahTahap && <button type="button" className="btn" onClick={() => onUbahTahap(tv)}>Ubah Tahap</button>}
        </footer>
      </div>
    </div>
  }

  // ---------- Halaman dokumen ----------
  return <div className="sdl-progar__shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !blocked) onClose() }}>
    <div ref={dialogRef} className="sdl-progar__dialog sdl-progar__detail" role="dialog" aria-modal="true" aria-labelledby="sdl-detail-title">
      <header><span className="sdl-progar__eyebrow">{doc.jenisLabel} · TA {doc.tahun}</span>
        <h2 id="sdl-detail-title">{doc.judul}</h2>
        <p><span className={`sdl-progar__badge ${st.cls}`}>{st.label}</span>{doc.penggantiDari && <span className="sdl-progar__tag">Revisi</span>}</p></header>
      <dl className="sdl-progar__meta-list">
        <dt>Nomor</dt><dd>{doc.nomor || '–'}</dd>
        <dt>Tanggal</dt><dd className="sdl-progar__num">{tgl(doc.tanggal) || '–'}</dd>
        <dt>Diunggah</dt><dd>{doc.createdByName}, <span className="sdl-progar__num">{tgl(doc.createdAt.slice(0, 10))}</span></dd>
        {doc.reviewedByName && (showApprovalDetails || doc.status === 'ditolak') && <><dt>{doc.status === 'ditolak' ? 'Ditolak' : 'Disahkan'}</dt><dd>{doc.reviewedByName}, <span className="sdl-progar__num">{tgl(doc.reviewedAt?.slice(0, 10) ?? null)}</span>{doc.reviewNote && ` — “${doc.reviewNote}”`}</dd></>}
        {doc.final && <><dt>{tanpaSah ? 'Selesai' : 'Final'}</dt><dd>{doc.finalByName}, <span className="sdl-progar__num">{tgl(doc.finalAt?.slice(0, 10) ?? null)}</span></dd></>}
        {showApprovalDetails && (tanpaSah ? <><dt>Pengesahan</dt><dd className="sdl-progar__muted">Tidak diperlukan — dokumen ditandai Selesai setelah semua tahap diterima Kasubbagren.</dd></> : <><dt>PDF dokumen</dt><dd>{doc.berkas && <button type="button" className="sdl-progar__file" onClick={() => onPreview(`${BASE}/dokumen/${doc.id}/berkas`, doc.berkas!.filename)}>👁 {doc.berkas.filename}</button>}
          {signed.map(({ t, b }) => <button key={b.id} type="button" className="sdl-progar__file" onClick={() => onPreview(`${BASE}/dokumen/${doc.id}/tahap/${t.id}/lampiran/${b.id}`, b.filename)}>👁 {b.filename}</button>)}
          {!doc.berkas && !signed.length && <span className="sdl-progar__muted">{(() => {
            // R5H25: arahkan ke tahap pengesahan yang masih aktif; bila semuanya nonaktif, unggah langsung ke dokumen.
            const sah = (katalog?.jenis[doc.jenis] ?? []).find(p => !tahapNonaktif(katalog, doc.jenis, p) && katalog?.pekerjaan[p]?.berkas.some(s => s.slot === 'dokumen_sah'))
            return sah ? `Belum ada — lampirkan “Dokumen yang sudah ditandatangani” di tahap ${katalog!.pekerjaan[sah].label}` : katalog?.jenis[doc.jenis]?.length ? 'Belum ada — unggah PDF bertanda tangan ke dokumen ini' : 'Belum ada'
          })()}</span>}</dd></>)}
        {doc.periode && <><dt>Periode</dt><dd>{periodeLabel(doc.periode)} {doc.tahun}</dd></>}
        {showAnggaran && <><dt>Anggaran (estimasi)</dt><dd className="sdl-progar__anggaran">
          <span>{doc.anggaran ? <strong className="sdl-progar__num">{rupiah(doc.anggaran)}</strong> : <span className="sdl-progar__muted">Belum diisi</span>}
            {onAnggaran && <button type="button" className="sdl-progar__mini" onClick={onAnggaran}>{doc.anggaran ? 'Ubah' : 'Isi'}</button>}</span>
          {doc.anggaran && doc.hibah && <small><span className="sdl-progar__tag">Dana hibah</span></small>}
          {doc.anggaran && doc.anggaranNote && <small>{doc.anggaranNote}</small>}
          {doc.anggaran && doc.anggaranByName && <small className="sdl-progar__muted">Diperbarui {doc.anggaranByName}, <span className="sdl-progar__num">{tgl(doc.anggaranAt?.slice(0, 10) ?? null)}</span></small>}</dd></>}
        {tautan}
        {doc.keterangan && <><dt>Keterangan</dt><dd>{doc.keterangan}</dd></>}
      </dl>
      {onRiwayat && <button type="button" className="sdl-progar__history" onClick={onRiwayat}>🕘 Lihat riwayat versi</button>}
      {lampiranDok && <section className="sdl-progar__detail-tahap" aria-label="Lampiran dokumen">
        <h3>Lampiran Dokumen <span className="sdl-progar__muted sdl-progar__num">({doc.lampiran.length})</span></h3>
        <p className="sdl-progar__muted sdl-progar__lampdok-note">{lampiranDok.canEdit ? 'Berkas pendukung di luar tahap pekerjaan: PDF, Excel (.xlsx), atau Word (.docx), maks 20 MB per berkas.' : doc.final ? 'Terkunci: dokumen sudah final.' : 'Berkas pendukung di luar tahap pekerjaan.'}</p>
        {doc.lampiran.length > 0 && <ul className="sdl-progar__lampdok">{doc.lampiran.map(l => <li key={l.id}>
          <span className={`sdl-progar__lampdok-jenis is-${l.jenis}`}>{l.jenis.toUpperCase()}</span>
          <span className="sdl-progar__lampdok-main">
            <button type="button" className="sdl-progar__file is-full" title={l.jenis === 'pdf' ? `Lihat ${l.filename}` : `Unduh ${l.filename}`} onClick={() => onPreview(`${BASE}/dokumen/${doc.id}/lampiran/${l.id}`, l.filename)}>{l.jenis === 'pdf' ? '👁' : '⬇'} {l.filename}</button>
            <small className="sdl-progar__muted">{l.uploadedByName}, <span className="sdl-progar__num">{tgl(l.uploadedAt.slice(0, 10))} · {ukuran(l.size)}</span></small>
          </span>
          {lampiranDok.canEdit && <button type="button" className="sdl-progar__mini" aria-label={`Hapus ${l.filename}`} onClick={() => lampiranDok.onDelete(l)}>Hapus</button>}
        </li>)}</ul>}
        {lampiranDok.canEdit ? <button type="button" className="btn" disabled={lampiranDok.busy} onClick={lampiranDok.onAdd}>{lampiranDok.busy ? 'Mengunggah…' : '＋ Tambah Lampiran'}</button>
          : doc.lampiran.length === 0 && <p className="sdl-progar__muted">Tidak ada lampiran dokumen.</p>}
      </section>}
      {extra}
      <section className="sdl-progar__detail-tahap" aria-label="Tahap pekerjaan">
        <h3>Tahap Pekerjaan</h3>
        {doc.tahap.length === 0 ? <p className="sdl-progar__muted">Belum ada tahap pekerjaan yang dicatat.</p>
          : <>
            {(jumlahPekerjaan.length > 1 || belum > 0) && doc.tahap.length > 3 && <div className="sdl-progar__filters" role="group" aria-label="Saring tahap">
              <button type="button" className={saring === '' ? 'is-on' : undefined} aria-pressed={saring === ''} onClick={() => setSaring('')}>Semua <span className="sdl-progar__num">{doc.tahap.length}</span></button>
              {belum > 0 && <button type="button" className={saring === 'belum' ? 'is-on' : undefined} aria-pressed={saring === 'belum'} onClick={() => setSaring('belum')}>Belum diterima <span className="sdl-progar__num">{belum}</span></button>}
              {jumlahPekerjaan.length > 1 && jumlahPekerjaan.map(([k, label, n]) => <button key={k} type="button" className={saring === k ? 'is-on' : undefined} aria-pressed={saring === k} onClick={() => setSaring(k)}>{label} <span className="sdl-progar__num">{n}</span></button>)}
            </div>}
            <div className="table-scroll"><table className="data-table sdl-progar__table sdl-progar__register">
            <thead><tr><th className="sdl-progar__num">No</th><th>Tanggal</th><th>Pekerjaan</th><th className="sdl-progar__ringkas">Ringkasan</th><th className="sdl-progar__col-lamp">Lampiran</th><th>Pemeriksaan</th><th scope="col">Aksi</th></tr></thead>
            <tbody>{shown.map(t => {
              const no = doc.tahap.indexOf(t) + 1; const u = ulangKe(doc.tahap, t); const tg = tanggalTahap(t, katalog)
              return <tr key={t.id} className="sdl-progar__row-link" onClick={e => { if (!(e.target as HTMLElement).closest('button')) setLihat(t.id) }}>
              <td className="sdl-progar__num">{no}</td>
              <td className="sdl-progar__num sdl-progar__nowrap">{tg ? tgl(tg) : <span className="sdl-progar__muted">–</span>}</td>
              <td><button type="button" className="sdl-progar__open" onClick={() => setLihat(t.id)} title="Buka detail tahap">{t.pekerjaanLabel}</button>{u.total > 1 && <span className="sdl-progar__ke"> ke-{u.ke}</span>}{tahapNonaktif(katalog, doc.jenis, t.pekerjaan) && <span className="sdl-progar__tag sdl-progar__tag-off" title="Tahap ini sudah tidak ditawarkan untuk dokumen baru. Data yang tercatat tetap bisa diubah.">nonaktif di Master Data</span>}</td>
              <td className="sdl-progar__ringkas">{t.sumber && <span className="sdl-progar__tag sdl-sumber-tag" title={t.sumber.label}>🔗 {SUMBER_LABEL[t.sumber.jenis]}</span>}{ringkasTahap(t, katalog) || <span className="sdl-progar__muted">–</span>}</td>
              <td className="sdl-progar__num sdl-progar__col-lamp">{t.berkas.length ? `📎 ${t.berkas.length}` : <span className="sdl-progar__muted">–</span>}</td>
              <td>{badgeCek(t)}
                {t.cekStatus === 'dikembalikan' && t.cekNote && <small className="sdl-progar__rejected">“{t.cekNote}”</small>}
                {tahapActions(t)}</td>
              <td><div className="sdl-progar__reg-actions">{onUbahTahap && <button type="button" className="sdl-progar__mini" onClick={() => onUbahTahap(t)}>Ubah</button>}</div></td>
            </tr>})}</tbody>
          </table></div>
          {shown.length === 0 && <p className="sdl-progar__muted">Tidak ada tahap untuk saringan ini.</p>}
          </>}
      </section>
      <footer className="sdl-progar__detail-actions">{actions}<button type="button" className="btn" onClick={onClose}>Tutup</button></footer>
    </div>
  </div>
}
