import { useEffect, type ReactNode } from 'react'

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
