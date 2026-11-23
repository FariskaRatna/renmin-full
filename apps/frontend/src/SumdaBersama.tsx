import { useEffect, useRef, useState, type ReactNode } from 'react'
import { LampiranPreviewR5F15 } from './LampiranPreviewR5F15'
import { confirmDialog, showToast } from './UIFeedback'

/**
 * Helper bersama layar Subbagsumda (R5H27 Master Personel, R5H28 Karier & Mutasi).
 * Diekstrak dari SumdaPersonelR5H27.tsx tanpa mengubah perilaku.
 */

export const SUMDA_BASE = '/api/v1/subbagsumda'
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

/** Endpoint tidak dikenal server (mis. prefix dikembalikan ke Go): balasan 404 berupa teks, bukan JSON. */
export class TidakTersedia extends Error {}
export class ApiError extends Error { constructor(public code: string, message: string) { super(message) } }

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/**
 * Pemanggil API per modul: `errors` memetakan kode galat ke pesan, `pesan404` dipakai bila server
 * tidak mengenal endpoint. `body` FormData dikirim apa adanya (multipart), selainnya JSON.
 */
export function makeApi(errors: Record<string, string>, pesan404: string) {
  return async function api<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
    const headers: Record<string, string> = {}
    if (method !== 'GET') {
      const c = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
      if (!c.ok) throw Error('Sesi keamanan tidak tersedia. Silakan login kembali.')
      headers['X-CSRF-Token'] = ((await c.json()) as { csrfToken: string }).csrfToken
    }
    const form = body instanceof FormData
    if (body !== undefined && !form) headers['Content-Type'] = 'application/json'
    const r = await fetch(`${SUMDA_BASE}${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', headers,
      ...(body !== undefined ? { body: form ? body : JSON.stringify(body) } : {}),
    })
    const json = (r.headers.get('content-type') ?? '').includes('application/json')
    if (r.status === 404 && !json) throw new TidakTersedia(pesan404)
    if (!r.ok) {
      const e: { error?: string } = json ? await r.json().catch(() => ({})) : {}
      const code = e.error ?? `http_${r.status}`
      throw new ApiError(code, errors[code] ?? `Permintaan gagal (HTTP ${r.status}).`)
    }
    return r.status === 204 ? (undefined as T) : (await r.json() as T)
  }
}

/** 'YYYY-MM-DD' -> '23 Nov 2026' tanpa melewati zona waktu browser. */
export function tgl(d: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '—'
  return `${Number(d.slice(8, 10))} ${BULAN[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
}
export function waktu(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).format(d)
}

export function Shade({ children, onClose, label, busy = false }: { children: ReactNode; onClose: () => void; label: string; busy?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  return <div className="sdl-progar__shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <div className="sdl-progar__dialog sdl-sumda__dialog" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
  </div>
}

export type LampiranItem = { id: string; filename: string; size: number; uploadedBy?: string; uploadedByName?: string }
export const MAKS_PDF = 5 * 1024 * 1024

/**
 * Daftar lampiran PDF tersegel (R5H29; pola SumdaKarierR5H28): pratinjau, unggah (nama non-ASCII diganti
 * '_' karena server membaca nama multipart sebagai Latin-1), dan hapus. Otorisasi tetap di server;
 * `bisaUnggah`/`bisaHapus` hanya menyembunyikan tombol.
 */
export function LampiranPdf({ judul, items, urlUnduh, unggah, hapus, bisaUnggah, bisaHapus, maks = 10 }: {
  judul: string; items: LampiranItem[]; urlUnduh: (l: LampiranItem) => string
  unggah: (fd: FormData) => Promise<unknown>; hapus: (l: LampiranItem) => Promise<unknown>
  bisaUnggah: boolean; bisaHapus: (l: LampiranItem) => boolean; maks?: number
}) {
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<LampiranItem | null>(null)
  const ref = useRef<HTMLInputElement | null>(null)
  async function pilih(f: File) {
    if (f.size > MAKS_PDF) { showToast('Berkas lebih dari 5 MB.', 'error'); return }
    const fd = new FormData(); fd.append('file', f, f.name.replace(/[^\x20-\x7e]/g, '_'))
    setBusy(true)
    try { await unggah(fd); showToast('Lampiran diunggah.') } catch (e) { showToast((e as Error).message, 'error') }
    finally { setBusy(false); if (ref.current) ref.current.value = '' }
  }
  async function buang(l: LampiranItem) {
    if (!(await confirmDialog(`Hapus lampiran ${l.filename}?`, { confirmLabel: 'Hapus', danger: true }))) return
    try { await hapus(l); showToast('Lampiran dihapus.') } catch (e) { showToast((e as Error).message, 'error') }
  }
  return <section className="sdl-sumda__riwayat" aria-label={judul}>
    <strong>{judul} ({items.length}/{maks})</strong>
    {items.length === 0 ? <p className="sdl-sumda__muted">Belum ada lampiran.</p>
      : <ol className="sdl-karier__lampiran">{items.map(l => <li key={l.id}>
        <button type="button" className="sdl-sumda__link" onClick={() => setPreview(l)}>{l.filename}</button>
        <span className="sdl-sumda__muted">{l.size < 1024 ? '< 1 KB' : `${Math.round(l.size / 1024)} KB`}{l.uploadedByName ? ` · ${l.uploadedByName}` : ''}</span>
        {bisaHapus(l) ? <button type="button" className="btn sdl-progar__danger" onClick={() => void buang(l)}>Hapus</button> : <span />}
      </li>)}</ol>}
    {bisaUnggah && items.length < maks && <>
      <input ref={ref} type="file" accept="application/pdf,.pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void pilih(f) }} />
      <button type="button" className="btn" disabled={busy} onClick={() => ref.current?.click()}>Unggah PDF (maks. 5 MB)</button></>}
    {preview && <LampiranPreviewR5F15 stored={{ url: urlUnduh(preview), name: preview.filename, mime: 'application/pdf' }} maxBytes={MAKS_PDF} title={judul} note="Pratinjau berkas pendukung." onClose={() => setPreview(null)} />}
  </section>
}
