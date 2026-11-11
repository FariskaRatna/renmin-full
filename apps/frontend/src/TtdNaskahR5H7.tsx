import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type SignaturePad from 'signature_pad'
import './TtdNaskahR5H7.css'

/**
 * R5H7: Kabagrenmin menandatangani naskah surat keluar lalu menyetujuinya.
 *
 * Penempatan dikirim relatif 0..1 dari KIRI-ATAS halaman SEBAGAIMANA TAMPIL
 * (pdf.js sudah memperhitungkan /Rotate dan CropBox); server menerjemahkannya
 * ke ruang PDF (pdf-sign.js). Setiap PDF naskah wajib punya minimal satu
 * tanda tangan -- aturan yang sama ditegakkan server.
 *
 * Tanda tangan VISUAL, bukan TTE tersertifikasi. Tanpa ketik password/OTP
 * (keputusan pemilik 2026-11-10).
 */

export type NaskahFile = { id: string; name: string }
type Box = { key: number; page: number; x: number; y: number; w: number; h: number }
type Drag = { key: number; mode: 'move' | 'resize'; startX: number; startY: number; orig: Box; width: number; height: number }

const workURL = '/api/v1/unit-work/urmin/records/'
const MIN = 0.03
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const r5 = (v: number) => Math.round(v * 1e5) / 1e5

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang menyetujui surat keluar.',
  workflow_state_changed: 'Status surat berubah di sesi lain. Tutup jendela ini dan muat ulang.',
  document_integrity_changed: 'Naskah berubah sejak diajukan. Kembalikan surat untuk revisi.',
  already_signed: 'Surat ini sudah ditandatangani.',
  placements_mismatch: 'Setiap naskah PDF wajib diberi minimal satu tanda tangan.',
  invalid_placements: 'Posisi tanda tangan tidak valid. Pastikan seluruh kotak berada di dalam halaman.',
  invalid_signature_image: 'Gambar tanda tangan tidak valid. Coret ulang tanda tangan Anda.',
  no_saved_signature: 'Belum ada tanda tangan tersimpan. Coret tanda tangan baru.',
  signature_key_unavailable: 'Kunci enkripsi tanda tangan belum dikonfigurasi di server. Hubungi administrator.',
  pdf_unreadable: 'Salah satu naskah PDF tidak dapat dibaca. Kembalikan surat untuk revisi.',
  pdf_encrypted: 'Salah satu naskah PDF terkunci kata sandi. Kembalikan surat untuk revisi.',
  page_out_of_range: 'Ada tanda tangan di halaman yang tidak ada.',
  pdf_required_before_submit: 'Surat tidak memiliki naskah PDF.',
}

async function api<T>(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') {
    const c = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!c.ok) throw Error('Sesi keamanan tidak tersedia. Silakan login kembali.')
    const t: { csrfToken: string } = await c.json()
    headers['X-CSRF-Token'] = t.csrfToken
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  if (!r.ok) {
    const e: { error?: string; file?: string } = await r.json().catch(() => ({}))
    const msg = ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}${e.error ? `: ${e.error}` : ''}).`
    throw Error(e.file ? `${msg} (${e.file})` : msg)
  }
  return r.json() as Promise<T>
}

/** Potong area transparan di sekeliling coretan supaya tanda tangan mengisi kotaknya. */
function trimmedPng(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const { width, height } = canvas
  const data = ctx.getImageData(0, 0, width, height).data
  let top = height, left = width, right = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y }
  }
  if (right < 0) return null
  const pad = 6
  left = Math.max(0, left - pad); top = Math.max(0, top - pad)
  right = Math.min(width - 1, right + pad); bottom = Math.min(height - 1, bottom + pad)
  const w = Math.max(40, right - left + 1), h = Math.max(20, bottom - top + 1)
  const out = document.createElement('canvas')
  out.width = Math.min(w, 2000); out.height = Math.min(h, 1200)
  out.getContext('2d')?.drawImage(canvas, left, top, w, h, 0, 0, out.width, out.height)
  return out.toDataURL('image/png')
}

export function TtdNaskahR5H7({ registerId, workRecordId, version, title, files, onClose, onDone }: {
  registerId: string; workRecordId: string; version: number; title: string; files: NaskahFile[]
  onClose: () => void; onDone: (message: string) => void
}) {
  const [docs, setDocs] = useState<Record<string, PDFDocumentProxy>>({})
  const [loadError, setLoadError] = useState('')
  const [fileIdx, setFileIdx] = useState(0)
  const [page, setPage] = useState(1)
  const [boxes, setBoxes] = useState<Record<string, Box[]>>({})
  const [selected, setSelected] = useState<number | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [mode, setMode] = useState<'saved' | 'draw'>('draw')
  const [drawn, setDrawn] = useState<string | null>(null)
  const [saveAsMine, setSaveAsMine] = useState(true)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [rendering, setRendering] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const padCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const padRef = useRef<SignaturePad | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const keyRef = useRef(1)
  // pdf.js 6: destroy() ada di loading task, bukan di dokumennya.
  const tasksRef = useRef<PDFDocumentLoadingTask[]>([])
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 })

  const file = files[fileIdx]
  const doc = file ? docs[file.id] : undefined
  const numPages = doc?.numPages ?? 0
  const sigImage = mode === 'saved' ? saved : drawn

  // ---- muat tanda tangan tersimpan + seluruh PDF naskah ----
  useEffect(() => {
    let alive = true
    api<{ saved: boolean; image?: string }>('/api/v1/urmin/ttd/me')
      .then(r => { if (alive && r.saved && r.image) { setSaved(r.image); setMode('saved') } })
      .catch(() => { /* tanpa tanda tangan tersimpan tetap bisa coret baru */ })
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const loaded: Record<string, PDFDocumentProxy> = {}
        for (const f of files) {
          const r = await fetch(`${workURL}${encodeURIComponent(workRecordId)}/files/${encodeURIComponent(f.id)}`, { credentials: 'same-origin', cache: 'no-store' })
          if (!r.ok) throw Error(`Naskah ${f.name} tidak dapat diunduh (HTTP ${r.status}).`)
          const task = pdfjs.getDocument({ data: new Uint8Array(await r.arrayBuffer()) })
          tasksRef.current.push(task)
          loaded[f.id] = await task.promise
        }
        if (alive) setDocs(loaded)
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : 'Naskah tidak dapat dimuat.')
      }
    })()
    return () => { alive = false }
  }, [files, workRecordId])

  useEffect(() => () => { tasksRef.current.forEach(t => { void t.destroy() }); tasksRef.current = [] }, [])

  // ---- gambar halaman aktif selebar panggung ----
  useEffect(() => {
    if (!doc || !canvasRef.current || !stageRef.current) return
    let task: RenderTask | null = null
    let cancelled = false
    void (async () => {
      setRendering(true)
      try {
        const pg = await doc.getPage(page)
        // Satu halaman PENUH harus terlihat (lebar dan tinggi), supaya kotak
        // tanda tangan di bagian bawah halaman tidak tersembunyi di luar layar.
        const scroller = stageRef.current?.parentElement
        const availW = Math.max(280, (scroller?.clientWidth ?? 640) - 24)
        const availH = Math.max(360, (scroller?.clientHeight ?? 800) - 16)
        const base = pg.getViewport({ scale: 1 })
        const scale = Math.min(availW / base.width, availH / base.height, 1.6)
        const vp = pg.getViewport({ scale })
        const dpr = window.devicePixelRatio || 1
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = Math.floor(vp.width * dpr)
        canvas.height = Math.floor(vp.height * dpr)
        canvas.style.width = `${vp.width}px`
        canvas.style.height = `${vp.height}px`
        setStageSize({ w: vp.width, h: vp.height })
        task = pg.render({ canvas, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
        await task.promise
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === 'RenderingCancelledException')) setLoadError('Halaman tidak dapat ditampilkan.')
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => { cancelled = true; task?.cancel() }
  }, [doc, page])

  // ---- kanvas coretan ----
  useEffect(() => {
    if (mode !== 'draw' || !padCanvasRef.current) return
    let pad: SignaturePad | null = null
    let alive = true
    void import('signature_pad').then(({ default: Pad }) => {
      const canvas = padCanvasRef.current
      if (!alive || !canvas) return
      const dpr = Math.max(window.devicePixelRatio || 1, 1)
      canvas.width = canvas.offsetWidth * dpr
      canvas.height = canvas.offsetHeight * dpr
      canvas.getContext('2d')?.scale(dpr, dpr)
      pad = new Pad(canvas, { penColor: '#0d2f6e', minWidth: 1.2, maxWidth: 3.2 })
      pad.addEventListener('endStroke', () => setDrawn(trimmedPng(canvas)))
      padRef.current = pad
    })
    return () => { alive = false; pad?.off(); padRef.current = null }
  }, [mode])

  function clearPad() { padRef.current?.clear(); setDrawn(null) }

  // ---- kotak tanda tangan ----
  const pageBoxes = useMemo(() => (file ? (boxes[file.id] ?? []).filter(b => b.page === page) : []), [boxes, file, page])
  const missing = files.filter(f => !(boxes[f.id]?.length))
  const total = Object.values(boxes).reduce((n, l) => n + l.length, 0)

  function addBox() {
    if (!file) return
    const key = keyRef.current++
    const w = 0.28, h = 0.09
    const count = pageBoxes.length
    const b: Box = { key, page, x: clamp(0.62 - count * 0.04, 0, 1 - w), y: clamp(0.76 - count * 0.06, 0, 1 - h), w, h }
    setBoxes(prev => ({ ...prev, [file.id]: [...(prev[file.id] ?? []), b] }))
    setSelected(key)
  }
  function removeBox(key: number) {
    if (!file) return
    setBoxes(prev => ({ ...prev, [file.id]: (prev[file.id] ?? []).filter(b => b.key !== key) }))
    if (selected === key) setSelected(null)
  }
  const updateBox = useCallback((fileId: string, key: number, patch: Partial<Box>) => {
    setBoxes(prev => ({ ...prev, [fileId]: (prev[fileId] ?? []).map(b => (b.key === key ? { ...b, ...patch } : b)) }))
  }, [])

  function startDrag(e: ReactPointerEvent, b: Box, m: 'move' | 'resize') {
    e.preventDefault(); e.stopPropagation()
    setSelected(b.key)
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    dragRef.current = { key: b.key, mode: m, startX: e.clientX, startY: e.clientY, orig: b, width: stageSize.w, height: stageSize.h }
  }
  function onMove(e: ReactPointerEvent) {
    const d = dragRef.current
    if (!d || !file || d.width === 0) return
    const dx = (e.clientX - d.startX) / d.width
    const dy = (e.clientY - d.startY) / d.height
    if (d.mode === 'move') {
      updateBox(file.id, d.key, { x: r5(clamp(d.orig.x + dx, 0, 1 - d.orig.w)), y: r5(clamp(d.orig.y + dy, 0, 1 - d.orig.h)) })
    } else {
      updateBox(file.id, d.key, { w: r5(clamp(d.orig.w + dx, MIN, 1 - d.orig.x)), h: r5(clamp(d.orig.h + dy, MIN, 1 - d.orig.y)) })
    }
  }
  function endDrag() { dragRef.current = null }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // R5H8: preventDefault menandai Esc sudah ditangani, supaya jendela detail
      // di belakangnya (UrminR5D) tidak ikut tertutup oleh tombol yang sama.
      if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose() }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected !== null && !(e.target instanceof HTMLTextAreaElement)) removeBox(selected)
    }
    document.addEventListener('keydown', onKey)
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = before }
  })

  async function submit() {
    if (busy) return
    if (!sigImage) { setError(mode === 'draw' ? 'Coret tanda tangan Anda terlebih dahulu.' : 'Tanda tangan tersimpan belum dimuat.'); return }
    if (missing.length) { setError(`Belum ada tanda tangan pada: ${missing.map(f => f.name).join(', ')}.`); return }
    setBusy(true); setError('')
    try {
      const placements = Object.fromEntries(files.map(f => [f.id, (boxes[f.id] ?? []).map(({ page: p, x, y, w, h }) => ({ page: p, x: r5(x), y: r5(y), w: r5(w), h: r5(h) }))]))
      const body = mode === 'saved'
        ? { version, note: note.trim(), useSaved: true, placements }
        : { version, note: note.trim(), useSaved: false, image: drawn, saveAsMine, placements }
      const r = await api<{ signedFiles: number }>(`/api/v1/urmin/registry/${encodeURIComponent(registerId)}/sign-approve`, 'POST', body)
      onDone(`Surat disetujui; ${r.signedFiles} naskah ditandatangani.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Penandatanganan gagal.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="ttd-r5h7" role="dialog" aria-modal="true" aria-labelledby="ttd-r5h7-title">
    <header className="ttd-r5h7__head">
      <div><span className="ttd-r5h7__eyebrow">TANDA TANGANI & SETUJUI</span><h2 id="ttd-r5h7-title">{title}</h2>
        <p>Tempatkan tanda tangan pada setiap naskah, lalu setujui. Tanda tangan visual — bukan TTE tersertifikasi.</p></div>
      <button type="button" className="ttd-r5h7__close" onClick={onClose} disabled={busy} aria-label="Tutup">×</button>
    </header>

    <div className="ttd-r5h7__body">
      <aside className="ttd-r5h7__files" aria-label="Naskah">
        <strong>Naskah ({files.length})</strong>
        {files.map((f, i) => {
          const n = boxes[f.id]?.length ?? 0
          return <button type="button" key={f.id} className={`ttd-r5h7__file${i === fileIdx ? ' is-on' : ''}`} onClick={() => { setFileIdx(i); setPage(1); setSelected(null) }}>
            <span className={`ttd-r5h7__mark${n ? ' is-done' : ''}`} aria-hidden="true">{n ? '✓' : '!'}</span>
            <span><b title={f.name}>{f.name}</b><small>{n ? `${n} tanda tangan` : 'Belum ditandatangani'}</small></span>
          </button>
        })}
      </aside>

      <section className="ttd-r5h7__viewer" aria-label="Pratinjau naskah">
        <div className="ttd-r5h7__toolbar">
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || !doc}>‹ Sebelumnya</button>
          <span>Halaman {doc ? page : '–'} / {numPages || '–'}</span>
          <button type="button" onClick={() => setPage(p => Math.min(numPages, p + 1))} disabled={!doc || page >= numPages}>Berikutnya ›</button>
          <button type="button" className="ttd-r5h7__add" onClick={addBox} disabled={!doc || !sigImage} title={sigImage ? undefined : 'Siapkan tanda tangan di panel kanan dulu'}>＋ Tambah tanda tangan di halaman ini</button>
        </div>
        <div className="ttd-r5h7__scroll">
          {loadError ? <p className="ttd-r5h7__error" role="alert">{loadError}</p>
            : !doc ? <p className="ttd-r5h7__hint">Memuat naskah…</p>
            : <div ref={stageRef} className="ttd-r5h7__stage" style={{ width: stageSize.w || undefined, height: stageSize.h || undefined }}
                onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag} onPointerDown={() => setSelected(null)}>
                <canvas ref={canvasRef} aria-label={`Halaman ${page} ${file?.name ?? ''}`} />
                {rendering && <span className="ttd-r5h7__rendering">Memuat halaman…</span>}
                {pageBoxes.map(b => <div key={b.key} className={`ttd-r5h7__box${selected === b.key ? ' is-on' : ''}`}
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                  onPointerDown={e => startDrag(e, b, 'move')} role="group" aria-label="Kotak tanda tangan; geser untuk memindahkan">
                  {sigImage && <img src={sigImage} alt="" draggable={false} />}
                  <button type="button" className="ttd-r5h7__del" onPointerDown={e => e.stopPropagation()} onClick={() => removeBox(b.key)} aria-label="Hapus tanda tangan ini">×</button>
                  <span className="ttd-r5h7__grip" onPointerDown={e => startDrag(e, b, 'resize')} aria-hidden="true" />
                </div>)}
              </div>}
        </div>
        <p className="ttd-r5h7__hint">Geser kotak untuk memindahkan, tarik sudut kanan-bawah untuk mengubah ukuran. Satu naskah boleh punya beberapa tanda tangan.</p>
      </section>

      <aside className="ttd-r5h7__panel" aria-label="Tanda tangan">
        <strong>Tanda tangan</strong>
        <div className="ttd-r5h7__tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'saved'} className={mode === 'saved' ? 'is-on' : ''} disabled={!saved} onClick={() => setMode('saved')} title={saved ? undefined : 'Belum ada tanda tangan tersimpan'}>Tersimpan</button>
          <button type="button" role="tab" aria-selected={mode === 'draw'} className={mode === 'draw' ? 'is-on' : ''} onClick={() => setMode('draw')}>Coret baru</button>
        </div>
        {mode === 'saved' ? <div className="ttd-r5h7__saved">{saved ? <img src={saved} alt="Tanda tangan tersimpan" /> : <span>Belum ada.</span>}</div>
          : <>
            <canvas ref={padCanvasRef} className="ttd-r5h7__pad" aria-label="Kanvas tanda tangan" />
            <div className="ttd-r5h7__padrow"><button type="button" onClick={clearPad}>Hapus coretan</button>
              <label><input type="checkbox" checked={saveAsMine} onChange={e => setSaveAsMine(e.target.checked)} /> Simpan sebagai tanda tangan saya</label></div>
          </>}
        <label className="ttd-r5h7__note">Catatan persetujuan <i>(opsional)</i>
          <textarea rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Catatan untuk pembuat surat…" /></label>
        <div className="ttd-r5h7__summary">
          <span>{total} tanda tangan pada {files.length - missing.length}/{files.length} naskah</span>
          {missing.length > 0 && <small>Belum: {missing.map(f => f.name).join(', ')}</small>}
        </div>
        {error && <p className="ttd-r5h7__error" role="alert">{error}</p>}
        <button type="button" className="ttd-r5h7__submit" disabled={busy || !sigImage || missing.length > 0 || !!loadError} onClick={() => void submit()}>{busy ? 'Menandatangani…' : 'Tanda Tangani & Setujui'}</button>
        <button type="button" className="ttd-r5h7__cancel" disabled={busy} onClick={onClose}>Batal</button>
      </aside>
    </div>
  </div>
}
