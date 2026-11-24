import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Pager, type PagerState } from './PaginationR5H5'
import { AlasanDialog, BULAN, CariPersonel, LampiranPdf, Shade, StatusPengajuan, TidakTersedia, UUID_RE, makeApi, tgl, waktu, type LampiranItem, type PersonelCari } from './SumdaBersama'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './SumdaPersonelR5H27.css'
import './SumdaKarierR5H28.css'
import './SumdaLayananR5H30.css'

/**
 * R5H30: Subbagsumda — Cuti & Perizinan. Backend /api/v1/subbagsumda/cuti (Express saja, migrasi 071).
 * Alur Diajukan → Diproses → Disetujui/Ditolak → Selesai/Dibatalkan; Kasubbagsumda memutus (bukan pencatat).
 * Jatah tahunan 12 hari kerja hanya memberi PERINGATAN (K2). Lampiran cuti Sakit dibatasi di server (K4).
 * Aturan bisnis masih versi sementara untuk paparan (K25–K43).
 */

type Status = 'Diajukan' | 'Diproses' | 'Disetujui' | 'Ditolak' | 'Selesai' | 'Dibatalkan'
type Cuti = {
  id: string; jenis: string; tanggalMulai: string; tanggalSelesai: string; tanggalKembali: string; jumlahHari: number; hariDisesuaikan: boolean
  status: Status; catatan: string | null; catatanDibatasi?: boolean; version: number; createdBy: string; createdByName: string; updatedBy: string; decidedByName: string | null
  personel: { id: string; nrp: string; nama: string; status: string; terarsip: boolean }
}
type Jatah = { tahun: number; jatah: number; terpakai: number; dalamProses: number; sisa: number }
type Detail = { item: Cuti; jatah: Jatah; lampiran: LampiranItem[]; riwayat: { dari: string | null; ke: string; catatan: string | null; oleh: string; pada: string }[] }
type Caps = { canRead: boolean; canManage: boolean; canApprove: boolean }
type Kalender = { bulan: string; hari: { tanggal: string; items: { id: string; nama: string; jenis: string; status: Status }[] }[]; terpotong: boolean }

export const JENIS_CUTI: Record<string, string> = { TAHUNAN: 'Tahunan', SAKIT: 'Sakit', ALASAN_PENTING: 'Alasan penting', BESAR: 'Besar', LAINNYA: 'Lainnya' }
const STATUS: Status[] = ['Diajukan', 'Diproses', 'Disetujui', 'Ditolak', 'Selesai', 'Dibatalkan']

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  self_review_forbidden: 'Pencatat atau orang yang pernah mengubah isian/lampiran pengajuan ini tidak boleh memutusnya. Minta pemutus lain.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali tanggal dan jumlah hari.',
  invalid_body: 'Isian tidak dapat diproses.',
  version_conflict: 'Data sudah diubah orang lain. Data dimuat ulang; periksa lalu ulangi.',
  status_tidak_sesuai: 'Status sudah berubah atau tindakan belum berlaku (Selesai baru bisa mulai hari pertama cuti).',
  cuti_bertumpuk: 'Personel ini sudah punya cuti lain pada rentang tanggal tersebut.',
  personel_tidak_aktif: 'Cuti hanya untuk personel berstatus Aktif atau MPP.',
  personel_terarsip: 'Personel sudah diarsipkan; pengajuan hanya bisa dibatalkan.',
  batas_lampiran: 'Batas 10 lampiran tercapai.',
  file_too_large: 'Berkas lebih dari 5 MB.',
  one_file_required: 'Unggah tepat satu berkas.',
  invalid_file_type: 'Berkas harus PDF yang sah dan tidak terkunci kata sandi (nama berakhiran .pdf).',
  evidence_encryption_unavailable: 'Penyimpanan berkas aman sedang tidak tersedia. Hubungi admin sistem.',
  evidence_integrity_failure: 'Berkas tidak lolos pemeriksaan keutuhan. Hubungi admin sistem.',
  not_found: 'Data tidak ditemukan.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
const api = makeApi(ERRORS, 'Cuti & Perizinan tidak tersedia di server saat ini.')
const enc = encodeURIComponent

/** Hari ini menurut WIB (YYYY-MM-DD), untuk tampilan saja; server memakai Postgres. */
export const hariIniWib = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
/** Tampilan hari kerja Senin–Jumat; nilai sah tetap dihitung server (K9/K25). */
export function hariKerja(mulai: string, selesai: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(mulai) || !/^\d{4}-\d{2}-\d{2}$/.test(selesai) || selesai < mulai) return 0
  let n = 0
  for (let t = Date.parse(`${mulai}T00:00:00Z`), b = Date.parse(`${selesai}T00:00:00Z`); t <= b; t += 86400000) {
    const d = new Date(t).getUTCDay(); if (d !== 0 && d !== 6) n++
  }
  return n
}
const PETUNJUK_SAKIT = 'Jangan menulis diagnosis atau keterangan medis.'
const rentangTeks = (c: Cuti) => `${tgl(c.tanggalMulai)}${c.tanggalSelesai !== c.tanggalMulai ? ` – ${tgl(c.tanggalKembali || c.tanggalSelesai)}` : ''}`

export default function SumdaCutiR5H30({ tab, onTab, initialID, userId }: { tab?: string; onTab: (t: 'daftar' | 'kalender') => void; initialID?: string; userId: string }) {
  const [unavailable, setUnavailable] = useState(false)
  const lost = useCallback(() => setUnavailable(true), [])
  const [caps, setCaps] = useState<Caps | null>(null)
  useEffect(() => { api<Caps>('/cuti/capabilities').then(setCaps).catch(e => { if (e instanceof TidakTersedia) lost() }) }, [lost])
  const [openId, setOpenId] = useState<string | null>(initialID && UUID_RE.test(initialID) ? initialID : null)
  const [refresh, setRefresh] = useState(0)
  if (unavailable) return <section className="sdl-sumda"><div className="panel sdl-sumda__notice is-warn" role="alert">
    <strong>Cuti &amp; Perizinan tidak tersedia di server saat ini.</strong>
    <p>Layanan ini sedang dialihkan. Data tidak hilang; coba lagi beberapa saat lagi atau hubungi admin sistem.</p></div></section>
  const aktif = tab === 'kalender' ? 'kalender' : 'daftar'
  return <section className="sdl-sumda">
    <p className="sdl-sumda__notice">Versi untuk paparan: aturan jatah, hitungan hari kerja, dan alur persetujuan masih bisa berubah setelah dibahas bersama pengguna.</p>
    <nav className="sdl-sumda__tabs" aria-label="Bagian Cuti & Perizinan">
      <button type="button" className={aktif === 'daftar' ? 'is-on' : ''} aria-pressed={aktif === 'daftar'} onClick={() => onTab('daftar')}>Daftar pengajuan</button>
      <button type="button" className={aktif === 'kalender' ? 'is-on' : ''} aria-pressed={aktif === 'kalender'} onClick={() => onTab('kalender')}>Kalender ketidakhadiran</button>
    </nav>
    {aktif === 'daftar' ? <DaftarView caps={caps} onLost={lost} onOpen={setOpenId} refresh={refresh} /> : <KalenderView onLost={lost} onOpen={setOpenId} refresh={refresh} />}
    {openId && <DetailCuti id={openId} caps={caps} userId={userId} onClose={() => setOpenId(null)} onChanged={() => setRefresh(n => n + 1)} onLost={lost} />}
  </section>
}

function DaftarView({ caps, onLost, onOpen, refresh }: { caps: Caps | null; onLost: () => void; onOpen: (id: string) => void; refresh: number }) {
  const [q, setQ] = useState(''); const [qLive, setQLive] = useState('')
  const [status, setStatus] = useState(''); const [jenis, setJenis] = useState(''); const [bulan, setBulan] = useState('')
  const [page, setPage] = useState(1); const [size, setSize] = useState(10)
  const [data, setData] = useState<{ items: Cuti[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<{ item: Cuti | null } | null>(null)
  useEffect(() => { const t = setTimeout(() => setQ(qLive.trim()), 300); return () => clearTimeout(t) }, [qLive])
  useEffect(() => { setPage(1) }, [q, status, jenis, bulan, size])
  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: String(size) })
    if (q) p.set('q', q); if (status) p.set('status', status); if (jenis) p.set('jenis', jenis); if (bulan) p.set('bulan', bulan)
    try { setData(await api(`/cuti?${p}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [q, status, jenis, bulan, page, size, onLost])
  useEffect(() => { void load() }, [load, refresh])
  const pager = useMemo(() => ({ total: data?.total ?? 0, size, page, pageCount: Math.max(1, Math.ceil((data?.total ?? 0) / size)), start: (page - 1) * size, setSize, setPage } as PagerState), [data, size, page])
  return <>
    <div className="sdl-sumda__toolbar">
      <label className="sdl-sumda__search"><span className="sdl-sumda__sr">Cari personel</span>
        <input type="search" value={qLive} maxLength={100} placeholder="Cari nama atau NRP personel…" onChange={e => setQLive(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Bulan</span><input type="month" min="2000-01" max="2100-12" value={bulan} onChange={e => setBulan(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Jenis</span><select value={jenis} onChange={e => setJenis(e.target.value)}><option value="">Semua jenis</option>{Object.entries(JENIS_CUTI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option>{STATUS.map(s => <option key={s}>{s}</option>)}</select></label>
      <span className="sdl-sumda__grow" />
      {caps?.canManage && <button type="button" className="btn primary" onClick={() => setForm({ item: null })}>Catat cuti</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Personel</th><th>Jenis</th><th className="is-num">Tanggal</th><th className="is-num">Hari kerja</th><th>Status</th></tr></thead>
        <tbody>
          {data === null ? <tr><td colSpan={5} className="sdl-sumda__muted">Memuat…</td></tr>
            : data.items.length === 0 ? <tr><td colSpan={5} className="sdl-sumda__empty"><strong>Belum ada pengajuan cuti yang cocok.</strong></td></tr>
              : data.items.map(c => <tr key={c.id} className="sdl-sumda__click" onClick={() => onOpen(c.id)}>
                <td><div className="sdl-sumda__who"><strong>{c.personel.nama}</strong><span className="sdl-sumda__mono">{c.personel.nrp}</span></div>{c.personel.terarsip && <span className="sdl-sumda__flag">Personel terarsip</span>}</td>
                <td>{JENIS_CUTI[c.jenis] ?? c.jenis}</td>
                <td className="is-num sdl-sumda__mono">{rentangTeks(c)}</td>
                <td className="is-num sdl-sumda__mono">{c.jumlahHari}{c.hariDisesuaikan && <small>disesuaikan</small>}</td>
                <td><StatusPengajuan status={c.status} /></td>
              </tr>)}
        </tbody>
      </table></div>
      <Pager pager={pager} label="pengajuan" />
    </div>
    {form && <FormCuti item={form.item} onClose={() => setForm(null)} onSaved={c => { setForm(null); onOpen(c.id); void load() }} />}
  </>
}

function FormCuti({ item, onClose, onSaved }: { item: Cuti | null; onClose: () => void; onSaved: (c: Cuti) => void }) {
  const [personel, setPersonel] = useState<PersonelCari | null>(item ? { id: item.personel.id, nrp: item.personel.nrp, nama: item.personel.nama, status: item.personel.status } : null)
  const catatanTersamar = item !== null && item.catatan === null
  const [v, setV] = useState({ jenis: item?.jenis ?? 'TAHUNAN', tanggalMulai: item?.tanggalMulai ?? '', tanggalSelesai: item?.tanggalSelesai ?? '', catatan: item?.catatan ?? '' })
  const [manual, setManual] = useState<string>(item?.hariDisesuaikan ? String(item.jumlahHari) : '')
  const [jatah, setJatah] = useState<Jatah | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  const kerja = hariKerja(v.tanggalMulai, v.tanggalSelesai)
  const jumlah = manual !== '' ? Number(manual) : kerja
  const tahun = v.tanggalMulai.slice(0, 4)
  useEffect(() => {
    if (!personel || v.jenis !== 'TAHUNAN' || !/^\d{4}$/.test(tahun)) { setJatah(null); return }
    api<Jatah>(`/cuti/jatah?personelId=${enc(personel.id)}&tahun=${tahun}`).then(setJatah).catch(() => setJatah(null))
  }, [personel, v.jenis, tahun])
  // Pengajuan yang sedang diubah ikut terhitung "dalam proses" di jatah; dikurangkan untuk tampilan.
  const lainProses = jatah ? jatah.dalamProses - (item && item.jenis === 'TAHUNAN' && item.tanggalMulai.slice(0, 4) === tahun ? item.jumlahHari : 0) : 0
  const tersedia = jatah ? jatah.jatah - jatah.terpakai - lainProses : null
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    if (!personel) return setError('Pilih personel.')
    if (!v.tanggalMulai || !v.tanggalSelesai || v.tanggalSelesai < v.tanggalMulai) return setError('Isi tanggal mulai dan selesai (selesai tidak boleh sebelum mulai).')
    if (v.jenis === 'TAHUNAN' && v.tanggalMulai.slice(0, 4) !== v.tanggalSelesai.slice(0, 4)) return setError('Cuti tahunan tidak boleh melewati pergantian tahun; catat sebagai dua pengajuan.')
    if (jumlah < 1) return setError('Rentang ini tidak memuat hari kerja. Isi "jumlah hari" secara manual bila memang perlu dicatat.')
    if (tersedia !== null && jumlah > tersedia && !(await confirmDialog(`Cuti ${jumlah} hari melebihi sisa jatah tahunan (${Math.max(0, tersedia)} hari, termasuk pengajuan yang masih diproses). Tetap simpan?`, { confirmLabel: 'Tetap simpan' }))) return
    setBusy(true); setError('')
    try {
      const isi = { tanggalMulai: v.tanggalMulai, tanggalSelesai: v.tanggalSelesai, catatan: catatanTersamar ? null : v.catatan, ...(manual !== '' ? { jumlahHari: Number(manual) } : {}) }
      const r = item ? await api<{ item: Cuti; peringatan: string[] }>(`/cuti/${enc(item.id)}`, 'PATCH', { ...isi, version: item.version })
        : await api<{ item: Cuti; peringatan: string[] }>('/cuti', 'POST', { personelId: personel.id, jenis: v.jenis, ...isi })
      showToast(r.peringatan.includes('melebihi_jatah') ? 'Cuti disimpan — melebihi jatah tahunan.' : 'Cuti disimpan.', r.peringatan.length ? 'error' : undefined)
      onSaved(r.item)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label={item ? 'Ubah cuti' : 'Catat cuti'} busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">CUTI &amp; PERIZINAN</span><h2>{item ? 'Ubah pengajuan cuti' : 'Catat pengajuan cuti'}</h2></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label className="sdl-sumda__wide"><span>Personel<b aria-hidden="true"> *</b></span>
          {item ? <input value={`${item.personel.nama} · ${item.personel.nrp}`} disabled /> : personel
            ? <div className="sdl-karier__picked"><span><strong>{personel.nama}</strong> <span className="sdl-sumda__mono">{personel.nrp}</span></span><button type="button" className="btn" onClick={() => setPersonel(null)}>Ganti</button></div>
            : <CariPersonel statusAktif onPilih={setPersonel} />}</label>
        <label><span>Jenis cuti<b aria-hidden="true"> *</b></span><select value={v.jenis} disabled={Boolean(item)} onChange={set('jenis')}>{Object.entries(JENIS_CUTI).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          {item && <small>Jenis tidak bisa diubah; batalkan lalu catat baru.</small>}</label>
        <label><span>Jumlah hari (opsional)</span><input type="number" min={1} max={366} inputMode="numeric" placeholder={`Otomatis: ${kerja} hari kerja`} value={manual} onChange={e => setManual(e.target.value.replace(/\D/g, ''))} /><small>Kosongkan untuk hitungan Senin–Jumat; isi bila ada hari libur.</small></label>
        <label><span>Tanggal mulai<b aria-hidden="true"> *</b></span><input type="date" min="2000-01-01" max="2100-12-31" value={v.tanggalMulai} onChange={set('tanggalMulai')} /></label>
        <label><span>Tanggal selesai<b aria-hidden="true"> *</b></span><input type="date" min="2000-01-01" max="2100-12-31" value={v.tanggalSelesai} onChange={set('tanggalSelesai')} /></label>
        <div className="sdl-sumda__wide sdl-layanan__ringkas" aria-live="polite">
          <span><strong>{jumlah || 0}</strong> hari {manual !== '' ? '(disesuaikan)' : 'kerja'}</span>
          {jatah && <span>Jatah {jatah.tahun}: terpakai <strong>{jatah.terpakai}</strong> · dalam proses <strong>{lainProses}</strong> · sisa <strong className={tersedia !== null && jumlah > tersedia ? 'is-lewat' : ''}>{tersedia}</strong> dari {jatah.jatah}</span>}
        </div>
        <label className="sdl-sumda__wide"><span>Catatan</span><textarea rows={2} maxLength={1000} value={v.catatan} disabled={catatanTersamar} placeholder={catatanTersamar ? 'Catatan cuti sakit hanya untuk pencatat dan Kasubbag; tidak diubah.' : undefined} onChange={set('catatan')} />
          {v.jenis === 'SAKIT' && <small className="sdl-layanan__peringatan">Jangan menulis diagnosis atau keterangan medis. Surat dokter diunggah sebagai lampiran (hanya Kasubbag dan pengunggah yang bisa membukanya).</small>}</label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></footer>
    </form>
  </Shade>
}

function DetailCuti({ id, caps, userId, onClose, onChanged, onLost }: { id: string; caps: Caps | null; userId: string; onClose: () => void; onChanged: () => void; onLost: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<null | 'tolak' | 'batalkan' | 'selesai' | 'ubah'>(null)
  const muat = useCallback(async () => {
    try { setD(await api<Detail>(`/cuti/${enc(id)}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [id, onLost])
  useEffect(() => { void muat() }, [muat])
  if (!d) return <Shade onClose={onClose} label="Detail cuti"><p className="sdl-sumda__muted">{error || 'Memuat…'}</p><footer><button type="button" className="btn" onClick={onClose}>Tutup</button></footer></Shade>
  const c = d.item
  const kirim = async (aksi: string, extra: Record<string, unknown> = {}, pesan = 'Status diperbarui.') => {
    setBusy(true)
    try { await api(`/cuti/${enc(c.id)}/aksi`, 'POST', { aksi, catatan: '', version: c.version, ...extra }); showToast(pesan); onChanged() }
    catch (e) { showToast((e as Error).message, 'error') } finally { setBusy(false); setDialog(null); void muat() }
  }
  const pemutusSendiri = c.createdBy === userId || c.updatedBy === userId
  const bisaBatal = Boolean(caps?.canManage) && ['Diajukan', 'Diproses', 'Disetujui'].includes(c.status) && (c.createdBy === userId || Boolean(caps?.canApprove))
  const sudahMulai = hariIniWib() >= c.tanggalMulai
  return <Shade onClose={onClose} label={`Cuti ${c.personel.nama}`} busy={busy}>
    <header><span className="sdl-progar__eyebrow">CUTI &amp; PERIZINAN</span><h2>{c.personel.nama}</h2>
      <p><StatusPengajuan status={c.status} /> Cuti {JENIS_CUTI[c.jenis]?.toLowerCase() ?? c.jenis} · <span className="sdl-sumda__mono">{c.personel.nrp}</span></p></header>
    {c.personel.terarsip && <p className="sdl-sumda__notice is-warn">Personel sudah diarsipkan; pengajuan ini hanya bisa dibatalkan.</p>}
    {c.status === 'Diproses' && caps?.canApprove && pemutusSendiri && <p className="sdl-sumda__notice">Anda pencatat atau pengubah terakhir pengajuan ini, jadi keputusan harus diambil pemutus lain.</p>}
    <dl className="sdl-sumda__detail">
      <div><dt>Tanggal</dt><dd className="sdl-sumda__mono">{tgl(c.tanggalMulai)} – {tgl(c.tanggalSelesai)}</dd></div>
      <div><dt>Jumlah hari</dt><dd>{c.jumlahHari} {c.hariDisesuaikan ? 'hari (disesuaikan)' : 'hari kerja'}</dd></div>
      {c.tanggalKembali && <div><dt>Hari terakhir dijalani</dt><dd className="sdl-sumda__mono">{tgl(c.tanggalKembali)}</dd></div>}
      <div><dt>Dicatat oleh</dt><dd>{c.createdByName || '—'}</dd></div>
      {c.decidedByName && <div><dt>Diputus oleh</dt><dd>{c.decidedByName}</dd></div>}
      {c.jenis === 'TAHUNAN' && <div><dt>Jatah {d.jatah.tahun}</dt><dd>Terpakai {d.jatah.terpakai} · dalam proses {d.jatah.dalamProses} · sisa {d.jatah.sisa} dari {d.jatah.jatah}</dd></div>}
    </dl>
    {c.catatan && <div className="sdl-sumda__catatan"><strong>Catatan</strong><p>{c.catatan}</p></div>}
    {c.catatanDibatasi && <p className="sdl-sumda__muted">Catatan cuti sakit hanya dapat dibaca pencatat dan Kasubbag.</p>}
    <LampiranPdf judul={c.jenis === 'SAKIT' ? 'Lampiran (dibatasi untuk Kasubbag & pengunggah)' : 'Lampiran'} items={d.lampiran}
      urlUnduh={l => `/api/v1/subbagsumda/cuti/${enc(c.id)}/lampiran/${enc(l.id)}`}
      unggah={async fd => { await api(`/cuti/${enc(c.id)}/lampiran`, 'POST', fd); void muat() }} hapus={async l => { await api(`/cuti/${enc(c.id)}/lampiran/${enc(l.id)}`, 'DELETE'); void muat() }}
      bisaUnggah={Boolean(caps?.canManage) && !c.personel.terarsip && ['Diajukan', 'Diproses', 'Disetujui', 'Selesai'].includes(c.status)}
      bisaHapus={l => Boolean(caps?.canManage) && !c.personel.terarsip && ['Diajukan', 'Diproses'].includes(c.status) && (l.uploadedBy === userId || Boolean(caps?.canApprove))} />
    <section className="sdl-sumda__riwayat" aria-label="Riwayat status">
      <strong>Riwayat status</strong>
      <ol>{d.riwayat.map((h, i) => <li key={i}><span className="sdl-sumda__mono">{waktu(h.pada)}</span><span>{h.dari ? `${h.dari} → ${h.ke}` : h.ke}{h.catatan ? ` — ${h.catatan}` : h.catatan === null ? ' — (alasan dibatasi)' : ''}</span><span className="sdl-sumda__muted">{h.oleh}</span></li>)}</ol>
    </section>
    <footer>
      {bisaBatal && <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setDialog('batalkan')}>Batalkan</button>}
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={onClose}>Tutup</button>
      {caps?.canManage && c.status === 'Diajukan' && !c.personel.terarsip && <button type="button" className="btn" onClick={() => setDialog('ubah')}>Ubah</button>}
      {caps?.canManage && c.status === 'Diajukan' && !c.personel.terarsip && <button type="button" className="btn primary" disabled={busy} onClick={() => void kirim('proses', {}, 'Cuti diteruskan untuk diputus.')}>Proses</button>}
      {caps?.canApprove && c.status === 'Diproses' && !pemutusSendiri && !c.personel.terarsip && <>
        <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setDialog('tolak')}>Tolak</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void kirim('setujui', {}, 'Cuti disetujui.')}>Setujui</button></>}
      {caps?.canManage && c.status === 'Disetujui' && !c.personel.terarsip && <button type="button" className="btn primary" disabled={busy || !sudahMulai} title={sudahMulai ? undefined : 'Bisa ditandai selesai mulai hari pertama cuti.'} onClick={() => setDialog('selesai')}>Tandai selesai…</button>}
    </footer>
    {dialog === 'tolak' && <AlasanDialog judul="Tolak cuti" petunjuk={c.jenis === 'SAKIT' ? PETUNJUK_SAKIT : undefined} onClose={() => setDialog(null)} onSubmit={a => kirim('tolak', { catatan: a }, 'Cuti ditolak.')} />}
    {dialog === 'batalkan' && <AlasanDialog judul="Batalkan cuti" petunjuk={c.jenis === 'SAKIT' ? PETUNJUK_SAKIT : undefined} onClose={() => setDialog(null)} onSubmit={a => kirim('batalkan', { catatan: a }, 'Cuti dibatalkan.')} />}
    {dialog === 'selesai' && <SelesaiCuti c={c} onClose={() => setDialog(null)} onSubmit={extra => kirim('selesai', extra, 'Cuti ditandai selesai.')} />}
    {dialog === 'ubah' && <FormCuti item={c} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged(); void muat() }} />}
  </Shade>
}

function SelesaiCuti({ c, onClose, onSubmit }: { c: Cuti; onClose: () => void; onSubmit: (extra: Record<string, unknown>) => Promise<void> }) {
  const hari = hariIniWib()
  const batas = c.tanggalSelesai < hari ? c.tanggalSelesai : hari
  const [kembali, setKembali] = useState(batas)
  const [manual, setManual] = useState('')
  const [error, setError] = useState('')
  const lebihAwal = kembali !== c.tanggalSelesai
  return <Shade onClose={onClose} label="Tandai cuti selesai">
    <form className="sdl-sumda__form" onSubmit={e => {
      e.preventDefault()
      if (kembali < c.tanggalMulai || kembali > batas) { setError(`Hari terakhir harus antara ${tgl(c.tanggalMulai)} dan ${tgl(batas)}.`); return }
      if (lebihAwal && manual !== '' && (Number(manual) < 1 || Number(manual) > c.jumlahHari)) { setError(`Jumlah hari 1–${c.jumlahHari}.`); return }
      void onSubmit(lebihAwal ? { tanggalKembali: kembali, ...(manual !== '' ? { jumlahHari: Number(manual) } : {}) } : {})
    }}>
      <header><span className="sdl-progar__eyebrow">CUTI &amp; PERIZINAN</span><h2>Tandai selesai</h2><p>Isi hari terakhir cuti yang benar-benar dijalani bila personel kembali lebih awal.</p></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label><span>Hari terakhir cuti</span><input type="date" min={c.tanggalMulai} max={batas} value={kembali} onChange={e => setKembali(e.target.value)} /></label>
        <label><span>Jumlah hari (opsional)</span><input type="number" min={1} max={c.jumlahHari} inputMode="numeric" disabled={!lebihAwal} placeholder={`Otomatis: ${lebihAwal ? Math.min(hariKerja(c.tanggalMulai, kembali), c.jumlahHari) : c.jumlahHari}`} value={lebihAwal ? manual : ''} onChange={e => setManual(e.target.value.replace(/\D/g, ''))} />
          <small>Hanya bila kembali lebih awal; tidak melebihi {c.jumlahHari} hari yang disetujui.</small></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" onClick={onClose}>Kembali</button><button type="submit" className="btn primary">Tandai selesai</button></footer>
    </form>
  </Shade>
}

function KalenderView({ onLost, onOpen, refresh }: { onLost: () => void; onOpen: (id: string) => void; refresh: number }) {
  const [bulan, setBulan] = useState(() => hariIniWib().slice(0, 7))
  const [data, setData] = useState<Kalender | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    setData(null)
    api<Kalender>(`/cuti/kalender?bulan=${bulan}`).then(r => { setData(r); setError('') }).catch(e => { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) })
  }, [bulan, onLost, refresh])
  const geser = (n: number) => { const [y, m] = bulan.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setBulan(d.toISOString().slice(0, 7)) }
  const hariIni = hariIniWib()
  const awal = data ? (new Date(`${data.hari[0].tanggal}T00:00:00Z`).getUTCDay() + 6) % 7 : 0
  return <div className="panel sdl-layanan__kalender">
    <div className="sdl-sumda__toolbar">
      <button type="button" className="btn" onClick={() => geser(-1)} aria-label="Bulan sebelumnya">‹</button>
      <strong className="sdl-layanan__bulan">{BULAN[Number(bulan.slice(5, 7)) - 1]} {bulan.slice(0, 4)}</strong>
      <button type="button" className="btn" onClick={() => geser(1)} aria-label="Bulan berikutnya">›</button>
      <button type="button" className="btn" onClick={() => setBulan(hariIniWib().slice(0, 7))}>Bulan ini</button>
      <span className="sdl-sumda__grow" />
      <span className="sdl-layanan__legenda"><i className="is-disetujui" /> Disetujui/Selesai <i className="is-diproses" /> Belum diputus</span>
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    {data?.terpotong && <p className="sdl-sumda__notice is-warn">Lebih dari 1000 cuti di bulan ini; sebagian tidak ditampilkan.</p>}
    <div className="sdl-layanan__grid" role="grid" aria-label={`Kalender cuti ${bulan}`}>
      {['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'].map(h => <div key={h} className="sdl-layanan__hari" role="columnheader">{h}</div>)}
      {Array.from({ length: awal }, (_, i) => <div key={`k${i}`} className="sdl-layanan__sel is-kosong" />)}
      {data === null ? <div className="sdl-sumda__muted">Memuat…</div> : data.hari.map((h, i) => {
        const libur = (awal + i) % 7 >= 5
        return <div key={h.tanggal} role="gridcell" className={`sdl-layanan__sel${libur ? ' is-libur' : ''}${h.tanggal === hariIni ? ' is-hariini' : ''}`}>
          <span className="sdl-layanan__tgl">{Number(h.tanggal.slice(8))}</span>
          {h.items.slice(0, 3).map(x => <button key={x.id} type="button" className={`sdl-layanan__cuti ${x.status === 'Diproses' ? 'is-diproses' : 'is-disetujui'}`} title={`${x.nama} · ${JENIS_CUTI[x.jenis] ?? x.jenis} · ${x.status}`} onClick={() => onOpen(x.id)}>{x.nama}</button>)}
          {h.items.length > 3 && <small className="sdl-sumda__muted">+{h.items.length - 3} lagi</small>}
        </div>
      })}
    </div>
  </div>
}
