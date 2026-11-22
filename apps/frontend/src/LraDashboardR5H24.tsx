import { useState } from 'react'
import { rupiah } from './ProgarR5H11'
import { fmtUnduh, ringkas, type LraData } from './MyinterestR5H20'
import './LraDashboardR5H24.css'

/**
 * R5H24 (2026-11-20): tampilan menu "Data myinterest (LRA)" mengikuti referensi pemilik
 * mockup/redesign/references/dashboad_ren.jpg — hero serapan, empat ringkasan, serapan per
 * kegiatan (urut pagu terbesar), komposisi jenis belanja (donat), dan realisasi per bulan.
 * 2026-11-22: permintaan pengguna agar semua isi Excel tampil: donat disertai tabel
 * pagu/realisasi/%/sisa per jenis, dan tabel Rincian per kegiatan (bisa dibuka per jenis).
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
const urutPagu = <T extends { pagu: bigint }>(a: T, b: T) => (b.pagu > a.pagu ? 1 : b.pagu < a.pagu ? -1 : 0)
/** Rupiah penuh/ringkas yang aman untuk nilai negatif (realisasi melebihi pagu). */
const rp = (b: bigint) => (b < 0n ? `−${rupiah((-b).toString())}` : rupiah(b.toString()))
const rpPendek = (b: bigint) => (b < 0n ? `−${ringkas((-b).toString())}` : ringkas(b.toString()))

type Irisan = { key: string; nama: string; slot: number; nilai: bigint }
type Jenis = { key: string; nama: string; slot: number; irisan: string; pagu: bigint; realisasi: bigint }
type Kegiatan = NonNullable<LraData['terbaru']>['kegiatan'][number]

function Serapan({ p, label }: { p: number; label: string }) {
  return <span className="sdl-lrad__pct"><b>{pctText(p)}</b>
    <span className="sdl-lrad__track is-mini" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={label}><span style={{ width: `${Math.min(100, p)}%` }} /></span></span>
}

const Angka = ({ pagu, realisasi, bar, label }: { pagu: bigint; realisasi: bigint; bar: boolean; label: string }) => {
  const p = pct(realisasi, pagu); const sisa = pagu - realisasi
  return <><td>{rp(pagu)}</td><td>{rp(realisasi)}</td><td>{bar ? <Serapan p={p} label={label} /> : pctText(p)}</td><td className={sisa < 0n ? 'is-minus' : undefined}>{rp(sisa)}</td></>
}
const KEPALA = <thead><tr><th scope="col">Uraian</th><th scope="col">Pagu</th><th scope="col">Realisasi</th><th scope="col">% Realisasi</th><th scope="col">Sisa</th></tr></thead>

/** Donat komposisi realisasi + tabel pagu/realisasi/serapan/sisa per jenis belanja (sorotan saling terhubung). */
function Komposisi({ irisan, jenis, totalPagu, totalReal }: { irisan: Irisan[]; jenis: Jenis[]; totalPagu: bigint; totalReal: bigint }) {
  const [aktif, setAktif] = useState<string | null>(null)
  const R = 70; const C = 2 * Math.PI * R; const GAP = irisan.length > 1 ? 2 : 0
  let off = 0
  const segs = irisan.map((x) => {
    const frac = totalReal > 0n ? Number((x.nilai * 100000n) / totalReal) / 100000 : 0
    const len = Math.max(0, frac * C - GAP)
    const s = { ...x, frac, dash: `${len} ${C - len}`, offset: -off }
    off += frac * C
    return s
  })
  const a = segs.find((s) => s.key === aktif)
  const sorot = (k: string | null) => () => setAktif(k)
  return <div className="sdl-lrad__komposisi">
    <div className="sdl-lrad__donut-wrap">
      {segs.length ? <svg viewBox="0 0 200 200" className="sdl-lrad__donut" role="img" aria-label={`Komposisi realisasi: ${segs.map((s) => `${s.nama} ${pctText(s.frac * 100)}`).join(', ')}`}>
        <g transform="rotate(-90 100 100)">
          <circle cx="100" cy="100" r={R} className="sdl-lrad__donut-track" />
          {segs.map((s) => <circle key={s.key} cx="100" cy="100" r={R} className={`sdl-lrad__seg is-s${s.slot}${aktif && aktif !== s.key ? ' is-dim' : ''}`}
            strokeDasharray={s.dash} strokeDashoffset={s.offset} onMouseEnter={sorot(s.key)} onMouseLeave={sorot(null)}>
            <title>{`${s.nama}: ${rupiah(s.nilai.toString())} (${pctText(s.frac * 100)} dari realisasi)`}</title>
          </circle>)}
        </g>
        <text x="100" y="86" textAnchor="middle" className="sdl-lrad__donut-cap">{a ? a.nama.replace('Belanja ', '').toUpperCase() : 'TOTAL REALISASI'}</text>
        <text x="100" y="112" textAnchor="middle" className="sdl-lrad__donut-val">{(a ? ringkas(a.nilai.toString()) : ringkas(totalReal.toString())).replace('Rp ', '')}</text>
        <text x="100" y="130" textAnchor="middle" className="sdl-lrad__donut-cap">{a ? pctText(a.frac * 100) : ''}</text>
      </svg> : <p className="sdl-lrad__muted">Belum ada realisasi.</p>}
      <small className="sdl-lrad__muted">Lingkaran: porsi tiap jenis dalam total realisasi.</small>
    </div>
    <div className="sdl-lrad__tablewrap">
      <table className="sdl-lrad__table">
        {KEPALA}
        <tbody>{jenis.map((j) => <tr key={j.key} className={aktif === j.irisan ? 'is-on' : undefined} onMouseEnter={sorot(j.irisan)} onMouseLeave={sorot(null)}>
          <th scope="row"><i className={`sdl-lrad__sw is-s${j.slot}`} aria-hidden="true" />{j.nama}</th>
          <Angka pagu={j.pagu} realisasi={j.realisasi} bar label={`Serapan ${j.nama}`} />
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">Total</th><Angka pagu={totalPagu} realisasi={totalReal} bar label="Serapan total" /></tr></tfoot>
      </table>
    </div>
  </div>
}

/** Tabel rincian seperti susunan Excel myinterest: kegiatan, bisa dibuka per jenis belanja. */
function Rincian({ kegiatan, totalPagu, totalReal }: { kegiatan: Kegiatan[]; totalPagu: bigint; totalReal: bigint }) {
  const [buka, setBuka] = useState<Set<string>>(new Set())
  const semua = kegiatan.length > 0 && buka.size === kegiatan.length
  const toggle = (kode: string) => setBuka((s) => { const n = new Set(s); if (n.has(kode)) n.delete(kode); else n.add(kode); return n })
  return <section className="sdl-lrad__panel" aria-label="Rincian per kegiatan">
    <header><div><span className="sdl-lrad__eyebrow">Rincian</span><h3>Rincian per Kegiatan dan Jenis Belanja</h3><p>Angka lengkap sesuai berkas myinterest. Klik kegiatan untuk melihat rincian jenis belanjanya.</p></div>
      <button type="button" className="sdl-lrad__print" onClick={() => setBuka(semua ? new Set() : new Set(kegiatan.map((k) => k.kode)))}>{semua ? 'Tutup semua' : 'Buka semua'}</button></header>
    <div className="sdl-lrad__tablewrap">
      <table className="sdl-lrad__table is-rincian">
        {KEPALA}
        {kegiatan.map((k) => {
          const terbuka = buka.has(k.kode)
          const sub = Object.entries(k.jenis ?? {}).map(([key, v]) => ({ key, pagu: big(v.pagu), realisasi: big(v.realisasi) })).filter((j) => j.pagu > 0n || j.realisasi > 0n).sort(urutPagu)
          return <tbody key={k.kode} className={terbuka ? 'is-open' : undefined}>
            <tr className="sdl-lrad__keg">
              <th scope="row"><button type="button" aria-expanded={terbuka} onClick={() => toggle(k.kode)}><span className="sdl-lrad__caret" aria-hidden="true">▸</span><span className="sdl-lrad__kode">{k.kode}</span>{k.nama}</button></th>
              <Angka pagu={big(k.pagu)} realisasi={big(k.realisasi)} bar label={`Serapan ${k.nama}`} />
            </tr>
            {sub.map((j) => <tr key={j.key} className="sdl-lrad__sub">
              <th scope="row"><i className={`sdl-lrad__sw is-s${SLOT[j.key] ?? 0}`} aria-hidden="true" />{JENIS_NAMA[j.key] ?? j.key}</th>
              <Angka pagu={j.pagu} realisasi={j.realisasi} bar={false} label="" />
            </tr>)}
          </tbody>
        })}
        <tfoot><tr><th scope="row">Grand total</th><Angka pagu={totalPagu} realisasi={totalReal} bar={false} label="" /></tr></tfoot>
      </table>
    </div>
  </section>
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
  // Tabel per jenis: setiap jenis yang punya pagu/realisasi, urut pagu terbesar.
  const jenis: Jenis[] = Object.entries(t.perJenis).map(([k, v]) => ({ key: k, nama: JENIS_NAMA[k] ?? k, slot: SLOT[k] ?? 0, irisan: SLOT[k] ? k : 'lainnya', pagu: big(v.pagu), realisasi: big(v.realisasi) }))
    .filter((j) => j.pagu > 0n || j.realisasi > 0n).sort(urutPagu)
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
        <strong>{rpPendek(sisa)}</strong>
        {sisaTerbesar && <p>Sisa anggaran terbesar terdapat pada kegiatan <b>{sisaTerbesar.kode} · {sisaTerbesar.nama}</b> ({ringkas((big(sisaTerbesar.pagu) - big(sisaTerbesar.realisasi)).toString())}).</p>}
        <small>Data per {tgl(t.tanggalAkhir)}{t.waktuUnduh ? ` · diunduh ${fmtUnduh(t.waktuUnduh)}` : ''}</small>
      </div>
    </section>

    <div className="sdl-lrad__kpis">
      <div className="sdl-lrad__kpi"><header><span>Total Pagu Anggaran</span><Ikon d="M3 7h18v12H3zM3 7l2-3h14l2 3M16 13h2" /></header><strong>{ringkas(t.totalPagu)}</strong><small>Alokasi seluruh kegiatan</small></div>
      <div className="sdl-lrad__kpi"><header><span>Total Realisasi</span><Ikon d="M3 17l6-6 4 4 8-8M15 7h6v6" /></header><strong>{ringkas(t.totalRealisasi)}</strong><small>Belanja telah direalisasikan</small></div>
      <div className="sdl-lrad__kpi"><header><span>Sisa Anggaran</span><Ikon d="M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" /></header><strong>{rpPendek(sisa)}</strong><small>{pctText(pct(sisa, pagu))} dari total pagu</small></div>
      <div className="sdl-lrad__kpi"><header><span>Jumlah Kegiatan</span><Ikon d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" /></header><strong>{t.kegiatan.length}</strong><small>{jenisAktif} jenis belanja aktif</small></div>
    </div>

    <section className="sdl-lrad__panel" aria-label="Anggaran dan realisasi per jenis belanja">
      <header><div><span className="sdl-lrad__eyebrow">Per jenis belanja</span><h3>Anggaran dan Realisasi per Jenis Belanja</h3><p>Pagu, realisasi, persentase serapan, dan sisa anggaran setiap jenis belanja.</p></div><span className="sdl-lrad__chip">{jenis.length} Jenis</span></header>
      <Komposisi irisan={irisan} jenis={jenis} totalPagu={pagu} totalReal={real} />
    </section>

    <section className="sdl-lrad__panel" aria-label="Serapan per kegiatan">
      <header><div><span className="sdl-lrad__eyebrow">Per kegiatan</span><h3>Serapan per Kegiatan</h3><p>Diurutkan berdasarkan pagu terbesar.</p></div><span className="sdl-lrad__chip">{keg.length} Kegiatan</span></header>
      <ul className="sdl-lrad__acts">{keg.map((k) => { const p = pct(big(k.realisasi), big(k.pagu)); return <li key={k.kode} title={`${k.kode} ${k.nama}\nRealisasi ${rupiah(k.realisasi)} dari pagu ${rupiah(k.pagu)}`}>
        <div className="sdl-lrad__act-top"><div><strong><span>{k.kode}</span> {k.nama}</strong><small>Realisasi {ringkas(k.realisasi)} dari pagu {ringkas(k.pagu)} · sisa {rpPendek(big(k.pagu) - big(k.realisasi))}</small></div><b>{pctText(p)}</b></div>
        <span className="sdl-lrad__track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p} aria-label={`Serapan ${k.nama}`}><span style={{ width: `${Math.min(100, p)}%` }} /></span>
      </li> })}</ul>
      <p className="sdl-lrad__note"><i aria-hidden="true" /> Realisasi dibanding pagu · angka lengkap ada di tabel Rincian</p>
    </section>

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

    <Rincian kegiatan={keg} totalPagu={pagu} totalReal={real} />
  </div>
}
