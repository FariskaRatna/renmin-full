import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './DirectivesR5F23.css'

type Recipient={id:string;name:string;unit:string;readAt:string|null;acknowledgedAt:string|null}
type Directive={id:string;title:string;body:string;kind:string;priority:string;issuerId:string;issuerName:string;dueAt:string|null;createdAt:string;total:number;read:number;acknowledged:number;myReadAt?:string|null;myAcknowledgedAt?:string|null;recipients?:Recipient[]}
type Tab='list'|'create'
type ViewItem=Directive & {direction:'received'|'sent'}
type Attachment={id:string;name:string;mime:string;size:number;createdAt:string}
type SendForm={title:string;body:string;kind:string;priority:string;dueAt:string;recipients:string[]}
type DraftStatus='loading'|'empty'|'dirty'|'saving'|'saved'|'error'|'conflict'
const initialForm=():SendForm=>({title:'',body:'',kind:'umum',priority:'biasa',dueAt:'',recipients:[]})
const fmt=(date?:string|null)=>date?new Date(date).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'})+' WIB':'—'
const formKey=(form:SendForm)=>JSON.stringify(form)
const sizeFmt=(n:number)=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.max(1,Math.ceil(n/1024))} KB`
const maxUpload=100*1024*1024
const displayKind:Record<string,string>={umum:'Umum',persuratan:'Persiapan Surat',sprint:'Persiapan Sprint',lainnya:'Lainnya'}
// Read-only status timeline. A later stage never lights up before an earlier stage.
// Aggregate counters describe distinct recipients; the explicit confirmation is final.
function DeliverySteps({total,read,accepted}:{total:number;read:number;accepted:number}){
 const all=Math.max(total,1)
 const stages=[
  {name:'Terkirim',num:total,tone:'sent',current:total>0},
  {name:'Dibaca',num:Math.min(total,Math.max(read,accepted)),tone:'read',current:Math.max(read,accepted)>0},
  {name:'Diterima',num:Math.min(total,accepted),tone:'accepted',current:accepted>0}
 ]
 return <div className="sdl-arahan__steps" aria-label={`Status arahan: ${total} terkirim, ${read} dibaca, ${accepted} diterima`}>
  {stages.map((step,index)=><div key={step.name} className={`sdl-arahan__step ${step.tone} ${step.current?'is-active':'is-pending'} ${step.num===all?'is-complete':''}`}>
   <span className="sdl-arahan__step-symbol" aria-hidden="true">{step.current?'✓':index+1}</span>
   <span className="sdl-arahan__step-copy"><strong>{step.name}</strong><small>{step.num}/{total} staf</small></span>
  </div>)}
 </div>
}


async function api<T>(path:string,method='GET',body?:unknown):Promise<T>{
 const headers:Record<string,string>={};if(body!==undefined)headers['Content-Type']='application/json'
 if(method!=='GET'){
  const response=await fetch('/api/v1/auth/csrf',{cache:'no-store',credentials:'same-origin'})
  if(!response.ok)throw new Error('Sesi keamanan tidak tersedia.')
  const token:{csrfToken:string}=await response.json();headers['X-CSRF-Token']=token.csrfToken
 }
 const res=await fetch('/api/v1/leadership/directives'+path,{method,credentials:'same-origin',cache:'no-store',headers,...(body!==undefined?{body:JSON.stringify(body)}:{})})
 if(!res.ok){
  if(res.status===409)throw new Error('Draft berubah di sesi lain. Muat ulang draft terbaru sebelum melanjutkan.')
  throw new Error(res.status===403?'Anda tidak memiliki kewenangan untuk tindakan ini.':res.status===400?'Periksa kembali isi arahan dan penerimanya.':res.status===404?'Arahan tidak ditemukan atau bukan untuk akun Anda.':'Layanan arahan belum dapat digunakan.')
 }
 return res.json() as Promise<T>
}

export default function DirectivesR5F23({onNotificationChange}:{onNotificationChange?:()=>void}){
 const [canIssue,setCanIssue]=useState(false),[tab,setTab]=useState<Tab>('list')
 const [items,setItems]=useState<ViewItem[]>([]),[candidates,setCandidates]=useState<Recipient[]>([])
 const [draftFiles,setDraftFiles]=useState<Attachment[]>([]),[detailFiles,setDetailFiles]=useState<Attachment[]>([])
 const [uploadPercent,setUploadPercent]=useState<number|null>(null),[uploadBusy,setUploadBusy]=useState(false),[preview,setPreview]=useState<{url:string;name:string;mime:string}|null>(null)
 const [detailDirection,setDetailDirection]=useState<'received'|'sent'>('received')
 const previewRef=useRef<string|null>(null)
 const [detail,setDetail]=useState<Directive|null>(null),[form,setForm]=useState<SendForm>(initialForm)
 const [search,setSearch]=useState(''),[pickerOpen,setPickerOpen]=useState(false)
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true)
 const [message,setMessage]=useState(''),[error,setError]=useState(''),[deleteConfirm,setDeleteConfirm]=useState(false)
 const [draftReady,setDraftReady]=useState(false),[draftStatus,setDraftStatus]=useState<DraftStatus>('loading'),[savedAt,setSavedAt]=useState<string|null>(null)
 const formRef=useRef<SendForm>(form),revisionRef=useRef(0),savedKeyRef=useRef(formKey(form)),savePendingRef=useRef<Promise<boolean>|null>(null)
 const flash=(s:string)=>{setMessage(s);setError('')}
 const reload=useCallback(async(_mode:Tab='list',withSpinner=true)=>{if(withSpinner)setLoading(true);try{
  const [meta,received]=await Promise.all([api<{canIssue:boolean}>('/meta'),api<{items:Directive[]}>('/inbox')])
  const sent=meta.canIssue?await api<{items:Directive[]}>('/sent'):{items:[] as Directive[]}
  const all:ViewItem[]=[...(received.items||[]).map(x=>({...x,direction:'received' as const})),...(sent.items||[]).map(x=>({...x,direction:'sent' as const}))]
  all.sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())
  setCanIssue(meta.canIssue);setItems(all);setError('')
 }catch(e){setError(e instanceof Error?e.message:'Gagal memuat data.');if(withSpinner)setItems([])}finally{if(withSpinner)setLoading(false)}},[])
 useEffect(()=>{void reload('list')},[tab,reload])
 useEffect(()=>{if(tab!=='list')return;const timer=window.setInterval(()=>{void reload('list',false)},30000);return()=>window.clearInterval(timer)},[tab,reload])
 useEffect(()=>()=>{if(previewRef.current)URL.revokeObjectURL(previewRef.current)},[])
 async function loadDraftFiles(){const result=await api<{items:Attachment[]}>('/draft/attachments');setDraftFiles(result.items||[])}
 async function getDetailFiles(id:string){const result=await api<{items:Attachment[]}>(`/${id}/attachments`);setDetailFiles(result.items||[])}
 async function showFile(file:Attachment){
  try{
   setBusy(true)
   const response=await fetch(`/api/v1/leadership/directives/attachments/${file.id}/download`,{credentials:'same-origin',cache:'no-store'})
   if(!response.ok)throw new Error('Lampiran tidak tersedia atau akses ditolak.')
   const blob=await response.blob(),url=URL.createObjectURL(blob)
   if(previewRef.current)URL.revokeObjectURL(previewRef.current)
   previewRef.current=url
   setPreview({url,name:file.name,mime:file.mime})
  }catch(e){setError(e instanceof Error?e.message:'Gagal membuka lampiran.')}finally{setBusy(false)}
 }
 async function uploadFile(file:File){
  if(uploadBusy||busy)return
  if(draftFiles.length>=5){setError('Maksimal 5 lampiran untuk satu arahan.');return}
  if(!file.size||file.size>maxUpload){setError('Ukuran maksimal setiap file 100 MB.');return}
  const ext=file.name.toLowerCase().split('.').pop()
  if(!['jpg','jpeg','png','pdf'].includes(ext||'')){setError('Lampiran hanya JPG, PNG, atau PDF.');return}
  setUploadBusy(true);setUploadPercent(0);setError('')
  try{
   if(!await flushDraft(true))return
   const csrf=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
   if(!csrf.ok)throw new Error('Sesi keamanan tidak tersedia.')
   const token:{csrfToken:string}=await csrf.json()
   await new Promise<void>((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('POST','/api/v1/leadership/directives/draft/attachments')
    xhr.withCredentials=true;xhr.setRequestHeader('X-CSRF-Token',token.csrfToken)
    xhr.setRequestHeader('X-File-Name',encodeURIComponent(file.name))
    xhr.setRequestHeader('Content-Type','application/octet-stream')
    xhr.upload.onprogress=(ev)=>{if(ev.lengthComputable)setUploadPercent(Math.min(99,Math.round(ev.loaded/ev.total*100)))}
    xhr.onload=()=>xhr.status===201?resolve():reject(new Error(xhr.status===413?'File melebihi 100 MB.':xhr.status===409?'Draft berubah atau sudah mencapai batas lampiran.':'Upload gagal. Periksa format berkas.'))
    xhr.onerror=()=>reject(new Error('Koneksi terputus saat upload.'))
    xhr.send(file)
   })
   await loadDraftFiles();setUploadPercent(100);flash('Lampiran berhasil disimpan ke draft.')
  }catch(e){setError(e instanceof Error?e.message:'Gagal menyimpan lampiran.')}finally{setUploadBusy(false);setUploadPercent(null)}
 }
 async function removeFile(id:string){
  if(busy||uploadBusy)return
  try{setBusy(true);await api(`/draft/attachments/${id}`,'DELETE');await loadDraftFiles();flash('Lampiran dihapus dari draft.')}
  catch(e){setError(e instanceof Error?e.message:'Gagal menghapus lampiran.')}finally{setBusy(false)}
 }

 async function loadDraft(){
  setDraftReady(false);setDraftStatus('loading')
  try{
   const [candidateRes,draftRes]=await Promise.all([api<{items:Recipient[]}>('/candidates'),api<{draft:SendForm|null;revision?:number;updatedAt?:string}>('/draft')])
   const staff=candidateRes.items||[];setCandidates(staff)
   const old=draftRes.draft
   const restore:SendForm=old?{title:old.title||'',body:old.body||'',kind:old.kind||'umum',priority:old.priority||'biasa',dueAt:old.dueAt||'',recipients:Array.isArray(old.recipients)?old.recipients:[]}:initialForm()
   formRef.current=restore;setForm(restore);savedKeyRef.current=formKey(restore)
   revisionRef.current=draftRes.revision||0;setSavedAt(draftRes.updatedAt||null)
   await loadDraftFiles();setDraftStatus(old?'saved':'empty');setDraftReady(true);setSearch('');setPickerOpen(false)
   if(old)flash('Draft terakhir dipulihkan.')
  }catch(e){setError(e instanceof Error?e.message:'Gagal memuat draft.');setDraftStatus('error')}
 }
 function changeForm(patch:Partial<SendForm>){
  const next={...formRef.current,...patch};formRef.current=next;setForm(next)
  setDraftStatus('dirty');setMessage('')
 }
 async function flushDraft(force=false):Promise<boolean>{
  if(!draftReady)return false
  if(savePendingRef.current){await savePendingRef.current}
  if(formKey(formRef.current)===savedKeyRef.current&&(!force||revisionRef.current>0))return true
  const snapshot={...formRef.current,recipients:[...formRef.current.recipients]}
  const signature=formKey(snapshot)
  const work=(async()=>{
   try{
    setDraftStatus('saving')
    const response=await api<{revision:number;updatedAt:string}>('/draft','PUT',{...snapshot,revision:revisionRef.current})
    revisionRef.current=response.revision;savedKeyRef.current=signature;setSavedAt(response.updatedAt)
    setDraftStatus(formKey(formRef.current)===signature?'saved':'dirty')
    return true
   }catch(e){setDraftStatus(e instanceof Error&&e.message.includes('sesi lain')?'conflict':'error');setError(e instanceof Error?e.message:'Draft belum tersimpan.');return false}
  })()
  savePendingRef.current=work
  const ok=await work
  if(savePendingRef.current===work)savePendingRef.current=null
  if(!ok)return false
  if(formKey(formRef.current)!==savedKeyRef.current)return flushDraft()
  return true
 }
 useEffect(()=>{
  if(tab!=='create'||!draftReady||busy||formKey(form)===savedKeyRef.current)return
  const timer=window.setTimeout(()=>{void flushDraft()},800)
  return()=>window.clearTimeout(timer)
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[form,tab,draftReady,busy])
 useEffect(()=>{
  if(tab!=='create'||!draftReady)return
  const warn=(event:BeforeUnloadEvent)=>{if(formKey(formRef.current)!==savedKeyRef.current){event.preventDefault();event.returnValue=''}}
  const background=()=>{if(document.visibilityState==='hidden'&&formKey(formRef.current)!==savedKeyRef.current){void flushDraft()}}
  window.addEventListener('beforeunload',warn)
  document.addEventListener('visibilitychange',background)
  return()=>{window.removeEventListener('beforeunload',warn);document.removeEventListener('visibilitychange',background)}
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[tab,draftReady])

 async function switchTo(next:Tab){
  if(busy||uploadBusy||next===tab)return
  if(tab==='create'&&draftReady&&draftStatus!=='conflict'&&formKey(formRef.current)!==savedKeyRef.current){const ok=await flushDraft();if(!ok)return}
  setMessage('');setError('');setDetail(null);setDeleteConfirm(false)
  if(next==='create'){
   if(!canIssue)return
   setTab(next);await loadDraft()
  }else setTab(next)
 }
 async function open(item:ViewItem){try{setBusy(true);setDetailDirection(item.direction);setDetailFiles([])
   let record=await api<Directive>('/'+item.id);setDetail(record)
   await getDetailFiles(item.id)
   if(item.direction==='received'&&!record.myReadAt){await api('/'+item.id+'/read','POST');record=await api<Directive>('/'+item.id);setDetail(record);onNotificationChange?.();void reload('list',false)}
   if(item.direction==='sent'&&canIssue){await api('/'+item.id+'/ack-seen','POST');onNotificationChange?.()}
 }catch(e){setError(e instanceof Error?e.message:'Gagal membuka arahan.')}finally{setBusy(false)}}
 async function confirm(){if(!detail||busy)return;try{setBusy(true);await api('/'+detail.id+'/acknowledge','POST');setDetail(await api<Directive>('/'+detail.id));flash('Penerimaan arahan berhasil dikonfirmasi.');onNotificationChange?.();await reload('list',false)}
 catch(e){setError(e instanceof Error?e.message:'Gagal mengonfirmasi.')}finally{setBusy(false)}}
 async function send(e:FormEvent){
  e.preventDefault();if(busy||uploadBusy||!draftReady)return
  const p=formRef.current
  if(p.title.trim().length<3||p.body.trim().length<8){setError('Lengkapi judul dan isi arahan.');return}
  if(p.recipients.length<1||p.recipients.length>10){setError('Pilih 1 sampai 10 staf.');return}
  try{
   setBusy(true)
   if(!(await flushDraft()))return
   await api<{id:string}>('/','POST',{title:p.title.trim(),body:p.body.trim(),kind:p.kind,priority:p.priority,dueAt:p.dueAt?new Date(p.dueAt).toISOString():null,recipients:p.recipients,draftRevision:revisionRef.current})
   const cleared=initialForm();formRef.current=cleared;setForm(cleared);savedKeyRef.current=formKey(cleared);revisionRef.current=0;setSavedAt(null);setDraftReady(false)
   setDraftFiles([]);setTab('list');flash('Arahan berhasil dikirim kepada staf terpilih.');onNotificationChange?.()
  }catch(e){setError(e instanceof Error?e.message:'Gagal mengirim arahan.')}finally{setBusy(false)}
 }
 async function clearDraft(){
  setDeleteConfirm(false)
  if(busy||uploadBusy||!draftReady)return
  setBusy(true)
  try{
   if(savePendingRef.current)await savePendingRef.current
   if(revisionRef.current>0)await api('/draft','DELETE',{revision:revisionRef.current})
   const cleared=initialForm();formRef.current=cleared;setForm(cleared);savedKeyRef.current=formKey(cleared);revisionRef.current=0;setSavedAt(null);setDraftFiles([]);setDraftStatus('empty');flash('Draft dikosongkan.')
  }catch(e){setError(e instanceof Error?e.message:'Gagal menghapus draft.')}finally{setBusy(false)}
 }
 const matches=useMemo(()=>candidates.filter(p=>!form.recipients.includes(p.id)&&(p.name+' '+p.unit).toLocaleLowerCase('id-ID').includes(search.toLocaleLowerCase('id-ID'))).slice(0,8),[candidates,search,form.recipients])
 const selectedPeople=useMemo(()=>form.recipients.map(id=>candidates.find(p=>p.id===id)||{id,name:'Staf terpilih',unit:'Akun perlu diverifikasi',readAt:null,acknowledgedAt:null}),[candidates,form.recipients])
 function toggleRecipient(id:string){const current=formRef.current.recipients;changeForm({recipients:current.includes(id)?current.filter(x=>x!==id):current.length>=10?current:[...current,id]})}
 const hasContent=Boolean(form.title||form.body||form.dueAt||form.recipients.length||form.priority!=='biasa'||form.kind!=='umum'||draftFiles.length>0)
 const statusText:Record<DraftStatus,string>={loading:'Memuat draft…',empty:'Siap menulis arahan',dirty:'Ada perubahan belum tersimpan',saving:'Menyimpan draft…',saved:'Draft tersimpan otomatis',error:'Draft belum tersimpan',conflict:'Draft berubah di sesi lain'}
 const outstanding=items.filter(item=>item.direction==='received'?!item.myAcknowledgedAt:item.acknowledged<item.total).length
 const statusInfo=(item:ViewItem)=>{
  if(item.direction==='received')return item.myAcknowledgedAt?{text:'Diterima',kind:'accepted'}:item.myReadAt?{text:'Dibaca',kind:'read'}:{text:'Dikirim',kind:'sent'}
  if(item.total>0&&item.acknowledged===item.total)return {text:`${item.acknowledged}/${item.total} Diterima`,kind:'accepted'}
  if(item.acknowledged>0)return {text:`${item.acknowledged}/${item.total} Diterima`,kind:'sent'}
  if(item.read>0)return {text:`${item.read}/${item.total} Dibaca`,kind:'read'}
  return {text:'Dikirim',kind:'sent'}
 }
 return <div className="sdl-arahan">
  <header className="sdl-arahan__hero"><div><small>SIERA DELTA LIMA · LAYANAN LINTAS UNIT</small><h1>Arahan Pimpinan</h1><p>Instruksi langsung Kabagrenmin kepada staf renmin</p></div><span className="sdl-arahan__hero-icon" aria-hidden="true">↗</span></header>
  <nav className="sdl-arahan__tabs" aria-label="Menu arahan">
   <button type="button" className={tab==='list'?'active':''} onClick={()=>void switchTo('list')}>Arahan</button>
   {canIssue&&<button type="button" className={tab==='create'?'active':''} onClick={()=>void switchTo('create')}>＋ Buat Arahan</button>}
  </nav>
  {error&&<div className="sdl-arahan__toast sdl-arahan__error" role="alert"><span>{error}</span><button type="button" onClick={()=>setError('')} aria-label="Tutup pesan">×</button></div>}
  {message&&<div className="sdl-arahan__toast" role="status"><span>{message}</span><button type="button" onClick={()=>setMessage('')} aria-label="Tutup pesan">×</button></div>}
  {tab==='create'&&canIssue?<section className="sdl-arahan__editor" aria-label="Tulis arahan baru">
   <div className="sdl-arahan__editor-heading"><div><span className="sdl-arahan__eyebrow">KIRIM ARAHAN</span><h2>Tulis instruksi baru</h2><p>Satu pesan, sampai 10 staf yang dituju.</p></div><span className={`sdl-arahan__save-indicator ${draftStatus}`}><span className="sdl-arahan__status-dot"/>{statusText[draftStatus]}</span></div>
   <form onSubmit={(e:FormEvent)=>void send(e)} className="sdl-arahan__editor-grid">
    <div className="sdl-arahan__compose-card">
     <div className="sdl-arahan__receiver-head"><span>Kepada <b>{form.recipients.length}/10</b></span><span className="sdl-arahan__small">Staf BagRenmin</span></div>
     <div className="sdl-arahan__chip-area">
      {selectedPeople.map(person=><span className="sdl-arahan__chip" key={person.id}><span className="sdl-arahan__chip-avatar">{person.name.slice(0,1)}</span><span title={person.name}>{person.name}</span><button type="button" onClick={()=>toggleRecipient(person.id)} aria-label={`Hapus ${person.name}`} disabled={busy||!draftReady}>×</button></span>)}
      <div className="sdl-arahan__picker-wrap"><input className="sdl-arahan__search" aria-label="Cari dan tambah penerima" value={search} onFocus={()=>setPickerOpen(true)} onChange={(e:{target:{value:string}})=>{setSearch(e.target.value);setPickerOpen(true)}} placeholder={form.recipients.length?'Tambah staf…':'Cari nama staf atau unit…'} disabled={!draftReady||busy}/>
       {pickerOpen&&<div className="sdl-arahan__picker" role="listbox" aria-label="Pilihan staf"><div className="sdl-arahan__picker-cap">PILIH STAF AKTIF</div>{matches.length?matches.map(person=><button role="option" aria-selected={false} className="sdl-arahan__candidate" type="button" key={person.id} disabled={form.recipients.length>=10||busy} onClick={()=>{toggleRecipient(person.id);setSearch('');setPickerOpen(false)}}><span className="sdl-arahan__candidate-avatar">{person.name.slice(0,1)}</span><span><strong>{person.name}</strong><small>{person.unit.toUpperCase()}</small></span><span className="sdl-arahan__candidate-plus">+</span></button>):<p className="sdl-arahan__no-people">{form.recipients.length>=10?'Maksimal 10 penerima.':'Staf tidak ditemukan.'}</p>}<button type="button" className="sdl-arahan__picker-close" onClick={()=>setPickerOpen(false)}>Selesai</button></div>}</div>
     </div>
     <div className="sdl-arahan__compose-body"><label className="sdl-arahan__sr-only" htmlFor="sdl-directive-title">Judul Arahan</label><input id="sdl-directive-title" className="sdl-arahan__title-input" required minLength={3} maxLength={160} value={form.title} onChange={(e:{target:{value:string}})=>changeForm({title:e.target.value})} onBlur={()=>{if(draftReady&&!busy)void flushDraft()}} disabled={!draftReady||busy} placeholder="Judul arahan…" />
      <label className="sdl-arahan__sr-only" htmlFor="sdl-directive-body">Isi Arahan</label><textarea id="sdl-directive-body" className="sdl-arahan__body-input" required minLength={8} maxLength={4000} rows={7} value={form.body} onChange={(e:{target:{value:string}})=>changeForm({body:e.target.value})} onBlur={()=>{if(draftReady&&!busy)void flushDraft()}} disabled={!draftReady||busy} placeholder="Tulis arahan singkat dan jelas untuk staf yang dituju…"/>
      <span className="sdl-arahan__character">{form.body.length}/4.000 karakter</span></div>
     <div className="sdl-arahan__attachments-editor"><div className="sdl-arahan__attach-heading"><strong>📎 Lampiran</strong><span>{draftFiles.length}/5 · JPG, PNG, PDF · maks. 100 MB/file</span></div>
      {draftFiles.length>0&&<div className="sdl-arahan__file-list">{draftFiles.map(file=><div className="sdl-arahan__file-row" key={file.id}><span className="sdl-arahan__file-icon">{file.mime==='application/pdf'?'PDF':'FOTO'}</span><span className="sdl-arahan__file-info"><strong>{file.name}</strong><small>{sizeFmt(file.size)}</small></span><button type="button" onClick={()=>void showFile(file)} disabled={busy||uploadBusy}>Lihat</button><button type="button" onClick={()=>void removeFile(file.id)} disabled={busy||uploadBusy} aria-label={`Hapus ${file.name}`}>×</button></div>)}</div>}
      {draftFiles.length<5&&<label className="sdl-arahan__upload-button">{uploadBusy?`Mengunggah ${uploadPercent??0}%…`:'＋ Tambah Foto / PDF'}<input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" disabled={uploadBusy||busy||!draftReady} onChange={(e:{currentTarget:{files:FileList|null;value:string}})=>{const selected=e.currentTarget.files?.[0];if(selected)void uploadFile(selected);e.currentTarget.value=''}}/></label>}
      {uploadBusy&&<div className="sdl-arahan__upload-progress"><span style={{width:`${uploadPercent||0}%`}}/></div>}
     </div>
     <div className="sdl-arahan__composer-foot"><span>Pesan satu arah · Penerima wajib konfirmasi</span><span className="sdl-arahan__save-inline">{savedAt&&draftStatus==='saved'?`Disimpan ${fmt(savedAt)}`:statusText[draftStatus]}</span></div>
    </div>
    <aside className="sdl-arahan__settings"><div className="sdl-arahan__settings-title"><h3>Pengaturan arahan</h3><p>Lengkapi bila diperlukan.</p></div>
     <div className="sdl-arahan__setting-block"><span className="sdl-arahan__setting-label">Prioritas</span><div className="sdl-arahan__priority-switch" role="group" aria-label="Prioritas arahan">{[['biasa','Biasa'],['penting','Penting'],['kilat','Kilat']].map(([val,label])=><button type="button" key={val} disabled={!draftReady||busy} className={form.priority===val?`active ${val}`:''} aria-pressed={form.priority===val} onClick={()=>changeForm({priority:val})}>{label}</button>)}</div></div>
     <label className="sdl-arahan__setting-block"><span className="sdl-arahan__setting-label">Jenis arahan</span><select value={form.kind} onChange={(e:{target:{value:string}})=>changeForm({kind:e.target.value})} disabled={!draftReady||busy}>{Object.entries(displayKind).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
     <label className="sdl-arahan__setting-block"><span className="sdl-arahan__setting-label">Tenggat <i>(opsional)</i></span><input type="datetime-local" value={form.dueAt} onChange={(e:{target:{value:string}})=>changeForm({dueAt:e.target.value})} disabled={!draftReady||busy}/></label>
     <div className="sdl-arahan__send-summary"><span>Ringkasan pengiriman</span><strong>{form.recipients.length} staf terpilih</strong><small>Setelah dikirim, isi arahan tidak dapat diubah.</small></div>
     <button className="sdl-arahan__primary sdl-arahan__send" type="submit" disabled={busy||uploadBusy||!draftReady||form.recipients.length===0||!form.title.trim()||!form.body.trim()||draftStatus==='conflict'}>{busy?'Mengirim…':`Kirim Arahan →`}</button>
     <div className="sdl-arahan__draft-actions">{draftStatus==='conflict'?<button type="button" disabled={busy} onClick={()=>{void loadDraft()}}>Muat draft terbaru (ganti perubahan lokal)</button>:<button type="button" disabled={busy||!draftReady} onClick={()=>{void flushDraft()}}>Simpan sekarang</button>}<button type="button" disabled={busy||!draftReady||!hasContent} onClick={()=>setDeleteConfirm(true)}>Hapus draft</button></div>
    </aside>
   </form>
  </section>:<div className="sdl-arahan__list"><div className="sdl-arahan__list-head"><div><h2>Daftar Arahan</h2><p>Arahan masuk, terkirim, dan konfirmasi penerimaan dalam satu tempat.</p></div>{!loading&&items.length>0&&<span className="sdl-arahan__list-count">{outstanding} belum dikonfirmasi</span>}</div>{loading?<div className="sdl-arahan__empty">Memuat arahan…</div>:items.length===0?<div className="sdl-arahan__empty">Belum ada arahan.</div>:items.map(item=>{const status=statusInfo(item);return <button type="button" className={`sdl-arahan__item ${item.priority} ${status.kind}`} key={item.id} onClick={()=>void open(item)}><span className="sdl-arahan__item-icon">{item.direction==='sent'?'↗':'↙'}</span><span className="sdl-arahan__itembody"><span className="sdl-arahan__itemtop"><strong>{item.title}</strong><span className={`sdl-arahan__priority ${item.priority}`}>{item.priority.toUpperCase()}</span><span className={`sdl-arahan__status-badge ${status.kind}`}>{status.text}</span></span><small>{item.direction==='received'?`Dari ${item.issuerName}`:`Kepada ${item.total} staf`} · Dikirim {fmt(item.createdAt)}</small>{item.direction==='received'&&item.myAcknowledgedAt&&<small className="sdl-arahan__received-at">✓ Diterima {fmt(item.myAcknowledgedAt)}</small>}</span><span className="sdl-arahan__arrow">→</span></button>})}</div>}
  {deleteConfirm&&<div className="sdl-arahan__overlay" role="presentation"><section className="sdl-arahan__confirm-dialog" role="dialog" aria-modal="true" aria-label="Hapus draft"><h3>Hapus draft arahan?</h3><p>Isi arahan yang belum dikirim akan dikosongkan dari draft akun Anda.</p><div><button type="button" onClick={()=>setDeleteConfirm(false)}>Batal</button><button type="button" className="sdl-arahan__danger" onClick={()=>{void clearDraft()}}>Ya, hapus draft</button></div></section></div>}
  {detail&&<div className="sdl-arahan__overlay" onMouseDown={(e:{target:EventTarget;currentTarget:EventTarget})=>{if(e.target===e.currentTarget)setDetail(null)}}><article className="sdl-arahan__dialog" role="dialog" aria-modal="true" aria-label="Detail arahan"><header><div><span className={`sdl-arahan__priority ${detail.priority}`}>{detail.priority.toUpperCase()}</span><h2>{detail.title}</h2></div><button type="button" onClick={()=>setDetail(null)} aria-label="Tutup">×</button></header><div className="sdl-arahan__detail-meta"><div className="sdl-arahan__meta-block"><span>Dikirim oleh</span><strong>{detail.issuerName}</strong><small>{fmt(detail.createdAt)}</small></div><div className="sdl-arahan__meta-block"><span>Ditujukan kepada</span><strong>{detailDirection==='sent'?(detail.recipients?.length===1?detail.recipients[0].name:`${detail.total} staf BagRenmin`):'Akun Anda'}</strong>{detailDirection==='sent'&&detail.recipients&&detail.recipients.length>1&&<small>{detail.recipients.map(r=>r.name).join(' · ')}</small>}</div></div><p className="sdl-arahan__body">{detail.body}</p><div className="sdl-arahan__facts"><span>Jenis: {displayKind[detail.kind]||detail.kind}</span>{detail.dueAt&&<span>Tenggat: {fmt(detail.dueAt)}</span>}</div>
   {detailFiles.length>0&&<div className="sdl-arahan__attachments-detail"><h3>Lampiran · {detailFiles.length}</h3><div className="sdl-arahan__file-pills">{detailFiles.map(file=><button type="button" key={file.id} className="sdl-arahan__file-pill" title={`${file.name} · ${sizeFmt(file.size)}`} onClick={()=>void showFile(file)} disabled={busy}><span className="sdl-arahan__file-mini-icon" aria-hidden="true">{file.mime==='application/pdf'?'PDF':'IMG'}</span><span className="sdl-arahan__file-pill-label"><strong>{file.name}</strong><small>{sizeFmt(file.size)}</small></span><span className="sdl-arahan__file-pill-arrow" aria-hidden="true">↗</span></button>)}</div></div>}
   {detailDirection==='sent'?<div><h3>Konfirmasi Penerima · {detail.acknowledged}/{detail.total}</h3><DeliverySteps total={detail.total} read={detail.read} accepted={detail.acknowledged}/><div className="sdl-arahan__recipientrows">{detail.recipients?.map(p=><div key={p.id}><span><strong>{p.name}</strong><small>{p.unit.toUpperCase()}</small></span><span className="sdl-arahan__recipient-state"><span className="sdl-arahan__recipient-mini-steps" aria-label={`Status ${p.name}: ${p.acknowledgedAt?'Diterima':p.readAt?'Dibaca':'Dikirim'}`}><i className="sent active" title="Terkirim"/><i className={`read ${p.readAt||p.acknowledgedAt?'active':''}`} title="Dibaca"/><i className={`accepted ${p.acknowledgedAt?'active':''}`} title="Diterima"/></span><span className={`sdl-arahan__status-badge ${p.acknowledgedAt?'accepted':p.readAt?'read':'sent'}`}>{p.acknowledgedAt?'Diterima':p.readAt?'Dibaca':'Dikirim'}</span><small>Dikirim {fmt(detail.createdAt)}</small>{p.readAt&&<small>Dibaca {fmt(p.readAt)}</small>}{p.acknowledgedAt&&<small>Diterima {fmt(p.acknowledgedAt)}</small>}</span></div>)}</div></div>:<div className="sdl-arahan__confirm"><DeliverySteps total={1} read={detail.myReadAt||detail.myAcknowledgedAt?1:0} accepted={detail.myAcknowledgedAt?1:0}/>{detail.myAcknowledgedAt?<p className="sdl-arahan__status-badge accepted">✓ Diterima {fmt(detail.myAcknowledgedAt)}</p>:<><p>{detail.myReadAt?'Dibaca '+fmt(detail.myReadAt):'Belum dibaca'}. Tekan tombol untuk konfirmasi penerimaan.</p><button type="button" className="sdl-arahan__primary" disabled={busy} onClick={()=>void confirm()}>{busy?'Memproses…':'✓ Terima Arahan'}</button></>}</div>}</article></div>}
  {preview&&<div className="sdl-arahan__overlay" onMouseDown={(e:{target:EventTarget;currentTarget:EventTarget})=>{if(e.target===e.currentTarget)setPreview(null)}}><div className="sdl-arahan__image-dialog" role="dialog" aria-modal="true" aria-label={`Foto ${preview.name}`}><header><strong>{preview.name}</strong><div className="sdl-arahan__preview-actions"><a href={preview.url} download={preview.name}>Unduh</a><button type="button" onClick={()=>setPreview(null)}>Tutup</button></div></header>{preview.mime==='application/pdf'?<iframe src={preview.url} title={`Pratinjau ${preview.name}`} className="sdl-arahan__pdf-frame"/>:<img src={preview.url} alt={preview.name}/>}</div></div>}
 </div>
}
