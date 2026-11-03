import { useCallback, useEffect, useRef, useState, type FormEvent, type ChangeEvent, type DragEvent } from 'react'
import { confirmDialog, showToast } from './UIFeedback'
import './UnitWorkR5F4.css'

type Unit = 'urmin' | 'subbagren' | 'subbagsumda' | 'subbagbinfung'
type RecordItem = { id:string;unit:string;category:string;title:string;description:string;classification:'biasa'|'penting';owner:string;version:number;createdAt:string }
type FileItem = { id:string;name:string;mediaType:string;size:number;createdAt:string }
type TaskItem = { id:string;from:string;to:string;toName:string;instruction:string;dueDate:string|null;status:string;response:string;createdAt:string }
type EventItem = { action:string;note:string;user:string;at:string }
type Details = { record:RecordItem;files:FileItem[];tasks:TaskItem[];events:EventItem[] }
type Person = { id:string;name:string }
type Preview = { name:string;type:string;url:string }
type FormDataItem = { category:string;title:string;description:string;classification:'biasa'|'penting' }
type LoadState = 'loading' | 'ready' | 'error'
const blank: FormDataItem = { category:'Administrasi',title:'',description:'',classification:'biasa' }
const MAX_SIZE=5*1024*1024
const MAX_FILES=10
const units:Record<Unit,string>={urmin:'Urmin',subbagren:'Subbagren',subbagsumda:'Subbagsumda',subbagbinfung:'Subbagbinfung'}
const taskNames:Record<string,string>={pending:'Menunggu',received:'Dikerjakan',completed:'Selesai',cancelled:'Dibatalkan'}
const eventNames:Record<string,string>={created:'Berkas Dibuat',updated:'Berkas Diperbarui',deleted:'Berkas Diarsipkan',uploaded:'Lampiran Diunggah',file_removed:'Lampiran Dihapus',assigned:'Disposisi Dikirim',received:'Tugas Diterima',completed:'Tugas Diselesaikan',cancelled:'Disposisi Dibatalkan'}
function failText(e:unknown){return e instanceof Error?e.message:'Permintaan belum berhasil. Silakan coba lagi.'}
function dateLabel(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'Asia/Jakarta'})}
function deadline(value:string|null){if(!value)return 'Tanpa tenggat';if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const d=new Date(value+'T00:00:00Z');return Number.isNaN(d.getTime())?value:d.toLocaleDateString('id-ID',{day:'2-digit',month:'long',year:'numeric',timeZone:'UTC'})}
function readableError(code:string,status:number){
 if(status===401)return 'Sesi berakhir. Silakan masuk kembali.'
 if(status===403||status===404)return 'Data tidak tersedia atau Anda tidak memiliki akses.'
 const errors:Record<string,string>={invalid_input:'Periksa kembali data yang diisi.',invalid_record:'Kategori dan judul belum sesuai ketentuan.',file_required_or_too_large:'Lampiran tidak terbaca atau melebihi 5 MiB.',file_limit_5mib:'Ukuran lampiran maksimal 5 MiB.',unsupported_file_type:'Hanya PDF, JPG, JPEG atau PNG yang didukung.',max_10_files:'Maksimal 10 lampiran aktif per berkas.',recipient_not_allowed:'Penerima belum memenuhi syarat akses unit.',active_disposition:'Masih ada disposisi aktif. Selesaikan atau batalkan sebelum mengarsipkan.',stale_version:'Berkas telah berubah. Muat ulang sebelum mengedit.',invalid_task_transition:'Status tugas telah berubah. Muat ulang detail dan coba lagi.',response_required:'Hasil tindak lanjut minimal 3 karakter.',invalid_assignment:'Penerima dan arahan disposisi harus valid.',invalid_date:'Tanggal tenggat belum valid.',already_removed:'Berkas sudah diarsipkan.',integrity_mismatch:'Integritas lampiran tidak dapat diverifikasi.'}
 return errors[code]||`Permintaan belum berhasil (${status}). Silakan coba lagi.`
}
async function request<T>(url:string,method:'GET'|'POST'|'PATCH'|'DELETE'='GET',body?:unknown,upload=false):Promise<T>{
 const headers:Record<string,string>={}
 if(method!=='GET'){
  const response=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
  if(!response.ok)throw Error('Sesi tidak tersedia. Silakan masuk kembali.')
  const {csrfToken}=await response.json() as {csrfToken:string}
  if(!csrfToken)throw Error('Sesi tidak tersedia. Silakan masuk kembali.')
  headers['X-CSRF-Token']=csrfToken
  if(!upload)headers['Content-Type']='application/json'
 }
 const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers,...(body===undefined?{}:{body:upload?body as FormData:JSON.stringify(body)})})
 if(!response.ok){const data=await response.json().catch(()=>({})) as {error?:string};throw Error(readableError(data.error||'server_error',response.status))}
 return await response.json() as T
}
function checkFile(file:File):string|null{
 if(file.size===0)return `${file.name}: berkas kosong.`
 if(file.size>MAX_SIZE)return `${file.name}: maksimal 5 MiB.`
 if(!/\.(pdf|png|jpe?g)$/i.test(file.name))return `${file.name}: format harus PDF, JPG atau PNG.`
 return null
}

export default function UnitWorkR5A({unit,userID,initialRecordID,demoAdmin=false}:{unit:Unit;userID:string;initialRecordID?:string;demoAdmin?:boolean}){
 const base=`/api/v1/unit-work/${unit}`
 const [records,setRecords]=useState<RecordItem[]>([])
 const [limited,setLimited]=useState(false)
 const [listState,setListState]=useState<LoadState>('loading')
 const [query,setQuery]=useState('')
 const [submittedQuery,setSubmittedQuery]=useState('')
 const [classFilter,setClassFilter]=useState('semua')
 const [current,setCurrent]=useState<Details|null>(null)
 const [selectedID,setSelectedID]=useState('')
 const [detailState,setDetailState]=useState<'idle'|LoadState>('idle')
 const [people,setPeople]=useState<Person[]>([])
 const [editor,setEditor]=useState(false)
 const [form,setForm]=useState<FormDataItem>(blank)
 const [busy,setBusy]=useState(false)
 const [uploadProgress,setUploadProgress]=useState('')
 const [dragging,setDragging]=useState(false)
 const [recipient,setRecipient]=useState('')
 const [instruction,setInstruction]=useState('')
 const [dueDate,setDueDate]=useState('')
 const [replies,setReplies]=useState<Record<string,string>>({})
 const [preview,setPreview]=useState<Preview|null>(null)
 const [previewBusy,setPreviewBusy]=useState(false)
 const [detailTab,setDetailTab]=useState<'files'|'tasks'|'history'>('files')
 const previewRef=useRef<Preview|null>(null)
 const listSeq=useRef(0)
 const detailSeq=useRef(0)
 const previewSeq=useRef(0)
 const selectedRef=useRef('')
 const mounted=useRef(false)
 const handledDeepLink=useRef<string|undefined>(undefined)
 const fileInput=useRef<HTMLInputElement|null>(null)

 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;listSeq.current++;detailSeq.current++;previewSeq.current++;if(previewRef.current)URL.revokeObjectURL(previewRef.current.url)}},[])
 const closePreview=useCallback(()=>{++previewSeq.current;if(previewRef.current)URL.revokeObjectURL(previewRef.current.url);previewRef.current=null;setPreview(null);setPreviewBusy(false)},[])
 const refreshRecords=useCallback(async(searchTerm:string)=>{
  const seq=++listSeq.current;setListState('loading')
  try{
   const data=await request<{items:RecordItem[];limited?:boolean}>(`${base}/records?q=${encodeURIComponent(searchTerm)}`)
   if(!mounted.current||seq!==listSeq.current)return
   setRecords(data.items??[]);setLimited(Boolean(data.limited));setListState('ready')
  }catch(error){if(!mounted.current||seq!==listSeq.current)return;setListState('error');showToast(failText(error),'error')}
 },[base])
 const refreshDetail=useCallback(async(id:string)=>{
  selectedRef.current=id;setSelectedID(id);const seq=++detailSeq.current
  setDetailState('loading');setCurrent(null);setReplies({});closePreview()
  try{
   const data=await request<Details>(`${base}/records/${encodeURIComponent(id)}`)
   if(!mounted.current||seq!==detailSeq.current||selectedRef.current!==id)return
   setCurrent(data);setDetailState('ready')
  }catch(error){if(!mounted.current||seq!==detailSeq.current)return;setDetailState('error');showToast(failText(error),'error')}
 },[base,closePreview])
 const reloadDetail=useCallback(async(id:string)=>{
  if(!id||selectedRef.current!==id)return
  const seq=++detailSeq.current
  try{
   const data=await request<Details>(`${base}/records/${encodeURIComponent(id)}`)
   if(!mounted.current||seq!==detailSeq.current||selectedRef.current!==id)return
   setCurrent(data);setDetailState('ready')
  }catch(error){if(!mounted.current||seq!==detailSeq.current)return;showToast(failText(error),'error')}
 },[base])
 useEffect(()=>{
  setRecords([]);setCurrent(null);setSelectedID('');selectedRef.current='';++detailSeq.current;setDetailState('idle');setListState('loading');setClassFilter('semua');setQuery('');setSubmittedQuery('');setPeople([]);setEditor(false);closePreview()
  let active=true
  void refreshRecords('')
  void request<{items:Person[]}>(`${base}/people`).then(data=>{if(active&&mounted.current)setPeople(data.items??[])}).catch(()=>{/* Recipient listing can be denied for read-only accounts. */})
  return()=>{active=false}
 },[base,refreshRecords,closePreview])
 useEffect(()=>{
  if(!initialRecordID||handledDeepLink.current===initialRecordID)return
  handledDeepLink.current=initialRecordID
  setEditor(false);void refreshDetail(initialRecordID)
 },[initialRecordID,refreshDetail])
 function closeDetail(){++detailSeq.current;selectedRef.current='';setSelectedID('');setCurrent(null);setDetailState('idle');closePreview()}
 function showNew(){closeDetail();setForm({...blank});setEditor(true)}
 function editRecord(){if(!current)return;setForm({category:current.record.category,title:current.record.title,description:current.record.description,classification:current.record.classification});setEditor(true)}
 async function commit(fn:()=>Promise<void>,success:string){if(busy)return;setBusy(true);try{await fn();showToast(success,'success')}catch(error){showToast(failText(error),'error')}finally{if(mounted.current)setBusy(false)}}
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!form.title.trim()||!form.category.trim())return
  const active=current;await commit(async()=>{
   let id=active?.record.id||''
   if(active){await request(`${base}/records/${encodeURIComponent(id)}`,'PATCH',{...form,version:active.record.version})}
   else{const result=await request<{id:string}>(`${base}/records`,'POST',form);id=result.id}
   setEditor(false);await refreshRecords(submittedQuery);await refreshDetail(id)
  },active?'Berkas diperbarui.':'Berkas ditambahkan.')
 }
 async function archive(){if(!current||busy)return;const id=current.record.id
  if(!await confirmDialog('Arsipkan berkas ini? Berkas tidak lagi muncul di daftar aktif.',{confirmLabel:'Arsipkan',danger:true}))return
  await commit(async()=>{await request(`${base}/records/${encodeURIComponent(id)}`,'DELETE',{});closeDetail();await refreshRecords(submittedQuery)},'Berkas diarsipkan.')
 }
 async function uploadFiles(selected:FileList|File[]){if(!current||busy)return
  const id=current.record.id;const files=Array.from(selected)
  if(!files.length)return
  const invalid=files.map(checkFile).find(Boolean)
  if(invalid){showToast(invalid,'error');return}
  if(current.files.length+files.length>MAX_FILES){showToast(`Hanya tersedia ${MAX_FILES-current.files.length} slot lampiran pada berkas ini.`,'error');return}
  setBusy(true);let done=0;let failure=''
  try{
   for(const file of files){
    setUploadProgress(`Mengunggah ${done+1} dari ${files.length}…`)
    try{const body=new FormData();body.append('file',file);await request(`${base}/records/${encodeURIComponent(id)}/files`,'POST',body,true);done++}
    catch(error){failure=failText(error);break}
   }
   await reloadDetail(id)
   if(done)showToast(`${done} lampiran berhasil diunggah.`,'success')
   if(failure)showToast(`${failure} ${done?`${files.length-done} lampiran belum selesai.`:''}`,'error')
  }finally{if(mounted.current){setBusy(false);setUploadProgress('');setDragging(false)} }
 }
 async function deleteFile(fileID:string){if(!current||busy)return
  const id=current.record.id
  if(!await confirmDialog('Hapus lampiran dari berkas ini?',{confirmLabel:'Hapus',danger:true}))return
  await commit(async()=>{await request(`${base}/records/${encodeURIComponent(id)}/files/${encodeURIComponent(fileID)}`,'DELETE',{});await reloadDetail(id)},'Lampiran dihapus.')
 }
 async function fileBlob(file:FileItem,recordID:string):Promise<Blob>{
  const response=await fetch(`${base}/records/${encodeURIComponent(recordID)}/files/${encodeURIComponent(file.id)}`,{credentials:'same-origin',cache:'no-store'})
  if(!response.ok){if(response.status===401)throw Error('Sesi berakhir. Silakan masuk kembali.');throw Error('Lampiran tidak tersedia atau Anda tidak memiliki akses.')}
  if(!['application/pdf','image/jpeg','image/png'].includes(file.mediaType))throw Error('Format lampiran tidak didukung.')
  const array=await response.arrayBuffer()
  if(!array.byteLength||array.byteLength>MAX_SIZE)throw Error('Ukuran lampiran tidak valid.')
  return new Blob([array],{type:file.mediaType})
 }
 async function openPreview(file:FileItem){if(!current||previewBusy)return
  const id=current.record.id;const seq=++previewSeq.current
  if(previewRef.current)URL.revokeObjectURL(previewRef.current.url)
  previewRef.current=null;setPreview(null);setPreviewBusy(true)
  try{
   const blob=await fileBlob(file,id)
   if(!mounted.current||seq!==previewSeq.current||selectedRef.current!==id)return
   const next={name:file.name,type:file.mediaType,url:URL.createObjectURL(blob)}
   previewRef.current=next;setPreview(next)
  }catch(error){if(mounted.current&&seq===previewSeq.current)showToast(failText(error),'error')}
  finally{if(mounted.current&&seq===previewSeq.current)setPreviewBusy(false)}
 }
 async function download(file:FileItem){if(!current)return;try{
  const blob=await fileBlob(file,current.record.id);const url=URL.createObjectURL(blob)
  const a=document.createElement('a');a.href=url;a.download=file.name;a.rel='noopener';document.body.append(a);a.click();a.remove()
  window.setTimeout(()=>URL.revokeObjectURL(url),30_000)
 }catch(error){showToast(failText(error),'error')}}
 async function assign(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!current||busy||!recipient||instruction.trim().length<5)return
  const id=current.record.id
  const target=people.find(p=>p.id===recipient)
  if(!await confirmDialog(`Kirim disposisi kepada ${target?.name||'penerima terpilih'}?`,{confirmLabel:'Kirim Disposisi'}))return
  await commit(async()=>{
   await request(`${base}/records/${encodeURIComponent(id)}/tasks`,'POST',{to:recipient,instruction:instruction.trim(),dueDate})
   setRecipient('');setInstruction('');setDueDate('');await reloadDetail(id)
  },'Disposisi dikirim.')
 }
 async function taskAction(task:TaskItem,action:'receive'|'complete'|'cancel'){
  if(!current||busy)return
  const id=current.record.id;const response=action==='complete'?(replies[task.id]||'').trim():''
  if(action==='complete'&&response.length<3){showToast('Hasil tindak lanjut minimal 3 karakter.','error');return}
  const labels={receive:'Terima tugas ini?',complete:'Selesaikan tugas ini?',cancel:'Batalkan disposisi ini?'}
  if(!await confirmDialog(labels[action],{confirmLabel:action==='receive'?'Terima':action==='complete'?'Selesaikan':'Batalkan',...(action==='cancel'?{danger:true}:{})}))return
  await commit(async()=>{
   await request(`${base}/records/${encodeURIComponent(id)}/tasks/${encodeURIComponent(task.id)}/${action}`,'POST',{response})
   setReplies(prev=>{const next={...prev};delete next[task.id];return next})
   await reloadDetail(id)
  },action==='receive'?'Tugas diterima.':action==='complete'?'Tugas diselesaikan.':'Disposisi dibatalkan.')
 }
 const visibleRecords=records.filter(item=>classFilter==='semua'||item.classification===classFilter)
 const activeTasks=current?.tasks.filter(t=>['pending','received'].includes(t.status)).length||0
 const isPreviewImage=preview?.type.startsWith('image/')
 useEffect(()=>{
  if(!editor&&!preview&&!previewBusy)return
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!busy){if(preview||previewBusy)closePreview();else setEditor(false)}}
  window.addEventListener('keydown',onKey)
  return()=>window.removeEventListener('keydown',onKey)
 },[editor,preview,previewBusy,busy,closePreview])
 return <div className="unitwork-r5a sdl-unit-berkas sdl-work-r5f4">
  <section className="sdl-work-r5f4__summary" aria-label="Ringkasan berkas">
   <div><small>Berkas Ditampilkan</small><strong>{records.length}</strong><span>Sesuai hak akses</span></div>
   <div><small>Berkas Penting</small><strong>{records.filter(p=>p.classification==='penting').length}</strong><span>Dalam hasil daftar</span></div>
   <div><small>Disposisi Aktif</small><strong>{current?activeTasks:'—'}</strong><span>{current?'Pada berkas terpilih':'Pilih berkas dahulu'}</span></div>
  </section>
  <section className="panel sdl-work-register">
   <header className="sdl-work-register__header"><div><h2>Daftar Berkas</h2><p>Kelola dokumen dan penugasan internal {units[unit]}.</p></div><button type="button" className="btn primary" onClick={showNew} disabled={busy}>+ Tambah Berkas</button></header>
   <form className="sdl-work-r5f4__filters" onSubmit={(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();setSubmittedQuery(query);void refreshRecords(query)}}>
    <label className="sdl-work-r5f4__search"><span className="sdl-sr-only">Cari berkas</span><input aria-label="Cari berkas" value={query} maxLength={120} onChange={(e:ChangeEvent<HTMLInputElement>)=>setQuery(e.target.value)} placeholder="Cari judul atau kategori…" /></label>
    <label><span className="sdl-sr-only">Klasifikasi</span><select aria-label="Filter klasifikasi" value={classFilter} onChange={(e:ChangeEvent<HTMLSelectElement>)=>setClassFilter(e.target.value)}><option value="semua">Semua Klasifikasi</option><option value="biasa">Biasa</option><option value="penting">Penting</option></select></label>
    <button className="btn" type="submit" disabled={listState==='loading'}>Cari</button>
    <button className="btn" type="button" disabled={listState==='loading'} onClick={()=>{setQuery('');setSubmittedQuery('');setClassFilter('semua');void refreshRecords('')}}>Reset</button>
    <button className="btn" type="button" disabled={listState==='loading'} onClick={()=>void refreshRecords(submittedQuery)}>Muat Ulang</button>
   </form>
   {limited&&<p className="sdl-work-r5f4__limit">Daftar dibatasi pada 200 berkas terbaru yang dapat diakses dari hasil pencarian. Gunakan pencarian untuk mempersempit data.</p>}
   {listState==='loading'?<div className="sdl-work-empty" role="status">Memuat berkas…</div>:listState==='error'?<div className="sdl-work-empty"><strong>Daftar belum dapat dimuat.</strong><button className="btn" type="button" onClick={()=>void refreshRecords(submittedQuery)}>Coba Lagi</button></div>:visibleRecords.length===0?<div className="sdl-work-empty"><strong>Belum ada berkas yang sesuai</strong><p>Periksa pencarian atau tambahkan berkas baru.</p><button type="button" className="btn" onClick={showNew}>Tambah Berkas</button></div>:<div className="sdl-work-records">{visibleRecords.map(item=><button type="button" key={item.id} className={`sdl-work-record ${selectedID===item.id?'is-selected':''}`} aria-pressed={selectedID===item.id} disabled={busy} onClick={()=>{setEditor(false);void refreshDetail(item.id)}}><span className="sdl-work-record__icon" aria-hidden="true">▤</span><span className="sdl-work-record__copy"><strong>{item.title}</strong><small>{item.category} · {dateLabel(item.createdAt)}</small></span><span className={`sdl-work-r5f4__classification ${item.classification==='penting'?'is-important':''}`}>{item.classification==='penting'?'Penting':'Biasa'}</span><span className="sdl-work-record__arrow" aria-hidden="true">→</span></button>)}</div>}
  </section>
  {editor&&<div className="sdl-work-modal-backdrop" role="presentation" onMouseDown={(e:{target:EventTarget;currentTarget:EventTarget})=>{if(e.target===e.currentTarget&&!busy)setEditor(false)}}>
   <section className="sdl-work-modal" role="dialog" aria-modal="true" aria-labelledby="sdl-work-modal-title">
    <div className="sdl-work-modal__heading"><div><span className="sdl-work-kicker">BERKAS UNIT</span><h2 id="sdl-work-modal-title">{current?'Edit Berkas':'Tambah Berkas'}</h2><p>Lengkapi informasi berkas.</p></div><button type="button" className="sdl-work-modal__close" aria-label="Tutup formulir" disabled={busy} onClick={()=>setEditor(false)}>×</button></div>
    <form onSubmit={(e:FormEvent<HTMLFormElement>)=>void save(e)}><div className="sdl-work-fields"><label>Kategori<input required minLength={2} maxLength={100} value={form.category} onChange={(e:ChangeEvent<HTMLInputElement>)=>setForm(prev=>({...prev,category:e.target.value}))}/></label><label>Judul Berkas<input required minLength={3} maxLength={240} value={form.title} onChange={(e:ChangeEvent<HTMLInputElement>)=>setForm(prev=>({...prev,title:e.target.value}))}/></label><label className="sdl-work-fields__wide">Uraian<textarea rows={4} maxLength={4000} value={form.description} onChange={(e:ChangeEvent<HTMLTextAreaElement>)=>setForm(prev=>({...prev,description:e.target.value}))}/></label><label>Klasifikasi<select value={form.classification} onChange={(e:ChangeEvent<HTMLSelectElement>)=>setForm(prev=>({...prev,classification:e.target.value as FormDataItem['classification']}))}><option value="biasa">Biasa</option><option value="penting">Penting</option></select></label></div><div className="sdl-work-modal__actions"><button className="btn" type="button" disabled={busy} onClick={()=>setEditor(false)}>Batal</button><button className="btn primary" type="submit" disabled={busy}>{busy?'Menyimpan…':'Simpan Berkas'}</button></div></form>
   </section>
  </div>}
  {selectedID&&!editor&&detailState==='loading'&&<section className="panel sdl-work-details" role="status">Memuat detail berkas…</section>}
  {selectedID&&!editor&&detailState==='error'&&<section className="panel sdl-work-details"><p>Detail belum dapat dimuat.</p><button className="btn" type="button" onClick={()=>void refreshDetail(selectedID)}>Coba Lagi</button><button className="btn" type="button" onClick={closeDetail}>Tutup</button></section>}
  {current&&!editor&&detailState==='ready'&&<section className="panel sdl-work-details">
   <header className="sdl-work-details__header"><div><span className="sdl-work-kicker">DETAIL BERKAS</span><h2>{current.record.title}</h2><p>{current.record.category} · {current.record.classification==='penting'?'Penting':'Biasa'} · {dateLabel(current.record.createdAt)}</p></div><div className="sdl-work-details__actions"><button type="button" className="btn" disabled={busy} onClick={()=>void reloadDetail(current.record.id)}>Muat Ulang</button><button type="button" className="btn" disabled={busy} onClick={editRecord}>Edit</button><button type="button" className="btn" disabled={busy} onClick={()=>void archive()}>Arsipkan</button><button type="button" className="btn" disabled={busy} onClick={closeDetail}>Tutup</button></div></header>
   {current.record.description&&<p className="sdl-work-description">{current.record.description}</p>}
   <nav className="sdl-r5f5-tabs sdl-r5f5-tabs--detail" aria-label="Bagian detail berkas">
    {([{id:'files',label:'Lampiran'},{id:'tasks',label:'Tugas Internal'},{id:'history',label:'Riwayat'}] as const).map(tab=><button type="button" key={tab.id} className={`sdl-r5f5-tab ${detailTab===tab.id?'is-active':''}`} aria-current={detailTab===tab.id?'page':undefined} onClick={()=>setDetailTab(tab.id)}>{tab.label}</button>)}
   </nav>
   {detailTab==='files'&&<div className="sdl-work-details__section"><div className="sdl-work-section-head"><h3>Foto & Dokumen ({current.files.length}/{MAX_FILES})</h3><span>PDF, JPG, PNG · Maksimal 5 MiB per lampiran</span></div>
    <div className={`sdl-work-r5f4__drop ${dragging?'is-dragging':''}`} onDragOver={(e:DragEvent<HTMLDivElement>)=>{e.preventDefault();if(!busy)setDragging(true)}} onDragLeave={(e:DragEvent<HTMLDivElement>)=>{if(e.target===e.currentTarget)setDragging(false)}} onDrop={(e:DragEvent<HTMLDivElement>)=>{e.preventDefault();setDragging(false);if(!busy)void uploadFiles(e.dataTransfer.files)}}>
     <div><strong>Tarik berkas ke sini</strong><small>atau pilih hingga {MAX_FILES-current.files.length} lampiran tambahan</small></div>
     <button className="btn" type="button" disabled={busy||current.files.length>=MAX_FILES} onClick={()=>fileInput.current?.click()}>Pilih Berkas</button>
     <input ref={fileInput} className="sdl-sr-only" type="file" multiple accept=".pdf,.jpg,.jpeg,.png" aria-label="Pilih lampiran PDF atau foto" disabled={busy} onChange={(e:ChangeEvent<HTMLInputElement>)=>{const files=e.target.files;if(files)void uploadFiles(files);e.target.value=''}}/>
    </div>
    {uploadProgress&&<p className="sdl-work-r5f4__progress" role="status">{uploadProgress}</p>}
    {current.files.length===0?<p className="sdl-work-muted">Belum ada lampiran pada berkas ini.</p>:<div className="sdl-work-files">{current.files.map(file=><article key={file.id} className="sdl-work-file sdl-work-r5f4__file"><div className="sdl-work-r5f4__file-icon" aria-hidden="true">{file.mediaType==='application/pdf'?'PDF':'FOTO'}</div><strong title={file.name}>{file.name}</strong><small>{(file.size/1024).toLocaleString('id-ID',{maximumFractionDigits:0})} KB · {dateLabel(file.createdAt)}</small><div className="sdl-work-r5f4__file-actions"><button className="btn" type="button" disabled={busy||previewBusy} onClick={()=>void openPreview(file)}>Preview</button><button className="btn" type="button" disabled={busy} onClick={()=>void download(file)}>Unduh</button><button className="btn" type="button" disabled={busy} onClick={()=>void deleteFile(file.id)}>Hapus</button></div></article>)}</div>}
   </div>}
   {detailTab==='tasks'&&<div className="sdl-work-details__section"><div className="sdl-work-section-head"><h3>Disposisi Internal ({current.tasks.length})</h3><span>{activeTasks} tugas aktif</span></div>
    <form className="sdl-work-task-form" onSubmit={(e:FormEvent<HTMLFormElement>)=>void assign(e)}><label>Penerima<select required value={recipient} onChange={(e:ChangeEvent<HTMLSelectElement>)=>setRecipient(e.target.value)}><option value="">Pilih petugas unit</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Tenggat (opsional)<input type="date" value={dueDate} onChange={(e:ChangeEvent<HTMLInputElement>)=>setDueDate(e.target.value)}/></label><label className="sdl-work-r5f4__task-instruction">Instruksi<textarea required minLength={5} maxLength={1000} rows={3} placeholder="Tuliskan arahan tindak lanjut" value={instruction} onChange={(e:ChangeEvent<HTMLTextAreaElement>)=>setInstruction(e.target.value)}/></label><div className="sdl-work-task-form__submit"><button className="btn primary" type="submit" disabled={busy||!recipient||instruction.trim().length<5}>Kirim Disposisi</button></div></form>
    {people.length===0&&<p className="sdl-work-muted">Tidak ada kandidat penerima yang tersedia untuk akun ini.</p>}
    {current.tasks.length===0?<p className="sdl-work-muted">Belum ada disposisi internal pada berkas ini.</p>:<div className="sdl-work-task-list">{current.tasks.map(task=><article key={task.id} className="sdl-work-task"><header><strong>{task.toName}</strong><span className={`sdl-work-r5f4__task-status status-${task.status}`}>{taskNames[task.status]||'Diperbarui'}</span></header><p className="sdl-work-r5f4__instruction">{task.instruction}</p><small>Dikirim {dateLabel(task.createdAt)} · {deadline(task.dueDate)}</small>{task.response&&<p><strong>Hasil:</strong> {task.response}</p>}<div className="sdl-work-task__actions">{(task.to===userID||demoAdmin)&&task.status==='pending'&&<button type="button" className="btn" disabled={busy} onClick={()=>void taskAction(task,'receive')}>Terima Tugas</button>}{(task.to===userID||demoAdmin)&&task.status==='received'&&<div className="sdl-work-task-reply"><label className="sdl-work-r5f4__reply-label">Hasil tindak lanjut<textarea maxLength={1000} rows={2} placeholder="Tuliskan hasil pengerjaan" value={replies[task.id]||''} onChange={(e:ChangeEvent<HTMLTextAreaElement>)=>setReplies(prev=>({...prev,[task.id]:e.target.value}))}/></label><button type="button" className="btn primary" disabled={busy||(replies[task.id]||'').trim().length<3} onClick={()=>void taskAction(task,'complete')}>Selesaikan</button></div>}{(task.from===userID||demoAdmin)&&['pending','received'].includes(task.status)&&<button type="button" className="btn" disabled={busy} onClick={()=>void taskAction(task,'cancel')}>Batalkan</button>}</div></article>)}</div>}
   </div>}
   {detailTab==='history'&&<div className="sdl-work-details__section"><div className="sdl-work-section-head"><h3>Riwayat Aktivitas</h3><span>{current.events.length} catatan terbaru</span></div>{current.events.length===0?<p className="sdl-work-muted">Belum ada aktivitas.</p>:<ol className="sdl-work-r5f4__events">{current.events.map((event,i)=><li key={`${i}-${event.at}-${event.action}`}><div><strong>{eventNames[event.action]||'Pembaruan Berkas'}</strong><small>{event.user} · {event.at} WIB</small></div>{event.note&&<p>{event.note}</p>}</li>)}</ol>}</div>}
  </section>}
  {(preview||previewBusy)&&<div className="sdl-work-r5f4__preview-backdrop" role="presentation" onMouseDown={(e:{target:EventTarget;currentTarget:EventTarget})=>{if(e.target===e.currentTarget)closePreview()}}><section className="sdl-work-r5f4__preview" role="dialog" aria-modal="true" aria-label="Preview lampiran"><header><strong>{preview?.name||'Membuka lampiran…'}</strong><button type="button" className="btn" onClick={closePreview}>Tutup</button></header>{previewBusy?<div role="status" className="sdl-work-r5f4__preview-wait">Memuat lampiran…</div>:isPreviewImage?<img src={preview?.url} alt={preview?.name||'Foto lampiran'}/>:preview?.type==='application/pdf'?<iframe title={`Preview ${preview.name}`} src={preview.url} sandbox="allow-same-origin"/>:null}<p>Jika dokumen tidak dapat ditampilkan, gunakan tombol Unduh pada daftar lampiran.</p></section></div>}
 </div>
}
