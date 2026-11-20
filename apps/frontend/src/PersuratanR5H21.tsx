import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { LampiranPreviewR5F15 } from './LampiranPreviewR5F15'
import { FormDialog, type Dialog } from './ProgarR5H11'
import { TtdNaskahR5H7 } from './TtdNaskahR5H7'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './PersuratanR5H21.css'

/**
 * R5H21 (2026-11-19): persuratan antar-unit untuk Subbagren, Subbagsumda, Subbagbinfung
 * (dan Urmin sebagai penerima). Satu komponen untuk dua menu:
 *   - mode 'keluar': draf -> diajukan -> disetujui Kabagrenmin -> dikirim ke unit tujuan.
 *   - mode 'masuk' : surat yang dikirim unit lain ke unit ini; ditandai diterima,
 *                    terlihat oleh semua staf unit.
 * API: /api/v1/persuratan (Express saja, migrasi 064).
 */

export type UnitKey = 'urmin' | 'subbagren' | 'subbagsumda' | 'subbagbinfung'
const UNITS: UnitKey[] = ['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung']
const UNIT_LABEL: Record<UnitKey, string> = { urmin: 'Urmin', subbagren: 'Subbagren', subbagsumda: 'Subbagsumda', subbagbinfung: 'Subbagbinfung' }
/**
 * Standar "Kepada" untuk tujuan INTERNAL, sama di semua unit (keputusan pemilik 2026-11-19):
 * tujuannya UNIT (seluruh anggotanya menerima), bukan hanya kepala/kasubbagnya.
 * Nilai tersimpan tetap teks (kontrak API Urmin tidak berubah); teks standar inilah yang
 * dipetakan ke unit penerima saat surat dikirim ke unit internal.
 */
export const KEPADA_UNIT: Record<UnitKey, string> = UNIT_LABEL
export const KEPADA_INTERNAL: { label: string; units: UnitKey[] }[] = [
  ...UNITS.map(u => ({ label: KEPADA_UNIT[u], units: [u] })),
  { label: 'Seluruh Subbag', units: ['subbagren', 'subbagsumda', 'subbagbinfung'] },
]
/** Unit penerima dari teks "Kepada" standar; [] bila bukan tujuan internal standar. */
export function unitDariKepada(kepada: string | undefined): UnitKey[] {
  const k = (kepada ?? '').trim().toLowerCase()
  // Label lama (sempat dipakai 2026-11-19) tetap dikenali.
  const lama: Record<string, string> = { kaurmin: 'urmin', kasubbagren: 'subbagren', kasubbagsumda: 'subbagsumda', kasubbagbinfung: 'subbagbinfung', 'para kasubbag': 'seluruh subbag' }
  const key = lama[k] ?? k
  return KEPADA_INTERNAL.find(x => x.label.toLowerCase() === key)?.units ?? []
}
/** Pemilih "Kepada": tujuan internal standar, atau ketik bebas (eksternal/pejabat lain). */
export function KepadaPick({ label, value, onChange, kecuali, className }: { label: string; value: string; onChange: (v: string) => void; kecuali?: UnitKey; className?: string }) {
  const opsi = KEPADA_INTERNAL.filter(x => !(kecuali && x.units.length === 1 && x.units[0] === kecuali))
  const standar = opsi.some(x => x.label === value)
  const [lain, setLain] = useState(!standar && value.trim() !== '')
  return <label className={className}><span>{label}</span>
    <select value={lain ? '__lain' : standar ? value : ''} onChange={e => { const v = e.target.value; if (v === '__lain') { setLain(true); onChange(standar ? '' : value) } else { setLain(false); onChange(v) } }}>
      <option value="">— Pilih tujuan —</option>
      <optgroup label="Internal Bagrenmin (bisa dikirim lewat aplikasi)">{opsi.map(x => <option key={x.label} value={x.label}>{x.label}</option>)}</optgroup>
      <option value="__lain">Lainnya / eksternal (ketik)…</option>
    </select>
    {lain && <input value={value} maxLength={200} placeholder="mis. Karorenmin Polri" onChange={e => onChange(e.target.value)} />}
    <small>{lain ? 'Tujuan di luar daftar internal; tidak dikirim lewat aplikasi.' : standar ? 'Tujuan internal: setelah disetujui, unitnya otomatis tercentang saat Kirim ke unit internal.' : ''}</small>
  </label>
}

type Berkas = { id: string; peran: 'naskah' | 'lampiran' | 'naskah_ttd'; jenis: 'pdf' | 'xlsx' | 'docx'; filename: string; size: number; uploadedAt: string }
type Tujuan = { unit: UnitKey; label: string; diterimaAt: string | null; diterimaByName: string | null }
type Status = 'draft' | 'diajukan' | 'ditolak' | 'disetujui' | 'dikirim'
type Surat = {
  id: string; unitPengirim: UnitKey; unitPengirimLabel: string; nomor: string; tanggal: string | null; perihal: string; sifat: 'Biasa' | 'Kilat'
  jenisSurat: string; kodeArsip: string; ringkasan: string; tujuanEksternal: string; status: Status; reviewNote: string; version: number
  createdAt: string; submittedAt: string | null; reviewedAt: string | null; sentAt: string | null; createdBy: string; createdByName: string
  reviewedByName: string | null; sentByName: string | null; tujuan: Tujuan[]; berkas: Berkas[]; diterimaAt?: string | null; diterimaByName?: string | null
}
type Caps = { units: Record<UnitKey, { read: boolean; manage: boolean }>; canApprove: boolean }

const BASE = '/api/v1/persuratan'
const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak sesuai. Muat ulang halaman lalu coba lagi.',
  version_conflict: 'Surat sudah diubah orang lain. Muat ulang lalu coba lagi.',
  surat_terkunci: 'Surat sudah diajukan atau dikirim; tidak bisa diubah lagi.',
  naskah_belum_ada: 'Unggah naskah surat (PDF) dulu.',
  tujuan_belum_ada: 'Pilih minimal satu tujuan: unit internal atau eksternal.',
  tujuan_tidak_sah: 'Tujuan tidak sah (tidak boleh unit sendiri).',
  surat_belum_disetujui: 'Surat belum disetujui Kabagrenmin.',
  surat_bukan_diajukan: 'Surat tidak sedang menunggu persetujuan.',
  sudah_diterima: 'Surat ini sudah ditandai diterima.',
  naskah_harus_pdf: 'Naskah surat harus PDF.',
  invalid_file_type: 'Berkas tidak valid. Naskah harus PDF; lampiran boleh PDF, Excel (.xlsx), atau Word (.docx).',
  file_too_large: 'Ukuran berkas maksimal 20 MB.',
  batas_lampiran: 'Lampiran paling banyak 10 berkas.',
  jenis_surat_tidak_dikenal: 'Jenis surat tidak dikenal. Pilih dari daftar.',
  kode_arsip_tidak_dikenal: 'Kode arsip tidak dikenal. Pilih dari daftar.',
  pakai_surat_keluar_urmin: 'Urmin memakai menu Surat Keluar Urmin.',
  surat_rahasia: 'Surat berklasifikasi Rahasia tidak dikirim ke seluruh staf unit lain.',
  sudah_dikirim: 'Surat ini sudah dikirim ke unit internal.',
  placements_mismatch: 'Setiap naskah PDF wajib diberi minimal satu tanda tangan.',
  no_saved_signature: 'Belum ada tanda tangan tersimpan. Coret tanda tangan baru.',
  not_found: 'Surat tidak ditemukan atau bukan untuk unit ini.',
  evidence_integrity_failure: 'Berkas gagal diverifikasi. Hubungi admin.',
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
    throw Error(ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}).`)
  }
  return r.json() as Promise<T>
}

const tgl = (iso: string | null | undefined) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const ukuran = (n: number) => n >= 1048576 ? `${(n / 1048576).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
const STATUS: Record<Status, { label: string; cls: string }> = {
  draft: { label: 'Draf', cls: 'is-draft' }, diajukan: { label: 'Menunggu persetujuan', cls: 'is-draft' }, ditolak: { label: 'Dikembalikan', cls: 'is-ditolak' },
  disetujui: { label: 'Disetujui · siap dikirim', cls: 'is-disetujui' }, dikirim: { label: 'Dikirim', cls: 'is-disetujui' },
}
const PERAN: Record<Berkas['peran'], string> = { naskah: 'Naskah', naskah_ttd: 'Naskah bertanda tangan', lampiran: 'Lampiran' }
const tujuanText = (s: Surat) => [...s.tujuan.map(t => KEPADA_UNIT[t.unit] ?? t.label), ...(s.tujuanEksternal ? [s.tujuanEksternal] : [])].join(', ')

/** Jumlah surat masuk yang belum diterima (untuk penanda di sidebar). */
export function usePersuratanBadge(unit: UnitKey | null): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!unit) { setN(0); return }
    let live = true
    api<{ items: Surat[] }>(`/${unit}/masuk`).then(d => { if (live) setN(d.items.filter(x => !x.diterimaAt).length) }).catch(() => { if (live) setN(0) })
    const onChange = () => { api<{ items: Surat[] }>(`/${unit}/masuk`).then(d => { if (live) setN(d.items.filter(x => !x.diterimaAt).length) }).catch(() => undefined) }
    window.addEventListener('sdl-persuratan-changed', onChange)
    return () => { live = false; window.removeEventListener('sdl-persuratan-changed', onChange) }
  }, [unit])
  return n
}
const changed = () => window.dispatchEvent(new Event('sdl-persuratan-changed'))

export default function PersuratanR5H21({ unit, mode, userId, onOpenDisposisi, initialID }: { unit: UnitKey; mode: 'keluar' | 'masuk'; userId: string; onOpenDisposisi?: () => void; initialID?: string }) {
  const [caps, setCaps] = useState<Caps | null>(null)
  const [items, setItems] = useState<Surat[] | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<'' | 'aktif' | Status | 'belum' | 'sudah'>('')
  const [cari, setCari] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ surat?: Surat } | null>(null)
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const n = ++seq.current
    setLoading(true); setError('')
    try {
      const [c, d] = await Promise.all([api<Caps>('/capabilities'), api<{ items: Surat[] }>(`/${unit}/${mode}`)])
      if (n !== seq.current) return
      setCaps(c); setItems(d.items)
    } catch (e) { if (n === seq.current) setError(e instanceof Error ? e.message : 'Data tidak dapat dimuat.') } finally { if (n === seq.current) setLoading(false) }
  }, [unit, mode])
  useEffect(() => { setItems(null); setFilter(''); setDetailId(initialID ?? null); void load() }, [load, initialID])

  const canManage = Boolean(caps?.units[unit]?.manage)
  const bisaBuat = mode === 'keluar' && canManage && unit !== 'urmin'
  const shown = useMemo(() => (items ?? []).filter(s => {
    if (mode === 'masuk') { if (filter === 'belum' && s.diterimaAt) return false; if (filter === 'sudah' && !s.diterimaAt) return false }
    else if (filter === 'aktif') { if (s.status === 'dikirim') return false } else if (filter && s.status !== filter) return false
    const q = cari.trim().toLowerCase()
    return !q || `${s.nomor} ${s.perihal} ${tujuanText(s)} ${s.unitPengirimLabel}`.toLowerCase().includes(q)
  }), [items, filter, cari, mode])

  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); showToast(ok, 'success'); changed(); await load() } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal.', 'error') }
  }

  if (caps && !caps.units[unit]?.read) return <div className="sdl-progar"><div className="panel sdl-progar__empty"><strong>Tidak ada akses</strong><p>Akun ini belum diberi kewenangan membaca persuratan unit ini.</p></div></div>
  const detail = detailId ? items?.find(s => s.id === detailId) : undefined
  const belum = mode === 'masuk' ? (items ?? []).filter(s => !s.diterimaAt).length : 0

  return <div className="sdl-progar sdl-surat">
    <div className="sdl-progar__toolbar">
      <label className="sdl-progar__year">Tampilkan
        {mode === 'masuk'
          ? <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}><option value="">Semua surat</option><option value="belum">Belum diterima{belum ? ` (${belum})` : ''}</option><option value="sudah">Sudah diterima</option></select>
          : <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}><option value="">Semua surat</option><option value="aktif">Belum dikirim</option><option value="draft">Draf</option><option value="diajukan">Menunggu persetujuan</option><option value="ditolak">Dikembalikan</option><option value="disetujui">Siap dikirim</option><option value="dikirim">Dikirim</option></select>}
      </label>
      <label className="sdl-progar__year sdl-surat__cari">Cari<input type="search" value={cari} placeholder="Nomor, perihal, unit…" onChange={e => setCari(e.target.value)} /></label>
      <span className="sdl-progar__grow" />
      <button type="button" className="btn" onClick={() => void load()}>Muat ulang</button>
      {bisaBuat && <button type="button" className="btn primary" onClick={() => setEditor({})}>＋ Surat Keluar Baru</button>}
    </div>
    <p className="sdl-progar__hint">{mode === 'masuk'
      ? <>Semua staf {UNIT_LABEL[unit]} bisa membaca surat di sini; tandai <strong>Diterima</strong> setelah dibaca. Disposisi Kabagrenmin ada di menu {onOpenDisposisi ? <button type="button" className="sdl-progar__link" onClick={onOpenDisposisi}>Disposisi</button> : 'Disposisi'}.</>
      : <>Susun surat, lampirkan naskah PDF, lalu <strong>Ajukan</strong> ke Kabagrenmin. Setelah disetujui, tekan <strong>Kirim</strong>: surat masuk ke Surat Masuk unit tujuan. Tujuan eksternal dikirim di luar sistem.</>}</p>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}

    {loading && !items ? <div className="panel sdl-progar__empty"><p>Memuat…</p></div>
      : items && shown.length === 0 ? <div className="panel sdl-progar__empty"><strong>{items.length ? 'Tidak ada surat untuk saringan ini' : mode === 'masuk' ? 'Belum ada surat masuk' : 'Belum ada surat keluar'}</strong>
        <p>{mode === 'masuk' ? 'Surat yang dikirim unit lain ke unit ini akan tampil di sini.' : bisaBuat ? 'Tekan “＋ Surat Keluar Baru” untuk menyusun surat.' : 'Surat keluar unit ini akan tampil di sini.'}</p></div>
      : items && <section className="panel sdl-progar__program sdl-progar__doclist" aria-label={mode === 'masuk' ? 'Daftar surat masuk' : 'Daftar surat keluar'}><div className="table-scroll"><table className="data-table sdl-progar__table sdl-surat__table">
        <thead><tr><th>Nomor · Perihal</th><th>{mode === 'masuk' ? 'Dari' : 'Tujuan'}</th><th>{mode === 'masuk' ? 'Dikirim' : 'Tanggal'}</th><th>Status</th><th><span className="sdl-progar__sr">Aksi</span></th></tr></thead>
        <tbody>{shown.map(s => <tr key={s.id} className="sdl-progar__row-link" onClick={e => { if (!(e.target as HTMLElement).closest('button')) setDetailId(s.id) }}>
          <td><span className="sdl-surat__nomor">{s.nomor || '–'}</span><button type="button" className="sdl-progar__open" onClick={() => setDetailId(s.id)}>{s.perihal}</button>{s.sifat === 'Kilat' && <span className="sdl-progar__tag">Kilat</span>}</td>
          <td>{mode === 'masuk' ? <span className={`sdl-surat__unit is-${s.unitPengirim}`}>{s.unitPengirimLabel}</span> : <span className="sdl-surat__tujuan">{tujuanText(s) || <span className="sdl-progar__muted">Belum dipilih</span>}</span>}</td>
          <td className="sdl-progar__num sdl-progar__nowrap">{tgl(mode === 'masuk' ? s.sentAt : s.tanggal ?? s.createdAt)}</td>
          <td>{mode === 'masuk'
            ? (s.diterimaAt ? <span className="sdl-progar__badge is-disetujui">Diterima</span> : <span className="sdl-progar__badge is-draft">Belum diterima</span>)
            : <><span className={`sdl-progar__badge ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>
              {s.status === 'dikirim' && s.tujuan.length > 0 && <small className="sdl-progar__muted sdl-surat__terima">{s.tujuan.filter(t => t.diterimaAt).length}/{s.tujuan.length} unit menerima</small>}</>}</td>
          <td><button type="button" className="sdl-progar__mini" onClick={() => setDetailId(s.id)}>Buka</button></td>
        </tr>)}</tbody>
      </table></div></section>}

    {detail && <DetailSurat key={detail.id} s={detail} unit={unit} mode={mode} canManage={canManage} userId={userId} blocked={Boolean(editor || preview)}
      onClose={() => setDetailId(null)} onEdit={() => setEditor({ surat: detail })} onPreview={(url, name) => setPreview({ url, name })} run={run} />}
    {editor && <EditorSurat unit={unit} surat={editor.surat} onClose={() => setEditor(null)} onSaved={async (id, msg) => { setEditor(null); showToast(msg, 'success'); await load(); setDetailId(id) }} />}
    {preview && <LampiranPreviewR5F15 stored={{ url: preview.url, name: preview.name, mime: 'application/pdf' }} maxBytes={20 * 1024 * 1024} title={mode === 'masuk' ? 'Surat Masuk' : 'Surat Keluar'} note="Pratinjau berkas surat." onClose={() => setPreview(null)} />}
  </div>
}

function DetailSurat({ s, unit, mode, canManage, blocked, onClose, onEdit, onPreview, run, extraActions, eyebrow }: {
  s: Surat; unit: UnitKey; mode: 'keluar' | 'masuk'; canManage: boolean; userId: string; blocked: boolean; extraActions?: React.ReactNode; eyebrow?: string
  onClose: () => void; onEdit: () => void; onPreview: (url: string, name: string) => void; run: (fn: () => Promise<unknown>, ok: string) => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [peran, setPeran] = useState<'naskah' | 'lampiran'>('naskah')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !blocked && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [blocked, onClose])
  const editable = mode === 'keluar' && canManage && (s.status === 'draft' || s.status === 'ditolak')
  const base = mode === 'keluar' ? `${BASE}/${unit}/keluar/${s.id}` : `${BASE}/${unit}/masuk/${s.id}`
  const buka = (b: Berkas) => {
    const url = `${base}/berkas/${b.id}`
    if (b.jenis === 'pdf') onPreview(url, b.filename)
    else { const a = document.createElement('a'); a.href = url; a.download = b.filename; a.click() }
  }
  const pilih = (p: 'naskah' | 'lampiran') => { setPeran(p); fileRef.current?.click() }
  async function unggah(list: FileList | null) {
    const files = list ? [...list] : []
    if (fileRef.current) fileRef.current.value = ''
    if (!files.length) return
    const salah = files.find(f => peran === 'naskah' ? !/\.pdf$/i.test(f.name) : !/\.(pdf|xlsx|docx)$/i.test(f.name))
    if (salah) { showToast(peran === 'naskah' ? `Naskah harus PDF ("${salah.name}").` : `"${salah.name}" bukan PDF, Excel (.xlsx), atau Word (.docx).`, 'error'); return }
    if (files.some(f => f.size > 20 * 1024 * 1024)) { showToast(ERRORS.file_too_large, 'error'); return }
    setBusy(true)
    await run(async () => { for (const f of (peran === 'naskah' ? files.slice(0, 1) : files)) { const fd = new FormData(); fd.append('file', f); await api(`/${unit}/keluar/${s.id}/berkas?peran=${peran}`, 'POST', fd) } },
      peran === 'naskah' ? 'Naskah disimpan.' : `${files.length} lampiran ditambahkan.`)
    setBusy(false)
  }
  const naskah = s.berkas.filter(b => b.peran !== 'lampiran'); const lampiran = s.berkas.filter(b => b.peran === 'lampiran')
  const daftarBerkas = (list: Berkas[]) => list.length ? <ul className="sdl-surat__berkas">{list.map(b => <li key={b.id}>
    <span className={`sdl-surat__jenis is-${b.jenis}`}>{b.jenis.toUpperCase()}</span>
    <span className="sdl-surat__berkas-main"><button type="button" className="sdl-progar__file is-full" onClick={() => buka(b)}>{b.jenis === 'pdf' ? '👁' : '⬇'} {b.filename}</button>
      <small className="sdl-progar__muted">{PERAN[b.peran]} · <span className="sdl-progar__num">{ukuran(b.size)}</span></small></span>
    {editable && b.peran !== 'naskah_ttd' && <button type="button" className="sdl-progar__mini" aria-label={`Hapus ${b.filename}`} onClick={async () => { if (await confirmDialog(`Hapus "${b.filename}"?`, { confirmLabel: 'Hapus' })) await run(() => api(`/${unit}/keluar/${s.id}/berkas/${b.id}`, 'DELETE'), 'Berkas dihapus.') }}>Hapus</button>}
  </li>)}</ul> : null

  return <div className="sdl-progar__shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !blocked) onClose() }}>
    <div className="sdl-progar__dialog sdl-progar__detail" role="dialog" aria-modal="true" aria-labelledby="sdl-surat-title">
      <input ref={fileRef} type="file" hidden multiple={peran === 'lampiran'} accept={peran === 'naskah' ? 'application/pdf,.pdf' : '.pdf,.xlsx,.docx,application/pdf'} onChange={e => void unggah(e.target.files)} />
      <header><span className="sdl-progar__eyebrow">{eyebrow ?? (mode === 'masuk' ? `Surat masuk dari ${s.unitPengirimLabel}` : `Surat keluar ${UNIT_LABEL[unit]}`)}</span>
        <h2 id="sdl-surat-title">{s.perihal}</h2>
        <p>{mode === 'masuk'
          ? (s.diterimaAt ? <span className="sdl-progar__badge is-disetujui">Diterima</span> : <span className="sdl-progar__badge is-draft">Belum diterima</span>)
          : <span className={`sdl-progar__badge ${STATUS[s.status].cls}`}>{STATUS[s.status].label}</span>}{s.sifat === 'Kilat' && <span className="sdl-progar__tag">Kilat</span>}</p></header>
      {mode === 'keluar' && s.status === 'ditolak' && s.reviewNote && <p className="sdl-progar__rejected">Dikembalikan {s.reviewedByName}: “{s.reviewNote}” — perbaiki lalu ajukan lagi.</p>}
      <dl className="sdl-progar__meta-list">
        <dt>Nomor</dt><dd className="sdl-progar__num">{s.nomor || '–'}</dd>
        <dt>Tanggal surat</dt><dd className="sdl-progar__num">{tgl(s.tanggal) || '–'}</dd>
        {mode === 'masuk' && <><dt>Dari</dt><dd>{s.unitPengirimLabel}</dd></>}
        <dt>Tujuan</dt><dd>{s.tujuan.length === 0 && !s.tujuanEksternal ? <span className="sdl-progar__muted">Belum dipilih</span>
          : <ul className="sdl-surat__tujuan-list">{s.tujuan.map(t => <li key={t.unit}><span className={`sdl-surat__unit is-${t.unit}`}>{KEPADA_UNIT[t.unit]}</span>
            {s.status === 'dikirim' && (t.diterimaAt ? <small className="sdl-progar__ok">✓ diterima {t.diterimaByName}, <span className="sdl-progar__num">{tgl(t.diterimaAt)}</span></small> : <small className="sdl-progar__muted">belum diterima</small>)}</li>)}
            {s.tujuanEksternal && <li><span>{s.tujuanEksternal}</span><small className="sdl-progar__muted">eksternal{s.status === 'dikirim' ? ' · dikirim di luar sistem' : ''}</small></li>}</ul>}</dd>
        {s.ringkasan && <><dt>Ringkasan</dt><dd className="sdl-progar__pre">{s.ringkasan}</dd></>}
        <dt>Disusun</dt><dd>{s.createdByName}, <span className="sdl-progar__num">{tgl(s.createdAt)}</span></dd>
        {s.reviewedByName && s.status !== 'ditolak' && <><dt>Disetujui</dt><dd>{s.reviewedByName}, <span className="sdl-progar__num">{tgl(s.reviewedAt)}</span></dd></>}
        {s.sentAt && <><dt>Dikirim</dt><dd>{s.sentByName}, <span className="sdl-progar__num">{tgl(s.sentAt)}</span></dd></>}
        {mode === 'masuk' && s.diterimaAt && <><dt>Diterima</dt><dd>{s.diterimaByName}, <span className="sdl-progar__num">{tgl(s.diterimaAt)}</span></dd></>}
      </dl>
      <section className="sdl-progar__detail-tahap" aria-label="Berkas surat">
        <h3>Naskah</h3>
        {daftarBerkas(naskah) ?? <p className="sdl-progar__muted">{editable ? 'Belum ada naskah. Unggah PDF naskah surat.' : 'Tidak ada naskah.'}</p>}
        {editable && <button type="button" className="btn" disabled={busy} onClick={() => pilih('naskah')}>{naskah.length ? 'Ganti Naskah (PDF)' : '＋ Unggah Naskah (PDF)'}</button>}
        <h3>Lampiran <span className="sdl-progar__muted sdl-progar__num">({lampiran.length})</span></h3>
        {daftarBerkas(lampiran) ?? <p className="sdl-progar__muted">Tidak ada lampiran.</p>}
        {editable && <button type="button" className="btn" disabled={busy} onClick={() => pilih('lampiran')}>＋ Tambah Lampiran</button>}
      </section>
      <footer className="sdl-progar__detail-actions">
        {mode === 'keluar' && canManage && s.status === 'draft' && !s.submittedAt && <button type="button" className="btn sdl-progar__danger sdl-progar__footer-left" onClick={async () => { if (await confirmDialog(`Hapus draf "${s.perihal}"? Nomor ${s.nomor} tidak dipakai lagi.`, { confirmLabel: 'Hapus', danger: true })) { await run(() => api(`/${unit}/keluar/${s.id}`, 'DELETE'), 'Draf dihapus.'); onClose() } }}>Hapus Draf</button>}
        {editable && <button type="button" className="btn" onClick={onEdit}>Ubah</button>}
        {editable && <button type="button" className="btn primary" onClick={async () => { if (await confirmDialog(`Ajukan "${s.perihal}" ke Kabagrenmin untuk disetujui? Surat tidak bisa diubah selama menunggu.`, { confirmLabel: 'Ajukan' })) await run(() => api(`/${unit}/keluar/${s.id}/ajukan`, 'POST', { version: s.version }), 'Surat diajukan ke Kabagrenmin.') }}>Ajukan ke Kabagrenmin</button>}
        {mode === 'keluar' && canManage && s.status === 'disetujui' && <button type="button" className="btn primary" onClick={async () => { if (await confirmDialog(`Kirim "${s.perihal}" ke ${tujuanText(s)}?${s.tujuan.length ? ' Surat langsung masuk ke Surat Masuk unit tujuan.' : ''}`, { confirmLabel: 'Kirim' })) await run(() => api(`/${unit}/keluar/${s.id}/kirim`, 'POST', { version: s.version }), 'Surat dikirim.') }}>Kirim</button>}
        {mode === 'masuk' && canManage && !s.diterimaAt && <button type="button" className="btn primary" onClick={() => void run(() => api(`/${unit}/masuk/${s.id}/terima`, 'POST', {}), 'Surat ditandai diterima.')}>Tandai Diterima</button>}
        {extraActions}
        <button type="button" className="btn" onClick={onClose}>Tutup</button>
      </footer>
    </div>
  </div>
}

/**
 * R5H21 langkah 3: antrean Kabagrenmin -- surat keluar subbag yang diajukan. Setujui
 * SELALU dengan tanda tangan (TtdNaskahR5H7 dipakai ulang), atau kembalikan dengan catatan.
 */
export function PersetujuanSuratR5H21({ userId, initialID }: { userId: string; initialID?: string }) {
  const [items, setItems] = useState<Surat[] | null>(null)
  const [error, setError] = useState('')
  const [detailId, setDetailId] = useState<string | null>(initialID ?? null)
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  const [ttd, setTtd] = useState<Surat | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const load = useCallback(async () => {
    setError('')
    try { setItems((await api<{ items: Surat[] }>('/persetujuan')).items) } catch (e) { setError(e instanceof Error ? e.message : 'Data tidak dapat dimuat.') }
  }, [])
  useEffect(() => { void load() }, [load])
  async function run(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); showToast(ok, 'success'); changed(); window.dispatchEvent(new Event('sdl:inbox-changed')); await load() } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal.', 'error') }
  }
  const detail = detailId ? items?.find(x => x.id === detailId) : undefined
  const kembalikan = (s: Surat) => setDialog({ title: 'Kembalikan Surat', eyebrow: 'PERSETUJUAN SURAT', danger: true, context: `${s.unitPengirimLabel} — ${s.perihal}`,
    fields: [{ key: 'catatan', label: 'Apa yang perlu diperbaiki?', type: 'textarea', required: true, max: 500, hint: 'Minimal 8 karakter.' }], values: { catatan: '' }, submitLabel: 'Kembalikan',
    onSubmit: async v => { await api(`/keluar/${s.id}/tolak`, 'POST', { catatan: v.catatan, version: s.version }); showToast('Surat dikembalikan ke pengirim.', 'success'); changed(); window.dispatchEvent(new Event('sdl:inbox-changed')); setDetailId(null); await load() } })

  return <div className="sdl-progar sdl-surat">
    <div className="sdl-progar__toolbar"><span className="sdl-progar__grow" /><button type="button" className="btn" onClick={() => void load()}>Muat ulang</button></div>
    <p className="sdl-progar__hint">Surat keluar Subbagren, Subbagsumda, dan Subbagbinfung yang menunggu keputusan Anda. Periksa naskahnya, lalu <strong>Tanda Tangani &amp; Setujui</strong> atau <strong>Kembalikan</strong> dengan catatan. Setelah disetujui, pengirim yang menekan Kirim.</p>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    {!items ? <div className="panel sdl-progar__empty"><p>Memuat…</p></div>
      : items.length === 0 ? <div className="panel sdl-progar__empty"><strong>Tidak ada surat yang menunggu</strong><p>Surat keluar subbag yang diajukan akan tampil di sini.</p></div>
      : <section className="panel sdl-progar__program sdl-progar__doclist" aria-label="Surat menunggu persetujuan"><div className="table-scroll"><table className="data-table sdl-progar__table sdl-surat__table">
        <thead><tr><th>Nomor · Perihal</th><th>Dari</th><th>Tujuan</th><th>Diajukan</th><th><span className="sdl-progar__sr">Aksi</span></th></tr></thead>
        <tbody>{items.map(s => <tr key={s.id} className="sdl-progar__row-link" onClick={e => { if (!(e.target as HTMLElement).closest('button')) setDetailId(s.id) }}>
          <td><span className="sdl-surat__nomor">{s.nomor}</span><button type="button" className="sdl-progar__open" onClick={() => setDetailId(s.id)}>{s.perihal}</button>{s.sifat === 'Kilat' && <span className="sdl-progar__tag">Kilat</span>}</td>
          <td><span className={`sdl-surat__unit is-${s.unitPengirim}`}>{s.unitPengirimLabel}</span></td>
          <td className="sdl-surat__tujuan">{tujuanText(s)}</td>
          <td className="sdl-progar__num sdl-progar__nowrap">{tgl(s.submittedAt)}</td>
          <td><button type="button" className="sdl-progar__mini" onClick={() => setDetailId(s.id)}>Periksa</button></td>
        </tr>)}</tbody></table></div></section>}
    {detail && !ttd && <DetailSurat key={detail.id} s={detail} unit={detail.unitPengirim} mode="keluar" canManage={false} userId={userId} blocked={Boolean(preview || ttd || dialog)}
      eyebrow={`Persetujuan · surat keluar ${detail.unitPengirimLabel}`} onClose={() => setDetailId(null)} onEdit={() => undefined} onPreview={(url, name) => setPreview({ url, name })} run={run}
      extraActions={<><button type="button" className="btn sdl-progar__danger" onClick={() => kembalikan(detail)}>Kembalikan</button>
        <button type="button" className="btn primary" onClick={() => { if (!detail.berkas.some(b => b.peran === 'naskah')) { showToast(ERRORS.naskah_belum_ada, 'error'); return } setTtd(detail) }}>Tanda Tangani &amp; Setujui</button></>} />}
    {ttd && <TtdNaskahR5H7 registerId={ttd.id} workRecordId="" version={ttd.version} title={ttd.perihal}
      files={ttd.berkas.filter(b => b.peran === 'naskah').map(b => ({ id: b.id, name: b.filename }))}
      fileUrl={fid => `${BASE}/${ttd.unitPengirim}/keluar/${ttd.id}/berkas/${fid}`} signUrl={`${BASE}/keluar/${ttd.id}/ttd-setujui`}
      onClose={() => setTtd(null)} onDone={msg => { setTtd(null); setDetailId(null); showToast(msg, 'success'); changed(); window.dispatchEvent(new Event('sdl:inbox-changed')); void load() }} />}
    {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
    {preview && <LampiranPreviewR5F15 stored={{ url: preview.url, name: preview.name, mime: 'application/pdf' }} maxBytes={20 * 1024 * 1024} title="Persetujuan Surat" note="Periksa isi naskah sebelum menandatangani." onClose={() => setPreview(null)} />}
  </div>
}

/**
 * R5H21 langkah 4: di detail surat keluar Urmin yang sudah disetujui -- kirim salinannya
 * ke Surat Masuk unit internal (naskah bertanda tangan ikut), atau tampilkan status kirimannya.
 */
export function KirimInternalUrmin({ registerId, approved, rahasia, kepada }: { registerId: string; approved: boolean; rahasia: boolean; kepada?: string }) {
  const [item, setItem] = useState<Surat | null | undefined>(undefined)
  const [can, setCan] = useState(false)
  // "Kepada" standar (mis. Subbagren / Seluruh Subbag) langsung mencentang unitnya.
  const [pilih, setPilih] = useState<UnitKey[]>(() => unitDariKepada(kepada).filter(u => u !== 'urmin'))
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    try {
      const [c, d] = await Promise.all([api<Caps>('/capabilities'), api<{ item: Surat | null }>(`/dari-urmin/${registerId}`)])
      setCan(Boolean(c.units.urmin?.manage)); setItem(d.item)
    } catch { setItem(null); setCan(false) }
  }, [registerId])
  useEffect(() => { if (approved) void load() }, [approved, load])
  if (!approved || item === undefined) return null
  if (item) return <div className="sdl-surat-urmin"><h3 className="sdl-outgoing-workflow-subtitle">Dikirim ke Unit Internal</h3>
    <ul className="sdl-surat__tujuan-list">{item.tujuan.map(t => <li key={t.unit}><span className={`sdl-surat__unit is-${t.unit}`}>{KEPADA_UNIT[t.unit]}</span>
      {t.diterimaAt ? <small className="sdl-progar__ok">✓ diterima {t.diterimaByName}, {tgl(t.diterimaAt)}</small> : <small className="sdl-progar__muted">belum diterima</small>}</li>)}</ul>
    <p className="urmin-file-hint">Dikirim {item.sentByName}, {tgl(item.sentAt)}.</p></div>
  if (!can) return null
  if (rahasia) return <p className="urmin-file-hint">Surat berklasifikasi Rahasia tidak dikirim ke Surat Masuk unit lain.</p>
  async function kirim() {
    if (!pilih.length) { showToast('Pilih minimal satu unit tujuan.', 'error'); return }
    setBusy(true)
    try { await api(`/dari-urmin/${registerId}`, 'POST', { tujuanUnit: pilih }); showToast('Surat dikirim ke Surat Masuk unit tujuan.', 'success'); setOpen(false); await load() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Gagal mengirim.', 'error') } finally { setBusy(false) }
  }
  return <div className="sdl-surat-urmin"><h3 className="sdl-outgoing-workflow-subtitle">Kirim ke Unit Internal</h3>
    {!open ? <><p className="urmin-file-hint">Surat sudah disetujui. Kirim salinannya (naskah bertanda tangan) ke Surat Masuk subbag yang dituju.</p>
      <button type="button" className="sumda-button sumda-button-primary" onClick={() => setOpen(true)}>{pilih.length ? `Kirim ke ${pilih.map(u => KEPADA_UNIT[u]).join(', ')}` : 'Kirim ke unit internal'}</button></>
      : <><fieldset className="sdl-surat__units"><legend>Unit tujuan</legend>{(['subbagren', 'subbagsumda', 'subbagbinfung'] as UnitKey[]).map(u => <label key={u} className="sdl-progar__check"><input type="checkbox" checked={pilih.includes(u)} onChange={e => setPilih(x => e.target.checked ? [...x, u] : x.filter(y => y !== u))} /> {KEPADA_UNIT[u]}</label>)}</fieldset>
        {kepada && unitDariKepada(kepada).length === 0 && <p className="urmin-file-hint">“Kepada” surat ini bukan tujuan internal standar ({kepada}); pilih unitnya sendiri.</p>}
        <div className="sdl-surat-urmin__aksi"><button type="button" className="sumda-button sumda-button-cancel" disabled={busy} onClick={() => setOpen(false)}>Batal</button><button type="button" className="sumda-button sumda-button-primary" disabled={busy} onClick={() => void kirim()}>{busy ? 'Mengirim…' : 'Kirim'}</button></div></>}
  </div>
}

/** Jumlah surat menunggu persetujuan Kabagrenmin (untuk Inbox & sidebar). */
export async function loadPersetujuanSurat(): Promise<Surat[]> {
  try { const r = await fetch(`${BASE}/persetujuan`, { credentials: 'same-origin', cache: 'no-store' }); return r.ok ? ((await r.json()) as { items: Surat[] }).items : [] } catch { return [] }
}

function EditorSurat({ unit, surat, onClose, onSaved }: { unit: UnitKey; surat?: Surat; onClose: () => void; onSaved: (id: string, msg: string) => Promise<void> }) {
  const [v, setV] = useState({
    perihal: surat?.perihal ?? '', tanggal: surat?.tanggal ?? new Date().toISOString().slice(0, 10), sifat: surat?.sifat ?? 'Biasa',
    jenisSurat: surat?.jenisSurat ?? '', kodeArsip: surat?.kodeArsip ?? '', ringkasan: surat?.ringkasan ?? '', tujuanEksternal: surat?.tujuanEksternal ?? '',
  })
  const [tujuan, setTujuan] = useState<UnitKey[]>(surat?.tujuan.map(t => t.unit) ?? [])
  const [jenis, setJenis] = useState<{ code: string; name: string }[]>([])
  const [arsip, setArsip] = useState<{ code: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (!surat) api<{ items: { code: string; name: string }[] }>('/api/v1/urmin/jenis-surat').then(d => setJenis(d.items)).catch(() => setJenis([])) }, [surat])
  useEffect(() => {
    if (surat) return
    const q = v.kodeArsip.trim()
    const h = setTimeout(() => { api<{ items: { code: string; name: string }[] }>(`/api/v1/urmin/kode-arsip?q=${encodeURIComponent(q)}`).then(d => setArsip(d.items)).catch(() => setArsip([])) }, 200)
    return () => clearTimeout(h)
  }, [v.kodeArsip, surat])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (v.perihal.trim().length < 3) { setError('Perihal wajib diisi (minimal 3 karakter).'); return }
    if (!surat && !v.jenisSurat) { setError('Pilih jenis surat.'); return }
    if (!surat && !v.kodeArsip.trim()) { setError('Pilih kode arsip.'); return }
    setBusy(true); setError('')
    try {
      const common = { perihal: v.perihal.trim(), tanggal: v.tanggal, ringkasan: v.ringkasan.trim(), tujuanUnit: tujuan, tujuanEksternal: v.tujuanEksternal.trim() }
      if (surat) {
        await api(`/${unit}/keluar/${surat.id}`, 'PUT', { ...common, version: surat.version })
        await onSaved(surat.id, 'Surat diperbarui.')
      } else {
        const r = await api<{ id: string; nomor: string }>(`/${unit}/keluar`, 'POST', { ...common, sifat: v.sifat, jenisSurat: v.jenisSurat, kodeArsip: v.kodeArsip.trim() })
        changed()
        await onSaved(r.id, `Draf disimpan dengan nomor ${r.nomor}. Unggah naskah PDF-nya.`)
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Gagal menyimpan.') } finally { setBusy(false) }
  }

  return <div className="sdl-progar__shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <form className="sdl-progar__dialog sdl-surat__editor" role="dialog" aria-modal="true" aria-labelledby="sdl-surat-editor-title" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">Surat keluar {UNIT_LABEL[unit]}</span><h2 id="sdl-surat-editor-title">{surat ? 'Ubah Surat' : 'Surat Keluar Baru'}</h2>
        {surat ? <p>Nomor <span className="sdl-progar__num">{surat.nomor}</span> · jenis, kode arsip, dan sifat tidak berubah.</p> : <p>Nomor surat dibuat otomatis saat draf disimpan.</p>}</header>
      <div className="sdl-progar__fields">
        <label><span>Perihal<b aria-hidden="true"> *</b></span><input maxLength={240} value={v.perihal} autoFocus onChange={set('perihal')} /></label>
        <label className="is-half"><span>Tanggal surat</span><input type="date" value={v.tanggal ?? ''} onChange={set('tanggal')} /></label>
        {!surat && <>
          <label className="is-half"><span>Sifat</span><select value={v.sifat} onChange={set('sifat')}><option value="Biasa">Biasa</option><option value="Kilat">Kilat</option></select></label>
          <label className="is-half"><span>Jenis surat<b aria-hidden="true"> *</b></span><select value={v.jenisSurat} onChange={set('jenisSurat')}><option value="">— Pilih —</option>{jenis.map(j => <option key={j.code} value={j.code}>{j.code} — {j.name}</option>)}</select></label>
          <label className="is-half"><span>Kode arsip<b aria-hidden="true"> *</b></span><input list="sdl-surat-arsip" maxLength={16} value={v.kodeArsip} placeholder="Ketik kode atau nama" onChange={e => setV(x => ({ ...x, kodeArsip: e.target.value.toUpperCase().replace(/\s.*$/, '') }))} />
            <datalist id="sdl-surat-arsip">{arsip.map(a => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist></label>
        </>}
        <fieldset className="sdl-surat__units"><legend>Kepada (internal Bagrenmin)</legend>
          {UNITS.filter(u => u !== unit).map(u => <label key={u} className="sdl-progar__check"><input type="checkbox" checked={tujuan.includes(u)} onChange={e => setTujuan(t => e.target.checked ? [...t, u] : t.filter(x => x !== u))} /> {KEPADA_UNIT[u]}</label>)}
          {unit !== 'urmin' && <button type="button" className="sdl-progar__mini" onClick={() => setTujuan(UNITS.filter(u => u !== unit && u !== 'urmin'))}>Seluruh Subbag</button>}
        </fieldset>
        <label><span>Kepada (eksternal)</span><input maxLength={500} value={v.tujuanEksternal} placeholder="mis. Biro Renmin Polri (kosongkan bila tidak ada)" onChange={set('tujuanEksternal')} /><small>Dikirim di luar sistem; di aplikasi hanya dicatat.</small></label>
        <label><span>Ringkasan isi</span><textarea rows={3} maxLength={2000} value={v.ringkasan} onChange={set('ringkasan')} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : surat ? 'Simpan' : 'Simpan Draf'}</button></footer>
    </form>
  </div>
}

