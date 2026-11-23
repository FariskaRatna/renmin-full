import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Pager, type PagerState } from './PaginationR5H5'
import { ApiError, LampiranPdf, Shade, TidakTersedia, UUID_RE, makeApi, tgl, waktu } from './SumdaBersama'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './SumdaPersonelR5H27.css'
import './SumdaKarierR5H28.css'
import './SumdaDiklatR5H29.css'

/**
 * R5H29: Subbagsumda — Diklat & Kompetensi (menggantikan menu "Pendidikan & Pengembangan SDM").
 * Tab Kegiatan: kegiatan diklat, peserta dari Master Personel, hasil saat Selesai, lampiran PDF.
 * Tab Kompetensi: sertifikat/kompetensi per personel + alert H-60/H-30/Kedaluwarsa (dihitung server, WIB).
 * Backend: /api/v1/subbagsumda/{diklat,kompetensi} (Express saja, migrasi 070). Tanpa persetujuan (K3).
 */

type StatusK = 'Terjadwal' | 'Berjalan' | 'Selesai' | 'Dibatalkan'
type Hasil = 'Belum' | 'Lulus' | 'Tidak lulus' | 'Tidak hadir'
type Tahap = 'H-60' | 'H-30' | 'KEDALUWARSA'
type Lampiran = { id: string; filename: string; size: number; uploadedBy: string; uploadedByName: string; uploadedAt: string }
type Kegiatan = { id: string; nama: string; jenis: string; penyelenggara: string; lokasi: string; nomorSurat: string; tanggalMulai: string; tanggalSelesai: string; status: StatusK; catatan: string; version: number; salinan: boolean; jumlahPeserta: number; createdByName: string }
type Peserta = { id: string; personelId: string; nrp: string; nama: string; personelStatus: string; terarsip: boolean; pangkatLabel: string; unitKerja: string; hasil: Hasil; nomorSertifikat: string; keterangan: string; version: number; kompetensiId: string | null; lampiran: Lampiran[] }
type DetailK = { item: Kegiatan; peserta: Peserta[]; lampiran: Lampiran[]; riwayat: { dari: string | null; ke: string; catatan: string; oleh: string; pada: string }[] }
type Kompetensi = { id: string; personelId: string; nama: string; kategori: string; nomor: string; penerbit: string; tanggalTerbit: string; berlakuSampai: string; catatan: string; version: number; dariPesertaId: string | null; dariDiklat: { id: string; nama: string } | null; personel: { id: string; nrp: string; nama: string; status: string; terarsip: boolean }; sisaHari: number | null; tahap: Tahap | null }
type Caps = { canRead: boolean; canManage: boolean; canArchive: boolean }
type PersonelCari = { id: string; nrp: string; nama: string; status: string }

const JENIS = ['Pendidikan', 'Pelatihan', 'Kursus', 'Seminar/Lokakarya', 'Sertifikasi', 'Lainnya']
const STATUS: StatusK[] = ['Terjadwal', 'Berjalan', 'Selesai', 'Dibatalkan']
const HASIL: Hasil[] = ['Belum', 'Lulus', 'Tidak lulus', 'Tidak hadir']
const KATEGORI = ['Sertifikasi profesi', 'Kursus', 'Lisensi', 'Keahlian', 'Lainnya']
const TAHAP: { key: Tahap; label: string }[] = [{ key: 'H-60', label: 'H-60 · 2 bulan' }, { key: 'H-30', label: 'H-30 · 1 bulan' }, { key: 'KEDALUWARSA', label: 'Kedaluwarsa' }]

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak dapat diproses.',
  version_conflict: 'Data sudah diubah orang lain. Data dimuat ulang; periksa lalu ulangi.',
  status_tidak_sesuai: 'Status sudah berubah; tindakan ini tidak berlaku lagi.',
  peserta_ganda: 'Sebagian personel sudah menjadi peserta kegiatan ini.',
  batas_peserta: 'Batas 200 peserta per kegiatan tercapai.',
  personel_tidak_aktif: 'Peserta hanya personel berstatus Aktif atau MPP.',
  personel_terarsip: 'Personel sudah diarsipkan; datanya tidak bisa diubah lagi.',
  hasil_belum_boleh: 'Hasil peserta baru bisa diisi setelah kegiatan Selesai.',
  kompetensi_ganda: 'Peserta ini sudah punya kompetensi aktif dari kegiatan ini.',
  kompetensi_terkait: 'Hasil Lulus tidak bisa diubah karena sudah dijadikan kompetensi. Arsipkan kompetensinya dulu.',
  batas_lampiran: 'Batas 10 lampiran tercapai.',
  file_too_large: 'Berkas lebih dari 5 MB.',
  one_file_required: 'Unggah tepat satu berkas.',
  invalid_file_type: 'Berkas harus PDF yang sah (nama berakhiran .pdf).',
  evidence_encryption_unavailable: 'Penyimpanan berkas aman sedang tidak tersedia. Hubungi admin sistem.',
  evidence_integrity_failure: 'Berkas tidak lolos pemeriksaan keutuhan. Hubungi admin sistem.',
  not_found: 'Data tidak ditemukan.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
const api = makeApi(ERRORS, 'Diklat & Kompetensi tidak tersedia di server saat ini.')
const enc = encodeURIComponent

function Badge({ status }: { status: StatusK }) { return <span className={`sdl-diklat__status is-${status.toLowerCase()}`}>{status}</span> }
function TahapBadge({ tahap }: { tahap: Tahap | null }) {
  if (!tahap) return null
  return <span className={`sdl-sumda__tahap ${tahap === 'KEDALUWARSA' ? 'is-due' : tahap === 'H-30' ? 'is-h-7' : 'is-h-30'}`}>{tahap === 'KEDALUWARSA' ? 'Kedaluwarsa' : tahap}</span>
}
function sisaTeks(n: number | null) { return n === null ? '' : n > 0 ? `${n} hari lagi` : n === 0 ? 'Hari ini' : `Lewat ${-n} hari` }

function useCaps(path: string, onLost: () => void) {
  const [caps, setCaps] = useState<Caps | null>(null)
  useEffect(() => { api<Caps>(path).then(setCaps).catch(e => { if (e instanceof TidakTersedia) onLost() }) }, [path, onLost])
  return caps
}
function usePager(total: number, size: number, page: number, setSize: (n: number) => void, setPage: (n: number) => void): PagerState {
  return useMemo(() => ({ total, size, page, pageCount: Math.max(1, Math.ceil(total / size)), start: (page - 1) * size, setSize, setPage } as PagerState), [total, size, page, setSize, setPage])
}

/** Pencarian personel (nama/NRP) untuk peserta atau pemegang kompetensi. */
function CariPersonel({ onPilih, statusAktif, multi = false, terpilih = [] }: { onPilih: (p: PersonelCari) => void; statusAktif: boolean; multi?: boolean; terpilih?: string[] }) {
  const [cari, setCari] = useState('')
  const [hasil, setHasil] = useState<PersonelCari[]>([])
  useEffect(() => {
    const t = setTimeout(() => {
      const term = cari.trim()
      if (term.length < 2) { setHasil([]); return }
      const daftar = statusAktif ? ['Aktif', 'MPP'] : ['']
      Promise.all(daftar.map(st => api<{ items: PersonelCari[] }>(`/personel?${new URLSearchParams({ q: term, size: '10', ...(st ? { status: st } : {}) })}`)))
        .then(r => setHasil(r.flatMap(x => x.items).slice(0, 10))).catch(() => setHasil([]))
    }, 300)
    return () => clearTimeout(t)
  }, [cari, statusAktif])
  return <>
    <input type="search" value={cari} placeholder="Ketik nama atau NRP (min. 2 huruf)…" onChange={e => setCari(e.target.value)} />
    {hasil.length > 0 && <ul className="sdl-karier__hasil" role="listbox" aria-label="Hasil pencarian personel">{hasil.map(p => {
      const sudah = terpilih.includes(p.id)
      return <li key={p.id}><button type="button" role="option" aria-selected={sudah} disabled={sudah} onClick={() => { onPilih(p); if (!multi) setHasil([]) }}>
        <strong>{p.nama}</strong> <span className="sdl-sumda__mono">{p.nrp}</span><small>{sudah ? 'dipilih' : p.status}</small></button></li>
    })}</ul>}
  </>
}

export default function SumdaDiklatR5H29({ tab, onTab, initialID, userId, legacy }: { tab?: string; onTab: (t: 'kegiatan' | 'kompetensi') => void; initialID?: string; userId: string; legacy?: ReactNode }) {
  const [unavailable, setUnavailable] = useState(false)
  const [showLegacy, setShowLegacy] = useState(false)
  const lost = useCallback(() => setUnavailable(true), [])
  if (unavailable) return <section className="sdl-sumda"><div className="panel sdl-sumda__notice is-warn" role="alert">
    <strong>Diklat &amp; Kompetensi tidak tersedia di server saat ini.</strong>
    <p>Layanan ini sedang dialihkan. Data tidak hilang; coba lagi beberapa saat lagi atau hubungi admin sistem.</p>
    {legacy && <button type="button" className="btn" onClick={() => setShowLegacy(v => !v)}>{showLegacy ? 'Sembunyikan' : 'Buka'} data registry pendidikan lama (darurat)</button>}
  </div>{showLegacy && legacy}</section>
  const aktif = tab === 'kompetensi' ? 'kompetensi' : 'kegiatan'
  return <section className="sdl-sumda">
    <nav className="sdl-sumda__tabs" aria-label="Bagian Diklat & Kompetensi">
      <button type="button" className={aktif === 'kegiatan' ? 'is-on' : ''} aria-pressed={aktif === 'kegiatan'} onClick={() => onTab('kegiatan')}>Kegiatan diklat</button>
      <button type="button" className={aktif === 'kompetensi' ? 'is-on' : ''} aria-pressed={aktif === 'kompetensi'} onClick={() => onTab('kompetensi')}>Kompetensi</button>
    </nav>
    {aktif === 'kegiatan' ? <KegiatanView initialID={initialID} userId={userId} onLost={lost} onKompetensi={() => onTab('kompetensi')} />
      : <KompetensiView initialID={initialID} userId={userId} onLost={lost} />}
  </section>
}

/* ------------------------------------------------------------- Kegiatan */

function KegiatanView({ initialID, userId, onLost, onKompetensi }: { initialID?: string; userId: string; onLost: () => void; onKompetensi: () => void }) {
  const caps = useCaps('/diklat/capabilities', onLost)
  const [q, setQ] = useState(''); const [qLive, setQLive] = useState('')
  const [status, setStatus] = useState(''); const [jenis, setJenis] = useState(''); const [tahun, setTahun] = useState('')
  const [page, setPage] = useState(1); const [size, setSize] = useState(10)
  const [data, setData] = useState<{ items: Kegiatan[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<{ item: Kegiatan | null } | null>(null)
  useEffect(() => { const t = setTimeout(() => setQ(qLive.trim()), 300); return () => clearTimeout(t) }, [qLive])
  useEffect(() => { setPage(1) }, [q, status, jenis, tahun, size])
  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: String(size) })
    if (q) p.set('q', q); if (status) p.set('status', status); if (jenis) p.set('jenis', jenis); if (tahun) p.set('tahun', tahun)
    try { setData(await api(`/diklat?${p}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [q, status, jenis, tahun, page, size, onLost])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (initialID && UUID_RE.test(initialID)) setOpenId(initialID) }, [initialID])
  const pager = usePager(data?.total ?? 0, size, page, setSize, setPage)
  const thn = new Date().getFullYear()
  return <>
    <div className="sdl-sumda__toolbar">
      <label className="sdl-sumda__search"><span className="sdl-sumda__sr">Cari kegiatan</span>
        <input type="search" value={qLive} maxLength={100} placeholder="Cari nama kegiatan, penyelenggara, nomor surat…" onChange={e => setQLive(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Tahun</span><select value={tahun} onChange={e => setTahun(e.target.value)}><option value="">Semua tahun</option>{[thn + 1, thn, thn - 1, thn - 2, thn - 3].map(y => <option key={y}>{y}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Jenis</span><select value={jenis} onChange={e => setJenis(e.target.value)}><option value="">Semua jenis</option>{JENIS.map(j => <option key={j}>{j}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option>{STATUS.map(s => <option key={s}>{s}</option>)}</select></label>
      <span className="sdl-sumda__grow" />
      {caps?.canManage && <button type="button" className="btn primary" onClick={() => setForm({ item: null })}>Tambah kegiatan</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Kegiatan</th><th>Jenis</th><th className="is-num">Tanggal</th><th className="is-num">Peserta</th><th>Status</th></tr></thead>
        <tbody>
          {data === null ? <tr><td colSpan={5} className="sdl-sumda__muted">Memuat…</td></tr>
            : data.items.length === 0 ? <tr><td colSpan={5} className="sdl-sumda__empty"><strong>Belum ada kegiatan yang cocok.</strong></td></tr>
              : data.items.map(k => <tr key={k.id} className="sdl-sumda__click" onClick={() => setOpenId(k.id)}>
                <td><div className="sdl-sumda__who"><strong>{k.nama}</strong><span>{k.penyelenggara || '—'}{k.lokasi ? ` · ${k.lokasi}` : ''}</span></div>{k.salinan && <span className="sdl-sumda__flag">Salinan registry lama</span>}</td>
                <td>{k.jenis}</td>
                <td className="is-num sdl-sumda__mono">{k.tanggalMulai ? tgl(k.tanggalMulai) : '—'}{k.tanggalSelesai && <small>s.d. {tgl(k.tanggalSelesai)}</small>}</td>
                <td className="is-num sdl-sumda__mono">{k.jumlahPeserta}</td>
                <td><Badge status={k.status} /></td>
              </tr>)}
        </tbody>
      </table></div>
      <Pager pager={pager} label="kegiatan" />
    </div>
    {form && <FormKegiatan item={form.item} onClose={() => setForm(null)} onSaved={k => { setForm(null); showToast('Kegiatan disimpan.'); setOpenId(k.id); void load() }} />}
    {openId && <DetailKegiatan id={openId} caps={caps} userId={userId} onClose={() => setOpenId(null)} onChanged={() => void load()} onEdit={k => { setOpenId(null); setForm({ item: k }) }} onLost={onLost} onKompetensi={onKompetensi} />}
  </>
}

function FormKegiatan({ item, onClose, onSaved }: { item: Kegiatan | null; onClose: () => void; onSaved: (k: Kegiatan) => void }) {
  const final = item ? !['Terjadwal', 'Berjalan'].includes(item.status) : false
  const [v, setV] = useState({ nama: item?.nama ?? '', jenis: item?.jenis ?? 'Pelatihan', penyelenggara: item?.penyelenggara ?? '', lokasi: item?.lokasi ?? '', nomorSurat: item?.nomorSurat ?? '', tanggalMulai: item?.tanggalMulai ?? '', tanggalSelesai: item?.tanggalSelesai ?? '', catatan: item?.catatan ?? '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    if (v.nama.trim().length < 3) return setError('Nama kegiatan wajib diisi (minimal 3 karakter).')
    if (!v.tanggalMulai && !item?.salinan) return setError('Tanggal mulai wajib diisi.')
    setBusy(true); setError('')
    try {
      const r = item ? await api<{ item: Kegiatan }>(`/diklat/${enc(item.id)}`, 'PATCH', { ...v, version: item.version }) : await api<{ item: Kegiatan }>('/diklat', 'POST', v)
      onSaved(r.item)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label={item ? 'Ubah kegiatan' : 'Tambah kegiatan'} busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">DIKLAT &amp; KOMPETENSI</span><h2>{item ? 'Ubah kegiatan' : 'Tambah kegiatan diklat'}</h2>
        {final && <p>Kegiatan sudah {item!.status.toLowerCase()}; hanya catatan yang bisa diubah.</p>}</header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label className="sdl-sumda__wide"><span>Nama kegiatan<b aria-hidden="true"> *</b></span><input value={v.nama} maxLength={200} disabled={final} autoFocus onChange={set('nama')} /></label>
        <label><span>Jenis<b aria-hidden="true"> *</b></span><select value={v.jenis} disabled={final} onChange={set('jenis')}>{JENIS.map(j => <option key={j}>{j}</option>)}</select></label>
        <label><span>No. surat perintah</span><input value={v.nomorSurat} maxLength={100} disabled={final} onChange={set('nomorSurat')} /></label>
        <label><span>Penyelenggara</span><input value={v.penyelenggara} maxLength={200} disabled={final} onChange={set('penyelenggara')} /></label>
        <label><span>Lokasi</span><input value={v.lokasi} maxLength={200} disabled={final} onChange={set('lokasi')} /></label>
        <label><span>Tanggal mulai<b aria-hidden="true"> *</b></span><input type="date" min="2000-01-01" max="2100-12-31" value={v.tanggalMulai} disabled={final} onChange={set('tanggalMulai')} /></label>
        <label><span>Tanggal selesai</span><input type="date" min="2000-01-01" max="2100-12-31" value={v.tanggalSelesai} disabled={final} onChange={set('tanggalSelesai')} /><small>Wajib saat menandai Selesai.</small></label>
        <label className="sdl-sumda__wide"><span>Catatan</span><textarea rows={3} maxLength={2000} value={v.catatan} onChange={set('catatan')} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></footer>
    </form>
  </Shade>
}

function DetailKegiatan({ id, caps, userId, onClose, onChanged, onEdit, onLost, onKompetensi }: { id: string; caps: Caps | null; userId: string; onClose: () => void; onChanged: () => void; onEdit: (k: Kegiatan) => void; onLost: () => void; onKompetensi: () => void }) {
  const [d, setD] = useState<DetailK | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<null | { jenis: 'selesai' | 'batal' } | { jenis: 'hasil' | 'kompetensi'; p: Peserta } | { jenis: 'peserta' }>(null)
  const muat = useCallback(async () => {
    try { setD(await api<DetailK>(`/diklat/${enc(id)}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [id, onLost])
  useEffect(() => { void muat() }, [muat])
  if (!d) return <Shade onClose={onClose} label="Detail kegiatan"><p className="sdl-sumda__muted">{error || 'Memuat…'}</p><footer><button type="button" className="btn" onClick={onClose}>Tutup</button></footer></Shade>
  const k = d.item
  const berjalan = k.status === 'Terjadwal' || k.status === 'Berjalan'
  const ubahStatus = async (ke: StatusK, extra: Record<string, string> = {}) => {
    setBusy(true)
    try { await api(`/diklat/${enc(k.id)}/status`, 'POST', { status: ke, catatan: '', version: k.version, ...extra }); showToast(`Kegiatan ${ke.toLowerCase()}.`); onChanged() }
    catch (e) { showToast((e as Error).message, 'error') } finally { setBusy(false); void muat() }
  }
  const arsip = async () => {
    if (!(await confirmDialog(`Arsipkan kegiatan ${k.nama}? Kegiatan tidak tampil lagi; kompetensi turunannya tetap.`, { confirmLabel: 'Arsipkan', danger: true }))) return
    try { await api(`/diklat/${enc(k.id)}?version=${k.version}`, 'DELETE'); showToast('Kegiatan diarsipkan.'); onChanged(); onClose() } catch (e) { showToast((e as Error).message, 'error') }
  }
  const hapusPeserta = async (p: Peserta) => {
    if (!(await confirmDialog(`Keluarkan ${p.nama} dari peserta?`, { confirmLabel: 'Keluarkan', danger: true }))) return
    try { await api(`/diklat/${enc(k.id)}/peserta/${enc(p.id)}?version=${p.version}`, 'DELETE'); showToast('Peserta dikeluarkan.'); onChanged() } catch (e) { showToast((e as Error).message, 'error') }
    void muat()
  }
  const bisaHapus = (l: Lampiran) => Boolean(caps?.canManage && (l.uploadedBy === userId || caps.canArchive))
  return <Shade onClose={onClose} label={`Kegiatan ${k.nama}`} busy={busy}>
    <header><span className="sdl-progar__eyebrow">DIKLAT &amp; KOMPETENSI</span><h2>{k.nama}</h2>
      <p><Badge status={k.status} /> {k.jenis}{k.nomorSurat && <> · <span className="sdl-sumda__mono">{k.nomorSurat}</span></>}</p></header>
    {k.salinan && <p className="sdl-sumda__notice">Disalin dari registry pendidikan lama. Peserta lama ada di catatan; tambahkan peserta dari Master Personel bila perlu.</p>}
    <dl className="sdl-sumda__detail">
      <div><dt>Tanggal</dt><dd className="sdl-sumda__mono">{k.tanggalMulai ? tgl(k.tanggalMulai) : '—'}{k.tanggalSelesai ? ` s.d. ${tgl(k.tanggalSelesai)}` : ''}</dd></div>
      <div><dt>Penyelenggara / lokasi</dt><dd>{k.penyelenggara || '—'}{k.lokasi ? ` · ${k.lokasi}` : ''}</dd></div>
    </dl>
    {k.catatan && <div className="sdl-sumda__catatan"><strong>Catatan</strong><p>{k.catatan}</p></div>}

    <section className="sdl-sumda__riwayat" aria-label="Peserta">
      <strong>Peserta ({d.peserta.length}/200)</strong>
      {d.peserta.length === 0 ? <p className="sdl-sumda__muted">Belum ada peserta.</p>
        : <div className="table-scroll"><table className="data-table sdl-sumda__table sdl-diklat__peserta">
          <thead><tr><th>Personel</th><th>Hasil</th><th>Sertifikat</th><th><span className="sdl-sumda__sr">Aksi</span></th></tr></thead>
          <tbody>{d.peserta.map(p => <tr key={p.id}>
            <td><div className="sdl-sumda__who"><strong>{p.nama}</strong><span className="sdl-sumda__mono">{p.nrp}</span></div>{p.terarsip && <span className="sdl-sumda__flag">Personel terarsip</span>}</td>
            <td><span className={`sdl-diklat__hasil is-${p.hasil.replace(' ', '-').toLowerCase()}`}>{p.hasil}</span>{p.kompetensiId && <small className="sdl-sumda__sub">Sudah jadi kompetensi</small>}</td>
            <td><span className="sdl-sumda__mono">{p.nomorSertifikat || '—'}</span>{p.lampiran.length > 0 && <small className="sdl-sumda__sub">{p.lampiran.length} PDF</small>}</td>
            <td className="sdl-sumda__actions">
              {caps?.canManage && k.status === 'Selesai' && !p.terarsip && <button type="button" className="btn" onClick={() => setDialog({ jenis: 'hasil', p })}>Hasil</button>}
              {caps?.canManage && k.status === 'Selesai' && p.hasil === 'Lulus' && !p.kompetensiId && !p.terarsip && <button type="button" className="btn" onClick={() => setDialog({ jenis: 'kompetensi', p })}>Jadikan kompetensi</button>}
              {caps?.canManage && berjalan && !p.terarsip && <button type="button" className="btn sdl-progar__danger" onClick={() => void hapusPeserta(p)}>Keluarkan</button>}
            </td>
          </tr>)}</tbody>
        </table></div>}
      {caps?.canManage && berjalan && d.peserta.length < 200 && <button type="button" className="btn" onClick={() => setDialog({ jenis: 'peserta' })}>Tambah peserta</button>}
    </section>

    <LampiranPdf judul="Lampiran kegiatan (surat perintah, jadwal)" items={d.lampiran} urlUnduh={l => `/api/v1/subbagsumda/diklat/${enc(k.id)}/lampiran/${enc(l.id)}`}
      unggah={async fd => { await api(`/diklat/${enc(k.id)}/lampiran`, 'POST', fd); void muat() }} hapus={async l => { await api(`/diklat/${enc(k.id)}/lampiran/${enc(l.id)}`, 'DELETE'); void muat() }}
      bisaUnggah={Boolean(caps?.canManage) && k.status !== 'Dibatalkan'} bisaHapus={l => bisaHapus(l as Lampiran) && k.status !== 'Dibatalkan'} />

    <section className="sdl-sumda__riwayat" aria-label="Riwayat status">
      <strong>Riwayat status</strong>
      <ol>{d.riwayat.map((h, i) => <li key={i}><span className="sdl-sumda__mono">{waktu(h.pada)}</span><span>{h.dari ? `${h.dari} → ${h.ke}` : h.ke}{h.catatan && ` — ${h.catatan}`}</span><span className="sdl-sumda__muted">{h.oleh}</span></li>)}</ol>
    </section>

    <footer>
      {caps?.canArchive && <button type="button" className="btn sdl-progar__danger" onClick={() => void arsip()}>Arsipkan</button>}
      {caps?.canManage && berjalan && <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setDialog({ jenis: 'batal' })}>Batalkan</button>}
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={onClose}>Tutup</button>
      {caps?.canManage && <button type="button" className="btn" onClick={() => onEdit(k)}>Ubah</button>}
      {caps?.canManage && k.status === 'Terjadwal' && <button type="button" className="btn primary" disabled={busy} onClick={() => void ubahStatus('Berjalan')}>Mulai</button>}
      {caps?.canManage && k.status === 'Berjalan' && <button type="button" className="btn primary" disabled={busy} onClick={() => setDialog({ jenis: 'selesai' })}>Tandai selesai…</button>}
    </footer>

    {dialog?.jenis === 'peserta' && <TambahPeserta k={k} terpilih={d.peserta.map(p => p.personelId)} onClose={() => setDialog(null)} onDone={() => { setDialog(null); onChanged(); void muat() }} />}
    {dialog?.jenis === 'selesai' && <SatuIsian judul="Tandai selesai" label="Tanggal selesai" tipe="date" awal={k.tanggalSelesai} wajib onClose={() => setDialog(null)} onSubmit={async v => { setDialog(null); await ubahStatus('Selesai', { tanggalSelesai: v }) }} />}
    {dialog?.jenis === 'batal' && <SatuIsian judul="Batalkan kegiatan" label="Alasan (min. 8 karakter)" tipe="textarea" min={8} wajib onClose={() => setDialog(null)} onSubmit={async v => { setDialog(null); await ubahStatus('Dibatalkan', { catatan: v }) }} />}
    {dialog?.jenis === 'hasil' && <HasilPeserta k={k} p={dialog.p} caps={caps} userId={userId} onClose={() => { setDialog(null); void muat() }} />}
    {dialog?.jenis === 'kompetensi' && <FormKompetensi dari={{ peserta: dialog.p, kegiatan: k }} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); showToast('Kompetensi dicatat.'); void muat(); onKompetensi() }} />}
  </Shade>
}

function SatuIsian({ judul, label, tipe, awal = '', min = 0, wajib, onClose, onSubmit }: { judul: string; label: string; tipe: 'date' | 'textarea'; awal?: string; min?: number; wajib?: boolean; onClose: () => void; onSubmit: (v: string) => Promise<void> }) {
  const [v, setV] = useState(awal); const [error, setError] = useState('')
  return <Shade onClose={onClose} label={judul}>
    <form className="sdl-sumda__form" onSubmit={e => { e.preventDefault(); if (wajib && [...v.trim()].length < Math.max(1, min)) { setError(min ? `Minimal ${min} karakter.` : `${label} wajib diisi.`); return } void onSubmit(v.trim()) }}>
      <header><span className="sdl-progar__eyebrow">DIKLAT &amp; KOMPETENSI</span><h2>{judul}</h2></header>
      <div className="sdl-progar__fields"><label><span>{label}{wajib && <b aria-hidden="true"> *</b>}</span>
        {tipe === 'date' ? <input type="date" min="2000-01-01" max="2100-12-31" value={v} autoFocus onChange={e => setV(e.target.value)} /> : <textarea rows={3} maxLength={1000} value={v} autoFocus onChange={e => setV(e.target.value)} />}</label></div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" onClick={onClose}>Kembali</button><button type="submit" className="btn primary">Simpan</button></footer>
    </form>
  </Shade>
}

function TambahPeserta({ k, terpilih, onClose, onDone }: { k: Kegiatan; terpilih: string[]; onClose: () => void; onDone: () => void }) {
  const [pilih, setPilih] = useState<PersonelCari[]>([])
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  async function simpan() {
    if (!pilih.length) return setError('Pilih minimal satu personel.')
    setBusy(true); setError('')
    try { await api(`/diklat/${enc(k.id)}/peserta`, 'POST', { personelIds: pilih.map(p => p.id), version: k.version }); showToast(`${pilih.length} peserta ditambahkan.`); onDone() }
    catch (e) { setError((e as Error).message); if (e instanceof ApiError && e.code === 'version_conflict') onDone() } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label="Tambah peserta" busy={busy}>
    <div className="sdl-sumda__form">
      <header><span className="sdl-progar__eyebrow">DIKLAT &amp; KOMPETENSI</span><h2>Tambah peserta</h2><p>Hanya personel Aktif/MPP. Maks. 50 sekali simpan.</p></header>
      <div className="sdl-progar__fields"><label><span>Cari personel</span>
        <CariPersonel statusAktif multi terpilih={[...terpilih, ...pilih.map(p => p.id)]} onPilih={p => setPilih(s => s.length >= 50 || s.some(x => x.id === p.id) ? s : [...s, p])} /></label></div>
      {pilih.length > 0 && <ul className="sdl-diklat__pilih">{pilih.map(p => <li key={p.id}>{p.nama} <span className="sdl-sumda__mono">{p.nrp}</span>
        <button type="button" className="sdl-sumda__link" onClick={() => setPilih(s => s.filter(x => x.id !== p.id))}>Hapus</button></li>)}</ul>}
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="button" className="btn primary" disabled={busy} onClick={() => void simpan()}>Simpan {pilih.length || ''} peserta</button></footer>
    </div>
  </Shade>
}

function HasilPeserta({ k, p, caps, userId, onClose }: { k: Kegiatan; p: Peserta; caps: Caps | null; userId: string; onClose: () => void }) {
  const [v, setV] = useState({ hasil: p.hasil, nomorSertifikat: p.nomorSertifikat, keterangan: p.keterangan })
  const [cur, setCur] = useState(p)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const muatUlang = async () => { const d = await api<DetailK>(`/diklat/${enc(k.id)}`); const x = d.peserta.find(y => y.id === p.id); if (x) setCur(x) }
  async function simpan(e: FormEvent) {
    e.preventDefault(); if (busy) return
    setBusy(true); setError('')
    try { await api(`/diklat/${enc(k.id)}/peserta/${enc(p.id)}`, 'PATCH', { ...v, nomorSertifikat: v.hasil === 'Lulus' ? v.nomorSertifikat : '', version: cur.version }); showToast('Hasil disimpan.'); onClose() }
    catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label={`Hasil ${p.nama}`} busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void simpan(e)}>
      <header><span className="sdl-progar__eyebrow">DIKLAT &amp; KOMPETENSI</span><h2>Hasil · {p.nama}</h2></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label><span>Hasil</span><select value={v.hasil} onChange={e => setV(s => ({ ...s, hasil: e.target.value as Hasil }))}>{HASIL.map(h => <option key={h}>{h}</option>)}</select></label>
        <label><span>No. sertifikat</span><input value={v.hasil === 'Lulus' ? v.nomorSertifikat : ''} disabled={v.hasil !== 'Lulus'} maxLength={100} onChange={e => setV(s => ({ ...s, nomorSertifikat: e.target.value }))} /><small>Hanya untuk hasil Lulus.</small></label>
        <label className="sdl-sumda__wide"><span>Keterangan</span><textarea rows={2} maxLength={500} value={v.keterangan} onChange={e => setV(s => ({ ...s, keterangan: e.target.value }))} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <LampiranPdf judul="Sertifikat peserta" items={cur.lampiran} urlUnduh={l => `/api/v1/subbagsumda/diklat/${enc(k.id)}/peserta/${enc(p.id)}/lampiran/${enc(l.id)}`}
        unggah={async fd => { await api(`/diklat/${enc(k.id)}/peserta/${enc(p.id)}/lampiran`, 'POST', fd); await muatUlang() }}
        hapus={async l => { await api(`/diklat/${enc(k.id)}/peserta/${enc(p.id)}/lampiran/${enc(l.id)}`, 'DELETE'); await muatUlang() }}
        bisaUnggah={Boolean(caps?.canManage)} bisaHapus={l => Boolean(caps?.canManage && (l.uploadedBy === userId || caps.canArchive))} />
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Tutup</button><button type="submit" className="btn primary" disabled={busy}>Simpan hasil</button></footer>
    </form>
  </Shade>
}

/* ----------------------------------------------------------- Kompetensi */

function FormKompetensi({ item, dari, onClose, onSaved }: { item?: Kompetensi; dari?: { peserta: Peserta; kegiatan: Kegiatan }; onClose: () => void; onSaved: (k: Kompetensi) => void }) {
  const [personel, setPersonel] = useState<PersonelCari | null>(dari ? { id: dari.peserta.personelId, nrp: dari.peserta.nrp, nama: dari.peserta.nama, status: dari.peserta.personelStatus } : null)
  const [v, setV] = useState({
    nama: item?.nama ?? dari?.kegiatan.nama ?? '', kategori: item?.kategori ?? (dari?.kegiatan.jenis === 'Sertifikasi' ? 'Sertifikasi profesi' : 'Kursus'),
    nomor: item?.nomor ?? dari?.peserta.nomorSertifikat ?? '', penerbit: item?.penerbit ?? dari?.kegiatan.penyelenggara ?? '',
    tanggalTerbit: item?.tanggalTerbit ?? dari?.kegiatan.tanggalSelesai ?? '', berlakuSampai: item?.berlakuSampai ?? '', catatan: item?.catatan ?? '',
  })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    if (!item && !personel) return setError('Pilih personel.')
    if (v.nama.trim().length < 3) return setError('Nama kompetensi wajib diisi (minimal 3 karakter).')
    setBusy(true); setError('')
    try {
      const r = item ? await api<{ item: Kompetensi }>(`/kompetensi/${enc(item.id)}`, 'PATCH', { ...v, version: item.version })
        : await api<{ item: Kompetensi }>('/kompetensi', 'POST', { personelId: personel!.id, ...(dari ? { dariPesertaId: dari.peserta.id } : {}), ...v })
      onSaved(r.item)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label={item ? 'Ubah kompetensi' : 'Catat kompetensi'} busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">DIKLAT &amp; KOMPETENSI</span><h2>{item ? 'Ubah kompetensi' : dari ? 'Jadikan kompetensi' : 'Catat kompetensi'}</h2>
        {dari && <p>Dari kegiatan "{dari.kegiatan.nama}". Isian terisi otomatis dan bisa dikoreksi; sertifikat peserta ditautkan, tidak disalin.</p>}</header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label className="sdl-sumda__wide"><span>Personel<b aria-hidden="true"> *</b></span>
          {item ? <input value={`${item.personel.nama} · ${item.personel.nrp}`} disabled /> : personel ? <div className="sdl-karier__picked"><span><strong>{personel.nama}</strong> <span className="sdl-sumda__mono">{personel.nrp}</span></span>
            {!dari && <button type="button" className="btn" onClick={() => setPersonel(null)}>Ganti</button>}</div>
            : <CariPersonel statusAktif={false} onPilih={setPersonel} />}</label>
        <label className="sdl-sumda__wide"><span>Nama kompetensi / sertifikat<b aria-hidden="true"> *</b></span><input value={v.nama} maxLength={200} onChange={set('nama')} /></label>
        <label><span>Kategori<b aria-hidden="true"> *</b></span><select value={v.kategori} onChange={set('kategori')}>{KATEGORI.map(x => <option key={x}>{x}</option>)}</select></label>
        <label><span>Nomor</span><input value={v.nomor} maxLength={100} onChange={set('nomor')} /></label>
        <label><span>Penerbit</span><input value={v.penerbit} maxLength={200} onChange={set('penerbit')} /></label>
        <label><span>Tanggal terbit</span><input type="date" min="1950-01-01" max="2100-12-31" value={v.tanggalTerbit} onChange={set('tanggalTerbit')} /></label>
        <label><span>Berlaku sampai</span><input type="date" min="1950-01-01" max="2100-12-31" value={v.berlakuSampai} onChange={set('berlakuSampai')} /><small>Kosongkan bila tanpa batas.</small></label>
        <label className="sdl-sumda__wide"><span>Catatan</span><textarea rows={2} maxLength={1000} value={v.catatan} onChange={set('catatan')} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></footer>
    </form>
  </Shade>
}

function KompetensiView({ initialID, userId, onLost }: { initialID?: string; userId: string; onLost: () => void }) {
  const caps = useCaps('/kompetensi/capabilities', onLost)
  const [q, setQ] = useState(''); const [qLive, setQLive] = useState('')
  const [tahap, setTahap] = useState<Tahap | ''>(''); const [kategori, setKategori] = useState('')
  const [page, setPage] = useState(1); const [size, setSize] = useState(10)
  const [data, setData] = useState<{ items: Kompetensi[]; total: number } | null>(null)
  const [ringkas, setRingkas] = useState<Record<Tahap, number> | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [form, setForm] = useState<{ item?: Kompetensi } | null>(null)
  useEffect(() => { const t = setTimeout(() => setQ(qLive.trim()), 300); return () => clearTimeout(t) }, [qLive])
  useEffect(() => { setPage(1) }, [q, tahap, kategori, size])
  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: String(size) })
    if (q) p.set('q', q); if (tahap) p.set('tahap', tahap); if (kategori) p.set('kategori', kategori)
    try {
      setData(await api(`/kompetensi?${p}`)); setError('')
      setRingkas((await api<{ ringkas: Record<Tahap, number> }>('/kompetensi/alert')).ringkas)
    } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [q, tahap, kategori, page, size, onLost])
  useEffect(() => { void load() }, [load])
  useEffect(() => { if (initialID && UUID_RE.test(initialID)) setOpen(initialID) }, [initialID])
  const pager = usePager(data?.total ?? 0, size, page, setSize, setPage)
  return <>
    <nav className="sdl-sumda__tabs sdl-diklat__alert" aria-label="Saring tahap kedaluwarsa">
      <button type="button" className={tahap === '' ? 'is-on' : ''} aria-pressed={tahap === ''} onClick={() => setTahap('')}>Semua</button>
      {TAHAP.map(t => <button key={t.key} type="button" className={tahap === t.key ? 'is-on' : ''} aria-pressed={tahap === t.key} onClick={() => setTahap(t.key)}>{t.label} <span>{ringkas?.[t.key] ?? '–'}</span></button>)}
    </nav>
    <p className="sdl-sumda__rule">Alert dihitung dari tanggal "berlaku sampai" untuk personel Aktif/MPP: H-60 (31–60 hari), H-30 (1–30), Kedaluwarsa (hari ini atau terlewat). Kompetensi tanpa batas tidak masuk alert; yang sudah punya pengganti bernama sama dengan masa berlaku lebih lama juga tidak.</p>
    <div className="sdl-sumda__toolbar">
      <label className="sdl-sumda__search"><span className="sdl-sumda__sr">Cari kompetensi</span>
        <input type="search" value={qLive} maxLength={100} placeholder="Cari kompetensi, nomor, penerbit, nama/NRP personel…" onChange={e => setQLive(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Kategori</span><select value={kategori} onChange={e => setKategori(e.target.value)}><option value="">Semua kategori</option>{KATEGORI.map(x => <option key={x}>{x}</option>)}</select></label>
      <span className="sdl-sumda__grow" />
      {caps?.canManage && <button type="button" className="btn primary" onClick={() => setForm({})}>Catat kompetensi</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Personel</th><th>Kompetensi</th><th>Kategori</th><th className="is-num">Berlaku sampai</th></tr></thead>
        <tbody>
          {data === null ? <tr><td colSpan={4} className="sdl-sumda__muted">Memuat…</td></tr>
            : data.items.length === 0 ? <tr><td colSpan={4} className="sdl-sumda__empty"><strong>Belum ada kompetensi yang cocok.</strong></td></tr>
              : data.items.map(x => <tr key={x.id} className="sdl-sumda__click" onClick={() => setOpen(x.id)}>
                <td><div className="sdl-sumda__who"><strong>{x.personel.nama}</strong><span className="sdl-sumda__mono">{x.personel.nrp}</span></div>{x.personel.terarsip && <span className="sdl-sumda__flag">Personel terarsip</span>}</td>
                <td><strong>{x.nama}</strong>{x.nomor && <small className="sdl-sumda__sub sdl-sumda__mono">{x.nomor}</small>}</td>
                <td>{x.kategori}</td>
                <td className="is-num"><span className="sdl-sumda__mono">{x.berlakuSampai ? tgl(x.berlakuSampai) : 'Tanpa batas'}</span><small className="sdl-sumda__sub">{x.tahap ? <TahapBadge tahap={x.tahap} /> : x.berlakuSampai ? sisaTeks(x.sisaHari) : ''}</small></td>
              </tr>)}
        </tbody>
      </table></div>
      <Pager pager={pager} label="kompetensi" />
    </div>
    {form && <FormKompetensi item={form.item} onClose={() => setForm(null)} onSaved={x => { setForm(null); showToast('Kompetensi disimpan.'); setOpen(x.id); void load() }} />}
    {open && <DetailKompetensi id={open} caps={caps} userId={userId} onClose={() => setOpen(null)} onChanged={() => void load()} onEdit={x => { setOpen(null); setForm({ item: x }) }} onLost={onLost} />}
  </>
}

function DetailKompetensi({ id, caps, userId, onClose, onChanged, onEdit, onLost }: { id: string; caps: Caps | null; userId: string; onClose: () => void; onChanged: () => void; onEdit: (k: Kompetensi) => void; onLost: () => void }) {
  const [d, setD] = useState<{ item: Kompetensi; lampiran: Lampiran[]; sertifikatPeserta: { id: string; filename: string; size: number }[] } | null>(null)
  const [error, setError] = useState('')
  const muat = useCallback(async () => {
    try { setD(await api(`/kompetensi/${enc(id)}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [id, onLost])
  useEffect(() => { void muat() }, [muat])
  if (!d) return <Shade onClose={onClose} label="Detail kompetensi"><p className="sdl-sumda__muted">{error || 'Memuat…'}</p><footer><button type="button" className="btn" onClick={onClose}>Tutup</button></footer></Shade>
  const x = d.item
  const arsip = async () => {
    if (!(await confirmDialog(`Arsipkan kompetensi ${x.nama}?`, { confirmLabel: 'Arsipkan', danger: true }))) return
    try { await api(`/kompetensi/${enc(x.id)}?version=${x.version}`, 'DELETE'); showToast('Kompetensi diarsipkan.'); onChanged(); onClose() } catch (e) { showToast((e as Error).message, 'error') }
  }
  const bolehUbah = Boolean(caps?.canManage) && !x.personel.terarsip
  return <Shade onClose={onClose} label={`Kompetensi ${x.nama}`}>
    <header><span className="sdl-progar__eyebrow">DIKLAT &amp; KOMPETENSI</span><h2>{x.nama}</h2>
      <p>{x.personel.nama} · <span className="sdl-sumda__mono">{x.personel.nrp}</span> {x.tahap && <TahapBadge tahap={x.tahap} />}</p></header>
    {x.personel.terarsip && <p className="sdl-sumda__notice is-warn">Personel sudah diarsipkan; kompetensi ini tidak bisa diubah lagi.</p>}
    <dl className="sdl-sumda__detail">
      <div><dt>Kategori</dt><dd>{x.kategori}</dd></div><div><dt>Nomor</dt><dd className="sdl-sumda__mono">{x.nomor || '—'}</dd></div>
      <div><dt>Penerbit</dt><dd>{x.penerbit || '—'}</dd></div><div><dt>Terbit</dt><dd className="sdl-sumda__mono">{tgl(x.tanggalTerbit)}</dd></div>
      <div><dt>Berlaku sampai</dt><dd className="sdl-sumda__mono">{x.berlakuSampai ? `${tgl(x.berlakuSampai)} (${sisaTeks(x.sisaHari)})` : 'Tanpa batas'}</dd></div>
      <div><dt>Asal</dt><dd>{x.dariDiklat ? `Diklat: ${x.dariDiklat.nama}` : x.dariPesertaId ? 'Diklat (kegiatan sudah diarsipkan)' : 'Dicatat langsung'}</dd></div>
    </dl>
    {x.catatan && <div className="sdl-sumda__catatan"><strong>Catatan</strong><p>{x.catatan}</p></div>}
    {d.sertifikatPeserta.length > 0 && x.dariDiklat && <LampiranPdf judul="Sertifikat dari diklat (tautan)" items={d.sertifikatPeserta} maks={d.sertifikatPeserta.length}
      urlUnduh={l => `/api/v1/subbagsumda/diklat/${enc(x.dariDiklat!.id)}/peserta/${enc(x.dariPesertaId!)}/lampiran/${enc(l.id)}`}
      unggah={async () => undefined} hapus={async () => undefined} bisaUnggah={false} bisaHapus={() => false} />}
    <LampiranPdf judul="Lampiran kompetensi" items={d.lampiran} urlUnduh={l => `/api/v1/subbagsumda/kompetensi/${enc(x.id)}/lampiran/${enc(l.id)}`}
      unggah={async fd => { await api(`/kompetensi/${enc(x.id)}/lampiran`, 'POST', fd); void muat() }} hapus={async l => { await api(`/kompetensi/${enc(x.id)}/lampiran/${enc(l.id)}`, 'DELETE'); void muat() }}
      bisaUnggah={bolehUbah} bisaHapus={l => bolehUbah && (l.uploadedBy === userId || Boolean(caps?.canArchive))} />
    <footer>
      {caps?.canArchive && !x.personel.terarsip && <button type="button" className="btn sdl-progar__danger" onClick={() => void arsip()}>Arsipkan</button>}
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={onClose}>Tutup</button>
      {bolehUbah && <button type="button" className="btn primary" onClick={() => onEdit(x)}>Ubah</button>}
    </footer>
  </Shade>
}
