import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import './SmartUnitDashboard.css'

type UnitKey = 'urmin'|'ren'|'sumda'|'binfung'
type Source = { id:string; title:string; route:string; endpoint:string; kind?:string }
type Row = { id:string; source:string; label:string; title:string; status:string; date:string; amount?:number }
type Loaded = { rows:Row[]; available:number; total:number; failures:string[]; budget?:{pagu:number;realization:number} }
type Range = 30|90|365|0

type RawItem = {id?:string;title?:string;code?:string;number?:number;status?:string;reviewStatus?:string;createdAt?:string;transactionDate?:string;authorizationDate?:string;fields?:Record<string,string>;amount?:string|number;proposedBudget?:number;authorizationNumber?:string;proposalTitle?:string;description?:string;fiscalYear?:number}

const sources:Record<UnitKey,Source[]> = {
  urmin:[
    {id:'masuk',title:'Surat Masuk',route:'surat-masuk',endpoint:'/api/v1/urmin/surat-masuk/'},
    {id:'keluar',title:'Surat Keluar',route:'surat-keluar',endpoint:'/api/v1/urmin/registry/?kind=surat_keluar'},
    {id:'agenda',title:'Agenda & Rapat',route:'agenda',endpoint:'/api/v1/urmin/registry/?kind=agenda'},
    {id:'arsip',title:'Arsip & Dokumentasi',route:'arsip',endpoint:'/api/v1/urmin/registry/?kind=arsip'},
    {id:'berkas',title:'Berkas & Tugas',route:'__unitwork',endpoint:'/api/v1/unit-work/urmin/records'}
  ],
  ren:[
    {id:'usulan',title:'Usulan Kebutuhan',route:'usulan',endpoint:'/api/v1/subbagren/usulan/'},
    {id:'berkas',title:'Berkas & Tugas',route:'__unitwork',endpoint:'/api/v1/unit-work/subbagren/records'}
  ],
  sumda:[
    {id:'personel',title:'Data Personel',route:'personel',endpoint:'/api/v1/subbagsumda/registry/?kind=personel'},
    {id:'pendidikan',title:'Pendidikan & Pelatihan',route:'pendidikan',endpoint:'/api/v1/subbagsumda/registry/?kind=pendidikan'},
    {id:'inventaris',title:'Inventaris & BMN',route:'inventaris',endpoint:'/api/v1/subbagsumda/registry/?kind=inventaris'},
    {id:'berkas',title:'Berkas & Tugas',route:'__unitwork',endpoint:'/api/v1/unit-work/subbagsumda/records'}
  ],
  binfung:[
    {id:'sop',title:'SOP & Regulasi',route:'sop',endpoint:'/api/v1/subbagbinfung/registry/?kind=sop'},
    {id:'pid',title:'Informasi & Dokumentasi',route:'pid',endpoint:'/api/v1/subbagbinfung/registry/?kind=pid'},
    {id:'rb',title:'RB & SPIP',route:'rb',endpoint:'/api/v1/subbagbinfung/registry/?kind=rb'},
    {id:'abk',title:'Analisis Beban Kerja',route:'abk',endpoint:'/api/v1/subbagbinfung/registry/?kind=abk'},
    {id:'pembinaan',title:'Program Pembinaan',route:'pembinaan',endpoint:'/api/v1/subbagbinfung/registry/?kind=pembinaan'},
    {id:'evaluasi',title:'Evaluasi Organisasi',route:'evaluasi',endpoint:'/api/v1/subbagbinfung/registry/?kind=evaluasi'},
    {id:'berkas',title:'Berkas & Tugas',route:'__unitwork',endpoint:'/api/v1/unit-work/subbagbinfung/records'}
  ]
}
const colors = ['#3b88a3','#d7a95f','#8772c6','#39a98c','#748fb8','#cd8b75','#5b78bd']
const money=(amount:number)=>new Intl.NumberFormat('id-ID',{notation:'compact',maximumFractionDigits:1}).format(amount)
const dateLabel=(s:string)=>{const d=new Date(s);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}
const parseAmount=(raw:unknown)=>{const n=typeof raw==='number'?raw:Number(raw);return Number.isFinite(n)&&n>=0?n:0}
function validDate(s:string){const n=Date.parse(s);return Number.isFinite(n)?n:0}
function toRow(item:RawItem,source:Source):Row {
  const fields=item.fields||{}
  const status=fields.status||fields.kondisi||item.reviewStatus||item.status||'Tercatat'
  return {id:String(item.id||''),source:source.id,label:source.title,title:item.title||item.proposalTitle||item.description||item.code||String(item.number||source.title),status,date:item.createdAt||item.transactionDate||item.authorizationDate||fields.tanggalMulai||'',amount:parseAmount(item.proposedBudget??item.amount)}
}
async function fetchJSON(path:string,signal:AbortSignal):Promise<unknown>{
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal})
  if(!response.ok)throw new Error(`${response.status}`)
  return response.json()
}
function getItems(data:unknown):RawItem[]{
  if(!data||typeof data!=='object')return []
  const items=(data as {items?:unknown}).items
  return Array.isArray(items)?items as RawItem[]:[]
}
function pulsePoints(counts:number[]):string {
  const max=Math.max(...counts,1)
  return counts.map((n,i)=>`${24+(i*524)/Math.max(counts.length-1,1)},${136-(n/max)*105}`).join(' ')
}

export default function SmartUnitDashboard({unit,title,accent,onOpen}:{unit:UnitKey;title:string;accent:string;onOpen:(route:string)=>void}) {
  const [range,setRange]=useState<Range>(90)
  const [refreshID,setRefreshID]=useState(0)
  const [data,setData]=useState<Loaded|null>(null)
  const [busy,setBusy]=useState(true)
  const [fetchError,setFetchError]=useState('')
  const [pickedSource,setPickedSource]=useState('all')
  const [pickedStatus,setPickedStatus]=useState('all')
  const [selectedBucket,setSelectedBucket]=useState<number|null>(null)
  const [detailsOpen,setDetailsOpen]=useState(false)
  const config=sources[unit]
  const load=useCallback(async(signal:AbortSignal)=>{
    setBusy(true);setFetchError('');setData(null)
    const settled=await Promise.allSettled([
      ...config.map(s=>fetchJSON(s.endpoint,signal)),
      ...(unit==='ren'?[fetchJSON(`/api/v1/subbagren/budget/?year=${new Date().getFullYear()}`,signal)]:[])
    ])
    if(signal.aborted)return
    const rows:Row[]=[];let available=0;const failures:string[]=[]
    config.forEach((s,i)=>{
      const result=settled[i]
      if(result.status==='fulfilled'){
        available++
        rows.push(...getItems(result.value).filter(x=>x.id).map(item=>toRow(item,s)))
      }else failures.push(s.title)
    })
    let budget:Loaded['budget']
    if(unit==='ren'){
      const result=settled[config.length]
      if(result?.status==='fulfilled'){
        available++
        const o=result.value as {pagus?:RawItem[];realizations?:RawItem[];totals?:{paguVerified?:string;realizationVerified?:string}}
        budget={pagu:parseAmount(o.totals?.paguVerified),realization:parseAmount(o.totals?.realizationVerified)}
        rows.push(...(o.pagus||[]).filter(x=>x.id).map(x=>toRow({...x,title:x.proposalTitle||'Pagu Anggaran'}, {id:'pagu',title:'Pagu Anggaran',route:'realisasi',endpoint:''})))
        rows.push(...(o.realizations||[]).filter(x=>x.id).map(x=>toRow({...x,title:x.description||'Realisasi Anggaran'},{id:'realisasi',title:'Realisasi Anggaran',route:'realisasi',endpoint:''})))
      }else failures.push('Realisasi Anggaran')
    }
    setData({rows,available,total:config.length+(unit==='ren'?1:0),failures,budget})
    setBusy(false)
  },[unit,config])
  useEffect(()=>{const ctrl=new AbortController();void load(ctrl.signal).catch(()=>{if(!ctrl.signal.aborted){setBusy(false);setFetchError('Data belum dapat dimuat.')}});return()=>ctrl.abort()},[load,refreshID])
  useEffect(()=>{setPickedSource('all');setPickedStatus('all');setSelectedBucket(null);setDetailsOpen(false)},[unit,range])

  const withinRange=useMemo(()=>{
    const threshold=range?Date.now()-range*86400000:0
    return (data?.rows||[]).filter(r=>range===0||(validDate(r.date)>0&&validDate(r.date)>=threshold))
  },[data,range])
  const counted=withinRange.length
  const groupCounts=useMemo(()=>{
    return [...config.map((s,i)=>({source:s.id,label:s.title,count:withinRange.filter(r=>r.source===s.id).length,color:colors[i%colors.length],route:s.route})),...(unit==='ren'?[{source:'pagu',label:'Pagu Anggaran',count:withinRange.filter(r=>r.source==='pagu').length,color:colors[2],route:'realisasi'},{source:'realisasi',label:'Realisasi Anggaran',count:withinRange.filter(r=>r.source==='realisasi').length,color:colors[3],route:'realisasi'}]:[])]
  },[withinRange,config,unit])
  const statuses=useMemo(()=>{
    const map=new Map<string,number>()
    withinRange.forEach(r=>{const key=r.status.trim()||'Tercatat';map.set(key,(map.get(key)||0)+1)})
    return Array.from(map,([label,count],i)=>({label,count,color:colors[i%colors.length]})).sort((a,b)=>b.count-a.count).slice(0,7)
  },[withinRange])
  const bucketInfo=useMemo(()=>{
    const now=Date.now()
    const span=range===0?Math.max(365*86400000,now-Math.min(...withinRange.filter(r=>validDate(r.date)).map(r=>validDate(r.date)),now)):range*86400000
    const start=now-span
    return Array.from({length:6},(_,i)=>{
      const left=start+span*i/6,right=start+span*(i+1)/6
      const count=withinRange.filter(r=>{const t=validDate(r.date);return t>0&&t>=left&&t<(i===5?right+1000:right)}).length
      return {i,left,right,count,label:new Date(left).toLocaleDateString('id-ID',{day:'2-digit',month:'short'})}
    })
  },[withinRange,range])
  const filtered=useMemo(()=>withinRange.filter(r=>
    (pickedSource==='all'||pickedSource===r.source)&&
    (pickedStatus==='all'||pickedStatus===r.status)&&
    (selectedBucket===null||(validDate(r.date)>=bucketInfo[selectedBucket].left&&validDate(r.date)<bucketInfo[selectedBucket].right+1000))
  ).sort((a,b)=>validDate(b.date)-validDate(a.date)),[withinRange,pickedSource,pickedStatus,selectedBucket,bucketInfo])
  const maxGroup=Math.max(1,...groupCounts.map(x=>x.count))
  const maximum=Math.max(1,...bucketInfo.map(x=>x.count))
  const selectedSource=groupCounts.find(x=>x.source===pickedSource)
  const reset=()=>{setPickedSource('all');setPickedStatus('all');setSelectedBucket(null)}
  const isLimited=(data?.available??0)<(data?.total??1)
  const unitStyle={'--dash-accent':accent} as CSSProperties
  return <section className="sdl-smart-dashboard" style={unitStyle} aria-label={`Dashboard ${title}`}>
    <div className="sdl-dash-toolbar">
      <div className="sdl-dash-title"><span className="sdl-dash-kicker">RINGKASAN DATA</span></div>
      <div className="sdl-dash-controls"><label htmlFor={`dash-range-${unit}`}>Periode</label><select id={`dash-range-${unit}`} value={range} onChange={e=>setRange(Number(e.target.value) as Range)}><option value={30}>30 hari</option><option value={90}>90 hari</option><option value={365}>12 bulan</option><option value={0}>Semua waktu</option></select><button type="button" onClick={()=>setRefreshID(n=>n+1)} disabled={busy} aria-label="Refresh dashboard" title="Refresh dashboard">⟳ <span>Refresh</span></button></div>
    </div>
    {fetchError&&<p className="sdl-dash-warning" role="alert">{fetchError}</p>}
    {isLimited&&!busy&&<div className="sdl-dash-warning" role="status">Sebagian sumber data tidak tersedia untuk akun ini. Grafik hanya menggunakan data yang dapat diakses.</div>}
    <div className="sdl-dash-kpis">
      <button type="button" onClick={()=>{reset();setDetailsOpen(true)}} className="sdl-dash-kpi"><span>Aktivitas Tercatat</span><strong>{busy?'…':counted.toLocaleString('id-ID')}</strong><small>Periode terpilih · lihat data ↗</small></button>
      <button type="button" onClick={()=>{reset();setDetailsOpen(true)}} className="sdl-dash-kpi"><span>Kategori Aktif</span><strong>{busy?'…':groupCounts.filter(x=>x.count>0).length}</strong><small>Berdasarkan data yang tersedia</small></button>
      <button type="button" onClick={()=>{reset();setDetailsOpen(true)}} className="sdl-dash-kpi"><span>Status Tercatat</span><strong>{busy?'…':statuses.length}</strong><small>Lihat rincian status ↗</small></button>
      <button type="button" onClick={()=>onOpen('__unitwork')} className="sdl-dash-kpi sdl-dash-kpi--accent"><span>Berkas & Disposisi</span><strong>↗</strong><small>Buka ruang kerja</small></button>
    </div>
    <div className="sdl-dash-panels">
      <section className="sdl-dash-panel sdl-dash-panel--wide"><div className="sdl-dash-panel-head"><div><h3>Activity Trend</h3><p>Catatan terbaru berdasarkan tanggal data</p></div><span className="sdl-dash-period">{range===0?'All time':`${range} days`}</span></div>
        <div className="sdl-dash-chart-area">{!busy&&counted===0?<div className="sdl-dash-empty">Belum ada aktivitas pada periode ini.</div>:<svg viewBox="0 0 575 172" role="img" aria-label="Tren aktivitas enam interval" preserveAspectRatio="none"><line x1="24" y1="136" x2="548" y2="136" stroke="var(--border)" strokeWidth="1"/><line x1="24" y1="84" x2="548" y2="84" stroke="var(--border)" strokeDasharray="4 7"/><line x1="24" y1="31" x2="548" y2="31" stroke="var(--border)" strokeDasharray="4 7"/><polyline fill="none" stroke="var(--dash-accent)" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" points={pulsePoints(bucketInfo.map(x=>x.count))}/>{bucketInfo.map((b,i)=><circle key={i} cx={24+i*524/5} cy={136-(b.count/maximum)*105} r={selectedBucket===i?7:4.8} fill="var(--dash-accent)" stroke="var(--card)" strokeWidth="2" />)}</svg>}
        </div><div className="sdl-dash-ticks">{bucketInfo.map(b=><button key={b.i} type="button" aria-pressed={selectedBucket===b.i} className={selectedBucket===b.i?'active':''} title={`${b.count} aktivitas`} onClick={()=>{setSelectedBucket(v=>v===b.i?null:b.i);setDetailsOpen(true)}}><strong>{b.label}</strong><span>{b.count}</span></button>)}</div>
      </section>
      <section className="sdl-dash-panel"><div className="sdl-dash-panel-head"><div><h3>Record Distribution</h3><p>Klik kategori untuk menampilkan datanya</p></div></div><div className="sdl-dash-distribution">{groupCounts.map(g=><button key={g.source} type="button" aria-pressed={pickedSource===g.source} className={pickedSource===g.source?'selected':''} onClick={()=>{setPickedSource(v=>v===g.source?'all':g.source);setDetailsOpen(true)}}><span className="sdl-dash-bar-label">{g.label}</span><span className="sdl-dash-bar-track"><span style={{width:`${(g.count/maxGroup)*100}%`,background:g.color}}/></span><strong>{g.count}</strong></button>)}{!busy&&counted===0&&<p className="sdl-dash-muted">Belum ada data tercatat.</p>}</div></section>
      <section className="sdl-dash-panel"><div className="sdl-dash-panel-head"><div><h3>Status Overview</h3><p>Pilih status untuk melihat detail</p></div></div><div className="sdl-dash-status-wrap"><div className="sdl-dash-donut" style={{background: statuses.length?`conic-gradient(${statuses.reduce((acc,s,i)=>{const start=statuses.slice(0,i).reduce((n,x)=>n+x.count,0)/Math.max(counted,1)*100;return acc+(i?',':'')+`${s.color} ${start}% ${start+s.count/Math.max(counted,1)*100}%`},'')})`:'var(--subtle)'}}><div><strong>{busy?'…':counted}</strong><small>records</small></div></div><div className="sdl-dash-status-list">{statuses.map(s=><button key={s.label} type="button" aria-pressed={pickedStatus===s.label} className={pickedStatus===s.label?'selected':''} onClick={()=>{setPickedStatus(v=>v===s.label?'all':s.label);setDetailsOpen(true)}}><i style={{background:s.color}}/><span>{s.label}</span><strong>{s.count}</strong></button>)}{statuses.length===0&&<p className="sdl-dash-muted">Belum ada status tercatat.</p>}</div></div></section>
      <section className="sdl-dash-panel sdl-dash-panel--wide"><div className="sdl-dash-panel-head"><div><h3>Recent Activity</h3><p>{selectedSource?.label||'Seluruh kategori'}{pickedStatus!=='all'?' · '+pickedStatus:''}</p></div><div className="sdl-dash-inline-actions">{(pickedSource!=='all'||pickedStatus!=='all'||selectedBucket!==null)&&<button type="button" onClick={reset}>Clear filter</button>}<button type="button" onClick={()=>setDetailsOpen(v=>!v)}>{detailsOpen?'Lebih ringkas':'Lihat semua'} ↗</button></div></div>
        {busy?<p className="sdl-dash-muted">Memuat aktivitas…</p>:filtered.length===0?<div className="sdl-dash-empty">Tidak ada data yang cocok dengan filter.</div>:<div className="sdl-dash-recent">{filtered.slice(0,detailsOpen?50:5).map((item,i)=><button key={`${item.source}-${item.id}-${i}`} type="button" onClick={()=>onOpen(groupCounts.find(g=>g.source===item.source)?.route||'__unitwork')}><span className="sdl-dash-recent-dot" style={{background:groupCounts.find(g=>g.source===item.source)?.color||accent}}/><span className="sdl-dash-recent-main"><strong>{item.title}</strong><small>{item.label} · {dateLabel(item.date)}</small></span><span className="sdl-dash-recent-status">{item.status}</span><span aria-hidden="true">↗</span></button>)}</div>}
        {detailsOpen&&filtered.length>50&&<small className="sdl-dash-muted">Menampilkan 50 catatan terbaru.</small>}
      </section>
      {data?.budget&&<section className="sdl-dash-panel sdl-dash-panel--wide"><div className="sdl-dash-panel-head"><div><h3>Budget Performance</h3><p>Pagu dan realisasi terverifikasi · tahun berjalan</p></div><button type="button" className="sdl-dash-text-link" onClick={()=>onOpen('realisasi')}>Buka realisasi ↗</button></div><div className="sdl-dash-budget"><strong>Rp {money(data.budget.realization)}</strong><span>dari Rp {money(data.budget.pagu)} pagu terverifikasi</span><div className="sdl-dash-budget-track"><div style={{width:`${data.budget.pagu>0?Math.min(100,100*data.budget.realization/data.budget.pagu):0}%`}}/></div><small>{data.budget.pagu>0?(100*data.budget.realization/data.budget.pagu).toFixed(1):'0'}% serapan terverifikasi</small></div></section>}
    </div>
    <div className="sdl-dash-shortcuts"><span>Quick access</span>{config.slice(0,4).map(s=><button key={s.id} type="button" onClick={()=>onOpen(s.route)}>{s.title} <span>↗</span></button>)}</div>
  </section>
}
