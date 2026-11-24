import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Pager, type PagerState } from './PaginationR5H5'
import { AlasanDialog, ApiError, CariPersonel, LampiranPdf, Shade, StatusPengajuan, TidakTersedia, UUID_RE, makeApi, tgl, waktu, type LampiranItem, type PersonelCari } from './SumdaBersama'
import { confirmDialog, showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './SumdaPersonelR5H27.css'
import './SumdaKarierR5H28.css'
import './SumdaLayananR5H30.css'

/**
 * R5H30: Subbagsumda — Kesejahteraan (layanan personel & pensiun). Backend /api/v1/subbagsumda/kesejahteraan.
 * Alur sama dengan Cuti; Kasubbagsumda memutus. Selesai untuk MPP/Persiapan Pensiun dapat memperbarui status
 * Master Personel (dikonfirmasi petugas, butuh hak ubah personel). "Proses Pensiun" dari Monitoring Pensiun
 * memakai `prosesPensiun()` di bawah. Aturan bisnis masih versi sementara untuk paparan (K25–K43).
 */

type Status = 'Diajukan' | 'Diproses' | 'Disetujui' | 'Ditolak' | 'Selesai' | 'Dibatalkan'
type Layanan = {
  id: string; jenis: string; nomorReferensi: string; targetSelesai: string; lewatTarget: boolean; status: Status; catatan: string
  diterapkan: { fields?: { status?: { lama: string; baru: string } } } | null; statusUsulan: string | null; version: number
  createdBy: string; createdByName: string; updatedBy: string; decidedByName: string | null
  personel: { id: string; nrp: string; nama: string; status: string; tanggalPensiun: string; version: number; terarsip: boolean }
}
type Detail = { item: Layanan; lampiran: LampiranItem[]; riwayat: { dari: string | null; ke: string; catatan: string; oleh: string; pada: string }[] }
type Caps = { canRead: boolean; canManage: boolean; canApprove: boolean }

export const JENIS_LAYANAN: Record<string, string> = { PERSIAPAN_PENSIUN: 'Persiapan pensiun', MPP: 'MPP', ASABRI: 'Administrasi ASABRI', KARTU_IDENTITAS: 'Kartu / identitas', LAINNYA: 'Layanan lain' }
const STATUS: Status[] = ['Diajukan', 'Diproses', 'Disetujui', 'Ditolak', 'Selesai', 'Dibatalkan']
/** K33: status asal yang boleh diterapkan. */
const ASAL: Record<string, string[]> = { MPP: ['Aktif'], Pensiun: ['Aktif', 'MPP'] }

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  self_review_forbidden: 'Pencatat atau orang yang pernah mengubah isian/lampiran layanan ini tidak boleh memutusnya. Minta pemutus lain.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak dapat diproses.',
  version_conflict: 'Data sudah diubah orang lain. Data dimuat ulang; periksa lalu ulangi.',
  status_tidak_sesuai: 'Status sudah berubah; tindakan ini tidak berlaku lagi.',
  pengajuan_ganda: 'Personel ini masih punya layanan terbuka dengan jenis yang sama.',
  personel_tidak_aktif: 'Status personel tidak sesuai untuk tindakan ini (layanan baru hanya untuk Aktif/MPP).',
  personel_terarsip: 'Personel sudah diarsipkan; layanan hanya bisa dibatalkan.',
  personel_berubah: 'Data Master Personel berubah sejak dialog dibuka. Dimuat ulang; periksa lalu ulangi.',
  personel_belum_lengkap: 'Tanggal pensiun personel belum diisi di Master Personel; lengkapi dulu sebelum menetapkan MPP.',
  batas_lampiran: 'Batas 10 lampiran tercapai.',
  file_too_large: 'Berkas lebih dari 5 MB.',
  one_file_required: 'Unggah tepat satu berkas.',
  invalid_file_type: 'Berkas harus PDF yang sah dan tidak terkunci kata sandi (nama berakhiran .pdf).',
  evidence_encryption_unavailable: 'Penyimpanan berkas aman sedang tidak tersedia. Hubungi admin sistem.',
  evidence_integrity_failure: 'Berkas tidak lolos pemeriksaan keutuhan. Hubungi admin sistem.',
  not_found: 'Data tidak ditemukan.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
const api = makeApi(ERRORS, 'Kesejahteraan tidak tersedia di server saat ini.')
const enc = encodeURIComponent

export async function kesejahteraanCaps(): Promise<Caps | null> {
  try { return await api<Caps>('/kesejahteraan/capabilities') } catch { return null }
}

/**
 * K34/K35: "Proses Pensiun" — buat layanan Persiapan Pensiun (target = tanggal pensiun), atau buka yang
 * masih terbuka. Mengembalikan id layanan, atau null bila dibatalkan/gagal (pesan sudah ditampilkan).
 */
export async function prosesPensiun(p: { id: string; nama: string; tanggalPensiun: string }): Promise<string | null> {
  if (!(await confirmDialog(`Buat layanan Persiapan Pensiun untuk ${p.nama}?`, { confirmLabel: 'Proses pensiun' }))) return null
  try {
    const r = await api<{ item: Layanan }>('/kesejahteraan', 'POST', { personelId: p.id, jenis: 'PERSIAPAN_PENSIUN', nomorReferensi: '', targetSelesai: p.tanggalPensiun || '', catatan: '' })
    showToast('Layanan Persiapan Pensiun dibuat.')
    return r.item.id
  } catch (e) {
    if (e instanceof ApiError && e.code === 'pengajuan_ganda' && typeof e.data.id === 'string') { showToast('Proses pensiun sudah ada; membuka layanan yang terbuka.'); return e.data.id }
    showToast((e as Error).message, 'error'); return null
  }
}

export default function SumdaKesejahteraanR5H30({ initialID, userId }: { initialID?: string; userId: string }) {
  const [unavailable, setUnavailable] = useState(false)
  const lost = useCallback(() => setUnavailable(true), [])
  const [caps, setCaps] = useState<Caps | null>(null)
  const [bolehUbahPersonel, setBolehUbahPersonel] = useState(false)
  useEffect(() => {
    api<Caps>('/kesejahteraan/capabilities').then(setCaps).catch(e => { if (e instanceof TidakTersedia) lost() })
    api<{ canUpdate: boolean }>('/personel/capabilities').then(c => setBolehUbahPersonel(c.canUpdate)).catch(() => setBolehUbahPersonel(false))
  }, [lost])
  const [q, setQ] = useState(''); const [qLive, setQLive] = useState('')
  const [status, setStatus] = useState(''); const [jenis, setJenis] = useState(''); const [lewat, setLewat] = useState(false)
  const [page, setPage] = useState(1); const [size, setSize] = useState(10)
  const [data, setData] = useState<{ items: Layanan[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState<string | null>(initialID && UUID_RE.test(initialID) ? initialID : null)
  const [form, setForm] = useState<{ item: Layanan | null } | null>(null)
  useEffect(() => { const t = setTimeout(() => setQ(qLive.trim()), 300); return () => clearTimeout(t) }, [qLive])
  useEffect(() => { setPage(1) }, [q, status, jenis, lewat, size])
  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: String(size) })
    if (q) p.set('q', q); if (status) p.set('status', status); if (jenis) p.set('jenis', jenis); if (lewat) p.set('lewatTarget', '1')
    try { setData(await api(`/kesejahteraan?${p}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) lost(); else setError((e as Error).message) }
  }, [q, status, jenis, lewat, page, size, lost])
  useEffect(() => { void load() }, [load])
  const pager = useMemo(() => ({ total: data?.total ?? 0, size, page, pageCount: Math.max(1, Math.ceil((data?.total ?? 0) / size)), start: (page - 1) * size, setSize, setPage } as PagerState), [data, size, page])
  if (unavailable) return <section className="sdl-sumda"><div className="panel sdl-sumda__notice is-warn" role="alert">
    <strong>Kesejahteraan tidak tersedia di server saat ini.</strong>
    <p>Layanan ini sedang dialihkan. Data tidak hilang; coba lagi beberapa saat lagi atau hubungi admin sistem.</p></div></section>
  return <section className="sdl-sumda">
    <p className="sdl-sumda__notice">Versi untuk paparan: jenis layanan dan alur persetujuan masih bisa berubah setelah dibahas bersama pengguna.</p>
    <div className="sdl-sumda__toolbar">
      <label className="sdl-sumda__search"><span className="sdl-sumda__sr">Cari layanan</span>
        <input type="search" value={qLive} maxLength={100} placeholder="Cari nama/NRP personel atau nomor referensi…" onChange={e => setQLive(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Jenis</span><select value={jenis} onChange={e => setJenis(e.target.value)}><option value="">Semua layanan</option>{Object.entries(JENIS_LAYANAN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option>{STATUS.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="sdl-layanan__cek"><input type="checkbox" checked={lewat} onChange={e => setLewat(e.target.checked)} /> Lewat target</label>
      <span className="sdl-sumda__grow" />
      {caps?.canManage && <button type="button" className="btn primary" onClick={() => setForm({ item: null })}>Catat layanan</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Personel</th><th>Layanan</th><th className="is-num">Target selesai</th><th>Status</th></tr></thead>
        <tbody>
          {data === null ? <tr><td colSpan={4} className="sdl-sumda__muted">Memuat…</td></tr>
            : data.items.length === 0 ? <tr><td colSpan={4} className="sdl-sumda__empty"><strong>Belum ada layanan yang cocok.</strong></td></tr>
              : data.items.map(x => <tr key={x.id} className="sdl-sumda__click" onClick={() => setOpenId(x.id)}>
                <td><div className="sdl-sumda__who"><strong>{x.personel.nama}</strong><span className="sdl-sumda__mono">{x.personel.nrp}</span></div>{x.personel.terarsip && <span className="sdl-sumda__flag">Personel terarsip</span>}</td>
                <td>{JENIS_LAYANAN[x.jenis] ?? x.jenis}{x.nomorReferensi && <small className="sdl-sumda__sub sdl-sumda__mono">{x.nomorReferensi}</small>}</td>
                <td className="is-num"><span className="sdl-sumda__mono">{x.targetSelesai ? tgl(x.targetSelesai) : '—'}</span>{x.lewatTarget && <small className="sdl-sumda__sub"><span className="sdl-sumda__flag">Lewat target</span></small>}</td>
                <td><StatusPengajuan status={x.status} /></td>
              </tr>)}
        </tbody>
      </table></div>
      <Pager pager={pager} label="layanan" />
    </div>
    {form && <FormLayanan item={form.item} onClose={() => setForm(null)} onSaved={id => { setForm(null); setOpenId(id); void load() }} />}
    {openId && <DetailLayanan id={openId} caps={caps} bolehUbahPersonel={bolehUbahPersonel} userId={userId} onClose={() => setOpenId(null)} onChanged={() => void load()} onLost={lost} />}
  </section>
}

function FormLayanan({ item, onClose, onSaved }: { item: Layanan | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [personel, setPersonel] = useState<PersonelCari | null>(null)
  const [v, setV] = useState({ jenis: item?.jenis ?? 'PERSIAPAN_PENSIUN', nomorReferensi: item?.nomorReferensi ?? '', targetSelesai: item?.targetSelesai ?? '', catatan: item?.catatan ?? '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    if (!item && !personel) return setError('Pilih personel.')
    setBusy(true); setError('')
    try {
      const r = item ? await api<{ item: Layanan }>(`/kesejahteraan/${enc(item.id)}`, 'PATCH', { nomorReferensi: v.nomorReferensi, targetSelesai: v.targetSelesai, catatan: v.catatan, version: item.version })
        : await api<{ item: Layanan }>('/kesejahteraan', 'POST', { personelId: personel!.id, ...v })
      showToast('Layanan disimpan.'); onSaved(r.item.id)
    } catch (err) {
      if (err instanceof ApiError && err.code === 'pengajuan_ganda' && typeof err.data.id === 'string') { showToast(err.message, 'error'); onSaved(err.data.id); return }
      setError((err as Error).message)
    } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label={item ? 'Ubah layanan' : 'Catat layanan'} busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">KESEJAHTERAAN</span><h2>{item ? 'Ubah layanan' : 'Catat layanan kesejahteraan'}</h2></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label className="sdl-sumda__wide"><span>Personel<b aria-hidden="true"> *</b></span>
          {item ? <input value={`${item.personel.nama} · ${item.personel.nrp}`} disabled /> : personel
            ? <div className="sdl-karier__picked"><span><strong>{personel.nama}</strong> <span className="sdl-sumda__mono">{personel.nrp}</span></span><button type="button" className="btn" onClick={() => setPersonel(null)}>Ganti</button></div>
            : <CariPersonel statusAktif onPilih={p => { setPersonel(p); if (!v.targetSelesai && p.tanggalPensiun && v.jenis === 'PERSIAPAN_PENSIUN') setV(s => ({ ...s, targetSelesai: p.tanggalPensiun! })) }} />}</label>
        <label><span>Jenis layanan<b aria-hidden="true"> *</b></span><select value={v.jenis} disabled={Boolean(item)} onChange={set('jenis')}>{Object.entries(JENIS_LAYANAN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span>No. referensi</span><input value={v.nomorReferensi} maxLength={100} onChange={set('nomorReferensi')} /></label>
        <label><span>Target selesai</span><input type="date" min="2000-01-01" max="2100-12-31" value={v.targetSelesai} onChange={set('targetSelesai')} /></label>
        <label className="sdl-sumda__wide"><span>Catatan</span><textarea rows={2} maxLength={1000} value={v.catatan} onChange={set('catatan')} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></footer>
    </form>
  </Shade>
}

function DetailLayanan({ id, caps, bolehUbahPersonel, userId, onClose, onChanged, onLost }: { id: string; caps: Caps | null; bolehUbahPersonel: boolean; userId: string; onClose: () => void; onChanged: () => void; onLost: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<null | 'tolak' | 'batalkan' | 'selesai' | 'ubah'>(null)
  const muat = useCallback(async () => {
    try { setD(await api<Detail>(`/kesejahteraan/${enc(id)}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [id, onLost])
  useEffect(() => { void muat() }, [muat])
  if (!d) return <Shade onClose={onClose} label="Detail layanan"><p className="sdl-sumda__muted">{error || 'Memuat…'}</p><footer><button type="button" className="btn" onClick={onClose}>Tutup</button></footer></Shade>
  const x = d.item
  const kirim = async (aksi: string, extra: Record<string, unknown> = {}, pesan = 'Status diperbarui.') => {
    setBusy(true)
    try { await api(`/kesejahteraan/${enc(x.id)}/aksi`, 'POST', { aksi, catatan: '', version: x.version, ...extra }); showToast(pesan); onChanged(); setDialog(null) }
    catch (e) { showToast((e as Error).message, 'error'); if (!(e instanceof ApiError && e.code === 'personel_berubah')) setDialog(null) }
    finally { setBusy(false); void muat() }
  }
  const pemutusSendiri = x.createdBy === userId || x.updatedBy === userId
  const bisaBatal = Boolean(caps?.canManage) && ['Diajukan', 'Diproses', 'Disetujui'].includes(x.status) && (x.createdBy === userId || Boolean(caps?.canApprove))
  const st = x.diterapkan?.fields?.status
  return <Shade onClose={onClose} label={`Layanan ${x.personel.nama}`} busy={busy}>
    <header><span className="sdl-progar__eyebrow">KESEJAHTERAAN</span><h2>{JENIS_LAYANAN[x.jenis] ?? x.jenis}</h2>
      <p><StatusPengajuan status={x.status} /> {x.personel.nama} · <span className="sdl-sumda__mono">{x.personel.nrp}</span></p></header>
    {x.personel.terarsip && <p className="sdl-sumda__notice is-warn">Personel sudah diarsipkan; layanan ini hanya bisa dibatalkan.</p>}
    {x.status === 'Diproses' && caps?.canApprove && pemutusSendiri && <p className="sdl-sumda__notice">Anda pencatat atau pengubah terakhir layanan ini, jadi keputusan harus diambil pemutus lain.</p>}
    <dl className="sdl-sumda__detail">
      <div><dt>Status personel</dt><dd>{x.personel.status}{x.personel.tanggalPensiun && <> · pensiun <span className="sdl-sumda__mono">{tgl(x.personel.tanggalPensiun)}</span></>}</dd></div>
      <div><dt>No. referensi</dt><dd className="sdl-sumda__mono">{x.nomorReferensi || '—'}</dd></div>
      <div><dt>Target selesai</dt><dd><span className="sdl-sumda__mono">{x.targetSelesai ? tgl(x.targetSelesai) : '—'}</span>{x.lewatTarget && <> <span className="sdl-sumda__flag">Lewat target</span></>}</dd></div>
      <div><dt>Dicatat oleh</dt><dd>{x.createdByName || '—'}</dd></div>
      {x.decidedByName && <div><dt>Diputus oleh</dt><dd>{x.decidedByName}</dd></div>}
      {x.status === 'Selesai' && <div><dt>Master Personel</dt><dd>{st ? `Status ${st.lama} → ${st.baru}` : 'Tidak diubah'}</dd></div>}
    </dl>
    {x.catatan && <div className="sdl-sumda__catatan"><strong>Catatan</strong><p>{x.catatan}</p></div>}
    <LampiranPdf judul="Lampiran" items={d.lampiran} urlUnduh={l => `/api/v1/subbagsumda/kesejahteraan/${enc(x.id)}/lampiran/${enc(l.id)}`}
      unggah={async fd => { await api(`/kesejahteraan/${enc(x.id)}/lampiran`, 'POST', fd); void muat() }} hapus={async l => { await api(`/kesejahteraan/${enc(x.id)}/lampiran/${enc(l.id)}`, 'DELETE'); void muat() }}
      bisaUnggah={Boolean(caps?.canManage) && !x.personel.terarsip && ['Diajukan', 'Diproses', 'Disetujui', 'Selesai'].includes(x.status)}
      bisaHapus={l => Boolean(caps?.canManage) && !x.personel.terarsip && ['Diajukan', 'Diproses'].includes(x.status) && (l.uploadedBy === userId || Boolean(caps?.canApprove))} />
    <section className="sdl-sumda__riwayat" aria-label="Riwayat status">
      <strong>Riwayat status</strong>
      <ol>{d.riwayat.map((h, i) => <li key={i}><span className="sdl-sumda__mono">{waktu(h.pada)}</span><span>{h.dari ? `${h.dari} → ${h.ke}` : h.ke}{h.catatan && ` — ${h.catatan}`}</span><span className="sdl-sumda__muted">{h.oleh}</span></li>)}</ol>
    </section>
    <footer>
      {bisaBatal && <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setDialog('batalkan')}>Batalkan</button>}
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={onClose}>Tutup</button>
      {caps?.canManage && x.status === 'Diajukan' && !x.personel.terarsip && <button type="button" className="btn" onClick={() => setDialog('ubah')}>Ubah</button>}
      {caps?.canManage && x.status === 'Diajukan' && !x.personel.terarsip && <button type="button" className="btn primary" disabled={busy} onClick={() => void kirim('proses', {}, 'Layanan diteruskan untuk diputus.')}>Proses</button>}
      {caps?.canApprove && x.status === 'Diproses' && !pemutusSendiri && !x.personel.terarsip && <>
        <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setDialog('tolak')}>Tolak</button>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void kirim('setujui', {}, 'Layanan disetujui.')}>Setujui</button></>}
      {caps?.canManage && x.status === 'Disetujui' && !x.personel.terarsip && <button type="button" className="btn primary" disabled={busy} onClick={() => setDialog('selesai')}>Tandai selesai…</button>}
    </footer>
    {dialog === 'tolak' && <AlasanDialog judul="Tolak layanan" onClose={() => setDialog(null)} onSubmit={a => kirim('tolak', { catatan: a }, 'Layanan ditolak.')} />}
    {dialog === 'batalkan' && <AlasanDialog judul="Batalkan layanan" onClose={() => setDialog(null)} onSubmit={a => kirim('batalkan', { catatan: a }, 'Layanan dibatalkan.')} />}
    {dialog === 'selesai' && <SelesaiLayanan x={x} bolehUbahPersonel={bolehUbahPersonel} busy={busy} onClose={() => setDialog(null)} onSubmit={extra => kirim('selesai', extra, 'Layanan selesai.')} />}
    {dialog === 'ubah' && <FormLayanan item={x} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged(); void muat() }} />}
  </Shade>
}

function SelesaiLayanan({ x, bolehUbahPersonel, busy, onClose, onSubmit }: { x: Layanan; bolehUbahPersonel: boolean; busy: boolean; onClose: () => void; onSubmit: (extra: Record<string, unknown>) => Promise<void> }) {
  const usulan = x.statusUsulan
  const sudah = usulan !== null && x.personel.status === usulan
  const asalSah = usulan !== null && (ASAL[usulan] ?? []).includes(x.personel.status)
  const kurang = usulan === 'MPP' && !x.personel.tanggalPensiun
  const bisa = usulan !== null && asalSah && !kurang && bolehUbahPersonel
  const [terapkan, setTerapkan] = useState(bisa)
  return <Shade onClose={onClose} label="Tandai layanan selesai" busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => { e.preventDefault(); void onSubmit(terapkan && bisa ? { terapkan: { status: usulan, personelVersion: x.personel.version } } : {}) }}>
      <header><span className="sdl-progar__eyebrow">KESEJAHTERAAN</span><h2>Tandai selesai</h2></header>
      {usulan === null ? <p>Layanan ini tidak mengubah Master Personel.</p> : <div className="sdl-layanan__terapkan">
        <p>Status personel sekarang <strong>{x.personel.status}</strong>{!sudah && <> → usulan <strong>{usulan}</strong></>}.</p>
        {sudah ? <p className="sdl-sumda__muted">Status personel sudah {usulan}; tidak ada yang perlu diubah.</p>
          : !asalSah ? <p className="sdl-sumda__muted">Status {x.personel.status} tidak bisa diubah menjadi {usulan} dari sini.</p>
            : kurang ? <p className="sdl-sumda__notice is-warn">Tanggal pensiun belum diisi di Master Personel; lengkapi dulu bila ingin menetapkan MPP.</p>
              : !bolehUbahPersonel ? <p className="sdl-sumda__muted">Akun ini tidak punya hak mengubah Master Personel; status personel tidak diubah.</p>
                : <label className="sdl-layanan__cek"><input type="checkbox" checked={terapkan} onChange={e => setTerapkan(e.target.checked)} /> Perbarui status di Master Personel menjadi <strong>{usulan}</strong></label>}
      </div>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Kembali</button><button type="submit" className="btn primary" disabled={busy}>Tandai selesai</button></footer>
    </form>
  </Shade>
}
