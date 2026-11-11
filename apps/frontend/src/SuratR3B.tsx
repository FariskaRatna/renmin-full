import { LampiranPreviewR5F15 } from './LampiranPreviewR5F15'
import { FloatingToast } from './UIFeedback'
import { BuatDisposisi, MonitoringDisposisi } from './DisposisiR3C'
import { useCallback, useEffect, useState } from 'react'
import { clickRow } from './ClickableRowR5H7'

type Attachment={id:string;filename:string;mime:string;size:number;sha256:string;createdAt:string}
type Distribution={id:string;incomingId:string;agendaNo:number;letterNumber:string;subject:string;classification:string;unit:string;recipient:string;recipientName:string;status:'sent'|'received';sentAt:string;receivedAt:string|null;reason:string}
type Event={action:string;actor:string;reason:string;at:string}
// Tipe Candidate dan daftar `units` ikut dihapus bersama formulir distribusi
// (R5G2) — keduanya hanya melayani pemilihan unit/petugas tujuan.
const root='/api/v1/urmin'
async function send<T>(url:string,method:'GET'|'POST'='GET',body?:Record<string,unknown>|FormData):Promise<T>{
 const headers:Record<string,string>={}
 if(method!=='GET'){
  const csrf=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
  if(!csrf.ok)throw Error('Sesi keamanan tidak tersedia')
  const json:{csrfToken:string}=await csrf.json();headers['X-CSRF-Token']=json.csrfToken
  if(!(body instanceof FormData))headers['Content-Type']='application/json'
 }
 const resp=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined})
 if(!resp.ok){const data:{error?:string}=await resp.json().catch(()=>({}));if(resp.status===403||resp.status===404)throw Error('Tidak ada izin atau data tidak tersedia');if(resp.status===409)throw Error('Status sudah berubah. Muat ulang.');throw Error(`Gagal (${resp.status}): ${data.error||'unavailable'}`)}
 return resp.json() as Promise<T>
}
async function download(incomingId:string,attachment:Attachment){
 const resp=await fetch(`${root}/surat-masuk/${incomingId}/attachments/${attachment.id}/download`,{credentials:'same-origin',cache:'no-store'})
 if(!resp.ok)throw Error('Tidak diizinkan mengunduh lampiran')
 const blob=await resp.blob(),url=URL.createObjectURL(blob)
 try{const a=document.createElement('a');a.href=url;a.download=attachment.filename;document.body.append(a);a.click();a.remove()}finally{window.setTimeout(()=>URL.revokeObjectURL(url),1000)}
}
function fmt(d:string|null){return d?new Date(d).toLocaleString('id-ID'):'—'}
export function SuratR3B({incomingId,registered,onRequestUpload}:{incomingId:string;registered:boolean;onRequestUpload?:()=>void}){
 const [files,setFiles]=useState<Attachment[]>([]),[deliveries,setDeliveries]=useState<Distribution[]>([])
 const [previewAttachment,setPreviewAttachment]=useState<Attachment|null>(null)
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[events,setEvents]=useState<Event[]>([]),[expanded,setExpanded]=useState('')
 const [canUpload,setCanUpload]=useState(false),[canDownload,setCanDownload]=useState(false)
 useEffect(()=>{setPreviewAttachment(null)},[incomingId])
 // canDistribute tidak lagi dibaca: formulir distribusi dihapus (R5G2).
 // Pemanggilan /recipient-candidates ikut hilang karena tidak ada lagi daftar
 // penerima untuk dipilih.
 const load=useCallback(async()=>{const [f,d]=await Promise.all([send<{items:Attachment[];canUpload:boolean;canDownload:boolean;canDistribute:boolean}>(`${root}/surat-masuk/${incomingId}/attachments`),send<{items:Distribution[]}>(`${root}/surat-masuk/${incomingId}/distributions`)]);setFiles(f.items);setDeliveries(d.items);setCanUpload(f.canUpload);setCanDownload(f.canDownload)},[incomingId])
 useEffect(()=>{setFiles([]);setDeliveries([]);setMessage('');setError('');load().catch(e=>setError(String(e)))},[load])
 async function showEvents(id:string){try{if(expanded===id){setExpanded('');return}const data=await send<{items:Event[]}>(`${root}/distribution-inbox/${id}/events`);setEvents(data.items);setExpanded(id)}catch(e){setError(String(e))}}
 if(!registered)return <div className="r3b-notice">Upload lampiran dan distribusi tersedia setelah surat diregister.</div>
 return <div className="r3b-wrap">
  <div className="sdl-sm-r5f6__section-row"><h4 className="sm-history-title">Lampiran Surat <small>PDF/JPG/PNG · maksimal 10 MB/file · 10 file/surat</small></h4>{canUpload&&onRequestUpload&&<button type="button" className="btn primary" onClick={onRequestUpload}>Upload Lampiran</button>}</div>
  {error&&<FloatingToast message={error} kind="error"/>}{message&&<FloatingToast message={message} kind="success"/>}
  <div className="r3b-files">{files.map(f=><div className="r3b-file" key={f.id}><span><strong>{f.filename}</strong><small>{(f.size/1024).toFixed(0)} KB · {fmt(f.createdAt)}</small></span><div className="sdl-r5f15__queue-actions"><button className="btn" type="button" disabled={!canDownload} onClick={()=>setPreviewAttachment(f)}>Preview</button><button className="btn" disabled={!canDownload} onClick={()=>download(incomingId,f).catch(e=>setError(String(e)))}>Unduh</button></div></div>)}{files.length===0&&<p className="r3b-muted">Belum ada lampiran yang bisa dilihat.</p>}</div>
  {previewAttachment&&<LampiranPreviewR5F15 stored={{url:`${root}/surat-masuk/${incomingId}/attachments/${previewAttachment.id}/download`,name:previewAttachment.filename,mime:previewAttachment.mime}} onClose={()=>setPreviewAttachment(null)}/>}
  <MonitoringDisposisi incomingId={incomingId}/>
  {/* R5G2: formulir "Distribusi ke Unit / Petugas" dihapus — penunjukan tim
      akan dilakukan lewat Arahan. Riwayat di bawah SENGAJA tetap ada: surat
      yang terlanjur didistribusikan sebelum perubahan ini masih berjalan, dan
      menyembunyikan jejaknya membuat disposisi yang sudah ada tampak muncul
      entah dari mana. Endpoint distribusi (105/106/108) tidak disentuh. */}
  <h4 className="sm-history-title">Riwayat Distribusi</h4>
  <div className="r3b-files">{deliveries.map(d=><div className="r3b-delivery" key={d.id}><div><strong>{d.recipientName}</strong> · {d.unit}<small> {fmt(d.sentAt)} · {d.status==='received'?'Diterima':'Menunggu konfirmasi'}</small></div><button className="btn" onClick={()=>showEvents(d.id)}>{expanded===d.id?'Tutup histori':'Lihat histori'}</button>{expanded===d.id&&<div className="r3b-events">{events.map((v,i)=><p key={i}><strong>{v.action==='sent'?'Dikirim':'Diterima'}</strong> · {v.actor} · {fmt(v.at)}<span>{v.reason}</span></p>)}</div>}</div>)}{deliveries.length===0&&<p className="r3b-muted">Belum ada distribusi untuk surat ini.</p>}</div>
 </div>
}
export function InboxDistribusi({initialID}:{initialID?:string} = {}){
 const [items,setItems]=useState<Distribution[]>([]),[pending,setPending]=useState(0),[selected,setSelected]=useState<string|null>(null),[files,setFiles]=useState<Attachment[]>([]),[events,setEvents]=useState<Event[]>([]),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [query,setQuery]=useState(''),[statusFilter,setStatusFilter]=useState<'all'|'sent'|'received'>('all'),[loading,setLoading]=useState(true)
 const refresh=useCallback(async()=>{setLoading(true);try{const r=await send<{items:Distribution[];pending:number}>(`${root}/distribution-inbox/`);setItems(r.items);setPending(r.pending)}finally{setLoading(false)}},[])
 useEffect(()=>{refresh().catch(e=>setError(e instanceof Error?e.message:'Gagal memuat inbox'))},[refresh])
 useEffect(()=>{if(initialID&&items.some(d=>d.id===initialID)&&selected!==initialID){const target=items.find(d=>d.id===initialID);if(target)void open(target)}},[initialID,items,selected])
 async function open(d:Distribution){setSelected(d.id);setError('');try{const [f,h]=await Promise.all([send<{items:Attachment[]}>(`${root}/surat-masuk/${d.incomingId}/attachments`),send<{items:Event[]}>(`${root}/distribution-inbox/${d.id}/events`)]);setFiles(f.items);setEvents(h.items)}catch(e){setError(e instanceof Error?e.message:'Gagal membuka surat')}}
 async function confirm(d:Distribution){setBusy(true);setError('');setMessage('');try{await send(`${root}/distribution-inbox/${d.id}/receive`,'POST',{reason});setReason('');await refresh();await open(d);setMessage('Surat diterima.')}catch(e){setError(e instanceof Error?e.message:'Gagal menerima surat')}finally{setBusy(false)}}
 const doc=items.find(x=>x.id===selected)
 const visible=items.filter(d=>(statusFilter==='all'||d.status===statusFilter)&&(!query.trim()||[d.subject,d.letterNumber,d.recipientName,String(d.agendaNo)].some(x=>x.toLowerCase().includes(query.trim().toLowerCase()))))
 return <div className="r3b-wrap sdl-inbox">
   {error&&<FloatingToast message={error} kind="error"/>}{message&&<FloatingToast message={message} kind="success"/>}
   <div className="sdl-inbox__summary"><div><span>Seluruh Distribusi</span><strong>{items.length}</strong></div><div><span>Menunggu Penerimaan</span><strong>{pending}</strong></div><div><span>Sudah Diterima</span><strong>{items.filter(x=>x.status==='received').length}</strong></div></div>
   <section className="panel sdl-inbox__panel"><div className="sdl-inbox__toolbar"><div><h2>Daftar Distribusi</h2><p>Surat yang ditujukan kepada akun Anda</p></div><button type="button" className="btn" disabled={loading} onClick={()=>refresh().catch(e=>setError(e instanceof Error?e.message:'Gagal memperbarui inbox'))}>{loading?'Memuat...':'Refresh'}</button></div>
      <div className="sdl-inbox__filters"><label><span className="sdl-sr-only">Cari surat</span><input placeholder="Cari perihal, nomor surat atau agenda..." aria-label="Cari distribusi" value={query} onChange={e=>setQuery(e.target.value)}/></label><label><span className="sdl-sr-only">Filter status</span><select aria-label="Filter status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as 'all'|'sent'|'received')}><option value="all">Semua Status</option><option value="sent">Menunggu</option><option value="received">Diterima</option></select></label></div>
      {visible.length===0?<div className="sdl-inbox__empty"><span className="sdl-inbox__empty-icon" aria-hidden="true">✉</span><strong>{loading?'Memuat distribusi...':items.length===0?'Belum ada surat masuk di inbox':'Tidak ada surat sesuai filter'}</strong><p>{items.length===0?'Surat yang didistribusikan kepada Anda akan tampil di sini.':'Coba ubah kata kunci atau filter status.'}</p></div>:<div className="table-scroll"><table className="data-table sdl-inbox__table"><thead><tr><th>Agenda</th><th>Perihal</th><th>Status</th><th>Dikirim</th></tr></thead><tbody>{visible.map(d=>{const rowProps=clickRow(()=>void open(d),{label:`Buka detail ${d.letterNumber??'distribusi'}`,active:selected===d.id});return <tr key={d.id} {...rowProps} className={`${rowProps.className}${selected===d.id?' sdl-inbox__selected':''}`}><td><strong>SM-{new Date(d.sentAt).getFullYear()}-{d.agendaNo}</strong></td><td><strong>{d.subject}</strong><small>{d.letterNumber}</small></td><td><span className={`sdl-inbox__status ${d.status==='received'?'is-received':'is-pending'}`}>{d.status==='sent'?'Menunggu':'Diterima'}</span></td><td>{fmt(d.sentAt)}</td></tr>})}</tbody></table></div>}
   </section>
   {doc&&<section className="panel sdl-inbox__detail"><div className="sdl-inbox__detail-head"><div><span className="sdl-work-kicker">DETAIL DISTRIBUSI</span><h2>{doc.letterNumber}</h2><p>{doc.subject}</p></div><button className="btn" type="button" onClick={()=>setSelected(null)}>Tutup</button></div><p className="sdl-inbox__meta">{doc.unit} · {doc.classification} · Dikirim {fmt(doc.sentAt)}</p><p className="sdl-inbox__meta">{doc.reason}</p><div className="sdl-inbox__detail-section"><h3>Lampiran</h3>{files.length===0?<p>Belum ada lampiran.</p>:files.map(f=><div className="r3b-file" key={f.id}><strong>{f.filename}</strong><button className="btn" onClick={()=>download(doc.incomingId,f).catch(e=>setError(e instanceof Error?e.message:'Gagal mengunduh'))}>Unduh</button></div>)}</div><div className="sdl-inbox__detail-section"><h3>Riwayat</h3>{events.length===0?<p>Belum ada riwayat.</p>:events.map((ev,idx)=><p className="r3b-event" key={idx}>{ev.action} · {ev.actor} · {fmt(ev.at)} — {ev.reason}</p>)}</div><div className="sdl-inbox__detail-section"><BuatDisposisi distributionId={doc.id} received={doc.status==='received'}/>{doc.status==='sent'&&<div className="r3b-action"><label>Keterangan penerimaan<input className="rm-input" value={reason} onChange={e=>setReason(e.target.value)} minLength={8} maxLength={500}/></label><button className="btn primary" disabled={busy||reason.trim().length<8} onClick={()=>void confirm(doc)}>Konfirmasi Diterima</button></div>}</div></section>}
 </div>
}
