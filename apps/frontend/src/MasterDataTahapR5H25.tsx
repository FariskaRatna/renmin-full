import { useCallback, useEffect, useState } from 'react'
import { showToast } from './UIFeedback'
import './MasterDataTahapR5H25.css'

/**
 * R5H25 (2026-11-22): tab "Subbagren — Tahap Pekerjaan" di halaman Master Data Superadmin.
 * Superadmin menyalakan/mematikan tahap per jenis dokumen PROGAR/DALGAR. Tahap nonaktif tidak
 * ditawarkan saat MENAMBAH tahap; tahap yang sudah tercatat tetap utuh. Tahap syarat sistem
 * terkunci, minimal satu tahap aktif per jenis, alasan wajib (docs/R5H25-MASTER-DATA-TAHAP-PEKERJAAN.md).
 * API: /api/v1/admin/master/tahap-pekerjaan (Express saja, migrasi 067).
 */

type Tahap = { key: string; label: string; aktif: boolean; terkunci: boolean; alasanKunci?: string }
type Jenis = { key: string; label: string; kelompok: 'progar' | 'dalgar'; tahap: Tahap[] }
type Data = { version: number; jenis: Jenis[] }

const URL = '/api/v1/admin/master/tahap-pekerjaan'
const KELOMPOK: { key: Jenis['kelompok']; label: string; blurb: string }[] = [
  { key: 'progar', label: 'PROGAR', blurb: 'Dokumen perencanaan: tahap langsung berlaku tanpa pengecekan.' },
  { key: 'dalgar', label: 'DALGAR', blurb: 'Laporan dan revisi anggaran: tiap tahap dicek Kasubbagren.' },
]
const ERRORS: Record<string, string> = {
  version_conflict: 'Pengaturan sudah diubah di tempat lain. Daftar dimuat ulang; periksa lalu simpan lagi.',
  tahap_terkunci: 'Tahap terkunci tidak bisa dinonaktifkan.',
  minimal_satu_tahap: 'Setiap jenis dokumen harus menyisakan minimal satu tahap aktif.',
  invalid_input: 'Alasan harus 8–500 karakter.',
  invalid_request: 'Permintaan tidak valid. Muat ulang halaman.',
}

async function call<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') {
    const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!csrf.ok) throw Object.assign(new Error('Sesi berakhir. Silakan masuk kembali.'), { code: 'csrf' })
    headers['X-CSRF-Token'] = ((await csrf.json()) as { csrfToken: string }).csrfToken
    headers['Content-Type'] = 'application/json'
  }
  const r = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!r.ok) {
    const e: { error?: string } = await r.json().catch(() => ({}))
    const msg = ERRORS[e.error ?? ''] ?? (r.status === 403 ? 'Hanya Superadmin yang dapat mengelola master data.' : r.status === 404 ? 'Layanan Master Data tahap belum tersedia di server ini.' : 'Permintaan belum berhasil. Silakan coba lagi.')
    throw Object.assign(new Error(msg), { code: e.error })
  }
  return r.json() as Promise<T>
}

function JenisRow({ j, version, onSaved, onConflict }: { j: Jenis; version: number; onSaved: () => Promise<void>; onConflict: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const aktifOf = (t: Tahap) => draft[t.key] ?? t.aktif
  const jumlahAktif = j.tahap.filter(aktifOf).length
  const nonaktifTersimpan = j.tahap.filter(t => !t.aktif).length
  const ubah = Object.entries(draft).filter(([k, v]) => j.tahap.find(t => t.key === k)?.aktif !== v)
  const alasanOk = reason.trim().length >= 8 && [...reason.trim()].length <= 500

  function toggle(t: Tahap) {
    const next = !aktifOf(t)
    setDraft(d => { const n = { ...d }; if (next === t.aktif) delete n[t.key]; else n[t.key] = next; return n })
  }
  function batal() { setDraft({}); setReason('') }
  async function simpan() {
    setBusy(true)
    try {
      await call(`${URL}/${j.key}`, 'PUT', { aktif: Object.fromEntries(ubah), reason: reason.trim(), version })
      showToast(`Tahap ${j.label} disimpan.`, 'success')
      batal(); await onSaved()
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Gagal menyimpan.', 'error')
      if ((e as { code?: string }).code === 'version_conflict') { batal(); await onConflict() }
    } finally { setBusy(false) }
  }

  return <li className={`sdl-mtahap__jenis${open ? ' is-open' : ''}`}>
    <button type="button" className="sdl-mtahap__toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="sdl-mtahap__caret" aria-hidden="true">▸</span>
      <strong>{j.label}</strong>
      <span className="sdl-mtahap__count">{jumlahAktif} dari {j.tahap.length} tahap aktif</span>
      {nonaktifTersimpan > 0 && <span className="sdl-mtahap__chip">{nonaktifTersimpan} nonaktif</span>}
      {ubah.length > 0 && <span className="sdl-mtahap__chip is-draft">{ubah.length} belum disimpan</span>}
    </button>
    {open && <div className="sdl-mtahap__body">
      <ol className="sdl-mtahap__list">{j.tahap.map((t, i) => {
        const on = aktifOf(t)
        const terakhir = on && jumlahAktif === 1
        const kunci = t.terkunci || terakhir
        const id = `mt-${j.key}-${t.key}`
        return <li key={t.key} className={`${on ? '' : 'is-off'}${t.key in draft ? ' is-changed' : ''}`}>
          <span className="sdl-mtahap__no">{i + 1}</span>
          <label htmlFor={id} className="sdl-mtahap__label">
            <span>{t.label}</span>
            {t.terkunci && <small>Terkunci: {t.alasanKunci}</small>}
            {!t.terkunci && terakhir && <small>Tahap aktif terakhir; minimal satu tahap harus aktif.</small>}
          </label>
          <span className="sdl-mtahap__state">{t.terkunci ? 'Terkunci' : on ? 'Aktif' : 'Nonaktif'}</span>
          <input id={id} type="checkbox" role="switch" className="sdl-mtahap__switch" checked={on} disabled={kunci || busy} onChange={() => toggle(t)}
            aria-describedby={kunci ? `${id}-why` : undefined} />
          {kunci && <span id={`${id}-why`} hidden>{t.terkunci ? t.alasanKunci : 'Minimal satu tahap harus aktif.'}</span>}
        </li>
      })}</ol>
      {ubah.length > 0 && <div className="sdl-mtahap__save">
        <label htmlFor={`mt-${j.key}-alasan`}>Alasan perubahan <small>(wajib, 8–500 karakter; tercatat di jejak audit)</small></label>
        <textarea id={`mt-${j.key}-alasan`} rows={2} maxLength={500} value={reason} placeholder="Mis. tahap ini tidak dipakai Subbagren sejak TA 2027." onChange={e => setReason(e.target.value)} />
        <div className="sdl-mtahap__actions">
          <button type="button" className="btn" disabled={busy} onClick={batal}>Batal</button>
          <button type="button" className="btn primary" disabled={busy || !alasanOk} onClick={() => void simpan()}>{busy ? 'Menyimpan…' : `Simpan ${ubah.length} perubahan`}</button>
        </div>
      </div>}
    </div>}
  </li>
}

export default function MasterDataTahapR5H25() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setData(await call<Data>(URL)); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Gagal memuat.') }
  }, [])
  useEffect(() => { void load() }, [load])

  return <section className="panel sdl-master sdl-mtahap" aria-label="Tahap pekerjaan Subbagren">
    <div className="sdl-master__head"><div>
      <h3>Tahap Pekerjaan Subbagren</h3>
      <p>Pilih tahap yang ditawarkan saat operator menambah tahap pada dokumen PROGAR dan DALGAR.
        Tahap yang dinonaktifkan tidak muncul lagi sebagai pilihan; tahap yang sudah tercatat di dokumen tetap utuh dan bisa diubah.</p>
    </div></div>
    <p className="sdl-master__limit">Tahap yang menjadi syarat sistem terkunci, dan setiap jenis dokumen harus menyisakan minimal satu tahap aktif.
      Operator melihat perubahan setelah memuat ulang halamannya.</p>
    {error && !data && <p className="sdl-master__empty">{error} <button type="button" className="btn" onClick={() => void load()}>Coba lagi</button></p>}
    {!error && !data && <p className="sdl-master__empty">Memuat…</p>}
    {data && KELOMPOK.map(k => {
      const list = data.jenis.filter(j => j.kelompok === k.key)
      return <div key={k.key} className="sdl-mtahap__group">
        <h4>{k.label} <small>{k.blurb}</small></h4>
        <ul className="sdl-mtahap__jenislist">{list.map(j => <JenisRow key={j.key} j={j} version={data.version} onSaved={load} onConflict={load} />)}</ul>
      </div>
    })}
  </section>
}
