import { useCallback, useEffect, useState } from 'react'
import { InboxDistribusi } from './InboxDistribusiR5F2'
import './InboxSayaR5H10.css'

/**
 * R5H10: Inbox gabungan -- semua yang menunggu tindakan akun ini, di satu tempat.
 *
 * TIDAK ADA ENDPOINT BARU. Setiap sumber sudah menyaring per akun di level SQL
 * (Engine A/B, distribusi per penerima); layar ini hanya merangkai hasilnya:
 *
 *   1. Disposisi/arahan masuk     GET /leadership/directives/inbox  (belum diterima)
 *   2. Surat keluar               GET /urmin/registry/?kind=surat_keluar
 *        Kabagrenmin: status 'submitted' (menunggu tanda tangan)
 *        lainnya    : status 'rejected' milik akun ini (perlu revisi)
 *   3. Tugas disposisi            GET /urmin/dispositions/?window=active
 *        penerima : belum selesai / diminta revisi
 *        pemberi  : menunggu telaah
 *   4. Surat masuk yang diteruskan GET /urmin/distribution-inbox/  (daftar di bawah)
 *
 * Sumber yang ditolak (403) atau gagal dibaca dianggap kosong: tidak setiap
 * akun berhak atas setiap modul, dan satu modul yang gagal tidak boleh
 * mengosongkan seluruh Inbox.
 */

export type InboxKind = 'disposisi' | 'arahan' | 'surat_keluar' | 'tugas'
export type InboxItem = { key: string; kind: InboxKind; title: string; sub: string; at: string; badge: string; tone: 'warn' | 'danger' | 'info'; open: InboxTarget }
export type InboxTarget =
  | { view: 'arahan'; recordID: string }
  | { view: 'tasks'; recordID: string }
  | { view: 'surat-keluar'; recordID: string }

type Directive = { id: string; title: string; issuerName: string; createdAt: string; incomingId?: string; agendaSurat?: string; myAcknowledgedAt?: string | null; sheet?: { letterNumber?: string; subject?: string } }
type Outgoing = { id: string; title: string; owner: string; createdAt: string; workflowStatus?: string; fields: Record<string, string> }
type Task = { id: string; letterNumber: string; subject: string; issuerId: string; issuerName: string; assigneeId: string; assigneeName: string; dueDate: string; status: string; reviewStatus: string; createdAt: string; slaStatus: string }

async function get<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
    return r.ok ? (await r.json()) as T : null
  } catch { return null }
}

/** Satu sumber kebenaran untuk halaman Inbox DAN badge di header. */
export async function loadInbox(me: { id: string; isKabagrenmin: boolean }): Promise<{ items: InboxItem[]; distributionPending: number }> {
  const [dir, out, tasks, dist] = await Promise.all([
    get<{ items?: Directive[] }>('/api/v1/leadership/directives/inbox'),
    get<{ items?: Outgoing[] }>('/api/v1/urmin/registry/?kind=surat_keluar'),
    get<{ items?: Task[] }>('/api/v1/urmin/dispositions/?window=active'),
    get<{ pending?: number }>('/api/v1/urmin/distribution-inbox/'),
  ])
  const items: InboxItem[] = []

  for (const d of dir?.items ?? []) {
    if (d.myAcknowledgedAt) continue
    const isDispo = Boolean(d.incomingId)
    items.push({
      key: `dir-${d.id}`, kind: isDispo ? 'disposisi' : 'arahan',
      title: isDispo ? (d.sheet?.subject || d.title) : d.title,
      sub: isDispo ? `Disposisi dari ${d.issuerName}${d.sheet?.letterNumber ? ` · ${d.sheet.letterNumber}` : ''}` : `Arahan dari ${d.issuerName}`,
      at: d.createdAt, badge: 'Belum diterima', tone: 'warn', open: { view: 'arahan', recordID: d.id },
    })
  }

  for (const s of out?.items ?? []) {
    if (me.isKabagrenmin && s.workflowStatus === 'submitted') {
      items.push({ key: `sk-${s.id}`, kind: 'surat_keluar', title: s.title, sub: `Surat keluar${s.fields?.tujuan ? ` kepada ${s.fields.tujuan}` : ''}`, at: s.createdAt, badge: 'Menunggu tanda tangan', tone: 'warn', open: { view: 'surat-keluar', recordID: s.id } })
    } else if (!me.isKabagrenmin && s.workflowStatus === 'rejected' && s.owner === me.id) {
      items.push({ key: `sk-${s.id}`, kind: 'surat_keluar', title: s.title, sub: 'Surat keluar dikembalikan Kabagrenmin', at: s.createdAt, badge: 'Perlu revisi', tone: 'danger', open: { view: 'surat-keluar', recordID: s.id } })
    }
  }

  for (const t of tasks?.items ?? []) {
    const letter = [t.letterNumber, t.subject].filter(Boolean).join(' · ')
    if (t.assigneeId === me.id && (t.status !== 'completed' || t.reviewStatus === 'revision_requested')) {
      const revisi = t.reviewStatus === 'revision_requested'
      const late = t.slaStatus === 'overdue'
      items.push({ key: `t-${t.id}`, kind: 'tugas', title: letter || 'Tugas disposisi', sub: `Tugas dari ${t.issuerName}${t.dueDate ? ` · batas ${t.dueDate}` : ''}`, at: t.createdAt, badge: revisi ? 'Diminta revisi' : late ? 'Terlambat' : t.status === 'pending' ? 'Tugas baru' : 'Dikerjakan', tone: revisi || late ? 'danger' : 'warn', open: { view: 'tasks', recordID: t.id } })
    } else if (t.issuerId === me.id && t.reviewStatus === 'awaiting_review') {
      items.push({ key: `t-${t.id}`, kind: 'tugas', title: letter || 'Tugas disposisi', sub: `Hasil dari ${t.assigneeName}`, at: t.createdAt, badge: 'Menunggu telaah Anda', tone: 'info', open: { view: 'tasks', recordID: t.id } })
    }
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  return { items, distributionPending: dist?.pending ?? 0 }
}

const KIND_LABEL: Record<InboxKind, string> = { disposisi: 'Disposisi', arahan: 'Arahan', surat_keluar: 'Surat Keluar', tugas: 'Tugas' }
type Filter = 'all' | InboxKind

export function InboxSaya({ me, initialID, onOpen }: { me: { id: string; isKabagrenmin: boolean }; initialID?: string; onOpen: (t: InboxTarget) => void }) {
  const [items, setItems] = useState<InboxItem[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const reload = useCallback(async () => {
    const r = await loadInbox(me)
    setItems(r.items)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.id, me.isKabagrenmin])

  useEffect(() => {
    void reload()
    const on = () => { void reload() }
    window.addEventListener('sdl:inbox-changed', on)
    return () => window.removeEventListener('sdl:inbox-changed', on)
  }, [reload])

  const counts = (items ?? []).reduce<Record<string, number>>((m, i) => { m[i.kind] = (m[i.kind] ?? 0) + 1; return m }, {})
  const kinds = (Object.keys(KIND_LABEL) as InboxKind[]).filter(k => counts[k])
  const shown = (items ?? []).filter(i => filter === 'all' || i.kind === filter)

  return <div className="sdl-inbox-h10">
    <section className="panel sdl-inbox-h10__panel" aria-labelledby="sdl-inbox-h10-title">
      <header className="sdl-inbox-h10__head">
        <div><h2 id="sdl-inbox-h10-title">Perlu tindakan Anda</h2>
          <p>{items === null ? 'Memuat…' : items.length === 0 ? 'Tidak ada yang menunggu tindakan Anda.' : `${items.length} hal menunggu tindakan Anda.`}</p></div>
        <button type="button" className="btn" onClick={() => { setItems(null); void reload() }}>Muat ulang</button>
      </header>
      {kinds.length > 1 && <div className="sdl-inbox-h10__filters" role="tablist" aria-label="Jenis">
        <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>Semua <b>{items?.length ?? 0}</b></button>
        {kinds.map(k => <button type="button" role="tab" key={k} aria-selected={filter === k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>{KIND_LABEL[k]} <b>{counts[k]}</b></button>)}
      </div>}
      {items !== null && shown.length > 0 && <ul className="sdl-inbox-h10__list">
        {shown.map(i => <li key={i.key}>
          <button type="button" onClick={() => onOpen(i.open)} aria-label={`Buka ${KIND_LABEL[i.kind]}: ${i.title}, ${i.badge}`} className={`sdl-inbox-h10__row tone-${i.tone}`}>
            <span className={`sdl-inbox-h10__kind is-${i.kind}`}>{KIND_LABEL[i.kind]}</span>
            <span className="sdl-inbox-h10__text"><strong>{i.title}</strong><small>{i.sub}</small></span>
            <span className={`sdl-inbox-h10__badge tone-${i.tone}`}>{i.badge}</span>
            <time className="sdl-inbox-h10__at" dateTime={i.at}>{new Date(i.at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</time>
          </button>
        </li>)}
      </ul>}
    </section>
    <h2 className="sdl-inbox-h10__sub">Surat masuk yang diteruskan kepada Anda</h2>
    <InboxDistribusi initialID={initialID}/>
  </div>
}
