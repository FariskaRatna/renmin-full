import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { JENIS } from './DokumenR5H13'
import { LampiranPreviewR5F15 } from './LampiranPreviewR5F15'
import { FormDialog, rupiah, type Dialog } from './ProgarR5H11'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'

/**
 * R5H18 (2026-11-17): Realisasi Anggaran memotong "Anggaran (estimasi)" setiap
 * DOKUMEN FINAL (pos anggaran), bukan lagi pagu kegiatan R5H11/R5H12.
 *
 * Alur tetap: Operator mencatat realisasi pada pos, mengunggah satu bukti bayar
 * (PDF/JPG/PNG <= 5 MB, terenkripsi), lalu Kasubbagren memverifikasi atau
 * menolak. Hanya realisasi terverifikasi yang mengurangi sisa; server menolak
 * verifikasi yang melampaui anggaran dokumen. Data pagu/realisasi lama tidak
 * ditampilkan lagi (keputusan pemilik), tetapi tetap tersimpan.
 */

type Bukti = { filename: string; mimeType: string; size: number }
type Real = { id: string; tanggal: string; uraian: string; nomorBukti: string; jumlah: string; status: 'draft' | 'terverifikasi' | 'ditolak'; version: number; createdBy: string; createdByName: string; createdAt: string; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string; bukti: Bukti | null }
type Item = { dokumenId: string; anggaran: string; terverifikasi: string; menunggu: string; sisa: string; aktif: boolean; digantikan: boolean; dokumen: { jenis: string; judul: string; nomor: string }; realisasi: Real[] }
type Data = { tahun: number; items: Item[]; totals: { anggaran: string; terverifikasi: string; menunggu: string; sisa: string } }
const jenisLabel = (j: string) => JENIS.find(([k]) => k === j)?.[1] ?? j
type Caps = { canRead: boolean; canRecordRealisasi: boolean; canVerifyRealisasi: boolean }

const BASE = '/api/v1/subbagren/progar'
const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak dapat diproses.',
  tahun_tidak_cocok: 'Tanggal realisasi harus berada di tahun anggaran dokumennya.',
  melebihi_sisa_anggaran: 'Jumlah melebihi sisa anggaran dokumen ini.',
  pos_tidak_aktif: 'Dokumen ini tidak lagi final atau sudah digantikan revisi; realisasi baru tidak bisa dicatat.',
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

export default function RealisasiR5H12({ userId, onOpenDokumen }: { userId: string; onOpenDokumen?: () => void }) {
  const thisYear = new Date().getFullYear()
  const [tahun, setTahun] = useState(thisYear)
  const [data, setData] = useState<Data | null>(null)
  const [caps, setCaps] = useState<Caps | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [uploading, setUploading] = useState('')
  // Bukti dibuka di jendela pratinjau (bukan diunduh) supaya pemeriksa cukup melihat.
  const [preview, setPreview] = useState<{ url: string; name: string; mime: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const uploadTarget = useRef<Real | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const c = caps ?? await api<Caps>('/capabilities')
      setCaps(c)
      if (c.canRead) setData(await api<Data>(`/realisasi-dokumen?tahun=${tahun}`))
    } catch (e) { setError(e instanceof Error ? e.message : 'Data tidak dapat dimuat.') } finally { setLoading(false) }
  }, [tahun]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  const years = useMemo(() => [thisYear - 1, thisYear, thisYear + 1, thisYear + 2], [thisYear])
  const canRecord = Boolean(caps?.canRecordRealisasi)
  const canVerify = Boolean(caps?.canVerifyRealisasi)
  const run = async (fn: () => Promise<unknown>, ok: string) => { await fn(); showToast(ok, 'success'); await load() }
  const guard = async (fn: () => Promise<void>) => { try { await fn() } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal.', 'error') } }

  const record = (it: Item) => setDialog({
    title: 'Catat Realisasi', eyebrow: `REALISASI ${tahun}`, context: `${jenisLabel(it.dokumen.jenis)} — ${it.dokumen.judul} · sisa ${rupiah(it.sisa)}`,
    fields: fields(tahun), values: { tanggal: '', jumlah: '', nomorBukti: '', uraian: '' }, submitLabel: 'Simpan Realisasi',
    onSubmit: v => run(() => api('/realisasi-dokumen', 'POST', { dokumenId: it.dokumenId, ...v }), 'Realisasi dicatat. Unggah bukti bayarnya agar bisa diverifikasi.'),
  })
  const edit = (it: Item, r: Real) => setDialog({
    title: 'Ubah Realisasi', eyebrow: `REALISASI ${tahun}`, context: `${jenisLabel(it.dokumen.jenis)} — ${it.dokumen.judul}`,
    fields: fields(tahun), values: { tanggal: r.tanggal, jumlah: r.jumlah, nomorBukti: r.nomorBukti, uraian: r.uraian }, submitLabel: 'Simpan Perubahan',
    onSubmit: v => run(() => api(`/realisasi-dokumen/${r.id}`, 'PUT', { ...v, version: r.version }), 'Realisasi diperbarui.'),
  })
  const reject = (it: Item, r: Real) => setDialog({
    title: 'Tolak Realisasi', eyebrow: 'VERIFIKASI REALISASI', danger: true, context: `${it.dokumen.judul} · ${r.nomorBukti} · ${rupiah(r.jumlah)}`,
    fields: [{ key: 'catatan', label: 'Alasan penolakan', type: 'textarea', required: true, max: 500, hint: 'Minimal 8 karakter. Akan dibaca oleh pencatat.' }],
    values: { catatan: '' }, submitLabel: 'Tolak Realisasi',
    onSubmit: v => run(() => api(`/realisasi-dokumen/${r.id}/review`, 'POST', { keputusan: 'ditolak', catatan: v.catatan, version: r.version }), 'Realisasi ditolak.'),
  })
  async function verify(it: Item, r: Real) {
    if (!await confirmDialog(`Verifikasi realisasi ${rupiah(r.jumlah)} (${r.nomorBukti}) untuk ${it.dokumen.judul}? Pastikan bukti bayar sudah diperiksa.`, { confirmLabel: 'Verifikasi' })) return
    await guard(() => run(() => api(`/realisasi-dokumen/${r.id}/review`, 'POST', { keputusan: 'terverifikasi', catatan: '', version: r.version }), 'Realisasi terverifikasi.'))
  }
  function pickBukti(r: Real) { uploadTarget.current = r; fileRef.current?.click() }
  async function onFile(file: File | undefined) {
    const r = uploadTarget.current
    if (fileRef.current) fileRef.current.value = ''
    if (!file || !r) return
    if (file.size > 5 * 1024 * 1024) { showToast(ERRORS.file_too_large, 'error'); return }
    const form = new FormData(); form.append('file', file)
    setUploading(r.id)
    await guard(() => run(() => api(`/realisasi-dokumen/${r.id}/bukti`, 'POST', form), 'Bukti bayar diunggah.'))
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
      <div><span>Anggaran dokumen final</span><strong>{rupiah(t.anggaran)}</strong></div>
      <div><span>Realisasi terverifikasi</span><strong>{rupiah(t.terverifikasi)}</strong><small>serapan {persen(t.terverifikasi, t.anggaran).toLocaleString('id-ID')}%</small></div>
      <div><span>Sisa anggaran</span><strong>{rupiah(t.sisa)}</strong></div>
      <div><span>Menunggu verifikasi</span><strong>{rupiah(t.menunggu)}</strong></div>
    </div>}

    {loading && !data ? <div className="panel sdl-progar__empty"><p>Memuat…</p></div>
      : data && data.items.length === 0 ? <div className="panel sdl-progar__empty">
          <strong>Belum ada dokumen final beranggaran untuk tahun {tahun}</strong>
          <p>Realisasi dicatat pada dokumen yang sudah Final/Selesai dan punya Anggaran (estimasi). Isi anggarannya di Detail dokumen, lalu tandai Final.</p>
          {onOpenDokumen && <button type="button" className="btn primary" onClick={onOpenDokumen}>Buka Dokumen Perancangan</button>}
        </div>
      : data?.items.map(it => {
          const pct = persen(it.terverifikasi, it.anggaran)
          return <section key={it.dokumenId} className="panel sdl-progar__program" aria-label={`Realisasi ${it.dokumen.judul}`}>
            <header className="sdl-progar__program-head">
              <div>
                <span className="sdl-progar__code">{jenisLabel(it.dokumen.jenis)}</span>{it.dokumen.nomor && <> <span className="sdl-progar__code">{it.dokumen.nomor}</span></>}
                <h3>{it.dokumen.judul}</h3>
                {!it.aktif && <p className="sdl-progar__rejected">{it.digantikan ? 'Sudah digantikan revisi' : 'Tidak lagi final'} — realisasi baru tidak bisa dicatat di pos ini.</p>}
              </div>
              <div className="sdl-progar__program-meta">
                <span>Anggaran {rupiah(it.anggaran)}</span>
                <strong>{rupiah(it.sisa)}</strong>
                <small>sisa anggaran</small>
              </div>
              <div className="sdl-progar__meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Serapan terverifikasi">
                <span style={{ width: `${Math.min(100, pct)}%` }} />
                <em>Terserap {rupiah(it.terverifikasi)} · {pct.toLocaleString('id-ID')}%{it.menunggu !== '0' ? ` · menunggu ${rupiah(it.menunggu)}` : ''}</em>
              </div>
              {canRecord && <div className="sdl-progar__actions"><button type="button" className="btn primary" disabled={it.sisa === '0' || !it.aktif} title={!it.aktif ? 'Pos tidak aktif' : it.sisa === '0' ? 'Anggaran sudah terserap penuh' : undefined} onClick={() => record(it)}>＋ Catat Realisasi</button></div>}
            </header>
            {it.realisasi.length === 0 ? <p className="sdl-progar__hint">Belum ada realisasi untuk dokumen ini.</p>
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
                      ? <button type="button" className="sdl-progar__file" onClick={() => setPreview({ url: `${BASE}/realisasi-dokumen/${r.id}/bukti`, name: r.bukti!.filename, mime: r.bukti!.mimeType })} title={`Lihat ${r.bukti.filename} · ${Math.ceil(r.bukti.size / 1024)} KB`}>👁 {r.bukti.filename}</button>
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

    {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
    {preview && <LampiranPreviewR5F15 stored={preview} title="Bukti Bayar" note="Periksa kesesuaian nomor dan jumlah pada bukti sebelum memverifikasi." onClose={() => setPreview(null)} />}
  </div>
}
