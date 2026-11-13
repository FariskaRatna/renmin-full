import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FormDialog, type Dialog } from './ProgarR5H11'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'

/**
 * R5H13: Dokumen Perencanaan (Renstra, Renja, RKA-K/L, DIPA, POK, TOR/KAK, RAB).
 *
 * Unggah -> lampirkan PDF -> Kasubbagren MENGESAHKAN (pengunggah tidak boleh
 * mengesahkan sendiri). Revisi = dokumen baru yang menggantikan dokumen sah;
 * versi lama tetap bisa dibuka. Dokumen bisa dikaitkan ke program/kegiatan.
 */

type Doc = { id: string; tahun: number; jenis: string; jenisLabel: string; judul: string; nomor: string; tanggal: string | null; keterangan: string; status: 'draft' | 'disahkan' | 'ditolak'; version: number; penggantiDari: string | null; digantikan: boolean; createdBy: string; createdByName: string; createdAt: string; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string; program: { id: string; kode: string } | null; kegiatan: { id: string; kode: string; nama: string } | null; berkas: { filename: string; size: number } | null }
type Caps = { canRead: boolean; canManage: boolean; canSahkan: boolean }
type Tree = { programs: { id: string; kode: string; nama: string; kegiatan: { id: string; kode: string; nama: string }[] }[] }

const BASE = '/api/v1/subbagren/perencanaan'
const JENIS: [string, string][] = [['renstra', 'Renstra'], ['renja', 'Renja'], ['rka_kl', 'RKA-K/L'], ['dipa', 'DIPA'], ['revisi_dipa', 'Revisi DIPA'], ['pok', 'POK'], ['tor_kak', 'TOR/KAK'], ['rab', 'RAB'], ['lainnya', 'Lainnya']]
const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_link: 'Program/kegiatan atau dokumen yang direvisi tidak sesuai tahun/jenisnya.',
  dokumen_not_draft: 'Dokumen ini sudah diputuskan dan tidak dapat diubah lagi.',
  version_conflict: 'Data sudah diubah (mungkin berkas baru diunggah). Muat ulang lalu coba lagi.',
  berkas_required: 'Lampirkan berkas PDF terlebih dahulu sebelum disahkan.',
  self_review_forbidden: 'Dokumen yang Anda unggah sendiri harus disahkan oleh orang lain.',
  revisi_hanya_dari_dokumen_sah: 'Revisi hanya bisa dibuat dari dokumen yang sudah disahkan.',
  revisi_sudah_ada: 'Dokumen ini sudah punya revisi yang sedang diproses atau sudah sah.',
  invalid_file_type: 'Berkas harus PDF yang valid (nama berakhiran .pdf).',
  file_too_large: 'Ukuran berkas maksimal 20 MB.',
  one_file_required: 'Pilih satu berkas.',
  evidence_encryption_unavailable: 'Kunci enkripsi berkas belum dikonfigurasi di server. Hubungi administrator.',
  evidence_integrity_failure: 'Berkas gagal diperiksa keutuhannya. Unggah ulang.',
  not_found: 'Data sudah tidak ada. Muat ulang halaman.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
async function api<T>(path: string, method: 'GET' | 'POST' | 'PUT' = 'GET', body?: unknown): Promise<T> {
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
    if (r.status === 404 && !e.error) throw Error('Layanan Dokumen Perencanaan belum tersedia di server ini.')
    throw Error(ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}).`)
  }
  return r.json() as Promise<T>
}
const tgl = (d: string | null) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

export default function DokumenR5H13({ userId }: { userId: string }) {
  const thisYear = new Date().getFullYear()
  const [tahun, setTahun] = useState(thisYear)
  const [docs, setDocs] = useState<Doc[] | null>(null)
  const [tree, setTree] = useState<Tree | null>(null)
  const [caps, setCaps] = useState<Caps | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [showOld, setShowOld] = useState(false)
  const [uploading, setUploading] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const target = useRef<Doc | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const c = caps ?? await api<Caps>('/capabilities')
      setCaps(c)
      if (!c.canRead) return
      const [d, t] = await Promise.all([api<{ items: Doc[] }>(`/dokumen?tahun=${tahun}`), api<Tree>(`/api/v1/subbagren/progar/?tahun=${tahun}`).catch(() => null)])
      setDocs(d.items); setTree(t)
    } catch (e) { setError(e instanceof Error ? e.message : 'Data tidak dapat dimuat.') } finally { setLoading(false) }
  }, [tahun]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  const years = useMemo(() => [thisYear - 1, thisYear, thisYear + 1, thisYear + 2], [thisYear])
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
    { key: 'link', label: 'Terkait Program / Kegiatan', type: 'select', max: 80, options: linkOptions, hint: 'Opsional. Hanya program/kegiatan tahun yang sama.' },
    { key: 'keterangan', label: 'Keterangan', type: 'textarea', max: 1000 },
  ]
  const linkOf = (d: Doc) => d.kegiatan ? `k:${d.kegiatan.id}` : d.program ? `p:${d.program.id}` : ''

  const add = () => setDialog({ title: 'Unggah Dokumen Perencanaan', eyebrow: `DOKUMEN PERENCANAAN ${tahun}`, fields: fields(), values: { jenis: 'dipa', judul: '', nomor: '', tanggal: '', link: '', keterangan: '' }, submitLabel: 'Simpan (lalu lampirkan PDF)',
    onSubmit: v => run(() => api('/dokumen', 'POST', { tahun, ...payload(v) }), 'Dokumen disimpan sebagai draft. Lampirkan berkas PDF-nya.') })
  const edit = (d: Doc) => setDialog({ title: 'Ubah Dokumen', eyebrow: `${d.jenisLabel.toUpperCase()} ${tahun}`, fields: fields(), values: { jenis: d.jenis, judul: d.judul, nomor: d.nomor, tanggal: d.tanggal ?? '', link: linkOf(d), keterangan: d.keterangan }, submitLabel: 'Simpan Perubahan',
    onSubmit: v => run(() => api(`/dokumen/${d.id}`, 'PUT', { ...payload(v), version: d.version }), 'Dokumen diperbarui.') })
  const revisi = (d: Doc) => setDialog({ title: 'Buat Revisi', eyebrow: `REVISI ${d.jenisLabel.toUpperCase()}`, context: `Menggantikan: ${d.judul}${d.nomor ? ` (${d.nomor})` : ''}`, fields: fields(), values: { jenis: d.jenis, judul: d.judul, nomor: '', tanggal: '', link: linkOf(d), keterangan: '' }, submitLabel: 'Simpan Revisi (lalu lampirkan PDF)',
    onSubmit: v => run(() => api('/dokumen', 'POST', { tahun, ...payload({ ...v, jenis: d.jenis }), penggantiDari: d.id }), 'Revisi disimpan sebagai draft. Lampirkan PDF-nya lalu ajukan pengesahan.') })
  const tolak = (d: Doc) => setDialog({ title: 'Tolak Dokumen', eyebrow: 'PENGESAHAN DOKUMEN', danger: true, context: d.judul, fields: [{ key: 'catatan', label: 'Alasan penolakan', type: 'textarea', required: true, max: 500, hint: 'Minimal 8 karakter.' }], values: { catatan: '' }, submitLabel: 'Tolak',
    onSubmit: v => run(() => api(`/dokumen/${d.id}/review`, 'POST', { keputusan: 'ditolak', catatan: v.catatan, version: d.version }), 'Dokumen ditolak.') })
  async function sahkan(d: Doc) {
    if (!await confirmDialog(`Sahkan ${d.jenisLabel} "${d.judul}"? Setelah disahkan, dokumen dan berkasnya terkunci.`, { confirmLabel: 'Sahkan' })) return
    await guard(() => run(() => api(`/dokumen/${d.id}/review`, 'POST', { keputusan: 'disahkan', catatan: '', version: d.version }), 'Dokumen disahkan.'))
  }
  function pick(d: Doc) { target.current = d; fileRef.current?.click() }
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

  const visible = (docs ?? []).filter(d => showOld || !d.digantikan)
  const groups = JENIS.map(([j, label]) => ({ j, label, items: visible.filter(d => d.jenis === j) })).filter(g => g.items.length)
  const oldCount = (docs ?? []).filter(d => d.digantikan).length
  const status = (d: Doc) => d.digantikan ? { cls: 'is-kosong', label: 'Digantikan revisi' } : d.status === 'disahkan' ? { cls: 'is-disetujui', label: 'Sah' } : d.status === 'ditolak' ? { cls: 'is-ditolak', label: 'Ditolak' } : { cls: 'is-draft', label: d.berkas ? 'Menunggu pengesahan' : 'Draft — belum ada PDF' }

  return <div className="sdl-progar">
    <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => void onFile(e.target.files?.[0])} />
    <div className="sdl-progar__toolbar">
      <label className="sdl-progar__year">Tahun Anggaran
        <select value={tahun} onChange={e => setTahun(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
      </label>
      <span className="sdl-progar__grow" />
      {oldCount > 0 && <label className="sdl-progar__check"><input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} /> Tampilkan versi lama ({oldCount})</label>}
      <button type="button" className="btn" onClick={() => void load()} disabled={loading}>Muat ulang</button>
      {canManage && <button type="button" className="btn primary" onClick={add}>＋ Unggah Dokumen</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}

    {loading && !docs ? <div className="panel sdl-progar__empty"><p>Memuat…</p></div>
      : docs && groups.length === 0 ? <div className="panel sdl-progar__empty"><strong>Belum ada dokumen perencanaan untuk tahun {tahun}</strong>
          <p>{canManage ? 'Unggah Renstra, Renja, RKA-K/L, DIPA, POK, TOR/KAK, atau RAB. Dokumen berlaku setelah disahkan Kasubbagren.' : 'Dokumen akan tampil di sini setelah diunggah.'}</p></div>
      : groups.map(g => <section key={g.j} className="panel sdl-progar__program" aria-label={g.label}>
          <header className="sdl-progar__program-head"><div><span className="sdl-progar__code">{g.label}</span><h3>{g.items.length} dokumen</h3></div></header>
          <div className="table-scroll"><table className="data-table sdl-progar__table">
            <thead><tr><th>Dokumen</th><th>Terkait</th><th>Berkas</th><th>Status</th>{(canManage || canSahkan) && <th><span className="sdl-progar__sr">Aksi</span></th>}</tr></thead>
            <tbody>{g.items.map(d => {
              const st = status(d); const mine = d.createdBy === userId
              return <tr key={d.id} className={d.digantikan ? 'sdl-progar__old' : undefined}>
                <td><strong>{d.judul}</strong>{d.penggantiDari && <span className="sdl-progar__tag">Revisi</span>}
                  <small>{[d.nomor, tgl(d.tanggal)].filter(Boolean).join(' · ') || 'Tanpa nomor'} · diunggah {d.createdByName}</small>
                  {d.status === 'ditolak' && <small className="sdl-progar__rejected">Ditolak {d.reviewedByName}: “{d.reviewNote}”</small>}
                  {d.status === 'disahkan' && d.reviewedAt && <small>Disahkan {d.reviewedByName}, {tgl(d.reviewedAt.slice(0, 10))}</small>}</td>
                <td>{d.kegiatan ? <span className="sdl-progar__muted">Kegiatan {d.kegiatan.kode}</span> : d.program ? <span className="sdl-progar__muted">Program {d.program.kode}</span> : <span className="sdl-progar__muted">–</span>}</td>
                <td>{d.berkas ? <a className="sdl-progar__file" href={`${BASE}/dokumen/${d.id}/berkas`} download={d.berkas.filename} title={`${d.berkas.filename} · ${Math.ceil(d.berkas.size / 1024)} KB`}>📄 {d.berkas.filename}</a> : <span className="sdl-progar__muted">Belum ada</span>}</td>
                <td><span className={`sdl-progar__badge ${st.cls}`}>{st.label}</span></td>
                {(canManage || canSahkan) && <td><div className="sdl-progar__row-actions">
                  {d.status === 'draft' && canManage && <>
                    <button type="button" className="btn" disabled={uploading === d.id} onClick={() => pick(d)}>{uploading === d.id ? 'Mengunggah…' : d.berkas ? 'Ganti PDF' : 'Lampirkan PDF'}</button>
                    <button type="button" className="btn" onClick={() => edit(d)}>Ubah</button></>}
                  {d.status === 'draft' && canSahkan && (mine
                    ? <span className="sdl-progar__muted" title="Dokumen yang Anda unggah sendiri disahkan orang lain">Diunggah oleh Anda</span>
                    : <><button type="button" className="btn primary" disabled={!d.berkas} title={d.berkas ? undefined : 'Belum ada berkas PDF'} onClick={() => void sahkan(d)}>Sahkan</button>
                      <button type="button" className="btn sdl-progar__danger" onClick={() => tolak(d)}>Tolak</button></>)}
                  {d.status === 'disahkan' && !d.digantikan && canManage && <button type="button" className="btn" onClick={() => revisi(d)}>Buat Revisi</button>}
                </div></td>}
              </tr>
            })}</tbody>
          </table></div>
        </section>)}

    {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
  </div>
}
