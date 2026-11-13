import { useCallback, useEffect, useMemo, useState } from 'react'
import { FormDialog, rupiah, type Dialog } from './ProgarR5H11'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'

/**
 * R5H13: Monitoring Kinerja & LKIP.
 *
 * Indikator kinerja per KEGIATAN (Program Anggaran), target dan capaian
 * KUMULATIF per triwulan (TW IV = setahun). Di samping capaian tampil serapan
 * anggaran kegiatan dari Realisasi (R5H12), sehingga kinerja dan uang terbaca
 * berdampingan. "Unduh Excel LKIP" menghasilkan rekap tahunan dari backend.
 */

type Cap = { nilai: string; catatan: string; updatedAt: string; updatedByName: string } | null
type Ind = { id: string; nama: string; satuan: string; version: number; target: string[]; capaian: Cap[] }
type Keg = { id: string; kode: string; nama: string; program: { kode: string; nama: string }; pagu: string | null; realisasi: string; indikator: Ind[] }
type Caps = { canRead: boolean; canManage: boolean }

const BASE = '/api/v1/subbagren/perencanaan'
const TW = ['TW I', 'TW II', 'TW III', 'TW IV']
const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Gunakan angka, maksimal dua angka di belakang koma.',
  target_tahunan_wajib: 'Target tahunan (TW IV) wajib lebih dari 0.',
  target_tidak_kumulatif: 'Target bersifat kumulatif: target triwulan berikutnya tidak boleh lebih kecil.',
  indikator_has_capaian: 'Indikator yang sudah punya capaian tidak dapat dihapus.',
  version_conflict: 'Data sudah diubah orang lain. Muat ulang lalu coba lagi.',
  not_found: 'Data sudah tidak ada. Muat ulang halaman.',
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
    if (r.status === 404 && !e.error) throw Error('Layanan Monitoring Kinerja belum tersedia di server ini.')
    throw Error(ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}).`)
  }
  return r.json() as Promise<T>
}

const num = (s: string | null | undefined) => (s === null || s === undefined || s === '' ? null : Number(s))
const fmt = (n: number | null) => n === null ? '–' : n.toLocaleString('id-ID', { maximumFractionDigits: 2 })
/** "1.250,5" atau "12,5" (gaya Indonesia) atau "12.5" -> "12.5". */
const toDec = (raw: string) => { const v = raw.trim(); return v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v }
const pctOf = (a: number | null, b: number | null) => (a === null || !b ? null : (a / b) * 100)
const tone = (p: number | null) => p === null ? '' : p >= 100 ? 'is-good' : p >= 75 ? 'is-mid' : 'is-low'
/** Capaian tahunan = capaian triwulan terakhir yang sudah diisi (kumulatif). */
const lastCap = (i: Ind) => { for (let t = 3; t >= 0; t--) if (i.capaian[t]) return { tw: t, v: num(i.capaian[t]!.nilai) }; return null }

export default function KinerjaR5H13() {
  const thisYear = new Date().getFullYear()
  const [tahun, setTahun] = useState(thisYear)
  const [data, setData] = useState<Keg[] | null>(null)
  const [caps, setCaps] = useState<Caps | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const c = caps ?? await api<Caps>('/capabilities')
      setCaps(c)
      if (c.canRead) setData((await api<{ kegiatan: Keg[] }>(`/kinerja?tahun=${tahun}`)).kegiatan)
    } catch (e) { setError(e instanceof Error ? e.message : 'Data tidak dapat dimuat.') } finally { setLoading(false) }
  }, [tahun]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load() }, [load])

  const years = useMemo(() => [thisYear - 1, thisYear, thisYear + 1, thisYear + 2], [thisYear])
  const canManage = Boolean(caps?.canManage)
  const run = async (fn: () => Promise<unknown>, ok: string) => { await fn(); showToast(ok, 'success'); await load() }

  const indFields: Dialog['fields'] = [
    { key: 'nama', label: 'Indikator Kinerja', required: true, max: 240, placeholder: 'mis. Persentase laporan keuangan yang tepat waktu' },
    { key: 'satuan', label: 'Satuan', required: true, max: 40, placeholder: 'mis. %, laporan, dokumen, kegiatan' },
    ...TW.map((t, i): Dialog['fields'][number] => ({ key: `t${i}`, label: `Target s.d. ${t}${i === 3 ? ' (tahunan)' : ''}`, type: 'decimal', required: i === 3, max: 19, half: true })),
  ]
  const targetOf = (v: Record<string, string>) => [0, 1, 2, 3].map(i => toDec(v[`t${i}`] || '0') || '0')
  const addInd = (k: Keg) => setDialog({ title: 'Tambah Indikator Kinerja', eyebrow: `KEGIATAN ${k.kode}`, context: `${k.nama}. Target diisi kumulatif s.d. akhir triwulan.`, fields: indFields, values: { nama: '', satuan: '', t0: '', t1: '', t2: '', t3: '' }, submitLabel: 'Simpan Indikator',
    onSubmit: v => run(() => api('/kinerja/indikator', 'POST', { kegiatanId: k.id, nama: v.nama, satuan: v.satuan, target: targetOf(v) }), 'Indikator ditambahkan.') })
  const editInd = (k: Keg, i: Ind) => setDialog({ title: 'Ubah Indikator', eyebrow: `KEGIATAN ${k.kode}`, context: k.nama, fields: indFields,
    values: { nama: i.nama, satuan: i.satuan, ...Object.fromEntries(i.target.map((t, n) => [`t${n}`, String(Number(t)).replace('.', ',')])) }, submitLabel: 'Simpan Perubahan',
    onSubmit: v => run(() => api(`/kinerja/indikator/${i.id}`, 'PUT', { nama: v.nama, satuan: v.satuan, target: targetOf(v), version: i.version }), 'Indikator diperbarui.') })
  async function delInd(i: Ind) {
    if (!await confirmDialog(`Hapus indikator "${i.nama}"?`, { confirmLabel: 'Hapus', danger: true })) return
    try { await run(() => api(`/kinerja/indikator/${i.id}`, 'DELETE'), 'Indikator dihapus.') } catch (e) { showToast(e instanceof Error ? e.message : 'Gagal.', 'error') }
  }
  const isiCapaian = (k: Keg, i: Ind, tw: number) => {
    const c = i.capaian[tw]
    setDialog({ title: `Capaian ${TW[tw]}`, eyebrow: `KEGIATAN ${k.kode}`, context: `${i.nama} — target s.d. ${TW[tw]}: ${fmt(num(i.target[tw]))} ${i.satuan}`,
      fields: [
        { key: 'nilai', label: `Capaian kumulatif s.d. ${TW[tw]} (${i.satuan})`, type: 'decimal', required: true, max: 19 },
        { key: 'catatan', label: 'Catatan / kendala / tindak lanjut', type: 'textarea', max: 1000 },
      ],
      values: { nilai: c ? String(Number(c.nilai)).replace('.', ',') : '', catatan: c?.catatan ?? '' }, submitLabel: 'Simpan Capaian',
      onSubmit: v => run(() => api(`/kinerja/indikator/${i.id}/capaian/${tw + 1}`, 'PUT', { nilai: toDec(v.nilai), catatan: v.catatan }), `Capaian ${TW[tw]} disimpan.`) })
  }

  const all = data ?? []
  const inds = all.flatMap(k => k.indikator)
  const annual = inds.map(i => { const l = lastCap(i); return l ? pctOf(l.v, num(i.target[3])) : null }).filter((x): x is number => x !== null)
  const avg = annual.length ? annual.reduce((a, b) => a + b, 0) / annual.length : null
  const pagu = all.reduce((n, k) => n + (k.pagu ? BigInt(k.pagu) : 0n), 0n)
  const real = all.reduce((n, k) => n + (k.pagu ? BigInt(k.realisasi) : 0n), 0n)
  const serapan = pagu > 0n ? Number((real * 1000n) / pagu) / 10 : null

  if (caps && !caps.canRead) return <div className="sdl-progar"><div className="panel sdl-progar__empty"><strong>Tidak ada akses</strong><p>Akun ini belum diberi kewenangan membaca kinerja Subbagren.</p></div></div>

  return <div className="sdl-progar">
    <div className="sdl-progar__toolbar">
      <label className="sdl-progar__year">Tahun Anggaran
        <select value={tahun} onChange={e => setTahun(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
      </label>
      <span className="sdl-progar__grow" />
      <button type="button" className="btn" onClick={() => void load()} disabled={loading}>Muat ulang</button>
      <a className="btn primary" href={`${BASE}/kinerja/lkip.xlsx?tahun=${tahun}`} download={`LKIP-Subbagren-${tahun}.xlsx`}>⬇ Unduh Excel LKIP</a>
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}

    {data && <div className="sdl-progar__stats sdl-progar__stats--4" aria-label="Ringkasan kinerja">
      <div><span>Indikator kinerja</span><strong>{inds.length}</strong><small>pada {all.filter(k => k.indikator.length).length} dari {all.length} kegiatan</small></div>
      <div><span>Rata-rata capaian tahunan</span><strong>{avg === null ? '–' : `${fmt(avg)}%`}</strong><small>dari {annual.length} indikator yang sudah diisi</small></div>
      <div><span>Serapan anggaran</span><strong>{serapan === null ? '–' : `${serapan.toLocaleString('id-ID')}%`}</strong><small>{rupiah(real.toString())} dari {rupiah(pagu.toString())}</small></div>
      <div><span>Belum ada indikator</span><strong>{all.filter(k => !k.indikator.length).length}</strong><small>kegiatan</small></div>
    </div>}

    {loading && !data ? <div className="panel sdl-progar__empty"><p>Memuat…</p></div>
      : data && all.length === 0 ? <div className="panel sdl-progar__empty"><strong>Belum ada kegiatan untuk tahun {tahun}</strong><p>Indikator kinerja dipasang pada kegiatan di menu Program Anggaran. Susun program dan kegiatannya terlebih dahulu.</p></div>
      : all.map(k => {
          const sp = k.pagu ? Number((BigInt(k.realisasi) * 1000n) / BigInt(k.pagu)) / 10 : null
          return <section key={k.id} className="panel sdl-progar__program" aria-label={`Kinerja kegiatan ${k.kode}`}>
            <header className="sdl-progar__program-head">
              <div><span className="sdl-progar__code">{k.program.kode}</span> <span className="sdl-progar__code">{k.kode}</span><h3>{k.nama}</h3><p>{k.program.nama}</p></div>
              <div className="sdl-progar__program-meta">
                <span>Serapan anggaran</span>
                <strong>{sp === null ? 'Belum ada pagu' : `${sp.toLocaleString('id-ID')}%`}</strong>
                {k.pagu && <small>{rupiah(k.realisasi)} / {rupiah(k.pagu)}</small>}
              </div>
              {canManage && <div className="sdl-progar__actions"><button type="button" className="btn" onClick={() => addInd(k)}>＋ Indikator</button></div>}
            </header>
            {k.indikator.length === 0 ? <p className="sdl-progar__hint">Belum ada indikator kinerja untuk kegiatan ini.</p>
              : <div className="table-scroll"><table className="data-table sdl-progar__table sdl-kinerja__table">
                <thead><tr><th>Indikator</th>{TW.map(t => <th key={t} className="is-num">{t}</th>)}<th className="is-num">Tahunan</th>{canManage && <th><span className="sdl-progar__sr">Aksi</span></th>}</tr></thead>
                <tbody>{k.indikator.map(i => {
                  const l = lastCap(i); const yp = l ? pctOf(l.v, num(i.target[3])) : null
                  // Warna = sesuai jalur atau tidak (terhadap target triwulan terakhir yang
                  // diisi), bukan terhadap target setahun yang belum waktunya tercapai.
                  const onTrack = l ? pctOf(l.v, num(i.target[l.tw])) : null
                  return <tr key={i.id}>
                    <td><strong>{i.nama}</strong><small>Satuan: {i.satuan}</small></td>
                    {TW.map((t, tw) => {
                      const c = i.capaian[tw]; const v = num(c?.nilai); const tg = num(i.target[tw]); const p = pctOf(v, tg)
                      const inner = <><b>{fmt(v)}</b><i>/ {fmt(tg)}</i>{p !== null && <em className={tone(p)}>{fmt(p)}%</em>}</>
                      return <td key={t} className="is-num">{canManage
                        ? <button type="button" className={`sdl-kinerja__cell${c ? '' : ' is-empty'}`} title={c ? `${c.catatan ? c.catatan + ' · ' : ''}diisi ${c.updatedByName}` : `Isi capaian ${t}`} onClick={() => isiCapaian(k, i, tw)}>{c ? inner : <span>＋ Isi</span>}</button>
                        : <span className="sdl-kinerja__cell" title={c?.catatan || undefined}>{inner}</span>}</td>
                    })}
                    <td className="is-num"><span className={`sdl-kinerja__year ${tone(onTrack)}`} title={onTrack === null ? undefined : `${fmt(onTrack)}% dari target s.d. ${TW[l!.tw]}`}>{yp === null ? '–' : `${fmt(yp)}%`}</span>{l && <small>s.d. {TW[l.tw]} · {onTrack !== null && onTrack >= 100 ? 'sesuai target' : 'di bawah target'}</small>}</td>
                    {canManage && <td><div className="sdl-progar__row-actions"><button type="button" className="btn" onClick={() => editInd(k, i)}>Ubah</button><button type="button" className="btn sdl-progar__danger" onClick={() => void delInd(i)}>Hapus</button></div></td>}
                  </tr>
                })}</tbody>
              </table></div>}
          </section>
        })}

    {dialog && <FormDialog dialog={dialog} onClose={() => setDialog(null)} />}
  </div>
}
