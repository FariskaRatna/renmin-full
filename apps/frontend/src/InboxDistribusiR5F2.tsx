import { useCallback, useEffect, useRef, useState } from 'react'
import { showToast } from './UIFeedback'
import { Pager, usePaged } from './PaginationR5H5'
import { clickRow } from './ClickableRowR5H7'
import { BuatDisposisi } from './DisposisiR3C'

type Distribution = {
  id: string; incomingId: string; agendaNo: number; letterNumber: string; subject: string
  classification: string; unit: string; recipient: string; recipientName: string
  status: 'sent' | 'received'; sentAt: string; receivedAt: string | null; reason: string
}
type Attachment = { id: string; filename: string; mime: string; size: number; sha256: string; createdAt: string }
type DistributionEvent = { action: string; actor: string; reason: string; at: string }
type InboxPayload = { items: Distribution[]; pending: number; limited?: boolean }
type AttachmentPayload = { items: Attachment[]; canDownload: boolean }
type Detail = { id: string; files: Attachment[]; events: DistributionEvent[]; canDownload: boolean }
type StatusFilter = 'all' | 'sent' | 'received'

const ROOT = '/api/v1/urmin'
const statusLabel = (status: Distribution['status']) => status === 'received' ? 'Diterima' : 'Menunggu'
const unitLabel: Record<string, string> = { urmin: 'Urmin', subbagren: 'Subbagren', subbagsumda: 'Subbagsumda', subbagbinfung: 'Subbagbinfung' }
const jakartaYear = (raw: string) => {
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date) : '—'
}
const readableDate = (raw: string | null) => {
  if (!raw) return '—'
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }) : '—'
}
// Membuka detail surat yang masih berstatus 'sent' = menerimanya. Tidak ada
// tindakan lain yang tersedia bagi penerima (tidak ada tolak/kembalikan), jadi
// konfirmasi manual hanya menambah langkah. Endpoint 112 tetap menuntut alasan
// 8-500 karakter; alasan baku ini yang tercatat di riwayat dan audit.
const AUTO_RECEIVE_REASON = 'Diterima saat membuka detail'
const errText = (error: unknown) => error instanceof Error ? error.message : 'Terjadi kesalahan. Silakan coba lagi.'

async function api<T>(url: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = {}
  if (method === 'POST') {
    const csrfResponse = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!csrfResponse.ok) throw new Error('Sesi keamanan tidak tersedia. Silakan masuk kembali.')
    const token = await csrfResponse.json() as { csrfToken: string }
    headers['X-CSRF-Token'] = token.csrfToken
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sesi berakhir. Silakan masuk kembali.')
    if (response.status === 403 || response.status === 404) throw new Error('Data tidak tersedia atau akses Anda sudah berubah.')
    if (response.status === 409) throw new Error('Status sudah berubah. Perbarui data dan coba kembali.')
    throw new Error('Permintaan gagal. Silakan coba kembali.')
  }
  return response.json() as Promise<T>
}

async function download(incomingId: string, attachment: Attachment): Promise<void> {
  const response = await fetch(`${ROOT}/surat-masuk/${encodeURIComponent(incomingId)}/attachments/${encodeURIComponent(attachment.id)}/download`, { credentials: 'same-origin', cache: 'no-store' })
  if (!response.ok) throw new Error('Lampiran tidak tersedia atau izin unduh telah berubah.')
  // Documents remain forced-download until a malware-scanning gate is implemented.
  const link = URL.createObjectURL(await response.blob())
  try {
    const anchor = document.createElement('a')
    anchor.href = link
    anchor.download = attachment.filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(link), 30_000)
  }
}

export function InboxDistribusi({ initialID, workspaceMode = 'inbox' }: { initialID?: string; workspaceMode?: 'inbox'|'history' } = {}) {
  const [items, setItems] = useState<Distribution[]>([])
  const [pending, setPending] = useState(0)
  const [limited, setLimited] = useState(false)
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(workspaceMode === 'history' ? 'received' : 'all')
  const [selectedID, setSelectedID] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [busy, setBusy] = useState(false)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)
  const deepLinkHandled = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const receiving = useRef(new Set<string>())

  const refresh = useCallback(async (): Promise<Distribution[] | null> => {
    const request = ++listRequest.current
    setListState('loading')
    try {
      const result = await api<InboxPayload>(`${ROOT}/distribution-inbox/`)
      if (request !== listRequest.current) return null
      setItems(result.items)
      setPending(result.pending)
      setLimited(result.limited === true)
      setListState('ready')
      // A revoked grant may remove the currently open record from the inbox.
      if (selectedRef.current && !result.items.some(item => item.id === selectedRef.current)) {
        selectedRef.current = null
        ++detailRequest.current
        setSelectedID(null)
        setDetail(null)
        setDetailState('idle')
      }
      return result.items
    } catch (error) {
      if (request !== listRequest.current) return null
      setListState('error')
      showToast(errText(error), 'error')
      return null
    }
  }, [])

  useEffect(() => {
    void refresh()
    return () => { ++listRequest.current; ++detailRequest.current }
  }, [refresh])

  const open = useCallback(async (recordID: string) => {
    selectedRef.current = recordID
    setSelectedID(recordID)
    setDetail(null)
    setDetailState('loading')
    const request = ++detailRequest.current
    const current = items.find(item => item.id === recordID)
    if (!current) {
      setDetailState('error')
      return
    }
    if (current.status === 'sent' && !receiving.current.has(recordID)) {
      receiving.current.add(recordID)
      setBusy(true)
      let failure: unknown = null
      try {
        await api(`${ROOT}/distribution-inbox/${encodeURIComponent(recordID)}/receive`, 'POST', { reason: AUTO_RECEIVE_REASON })
        window.dispatchEvent(new Event('sdl:inbox-changed'))
      } catch (error) {
        failure = error
      }
      // Dimuat ulang apa pun hasilnya: 409 berarti sudah diterima di tab lain,
      // dan itu bukan kegagalan bagi pengguna.
      const fresh = await refresh()
      receiving.current.delete(recordID)
      setBusy(false)
      const nowReceived = fresh?.find(item => item.id === recordID)?.status === 'received'
      if (failure && !nowReceived) showToast(`Penerimaan belum tercatat. ${errText(failure)}`, 'error')
      else if (!failure) showToast('Surat dicatat diterima.', 'success')
      if (request !== detailRequest.current || selectedRef.current !== recordID) return
    }
    try {
      const [attachments, history] = await Promise.all([
        api<AttachmentPayload>(`${ROOT}/surat-masuk/${encodeURIComponent(current.incomingId)}/attachments`),
        api<{ items: DistributionEvent[] }>(`${ROOT}/distribution-inbox/${encodeURIComponent(recordID)}/events`),
      ])
      if (request !== detailRequest.current || selectedRef.current !== recordID) return
      setDetail({ id: recordID, files: attachments.items, events: history.items, canDownload: attachments.canDownload })
      setDetailState('ready')
    } catch (error) {
      if (request !== detailRequest.current || selectedRef.current !== recordID) return
      setDetailState('error')
      showToast(errText(error), 'error')
    }
  }, [items])

  // Only auto-open once for each dashboard deep-link, never reopen after manual close.
  useEffect(() => {
    if (!initialID || listState !== 'ready' || deepLinkHandled.current === initialID) return
    deepLinkHandled.current = initialID
    if (items.some(item => item.id === initialID)) void open(initialID)
    else showToast('Distribusi tidak ditemukan atau tidak tersedia untuk akun ini.', 'error')
  }, [initialID, items, listState, open])

  function closeDetail() {
    ++detailRequest.current
    selectedRef.current = null
    setSelectedID(null)
    setDetail(null)
    setDetailState('idle')
  }

  const current = items.find(item => item.id === selectedID)
  const search = query.trim().toLocaleLowerCase('id-ID')
  const visible = items.filter(item => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false
    if (!search) return true
    return [item.subject, item.letterNumber, item.recipientName, item.reason, item.unit, item.classification, String(item.agendaNo)]
      .some(value => value.toLocaleLowerCase('id-ID').includes(search))
  })

  // R5H5: paginasi seperti menu Disposisi.
  const {pageItems:pagedVisible,pager}=usePaged(visible,[visible.length])
  const receivedCount = items.filter(item => item.status === 'received').length
  const countLabel = (value: number) => limited ? `${value}+` : String(value)

  return <div className="r3b-wrap sdl-inbox sdl-inbox-r5f2">
    <div className="sdl-inbox__summary" aria-label="Ringkasan distribusi untuk akun ini">
      <div><span>Distribusi Terbaru</span><strong>{listState === 'ready' ? countLabel(items.length) : '—'}</strong></div>
      <div><span>Menunggu Penerimaan</span><strong>{listState === 'ready' ? countLabel(pending) : '—'}</strong></div>
      <div><span>Sudah Diterima</span><strong>{listState === 'ready' ? countLabel(receivedCount) : '—'}</strong></div>
    </div>
    <section className="panel sdl-inbox__panel" aria-label="Daftar distribusi">
      <div className="sdl-inbox__toolbar">
        <div><h2>Daftar Distribusi</h2><p>Surat yang ditujukan khusus kepada akun Anda</p></div>
        <button className="btn" type="button" disabled={listState === 'loading' || busy} onClick={() => void refresh()}>{listState === 'loading' ? 'Memuat...' : 'Perbarui'}</button>
      </div>
      {limited && <p className="sdl-inbox-r5f2__limit">Menampilkan maksimal 100 distribusi terbaru. Ringkasan dan pencarian hanya mencakup data yang tampil.</p>}
      <div className="sdl-inbox__filters">
        <label><span className="sdl-sr-only">Cari surat</span><input value={query} onChange={event => setQuery(event.target.value)} aria-label="Cari distribusi" placeholder="Cari nomor, perihal, agenda atau penerima" /></label>
        {workspaceMode!=='history'&&<label><span className="sdl-sr-only">Filter status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)} aria-label="Filter status"><option value="all">Semua Status</option><option value="sent">Menunggu</option><option value="received">Diterima</option></select></label>}
      </div>
      {listState === 'loading' && items.length === 0 ? <div className="sdl-inbox__empty" role="status"><strong>Memuat surat...</strong></div>
        : listState === 'error' ? <div className="sdl-inbox__empty" role="alert"><strong>Daftar belum dapat diperbarui</strong><p>Periksa sesi dan coba kembali.</p><button className="btn" type="button" onClick={() => void refresh()}>Coba Lagi</button></div>
        : visible.length === 0 ? <div className="sdl-inbox__empty"><span className="sdl-inbox__empty-icon" aria-hidden="true">✉</span><strong>{items.length === 0 ? 'Belum ada distribusi' : 'Tidak ada hasil'}</strong><p>{items.length === 0 ? 'Surat yang dialamatkan kepada Anda akan muncul di sini.' : 'Ubah pencarian atau status untuk melihat distribusi lain.'}</p></div>
        : <div className="table-scroll"><table className="data-table sdl-inbox__table"><thead><tr><th>Agenda</th><th>Surat</th><th>Penerima</th><th>Status</th><th>Dikirim</th></tr></thead><tbody>{pagedVisible.map(item => { const rowProps = clickRow(() => void open(item.id), { label: `Buka detail ${item.letterNumber}`, active: selectedID === item.id }); return <tr key={item.id} {...rowProps} className={`${rowProps.className}${selectedID === item.id ? ' sdl-inbox__selected' : ''}`}>
          <td><strong>SM-{jakartaYear(item.sentAt)}-{item.agendaNo}</strong></td>
          <td><strong>{item.subject}</strong><small>{item.letterNumber}</small></td>
          <td>{unitLabel[item.unit] ?? item.unit}</td>
          <td><span className={`sdl-inbox__status ${item.status === 'sent' ? 'is-pending' : 'is-received'}`}>{statusLabel(item.status)}</span></td>
          <td>{readableDate(item.sentAt)}</td>
        </tr> })}</tbody></table></div>}<Pager pager={pager} label="surat"/>
    </section>
    {current && <section className="panel sdl-inbox__detail" aria-label="Detail surat terpilih">
      <div className="sdl-inbox__detail-head"><div><span className="sdl-work-kicker">DETAIL DISTRIBUSI</span><h2>{current.letterNumber}</h2><p>{current.subject}</p></div><button type="button" className="btn" onClick={closeDetail}>Tutup Detail</button></div>
      <div className="sdl-inbox-r5f2__facts">
        <div><span>Nomor Agenda</span><strong>{current.agendaNo}</strong></div>
        <div><span>Unit Tujuan</span><strong>{unitLabel[current.unit] ?? current.unit}</strong></div>
        <div><span>Penerima</span><strong>{current.recipientName}</strong></div>
        <div><span>Klasifikasi</span><strong>{current.classification}</strong></div>
        <div><span>Dikirim</span><strong>{readableDate(current.sentAt)}</strong></div>
        <div><span>Diterima</span><strong>{readableDate(current.receivedAt)}</strong></div>
      </div>
      <p className="sdl-inbox-r5f2__note"><strong>Keterangan Distribusi</strong>{current.reason}</p>
      {detailState === 'loading' ? <p className="sdl-inbox-r5f2__hint" role="status">Memuat lampiran dan riwayat...</p> : detailState === 'error' ? <div className="sdl-inbox-r5f2__hint" role="alert">Detail belum tersedia. <button type="button" className="btn" onClick={() => void open(current.id)}>Coba Lagi</button></div> : detail && detail.id === current.id && <>
        <div className="sdl-inbox__detail-section"><h3>Lampiran</h3>{detail.files.length === 0 ? <p>Belum ada lampiran.</p> : detail.files.map(file => <div className="r3b-file" key={file.id}><span><strong>{file.filename}</strong><small>{(file.size / 1024).toFixed(0)} KB · {readableDate(file.createdAt)}</small></span><button className="btn" type="button" disabled={!detail.canDownload} onClick={() => { void download(current.incomingId, file).catch(error => showToast(errText(error), 'error')) }}>Unduh</button></div>)}{!detail.canDownload && detail.files.length > 0 && <p>Anda tidak memiliki akses untuk mengunduh lampiran.</p>}</div>
        <div className="sdl-inbox__detail-section"><h3>Riwayat Distribusi</h3>{detail.events.length === 0 ? <p>Belum ada riwayat.</p> : <ol className="sdl-inbox-r5f2__timeline">{detail.events.map((event, index) => <li key={`${event.action}-${event.at}-${index}`}><strong>{event.action === 'sent' ? 'Dikirim' : event.action === 'received' ? 'Diterima' : 'Pembaruan'}</strong><small>{event.actor} · {readableDate(event.at)}</small><p>{event.reason}</p></li>)}</ol>}</div>
        {current.status === 'sent' ? <div className="sdl-inbox__detail-section sdl-inbox-r5f2__hint" role="status">{busy ? 'Mencatat penerimaan...' : <>Penerimaan belum tercatat. <button type="button" className="btn" onClick={() => void open(current.id)}>Coba Lagi</button></>}</div>
          : <div className="sdl-inbox__detail-section"><BuatDisposisi key={current.id} distributionId={current.id} received /></div>}
      </>}
    </section>}
  </div>
}

export default InboxDistribusi
