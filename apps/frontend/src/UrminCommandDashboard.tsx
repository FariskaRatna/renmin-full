import {useCallback,useEffect,useMemo,useState} from 'react'
import './UrminCommandDashboard.css'
import AgendaCalendarR5F17 from './AgendaCalendarR5F17'

type Incoming={id:string;subject:string;letterNumber:string;agendaNo:number;status:'draft'|'registered';createdAt:string;classification:string}
type Registry={id:string;title:string;code:string;createdAt:string;fields:Record<string,string>;classification:string}
type Inbox={id:string;incomingId:string;subject:string;letterNumber:string;status:'sent'|'received';sentAt:string}
type Task={id:string;subject:string;letterNumber:string;assigneeId:string;issuerId:string;dueDate:string;status:'pending'|'in_progress'|'completed';slaStatus:string;reviewStatus:string;createdAt:string;instruction:string}
type SourceData={incoming:Incoming[]|null; outgoing:Registry[]|null; agenda:Registry[]|null; inbox:Inbox[]|null; tasks:Task[]|null; limits:string[]; errors:string[]}
type TimeRange=30|90|365|0
type WorkItem={id:string;kind:'inbox'|'task'|'letter'|'agenda';title:string;subtitle:string;date:string;urgency:number;action:string;route:string;status?:string}
type Recent={id:string;kind:'masuk'|'keluar'|'agenda'|'arsip';title:string;when:string;type:string;route:string}
const urls={incoming:'/api/v1/urmin/surat-masuk/',outgoing:'/api/v1/urmin/registry/?kind=surat_keluar',agenda:'/api/v1/urmin/registry/?kind=agenda',inbox:'/api/v1/urmin/distribution-inbox/',tasks:'/api/v1/urmin/dispositions/'}
const readable=(s:string)=>{const v=Date.parse(s);return Number.isFinite(v)?new Date(v).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'}):'—'}
const isoDay=(s:string)=>s.slice(0,10)
const parse=(d:string)=>{const t=Date.parse(d);return Number.isFinite(t)?t:0}
const isActive=(t:Task)=>t.status!=='completed'
const needsReview=(t:Task,id:string)=>t.issuerId===id&&t.status==='completed'&&t.reviewStatus==='awaiting_review'
async function getData<T>(url:string,signal:AbortSignal):Promise<{items:T[];limited:boolean;pending?:number;overdue?:number}>{
 const res=await fetch(url,{credentials:'same-origin',cache:'no-store',signal})
 if(!res.ok)throw Error('Data tidak tersedia')
 const body=await res.json() as {items?:T[];limited?:boolean;pending?:number;overdue?:number}
 return {items:Array.isArray(body.items)?body.items:[],limited:body.limited===true,pending:body.pending,overdue:body.overdue}
}
function nowLocalDate(){const d=new Date();const yy=d.getFullYear(),mm=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return `${yy}-${mm}-${dd}`}
export default function UrminCommandDashboard({accountID,onOpen,onInbox,onTask}:{accountID:string;onOpen:(route:string,id?:string,create?:boolean)=>void;onInbox:(id?:string)=>void;onTask:(id?:string)=>void}){
 const [period,setPeriod]=useState<TimeRange>(90)
 const [reload,setReload]=useState(0)
 const [pending,setPending]=useState(true)
 const [data,setData]=useState<SourceData|null>(null)
 const [category,setCategory]=useState<'all'|'incoming'|'outgoing'>('all')
 const [bucket,setBucket]=useState<number|null>(null)
 const [taskFilter,setTaskFilter]=useState<'all'|'pending'|'progress'|'overdue'|'review'>('all')
 const [details,setDetails]=useState(false)
 const load=useCallback(async(signal:AbortSignal)=>{
   setPending(true)
   const names=Object.keys(urls) as (keyof typeof urls)[]
   const result=await Promise.allSettled(names.map(k=>getData<Incoming|Registry|Inbox|Task>(urls[k],signal)))
   if(signal.aborted)return
   const output:SourceData={incoming:null,outgoing:null,agenda:null,inbox:null,tasks:null,limits:[],errors:[]}
   names.forEach((name,i)=>{
     const response=result[i]
     if(response.status==='fulfilled'){
       const value=response.value
       // List endpoints already enforce per-record unit, classification, and role access.
       if(name==='incoming')output.incoming=value.items as Incoming[]
       if(name==='outgoing')output.outgoing=value.items as Registry[]
       if(name==='agenda')output.agenda=value.items as Registry[]
       if(name==='inbox')output.inbox=value.items as Inbox[]
       if(name==='tasks')output.tasks=value.items as Task[]
       if(value.limited)output.limits.push(name)
     }else output.errors.push(name)
   })
   setData(output);setPending(false)
 },[])
 useEffect(()=>{const ctrl=new AbortController();void load(ctrl.signal).catch(()=>{if(!ctrl.signal.aborted)setPending(false)});return()=>ctrl.abort()},[load,reload])
 useEffect(()=>{setCategory('all');setBucket(null);setTaskFilter('all');setDetails(false)},[period])
 const within=useCallback((s:string)=>period===0||(parse(s)>0&&parse(s)>=Date.now()-period*86400000),[period])
 const incoming=useMemo(()=>data?.incoming?.filter(x=>within(x.createdAt))??[],[data,within])
 const outgoing=useMemo(()=>data?.outgoing?.filter(x=>within(x.createdAt))??[],[data,within])
 const tasks=data?.tasks??[]
 const myTasks=tasks.filter(t=>t.assigneeId===accountID)
 const overdue=myTasks.filter(t=>isActive(t)&&(t.slaStatus==='overdue'||(t.dueDate&&isoDay(t.dueDate)<nowLocalDate())))
 const pendingTasks=myTasks.filter(t=>t.status==='pending')
 const progressTasks=myTasks.filter(t=>t.status==='in_progress')
 const reviewTasks=tasks.filter(t=>needsReview(t,accountID))
 const pendingInbox=(data?.inbox??[]).filter(i=>i.status==='sent')
 const actionCount=overdue.length+pendingTasks.filter(t=>!overdue.some(o=>o.id===t.id)).length+progressTasks.filter(t=>!overdue.some(o=>o.id===t.id)).length+reviewTasks.length+pendingInbox.length
 const jobs=useMemo(()=>{
   const all:WorkItem[]=[]
   overdue.forEach(t=>all.push({id:t.id,kind:'task',title:t.subject,subtitle:`Disposisi lewat tenggat · ${t.dueDate}`,date:t.dueDate,urgency:0,action:'Tindak lanjut',route:'__tasks',status:'overdue'}))
   pendingInbox.forEach(d=>all.push({id:d.id,kind:'inbox',title:d.subject,subtitle:`Surat ${d.letterNumber} menunggu penerimaan`,date:d.sentAt,urgency:1,action:'Terima surat',route:'__distribution-inbox'}))
   pendingTasks.filter(t=>!overdue.some(o=>o.id===t.id)).forEach(t=>all.push({id:t.id,kind:'task',title:t.subject,subtitle:`Menunggu diterima · tenggat ${t.dueDate}`,date:t.dueDate,urgency:2,action:'Terima tugas',route:'__tasks',status:'pending'}))
   reviewTasks.forEach(t=>all.push({id:t.id,kind:'task',title:t.subject,subtitle:'Pekerjaan selesai, menunggu review Anda',date:t.createdAt,urgency:3,action:'Review',route:'__tasks',status:'review'}))
   progressTasks.filter(t=>!overdue.some(o=>o.id===t.id)).forEach(t=>all.push({id:t.id,kind:'task',title:t.subject,subtitle:`Dalam proses · tenggat ${t.dueDate}`,date:t.dueDate,urgency:4,action:'Lanjutkan',route:'__tasks',status:'progress'}))
   return all.sort((a,b)=>a.urgency-b.urgency||parse(a.date)-parse(b.date))
 },[data,accountID])
 const selectableJobs=jobs.filter(j=>taskFilter==='all'||j.status===taskFilter||(taskFilter==='pending'&&j.kind==='inbox'))
 const trend=useMemo(()=>{
   const span=period===0?Math.max(365*86400000,Date.now()-Math.min(...[...incoming,...outgoing].map(x=>parse(x.createdAt)).filter(Boolean),Date.now())):period*86400000
   const start=Date.now()-span
   return Array.from({length:6},(_,i)=>{
     const lo=start+(span/6)*i,hi=start+(span/6)*(i+1)
     const count=(records:{createdAt:string}[])=>records.filter(x=>{const t=parse(x.createdAt);return t>=lo&&t<=(i===5?hi+2000:hi)}).length
     return {i,lo,hi,incoming:count(incoming),outgoing:count(outgoing),label:new Date(lo).toLocaleDateString('id-ID',{day:'2-digit',month:'short'})}
   })
 },[period,incoming,outgoing])
 const trendMax=Math.max(1,...trend.map(x=>Math.max(x.incoming,x.outgoing)))
 const recent=useMemo(()=>{
   const list:Recent[]=[]
   incoming.forEach(x=>list.push({id:x.id,kind:'masuk',title:x.subject,when:x.createdAt,type:'Surat Masuk',route:'surat-masuk'}))
   outgoing.forEach(x=>list.push({id:x.id,kind:'keluar',title:x.title,when:x.createdAt,type:'Surat Keluar',route:'surat-keluar'}))
   ;(data?.agenda??[]).filter(x=>within(x.createdAt)).forEach(x=>list.push({id:x.id,kind:'agenda',title:x.title,when:x.createdAt,type:'Agenda',route:'agenda'}))
   return list.filter(x=>(category==='all'||(category==='incoming'?x.kind==='masuk':x.kind==='keluar'))&&(bucket===null||(()=>{const t=parse(x.when),b=trend[bucket];return t>=b.lo&&t<b.hi+2000})())).sort((a,b)=>parse(b.when)-parse(a.when))
 },[incoming,outgoing,data,within,category,bucket,trend])
 const openJob=(j:WorkItem)=>j.kind==='inbox'?onInbox(j.id):onTask(j.id)
 const inaccessible=(name:keyof SourceData)=>data!==null&&data[name]===null
 const limited=(data?.limits.length??0)>0
 return <section className="urmin-command" aria-label="Dashboard Urmin">
   <div className="urmin-command__toolbar"><div className="urmin-command__eyebrow">URMIN · RINGKASAN OPERASIONAL</div><div className="urmin-command__tools"><label htmlFor="urmin-command-period">Periode</label><select id="urmin-command-period" value={period} onChange={e=>setPeriod(Number(e.target.value) as TimeRange)}><option value={30}>30 hari</option><option value={90}>90 hari</option><option value={365}>12 bulan</option><option value={0}>Semua waktu</option></select><button type="button" disabled={pending} onClick={()=>setReload(v=>v+1)}>↻ Refresh</button></div></div>
   {data?.errors.length?<div className="urmin-command__notice" role="status">Sebagian data tidak tersedia untuk akun ini. Ringkasan hanya menampilkan informasi sesuai kewenangan.</div>:null}
   {limited?<div className="urmin-command__notice" role="status">Sebagian daftar mencapai batas tampilan. Gunakan menu terkait untuk pencarian lebih spesifik.</div>:null}
   <div className="urmin-command__metrics">
     <button type="button" className="urmin-command__metric" onClick={()=>onOpen('surat-masuk')}><span>Surat Masuk</span><strong>{pending?'…':inaccessible('incoming')?'—':incoming.length+(data?.limits.includes('incoming')?'+':'')}</strong><small>Surat yang dapat Anda akses ↗</small></button>
     <button type="button" className="urmin-command__metric" onClick={()=>onOpen('surat-keluar')}><span>Surat Keluar</span><strong>{pending?'…':inaccessible('outgoing')?'—':outgoing.length+(data?.limits.includes('outgoing')?'+':'')}</strong><small>Register pada periode terpilih ↗</small></button>
     <button type="button" className="urmin-command__metric urmin-command__metric--warm" onClick={()=>onTask()}><span>Perlu Tindakan</span><strong>{pending?'…':inaccessible('tasks')&&inaccessible('inbox')?'—':actionCount}</strong><small>Inbox, disposisi dan review ↗</small></button>
     <button type="button" className="urmin-command__metric urmin-command__metric--red" onClick={()=>{setTaskFilter('overdue');document.getElementById('urmin-action-center')?.scrollIntoView({behavior:'smooth',block:'start'})}}><span>Disposisi Terlambat</span><strong>{pending?'…':inaccessible('tasks')?'—':overdue.length}</strong><small>Tenggat yang telah terlewati ↗</small></button>
   </div>
   <div className="urmin-command__actions"><button onClick={()=>onOpen('surat-masuk',undefined,true)}>+ Surat Masuk</button><button onClick={()=>onOpen('surat-keluar',undefined,true)}>+ Surat Keluar</button><button onClick={()=>onInbox()}>Inbox Distribusi</button><button onClick={()=>onTask()}>Tugas Disposisi</button><button onClick={()=>onOpen('agenda')}>Agenda</button></div>
   <div className="urmin-command__columns">
     <section className="urmin-command__panel urmin-command__panel--trend"><div className="urmin-command__panelhead"><div><h2>Tren Persuratan</h2><p>Surat masuk vs surat keluar</p></div><div className="urmin-command__legend"><span><i/> Masuk</span><span><i/> Keluar</span></div></div>
       {inaccessible('incoming')&&inaccessible('outgoing')?<div className="urmin-command__empty">Tren persuratan belum tersedia untuk akun ini.</div>:<div className="urmin-command__trend" role="group" aria-label="Filter grafik berdasarkan periode">{trend.map(b=><button type="button" key={b.i} aria-pressed={bucket===b.i} onClick={()=>{setBucket(v=>v===b.i?null:b.i);setDetails(true)}} title={`${b.incoming} surat masuk, ${b.outgoing} surat keluar`}><span className="urmin-command__bars"><i style={{height:`${Math.max(b.incoming?7:0,b.incoming/trendMax*100)}%`}}/><i style={{height:`${Math.max(b.outgoing?7:0,b.outgoing/trendMax*100)}%`}}/></span><span>{b.label}</span><strong>{b.incoming+b.outgoing}</strong></button>)}</div>}
       <div className="urmin-command__chartfoot"><button type="button" className={category==='all'?'active':''} onClick={()=>setCategory('all')}>Semua surat</button><button type="button" className={category==='incoming'?'active':''} onClick={()=>setCategory('incoming')}>Surat Masuk</button><button type="button" className={category==='outgoing'?'active':''} onClick={()=>setCategory('outgoing')}>Surat Keluar</button></div>
     </section>
     <section className="urmin-command__panel"><div className="urmin-command__panelhead"><div><h2>Status Disposisi Saya</h2><p>Penugasan yang ditujukan kepada akun ini</p></div></div>
       {inaccessible('tasks')?<div className="urmin-command__empty">Status tugas belum tersedia.</div>:<div className="urmin-command__statuses">{[{k:'pending',l:'Menunggu diterima',v:pendingTasks.length,c:'#D6A258'},{k:'progress',l:'Dalam proses',v:progressTasks.length,c:'#5988C6'},{k:'overdue',l:'Terlambat',v:overdue.length,c:'#CD7067'},{k:'review',l:'Menunggu review saya',v:reviewTasks.length,c:'#8E76C0'}].map(st=><button type="button" key={st.k} className={taskFilter===st.k?'selected':''} onClick={()=>{setTaskFilter(st.k as typeof taskFilter);document.getElementById('urmin-action-center')?.scrollIntoView({behavior:'smooth',block:'start'})}}><i style={{background:st.c}}/><span>{st.l}</span><strong>{st.v}</strong></button>)}</div>}
       <button type="button" className="urmin-command__textlink" onClick={()=>onTask()}>Buka tugas disposisi →</button>
     </section>
     <section className="urmin-command__panel urmin-command__panel--wide" id="urmin-action-center"><div className="urmin-command__panelhead"><div><h2>Perlu Ditindaklanjuti</h2><p>Prioritas tindakan untuk akun Anda</p></div><div className="urmin-command__switch"><button type="button" className={taskFilter==='all'?'active':''} onClick={()=>setTaskFilter('all')}>Semua</button><button type="button" className={taskFilter==='overdue'?'active':''} onClick={()=>setTaskFilter('overdue')}>Terlambat</button></div></div>
       {inaccessible('tasks')&&inaccessible('inbox')?<div className="urmin-command__empty">Pekerjaan tidak dapat ditampilkan untuk akun ini.</div>:selectableJobs.length===0?<div className="urmin-command__empty">Tidak ada pekerjaan yang sesuai filter.</div>:<div className="urmin-command__jobs">{selectableJobs.slice(0,details?20:6).map(j=><button key={`${j.kind}-${j.id}`} type="button" onClick={()=>openJob(j)}><span className={`urmin-command__priority pr-${j.urgency}`} aria-hidden="true"/><span className="urmin-command__jobtext"><strong>{j.title}</strong><small>{j.subtitle}</small></span><span className="urmin-command__jobaction">{j.action} ↗</span></button>)}</div>}
       <div className="urmin-command__panelbottom"><button type="button" onClick={()=>setDetails(v=>!v)}>{details?'Lebih ringkas':'Lihat lebih banyak'}</button><button type="button" onClick={()=>onInbox()}>Buka Inbox ↗</button></div>
     </section>
     <section className="urmin-command__panel urmin-command__panel--wide"><AgendaCalendarR5F17 items={data?.agenda??[]} unavailable={inaccessible('agenda')} limited={data?.limits.includes('agenda')??false} onOpen={onOpen}/></section>
     <section className="urmin-command__panel"><div className="urmin-command__panelhead"><div><h2>Aktivitas Terbaru</h2><p>{category==='incoming'?'Surat masuk':category==='outgoing'?'Surat keluar':'Persuratan dan agenda'}</p></div>{(bucket!==null||category!=='all')&&<button type="button" className="urmin-command__textlink" onClick={()=>{setBucket(null);setCategory('all')}}>Reset filter</button>}</div>
       {recent.length===0?<div className="urmin-command__empty">Belum ada aktivitas pada periode ini.</div>:<div className="urmin-command__recent">{recent.slice(0,details?15:5).map(r=><button type="button" key={`${r.kind}-${r.id}`} onClick={()=>onOpen(r.route,r.id)}><span><strong>{r.title}</strong><small>{r.type} · {readable(r.when)}</small></span><b>↗</b></button>)}</div>}
     </section>
   </div>
 </section>
}
