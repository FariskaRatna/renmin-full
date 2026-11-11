import { FloatingToast } from './UIFeedback'
import { clickRow } from './ClickableRowR5H7'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { LeadershipMonitorR3D3, SubmitFinalR3D3 } from './LeadershipR3D3'

type Candidate={id:string;name:string;unit:string}
type Task={id:string;distributionId:string;incomingId:string;letterNumber:string;subject:string;classification:string;unit:string;issuerId:string;issuerName:string;assigneeId:string;assigneeName:string;instruction:string;dueDate:string;status:'pending'|'in_progress'|'completed';completionNote:string|null;createdAt:string;acceptedAt:string|null;completedAt:string|null;version:number;reviewStatus:'not_ready'|'awaiting_review'|'approved'|'revision_requested';reviewReason:string|null;reviewerName:string|null;reviewedAt:string|null;slaStatus:'on_track'|'overdue'|'completed_on_time'|'completed_late'|'unknown';parentTaskId:string|null;depth:number}
type History={action:string;actor:string;reason:string;at:string}

async function request<T>(url:string,method:'GET'|'POST'='GET',body?:Record<string,unknown>):Promise<T>{
 const headers:Record<string,string>={}
 if(method==='POST'){
  const res=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
  if(!res.ok)throw Error('Sesi keamanan tidak tersedia')
  const {csrfToken}:{csrfToken:string}=await res.json()
  headers['X-CSRF-Token']=csrfToken
  headers['Content-Type']='application/json'
 }
 const res=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers,body:body?JSON.stringify(body):undefined})
 if(!res.ok){const b:{error?:string}=await res.json().catch(()=>({}));if(res.status===403||res.status===404)throw Error('Tidak memiliki izin atau data tidak tersedia');if(res.status===409)throw Error('Status atau versi sudah berubah. Muat ulang.');throw Error(`${res.status}: ${b.error||'unavailable'}`)}
 return res.json() as Promise<T>
}
const fmt=(d:string|null)=>d?new Date(d).toLocaleString('id-ID'):'—'
function statusText(s:Task['status']){return s==='pending'?'Menunggu diterima':s==='in_progress'?'Dalam proses':'Selesai'}
function slaText(s:Task['slaStatus']){return ({on_track:'Dalam target',overdue:'Lewat tenggat',completed_on_time:'Selesai tepat waktu',completed_late:'Selesai terlambat',unknown:'Tidak diketahui'})[s]||'—'}
function reviewText(s:Task['reviewStatus']){return ({not_ready:'Menunggu penyelesaian',awaiting_review:'Menunggu review',approved:'Hasil disetujui',revision_requested:'Perlu tindak lanjut'})[s]||'—'}

// Only displayed for a specifically addressed, already acknowledged distribution.
export function BuatDisposisi({distributionId,received}:{distributionId:string;received:boolean}){
 const [candidates,setCandidates]=useState<Candidate[]>([]),[assignee,setAssignee]=useState(''),[instruction,setInstruction]=useState(''),[due,setDue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[authorized,setAuthorized]=useState(false)
 useEffect(()=>{setAuthorized(false);setCandidates([]);setAssignee('');setError('');if(!received)return
  let active=true
  request<{items:Candidate[]}>(`/api/v1/urmin/distribution-inbox/${distributionId}/disposition-candidates`).then(v=>{if(active){setCandidates(v.items);setAuthorized(true)}}).catch(()=>{if(active)setAuthorized(false)})
  return()=>{active=false}
 },[distributionId,received])
 async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');setMessage('');try{
  await request(`/api/v1/urmin/distribution-inbox/${distributionId}/dispositions`,'POST',{assigneeId:assignee,instruction,dueDate:due});setMessage('Disposisi dicatat dan muncul di Tugas Disposisi penerima.');setInstruction('');setDue('');setAssignee('')
 }catch(e){setError(String(e))}finally{setBusy(false)}}
 if(!received||!authorized)return <p className="r3b-muted">Disposisi tersedia bagi penerima setelah konfirmasi surat dan permission <code>urmin.disposisi.issue</code> diaktifkan.</p>
 return <div className="r3b-wrap"><h4 className="sm-history-title">Beri Disposisi · Unit penerima</h4>
  {error&&<FloatingToast message={error} kind="error"/>}{message&&<FloatingToast message={message} kind="success"/>}
  <form className="r3b-action" onSubmit={submit}>
   <label>Petugas yang ditunjuk<select required className="rm-input" value={assignee} onChange={e=>setAssignee(e.target.value)}><option value="">Pilih petugas satu unit</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <label>Batas waktu<input required type="date" className="rm-input" value={due} onChange={e=>setDue(e.target.value)}/></label>
   <label className="r3b-wide">Arahan / instruksi<textarea required rows={3} minLength={8} maxLength={1000} className="rm-input" value={instruction} onChange={e=>setInstruction(e.target.value)} placeholder="Tuliskan tindakan yang harus diselesaikan"/></label>
   <button className="btn primary" disabled={busy||!assignee||instruction.trim().length<8||!due}>{busy?'Menyimpan...':'Terbitkan Disposisi'}</button>
  </form>
  {candidates.length===0&&<p className="r3b-muted">Belum ada petugas eligible. Aktifkan permission <code>urmin.disposisi.execute</code> pada role penerima, beserta grant unit aktif.</p>}
 </div>
}

export default function TugasDisposisi({currentUserId,initialID}:{currentUserId:string;initialID?:string}){
 const [forwardPeople,setForwardPeople]=useState<Candidate[]|null>(null),[forwardTo,setForwardTo]=useState(''),[forwardInstruction,setForwardInstruction]=useState(''),[forwardDue,setForwardDue]=useState(''),[forwardBusy,setForwardBusy]=useState(false)
 const [items,setItems]=useState<Task[]>([]),[pending,setPending]=useState(0),[overdue,setOverdue]=useState(0),[selected,setSelected]=useState(''),[events,setEvents]=useState<History[]>([]),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('')
 const load=useCallback(async()=>{setLoading(true);try{const data=await request<{items:Task[];pending:number;overdue:number}>('/api/v1/urmin/dispositions/');setItems(data.items);setPending(data.pending);setOverdue(data.overdue)}finally{setLoading(false)}},[])
 useEffect(()=>{load().catch(e=>setError(String(e)))},[load])
 useEffect(()=>{if(initialID&&items.some(t=>t.id===initialID)&&selected!==initialID){void details(initialID)}},[initialID,items,selected])
 async function details(id:string){setSelected(id);setForwardPeople(null);setForwardTo('');setForwardInstruction('');setForwardDue('');try{
  const r=await request<{events:History[]}>(`/api/v1/urmin/dispositions/${id}/history`);setEvents(r.events)
  const t=items.find(t=>t.id===id)
  if(t && t.assigneeId===currentUserId && t.status==='in_progress' && t.depth<2){
   const candidates=await request<{items:Candidate[]}>(`/api/v1/urmin/dispositions/${id}/forward-candidates`).catch(()=>null)
   if(candidates)setForwardPeople(candidates.items)
  }
 }catch(e){setError(String(e))}}
 async function review(t:Task,decision:'approved'|'revision_requested'){
  setBusy(true);setMessage('');setError('');try{
   await request(`/api/v1/urmin/dispositions/${t.id}/review`,'POST',{decision,reason,version:t.version});
   setReason('');await load();await details(t.id);
   setMessage(decision==='approved'?'Hasil tindak lanjut disetujui.':'Review ditandai perlu tindak lanjut; buat disposisi baru jika diperlukan.');
  }catch(e){setError(String(e))}finally{setBusy(false)}
 }
 async function change(t:Task,complete:boolean){setBusy(true);setMessage('');setError('');try{await request(`/api/v1/urmin/dispositions/${t.id}/${complete?'complete':'accept'}`,'POST',{reason,version:t.version});setReason('');await load();await details(t.id);setMessage(complete?'Tindak lanjut ditandai selesai.':'Disposisi diterima dan mulai dikerjakan.')}catch(e){setError(String(e))}finally{setBusy(false)}}
 async function forward(t:Task){setForwardBusy(true);setError('');setMessage('');try{
   await request(`/api/v1/urmin/dispositions/${t.id}/forward`,'POST',{assigneeId:forwardTo,instruction:forwardInstruction,dueDate:forwardDue,version:t.version});
   setForwardPeople(null);setForwardInstruction('');setForwardDue('');setForwardTo('');await load();setSelected('');
   setMessage('Disposisi turunan diterbitkan. Tugas induk menunggu penyelesaian dan review turunannya.')
  }catch(e){setError(String(e))}finally{setForwardBusy(false)}}
 const selectedTask=items.find(t=>t.id===selected)
 return <div className="r3b-wrap"><div className="sm-top-note"><strong>Disposisi & Tindak Lanjut</strong><span>{pending} tugas aktif · {overdue} terlambat · penugasan eksplisit, sesuai RBAC/ABAC</span></div>
  {error&&<FloatingToast message={error} kind="error"/>}{message&&<FloatingToast message={message} kind="success"/>}
  <section className="panel sm-panel"><div className="r3b-toolbar"><button className="btn" onClick={()=>load().catch(e=>setError(String(e)))}>Muat Ulang Tugas</button></div><div className="table-scroll"><table className="data-table"><thead><tr><th>Surat</th><th>Petugas</th><th>Tenggat</th><th>Status</th><th>SLA</th><th>Review</th></tr></thead><tbody>{items.map(t=><tr key={t.id} {...clickRow(()=>details(t.id),{label:`Buka detail disposisi ${t.letterNumber}`})}><td><strong>{t.depth>0?`${"↳ ".repeat(t.depth)}Turunan L${t.depth} · `:""}{t.letterNumber}</strong><small style={{display:'block'}}>{t.subject}</small></td><td>{t.assigneeName}</td><td>{t.dueDate}</td><td><span className={`r3c-status ${t.status}`}>{statusText(t.status)}</span></td><td><span className={`r3d-sla ${t.slaStatus}`}>{slaText(t.slaStatus)}</span></td><td>{reviewText(t.reviewStatus)}</td></tr>)}</tbody></table></div>{!loading&&items.length===0&&<p className="sm-empty">Belum ada disposisi untuk akun ini atau grant telah kedaluwarsa.</p>}</section>
  {selectedTask&&<section className="panel sm-panel"><div className="sm-section-title"><div><span className="eyebrow">DETAIL DISPOSISI</span><h3>{selectedTask.letterNumber}</h3><p>{selectedTask.issuerName} → {selectedTask.assigneeName} · {selectedTask.unit}</p></div><span className={`r3c-status ${selectedTask.status}`}>{statusText(selectedTask.status)}</span></div>
   <dl className="sm-details"><div><dt>Status SLA</dt><dd><span className={`r3d-sla ${selectedTask.slaStatus}`}>{slaText(selectedTask.slaStatus)}</span></dd></div><div><dt>Review pemberi tugas</dt><dd>{reviewText(selectedTask.reviewStatus)}</dd></div>{selectedTask.reviewReason&&<div className="sm-span"><dt>Catatan review</dt><dd>{selectedTask.reviewReason}</dd></div>}<div><dt>Hierarki</dt><dd>{selectedTask.parentTaskId?`Turunan level ${selectedTask.depth}`:"Disposisi utama"}</dd></div>{selectedTask.parentTaskId&&<div><dt>Induk</dt><dd><button className="btn" onClick={()=>details(selectedTask.parentTaskId!)}>Lihat tugas induk</button></dd></div>}<div><dt>Klasifikasi</dt><dd>{selectedTask.classification}</dd></div><div><dt>Tenggat</dt><dd>{selectedTask.dueDate}</dd></div><div className="sm-span"><dt>Arahan</dt><dd>{selectedTask.instruction}</dd></div>{selectedTask.completionNote&&<div className="sm-span"><dt>Hasil tindak lanjut</dt><dd>{selectedTask.completionNote}</dd></div>}</dl>
   <h4 className="sm-history-title">Timeline</h4><div className="sm-history">{events.map((ev,i)=><div className="sm-history-row" key={i}><span className="sm-history-dot"/><div><strong>{ev.action==='issued'?'Diterbitkan':ev.action==='accepted'?'Diterima':ev.action==='completed'?'Diselesaikan':ev.action==='approved'?'Disetujui':'Perlu tindak lanjut'}</strong><small>{ev.actor} · {fmt(ev.at)}</small><p>{ev.reason}</p></div></div>)}</div>
   {selectedTask.assigneeId===currentUserId && selectedTask.status!=='completed'&&<div className="r3b-action"><label className="r3b-wide">{selectedTask.status==='pending'?'Keterangan penerimaan':'Hasil tindak lanjut'}<textarea className="rm-input" rows={2} value={reason} onChange={e=>setReason(e.target.value)} minLength={8} maxLength={1000}/></label><button className="btn primary" disabled={busy||reason.trim().length<8} onClick={()=>change(selectedTask,selectedTask.status==='in_progress')}>{busy?'Menyimpan...':selectedTask.status==='pending'?'Terima Tugas':'Selesaikan Tugas'}</button><p className="r3b-muted">Hanya penerima tugas yang berwenang dapat mengubah status. Hanya penerima tugas yang dapat mengubah status.</p></div>}
   {selectedTask.assigneeId===currentUserId && selectedTask.status==='in_progress' && selectedTask.depth<2 && forwardPeople!==null &&<form className="r3b-action" onSubmit={e=>{e.preventDefault();forward(selectedTask)}}>
    <h4 className="sm-history-title r3b-wide">Teruskan Disposisi · Level {selectedTask.depth+1}</h4>
    <p className="r3b-muted r3b-wide">Khusus penerima tugas dengan izin <code>urmin.disposisi.forward</code>. Petugas tetap dalam unit dan batas waktu anak tidak melewati induk. Induk baru dapat diselesaikan setelah semua turunan selesai dan direview.</p>
    <label>Petugas tujuan<select className="rm-input" required value={forwardTo} onChange={e=>setForwardTo(e.target.value)}><option value="">Pilih petugas</option>{forwardPeople.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <label>Tenggat (maks. {selectedTask.dueDate})<input className="rm-input" required type="date" max={selectedTask.dueDate} value={forwardDue} onChange={e=>setForwardDue(e.target.value)}/></label>
    <label className="r3b-wide">Instruksi turunan<textarea className="rm-input" rows={2} required minLength={8} maxLength={1000} value={forwardInstruction} onChange={e=>setForwardInstruction(e.target.value)}/></label>
    <button type="submit" className="btn primary" disabled={forwardBusy||!forwardTo||forwardInstruction.trim().length<8||!forwardDue}>{forwardBusy?'Memproses...':'Teruskan ke Petugas'}</button>
    {forwardPeople.length===0&&<p className="r3b-muted">Belum ada petugas berizin yang dapat dipilih untuk penerusan.</p>}
   </form>}
   {selectedTask.issuerId===currentUserId && selectedTask.status==='completed' && selectedTask.reviewStatus==='awaiting_review'&&<div className="r3b-action r3d-review"><label className="r3b-wide">Catatan review (minimal 8 karakter)<textarea className="rm-input" rows={2} value={reason} onChange={e=>setReason(e.target.value)} minLength={8} maxLength={1000} placeholder="Alasan persetujuan atau arahan perbaikan"/></label><button className="btn primary" disabled={busy||reason.trim().length<8} onClick={()=>review(selectedTask,'approved')}>Setujui Hasil</button><button className="btn" disabled={busy||reason.trim().length<8} onClick={()=>review(selectedTask,'revision_requested')}>Perlu Tindak Lanjut</button><p className="r3b-muted r3b-wide">Hanya pemberi tugas dengan permission <code>urmin.disposisi.review</code> yang dapat mereview. Keputusan final dan dicatat dalam audit; tindak lanjut baru diterbitkan sebagai disposisi baru.</p></div>}
   {selectedTask.depth===0&&<SubmitFinalR3D3 taskId={selectedTask.id} version={selectedTask.version} issuerId={selectedTask.issuerId} currentUserId={currentUserId} reviewStatus={selectedTask.reviewStatus} status={selectedTask.status}/>}
  </section>}<LeadershipMonitorR3D3/></div>
}

// Monitoring deliberately requires Urmin read PLUS disposition read permission.
// A 404 means the user does not have tracking authority, not that data is public.
export function MonitoringDisposisi({incomingId}:{incomingId:string}){
 const [tasks,setTasks]=useState<Task[]|null>(null)
 useEffect(()=>{let active=true;setTasks(null);request<{items:Task[]}>(`/api/v1/urmin/surat-masuk/${incomingId}/disposition-tracking`).then(r=>{if(active)setTasks(r.items)}).catch(()=>{})
  return()=>{active=false}},[incomingId])
 if(!tasks)return null
 return <section className="r3b-wrap"><h4 className="sm-history-title">Monitoring Disposisi <small>berdasarkan izin baca disposisi</small></h4>{tasks.length===0?<p className="r3b-muted">Belum ada tindak lanjut.</p>:<div className="r3b-files">{tasks.map(t=><div className="r3b-delivery" key={t.id}><strong>{t.parentTaskId?`↳ Level ${t.depth} · `:""}{t.assigneeName} · {t.unit}</strong><small>{t.issuerName} · tenggat {t.dueDate}</small><p>{t.instruction}</p><span className={`r3c-status ${t.status}`}>{statusText(t.status)}</span>{t.completionNote&&<p>{t.completionNote}</p>}</div>)}</div>}</section>
}
