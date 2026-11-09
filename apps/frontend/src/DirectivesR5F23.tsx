import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './DirectivesR5F23.css'
import { Pager, usePaged } from './PaginationR5H5'

type Recipient={id:string;name:string;unit:string;section?:string;readAt:string|null;acknowledgedAt:string|null}
// R5H2: lembar disposisi. Urutan field mengikuti backend (directives/sheet.go).
// agendaNo milik server: tidak pernah dikirim, selalu null sampai bagian yang
// ditunjuk membuat surat dari arahan ini (tahap berikutnya).
type Sheet={letterFrom:string;letterNumber:string;directiveDate:string;letterDate:string;subject:string;classification:string;derajat:string;dispositions:string[];dispositionNote:string;agendaNo?:number|null}
type DispositionOption={code:string;name:string}
type Directive={id:string;title:string;body:string;kind:string;priority:string;issuerId:string;issuerName:string;dueAt:string|null;createdAt:string;total:number;read:number;acknowledged:number;myReadAt?:string|null;myAcknowledgedAt?:string|null;recipients?:Recipient[];incomingId?:string;agendaSurat?:string;sheet?:Sheet}
type Tab='list'|'create'
type ViewItem=Directive & {direction:'received'|'sent'}
type Attachment={id:string;name:string;mime:string;size:number;createdAt:string}
// R5H1: tujuan arahan adalah BAGIAN. holders hanya untuk diperlihatkan —
// "Kasubbagren · Budi S." memberi tahu Kabagrenmin surat ini akan mendarat di
// meja siapa, tanpa membuatnya memilih orang.
type SectionHolder={id:string;name:string;canReceiveBiasa:boolean;canReceivePenting:boolean}
// R5H4: kind = jabatan (kepala saja) | bagian (seluruh unit) | paur (Paur Subbagsumda).
type Section={key:string;label:string;kind:'jabatan'|'bagian'|'paur';unit:string;holders:SectionHolder[];letterBiasa:boolean;letterPenting:boolean}
type LinkableLetter={id:string;agendaNo:number;letterNumber:string;sender:string;subject:string;classification:string;derajat:string;letterKind:string;letterDate:string;receivedAt:string|null;directiveCount:number}
// recipients tetap ada dan SELALU kosong: ia bagian dari bentuk draft yang
// diterima server, dan backend menolak payload yang mengisi sections sekaligus
// recipients. Layar tidak lagi menunjuk orang per orang.
type SendForm={title:string;body:string;kind:string;priority:string;dueAt:string;recipients:string[];sections:string[];incomingId:string|null;sheet:Sheet}
type DraftStatus='loading'|'empty'|'dirty'|'saving'|'saved'|'error'|'conflict'
const todayJakarta=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const blankSheet=():Sheet=>({letterFrom:'',letterNumber:'',directiveDate:todayJakarta(),letterDate:'',subject:'',classification:'biasa',derajat:'biasa',dispositions:[],dispositionNote:''})
// Prioritas tidak lagi dipilih di layar; ia diturunkan dari lembar supaya
// badge daftar arahan (yang membaca priority) tetap bermakna. Kilat menang atas
// Rahasia karena badge itu menjawab "seberapa cepat", bukan "siapa boleh baca".
const priorityOf=(s:Sheet)=>s.derajat==='kilat'?'kilat':s.classification==='penting'?'penting':'biasa'
// Hanya field yang dikenal backend. Membangun ulang (bukan menyebar objek)
// memastikan agendaNo maupun kunci asing lain tidak pernah ikut terkirim.
const sheetPayload=(s:Sheet):Sheet=>({letterFrom:s.letterFrom,letterNumber:s.letterNumber,directiveDate:s.directiveDate,letterDate:s.letterDate,subject:s.subject,classification:s.classification,derajat:s.derajat,dispositions:[...s.dispositions],dispositionNote:s.dispositionNote})
const initialForm=():SendForm=>({title:'',body:'',kind:'umum',priority:'biasa',dueAt:'',recipients:[],sections:[],incomingId:null,sheet:blankSheet()})
const fmtDate=(date?:string)=>date?new Date(date+'T00:00:00').toLocaleDateString('id-ID',{dateStyle:'medium'}):'—'
const initialsOf=(label:string)=>label.replace(/[^A-Za-z ]/g,' ').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'•'
type ChipOption={key:string;label:string;detail:string;blocked:string}
// Pemilih berbentuk chip + kotak cari: bentuk penunjukan penerima sebelum R5H1,
// dipakai lagi untuk daftar Kasubbag dan daftar Disposisi Kabagrenmin.
function ChipPicker({ariaLabel,cap,placeholder,empty,options,picked,labelOf,disabled,onToggle}:{ariaLabel:string;cap:string;placeholder:string;empty:string;options:ChipOption[];picked:string[];labelOf:(key:string)=>string;disabled:boolean;onToggle:(key:string)=>void}){
 const [query,setQuery]=useState(''),[open,setOpen]=useState(false)
 const q=query.trim().toLowerCase()
 const available=options.filter(o=>!picked.includes(o.key)&&(!q||o.label.toLowerCase().includes(q)||o.detail.toLowerCase().includes(q)))
 return <div className="sdl-arahan__chip-area" role="group" aria-label={ariaLabel}>
  {picked.map(key=>{const label=labelOf(key);return <span className="sdl-arahan__chip" key={key}><span className="sdl-arahan__chip-avatar" aria-hidden="true">{initialsOf(label)}</span><span title={label}>{label}</span><button type="button" disabled={disabled} onClick={()=>onToggle(key)} aria-label={`Lepas ${label}`}>×</button></span>})}
  <div className="sdl-arahan__picker-wrap">
   <input className="sdl-arahan__search" value={query} disabled={disabled} placeholder={placeholder} aria-label={placeholder} onFocus={()=>setOpen(true)} onChange={(e:{target:{value:string}})=>{setQuery(e.target.value);setOpen(true)}} onKeyDown={(e:{key:string})=>{if(e.key==='Escape')setOpen(false)}}/>
   {open&&!disabled&&<div className="sdl-arahan__picker" role="listbox" aria-label={ariaLabel}><div className="sdl-arahan__picker-cap">{cap}</div>
    {available.length===0?<p className="sdl-arahan__no-people">{empty}</p>:available.map(o=><button type="button" role="option" aria-selected={false} className="sdl-arahan__candidate" key={o.key} disabled={Boolean(o.blocked)} onClick={()=>{onToggle(o.key);setQuery('')}}><span className="sdl-arahan__candidate-avatar" aria-hidden="true">{initialsOf(o.label)}</span><span><strong>{o.label}</strong><small>{o.blocked||o.detail}</small></span><span className="sdl-arahan__candidate-plus" aria-hidden="true">＋</span></button>)}
    <button type="button" className="sdl-arahan__picker-close" onClick={()=>setOpen(false)}>Tutup</button></div>}
  </div>
 </div>
}
const fmt=(date?:string|null)=>date?new Date(date).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'})+' WIB':'—'
const formKey=(form:SendForm)=>JSON.stringify(form)
const sizeFmt=(n:number)=>n>=1048576?`${(n/1048576).toFixed(1)} MB`:`${Math.max(1,Math.ceil(n/1024))} KB`
const maxUpload=100*1024*1024
const displayKind:Record<string,string>={umum:'Umum',persuratan:'Persiapan Surat',sprint:'Persiapan Sprint',lainnya:'Lainnya'}
// 'penting' tampil sebagai Rahasia sejak R5G; nilai wire-nya tidak berubah.
const displayClass:Record<string,string>={biasa:'Biasa',penting:'Rahasia'}
// Label cadangan untuk kunci bagian. Dipakai saat membaca arahan yang sudah
// terkirim tanpa pernah membuka layar penyusun — di sana /sections belum
// dimuat. Daftar resminya tetap milik backend (directives/sections.go); ini
// hanya menerjemahkan kunci menjadi kata, dan selalu ditimpa oleh label yang
// datang dari /sections begitu tersedia.
const fallbackSectionLabel:Record<string,string>={kasubbagren:'Kasubbagren',kasubbagsumda:'Kasubbagsumda',kasubbagbinfung:'Kasubbagbinfung',kasubbagurmin:'Kaurmin',subbagren:'Subbagren',subbagsumda:'Subbagsumda',subbagbinfung:'Subbagbinfung',urmin:'Urmin',paur_sumda:'Paur Sumda',paur_log:'Paur Log',paur_ada:'Paur ADA'}
// Keterangan jenis pilihan di daftar tujuan.
const sectionKindCap:Record<string,string>={jabatan:'KEPALA SAJA',bagian:'SELURUH BAGIAN',paur:'PAUR SUBBAGSUMDA'}
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

export default function DirectivesR5F23({onNotificationChange,initialID}:{onNotificationChange?:()=>void;initialID?:string}){
 const [canIssue,setCanIssue]=useState(false),[tab,setTab]=useState<Tab>('list')
 const [items,setItems]=useState<ViewItem[]>([]),[sectionList,setSectionList]=useState<Section[]>([]),[letters,setLetters]=useState<LinkableLetter[]>([]),[dispositionOptions,setDispositionOptions]=useState<DispositionOption[]>([])
 const [draftFiles,setDraftFiles]=useState<Attachment[]>([]),[detailFiles,setDetailFiles]=useState<Attachment[]>([])
 const [uploadPercent,setUploadPercent]=useState<number|null>(null),[uploadBusy,setUploadBusy]=useState(false),[preview,setPreview]=useState<{url:string;name:string;mime:string}|null>(null)
 const [detailDirection,setDetailDirection]=useState<'received'|'sent'>('received')
 const previewRef=useRef<string|null>(null)
 const [detail,setDetail]=useState<Directive|null>(null),[form,setForm]=useState<SendForm>(initialForm)
 const [letterPickerOpen,setLetterPickerOpen]=useState(false),[letterQuery,setLetterQuery]=useState('')
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
 // R5H4: dibuka dari menu Tugas Disposisi dengan id arahan. Dijalankan sekali,
 // begitu arahan itu muncul di daftar; daftar yang dimuat ulang tiap 30 detik
 // tidak boleh membuka detailnya lagi setelah pengguna menutupnya.
 const openedInitial=useRef(false)
 useEffect(()=>{if(!initialID||openedInitial.current)return;const item=items.find(x=>x.id===initialID);if(!item)return;openedInitial.current=true;void open(item)},[initialID,items])
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
   const [sectionRes,letterRes,draftRes,optionRes]=await Promise.all([api<{items:Section[]}>('/sections'),api<{items:LinkableLetter[]}>('/letters'),api<{draft:(Omit<SendForm,'sheet'>&{sheet?:Sheet})|null;revision?:number;updatedAt?:string}>('/draft'),api<{items:DispositionOption[]}>('/disposition-options')])
   const bagian=sectionRes.items||[];setSectionList(bagian)
   const opsi=optionRes.items||[];setDispositionOptions(opsi)
   const knownOption=new Set(opsi.map(o=>o.code))
   const suratList=letterRes.items||[];setLetters(suratList)
   const old=draftRes.draft
   const known=new Set(bagian.map(s=>s.key))
   // Draft lama bisa menyebut bagian yang kini tidak ada lagi, atau surat yang
   // sudah tidak boleh ditautkan. Keduanya disaring di sini, bukan dibiarkan
   // sampai tombol kirim — 400 saat kirim tidak memberi tahu apa yang salah.
   const restore:SendForm=old?{title:old.title||'',body:old.body||'',kind:old.kind||'umum',priority:old.priority||'biasa',dueAt:old.dueAt||'',recipients:[],
    sections:Array.isArray(old.sections)?old.sections.filter(k=>known.has(k)):[],
    incomingId:old.incomingId&&suratList.some(l=>l.id===old.incomingId)?old.incomingId:null,
    // Draft sebelum R5H2 tidak punya lembar. Opsi disposisi yang sudah dihapus
    // dari Master Data dilepas di sini karena akan ditolak saat kirim.
    sheet:old.sheet?{...sheetPayload({...blankSheet(),...old.sheet}),dispositions:(old.sheet.dispositions||[]).filter(c=>knownOption.has(c))}:blankSheet()}:initialForm()
   // Draft yang dibuat sebelum R5H1 memilih orang per orang. Jalur itu sudah
   // tidak ada di layar, jadi daftarnya dilepas — dan dikatakan, bukan hilang
   // diam-diam.
   const droppedPeople=old&&Array.isArray(old.recipients)?old.recipients.length:0
   formRef.current=restore;setForm(restore);savedKeyRef.current=formKey(restore)
   revisionRef.current=draftRes.revision||0;setSavedAt(draftRes.updatedAt||null)
   await loadDraftFiles();setDraftStatus(old?'saved':'empty');setDraftReady(true);setLetterPickerOpen(false)
   if(droppedPeople>0)flash(`Draft terakhir dipulihkan. ${droppedPeople} staf yang dipilih per orang dilepas — arahan kini ditujukan ke bagian.`)
   else if(old)flash('Draft terakhir dipulihkan.')
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
  const snapshot={...formRef.current,recipients:[...formRef.current.recipients],sections:[...formRef.current.sections],sheet:sheetPayload(formRef.current.sheet)}
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
  if(p.sections.length<1){setError('Pilih minimal satu bagian tujuan.');return}
  try{
   setBusy(true)
   if(!(await flushDraft()))return
   // recipients SENGAJA tidak dikirim: backend menolak payload yang mengisi
   // sections dan recipients sekaligus.
   await api<{id:string}>('/','POST',{title:p.title.trim(),body:p.body.trim(),kind:p.kind,priority:priorityOf(p.sheet),dueAt:p.dueAt?new Date(p.dueAt).toISOString():null,sections:p.sections,incomingId:p.incomingId,draftRevision:revisionRef.current,sheet:sheetPayload(p.sheet)})
   const cleared=initialForm();formRef.current=cleared;setForm(cleared);savedKeyRef.current=formKey(cleared);revisionRef.current=0;setSavedAt(null);setDraftReady(false)
   setDraftFiles([]);setTab('list');flash(p.incomingId?'Arahan terkirim. Surat beserta lampirannya ikut diserahkan ke bagian yang ditunjuk.':'Arahan berhasil dikirim ke bagian yang ditunjuk.');onNotificationChange?.()
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
 const sectionLabel=useMemo(()=>({...fallbackSectionLabel,...Object.fromEntries(sectionList.map(s=>[s.key,s.label]))}) as Record<string,string>,[sectionList])
 // Bagian yang disebut arahan ini, tanpa pengulangan: satu bagian dengan dua
 // pejabat menghasilkan dua baris penerima tapi tetap satu tujuan.
 const detailSections=useMemo(()=>{
  const keys=(detail?.recipients||[]).map(r=>r.section).filter((k):k is string=>Boolean(k))
  return [...new Set(keys)].map(k=>sectionLabel[k]||k)
 },[detail,sectionLabel])
 const chosenLetter=useMemo(()=>letters.find(l=>l.id===form.incomingId)||null,[letters,form.incomingId])
 // Pencarian di sisi layar atas daftar yang sudah dimuat (maks. 100 surat dari
 // /letters); tidak ada panggilan API baru. Cocok ke agenda, nomor, perihal, pengirim.
 const shownLetters=useMemo(()=>{
  const q=letterQuery.trim().toLocaleLowerCase('id-ID')
  if(!q)return letters
  return letters.filter(l=>[String(l.agendaNo),`#${l.agendaNo}`,l.letterNumber,l.subject,l.sender].some(v=>(v||'').toLocaleLowerCase('id-ID').includes(q)))
 },[letters,letterQuery])
 // R5H4: klasifikasi tidak lagi menghalangi pilihan. Anggota yang tidak
 // berwenang atas surat tetap menerima arahannya, tanpa naskah suratnya --
 // keterangan itu ditampilkan di detail pilihan (lihat sectionDetail).
 // Orang yang sama bisa terjaring dua pilihan (Kasubbagren + Subbagren);
 // backend mencatatnya sekali, jadi hitungannya juga sekali.
 const recipientCount=useMemo(()=>new Set(form.sections.flatMap(k=>sectionList.find(x=>x.key===k)?.holders.map(h=>h.id)??[])).size,[form.sections,sectionList])
 const blockReason=useCallback((s:Section):string=>s.holders.length===0?(s.kind==='paur'?'Belum ada anggota Paur ini.':'Belum ada anggota aktif.'):'',[])
 const sectionDetail=useCallback((s:Section):string=>{
  const n=s.holders.length
  const who=s.kind==='jabatan'&&n===1?s.holders[0].name:`${n} orang`
  let text=`${sectionKindCap[s.kind]||s.unit.toUpperCase()} · ${who}`
  if(chosenLetter&&n>0){
   const can=s.holders.filter(h=>chosenLetter.classification==='penting'?h.canReceivePenting:h.canReceiveBiasa).length
   if(can<n)text+=` · naskah surat hanya untuk ${can}/${n}`
  }
  return text
 },[chosenLetter])
 function toggleSection(key:string){const current=formRef.current.sections;changeForm({sections:current.includes(key)?current.filter(x=>x!==key):[...current,key]})}
 // Mengganti surat dapat membuat bagian yang sudah dipilih menjadi tidak
 // berwenang. Dibersihkan saat itu juga supaya ringkasan pengiriman tidak
 // pernah menghitung bagian yang tombolnya sedang mati.
 function chooseLetter(id:string|null){
  const letter=id?letters.find(l=>l.id===id)||null:null
  // Memilih surat mengisi lembar dari data surat itu; isiannya tetap bisa
  // diubah. Melepas surat tidak mengosongkan lembar -- yang sudah diketik atau
  // terisi tidak hilang diam-diam.
  const current=formRef.current.sheet
  const sheet=letter?{...current,letterFrom:letter.sender,letterNumber:letter.letterNumber,letterDate:letter.letterDate||'',subject:letter.subject,classification:letter.classification==='penting'?'penting':current.classification,derajat:letter.derajat==='kilat'?'kilat':'biasa'}:current
  const keep=formRef.current.sections.filter(key=>{
   const s=sectionList.find(x=>x.key===key)
   return Boolean(s&&s.holders.length>0)
  })
  changeForm({incomingId:id,sections:keep,sheet,priority:priorityOf(sheet)})
  setLetterPickerOpen(false);setLetterQuery('')
 }
 function changeSheet(patch:Partial<Sheet>){
  const sheet={...formRef.current.sheet,...patch}
  // R5H4: klasifikasi lembar tidak lagi melepas pilihan tujuan.
  changeForm({sheet,priority:priorityOf(sheet)})
 }
 function toggleDisposition(code:string){const current=formRef.current.sheet.dispositions;changeSheet({dispositions:current.includes(code)?current.filter(x=>x!==code):[...current,code]})}
 const dispositionName=useMemo(()=>Object.fromEntries(dispositionOptions.map(o=>[o.code,o.name])) as Record<string,string>,[dispositionOptions])
 // Penerima juga perlu nama opsi untuk membaca lembar; dimuat sekali saat
 // detail berisi disposisi pertama kali dibuka.
 useEffect(()=>{
  if(!detail?.sheet?.dispositions.length||dispositionOptions.length>0)return
  api<{items:DispositionOption[]}>('/disposition-options').then(r=>setDispositionOptions(r.items||[])).catch(()=>{})
 },[detail,dispositionOptions.length])
 // Lembar tidak boleh menurunkan klasifikasi surat Rahasia yang ditautkan;
 // backend menolaknya dengan 400, layar mencegahnya lebih dulu.
 const letterLocksClass=chosenLetter?.classification==='penting'
 const hasContent=Boolean(form.title||form.body||form.dueAt||form.sections.length||form.incomingId||form.kind!=='umum'||draftFiles.length>0||form.sheet.letterFrom||form.sheet.letterNumber||form.sheet.letterDate||form.sheet.subject||form.sheet.dispositions.length||form.sheet.dispositionNote||form.sheet.classification!=='biasa'||form.sheet.derajat!=='biasa')
 const statusText:Record<DraftStatus,string>={loading:'Memuat draft…',empty:'Siap menulis arahan',dirty:'Ada perubahan belum tersimpan',saving:'Menyimpan draft…',saved:'Draft tersimpan otomatis',error:'Draft belum tersimpan',conflict:'Draft berubah di sesi lain'}
 const outstanding=items.filter(item=>item.direction==='received'?!item.myAcknowledgedAt:item.acknowledged<item.total).length

  // R5H5: paginasi seperti menu Disposisi.
  const {pageItems:pagedItems,pager}=usePaged(items,[items.length])
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
   <div className="sdl-arahan__editor-heading"><div><span className="sdl-arahan__eyebrow">KIRIM ARAHAN</span><h2>Tulis instruksi baru</h2><p>Tunjuk bagiannya; sistem yang menentukan pejabatnya.</p></div><span className={`sdl-arahan__save-indicator ${draftStatus}`}><span className="sdl-arahan__status-dot"/>{statusText[draftStatus]}</span></div>
   <form onSubmit={(e:FormEvent)=>void send(e)} className="sdl-arahan__editor-grid">
    <div className="sdl-arahan__compose-card">
     <div className="sdl-arahan__letterpick">
      <div className="sdl-arahan__receiver-head"><span>Surat terkait <i>(opsional)</i></span><span className="sdl-arahan__small">{letters.length} surat sudah Anda terima</span></div>
      {chosenLetter?<div className="sdl-arahan__letter-chosen"><span className="sdl-arahan__letter-main"><strong>#{chosenLetter.agendaNo} · {chosenLetter.subject}</strong><small>{chosenLetter.letterNumber} · Dari {chosenLetter.sender}</small></span><span className={`sdl-arahan__priority ${chosenLetter.classification==='penting'?'penting':'biasa'}`}>{(displayClass[chosenLetter.classification]||chosenLetter.classification).toUpperCase()}</span><button type="button" onClick={()=>chooseLetter(null)} disabled={busy||!draftReady} aria-label="Lepas surat terkait">×</button></div>
      :<button type="button" className="sdl-arahan__letter-open" disabled={!draftReady||busy||letters.length===0} onClick={()=>setLetterPickerOpen(true)}>{letters.length===0?'Belum ada surat masuk yang Anda terima':'＋ Pilih surat masuk yang diarahkan'}</button>}
      {letterPickerOpen&&<div className="sdl-arahan__picker" role="listbox" aria-label="Pilihan surat masuk"><div className="sdl-arahan__picker-cap">SURAT YANG SUDAH ANDA TERIMA</div>
       <input className="sdl-arahan__letter-search" autoFocus value={letterQuery} onChange={e=>setLetterQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();setLetterPickerOpen(false);setLetterQuery('')}else if(e.key==='Enter'){e.preventDefault();if(shownLetters.length===1)chooseLetter(shownLetters[0].id)}}} placeholder="Ketik nomor surat, perihal, pengirim, atau agenda…" aria-label="Cari surat masuk" maxLength={100}/>
       {shownLetters.length===0&&<p className="sdl-arahan__no-people">Tidak ada surat yang cocok dengan “{letterQuery.trim()}”.</p>}
       {shownLetters.map(letter=><button role="option" aria-selected={form.incomingId===letter.id} className="sdl-arahan__letter-option" type="button" key={letter.id} disabled={busy} onClick={()=>chooseLetter(letter.id)}><span><strong>#{letter.agendaNo} · {letter.subject}</strong><small>{letter.letterNumber} · {letter.sender} · {displayClass[letter.classification]||letter.classification}{letter.derajat==='kilat'?' · KILAT':''}</small></span>{letter.directiveCount>0&&<span className="sdl-arahan__letter-tag">{letter.directiveCount} arahan</span>}</button>)}
       <button type="button" className="sdl-arahan__picker-close" onClick={()=>{setLetterPickerOpen(false);setLetterQuery('')}}>Tutup</button></div>}
      {chosenLetter&&<p className="sdl-arahan__letter-note">Surat ini beserta lampirannya ikut diserahkan kepada penerima yang berwenang atas klasifikasinya. Penerima lain tetap menerima arahan dan lembar disposisinya.</p>}
     </div>
     <div className="sdl-arahan__receiver-head"><span>Kepada <b>{form.sections.length}/{sectionList.length||11}</b></span><span className="sdl-arahan__small">Jabatan, seluruh bagian, atau Paur</span></div>
     <ChipPicker ariaLabel="Bagian tujuan arahan" cap="TUJUAN ARAHAN" placeholder={form.sections.length?'Tambah tujuan…':'Ketik atau pilih Kasubbag, bagian, atau Paur…'} empty={sectionList.length===0?'Daftar tujuan belum dapat dimuat.':'Semua tujuan sudah dipilih.'}
      options={sectionList.map(s=>({key:s.key,label:s.label,detail:sectionDetail(s),blocked:blockReason(s)}))}
      picked={form.sections} labelOf={key=>sectionLabel[key]||key} disabled={!draftReady||busy} onToggle={toggleSection}/>
     <fieldset className="sdl-arahan__sheet" disabled={!draftReady||busy}><legend>Lembar disposisi</legend>
      <label><span>No. Agenda</span><input value="" disabled readOnly placeholder="Terisi otomatis saat bagian membuat surat"/></label>
      <label><span>Surat dari</span><input maxLength={200} value={form.sheet.letterFrom} onChange={(e:{target:{value:string}})=>changeSheet({letterFrom:e.target.value})} placeholder="Instansi / pejabat pengirim"/></label>
      <label><span>Nomor surat</span><input maxLength={100} value={form.sheet.letterNumber} onChange={(e:{target:{value:string}})=>changeSheet({letterNumber:e.target.value})} placeholder="Contoh: B/ND-157/X/2026"/></label>
      <label><span>Tanggal</span><input type="date" value={form.sheet.directiveDate} onChange={(e:{target:{value:string}})=>changeSheet({directiveDate:e.target.value})}/></label>
      <label><span>Tanggal dibuat surat</span><input type="date" value={form.sheet.letterDate} onChange={(e:{target:{value:string}})=>changeSheet({letterDate:e.target.value})}/></label>
      <label className="is-wide"><span>Perihal</span><input maxLength={250} value={form.sheet.subject} onChange={(e:{target:{value:string}})=>changeSheet({subject:e.target.value})} placeholder="Perihal surat"/></label>
     </fieldset>
     <div className="sdl-arahan__receiver-head"><span>Disposisi Kabagrenmin <b>{form.sheet.dispositions.length}</b></span><span className="sdl-arahan__small">Pilihan dikelola di Master Data</span></div>
     <ChipPicker ariaLabel="Disposisi Kabagrenmin" cap="PILIHAN DISPOSISI" placeholder={form.sheet.dispositions.length?'Tambah disposisi…':'Ketik atau pilih disposisi…'} empty={dispositionOptions.length===0?'Belum ada pilihan disposisi di Master Data.':'Semua pilihan sudah dipilih.'}
      options={dispositionOptions.map(o=>({key:o.code,label:o.name,detail:o.code,blocked:''}))}
      picked={form.sheet.dispositions} labelOf={code=>dispositionName[code]||code} disabled={!draftReady||busy} onToggle={toggleDisposition}/>
     <div className="sdl-arahan__sheet-note"><label htmlFor="sdl-directive-dispo-note">Disposisi lainnya <i>(di luar daftar)</i></label><textarea id="sdl-directive-dispo-note" maxLength={1000} rows={3} value={form.sheet.dispositionNote} onChange={(e:{target:{value:string}})=>changeSheet({dispositionNote:e.target.value})} disabled={!draftReady||busy} placeholder="Tulis disposisi yang tidak ada di daftar…"/></div>
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
     <div className="sdl-arahan__setting-block"><span className="sdl-arahan__setting-label">Klasifikasi</span><div className="sdl-arahan__priority-switch" role="group" aria-label="Klasifikasi arahan">{[['biasa','Biasa'],['penting','Rahasia']].map(([val,label])=><button type="button" key={val} disabled={!draftReady||busy||(val==='biasa'&&letterLocksClass)} title={val==='biasa'&&letterLocksClass?'Surat terkait berklasifikasi Rahasia.':undefined} className={form.sheet.classification===val?`active ${val}`:''} aria-pressed={form.sheet.classification===val} onClick={()=>changeSheet({classification:val})}>{label}</button>)}</div></div>
     <div className="sdl-arahan__setting-block"><span className="sdl-arahan__setting-label">Derajat</span><div className="sdl-arahan__priority-switch" role="group" aria-label="Derajat arahan">{[['biasa','Biasa'],['kilat','Kilat']].map(([val,label])=><button type="button" key={val} disabled={!draftReady||busy} className={form.sheet.derajat===val?`active ${val}`:''} aria-pressed={form.sheet.derajat===val} onClick={()=>changeSheet({derajat:val})}>{label}</button>)}</div></div>
     <label className="sdl-arahan__setting-block"><span className="sdl-arahan__setting-label">Jenis arahan</span><select value={form.kind} onChange={(e:{target:{value:string}})=>changeForm({kind:e.target.value})} disabled={!draftReady||busy}>{Object.entries(displayKind).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
     <label className="sdl-arahan__setting-block"><span className="sdl-arahan__setting-label">Tenggat <i>(opsional)</i></span><input type="datetime-local" value={form.dueAt} onChange={(e:{target:{value:string}})=>changeForm({dueAt:e.target.value})} disabled={!draftReady||busy}/></label>
     <div className="sdl-arahan__send-summary"><span>Ringkasan pengiriman</span><strong>{form.sections.length} tujuan · {recipientCount} orang</strong><small>{form.sections.length>0?form.sections.map(k=>sectionLabel[k]||k).join(' · '):'Belum ada tujuan yang dipilih.'}</small><small>{form.incomingId?'Surat terkait ikut diserahkan. ':''}Setelah dikirim, isi arahan tidak dapat diubah.</small></div>
     <button className="sdl-arahan__primary sdl-arahan__send" type="submit" disabled={busy||uploadBusy||!draftReady||form.sections.length===0||!form.title.trim()||!form.body.trim()||draftStatus==='conflict'}>{busy?'Mengirim…':`Kirim Arahan →`}</button>
     <div className="sdl-arahan__draft-actions">{draftStatus==='conflict'?<button type="button" disabled={busy} onClick={()=>{void loadDraft()}}>Muat draft terbaru (ganti perubahan lokal)</button>:<button type="button" disabled={busy||!draftReady} onClick={()=>{void flushDraft()}}>Simpan sekarang</button>}<button type="button" disabled={busy||!draftReady||!hasContent} onClick={()=>setDeleteConfirm(true)}>Hapus draft</button></div>
    </aside>
   </form>
  </section>:<div className="sdl-arahan__list"><div className="sdl-arahan__list-head"><div><h2>Daftar Arahan</h2><p>Arahan masuk, terkirim, dan konfirmasi penerimaan dalam satu tempat.</p></div>{!loading&&items.length>0&&<span className="sdl-arahan__list-count">{outstanding} belum dikonfirmasi</span>}</div>{loading?<div className="sdl-arahan__empty">Memuat arahan…</div>:items.length===0?<div className="sdl-arahan__empty">Belum ada arahan.</div>:pagedItems.map(item=>{const status=statusInfo(item);return <button type="button" className={`sdl-arahan__item ${item.priority} ${status.kind}`} key={item.id} onClick={()=>void open(item)}><span className="sdl-arahan__item-icon">{item.direction==='sent'?'↗':'↙'}</span><span className="sdl-arahan__itembody"><span className="sdl-arahan__itemtop"><strong>{item.title}</strong><span className={`sdl-arahan__priority ${item.priority}`}>{item.priority.toUpperCase()}</span><span className={`sdl-arahan__status-badge ${status.kind}`}>{status.text}</span></span><small>{item.direction==='received'?`Dari ${item.issuerName}`:`Kepada ${item.total} staf`} · Dikirim {fmt(item.createdAt)}</small>{item.direction==='received'&&item.myAcknowledgedAt&&<small className="sdl-arahan__received-at">✓ Diterima {fmt(item.myAcknowledgedAt)}</small>}</span><span className="sdl-arahan__arrow">→</span></button>})}</div>}<Pager pager={pager} label="arahan"/>
  {deleteConfirm&&<div className="sdl-arahan__overlay" role="presentation"><section className="sdl-arahan__confirm-dialog" role="dialog" aria-modal="true" aria-label="Hapus draft"><h3>Hapus draft arahan?</h3><p>Isi arahan yang belum dikirim akan dikosongkan dari draft akun Anda.</p><div><button type="button" onClick={()=>setDeleteConfirm(false)}>Batal</button><button type="button" className="sdl-arahan__danger" onClick={()=>{void clearDraft()}}>Ya, hapus draft</button></div></section></div>}
  {detail&&<div className="sdl-arahan__overlay" onMouseDown={(e:{target:EventTarget;currentTarget:EventTarget})=>{if(e.target===e.currentTarget)setDetail(null)}}><article className="sdl-arahan__dialog" role="dialog" aria-modal="true" aria-label="Detail arahan"><header><div><span className={`sdl-arahan__priority ${detail.priority}`}>{detail.priority.toUpperCase()}</span><h2>{detail.title}</h2></div><button type="button" onClick={()=>setDetail(null)} aria-label="Tutup">×</button></header><div className="sdl-arahan__detail-meta"><div className="sdl-arahan__meta-block"><span>Dikirim oleh</span><strong>{detail.issuerName}</strong><small>{fmt(detail.createdAt)}</small></div><div className="sdl-arahan__meta-block"><span>Ditujukan kepada</span><strong>{detailDirection==='sent'?(detailSections.length?detailSections.join(' · '):detail.recipients?.length===1?detail.recipients[0].name:`${detail.total} staf BagRenmin`):'Akun Anda'}</strong>{detailDirection==='sent'&&detail.recipients&&detail.recipients.length>1&&<small>{detail.recipients.map(r=>r.name).join(' · ')}</small>}</div></div>{detail.sheet&&<dl className="sdl-arahan__sheet-detail" aria-label="Lembar disposisi">
    <div><dt>No. Agenda</dt><dd>{detail.agendaSurat??detail.sheet.agendaNo??'Belum terisi'}</dd></div>
    <div><dt>Surat dari</dt><dd>{detail.sheet.letterFrom||'—'}</dd></div>
    <div><dt>Nomor surat</dt><dd>{detail.sheet.letterNumber||'—'}</dd></div>
    <div><dt>Tanggal</dt><dd>{fmtDate(detail.sheet.directiveDate)}</dd></div>
    <div><dt>Tanggal dibuat surat</dt><dd>{fmtDate(detail.sheet.letterDate)}</dd></div>
    <div><dt>Klasifikasi · Derajat</dt><dd>{displayClass[detail.sheet.classification]||detail.sheet.classification} · {detail.sheet.derajat==='kilat'?'Kilat':'Biasa'}</dd></div>
    <div className="is-wide"><dt>Perihal</dt><dd>{detail.sheet.subject||'—'}</dd></div>
    <div className="is-wide"><dt>Disposisi Kabagrenmin</dt><dd>{detail.sheet.dispositions.length?detail.sheet.dispositions.map(c=>dispositionName[c]||c).join(' · '):'—'}{detail.sheet.dispositionNote&&<span className="sdl-arahan__sheet-note-text">{detail.sheet.dispositionNote}</span>}</dd></div>
   </dl>}<p className="sdl-arahan__body">{detail.body}</p><div className="sdl-arahan__facts"><span>Jenis: {displayKind[detail.kind]||detail.kind}</span>{detail.dueAt&&<span>Tenggat: {fmt(detail.dueAt)}</span>}</div>
   {detailFiles.length>0&&<div className="sdl-arahan__attachments-detail"><h3>Lampiran · {detailFiles.length}</h3><div className="sdl-arahan__file-pills">{detailFiles.map(file=><button type="button" key={file.id} className="sdl-arahan__file-pill" title={`${file.name} · ${sizeFmt(file.size)}`} onClick={()=>void showFile(file)} disabled={busy}><span className="sdl-arahan__file-mini-icon" aria-hidden="true">{file.mime==='application/pdf'?'PDF':'IMG'}</span><span className="sdl-arahan__file-pill-label"><strong>{file.name}</strong><small>{sizeFmt(file.size)}</small></span><span className="sdl-arahan__file-pill-arrow" aria-hidden="true">↗</span></button>)}</div></div>}
   {detailDirection==='sent'?<div><h3>Konfirmasi Penerima · {detail.acknowledged}/{detail.total}</h3><DeliverySteps total={detail.total} read={detail.read} accepted={detail.acknowledged}/><div className="sdl-arahan__recipientrows">{detail.recipients?.map(p=><div key={p.id}><span><strong>{p.name}</strong><small>{p.section?`${sectionLabel[p.section]||p.section} · ${p.unit.toUpperCase()}`:p.unit.toUpperCase()}</small></span><span className="sdl-arahan__recipient-state"><span className="sdl-arahan__recipient-mini-steps" aria-label={`Status ${p.name}: ${p.acknowledgedAt?'Diterima':p.readAt?'Dibaca':'Dikirim'}`}><i className="sent active" title="Terkirim"/><i className={`read ${p.readAt||p.acknowledgedAt?'active':''}`} title="Dibaca"/><i className={`accepted ${p.acknowledgedAt?'active':''}`} title="Diterima"/></span><span className={`sdl-arahan__status-badge ${p.acknowledgedAt?'accepted':p.readAt?'read':'sent'}`}>{p.acknowledgedAt?'Diterima':p.readAt?'Dibaca':'Dikirim'}</span><small>Dikirim {fmt(detail.createdAt)}</small>{p.readAt&&<small>Dibaca {fmt(p.readAt)}</small>}{p.acknowledgedAt&&<small>Diterima {fmt(p.acknowledgedAt)}</small>}</span></div>)}</div></div>:<div className="sdl-arahan__confirm"><DeliverySteps total={1} read={detail.myReadAt||detail.myAcknowledgedAt?1:0} accepted={detail.myAcknowledgedAt?1:0}/>{detail.myAcknowledgedAt?<p className="sdl-arahan__status-badge accepted">✓ Diterima {fmt(detail.myAcknowledgedAt)}</p>:<><p>{detail.myReadAt?'Dibaca '+fmt(detail.myReadAt):'Belum dibaca'}. Tekan tombol untuk konfirmasi penerimaan.</p><button type="button" className="sdl-arahan__primary" disabled={busy} onClick={()=>void confirm()}>{busy?'Memproses…':'✓ Terima Arahan'}</button></>}</div>}</article></div>}
  {preview&&<div className="sdl-arahan__overlay" onMouseDown={(e:{target:EventTarget;currentTarget:EventTarget})=>{if(e.target===e.currentTarget)setPreview(null)}}><div className="sdl-arahan__image-dialog" role="dialog" aria-modal="true" aria-label={`Foto ${preview.name}`}><header><strong>{preview.name}</strong><div className="sdl-arahan__preview-actions"><a href={preview.url} download={preview.name}>Unduh</a><button type="button" onClick={()=>setPreview(null)}>Tutup</button></div></header>{preview.mime==='application/pdf'?<iframe src={preview.url} title={`Pratinjau ${preview.name}`} className="sdl-arahan__pdf-frame"/>:<img src={preview.url} alt={preview.name}/>}</div></div>}
 </div>
}
