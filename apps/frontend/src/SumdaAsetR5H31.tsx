import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Pager, type PagerState } from './PaginationR5H5'
import { AlasanDialog, CariPersonel, LampiranPdf, Shade, TidakTersedia, UUID_RE, makeApi, tgl, waktu, type LampiranItem, type PersonelCari } from './SumdaBersama'
import { hariIniWib } from './SumdaCutiR5H30'
import { showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './SumdaPersonelR5H27.css'
import './SumdaKarierR5H28.css'
import './SumdaLayananR5H30.css'
import './SumdaR5H31.css'

/**
 * R5H31: Subbagsumda — Inventaris & BMN (menggantikan registry inventaris + menu Pemeliharaan Logistik).
 * Backend /api/v1/subbagsumda/aset (Express saja, migrasi 072). Penghapusan BMN diputus Kasubbagsumda
 * (bukan pengusul) dan wajib lampiran SK/BA yang diunggah sejak usulan.
 */

type StatusAset = 'Aktif' | 'Pemeliharaan' | 'Usulan Penghapusan' | 'Dihapus'
type Tahap = 'H-14' | 'JATUH_TEMPO'
type Aset = {
  id: string; kodeBmn: string; nama: string; kategori: string; merekTipe: string; tahunPerolehan: number | null; jumlah: number; satuan: string
  lokasi: string; kondisi: string; penanggungJawab: { id: string | null; nama: string | null; nrp: string | null; terarsip: boolean; teks: string }
  jadwalPemeliharaan: string; sisaHari: number | null; tahap: Tahap | null; status: StatusAset; statusSebelum: string | null
  usulan: { alasan: string; oleh: string; olehNama: string; pada: string } | null; decidedByName: string | null
  catatan: string; salinan: boolean; version: number; updatedBy: string
}
type Entri = { id: string; tanggal: string; jenis: string; uraian: string; pelaksana: string; kondisi: string; jadwalBerikutnya: string; koreksiDari: string | null; olehNama: string }
type Detail = { item: Aset; pemeliharaan: Entri[]; pemeliharaanTerpotong: boolean; lampiran: LampiranItem[]; riwayat: { dari: string | null; ke: string; catatan: string; oleh: string; pada: string }[] }
type Caps = { canRead: boolean; canManage: boolean; canApprove: boolean }

const KATEGORI = ['Komputer', 'Perangkat Jaringan', 'Perabot', 'Elektronik', 'Kendaraan', 'Lainnya']
const KONDISI = ['Baik', 'Perlu Pemeriksaan', 'Rusak Ringan', 'Rusak Berat']
const STATUS: StatusAset[] = ['Aktif', 'Pemeliharaan', 'Usulan Penghapusan', 'Dihapus']
const JENIS: Record<string, string> = { RUTIN: 'Rutin', PERBAIKAN: 'Perbaikan', PEMERIKSAAN: 'Pemeriksaan' }

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  self_review_forbidden: 'Pengusul, atau orang yang mengubah lampiran sejak usulan, tidak boleh memutus penghapusan ini.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak dapat diproses.',
  version_conflict: 'Data sudah diubah orang lain. Data dimuat ulang; periksa lalu ulangi.',
  status_tidak_sesuai: 'Tindakan ini tidak berlaku untuk status aset sekarang (aset dibekukan selama usulan penghapusan; aset Dihapus hanya-baca).',
  kode_bmn_ganda: 'Kode BMN sudah dipakai aset lain.',
  lampiran_wajib: 'Unggah SK/berita acara penghapusan (PDF) dulu; lampiran harus diunggah setelah usulan dibuat.',
  personel_terarsip: 'Personel itu sudah diarsipkan; pilih penanggung jawab lain.',
  batas_lampiran: 'Batas 10 lampiran tercapai.',
  file_too_large: 'Berkas lebih dari 5 MB.',
  one_file_required: 'Unggah tepat satu berkas.',
  invalid_file_type: 'Berkas harus PDF yang sah dan tidak terkunci kata sandi (nama berakhiran .pdf).',
  evidence_encryption_unavailable: 'Penyimpanan berkas aman sedang tidak tersedia. Hubungi admin sistem.',
  evidence_integrity_failure: 'Berkas tidak lolos pemeriksaan keutuhan. Hubungi admin sistem.',
  not_found: 'Data tidak ditemukan.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
const api = makeApi(ERRORS, 'Inventaris & BMN tidak tersedia di server saat ini.')
const enc = encodeURIComponent

function TahapBadge({ t }: { t: Tahap | null }) {
  if (!t) return null
  return <span className={`sdl-sumda__tahap ${t === 'JATUH_TEMPO' ? 'is-due' : 'is-h-7'}`}>{t === 'JATUH_TEMPO' ? 'Jatuh tempo' : 'H-14'}</span>
}
function StatusAsetBadge({ s }: { s: StatusAset }) {
  return <span className={`sdl-r5h31__aset is-${s.split(' ')[0].toLowerCase()}`}>{s}</span>
}
const pjTeks = (a: Aset) => a.penanggungJawab.id ? `${a.penanggungJawab.nama}${a.penanggungJawab.terarsip ? ' (terarsip)' : ''}` : a.penanggungJawab.teks || '—'

export default function SumdaAsetR5H31({ tab, onTab, initialID, userId, legacy, onOpenFiles }: { tab?: string; onTab: (t: 'daftar' | 'jadwal') => void; initialID?: string; userId: string; legacy?: ReactNode; onOpenFiles?: () => void }) {
  const [unavailable, setUnavailable] = useState(false)
  const [showLegacy, setShowLegacy] = useState(false)
  const lost = useCallback(() => setUnavailable(true), [])
  const [caps, setCaps] = useState<Caps | null>(null)
  useEffect(() => { api<Caps>('/aset/capabilities').then(setCaps).catch(e => { if (e instanceof TidakTersedia) lost() }) }, [lost])
  const [openId, setOpenId] = useState<string | null>(initialID && UUID_RE.test(initialID) ? initialID : null)
  const [refresh, setRefresh] = useState(0)
  if (unavailable) return <section className="sdl-sumda"><div className="panel sdl-sumda__notice is-warn" role="alert">
    <strong>Inventaris &amp; BMN tidak tersedia di server saat ini.</strong>
    <p>Layanan ini sedang dialihkan. Data tidak hilang; coba lagi beberapa saat lagi atau hubungi admin sistem.</p>
    {legacy && <button type="button" className="btn" onClick={() => setShowLegacy(v => !v)}>{showLegacy ? 'Sembunyikan' : 'Buka'} registry inventaris lama (darurat)</button>}
  </div>{showLegacy && legacy}</section>
  const aktif = tab === 'jadwal' ? 'jadwal' : 'daftar'
  return <section className="sdl-sumda">
    <nav className="sdl-sumda__tabs" aria-label="Bagian Inventaris & BMN">
      <button type="button" className={aktif === 'daftar' ? 'is-on' : ''} aria-pressed={aktif === 'daftar'} onClick={() => onTab('daftar')}>Daftar aset</button>
      <button type="button" className={aktif === 'jadwal' ? 'is-on' : ''} aria-pressed={aktif === 'jadwal'} onClick={() => onTab('jadwal')}>Jadwal pemeliharaan</button>
    </nav>
    {aktif === 'daftar' ? <DaftarAset caps={caps} onLost={lost} onOpen={setOpenId} refresh={refresh} /> : <JadwalAset onLost={lost} onOpen={setOpenId} refresh={refresh} />}
    {openId && <DetailAset id={openId} caps={caps} userId={userId} onClose={() => setOpenId(null)} onChanged={() => setRefresh(n => n + 1)} onLost={lost} onOpenFiles={onOpenFiles} />}
  </section>
}

function DaftarAset({ caps, onLost, onOpen, refresh }: { caps: Caps | null; onLost: () => void; onOpen: (id: string) => void; refresh: number }) {
  const [q, setQ] = useState(''); const [qLive, setQLive] = useState('')
  const [kategori, setKategori] = useState(''); const [kondisi, setKondisi] = useState(''); const [status, setStatus] = useState('')
  const [page, setPage] = useState(1); const [size, setSize] = useState(10)
  const [data, setData] = useState<{ items: Aset[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState<{ item: Aset | null } | null>(null)
  useEffect(() => { const t = setTimeout(() => setQ(qLive.trim()), 300); return () => clearTimeout(t) }, [qLive])
  useEffect(() => { setPage(1) }, [q, kategori, kondisi, status, size])
  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: String(size) })
    if (q) p.set('q', q); if (kategori) p.set('kategori', kategori); if (kondisi) p.set('kondisi', kondisi); if (status) p.set('status', status)
    try { setData(await api(`/aset?${p}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [q, kategori, kondisi, status, page, size, onLost])
  useEffect(() => { void load() }, [load, refresh])
  const pager = useMemo(() => ({ total: data?.total ?? 0, size, page, pageCount: Math.max(1, Math.ceil((data?.total ?? 0) / size)), start: (page - 1) * size, setSize, setPage } as PagerState), [data, size, page])
  return <>
    <div className="sdl-sumda__toolbar">
      <label className="sdl-sumda__search"><span className="sdl-sumda__sr">Cari aset</span>
        <input type="search" value={qLive} maxLength={100} placeholder="Cari kode BMN, nama, atau lokasi…" onChange={e => setQLive(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Kategori</span><select value={kategori} onChange={e => setKategori(e.target.value)}><option value="">Semua kategori</option>{KATEGORI.map(k => <option key={k}>{k}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Kondisi</span><select value={kondisi} onChange={e => setKondisi(e.target.value)}><option value="">Semua kondisi</option>{KONDISI.map(k => <option key={k}>{k}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="">Belum dihapus</option>{STATUS.map(s => <option key={s}>{s}</option>)}</select></label>
      <span className="sdl-sumda__grow" />
      {caps?.canManage && <button type="button" className="btn primary" onClick={() => setForm({ item: null })}>Tambah aset</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Aset</th><th>Kategori</th><th>Lokasi</th><th>Kondisi</th><th className="is-num">Pemeliharaan</th><th>Status</th></tr></thead>
        <tbody>
          {data === null ? <tr><td colSpan={6} className="sdl-sumda__muted">Memuat…</td></tr>
            : data.items.length === 0 ? <tr><td colSpan={6} className="sdl-sumda__empty"><strong>Belum ada aset yang cocok.</strong></td></tr>
              : data.items.map(a => <tr key={a.id} className="sdl-sumda__click" onClick={() => onOpen(a.id)}>
                <td><div className="sdl-sumda__who"><strong>{a.nama}</strong><span className="sdl-sumda__mono">{a.kodeBmn}</span></div>{a.salinan && <span className="sdl-sumda__flag">Salinan registry lama</span>}</td>
                <td>{a.kategori}</td>
                <td>{a.lokasi || '—'}</td>
                <td>{a.kondisi}</td>
                <td className="is-num"><span className="sdl-sumda__mono">{a.jadwalPemeliharaan ? tgl(a.jadwalPemeliharaan) : '—'}</span>{a.tahap && <small className="sdl-sumda__sub"><TahapBadge t={a.tahap} /></small>}</td>
                <td><StatusAsetBadge s={a.status} /></td>
              </tr>)}
        </tbody>
      </table></div>
      <Pager pager={pager} label="aset" />
    </div>
    {form && <FormAset item={form.item} onClose={() => setForm(null)} onSaved={id => { setForm(null); onOpen(id); void load() }} />}
  </>
}

function JadwalAset({ onLost, onOpen, refresh }: { onLost: () => void; onOpen: (id: string) => void; refresh: number }) {
  const [tahap, setTahap] = useState<Tahap | ''>('')
  const [data, setData] = useState<{ ringkas: Record<Tahap, number>; items: Aset[] } | null>(null)
  useEffect(() => {
    api<{ ringkas: Record<Tahap, number>; items: Aset[] }>(`/aset/jadwal${tahap ? `?tahap=${tahap}` : ''}`).then(setData).catch(e => { if (e instanceof TidakTersedia) onLost() })
  }, [tahap, onLost, refresh])
  return <>
    <nav className="sdl-sumda__tabs" aria-label="Saring tahap pemeliharaan">
      <button type="button" className={tahap === '' ? 'is-on' : ''} aria-pressed={tahap === ''} onClick={() => setTahap('')}>Semua</button>
      <button type="button" className={tahap === 'H-14' ? 'is-on' : ''} aria-pressed={tahap === 'H-14'} onClick={() => setTahap('H-14')}>H-14 <span>{data?.ringkas['H-14'] ?? '–'}</span></button>
      <button type="button" className={tahap === 'JATUH_TEMPO' ? 'is-on' : ''} aria-pressed={tahap === 'JATUH_TEMPO'} onClick={() => setTahap('JATUH_TEMPO')}>Jatuh tempo <span>{data?.ringkas.JATUH_TEMPO ?? '–'}</span></button>
    </nav>
    <p className="sdl-sumda__rule">Dihitung dari jadwal pemeliharaan (WIB) untuk aset Aktif/Pemeliharaan: H-14 = 1–14 hari lagi, Jatuh tempo = hari ini atau terlewat.</p>
    <div className="panel table-panel"><div className="table-scroll"><table className="data-table sdl-sumda__table">
      <thead><tr><th>Aset</th><th>Lokasi</th><th className="is-num">Jadwal</th><th>Tahap</th></tr></thead>
      <tbody>{data === null ? <tr><td colSpan={4} className="sdl-sumda__muted">Memuat…</td></tr>
        : data.items.length === 0 ? <tr><td colSpan={4} className="sdl-sumda__empty"><strong>Tidak ada pemeliharaan yang mendekat.</strong></td></tr>
          : data.items.map(a => <tr key={a.id} className="sdl-sumda__click" onClick={() => onOpen(a.id)}>
            <td><div className="sdl-sumda__who"><strong>{a.nama}</strong><span className="sdl-sumda__mono">{a.kodeBmn}</span></div></td>
            <td>{a.lokasi || '—'}</td><td className="is-num sdl-sumda__mono">{tgl(a.jadwalPemeliharaan)}</td><td><TahapBadge t={a.tahap} /></td></tr>)}</tbody>
    </table></div></div>
  </>
}

function FormAset({ item, onClose, onSaved }: { item: Aset | null; onClose: () => void; onSaved: (id: string) => void }) {
  const [v, setV] = useState({
    kodeBmn: item?.kodeBmn ?? '', nama: item?.nama ?? '', kategori: item?.kategori ?? 'Komputer', merekTipe: item?.merekTipe ?? '',
    tahunPerolehan: item?.tahunPerolehan ? String(item.tahunPerolehan) : '', jumlah: String(item?.jumlah ?? 1), satuan: item?.satuan ?? 'unit',
    lokasi: item?.lokasi ?? '', kondisi: item?.kondisi ?? 'Baik', jadwalPemeliharaan: item?.jadwalPemeliharaan ?? '', catatan: item?.catatan ?? '',
  })
  const [pj, setPj] = useState<{ id: string; label: string } | null>(item?.penanggungJawab.id ? { id: item.penanggungJawab.id, label: pjTeks(item) } : null)
  const [pjTeksV, setPjTeks] = useState(item?.penanggungJawab.teks ?? '')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    setBusy(true); setError('')
    const isi = { ...v, tahunPerolehan: v.tahunPerolehan ? Number(v.tahunPerolehan) : null, jumlah: Number(v.jumlah), penanggungJawabId: pj?.id ?? null, penanggungJawabTeks: pj ? '' : pjTeksV }
    try {
      const r = item ? await api<{ item: Aset }>(`/aset/${enc(item.id)}`, 'PATCH', { ...isi, version: item.version }) : await api<{ item: Aset }>('/aset', 'POST', isi)
      showToast('Aset disimpan.'); onSaved(r.item.id)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label={item ? 'Ubah aset' : 'Tambah aset'} busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">INVENTARIS &amp; BMN</span><h2>{item ? 'Ubah aset' : 'Tambah aset'}</h2></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label><span>Kode BMN<b aria-hidden="true"> *</b></span><input value={v.kodeBmn} maxLength={64} onChange={set('kodeBmn')} /><small>Huruf, angka, spasi, titik, garis miring, tanda hubung, kurung.</small></label>
        <label><span>Nama aset<b aria-hidden="true"> *</b></span><input value={v.nama} maxLength={200} onChange={set('nama')} /></label>
        <label><span>Kategori<b aria-hidden="true"> *</b></span><select value={v.kategori} onChange={set('kategori')}>{KATEGORI.map(k => <option key={k}>{k}</option>)}</select></label>
        <label><span>Merek / tipe</span><input value={v.merekTipe} maxLength={200} onChange={set('merekTipe')} /></label>
        <label><span>Tahun perolehan</span><input type="number" min={1900} max={2100} value={v.tahunPerolehan} onChange={set('tahunPerolehan')} /></label>
        <label><span>Jumlah<b aria-hidden="true"> *</b></span><span className="sdl-r5h31__jumlah"><input type="number" min={1} value={v.jumlah} onChange={set('jumlah')} /><input aria-label="Satuan" value={v.satuan} maxLength={32} onChange={set('satuan')} /></span></label>
        <label><span>Lokasi umum</span><input value={v.lokasi} maxLength={200} placeholder="Ruangan/gudang (bukan lokasi operasional)" onChange={set('lokasi')} /></label>
        <label><span>Kondisi<b aria-hidden="true"> *</b></span><select value={v.kondisi} onChange={set('kondisi')}>{KONDISI.map(k => <option key={k}>{k}</option>)}</select></label>
        <label><span>Jadwal pemeliharaan</span><input type="date" min="2000-01-01" max="2100-12-31" value={v.jadwalPemeliharaan} onChange={set('jadwalPemeliharaan')} /></label>
        <label className="sdl-sumda__wide"><span>Penanggung jawab</span>
          {pj ? <div className="sdl-karier__picked"><span><strong>{pj.label}</strong></span><button type="button" className="btn" onClick={() => setPj(null)}>Ganti</button></div>
            : <><CariPersonel statusAktif={false} onPilih={(p: PersonelCari) => { setPj({ id: p.id, label: `${p.nama} · ${p.nrp}` }); setPjTeks('') }} />
              <input value={pjTeksV} maxLength={200} placeholder="…atau tulis nama bila bukan personel terdata" onChange={e => setPjTeks(e.target.value)} /></>}</label>
        <label className="sdl-sumda__wide"><span>Catatan</span><textarea rows={2} maxLength={2000} value={v.catatan} onChange={set('catatan')} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></footer>
    </form>
  </Shade>
}

function DetailAset({ id, caps, userId, onClose, onChanged, onLost, onOpenFiles }: { id: string; caps: Caps | null; userId: string; onClose: () => void; onChanged: () => void; onLost: () => void; onOpenFiles?: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<null | 'usulkan' | 'tolak' | 'entri' | 'ubah'>(null)
  const muat = useCallback(async () => {
    try { setD(await api<Detail>(`/aset/${enc(id)}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [id, onLost])
  useEffect(() => { void muat() }, [muat])
  if (!d) return <Shade onClose={onClose} label="Detail aset"><p className="sdl-sumda__muted">{error || 'Memuat…'}</p><footer><button type="button" className="btn" onClick={onClose}>Tutup</button></footer></Shade>
  const a = d.item
  const kirim = async (aksi: string, extra: Record<string, unknown> = {}, pesan = 'Status diperbarui.') => {
    setBusy(true)
    try { await api(`/aset/${enc(a.id)}/aksi`, 'POST', { aksi, catatan: '', version: a.version, ...extra }); showToast(pesan); onChanged(); setDialog(null) }
    catch (e) { showToast((e as Error).message, 'error') } finally { setBusy(false); void muat() }
  }
  const kelola = Boolean(caps?.canManage)
  const bisaUbah = kelola && ['Aktif', 'Pemeliharaan'].includes(a.status)
  const usulan = a.status === 'Usulan Penghapusan'
  const pengusul = a.usulan?.oleh === userId
  return <Shade onClose={onClose} label={`Aset ${a.nama}`} busy={busy}>
    <header><span className="sdl-progar__eyebrow">INVENTARIS &amp; BMN</span><h2>{a.nama}</h2>
      <p><StatusAsetBadge s={a.status} /> <span className="sdl-sumda__mono">{a.kodeBmn}</span> · {a.kategori} <TahapBadge t={a.tahap} /></p></header>
    {a.salinan && <p className="sdl-sumda__notice">Disalin dari registry inventaris lama. {onOpenFiles && <button type="button" className="sdl-sumda__link" onClick={onOpenFiles}>Berkas lama di "Berkas, Foto &amp; Disposisi"</button>}</p>}
    {usulan && <p className="sdl-sumda__notice is-warn">Diusulkan dihapus oleh {a.usulan?.olehNama} ({a.usulan ? waktu(a.usulan.pada) : ''}): {a.usulan?.alasan}. Unggah SK/berita acara penghapusan sebelum Kasubbagsumda memutus. Selama usulan, data aset dibekukan.</p>}
    {a.status === 'Dihapus' && <p className="sdl-sumda__notice">Aset sudah dihapus{a.decidedByName ? ` (diputus ${a.decidedByName})` : ''}; data hanya-baca.</p>}
    <dl className="sdl-sumda__detail">
      <div><dt>Merek / tipe</dt><dd>{a.merekTipe || '—'}</dd></div><div><dt>Tahun perolehan</dt><dd className="sdl-sumda__mono">{a.tahunPerolehan ?? '—'}</dd></div>
      <div><dt>Jumlah</dt><dd>{a.jumlah} {a.satuan}</dd></div><div><dt>Lokasi</dt><dd>{a.lokasi || '—'}</dd></div>
      <div><dt>Kondisi</dt><dd>{a.kondisi}</dd></div><div><dt>Penanggung jawab</dt><dd>{pjTeks(a)}</dd></div>
      <div><dt>Jadwal pemeliharaan</dt><dd className="sdl-sumda__mono">{a.jadwalPemeliharaan ? tgl(a.jadwalPemeliharaan) : '—'}</dd></div>
    </dl>
    {a.catatan && <div className="sdl-sumda__catatan"><strong>Catatan</strong><p>{a.catatan}</p></div>}
    <section className="sdl-sumda__riwayat" aria-label="Riwayat pemeliharaan">
      <strong>Riwayat pemeliharaan{d.pemeliharaanTerpotong ? ' (200 terbaru)' : ''}</strong>
      {d.pemeliharaan.length === 0 ? <p className="sdl-sumda__muted">Belum ada catatan pemeliharaan.</p>
        : <ol>{d.pemeliharaan.map(e => <li key={e.id}><span className="sdl-sumda__mono">{tgl(e.tanggal)}</span>
          <span>{JENIS[e.jenis] ?? e.jenis} · {e.uraian}{e.pelaksana && ` (${e.pelaksana})`}{e.koreksiDari && ' · koreksi'}</span><span className="sdl-sumda__muted">{e.kondisi}{e.jadwalBerikutnya && ` → ${tgl(e.jadwalBerikutnya)}`}</span></li>)}</ol>}
      {bisaUbah && <button type="button" className="btn" onClick={() => setDialog('entri')}>Catat pemeliharaan</button>}
    </section>
    <LampiranPdf judul="Lampiran (SK, berita acara, faktur)" items={d.lampiran} urlUnduh={l => `/api/v1/subbagsumda/aset/${enc(a.id)}/lampiran/${enc(l.id)}`}
      unggah={async fd => { await api(`/aset/${enc(a.id)}/lampiran`, 'POST', fd); void muat() }} hapus={async l => { await api(`/aset/${enc(a.id)}/lampiran/${enc(l.id)}`, 'DELETE'); void muat() }}
      bisaUnggah={kelola && a.status !== 'Dihapus'} bisaHapus={l => kelola && a.status !== 'Dihapus' && (l.uploadedBy === userId || Boolean(caps?.canApprove))} />
    <section className="sdl-sumda__riwayat" aria-label="Riwayat status">
      <strong>Riwayat status</strong>
      <ol>{d.riwayat.map((h, i) => <li key={i}><span className="sdl-sumda__mono">{waktu(h.pada)}</span><span>{h.dari ? `${h.dari} → ${h.ke}` : h.ke}{h.catatan && ` — ${h.catatan}`}</span><span className="sdl-sumda__muted">{h.oleh}</span></li>)}</ol>
    </section>
    <footer>
      {bisaUbah && <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setDialog('usulkan')}>Usulkan penghapusan</button>}
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={onClose}>Tutup</button>
      {bisaUbah && <button type="button" className="btn" onClick={() => setDialog('ubah')}>Ubah</button>}
      {kelola && a.status === 'Aktif' && <button type="button" className="btn" disabled={busy} onClick={() => void kirim('pemeliharaan', {}, 'Aset ditandai dalam pemeliharaan.')}>Tandai pemeliharaan</button>}
      {kelola && a.status === 'Pemeliharaan' && <button type="button" className="btn primary" disabled={busy} onClick={() => void kirim('aktifkan', {}, 'Aset aktif kembali.')}>Aktifkan kembali</button>}
      {caps?.canApprove && usulan && !pengusul && <>
        <button type="button" className="btn" disabled={busy} onClick={() => setDialog('tolak')}>Tolak usulan</button>
        <button type="button" className="btn primary sdl-progar__danger" disabled={busy} onClick={() => void kirim('setujui_hapus', {}, 'Aset dihapus.')}>Setujui penghapusan</button></>}
    </footer>
    {dialog === 'usulkan' && <AlasanDialog judul="Usulkan penghapusan BMN" onClose={() => setDialog(null)} onSubmit={x => kirim('usulkan_hapus', { catatan: x }, 'Usulan penghapusan dibuat.')} />}
    {dialog === 'tolak' && <AlasanDialog judul="Tolak usulan penghapusan" onClose={() => setDialog(null)} onSubmit={x => kirim('tolak_hapus', { catatan: x }, 'Usulan ditolak.')} />}
    {dialog === 'entri' && <FormEntri a={a} entri={d.pemeliharaan} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged(); void muat() }} />}
    {dialog === 'ubah' && <FormAset item={a} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); onChanged(); void muat() }} />}
  </Shade>
}

function FormEntri({ a, entri, onClose, onSaved }: { a: Aset; entri: Entri[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ tanggal: hariIniWib(), jenis: 'RUTIN', uraian: '', pelaksana: '', kondisi: a.kondisi, jadwalBerikutnya: '', koreksiDari: '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    if (v.jenis === 'RUTIN' && !v.jadwalBerikutnya) return setError('Pemeliharaan rutin wajib punya jadwal berikutnya.')
    setBusy(true); setError('')
    try { await api(`/aset/${enc(a.id)}/pemeliharaan`, 'POST', { ...v, koreksiDari: v.koreksiDari || null, version: a.version }); showToast('Pemeliharaan dicatat.'); onSaved() }
    catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return <Shade onClose={onClose} label="Catat pemeliharaan" busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void submit(e)}>
      <header><span className="sdl-progar__eyebrow">INVENTARIS &amp; BMN</span><h2>Catat pemeliharaan</h2><p>Kondisi dan jadwal aset ikut diperbarui. Entri tidak bisa diubah; salah catat → buat entri koreksi.</p></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        <label><span>Tanggal<b aria-hidden="true"> *</b></span><input type="date" min="2000-01-01" max={hariIniWib()} value={v.tanggal} onChange={set('tanggal')} /></label>
        <label><span>Jenis<b aria-hidden="true"> *</b></span><select value={v.jenis} onChange={set('jenis')}>{Object.entries(JENIS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="sdl-sumda__wide"><span>Uraian<b aria-hidden="true"> *</b></span><textarea rows={2} maxLength={1000} value={v.uraian} onChange={set('uraian')} /></label>
        <label><span>Pelaksana</span><input value={v.pelaksana} maxLength={200} onChange={set('pelaksana')} /></label>
        <label><span>Kondisi sesudahnya<b aria-hidden="true"> *</b></span><select value={v.kondisi} onChange={set('kondisi')}>{KONDISI.map(k => <option key={k}>{k}</option>)}</select></label>
        <label><span>Jadwal berikutnya{v.jenis === 'RUTIN' && <b aria-hidden="true"> *</b>}</span><input type="date" min={v.tanggal} max="2100-12-31" value={v.jadwalBerikutnya} onChange={set('jadwalBerikutnya')} /></label>
        {entri.length > 0 && <label><span>Koreksi atas entri</span><select value={v.koreksiDari} onChange={set('koreksiDari')}><option value="">— bukan koreksi —</option>{entri.map(e => <option key={e.id} value={e.id}>{tgl(e.tanggal)} · {JENIS[e.jenis]} · {e.uraian.slice(0, 30)}</option>)}</select></label>}
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>Simpan</button></footer>
    </form>
  </Shade>
}
