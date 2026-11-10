import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { confirmDialog, showToast } from './UIFeedback'
import { LeadershipMonitorR3D3 } from './LeadershipR3D3'
import { DisposisiAutoCompleteR5F20 } from './DisposisiAutoCompleteR5F20'
import './TugasDisposisiR5F3.css'
import { DisposisiSuratR5H6 } from './DisposisiSuratR5H6'
import { SuratR3B } from './SuratR3B'

type TaskStatus = 'pending' | 'in_progress' | 'completed'
type ReviewStatus = 'not_ready' | 'awaiting_review' | 'approved' | 'revision_requested'
type SLAStatus = 'on_track' | 'overdue' | 'completed_on_time' | 'completed_late' | 'unknown'
type Task = {
  id: string; distributionId: string; incomingId: string; letterNumber: string; subject: string
  classification: string; unit: string; issuerId: string; issuerName: string
  assigneeId: string; assigneeName: string; instruction: string; dueDate: string
  status: TaskStatus; completionNote: string | null; createdAt: string; acceptedAt: string | null
  completedAt: string | null; version: number; reviewStatus: ReviewStatus
  reviewReason: string | null; reviewerName: string | null; reviewedAt: string | null
  slaStatus: SLAStatus; parentTaskId: string | null; depth: number
}
type Event = { action: string; actor: string; reason: string; at: string }
/** R5G6: bukti hasil tindak lanjut (endpoint 145). */
type Attachment = { id: string; filename: string; mimeType: string; sizeBytes: number; sha256: string; uploadedBy: string; createdAt: string }
type FileList = { items: Attachment[]; canUpload: boolean }
type Candidate = { id: string; name: string; unit: string }
type TaskList = { items: Task[]; pending: number; overdue: number; limited?: boolean }
// Bentuk baris dari /urmin/distribution-inbox/ — surat yang ditujukan ke akun
// ini. 'sent' = belum dikonfirmasi diterima, jadi masih menunggu tindakan.
type IncomingLetter = {
  id: string; incomingId: string; agendaNo: number; letterNumber: string; subject: string
  classification: string; unit: string; status: 'sent' | 'received'; sentAt: string; reason: string
}
// R5H6: di layar baris ini disebut "Disposisi", bukan "Arahan" (permintaan
// pemilik); datanya tetap arahan dari API yang sama.
// R5H4: arahan Kabagrenmin yang ditujukan ke akun ini (GET
// /leadership/directives/inbox). Digabung ke daftar tugas atas permintaan
// pemilik sistem: staf melihat arahan di menu Disposisi DAN di menu Arahan.
type DirectiveRow = {
  id: string; title: string; priority: string; issuerName: string; dueAt: string | null; createdAt: string
  myReadAt?: string | null; myAcknowledgedAt?: string | null; sheet?: { letterNumber?: string; subject?: string; letterFrom?: string; letterDate?: string; classification?: string; derajat?: string }; incomingId?: string
}
type Detail = { item: Task; events: Event[] }
// R5H6: data surat untuk jendela detail disposisi — bentuk yang sama dengan
// GET /urmin/surat-masuk/:id dan /:id/intake yang dipakai layar Surat Masuk.
type DispoLetter = {
  item: { agendaNo: number; letterNumber: string; sender: string; letterDate: string; receivedDate: string; subject: string; classification: string; derajat?: string; createdAt: string }
  intake: { letterKind: string; responseDue: string; eventStart: string; eventEnd: string; eventLocation: string; eventAgenda: string; details: string } | null
}
const letterKindNames: Record<string, string> = { undangan: 'Undangan', permintaan: 'Permintaan Data / Dokumen', pemberitahuan: 'Pemberitahuan', lainnya: 'Lainnya' }
type OwnerFilter = 'all' | 'mine' | 'issued'
type StatusFilter = 'all' | 'pending' | 'in_progress' | 'completed' | 'awaiting_review'

const BASE = '/api/v1/urmin/dispositions'
const unitNames: Record<string, string> = { urmin: 'Urmin', subbagren: 'Subbagren', subbagsumda: 'Subbagsumda', subbagbinfung: 'Subbagbinfung' }
const statusNames: Record<TaskStatus, string> = { pending: 'Menunggu Diterima', in_progress: 'Dalam Proses', completed: 'Selesai' }
const reviewNames: Record<ReviewStatus, string> = { not_ready: 'Belum Direview', awaiting_review: 'Menunggu Review', approved: 'Disetujui', revision_requested: 'Perlu Tindak Lanjut' }
const slaNames: Record<SLAStatus, string> = { on_track: 'Dalam Target', overdue: 'Terlambat', completed_on_time: 'Tepat Waktu', completed_late: 'Selesai Terlambat', unknown: '—' }
const errText = (e: unknown) => e instanceof Error ? e.message : 'Gagal memproses permintaan. Silakan coba lagi.'
function datetime(raw: string | null) {
  if (!raw) return '—'
  const date = new Date(raw)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}
function dateOnly(raw: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
  const date = new Date(`${raw}T00:00:00Z`)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('id-ID', { timeZone: 'UTC', day: '2-digit', month: 'long', year: 'numeric' }) : raw
}
async function api<T>(url: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = {}
  if (method === 'POST') {
    const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!csrf.ok) throw new Error('Sesi berakhir. Silakan masuk kembali.')
    const { csrfToken } = await csrf.json() as { csrfToken: string }
    if (!csrfToken) throw new Error('Sesi tidak tersedia. Silakan masuk kembali.')
    headers['Content-Type'] = 'application/json'
    headers['X-CSRF-Token'] = csrfToken
  }
  const response = await fetch(url, { method, credentials: 'same-origin', cache: 'no-store', headers, body: body ? JSON.stringify(body) : undefined })
  if (!response.ok) {
    if (response.status === 401) throw new Error('Sesi berakhir. Silakan masuk kembali.')
    if (response.status === 403 || response.status === 404) throw new Error('Tugas tidak tersedia atau Anda tidak memiliki akses.')
    if (response.status === 409) throw new Error('Status tugas berubah. Perbarui data sebelum mencoba lagi.')
    throw new Error('Permintaan belum berhasil. Silakan coba lagi.')
  }
  return response.json() as Promise<T>
}
/** Ukuran berkas yang terbaca manusia; dibulatkan ke satu desimal. */
function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
function eventLabel(value: string) {
  const names: Record<string, string> = { issued: 'Diterbitkan', accepted: 'Diterima', completed: 'Diselesaikan', approved: 'Hasil Disetujui', revision_requested: 'Perlu Tindak Lanjut', forwarded: 'Diteruskan' }
  return names[value] ?? 'Pembaruan'
}

export default function TugasDisposisiR5F3({ currentUserId, initialID, workspaceTab, onOpenLetter, onOpenInbox, onOpenDirective }: { currentUserId: string; initialID?: string; workspaceTab?: 'mine'|'review'; onOpenLetter?: (incomingID: string) => void; onOpenInbox?: () => void; onOpenDirective?: (directiveID: string) => void }) {
  const [items, setItems] = useState<Task[]>([])
  // Surat yang ditujukan ke akun ini tapi BELUM menjadi tugas disposisi.
  // Daftar tugas menyaring assigneeId, jadi surat yang baru tiba tidak pernah
  // muncul di sana — padahal justru itu yang menunggu tindakan. Keduanya
  // ditampilkan dalam satu tabel supaya tidak ada dua daftar yang harus dicek.
  const [incomingLetters, setIncomingLetters] = useState<IncomingLetter[]>([])
  const [directives, setDirectives] = useState<DirectiveRow[]>([])
  // R5H6: disposisi surat dibuka DI menu ini (jendela), bukan pindah ke Surat Masuk.
  const [openDispo, setOpenDispo] = useState<DirectiveRow | null>(null)
  const [dispoLetter, setDispoLetter] = useState<DispoLetter | null>(null)
  const [summary, setSummary] = useState({ pending: 0, overdue: 0, limited: false })
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [query, setQuery] = useState('')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortOrder, setSortOrder] = useState<'latest'|'due'>('latest')
  // R5G3. Rentang tanggal dan ukuran halaman.
  //
  // from/to dikirim ke server karena ia menyaring atas letter_date, kolom yang
  // tidak ikut dalam respons; menyaringnya di sini mustahil. Ukuran halaman
  // sebaliknya murni di sini — server menyaring izin SESUDAH LIMIT, jadi
  // paginasi di server akan menghasilkan halaman yang jumlahnya tidak tetap.
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const [selectedID, setSelectedID] = useState('')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [reason, setReason] = useState('')
  const [forwardPeople, setForwardPeople] = useState<Candidate[] | null>(null)
  const [files, setFiles] = useState<FileList>({ items: [], canUpload: false })
  const [forwardTo, setForwardTo] = useState('')
  const [forwardInstruction, setForwardInstruction] = useState('')
  const [forwardDue, setForwardDue] = useState('')
  const [busy, setBusy] = useState(false)
  const listSeq = useRef(0)
  const detailSeq = useRef(0)
  const selectedRef = useRef('')
  const deepLinkHandled = useRef<string | undefined>(undefined)
  const mounted = useRef(true)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; listSeq.current += 1; detailSeq.current += 1 }
  }, [])

  const refreshList = useCallback(async () => {
    const seq = ++listSeq.current
    setLoadState('loading')
    try {
      // Rentang eksplisit menimpa `window` di server, jadi keduanya tidak
      // pernah dikirim bersamaan. Separuh rentang diabaikan sampai lengkap —
      // server menolak from tanpa to, dan menampilkan 400 saat pengguna baru
      // mengisi kotak pertama akan terbaca seperti kerusakan.
      const params = new URLSearchParams()
      if (fromDate && toDate) {
        params.set('from', fromDate)
        params.set('to', toDate)
      } else {
        params.set('window', 'active')
      }
      const result = await api<TaskList>(`${BASE}/?${params.toString()}`)
      if (!mounted.current || seq !== listSeq.current) return
      setItems(result.items ?? [])
      setSummary({ pending: result.pending ?? 0, overdue: result.overdue ?? 0, limited: Boolean(result.limited) })
      setLoadState('ready')
      // Surat masuk diambil TERPISAH dan kegagalannya tidak menggagalkan daftar
      // tugas: dua sumber berbeda, dan satu yang kosong tidak boleh membuat
      // seluruh layar tampil sebagai error.
      try {
        const inbox = await api<{ items: IncomingLetter[] }>('/api/v1/urmin/distribution-inbox/')
        if (!mounted.current || seq !== listSeq.current) return
        setIncomingLetters(inbox.items ?? [])
      } catch { if (mounted.current && seq === listSeq.current) setIncomingLetters([]) }
      // Arahan juga sumber terpisah, dengan alasan yang sama.
      try {
        const inbox = await api<{ items: DirectiveRow[] }>('/api/v1/leadership/directives/inbox')
        if (!mounted.current || seq !== listSeq.current) return
        // R5H6: hanya disposisi SURAT (arahan bertaut surat masuk). Arahan biasa
        // tinggal di menu Arahan; menu ini tidak lagi terhubung ke sana.
        setDirectives((inbox.items ?? []).filter(d => Boolean(d.incomingId)))
      } catch { if (mounted.current && seq === listSeq.current) setDirectives([]) }
    } catch (error) {
      if (!mounted.current || seq !== listSeq.current) return
      setLoadState('error')
      showToast(errText(error), 'error')
    }
  }, [workspaceTab, fromDate, toDate])

  const clearDetail = useCallback(() => {
    ++detailSeq.current
    selectedRef.current = ''
    setSelectedID('')
    setDetail(null)
    setDetailState('idle')
    setForwardPeople(null)
    setReason('')
    setForwardTo('')
    setForwardDue('')
    setForwardInstruction('')
  }, [])

  // R5H6: membuka disposisi = menerima suratnya (baris distribusi 'sent'),
  // sama seperti membuka detail di Surat Masuk. Konfirmasi "Terima Disposisi"
  // tetap tindakan sendiri di dalam jendela.
  async function openDisposition(d: DirectiveRow) {
    setOpenDispo(d); setDispoLetter(null)
    const pending = incomingLetters.find(l => l.incomingId === d.incomingId && l.status === 'sent')
    if (pending) {
      try {
        await api(`/api/v1/urmin/distribution-inbox/${encodeURIComponent(pending.id)}/receive`, 'POST', { reason: 'Diterima saat membuka disposisi' })
        window.dispatchEvent(new Event('sdl:inbox-changed'))
      } catch { /* 409 = sudah diterima; daftar dimuat ulang saat jendela ditutup */ }
    }
    // Data surat lengkap hanya untuk penerima yang diserahi suratnya; yang lain
    // (403/404) cukup memakai isi lembar disposisi.
    if (!d.incomingId || !incomingLetters.some(l => l.incomingId === d.incomingId)) return
    try {
      const [main, meta] = await Promise.all([
        api<{ item: DispoLetter['item'] }>(`/api/v1/urmin/surat-masuk/${d.incomingId}`),
        api<{ intake: DispoLetter['intake'] }>(`/api/v1/urmin/surat-masuk/${d.incomingId}/intake`).catch(() => ({ intake: null })),
      ])
      setDispoLetter({ item: main.item, intake: meta.intake })
    } catch { setDispoLetter(null) }
  }
  const openDetail = useCallback(async (id: string, resetForm = true) => {
    if (!id) return
    const seq = ++detailSeq.current
    selectedRef.current = id
    setSelectedID(id)
    setDetailState('loading')
    setDetail(null)
    setForwardPeople(null)
    if (resetForm) {
      setReason(''); setForwardTo(''); setForwardDue(''); setForwardInstruction('')
    }
    try {
      const loaded = await api<Detail>(`${BASE}/${encodeURIComponent(id)}/history`)
      if (!mounted.current || seq !== detailSeq.current || selectedRef.current !== id) return
      setDetail(loaded)
      setDetailState('ready')
      const task = loaded.item
      // R5G6: lampiran diambil TERPISAH dan kegagalannya tidak menggagalkan
      // detail tugas. Dua sumber berbeda, dan lampiran yang gagal dimuat tidak
      // boleh membuat seluruh panel tampil sebagai error.
      try {
        const files = await api<FileList>(`${BASE}/${encodeURIComponent(id)}/attachments`)
        if (mounted.current && seq === detailSeq.current && selectedRef.current === id) setFiles(files)
      } catch {
        if (mounted.current && seq === detailSeq.current) setFiles({ items: [], canUpload: false })
      }
      if (task.assigneeId === currentUserId && task.status === 'in_progress' && task.depth < 2) {
        try {
          const people = await api<{ items: Candidate[] }>(`${BASE}/${encodeURIComponent(id)}/forward-candidates`)
          if (mounted.current && seq === detailSeq.current && selectedRef.current === id) setForwardPeople(people.items ?? [])
        } catch {
          // Forward is optional and permission-gated; do not expose unauthorized candidates.
        }
      }
    } catch (error) {
      if (!mounted.current || seq !== detailSeq.current || selectedRef.current !== id) return
      setDetailState('error')
      showToast(errText(error), 'error')
    }
  }, [currentUserId])

  // Detail is a real modal, not a second full-width card under the table.
  useEffect(() => {
    if (!selectedID) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [selectedID])
  useEffect(() => {
    if (!selectedID || busy) return
    const handleModalKey = (event: KeyboardEvent) => {
      // Global confirmation dialogs take keyboard priority over this detail modal.
      if (document.querySelectorAll('[aria-modal="true"]').length > 1) return
      if (event.key === 'Escape') {
        event.preventDefault()
        clearDetail()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
        .filter(el => el.getClientRects().length > 0)
      if (!focusable.length) { event.preventDefault(); return }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleModalKey)
    return () => document.removeEventListener('keydown', handleModalKey)
  }, [selectedID, busy, clearDetail])

  useEffect(() => { void refreshList() }, [refreshList])
  // Kembali ke halaman 1 setiap kali isi daftarnya berubah bentuk. Tanpa ini,
  // menyaring dari 80 baris menjadi 6 selagi berada di halaman 4 menghasilkan
  // layar kosong yang terbaca seperti "tidak ada data".
  useEffect(() => { setPage(1) }, [workspaceTab, fromDate, toDate, query, statusFilter, ownerFilter, pageSize])
  useEffect(() => {
    if (!initialID || deepLinkHandled.current === initialID) return
    deepLinkHandled.current = initialID
    void openDetail(initialID)
  }, [initialID, openDetail])

  async function refresh() {
    await refreshList()
    if (selectedRef.current) await openDetail(selectedRef.current, false)
  }
  async function action(task: Task, choice: 'accept' | 'complete' | 'approved' | 'revision_requested') {
    const note = reason.trim()
    if (busy || note.length < 8 || note.length > 1000 || selectedRef.current !== task.id) return
    const labels: Record<typeof choice, string> = { accept: 'Terima Tugas', complete: 'Selesaikan Tugas', approved: 'Setujui Hasil', revision_requested: 'Perlu Tindak Lanjut' }
    const label = labels[choice]
    const ok = await confirmDialog(`${label} untuk surat ${task.letterNumber}?`, { confirmLabel: label })
    if (!ok || selectedRef.current !== task.id || !mounted.current) return
    setBusy(true)
    try {
      if (choice === 'accept' || choice === 'complete') await api(`${BASE}/${task.id}/${choice}`, 'POST', { reason: note, version: task.version })
      else await api(`${BASE}/${task.id}/review`, 'POST', { decision: choice, reason: note, version: task.version })
      showToast(choice === 'accept' ? 'Tugas berhasil diterima.' : choice === 'complete' ? 'Hasil tugas berhasil dicatat.' : choice === 'approved' ? 'Hasil tugas disetujui.' : 'Review berhasil dicatat.', 'success')
      setReason('')
      await refreshList()
      if (selectedRef.current === task.id) await openDetail(task.id)
    } catch (error) {
      showToast(errText(error), 'error')
      if (selectedRef.current === task.id) await openDetail(task.id, false)
    } finally { if (mounted.current) setBusy(false) }
  }
  /**
   * R5G6: unggah bukti hasil tindak lanjut.
   *
   * Tidak lewat `api()` — helper itu mengirim JSON, sedangkan endpoint 144
   * menerima multipart. CSRF tetap wajib, jadi tokennya diambil dengan cara
   * yang sama sebelum berkasnya dikirim.
   */
  async function uploadFile(task: Task, file: File) {
    if (busy) return
    setBusy(true)
    try {
      const csrf = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
      if (!csrf.ok) throw new Error('Sesi berakhir. Silakan masuk kembali.')
      const { csrfToken } = await csrf.json() as { csrfToken: string }
      const body = new FormData()
      body.append('file', file)
      // Alasan wajib minimal 8 karakter di backend; isian pengguna dipakai
      // kalau ada, kalau tidak diberi keterangan baku yang tetap bermakna di
      // jejak audit.
      body.append('reason', reason.trim().length >= 8 ? reason.trim() : `Lampiran hasil tindak lanjut: ${file.name}`)
      const response = await fetch(`${BASE}/${encodeURIComponent(task.id)}/attachments`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'X-CSRF-Token': csrfToken }, body,
      })
      if (!response.ok) {
        const e: { error?: string } = await response.json().catch(() => ({}))
        throw new Error(
          e.error === 'invalid_file_type' ? 'Hanya PDF, PNG, atau JPG yang dapat diunggah.'
          : e.error === 'file_too_large' || e.error === 'invalid_attachment' ? 'Ukuran berkas melebihi 10 MB.'
          : e.error === 'attachment_limit' ? 'Lampiran sudah mencapai batas 10 berkas.'
          : e.error === 'already_completed' ? 'Tugas sudah selesai; lampiran tidak dapat ditambah lagi.'
          : 'Unggah lampiran belum berhasil. Silakan coba lagi.')
      }
      showToast('Lampiran berhasil diunggah.', 'success')
      const next = await api<FileList>(`${BASE}/${encodeURIComponent(task.id)}/attachments`)
      if (mounted.current && selectedRef.current === task.id) setFiles(next)
    } catch (error) {
      showToast(errText(error), 'error')
    } finally { if (mounted.current) setBusy(false) }
  }

  // R5H5: tab Arsip dan tombol Arsipkan dihapus atas permintaan pemilik
  // sistem (2026-11-05). Endpoint POST /{id}/archive dan ?window=archive tetap
  // hidup di backend — kontrak API tidak berubah, hanya tidak dipanggil UI.
  async function forward(event: FormEvent, task: Task) {
    event.preventDefault()
    if (busy || !forwardTo || forwardInstruction.trim().length < 8 || forwardInstruction.trim().length > 1000 || !forwardDue || forwardDue > task.dueDate || selectedRef.current !== task.id) return
    const ok = await confirmDialog(`Teruskan disposisi ${task.letterNumber} kepada petugas terpilih?`, { confirmLabel: 'Teruskan Tugas' })
    if (!ok || selectedRef.current !== task.id || !mounted.current) return
    setBusy(true)
    try {
      await api(`${BASE}/${task.id}/forward`, 'POST', { assigneeId: forwardTo, instruction: forwardInstruction.trim(), dueDate: forwardDue, version: task.version })
      showToast('Disposisi berhasil diteruskan.', 'success')
      setForwardTo(''); setForwardDue(''); setForwardInstruction('')
      await refreshList()
      if (selectedRef.current === task.id) await openDetail(task.id)
    } catch (error) {
      showToast(errText(error), 'error')
      if (selectedRef.current === task.id) await openDetail(task.id, false)
    } finally { if (mounted.current) setBusy(false) }
  }

  const normalQuery = query.trim().toLocaleLowerCase('id-ID')
  const visible = items.filter(task => {
    if (workspaceTab === 'mine' && task.assigneeId !== currentUserId) return false
    if (workspaceTab === 'review' && (task.issuerId !== currentUserId || task.reviewStatus !== 'awaiting_review')) return false
    if (!workspaceTab && ownerFilter === 'mine' && task.assigneeId !== currentUserId) return false
    if (!workspaceTab && ownerFilter === 'issued' && task.issuerId !== currentUserId) return false
    if (workspaceTab !== 'review' && (statusFilter === 'awaiting_review' ? task.reviewStatus !== 'awaiting_review' : statusFilter !== 'all' && task.status !== statusFilter)) return false
    if (!normalQuery) return true
    return [task.letterNumber, task.subject, task.issuerName, task.assigneeName, task.instruction, task.unit].some(value => value.toLocaleLowerCase('id-ID').includes(normalQuery))
  })
  const sorted = [...visible].sort((a, b) => {
    if (sortOrder === 'due') return a.dueDate.localeCompare(b.dueDate) || b.createdAt.localeCompare(a.createdAt)
    return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
  })
  // Hanya di tab "Tugas Saya", dan hanya yang berstatus 'sent' — begitu surat
  // dikonfirmasi diterima ia berhenti menunggu, dan menampilkannya terus akan
  // membuat daftar tidak pernah habis. R5H5: filter status ikut berlaku —
  // surat yang belum dikonfirmasi setara "Menunggu Diterima", jadi ia hanya
  // tampil pada filter Semua Status dan Menunggu Diterima.
  const letterQuery = query.trim().toLowerCase()
  const letterRows = (workspaceTab === 'mine' || !workspaceTab)
    ? incomingLetters
        .filter(l => l.status === 'sent')
        // R5H6: surat yang datang bersama disposisi sudah diwakili baris disposisinya.
        .filter(l => !directives.some(d => d.incomingId === l.incomingId))
        .filter(() => statusFilter === 'all' || statusFilter === 'pending')
        .filter(l => !letterQuery || [l.letterNumber, l.subject, l.unit].some(v => v.toLowerCase().includes(letterQuery)))
        .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    : []
  // Arahan tampil di "Tugas Saya" dan tampilan tanpa tab, sama seperti surat.
  // Yang sudah dikonfirmasi tetap tampil (berlabel Diterima) supaya staf bisa
  // membuka lagi lembar disposisinya dari sini. R5H5: filter status ikut
  // berlaku — belum dikonfirmasi = Menunggu Diterima, sudah = Selesai.
  const directiveRows = (workspaceTab === 'mine' || !workspaceTab)
    ? directives
        .filter(d => statusFilter === 'all' || (statusFilter === 'pending' && !d.myAcknowledgedAt) || (statusFilter === 'completed' && Boolean(d.myAcknowledgedAt)))
        .filter(d => !letterQuery || [d.title, d.issuerName, d.sheet?.letterNumber ?? '', d.sheet?.subject ?? ''].some(v => v.toLowerCase().includes(letterQuery)))
        .sort((a, b) => Number(Boolean(a.myAcknowledgedAt)) - Number(Boolean(b.myAcknowledgedAt)) || b.createdAt.localeCompare(a.createdAt))
    : []
  // R5H5: surat, arahan, dan tugas dipaginasi sebagai SATU daftar dengan
  // urutan surat → arahan → tugas. Sebelumnya hanya tugas yang dipaginasi dan
  // dihitung, sehingga surat/arahan terulang di setiap halaman dan judul
  // menulis "0 tugas" di atas daftar yang berisi.
  const totalRows = letterRows.length + directiveRows.length + sorted.length
  const hasAnyRow = items.length > 0 || ((workspaceTab === 'mine' || !workspaceTab) && (incomingLetters.some(l => l.status === 'sent') || directives.length > 0))
  const pageCount = Math.max(1, Math.ceil(totalRows / pageSize))
  const safePage = Math.min(page, pageCount)
  const pageStart = (safePage - 1) * pageSize
  const pageEnd = pageStart + pageSize
  const lettersShown = letterRows.slice(pageStart, pageEnd)
  const directivesOffset = letterRows.length
  const directivesShown = directiveRows.slice(Math.max(0, pageStart - directivesOffset), Math.max(0, pageEnd - directivesOffset))
  const tasksOffset = directivesOffset + directiveRows.length
  const displayed = sorted.slice(Math.max(0, pageStart - tasksOffset), Math.max(0, pageEnd - tasksOffset))
  const reviewCount = items.filter(t => t.issuerId === currentUserId && t.reviewStatus === 'awaiting_review').length
  // R5H5: angka ringkasan dari server (pending/overdue) hanya menghitung tugas
  // disposisi. Surat yang belum dikonfirmasi dan arahan yang belum diterima
  // ikut tampil di tabel yang sama, jadi ikut dihitung di sini — kalau tidak,
  // layar menampilkan "0 Tugas Aktif" di atas daftar yang penuh. Dihitung dari
  // data mentah, bukan hasil pencarian, supaya angkanya tidak ikut berubah saat
  // mengetik di kotak cari.
  const nowISO = new Date().toISOString()
  const openLetters = incomingLetters.filter(l => l.status === 'sent').length
  const openDirectives = directives.filter(d => !d.myAcknowledgedAt)
  const lateDirectives = openDirectives.filter(d => d.dueAt && d.dueAt < nowISO).length
  const activeCount = summary.pending + openLetters + openDirectives.length
  const lateCount = summary.overdue + lateDirectives
  const task = detail?.item ?? null
  const canAct = task?.assigneeId === currentUserId && (task.status === 'pending' || task.status === 'in_progress')
  const canReview = task?.issuerId === currentUserId && task.status === 'completed' && task.reviewStatus === 'awaiting_review'
  const noteValid = reason.trim().length >= 8 && reason.trim().length <= 1000

  return <div className="sdl-tasks-r5f3">
    {/* R5G2: Monitoring Pimpinan (LeadershipMonitorR3D3) disembunyikan atas
        permintaan pemilik sistem, 2026-11-02. Komponennya UTUH dan endpoint
        /dispositions/leadership + /decide-final tetap hidup — hanya tidak
        dirender. Untuk menampilkan lagi, hapus komentar di bawah.

        Yang hilang selama disembunyikan: satu-satunya tempat Kabagrenmin
        memberi keputusan final (approved / revision_requested) di UI.
        Disposisi yang menunggu keputusannya tidak akan bisa diselesaikan. */}
    {/* <LeadershipMonitorR3D3 /> */}
    <div className="sdl-tasks-r5f11__overview" aria-label="Ringkasan disposisi">
      <span><strong>{loadState === 'ready' ? activeCount : '—'}</strong> Tugas Aktif</span>
      <span className={lateCount > 0 ? 'is-warning' : undefined}><strong>{loadState === 'ready' ? lateCount : '—'}</strong> Terlambat</span>
      <span><strong>{loadState === 'ready' ? reviewCount : '—'}</strong> Perlu Review</span>
    </div>
    <section className="panel sdl-tasks-r5f3__panel" aria-label="Daftar tugas disposisi">
      <div className="sdl-tasks-r5f11__toolbar"><div><strong>{loadState === 'ready' ? `${totalRows} tugas` : 'Daftar tugas'}</strong><span>{workspaceTab === 'mine' ? 'Ditugaskan kepada Anda' : workspaceTab === 'review' ? 'Hasil yang memerlukan keputusan Anda' : 'Tugas yang dapat Anda akses'}</span></div><button type="button" className="btn" disabled={busy || loadState === 'loading'} onClick={() => void refresh()}>{loadState === 'loading' ? 'Memuat...' : 'Perbarui'}</button></div>
      <p className="sdl-tasks-r5f3__limit">{fromDate && toDate
        ? `Rentang tanggal surat ${dateOnly(fromDate)} sampai ${dateOnly(toDate)}.`
        : 'Menampilkan surat bertanggal 15 hari ke belakang sampai 15 hari ke depan yang belum selesai. Yang sudah disetujui tercatat di menu Arsip.'}</p>
      {summary.limited && <p className="sdl-tasks-r5f3__limit">Menampilkan maksimal 200 tugas terbaru. Ringkasan pencarian dan jumlah review hanya mencakup data yang ditampilkan.</p>}
      <div className="sdl-tasks-r5f3__filters">
        <label><span className="sdl-sr-only">Cari tugas</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Cari nomor surat, perihal atau petugas" aria-label="Cari tugas" /></label>
        {!workspaceTab && <label><span className="sdl-sr-only">Kelompok tugas</span><select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value as OwnerFilter)} aria-label="Kelompok tugas"><option value="all">Semua Tugas</option><option value="mine">Ditugaskan ke Saya</option><option value="issued">Saya Terbitkan</option></select></label>}
        {workspaceTab!=='review'&&<label><span className="sdl-sr-only">Status tugas</span><select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} aria-label="Status tugas"><option value="all">Semua Status</option><option value="pending">Menunggu Diterima</option><option value="in_progress">Dalam Proses</option><option value="completed">Selesai</option><option value="awaiting_review">Menunggu Review</option></select></label>}
        <label><span className="sdl-sr-only">Urutkan tugas</span><select value={sortOrder} onChange={e => setSortOrder(e.target.value as 'latest'|'due')} aria-label="Urutkan tugas"><option value="latest">Terbaru</option><option value="due">Tenggat terdekat</option></select></label>
        {/* Rentang baru dikirim ke server setelah KEDUANYA terisi; mengisi satu
            kotak saja tidak mengubah apa pun. */}
        <label><span className="sdl-sr-only">Tanggal surat dari</span><input type="date" value={fromDate} max={toDate || undefined} onChange={e => setFromDate(e.target.value)} aria-label="Tanggal surat dari" /></label>
        <label><span className="sdl-sr-only">Tanggal surat sampai</span><input type="date" value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)} aria-label="Tanggal surat sampai" /></label>
        {(fromDate || toDate) && <button type="button" className="btn" onClick={() => { setFromDate(''); setToDate('') }}>Hapus Rentang</button>}
        <label><span className="sdl-sr-only">Jumlah data per halaman</span><select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} aria-label="Jumlah data per halaman"><option value={5}>5 per halaman</option><option value={10}>10 per halaman</option><option value={50}>50 per halaman</option><option value={100}>100 per halaman</option></select></label>
      </div>
      {loadState === 'loading' && !items.length ? <div className="sdl-tasks-r5f3__empty" role="status">Memuat tugas...</div>
        : loadState === 'error' ? <div className="sdl-tasks-r5f3__empty" role="alert"><strong>Daftar tugas belum tersedia.</strong><p>Periksa sesi dan coba kembali.</p><button type="button" className="btn" onClick={() => void refresh()}>Coba Lagi</button></div>
        : totalRows === 0 ? <div className="sdl-tasks-r5f3__empty"><strong>{hasAnyRow ? 'Tidak ada tugas sesuai filter' : 'Belum ada surat atau tugas disposisi'}</strong><p>{hasAnyRow ? 'Coba ubah pencarian atau filter.' : 'Surat yang ditujukan kepada Anda akan muncul di sini begitu didistribusikan.'}</p></div>
        : <div className="table-scroll"><table className="data-table sdl-tasks-r5f3__table"><thead><tr><th>Surat / Perihal</th><th>Penugasan</th><th>Tenggat</th><th>Status</th><th>Review / Target</th><th>Aksi</th></tr></thead><tbody>
          {/* Surat yang menunggu tindakan ditaruh PALING ATAS: ia belum jadi
              tugas, dan justru itu yang perlu dikerjakan lebih dulu. */}
          {lettersShown.map(letter => <tr key={`letter-${letter.id}`} className="sdl-tasks-r5f3__letter-row">
            <td><strong>{letter.letterNumber}</strong><small>{letter.subject}</small></td>
            <td><strong>Belum ditugaskan</strong><small>Dari unit {letter.unit}</small></td>
            <td>—</td>
            <td><span className="r3c-status pending">Surat Masuk</span></td>
            <td><span className="r3d-sla unknown">Menunggu tindakan</span><small>{dateOnly(letter.sentAt)}</small></td>
            <td>{onOpenLetter ? <button type="button" className="btn" onClick={() => onOpenLetter(letter.incomingId)}>Lihat Surat</button> : '—'}</td>
          </tr>)}
          {directivesShown.map(d => <tr key={`arahan-${d.id}`} className="sdl-tasks-r5f3__letter-row">
            <td><strong>{d.sheet?.letterNumber || d.title}</strong><small>{d.sheet?.letterNumber ? d.title : (d.sheet?.subject || 'Disposisi pimpinan')}</small></td>
            <td><strong>Disposisi · {d.issuerName}</strong><small>{d.priority === 'kilat' ? 'Kilat' : d.priority === 'penting' ? 'Penting' : 'Biasa'}</small></td>
            <td>{d.dueAt ? datetime(d.dueAt) : '—'}</td>
            <td><span className={`r3c-status ${d.myAcknowledgedAt ? 'completed' : d.myReadAt ? 'in_progress' : 'pending'}`}>{d.myAcknowledgedAt ? 'Disposisi Diterima' : d.myReadAt ? 'Disposisi Dibaca' : 'Disposisi Baru'}</span></td>
            <td><span className="r3d-sla unknown">{d.myAcknowledgedAt ? 'Sudah dikonfirmasi' : 'Perlu konfirmasi'}</span><small>{datetime(d.createdAt)}</small></td>
            <td>{d.incomingId ? <button type="button" className="btn" onClick={() => void openDisposition(d)}>Buka</button> : '—'}</td>
          </tr>)}
          {displayed.map(t => <tr key={t.id} className={selectedID === t.id ? 'sdl-tasks-r5f3__active' : undefined}>
          <td><strong>{t.depth > 0 ? `↳ L${t.depth} · ` : ''}{t.letterNumber}</strong><small>{t.subject}</small></td>
          <td><strong>{t.assigneeName}</strong><small>Dari {t.issuerName}</small></td>
          <td>{dateOnly(t.dueDate)}</td>
          <td><span className={`r3c-status ${t.status}`}>{statusNames[t.status]}</span></td>
          <td><span className={`r3d-sla ${t.slaStatus}`}>{slaNames[t.slaStatus]}</span><small>{reviewNames[t.reviewStatus]}</small></td>
          <td><button type="button" className="btn" disabled={busy} onClick={() => void openDetail(t.id)}>Detail</button></td>
        </tr>)}</tbody></table></div>}
      {loadState === 'ready' && totalRows > 0 && <div className="sdl-tasks-r5f3__pager">
        <span>Menampilkan {pageStart + 1}–{Math.min(pageEnd, totalRows)} dari {totalRows}</span>
        <div>
          <button type="button" className="btn" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Sebelumnya</button>
          <span aria-live="polite">Halaman {safePage} dari {pageCount}</span>
          <button type="button" className="btn" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Berikutnya</button>
        </div>
      </div>}
    </section>
    {openDispo && openDispo.incomingId && <div className="sdl-tasks-r5f11__backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) { setOpenDispo(null); void refresh() } }} onKeyDown={e => { if (e.key === 'Escape') { setOpenDispo(null); void refresh() } }}>
      <section className="sdl-tasks-r5f11__dialog" role="dialog" aria-modal="true" aria-labelledby="sdl-dispo-r5h6-title">
      <div className="sdl-tasks-r5f11__modal-head"><div><span className="sdl-work-kicker">DETAIL DISPOSISI</span><h2 id="sdl-dispo-r5h6-title">{openDispo.sheet?.letterNumber || openDispo.title}</h2><p>{openDispo.sheet?.subject || openDispo.title}</p></div><button type="button" className="btn" autoFocus onClick={() => { setOpenDispo(null); void refresh() }} aria-label="Tutup detail disposisi">Tutup</button></div>
      <div className="sdl-tasks-r5f11__modal-body">
        {(() => {
          const L = dispoLetter?.item, I = dispoLetter?.intake, sh = openDispo.sheet
          const klas = (L?.classification ?? sh?.classification) === 'penting' ? 'Rahasia' : 'Biasa'
          const derajat = (L?.derajat ?? sh?.derajat) === 'kilat' ? 'Kilat' : 'Biasa'
          const when = (v?: string) => v ? v.replace('T', ' ').slice(0, 16) + ' WIB' : ''
          return <>
            <h4 className="sm-history-title" style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>Informasi Surat</h4>
            <div className="sdl-tasks-r5f3__facts">
              <div><span>No. Agenda Surat Masuk</span><strong>{L ? `SM-${new Date(L.createdAt).getFullYear()}-${L.agendaNo}` : '—'}</strong></div>
              <div><span>Nomor Surat</span><strong>{L?.letterNumber || sh?.letterNumber || '—'}</strong></div>
              <div><span>Surat Dari</span><strong>{L?.sender || sh?.letterFrom || '—'}</strong></div>
              <div><span>Tanggal Surat</span><strong>{(L?.letterDate || sh?.letterDate) ? dateOnly((L?.letterDate || sh?.letterDate)!) : '—'}</strong></div>
              <div><span>Tanggal Diterima</span><strong>{L?.receivedDate ? dateOnly(L.receivedDate) : '—'}</strong></div>
              <div><span>Klasifikasi</span><strong>{klas}</strong></div>
              <div><span>Derajat</span><strong>{derajat}</strong></div>
              <div><span>Jenis Surat</span><strong>{I ? (letterKindNames[I.letterKind] ?? I.letterKind) : '—'}</strong></div>
              <div><span>Batas Respons</span><strong>{I?.responseDue ? dateOnly(I.responseDue) : 'Tanpa batas respons'}</strong></div>
              <div><span>Tenggat Disposisi</span><strong>{openDispo.dueAt ? datetime(openDispo.dueAt) : '—'}</strong></div>
              <div><span>Dikirim Oleh</span><strong>{openDispo.issuerName}</strong></div>
              <div><span>Tanggal Dikirim</span><strong>{datetime(openDispo.createdAt)}</strong></div>
              {I?.eventStart && <div style={{ gridColumn: '1 / -1' }}><span>Pelaksanaan Kegiatan</span><strong>{when(I.eventStart)}{I.eventEnd ? ` s.d. ${when(I.eventEnd)}` : ''} · {I.eventLocation || 'Lokasi belum dicatat'}{I.eventAgenda ? ` · ${I.eventAgenda}` : ''}</strong></div>}
              <div style={{ gridColumn: '1 / -1' }}><span>Perihal</span><strong>{L?.subject || sh?.subject || openDispo.title}</strong></div>
              {I?.details && <div style={{ gridColumn: '1 / -1' }}><span>Informasi Tambahan</span><strong style={{ whiteSpace: 'pre-wrap' }}>{I.details}</strong></div>}
            </div>
          </>
        })()}
        <DisposisiSuratR5H6 key={openDispo.id} letter={{ id: openDispo.incomingId, letterNumber: openDispo.sheet?.letterNumber || '', sender: openDispo.sheet?.letterFrom || '', letterDate: openDispo.sheet?.letterDate || '', subject: openDispo.sheet?.subject || openDispo.title, classification: openDispo.sheet?.classification === 'penting' ? 'penting' : 'biasa', derajat: openDispo.sheet?.derajat === 'kilat' ? 'kilat' : 'biasa' }} onChanged={() => void refresh()} />
        {/* Naskah & lampiran hanya untuk penerima yang memang diserahi suratnya
            (berwenang atas klasifikasinya); yang lain cukup lembar disposisi. */}
        {incomingLetters.some(l => l.incomingId === openDispo.incomingId)
          ? <SuratR3B incomingId={openDispo.incomingId} registered={true} />
          : <p className="sdl-tasks-r5f3__message">Naskah surat tidak diserahkan ke akun Anda karena klasifikasinya. Lembar disposisi di atas tetap berlaku.</p>}
      </div>
      </section>
    </div>}
    {selectedID && <div className="sdl-tasks-r5f11__backdrop" role="presentation">
      <section ref={dialogRef} className="sdl-tasks-r5f11__dialog" role="dialog" aria-modal="true" aria-labelledby="sdl-tasks-r5f11-title" aria-describedby="sdl-tasks-r5f11-subtitle">
      <div className="sdl-tasks-r5f11__modal-head"><div><span className="sdl-work-kicker">DETAIL DISPOSISI</span><h2 id="sdl-tasks-r5f11-title">{task ? task.letterNumber : 'Detail Tugas'}</h2><p id="sdl-tasks-r5f11-subtitle">{task?.subject ?? 'Memuat informasi tugas...'}</p></div><button ref={closeButtonRef} type="button" className="btn" onClick={clearDetail} disabled={busy} aria-label="Tutup detail disposisi">Tutup</button></div>
      <div className="sdl-tasks-r5f11__modal-body">
      {detailState === 'loading' ? <p role="status" className="sdl-tasks-r5f3__message">Memuat detail dan riwayat...</p>
        : detailState === 'error' ? <div role="alert" className="sdl-tasks-r5f3__message">Detail tidak tersedia. <button type="button" className="btn" onClick={() => void openDetail(selectedID)}>Coba Lagi</button></div>
        : task && detail && <>
          <div className="sdl-tasks-r5f3__facts">
            <div><span>Dari</span><strong>{task.issuerName}</strong></div><div><span>Ditugaskan Kepada</span><strong>{task.assigneeName}</strong></div>
            <div><span>Unit</span><strong>{unitNames[task.unit] ?? task.unit}</strong></div><div><span>Tenggat</span><strong>{dateOnly(task.dueDate)}</strong></div>
            <div><span>Status</span><strong>{statusNames[task.status]}</strong></div><div><span>Review</span><strong>{reviewNames[task.reviewStatus]}</strong></div>
            <div><span>Target</span><strong>{slaNames[task.slaStatus]}</strong></div><div><span>Hierarki</span><strong>{task.parentTaskId ? `Turunan Level ${task.depth}` : 'Disposisi Utama'}</strong></div>
          </div>
          <div className="sdl-tasks-r5f11__detail-actions">{onOpenLetter && <button type="button" className="btn" disabled={busy} onClick={() => onOpenLetter(task.incomingId)}>Buka Surat & Lampiran</button>}{task.parentTaskId && <button type="button" className="btn" disabled={busy} onClick={() => void openDetail(task.parentTaskId!)}>Lihat Tugas Induk</button>}</div>
          <div className="sdl-tasks-r5f3__section"><h3>Arahan</h3><p className="sdl-tasks-r5f3__copy">{task.instruction}</p></div>
          {task.completionNote && <div className="sdl-tasks-r5f3__section"><h3>Hasil Tindak Lanjut</h3><p className="sdl-tasks-r5f3__copy">{task.completionNote}</p></div>}
          {task.reviewReason && <div className="sdl-tasks-r5f3__section"><h3>Catatan Review</h3><p className="sdl-tasks-r5f3__copy">{task.reviewReason}</p></div>}
          <div className="sdl-tasks-r5f3__section"><h3>Riwayat Disposisi</h3>{detail.events.length === 0 ? <p className="sdl-tasks-r5f3__message">Belum ada riwayat.</p> : <ol className="sdl-tasks-r5f3__events">{detail.events.map((ev, i) => <li key={`${ev.at}-${ev.action}-${i}`}><strong>{eventLabel(ev.action)}</strong><small>{ev.actor} · {datetime(ev.at)}</small><p>{ev.reason}</p></li>)}</ol>}</div>
          {canAct && <div className="sdl-tasks-r5f3__section"><h3>{task.status === 'pending' ? 'Terima Tugas' : 'Selesaikan Tugas'}</h3><label className="sdl-tasks-r5f3__field">{task.status === 'pending' ? 'Keterangan Penerimaan' : 'Hasil Tindak Lanjut'}<textarea className="rm-input" rows={3} minLength={8} maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} disabled={busy} placeholder="Tuliskan keterangan minimal 8 karakter" /></label>
            {/* R5G6: lampiran diunggah SEBELUM tugas diselesaikan. Setelah
                statusnya completed, backend menolak 409 — bukti tidak boleh
                bertambah di belakang telaah penerbit. */}
            {task.status !== 'pending' && files.canUpload && <label className="sdl-tasks-r5f3__field">Lampiran Bukti (opsional)
              <input type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy} onChange={e => {
                const picked = e.target.files?.[0]
                e.target.value = ''
                if (picked) void uploadFile(task, picked)
              }} />
              <small className="sdl-tasks-r5f3__hint">PDF, PNG, atau JPG · maksimal 10 MB · paling banyak 10 berkas. Unggah dulu, lalu tekan Selesaikan Tugas.</small>
            </label>}
            <button type="button" className="btn primary" disabled={busy || !noteValid} onClick={() => void action(task, task.status === 'pending' ? 'accept' : 'complete')}>{busy ? 'Memproses...' : task.status === 'pending' ? 'Terima Tugas' : 'Selesaikan Tugas'}</button></div>}
          {/* Terlihat oleh KEDUA pihak: pelaksana memastikan buktinya terkirim,
              penerbit membukanya saat menelaah. */}
          {files.items.length > 0 && <div className="sdl-tasks-r5f3__section"><h3>Lampiran Bukti</h3><ul className="sdl-tasks-r5f3__files">
            {files.items.map(f => <li key={f.id}>
              <a href={`${BASE}/${encodeURIComponent(task.id)}/attachments/${encodeURIComponent(f.id)}/download`} download={f.filename}>{f.filename}</a>
              <small>{fileSize(f.sizeBytes)} · {f.uploadedBy} · {datetime(f.createdAt)}</small>
            </li>)}
          </ul></div>}
          {task.assigneeId === currentUserId && task.status === 'in_progress' && task.depth < 2 && forwardPeople !== null && <div className="sdl-tasks-r5f3__section"><h3>Teruskan ke Petugas · Level {task.depth + 1}</h3><form onSubmit={event => void forward(event, task)} className="sdl-tasks-r5f3__forward"><label className="sdl-tasks-r5f3__field">Petugas Tujuan<select className="rm-input" required disabled={busy} value={forwardTo} onChange={e => setForwardTo(e.target.value)}><option value="">Pilih petugas</option>{forwardPeople.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label className="sdl-tasks-r5f3__field">Tenggat<input className="rm-input" type="date" required disabled={busy} max={task.dueDate} value={forwardDue} onChange={e => setForwardDue(e.target.value)} /></label><label className="sdl-tasks-r5f3__field sdl-tasks-r5f3__wide">Arahan untuk Petugas<textarea className="rm-input" required minLength={8} maxLength={1000} rows={3} disabled={busy} value={forwardInstruction} onChange={e => setForwardInstruction(e.target.value)} /></label><button type="submit" className="btn primary" disabled={busy || !forwardTo || forwardInstruction.trim().length < 8 || !forwardDue || forwardDue > task.dueDate}>{busy ? 'Memproses...' : 'Teruskan Tugas'}</button>{forwardPeople.length === 0 && <p className="sdl-tasks-r5f3__message">Belum ada petugas yang dapat dipilih.</p>}</form></div>}
          {canReview && <div className="sdl-tasks-r5f3__section"><h3>Review Hasil Tugas</h3><label className="sdl-tasks-r5f3__field">Catatan Review<textarea className="rm-input" minLength={8} maxLength={1000} rows={3} disabled={busy} value={reason} onChange={e => setReason(e.target.value)} placeholder="Tuliskan hasil penilaian minimal 8 karakter" /></label><div className="sdl-tasks-r5f3__buttons"><button type="button" className="btn primary" disabled={busy || !noteValid} onClick={() => void action(task, 'approved')}>Setujui Hasil</button><button type="button" className="btn" disabled={busy || !noteValid} onClick={() => void action(task, 'revision_requested')}>Perlu Tindak Lanjut</button></div></div>}
          {task.depth === 0 && <div className="sdl-tasks-r5f3__section"><DisposisiAutoCompleteR5F20 key={`${task.id}-${task.version}-${task.reviewStatus}`} taskId={task.id} version={task.version} issuerId={task.issuerId} currentUserId={currentUserId} reviewStatus={task.reviewStatus} status={task.status} /></div>}
        </>}
      </div>
      </section>
    </div>}
  </div>
}
