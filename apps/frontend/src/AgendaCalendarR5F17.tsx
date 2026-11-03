import {useEffect,useMemo,useState} from 'react'
import './AgendaCalendarR5F17.css'

export type AgendaItemR5F17={id:string;title:string;code:string;fields:Record<string,string>}
type Mode='month'|'week'
const weekNames=['Min','Sen','Sel','Rab','Kam','Jum','Sab']
const localDate=(d:Date)=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const today=()=>new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate())
const dayOnly=(key:string)=>/^\d{4}-\d{2}-\d{2}$/.test(key)?new Date(Number(key.slice(0,4)),Number(key.slice(5,7))-1,Number(key.slice(8,10))):null
const safeText=(v:string|undefined)=>v?.trim()||'—'
const fullDate=(d:Date)=>d.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
const monthName=(d:Date)=>d.toLocaleDateString('id-ID',{month:'long',year:'numeric'})

export default function AgendaCalendarR5F17({items,unavailable,limited,onOpen}:{items:AgendaItemR5F17[];unavailable:boolean;limited:boolean;onOpen:(route:string,id?:string)=>void}){
 const [mode,setMode]=useState<Mode>('month')
 const [cursor,setCursor]=useState<Date>(()=>today())
 const [chosen,setChosen]=useState<string|null>(null)
 const normalized=useMemo(()=>items.filter(i=>/^\d{4}-\d{2}-\d{2}$/.test(i.fields?.tanggal||'')).map(i=>({ ...i,day:i.fields.tanggal,status:i.fields.statusAgenda||'Direncanakan',time:i.fields.waktu||''})).sort((a,b)=>a.day.localeCompare(b.day)||a.time.localeCompare(b.time)||a.title.localeCompare(b.title)),[items])
 const byDate=useMemo(()=>{
   const index=new Map<string,typeof normalized>()
   normalized.forEach(entry=>{const v=index.get(entry.day)||[];v.push(entry);index.set(entry.day,v)})
   return index
 },[normalized])
 const displayDays=useMemo(()=>{
   const start=mode==='month'?new Date(cursor.getFullYear(),cursor.getMonth(),1):new Date(cursor)
   if(mode==='week')start.setDate(start.getDate()-start.getDay())
   else start.setDate(start.getDate()-start.getDay())
   const length=mode==='week'?7:Math.ceil((new Date(cursor.getFullYear(),cursor.getMonth()+1,0).getDate()+new Date(cursor.getFullYear(),cursor.getMonth(),1).getDay())/7)*7
   return Array.from({length},(_,index)=>new Date(start.getFullYear(),start.getMonth(),start.getDate()+index))
 },[cursor,mode])
 const active=chosen?byDate.get(chosen)||[]:[]
 useEffect(()=>{
   if(!chosen)return
   function close(e:KeyboardEvent){if(e.key==='Escape')setChosen(null)}
   document.addEventListener('keydown',close)
   return()=>document.removeEventListener('keydown',close)
 },[chosen])
 const navigate=(offset:number)=>setCursor(v=>mode==='month'?new Date(v.getFullYear(),v.getMonth()+offset,1):new Date(v.getFullYear(),v.getMonth(),v.getDate()+offset*7))
 return <div className="agenda-cal" aria-label="Kalender Agenda URMIN">
   <div className="agenda-cal__toolbar">
     <div className="agenda-cal__heading"><h2>Kalender Agenda</h2><p>Jadwal kegiatan dan rapat URMIN</p></div>
     <div className="agenda-cal__controls">
       <button type="button" onClick={()=>setCursor(today())}>Hari ini</button>
       <div className="agenda-cal__navigation"><button type="button" aria-label="Sebelumnya" onClick={()=>navigate(-1)}>‹</button><span>{monthName(cursor)}</span><button type="button" aria-label="Berikutnya" onClick={()=>navigate(1)}>›</button></div>
       <div className="agenda-cal__segmented"><button type="button" aria-pressed={mode==='month'} onClick={()=>setMode('month')}>Bulan</button><button type="button" aria-pressed={mode==='week'} onClick={()=>setMode('week')}>Minggu</button></div>
       <button type="button" className="agenda-cal__open" onClick={()=>onOpen('agenda')}>Buka Agenda ↗</button>
     </div>
   </div>
   {unavailable?<div className="agenda-cal__unavailable">Kalender belum dapat ditampilkan untuk akun ini.</div>:<>
     {limited&&<p className="agenda-cal__notice">Daftar agenda yang dimuat dibatasi. Buka menu Agenda & Rapat untuk melihat data lainnya.</p>}
     <div className="agenda-cal__scroll">
       <div className="agenda-cal__grid" role="grid" aria-label={`Kalender ${monthName(cursor)}`}>
         {weekNames.map(n=><div key={n} className="agenda-cal__weekday" role="columnheader">{n}</div>)}
         {displayDays.map(day=>{
           const key=localDate(day),matches=byDate.get(key)||[],current=key===localDate(today()),isOutside=mode==='month'&&day.getMonth()!==cursor.getMonth()
           return <div key={key} role="gridcell" className={`agenda-cal__day${current?' is-today':''}${isOutside?' is-outside':''}`}>
             <button type="button" className="agenda-cal__day-number" onClick={()=>setChosen(key)} aria-label={`Lihat agenda ${fullDate(day)}`}>{day.getDate()}</button>
             <div className="agenda-cal__entries">
               {matches.slice(0,mode==='week'?5:2).map(a=><button type="button" key={a.id} title={`${a.time?`${a.time} · `:''}${a.title}`} className={`agenda-cal__event${a.status==='Dibatalkan'?' is-cancelled':''}${a.status==='Selesai'?' is-completed':''}`} onClick={()=>setChosen(key)}>{a.time&&<span>{a.time} </span>}{a.title}</button>)}
               {matches.length>(mode==='week'?5:2)&&<button type="button" className="agenda-cal__more" onClick={()=>setChosen(key)}>+{matches.length-(mode==='week'?5:2)} agenda</button>}
             </div>
           </div>
         })}
       </div>
     </div>
     <div className="agenda-cal__foot"><span><i/> Terjadwal</span><span><i/> Selesai</span><span><i/> Dibatalkan</span><span className="agenda-cal__total">{normalized.length} agenda tersedia</span></div>
   </>}
   {chosen&&<div className="agenda-cal__backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setChosen(null)}}>
     <section className="agenda-cal__dialog" role="dialog" aria-modal="true" aria-labelledby="agenda-cal-date">
       <header><div><small>AGENDA HARIAN</small><h3 id="agenda-cal-date">{fullDate(dayOnly(chosen)||today())}</h3></div><button type="button" onClick={()=>setChosen(null)} aria-label="Tutup dialog">×</button></header>
       <div className="agenda-cal__detail-list">{active.length===0?<p>Belum ada agenda pada tanggal ini.</p>:active.map(a=><article key={a.id}><div className="agenda-cal__detail-head"><strong>{a.title}</strong><span>{a.status}</span></div><dl><dt>Waktu</dt><dd>{safeText(a.time)}</dd><dt>Lokasi</dt><dd>{safeText(a.fields.lokasi)}</dd><dt>Penyelenggara</dt><dd>{safeText(a.fields.penyelenggara)}</dd><dt>Peserta</dt><dd>{safeText(a.fields.peserta)}</dd></dl><button type="button" onClick={()=>{setChosen(null);onOpen('agenda',a.id)}}>Buka Detail Agenda ↗</button></article>)}</div>
       <footer><button type="button" onClick={()=>{setChosen(null);onOpen('agenda')}}>Lihat Semua Agenda</button><button type="button" onClick={()=>setChosen(null)}>Tutup</button></footer>
     </section>
   </div>}
 </div>
}
