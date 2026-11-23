import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Pager, type PagerState } from './PaginationR5H5'
import { confirmDialog, showToast } from './UIFeedback'
import { ApiError, BULAN, Shade, TidakTersedia, UUID_RE, makeApi, tgl, waktu } from './SumdaBersama'
import './ProgarR5H11.css'
import './SumdaPersonelR5H27.css'

/**
 * R5H27: Subbagsumda — Dashboard, Master Personel, Monitoring Pensiun.
 *
 * Satu komponen, tiga mode (menu):
 *   'dashboard' — ringkasan satu baris, alert terdekat, proyeksi 6 bulan, terdekat pensiun, aktivitas.
 *   'master'    — direktori personel berhalaman di server (cari, filter, tambah/ubah/arsip).
 *   'pensiun'   — alert per tahap H-60/H-30/H-14/H-7/Jatuh tempo + "Tandai tinjau" bersama unit.
 *
 * Gaya "buku register" (docs/DESIGN-BRIEF.md): tabel, angka tabular, tanpa hero dan tanpa kartu
 * statistik berikon. Tahap dan sisa hari dihitung SERVER (Asia/Jakarta); layar hanya menampilkan.
 * Backend: /api/v1/subbagsumda/{personel,pensiun,dashboard} (Express saja, migrasi 068).
 * Bila endpoint 404 (prefix di-rollback ke Go), tampil pesan + akses darurat ke registry lama (K20).
 */

type Tahap = 'H-60' | 'H-30' | 'H-14' | 'H-7' | 'JATUH_TEMPO'
type Status = 'Aktif' | 'MPP' | 'Pensiun' | 'Nonaktif'
type RiwayatKarier = { id: string; jenis: string; status: string; tanggalUsulan: string; tanggalEfektif: string; ringkas: string }
type RiwayatDiklat = { diklatId: string; pesertaId: string; nama: string; jenis: string; status: string; tanggalMulai: string; tanggalSelesai: string; hasil: string; nomorSertifikat: string }
type KompetensiRingkas = { id: string; nama: string; kategori: string; nomor: string; berlakuSampai: string; sisaHari: number | null; tahap: 'H-60' | 'H-30' | 'KEDALUWARSA' | null }
type Personel = {
  id: string; nrp: string; nama: string; jenis: '' | 'Polri' | 'PNS'; pangkat: string; pangkatLabel: string
  jabatan: string; unitKerja: string; tmtDinas: string; tanggalPensiun: string; status: Status; catatan: string
  version: number; salinan: boolean; perluDilengkapi: boolean; sisaHari: number | null; tahap: Tahap | null
  riwayatKarier?: RiwayatKarier[]
  riwayatDiklat?: RiwayatDiklat[]
  kompetensi?: KompetensiRingkas[]
}
type Alert = { personel: Personel; sisaHari: number; tahap: Tahap; ditinjau: { oleh: string; pada: string } | null }
type Caps = { canRead: boolean; canCreate: boolean; canUpdate: boolean; canArchive: boolean; canReview: boolean }
type Aktivitas = { jenis: string; personelId: string | null; personelNama: string | null; oleh: string; pada: string; rincian: Record<string, unknown> }
type Dashboard = {
  totals: { personel: number; aktif: number; mpp: number; alert: number; belumDitinjau: number; belumLengkap: number; enamBulan: number; karierMenunggu?: number; kompetensiKedaluwarsa60?: number }
  proyeksi: { bulan: string; jumlah: number }[]; alertTerdekat: Alert[]; terdekat: Personel[]; aktivitas: Aktivitas[]
}
type Rank = { code: string; shortName: string; fullName: string; group: string }
type Mode = 'dashboard' | 'master' | 'pensiun'
export type SumdaNav = (menu: 'personel' | 'pensiun' | 'karier' | 'diklat', opts?: { recordID?: string; tab?: string }) => void

const STATUS: Status[] = ['Aktif', 'MPP', 'Pensiun', 'Nonaktif']
const TAHAP: { key: Tahap; label: string; rentang: string }[] = [
  { key: 'H-60', label: '2 bulan lagi', rentang: '31–60 hari' },
  { key: 'H-30', label: '1 bulan lagi', rentang: '15–30 hari' },
  { key: 'H-14', label: '2 minggu lagi', rentang: '8–14 hari' },
  { key: 'H-7', label: '1 minggu lagi', rentang: '1–7 hari' },
  { key: 'JATUH_TEMPO', label: 'Jatuh tempo', rentang: 'hari ini atau terlewat' },
]
const GOLONGAN_PNS = ['I', 'II', 'III', 'IV'].flatMap(g => (g === 'IV' ? ['a', 'b', 'c', 'd', 'e'] : ['a', 'b', 'c', 'd']).map(r => `${g}/${r}`))
const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Personel Aktif/MPP wajib bertanggal pensiun.',
  invalid_body: 'Isian tidak dapat diproses.',
  invalid_rank: 'Pilih pangkat/golongan dari daftar yang tersedia.',
  duplicate_nrp: 'NRP/NIP tersebut sudah terdaftar pada personel lain.',
  version_conflict: 'Data sudah diubah orang lain. Data dimuat ulang; periksa lalu ulangi.',
  alert_berubah: 'Sebagian alert sudah berubah (tanggal atau tahap). Daftar dimuat ulang.',
  not_found: 'Data sudah tidak ada atau sudah diarsipkan.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}

const api = makeApi(ERRORS, 'Master Personel tidak tersedia di server saat ini.')

function sisaTeks(n: number | null) {
  if (n === null) return ''
  return n > 0 ? `${n} hari lagi` : n === 0 ? 'Hari ini' : `Lewat ${-n} hari`
}
function TahapBadge({ tahap }: { tahap: Tahap | null }) {
  if (!tahap) return null
  return <span className={`sdl-sumda__tahap is-${tahap === 'JATUH_TEMPO' ? 'due' : tahap.toLowerCase()}`}>{tahap === 'JATUH_TEMPO' ? 'Jatuh tempo' : tahap}</span>
}
function StatusBadge({ status }: { status: Status }) {
  return <span className={`sdl-sumda__status is-${status.toLowerCase()}`}>{status}</span>
}
function NamaSel({ p }: { p: Personel }) {
  return <div className="sdl-sumda__who"><strong>{p.nama}</strong><span className="sdl-sumda__mono">{p.nrp}</span></div>
}

function useCaps() {
  const [caps, setCaps] = useState<Caps | null>(null)
  useEffect(() => { api<Caps>('/personel/capabilities').then(setCaps).catch(() => setCaps(null)) }, [])
  return caps
}

export default function SumdaPersonelR5H27({ mode, initialID, onNavigate, legacy }: { mode: Mode; initialID?: string; onNavigate: SumdaNav; legacy?: ReactNode }) {
  const [unavailable, setUnavailable] = useState(false)
  const [showLegacy, setShowLegacy] = useState(false)
  const lost = useCallback(() => setUnavailable(true), [])
  if (unavailable) {
    return <section className="sdl-sumda">
      <div className="panel sdl-sumda__notice is-warn" role="alert">
        <strong>Master Personel tidak tersedia di server saat ini.</strong>
        <p>Layanan ini sedang dialihkan. Data personel tidak hilang; coba lagi beberapa saat lagi atau hubungi admin sistem.</p>
        {legacy && <button type="button" className="btn" onClick={() => setShowLegacy(v => !v)}>{showLegacy ? 'Sembunyikan' : 'Buka'} data registry lama (darurat)</button>}
      </div>
      {showLegacy && legacy}
    </section>
  }
  return mode === 'dashboard' ? <DashboardView onNavigate={onNavigate} onLost={lost} />
    : mode === 'pensiun' ? <PensiunView onNavigate={onNavigate} onLost={lost} />
      : <MasterView initialID={initialID} onLost={lost} />
}

/* --------------------------------------------------------------- Dashboard */

function DashboardView({ onNavigate, onLost }: { onNavigate: SumdaNav; onLost: () => void }) {
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api<Dashboard>('/dashboard').then(setData).catch(e => { if (e instanceof TidakTersedia) onLost(); else setError(e.message) })
  }, [onLost])
  if (error) return <p className="sdl-progar__error" role="alert">{error}</p>
  if (!data) return <p className="sdl-sumda__muted" aria-live="polite">Memuat ringkasan…</p>
  const t = data.totals
  const max = Math.max(1, ...data.proyeksi.map(b => b.jumlah))
  return <section className="sdl-sumda">
    <dl className="sdl-sumda__summary" aria-label="Ringkasan personel">
      <div><dt>Personel terdata</dt><dd>{t.personel}</dd><small>{t.aktif} aktif · {t.mpp} MPP</small></div>
      <div className={t.belumDitinjau ? 'is-attention' : ''}><dt>Alert pensiun ≤ 60 hari</dt><dd>{t.alert}</dd><small>{t.belumDitinjau} belum ditinjau</small></div>
      <div><dt>Data belum lengkap</dt><dd>{t.belumLengkap}</dd><small>Aktif/MPP tanpa tanggal pensiun atau jenis</small></div>
      <div><dt>Pensiun 6 bulan</dt><dd>{t.enamBulan}</dd><small>Bulan ini s.d. 5 bulan ke depan</small></div>
      {t.karierMenunggu !== undefined && <div className={t.karierMenunggu ? 'is-attention' : ''}><dt>Karier menunggu keputusan</dt><dd>{t.karierMenunggu}</dd>
        <small><button type="button" className="sdl-sumda__link" onClick={() => onNavigate('karier')}>Karier &amp; Mutasi</button></small></div>}
      {t.kompetensiKedaluwarsa60 !== undefined && <div className={t.kompetensiKedaluwarsa60 ? 'is-attention' : ''}><dt>Kompetensi kedaluwarsa ≤ 60 hari</dt><dd>{t.kompetensiKedaluwarsa60}</dd>
        <small><button type="button" className="sdl-sumda__link" onClick={() => onNavigate('diklat', { tab: 'kompetensi' })}>Diklat &amp; Kompetensi</button></small></div>}
    </dl>

    <div className="sdl-sumda__split">
      <section className="panel sdl-sumda__block" aria-labelledby="sumda-alert-h">
        <header><h2 id="sumda-alert-h">Alert terdekat</h2><button type="button" className="sdl-sumda__link" onClick={() => onNavigate('pensiun')}>Monitoring Pensiun</button></header>
        {data.alertTerdekat.length === 0 ? <p className="sdl-sumda__muted">Tidak ada personel yang pensiun dalam 60 hari.</p>
          : <div className="table-scroll"><table className="data-table sdl-sumda__table">
            <thead><tr><th>Personel</th><th>Tahap</th><th className="is-num">Hitung mundur</th><th>Tinjau</th></tr></thead>
            <tbody>{data.alertTerdekat.map(a => <tr key={a.personel.id} className="sdl-sumda__click" onClick={() => onNavigate('personel', { recordID: a.personel.id })}>
              <td><NamaSel p={a.personel} /></td><td><TahapBadge tahap={a.tahap} /></td>
              <td className="is-num sdl-sumda__mono">{sisaTeks(a.sisaHari)}</td>
              <td>{a.ditinjau ? <span className="sdl-sumda__muted">Sudah</span> : <span className="sdl-sumda__flag">Belum</span>}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>
      <section className="panel sdl-sumda__block" aria-labelledby="sumda-proj-h">
        <header><h2 id="sumda-proj-h">Proyeksi pensiun 6 bulan</h2></header>
        <table className="sdl-sumda__bars">
          <caption className="sdl-sumda__sr">Jumlah personel Aktif/MPP yang pensiun per bulan</caption>
          <tbody>{data.proyeksi.map(b => <tr key={b.bulan}>
            <th scope="row">{BULAN[Number(b.bulan.slice(5, 7)) - 1]} {b.bulan.slice(2, 4)}</th>
            <td><span className="sdl-sumda__bar" style={{ width: `${(b.jumlah / max) * 100}%` }} /></td>
            <td className="is-num sdl-sumda__mono">{b.jumlah}</td>
          </tr>)}</tbody>
        </table>
      </section>
    </div>

    <div className="sdl-sumda__split">
      <section className="panel sdl-sumda__block" aria-labelledby="sumda-near-h">
        <header><h2 id="sumda-near-h">Terdekat pensiun</h2><button type="button" className="sdl-sumda__link" onClick={() => onNavigate('personel')}>Master Personel</button></header>
        {data.terdekat.length === 0 ? <p className="sdl-sumda__muted">Belum ada tanggal pensiun yang tercatat.</p>
          : <div className="table-scroll"><table className="data-table sdl-sumda__table">
            <thead><tr><th>Personel</th><th>Unit kerja</th><th className="is-num">Tanggal pensiun</th></tr></thead>
            <tbody>{data.terdekat.map(p => <tr key={p.id} className="sdl-sumda__click" onClick={() => onNavigate('personel', { recordID: p.id })}>
              <td><NamaSel p={p} /></td><td>{p.unitKerja || <span className="sdl-sumda__muted">—</span>}</td>
              <td className="is-num sdl-sumda__mono">{tgl(p.tanggalPensiun)}<small>{sisaTeks(p.sisaHari)}</small></td>
            </tr>)}</tbody>
          </table></div>}
      </section>
      <section className="panel sdl-sumda__block" aria-labelledby="sumda-act-h">
        <header><h2 id="sumda-act-h">Aktivitas terakhir</h2></header>
        {data.aktivitas.length === 0 ? <p className="sdl-sumda__muted">Belum ada aktivitas.</p>
          : <ol className="sdl-sumda__log">{data.aktivitas.map((a, i) => <li key={i}>
            <span className="sdl-sumda__mono">{waktu(a.pada)}</span>
            <span><strong>{aktivitasTeks(a)}</strong><small>{a.oleh}</small></span>
          </li>)}</ol>}
      </section>
    </div>
  </section>
}

function aktivitasTeks(a: Aktivitas) {
  const siapa = a.personelNama ?? 'personel (terarsip)'
  switch (a.jenis) {
    case 'personel.create': return `Menambah ${siapa}`
    case 'personel.update': return `Mengubah data ${siapa}`
    case 'personel.archive': return `Mengarsipkan ${siapa}`
    case 'pensiun.review': return `Meninjau alert ${String(a.rincian.tahap ?? '').replace('JATUH_TEMPO', 'jatuh tempo')} ${siapa}`
    case 'personel.salin_registry': return `Menyalin ${String(a.rincian.disalin ?? 0)} personel dari registry lama`
    default: return a.jenis
  }
}

/* ------------------------------------------------------------------ Master */

type ListResp = { items: Personel[]; total: number; page: number; size: number; unitKerja: string[] }

function MasterView({ initialID, onLost }: { initialID?: string; onLost: () => void }) {
  const caps = useCaps()
  const [q, setQ] = useState('')
  const [qLive, setQLive] = useState('')
  const [status, setStatus] = useState('')
  const [unitKerja, setUnitKerja] = useState('')
  const [belum, setBelum] = useState(false)
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(10)
  const [data, setData] = useState<ListResp | null>(null)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<Personel | null>(null)
  const [form, setForm] = useState<{ item: Personel | null } | null>(null)

  useEffect(() => { const t = setTimeout(() => setQ(qLive.trim()), 300); return () => clearTimeout(t) }, [qLive])
  useEffect(() => { setPage(1) }, [q, status, unitKerja, belum, size])

  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: String(size) })
    if (q) p.set('q', q)
    if (status) p.set('status', status)
    if (unitKerja) p.set('unitKerja', unitKerja)
    if (belum) p.set('lengkap', 'belum')
    try { setData(await api<ListResp>(`/personel?${p}`)); setError('') } catch (e) {
      if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message)
    }
  }, [q, status, unitKerja, belum, page, size, onLost])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!initialID) return
    // ?id= datang dari URL yang bisa dibuat orang lain: hanya UUID yang boleh masuk ke path API,
    // supaya tautan seperti ?id=../../urmin/registry tidak memanggil endpoint lain atas nama korban.
    if (!UUID_RE.test(initialID)) { showToast('Tautan personel tidak valid.', 'error'); return }
    api<{ item: Personel }>(`/personel/${encodeURIComponent(initialID)}`).then(r => setDetail(r.item)).catch(e => { if (e instanceof TidakTersedia) onLost(); else showToast((e as Error).message, 'error') })
  }, [initialID, onLost])

  const pager: PagerState = useMemo(() => {
    const total = data?.total ?? 0
    const pageCount = Math.max(1, Math.ceil(total / size))
    return { total, size, page, pageCount, start: (page - 1) * size, setSize, setPage } as PagerState
  }, [data, size, page])

  async function arsip(p: Personel) {
    if (!(await confirmDialog(`Arsipkan ${p.nama} (${p.nrp}) dari Master Personel? Data tidak tampil lagi di daftar dan alert.`, { confirmLabel: 'Arsipkan', danger: true }))) return
    try {
      await api(`/personel/${p.id}?version=${p.version}`, 'DELETE')
      showToast('Personel diarsipkan.'); setDetail(null); void load()
    } catch (e) { showToast((e as Error).message, 'error'); if (e instanceof ApiError && e.code === 'version_conflict') { setDetail(null); void load() } }
  }

  return <section className="sdl-sumda">
    <div className="sdl-sumda__toolbar">
      <label className="sdl-sumda__search"><span className="sdl-sumda__sr">Cari personel</span>
        <input type="search" value={qLive} maxLength={100} placeholder="Cari nama, NRP/NIP, pangkat, jabatan, unit…" onChange={e => setQLive(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Status</span>
        <select value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option>{STATUS.map(s => <option key={s}>{s}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Unit kerja</span>
        <select value={unitKerja} onChange={e => setUnitKerja(e.target.value)}><option value="">Semua unit kerja</option>{(data?.unitKerja ?? []).map(u => <option key={u}>{u}</option>)}</select></label>
      <label className="sdl-sumda__check"><input type="checkbox" checked={belum} onChange={e => setBelum(e.target.checked)} /> Belum lengkap saja</label>
      <span className="sdl-sumda__grow" />
      {caps?.canCreate && <button type="button" className="btn primary" onClick={() => setForm({ item: null })}>Tambah personel</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Personel</th><th>Pangkat / jabatan</th><th>Unit kerja</th><th className="is-num">Tanggal pensiun</th><th>Status</th><th><span className="sdl-sumda__sr">Aksi</span></th></tr></thead>
        <tbody>
          {data === null ? <tr><td colSpan={6} className="sdl-sumda__muted">Memuat…</td></tr>
            : data.items.length === 0 ? <tr><td colSpan={6} className="sdl-sumda__empty"><strong>Tidak ada personel yang cocok.</strong> Ubah kata kunci atau filter.</td></tr>
              : data.items.map(p => <tr key={p.id} className="sdl-sumda__click" onClick={() => setDetail(p)}>
                <td><NamaSel p={p} />{p.perluDilengkapi && <span className="sdl-sumda__flag">Perlu dilengkapi</span>}</td>
                <td>{p.pangkatLabel
                  ? <><span>{p.pangkatLabel}</span>{p.jabatan && <small className="sdl-sumda__sub">{p.jabatan}</small>}</>
                  : p.jabatan || <span className="sdl-sumda__muted">—</span>}</td>
                <td>{p.unitKerja || <span className="sdl-sumda__muted">—</span>}</td>
                <td className="is-num"><span className="sdl-sumda__mono">{p.tanggalPensiun ? tgl(p.tanggalPensiun) : 'Belum diisi'}</span>
                  <small className="sdl-sumda__sub">{p.tahap ? <TahapBadge tahap={p.tahap} /> : sisaTeks(p.sisaHari)}</small></td>
                <td><StatusBadge status={p.status} /></td>
                <td className="sdl-sumda__actions" onClick={e => e.stopPropagation()}>
                  {caps?.canUpdate && <button type="button" className="btn" onClick={() => setForm({ item: p })}>Ubah</button>}
                </td>
              </tr>)}
        </tbody>
      </table></div>
      <Pager pager={pager} label="personel" />
    </div>
    {detail && <DetailDialog p={detail} caps={caps} onClose={() => setDetail(null)} onEdit={() => { setForm({ item: detail }); setDetail(null) }} onArchive={() => void arsip(detail)} />}
    {form && <PersonelForm item={form.item} onClose={() => setForm(null)} onSaved={(saved, conflict) => { setForm(null); if (!conflict) { showToast(form.item ? 'Perubahan disimpan.' : 'Personel ditambahkan.'); setDetail(saved) } void load() }} />}
  </section>
}

const JENIS_KARIER_LABEL: Record<string, string> = { UKP: 'UKP', KGB: 'KGB', MUTASI: 'Mutasi', PENYESUAIAN_JABATAN: 'Penyesuaian jabatan' }

function DetailDialog({ p, caps, onClose, onEdit, onArchive }: { p: Personel; caps: Caps | null; onClose: () => void; onEdit: () => void; onArchive: () => void }) {
  // R5H28 K13/K28: riwayat karier hanya ada di GET /personel/:id, jadi dimuat setiap dialog dibuka.
  // R5H29 K18: riwayat diklat & kompetensi ikut di respons yang sama.
  const [riwayat, setRiwayat] = useState<RiwayatKarier[] | null>(null)
  const [diklat, setDiklat] = useState<RiwayatDiklat[]>([])
  const [kompetensi, setKompetensi] = useState<KompetensiRingkas[]>([])
  useEffect(() => {
    if (!UUID_RE.test(p.id)) return
    api<{ item: Personel }>(`/personel/${encodeURIComponent(p.id)}`).then(r => {
      setRiwayat(r.item.riwayatKarier ?? []); setDiklat(r.item.riwayatDiklat ?? []); setKompetensi(r.item.kompetensi ?? [])
    }).catch(() => setRiwayat([]))
  }, [p.id])
  const rows: [string, ReactNode][] = [
    ['NRP / NIP', <span className="sdl-sumda__mono">{p.nrp}</span>], ['Jenis', p.jenis || 'Belum diisi'],
    ['Pangkat / golongan', p.pangkatLabel || '—'], ['Jabatan', p.jabatan || '—'], ['Unit kerja', p.unitKerja || '—'],
    ['TMT dinas', <span className="sdl-sumda__mono">{tgl(p.tmtDinas)}</span>],
    ['Tanggal pensiun', <span className="sdl-sumda__mono">{p.tanggalPensiun ? tgl(p.tanggalPensiun) : 'Belum diisi'}</span>],
    ['Status', <StatusBadge status={p.status} />],
  ]
  return <Shade onClose={onClose} label={`Detail ${p.nama}`}>
    <header><span className="sdl-progar__eyebrow">MASTER PERSONEL</span><h2>{p.nama}</h2></header>
    {p.tahap && <p className="sdl-sumda__notice is-warn"><TahapBadge tahap={p.tahap} /> {sisaTeks(p.sisaHari)} menuju tanggal pensiun. Pastikan administrasi pensiun disiapkan.</p>}
    {p.perluDilengkapi && <p className="sdl-sumda__notice">{p.salinan ? 'Data ini disalin dari registry lama. ' : ''}Lengkapi jenis personel dan tanggal pensiun agar alert pensiun berjalan.</p>}
    <dl className="sdl-sumda__detail">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    {p.catatan && <div className="sdl-sumda__catatan"><strong>Catatan</strong><p>{p.catatan}</p></div>}
    <section className="sdl-sumda__riwayat" aria-label="Riwayat karier dan mutasi">
      <strong>Riwayat karier &amp; mutasi</strong>
      {riwayat === null ? <p className="sdl-sumda__muted">Memuat…</p>
        : riwayat.length === 0 ? <p className="sdl-sumda__muted">Belum ada pengajuan.</p>
          : <ol>{riwayat.map(r => <li key={r.id}><span className="sdl-sumda__mono">{tgl(r.tanggalEfektif || r.tanggalUsulan)}</span>
            <span>{JENIS_KARIER_LABEL[r.jenis] ?? r.jenis} · {r.ringkas}</span><span className="sdl-sumda__muted">{r.status}</span></li>)}</ol>}
    </section>
    {riwayat !== null && <section className="sdl-sumda__riwayat" aria-label="Riwayat diklat">
      <strong>Riwayat diklat</strong>
      {diklat.length === 0 ? <p className="sdl-sumda__muted">Belum pernah tercatat sebagai peserta.</p>
        : <ol>{diklat.map(r => <li key={r.pesertaId}><span className="sdl-sumda__mono">{r.tanggalMulai ? tgl(r.tanggalMulai) : '—'}</span>
          <span>{r.nama} · {r.jenis}</span><span className="sdl-sumda__muted">{r.status === 'Selesai' ? r.hasil : r.status}</span></li>)}</ol>}
    </section>}
    {riwayat !== null && <section className="sdl-sumda__riwayat" aria-label="Kompetensi">
      <strong>Kompetensi</strong>
      {kompetensi.length === 0 ? <p className="sdl-sumda__muted">Belum ada kompetensi tercatat.</p>
        : <ol>{kompetensi.map(k => <li key={k.id}><span className="sdl-sumda__mono">{k.berlakuSampai ? tgl(k.berlakuSampai) : 'Tanpa batas'}</span>
          <span>{k.nama} · {k.kategori}</span><span className={k.tahap ? 'sdl-sumda__flag' : 'sdl-sumda__muted'}>{k.tahap === 'KEDALUWARSA' ? 'Kedaluwarsa' : k.tahap ?? ''}</span></li>)}</ol>}
    </section>}
    <footer>
      {caps?.canArchive && <button type="button" className="btn sdl-progar__danger" onClick={onArchive}>Arsipkan</button>}
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={onClose}>Tutup</button>
      {caps?.canUpdate && <button type="button" className="btn primary" onClick={onEdit}>Ubah data</button>}
    </footer>
  </Shade>
}

function PersonelForm({ item, onClose, onSaved }: { item: Personel | null; onClose: () => void; onSaved: (p: Personel | null, conflict?: boolean) => void }) {
  const [v, setV] = useState(() => ({
    nrp: item?.nrp ?? '', nama: item?.nama ?? '', jenis: item?.jenis || 'Polri', pangkat: item?.pangkat ?? '',
    jabatan: item?.jabatan ?? '', unitKerja: item?.unitKerja ?? '', tmtDinas: item?.tmtDinas ?? '',
    tanggalPensiun: item?.tanggalPensiun ?? '', status: item?.status ?? 'Aktif', catatan: item?.catatan ?? '',
  }))
  const [ranks, setRanks] = useState<Rank[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api<{ items: Rank[] }>('/registry/ranks').then(r => setRanks(r.items)).catch(() => setRanks([])) }, [])
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  const dipantau = v.status === 'Aktif' || v.status === 'MPP'
  const opsiPangkat = v.jenis === 'PNS' ? GOLONGAN_PNS.map(g => ({ value: g, label: `Golongan ${g}` })) : ranks.map(r => ({ value: r.code, label: `${r.shortName} — ${r.fullName}` }))
  const pangkatLama = item && item.pangkat && !opsiPangkat.some(o => o.value === item.pangkat) && v.pangkat === item.pangkat

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    if (v.nrp.trim().length < 2) return setError('NRP/NIP wajib diisi (minimal 2 karakter).')
    if (v.nama.trim().length < 3) return setError('Nama lengkap wajib diisi (minimal 3 karakter).')
    if (dipantau && !v.tanggalPensiun) return setError('Tanggal pensiun wajib diisi untuk personel Aktif atau MPP.')
    setBusy(true); setError('')
    try {
      const r = item
        ? await api<{ item: Personel }>(`/personel/${item.id}`, 'PATCH', { ...v, version: item.version })
        : await api<{ item: Personel }>('/personel', 'POST', v)
      onSaved(r.item)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'version_conflict') { showToast(err.message, 'error'); onSaved(null, true); return }
      setError((err as Error).message)
    } finally { setBusy(false) }
  }

  return <Shade onClose={onClose} label={item ? 'Ubah personel' : 'Tambah personel'} busy={busy}>
    <form onSubmit={e => void submit(e)} className="sdl-sumda__form">
      <header><span className="sdl-progar__eyebrow">MASTER PERSONEL</span><h2>{item ? 'Ubah data personel' : 'Tambah personel'}</h2>
        <p>Isian bertanda * wajib. Tanggal pensiun diisi manual dan dipakai untuk alert H-60 sampai jatuh tempo.</p></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label><span>NRP / NIP<b aria-hidden="true"> *</b></span><input value={v.nrp} maxLength={64} autoFocus onChange={set('nrp')} /></label>
        <label><span>Nama lengkap<b aria-hidden="true"> *</b></span><input value={v.nama} maxLength={200} onChange={set('nama')} /></label>
        <label><span>Jenis personel<b aria-hidden="true"> *</b></span>
          <select value={v.jenis} onChange={e => setV(s => ({ ...s, jenis: e.target.value as 'Polri' | 'PNS', pangkat: '' }))}><option>Polri</option><option>PNS</option></select></label>
        <label><span>{v.jenis === 'PNS' ? 'Golongan' : 'Pangkat'}</span>
          <select value={v.pangkat} onChange={set('pangkat')}>
            <option value="">— Belum dipilih —</option>
            {pangkatLama && <option value={item!.pangkat}>{item!.pangkatLabel} (data lama)</option>}
            {opsiPangkat.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></label>
        <label><span>Jabatan</span><input value={v.jabatan} maxLength={200} onChange={set('jabatan')} /></label>
        <label><span>Unit kerja</span><input value={v.unitKerja} maxLength={200} onChange={set('unitKerja')} /></label>
        <label><span>TMT dinas</span><input type="date" min="1950-01-01" max="2100-12-31" value={v.tmtDinas} onChange={set('tmtDinas')} /></label>
        <label><span>Tanggal pensiun{dipantau && <b aria-hidden="true"> *</b>}</span><input type="date" min="2000-01-01" max="2100-12-31" value={v.tanggalPensiun} onChange={set('tanggalPensiun')} /></label>
        <label><span>Status<b aria-hidden="true"> *</b></span>
          <select value={v.status} onChange={set('status')}>{STATUS.map(s => <option key={s}>{s}</option>)}</select>
          <small>Aktif dan MPP ikut dipantau alert pensiun.</small></label>
        <label className="sdl-sumda__wide"><span>Catatan administrasi</span><textarea rows={3} maxLength={1000} value={v.catatan} onChange={set('catatan')} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer>
        <button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : item ? 'Simpan perubahan' : 'Simpan'}</button>
      </footer>
    </form>
  </Shade>
}

/* ----------------------------------------------------------------- Pensiun */

type AlertResp = { ringkas: Record<Tahap, number>; belumDitinjau: number; items: Alert[] }

function PensiunView({ onNavigate, onLost }: { onNavigate: SumdaNav; onLost: () => void }) {
  const caps = useCaps()
  const [filter, setFilter] = useState<Tahap | ''>('')
  const [data, setData] = useState<AlertResp | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setData(await api<AlertResp>(`/pensiun/alert${filter ? `?tahap=${filter}` : ''}`)); setError('') } catch (e) {
      if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message)
    }
  }, [filter, onLost])
  useEffect(() => { void load() }, [load])

  const belum = (data?.items ?? []).filter(a => !a.ditinjau)
  async function tinjau(list: Alert[]) {
    if (!list.length || busy) return
    if (list.length > 1 && !(await confirmDialog(`Tandai ${list.length} alert yang tampil sebagai sudah ditinjau? Tanda ini berlaku untuk seluruh Subbagsumda.`, { confirmLabel: 'Tandai ditinjau' }))) return
    setBusy(true)
    try {
      for (let i = 0; i < list.length; i += 200) {
        await api('/pensiun/alert/tinjau', 'POST', { items: list.slice(i, i + 200).map(a => ({ personelId: a.personel.id, tahap: a.tahap, tanggalPensiun: a.personel.tanggalPensiun })) })
      }
      showToast(list.length > 1 ? `${list.length} alert ditandai ditinjau.` : 'Alert ditandai ditinjau.')
    } catch (e) { showToast((e as Error).message, 'error') } finally { setBusy(false); void load() }
  }

  return <section className="sdl-sumda">
    <nav className="sdl-sumda__tabs" aria-label="Saring tahap">
      <button type="button" className={filter === '' ? 'is-on' : ''} aria-pressed={filter === ''} onClick={() => setFilter('')}>Semua <span>{data ? Object.values(data.ringkas).reduce((s, n) => s + n, 0) : '–'}</span></button>
      {TAHAP.map(t => <button key={t.key} type="button" className={filter === t.key ? 'is-on' : ''} aria-pressed={filter === t.key} title={t.rentang} onClick={() => setFilter(t.key)}>
        {t.key === 'JATUH_TEMPO' ? 'Jatuh tempo' : `${t.key} · ${t.label}`} <span>{data?.ringkas[t.key] ?? '–'}</span></button>)}
    </nav>
    <p className="sdl-sumda__rule">Tahap dihitung otomatis dari tanggal pensiun personel Aktif/MPP: H-60 (31–60 hari), H-30 (15–30), H-14 (8–14), H-7 (1–7), Jatuh tempo (hari ini atau terlewat). Tahap baru menggantikan tahap sebelumnya dan muncul lagi sebagai belum ditinjau.</p>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="sdl-sumda__panelhead">
        <span>{data ? `${data.items.length} alert ditampilkan · ${belum.length} belum ditinjau` : 'Memuat…'}</span>
        {caps?.canReview && belum.length > 0 && <button type="button" className="btn" disabled={busy} onClick={() => void tinjau(belum)}>Tinjau semua yang tampil ({belum.length})</button>}
      </div>
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Personel</th><th>Unit kerja</th><th className="is-num">Tanggal pensiun</th><th>Tahap</th><th className="is-num">Hitung mundur</th><th>Tinjau</th></tr></thead>
        <tbody>
          {data && data.items.length === 0 && <tr><td colSpan={6} className="sdl-sumda__empty"><strong>Tidak ada alert{filter ? ' pada tahap ini' : ''}.</strong> Personel yang pensiun lebih dari 60 hari lagi belum masuk daftar.</td></tr>}
          {data?.items.map(a => <tr key={a.personel.id}>
            <td><button type="button" className="sdl-sumda__rowlink" onClick={() => onNavigate('personel', { recordID: a.personel.id })}><NamaSel p={a.personel} /></button></td>
            <td>{a.personel.unitKerja || <span className="sdl-sumda__muted">—</span>}</td>
            <td className="is-num sdl-sumda__mono">{tgl(a.personel.tanggalPensiun)}</td>
            <td><TahapBadge tahap={a.tahap} /></td>
            <td className="is-num sdl-sumda__mono">{sisaTeks(a.sisaHari)}</td>
            <td>{a.ditinjau
              ? <span className="sdl-sumda__done">Ditinjau<small>{a.ditinjau.oleh} · {waktu(a.ditinjau.pada)}</small></span>
              : caps?.canReview ? <button type="button" className="btn" disabled={busy} onClick={() => void tinjau([a])}>Tandai tinjau</button>
                : <span className="sdl-sumda__flag">Belum</span>}</td>
          </tr>)}
        </tbody>
      </table></div>
    </div>
  </section>
}
