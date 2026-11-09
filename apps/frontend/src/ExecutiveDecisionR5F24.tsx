import {useEffect,useMemo,useState} from 'react'
import './ExecutiveDecisionR5F24.css'

type Area='urmin'|'ren'|'sumda'|'binfung'|'arahan'|'users'|'roles'|'roadmap'
type Metric={key:string;label:string;unit:string;value:number|null;detail:string;action:Area;scope:string}
type Attention={key:string;severity:'danger'|'warning'|'info';title:string;description:string;count:number;action:Area;unit:string}
type Point={month:string;value:number}
type Brief={kind:'leader'|'admin';generatedAt:string;period:string;metrics:Metric[];attention:Attention[];trend:Point[]|null;trendAvailable:boolean;sourcesAvailable:number;sourcesTotal:number;asOf:string}
const names:Record<Area,string>={urmin:'URMIN',ren:'SUBBAGREN',sumda:'SUBBAGSUMDA',binfung:'SUBBAGBINFUNG',arahan:'Arahan Pimpinan',users:'Kelola Akun',roles:'Hak Akses',roadmap:'Roadmap'}
const actionName:Record<Area,string>={urmin:'Tinjau URMIN',ren:'Tinjau SUBBAGREN',sumda:'Tinjau SUMDA',binfung:'Tinjau BINFUNG',arahan:'Tinjau Arahan',users:'Kelola Akun',roles:'Tinjau Hak Akses',roadmap:'Buka Roadmap'}
const periods=[['30d','30 Hari'],['90d','90 Hari'],['365d','12 Bulan'],['all','Semua']]
const fmt=(v:number|null|undefined)=>v===null||v===undefined?'—':new Intl.NumberFormat('id-ID').format(v)
const monthLabel=(ym:string)=>{const [y,m]=ym.split('-').map(Number);return new Date(y,m-1,1).toLocaleDateString('id-ID',{month:'short',year:'2-digit'})}
const when=(s:string)=>{const d=new Date(s);return Number.isFinite(d.valueOf())?new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',dateStyle:'medium',timeStyle:'short'}).format(d)+' WIB':'—'}
const groups:Record<'leader'|'admin',{id:string;title:string;sub:string}[]>={
 leader:[{id:'urmin',title:'URMIN',sub:'Persuratan & Disposisi'},{id:'arahan',title:'Arahan Pimpinan',sub:'Instruksi langsung'},{id:'ren',title:'SUBBAGREN',sub:'Program & Anggaran'},{id:'sumda',title:'SUBBAGSUMDA',sub:'Sumber Daya'},{id:'binfung',title:'SUBBAGBINFUNG',sub:'Pembinaan Fungsi'}],
 admin:[{id:'system',title:'Akun & Akses',sub:'Administrasi sistem'}]
}
export default function ExecutiveDecisionR5F24({onOpen,onBack}:{onOpen:(area:Area)=>void;onBack:()=>void}){
 const [period,setPeriod]=useState('90d')
 const [tick,setTick]=useState(0)
 const [selected,setSelected]=useState('all')
 const [brief,setBrief]=useState<Brief|null>(null)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setError('')
  fetch('/api/v1/executive/v2/overview?period='+encodeURIComponent(period),{credentials:'same-origin',cache:'no-store',signal:controller.signal})
   .then(async r=>{if(r.status===403)throw new Error('Anda tidak memiliki kewenangan melihat dashboard ini.');if(!r.ok)throw new Error('Ringkasan belum dapat dimuat.');return await r.json() as Brief})
   .then(data=>{if(!Array.isArray(data.metrics)||!Array.isArray(data.attention)||!['leader','admin'].includes(data.kind)||data.asOf!=='live')throw Error('Respons dashboard tidak valid.');setBrief(data)})
   .catch(e=>{if(!controller.signal.aborted){setBrief(null);setError(e instanceof Error?e.message:'Tidak dapat menampilkan ringkasan.')}})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[period,tick])
 useEffect(()=>{const refresh=window.setInterval(()=>setTick(x=>x+1),60000);return()=>window.clearInterval(refresh)},[])
 const leader=brief?.kind==='leader';const admin=brief?.kind==='admin'
 const metrics=useMemo(()=>brief?.metrics??[],[brief]);const actionable=brief?.attention??[]
 const shown=metrics.filter(m=>selected==='all'||(selected==='system'?m.scope==='system':m.scope===selected))
 const months=useMemo(()=>{if(!brief?.trendAvailable)return null;const map=new Map((brief.trend||[]).map(x=>[x.month,x.value]));const now=new Date();return Array.from({length:6},(_,i)=>{const date=new Date(now.getFullYear(),now.getMonth()-5+i,1);const key=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');return {month:key,value:map.get(key)??0}})},[brief])
 const maximum=Math.max(1,...(months||[]).map(m=>m.value))
 return <div className="sdl-x24">
  <div className="sdl-x24-hero"><div><span className="sdl-x24-kicker">SIERA DELTA LIMA · BAGRENMIN DENSUS 88 AT POLRI</span><h1>{admin?'Dashboard Pengelola':'Executive Dashboard'}</h1><p>{admin?'Pantau kesiapan akun dan kewenangan, lalu ambil tindakan administratif.':'Lihat prioritas perhatian dan tentukan tindak lanjut di empat unit kerja.'}</p></div><div className="sdl-x24-hero-controls"><label>Periode <select value={period} onChange={e=>setPeriod(e.target.value)} aria-label="Pilih periode laporan">{periods.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><button type="button" disabled={loading} onClick={()=>setTick(x=>x+1)} aria-label="Perbarui dashboard">↻ Perbarui</button></div></div>
  <div className="sdl-x24-info"><span>{loading?'Memperbarui ringkasan…':brief?`Diperbarui ${when(brief.generatedAt)} · ${brief.sourcesAvailable}/${brief.sourcesTotal} indikator tersambung`:'Data belum tersedia'}</span><button onClick={onBack} type="button">← Kembali ke Portal</button></div>
  {error&&<div className="sdl-x24-error" role="alert">{error}<button type="button" onClick={()=>setTick(x=>x+1)}>Coba lagi</button></div>}
  {brief&&<>
   <section className="sdl-x24-main-grid"><div className="sdl-x24-decision"><div className="sdl-x24-section-head"><div><span className="sdl-x24-eyebrow">PUSAT KEPUTUSAN</span><h2>{admin?'Tindakan Administratif':'Perlu Keputusan / Tindakan'}</h2><p>Urutan perhatian dari data yang tersedia saat ini.</p></div><span className="sdl-x24-counter">{actionable.length} perhatian</span></div>
    <div className="sdl-x24-actions">{actionable.length?actionable.map(a=><div className={'sdl-x24-alert is-'+a.severity} key={a.key}><div className="sdl-x24-alert-mark">{a.severity==='danger'?'!':a.severity==='warning'?'•':'i'}</div><div className="sdl-x24-alert-content"><span className="sdl-x24-alert-unit">{a.unit}</span><strong>{a.title}</strong><p>{a.description}</p></div><div className="sdl-x24-alert-act"><strong>{fmt(a.count)}</strong><button type="button" onClick={()=>onOpen(a.action)}>{actionName[a.action]} →</button></div></div>):<div className="sdl-x24-none"><strong>Tidak ada perhatian yang terdeteksi.</strong><p>{brief.sourcesAvailable===brief.sourcesTotal?'Seluruh indikator yang tersedia belum menunjukkan antrean prioritas.':'Sebagian indikator belum tersambung. Kondisi belum bisa dinyatakan sepenuhnya aman.'}</p></div>}</div>
   </div><aside className="sdl-x24-summary"><span className="sdl-x24-eyebrow">SEKILAS KONDISI</span><h2>{admin?'Kesiapan Administrasi':'Ringkasan Monitoring'}</h2><div className="sdl-x24-summary-count"><b>{brief.sourcesAvailable}</b><span> / {brief.sourcesTotal} indikator tersedia</span></div><div className="sdl-x24-track"><span style={{width:(brief.sourcesTotal?100*brief.sourcesAvailable/brief.sourcesTotal:0)+'%'}}/></div><p>Angka diambil dari catatan aplikasi, bukan data contoh. Indikator yang belum tersedia ditandai “—”.</p><div className="sdl-x24-mini-actions">{admin?<><button type="button" onClick={()=>onOpen('users')}>Kelola pengguna →</button><button type="button" onClick={()=>onOpen('roles')}>Hak akses →</button><button type="button" onClick={()=>onOpen('roadmap')}>Roadmap proyek →</button></>:<><button type="button" onClick={()=>onOpen('arahan')}>Pantau Arahan Pimpinan →</button><button type="button" onClick={()=>onOpen('urmin')}>Disposisi & Persuratan →</button><button type="button" onClick={()=>onOpen('ren')}>Program & Anggaran →</button></>}</div></aside></section>
   <div className="sdl-x24-section-head sdl-x24-metrics-head"><div><span className="sdl-x24-eyebrow">INDIKATOR UTAMA</span><h2>{admin?'Administrasi Sistem':'Kondisi Operasional'}</h2><p>Klik indikator untuk membuka layanan terkait sesuai kewenangan akun.</p></div></div>
   <div className="sdl-x24-filter" aria-label="Filter indikator">{[{id:'all',title:'Semua'},...groups[brief.kind]].map(g=><button type="button" key={g.id} className={selected===g.id?'active':''} onClick={()=>setSelected(g.id)}>{g.title}</button>)}</div>
   <div className="sdl-x24-metrics">{shown.length?shown.map(m=><button type="button" key={m.key} className={'sdl-x24-metric'+(m.value===null?' is-missing':'')} onClick={()=>onOpen(m.action)}><span className="sdl-x24-metric-unit">{m.scope==='system'?'ADMINISTRASI':m.scope==='arahan'?'ARAHAN':names[m.scope as Area]||m.scope}</span><strong>{m.label}</strong><span className="sdl-x24-metric-number">{fmt(m.value)}</span><small>{m.value===null?'Sumber belum tersedia':m.detail}</small><span className="sdl-x24-metric-link">Buka layanan ↗</span></button>):<div className="sdl-x24-none">Belum ada indikator untuk bagian ini.</div>}</div>
   {leader&&<section className="sdl-x24-lower"><div className="sdl-x24-panel"><div className="sdl-x24-section-head"><div><span className="sdl-x24-eyebrow">TREN ENAM BULAN</span><h2>Arus Surat Masuk</h2><p>Surat terdaftar per bulan. Angka tidak termasuk draft.</p></div></div>{months?<div className="sdl-x24-chart" role="img" aria-label="Grafik tren surat masuk enam bulan">{months.map(m=><div className="sdl-x24-barcol" key={m.month}><b>{fmt(m.value)}</b><div className="sdl-x24-bar-slot"><span style={{height:(m.value===0?0:Math.max(5,m.value/maximum*100))+'%'}}/></div><small>{monthLabel(m.month)}</small></div>)}</div>:<div className="sdl-x24-none">Tren belum tersedia dari sumber data.</div>}</div><div className="sdl-x24-panel"><span className="sdl-x24-eyebrow">PANDUAN TINDAKAN</span><h2>Apa yang perlu diprioritaskan?</h2><p className="sdl-x24-guidance">Mulai dari indikator yang melewati tenggat, lanjutkan antrean persetujuan, lalu verifikasi kelengkapan arahan. Setiap tombol mengarahkan Anda ke workspace terkait, bukan otomatis menyetujui pekerjaan.</p><div className="sdl-x24-steps"><span>01 <strong>Tinjau risiko terlambat</strong></span><span>02 <strong>Tetapkan penanggung jawab</strong></span><span>03 <strong>Pantau tindak lanjut</strong></span></div></div></section>}
   {admin&&<div className="sdl-x24-panel sdl-x24-admin-note"><span className="sdl-x24-eyebrow">BATAS KEWENANGAN</span><h2>Administrasi tanpa akses operasional</h2><p>Dashboard Superadmin hanya menampilkan data akun dan grant, serta pintasan menuju Roadmap. Tidak menampilkan isi surat, arahan, personel operasional, bukti anggaran, atau agregat kasus unit.</p></div>}
   <p className="sdl-x24-foot">Status indikator mencerminkan data yang tersedia pada saat pembaruan, bukan keputusan otomatis. Seluruh detail dan tindak lanjut tetap memerlukan izin akses di masing-masing modul. Indikator stok saat ini tidak dibatasi oleh filter periode.</p>
  </>}
 </div>
}
