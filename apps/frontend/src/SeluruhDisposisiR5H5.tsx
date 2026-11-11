import { useCallback, useEffect, useRef, useState } from 'react'
import './TugasDisposisiR5F3.css'
import { clickRow } from './ClickableRowR5H7'

/**
 * R5H5: tab "Seluruh Disposisi" — monitoring semua surat masuk yang diajukan
 * ke Kabagrenmin, yang sudah maupun belum dibukanya. HANYA BACA.
 *
 * Tidak ada endpoint baru. Sumbernya register Surat Masuk (endpoint 97), yang
 * sudah menurunkan `workflowStatuses` per surat sejak R5G2:
 *   awaiting_kabag   → belum dibuka Kabagrenmin
 *   read_kabag dst.  → sudah dibuka (dan mungkin sudah dijawab/diteruskan)
 * Surat `draft` dan `recorded` (tanpa disposisi) tidak pernah sampai ke
 * Kabagrenmin, jadi tidak ditampilkan.
 *
 * Otorisasi tetap di server: endpoint 97 menyaring per dokumen, jadi daftar ini
 * hanya berisi surat yang memang boleh dibaca akun yang membukanya.
 */
type Item = { id: string; agendaNo: number; letterNumber: string; sender: string; letterDate: string; subject: string; derajat?: string; createdAt: string }
type ListResponse = { items: Item[]; limited: boolean; workflowStatuses?: Record<string, string>; workflowSince?: Record<string, string> }
type OpenFilter = 'all' | 'unread' | 'read'

const statusLabels: Record<string, string> = {
  awaiting_kabag: 'Belum Dibuka',
  read_kabag: 'Sudah Dibuka',
  directive_issued: 'Sudah Didisposisikan Kabagrenmin',
  dispatched: 'Sudah Didistribusikan',
  in_progress: 'Dalam Tindak Lanjut',
  awaiting_review: 'Menunggu Review',
}
// Kelas r3c-status yang sudah ada: pending = abu/kuning, in_progress = biru,
// completed = hijau. Dipakai ulang supaya warnanya sama dengan tab Tugas Saya.
const statusClass: Record<string, string> = {
  awaiting_kabag: 'pending', read_kabag: 'in_progress', directive_issued: 'completed',
  dispatched: 'completed', in_progress: 'in_progress', awaiting_review: 'in_progress',
}

function dateOnly(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw || '—'
  const date = new Date(`${raw.slice(0, 10)}T00:00:00Z`)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('id-ID', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : raw
}
function datetime(raw?: string) {
  if (!raw) return '—'
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}
function waitedDays(since?: string): number | null {
  if (!since) return null
  const t = new Date(since).getTime()
  return Number.isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000))
}

export default function SeluruhDisposisiR5H5({ onOpenLetter }: { onOpenLetter?: (incomingID: string) => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [statuses, setStatuses] = useState<Record<string, string>>({})
  const [since, setSince] = useState<Record<string, string>>({})
  const [limited, setLimited] = useState(false)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [openFilter, setOpenFilter] = useState<OpenFilter>('all')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoadState('loading')
    try {
      const response = await fetch('/api/v1/urmin/surat-masuk/', { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) throw new Error(String(response.status))
      const data = await response.json() as ListResponse
      if (mine !== seq.current) return
      setItems(data.items ?? [])
      setStatuses(data.workflowStatuses ?? {})
      setSince(data.workflowSince ?? {})
      setLimited(Boolean(data.limited))
      setLoadState('ready')
    } catch {
      if (mine === seq.current) setLoadState('error')
    }
  }, [])
  useEffect(() => { void load(); return () => { seq.current += 1 } }, [load])
  useEffect(() => { setPage(1) }, [query, openFilter, pageSize])

  const toKabag = items.filter(i => statusLabels[statuses[i.id]] !== undefined)
  const unreadCount = toKabag.filter(i => statuses[i.id] === 'awaiting_kabag').length
  const q = query.trim().toLocaleLowerCase('id-ID')
  const visible = toKabag
    .filter(i => openFilter === 'all' || (openFilter === 'unread') === (statuses[i.id] === 'awaiting_kabag'))
    .filter(i => !q || [i.letterNumber, i.sender, i.subject, String(i.agendaNo)].some(v => v.toLocaleLowerCase('id-ID').includes(q)))
    .sort((a, b) => (since[b.id] ?? b.createdAt).localeCompare(since[a.id] ?? a.createdAt))
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const displayed = visible.slice((safePage - 1) * pageSize, safePage * pageSize)

  return <div className="sdl-tasks-r5f3">
    <div className="sdl-tasks-r5f11__overview" aria-label="Ringkasan disposisi ke Kabagrenmin">
      <span><strong>{loadState === 'ready' ? toKabag.length : '—'}</strong> Surat ke Kabagrenmin</span>
      <span className={unreadCount > 0 ? 'is-warning' : undefined}><strong>{loadState === 'ready' ? unreadCount : '—'}</strong> Belum Dibuka</span>
      <span><strong>{loadState === 'ready' ? toKabag.length - unreadCount : '—'}</strong> Sudah Dibuka</span>
    </div>
    <section className="panel sdl-tasks-r5f3__panel" aria-label="Seluruh disposisi ke Kabagrenmin">
      <div className="sdl-tasks-r5f11__toolbar"><div><strong>{loadState === 'ready' ? `${visible.length} surat` : 'Seluruh disposisi'}</strong><span>Surat masuk yang diajukan ke Kabagrenmin · monitoring</span></div><button type="button" className="btn" disabled={loadState === 'loading'} onClick={() => void load()}>{loadState === 'loading' ? 'Memuat...' : 'Perbarui'}</button></div>
      <p className="sdl-tasks-r5f3__limit">Hanya untuk pemantauan. Tindakan atas surat tetap dilakukan Kabagrenmin; tombol Lihat Surat membuka register Surat Masuk.</p>
      {limited && <p className="sdl-tasks-r5f3__limit">Register hanya memuat 200 surat terbaru; surat yang lebih lama tidak tercakup di sini.</p>}
      <div className="sdl-tasks-r5f3__filters">
        <label><span className="sdl-sr-only">Cari surat</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nomor surat, pengirim, perihal atau agenda" aria-label="Cari surat" /></label>
        <label><span className="sdl-sr-only">Status dibuka</span><select value={openFilter} onChange={e => setOpenFilter(e.target.value as OpenFilter)} aria-label="Status dibuka"><option value="all">Semua</option><option value="unread">Belum dibuka</option><option value="read">Sudah dibuka</option></select></label>
        <label><span className="sdl-sr-only">Jumlah data per halaman</span><select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} aria-label="Jumlah data per halaman"><option value={10}>10 per halaman</option><option value={50}>50 per halaman</option><option value={100}>100 per halaman</option></select></label>
      </div>
      {loadState === 'loading' && !items.length ? <div className="sdl-tasks-r5f3__empty" role="status">Memuat surat...</div>
        : loadState === 'error' ? <div className="sdl-tasks-r5f3__empty" role="alert"><strong>Daftar belum tersedia.</strong><p>Periksa sesi dan coba kembali.</p><button type="button" className="btn" onClick={() => void load()}>Coba Lagi</button></div>
        : displayed.length === 0 ? <div className="sdl-tasks-r5f3__empty"><strong>{toKabag.length ? 'Tidak ada surat sesuai filter' : 'Belum ada surat yang diajukan ke Kabagrenmin'}</strong><p>{toKabag.length ? 'Coba ubah pencarian atau filter.' : 'Surat masuk yang diajukan untuk disposisi akan muncul di sini.'}</p></div>
        : <div className="table-scroll"><table className="data-table sdl-tasks-r5f3__table"><thead><tr><th>Agenda</th><th>Surat / Perihal</th><th>Surat Dari</th><th>Diajukan</th><th>Status</th></tr></thead><tbody>
          {displayed.map(i => {
            const status = statuses[i.id]
            const days = waitedDays(since[i.id])
            return <tr key={i.id} {...clickRow(() => onOpenLetter?.(i.id), { label: `Buka surat ${i.letterNumber}`, disabled: !onOpenLetter })}>
              <td>SM-{new Date(i.createdAt).getFullYear()}-{i.agendaNo}</td>
              <td><strong>{i.letterNumber}</strong><small>{i.subject}</small></td>
              <td>{i.sender}<small>{dateOnly(i.letterDate)}</small></td>
              <td>{datetime(since[i.id])}{status === 'awaiting_kabag' && days !== null && <small>Menunggu {days === 0 ? 'hari ini' : `${days} hari`}</small>}</td>
              <td><span className={`r3c-status ${statusClass[status]}`}>{statusLabels[status]}</span></td>
            </tr>
          })}
        </tbody></table></div>}
      {loadState === 'ready' && visible.length > 0 && <div className="sdl-tasks-r5f3__pager">
        <span>Menampilkan {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, visible.length)} dari {visible.length}</span>
        <div>
          <button type="button" className="btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Sebelumnya</button>
          <span aria-live="polite">Halaman {safePage} dari {pageCount}</span>
          <button type="button" className="btn" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Berikutnya</button>
        </div>
      </div>}
    </section>
  </div>
}
