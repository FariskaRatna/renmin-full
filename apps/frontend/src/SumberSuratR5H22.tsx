import { useEffect, useState } from 'react'

/**
 * R5H22 (2026-11-19): tahap "menerima surat/undangan" Subbagren bisa menautkan sumbernya:
 *   - Disposisi Kabagrenmin (berinduk surat masuk Urmin)  GET /api/v1/leadership/directives/inbox
 *   - Surat Masuk antar-unit Subbagren (R5H21)             GET /api/v1/persuratan/subbagren/masuk
 *   - atau diisi manual seperti biasa.
 * Keputusan pemilik: HANYA tautan (PDF dibuka dari sumbernya, tidak disalin); status diterima
 * Surat Masuk tidak berubah. Memilih sumber mengisi nomor/tanggal/pengirim/perihal tahap.
 */

export type SumberJenis = 'disposisi' | 'surat_masuk'
export type Sumber = { jenis: SumberJenis; id: string; label: string }
export type IsiSumber = { nomor: string; tanggal: string; dari: string; perihal: string }
type Opsi = Sumber & { isi: IsiSumber; info: string }

type Directive = { id: string; title: string; issuerName: string; createdAt: string; incomingId?: string; sheet?: { letterNumber?: string; letterDate?: string; letterFrom?: string; subject?: string } }
type SuratMasuk = { id: string; nomor: string; tanggal: string | null; perihal: string; unitPengirimLabel: string; sentAt: string | null; diterimaAt?: string | null }

export const SUMBER_LABEL: Record<SumberJenis, string> = { disposisi: 'Disposisi', surat_masuk: 'Surat Masuk' }
const tgl = (iso?: string | null) => iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
const join = (...p: (string | undefined | null)[]) => p.filter(Boolean).join(' · ')

let cache: Promise<Record<SumberJenis, Opsi[]>> | null = null
async function get<T>(url: string): Promise<T | null> {
  try { const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' }); return r.ok ? (await r.json()) as T : null } catch { return null }
}
function muat(): Promise<Record<SumberJenis, Opsi[]>> {
  cache ??= Promise.all([
    get<{ items?: Directive[] }>('/api/v1/leadership/directives/inbox'),
    get<{ items?: SuratMasuk[] }>('/api/v1/persuratan/subbagren/masuk'),
  ]).then(([d, m]) => ({
    disposisi: (d?.items ?? []).filter(x => x.incomingId).map(x => {
      const s = x.sheet ?? {}
      return { jenis: 'disposisi' as const, id: x.id, label: join(s.letterNumber, s.subject || x.title), info: join(s.letterFrom && `dari ${s.letterFrom}`, `disposisi ${x.issuerName}`, tgl(x.createdAt)),
        isi: { nomor: s.letterNumber ?? '', tanggal: s.letterDate ?? '', dari: s.letterFrom ?? '', perihal: s.subject || x.title } }
    }),
    surat_masuk: (m?.items ?? []).map(x => ({ jenis: 'surat_masuk' as const, id: x.id, label: join(x.nomor, x.perihal), info: join(`dari ${x.unitPengirimLabel}`, tgl(x.sentAt), x.diterimaAt ? 'diterima' : 'belum diterima'),
      isi: { nomor: x.nomor, tanggal: x.tanggal ?? '', dari: x.unitPengirimLabel, perihal: x.perihal } })),
  }))
  // Gagal/akses ditolak dianggap kosong; muat ulang di pembukaan formulir berikutnya.
  void cache.finally(() => setTimeout(() => { cache = null }, 30_000))
  return cache
}

export function SumberPicker({ value, onPick }: { value: Sumber | null; onPick: (s: Sumber | null, isi: IsiSumber | null) => void }) {
  const [mode, setMode] = useState<'manual' | SumberJenis>(value?.jenis ?? 'manual')
  const [opsi, setOpsi] = useState<Record<SumberJenis, Opsi[]> | null>(null)
  useEffect(() => { if (mode !== 'manual' && !opsi) void muat().then(setOpsi) }, [mode, opsi])
  const list = mode === 'manual' ? [] : opsi?.[mode] ?? []
  const pilihan = value && mode === value.jenis ? value.id : ''
  return <fieldset className="sdl-sumber">
    <legend>Sumber surat</legend>
    <div className="sdl-sumber__modes" role="radiogroup" aria-label="Sumber surat">
      {(['manual', 'disposisi', 'surat_masuk'] as const).map(m => <label key={m} className={mode === m ? 'is-on' : undefined}>
        <input type="radio" name={`sumber-${value?.id ?? 'baru'}`} checked={mode === m} onChange={() => { setMode(m); if (m === 'manual') onPick(null, null) }} />
        {m === 'manual' ? 'Isi manual' : `Dari ${SUMBER_LABEL[m]}`}</label>)}
    </div>
    {mode !== 'manual' && <>
      <select aria-label={`Pilih ${SUMBER_LABEL[mode]}`} value={pilihan} onChange={e => { const o = list.find(x => x.id === e.target.value); if (o) onPick({ jenis: o.jenis, id: o.id, label: o.label }, o.isi) }}>
        <option value="">{!opsi ? 'Memuat…' : list.length ? `— Pilih ${SUMBER_LABEL[mode].toLowerCase()} —` : `Belum ada ${SUMBER_LABEL[mode].toLowerCase()} untuk Subbagren`}</option>
        {value && value.jenis === mode && !list.some(x => x.id === value.id) && <option value={value.id}>{value.label}</option>}
        {list.map(o => <option key={o.id} value={o.id}>{o.label} — {o.info}</option>)}
      </select>
      <small>{value && value.jenis === mode ? 'Tertaut. Isian di bawah diambil dari sumbernya; PDF surat dibuka dari sumber (tidak perlu diunggah ulang).' : 'Isian nomor, tanggal, pengirim, dan perihal akan terisi dari surat yang dipilih.'}</small>
    </>}
  </fieldset>
}
