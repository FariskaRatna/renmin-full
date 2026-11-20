import { useCallback, useEffect, useRef, useState } from 'react'
import { confirmDialog, showToast } from './UIFeedback'
import './TindakLanjutR5H23.css'

/**
 * R5H23 (2026-11-19): tindak lanjut arahan/disposisi. Setelah arahan DITERIMA, tiap penerima
 * punya satu laporan (teks bebas, bisa diubah) dengan lampiran banyak (maks 10; PDF, gambar,
 * Excel, Word). Terlihat oleh pemberi arahan dan semua penerima arahan yang sama.
 * API: /api/v1/leadership/directives/:id/tindak-lanjut (Express saja, migrasi 066).
 */

type Berkas = { id: string; jenis: 'pdf' | 'png' | 'jpg' | 'xlsx' | 'docx'; filename: string; size: number; uploadedAt: string }
type Entri = { recipientId: string; name: string; section: string | null; acknowledgedAt: string | null; milikSaya: boolean; isi: string; version: number; updatedAt: string | null; berkas: Berkas[] }
type Data = { bisaTulis: boolean; items: Entri[] }

const BASE = '/api/v1/leadership/directives'
const MAX_FILES = 10
const ERRORS: Record<string, string> = {
  belum_diterima: 'Tekan Terima dulu sebelum menulis tindak lanjut.',
  access_denied: 'Hanya penerima arahan yang bisa menulis tindak lanjut.',
  version_conflict: 'Tindak lanjut sudah diubah di tempat lain. Muat ulang lalu coba lagi.',
  invalid_file_type: 'Berkas harus PDF, gambar (PNG/JPG), Excel (.xlsx), atau Word (.docx) yang valid.',
  file_too_large: 'Ukuran berkas maksimal 20 MB.',
  batas_lampiran: `Lampiran paling banyak ${MAX_FILES} berkas.`,
  invalid_input: 'Isi tindak lanjut maksimal 4.000 karakter.',
  not_found: 'Arahan atau lampiran tidak ditemukan.',
}
async function api<T>(path: string, method: 'GET' | 'PUT' | 'POST' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') {
    const c = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!c.ok) throw Error('Sesi keamanan tidak tersedia. Silakan login kembali.')
    headers['X-CSRF-Token'] = ((await c.json()) as { csrfToken: string }).csrfToken
  }
  const form = body instanceof FormData
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
  const r = await fetch(`${BASE}${path}`, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}) })
  if (!r.ok) { const e: { error?: string } = await r.json().catch(() => ({})); throw Error(ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}).`) }
  return r.json() as Promise<T>
}
const waktu = (iso: string | null) => iso ? new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
const ukuran = (n: number) => n >= 1048576 ? `${(n / 1048576).toLocaleString('id-ID', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
const JENIS: Record<Berkas['jenis'], string> = { pdf: 'PDF', png: 'IMG', jpg: 'IMG', xlsx: 'XLSX', docx: 'DOCX' }

export function TindakLanjutR5H23({ directiveId }: { directiveId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [isi, setIsi] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const load = useCallback(async () => {
    try { const d = await api<Data>(`/${directiveId}/tindak-lanjut`); setData(d); setIsi(d.items.find(x => x.milikSaya)?.isi ?? ''); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Tindak lanjut tidak dapat dimuat.') }
  }, [directiveId])
  useEffect(() => { void load() }, [load])

  if (error && !data) return <section className="sdl-tl" aria-label="Tindak lanjut"><h3>Tindak Lanjut</h3><p className="sdl-tl__muted">{error}</p></section>
  if (!data) return <section className="sdl-tl" aria-label="Tindak lanjut"><h3>Tindak Lanjut</h3><p className="sdl-tl__muted">Memuat…</p></section>
  const saya = data.items.find(x => x.milikSaya)
  const lain = data.items.filter(x => !x.milikSaya)
  const terisi = (x: Entri) => x.isi.trim() !== '' || x.berkas.length > 0
  const berubah = saya ? isi.trim() !== saya.isi : isi.trim() !== ''

  async function simpan() {
    setBusy(true)
    try { await api(`/${directiveId}/tindak-lanjut`, 'PUT', { isi, version: saya?.version ?? 0 }); showToast('Tindak lanjut disimpan.', 'success'); await load() }
    catch (e) { showToast(e instanceof Error ? e.message : 'Gagal menyimpan.', 'error') } finally { setBusy(false) }
  }
  async function unggah(list: FileList | null) {
    const files = list ? [...list] : []
    if (fileRef.current) fileRef.current.value = ''
    if (!files.length) return
    const sisa = MAX_FILES - (saya?.berkas.length ?? 0)
    if (files.length > sisa) { showToast(`Sisa kuota lampiran ${sisa} berkas.`, 'error'); return }
    const salah = files.find(f => !/\.(pdf|png|jpe?g|xlsx|docx)$/i.test(f.name)); if (salah) { showToast(`"${salah.name}": ${ERRORS.invalid_file_type}`, 'error'); return }
    if (files.some(f => f.size > 20 * 1024 * 1024)) { showToast(ERRORS.file_too_large, 'error'); return }
    setBusy(true); let ok = 0
    try {
      // Teks yang belum disimpan ikut disimpan dulu supaya tidak hilang saat daftar dimuat ulang.
      if (berubah) await api(`/${directiveId}/tindak-lanjut`, 'PUT', { isi, version: saya?.version ?? 0 })
      for (const f of files) { const fd = new FormData(); fd.append('file', f); await api(`/${directiveId}/tindak-lanjut/berkas`, 'POST', fd); ok++ }
      showToast(`${ok} lampiran ditambahkan.`, 'success')
    } catch (e) { showToast(`${ok ? `${ok} lampiran tersimpan; ` : ''}${e instanceof Error ? e.message : 'Gagal mengunggah.'}`, 'error') }
    finally { setBusy(false); void load() }
  }
  async function hapus(b: Berkas) {
    if (!await confirmDialog(`Hapus lampiran "${b.filename}"?`, { confirmLabel: 'Hapus' })) return
    try { await api(`/${directiveId}/tindak-lanjut/berkas/${b.id}`, 'DELETE'); showToast('Lampiran dihapus.', 'success'); await load() } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal.', 'error') }
  }
  const daftarBerkas = (x: Entri, bisaHapus: boolean) => x.berkas.length > 0 && <ul className="sdl-tl__files">{x.berkas.map(b => <li key={b.id}>
    <span className={`sdl-tl__jenis is-${b.jenis}`}>{JENIS[b.jenis]}</span>
    <a href={`${BASE}/${directiveId}/tindak-lanjut/berkas/${b.id}`} download={b.filename} title={`Unduh ${b.filename}`}>{b.filename}</a>
    <small>{ukuran(b.size)}</small>
    {bisaHapus && <button type="button" onClick={() => void hapus(b)} disabled={busy} aria-label={`Hapus ${b.filename}`}>Hapus</button>}
  </li>)}</ul>

  return <section className="sdl-tl" aria-label="Tindak lanjut">
    <h3>Tindak Lanjut</h3>
    {saya && (data.bisaTulis ? <div className="sdl-tl__editor">
      <label htmlFor={`tl-${directiveId}`}>Laporan tindak lanjut Anda</label>
      <textarea id={`tl-${directiveId}`} rows={4} maxLength={4000} value={isi} placeholder="Tuliskan apa yang sudah/akan dikerjakan…" onChange={e => setIsi(e.target.value)} />
      <input ref={fileRef} type="file" hidden multiple accept=".pdf,.png,.jpg,.jpeg,.xlsx,.docx,application/pdf,image/png,image/jpeg" onChange={e => void unggah(e.target.files)} />
      {daftarBerkas(saya, true)}
      <div className="sdl-tl__bar">
        <button type="button" className="sdl-tl__btn" disabled={busy || (saya.berkas.length >= MAX_FILES)} onClick={() => fileRef.current?.click()}>＋ Lampiran</button>
        <small>{saya.berkas.length}/{MAX_FILES} · PDF, gambar, Excel, Word · maks. 20 MB/berkas</small>
        <button type="button" className="sdl-tl__btn is-primary" disabled={busy || !berubah} onClick={() => void simpan()}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </div>
      {saya.updatedAt && <small className="sdl-tl__muted">Terakhir diperbarui {waktu(saya.updatedAt)}</small>}
    </div> : <p className="sdl-tl__muted">Tekan Terima dulu, lalu tuliskan tindak lanjut Anda di sini.</p>)}
    {(saya ? lain : data.items).length > 0 && <div className="sdl-tl__others">
      {saya && <h4>Tindak lanjut penerima lain</h4>}
      {(saya ? lain : data.items).map(x => <article key={x.recipientId} className={`sdl-tl__entry${terisi(x) ? '' : ' is-empty'}`}>
        <header><strong>{x.name}</strong>{x.updatedAt && terisi(x) && <small>{waktu(x.updatedAt)}</small>}</header>
        {terisi(x) ? <>{x.isi && <p>{x.isi}</p>}{daftarBerkas(x, false)}</> : <p className="sdl-tl__muted">{x.acknowledgedAt ? 'Sudah diterima, belum ada tindak lanjut.' : 'Belum diterima.'}</p>}
      </article>)}
    </div>}
  </section>
}
