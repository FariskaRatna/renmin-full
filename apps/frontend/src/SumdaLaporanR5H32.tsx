import { useCallback, useEffect, useState } from 'react'
import { BULAN, SUMDA_BASE, TidakTersedia, makeApi } from './SumdaBersama'
import { JENIS_ARSIP } from './SumdaArsipR5H32'
import { showToast } from './UIFeedback'
import './ProgarR5H11.css'
import './SumdaPersonelR5H27.css'
import './SumdaR5H32.css'

/**
 * R5H32: Subbagsumda — Laporan & Analitik. Backend /api/v1/subbagsumda/laporan (Express saja).
 * Semua angka dihitung server (agregat SQL, WIB). Blok yang haknya tidak dipegang akun ini bernilai null dan
 * TIDAK dirender (bukan nol). Ekspor CSV hanya Kasubbagsumda/Kabagrenmin dan setiap unduhan diaudit server.
 * Cetak memakai cetak browser dengan gaya cetak yang dicakup kelas body `sdl-cetak-laporan`.
 */

type Bar = { label: string; jumlah: number }
type Ringkasan = {
  tahun: number; tahunIni: number; hariIni: string
  personel: { aktif: number; mpp: number; total: number; perUnit: Bar[]; perPangkat: { polri: Bar[]; pns: Bar[] }; proyeksi: { bulan: string; jumlah: number }[] }
  pensiun30: number
  layananBerjalan: { karier: number; cuti: number; kesejahteraan: number; total: number }
  cuti: { perBulan: { bulan: string; pengajuan: number; hari: number }[] }
  diklat: { perBulan: { bulan: string; kegiatan: number; peserta: number }[] }
  register: { modul: string; jumlah: number; diproses: number }[]
  kinerja: { perKategori: { kategori: string; jumlah: number }[] } | null
  aset: { terdaftar: number; pemeliharaan14: number; perKondisi: Bar[]; perStatus: Bar[] } | null
  arsip: { aktif: number; inaktif: number; musnah: number; retensi30: number; perJenis: Bar[]; terbatas: number | null } | null
}
type Caps = { canRead: boolean; canExport: boolean; modul: Record<string, boolean> }

const ERRORS: Record<string, string> = {
  access_denied: 'Akun ini tidak berwenang membuka data tersebut.',
  invalid_input: 'Pilihan tahun atau saringan tidak sesuai.',
  terlalu_banyak: 'Terlalu banyak baris (lebih dari 10.000). Persempit dengan saringan tahun.',
  not_found: 'Modul ekspor tidak dikenal.',
  database_unavailable: 'Server sedang tidak dapat diakses atau unduhan tidak dapat dicatat. Coba beberapa saat lagi.',
}
const api = makeApi(ERRORS, 'Laporan & Analitik tidak tersedia di server saat ini.')

/** Label, keterangan register, dan apakah ekspor memakai saringan tahun (K42). */
const MODUL: Record<string, { label: string; diproses: string; tahun: boolean }> = {
  personel: { label: 'Master Personel', diproses: '', tahun: false },
  pensiun: { label: 'Monitoring Pensiun', diproses: '', tahun: false },
  karier: { label: 'Karier & Mutasi', diproses: 'belum final', tahun: true },
  diklat: { label: 'Diklat (per peserta)', diproses: 'terjadwal/berjalan', tahun: true },
  kompetensi: { label: 'Kompetensi', diproses: 'perlu perpanjangan', tahun: false },
  cuti: { label: 'Cuti & Perizinan', diproses: 'belum final', tahun: true },
  kesejahteraan: { label: 'Kesejahteraan', diproses: 'belum final', tahun: true },
  kinerja: { label: 'Kinerja & Pembinaan', diproses: 'draft/diajukan', tahun: true },
  aset: { label: 'Inventaris & BMN', diproses: 'pemeliharaan/usulan hapus', tahun: false },
  arsip: { label: 'Persuratan & Arsip', diproses: 'retensi ≤ 30 hari', tahun: true },
}
const KATEGORI: Record<string, string> = { BAIK_SEKALI: 'Baik sekali', BAIK: 'Baik', CUKUP: 'Cukup', PERLU_PEMBINAAN: 'Perlu pembinaan' }
const bulanLabel = (b: string) => `${BULAN[Number(b.slice(5, 7)) - 1]} ${b.slice(2, 4)}`
const angka = (n: number) => n.toLocaleString('id-ID')

function Batang({ judul, data, label = false, satuan, kosong = 'Belum ada data.' }: { judul: string; data: { label: string; jumlah: number; ket?: string }[]; label?: boolean; satuan?: string; kosong?: string }) {
  const max = Math.max(1, ...data.map(d => d.jumlah))
  return <section className="panel sdl-sumda__block sdl-r5h32__blok" aria-label={judul}>
    <header><h2>{judul}</h2>{satuan && <span className="sdl-sumda__muted">{satuan}</span>}</header>
    {data.length === 0 ? <p className="sdl-sumda__muted">{kosong}</p>
      : <table className={`sdl-sumda__bars${label ? ' sdl-r5h32__bars--label' : ''}`}>
        <caption className="sdl-sumda__sr">{judul}</caption>
        <tbody>{data.map(d => <tr key={d.label}>
          <th scope="row" title={d.label}>{d.label}</th>
          <td><span className="sdl-sumda__bar" style={{ width: `${(d.jumlah / max) * 100}%` }} /></td>
          <td className="is-num sdl-sumda__mono">{angka(d.jumlah)}{d.ket && <small className="sdl-r5h32__ket">{d.ket}</small>}</td>
        </tr>)}</tbody>
      </table>}
  </section>
}

export default function SumdaLaporanR5H32() {
  const [unavailable, setUnavailable] = useState(false)
  const [caps, setCaps] = useState<Caps | null>(null)
  const [tahun, setTahun] = useState<number | null>(null)
  const [data, setData] = useState<Ringkasan | null>(null)
  const [error, setError] = useState('')
  const [unduh, setUnduh] = useState<string | null>(null)
  useEffect(() => { api<Caps>('/laporan/capabilities').then(setCaps).catch(e => { if (e instanceof TidakTersedia) setUnavailable(true) }) }, [])
  const muat = useCallback(async () => {
    try { setData(await api<Ringkasan>(`/laporan/ringkasan${tahun ? `?tahun=${tahun}` : ''}`)); setError('') }
    catch (e) { if (e instanceof TidakTersedia) setUnavailable(true); else setError((e as Error).message) }
  }, [tahun])
  useEffect(() => { void muat() }, [muat])
  useEffect(() => {
    const lepas = () => document.body.classList.remove('sdl-cetak-laporan')
    window.addEventListener('afterprint', lepas)
    return () => { window.removeEventListener('afterprint', lepas); lepas() }
  }, [])

  async function ekspor(modul: string) {
    if (!data || unduh) return
    setUnduh(modul)
    try {
      const qs = MODUL[modul]?.tahun ? `?tahun=${data.tahun}` : ''
      const r = await fetch(`${SUMDA_BASE}/laporan/ekspor/${encodeURIComponent(modul)}${qs}`, { credentials: 'same-origin', cache: 'no-store' })
      if (!r.ok) {
        const j: { error?: string } = (r.headers.get('content-type') ?? '').includes('application/json') ? await r.json().catch(() => ({})) : {}
        throw new Error(ERRORS[j.error ?? ''] ?? `Unduhan gagal (HTTP ${r.status}).`)
      }
      const nama = /filename="?([^";]+)"?/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? `sumda-${modul}.csv`
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a'); a.href = url; a.download = nama; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast(`${nama} diunduh.`)
    } catch (e) { showToast((e as Error).message, 'error') } finally { setUnduh(null) }
  }
  function cetak() { document.body.classList.add('sdl-cetak-laporan'); window.print() }

  if (unavailable) return <section className="sdl-sumda"><div className="panel sdl-sumda__notice is-warn" role="alert">
    <strong>Laporan &amp; Analitik tidak tersedia di server saat ini.</strong>
    <p>Layanan ini sedang dialihkan. Data tidak hilang; coba lagi beberapa saat lagi atau hubungi admin sistem.</p>
  </div></section>
  if (error && !data) return <p className="sdl-progar__error" role="alert">{error}</p>
  if (!data) return <p className="sdl-sumda__muted" aria-live="polite">Memuat laporan…</p>
  const d = data
  const pilihanTahun = Array.from({ length: 7 }, (_, i) => d.tahunIni + 1 - i)
  const ekspotModul = caps?.canExport ? Object.keys(MODUL).filter(m => caps.modul[m]) : []
  return <section className="sdl-sumda sdl-r5h32">
    <div className="sdl-sumda__toolbar sdl-r5h32__alat">
      <label><span>Tahun</span> <select value={d.tahun} onChange={e => setTahun(Number(e.target.value))}>{pilihanTahun.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
      <span className="sdl-sumda__muted">Data per {d.hariIni.split('-').reverse().join('-')} (WIB). Angka berbasis tanggal memakai tahun {d.tahun}; selainnya keadaan saat ini.</span>
      <span className="sdl-sumda__grow" />
      <button type="button" className="btn" onClick={cetak}>Cetak</button>
    </div>
    <h2 className="sdl-r5h32__judul-cetak">Laporan Subbagsumda — tahun {d.tahun} (data per {d.hariIni})</h2>

    <dl className="sdl-sumda__summary" aria-label="Ringkasan Subbagsumda">
      <div><dt>Personel aktif</dt><dd>{angka(d.personel.aktif + d.personel.mpp)}</dd><small>{angka(d.personel.aktif)} aktif · {angka(d.personel.mpp)} MPP</small></div>
      <div className={d.pensiun30 ? 'is-attention' : ''}><dt>Pensiun ≤ 30 hari</dt><dd>{angka(d.pensiun30)}</dd><small>Termasuk yang sudah jatuh tempo</small></div>
      <div><dt>Layanan SDM berjalan</dt><dd>{angka(d.layananBerjalan.total)}</dd><small>{d.layananBerjalan.karier} karier · {d.layananBerjalan.cuti} cuti · {d.layananBerjalan.kesejahteraan} kesejahteraan</small></div>
      {d.aset && <div><dt>Aset terdaftar</dt><dd>{angka(d.aset.terdaftar)}</dd><small>{d.aset.pemeliharaan14} pemeliharaan ≤ 14 hari</small></div>}
      {d.arsip && <div className={d.arsip.retensi30 ? 'is-attention' : ''}><dt>Arsip aktif</dt><dd>{angka(d.arsip.aktif)}</dd><small>{d.arsip.inaktif} inaktif · {d.arsip.retensi30} retensi ≤ 30 hari</small></div>}
    </dl>

    <div className="sdl-r5h32__grid">
      <Batang judul="Personel aktif per unit kerja" label data={d.personel.perUnit} />
      <Batang judul="Pangkat Polri" label data={d.personel.perPangkat.polri} kosong="Tidak ada personel Polri aktif." />
      <Batang judul="Golongan PNS" label data={d.personel.perPangkat.pns} kosong="Tidak ada PNS aktif." />
      <Batang judul="Proyeksi pensiun 12 bulan" data={d.personel.proyeksi.map(b => ({ label: bulanLabel(b.bulan), jumlah: b.jumlah }))} satuan="personel" />
      <Batang judul={`Cuti disetujui per bulan ${d.tahun}`} data={d.cuti.perBulan.map(b => ({ label: bulanLabel(b.bulan), jumlah: b.pengajuan, ket: b.hari ? `${b.hari} hr` : undefined }))} satuan="pengajuan" />
      <Batang judul={`Diklat per bulan ${d.tahun}`} data={d.diklat.perBulan.map(b => ({ label: bulanLabel(b.bulan), jumlah: b.kegiatan, ket: b.peserta ? `${b.peserta} peserta` : undefined }))} satuan="kegiatan" />
      {d.kinerja && <Batang judul={`Kategori kinerja ${d.tahun}`} label data={d.kinerja.perKategori.map(k => ({ label: KATEGORI[k.kategori] ?? k.kategori, jumlah: k.jumlah }))} satuan="disetujui/selesai" />}
      {d.aset && <Batang judul="Aset per kondisi" label data={d.aset.perKondisi} satuan="belum dihapus" />}
      {d.arsip && <Batang judul={`Arsip per jenis ${d.tahun}`} label data={d.arsip.perJenis.map(j => ({ label: JENIS_ARSIP[j.label] ?? j.label, jumlah: j.jumlah }))} />}
    </div>

    <section className="panel sdl-sumda__block" aria-labelledby="sdl-r5h32-reg">
      <header><h2 id="sdl-r5h32-reg">Ringkasan register</h2></header>
      <div className="table-scroll"><table className="data-table sdl-sumda__table">
        <thead><tr><th>Modul</th><th className="is-num">Tercatat {d.tahun}</th><th className="is-num">Sedang diproses</th><th>Arti “diproses”</th></tr></thead>
        <tbody>{d.register.map(r => <tr key={r.modul}><td>{MODUL[r.modul]?.label ?? r.modul}</td><td className="is-num sdl-sumda__mono">{angka(r.jumlah)}</td>
          <td className="is-num sdl-sumda__mono">{angka(r.diproses)}</td><td className="sdl-sumda__muted">{MODUL[r.modul]?.diproses}</td></tr>)}</tbody>
      </table></div>
    </section>

    {ekspotModul.length > 0 && <section className="panel sdl-sumda__block sdl-r5h32__unduh" aria-labelledby="sdl-r5h32-unduh">
      <header><h2 id="sdl-r5h32-unduh">Unduh data (CSV)</h2></header>
      <p className="sdl-sumda__rule">Setiap unduhan dicatat di audit. Modul bertanda tahun memakai tahun {d.tahun}; maksimal 10.000 baris. Berkas dibuka dengan Excel (pemisah titik koma).</p>
      <ul className="sdl-r5h32__modul">{ekspotModul.map(m => <li key={m}>
        <span>{MODUL[m].label}{MODUL[m].tahun && <small className="sdl-sumda__muted"> · {d.tahun}</small>}</span>
        <button type="button" className="btn" disabled={unduh !== null} onClick={() => void ekspor(m)}>{unduh === m ? 'Mengunduh…' : 'Unduh CSV'}</button>
      </li>)}</ul>
    </section>}
  </section>
}
