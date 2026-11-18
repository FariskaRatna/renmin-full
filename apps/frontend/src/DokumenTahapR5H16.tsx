import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { confirmDialog } from './UIFeedback'

/**
 * R5H16: Tahap Pekerjaan dokumen Subbagren.
 *
 * Formulir dokumen (Unggah / Ubah) dengan bagian TAHAP PEKERJAAN: setiap blok
 * memilih satu pekerjaan dari dropdown (sesuai jenis dokumen), lalu isian dan
 * lampiran PDF pekerjaan itu muncul. Setelah satu blok dipilih, tombol
 * "＋ Tambah Tahap Pekerjaan" muncul untuk blok berikutnya.
 *
 * Daftar pekerjaan, field, dan slot berkas datang dari backend
 * (GET /tahap-katalog) supaya validasi dan tampilan memakai satu sumber.
 */

export type KField = { key: string; label: string; type: 'text' | 'textarea' | 'date' | 'number' | 'select'; max: number; required?: boolean; half?: boolean; hint?: string; default?: string; options?: string[]; auto?: boolean }
/** jenis 'xlsx' (R5H20): satu file Excel myinterest, menggantikan yang lama. Selain itu PDF. */
export type KSlot = { slot: string; label: string; utama?: boolean; jenis?: 'xlsx' }
export type Katalog = { jenis: Record<string, string[]>; pekerjaan: Record<string, { label: string; form: string; fields: KField[]; berkas: KSlot[] }>; tanpaSah?: string[]; periode?: Record<string, 'bulan' | 'triwulan'> }
export type Tahap = { id: string; pekerjaan: string; pekerjaanLabel: string; isian: Record<string, string>; version: number; createdAt: string; updatedAt: string; updatedByName: string; berkas: { id: string; slot: string; filename: string; size: number }[]
  createdBy: string; updatedBy: string; cekStatus: 'menunggu' | 'diterima' | 'dikembalikan'; cekNote: string; cekAt: string | null; cekByName: string | null }
export type DokMeta = { id: string; jenis: string; periode?: string; judul: string; nomor: string; tanggal: string | null; keterangan: string; version: number; tahap: Tahap[] }

type Api = <T>(path: string, method?: 'GET' | 'POST' | 'PUT' | 'DELETE', body?: unknown) => Promise<T>
/** files: berkas baru per slot (diunggah saat Simpan); existing: lampiran tersimpan; drop: id lampiran yang akan dihapus. */
type Block = { key: string; id?: string; version?: number; pekerjaan: string; isian: Record<string, string>; files: Record<string, File[]>; existing: Record<string, { id: string; filename: string }[]>; drop: string[]; dirty: boolean }

const MAX_PDF = 20 * 1024 * 1024
const MAX_XLSX = 2 * 1024 * 1024
const MAX_PER_SLOT = 10
let seq = 0
const newKey = () => `b${++seq}`
const emptyBlock = (): Block => ({ key: newKey(), pekerjaan: '', isian: {}, files: {}, existing: {}, drop: [], dirty: false })
function groupBySlot(berkas: Tahap['berkas']) {
  const out: Block['existing'] = {}
  for (const b of berkas) (out[b.slot] ??= []).push({ id: b.id, filename: b.filename })
  return out
}
const tgl = (d?: string) => d ? new Date(`${d}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

export function isDistribusi(k: Katalog | null, pekerjaan: string) { return k?.pekerjaan[pekerjaan]?.form === 'distribusi' }

/**
 * mode 'create' : dokumen baru + tahap (boleh beberapa blok sekaligus).
 * mode 'edit'   : ubah data dokumen draft saja; tahap diubah dari register di Detail.
 * mode 'tahap'  : SATU tahap -- ubah tahap `tahapId`, atau tambah satu tahap baru bila
 *                 tahapId kosong (2026-11-17: formulir tetap pendek walau tahap banyak).
 */
export function DokumenDialog({ mode, kind = 'dokumen', tahun, doc, tahapId, katalog, jenisOptions, api, onClose, onDone }: {
  mode: 'create' | 'edit' | 'tahap'; kind?: 'dokumen' | 'laporan' | 'revisi'; tahun: number; doc?: DokMeta; tahapId?: string; katalog: Katalog | null
  jenisOptions: [string, string][]; api: Api; onClose: () => void; onDone: (message: string, ok: boolean) => void
}) {
  const [tahunDok, setTahunDok] = useState(tahun)
  const nowYear = new Date().getFullYear()
  const tahunOptions = [...new Set([nowYear - 1, nowYear, nowYear + 1, nowYear + 2, tahun])].sort((a, b) => a - b)
  const [meta, setMeta] = useState({ jenis: doc?.jenis ?? jenisOptions[0]?.[0] ?? 'renstra', periode: doc?.periode ?? '', judul: doc?.judul ?? '', nomor: doc?.nomor ?? '', tanggal: doc?.tanggal ?? '', keterangan: doc?.keterangan ?? '' })
  // Nomor tahap mengikuti urutan sebenarnya di dokumen; tahap baru melanjutkan
  // setelah tahap terakhir yang tersimpan. Tahap yang sudah DITERIMA tetap bisa
  // diubah, tetapi kembali "Menunggu dicek" setelah disimpan.
  const nomorTahap = (b: Block, list: Block[] = blocks) => {
    const all = doc?.tahap ?? []
    if (b.id) return all.findIndex(t => t.id === b.id) + 1
    return all.length + list.filter(x => !x.id).findIndex(x => x.key === b.key) + 1
  }
  const initial = useMemo<Block[]>(() => (doc?.tahap ?? []).filter(t => mode === 'tahap' && t.id === tahapId)
    .map(t => ({ key: newKey(), id: t.id, version: t.version, pekerjaan: t.pekerjaan, isian: { ...t.isian }, files: {}, existing: groupBySlot(t.berkas), drop: [], dirty: false })), [doc, katalog, mode, tahapId])
  const [blocks, setBlocks] = useState<Block[]>(() => mode === 'edit' ? [] : initial.length ? initial : [emptyBlock()])
  const [removed, setRemoved] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lastRef = useRef<HTMLSelectElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const allowed = useMemo(() => {
    const list = katalog?.jenis[meta.jenis] ?? []
    return list
  }, [katalog, meta.jenis])
  const hasTahap = allowed.length > 0
  const jenisLocked = mode === 'edit' && (doc?.tahap.length ?? 0) > 0
  // Berapa kali tiap pekerjaan sudah dicatat (urutan bebas, boleh berulang -- mis. rapat
  // berkali-kali): tahap tersimpan di luar formulir + blok lain di formulir ini.
  const timesUsed = (k: string, except: string) => {
    const inForm = new Set(blocks.map(b => b.id).filter(Boolean))
    return (doc?.tahap ?? []).filter(t => !inForm.has(t.id) && t.pekerjaan === k).length + blocks.filter(b => b.key !== except && b.pekerjaan === k).length
  }
  const editing = mode === 'tahap' && tahapId ? doc?.tahap.find(t => t.id === tahapId) : undefined
  async function hapusTahap() {
    if (!doc || !editing || busy) return
    if (!await confirmDialog(`Hapus tahap "${editing.pekerjaanLabel}" beserta lampirannya?`, { confirmLabel: 'Hapus' })) return
    setBusy(true); setError('')
    try { await api(`/dokumen/${doc.id}/tahap/${editing.id}`, 'DELETE'); onDone('Tahap dihapus.', true) }
    catch (err) { setBusy(false); setError(err instanceof Error ? err.message : 'Gagal menghapus.') }
  }

  const setBlock = (key: string, fn: (b: Block) => Block) => setBlocks(bs => bs.map(b => b.key === key ? fn(b) : b))
  function choose(key: string, pekerjaan: string) {
    const fields = katalog?.pekerjaan[pekerjaan]?.fields ?? []
    setBlock(key, b => ({ ...b, pekerjaan, isian: Object.fromEntries(fields.filter(f => f.default).map(f => [f.key, f.default!])), files: {}, dirty: true }))
  }
  function addBlock() {
    setBlocks(bs => [...bs, emptyBlock()])
    setTimeout(() => lastRef.current?.focus(), 0)
  }
  function removeBlock(b: Block) {
    if (b.id) setRemoved(r => [...r, b.id!])
    setBlocks(bs => { const next = bs.filter(x => x.key !== b.key); return next.length ? next : [emptyBlock()] })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    const periodeKind = katalog?.periode?.[meta.jenis]
    if (mode !== 'tahap' && periodeKind && !meta.periode) { setError(`Pilih ${periodeKind === 'bulan' ? 'bulan' : 'triwulan'} laporan.`); return }
    // Laporan/revisi: judul boleh dikosongkan, diisi otomatis dari jenis + periode + tahun.
    const autoJudul = `${jenisOptions.find(([v]) => v === meta.jenis)?.[1] ?? ''}${meta.periode ? ` ${periodeLabel(meta.periode)}` : ''} ${tahunDok}`.trim()
    const judulFinal = meta.judul.trim() || (kind !== 'dokumen' ? autoJudul : '')
    if (mode !== 'tahap' && judulFinal.length < 3) { setError('Judul Dokumen wajib diisi (minimal 3 karakter).'); return }
    const active = hasTahap ? blocks.filter(b => b.pekerjaan) : []
    for (const b of active) {
      const no = nomorTahap(b)
      const p = katalog!.pekerjaan[b.pekerjaan]
      for (const f of p.fields) if (f.required && !(b.isian[f.key] ?? '').trim()) { setError(`Tahap ${no} (${p.label}): ${f.label} wajib diisi.`); return }
      for (const [slot, list] of Object.entries(b.files)) {
        const ks = p.berkas.find(s => s.slot === slot); const label = ks?.label
        const xlsx = ks?.jenis === 'xlsx'
        for (const file of list) {
          if (xlsx ? !/\.xlsx$/i.test(file.name) : !/\.pdf$/i.test(file.name)) { setError(`Tahap ${no}: "${file.name}" harus ${xlsx ? 'file Excel .xlsx unduhan myinterest' : 'PDF'}.`); return }
          if (file.size > (xlsx ? MAX_XLSX : MAX_PDF)) { setError(`Tahap ${no}: "${file.name}" lebih dari ${xlsx ? '2' : '20'} MB.`); return }
        }
        const kept = (b.existing[slot] ?? []).filter(x => !b.drop.includes(x.id)).length
        if (!xlsx && kept + list.length > MAX_PER_SLOT) { setError(`Tahap ${no}: ${label} paling banyak ${MAX_PER_SLOT} berkas.`); return }
      }
    }
    if (mode === 'tahap' && !active.length && !removed.length) { setError('Pilih pekerjaan terlebih dahulu.'); return }
    setBusy(true); setError('')
    let did = doc?.id ?? ''
    const docPayload = { jenis: meta.jenis, periode: periodeKind ? meta.periode : '', judul: judulFinal, nomor: meta.nomor.trim(), tanggal: meta.tanggal, keterangan: meta.keterangan.trim(), programId: '', kegiatanId: '' }
    try {
      if (mode === 'create') did = (await api<{ id: string }>('/dokumen', 'POST', { tahun: tahunDok, ...docPayload })).id
      else if (mode === 'edit' && doc) {
        const changed = docPayload.jenis !== doc.jenis || docPayload.periode !== (doc.periode ?? '') || docPayload.judul !== doc.judul || docPayload.nomor !== doc.nomor || docPayload.tanggal !== (doc.tanggal ?? '') || docPayload.keterangan !== doc.keterangan
        // Kaitan program/kegiatan lama dipertahankan oleh pemanggil lewat doc (lihat DokumenR5H13).
        if (changed) await api(`/dokumen/${doc.id}`, 'PUT', { ...docPayload, ...linkOf(doc), version: doc.version })
      }
    } catch (err) { setBusy(false); setError(err instanceof Error ? err.message : 'Gagal menyimpan.'); return }
    // Sejak titik ini dokumen sudah ada; kegagalan tahap tidak membatalkannya.
    try {
      for (const tid of removed) await api(`/dokumen/${did}/tahap/${tid}`, 'DELETE')
      for (const b of active) {
        let tid = b.id
        if (!tid) tid = (await api<{ id: string }>(`/dokumen/${did}/tahap`, 'POST', { pekerjaan: b.pekerjaan, isian: trimmed(b.isian) })).id
        else if (b.dirty) await api(`/dokumen/${did}/tahap/${tid}`, 'PUT', { isian: trimmed(b.isian), version: b.version })
        // Unggah dulu baru hapus: mengganti PDF bertanda tangan satu-satunya tidak ditolak.
        for (const [slot, list] of Object.entries(b.files)) {
          for (const file of list) {
            const form = new FormData(); form.append('file', file)
            await api(`/dokumen/${did}/tahap/${tid}/lampiran/${slot}`, 'POST', form)
          }
        }
        // Slot xlsx: unggahan baru sudah menggantikan file lama di server, jadi jangan dihapus lagi.
        const diganti = new Set((katalog?.pekerjaan[b.pekerjaan]?.berkas ?? []).filter(s => s.jenis === 'xlsx' && (b.files[s.slot] ?? []).length > 0).flatMap(s => (b.existing[s.slot] ?? []).map(x => x.id)))
        for (const lid of b.drop.filter(x => !diganti.has(x))) await api(`/dokumen/${did}/tahap/${tid}/lampiran/${lid}`, 'DELETE')
      }
      onDone(mode === 'create' ? 'Dokumen disimpan sebagai draft.' : mode === 'tahap' ? (tahapId ? 'Tahap diperbarui.' : 'Tahap pekerjaan ditambahkan.') : 'Dokumen diperbarui.', true)
    } catch (err) {
      onDone(`${mode === 'create' ? 'Dokumen tersimpan' : 'Sebagian perubahan tersimpan'}, tetapi tahap gagal disimpan: ${err instanceof Error ? err.message : 'galat'} Buka Ubah untuk melengkapi.`, false)
    }
  }

  const noun = kind === 'laporan' ? 'Laporan' : kind === 'revisi' ? 'Revisi Anggaran' : 'Dokumen'
  const title = mode === 'create' ? (kind === 'dokumen' ? 'Unggah Dokumen' : `${noun} Baru`) : mode === 'edit' ? `Ubah ${noun}` : editing ? 'Ubah Tahap Pekerjaan' : 'Tambah Tahap Pekerjaan'
  return <div className="sdl-progar__shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <form className="sdl-progar__dialog sdl-progar__dokdialog" role="dialog" aria-modal="true" aria-labelledby="sdl-dok-title" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">{mode === 'tahap' ? `TAHAP PEKERJAAN · TA ${tahunDok}` : `${kind === 'dokumen' ? 'DOKUMEN PERANCANGAN' : noun.toUpperCase()} · TA ${tahunDok}`}</span><h2 id="sdl-dok-title">{title}</h2>
        {mode === 'tahap' && doc && <p>{doc.judul}</p>}</header>

      {mode !== 'tahap' && <div className="sdl-progar__fields">
        <label><span>Tahun Anggaran<b aria-hidden="true"> *</b></span>
          <select value={tahunDok} disabled={mode !== 'create'} onChange={e => setTahunDok(Number(e.target.value))}>{tahunOptions.map(y => <option key={y} value={y}>{y}</option>)}</select>
          {mode !== 'create' && <small>Tahun anggaran tidak bisa diubah setelah dokumen dibuat.</small>}</label>
        <label className={katalog?.periode?.[meta.jenis] ? 'is-half' : undefined}><span>Jenis {noun === 'Dokumen' ? 'Dokumen' : noun}<b aria-hidden="true"> *</b></span>
          <select value={meta.jenis} disabled={jenisLocked} onChange={e => { setMeta(m => ({ ...m, jenis: e.target.value, periode: '' })); setBlocks([emptyBlock()]) }}>
            {jenisOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {jenisLocked && <small>Jenis tidak bisa diganti karena sudah punya tahap pekerjaan.</small>}</label>
        {katalog?.periode?.[meta.jenis] && <label className="is-half"><span>{katalog.periode[meta.jenis] === 'bulan' ? 'Bulan' : 'Triwulan'}<b aria-hidden="true"> *</b></span>
          <select value={meta.periode} onChange={e => setMeta(m => ({ ...m, periode: e.target.value }))}>
            <option value="">— Pilih —</option>
            {(katalog.periode[meta.jenis] === 'bulan' ? BULAN.map((_, i) => `B${String(i + 1).padStart(2, '0')}`) : ['TW1', 'TW2', 'TW3', 'TW4']).map(p => <option key={p} value={p}>{periodeLabel(p)}</option>)}</select></label>}
        <label><span>Judul {noun === 'Dokumen' ? 'Dokumen' : noun}{kind === 'dokumen' && <b aria-hidden="true"> *</b>}</span><input maxLength={240} value={meta.judul}
          placeholder={kind === 'dokumen' ? 'mis. Renstra Densus 88 AT Polri 2025–2029' : `Kosongkan untuk memakai nama otomatis: ${`${jenisOptions.find(([v]) => v === meta.jenis)?.[1] ?? ''}${meta.periode ? ` ${periodeLabel(meta.periode)}` : ''} ${tahunDok}`.trim()}`}
          onChange={e => setMeta(m => ({ ...m, judul: e.target.value }))} /></label>
        <label className="is-half"><span>Nomor Dokumen</span><input maxLength={120} value={meta.nomor} onChange={e => setMeta(m => ({ ...m, nomor: e.target.value }))} /></label>
        <label className="is-half"><span>Tanggal Dokumen</span><input type="date" value={meta.tanggal} onChange={e => setMeta(m => ({ ...m, tanggal: e.target.value }))} /></label>
      </div>}

      {hasTahap && mode === 'edit' ? <p className="sdl-progar__tahap-help">Tahap pekerjaan ditambah dan diubah dari tabel <strong>Tahap Pekerjaan</strong> di Detail dokumen.</p>
        : hasTahap ? <section className="sdl-progar__tahap-section" aria-label="Tahap pekerjaan">
        {mode !== 'tahap' && <h3>Tahap Pekerjaan</h3>}
        {mode === 'create' && <p className="sdl-progar__tahap-help">Pilih pekerjaan yang sedang/sudah dikerjakan, isi data dan lampirkan buktinya. Tahap berikutnya bisa ditambahkan sekarang atau nanti dari Detail dokumen.</p>}
        {blocks.map(b => {
          const no = nomorTahap(b)
          const p = b.pekerjaan ? katalog?.pekerjaan[b.pekerjaan] : undefined
          const accepted = Boolean(b.id) && doc?.tahap.find(t => t.id === b.id)?.cekStatus === 'diterima'
          const touched = b.dirty || b.drop.length > 0 || Object.values(b.files).some(l => l.length > 0)
          return <div key={b.key} className="sdl-progar__tahap-block">
            <div className="sdl-progar__tahap-top">
              <strong>Tahap {no}{!b.id && <span className="sdl-progar__cek-mini"> · baru</span>}{b.id && (() => { const t = doc!.tahap.find(x => x.id === b.id)!; const u = ulangKe(doc!.tahap, t); return <span className="sdl-progar__cek-mini">{u.total > 1 && ` · ${t.pekerjaanLabel} ke-${u.ke}`} · {cekLabel(t.cekStatus)}</span> })()}</strong>
              {mode === 'create' && <button type="button" className="sdl-progar__tahap-x" aria-label={`Hapus tahap ${no}`} title="Hapus tahap ini" onClick={() => removeBlock(b)}>✕</button>}
            </div>
            {accepted && touched && <p className="sdl-progar__pending">Tahap ini sudah diterima. Setelah disimpan, perubahannya perlu dicek ulang Kasubbagren.</p>}
            {b.id && doc?.tahap.find(t => t.id === b.id)?.cekStatus === 'dikembalikan' && <p className="sdl-progar__rejected">Dikembalikan: “{doc.tahap.find(t => t.id === b.id)!.cekNote}” — perbaiki lalu Simpan untuk diperiksa lagi.</p>}
            <div className="sdl-progar__fields">
              <label><span>Pekerjaan</span>
                <select ref={b.key === blocks[blocks.length - 1].key ? lastRef : undefined} value={b.pekerjaan} disabled={Boolean(b.id)} onChange={e => choose(b.key, e.target.value)}>
                  <option value="">— Pilih pekerjaan —</option>
                  {allowed.map(k => { const n = b.id ? 0 : timesUsed(k, b.key); return <option key={k} value={k}>{katalog!.pekerjaan[k].label}{n > 0 ? ` (sudah ${n}×)` : ''}</option> })}
                </select></label>
              {p && p.fields.map(f => <label key={f.key} className={f.half ? 'is-half' : undefined}>
                <span>{f.label}{f.required && <b aria-hidden="true"> *</b>}</span>
                {f.auto ? <output className="sdl-progar__auto">{b.isian[f.key] ? (f.type === 'date' ? new Date(`${b.isian[f.key]}T12:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : b.isian[f.key]) : <span className="sdl-progar__muted">Terisi otomatis saat file diunggah</span>}</output>
                  : f.type === 'textarea' ? <textarea rows={2} maxLength={f.max} value={b.isian[f.key] ?? ''} onChange={e => { const v = e.target.value; setBlock(b.key, x => ({ ...x, isian: { ...x.isian, [f.key]: v }, dirty: true })) }} />
                  : f.type === 'select' ? <select value={b.isian[f.key] ?? ''} onChange={e => { const v = e.target.value; setBlock(b.key, x => ({ ...x, isian: { ...x.isian, [f.key]: v }, dirty: true })) }}><option value="">—</option>{(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}</select>
                  : <input type={f.type === 'date' ? 'date' : 'text'} inputMode={f.type === 'number' ? 'numeric' : undefined} maxLength={f.max} value={b.isian[f.key] ?? ''} onChange={e => { const v = f.type === 'number' ? e.target.value.replace(/\D/g, '') : e.target.value; setBlock(b.key, x => ({ ...x, isian: { ...x.isian, [f.key]: v }, dirty: true })) }} />}
                {f.hint && !f.auto && <small>{f.hint}</small>}
              </label>)}
              {p && p.berkas.map(s => <div key={s.slot} className="sdl-progar__tahap-file" role="group" aria-label={s.label}>
                <span>📎 {s.label}{s.utama && <em> · bukti utama</em>}</span>
                <ul className="sdl-progar__lampiran">
                  {(b.existing[s.slot] ?? []).map(x => { const ganti = s.jenis === 'xlsx' && (b.files[s.slot] ?? []).length > 0; const gone = ganti || b.drop.includes(x.id); return <li key={x.id} className={gone ? 'is-gone' : undefined}>
                    <span>{x.filename}</span>{ganti ? <em>akan diganti</em> : gone ? <em>akan dihapus</em> : <em>tersimpan</em>}
                    {!ganti && <button type="button" className="sdl-progar__mini" onClick={() => setBlock(b.key, y => ({ ...y, drop: gone ? y.drop.filter(z => z !== x.id) : [...y.drop, x.id] }))}>{gone ? 'Batal hapus' : 'Hapus'}</button>}</li> })}
                  {(b.files[s.slot] ?? []).map((f, fi) => <li key={`n${fi}`}><span>{f.name}</span><em>baru</em>
                    <button type="button" className="sdl-progar__mini" onClick={() => setBlock(b.key, y => ({ ...y, files: { ...y.files, [s.slot]: (y.files[s.slot] ?? []).filter((_, j) => j !== fi) } }))}>Batal</button></li>)}
                </ul>
                {s.jenis === 'xlsx'
                  ? <><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label={`Pilih ${s.label}`} onChange={e => { const picked = e.target.files?.[0]; e.target.value = ''; if (picked) setBlock(b.key, y => ({ ...y, files: { ...y.files, [s.slot]: [picked] } })) }} />
                    <small>Satu file Excel (≤ 2 MB) tanpa diubah. Angkanya langsung diimpor ke LRA dan dashboard; file baru menggantikan yang lama.</small></>
                  : <><input type="file" multiple accept="application/pdf,.pdf" aria-label={`Tambah berkas ${s.label}`} onChange={e => { const picked = Array.from(e.target.files ?? []); e.target.value = ''; if (picked.length) setBlock(b.key, y => ({ ...y, files: { ...y.files, [s.slot]: [...(y.files[s.slot] ?? []), ...picked] } })) }} />
                    <small>Bisa lebih dari satu PDF (maks {MAX_PER_SLOT}, masing-masing ≤ 20 MB).</small></>}
              </div>)}
            </div>
          </div>
        })}
        {mode === 'create' && blocks.every(b => b.pekerjaan) && <button type="button" className="btn sdl-progar__tahap-add" onClick={addBlock}>＋ Tambah Tahap Pekerjaan</button>}
      </section>
        : mode !== 'tahap' && <p className="sdl-progar__tahap-help">Jenis ini tidak memakai tahap pekerjaan. Setelah disimpan, lampirkan PDF dokumennya dari daftar.</p>}

      {mode !== 'tahap' && <div className="sdl-progar__fields"><label><span>Keterangan</span><textarea rows={2} maxLength={1000} value={meta.keterangan} onChange={e => setMeta(m => ({ ...m, keterangan: e.target.value }))} /></label></div>}

      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer>
        {editing && editing.cekStatus !== 'diterima' && <button type="button" className="btn sdl-progar__danger sdl-progar__footer-left" disabled={busy} onClick={() => void hapusTahap()}>Hapus Tahap</button>}
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button>
      </footer>
    </form>
  </div>
}

function trimmed(isian: Record<string, string>) {
  return Object.fromEntries(Object.entries(isian).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''))
}
/** Kaitan program/kegiatan lama ikut dikirim ulang supaya tidak terhapus saat Ubah. */
function linkOf(doc: DokMeta & { program?: { id: string } | null; kegiatan?: { id: string } | null }) {
  return { programId: doc.kegiatan ? '' : doc.program?.id ?? '', kegiatanId: doc.kegiatan?.id ?? '' }
}

/** Garis tahap di baris dokumen: pekerjaan, tanggal utama, lampiran. */
export function TahapList({ tahap, katalog, onPreview }: { tahap: Tahap[]; katalog: Katalog | null; onPreview: (t: Tahap, lampiranId: string, filename: string) => void }) {
  if (!tahap.length) return null
  return <ol className="sdl-progar__tahap">
    {tahap.map(t => {
      const p = katalog?.pekerjaan[t.pekerjaan]
      const date = t.isian.tanggal || t.isian.rapatTanggal || t.isian.sprinTanggal || t.isian.suratTanggal || t.isian.ttdTanggal
      const missing = (p?.berkas ?? []).filter(s => s.utama && !t.berkas.some(b => b.slot === s.slot))
      return <li key={t.id}>
        <span className="sdl-progar__tahap-name">✓ {t.pekerjaanLabel}</span>{date && <span className="sdl-progar__muted"> · {tgl(date)}</span>}
        {t.berkas.map(b => <button key={b.id} type="button" className="sdl-progar__file" title={`Lihat ${b.filename}`} onClick={() => onPreview(t, b.id, b.filename)}>👁 {lampiranLabel(t, b, p?.berkas)}</button>)}
        {missing.length > 0 && <span className="sdl-progar__tahap-missing">⚠ belum ada: {missing.map(s => s.label).join(', ')}</span>}
      </li>
    })}
  </ol>
}

/** "Notulen rapat", atau "Notulen rapat (2)" bila slot yang sama berisi beberapa berkas. */
export function lampiranLabel(t: Tahap, b: Tahap['berkas'][number], slots?: KSlot[]) {
  const label = slots?.find(s => s.slot === b.slot)?.label ?? b.slot
  const same = t.berkas.filter(x => x.slot === b.slot)
  return same.length > 1 ? `${label} (${same.indexOf(b) + 1})` : label
}

export function cekLabel(s?: Tahap['cekStatus']) {
  return s === 'diterima' ? 'Diterima' : s === 'dikembalikan' ? 'Dikembalikan' : 'Menunggu dicek'
}

/** Tanggal utama tahap: field bertipe tanggal pertama di katalog yang terisi. */
export function tanggalTahap(t: Tahap, katalog: Katalog | null) {
  for (const f of katalog?.pekerjaan[t.pekerjaan]?.fields ?? []) if (f.type === 'date' && t.isian[f.key]) return t.isian[f.key]
  return ''
}
/** Ringkasan satu baris: dua isian teks pertama (bukan tanggal) sesuai urutan katalog. */
export function ringkasTahap(t: Tahap, katalog: Katalog | null) {
  const vals = (katalog?.pekerjaan[t.pekerjaan]?.fields ?? []).filter(f => f.type !== 'date' && t.isian[f.key]).slice(0, 2)
    .map(f => f.type === 'number' ? `${t.isian[f.key]} ${f.label.replace(/^jumlah\s+/i, '').toLowerCase()}` : t.isian[f.key].replace(/\s+/g, ' '))
  const out = vals.join(' · ')
  return out.length > 80 ? `${out.slice(0, 79)}…` : out
}
/** Urutan kemunculan pekerjaan yang sama ("ke-2 dari 3"); total 1 berarti tidak berulang. */
export function ulangKe(all: Tahap[], t: Tahap) {
  const same = all.filter(x => x.pekerjaan === t.pekerjaan)
  return { ke: same.indexOf(t) + 1, total: same.length }
}

export const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
const ROMAWI = ['I', 'II', 'III', 'IV']
/** "B10" -> "Oktober", "TW3" -> "Triwulan III", "" -> "". */
export function periodeLabel(p?: string) {
  if (!p) return ''
  if (p.startsWith('B')) return BULAN[Number(p.slice(1)) - 1] ?? p
  if (p.startsWith('TW')) return `Triwulan ${ROMAWI[Number(p.slice(2)) - 1] ?? p.slice(2)}`
  return p
}
