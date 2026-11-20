import { useState } from 'react'
import { rupiah } from './ProgarR5H11'
import { fmtUnduh, ringkas, type LraData } from './MyinterestR5H20'
import './LraDashboardR5H24.css'

/**
 * R5H24 (2026-11-20): tampilan menu "Data myinterest (LRA)" mengikuti referensi pemilik
 * mockup/redesign/references/dashboad_ren.jpg — hero serapan, empat ringkasan, serapan per
 * kegiatan (urut pagu terbesar), komposisi jenis belanja (donat), dan realisasi per bulan.
 *
 * Warna donat (divalidasi scripts/validate_palette.js, terang & gelap): melekat ke JENIS
 * belanja, bukan ke urutan: Barang · Modal · Pegawai · Hibah; jenis lain dilipat ke "Lainnya".
 */

const BULAN3 = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const JENIS_NAMA: Record<string, string> = { pegawai: 'Belanja Pegawai', barang: 'Belanja Barang', modal: 'Belanja Modal', bunga: 'Beban Bunga', subsidi: 'Subsidi', hibah: 'Belanja Hibah', bansos: 'Bantuan Sosial', lain: 'Belanja Lain-lain', transfer: 'Transfer' }
const SLOT: Record<string, number> = { barang: 1, modal: 2, pegawai: 3, hibah: 4 }
const big = (s: string | null | undefined) => BigInt(s || '0')
const pct = (a: bigint, b: bigint) => (b > 0n ? Number((a * 10000n) / b) / 100 : 0)
const pctText = (n: number) => `${n.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
const tgl = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })

type Irisan = { key: string; nama: string; slot: number; nilai: bigint }

function Donat({ irisan, total }: { irisan: Irisan[]; total: bigint }) {
  const [aktif, setAktif] = useState<string | null>(null)
  const R = 70; const C = 2 * Math.PI * R; const GAP = irisan.length > 1 ? 2 : 0
  let off = 0
  const segs = irisan.map((x) => {
    const frac = total > 0n ? Number((x.nilai * 100000n) / total) / 100000 : 0
    const len = Math.max(0, frac * C - GAP)
    const s = { ...x, frac, dash: `${len} ${C - len}`, offset: -off }
    off += frac * C
    return s
  })
  const a = segs.find((s) => s.key === aktif)
  return <div className="sdl-lrad__donut-wrap">
    <svg viewBox="0 0 200 200" className="sdl-lrad__donut" role="img" aria-label={`Komposisi realisasi: ${segs.map((s) => `${s.nama} ${pctText(s.frac * 100)}`).join(', ')}`}>
      <g transform="rotate(-90 100 100)">
        <circle cx="100" cy="100" r={R} className="sdl-lrad__donut-track" />
        {segs.map((s) => <circle key={s.key} cx="100" cy="100" r={R} className={`sdl-lrad__seg is-s${s.slot}${aktif && aktif !== s.key ? ' is-dim' : ''}`}
          strokeDasharray={s.dash} strokeDashoffset={s.offset} onMouseEnter={() => setAktif(s.key)} onMouseLeave={() => setAktif(null)}>
          <title>{`${s.nama}: ${rupiah(s.nilai.toString())} (${pctText(s.frac * 100)} dari realisasi)`}</title>
        </circle>)}
      </g>
      <text x="100" y="92" textAnchor="middle" className="sdl-lrad__donut-cap">{a ? a.nama.replace('Belanja ', '').toUpperCase() : 'TOTAL REALISASI'}</text>
      <text x="100" y="118" textAnchor="middle" className="sdl-lrad__donut-val">{(a ? ringkas(a.nilai.toString()) : ringkas(total.toString())).replace('Rp ', '')}</text>
    </svg>
    <ul className="sdl-lrad__legend">{segs.map((s) => <li key={s.key} className={aktif === s.key ? 'is-on' : undefined} onMouseEnter={() => setAktif(s.key)} onMouseLeave={() => setAktif(null)}>
      <i className={`is-s${s.slot}`} aria-hidden="true" />
      <span><strong>{s.nama}</strong><small>{pctText(s.frac * 100)} dari realisasi</small></span>
      <b title={rupiah(s.nilai.toString())}>{ringkas(s.nilai.toString())}</b>
    </li>)}</ul>
  </div>
}

const Ikon = ({ d }: { d: string }) => <span className="sdl-lrad__ico" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg></span>

export function LraDashboardR5H24({ data }: { data: LraData }) {
  const t = data.terbaru!
  const pagu = big(t.totalPagu); const real = big(t.totalRealisasi); const sisa = pagu - real
  const serapan = pct(real, pagu)
  const keg = [...t.kegiatan].sort((a, b) => (big(b.pagu) > big(a.pagu) ? 1 : big(b.pagu) < big(a.pagu) ? -1 : a.kode.localeCompare(b.kode)))
  const sisaTerbesar = keg.reduce<typeof keg[number] | null>((m, k) => (!m || big(k.pagu) - big(k.realisasi) > big(m.pagu) - big(m.realisasi) ? k : m), null)
  const awal = data.impor.find((i) => i.id === t.imporId)?.tanggalAwal ?? `${data.tahun}-01-01`
  // Komposisi realisasi per jenis: empat jenis berwarna tetap, sisanya "Lainnya".
  const perJenis = Object.entries(t.perJenis).map(([k, v]) => ({ k, r: big(v.realisasi) })).filter((x) => x.r > 0n)
  const irisan: Irisan[] = perJenis.filter((x) => SLOT[x.k]).map((x) => ({ key: x.k, nama: JENIS_NAMA[x.k] ?? x.k, slot: SLOT[x.k], nilai: x.r }))
  const lain = perJenis.filter((x) => !SLOT[x.k]).reduce((s, x) => s + x.r, 0n)
  if (lain > 0n) irisan.push({ key: 'lainnya', nama: 'Lainnya', slot: 0, nilai: lain })
  irisan.sort((a, b) => (b.nilai > a.nilai ? 1 : b.nilai < a.nilai ? -1 : 0))
  const jenisAktif = Object.values(t.perJenis).filter((v) => big(v.pagu) > 0n).length
  const bln = data.bulanan.filter((b) => b.bulanIni !== null)
  const maxBulan = bln.reduce((m, b) => (big(b.bulanIni) > m ? big(b.bulanIni) : m), 0n)

  return <div className="sdl-lrad">
    <div className="sdl-lrad__head">
      <div><span className="sdl-lrad__eyebrow">Realisasi anggaran · data resmi myinterest</span>
        <h2>Dashboard Realisasi Anggaran</h2>
        <p>Ikhtisar belanja menurut kegiatan dan jenis belanja untuk kebutuhan pimpinan.</p></div>
      <div className="sdl-lrad__head-tools">
        <span className="sdl-lrad__range" title={t.waktuUnduh ? `Diunduh ${fmtUnduh(t.waktuUnduh)}` : undefined}>📅 {tgl(awal)} – {tgl(t.tanggalAkhir)}</span>
        <button type="button" className="sdl-lrad__print" onClick={() => window.print()}>Cetak</button>
      </div>
    </div>

    <section className="sdl-lrad__hero" aria-label="Capaian realisasi keseluruhan">
      <div className="sdl-lrad__hero-main">
        <span className="sdl-lrad__hero-eyebrow">Capaian realisasi keseluruhan</span>
        <p className="sdl-lrad__hero-label">Tingkat serapan anggaran</p>
        <strong className="sdl-lrad__hero-num">{pctText(serapan)}</strong>
        <span className="sdl-lrad__hero-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={serapan} aria-label="Serapan anggaran"><span style={{ width: `${Math.min(100, serapan)}%` }} /></span>
        <p className="sdl-lrad__hero-sub">{ringkas(t.totalRealisasi)} telah terealisasi dari {ringkas(t.totalPagu)} pagu</p>
      </div>
      <div className="sdl-lrad__hero-card">
        <span>Anggaran belum terealisasi</span>
        <strong>{ringkas(sisa.toString())}</strong>
        {sisaTerbesar && <p>Sisa anggaran terbesar terdapat pada kegiatan <b>{sisaTerbesar.kode} · {sisaTerbesar.nama}</b> ({ringkas((big(sisaTerbesar.pagu) - big(sisaTerbesar.realisasi)).toString())}).</p>}
        <small>Data per {tgl(t.tanggalAkhir)}{t.waktuUnduh ? ` · diunduh ${fmtUnduh(t.waktuUnduh)}` : ''}</small>
      </div>
    </section>

    <div className="sdl-lrad__kpis">
      <div className="sdl-lrad__kpi"><header><span>Total Pagu Anggaran</span><Ikon d="M3 7h18v12H3zM3 7l2-3h14l2 3M16 13h2" /></header><strong>{ringkas(t.totalPagu)}</strong><small>Alokasi seluruh kegiatan</small></div>
      <div className="sdl-lrad__kpi"><header><span>Total Realisasi</span><Ikon d="M3 17l6-6 4 4 8-8M15 7h6v6" /></header><strong>{ringkas(t.totalRealisasi)}</strong><small>Belanja telah direalisasikan</small></div>
      <div className="sdl-lrad__kpi"><header><span>Sisa Anggaran</span><Ikon d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" /></header><strong>{ringkas(sisa.toString())}</strong><small>{pctText(pct(sisa, pagu))} dari total pagu</small></div>
      <div className="sdl-lrad__kpi"><header><span>Jumlah Kegiatan</span><Ikon d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" /></header><strong>{t.kegiatan.length}</strong><small>{jenisAktif} jenis belanja aktif</small></div>
    </div>

    <div className="sdl-lrad__grid">
      <section className="sdl-lrad__panel" aria-label="Serapan per kegiatan">
        <header><div><span className="sdl-lrad__eyebrow">Per kegiatan</span><h3>Serapan per Kegiatan</h3><p>Diurutkan berdasarkan pagu terbesar.</p></div><span className="sdl-lrad__chip">{keg.length} Kegiatan</span></header>
        <ul className="sdl-lrad__acts">{keg.map((k) => { const p = pct(big(k.realisasi), big(k.pagu)); return <li key={k.kode} title={`${k.kode} ${k.nama}\nRealisasi ${rupiah(k.realisasi)} dari pagu ${rupiah(k.pagu)}`}>
          <div className="sdl-lrad__act-top"><div><strong><span>{k.kode}</span> {k.nama}</strong><small>Realisasi {ringkas(k.realisasi)} dari pagu {ringkas(k.pagu)}</small></div><b>{pctText(p)}</b></div>
          <span className="sdl-lrad__track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={`Serapan ${k.nama}`}><span style={{ width: `${Math.min(100, p)}%` }} /></span>
        </li> })}</ul>
        <p className="sdl-lrad__note"><i aria-hidden="true" /> Realisasi dibanding pagu · nominal di bawah nama kegiatan</p>
      </section>
      <section className="sdl-lrad__panel" aria-label="Komposisi jenis belanja">
        <header><div><span className="sdl-lrad__eyebrow">Komposisi belanja</span><h3>Komposisi Jenis Belanja</h3><p>Berdasarkan total realisasi, bukan pagu.</p></div><span className="sdl-lrad__chip">Realisasi</span></header>
        {irisan.length ? <Donat irisan={irisan} total={real} /> : <p className="sdl-lrad__muted">Belum ada realisasi.</p>}
      </section>
    </div>

    {bln.length > 0 && <section className="sdl-lrad__panel" aria-label="Realisasi per bulan">
      <header><div><span className="sdl-lrad__eyebrow">Per bulan</span><h3>Realisasi per Bulan</h3><p>Selisih potret myinterest akhir bulan berurutan.</p></div></header>
      <div className="sdl-lrad__cols" role="img" aria-label={`Realisasi per bulan: ${bln.map((b) => `${BULAN3[b.bulan - 1]} ${ringkas(b.bulanIni ?? '0')}`).join(', ')}`}>
        {bln.map((b) => <div key={b.bulan} className="sdl-lrad__col" title={`${BULAN3[b.bulan - 1]}: ${rupiah(b.bulanIni ?? '0')} (kumulatif ${rupiah(b.kumulatif)})`}>
          <small>{ringkas(b.bulanIni ?? '0')}</small>
          <span className="sdl-lrad__slot"><span style={{ height: `${maxBulan > 0n ? Math.max(3, Number((big(b.bulanIni) * 1000n) / maxBulan) / 10) : 0}%` }} /></span>
          <b>{BULAN3[b.bulan - 1]}</b></div>)}
      </div>
      {data.bulanan.length > bln.length && <p className="sdl-lrad__muted">Bulan tanpa potret bulan sebelumnya tidak bisa dihitung selisihnya.</p>}
    </section>}
  </div>
}
