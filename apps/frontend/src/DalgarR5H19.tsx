import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { rupiah } from './ProgarR5H11'
import { BULAN } from './DokumenTahapR5H16'
import { fmtUnduh } from './MyinterestR5H20'
import './ProgarR5H11.css'

/**
 * R5H19 (2026-11-18): menu DALGAR tersambung ke angka anggaran/realisasi.
 *
 *  - RingkasanRealisasi: LRA, Laporan Penggunaan Anggaran, EKA PN, dan Hibah
 *    menampilkan realisasi terverifikasi per pos. Angka sementara selama Dalam
 *    proses; potret tetap setelah laporan ditandai Selesai.
 *  - RevisiAnggaran: daftar perubahan Revisi POK (anggaran baru per pos) atau
 *    Revisi RPD (rencana 12 bulan per pos). Diterapkan saat revisi ditandai Selesai.
 *  - RpdDialog: RPD awal satu pos (menu Realisasi Anggaran).
 */

export const RINGKASAN_JENIS = ['lap_lra', 'lap_penggunaan_anggaran', 'lap_eka_pn', 'lap_hibah']
export const REVISI_ANGGARAN = ['revisi_pok', 'revisi_rpd']

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang melakukan tindakan tersebut.',
  invalid_input: 'Isian belum lengkap atau tidak sesuai. Periksa kembali.',
  invalid_body: 'Isian tidak dapat diproses (terlalu banyak data).',
  version_conflict: 'Data sudah diubah orang lain. Tutup lalu buka kembali.',
  dokumen_terkunci: 'Revisi ini sudah Selesai; daftar perubahannya tidak bisa diubah lagi.',
  pos_tidak_aktif: 'Salah satu dokumen tidak lagi Final atau sudah digantikan revisi.',
  tahun_tidak_cocok: 'Dokumen harus setahun anggaran dengan revisinya.',
  anggaran_di_bawah_realisasi: 'Anggaran baru tidak boleh lebih kecil dari realisasi yang sudah terverifikasi.',
  rpd_tidak_sama_anggaran: 'Total RPD 12 bulan harus sama dengan anggaran dokumennya.',
  rpd_sudah_ada: 'RPD dokumen ini sudah diisi. Perubahan dibuat lewat Revisi RPD di menu Revisi Anggaran.',
  not_found: 'Data sudah tidak ada. Muat ulang halaman.',
  database_unavailable: 'Server sedang tidak dapat diakses. Coba beberapa saat lagi.',
}
async function call<T>(path: string, method: 'GET' | 'PUT' = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (method !== 'GET') {
    const c = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    if (!c.ok) throw Error('Sesi keamanan tidak tersedia. Silakan login kembali.')
    headers['X-CSRF-Token'] = ((await c.json()) as { csrfToken: string }).csrfToken
    headers['Content-Type'] = 'application/json'
  }
  const r = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  if (!r.ok) {
    const e: { error?: string } = await r.json().catch(() => ({}))
    throw Error(ERRORS[e.error || ''] || `Permintaan gagal (HTTP ${r.status}).`)
  }
  return r.json() as Promise<T>
}
const PER = '/api/v1/subbagren/perencanaan'
const PROGAR = '/api/v1/subbagren/progar'
const tgl = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })
const big = (s: string | null | undefined) => BigInt(s || '0')
const persen = (a: string, b: string) => { const B = big(b); return B > 0n ? (Number((big(a) * 1000n) / B) / 10).toLocaleString('id-ID') : '0' }
const sumRpd = (r: string[]) => r.reduce((n, x) => n + big(x), 0n).toString()
const digits = (v: string) => v.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 16)
const tampil = (v: string) => v ? rupiah(v).slice(3) : ''
const selisih = (baru: string, lama: string) => { const d = big(baru) - big(lama); return d === 0n ? '±0' : `${d > 0n ? '+' : '−'}${rupiah((d < 0n ? -d : d).toString()).slice(3)}` }

// ======================= Ringkasan realisasi laporan =======================
type Baris = { dokumenId: string; jenis: string; judul: string; nomor: string; hibah: boolean; anggaran: string; rencanaPeriode: string | null; rencanaKumulatif: string | null; realisasiPeriode: string; realisasiKumulatif: string; sisa: string }
type Ringkasan = { beku: boolean; tahun: number; periode: string; bulanAwal: number; bulanAkhir: number; sampai: string; hibahSaja: boolean; menunggu: number; dibuat: string; baris: Baris[]
  total: { anggaran: string; rencanaPeriode: string | null; rencanaKumulatif: string | null; realisasiPeriode: string; realisasiKumulatif: string; sisa: string } }
/** R5H20: LRA memakai data resmi myinterest per kegiatan. */
type RingkasanMyinterest = { sumber: 'myinterest'; beku: boolean; tahun: number; periode: string; bulanAwal: number; bulanAkhir: number; sampai: string; dibuat: string
  potret: { id: string; tanggalAkhir: string; waktuUnduh: string } | null; potretSebelum: { tanggalAkhir: string } | null
  kegiatan: { kode: string; nama: string; pagu: string; realisasiPeriode: string | null; realisasiKumulatif: string; sisa: string }[]
  total: { pagu: string; realisasiPeriode: string | null; realisasiKumulatif: string; sisa: string } | null }

export function RingkasanRealisasi({ docId, stamp, jenisLabel }: { docId: string; stamp: number; jenisLabel: (j: string) => string }) {
  const [data, setData] = useState<Ringkasan | null>(null)
  const [mi, setMi] = useState<RingkasanMyinterest | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setError('')
    call<Ringkasan | RingkasanMyinterest>(`${PER}/dokumen/${docId}/ringkasan`).then(d => {
      if (!live) return
      if ('sumber' in d && d.sumber === 'myinterest') { setMi(d); setData(null) } else { setData(d as Ringkasan); setMi(null) }
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Ringkasan tidak dapat dimuat.') })
    return () => { live = false }
  }, [docId, stamp])
  if (mi) return <RingkasanMyinterestView d={mi} />
  const setahun = data ? data.bulanAwal === 1 && data.bulanAkhir === 12 : false
  const namaPeriode = data ? (data.bulanAwal === data.bulanAkhir ? BULAN[data.bulanAwal - 1] : setahun ? 'Setahun' : `${BULAN[data.bulanAwal - 1]}–${BULAN[data.bulanAkhir - 1]}`) : ''
  return <section className="sdl-progar__detail-tahap sdl-progar__ringkasan" aria-label="Ringkasan realisasi">
    <h3>Ringkasan Realisasi{data?.hibahSaja ? ' Dana Hibah' : ''}</h3>
    {error ? <p className="sdl-progar__error" role="alert">{error}</p> : !data ? <p className="sdl-progar__muted">Memuat…</p> : <>
      <p className="sdl-progar__ringkasan-note">
        {data.beku
          ? <span className="sdl-progar__badge is-disetujui">Potret saat Selesai · {tgl(data.dibuat)}</span>
          : <span className="sdl-progar__badge is-draft">Angka sementara</span>}
        <span className="sdl-progar__muted">Realisasi terverifikasi TA {data.tahun}{setahun ? '' : `, periode ${namaPeriode}`} s.d. <span className="sdl-progar__num">{tgl(data.sampai)}</span>.
          {!data.beku && ' Angka mengikuti menu Realisasi Anggaran sampai laporan ditandai Selesai.'}</span>
      </p>
      {data.menunggu > 0 && <p className="sdl-progar__pending">{data.menunggu} realisasi sampai periode ini masih menunggu verifikasi dan belum dihitung.</p>}
      {data.baris.length === 0
        ? <p className="sdl-progar__muted">{data.hibahSaja ? 'Belum ada dokumen Final yang ditandai dana hibah. Tandai di Anggaran (estimasi) dokumennya.' : `Belum ada dokumen Final beranggaran di TA ${data.tahun}.`}</p>
        : <div className="table-scroll"><table className="data-table sdl-progar__table sdl-progar__register">
          <thead><tr><th>Pos anggaran</th><th className="is-num">Anggaran</th>
            {!setahun && <><th className="is-num">Rencana (RPD) {namaPeriode}</th><th className="is-num">Realisasi {namaPeriode}</th></>}
            <th className="is-num">Realisasi s.d. {setahun ? 'akhir tahun' : namaPeriode}</th><th className="is-num">%</th><th className="is-num">Sisa</th></tr></thead>
          <tbody>{data.baris.map(b => <tr key={b.dokumenId}>
            <td><strong>{b.judul}</strong><small className="sdl-progar__num">{jenisLabel(b.jenis)}{b.nomor ? ` · ${b.nomor}` : ''}{b.hibah ? ' · Hibah' : ''}</small></td>
            <td className="is-num sdl-progar__nowrap">{rupiah(b.anggaran)}</td>
            {!setahun && <><td className="is-num sdl-progar__nowrap">{b.rencanaPeriode === null ? <span className="sdl-progar__muted" title="RPD belum diisi">–</span> : rupiah(b.rencanaPeriode)}</td>
              <td className="is-num sdl-progar__nowrap">{rupiah(b.realisasiPeriode)}</td></>}
            <td className="is-num sdl-progar__nowrap">{rupiah(b.realisasiKumulatif)}</td>
            <td className="is-num">{persen(b.realisasiKumulatif, b.anggaran)}</td>
            <td className="is-num sdl-progar__nowrap">{rupiah(b.sisa)}</td>
          </tr>)}</tbody>
          <tfoot><tr><th>Jumlah</th><th className="is-num sdl-progar__nowrap">{rupiah(data.total.anggaran)}</th>
            {!setahun && <><th className="is-num sdl-progar__nowrap">{data.total.rencanaPeriode === null ? '–' : rupiah(data.total.rencanaPeriode)}</th><th className="is-num sdl-progar__nowrap">{rupiah(data.total.realisasiPeriode)}</th></>}
            <th className="is-num sdl-progar__nowrap">{rupiah(data.total.realisasiKumulatif)}</th><th className="is-num">{persen(data.total.realisasiKumulatif, data.total.anggaran)}</th>
            <th className="is-num sdl-progar__nowrap">{rupiah(data.total.sisa)}</th></tr></tfoot>
        </table></div>}
    </>}
  </section>
}

// ======================= RPD 12 bulan =======================
function RpdGrid({ value, onChange, anggaran, idPrefix }: { value: string[]; onChange: (v: string[]) => void; anggaran: string; idPrefix: string }) {
  const total = sumRpd(value)
  const pas = total === big(anggaran).toString()
  const rata = () => {
    const a = big(anggaran); const per = a / 12n; const sisa = a - per * 12n
    onChange(Array.from({ length: 12 }, (_, i) => (i === 11 ? per + sisa : per).toString()))
  }
  return <div className="sdl-progar__rpd">
    <div className="sdl-progar__rpd-grid">{BULAN.map((b, i) => <label key={b} htmlFor={`${idPrefix}-${i}`}><span>{b}</span>
      <div className="sdl-progar__money"><span aria-hidden="true">Rp</span><input id={`${idPrefix}-${i}`} inputMode="numeric" value={tampil(value[i] === '0' ? '' : value[i])} placeholder="0"
        onChange={e => { const next = [...value]; next[i] = digits(e.target.value) || '0'; onChange(next) }} /></div></label>)}</div>
    <p className="sdl-progar__rpd-total">
      <span>Total RPD <strong className="sdl-progar__num">{rupiah(total)}</strong> dari anggaran <span className="sdl-progar__num">{rupiah(anggaran)}</span></span>
      {pas ? <span className="sdl-progar__ok">✓ Sesuai</span> : <span className="sdl-progar__rejected-inline">Selisih {selisih(total, anggaran)}</span>}
      <button type="button" className="sdl-progar__mini" onClick={rata}>Bagi rata 12 bulan</button>
    </p>
  </div>
}

function Modal({ title, eyebrow, context, busy, error, submitLabel, wide, onSubmit, onClose, children }: {
  title: string; eyebrow: string; context?: string; busy: boolean; error: string; submitLabel: string; wide?: boolean
  onSubmit: () => void; onClose: () => void; children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !e.defaultPrevented) { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onClose])
  return <div className="sdl-progar__shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose() }}>
    <form className={`sdl-progar__dialog${wide ? ' sdl-progar__detail' : ''}`} role="dialog" aria-modal="true" aria-labelledby="sdl-dalgar-title" onSubmit={(e: FormEvent) => { e.preventDefault(); if (!busy) onSubmit() }}>
      <header><span className="sdl-progar__eyebrow">{eyebrow}</span><h2 id="sdl-dalgar-title">{title}</h2>{context && <p>{context}</p>}</header>
      {children}
      {error && <p className="sdl-progar__error" role="alert">{error}</p>}
      <footer><button type="button" className="btn" disabled={busy} onClick={onClose}>Batal</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Menyimpan…' : submitLabel}</button></footer>
    </form>
  </div>
}

/** RPD awal satu pos (sekali; perubahan berikutnya lewat Revisi RPD). */
export function RpdDialog({ pos, onClose, onDone }: { pos: { dokumenId: string; judul: string; anggaran: string; tahun: number }; onClose: () => void; onDone: () => void }) {
  const [rpd, setRpd] = useState<string[]>(Array(12).fill('0'))
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async () => {
    if (sumRpd(rpd) !== big(pos.anggaran).toString()) { setError(ERRORS.rpd_tidak_sama_anggaran); return }
    setBusy(true); setError('')
    try { await call(`${PROGAR}/realisasi-dokumen/pos/${pos.dokumenId}/rpd`, 'PUT', { rpd }); onDone() } catch (e) { setError(e instanceof Error ? e.message : 'Gagal menyimpan.') } finally { setBusy(false) }
  }
  return <Modal title="Isi RPD" eyebrow={`RENCANA PENARIKAN DANA · TA ${pos.tahun}`} context={pos.judul} busy={busy} error={error} submitLabel="Simpan RPD" wide onSubmit={() => void submit()} onClose={onClose}>
    <p className="sdl-progar__hint">Rencana penarikan dana per bulan. Totalnya harus sama dengan anggaran dokumen. Setelah disimpan, perubahan dibuat lewat <strong>Revisi RPD</strong> di menu Revisi Anggaran.</p>
    <RpdGrid value={rpd} onChange={setRpd} anggaran={pos.anggaran} idPrefix="rpd-awal" />
  </Modal>
}

// ======================= Revisi POK / RPD =======================
type Butir = { dokumenId: string; jenis: string; jenisLabel: string; judul: string; nomor: string; anggaranSekarang: string | null; terverifikasi: string; rpdSekarang: string[] | null
  anggaranBaru: string | null; rpdBaru: string[] | null; anggaranLama: string | null; rpdLama: string[] | null; diterapkanAt: string | null }
type Pos = { dokumenId: string; anggaran: string; terverifikasi: string; aktif: boolean; rpd: string[] | null; dokumen: { jenis: string; judul: string; nomor: string } }

export function RevisiAnggaran({ doc, canEdit, jenisLabel, onChanged }: {
  doc: { id: string; tahun: number; jenis: string; version: number; final: boolean; judul: string }
  canEdit: boolean; jenisLabel: (j: string) => string; onChanged: () => void
}) {
  const pok = doc.jenis === 'revisi_pok'
  const [items, setItems] = useState<Butir[] | null>(null)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState(false)
  useEffect(() => {
    let live = true
    setError('')
    call<{ items: Butir[] }>(`${PER}/dokumen/${doc.id}/revisi-item`).then(d => { if (live) setItems(d.items) }).catch(e => { if (live) setError(e instanceof Error ? e.message : 'Daftar perubahan tidak dapat dimuat.') })
    return () => { live = false }
  }, [doc.id, doc.version])
  const diterapkan = items?.find(i => i.diterapkanAt)?.diterapkanAt ?? null
  // Sebelum diterapkan: bandingkan dengan angka sekarang; sesudahnya: dengan angka lama yang dicatat.
  const lamaA = (i: Butir) => (diterapkan ? i.anggaranLama : i.anggaranSekarang) ?? '0'
  const lamaR = (i: Butir) => diterapkan ? i.rpdLama : i.rpdSekarang
  const totLama = (items ?? []).reduce((n, i) => n + big(lamaA(i)), 0n).toString()
  const totBaru = (items ?? []).reduce((n, i) => n + big(i.anggaranBaru), 0n).toString()
  return <section className="sdl-progar__detail-tahap" aria-label={pok ? 'Perubahan anggaran' : 'Perubahan RPD'}>
    <h3>{pok ? 'Perubahan Anggaran (POK)' : 'Perubahan RPD'}</h3>
    {error ? <p className="sdl-progar__error" role="alert">{error}</p> : !items ? <p className="sdl-progar__muted">Memuat…</p> : <>
      <p className="sdl-progar__ringkasan-note">
        {diterapkan ? <span className="sdl-progar__badge is-disetujui">Diterapkan · {tgl(diterapkan)}</span> : <span className="sdl-progar__badge is-draft">Belum diterapkan</span>}
        <span className="sdl-progar__muted">{diterapkan
          ? `${pok ? 'Anggaran' : 'RPD'} dokumen di bawah sudah diganti saat revisi ditandai Selesai.`
          : `${pok ? 'Anggaran' : 'RPD'} dokumen diganti otomatis saat revisi ini ditandai Selesai.`}</span>
        {canEdit && !doc.final && <button type="button" className="sdl-progar__mini" onClick={() => setEdit(true)}>{items.length ? 'Ubah daftar' : 'Atur perubahan'}</button>}
      </p>
      {items.length === 0 ? <p className="sdl-progar__muted">Belum ada dokumen yang diubah. {canEdit && !doc.final ? 'Tekan Atur perubahan untuk memilih dokumen Final dan angka barunya.' : ''}</p>
        : pok ? <div className="table-scroll"><table className="data-table sdl-progar__table sdl-progar__register">
          <thead><tr><th>Dokumen</th><th className="is-num">{diterapkan ? 'Anggaran lama' : 'Anggaran sekarang'}</th><th className="is-num">Anggaran baru</th><th className="is-num">Selisih</th></tr></thead>
          <tbody>{items.map(i => <tr key={i.dokumenId}>
            <td><strong>{i.judul}</strong><small className="sdl-progar__num">{jenisLabel(i.jenis)}{i.nomor ? ` · ${i.nomor}` : ''}{big(i.terverifikasi) > 0n ? ` · terealisasi ${rupiah(i.terverifikasi)}` : ''}</small></td>
            <td className="is-num sdl-progar__nowrap">{rupiah(lamaA(i))}</td><td className="is-num sdl-progar__nowrap"><strong>{rupiah(i.anggaranBaru ?? '0')}</strong></td>
            <td className="is-num sdl-progar__nowrap">{selisih(i.anggaranBaru ?? '0', lamaA(i))}</td></tr>)}</tbody>
          <tfoot><tr><th>Jumlah</th><th className="is-num sdl-progar__nowrap">{rupiah(totLama)}</th><th className="is-num sdl-progar__nowrap">{rupiah(totBaru)}</th><th className="is-num sdl-progar__nowrap">{selisih(totBaru, totLama)}</th></tr></tfoot>
        </table></div>
        : items.map(i => <div key={i.dokumenId} className="sdl-progar__rpd-item">
          <p><strong>{i.judul}</strong> <small className="sdl-progar__muted">{jenisLabel(i.jenis)} · anggaran {rupiah(i.anggaranSekarang ?? '0')}</small></p>
          <div className="table-scroll"><table className="data-table sdl-progar__table sdl-progar__rpd-table">
            <thead><tr><th />{BULAN.map(b => <th key={b} className="is-num">{b.slice(0, 3)}</th>)}<th className="is-num">Total</th></tr></thead>
            <tbody>
              <tr className="sdl-progar__muted"><th scope="row">{diterapkan ? 'Lama' : 'Sekarang'}</th>{(lamaR(i) ?? Array(12).fill(null)).map((x, k) => <td key={k} className="is-num">{x === null ? '–' : tampil(x) || '0'}</td>)}<td className="is-num">{lamaR(i) ? tampil(sumRpd(lamaR(i)!)) : '–'}</td></tr>
              <tr><th scope="row">Baru</th>{(i.rpdBaru ?? []).map((x, k) => <td key={k} className="is-num"><strong>{tampil(x) || '0'}</strong></td>)}<td className="is-num"><strong>{tampil(sumRpd(i.rpdBaru ?? []))}</strong></td></tr>
            </tbody></table></div>
        </div>)}
    </>}
    {edit && items && <RevisiEditor doc={doc} pok={pok} items={items} jenisLabel={jenisLabel} onClose={() => setEdit(false)} onDone={() => { setEdit(false); onChanged() }} />}
  </section>
}

function RevisiEditor({ doc, pok, items, jenisLabel, onClose, onDone }: {
  doc: { id: string; tahun: number; version: number; judul: string }; pok: boolean; items: Butir[]; jenisLabel: (j: string) => string; onClose: () => void; onDone: () => void
}) {
  const [pos, setPos] = useState<Pos[] | null>(null)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  // POK: dokumenId -> anggaran baru ('' = tidak diubah). RPD: dokumenId -> 12 bulan.
  const [ang, setAng] = useState<Record<string, string>>(() => Object.fromEntries(items.filter(i => i.anggaranBaru !== null).map(i => [i.dokumenId, i.anggaranBaru!])))
  const [rpd, setRpd] = useState<Record<string, string[]>>(() => Object.fromEntries(items.filter(i => i.rpdBaru).map(i => [i.dokumenId, i.rpdBaru!])))
  useEffect(() => {
    call<{ items: Pos[] }>(`${PROGAR}/realisasi-dokumen?tahun=${doc.tahun}`).then(d => setPos(d.items.filter(p => p.aktif))).catch(e => setError(e instanceof Error ? e.message : 'Daftar dokumen tidak dapat dimuat.'))
  }, [doc.tahun])
  const submit = async () => {
    const list = pok
      ? Object.entries(ang).filter(([, v]) => v !== '').map(([dokumenId, anggaran]) => ({ dokumenId, anggaran }))
      : Object.entries(rpd).map(([dokumenId, r]) => ({ dokumenId, rpd: r }))
    if (!pok) for (const p of pos ?? []) if (rpd[p.dokumenId] && sumRpd(rpd[p.dokumenId]) !== big(p.anggaran).toString()) { setError(`Total RPD "${p.dokumen.judul}" belum sama dengan anggarannya.`); return }
    setBusy(true); setError('')
    try { await call(`${PER}/dokumen/${doc.id}/revisi-item`, 'PUT', { items: list, version: doc.version }); onDone() } catch (e) { setError(e instanceof Error ? e.message : 'Gagal menyimpan.') } finally { setBusy(false) }
  }
  return <Modal title={pok ? 'Perubahan Anggaran' : 'Perubahan RPD'} eyebrow={`${pok ? 'REVISI POK' : 'REVISI RPD'} · TA ${doc.tahun}`} context={doc.judul} busy={busy || !pos} error={error} submitLabel="Simpan Daftar" wide onSubmit={() => void submit()} onClose={onClose}>
    <p className="sdl-progar__hint">{pok
      ? 'Isi anggaran baru hanya pada dokumen yang berubah; biarkan kosong untuk yang tetap. Anggaran baru tidak boleh di bawah realisasi terverifikasi.'
      : 'Centang dokumen yang RPD-nya berubah, lalu isi rencana 12 bulan. Totalnya harus sama dengan anggaran dokumen.'} Perubahan baru diterapkan saat revisi ditandai <strong>Selesai</strong>.</p>
    {!pos ? <p className="sdl-progar__muted">Memuat dokumen Final TA {doc.tahun}…</p>
      : pos.length === 0 ? <p className="sdl-progar__muted">Belum ada dokumen Final beranggaran di TA {doc.tahun}.</p>
      : pok ? <div className="table-scroll"><table className="data-table sdl-progar__table sdl-progar__register">
        <thead><tr><th>Dokumen</th><th className="is-num">Anggaran sekarang</th><th className="is-num">Terealisasi</th><th>Anggaran baru</th></tr></thead>
        <tbody>{pos.map(p => <tr key={p.dokumenId}>
          <td><strong>{p.dokumen.judul}</strong><small className="sdl-progar__num">{jenisLabel(p.dokumen.jenis)}{p.dokumen.nomor ? ` · ${p.dokumen.nomor}` : ''}</small></td>
          <td className="is-num sdl-progar__nowrap">{rupiah(p.anggaran)}</td><td className="is-num sdl-progar__nowrap">{rupiah(p.terverifikasi)}</td>
          <td><div className="sdl-progar__money"><span aria-hidden="true">Rp</span><input inputMode="numeric" aria-label={`Anggaran baru ${p.dokumen.judul}`} placeholder="tetap" value={tampil(ang[p.dokumenId] ?? '')}
            onChange={e => setAng(a => ({ ...a, [p.dokumenId]: digits(e.target.value) }))} /></div></td>
        </tr>)}</tbody></table></div>
      : pos.map(p => { const on = Boolean(rpd[p.dokumenId]); return <div key={p.dokumenId} className="sdl-progar__rpd-item">
          <label className="sdl-progar__check"><input type="checkbox" checked={on} onChange={e => setRpd(r => { const n = { ...r }; if (e.target.checked) n[p.dokumenId] = p.rpd ? [...p.rpd] : Array(12).fill('0'); else delete n[p.dokumenId]; return n })} />
            <strong>{p.dokumen.judul}</strong> <small className="sdl-progar__muted">{jenisLabel(p.dokumen.jenis)} · anggaran {rupiah(p.anggaran)}{p.rpd ? '' : ' · RPD belum diisi'}</small></label>
          {on && <RpdGrid value={rpd[p.dokumenId]} onChange={v => setRpd(r => ({ ...r, [p.dokumenId]: v }))} anggaran={p.anggaran} idPrefix={`rpd-${p.dokumenId}`} />}
        </div> })}
  </Modal>
}

function RingkasanMyinterestView({ d }: { d: RingkasanMyinterest }) {
  const bulan = BULAN[d.bulanAkhir - 1]
  return <section className="sdl-progar__detail-tahap sdl-progar__ringkasan" aria-label="LRA dari myinterest">
    <h3>Realisasi Belanja (myinterest)</h3>
    <p className="sdl-progar__ringkasan-note">
      {d.beku ? <span className="sdl-progar__badge is-disetujui">Potret saat Selesai · {tgl(d.dibuat)}</span> : <span className="sdl-progar__badge is-draft">Angka sementara</span>}
      <span className="sdl-progar__muted">{d.potret
        ? <>Data myinterest per <span className="sdl-progar__num">{tgl(d.potret.tanggalAkhir)}</span>{d.potret.waktuUnduh ? `, diunduh ${fmtUnduh(d.potret.waktuUnduh)}` : ''}.</>
        : <>Belum ada data myinterest bulan {bulan} {d.tahun}. Impor di menu <strong>Data myinterest (LRA)</strong> dengan rentang 1 Januari s.d. akhir {bulan}.</>}</span>
    </p>
    {d.potret && d.bulanAwal > 1 && !d.potretSebelum && <p className="sdl-progar__pending">Potret akhir {BULAN[d.bulanAwal - 2]} belum diimpor, jadi realisasi khusus bulan {bulan} belum bisa dihitung (yang tampil hanya kumulatif).</p>}
    {d.potret && d.total && <div className="table-scroll"><table className="data-table sdl-progar__table sdl-progar__register">
      <thead><tr><th>Kegiatan</th><th className="is-num">Pagu</th><th className="is-num">Realisasi {bulan}</th><th className="is-num">Realisasi s.d. {bulan}</th><th className="is-num">%</th><th className="is-num">Sisa</th></tr></thead>
      <tbody>{d.kegiatan.map(k => <tr key={k.kode}><td><strong>{k.kode}</strong><small>{k.nama}</small></td>
        <td className="is-num sdl-progar__nowrap">{rupiah(k.pagu)}</td>
        <td className="is-num sdl-progar__nowrap">{k.realisasiPeriode === null ? <span className="sdl-progar__muted">–</span> : rupiah(k.realisasiPeriode)}</td>
        <td className="is-num sdl-progar__nowrap">{rupiah(k.realisasiKumulatif)}</td><td className="is-num">{persen(k.realisasiKumulatif, k.pagu)}</td>
        <td className="is-num sdl-progar__nowrap">{rupiah(k.sisa)}</td></tr>)}</tbody>
      <tfoot><tr><th>Jumlah</th><th className="is-num sdl-progar__nowrap">{rupiah(d.total.pagu)}</th><th className="is-num sdl-progar__nowrap">{d.total.realisasiPeriode === null ? '–' : rupiah(d.total.realisasiPeriode)}</th>
        <th className="is-num sdl-progar__nowrap">{rupiah(d.total.realisasiKumulatif)}</th><th className="is-num">{persen(d.total.realisasiKumulatif, d.total.pagu)}</th><th className="is-num sdl-progar__nowrap">{rupiah(d.total.sisa)}</th></tr></tfoot>
    </table></div>}
  </section>
}
