import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Pager, type PagerState } from './PaginationR5H5'
import { AlasanDialog, ApiError, CariPersonel, LampiranPdf, Shade, StatusPengajuan, TidakTersedia, UUID_RE, makeApi, tgl, waktu, type LampiranItem, type PersonelCari } from './SumdaBersama'
import { showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './SumdaPersonelR5H27.css'
import './SumdaKarierR5H28.css'
import './SumdaLayananR5H30.css'
import './SumdaR5H31.css'

/**
 * R5H31: Subbagsumda — Kinerja & Pembinaan. Backend /api/v1/subbagsumda/kinerja (Express saja, migrasi 072).
 * K1: isi penilaian hanya untuk pencatat, Kasubbagsumda, dan Kabagrenmin (kinerja.read) — server mengirim null
 * untuk pembaca lain; layar ini hanya menampilkan status ringkas bagi mereka.
 */

type Ringkas = 'BELUM_DINILAI' | 'DIAJUKAN' | 'DINILAI'
type Status = 'Draft' | 'Diajukan' | 'Disetujui' | 'Selesai' | 'Dibatalkan'
type Kinerja = {
  id: string; tahun: number; periode: string; statusRingkas: Ringkas; dibatasi: boolean
  kategori: string | null; catatan: string | null; penilai: string | null; tanggalPenilaian: string | null; status: Status | null; version: number | null
  lewatTenggat: boolean | null; createdBy: string | null; createdByName: string | null; updatedBy: string | null; decidedByName: string | null
  personel: { id: string; nrp: string; nama: string; pangkatLabel: string; status: string; terarsip: boolean }
}
type TL = { id: string; bentuk: string; uraian: string; tenggat: string; status: string; hasil: string; lewatTenggat: boolean; updatedByName: string }
type Detail = { item: Kinerja; tindakLanjut: TL[] | null; lampiran: LampiranItem[] | null; riwayat: { dari: string | null; ke: string; catatan: string; oleh: string; pada: string }[] | null }
type Caps = { canRead: boolean; canReadDetail: boolean; canManage: boolean; canApprove: boolean }

export const PERIODE: Record<string, string> = { SEMESTER_I: 'Semester I', SEMESTER_II: 'Semester II', TAHUNAN: 'Tahunan' }
export const KATEGORI: Record<string, string> = { BAIK_SEKALI: 'Baik sekali', BAIK: 'Baik', CUKUP: 'Cukup', PERLU_PEMBINAAN: 'Perlu pembinaan' }
export const RINGKAS: Record<Ringkas, string> = { BELUM_DINILAI: 'Belum dinilai', DIAJUKAN: 'Diajukan', DINILAI: 'Dinilai' }
const BENTUK: Record<string, string> = { KONSELING: 'Konseling', PELATIHAN: 'Pelatihan', PENDAMPINGAN: 'Pendampingan', TEGURAN: 'Teguran', LAINNYA: 'Lainnya' }
const STATUS: Status[] = ['Draft', 'Diajukan', 'Disetujui', 'Selesai', 'Dibatalkan']

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut (isi penilaian hanya untuk pencatat dan pejabat yang berhak).',
  self_review_forbidden: 'Pencatat atau orang yang pernah mengubah isi/tindak lanjut/lampiran penilaian ini tidak boleh memutusnya.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak dapat diproses.',
  version_conflict: 'Data sudah diubah orang lain. Data dimuat ulang; periksa lalu ulangi.',
  status_tidak_sesuai: 'Tindakan ini tidak berlaku untuk status atau kategori penilaian sekarang.',
  penilaian_ganda: 'Personel ini sudah punya penilaian untuk periode tersebut.',
  tindak_lanjut_wajib: 'Kategori Perlu Pembinaan wajib punya rencana tindak lanjut sebelum disetujui.',
  tindak_lanjut_terbuka: 'Masih ada tindak lanjut yang belum selesai (atau belum ada yang selesai).',
  batas_tindak_lanjut: 'Batas 20 tindak lanjut tercapai.',
  personel_tidak_aktif: 'Penilaian hanya untuk personel berstatus Aktif atau MPP.',
  personel_terarsip: 'Personel sudah diarsipkan; penilaian hanya bisa dibatalkan atau tindak lanjutnya ditutup.',
  batas_lampiran: 'Batas 10 lampiran tercapai.',
  file_too_large: 'Berkas lebih dari 5 MB.',
  one_file_required: 'Unggah tepat satu berkas.',
  invalid_file_type: 'Berkas harus PDF yang sah dan tidak terkunci kata sandi (nama berakhiran .pdf).',
  evidence_encryption_unavailable: 'Penyimpanan berkas aman sedang tidak tersedia. Hubungi admin sistem.',
  evidence_integrity_failure: 'Berkas tidak lolos pemeriksaan keutuhan. Hubungi admin sistem.',
  not_found: 'Data tidak ditemukan.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
const api = makeApi(ERRORS, 'Kinerja & Pembinaan tidak tersedia di server saat ini.')
const enc = encodeURIComponent

function Kategori({ k }: { k: string | null }) {
  if (!k) return null
  return <span className={`sdl-r5h31__kat is-${k.toLowerCase()}`}>{KATEGORI[k] ?? k}</span>
}
const periodeTeks = (x: { tahun: number; periode: string }) => `${x.tahun} · ${PERIODE[x.periode] ?? x.periode}`

export default function SumdaKinerjaR5H31({ initialID, userId }: { initialID?: string; userId: string }) {
  const [unavailable, setUnavailable] = useState(false)
  const lost = useCallback(() => setUnavailable(true), [])
  const [caps, setCaps] = useState<Caps | null>(null)
  useEffect(() => { api<Caps>('/kinerja/capabilities').then(setCaps).catch(e => { if (e instanceof TidakTersedia) lost() }) }, [lost])
  const thn = new Date().getFullYear()
  const [q, setQ] = useState(''); const [qLive, setQLive] = useState('')
  const [tahun, setTahun] = useState(String(thn)); const [periode, setPeriode] = useState(''); const [status, setStatus] = useState('')
  const [kategori, setKategori] = useState(''); const [lewat, setLewat] = useState(false)
  const [page, setPage] = useState(1); const [size, setSize] = useState(10)
  const [data, setData] = useState<{ items: Kinerja[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(initialID && UUID_RE.test(initialID) ? initialID : null)
  const [form, setForm] = useState<{ item: Kinerja | null } | null>(null)
  useEffect(() => { const t = setTimeout(() => setQ(qLive.trim()), 300); return () => clearTimeout(t) }, [qLive])
  useEffect(() => { setPage(1) }, [q, tahun, periode, status, kategori, lewat, size])
  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: String(size) })
    if (q) p.set('q', q); if (tahun) p.set('tahun', tahun); if (periode) p.set('periode', periode); if (status) p.set('status', status)
    if (kategori) p.set('kategori', kategori); if (lewat) p.set('lewatTenggat', '1')
    try { setData(await api(`/kinerja?${p}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) lost(); else setError((e as Error).message) }
  }, [q, tahun, periode, status, kategori, lewat, page, size, lost])
  useEffect(() => { void load() }, [load])
  const pager = useMemo(() => ({ total: data?.total ?? 0, size, page, pageCount: Math.max(1, Math.ceil((data?.total ?? 0) / size)), start: (page - 1) * size, setSize, setPage } as PagerState), [data, size, page])
  if (unavailable) return <section className="sdl-sumda"><div className="panel sdl-sumda__notice is-warn" role="alert">
    <strong>Kinerja &amp; Pembinaan tidak tersedia di server saat ini.</strong>
    <p>Layanan ini sedang dialihkan. Data tidak hilang; coba lagi beberapa saat lagi atau hubungi admin sistem.</p></div></section>
  const isi = Boolean(caps?.canReadDetail)
  return <section className="sdl-sumda">
    <p className="sdl-sumda__notice">Versi untuk paparan. Hasil penilaian hanya dapat dibaca pencatat, Kasubbagsumda, dan Kabagrenmin; pengguna lain hanya melihat apakah personel sudah dinilai.</p>
    <div className="sdl-sumda__toolbar">
      <label className="sdl-sumda__search"><span className="sdl-sumda__sr">Cari personel</span>
        <input type="search" value={qLive} maxLength={100} placeholder="Cari nama atau NRP personel…" onChange={e => setQLive(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Tahun</span><select value={tahun} onChange={e => setTahun(e.target.value)}><option value="">Semua tahun</option>{[thn + 1, thn, thn - 1, thn - 2].map(y => <option key={y}>{y}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Periode</span><select value={periode} onChange={e => setPeriode(e.target.value)}><option value="">Semua periode</option>{Object.entries(PERIODE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option>{STATUS.map(s => <option key={s}>{s}</option>)}</select></label>
      {isi && <label><span className="sdl-sumda__sr">Kategori</span><select value={kategori} onChange={e => setKategori(e.target.value)}><option value="">Semua kategori</option>{Object.entries(KATEGORI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
      {isi && <label className="sdl-layanan__cek"><input type="checkbox" checked={lewat} onChange={e => setLewat(e.target.checked)} /> Pembinaan lewat tenggat</label>}
      <span className="sdl-sumda__grow" />
      {caps?.canManage && <button type="button" className="btn primary" onClick={() => setForm({ item: null })}>Catat penilaian</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Personel</th><th>Periode</th><th>Hasil</th><th>Status</th></tr></thead>
        <tbody>
          {data === null ? <tr><td colSpan={4} className="sdl-sumda__muted">Memuat…</td></tr>
            : data.items.length === 0 ? <tr><td colSpan={4} className="sdl-sumda__empty"><strong>Belum ada penilaian yang cocok.</strong></td></tr>
              : data.items.map(x => <tr key={x.id} className="sdl-sumda__click" onClick={() => setOpenId(x.id)}>
                <td><div className="sdl-sumda__who"><strong>{x.personel.nama}</strong><span className="sdl-sumda__mono">{x.personel.nrp}</span></div>{x.personel.terarsip && <span className="sdl-sumda__flag">Personel terarsip</span>}</td>
                <td className="sdl-sumda__mono">{periodeTeks(x)}</td>
                <td>{x.dibatasi ? <span className="sdl-sumda__muted">Dibatasi</span> : <><Kategori k={x.kategori} />{x.lewatTenggat && <small className="sdl-sumda__sub"><span className="sdl-sumda__flag">Lewat tenggat</span></small>}</>}</td>
                <td>{x.dibatasi ? <span className="sdl-r5h31__ringkas">{RINGKAS[x.statusRingkas]}</span> : <StatusPengajuan status={x.status ?? ''} />}</td>
              </tr>)}
        </tbody>
      </table></div>
      <Pager pager={pager} label="penilaian" />
    </div>
    {form && <FormKinerja item={form.item} onClose={() => setForm(null)} onSaved={id => { setForm(null); setOpenId(id); void load() }} />}
    {openId && <DetailKinerja id={openId} caps={caps} userId={userId} onClose={() => setOpenId(null)} onChanged={() => void load()} onLost={lost} onEdit={k => setForm({ item: k })} />}
  </section>
}

function FormKinerja({ item, onClose, onSaved }: { item: Kinerja | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [personel, setPersonel] = useState<PersonelCari | null>(null)
  const [v, setV] = useState({ tahun: String(item?.tahun ?? new Date().getFullYear()), periode: item?.periode ?? 'TAHUNAN', kategori: item?.kategori ?? 'BAIK', penilai: item?.penilai ?? '', tanggalPenilaian: item?.tanggalPenilaian ?? '', catatan: item?.catatan ?? '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    if (!item && !personel) return setError('Pilih personel.')
    setBusy(true); setError('')
    const isi = { tahun: Number(v.tahun), periode: v.periode, kategori: v.kategori, penilai: v.penilai, tanggalPenilaian: v.tanggalPenilaian, catatan: v.catatan }
    try {
      const r = item ? await api<{ item: Kinerja }>(`/kinerja/${enc(item.id)}`, 'PATCH', { ...isi, version: item.version })
        : await api<{ item: Kinerja }>('/kinerja', 'POST', { personelId: personel!.id, ...isi })
      showToast('Penilaian disimpan.'); onSaved(r.item.id)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'penilaian_ganda' && typeof err.data.id === 'string') { showToast(err.message, 'error'); onSaved(err.data.id); return }
      setError((err as Error).message)
    } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label={item ? 'Ubah penilaian' : 'Catat penilaian'} busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">KINERJA &amp; PEMBINAAN</span><h2>{item ? 'Ubah penilaian' : 'Catat penilaian kinerja'}</h2></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label className="sdl-sumda__wide"><span>Personel<b aria-hidden="true"> *</b></span>
          {item ? <input value={`${item.personel.nama} · ${item.personel.nrp}`} disabled /> : personel
            ? <div className="sdl-karier__picked"><span><strong>{personel.nama}</strong> <span className="sdl-sumda__mono">{personel.nrp}</span></span><button type="button" className="btn" onClick={() => setPersonel(null)}>Ganti</button></div>
            : <CariPersonel statusAktif onPilih={setPersonel} />}</label>
        <label><span>Tahun<b aria-hidden="true"> *</b></span><input type="number" min={2000} max={2100} value={v.tahun} onChange={set('tahun')} /></label>
        <label><span>Periode<b aria-hidden="true"> *</b></span><select value={v.periode} onChange={set('periode')}>{Object.entries(PERIODE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span>Kategori hasil<b aria-hidden="true"> *</b></span><select value={v.kategori} onChange={set('kategori')}>{Object.entries(KATEGORI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {v.kategori === 'PERLU_PEMBINAAN' && <small className="sdl-layanan__peringatan">Wajib ada rencana tindak lanjut sebelum disetujui.</small>}</label>
        <label><span>Tanggal penilaian</span><input type="date" min="2000-01-01" max="2100-12-31" value={v.tanggalPenilaian} onChange={set('tanggalPenilaian')} /></label>
        <label className="sdl-sumda__wide"><span>Pejabat penilai</span><input value={v.penilai} maxLength={200} onChange={set('penilai')} /></label>
        <label className="sdl-sumda__wide"><span>Catatan</span><textarea rows={3} maxLength={2000} value={v.catatan} onChange={set('catatan')} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></footer>
    </form>
  </Shade>
}

function DetailKinerja({ id, caps, userId, onClose, onChanged, onLost, onEdit }: { id: string; caps: Caps | null; userId: string; onClose: () => void; onChanged: () => void; onLost: () => void; onEdit: (k: Kinerja) => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<null | 'kembalikan' | 'batalkan' | 'tl' | { tl: TL }>(null)
  const muat = useCallback(async () => {
    try { setD(await api<Detail>(`/kinerja/${enc(id)}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [id, onLost])
  useEffect(() => { void muat() }, [muat])
  if (!d) return <Shade onClose={onClose} label="Detail penilaian"><p className="sdl-sumda__muted">{error || 'Memuat…'}</p><footer><button type="button" className="btn" onClick={onClose}>Tutup</button></footer></Shade>
  const x = d.item
  if (x.dibatasi) return <Shade onClose={onClose} label={`Penilaian ${x.personel.nama}`}>
    <header><span className="sdl-progar__eyebrow">KINERJA &amp; PEMBINAAN</span><h2>{x.personel.nama}</h2><p>{periodeTeks(x)} · <span className="sdl-r5h31__ringkas">{RINGKAS[x.statusRingkas]}</span></p></header>
    <p className="sdl-sumda__notice">Isi penilaian hanya dapat dibaca pencatat, Kasubbagsumda, dan Kabagrenmin.</p>
    <footer><span className="sdl-sumda__grow" /><button type="button" className="btn" onClick={onClose}>Tutup</button></footer>
  </Shade>
  const kirim = async (aksi: string, extra: Record<string, unknown> = {}, pesan = 'Status diperbarui.') => {
    setBusy(true)
    try { await api(`/kinerja/${enc(x.id)}/aksi`, 'POST', { aksi, catatan: '', version: x.version, ...extra }); showToast(pesan); onChanged(); setDialog(null) }
    catch (e) { showToast((e as Error).message, 'error') } finally { setBusy(false); void muat() }
  }
  const pengelola = Boolean(caps?.canManage) && (x.createdBy === userId || Boolean(caps?.canReadDetail))
  const pemutus = Boolean(caps?.canApprove && caps.canReadDetail) && x.createdBy !== userId
  const pp = x.kategori === 'PERLU_PEMBINAAN'
  const terbuka = ['Draft', 'Diajukan', 'Disetujui'].includes(x.status ?? '')
  const tl = d.tindakLanjut ?? []
  return <Shade onClose={onClose} label={`Penilaian ${x.personel.nama}`} busy={busy}>
    <header><span className="sdl-progar__eyebrow">KINERJA &amp; PEMBINAAN</span><h2>{x.personel.nama}</h2>
      <p><StatusPengajuan status={x.status ?? ''} /> {periodeTeks(x)} · <Kategori k={x.kategori} /></p></header>
    {x.personel.terarsip && <p className="sdl-sumda__notice is-warn">Personel sudah diarsipkan; penilaian hanya bisa dibatalkan atau tindak lanjutnya ditutup.</p>}
    <dl className="sdl-sumda__detail">
      <div><dt>Pejabat penilai</dt><dd>{x.penilai || '—'}</dd></div>
      <div><dt>Tanggal penilaian</dt><dd className="sdl-sumda__mono">{x.tanggalPenilaian ? tgl(x.tanggalPenilaian) : '—'}</dd></div>
      <div><dt>Dicatat oleh</dt><dd>{x.createdByName || '—'}</dd></div>
      {x.decidedByName && <div><dt>Diputus oleh</dt><dd>{x.decidedByName}</dd></div>}
    </dl>
    {x.catatan && <div className="sdl-sumda__catatan"><strong>Catatan</strong><p>{x.catatan}</p></div>}
    {pp && <section className="sdl-sumda__riwayat" aria-label="Tindak lanjut pembinaan">
      <strong>Tindak lanjut pembinaan ({tl.length})</strong>
      {tl.length === 0 ? <p className="sdl-sumda__muted">Belum ada rencana tindak lanjut.</p>
        : <ol>{tl.map(t => <li key={t.id}><span className="sdl-sumda__mono">{tgl(t.tenggat)}</span>
          <span>{BENTUK[t.bentuk] ?? t.bentuk} · {t.uraian}{t.hasil && ` — ${t.hasil}`}{t.lewatTenggat && <> <span className="sdl-sumda__flag">Lewat tenggat</span></>}</span>
          <span>{pengelola && terbuka && ['Rencana', 'Berjalan'].includes(t.status) ? <button type="button" className="sdl-sumda__link" onClick={() => setDialog({ tl: t })}>{t.status} · ubah</button> : <span className="sdl-sumda__muted">{t.status}</span>}</span></li>)}</ol>}
      {pengelola && terbuka && !x.personel.terarsip && tl.length < 20 && <button type="button" className="btn" onClick={() => setDialog('tl')}>Tambah tindak lanjut</button>}
    </section>}
    {d.lampiran && <LampiranPdf judul="Lampiran (SKP / berita acara)" items={d.lampiran} urlUnduh={l => `/api/v1/subbagsumda/kinerja/${enc(x.id)}/lampiran/${enc(l.id)}`}
      unggah={async fd => { await api(`/kinerja/${enc(x.id)}/lampiran`, 'POST', fd); void muat() }} hapus={async l => { await api(`/kinerja/${enc(x.id)}/lampiran/${enc(l.id)}`, 'DELETE'); void muat() }}
      bisaUnggah={pengelola && terbuka && !x.personel.terarsip} bisaHapus={l => pengelola && terbuka && (l.uploadedBy === userId || Boolean(caps?.canApprove))} />}
    <section className="sdl-sumda__riwayat" aria-label="Riwayat status">
      <strong>Riwayat status</strong>
      <ol>{(d.riwayat ?? []).map((h, i) => <li key={i}><span className="sdl-sumda__mono">{waktu(h.pada)}</span><span>{h.dari ? `${h.dari} → ${h.ke}` : h.ke}{h.catatan && ` — ${h.catatan}`}</span><span className="sdl-sumda__muted">{h.oleh}</span></li>)}</ol>
    </section>
    <footer>
      {((pengelola && x.createdBy === userId) || caps?.canApprove) && ['Draft', 'Diajukan'].includes(x.status ?? '') && <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setDialog('batalkan')}>Batalkan</button>}
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={onClose}>Tutup</button>
      {pengelola && x.status === 'Draft' && !x.personel.terarsip && <button type="button" className="btn" onClick={() => { onClose(); onEdit(x) }}>Ubah</button>}
      {pengelola && x.status === 'Draft' && !x.personel.terarsip && <button type="button" className="btn primary" disabled={busy} onClick={() => void kirim('ajukan', {}, 'Penilaian diajukan.')}>Ajukan</button>}
      {pemutus && x.status === 'Diajukan' && !x.personel.terarsip && <>
        <button type="button" className="btn" disabled={busy} onClick={() => setDialog('kembalikan')}>Kembalikan</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void kirim('setujui', {}, 'Penilaian disetujui.')}>Setujui</button></>}
      {pengelola && x.status === 'Disetujui' && <button type="button" className="btn primary" disabled={busy} onClick={() => void kirim('selesai', {}, 'Pembinaan selesai.')}>Tandai selesai</button>}
    </footer>
    {dialog === 'kembalikan' && <AlasanDialog judul="Kembalikan ke Draft" onClose={() => setDialog(null)} onSubmit={a => kirim('kembalikan', { catatan: a }, 'Penilaian dikembalikan.')} />}
    {dialog === 'batalkan' && <AlasanDialog judul="Batalkan penilaian" onClose={() => setDialog(null)} onSubmit={a => kirim('batalkan', { catatan: a }, 'Penilaian dibatalkan.')} />}
    {dialog === 'tl' && <FormTL x={x} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged(); void muat() }} />}
    {dialog && typeof dialog === 'object' && <FormTL x={x} tl={dialog.tl} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged(); void muat() }} />}
  </Shade>
}

function FormTL({ x, tl, onClose, onSaved }: { x: Kinerja; tl?: TL; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ bentuk: tl?.bentuk ?? 'KONSELING', uraian: tl?.uraian ?? '', tenggat: tl?.tenggat ?? '', status: tl?.status ?? 'Rencana', hasil: tl?.hasil ?? '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    if (!v.tenggat) return setError('Tenggat wajib diisi.')
    if (v.status === 'Selesai' && v.hasil.trim().length < 3) return setError('Isi hasil pembinaan (min. 3 karakter).')
    setBusy(true); setError('')
    try {
      if (tl) await api(`/kinerja/${enc(x.id)}/tindak-lanjut/${enc(tl.id)}`, 'PATCH', { ...v, version: x.version })
      else await api(`/kinerja/${enc(x.id)}/tindak-lanjut`, 'POST', { bentuk: v.bentuk, uraian: v.uraian, tenggat: v.tenggat, version: x.version })
      showToast('Tindak lanjut disimpan.'); onSaved()
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label="Tindak lanjut pembinaan" busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">KINERJA &amp; PEMBINAAN</span><h2>{tl ? 'Ubah tindak lanjut' : 'Tambah tindak lanjut'}</h2></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label><span>Bentuk<b aria-hidden="true"> *</b></span><select value={v.bentuk} onChange={set('bentuk')}>{Object.entries(BENTUK).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span>Tenggat<b aria-hidden="true"> *</b></span><input type="date" min="2000-01-01" max="2100-12-31" value={v.tenggat} onChange={set('tenggat')} /></label>
        <label className="sdl-sumda__wide"><span>Uraian<b aria-hidden="true"> *</b></span><textarea rows={2} maxLength={1000} value={v.uraian} onChange={set('uraian')} /></label>
        {tl && <label><span>Status</span><select value={v.status} onChange={set('status')}>{['Rencana', 'Berjalan', 'Selesai', 'Dibatalkan'].map(s => <option key={s}>{s}</option>)}</select></label>}
        {tl && <label className="sdl-sumda__wide"><span>Hasil{v.status === 'Selesai' && <b aria-hidden="true"> *</b>}</span><textarea rows={2} maxLength={1000} value={v.hasil} onChange={set('hasil')} /></label>}
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>Simpan</button></footer>
    </form>
  </Shade>
}
