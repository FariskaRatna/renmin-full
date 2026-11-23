import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { LampiranPreviewR5F15 } from './LampiranPreviewR5F15'
import { Pager, type PagerState } from './PaginationR5H5'
import { ApiError, Shade, TidakTersedia, UUID_RE, makeApi, tgl, waktu } from './SumdaBersama'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './SumdaPersonelR5H27.css'
import './SumdaKarierR5H28.css'

/**
 * R5H28: Subbagsumda — Karier & Mutasi (UKP, KGB, Mutasi, Penyesuaian Jabatan).
 *
 * Gaya "buku register" seperti R5H27. Alur: Diajukan → Diproses → Disetujui/Ditolak → Selesai
 * (atau Dibatalkan). Kasubbagsumda memutus, tetapi tidak untuk pengajuan yang ia catat/ubah sendiri.
 * Saat Selesai, nilai baru dikonfirmasi lalu diterapkan ke Master Personel di server (K2).
 * Backend: /api/v1/subbagsumda/karier (Express saja, migrasi 069).
 */

type Jenis = 'UKP' | 'KGB' | 'MUTASI' | 'PENYESUAIAN_JABATAN'
type Status = 'Diajukan' | 'Diproses' | 'Disetujui' | 'Ditolak' | 'Selesai' | 'Dibatalkan'
type PersonelRingkas = { id: string; nrp: string; nama: string; jenis: '' | 'Polri' | 'PNS'; pangkat: string; pangkatLabel: string; jabatan: string; unitKerja: string; status: string; version: number; terarsip?: boolean }
type Nilai = { pangkat: string; jabatan: string; unitKerja: string }
type Karier = {
  id: string; jenis: Jenis; nomorReferensi: string; tanggalUsulan: string; tanggalEfektif: string; status: Status; catatan: string; version: number
  usulan: Nilai & { pangkatLabel: string }; ringkas: string; diterapkan: { fields?: Record<string, { lama: string; baru: string }>; dikoreksi?: string[] } | null
  createdBy: string; createdByName: string; updatedBy: string; decidedByName: string | null; decidedAt: string | null; selesaiAt: string | null
  personel: PersonelRingkas
}
type Lampiran = { id: string; filename: string; size: number; uploadedBy: string; uploadedByName: string; uploadedAt: string }
type Riwayat = { dari: string | null; ke: string; catatan: string; oleh: string; pada: string }
type Detail = { item: Karier; lampiran: Lampiran[]; riwayat: Riwayat[] }
type Caps = { canRead: boolean; canManage: boolean; canApprove: boolean }
type Rank = { code: string; shortName: string; fullName: string }

const JENIS: { key: Jenis; label: string; bantuan: string }[] = [
  { key: 'UKP', label: 'UKP (kenaikan pangkat)', bantuan: 'Mengubah pangkat/golongan saat Selesai.' },
  { key: 'KGB', label: 'KGB (kenaikan gaji berkala)', bantuan: 'Tidak mengubah Master Personel.' },
  { key: 'MUTASI', label: 'Mutasi', bantuan: 'Mengubah jabatan dan/atau unit kerja saat Selesai.' },
  { key: 'PENYESUAIAN_JABATAN', label: 'Penyesuaian jabatan', bantuan: 'Mengubah jabatan saat Selesai.' },
]
const JENIS_LABEL: Record<Jenis, string> = { UKP: 'UKP', KGB: 'KGB', MUTASI: 'Mutasi', PENYESUAIAN_JABATAN: 'Penyesuaian jabatan' }
const STATUS: Status[] = ['Diajukan', 'Diproses', 'Disetujui', 'Ditolak', 'Selesai', 'Dibatalkan']
const FIELD: Record<Jenis, (keyof Nilai)[]> = { UKP: ['pangkat'], KGB: [], MUTASI: ['jabatan', 'unitKerja'], PENYESUAIAN_JABATAN: ['jabatan'] }
const FIELD_LABEL: Record<keyof Nilai, string> = { pangkat: 'Pangkat / golongan', jabatan: 'Jabatan', unitKerja: 'Unit kerja' }
const GOLONGAN_PNS = ['I', 'II', 'III', 'IV'].flatMap(g => (g === 'IV' ? ['a', 'b', 'c', 'd', 'e'] : ['a', 'b', 'c', 'd']).map(r => `${g}/${r}`))
const MAKS_PDF = 5 * 1024 * 1024

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  self_review_forbidden: 'Pengajuan yang Anda catat atau ubah sendiri harus diputuskan oleh orang lain.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak dapat diproses.',
  invalid_rank: 'Pilih pangkat/golongan dari daftar yang tersedia.',
  version_conflict: 'Pengajuan sudah diubah orang lain. Data dimuat ulang; periksa lalu ulangi.',
  status_tidak_sesuai: 'Status pengajuan sudah berubah; tindakan ini tidak berlaku lagi.',
  pengajuan_ganda: 'Personel ini masih punya pengajuan terbuka dengan jenis yang sama.',
  personel_berubah: 'Data Master Personel berubah sejak dialog dibuka. Nilai terkini dimuat ulang; periksa lalu simpan lagi.',
  personel_terarsip: 'Personel sudah diarsipkan; pengajuan hanya bisa dibatalkan.',
  personel_tidak_aktif: 'Pengajuan hanya untuk personel berstatus Aktif atau MPP.',
  personel_belum_lengkap: 'Lengkapi jenis personel (Polri/PNS) di Master Personel sebelum mengajukan UKP.',
  batas_lampiran: 'Batas 10 lampiran per pengajuan sudah tercapai.',
  file_too_large: 'Berkas lebih dari 5 MB.',
  one_file_required: 'Unggah tepat satu berkas.',
  invalid_file_type: 'Berkas harus PDF yang sah (nama berakhiran .pdf).',
  evidence_encryption_unavailable: 'Penyimpanan berkas aman sedang tidak tersedia. Hubungi admin sistem.',
  evidence_integrity_failure: 'Berkas tidak lolos pemeriksaan keutuhan. Hubungi admin sistem.',
  not_found: 'Data tidak ditemukan.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
const api = makeApi(ERRORS, 'Karier & Mutasi tidak tersedia di server saat ini.')

function StatusBadge({ status }: { status: Status }) {
  return <span className={`sdl-karier__status is-${status.toLowerCase()}`}>{status}</span>
}

export default function SumdaKarierR5H28({ initialID, userId }: { initialID?: string; userId: string }) {
  const [unavailable, setUnavailable] = useState(false)
  const lost = useCallback(() => setUnavailable(true), [])
  const [caps, setCaps] = useState<Caps | null>(null)
  useEffect(() => { api<Caps>('/karier/capabilities').then(setCaps).catch(e => { if (e instanceof TidakTersedia) lost() }) }, [lost])

  const [q, setQ] = useState(''); const [qLive, setQLive] = useState('')
  const [status, setStatus] = useState(''); const [jenis, setJenis] = useState('')
  const [page, setPage] = useState(1); const [size, setSize] = useState(10)
  const [data, setData] = useState<{ items: Karier[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [baru, setBaru] = useState(false)

  useEffect(() => { const t = setTimeout(() => setQ(qLive.trim()), 300); return () => clearTimeout(t) }, [qLive])
  useEffect(() => { setPage(1) }, [q, status, jenis, size])
  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: String(size) })
    if (q) p.set('q', q); if (status) p.set('status', status); if (jenis) p.set('jenis', jenis)
    try { setData(await api(`/karier?${p}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) lost(); else setError((e as Error).message) }
  }, [q, status, jenis, page, size, lost])
  useEffect(() => { void load() }, [load])
  // ?id= dari URL bisa dibuat orang lain: hanya UUID yang dipakai (pelajaran review R5H27 S2).
  useEffect(() => { if (initialID && UUID_RE.test(initialID)) setOpenId(initialID) }, [initialID])

  const pager: PagerState = useMemo(() => {
    const total = data?.total ?? 0
    return { total, size, page, pageCount: Math.max(1, Math.ceil(total / size)), start: (page - 1) * size, setSize, setPage } as PagerState
  }, [data, size, page])

  if (unavailable) return <section className="sdl-sumda"><div className="panel sdl-sumda__notice is-warn" role="alert">
    <strong>Karier &amp; Mutasi tidak tersedia di server saat ini.</strong>
    <p>Layanan ini sedang dialihkan. Data pengajuan tidak hilang; coba lagi beberapa saat lagi atau hubungi admin sistem.</p></div></section>

  return <section className="sdl-sumda">
    <div className="sdl-sumda__toolbar">
      <label className="sdl-sumda__search"><span className="sdl-sumda__sr">Cari pengajuan</span>
        <input type="search" value={qLive} maxLength={100} placeholder="Cari nama, NRP/NIP, atau nomor referensi…" onChange={e => setQLive(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Jenis</span>
        <select value={jenis} onChange={e => setJenis(e.target.value)}><option value="">Semua jenis</option>{JENIS.map(j => <option key={j.key} value={j.key}>{JENIS_LABEL[j.key]}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Status</span>
        <select value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option>{STATUS.map(s => <option key={s}>{s}</option>)}</select></label>
      <span className="sdl-sumda__grow" />
      {caps?.canManage && <button type="button" className="btn primary" onClick={() => setBaru(true)}>Buat pengajuan</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Personel</th><th>Jenis</th><th>Usulan</th><th className="is-num">Tgl. usulan</th><th className="is-num">TMT</th><th>Status</th></tr></thead>
        <tbody>
          {data === null ? <tr><td colSpan={6} className="sdl-sumda__muted">Memuat…</td></tr>
            : data.items.length === 0 ? <tr><td colSpan={6} className="sdl-sumda__empty"><strong>Belum ada pengajuan yang cocok.</strong></td></tr>
              : data.items.map(k => <tr key={k.id} className="sdl-sumda__click" onClick={() => setOpenId(k.id)}>
                <td><div className="sdl-sumda__who"><strong>{k.personel.nama}</strong><span className="sdl-sumda__mono">{k.personel.nrp}</span></div>
                  {k.personel.terarsip && <span className="sdl-sumda__flag">Personel terarsip</span>}</td>
                <td>{JENIS_LABEL[k.jenis]}{k.nomorReferensi && <small className="sdl-sumda__sub sdl-sumda__mono">{k.nomorReferensi}</small>}</td>
                <td>{k.ringkas}</td>
                <td className="is-num sdl-sumda__mono">{tgl(k.tanggalUsulan)}</td>
                <td className="is-num sdl-sumda__mono">{k.tanggalEfektif ? tgl(k.tanggalEfektif) : '—'}</td>
                <td><StatusBadge status={k.status} /></td>
              </tr>)}
        </tbody>
      </table></div>
      <Pager pager={pager} label="pengajuan" />
    </div>
    {baru && <FormPengajuan onClose={() => setBaru(false)} onSaved={k => { setBaru(false); showToast('Pengajuan dicatat.'); setOpenId(k.id); void load() }} />}
    {openId && <DetailPengajuan id={openId} caps={caps} userId={userId} onClose={() => setOpenId(null)} onChanged={() => void load()} onLost={lost} />}
  </section>
}

/* ------------------------------------------------------- Pilih nilai (pangkat) */

function useRanks() {
  const [ranks, setRanks] = useState<Rank[]>([])
  useEffect(() => { api<{ items: Rank[] }>('/registry/ranks').then(r => setRanks(r.items)).catch(() => setRanks([])) }, [])
  return ranks
}
function opsiPangkat(jenisPersonel: string, ranks: Rank[]) {
  return jenisPersonel === 'PNS' ? GOLONGAN_PNS.map(g => ({ value: g, label: `Golongan ${g}` })) : ranks.map(r => ({ value: r.code, label: `${r.shortName} — ${r.fullName}` }))
}

function NilaiFields({ jenis, jenisPersonel, v, set, ranks }: { jenis: Jenis; jenisPersonel: string; v: Nilai; set: (k: keyof Nilai, x: string) => void; ranks: Rank[] }) {
  return <>{FIELD[jenis].map(f => <label key={f}><span>{FIELD_LABEL[f]} baru{(jenis === 'UKP' || jenis === 'PENYESUAIAN_JABATAN') && <b aria-hidden="true"> *</b>}</span>
    {f === 'pangkat'
      ? <select value={v.pangkat} onChange={e => set('pangkat', e.target.value)}><option value="">— Pilih —</option>{opsiPangkat(jenisPersonel, ranks).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
      : <input value={v[f]} maxLength={200} onChange={e => set(f, e.target.value)} />}
  </label>)}</>
}

/* ------------------------------------------------------------- Buat pengajuan */

function FormPengajuan({ onClose, onSaved }: { onClose: () => void; onSaved: (k: Karier) => void }) {
  const ranks = useRanks()
  const [cari, setCari] = useState('')
  const [hasil, setHasil] = useState<PersonelRingkas[]>([])
  const [personel, setPersonel] = useState<PersonelRingkas | null>(null)
  const [jenis, setJenis] = useState<Jenis>('UKP')
  const [v, setV] = useState({ nomorReferensi: '', tanggalUsulan: '', tanggalEfektif: '', catatan: '' })
  const [nilai, setNilai] = useState<Nilai>({ pangkat: '', jabatan: '', unitKerja: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const t = setTimeout(() => {
      const term = cari.trim()
      if (term.length < 2) { setHasil([]); return }
      Promise.all(['Aktif', 'MPP'].map(st => api<{ items: PersonelRingkas[] }>(`/personel?${new URLSearchParams({ q: term, status: st, size: '10' })}`)))
        .then(r => setHasil(r.flatMap(x => x.items).slice(0, 10))).catch(() => setHasil([]))
    }, 300)
    return () => clearTimeout(t)
  }, [cari])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!personel) return setError('Pilih personel lebih dulu.')
    if (!v.tanggalUsulan) return setError('Tanggal usulan wajib diisi.')
    setBusy(true); setError('')
    try {
      const usulan = Object.fromEntries(FIELD[jenis].map(f => [f, nilai[f]]))
      const r = await api<{ item: Karier }>('/karier', 'POST', { personelId: personel.id, jenis, ...v, usulan })
      onSaved(r.item)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return <Shade onClose={onClose} label="Buat pengajuan karier" busy={busy}>
    <form onSubmit={e => void submit(e)} className="sdl-sumda__form">
      <header><span className="sdl-progar__eyebrow">KARIER &amp; MUTASI</span><h2>Buat pengajuan</h2>
        <p>Pengajuan diputuskan Kasubbagsumda. Sebaiknya dicatat operator/staf: pencatat tidak bisa memutus pengajuannya sendiri.</p></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label className="sdl-sumda__wide"><span>Personel<b aria-hidden="true"> *</b></span>
          {personel
            ? <div className="sdl-karier__picked"><span><strong>{personel.nama}</strong> <span className="sdl-sumda__mono">{personel.nrp}</span><small className="sdl-sumda__sub">{personel.pangkatLabel || '—'} · {personel.jabatan || '—'} · {personel.unitKerja || '—'}</small></span>
              <button type="button" className="btn" onClick={() => { setPersonel(null); setCari('') }}>Ganti</button></div>
            : <><input type="search" value={cari} autoFocus placeholder="Ketik nama atau NRP (min. 2 huruf)…" onChange={e => setCari(e.target.value)} />
              {hasil.length > 0 && <ul className="sdl-karier__hasil" role="listbox" aria-label="Hasil pencarian personel">{hasil.map(p => <li key={p.id}>
                <button type="button" role="option" aria-selected="false" onClick={() => { setPersonel(p); setHasil([]) }}><strong>{p.nama}</strong> <span className="sdl-sumda__mono">{p.nrp}</span><small>{p.status}</small></button></li>)}</ul>}
              <small>Hanya personel berstatus Aktif atau MPP.</small></>}
        </label>
        <label><span>Jenis pengajuan<b aria-hidden="true"> *</b></span>
          <select value={jenis} onChange={e => { setJenis(e.target.value as Jenis); setNilai({ pangkat: '', jabatan: '', unitKerja: '' }) }}>{JENIS.map(j => <option key={j.key} value={j.key}>{j.label}</option>)}</select>
          <small>{JENIS.find(j => j.key === jenis)?.bantuan}</small></label>
        <label><span>No. referensi / SK</span><input value={v.nomorReferensi} maxLength={100} onChange={e => setV(s => ({ ...s, nomorReferensi: e.target.value }))} /></label>
        <label><span>Tanggal usulan<b aria-hidden="true"> *</b></span><input type="date" min="2000-01-01" max="2100-12-31" value={v.tanggalUsulan} onChange={e => setV(s => ({ ...s, tanggalUsulan: e.target.value }))} /></label>
        <label><span>Tanggal efektif (TMT)</span><input type="date" min="2000-01-01" max="2100-12-31" value={v.tanggalEfektif} onChange={e => setV(s => ({ ...s, tanggalEfektif: e.target.value }))} /><small>Wajib saat menandai Selesai.</small></label>
        {personel && <NilaiFields jenis={jenis} jenisPersonel={personel.jenis} v={nilai} set={(k, x) => setNilai(s => ({ ...s, [k]: x }))} ranks={ranks} />}
        <label className="sdl-sumda__wide"><span>Catatan</span><textarea rows={3} maxLength={1000} value={v.catatan} onChange={e => setV(s => ({ ...s, catatan: e.target.value }))} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan pengajuan'}</button></footer>
    </form>
  </Shade>
}

/* ----------------------------------------------------------- Detail & aksi */

type Aksi = 'proses' | 'setujui' | 'tolak' | 'batalkan' | 'selesai'

function DetailPengajuan({ id, caps, userId, onClose, onChanged, onLost }: { id: string; caps: Caps | null; userId: string; onClose: () => void; onChanged: () => void; onLost: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selesai, setSelesai] = useState(false)
  const [alasanFor, setAlasanFor] = useState<'tolak' | 'batalkan' | null>(null)
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const muat = useCallback(async () => {
    try { setD(await api<Detail>(`/karier/${encodeURIComponent(id)}`)); setError('') } catch (e) {
      if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message)
    }
  }, [id, onLost])
  useEffect(() => { void muat() }, [muat])

  if (!d) return <Shade onClose={onClose} label="Detail pengajuan"><p className="sdl-sumda__muted">{error || 'Memuat…'}</p>
    <footer><button type="button" className="btn" onClick={onClose}>Tutup</button></footer></Shade>
  const k = d.item
  const terbuka = ['Diajukan', 'Diproses', 'Disetujui'].includes(k.status)
  const sayaPencatat = k.createdBy === userId || k.updatedBy === userId

  async function jalankan(aksi: Aksi, catatan = '') {
    if (aksi === 'setujui' && !(await confirmDialog(`Setujui pengajuan ${JENIS_LABEL[k.jenis]} untuk ${k.personel.nama}?`, { confirmLabel: 'Setujui' }))) return
    setBusy(true)
    try {
      await api(`/karier/${encodeURIComponent(k.id)}/aksi`, 'POST', { aksi, catatan, version: k.version })
      showToast({ proses: 'Pengajuan diproses.', setujui: 'Pengajuan disetujui.', tolak: 'Pengajuan ditolak.', batalkan: 'Pengajuan dibatalkan.', selesai: '' }[aksi])
      onChanged()
    } catch (e) { showToast((e as Error).message, 'error') } finally { setBusy(false); void muat() }
  }

  async function unggah(f: File) {
    if (f.size > MAKS_PDF) { showToast(ERRORS.file_too_large, 'error'); return }
    // Server membaca nama multipart sebagai Latin-1; karakter non-ASCII diganti '_' supaya tidak tertolak.
    const fd = new FormData(); fd.append('file', f, f.name.replace(/[^\x20-\x7e]/g, '_'))
    setBusy(true)
    try { await api(`/karier/${encodeURIComponent(k.id)}/lampiran`, 'POST', fd); showToast('Lampiran diunggah.') } catch (e) { showToast((e as Error).message, 'error') }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; void muat() }
  }
  async function hapus(l: Lampiran) {
    if (!(await confirmDialog(`Hapus lampiran ${l.filename}?`, { confirmLabel: 'Hapus', danger: true }))) return
    try { await api(`/karier/${encodeURIComponent(k.id)}/lampiran/${encodeURIComponent(l.id)}`, 'DELETE'); showToast('Lampiran dihapus.') } catch (e) { showToast((e as Error).message, 'error') }
    void muat()
  }

  const bisaHapusLampiran = (l: Lampiran) => caps?.canManage && ['Diajukan', 'Diproses'].includes(k.status) && (l.uploadedBy === userId || caps.canApprove)
  return <Shade onClose={onClose} label={`Pengajuan ${k.personel.nama}`} busy={busy}>
    <header><span className="sdl-progar__eyebrow">KARIER &amp; MUTASI</span><h2>{JENIS_LABEL[k.jenis]} · {k.personel.nama}</h2>
      <p><StatusBadge status={k.status} /> <span className="sdl-sumda__mono">{k.personel.nrp}</span>{k.nomorReferensi && <> · Ref. <span className="sdl-sumda__mono">{k.nomorReferensi}</span></>}</p></header>
    {k.personel.terarsip && <p className="sdl-sumda__notice is-warn">Personel sudah diarsipkan; pengajuan ini hanya bisa dibatalkan.</p>}
    {k.status === 'Diproses' && caps?.canApprove && sayaPencatat && <p className="sdl-sumda__notice">Anda mencatat atau terakhir mengubah pengajuan ini, jadi keputusannya harus diambil pemegang hak setuju lain.</p>}

    {k.jenis !== 'KGB' && <table className="sdl-karier__banding">
      <thead><tr><th></th><th>Sekarang (Master Personel)</th><th>{k.status === 'Selesai' ? 'Diterapkan' : 'Usulan'}</th></tr></thead>
      <tbody>{FIELD[k.jenis].map(f => {
        const now = f === 'pangkat' ? k.personel.pangkatLabel : f === 'jabatan' ? k.personel.jabatan : k.personel.unitKerja
        const ditr = k.diterapkan?.fields?.[f]
        const usul = f === 'pangkat' ? k.usulan.pangkatLabel : k.usulan[f]
        // Pangkat disimpan sebagai kode; tampilkan label bila kode baru sama dengan usulan.
        const baru = ditr && f === 'pangkat' && ditr.baru === k.usulan.pangkat ? k.usulan.pangkatLabel : ditr?.baru
        const koreksi = k.diterapkan?.dikoreksi?.includes(f)
        return <tr key={f}><th scope="row">{FIELD_LABEL[f]}</th><td>{now || '—'}</td><td>{ditr ? `${ditr.lama || '—'} → ${baru}` : usul || '—'}{koreksi && <small className="sdl-sumda__flag" title="Nilai yang diterapkan berbeda dari usulan yang disetujui">Dikoreksi saat selesai</small>}</td></tr>
      })}</tbody></table>}
    <dl className="sdl-sumda__detail">
      <div><dt>Tanggal usulan</dt><dd className="sdl-sumda__mono">{tgl(k.tanggalUsulan)}</dd></div>
      <div><dt>Tanggal efektif (TMT)</dt><dd className="sdl-sumda__mono">{k.tanggalEfektif ? tgl(k.tanggalEfektif) : '—'}</dd></div>
      <div><dt>Dicatat oleh</dt><dd>{k.createdByName || '—'}</dd></div>
      <div><dt>Diputus oleh</dt><dd>{k.decidedByName ? `${k.decidedByName}, ${waktu(k.decidedAt ?? '')}` : '—'}</dd></div>
    </dl>
    {k.catatan && <div className="sdl-sumda__catatan"><strong>Catatan</strong><p>{k.catatan}</p></div>}

    <section className="sdl-sumda__riwayat" aria-label="Lampiran">
      <strong>Lampiran PDF ({d.lampiran.length}/10)</strong>
      {d.lampiran.length === 0 ? <p className="sdl-sumda__muted">Belum ada lampiran.</p>
        : <ol className="sdl-karier__lampiran">{d.lampiran.map(l => <li key={l.id}>
          <button type="button" className="sdl-sumda__link" onClick={() => setPreview({ url: `/api/v1/subbagsumda/karier/${encodeURIComponent(k.id)}/lampiran/${encodeURIComponent(l.id)}`, name: l.filename })}>{l.filename}</button>
          <span className="sdl-sumda__muted">{l.size < 1024 ? '< 1 KB' : `${Math.round(l.size / 1024)} KB`} · {l.uploadedByName}</span>
          {bisaHapusLampiran(l) ? <button type="button" className="btn sdl-progar__danger" onClick={() => void hapus(l)}>Hapus</button> : <span />}
        </li>)}</ol>}
      {caps?.canManage && terbuka && d.lampiran.length < 10 && <>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden onChange={e => { const f = e.target.files?.[0]; if (f) void unggah(f) }} />
        <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>Unggah PDF (maks. 5 MB)</button></>}
    </section>

    <section className="sdl-sumda__riwayat" aria-label="Riwayat status">
      <strong>Riwayat status</strong>
      <ol>{d.riwayat.map((h, i) => <li key={i}><span className="sdl-sumda__mono">{waktu(h.pada)}</span><span>{h.dari ? `${h.dari} → ${h.ke}` : h.ke}{h.catatan && ` — ${h.catatan}`}</span><span className="sdl-sumda__muted">{h.oleh}</span></li>)}</ol>
    </section>

    <footer>
      {caps?.canManage && ['Diajukan', 'Diproses'].includes(k.status) && (k.createdBy === userId || caps.canApprove) && <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setAlasanFor('batalkan')}>Batalkan</button>}
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={onClose}>Tutup</button>
      {caps?.canManage && k.status === 'Diajukan' && !k.personel.terarsip && <button type="button" className="btn primary" disabled={busy} onClick={() => void jalankan('proses')}>Proses</button>}
      {caps?.canApprove && k.status === 'Diproses' && !sayaPencatat && !k.personel.terarsip && <>
        <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setAlasanFor('tolak')}>Tolak</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void jalankan('setujui')}>Setujui</button></>}
      {caps?.canManage && k.status === 'Disetujui' && !k.personel.terarsip && <button type="button" className="btn primary" disabled={busy} onClick={() => setSelesai(true)}>Tandai selesai…</button>}
    </footer>
    {selesai && <SelesaiDialog k={k} onClose={() => setSelesai(false)} onDone={() => { setSelesai(false); showToast('Pengajuan selesai; Master Personel diperbarui.'); onChanged(); void muat() }} onReload={() => void muat()} />}
    {alasanFor && <AlasanDialog judul={alasanFor === 'tolak' ? 'Tolak pengajuan' : 'Batalkan pengajuan'} onClose={() => setAlasanFor(null)}
      onSubmit={async alasan => { const a = alasanFor; setAlasanFor(null); await jalankan(a, alasan) }} />}
    {preview && <LampiranPreviewR5F15 stored={{ url: preview.url, name: preview.name, mime: 'application/pdf' }} maxBytes={MAKS_PDF} title="Lampiran Karier & Mutasi" note="Pratinjau berkas pendukung pengajuan." onClose={() => setPreview(null)} />}
  </Shade>
}

/** Konfirmasi nilai yang diterapkan ke Master Personel (K2/K10). */
function SelesaiDialog({ k, onClose, onDone, onReload }: { k: Karier; onClose: () => void; onDone: () => void; onReload: () => void }) {
  const ranks = useRanks()
  const [tmt, setTmt] = useState(k.tanggalEfektif)
  const [catatan, setCatatan] = useState('')
  const [nilai, setNilai] = useState<Nilai>({ pangkat: k.usulan.pangkat, jabatan: k.usulan.jabatan, unitKerja: k.usulan.unitKerja })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (!tmt) return setError('Tanggal efektif (TMT) wajib diisi.')
    setBusy(true); setError('')
    try {
      const terapkan = k.jenis === 'KGB' ? undefined : { ...Object.fromEntries(FIELD[k.jenis].map(f => [f, nilai[f]])), personelVersion: k.personel.version }
      await api(`/karier/${encodeURIComponent(k.id)}/aksi`, 'POST', { aksi: 'selesai', catatan, version: k.version, tanggalEfektif: tmt, ...(terapkan ? { terapkan } : {}) })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      if (err instanceof ApiError && (err.code === 'personel_berubah' || err.code === 'version_conflict')) { onReload(); onClose() }
    } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label="Tandai selesai" busy={busy}>
    <form onSubmit={e => void submit(e)} className="sdl-sumda__form">
      <header><span className="sdl-progar__eyebrow">KARIER &amp; MUTASI</span><h2>Tandai selesai</h2>
        <p>{k.jenis === 'KGB' ? 'KGB tidak mengubah Master Personel.' : 'Periksa nilai baru. Setelah disimpan, Master Personel diperbarui dan tidak bisa dibatalkan dari sini.'}</p></header>
      {k.personel.status !== 'Aktif' && k.personel.status !== 'MPP' && <p className="sdl-sumda__notice is-warn">Status personel saat ini {k.personel.status}. Pastikan penerapan ini memang dimaksud.</p>}
      <div className="sdl-progar__fields sdl-sumda__grid">
        {FIELD[k.jenis].map(f => <label key={`now-${f}`}><span>{FIELD_LABEL[f]} sekarang</span><input value={(f === 'pangkat' ? k.personel.pangkatLabel : f === 'jabatan' ? k.personel.jabatan : k.personel.unitKerja) || '—'} disabled /></label>)}
        <NilaiFields jenis={k.jenis} jenisPersonel={k.personel.jenis} v={nilai} set={(kk, x) => setNilai(s => ({ ...s, [kk]: x }))} ranks={ranks} />
        <label><span>Tanggal efektif (TMT)<b aria-hidden="true"> *</b></span><input type="date" min="2000-01-01" max="2100-12-31" value={tmt} onChange={e => setTmt(e.target.value)} /></label>
        <label className="sdl-sumda__wide"><span>Catatan</span><textarea rows={2} maxLength={1000} value={catatan} onChange={e => setCatatan(e.target.value)} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan & terapkan'}</button></footer>
    </form>
  </Shade>
}

/** Alasan wajib untuk tolak/batalkan (K24: minimal 8 karakter). */
function AlasanDialog({ judul, onClose, onSubmit }: { judul: string; onClose: () => void; onSubmit: (alasan: string) => Promise<void> }) {
  const [alasan, setAlasan] = useState('')
  const [error, setError] = useState('')
  return <Shade onClose={onClose} label={judul}>
    <form className="sdl-sumda__form" onSubmit={e => {
      e.preventDefault()
      if ([...alasan.trim()].length < 8) { setError('Alasan minimal 8 karakter.'); return }
      void onSubmit(alasan.trim())
    }}>
      <header><span className="sdl-progar__eyebrow">KARIER &amp; MUTASI</span><h2>{judul}</h2><p>Alasan tercatat di riwayat pengajuan.</p></header>
      <div className="sdl-progar__fields"><label><span>Alasan<b aria-hidden="true"> *</b></span>
        <textarea rows={3} maxLength={1000} autoFocus value={alasan} onChange={e => setAlasan(e.target.value)} /></label></div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" onClick={onClose}>Kembali</button><button type="submit" className="btn primary sdl-progar__danger-solid">{judul.split(' ')[0]}</button></footer>
    </form>
  </Shade>
}
