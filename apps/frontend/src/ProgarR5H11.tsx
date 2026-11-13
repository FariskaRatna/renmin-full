import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'

/**
 * R5H11: Program Anggaran (PROGAR) dan Pagu Anggaran.
 *
 * Satu komponen, dua menu:
 *   mode 'program' (ruang kerja PROGAR) -- susun Program -> Kegiatan.
 *   mode 'pagu'    (ruang kerja PAGU)   -- pagu dicatat PER KEGIATAN yang
 *                  diambil dari PROGAR; berstatus draft sampai Kasubbagren
 *                  menyetujui. Pencatat tidak bisa menyetujui inputannya sendiri.
 *
 * Backend: /api/v1/subbagren/progar (Express saja, migrasi 049).
 */

type Pagu = { id: string; jumlah: string; dasar: string; keterangan: string; status: 'draft' | 'disetujui' | 'ditolak'; version: number; createdBy: string; createdByName: string; createdAt: string; reviewedByName: string | null; reviewedAt: string | null; reviewNote: string }
type Kegiatan = { id: string; kode: string; nama: string; keterangan: string; version: number; pagu: Pagu | null; ditolak: Pagu | null }
type Program = { id: string; tahun: number; kode: string; nama: string; keterangan: string; version: number; kegiatan: Kegiatan[] }
type Tree = { tahun: number; programs: Program[]; totals: { disetujui: string; draft: string } }
type Caps = { canRead: boolean; canManage: boolean; canApprove: boolean }

export type FieldDef = { key: string; label: string; type?: 'text' | 'textarea' | 'rupiah' | 'date' | 'select' | 'decimal'; options?: { value: string; label: string }[]; required?: boolean; max: number; hint?: string; placeholder?: string; half?: boolean }
export type Dialog = { title: string; eyebrow: string; fields: FieldDef[]; values: Record<string, string>; submitLabel: string; danger?: boolean; context?: string; onSubmit: (v: Record<string, string>) => Promise<void> }

const BASE = '/api/v1/subbagren/progar'

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  duplicate: 'Kode tersebut sudah dipakai. Gunakan kode lain.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak dapat diproses.',
  version_conflict: 'Data sudah diubah orang lain. Muat ulang lalu coba lagi.',
  not_found: 'Data sudah tidak ada. Muat ulang halaman.',
  program_has_kegiatan: 'Program masih berisi kegiatan. Hapus kegiatannya terlebih dahulu.',
  kegiatan_has_pagu: 'Kegiatan ini sudah memiliki pagu, sehingga tidak dapat dihapus.',
  pagu_exists: 'Kegiatan ini sudah memiliki pagu.',
  pagu_not_draft: 'Pagu ini sudah diputuskan dan tidak dapat diubah lagi.',
  self_review_forbidden: 'Pagu yang Anda catat sendiri harus disetujui oleh orang lain.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}

async function api<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') {
    const c = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!c.ok) throw Error('Sesi keamanan tidak tersedia. Silakan login kembali.')
    headers['X-CSRF-Token'] = ((await c.json()) as { csrfToken: string }).csrfToken
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(`${BASE}${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  if (!r.ok) {
    const e: { error?: string } = await r.json().catch(() => ({}))
    if (r.status === 404 && !e.error) throw Error('Layanan Program & Pagu belum tersedia di server ini.')
    throw Error(ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}).`)
  }
  return r.json() as Promise<T>
}

/** "1500000" -> "Rp 1.500.000" tanpa melewati Number (aman untuk nilai besar). */
export function rupiah(digits: string): string {
  const clean = (digits || '0').replace(/^0+(?=\d)/, '')
  return `Rp ${clean.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`
}
const digitsOnly = (v: string) => v.replace(/\D/g, '').replace(/^0+/, '')
const readable = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })

const STATUS_LABEL: Record<Pagu['status'], string> = { draft: 'Menunggu persetujuan', disetujui: 'Disetujui', ditolak: 'Ditolak' }

const programFields: FieldDef[] = [
  { key: 'kode', label: 'Kode Program', required: true, max: 40, placeholder: 'mis. 060.01.WA', hint: 'Huruf, angka, titik, garis miring, atau tanda hubung.' },
  { key: 'nama', label: 'Nama Program', required: true, max: 240, placeholder: 'mis. Program Dukungan Manajemen' },
  { key: 'keterangan', label: 'Keterangan', type: 'textarea', max: 1000 },
]
const kegiatanFields: FieldDef[] = [
  { key: 'kode', label: 'Kode Kegiatan', required: true, max: 40, placeholder: 'mis. 3074' },
  { key: 'nama', label: 'Nama Kegiatan', required: true, max: 240, placeholder: 'mis. Dukungan Manajemen dan Teknis' },
  { key: 'keterangan', label: 'Keterangan', type: 'textarea', max: 1000 },
]
const paguFields: FieldDef[] = [
  { key: 'jumlah', label: 'Jumlah Pagu (Rp)', type: 'rupiah', required: true, max: 16 },
  { key: 'dasar', label: 'Dasar / Dokumen Sumber', required: true, max: 240, placeholder: 'mis. DIPA 2027 No. SP DIPA-060.01.1.xxx', hint: 'Nomor dokumen yang menetapkan pagu ini.' },
  { key: 'keterangan', label: 'Keterangan', type: 'textarea', max: 1000 },
]

export default function ProgarR5H11({ mode, userId, onOpenProgram }: { mode: 'program' | 'pagu'; userId: string; onOpenProgram?: () => void }) {
  const thisYear = new Date().getFullYear()
  const [tahun, setTahun] = useState(thisYear)
  const [tree, setTree] = useState<Tree | null>(null)
  const [caps, setCaps] = useState<Caps | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [filter, setFilter] = useState<'all' | 'kosong' | 'draft' | 'disetujui'>('all')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const c = caps ?? await api<Caps>('/capabilities')
      setCaps(c)
      if (!c.canRead) { setTree(null); return }
      setTree(await api<Tree>(`/?tahun=${tahun}`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Data tidak dapat dimuat.')
    } finally { setLoading(false) }
  }, [tahun]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load() }, [load])

  const years = useMemo(() => [thisYear - 1, thisYear, thisYear + 1, thisYear + 2], [thisYear])
  const canManage = Boolean(caps?.canManage)
  const canApprove = Boolean(caps?.canApprove)
  const programs = tree?.programs ?? []
  const allKegiatan = programs.flatMap(p => p.kegiatan)
  const tanpaPagu = allKegiatan.filter(k => !k.pagu).length
  const menunggu = allKegiatan.filter(k => k.pagu?.status === 'draft').length

  async function run(action: () => Promise<unknown>, okMessage: string) {
    await action()
    showToast(okMessage, 'success')
    await load()
  }

  // ---- Program & Kegiatan ----
  const addProgram = () => setDialog({ title: 'Tambah Program', eyebrow: `PROGRAM ANGGARAN ${tahun}`, fields: programFields, values: { kode: '', nama: '', keterangan: '' }, submitLabel: 'Simpan Program',
    onSubmit: v => run(() => api('/program', 'POST', { tahun, kode: v.kode, nama: v.nama, keterangan: v.keterangan }), 'Program ditambahkan.') })
  const editProgram = (p: Program) => setDialog({ title: 'Ubah Program', eyebrow: `PROGRAM ${p.kode}`, fields: programFields, values: { kode: p.kode, nama: p.nama, keterangan: p.keterangan }, submitLabel: 'Simpan Perubahan',
    onSubmit: v => run(() => api(`/program/${p.id}`, 'PUT', { kode: v.kode, nama: v.nama, keterangan: v.keterangan, version: p.version }), 'Program diperbarui.') })
  async function deleteProgram(p: Program) {
    if (!await confirmDialog(`Hapus program ${p.kode} — ${p.nama}?`, { confirmLabel: 'Hapus', danger: true })) return
    try { await run(() => api(`/program/${p.id}`, 'DELETE'), 'Program dihapus.') } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal menghapus.', 'error') }
  }
  const addKegiatan = (p: Program) => setDialog({ title: 'Tambah Kegiatan', eyebrow: `PROGRAM ${p.kode}`, context: p.nama, fields: kegiatanFields, values: { kode: '', nama: '', keterangan: '' }, submitLabel: 'Simpan Kegiatan',
    onSubmit: v => run(() => api(`/program/${p.id}/kegiatan`, 'POST', { kode: v.kode, nama: v.nama, keterangan: v.keterangan }), 'Kegiatan ditambahkan.') })
  const editKegiatan = (p: Program, k: Kegiatan) => setDialog({ title: 'Ubah Kegiatan', eyebrow: `PROGRAM ${p.kode}`, context: p.nama, fields: kegiatanFields, values: { kode: k.kode, nama: k.nama, keterangan: k.keterangan }, submitLabel: 'Simpan Perubahan',
    onSubmit: v => run(() => api(`/kegiatan/${k.id}`, 'PUT', { kode: v.kode, nama: v.nama, keterangan: v.keterangan, version: k.version }), 'Kegiatan diperbarui.') })
  async function deleteKegiatan(k: Kegiatan) {
    if (!await confirmDialog(`Hapus kegiatan ${k.kode} — ${k.nama}?`, { confirmLabel: 'Hapus', danger: true })) return
    try { await run(() => api(`/kegiatan/${k.id}`, 'DELETE'), 'Kegiatan dihapus.') } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal menghapus.', 'error') }
  }

  // ---- Pagu ----
  const addPagu = (p: Program, k: Kegiatan) => setDialog({ title: 'Catat Pagu', eyebrow: `PAGU ANGGARAN ${tahun}`, context: `${p.kode} · ${k.kode} — ${k.nama}`, fields: paguFields, values: { jumlah: '', dasar: '', keterangan: '' }, submitLabel: 'Simpan & Ajukan',
    onSubmit: v => run(() => api('/pagu', 'POST', { kegiatanId: k.id, jumlah: v.jumlah, dasar: v.dasar, keterangan: v.keterangan }), 'Pagu dicatat dan menunggu persetujuan Kasubbagren.') })
  const editPagu = (p: Program, k: Kegiatan, g: Pagu) => setDialog({ title: 'Ubah Pagu', eyebrow: `PAGU ANGGARAN ${tahun}`, context: `${p.kode} · ${k.kode} — ${k.nama}`, fields: paguFields, values: { jumlah: g.jumlah, dasar: g.dasar, keterangan: g.keterangan }, submitLabel: 'Simpan Perubahan',
    onSubmit: v => run(() => api(`/pagu/${g.id}`, 'PUT', { jumlah: v.jumlah, dasar: v.dasar, keterangan: v.keterangan, version: g.version }), 'Pagu diperbarui.') })
  async function approvePagu(k: Kegiatan, g: Pagu) {
    if (!await confirmDialog(`Setujui pagu ${rupiah(g.jumlah)} untuk kegiatan ${k.kode}? Setelah disetujui, pagu tidak dapat diubah.`, { confirmLabel: 'Setujui' })) return
    try { await run(() => api(`/pagu/${g.id}/review`, 'POST', { keputusan: 'disetujui', catatan: '', version: g.version }), 'Pagu disetujui.') } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal menyetujui.', 'error') }
  }
  const rejectPagu = (p: Program, k: Kegiatan, g: Pagu) => setDialog({ title: 'Tolak Pagu', eyebrow: 'PERSETUJUAN PAGU', danger: true, context: `${p.kode} · ${k.kode} — ${rupiah(g.jumlah)}`, fields: [{ key: 'catatan', label: 'Alasan penolakan', type: 'textarea', required: true, max: 500, hint: 'Minimal 8 karakter. Akan dibaca oleh pencatat pagu.' }], values: { catatan: '' }, submitLabel: 'Tolak Pagu',
    onSubmit: v => run(() => api(`/pagu/${g.id}/review`, 'POST', { keputusan: 'ditolak', catatan: v.catatan, version: g.version }), 'Pagu ditolak.') })

  const head = <div className="sdl-progar__toolbar">
    <label className="sdl-progar__year">Tahun Anggaran
      <select value={tahun} onChange={e => setTahun(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
    </label>
    <span className="sdl-progar__grow" />
    <button type="button" className="btn" onClick={() => void load()} disabled={loading}>Muat ulang</button>
    {mode === 'program' && canManage && <button type="button" className="btn primary" onClick={addProgram}>＋ Tambah Program</button>}
  </div>

  if (caps && !caps.canRead) return <div className="sdl-progar"><div className="panel sdl-progar__empty"><strong>Tidak ada akses</strong><p>Akun ini belum diberi kewenangan membaca Program dan Pagu Anggaran Subbagren.</p></div></div>

  return <div className="sdl-progar">
    {head}
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}

    {mode === 'pagu' && tree && <div className="sdl-progar__stats" aria-label="Ringkasan pagu">
      <div><span>Pagu disetujui</span><strong>{rupiah(tree.totals.disetujui)}</strong></div>
      <div><span>Menunggu persetujuan</span><strong>{rupiah(tree.totals.draft)}</strong><small>{menunggu} kegiatan</small></div>
      <div><span>Kegiatan tanpa pagu</span><strong>{tanpaPagu}</strong><small>dari {allKegiatan.length} kegiatan</small></div>
    </div>}

    {mode === 'pagu' && tree && allKegiatan.length > 0 && <div className="sdl-progar__filters" role="tablist" aria-label="Saring status pagu">
      {([['all', 'Semua'], ['kosong', 'Belum ada pagu'], ['draft', 'Menunggu persetujuan'], ['disetujui', 'Disetujui']] as const).map(([k, l]) =>
        <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
    </div>}

    {loading && !tree ? <div className="panel sdl-progar__empty"><p>Memuat…</p></div>
      : tree && programs.length === 0 ? <div className="panel sdl-progar__empty">
          <strong>Belum ada program untuk tahun {tahun}</strong>
          {mode === 'program'
            ? <p>{canManage ? 'Mulai dengan menambahkan program, lalu isi kegiatannya. Pagu anggaran dicatat per kegiatan di menu Pagu Anggaran.' : 'Program akan tampil di sini setelah dicatat oleh Operator atau Kasubbagren.'}</p>
            : <><p>Pagu dicatat per kegiatan yang diambil dari Program Anggaran. Susun program dan kegiatannya terlebih dahulu.</p>
              {onOpenProgram && <button type="button" className="btn primary" onClick={onOpenProgram}>Buka Program Anggaran</button>}</>}
        </div>
      : programs.map(p => {
          const rows = mode === 'pagu' ? p.kegiatan.filter(k => filter === 'all' || (filter === 'kosong' ? !k.pagu : k.pagu?.status === filter)) : p.kegiatan
          if (mode === 'pagu' && filter !== 'all' && rows.length === 0) return null
          const approved = p.kegiatan.reduce((n, k) => k.pagu?.status === 'disetujui' ? n + BigInt(k.pagu.jumlah) : n, 0n)
          return <section key={p.id} className="panel sdl-progar__program" aria-label={`Program ${p.kode}`}>
            <header className="sdl-progar__program-head">
              <div>
                <span className="sdl-progar__code">{p.kode}</span>
                <h3>{p.nama}</h3>
                {p.keterangan && <p>{p.keterangan}</p>}
              </div>
              <div className="sdl-progar__program-meta">
                <span>{p.kegiatan.length} kegiatan</span>
                <strong>{rupiah(approved.toString())}</strong>
                <small>pagu disetujui</small>
              </div>
              {mode === 'program' && canManage && <div className="sdl-progar__actions">
                <button type="button" className="btn" onClick={() => addKegiatan(p)}>＋ Kegiatan</button>
                <button type="button" className="btn" onClick={() => editProgram(p)}>Ubah</button>
                <button type="button" className="btn sdl-progar__danger" onClick={() => void deleteProgram(p)}>Hapus</button>
              </div>}
            </header>

            {p.kegiatan.length === 0 ? <p className="sdl-progar__hint">{mode === 'program' ? 'Belum ada kegiatan. Tambahkan kegiatan agar pagu bisa dicatat.' : 'Program ini belum memiliki kegiatan.'}</p>
              : <div className="table-scroll"><table className="data-table sdl-progar__table">
                <thead><tr><th>Kode</th><th>Kegiatan</th><th className="is-num">Pagu</th><th>Status</th>{(canManage || canApprove) && <th><span className="sdl-progar__sr">Aksi</span></th>}</tr></thead>
                <tbody>{rows.map(k => {
                  const g = k.pagu
                  const mine = g?.createdBy === userId
                  return <tr key={k.id}>
                    <td><span className="sdl-progar__code">{k.kode}</span></td>
                    <td><strong>{k.nama}</strong>
                      {mode === 'pagu' && g && <small>Dasar: {g.dasar} · dicatat {g.createdByName}, {readable(g.createdAt)}</small>}
                      {mode === 'pagu' && !g && k.ditolak && <small className="sdl-progar__rejected">Pagu {rupiah(k.ditolak.jumlah)} ditolak {k.ditolak.reviewedByName}: “{k.ditolak.reviewNote}”</small>}
                      {mode === 'program' && k.keterangan && <small>{k.keterangan}</small>}
                    </td>
                    <td className="is-num">{g ? rupiah(g.jumlah) : <span className="sdl-progar__muted">–</span>}</td>
                    <td>{g ? <span className={`sdl-progar__badge is-${g.status}`} title={g.reviewedAt ? `${STATUS_LABEL[g.status]} oleh ${g.reviewedByName}, ${readable(g.reviewedAt)}` : undefined}>{STATUS_LABEL[g.status]}</span> : <span className="sdl-progar__badge is-kosong">Belum ada pagu</span>}</td>
                    {(canManage || canApprove) && <td><div className="sdl-progar__row-actions">
                      {mode === 'program' && canManage && <><button type="button" className="btn" onClick={() => editKegiatan(p, k)}>Ubah</button>
                        <button type="button" className="btn sdl-progar__danger" disabled={Boolean(g)} title={g ? 'Kegiatan dengan pagu tidak dapat dihapus' : undefined} onClick={() => void deleteKegiatan(k)}>Hapus</button></>}
                      {mode === 'pagu' && !g && canManage && <button type="button" className="btn primary" onClick={() => addPagu(p, k)}>Catat Pagu</button>}
                      {mode === 'pagu' && g?.status === 'draft' && canManage && <button type="button" className="btn" onClick={() => editPagu(p, k, g)}>Ubah</button>}
                      {mode === 'pagu' && g?.status === 'draft' && canApprove && (mine
                        ? <span className="sdl-progar__muted" title="Pagu yang Anda catat sendiri disetujui orang lain">Dicatat oleh Anda</span>
                        : <><button type="button" className="btn primary" onClick={() => void approvePagu(k, g)}>Setujui</button>
                          <button type="button" className="btn sdl-progar__danger" onClick={() => rejectPagu(p, k, g)}>Tolak</button></>)}
                    </div></td>}
                  </tr>
                })}</tbody>
              </table></div>}
          </section>
        })}

    {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
  </div>
}

export function FormDialog({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  const [values, setValues] = useState(dialog.values)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    for (const f of dialog.fields) {
      const v = (values[f.key] ?? '').trim()
      if (f.required && !v) { setError(`${f.label} wajib diisi.`); return }
    }
    setBusy(true); setError('')
    try {
      await dialog.onSubmit(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan.')
    } finally { setBusy(false) }
  }

  return <div className="sdl-progar__shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <form className="sdl-progar__dialog" role="dialog" aria-modal="true" aria-labelledby="sdl-progar-dialog-title" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">{dialog.eyebrow}</span><h2 id="sdl-progar-dialog-title">{dialog.title}</h2>{dialog.context && <p>{dialog.context}</p>}</header>
      <div className="sdl-progar__fields">
        {dialog.fields.map((f, i) => <label key={f.key} className={f.half ? 'is-half' : undefined}>
          <span>{f.label}{f.required && <b aria-hidden="true"> *</b>}</span>
          {f.type === 'textarea'
            ? <textarea rows={3} maxLength={f.max} value={values[f.key] ?? ''} autoFocus={i === 0} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
            : f.type === 'rupiah'
              ? <div className="sdl-progar__money"><span aria-hidden="true">Rp</span><input inputMode="numeric" autoFocus={i === 0} value={values[f.key] ? rupiah(values[f.key]).slice(3) : ''} placeholder="0" onChange={e => setValues(v => ({ ...v, [f.key]: digitsOnly(e.target.value).slice(0, 16) }))} /></div>
              : f.type === 'select'
                ? <select autoFocus={i === 0} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}>{(f.options ?? []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : f.type === 'decimal'
                ? <input inputMode="decimal" autoFocus={i === 0} maxLength={f.max} placeholder={f.placeholder ?? '0'} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value.replace(/[^0-9.,]/g, '') }))} />
              : f.type === 'date'
                ? <input type="date" autoFocus={i === 0} value={values[f.key] ?? ''} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
              : <input maxLength={f.max} autoFocus={i === 0} value={values[f.key] ?? ''} placeholder={f.placeholder} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />}
          {f.hint && <small>{f.hint}</small>}
        </label>)}
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button>
        <button type="submit" className={`btn primary${dialog.danger ? ' sdl-progar__danger-solid' : ''}`} disabled={busy}>{busy ? 'Menyimpan…' : dialog.submitLabel}</button>
      </footer>
    </form>
  </div>
}
