import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { rupiah } from './ProgarR5H11'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './MyinterestR5H20.css'

/**
 * R5H20 (2026-11-18): data RESMI myinterest "Realisasi Belanja per Jenis Kegiatan".
 *
 *  - Menu DALGAR "Data myinterest": Operator mengimpor file Excel unduhan
 *    myinterest (langsung berlaku). Setiap impor = potret per tanggal data;
 *    impor ulang tanggal yang sama menggantikan potret lama. LRA di menu Laporan
 *    membaca potret ini (keputusan pemilik 2026-11-18, kembali ke bentuk ini).
 *  - LraChart: grafik serapan per kegiatan + realisasi per bulan, dipakai di
 *    halaman ini, Beranda Subbagren, dan Dashboard pimpinan.
 */

type Impor = { id: string; tanggalAwal: string; tanggalAkhir: string; waktuUnduh: string; filename: string; totalPagu: string; totalRealisasi: string; importedAt: string; importedByName: string }
type Kegiatan = { kode: string; nama: string; pagu: string; realisasi: string; jenis: Record<string, { pagu: string; realisasi: string }> }
type Bulanan = { bulan: number; tanggalAkhir: string; pagu: string; kumulatif: string; bulanIni: string | null }
type Data = { tahun: number; impor: Impor[]; bulanan: Bulanan[]
  terbaru: null | { imporId: string; tanggalAkhir: string; waktuUnduh: string; totalPagu: string; totalRealisasi: string; kegiatan: Kegiatan[]; perJenis: Record<string, { pagu: string; realisasi: string }> } }

const BASE = '/api/v1/subbagren/progar'
const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang mengimpor data myinterest.',
  bukan_xlsx: 'Berkas bukan Excel (.xlsx) yang valid.',
  format_tidak_dikenali: 'Format tidak dikenali. Gunakan unduhan myinterest "Realisasi Belanja per Jenis Kegiatan" tanpa diubah.',
  tanggal_tidak_ditemukan: 'Baris "Tanggal : … s.d. …" tidak ditemukan di berkas.',
  rentang_tidak_didukung: 'Rentang tanggal harus mulai 1 Januari (angka kumulatif). Unduh ulang dari myinterest dengan rentang 1 Januari s.d. tanggal data.',
  total_tidak_cocok: 'Angka di berkas tidak cocok dengan kolom Total/GRAND TOTAL-nya. Unduh ulang dari myinterest.',
  nilai_tidak_valid: 'Ada angka yang tidak terbaca di berkas.',
  kegiatan_tidak_valid: 'Ada baris kegiatan tanpa kode/nama yang sah.',
  kegiatan_ganda: 'Satu kode kegiatan muncul dua kali.',
  invalid_file_type: 'Nama berkas harus berakhiran .xlsx (tanpa karakter khusus).',
  file_too_large: 'Ukuran berkas maksimal 2 MB.',
  one_file_required: 'Pilih satu berkas.',
  not_found: 'Data sudah tidak ada. Muat ulang halaman.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
async function call<T>(path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET', body?: FormData): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') {
    const c = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!c.ok) throw Error('Sesi keamanan tidak tersedia. Silakan login kembali.')
    headers['X-CSRF-Token'] = ((await c.json()) as { csrfToken: string }).csrfToken
  }
  const r = await fetch(`${BASE}${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(body ? { body } : {}) })
  if (!r.ok) {
    const e: { error?: string } = await r.json().catch(() => ({}))
    const err = Error(ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}).`) as Error & { status?: number }
    err.status = r.status
    throw err
  }
  return r.json() as Promise<T>
}

const BULAN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const JENIS_LABEL: Record<string, string> = { pegawai: 'Pegawai', barang: 'Barang', modal: 'Modal', bunga: 'Beban Bunga', subsidi: 'Subsidi', hibah: 'Hibah', bansos: 'Bansos', lain: 'Lain-lain', transfer: 'Transfer' }
const big = (s: string | null | undefined) => BigInt(s || '0')
const pct = (a: string, b: string) => { const B = big(b); return B > 0n ? Number((big(a) * 10000n) / B) / 100 : 0 }
const pctText = (n: number) => `${n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const tgl = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
/** "16-11-2026 12:34:02 WIB (+0700 GMT)" -> "16 Nov 2026 pukul 12.34 WIB" (format lain dikembalikan apa adanya). */
export function fmtUnduh(s: string): string {
  const m = s.match(/^(?:(\d{2})-(\d{2})-(\d{4})|(\d{4})-(\d{2})-(\d{2}))\s+(\d{2}):(\d{2})(?::\d{2})?(?:\s+([A-Z]{3,4}))?/)
  if (!m) return s
  const iso = m[1] ? `${m[3]}-${m[2]}-${m[1]}` : `${m[4]}-${m[5]}-${m[6]}`
  return `${tgl(iso)} pukul ${m[7]}.${m[8]}${m[9] ? ` ${m[9]}` : ''}`
}
/** Rupiah ringkas untuk label grafik: 1,40 T / 383,35 M / 185,5 jt. */
export function ringkas(digits: string): string {
  const n = Number(big(digits))
  const f = (v: number, d: number) => v.toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })
  if (n >= 1e12) return `Rp ${f(n / 1e12, 2)} T`
  if (n >= 1e9) return `Rp ${f(n / 1e9, 2)} M`
  if (n >= 1e6) return `Rp ${f(n / 1e6, 1)} jt`
  return rupiah(digits)
}

/**
 * Grafik LRA dari data myinterest. `variant`:
 *   'page' (menu Data myinterest), 'dash' (Beranda Subbagren), 'exec' (Dashboard pimpinan).
 * Di dashboard, akun tanpa akses atau tanpa data membuat komponen ini tidak tampil sama sekali
 * kecuali `showEmpty`.
 */
export function LraChart({ tahun, variant = 'page', data: given, onOpen, wrap }: { tahun?: number; variant?: 'page' | 'dash' | 'exec'; data?: Data | null; onOpen?: () => void; wrap?: (chart: ReactNode) => ReactNode }) {
  const [own, setOwn] = useState<Data | null>(null)
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (given !== undefined) return
    let live = true
    call<Data>(`/myinterest?tahun=${tahun ?? 'terbaru'}`).then(d => { if (live) setOwn(d) }).catch(() => { if (live) setHidden(true) })
    return () => { live = false }
  }, [tahun, given])
  const data = given !== undefined ? given : own
  if (hidden || (variant !== 'page' && (!data || !data.terbaru))) return null
  if (!data) return <p className="sdl-progar__muted">Memuat…</p>
  const t = data.terbaru
  if (!t) return <div className="sdl-lra sdl-lra--empty"><strong>Belum ada data myinterest TA {data.tahun}</strong><p>Impor file "Realisasi Belanja per Jenis Kegiatan" dari myinterest untuk menampilkan LRA.</p></div>
  const serapan = pct(t.totalRealisasi, t.totalPagu)
  const bln = data.bulanan.filter(b => b.bulanIni !== null)
  const maxBulan = bln.reduce((m, b) => (big(b.bulanIni) > m ? big(b.bulanIni) : m), 0n)
  const chart = <div className={`sdl-lra sdl-lra--${variant}`}>
    <div className="sdl-lra__head">
      <div><span className="sdl-lra__eyebrow">LRA · REALISASI BELANJA TA {data.tahun}</span>
        <p className="sdl-lra__src">Data myinterest per <strong>{tgl(t.tanggalAkhir)}</strong>{t.waktuUnduh ? <> · diunduh {fmtUnduh(t.waktuUnduh)}</> : ''}</p></div>
      {onOpen && <button type="button" className="sdl-lra__link" onClick={onOpen}>Buka data ↗</button>}
    </div>
    <div className="sdl-lra__hero">
      <strong className="sdl-lra__num">{pctText(serapan)}</strong>
      <span>serapan · <b>{ringkas(t.totalRealisasi)}</b> dari pagu {ringkas(t.totalPagu)}</span>
      <span className="sdl-lra__muted">sisa {ringkas((big(t.totalPagu) - big(t.totalRealisasi)).toString())}</span>
    </div>
    <ul className="sdl-lra__bars" aria-label="Serapan per kegiatan">
      {t.kegiatan.map(k => { const p = pct(k.realisasi, k.pagu); return <li key={k.kode} title={`${k.kode} ${k.nama}\nRealisasi ${rupiah(k.realisasi)} dari pagu ${rupiah(k.pagu)} (${pctText(p)})`}>
        <span className="sdl-lra__label"><b>{k.kode}</b> {k.nama}</span>
        <span className="sdl-lra__track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={`Serapan ${k.nama}`}><span style={{ width: `${Math.min(100, p)}%` }} /></span>
        <span className="sdl-lra__val"><b>{pctText(p)}</b><small>{ringkas(k.realisasi)} / {ringkas(k.pagu)}</small></span>
      </li> })}
    </ul>
    {bln.length === 1 && variant !== 'dash' && <p className="sdl-lra__one">Realisasi {BULAN3[bln[0].bulan - 1]}: <b>{ringkas(bln[0].bulanIni ?? '0')}</b> <span className="sdl-lra__muted">· dari selisih potret akhir bulan. Grafik per bulan tampil setelah ada dua bulan atau lebih.</span></p>}
    {bln.length > 1 && variant !== 'dash' && <div className="sdl-lra__months">
      <span className="sdl-lra__eyebrow">REALISASI PER BULAN</span>
      <div className="sdl-lra__cols" role="img" aria-label="Realisasi per bulan dari selisih potret myinterest">
        {bln.map(b => <div key={b.bulan} className="sdl-lra__col" title={`${BULAN3[b.bulan - 1]}: ${rupiah(b.bulanIni ?? '0')} (kumulatif ${rupiah(b.kumulatif)})`}>
          <small>{ringkas(b.bulanIni ?? '0')}</small>
          <span className="sdl-lra__slot"><span style={{ height: `${maxBulan > 0n ? Math.max(3, Number((big(b.bulanIni) * 1000n) / maxBulan) / 10) : 0}%` }} /></span>
          <b>{BULAN3[b.bulan - 1]}</b></div>)}
      </div>
      {data.bulanan.length > bln.length && <p className="sdl-lra__muted">Bulan tanpa potret bulan sebelumnya tidak bisa dihitung selisihnya.</p>}
    </div>}
  </div>
  return wrap ? <>{wrap(chart)}</> : chart
}

/** Menu DALGAR "Data myinterest". */
export default function MyinterestR5H20({ onOpenLaporan }: { onOpenLaporan?: () => void }) {
  const [canImport, setCanImport] = useState(false)
  useEffect(() => { call<{ canRecordRealisasi: boolean }>('/capabilities').then(c => setCanImport(Boolean(c.canRecordRealisasi))).catch(() => setCanImport(false)) }, [])
  const thisYear = new Date().getFullYear()
  const [tahun, setTahun] = useState<number | null>(null)
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const load = useCallback(async (t: number | null) => {
    setError('')
    try { const d = await call<Data>(`/myinterest?tahun=${t ?? 'terbaru'}`); setData(d); if (t === null) setTahun(d.tahun) } catch (e) { setError(e instanceof Error ? e.message : 'Data tidak dapat dimuat.') }
  }, [])
  useEffect(() => { void load(null) }, [load])
  async function onFile(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = ''
    if (!file) return
    if (file.size > 2 * 1024 * 1024) { showToast(ERRORS.file_too_large, 'error'); return }
    const form = new FormData(); form.append('file', file)
    setBusy(true)
    try {
      const r = await call<{ tahun: number; tanggalAkhir: string; kegiatan: number; totalRealisasi: string; menggantikan: boolean }>('/myinterest', 'POST', form)
      showToast(`Data myinterest s.d. ${tgl(r.tanggalAkhir)} diimpor: ${r.kegiatan} kegiatan, realisasi ${rupiah(r.totalRealisasi)}${r.menggantikan ? ' (menggantikan impor tanggal yang sama)' : ''}.`, 'success')
      setTahun(r.tahun); await load(r.tahun)
    } catch (e) { showToast(e instanceof Error ? e.message : 'Impor gagal.', 'error') } finally { setBusy(false) }
  }
  async function hapus(i: Impor) {
    if (!await confirmDialog(`Hapus data myinterest s.d. ${tgl(i.tanggalAkhir)} (${i.filename})? LRA dan dashboard memakai potret lain yang tersisa.`, { confirmLabel: 'Hapus' })) return
    try { await call(`/myinterest/${i.id}`, 'DELETE'); showToast('Data impor dihapus.', 'success'); await load(tahun) } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal.', 'error') }
  }
  const years = [...new Set([thisYear - 1, thisYear, thisYear + 1, ...(tahun ? [tahun] : [])])].sort((a, b) => b - a)
  const t = data?.terbaru
  return <div className="sdl-progar">
    <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e => void onFile(e.target.files?.[0])} />
    <div className="sdl-progar__toolbar">
      <label className="sdl-progar__year">Tahun Anggaran
        <select value={tahun ?? ''} onChange={e => { const v = Number(e.target.value); setTahun(v); void load(v) }}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select></label>
      <span className="sdl-progar__grow" />
      <button type="button" className="btn" onClick={() => void load(tahun)}>Muat ulang</button>
      {canImport && <button type="button" className="btn primary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Mengimpor…' : '⤒ Impor file myinterest'}</button>}
    </div>
    <p className="sdl-progar__hint">Unduh <strong>Realisasi Belanja per Jenis Kegiatan</strong> dari myinterest dengan rentang <strong>1 Januari s.d. akhir bulan</strong>, lalu impor di sini setiap awal bulan. Angka ini menjadi acuan resmi LRA dan dashboard; realisasi per bulan dihitung dari selisih potret akhir bulan.{onOpenLaporan && <> <button type="button" className="sdl-progar__link" onClick={onOpenLaporan}>Buka menu Laporan →</button></>}</p>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <section className="panel sdl-progar__program"><LraChart variant="page" data={data} /></section>
    {t && <section className="panel sdl-progar__program" aria-label="Rincian per jenis belanja">
      <h3 className="sdl-lra__h3">Rincian per kegiatan dan jenis belanja · s.d. {tgl(t.tanggalAkhir)}</h3>
      <div className="table-scroll"><table className="data-table sdl-progar__table sdl-progar__register">
        <thead><tr><th>Kegiatan</th><th>Jenis belanja</th><th className="is-num">Pagu</th><th className="is-num">Realisasi</th><th className="is-num">%</th><th className="is-num">Sisa</th></tr></thead>
        <tbody>{t.kegiatan.flatMap(k => Object.entries(k.jenis).map(([j, v], i) => <tr key={`${k.kode}-${j}`}>
          {i === 0 && <td rowSpan={Object.keys(k.jenis).length}><strong>{k.kode}</strong><small>{k.nama}</small></td>}
          <td>{JENIS_LABEL[j] ?? j}</td><td className="is-num">{rupiah(v.pagu)}</td><td className="is-num">{rupiah(v.realisasi)}</td>
          <td className="is-num">{pctText(pct(v.realisasi, v.pagu))}</td><td className="is-num">{rupiah((big(v.pagu) - big(v.realisasi)).toString())}</td></tr>))}</tbody>
        <tfoot><tr><th colSpan={2}>Jumlah</th><th className="is-num">{rupiah(t.totalPagu)}</th><th className="is-num">{rupiah(t.totalRealisasi)}</th><th className="is-num">{pctText(pct(t.totalRealisasi, t.totalPagu))}</th><th className="is-num">{rupiah((big(t.totalPagu) - big(t.totalRealisasi)).toString())}</th></tr></tfoot>
      </table></div>
    </section>}
    {data && data.impor.length > 0 && <section className="panel sdl-progar__program" aria-label="Riwayat impor">
      <h3 className="sdl-lra__h3">Riwayat impor TA {data.tahun}</h3>
      <div className="table-scroll"><table className="data-table sdl-progar__table sdl-progar__register">
        <thead><tr><th>Data s.d.</th><th>Berkas</th><th className="is-num">Realisasi kumulatif</th><th>Diimpor</th>{canImport && <th><span className="sdl-progar__sr">Aksi</span></th>}</tr></thead>
        <tbody>{data.impor.map(i => <tr key={i.id}><td className="sdl-progar__nowrap"><strong>{tgl(i.tanggalAkhir)}</strong></td>
          <td>{i.filename}{i.waktuUnduh && <small className="sdl-progar__muted">diunduh {fmtUnduh(i.waktuUnduh)}</small>}</td>
          <td className="is-num">{rupiah(i.totalRealisasi)}</td><td>{i.importedByName}<small className="sdl-progar__muted">{tgl(i.importedAt)}</small></td>
          {canImport && <td><button type="button" className="sdl-progar__mini" onClick={() => void hapus(i)}>Hapus</button></td>}</tr>)}</tbody>
      </table></div>
    </section>}
  </div>
}
