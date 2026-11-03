import { useEffect, useMemo, useState } from 'react'
import './ExecutiveOverviewR5F8.css'

type Metric={label:string;value:number|null;unit?:string;detail?:string}
type Breakdown={key:string;label:string;value:number}
type Unit={id:'urmin'|'ren'|'sumda'|'binfung';title:string;ready:boolean;metrics:Metric[];breakdown:Breakdown[];placements?:Breakdown[];note?:string}
type Trend={month:string;suratMasuk:number}
type Result={period:string;generatedAt:string;units:Unit[];trend:Trend[]|null;source:'live'}
const titles:Record<Unit['id'],string>={urmin:'Urusan Administrasi',ren:'Perencanaan',sumda:'Sumber Daya',binfung:'Pembinaan Fungsi'}
const icons:Record<Unit['id'],string>={urmin:'✉',ren:'▤',sumda:'♙',binfung:'◇'}
const periods=[{value:'30d',label:'30 Hari'},{value:'90d',label:'90 Hari'},{value:'365d',label:'12 Bulan'},{value:'all',label:'Semua'}]
function metricNumber(m?:Metric):string {
 if(!m||m.value===null||m.value===undefined)return '—'
 if(m.unit==='IDR')return 'Rp '+new Intl.NumberFormat('id-ID',{notation:'compact',maximumFractionDigits:1}).format(m.value)
 return new Intl.NumberFormat('id-ID').format(m.value)
}
function monthName(ym:string){const [y,m]=ym.split('-').map(Number);if(!y||!m)return ym;return new Intl.DateTimeFormat('id-ID',{month:'short',year:'2-digit'}).format(new Date(y,m-1,1))}
function readiness(unit:Unit){if(!unit.ready)return 'Belum Tersambung';return 'Data Tersedia'}
function attention(unit:Unit){if(!unit.ready)return null
 if(unit.id==='urmin')return unit.metrics.find(m=>m.label==='Perlu Perhatian')?.value??null
 if(unit.id==='sumda')return unit.metrics.find(m=>m.label==='BMN Perlu Perhatian')?.value??null
 if(unit.id==='binfung')return unit.metrics.find(m=>m.label==='SOP Belum Final')?.value??null
 if(unit.id==='ren')return unit.breakdown.find(b=>b.key==='pending')?.value??null
 return null}
function percent(unit:Unit):{label:string;value:number}|null{
 if(!unit.ready)return null
 const first=(name:string)=>unit.metrics.find(x=>x.label===name)?.value ?? 0
 let part=0,whole=0,label=''
 if(unit.id==='ren'){part=unit.breakdown.find(x=>x.key==='verified')?.value??0;whole=first('Pengajuan Anggaran');label='Pagu terverifikasi'}
 if(unit.id==='sumda'){part=first('BMN Kondisi Baik');whole=first('BMN Tercatat');label='Entri BMN kondisi baik'}
 if(unit.id==='binfung'){part=first('SOP Berstatus Final');whole=first('SOP Tercatat');label='SOP berstatus final'}
 if(unit.id==='urmin')return null
 return whole>0?{label,value:Math.max(0,Math.min(100,Math.round(part/whole*100)))}:null
}
export default function ExecutiveOverviewR5F8({onBack}:{onBack:()=>void}){
 const [period,setPeriod]=useState('90d')
 const [data,setData]=useState<Result|null>(null)
 const [selected,setSelected]=useState<string>('all')
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [revision,setRevision]=useState(0)
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('');
  fetch('/api/v1/executive/overview?period='+encodeURIComponent(period),{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async r=>{if(r.status===403)throw new Error('Anda tidak memiliki akses ke Executive Overview.');if(!r.ok)throw new Error('Ringkasan belum dapat dimuat.');return await r.json() as Result})
   .then(payload=>{if(!Array.isArray(payload.units)||payload.source!=='live')throw new Error('Data ringkasan tidak valid.');setData(payload)})
   .catch(e=>{if(!controller.signal.aborted){setData(null);setError(e instanceof Error?e.message:'Gagal memuat data.')}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[period,revision])
 const units=useMemo(()=>data?.units??[],[data]);
 const selectedUnit=units.find(u=>u.id===selected)
 const activeAlerts=units.filter(u=>attention(u)!==null && (attention(u)??0)>0)
 const months=useMemo(()=>{if(!data?.trend)return null;const byMonth=new Map(data.trend.map(t=>[t.month,t.suratMasuk]));const now=new Date();return Array.from({length:6},(_,i)=>{const date=new Date(now.getFullYear(),now.getMonth()-5+i,1);const key=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');return {month:key,value:byMonth.get(key)??0}})},[data])
 const maxBar=Math.max(1,...(months?.map(x=>x.value)??[1]))
 return <div className="sdl-exec">
   <div className="sdl-exec__toolbar"><button className="sdl-exec__back" type="button" onClick={onBack}>← Portal</button><span className="sdl-exec__eyebrow">SIERA DELTA LIMA · BAGRENMIN DENSUS 88 AT POLRI</span></div>
   <section className="sdl-exec__hero"><div><span className="sdl-exec__kicker">EXECUTIVE COMMAND CENTER</span><h1>Executive Overview</h1><p>Pantau kondisi empat unit dalam satu tampilan. Seluruh angka berasal dari data aplikasi yang tersedia.</p></div><div className="sdl-exec__hero-action"><label htmlFor="sdl-exec-period">Periode data</label><select id="sdl-exec-period" value={period} onChange={e=>setPeriod(e.target.value)}>{periods.map(p=><option key={p.value} value={p.value}>{p.label}</option>)}</select><button type="button" onClick={()=>setRevision(v=>v+1)} disabled={loading}>↻ Perbarui</button></div></section>
   <div className="sdl-exec__meta">{loading?'Memuat ringkasan…':error?'Laporan tidak tersedia':data?`Diperbarui ${new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'}).format(new Date(data.generatedAt))} WIB · Data aktual`:'—'}</div>
   {error&&<div role="alert" className="sdl-exec__error">{error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Coba lagi</button></div>}
   {data&&<>
   <div className="sdl-exec__brief">
    <div><span className="sdl-exec__brief-label">UNIT DIPANTAU</span><strong>{units.length} <small>unit</small></strong><p>URMIN dan 3 Subbag</p></div>
    <div><span className="sdl-exec__brief-label">SUMBER DATA AKTIF</span><strong>{units.filter(u=>u.ready).length} <small>dari 4</small></strong><p>Tersambung ke register</p></div>
    <div><span className="sdl-exec__brief-label">UNIT PERLU PERHATIAN</span><strong>{activeAlerts.length} <small>unit</small></strong><p>Dari sumber data tersedia*</p></div>
    <div><span className="sdl-exec__brief-label">SURAT MASUK</span><strong>{metricNumber(units.find(u=>u.id==='urmin')?.metrics[0])}</strong><p>Terdaftar dalam periode</p></div>
   </div>
   <div className="sdl-exec__section-head"><div><h2>Ringkasan Per Unit</h2><p>Klik unit untuk melihat rincian indikator operasional.</p></div><div className="sdl-exec__switch"><button type="button" className={selected==='all'?'active':''} onClick={()=>setSelected('all')}>Semua Unit</button>{units.map(u=><button key={u.id} type="button" className={selected===u.id?'active':''} onClick={()=>setSelected(u.id)}>{u.title}</button>)}</div></div>
   <div className="sdl-exec__units">{units.filter(u=>selected==='all'||u.id===selected).map(u=>{
      const p=percent(u);const a=attention(u);
      return <button type="button" key={u.id} className={'sdl-exec__unit sdl-exec__unit--'+u.id+(selected===u.id?' is-selected':'')} onClick={()=>setSelected(selected===u.id?'all':u.id)} aria-expanded={selected===u.id}>
       <span className="sdl-exec__unit-top"><span className="sdl-exec__unit-icon">{icons[u.id]}</span><span className={'sdl-exec__status '+(u.ready?'is-ready':'')}>{readiness(u)}</span></span>
       <strong>{u.title}</strong><span className="sdl-exec__unit-sub">{titles[u.id]}</span>
       {u.ready?<><span className="sdl-exec__unit-stats">{u.metrics.slice(0,4).map(m=><span key={m.label}><small>{m.label}</small><b>{metricNumber(m)}</b></span>)}</span>
       {p&&<span className="sdl-exec__progress"><span><small>{p.label}</small><b>{p.value}%</b></span><span className="sdl-exec__track"><span style={{width:p.value+'%'}}/></span></span>}
       {a!==null&&a>0&&<span className="sdl-exec__alert">● {a.toLocaleString('id-ID')} item perlu perhatian</span>}</>:<span className="sdl-exec__empty">{u.note}</span>}
       <span className="sdl-exec__unit-link">{selected===u.id?'Tutup detail ↑':'Lihat detail →'}</span>
      </button>})}</div>
   {selectedUnit&&<section className="sdl-exec__detail"><div className="sdl-exec__section-head"><div><h2>Rincian {selectedUnit.title}</h2><p>{selectedUnit.note||'Indikator tersedia pada periode terpilih.'}</p></div><button type="button" onClick={()=>setSelected('all')}>Tutup ×</button></div>{selectedUnit.ready?<div className="sdl-exec__detail-cols"><div>{selectedUnit.metrics.map(m=><div className="sdl-exec__detail-stat" key={m.label}><span>{m.label}<small>{m.detail||''}</small></span><strong>{metricNumber(m)}</strong></div>)}</div><div><h3>Komposisi Status</h3>{selectedUnit.breakdown.length>0?selectedUnit.breakdown.map(b=>{const max=Math.max(1,...selectedUnit.breakdown.map(x=>x.value));return <div key={b.key} className="sdl-exec__breakdown"><span>{b.label} <b>{b.value.toLocaleString('id-ID')}</b></span><div><i style={{width:100*b.value/max+'%'}}/></div></div>}):<p>Belum ada komposisi yang dapat ditampilkan.</p>}{selectedUnit.placements?.length ? <><h3>Penempatan Personel (Unit Kerja)</h3>{selectedUnit.placements.map(b=><div key={b.key} className="sdl-exec__placement"><span>{b.label}</span><strong>{b.value.toLocaleString('id-ID')}</strong></div>)}</>:null}</div></div>:<p>{selectedUnit.note}</p>}</section>}
   <div className="sdl-exec__lower"><section className="sdl-exec__panel"><div className="sdl-exec__section-head"><div><h2>Tren Surat Masuk</h2><p>Surat yang sudah terdaftar, hingga enam bulan terakhir.</p></div></div>{months&&units.find(u=>u.id==='urmin')?.ready?<div className="sdl-exec__chart" role="img" aria-label="Grafik tren bulanan surat masuk">{months.map(p=><div className="sdl-exec__barcol" key={p.month}><strong>{p.value.toLocaleString('id-ID')}</strong><span className="sdl-exec__barslot"><span style={{height:Math.max(p.value?6:0,p.value/maxBar*100)+'%'}}/></span><small>{monthName(p.month)}</small></div>)}</div>:<p className="sdl-exec__empty">Tren belum tersedia dari sumber data.</p>}</section>
   <section className="sdl-exec__panel"><div className="sdl-exec__section-head"><div><h2>Prioritas Perhatian</h2><p>Indikator yang perlu dipantau pimpinan.</p></div></div>{activeAlerts.length?activeAlerts.map(u=><button key={u.id} className="sdl-exec__priority" type="button" onClick={()=>setSelected(u.id)}><span><b>{u.title}</b><small>{u.id==='urmin'?'Terlambat / menunggu arahan':u.id==='ren'?'Pengajuan belum diverifikasi':u.id==='sumda'?'BMN butuh penanganan':'SOP belum final'}</small></span><strong>{attention(u)?.toLocaleString('id-ID')} →</strong></button>):<div className="sdl-exec__empty">{units.every(u=>u.ready)?'Tidak ada indikator perhatian pada data yang tersedia.':'Tidak ada indikator perhatian terhitung; sebagian sumber data belum tersedia.'}</div>}</section></div>
   <p className="sdl-exec__footnote">* Indikator perhatian memiliki definisi berbeda per unit dan tidak dapat dijumlahkan sebagai satu jenis tugas. Data tampil agregat; halaman ini tidak membuka dokumen atau informasi personal. Status akhir dan target kinerja resmi memerlukan validasi definisi bisnis lebih lanjut.</p>
   </>}
 </div>
}
