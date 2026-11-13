import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BudgetR4A3 from './BudgetR4A3'
import { FormDialog, rupiah, type Dialog } from './ProgarR5H11'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'

/**
 * R5H12: Realisasi Anggaran per kegiatan, memotong Pagu Anggaran (R5H11).
 *
 * Alur: Operator mencatat realisasi pada kegiatan yang pagunya DISETUJUI,
 * mengunggah satu bukti bayar (PDF/JPG/PNG <= 5 MB, disimpan terenkripsi), lalu
 * Kasubbagren memverifikasi atau menolak. Hanya realisasi terverifikasi yang
 * mengurangi sisa pagu; server menolak verifikasi yang melampaui pagu.
 *
 * LRA lama (pagu berbasis Usulan, R4A3) tetap bisa dibaca lewat tombol di
 * bawah, tanpa formulir input.
 */

type Bukti = { filename: string; mimeType: string; size: number }
type Real = { id: string; tanggal: string; uraian: string; nomorBukti: string; jumlah: string; status: 'draft' | 'terverifikasi' | 'ditolak'; version: number; createdBy: string; createdByName: string; createdAt: string; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string; bukti: Bukti | null }
type Item = { paguId: string; pagu: string; terverifikasi: string; menunggu: string; sisa: string; program: { kode: string; nama: string }; kegiatan: { id: string; kode: string; nama: string }; realisasi: Real[] }
type Data = { tahun: number; items: Item[]; totals: { pagu: string; terverifikasi: string; menunggu: string; sisa: string } }
type Caps = { canRead: boolean; canRecordRealisasi: boolean; canVerifyRealisasi: boolean }

const BASE = '/api/v1/subbagren/progar'
const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak dapat diproses.',
  tahun_tidak_cocok: 'Tanggal realisasi harus berada di tahun anggaran pagunya.',
  melebihi_sisa_pagu: 'Jumlah melebihi sisa pagu kegiatan ini.',
  pagu_not_approved: 'Pagu kegiatan ini belum disetujui.',
  realisasi_not_draft: 'Realisasi ini sudah diputuskan dan tidak dapat diubah lagi.',
  version_conflict: 'Data sudah diubah (mungkin bukti baru diunggah). Muat ulang lalu coba lagi.',
  bukti_required: 'Unggah bukti bayar terlebih dahulu sebelum diverifikasi.',
  self_review_forbidden: 'Realisasi yang Anda catat sendiri harus diverifikasi oleh orang lain.',
  invalid_file_type: 'Bukti harus berupa PDF, JPG, atau PNG yang valid.',
  file_too_large: 'Ukuran bukti maksimal 5 MB.',
  one_file_required: 'Pilih satu berkas bukti.',
  evidence_encryption_unavailable: 'Kunci enkripsi bukti belum dikonfigurasi di server. Hubungi administrator.',
  evidence_integrity_failure: 'Bukti gagal diperiksa keutuhannya. Unggah ulang bukti.',
  not_found: 'Data sudah tidak ada. Muat ulang halaman.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}

async function csrf(): Promise<string> {
  const c = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
  if (!c.ok) throw Error('Sesi keamanan tidak tersedia. Silakan login kembali.')
  return ((await c.json()) as { csrfToken: string }).csrfToken
}
async function api<T>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown | FormData): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['X-CSRF-Token'] = await csrf()
  const isForm = body instanceof FormData
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json'
  const r = await fetch(`${BASE}${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(body !== undefined ? { body: isForm ? body : JSON.stringify(body) } : {}) })
  if (!r.ok) {
    const e: { error?: string } = await r.json().catch(() => ({}))
    if (r.status === 404 && !e.error) throw Error('Layanan Realisasi belum tersedia di server ini.')
    throw Error(ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}).`)
  }
  return r.json() as Promise<T>
}

const STATUS: Record<Real['status'], { label: string; cls: string }> = {
  draft: { label: 'Menunggu verifikasi', cls: 'is-draft' },
  terverifikasi: { label: 'Terverifikasi', cls: 'is-disetujui' },
  ditolak: { label: 'Ditolak', cls: 'is-ditolak' },
}
const tanggalID = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
const persen = (a: string, b: string) => { const B = BigInt(b || '0'); return B > 0n ? Number((BigInt(a) * 1000n) / B) / 10 : 0 }

const fields = (year: number): Dialog['fields'] => [
  { key: 'tanggal', label: 'Tanggal Transaksi', type: 'date', required: true, max: 10, hint: `Harus di tahun anggaran ${year}.` },
  { key: 'jumlah', label: 'Jumlah Realisasi (Rp)', type: 'rupiah', required: true, max: 16 },
  { key: 'nomorBukti', label: 'Nomor Bukti (SPM / SP2D / kuitansi)', required: true, max: 120, placeholder: 'mis. SPM-001/2026' },
  { key: 'uraian', label: 'Uraian', required: true, max: 240, placeholder: 'mis. Belanja ATK triwulan I' },
]

export default function RealisasiR5H12({ userId, onOpenPagu }: { userId: string; onOpenPagu?: () => void }) {
  const thisYear = new Date().getFullYear()
  const [tahun, setTahun] = useState(thisYear)
  const [data, setData] = useState<Data | null>(null)
  const [caps, setCaps] = useState<Caps | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [legacy, setLegacy] = useState(false)
  const [uploading, setUploading] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const uploadTarget = useRef<Real | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const c = caps ?? await api<Caps>('/capabilities')
      setCaps(c)
      if (c.canRead) setData(await api<Data>(`/realisasi?tahun=${tahun}`))
    } catch (e) { setError(e instanceof Error ? e.message : 'Data tidak dapat dimuat.') } finally { setLoading(false) }
  }, [tahun]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  const years = useMemo(() => [thisYear - 1, thisYear, thisYear + 1, thisYear + 2], [thisYear])
  const canRecord = Boolean(caps?.canRecordRealisasi)
  const canVerify = Boolean(caps?.canVerifyRealisasi)
  const run = async (fn: () => Promise<unknown>, ok: string) => { await fn(); showToast(ok, 'success'); await load() }
  const guard = async (fn: () => Promise<void>) => { try { await fn() } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal.', 'error') } }

  const record = (it: Item) => setDialog({
    title: 'Catat Realisasi', eyebrow: `REALISASI ${tahun}`, context: `${it.kegiatan.kode} — ${it.kegiatan.nama} · sisa ${rupiah(it.sisa)}`,
    fields: fields(tahun), values: { tanggal: '', jumlah: '', nomorBukti: '', uraian: '' }, submitLabel: 'Simpan Realisasi',
    onSubmit: v => run(() => api('/realisasi', 'POST', { paguId: it.paguId, ...v }), 'Realisasi dicatat. Unggah bukti bayarnya agar bisa diverifikasi.'),
  })
  const edit = (it: Item, r: Real) => setDialog({
    title: 'Ubah Realisasi', eyebrow: `REALISASI ${tahun}`, context: `${it.kegiatan.kode} — ${it.kegiatan.nama}`,
    fields: fields(tahun), values: { tanggal: r.tanggal, jumlah: r.jumlah, nomorBukti: r.nomorBukti, uraian: r.uraian }, submitLabel: 'Simpan Perubahan',
    onSubmit: v => run(() => api(`/realisasi/${r.id}`, 'PUT', { ...v, version: r.version }), 'Realisasi diperbarui.'),
  })
  const reject = (it: Item, r: Real) => setDialog({
    title: 'Tolak Realisasi', eyebrow: 'VERIFIKASI REALISASI', danger: true, context: `${it.kegiatan.kode} · ${r.nomorBukti} · ${rupiah(r.jumlah)}`,
    fields: [{ key: 'catatan', label: 'Alasan penolakan', type: 'textarea', required: true, max: 500, hint: 'Minimal 8 karakter. Akan dibaca oleh pencatat.' }],
    values: { catatan: '' }, submitLabel: 'Tolak Realisasi',
    onSubmit: v => run(() => api(`/realisasi/${r.id}/review`, 'POST', { keputusan: 'ditolak', catatan: v.catatan, version: r.version }), 'Realisasi ditolak.'),
  })
  async function verify(it: Item, r: Real) {
    if (!await confirmDialog(`Verifikasi realisasi ${rupiah(r.jumlah)} (${r.nomorBukti}) untuk kegiatan ${it.kegiatan.kode}? Pastikan bukti bayar sudah diperiksa.`, { confirmLabel: 'Verifikasi' })) return
    await guard(() => run(() => api(`/realisasi/${r.id}/review`, 'POST', { keputusan: 'terverifikasi', catatan: '', version: r.version }), 'Realisasi terverifikasi.'))
  }
  function pickBukti(r: Real) { uploadTarget.current = r; fileRef.current?.click() }
  async function onFile(file: File | undefined) {
    const r = uploadTarget.current
    if (fileRef.current) fileRef.current.value = ''
    if (!file || !r) return
    if (file.size > 5 * 1024 * 1024) { showToast(ERRORS.file_too_large, 'error'); return }
    const form = new FormData(); form.append('file', file)
    setUploading(r.id)
    await guard(() => run(() => api(`/realisasi/${r.id}/bukti`, 'POST', form), 'Bukti bayar diunggah.'))
    setUploading('')
  }

  if (caps && !caps.canRead) return <div className="sdl-progar"><div className="panel sdl-progar__empty"><strong>Tidak ada akses</strong><p>Akun ini belum diberi kewenangan membaca anggaran Subbagren.</p></div></div>

  const t = data?.totals
  return <div className="sdl-progar">
    <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" hidden onChange={e => void onFile(e.target.files?.[0])} />
    <div className="sdl-progar__toolbar">
      <label className="sdl-progar__year">Tahun Anggaran
        <select value={tahun} onChange={e => setTahun(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
      </label>
      <span className="sdl-progar__grow" />
      <button type="button" className="btn" onClick={() => void load()} disabled={loading}>Muat ulang</button>
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}

    {t && <div className="sdl-progar__stats sdl-progar__stats--4" aria-label="Ringkasan realisasi">
      <div><span>Pagu disetujui</span><strong>{rupiah(t.pagu)}</strong></div>
      <div><span>Realisasi terverifikasi</span><strong>{rupiah(t.terverifikasi)}</strong><small>serapan {persen(t.terverifikasi, t.pagu).toLocaleString('id-ID')}%</small></div>
      <div><span>Sisa pagu</span><strong>{rupiah(t.sisa)}</strong></div>
      <div><span>Menunggu verifikasi</span><strong>{rupiah(t.menunggu)}</strong></div>
    </div>}

    {loading && !data ? <div className="panel sdl-progar__empty"><p>Memuat…</p></div>
      : data && data.items.length === 0 ? <div className="panel sdl-progar__empty">
          <strong>Belum ada pagu yang disetujui untuk tahun {tahun}</strong>
          <p>Realisasi dicatat pada kegiatan yang pagunya sudah disetujui Kasubbagren di menu Pagu Anggaran.</p>
          {onOpenPagu && <button type="button" className="btn primary" onClick={onOpenPagu}>Buka Pagu Anggaran</button>}
        </div>
      : data?.items.map(it => {
          const pct = persen(it.terverifikasi, it.pagu)
          return <section key={it.paguId} className="panel sdl-progar__program" aria-label={`Realisasi kegiatan ${it.kegiatan.kode}`}>
            <header className="sdl-progar__program-head">
              <div>
                <span className="sdl-progar__code">{it.program.kode}</span> <span className="sdl-progar__code">{it.kegiatan.kode}</span>
                <h3>{it.kegiatan.nama}</h3>
                <p>{it.program.nama}</p>
              </div>
              <div className="sdl-progar__program-meta">
                <span>Pagu {rupiah(it.pagu)}</span>
                <strong>{rupiah(it.sisa)}</strong>
                <small>sisa pagu</small>
              </div>
              <div className="sdl-progar__meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Serapan terverifikasi">
                <span style={{ width: `${Math.min(100, pct)}%` }} />
                <em>Terserap {rupiah(it.terverifikasi)} · {pct.toLocaleString('id-ID')}%{it.menunggu !== '0' ? ` · menunggu ${rupiah(it.menunggu)}` : ''}</em>
              </div>
              {canRecord && <div className="sdl-progar__actions"><button type="button" className="btn primary" disabled={it.sisa === '0'} title={it.sisa === '0' ? 'Pagu sudah terserap penuh' : undefined} onClick={() => record(it)}>＋ Catat Realisasi</button></div>}
            </header>
            {it.realisasi.length === 0 ? <p className="sdl-progar__hint">Belum ada realisasi untuk kegiatan ini.</p>
              : <div className="table-scroll"><table className="data-table sdl-progar__table">
                <thead><tr><th>Tanggal</th><th>Uraian</th><th className="is-num">Jumlah</th><th>Bukti</th><th>Status</th>{(canRecord || canVerify) && <th><span className="sdl-progar__sr">Aksi</span></th>}</tr></thead>
                <tbody>{it.realisasi.map(r => {
                  const mine = r.createdBy === userId
                  return <tr key={r.id}>
                    <td className="sdl-progar__nowrap">{tanggalID(r.tanggal)}</td>
                    <td><strong>{r.uraian}</strong><small>{r.nomorBukti} · dicatat {r.createdByName}</small>
                      {r.status === 'ditolak' && <small className="sdl-progar__rejected">Ditolak {r.reviewedByName}: “{r.reviewNote}”</small>}</td>
                    <td className="is-num">{rupiah(r.jumlah)}</td>
                    <td>{r.bukti
                      ? <a className="sdl-progar__file" href={`${BASE}/realisasi/${r.id}/bukti`} download={r.bukti.filename} title={`${r.bukti.filename} · ${Math.ceil(r.bukti.size / 1024)} KB`}>📎 {r.bukti.filename}</a>
                      : <span className="sdl-progar__muted">Belum ada</span>}</td>
                    <td><span className={`sdl-progar__badge ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                    {(canRecord || canVerify) && <td><div className="sdl-progar__row-actions">
                      {r.status === 'draft' && canRecord && <>
                        <button type="button" className="btn" disabled={uploading === r.id} onClick={() => pickBukti(r)}>{uploading === r.id ? 'Mengunggah…' : r.bukti ? 'Ganti Bukti' : 'Unggah Bukti'}</button>
                        <button type="button" className="btn" onClick={() => edit(it, r)}>Ubah</button></>}
                      {r.status === 'draft' && canVerify && (mine
                        ? <span className="sdl-progar__muted" title="Realisasi yang Anda catat sendiri diverifikasi orang lain">Dicatat oleh Anda</span>
                        : <><button type="button" className="btn primary" disabled={!r.bukti} title={r.bukti ? undefined : 'Belum ada bukti bayar'} onClick={() => void verify(it, r)}>Verifikasi</button>
                          <button type="button" className="btn sdl-progar__danger" onClick={() => reject(it, r)}>Tolak</button></>)}
                    </div></td>}
                  </tr>
                })}</tbody>
              </table></div>}
          </section>
        })}

    <div className="sdl-progar__legacy">
      <button type="button" className="btn" aria-expanded={legacy} onClick={() => setLegacy(v => !v)}>{legacy ? 'Sembunyikan' : 'Lihat'} LRA lama (pagu berbasis Usulan)</button>
      {legacy && <div className="sdl-progar__legacy-body"><p className="sdl-progar__hint">Arsip baca. Pagu dan realisasi baru dicatat per kegiatan di atas.</p><BudgetR4A3 legacy /></div>}
    </div>

    {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
  </div>
}
