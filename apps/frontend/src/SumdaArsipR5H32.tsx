import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Pager, type PagerState } from './PaginationR5H5'
import { AlasanDialog, CariPersonel, LampiranPdf, Shade, TidakTersedia, UUID_RE, makeApi, tgl, waktu, type LampiranItem, type PersonelCari } from './SumdaBersama'
import { showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './SumdaPersonelR5H27.css'
import './SumdaKarierR5H28.css'
import './SumdaLayananR5H30.css'
import './SumdaR5H32.css'

/**
 * R5H32: Subbagsumda — Persuratan & Arsip (register arsip dokumen: SK, nota dinas, surat eksternal, berita acara).
 * Backend /api/v1/subbagsumda/arsip (Express saja, migrasi 073). Surat Masuk/Keluar R5H21 tetap di menunya sendiri;
 * surat yang sudah dikirim/diterima Sumda bisa ditautkan. Arsip TERBATAS hanya terlihat oleh pencatat, Kasubbagsumda,
 * dan Kabagrenmin — penyaringannya di server; bagi akun lain arsip itu tidak ada.
 */

type Status = 'Aktif' | 'Inaktif' | 'Musnah'
type TahapRetensi = 'H-30' | 'JATUH_TEMPO'
type Arsip = {
  id: string; nomor: string; jenis: string; perihal: string; tanggal: string; asalTujuan: string; kodeKlasifikasi: string; lokasiSimpan: string
  retensiSampai: string; sisaRetensi: number | null; tahapRetensi: TahapRetensi | null; kerahasiaan: 'BIASA' | 'TERBATAS'; catatan: string
  personel: { id: string; nama: string; nrp: string; terarsip: boolean } | null; suratId: string | null; status: Status
  musnah: { olehNama: string; pada: string } | null; createdBy: string; createdByName: string; version: number
}
type Surat = { id?: string; arah?: 'masuk' | 'keluar'; nomor?: string; tanggal?: string; perihal?: string; unitPengirim?: string; dibatasi?: true; hilang?: true }
type SuratPilihan = { id: string; arah: 'masuk' | 'keluar'; nomor: string; tanggal: string; perihal: string; unitPengirim: string; kodeArsip: string; tujuan: string[] }
type Lampiran = LampiranItem & { peran: 'DOKUMEN' | 'BA_MUSNAH' }
type Detail = { item: Arsip; surat: Surat | null; lampiran: Lampiran[]; riwayat: { dari: string | null; ke: string; catatan: string; oleh: string; pada: string }[] }
type Caps = { canRead: boolean; canManage: boolean; canRestricted: boolean; canTautSurat: boolean }

export const JENIS_ARSIP: Record<string, string> = {
  SURAT_MASUK: 'Surat masuk', SURAT_KELUAR: 'Surat keluar', NOTA_DINAS: 'Nota dinas', SURAT_KEPUTUSAN: 'Surat keputusan',
  BERITA_ACARA: 'Berita acara', LAINNYA: 'Lainnya',
}
const STATUS: Status[] = ['Aktif', 'Inaktif', 'Musnah']
const UNIT: Record<string, string> = { urmin: 'Urmin', subbagren: 'Subbagren', subbagsumda: 'Subbagsumda', subbagbinfung: 'Subbagbinfung' }

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali (retensi tidak boleh sebelum tanggal dokumen).',
  invalid_body: 'Isian tidak dapat diproses.',
  version_conflict: 'Data sudah diubah orang lain. Data dimuat ulang; periksa lalu ulangi.',
  status_tidak_sesuai: 'Tindakan ini tidak berlaku untuk status arsip sekarang (arsip Musnah hanya-baca; pemusnahan hanya dari Inaktif).',
  lampiran_wajib: 'Unggah berita acara pemusnahan (PDF) di bagian "Berita acara pemusnahan" dulu.',
  surat_tidak_berlaku: 'Surat itu tidak bisa ditautkan: harus surat yang sudah dikirim Subbagsumda, atau surat masuk yang sudah ditandai diterima.',
  surat_sudah_diarsip: 'Surat itu sudah ditautkan ke arsip lain.',
  personel_terarsip: 'Personel itu sudah diarsipkan; pilih personel lain.',
  batas_lampiran: 'Batas 10 lampiran tercapai.',
  file_too_large: 'Berkas lebih dari 5 MB.',
  one_file_required: 'Unggah tepat satu berkas.',
  invalid_file_type: 'Berkas harus PDF yang sah dan tidak terkunci kata sandi (nama berakhiran .pdf).',
  evidence_encryption_unavailable: 'Penyimpanan berkas aman sedang tidak tersedia. Hubungi admin sistem.',
  evidence_integrity_failure: 'Berkas tidak lolos pemeriksaan keutuhan. Hubungi admin sistem.',
  not_found: 'Arsip tidak ditemukan atau tidak dapat dibuka akun ini.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
const api = makeApi(ERRORS, 'Persuratan & Arsip tidak tersedia di server saat ini.')
const enc = encodeURIComponent

function RetensiBadge({ t, sisa }: { t: TahapRetensi | null; sisa?: number | null }) {
  if (!t) return null
  return <span className={`sdl-sumda__tahap ${t === 'JATUH_TEMPO' ? 'is-due' : 'is-h-7'}`} title={sisa !== null && sisa !== undefined ? `${sisa} hari` : undefined}>
    {t === 'JATUH_TEMPO' ? 'Retensi habis' : 'Retensi ≤ 30 hari'}</span>
}
function StatusBadge({ s }: { s: Status }) {
  return <span className={`sdl-r5h32__status is-${s.toLowerCase()}`}>{s}</span>
}
function Terbatas() {
  return <span className="sdl-r5h32__terbatas" title="Hanya pencatat, Kasubbagsumda, dan Kabagrenmin">Terbatas</span>
}

export default function SumdaArsipR5H32({ initialID, userId, onOpenSurat }: { initialID?: string; userId: string; onOpenSurat: (arah: 'masuk' | 'keluar', id: string) => void }) {
  const [unavailable, setUnavailable] = useState(false)
  const lost = useCallback(() => setUnavailable(true), [])
  const [caps, setCaps] = useState<Caps | null>(null)
  useEffect(() => { api<Caps>('/arsip/capabilities').then(setCaps).catch(e => { if (e instanceof TidakTersedia) lost() }) }, [lost])
  const [openId, setOpenId] = useState<string | null>(initialID && UUID_RE.test(initialID) ? initialID : null)
  const [refresh, setRefresh] = useState(0)
  if (unavailable) return <section className="sdl-sumda"><div className="panel sdl-sumda__notice is-warn" role="alert">
    <strong>Persuratan &amp; Arsip tidak tersedia di server saat ini.</strong>
    <p>Layanan ini sedang dialihkan. Data tidak hilang; coba lagi beberapa saat lagi atau hubungi admin sistem. Surat Masuk/Keluar tetap bisa dibuka dari menunya.</p>
  </div></section>
  return <section className="sdl-sumda">
    <DaftarArsip caps={caps} onLost={lost} onOpen={setOpenId} refresh={refresh} />
    {openId && <DetailArsip id={openId} caps={caps} userId={userId} onClose={() => setOpenId(null)} onChanged={() => setRefresh(n => n + 1)} onLost={lost} onOpenSurat={onOpenSurat} />}
  </section>
}

function DaftarArsip({ caps, onLost, onOpen, refresh }: { caps: Caps | null; onLost: () => void; onOpen: (id: string) => void; refresh: number }) {
  const [q, setQ] = useState(''); const [qLive, setQLive] = useState('')
  const [jenis, setJenis] = useState(''); const [status, setStatus] = useState(''); const [tahun, setTahun] = useState('')
  const [kerahasiaan, setKerahasiaan] = useState(''); const [retensi, setRetensi] = useState(false)
  const [page, setPage] = useState(1); const [size, setSize] = useState(10)
  const [data, setData] = useState<{ items: Arsip[]; total: number } | null>(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState(false)
  useEffect(() => { const t = setTimeout(() => setQ(qLive.trim()), 300); return () => clearTimeout(t) }, [qLive])
  useEffect(() => { setPage(1) }, [q, jenis, status, tahun, kerahasiaan, retensi, size])
  const load = useCallback(async () => {
    const p = new URLSearchParams({ page: String(page), size: String(size) })
    if (q) p.set('q', q); if (jenis) p.set('jenis', jenis); if (status) p.set('status', status)
    if (/^\d{4}$/.test(tahun)) p.set('tahun', tahun); if (kerahasiaan) p.set('kerahasiaan', kerahasiaan); if (retensi) p.set('retensi', '1')
    try { setData(await api(`/arsip?${p}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [q, jenis, status, tahun, kerahasiaan, retensi, page, size, onLost])
  useEffect(() => { void load() }, [load, refresh])
  const pager = useMemo(() => ({ total: data?.total ?? 0, size, page, pageCount: Math.max(1, Math.ceil((data?.total ?? 0) / size)), start: (page - 1) * size, setSize, setPage } as PagerState), [data, size, page])
  return <>
    <div className="sdl-sumda__toolbar">
      <label className="sdl-sumda__search"><span className="sdl-sumda__sr">Cari arsip</span>
        <input type="search" value={qLive} maxLength={100} placeholder="Cari nomor, perihal, asal/tujuan, atau kode…" onChange={e => setQLive(e.target.value)} /></label>
      <label><span className="sdl-sumda__sr">Jenis</span><select value={jenis} onChange={e => setJenis(e.target.value)}><option value="">Semua jenis</option>{Object.entries(JENIS_ARSIP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Status</span><select value={status} onChange={e => setStatus(e.target.value)}><option value="">Semua status</option>{STATUS.map(s => <option key={s}>{s}</option>)}</select></label>
      <label><span className="sdl-sumda__sr">Tahun dokumen</span><input className="sdl-r5h32__tahun" inputMode="numeric" maxLength={4} placeholder="Tahun" value={tahun} onChange={e => setTahun(e.target.value.replace(/\D/g, ''))} /></label>
      {caps?.canRestricted && <label><span className="sdl-sumda__sr">Kerahasiaan</span><select value={kerahasiaan} onChange={e => setKerahasiaan(e.target.value)}><option value="">Semua kerahasiaan</option><option value="BIASA">Biasa</option><option value="TERBATAS">Terbatas</option></select></label>}
      <label className="sdl-r5h32__cek"><input type="checkbox" checked={retensi} onChange={e => setRetensi(e.target.checked)} /> Retensi ≤ 30 hari</label>
      <span className="sdl-sumda__grow" />
      {caps?.canManage && <button type="button" className="btn primary" onClick={() => setForm(true)}>Catat arsip</button>}
    </div>
    {error && <p className="sdl-progar__error" role="alert">{error}</p>}
    <div className="panel table-panel">
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Dokumen</th><th>Jenis</th><th className="is-num">Tanggal</th><th>Lokasi simpan</th><th className="is-num">Retensi</th><th>Status</th></tr></thead>
        <tbody>
          {data === null ? <tr><td colSpan={6} className="sdl-sumda__muted">Memuat…</td></tr>
            : data.items.length === 0 ? <tr><td colSpan={6} className="sdl-sumda__empty"><strong>Belum ada arsip yang cocok.</strong></td></tr>
              : data.items.map(a => <tr key={a.id} className="sdl-sumda__click" onClick={() => onOpen(a.id)}>
                <td><div className="sdl-sumda__who"><strong>{a.perihal}</strong><span className="sdl-sumda__mono">{a.nomor || 'Tanpa nomor'}{a.kodeKlasifikasi && ` · ${a.kodeKlasifikasi}`}</span></div>
                  {a.kerahasiaan === 'TERBATAS' && <Terbatas />}{a.suratId && <span className="sdl-sumda__flag">Surat tertaut</span>}</td>
                <td>{JENIS_ARSIP[a.jenis] ?? a.jenis}</td>
                <td className="is-num sdl-sumda__mono">{tgl(a.tanggal)}</td>
                <td>{a.lokasiSimpan || '—'}</td>
                <td className="is-num"><span className="sdl-sumda__mono">{a.retensiSampai ? tgl(a.retensiSampai) : '—'}</span>{a.tahapRetensi && <small className="sdl-sumda__sub"><RetensiBadge t={a.tahapRetensi} sisa={a.sisaRetensi} /></small>}</td>
                <td><StatusBadge s={a.status} /></td>
              </tr>)}
        </tbody>
      </table></div>
      <Pager pager={pager} label="arsip" />
    </div>
    {form && <FormArsip item={null} caps={caps} onClose={() => setForm(false)} onSaved={id => { setForm(false); if (id) onOpen(id); void load() }} />}
  </>
}

function FormArsip({ item, caps, onClose, onSaved }: { item: Arsip | null; caps: Caps | null; onClose: () => void; onSaved: (id: string | null) => void }) {
  const [v, setV] = useState({
    nomor: item?.nomor ?? '', jenis: item?.jenis ?? 'SURAT_KEPUTUSAN', perihal: item?.perihal ?? '', tanggal: item?.tanggal ?? '',
    asalTujuan: item?.asalTujuan ?? '', kodeKlasifikasi: item?.kodeKlasifikasi ?? '', lokasiSimpan: item?.lokasiSimpan ?? '',
    retensiSampai: item?.retensiSampai ?? '', kerahasiaan: item?.kerahasiaan ?? 'BIASA', catatan: item?.catatan ?? '',
  })
  const [personel, setPersonel] = useState<{ id: string; label: string } | null>(item?.personel ? { id: item.personel.id, label: `${item.personel.nama} · ${item.personel.nrp}${item.personel.terarsip ? ' (terarsip)' : ''}` } : null)
  const [suratId, setSuratId] = useState<string | null>(item?.suratId ?? null)
  const [surat, setSurat] = useState<SuratPilihan[] | null>(null)
  const [kode, setKode] = useState<{ code: string; name: string }[]>([])
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(s => ({ ...s, [k]: e.target.value }))
  const bisaTaut = Boolean(caps?.canTautSurat)
  useEffect(() => { if (bisaTaut) api<{ items: SuratPilihan[] }>('/arsip/surat-tertaut').then(r => setSurat(r.items)).catch(() => setSurat([])) }, [bisaTaut])
  useEffect(() => {
    const h = setTimeout(() => {
      fetch(`/api/v1/urmin/kode-arsip?q=${enc(v.kodeKlasifikasi.trim())}`, { credentials: 'same-origin', cache: 'no-store' })
        .then(r => r.ok ? r.json() : { items: [] }).then((d: { items?: { code: string; name: string }[] }) => setKode((d.items ?? []).slice(0, 30))).catch(() => setKode([]))
    }, 250)
    return () => clearTimeout(h)
  }, [v.kodeKlasifikasi])
  function pilihSurat(id: string) {
    setSuratId(id || null)
    const s = surat?.find(x => x.id === id)
    if (!s || item) return
    // Memilih surat mengisi form; isian tetap milik arsip ini dan boleh diubah.
    setV(x => ({ ...x, nomor: s.nomor || x.nomor, tanggal: s.tanggal || x.tanggal, perihal: s.perihal, jenis: s.arah === 'masuk' ? 'SURAT_MASUK' : 'SURAT_KELUAR',
      kodeKlasifikasi: s.kodeArsip || x.kodeKlasifikasi,
      asalTujuan: s.arah === 'masuk' ? (UNIT[s.unitPengirim] ?? s.unitPengirim) : s.tujuan.map(t => UNIT[t] ?? t).join(', ').slice(0, 200) }))
  }
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return
    if (!v.tanggal) return setError('Tanggal dokumen wajib diisi.')
    if (v.retensiSampai && v.retensiSampai < v.tanggal) return setError('Retensi tidak boleh sebelum tanggal dokumen.')
    setBusy(true); setError('')
    const isi = { ...v, personelId: personel?.id ?? null, suratId }
    try {
      if (item) {
        const r = await api<{ item: Arsip | null; tersembunyi?: boolean }>(`/arsip/${enc(item.id)}`, 'PATCH', { ...isi, version: item.version })
        if (r.tersembunyi) { showToast('Arsip kini Terbatas dan tidak lagi dapat dibuka akun ini.'); onSaved(null); return }
        showToast('Arsip disimpan.'); onSaved(r.item?.id ?? null)
      } else {
        const r = await api<{ item: Arsip }>('/arsip', 'POST', isi)
        showToast('Arsip dicatat.'); onSaved(r.item.id)
      }
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  const pilihanSurat = surat?.filter(s => s.id !== item?.suratId) ?? []
  const turunTerbatas = item?.kerahasiaan === 'TERBATAS' && !caps?.canRestricted
  return <Shade onClose={onClose} label={item ? 'Ubah arsip' : 'Catat arsip'} busy={busy}>
    <form className="sdl-sumda__form" onSubmit={e => void submit(e)}>
      <header><h2>{item ? 'Ubah arsip' : 'Catat arsip'}</h2><p>Dokumen yang disimpan Subbagsumda di luar alur Surat Masuk/Keluar: SK, nota dinas, surat eksternal, berita acara.</p></header>
      <div className="sdl-progar__fields sdl-sumda__grid">
        {bisaTaut && <label className="sdl-sumda__wide"><span>Tautkan surat (opsional)</span>
          <select value={suratId ?? ''} onChange={e => pilihSurat(e.target.value)}>
            <option value="">— tanpa tautan surat —</option>
            {item?.suratId && <option value={item.suratId}>Surat yang sudah tertaut</option>}
            {pilihanSurat.map(s => <option key={s.id} value={s.id}>{s.arah === 'masuk' ? 'Masuk' : 'Keluar'} · {s.nomor || 'tanpa nomor'} · {s.perihal.slice(0, 70)}</option>)}
          </select>
          <small>Surat Masuk/Keluar yang sudah dikirim atau diterima Subbagsumda dan belum diarsipkan.</small></label>}
        <label><span>Jenis<b aria-hidden="true"> *</b></span><select value={v.jenis} onChange={set('jenis')}>{Object.entries(JENIS_ARSIP).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label><span>Nomor dokumen</span><input value={v.nomor} maxLength={120} onChange={set('nomor')} /></label>
        <label className="sdl-sumda__wide"><span>Perihal<b aria-hidden="true"> *</b></span><input value={v.perihal} maxLength={240} onChange={set('perihal')} /></label>
        <label><span>Tanggal dokumen<b aria-hidden="true"> *</b></span><input type="date" min="1950-01-01" max="2100-12-31" value={v.tanggal} onChange={set('tanggal')} /></label>
        <label><span>Asal / tujuan</span><input value={v.asalTujuan} maxLength={200} onChange={set('asalTujuan')} /></label>
        <label><span>Kode klasifikasi</span><input list="sdl-r5h32-kode" value={v.kodeKlasifikasi} maxLength={60} onChange={set('kodeKlasifikasi')} />
          <datalist id="sdl-r5h32-kode">{kode.map(k => <option key={k.code} value={k.code}>{k.name}</option>)}</datalist></label>
        <label><span>Lokasi simpan</span><input value={v.lokasiSimpan} maxLength={200} placeholder="Lemari / rak / map" onChange={set('lokasiSimpan')} /></label>
        <label><span>Retensi sampai</span><input type="date" min={v.tanggal || '1950-01-01'} max="2100-12-31" value={v.retensiSampai} onChange={set('retensiSampai')} /></label>
        <label><span>Kerahasiaan<b aria-hidden="true"> *</b></span><select value={v.kerahasiaan} disabled={turunTerbatas} onChange={set('kerahasiaan')}><option value="BIASA">Biasa</option><option value="TERBATAS">Terbatas</option></select>
          <small>{turunTerbatas ? 'Hanya Kasubbagsumda/Kabagrenmin yang bisa menurunkan ke Biasa.' : 'Terbatas: hanya pencatat, Kasubbagsumda, dan Kabagrenmin yang bisa melihat.'}</small></label>
        <label className="sdl-sumda__wide"><span>Personel terkait (opsional)</span>
          {personel ? <div className="sdl-karier__picked"><span><strong>{personel.label}</strong></span><button type="button" className="btn" onClick={() => setPersonel(null)}>Lepas</button></div>
            : <CariPersonel statusAktif={false} onPilih={(p: PersonelCari) => setPersonel({ id: p.id, label: `${p.nama} · ${p.nrp}` })} />}</label>
        <label className="sdl-sumda__wide"><span>Catatan</span><textarea rows={2} maxLength={2000} value={v.catatan} onChange={set('catatan')} /></label>
      </div>
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button><button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</button></footer>
    </form>
  </Shade>
}

function DetailArsip({ id, caps, userId, onClose, onChanged, onLost, onOpenSurat }: { id: string; caps: Caps | null; userId: string; onClose: () => void; onChanged: () => void; onLost: () => void; onOpenSurat: (arah: 'masuk' | 'keluar', id: string) => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<null | 'musnah' | 'ubah'>(null)
  const muat = useCallback(async () => {
    try { setD(await api<Detail>(`/arsip/${enc(id)}`)); setError('') } catch (e) { if (e instanceof TidakTersedia) onLost(); else setError((e as Error).message) }
  }, [id, onLost])
  useEffect(() => { void muat() }, [muat])
  if (!d) return <Shade onClose={onClose} label="Detail arsip"><p className="sdl-sumda__muted">{error || 'Memuat…'}</p><footer><button type="button" className="btn" onClick={onClose}>Tutup</button></footer></Shade>
  const a = d.item
  const kirim = async (aksi: string, extra: Record<string, unknown> = {}, pesan = 'Status diperbarui.') => {
    setBusy(true)
    try { await api(`/arsip/${enc(a.id)}/aksi`, 'POST', { aksi, catatan: '', version: a.version, ...extra }); showToast(pesan); onChanged(); setDialog(null) }
    catch (e) { showToast((e as Error).message, 'error') } finally { setBusy(false); void muat() }
  }
  const kelola = Boolean(caps?.canManage)
  const final = a.status === 'Musnah'
  const dok = d.lampiran.filter(l => l.peran !== 'BA_MUSNAH')
  const ba = d.lampiran.filter(l => l.peran === 'BA_MUSNAH')
  // Batas 10 berlaku untuk gabungan dokumen + berita acara (server); tombol unggah hilang bila kuota gabungan habis.
  const lamp = (peran: 'DOKUMEN' | 'BA_MUSNAH', items: Lampiran[], judul: string, sisa: number) => <LampiranPdf judul={judul} items={items} maks={10}
    urlUnduh={l => `/api/v1/subbagsumda/arsip/${enc(a.id)}/lampiran/${enc(l.id)}`}
    unggah={async fd => { await api(`/arsip/${enc(a.id)}/lampiran?peran=${peran}`, 'POST', fd); void muat() }}
    hapus={async l => { await api(`/arsip/${enc(a.id)}/lampiran/${enc(l.id)}`, 'DELETE'); void muat() }}
    bisaUnggah={kelola && !final && sisa > 0} bisaHapus={l => kelola && !final && (l.uploadedBy === userId || Boolean(caps?.canRestricted))} />
  const sisa = Math.max(0, 10 - d.lampiran.length)
  return <Shade onClose={onClose} label={`Arsip ${a.perihal}`} busy={busy}>
    <header><h2>{a.perihal}</h2>
      <p><StatusBadge s={a.status} /> {a.kerahasiaan === 'TERBATAS' && <Terbatas />} <span className="sdl-sumda__mono">{a.nomor || 'Tanpa nomor'}</span> · {JENIS_ARSIP[a.jenis] ?? a.jenis} <RetensiBadge t={a.tahapRetensi} sisa={a.sisaRetensi} /></p></header>
    {final && <p className="sdl-sumda__notice">Arsip sudah dimusnahkan{a.musnah ? ` oleh ${a.musnah.olehNama} (${waktu(a.musnah.pada)})` : ''}. Catatan dan lampiran disimpan sebagai bukti; data hanya-baca.</p>}
    <dl className="sdl-sumda__detail">
      <div><dt>Tanggal dokumen</dt><dd className="sdl-sumda__mono">{tgl(a.tanggal)}</dd></div><div><dt>Asal / tujuan</dt><dd>{a.asalTujuan || '—'}</dd></div>
      <div><dt>Kode klasifikasi</dt><dd className="sdl-sumda__mono">{a.kodeKlasifikasi || '—'}</dd></div><div><dt>Lokasi simpan</dt><dd>{a.lokasiSimpan || '—'}</dd></div>
      <div><dt>Retensi sampai</dt><dd className="sdl-sumda__mono">{a.retensiSampai ? tgl(a.retensiSampai) : '—'}</dd></div>
      <div><dt>Personel terkait</dt><dd>{a.personel ? `${a.personel.nama} · ${a.personel.nrp}${a.personel.terarsip ? ' (terarsip)' : ''}` : '—'}</dd></div>
      <div><dt>Dicatat oleh</dt><dd>{a.createdByName || '—'}</dd></div>
    </dl>
    {d.surat && <div className="sdl-sumda__catatan"><strong>Surat tertaut</strong>
      {d.surat.hilang ? <p className="sdl-sumda__muted">Surat yang ditautkan sudah tidak ada di sistem.</p>
        : d.surat.dibatasi ? <p className="sdl-sumda__muted">Akun ini tidak memiliki akses persuratan untuk melihat surat tertaut.</p>
          : <p><span className="sdl-sumda__mono">{d.surat.nomor || 'Tanpa nomor'}</span> · {d.surat.perihal} · {d.surat.arah === 'masuk' ? `dari ${UNIT[d.surat.unitPengirim ?? ''] ?? d.surat.unitPengirim}` : 'surat keluar'}{' '}
            <button type="button" className="sdl-sumda__link" onClick={() => onOpenSurat(d.surat!.arah!, d.surat!.id!)}>Buka di Surat {d.surat.arah === 'masuk' ? 'Masuk' : 'Keluar'}</button></p>}</div>}
    {a.catatan && <div className="sdl-sumda__catatan"><strong>Catatan</strong><p>{a.catatan}</p></div>}
    {lamp('DOKUMEN', dok, 'Dokumen', sisa)}
    {(a.status !== 'Aktif' || ba.length > 0) && lamp('BA_MUSNAH', ba, 'Berita acara pemusnahan', sisa)}
    <section className="sdl-sumda__riwayat" aria-label="Riwayat status">
      <strong>Riwayat status</strong>
      <ol>{d.riwayat.map((h, i) => <li key={i}><span className="sdl-sumda__mono">{waktu(h.pada)}</span><span>{h.dari ? `${h.dari} → ${h.ke}` : `Dicatat (${h.ke})`}{h.catatan && ` — ${h.catatan}`}</span><span className="sdl-sumda__muted">{h.oleh}</span></li>)}</ol>
    </section>
    <footer>
      {kelola && caps?.canRestricted && a.status === 'Inaktif' && <button type="button" className="btn sdl-progar__danger" disabled={busy} onClick={() => setDialog('musnah')}>Musnahkan</button>}
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={onClose}>Tutup</button>
      {kelola && !final && <button type="button" className="btn" onClick={() => setDialog('ubah')}>Ubah</button>}
      {kelola && a.status === 'Aktif' && <button type="button" className="btn" disabled={busy} onClick={() => void kirim('inaktifkan', {}, 'Arsip dipindah ke Inaktif.')}>Jadikan inaktif</button>}
      {kelola && a.status === 'Inaktif' && <button type="button" className="btn primary" disabled={busy} onClick={() => void kirim('aktifkan', {}, 'Arsip aktif kembali.')}>Aktifkan kembali</button>}
    </footer>
    {dialog === 'musnah' && <AlasanDialog judul="Musnahkan arsip" petunjuk={ba.length ? 'Tindakan final: arsip menjadi hanya-baca.' : 'Unggah berita acara pemusnahan (PDF) lebih dulu; tanpa itu pemusnahan ditolak.'}
      onClose={() => setDialog(null)} onSubmit={x => kirim('musnahkan', { catatan: x }, 'Arsip dimusnahkan.')} />}
    {dialog === 'ubah' && <FormArsip item={a} caps={caps} onClose={() => setDialog(null)} onSaved={nid => { setDialog(null); onChanged(); if (nid) void muat(); else onClose() }} />}
  </Shade>
}
