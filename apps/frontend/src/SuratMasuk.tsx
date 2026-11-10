import { FloatingToast } from './UIFeedback'
import { SuratR3B } from './SuratR3B'
import { LampiranPreviewR5F15 } from './LampiranPreviewR5F15'
import { LampiranFileCardR5F16 } from './LampiranFileCardR5F16'
import { DisposisiSuratR5H6 } from './DisposisiSuratR5H6'
import { useCallback, useEffect, useRef, useState, type FormEvent, type DragEvent } from 'react'
import './SuratMasukR5F6.css'
import './SuratMasukR5F7.css'
import './SuratMasukStatusR5H5.css'
import { Pager, usePaged } from './PaginationR5H5'

type Derajat = 'biasa'|'kilat'
type Item = {id:string;agendaNo:number;letterNumber:string;sender:string;letterDate:string;receivedDate:string;subject:string;classification:'biasa'|'penting';derajat:Derajat;status:'draft'|'registered';createdBy:string;version:number;createdAt:string;updatedAt:string}
type History = {action:string;fromStatus:string|null;toStatus:string;reason:string;version:number;actor:string;at:string}
type Draft = {letterNumber:string;sender:string;letterDate:string;receivedDate:string;subject:string;classification:'biasa'|'penting';derajat:Derajat;reason:string}
type FileSummary = {items:{id:string}[];canUpload:boolean;canDownload:boolean;canDistribute:boolean}
type Kind = 'undangan'|'permintaan'|'pemberitahuan'|'lainnya'
type IntakeExtra = {letterKind:Kind;responseDue:string;eventStart:string;eventEnd:string;eventLocation:string;eventAgenda:string;details:string;needsDisposition:boolean}
type IntakeRecord = IntakeExtra & {routeStatus:string;workflowStatus:string;submittedAt:string|null}
// R5H6: ringkasan intake kini masuk ke grid detail, bukan kotak terpisah
// di tengah halaman. Status sudah tampil di baris judul.
const kindLabels:Record<string,string>={undangan:'Undangan',permintaan:'Permintaan Data / Dokumen',pemberitahuan:'Pemberitahuan',lainnya:'Lainnya'}
const blankExtra:IntakeExtra={letterKind:'lainnya',responseDue:'',eventStart:'',eventEnd:'',eventLocation:'',eventAgenda:'',details:'',needsDisposition:false}
// read_kabag dan directive_issued (R5G2) duduk di antara awaiting_kabag dan
// dispatched: surat yang dijawab lewat Arahan Pimpinan tidak pernah melewati
// jalur distribusi, jadi tanpa keduanya ia akan tertinggal di "Menunggu".
const routeLabels:Record<string,string>={draft:'Draft',recorded:'Tercatat · Tanpa Disposisi',awaiting_kabag:'Menunggu Disposisi Kabagrenmin',read_kabag:'Dibaca Kabagrenmin',directive_issued:'Sudah Didisposisikan Kabagrenmin',dispatched:'Sudah Didistribusikan Kabagrenmin',in_progress:'Dalam Tindak Lanjut',awaiting_review:'Menunggu Review'}

/**
 * R5G5: lama sebuah surat berada pada keadaannya sekarang.
 *
 * Dihitung dari `submitted_at`, bukan tanggal surat — yang dicari petugas
 * adalah "sudah berapa lama saya menunggu jawaban", bukan umur suratnya.
 * Mengembalikan null kalau surat itu tidak punya baris intake sama sekali
 * (surat warisan R3B), sehingga tidak ada angka yang dikarang.
 */
function waitingDays(since?:string):number|null{
 if(!since) return null
 const t=new Date(since).getTime()
 if(Number.isNaN(t)) return null
 return Math.max(0,Math.floor((Date.now()-t)/86400000))
}
function waitingLabel(days:number):string{
 return days===0?'hari ini':days===1?'1 hari':`${days} hari`
}
// Dua hari dipilih sebagai batas "perlu diingatkan": cukup lama untuk bukan
// sekadar belum sempat dibuka, cukup pendek untuk masih berguna diingatkan.
const REMIND_AFTER_DAYS=2
// `surat` = naskah suratnya (paling banyak satu, field multipart terpisah),
// `files` = lampiran pendukung. Backend menandai keduanya lewat doc_kind.
async function submitIntake(payload:Record<string,unknown>,files:File[],surat:File[]=[]):Promise<{item:Item;routeStatus:string;filesSaved:number}>{
 const tokenResp=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
 if(!tokenResp.ok)throw Error('Sesi keamanan tidak tersedia.')
 const token:{csrfToken:string}=await tokenResp.json()
 const data=new FormData();data.set('payload',JSON.stringify(payload))
 surat.forEach(f=>data.append('surat',f))
 files.forEach(f=>data.append('files',f))
 const response=await fetch('/api/v1/urmin/surat-masuk/intake',{method:'POST',body:data,credentials:'same-origin',cache:'no-store',headers:{'X-CSRF-Token':token.csrfToken}})
 if(!response.ok){const e:{error?:string}=await response.json().catch(()=>({}));
  if(response.status===409&&e.error==='kabagrenmin_not_available_or_ambiguous')throw Error('Akun Kabagrenmin aktif yang sesuai belum tersedia atau lebih dari satu. Hubungi administrator.')
  if(response.status===409&&e.error==='kabagrenmin_not_eligible')throw Error('Kabagrenmin belum memiliki izin penerimaan surat untuk klasifikasi ini. Minta administrator memeriksa role dan klasifikasi.')
  if(response.status===403&&e.error==='attachment_permission_required')throw Error('Akun Anda belum memiliki izin unggah lampiran pada Surat Masuk. Hubungi administrator untuk memeriksa grant aktif.')
  if(response.status===403&&e.error==='access_denied')throw Error('Akun Anda belum memiliki izin membuat atau mengajukan Surat Masuk pada klasifikasi ini. Periksa kewenangan unit dan klasifikasi.')
  if(response.status===403)throw Error('Pengajuan ditolak oleh pengaturan hak akses. Periksa izin membuat surat dan unggah lampiran.')
  if(response.status===409)throw Error('Data surat atau penerima telah berubah. Muat ulang dan coba kembali.')
  if(response.status===413)throw Error('Total lampiran terlalu besar. Maksimal 10 file, masing-masing 10 MB.')
  if(response.status===400&&e.error==='invalid_file_type')throw Error('Lampiran ditolak. Pastikan file PDF/JPG/PNG asli, utuh, dan nama file hanya memakai huruf/angka/tanda umum.')
  if(response.status===400&&e.error==='invalid_intake')throw Error('Informasi surat belum sesuai. Periksa nomor, tanggal, perihal, jenis surat, deadline, dan alasan minimal 8 karakter.')
  if(response.status===400&&e.error==='draft_files_not_supported')throw Error('Lampiran baru tersimpan saat Ajukan Surat, bukan ketika Simpan Draft.')
  if(response.status===400)throw Error('Periksa data, tanggal penting, format file dan kelengkapan surat.')
  if(response.status===503)throw Error('Server belum berhasil menyimpan surat. Coba kembali dan laporkan waktu kejadian jika berulang.')
  throw Error('Gagal menyimpan surat. Silakan coba lagi.')
 }
 return response.json()
}
// Label tampilan saja. Nilai yang dikirim ke API tetap 'penting' — ia terikat
// CHECK constraint di enam tabel dan dipakai Engine A untuk mencocokkan
// classification_limit pada grant, jadi menggantinya bukan perubahan label.
function classificationLabel(value:'biasa'|'penting'){return value==='penting'?'Rahasia':'Biasa'}

// Derajat kecepatan penanganan — terpisah dari klasifikasi, dan sengaja TIDAK
// ikut menentukan hak akses. Nilainya sama di API dan di layar.
function derajatLabel(value:Derajat){return value==='kilat'?'Kilat':'Biasa'}
// Bentuknya mengikuti badge prioritas di Arahan (`.sdl-arahan__priority`):
// kotak kecil ber-huruf besar yang menempel di samping judul, bukan kolom
// tersendiri. Dibuat kelas terpisah, bukan memakai kelas Arahan, supaya
// perubahan desain di satu modul tidak diam-diam mengubah modul lain.
function DerajatTag({value}:{value:Derajat}){
  return <span className={`sm-derajat ${value}`} title={value==='kilat'?'Perlu penanganan segera':'Penanganan normal'}>{derajatLabel(value).toUpperCase()}</span>
}

// Alasan tetap wajib di server (sdl_urmin_incoming_history.reason NOT NULL,
// minimal 8 karakter) karena ia mengisi jejak audit yang tidak bisa diubah.
// Field-nya dihapus dari formulir, jadi nilainya diisi sistem.
const systemReason = 'Pencatatan surat masuk melalui formulir Urmin.'
const AUTO_RECEIVE_REASON='Diterima saat membuka detail'
const blank:Draft = {letterNumber:'',sender:'',letterDate:'',receivedDate:'',subject:'',classification:'biasa',derajat:'biasa',reason:systemReason}
const maxBytes = 10 * 1024 * 1024
const safeFilename = /^[a-zA-Z0-9 _().-]{1,160}$/
const allowedExt = /\.(pdf|jpe?g|png)$/i

async function api<T>(path:string,method:'GET'|'POST'|'PATCH'='GET',body?:unknown):Promise<T>{
 const headers:Record<string,string>={}
 if(method!=='GET'){
  const c=await fetch('/api/v1/auth/csrf',{cache:'no-store',credentials:'same-origin'})
  if(!c.ok)throw Error('Sesi keamanan tidak tersedia.')
  const token:{csrfToken:string}=await c.json()
  headers['Content-Type']='application/json';headers['X-CSRF-Token']=token.csrfToken
 }
 const r=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers,body:body===undefined?undefined:JSON.stringify(body)})
 if(!r.ok){const e:{error?:string}=await r.json().catch(()=>({}));if(r.status===403||r.status===404)throw Error('Tidak ada izin atau data tidak tersedia.');if(r.status===409)throw Error('Data berubah atau status sudah dikunci. Muat ulang.');if(r.status===401)throw Error('Sesi berakhir. Silakan login lagi.');throw Error(`Permintaan gagal (${r.status}: ${e.error||'unavailable'})`)}
 return r.json() as Promise<T>
}
async function postAttachment(id:string,file:File,reason:string){
 const csrfResp=await fetch('/api/v1/auth/csrf',{cache:'no-store',credentials:'same-origin'})
 if(!csrfResp.ok)throw Error('Sesi keamanan tidak tersedia.')
 const {csrfToken}:{csrfToken:string}=await csrfResp.json()
 const payload=new FormData();payload.set('file',file);payload.set('reason',reason)
 const resp=await fetch(`/api/v1/urmin/surat-masuk/${id}/attachments`,{method:'POST',body:payload,cache:'no-store',credentials:'same-origin',headers:{'X-CSRF-Token':csrfToken}})
 if(!resp.ok){const data:{error?:string}=await resp.json().catch(()=>({}));if(resp.status===413)throw Error('File melebihi 10 MB atau tidak dapat diterima.');if(resp.status===409)throw Error('Surat berubah atau batas lampiran sudah tercapai.');if(resp.status===401)throw Error('Sesi berakhir. Silakan login lagi.');if(resp.status===403||resp.status===404)throw Error('Akses unggah tidak diizinkan.');if(resp.status===400)throw Error('Format/nama file atau keterangan tidak valid.');throw Error(`Gagal mengunggah (${data.error||resp.status}).`)}
}
function formOf(i:Item):Draft{return {letterNumber:i.letterNumber,sender:i.sender,letterDate:i.letterDate,receivedDate:i.receivedDate,subject:i.subject,classification:i.classification,derajat:i.derajat??'biasa',reason:systemReason}}
// R5H5: format sama dengan daftar Surat Keluar ("05 Nov 2026"). Tanggal surat
// adalah tanggal kalender tanpa zona, jadi dibaca sebagai tengah hari UTC
// supaya tidak bergeser sehari di zona mana pun.
function readableDate(date:string){
 if(!date)return '—'
 const d=new Date(`${date.slice(0,10)}T12:00:00Z`)
 return Number.isNaN(d.getTime())?date.slice(0,10):d.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'})
}
function fileError(file:File):string|null{
 if(!safeFilename.test(file.name)||!allowedExt.test(file.name))return `Nama atau format file tidak didukung: ${file.name}. Gunakan nama sederhana dan PDF/JPG/PNG.`
 if(file.size===0||file.size>maxBytes)return `Ukuran ${file.name} harus lebih dari 0 dan maksimal 10 MB.`
 return null
}

/**
 * R5G5 (2.2a): memberi tahu pengaju apakah Kabagrenmin sudah membuka suratnya.
 *
 * Datanya sudah ada sejak R5G2 — `awaiting_kabag` berarti belum dibuka,
 * `read_kabag` berarti sudah. Yang kurang hanya LAMANYA, dan tanpa itu kedua
 * keadaan terbaca sama saja: surat yang diajukan tadi pagi dan yang menggantung
 * dua minggu sama-sama bertulis "Menunggu Disposisi Kabagrenmin".
 *
 * Hanya muncul pada dua keadaan itu. Begitu suratnya diteruskan atau dijawab
 * lewat arahan, lama menunggu berhenti menjadi pertanyaan.
 */
/**
 * R5H5: warna badge status menurut tahap alur, bukan menurut status register.
 * Sebelumnya semua surat terdaftar berwarna hijau, termasuk yang masih
 * menunggu Kabagrenmin — warnanya tidak membedakan apa pun.
 */
function statusTone(workflow:string|undefined,registerStatus:string):'neutral'|'warn'|'info'|'ok'|'review'{
 switch(workflow){
  case 'awaiting_kabag': return 'warn'
  case 'read_kabag': case 'in_progress': return 'info'
  case 'directive_issued': case 'dispatched': return 'ok'
  case 'awaiting_review': return 'review'
  case 'draft': case 'recorded': return 'neutral'
 }
 return registerStatus==='registered'?'ok':'neutral'
}

/**
 * R5H5: label ringkas untuk sel Status di DAFTAR. Label panjang (routeLabels)
 * tetap dipakai di detail surat; di daftar cukup kata kunci tahapnya.
 * "Menunggu Disposisi Kabagrenmin" dipecah menjadi dibuka/belum dibuka karena
 * hanya itu yang membedakan dua keadaan tersebut di mata petugas.
 */
const listLabels:Record<string,string>={draft:'Draft',recorded:'Tercatat',awaiting_kabag:'Belum Dibuka Kabagrenmin',read_kabag:'Dibuka Kabagrenmin',directive_issued:'Didisposisikan',dispatched:'Didistribusikan',in_progress:'Ditindaklanjuti',awaiting_review:'Menunggu Review'}

/**
 * R5H5: satu badge dan PALING BANYAK satu keterangan. Sebelumnya tiga baris
 * bertumpuk (status, "Menunggu tindakan Anda", "Belum dibuka · hari ini") yang
 * sebagian besar mengulang hal yang sama.
 *
 * - Surat yang menunggu tindakan akun ini: badge "Perlu Tindakan Anda" saja —
 *   itu satu-satunya hal yang perlu diketahui penerimanya.
 * - Belum dibuka Kabagrenmin: keterangan lama menunggu hanya muncul mulai 1
 *   hari; "hari ini" tidak menambah informasi. Merah mulai REMIND_AFTER_DAYS.
 * - Keadaan lain: badge saja. Rincian lengkap tetap ada di tooltip.
 */
function StatusCell({workflow,registerStatus,since,mine}:{workflow?:string;registerStatus:string;since?:string;mine:boolean}){
 const full=routeLabels[workflow||'']||(registerStatus==='draft'?'Draft':'Terdaftar')
 if(mine) return <div className="sm-status"><span className="sm-badge tone-warn" title={`${full}. Surat ini ditujukan kepada Anda dan belum dikonfirmasi diterima.`}>Perlu Tindakan Anda</span></div>
 const days=workflow==='awaiting_kabag'?waitingDays(since):null
 const overdue=days!==null&&days>=REMIND_AFTER_DAYS
 const label=listLabels[workflow||'']||(registerStatus==='draft'?'Draft':'Terdaftar')
 return <div className="sm-status">
  <span className={`sm-badge tone-${statusTone(workflow,registerStatus)}`} title={days!==null?`${full}. Diajukan ${waitingLabel(days)} lalu${overdue?'; pertimbangkan untuk mengingatkan.':'.'}`:full}>{label}</span>
  {days!==null&&days>=1&&<span className={`sm-meta${overdue?' is-overdue':''}`}>Menunggu {waitingLabel(days)}</span>}
 </div>
}

/**
 * R5H5: ikon tombol aksi, sama persis dengan ikon di daftar Surat Keluar
 * (UrminR5D Icon) supaya kedua daftar terlihat satu keluarga.
 */
function RowIcon({d}:{d:'info'|'upload'}){
 return <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
  {d==='info'?<><circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/></>:<path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/>}
 </svg>
}

export default function SuratMasuk({initialID,initialCreate,isKabagrenmin=false}:{initialID?:string;initialCreate?:boolean;isKabagrenmin?:boolean}){
 // R5H6: Kabagrenmin hanya melihat surat yang DIDISPOSISIKAN kepadanya —
 // bukan draft operator, bukan surat "cukup dicatat". Penyaringan tampilan;
 // hak akses tetap ditegakkan backend.
 const [list,setList]=useState<Item[]>([]),[search,setSearch]=useState(''),[filter,setFilter]=useState(''),[limited,setLimited]=useState(false),[workflowStatuses,setWorkflowStatuses]=useState<Record<string,string>>({})
 const [workflowSince,setWorkflowSince]=useState<Record<string,string>>({})
 const [selected,setSelected]=useState<string|null>(null),[detail,setDetail]=useState<Item|null>(null),[history,setHistory]=useState<History[]>([])
 const [canEdit,setCanEdit]=useState(false),[canCreate,setCanCreate]=useState(false),[editing,setEditing]=useState(false),[creating,setCreating]=useState(false)
 const [form,setForm]=useState<Draft>({...blank}),[extra,setExtra]=useState<IntakeExtra>({...blankExtra}),[intakeRecord,setIntakeRecord]=useState<IntakeRecord|null>(null)
 const [intakeFiles,setIntakeFiles]=useState<File[]>([]),[intakeError,setIntakeError]=useState(''),[submitConfirm,setSubmitConfirm]=useState(false)
 const [intakeSurat,setIntakeSurat]=useState<File[]>([])
 const [awaitingIds,setAwaitingIds]=useState<Set<string>>(new Set())
 // incomingId -> distributionId untuk surat yang masih 'sent' ke akun ini.
 // Membuka detailnya = menerimanya (lihat open()); tidak ada tindakan lain bagi
 // penerima, jadi konfirmasi manual hanya menambah langkah.
 const awaitingDist=useRef(new Map<string,string>()),receiving=useRef(new Set<string>())
 const [previewFile,setPreviewFile]=useState<File|null>(null)
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [uploadOpen,setUploadOpen]=useState(false),[uploadTarget,setUploadTarget]=useState(''),[fileQueue,setFileQueue]=useState<File[]>([])
 const [uploadReason,setUploadReason]=useState(''),[uploadAccess,setUploadAccess]=useState<FileSummary|null>(null)
 const [uploadChecking,setUploadChecking]=useState(false),[uploadBusy,setUploadBusy]=useState(false),[uploadProgress,setUploadProgress]=useState(0),[uploadError,setUploadError]=useState('')
 const [attachmentRevision,setAttachmentRevision]=useState(0)
 const openSeq=useRef(0),uploadSeq=useRef(0)
 const registeredList=list.filter(i=>i.status==='registered')
 // R5H5: paginasi seperti menu Disposisi; kembali ke halaman 1 saat pencarian berubah.
 const {pageItems:pagedList,pager}=usePaged(list,[filter])
 const uploadOptions=detail?.status==='registered'&&!registeredList.some(i=>i.id===detail.id)?[detail,...registeredList]:registeredList
 const uploadDoc=uploadOptions.find(i=>i.id===uploadTarget)
 const modalOpen=creating||editing||uploadOpen||submitConfirm
 const reload=useCallback(async()=>{
  const [items,caps]=await Promise.all([api<{items:Item[];limited:boolean;workflowStatuses?:Record<string,string>;workflowSince?:Record<string,string>}>(`/api/v1/urmin/surat-masuk/?q=${encodeURIComponent(filter)}`),api<{canCreate:boolean}>('/api/v1/urmin/surat-masuk/capabilities')])
  const kabagStatuses=new Set(['awaiting_kabag','read_kabag','directive_issued','dispatched','in_progress','awaiting_review'])
  setList(isKabagrenmin?items.items.filter(i=>kabagStatuses.has((items.workflowStatuses||{})[i.id]||'')):items.items);setLimited(items.limited);setWorkflowStatuses(items.workflowStatuses||{});setWorkflowSince(items.workflowSince||{});setCanCreate(caps.canCreate)
  // Surat yang DITUJUKAN ke akun ini dan belum dikonfirmasi diterima. Sumbernya
  // distribusi, bukan register, jadi harus diambil terpisah — register tidak
  // tahu apa-apa soal siapa yang dituju. Kegagalannya sengaja ditelan: penanda
  // ini tambahan, dan daftar surat harus tetap tampil tanpanya.
  try{
   const inbox=await api<{items:{id:string;incomingId:string;status:string}[]}>('/api/v1/urmin/distribution-inbox/')
   const sent=inbox.items.filter(d=>d.status==='sent')
   awaitingDist.current=new Map(sent.map(d=>[d.incomingId,d.id]))
   setAwaitingIds(new Set(sent.map(d=>d.incomingId)))
  }catch{awaitingDist.current=new Map();setAwaitingIds(new Set())}
 },[filter,isKabagrenmin])
 // Lewat ref: open() tidak boleh ikut berubah saat filter berubah, karena
 // efek initialID bergantung padanya dan akan membuka ulang surat lama.
 const reloadRef=useRef(reload);reloadRef.current=reload
 const open=useCallback(async(id:string)=>{
  const seq=++openSeq.current
  const [data,metadata]=await Promise.all([
   api<{item:Item;history:History[];canEdit:boolean}>(`/api/v1/urmin/surat-masuk/${id}`),
   api<{intake:IntakeRecord|null}>(`/api/v1/urmin/surat-masuk/${id}/intake`)
  ])
  if(seq!==openSeq.current)return
  setSelected(id);setDetail(data.item);setHistory(data.history);setCanEdit(data.canEdit);setEditing(false)
  setIntakeRecord(metadata.intake);setExtra(metadata.intake?{...blankExtra,...metadata.intake,eventStart:(metadata.intake.eventStart||'').replace(' ','T').slice(0,16),eventEnd:(metadata.intake.eventEnd||'').replace(' ','T').slice(0,16),responseDue:metadata.intake.responseDue||''}:{...blankExtra})
  const distributionId=awaitingDist.current.get(id)
  if(distributionId&&!receiving.current.has(distributionId)){
   receiving.current.add(distributionId)
   try{
    await api(`/api/v1/urmin/distribution-inbox/${encodeURIComponent(distributionId)}/receive`,'POST',{reason:AUTO_RECEIVE_REASON})
    window.dispatchEvent(new Event('sdl:inbox-changed'))
    setMessage('Surat dicatat diterima.')
   }catch(e){
    // 409 = sudah diterima di tab/layar lain; bukan kegagalan bagi pengguna.
    if(!(e instanceof Error&&e.message.startsWith('Data berubah')))setError(`Penerimaan belum tercatat. ${e instanceof Error?e.message:''}`)
   }finally{receiving.current.delete(distributionId)}
   await reloadRef.current().catch(()=>{})
   if(seq===openSeq.current){
    const fresh=await api<{item:Item;history:History[];canEdit:boolean}>(`/api/v1/urmin/surat-masuk/${id}`).catch(()=>null)
    if(fresh&&seq===openSeq.current){setDetail(fresh.item);setHistory(fresh.history)}
   }
  }
 },[])
 useEffect(()=>{setLoading(true);reload().catch(e=>setError(e instanceof Error?e.message:'Tidak bisa memuat surat')).finally(()=>setLoading(false))},[reload])
 useEffect(()=>{if(initialID)void open(initialID).catch(()=>setError('Surat tidak dapat dibuka.'))},[initialID,open])
 useEffect(()=>{if(initialCreate&&!isKabagrenmin)setCreating(true)},[initialCreate,isKabagrenmin])
 useEffect(()=>{
  if(!modalOpen)return
  const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy&&!uploadBusy){if(submitConfirm)setSubmitConfirm(false);else{setCreating(false);setEditing(false);setUploadOpen(false)}}}
  document.addEventListener('keydown',onKey)
  const before=document.body.style.overflow;document.body.style.overflow='hidden'
  return()=>{document.removeEventListener('keydown',onKey);document.body.style.overflow=before}
 },[modalOpen,busy,uploadBusy,submitConfirm])
 useEffect(()=>{
  if(!uploadOpen||!uploadTarget){setUploadAccess(null);setUploadChecking(false);return}
  const seq=++uploadSeq.current
  setUploadAccess(null);setUploadChecking(true)
  void api<FileSummary>(`/api/v1/urmin/surat-masuk/${uploadTarget}/attachments`)
    .then(data=>{if(seq===uploadSeq.current)setUploadAccess(data)})
    .catch(e=>{if(seq===uploadSeq.current)setUploadError(e instanceof Error?e.message:'Tidak bisa memeriksa lampiran.')})
    .finally(()=>{if(seq===uploadSeq.current)setUploadChecking(false)})
  return()=>{uploadSeq.current++}
 },[uploadOpen,uploadTarget,attachmentRevision])
 function beginCreate(){setCreating(true);setEditing(false);setMessage('');setError('');setIntakeError('');setIntakeFiles([]);setPreviewFile(null);setExtra({...blankExtra});setForm({...blank})}
 function beginEdit(){if(!detail||!canEdit)return;setEditing(true);setCreating(false);setForm(formOf(detail));setIntakeFiles([]);setIntakeError('');setError('')}
 function change<K extends keyof Draft>(key:K,val:Draft[K]){setForm(prev=>({...prev,[key]:val}))}
 function closeForm(){if(busy)return;setCreating(false);setEditing(false);setSubmitConfirm(false);setIntakeFiles([]);setPreviewFile(null)}
 function beginUpload(id?:string){
  setPreviewFile(null);setUploadTarget(id||'');setFileQueue([]);setUploadReason('');setUploadProgress(0);setUploadError('');setUploadAccess(null);setUploadOpen(true)
 }
 function closeUpload(){if(uploadBusy)return;setUploadOpen(false);setFileQueue([]);setPreviewFile(null)}
 function enqueue(files:FileList|File[]){
  const incoming=Array.from(files);if(incoming.length===0)return
  const invalid=incoming.map(fileError).find(Boolean);if(invalid){setUploadError(invalid);return}
  const combined=[...fileQueue];for(const f of incoming){if(!combined.some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified))combined.push(f)}
  if(combined.length+(uploadAccess?.items.length||0)>10){setUploadError('Maksimal 10 lampiran per surat, termasuk yang sudah tersimpan.');return}
  setFileQueue(combined);setUploadError('')
 }
 function queueIntake(files:FileList|File[]){
  const incoming=Array.from(files);const invalid=incoming.map(fileError).find(Boolean)
  if(invalid){setIntakeError(invalid);return}
  const combined=[...intakeFiles]
  incoming.forEach(f=>{if(!combined.some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified))combined.push(f)})
  // Batas 10 dihitung GABUNGAN dengan naskah surat — backend memakai batas yang
  // sama, jadi menghitungnya terpisah di sini akan menolak di server, bukan di
  // layar, dan pesannya jauh kurang jelas.
  if(combined.length+intakeSurat.length>10){setIntakeError('Maksimal 10 berkas, termasuk naskah surat.');return}
  setIntakeFiles(combined);setIntakeError('')
 }
 function queueSurat(files:FileList|File[]){
  const incoming=Array.from(files);const invalid=incoming.map(fileError).find(Boolean)
  if(invalid){setIntakeError(invalid);return}
  if(incoming.length!==1){setIntakeError('Pilih tepat satu berkas naskah surat.');return}
  if(intakeFiles.length+1>10){setIntakeError('Maksimal 10 berkas, termasuk naskah surat.');return}
  setIntakeSurat([incoming[0]]);setIntakeError('')
 }
 function validateIntake(mode:'draft'|'submit'='submit'){
  if(mode==='submit'&&extra.letterKind==='undangan'&&!extra.eventStart){setIntakeError('Tanggal dan waktu kegiatan wajib untuk undangan.');return false}
  if(mode==='submit'&&extra.letterKind==='permintaan'&&!extra.responseDue){setIntakeError('Batas waktu respons wajib untuk permintaan.');return false}
  if(extra.eventEnd&&extra.eventStart&&extra.eventEnd<extra.eventStart){setIntakeError('Waktu selesai tidak boleh sebelum waktu kegiatan.');return false}
  setIntakeError('');return true
 }
 async function sendIntake(mode:'draft'|'submit'){
  if(busy||!validateIntake(mode))return
  if(mode==='draft'&&intakeFiles.length+intakeSurat.length>0){setIntakeError('Untuk menyimpan berkas, gunakan Ajukan Surat. Berkas belum tersimpan sebagai draft.');return}
  setBusy(true);setError('');setMessage('');setSubmitConfirm(false)
  try{
   const payload={...form,...extra,mode,...(!creating&&detail?{id:detail.id,version:detail.version}:{})}
   const result=await submitIntake(payload,mode==='submit'?intakeFiles:[],mode==='submit'?intakeSurat:[])
   setCreating(false);setEditing(false);setIntakeFiles([]);setIntakeSurat([]);setPreviewFile(null)
   await reload();await open(result.item.id)
   setMessage(mode==='draft'?'Draft surat masuk tersimpan.':result.routeStatus==='awaiting_kabag'?'Surat dan lampiran tersimpan. Menunggu disposisi Kabagrenmin.':'Surat dan lampiran tersimpan tanpa disposisi.')
  }catch(e){setIntakeError(e instanceof Error?e.message:'Gagal menyimpan surat masuk')}
  finally{setBusy(false)}
 }
 function save(e:FormEvent<HTMLFormElement>){e.preventDefault();void sendIntake('draft')}
 function requestSubmit(){if(!form.letterNumber.trim()||!form.sender.trim()||!form.letterDate||!form.receivedDate||!form.subject.trim()){setIntakeError('Lengkapi informasi surat terlebih dahulu.');return}if(validateIntake())setSubmitConfirm(true)}
 async function upload(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(uploadBusy||!uploadTarget||!uploadAccess?.canUpload||!fileQueue.length)return
  if(uploadReason.trim().length<8){setUploadError('Keterangan upload minimal 8 karakter.');return}
  if(fileQueue.length+uploadAccess.items.length>10){setUploadError('Batas lampiran per surat terlampaui.');return}
  setUploadBusy(true);setUploadError('');setUploadProgress(0);let completed=0
  try{
   for(const file of fileQueue){await postAttachment(uploadTarget,file,uploadReason.trim());completed++;setUploadProgress(completed)}
   setUploadOpen(false);setFileQueue([]);setUploadReason('');setAttachmentRevision(x=>x+1)
   setMessage(`${completed} lampiran berhasil diunggah.`)
   try{await reload();if(detail?.id===uploadTarget)await open(uploadTarget)}catch{setError('Lampiran tersimpan, tetapi tampilan belum diperbarui. Muat ulang halaman.')} 
  }catch(e){
   setFileQueue(prev=>prev.slice(completed))
   setAttachmentRevision(x=>x+1)
   if(completed){try{await reload();if(detail?.id===uploadTarget)await open(uploadTarget)}catch{/* Berkas yang berhasil tetap tersimpan */}}
   setUploadError(`${completed?`${completed} file berhasil, namun upload terhenti. `:''}${e instanceof Error?e.message:'Gagal mengunggah lampiran.'}`)
  }finally{setUploadBusy(false)}
 }
 return <div className="sm-root sdl-sm-r5f6">
  {error&&<FloatingToast message={error} kind="error"/>}{message&&<FloatingToast message={message} kind="success"/>}
  <section className="panel sm-panel">
   <div className="sm-toolbar sdl-sm-r5f6__toolbar">
    <form className="sm-search" onSubmit={e=>{e.preventDefault();setFilter(search)}}><input className="rm-input" aria-label="Cari surat masuk" placeholder="Cari nomor, asal, perihal" value={search} onChange={e=>setSearch(e.target.value)} maxLength={100}/><button className="btn" type="submit">Cari</button></form>
    <div className="sdl-sm-r5f6__toolbar-actions"><button type="button" className="btn" onClick={()=>beginUpload(detail?.status==='registered'?detail.id:undefined)}>Upload Lampiran</button>{!isKabagrenmin&&<button className="btn primary" disabled={!canCreate||busy} title={canCreate?'Buat draft surat masuk':'Tidak ada izin membuat surat'} onClick={beginCreate}>+ Tambah Surat</button>}</div>
   </div>
   {limited&&<p className="sm-hint">Daftar dibatasi 200 surat terbaru sesuai akses akun. Surat lama dapat dicari melalui kolom pencarian.</p>}
   <div className="table-scroll"><table className="data-table sm-table"><thead><tr><th>Agenda</th><th>Nomor Surat</th><th>Surat Dari</th><th>Tanggal Surat</th><th>Status</th><th>Aksi</th></tr></thead><tbody>{pagedList.map(i=><tr key={i.id} className={selected===i.id?'sm-selected':''}><td>SM-{new Date(i.createdAt).getFullYear()}-{i.agendaNo}</td><td><span className="sm-title-row"><strong>{i.letterNumber}</strong><DerajatTag value={i.derajat??'biasa'}/></span></td><td>{i.sender}</td><td>{readableDate(i.letterDate)}</td><td><StatusCell workflow={workflowStatuses[i.id]} registerStatus={i.status} since={workflowSince[i.id]} mine={awaitingIds.has(i.id)}/></td><td><div className="sdl-sm-r5f6__row-actions sm-row-actions"><button className="sm-row-action" type="button" title="Lihat detail surat" onClick={()=>open(i.id).catch(e=>setError(e instanceof Error?e.message:'Gagal membuka surat'))}><RowIcon d="info"/> Detail</button>{i.status==='registered'&&<button className="sm-row-action sm-row-action--file" type="button" title="Unggah lampiran surat" onClick={()=>beginUpload(i.id)}><RowIcon d="upload"/> Upload</button>}</div></td></tr>)}</tbody></table></div>
   <Pager pager={pager} label="surat"/>
   {!loading&&list.length===0&&<div className="sm-empty">Belum ada surat yang bisa ditampilkan.</div>}{loading&&<div className="sm-empty">Memuat daftar surat...</div>}
  </section>
  {detail&&<section className="panel sm-panel"><div className="sm-section-title sdl-sm-r5f6__detail-head"><div><span className="eyebrow">DETAIL SURAT MASUK</span><span className="sm-title-row"><h3>{detail.letterNumber}</h3><DerajatTag value={detail.derajat??'biasa'}/></span><p>Agenda SM-{new Date(detail.createdAt).getFullYear()}-{detail.agendaNo} · Versi {detail.version} · {routeLabels[intakeRecord?.workflowStatus||'']||(detail.status==='draft'?'Draft':'Terdaftar')}</p></div><div className="sdl-sm-r5f6__row-actions">{canEdit&&<button className="btn" type="button" onClick={beginEdit}>Edit Draft</button>}{detail.status==='registered'&&<button className="btn primary" type="button" onClick={()=>beginUpload(detail.id)}>Upload Lampiran</button>}</div></div>
   <dl className="sm-details"><div><dt>Surat Dari</dt><dd>{detail.sender}</dd></div><div><dt>Tanggal Surat</dt><dd>{detail.letterDate}</dd></div><div><dt>Tanggal Diinput</dt><dd>{detail.receivedDate}</dd></div><div><dt>Klasifikasi</dt><dd>{classificationLabel(detail.classification)}</dd></div>{intakeRecord&&<><div><dt>Jenis Surat</dt><dd>{kindLabels[intakeRecord.letterKind]||intakeRecord.letterKind}</dd></div><div><dt>Batas Respons</dt><dd>{intakeRecord.responseDue?readableDate(intakeRecord.responseDue):'Tanpa batas respons'}</dd></div>{intakeRecord.eventStart&&<div className="sm-span"><dt>Pelaksanaan</dt><dd>{intakeRecord.eventStart.replace('T',' ').slice(0,16)} WIB · {intakeRecord.eventLocation||'Lokasi belum dicatat'}</dd></div>}</>}<div className="sm-span"><dt>Perihal</dt><dd>{detail.subject}</dd></div></dl>
   {detail.status==='draft'&&canEdit&&<div className="sm-register"><strong>Draft Surat</strong><p>Lengkapi informasi, pilihan disposisi dan lampiran dalam satu form sebelum pengajuan.</p><button className="btn primary" type="button" onClick={beginEdit}>Lengkapi & Ajukan</button></div>}
   {detail.status==='registered'&&<DisposisiSuratR5H6 key={`${detail.id}:${awaitingIds.has(detail.id)}`} letter={detail} onChanged={()=>{void reload().catch(()=>{});void open(detail.id).catch(()=>{})}}/>}
   <SuratR3B key={`${detail.id}:${attachmentRevision}`} incomingId={detail.id} registered={detail.status==='registered'} onRequestUpload={()=>beginUpload(detail.id)}/>
   <h4 className="sm-history-title">Riwayat Surat</h4><div className="sm-history">{history.map((h,i)=><div className="sm-history-row" key={`${h.version}-${i}`}><span className="sm-history-dot"/><div><strong>{h.action==='created'?'Draft dibuat':h.action==='edited'?'Draft diperbarui':'Surat diregister'}</strong><small>{h.actor} · {new Date(h.at).toLocaleString('id-ID')} · Versi {h.version}</small><p>{h.reason}</p></div></div>)}</div>
  </section>}

  {previewFile&&<LampiranPreviewR5F15 file={previewFile} onClose={()=>setPreviewFile(null)}/>}
  {(creating||editing)&&<div className="sdl-sm-r5f6__backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)closeForm()}}><section className="sdl-sm-r5f6__dialog sdl-sm-r5f7__dialog" role="dialog" aria-modal="true" aria-labelledby="sdl-sm-form-title"><header className="sdl-sm-r5f6__modal-head"><div><span className="eyebrow">SURAT MASUK</span><h2 id="sdl-sm-form-title">{creating?'Tambah Surat Masuk':'Lengkapi Draft Surat'}</h2><p>Isi informasi surat, lampiran, dan tentukan alur pengajuan.</p></div><button type="button" className="sdl-sm-r5f6__close" aria-label="Tutup" disabled={busy} onClick={closeForm}>×</button></header>
   <form onSubmit={save}><div className="sdl-sm-r5f6__fields sdl-sm-r5f7__fields">
    <h3 className="sdl-sm-r5f6__wide">Informasi Surat</h3>
    <label>Nomor Surat<input autoFocus required className="rm-input" maxLength={120} minLength={3} value={form.letterNumber} onChange={e=>change('letterNumber',e.target.value)}/></label>
    <label>Surat Dari<input required className="rm-input" maxLength={240} minLength={3} value={form.sender} onChange={e=>change('sender',e.target.value)}/></label>
    <label>Tanggal Surat<input required className="rm-input" type="date" value={form.letterDate} onChange={e=>change('letterDate',e.target.value)}/></label>
    <label>Tanggal Diinput<input required className="rm-input" type="date" value={form.receivedDate} onChange={e=>change('receivedDate',e.target.value)}/></label>
    <label>Jenis Surat<select className="rm-input" value={extra.letterKind} onChange={e=>setExtra(x=>({...x,letterKind:e.target.value as Kind}))}><option value="undangan">Undangan</option><option value="permintaan">Permintaan Data / Dokumen</option><option value="pemberitahuan">Pemberitahuan</option><option value="lainnya">Lainnya</option></select></label>
    <label>Klasifikasi<select className="rm-input" value={form.classification} onChange={e=>change('classification',e.target.value as 'biasa'|'penting')}><option value="biasa">Biasa</option><option value="penting">Rahasia</option></select></label>
    <label>Derajat<select className="rm-input" value={form.derajat} onChange={e=>change('derajat',e.target.value as Derajat)}><option value="biasa">Biasa</option><option value="kilat">Kilat</option></select></label>
    <label className="sdl-sm-r5f6__wide">Perihal<textarea required className="rm-input" rows={2} minLength={3} maxLength={1000} value={form.subject} onChange={e=>change('subject',e.target.value)}/></label>
    <h3 className="sdl-sm-r5f6__wide">Tanggal Penting</h3>
    {(extra.letterKind==='undangan'||extra.letterKind==='lainnya')&&<><label>Tanggal & Waktu Kegiatan {extra.letterKind==='undangan'?'*':''}<input className="rm-input" type="datetime-local" value={extra.eventStart} onChange={e=>setExtra(x=>({...x,eventStart:e.target.value}))}/></label><label>Waktu Selesai (opsional)<input className="rm-input" type="datetime-local" value={extra.eventEnd} onChange={e=>setExtra(x=>({...x,eventEnd:e.target.value}))}/></label><label>Lokasi / Link Meeting<input className="rm-input" maxLength={240} value={extra.eventLocation} onChange={e=>setExtra(x=>({...x,eventLocation:e.target.value}))}/></label><label>Agenda Kegiatan<input className="rm-input" maxLength={500} value={extra.eventAgenda} onChange={e=>setExtra(x=>({...x,eventAgenda:e.target.value}))}/></label></>}
    <label>{extra.letterKind==='undangan'?'Batas Konfirmasi Kehadiran':extra.letterKind==='permintaan'?'Batas Waktu Respons *':'Batas Waktu Respons (opsional)'}<input className="rm-input" type="date" value={extra.responseDue} onChange={e=>setExtra(x=>({...x,responseDue:e.target.value}))}/></label>
    <label className="sdl-sm-r5f6__wide">Informasi Tambahan<textarea className="rm-input" rows={2} maxLength={1000} value={extra.details} onChange={e=>setExtra(x=>({...x,details:e.target.value}))}/></label>
    <h3 className="sdl-sm-r5f6__wide">Berkas Surat</h3>
    <div className="sdl-sm-r5f6__wide sdl-sm-r5f6__drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();queueSurat(e.dataTransfer.files)}}><span aria-hidden="true" className="sdl-sm-r5f6__drop-icon">↑</span><strong>Pilih atau tarik naskah surat ke sini</strong><span>PDF, JPG, PNG · satu berkas · maksimal 10 MB</span><input type="file" accept=".pdf,.jpg,.jpeg,.png" aria-label="Pilih naskah surat masuk" disabled={busy} onChange={e=>{if(e.target.files)queueSurat(e.target.files);e.target.value=''}}/></div>
    <div className="sdl-sm-r5f6__wide sdl-r5f16__selection" aria-live="polite">{intakeSurat.length===0?'Belum ada naskah surat dipilih.':'Naskah surat siap diajukan · Belum tersimpan'}</div>
    {intakeSurat.length>0&&<div className="sdl-sm-r5f6__wide sdl-r5f16__cards">{intakeSurat.map(f=><LampiranFileCardR5F16 key={`${f.name}-${f.size}-${f.lastModified}`} file={f} busy={busy} onPreview={()=>setPreviewFile(f)} onRemove={()=>{if(previewFile===f)setPreviewFile(null);setIntakeSurat([])}} />)}</div>}
    <h3 className="sdl-sm-r5f6__wide">Lampiran Surat</h3>
    <div className="sdl-sm-r5f6__wide sdl-sm-r5f6__drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();queueIntake(e.dataTransfer.files)}}><span aria-hidden="true" className="sdl-sm-r5f6__drop-icon">↑</span><strong>Pilih atau tarik file ke sini</strong><span>PDF, JPG, PNG · maksimal 10 file · maksimal 10 MB/file</span><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" aria-label="Pilih lampiran surat masuk" disabled={busy} onChange={e=>{if(e.target.files)queueIntake(e.target.files);e.target.value=''}}/></div>
    <div className="sdl-sm-r5f6__wide sdl-r5f16__selection" aria-live="polite">{intakeFiles.length===0?'Belum ada lampiran dipilih. Preview akan muncul setelah memilih file.':`${intakeFiles.length} dari 10 lampiran siap diajukan · Belum tersimpan`}</div>
    {intakeFiles.length>0&&<div className="sdl-sm-r5f6__wide sdl-r5f16__cards">{intakeFiles.map((f,i)=><LampiranFileCardR5F16 key={`${f.name}-${f.size}-${f.lastModified}`} file={f} busy={busy} onPreview={()=>setPreviewFile(f)} onRemove={()=>{if(previewFile===f)setPreviewFile(null);setIntakeFiles(x=>x.filter((_,j)=>j!==i))}} />)}</div>}
    <h3 className="sdl-sm-r5f6__wide">Alur Surat</h3>
    <fieldset className="sdl-sm-r5f6__wide sdl-sm-r5f7__choices"><legend>Apakah perlu disposisi?</legend><label><input type="radio" name="needDispo" checked={extra.needsDisposition} onChange={()=>setExtra(x=>({...x,needsDisposition:true}))}/> Ya, kirim ke Kabagrenmin</label><label><input type="radio" name="needDispo" checked={!extra.needsDisposition} onChange={()=>setExtra(x=>({...x,needsDisposition:false}))}/> Tidak, cukup dicatat</label></fieldset>
    <div className="sdl-sm-r5f6__wide sdl-sm-r5f7__next" aria-live="polite">{extra.needsDisposition?'Setelah diajukan, surat dan lampiran masuk ke Surat Masuk Kabagrenmin untuk didisposisikan.':'Setelah diajukan, surat tercatat tanpa antrean disposisi. Pimpinan dapat melihatnya sesuai hak akses.'}</div>
    {intakeError&&<div className="sdl-sm-r5f6__wide sdl-sm-r5f6__warning" role="alert">{intakeError}</div>}
    <p className="sdl-sm-r5f6__wide sdl-sm-r5f6__note">Simpan Draft hanya menyimpan informasi surat. File baru disimpan bersama pengajuan supaya tidak ada lampiran tanpa proses yang jelas.</p>
   </div><footer className="sdl-sm-r5f6__actions"><button type="button" className="btn" disabled={busy} onClick={closeForm}>Batal</button><button type="submit" className="btn" disabled={busy}>{busy?'Menyimpan...':'Simpan Draft'}</button><button type="button" className="btn primary" disabled={busy||form.reason.trim().length<8} onClick={requestSubmit}>Ajukan Surat</button></footer></form>
  </section></div>}
  {submitConfirm&&(creating||editing)&&<div className="sdl-sm-r5f6__backdrop sdl-sm-r5f7__confirm" role="presentation"><section className="sdl-sm-r5f6__dialog sdl-sm-r5f6__dialog--compact" role="dialog" aria-modal="true" aria-labelledby="sdl-r5f7-confirm-title"><header className="sdl-sm-r5f6__modal-head"><div><span className="eyebrow">KONFIRMASI PENGAJUAN</span><h2 id="sdl-r5f7-confirm-title">Ajukan Surat Masuk?</h2><p>Surat, metadata dan {intakeFiles.length} lampiran akan disimpan bersama-sama.</p></div></header><div className="sdl-sm-r5f6__confirm-text"><strong>{form.letterNumber}</strong><span>{extra.needsDisposition?'Tujuan: Kabagrenmin · Menunggu Disposisi':'Tujuan: Register URMIN · Tanpa Disposisi'}</span><span>Setelah diajukan, data utama tidak dapat diedit seperti draft.</span></div><footer className="sdl-sm-r5f6__actions"><button className="btn" type="button" disabled={busy} onClick={()=>setSubmitConfirm(false)}>Kembali</button><button className="btn primary" type="button" disabled={busy} onClick={()=>void sendIntake('submit')}>{busy?'Memproses...':'Ya, Ajukan Surat'}</button></footer></section></div>}

  {uploadOpen&&<div className="sdl-sm-r5f6__backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)closeUpload()}}><section className="sdl-sm-r5f6__dialog sdl-sm-r5f6__dialog--upload" role="dialog" aria-modal="true" aria-labelledby="sdl-sm-upload-title"><header className="sdl-sm-r5f6__modal-head"><div><span className="eyebrow">LAMPIRAN SURAT MASUK</span><h2 id="sdl-sm-upload-title">Upload Lampiran</h2><p>Tambahkan dokumen PDF, JPG, atau PNG ke surat yang sudah terdaftar.</p></div><button type="button" className="sdl-sm-r5f6__close" aria-label="Tutup" disabled={uploadBusy} onClick={closeUpload}>×</button></header>
   <form onSubmit={upload}><div className="sdl-sm-r5f6__upload-content">
    <label className="sdl-sm-r5f6__label">Pilih surat terdaftar<select className="rm-input" autoFocus value={uploadTarget} disabled={uploadBusy} onChange={e=>{setUploadTarget(e.target.value);setFileQueue([]);setUploadProgress(0);setUploadError('')}} required><option value="">Pilih surat...</option>{uploadOptions.map(i=><option key={i.id} value={i.id}>SM-{new Date(i.createdAt).getFullYear()}-{i.agendaNo} · {i.letterNumber} · {i.subject.slice(0,55)}</option>)}</select></label>
    {uploadOptions.length===0&&<p className="sdl-sm-r5f6__hint">Belum ada surat terdaftar pada daftar ini. Register surat terlebih dahulu.</p>}
    {limited&&<p className="sdl-sm-r5f6__hint">Pemilihan surat mengikuti hasil daftar (maksimal 200 surat). Gunakan pencarian pada halaman Surat Masuk untuk menemukan surat lainnya.</p>}
    {uploadTarget&&uploadDoc&&<div className="sdl-sm-r5f6__file-status">{uploadChecking?'Memeriksa akses upload...':uploadAccess?`${uploadAccess.items.length} dari 10 lampiran sudah tersimpan.`:'Memeriksa surat...'}</div>}
    {uploadAccess&&!uploadAccess.canUpload&&<p className="sdl-sm-r5f6__warning">Akun ini tidak memiliki izin upload untuk surat yang dipilih.</p>}
    {uploadAccess?.canUpload&&uploadAccess.items.length<10&&<div className="sdl-sm-r5f6__drop" onDragOver={(e:DragEvent<HTMLDivElement>)=>e.preventDefault()} onDrop={(e:DragEvent<HTMLDivElement>)=>{e.preventDefault();if(!uploadBusy)enqueue(e.dataTransfer.files)}}>
     <span aria-hidden="true" className="sdl-sm-r5f6__drop-icon">↑</span><strong>Pilih atau tarik file ke sini</strong><span>PDF/JPG/PNG · maksimal 10 MB/file · maksimal 10 file/surat</span><input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" aria-label="Pilih berkas lampiran" disabled={uploadBusy} onChange={e=>{if(e.target.files)enqueue(e.target.files);e.target.value=''}}/>
    </div>}
    {fileQueue.length>0&&<div className="sdl-r5f16__cards">{fileQueue.map((f,i)=><LampiranFileCardR5F16 key={`${f.name}-${f.size}-${f.lastModified}`} file={f} busy={uploadBusy} onPreview={()=>setPreviewFile(f)} onRemove={()=>{if(previewFile===f)setPreviewFile(null);setFileQueue(prev=>prev.filter((_,j)=>j!==i))}} />)}</div>}
    <label className="sdl-sm-r5f6__label">Keterangan upload<textarea className="rm-input" rows={2} required minLength={8} maxLength={500} value={uploadReason} disabled={uploadBusy} onChange={e=>setUploadReason(e.target.value)} placeholder="Tuliskan alasan atau keterangan lampiran..."/></label>
    {uploadBusy&&<p className="sdl-sm-r5f6__file-status" aria-live="polite">Mengunggah {uploadProgress} dari {fileQueue.length} file...</p>}
    {uploadError&&<p className="sdl-sm-r5f6__warning" role="alert">{uploadError}</p>}
   </div><footer className="sdl-sm-r5f6__actions"><button type="button" className="btn" disabled={uploadBusy} onClick={closeUpload}>Batal</button><button type="submit" className="btn primary" disabled={uploadBusy||uploadChecking||!uploadTarget||!uploadAccess?.canUpload||fileQueue.length===0||fileQueue.length+(uploadAccess?.items.length||0)>10||uploadReason.trim().length<8}>{uploadBusy?'Mengunggah...':`Upload ${fileQueue.length||''} File`}</button></footer></form>
  </section></div>}
 </div>
}
