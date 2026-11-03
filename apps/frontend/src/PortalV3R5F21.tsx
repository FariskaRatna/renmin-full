import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import './PortalV3R5F21.css'

type Unit = 'urmin'|'ren'|'sumda'|'binfung'
type Kind='berita'|'pengumuman'|'sop'|'peraturan'|'agenda'
type Post={id:string;kind:Kind;title:string;summary:string;body:string;ownerUnit:string;coverUrl:string;referenceNo:string;startsAt:string|null;pinned:boolean;published:boolean;version:number;createdAt:string;updatedAt:string}
type EditorForm={id:string;version:number;kind:Kind;title:string;summary:string;body:string;ownerUnit:string;coverUrl:string;referenceNo:string;startsAt:string;pinned:boolean;published:boolean}
type View='home'|'news'|'agenda'|'docs'|'editor'|'spip'
const LOGO='https://upload.wikimedia.org/wikipedia/commons/6/64/Densus_88_AT.png'
const labels:Record<Kind,string>={berita:'Berita',pengumuman:'Pengumuman',sop:'SOP',peraturan:'Peraturan',agenda:'Agenda'}
const icons:Record<string,ReactNode>={
 file:<><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M13 2v7h7M8 14h8m-8 4h7"/></>,
 chart:<><path d="M3 21V4m0 17h18M7 16l5-5 4 3 5-7"/></>,
 users:<><circle cx="9" cy="8" r="3"/><path d="M2 21v-2a7 7 0 0 1 14 0v2zM17 5a3 3 0 0 1 0 6m3 10v-2a6 6 0 0 0-4-5"/></>,
 folder:<path d="M3 6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>,
 shield:<><path d="M12 2 3 6v6c0 5 3 8 9 10 6-2 9-5 9-10V6z"/><path d="m8 12 3 3 5-5"/></>,
 calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18"/></>,
 news:<><path d="M5 3h14v17a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V7h3zM5 17v2a1 1 0 0 1-2 0"/><path d="M9 7h6v4H9zM9 15h6m-6 3h6"/></>,
 bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
 arrow:<path d="M5 12h14m-6-6 6 6-6 6"/>,
 search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
 book:<><path d="M12 6C9 4 6 4 3 4v16c3 0 6 0 9 2 3-2 6-2 9-2V4c-3 0-6 0-9 2zM12 6v16"/></>,
 clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
 plus:<path d="M12 5v14M5 12h14"/>,
 close:<path d="M5 5l14 14M19 5 5 19"/>,
 back:<path d="m14 6-6 6 6 6"/>,
 info:<><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>
}
function Icon({name,size=21}:{name:string;size?:number}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[name]||icons.info}</svg>}
const fmt=(v:string,opts:Intl.DateTimeFormatOptions={day:'numeric',month:'short',year:'numeric'})=>new Date(v).toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta',...opts})
const monthLabel=(d:Date)=>d.toLocaleDateString('id-ID',{month:'long',year:'numeric'})
const localMonth=(date:Date)=>new Date(date.getFullYear(),date.getMonth(),1)
const dKey=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
const eventDay=(iso:string|null)=>iso?new Date(iso).toLocaleDateString('sv-SE',{timeZone:'Asia/Jakarta'}):''
const inputWib=(iso:string)=>new Date(iso).toLocaleString('sv-SE',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).replace(' ','T').slice(0,16)
const initial:EditorForm={id:'',version:0,kind:'berita',title:'',summary:'',body:'',ownerUnit:'subbagbinfung',coverUrl:'',referenceNo:'',startsAt:'',pinned:false,published:false}
function NewsPhoto({item,feature=false}:{item:Post;feature?:boolean}){const [failed,setFailed]=useState(false);return <div className={`sdlv3__photo ${feature?'sdlv3__photo--large':''}`}>{item.coverUrl&&!failed?<img src={item.coverUrl} referrerPolicy="no-referrer" loading="lazy" alt="" onError={()=>setFailed(true)}/>:<Icon name="news" size={feature?40:28}/>}</div>}
export default function PortalV3R5F21({onOpenUnit,isSuperadmin}:{onOpenUnit:(id:Unit)=>void;isSuperadmin:boolean}){
 const [view,setView]=useState<View>('home')
 const [items,setItems]=useState<Post[]>([])
 const [canEdit,setCanEdit]=useState(false)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [month,setMonth]=useState(()=>localMonth(new Date()))
 const [calMode,setCalMode]=useState<'month'|'week'>('month')
 const [weekAnchor,setWeekAnchor]=useState(()=>new Date())
 const [query,setQuery]=useState('')
 const [filter,setFilter]=useState<'all'|'berita'|'pengumuman'>('all')
 const [details,setDetails]=useState<Post|null>(null)
 const [editorForm,setEditorForm]=useState<EditorForm|null>(null)
 const [busy,setBusy]=useState(false)
 const [manage,setManage]=useState(false)
 const [logoError,setLogoError]=useState(false)
 async function reload(showAll=false){
  setLoading(true);setError('')
  try{
   const r=await fetch('/api/v1/portal/posts/?'+(showAll?'manage=1':'view=published'),{credentials:'same-origin',cache:'no-store'})
   if(!r.ok)throw Error(r.status===403?'Anda tidak memiliki akses publikasi.':'Informasi Portal tidak dapat dimuat.')
   const j=await r.json() as {items?:Post[];editor?:boolean}
   setItems(Array.isArray(j.items)?j.items:[]);setCanEdit(j.editor===true&&!isSuperadmin);setManage(showAll)
  }catch(e){setError(e instanceof Error?e.message:'Informasi tidak tersedia.');setItems([])}finally{setLoading(false)}
 }
 useEffect(()=>{void reload()},[isSuperadmin])
 const shown=useMemo(()=>items.filter(i=>i.published),[items])
 const news=shown.filter(x=>x.kind==='berita')
 const announcements=shown.filter(x=>x.kind==='pengumuman')
 const docs=shown.filter(x=>x.kind==='sop'||x.kind==='peraturan')
 const agenda=shown.filter(x=>x.kind==='agenda'&&x.startsAt).sort((a,b)=>String(a.startsAt).localeCompare(String(b.startsAt)))
 const today=dKey(new Date())
 const upcoming=agenda.filter(a=>eventDay(a.startsAt)>=today)
 const launch=[{key:'urmin' as Unit,label:'URMIN',desc:'Persuratan',icon:'file'}, {key:'ren' as Unit,label:'SUBBAGREN',desc:'Program & anggaran',icon:'chart'}, {key:'sumda' as Unit,label:'SUBBAGSUMDA',desc:'Sumber daya',icon:'users'}, {key:'binfung' as Unit,label:'SUBBAGBINFUNG',desc:'Pembinaan fungsi',icon:'folder'}]
 const go=(next:View)=>{setView(next);setQuery('');window.scrollTo(0,0);if(next==='editor'){void reload(true)}else if(manage){void reload(false)}}
 const boxEmpty=(msg:string)=><div className="sdlv3__empty">{loading?'Memuat informasi…':msg}</div>
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!editorForm||!canEdit)return;setBusy(true)
  try{
   const c=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'});if(!c.ok)throw Error('Sesi tidak tersedia. Silakan login ulang.')
   const token=(await c.json() as {csrfToken:string}).csrfToken
   const {id,version,...rest}=editorForm
   const body={...rest,version,startsAt:rest.startsAt?new Date(`${rest.startsAt}+07:00`).toISOString():null}
   const endpoint=id?`/api/v1/portal/posts/${encodeURIComponent(id)}`:'/api/v1/portal/posts/'
   const r=await fetch(endpoint,{method:id?'PUT':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify(body)})
   if(!r.ok){const err=await r.json().catch(()=>({error:''})) as {error?:string};throw Error(err.error==='version_conflict'?'Konten berubah di sesi lain. Muat ulang daftar.':`Tidak dapat menyimpan konten (${r.status}).`)}
   setEditorForm(null);setNotice('Konten berhasil disimpan.');await reload(true)
  }catch(err){setNotice(err instanceof Error?err.message:'Gagal menyimpan konten.')}finally{setBusy(false)}
 }
 function openForm(item?:Post){setEditorForm(item?{id:item.id,version:item.version,kind:item.kind,title:item.title,summary:item.summary,body:item.body,ownerUnit:item.ownerUnit,coverUrl:item.coverUrl,referenceNo:item.referenceNo,startsAt:item.startsAt?inputWib(item.startsAt):'',pinned:item.pinned,published:item.published}:{...initial})}
 const SectionHeader=({eyebrow,title,action}:{eyebrow:string;title:string;action?:ReactNode})=><div className="sdlv3__sectionhead"><div><small>{eyebrow}</small><h2>{title}</h2></div>{action}</div>
 const ItemRow=({p}:{p:Post})=><button type="button" className="sdlv3__newsrow" onClick={()=>setDetails(p)}><NewsPhoto item={p}/><span><small>{labels[p.kind]} · {fmt(p.updatedAt)}</small><strong>{p.title}</strong><em>{p.summary}</em></span><Icon name="arrow" size={15}/></button>
 const AgendaRow=({p}:{p:Post})=><button type="button" className="sdlv3__agendarow" onClick={()=>setDetails(p)}><span className="sdlv3__date"><strong>{fmt(p.startsAt!,{day:'2-digit'})}</strong><small>{fmt(p.startsAt!,{month:'short'})}</small></span><span><strong>{p.title}</strong><small>{p.ownerUnit.toUpperCase()} · {new Date(p.startsAt!).toLocaleTimeString('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit'})} WIB</small></span><Icon name="arrow" size={14}/></button>
 function Calendar(){const start=new Date(month.getFullYear(),month.getMonth(),1),offset=(start.getDay()+6)%7,days=calMode==='month'?42:7,begin=new Date(start.getFullYear(),start.getMonth(),1-offset)
  if(calMode==='week'){const date=weekAnchor;const weekday=(date.getDay()+6)%7;begin.setTime(new Date(date.getFullYear(),date.getMonth(),date.getDate()-weekday).getTime())}
  return <div className="sdlv3__calendar"><div className="sdlv3__caltools"><button onClick={()=>{setMonth(localMonth(new Date()));setWeekAnchor(new Date())}}>Hari ini</button><button aria-label="Periode sebelumnya" onClick={()=>calMode==='week'?setWeekAnchor(new Date(weekAnchor.getFullYear(),weekAnchor.getMonth(),weekAnchor.getDate()-7)):setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}>‹</button><button aria-label="Periode berikutnya" onClick={()=>calMode==='week'?setWeekAnchor(new Date(weekAnchor.getFullYear(),weekAnchor.getMonth(),weekAnchor.getDate()+7)):setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}>›</button><strong>{monthLabel(calMode==='week'?weekAnchor:month)}</strong><span className="sdlv3__calview"><button className={calMode==='month'?'on':''} onClick={()=>setCalMode('month')}>Bulan</button><button className={calMode==='week'?'on':''} onClick={()=>setCalMode('week')}>Minggu</button></span></div><div className="sdlv3__calgrid">{['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(x=><div className="sdlv3__weekday" key={x}>{x}</div>)}{Array.from({length:days},(_,i)=>{const day=new Date(begin);day.setDate(begin.getDate()+i);const date=dKey(day);const ev=agenda.filter(x=>eventDay(x.startsAt)===date);return <div key={date} className={`sdlv3__calday ${day.getMonth()!==month.getMonth()?'outside':''} ${date===today?'today':''}`}><span>{day.getDate()}</span>{ev.slice(0,2).map(p=><button key={p.id} title={p.title} onClick={()=>setDetails(p)}>{p.title}</button>)}{ev.length>2&&<small>+{ev.length-2} agenda</small>}</div>})}</div></div>
 }
 return <div className="sdlv3">
 <section className="sdlv3__hero"><div><small>PORTAL INFORMASI BAGRENMIN</small><h1>Informasi terhubung.<br/><em>Kegiatan lebih terarah.</em></h1><p>BagRenmin Densus 88 AT Polri</p></div><div className="sdlv3__logo">{!logoError?<img src={LOGO} alt="Lambang Densus 88 AT" referrerPolicy="no-referrer" onError={()=>setLogoError(true)}/>:<strong>88</strong>}</div></section>
 <nav className="sdlv3__nav" aria-label="Navigasi Portal BagRenmin"><button className={view==='home'?'active':''} onClick={()=>go('home')}>Beranda</button><button className={view==='news'?'active':''} onClick={()=>go('news')}>Berita & Pengumuman</button><button className={view==='agenda'?'active':''} onClick={()=>go('agenda')}>Kalender</button><button className={view==='docs'?'active':''} onClick={()=>go('docs')}>SOP & Peraturan</button>{canEdit&&<button className={view==='editor'?'active':''} onClick={()=>go('editor')}>Kelola Portal</button>}</nav>
 {error&&<div className="sdlv3__message" role="status">{error}</div>}{notice&&<div className="sdlv3__message" role="status">{notice}<button onClick={()=>setNotice('')} aria-label="Tutup pemberitahuan">×</button></div>}
 {view==='home'&&<>
  <section className="sdlv3__section"><SectionHeader eyebrow="AKSES RUANG KERJA" title="Unit & Layanan"/><div className="sdlv3__launch">{launch.map((x,i)=><button disabled={isSuperadmin} key={x.key} onClick={()=>onOpenUnit(x.key)}><span className={`sdlv3__launchicon tone-${i}`}><Icon name={x.icon} size={27}/></span><strong>{x.label}</strong><small>{x.desc}</small></button>)}<button disabled={isSuperadmin} onClick={()=>go('spip')}><span className="sdlv3__launchicon tone-4"><Icon name="shield" size={27}/></span><strong>SPIP</strong><small>Data dukung</small></button><button onClick={()=>go('agenda')}><span className="sdlv3__launchicon tone-5"><Icon name="calendar" size={27}/></span><strong>KALENDER</strong><small>Agenda bersama</small></button></div></section>
  <section className="sdlv3__section"><SectionHeader eyebrow="TERBARU DARI BAGRENMIN" title="Informasi & Berita" action={<button className="sdlv3__link" onClick={()=>go('news')}>Lihat Semua →</button>}/><div className="sdlv3__newsgrid"><div>{news[0]?<button className="sdlv3__featured" onClick={()=>setDetails(news[0])}><NewsPhoto item={news[0]} feature/><span><small>BERITA</small><strong>{news[0].title}</strong><em>{news[0].summary}</em><small>{fmt(news[0].updatedAt)}</small></span></button>:boxEmpty('Belum ada berita yang dipublikasikan.')}</div><div className="sdlv3__newslist">{news.slice(1,4).map(x=><ItemRow key={x.id} p={x}/>)}{news.length<2&&boxEmpty('Berita berikutnya akan tampil di sini.')}<button className="sdlv3__more" onClick={()=>go('news')}>Telusuri seluruh informasi →</button></div></div></section>
  <section className="sdlv3__announcements"><strong><Icon name="bell" size={16}/> PENGUMUMAN</strong>{announcements.length?announcements.slice(0,2).map(x=><button key={x.id} onClick={()=>setDetails(x)}>{x.title} ›</button>):<span>Belum ada pengumuman yang dipublikasikan.</span>}</section>
  <div className="sdlv3__bottom"><section><SectionHeader eyebrow="AGENDA BERSAMA" title="Kalender BagRenmin" action={<button className="sdlv3__link" onClick={()=>go('agenda')}>Lihat Kalender →</button>}/><p>Agenda yang telah dipublikasikan untuk BagRenmin.</p><div className="sdlv3__months"><span>{monthLabel(new Date(new Date().getFullYear(),new Date().getMonth()-1,1))}</span><b>{monthLabel(new Date())}</b><span>{monthLabel(new Date(new Date().getFullYear(),new Date().getMonth()+1,1))}</span></div>{upcoming.slice(0,4).map(x=><AgendaRow key={x.id} p={x}/>)}{!upcoming.length&&boxEmpty('Belum ada agenda bersama mendatang.')}</section><section><SectionHeader eyebrow="PUSTAKA DOKUMEN" title="SOP & Peraturan" action={<button className="sdlv3__link" onClick={()=>go('docs')}>Lihat Semua →</button>}/><p>Pedoman yang telah dipublikasikan.</p>{docs.slice(0,4).map(x=><button className="sdlv3__docrow" key={x.id} onClick={()=>setDetails(x)}><Icon name="book" size={21}/><span><small>{labels[x.kind]} · {x.referenceNo||'Nomor belum tersedia'}</small><strong>{x.title}</strong></span><span>›</span></button>)}{docs.length===0&&boxEmpty('Belum ada SOP atau peraturan yang dipublikasikan.')}</section></div>
 </>}
 {view==='news'&&<section className="sdlv3__section"><SectionHeader eyebrow="INFORMASI BAGRENMIN" title="Berita & Pengumuman"/><div className="sdlv3__filters"><label><Icon name="search" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari berita dan pengumuman…"/></label><select value={filter} onChange={e=>setFilter(e.target.value as typeof filter)}><option value="all">Semua</option><option value="berita">Berita</option><option value="pengumuman">Pengumuman</option></select></div><div className="sdlv3__newsarchive">{shown.filter(x=>(x.kind==='berita'||x.kind==='pengumuman')&&(filter==='all'||x.kind===filter)&&(`${x.title} ${x.summary}`.toLowerCase().includes(query.toLowerCase()))).map(p=><ItemRow key={p.id} p={p}/>)}{!news.length&&!announcements.length&&boxEmpty('Belum ada publikasi.')}</div></section>}
 {view==='agenda'&&<section className="sdlv3__section"><SectionHeader eyebrow="AGENDA LINTAS UNIT" title="Kalender BagRenmin"/><p className="sdlv3__desc">Menampilkan agenda yang sudah dinyatakan layak dipublikasikan, bukan data privat masing-masing unit.</p><Calendar/>{!agenda.length&&boxEmpty('Belum ada agenda bersama yang dipublikasikan.')}</section>}
 {view==='docs'&&<section className="sdlv3__section"><SectionHeader eyebrow="PUSTAKA BAGRENMIN" title="SOP & Peraturan"/><div className="sdlv3__newsarchive">{docs.map(x=><button key={x.id} className="sdlv3__docrow" onClick={()=>setDetails(x)}><Icon name="book"/><span><small>{labels[x.kind]} · {x.referenceNo||'—'}</small><strong>{x.title}</strong><small>{x.ownerUnit.toUpperCase()}</small></span><span>›</span></button>)}{docs.length===0&&boxEmpty('Belum ada dokumen yang dipublikasikan.')}</div></section>}
 {view==='spip'&&<section className="sdlv3__section"><SectionHeader eyebrow="LAYANAN LINTAS UNIT" title="SPIP & Data Dukung"/><div className="sdlv3__empty">Integrasi SPIP lintas unit sedang disiapkan. Dokumen dan laporan tetap dikelola unit pemilik sesuai kewenangan.</div></section>}
 {view==='editor'&&canEdit&&<section className="sdlv3__section"><SectionHeader eyebrow="SUBBAGBINFUNG" title="Manajemen Portal" action={<button className="sdlv3__primary" onClick={()=>openForm()}><Icon name="plus" size={15}/> Buat Konten</button>}/><p className="sdlv3__desc">Kelola berita, pengumuman, SOP, peraturan, dan agenda yang akan dipublikasikan ke Portal.</p><div className="sdlv3__editorlist">{items.map(p=><div key={p.id}><span><small>{labels[p.kind]} · {p.ownerUnit.toUpperCase()}</small><strong>{p.title}</strong></span><span className={p.published?'sdlv3__status-on':'sdlv3__status-off'}>{p.published?'Tayang':'Draft'}</span><button onClick={()=>openForm(p)}>Edit</button></div>)}{!items.length&&boxEmpty('Belum ada konten yang dibuat.')}</div></section>}
 {details&&<div className="sdlv3__overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setDetails(null)}}><article className="sdlv3__dialog" role="dialog" aria-modal="true" aria-label={details.title}><header><div><small>{labels[details.kind]} · {fmt(details.updatedAt)}</small><h2>{details.title}</h2></div><button onClick={()=>setDetails(null)} aria-label="Tutup"><Icon name="close"/></button></header><p>{details.summary}</p><div className="sdlv3__body">{details.body}</div>{details.kind==='agenda'&&details.startsAt&&<p><Icon name="clock" size={16}/> {new Date(details.startsAt).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB</p>}{(details.kind==='sop'||details.kind==='peraturan')&&<div className="sdlv3__message">Dokumen resmi harus tersedia dan terverifikasi sebelum dapat diunduh.</div>}</article></div>}
 {editorForm&&canEdit&&<div className="sdlv3__overlay" onMouseDown={e=>{if(e.target===e.currentTarget)setEditorForm(null)}}><div className="sdlv3__dialog" role="dialog" aria-modal="true" aria-label="Editor konten"><header><h2>{editorForm.id?'Edit':'Buat'} Konten Portal</h2><button onClick={()=>setEditorForm(null)} aria-label="Tutup"><Icon name="close"/></button></header><form onSubmit={e=>void save(e)}><div className="sdlv3__formgrid"><label>Jenis Konten<select value={editorForm.kind} onChange={e=>setEditorForm({...editorForm,kind:e.target.value as Kind,startsAt:e.target.value==='agenda'?(editorForm.startsAt||inputWib(new Date().toISOString())):''})}>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Unit Pemilik<select value={editorForm.ownerUnit} onChange={e=>setEditorForm({...editorForm,ownerUnit:e.target.value})}>{[['subbagbinfung','SUBBAGBINFUNG'],['urmin','URMIN'],['subbagren','SUBBAGREN'],['subbagsumda','SUBBAGSUMDA']].map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div><label>Judul<input required minLength={3} maxLength={160} value={editorForm.title} onChange={e=>setEditorForm({...editorForm,title:e.target.value})}/></label><label>Ringkasan<textarea maxLength={600} value={editorForm.summary} onChange={e=>setEditorForm({...editorForm,summary:e.target.value})}/></label><label>Isi / Keterangan<textarea rows={4} maxLength={8000} value={editorForm.body} onChange={e=>setEditorForm({...editorForm,body:e.target.value})}/></label><div className="sdlv3__formgrid"><label>Nomor referensi<input maxLength={160} value={editorForm.referenceNo} onChange={e=>setEditorForm({...editorForm,referenceNo:e.target.value})}/></label><label>URL Foto (HTTPS)<input type="url" maxLength={1000} value={editorForm.coverUrl} onChange={e=>setEditorForm({...editorForm,coverUrl:e.target.value})}/></label></div>{editorForm.kind==='agenda'&&<label>Waktu Agenda<input type="datetime-local" required value={editorForm.startsAt} onChange={e=>setEditorForm({...editorForm,startsAt:e.target.value})}/></label>}<div className="sdlv3__choices"><label><input type="checkbox" checked={editorForm.pinned} onChange={e=>setEditorForm({...editorForm,pinned:e.target.checked})}/> Sematkan</label><label><input type="checkbox" checked={editorForm.published} onChange={e=>setEditorForm({...editorForm,published:e.target.checked})}/> Publikasikan</label></div><div className="sdlv3__actions"><button type="button" onClick={()=>setEditorForm(null)}>Batal</button><button type="submit" className="sdlv3__primary" disabled={busy}>{busy?'Menyimpan…':'Simpan Konten'}</button></div></form></div></div>}
 </div>
}
