import { useCallback, useEffect, useState, type FormEvent } from 'react'

type Progress={totalTasks:number;reviewedApproved:number;progressPercent:number;readyForSubmission:boolean}
type Approval={status:'not_submitted'|'pending'|'approved'|'revision_requested';version:number;submittedAt?:string;decidedAt?:string;decisionReason?:string}
type Case={rootTaskId:string;letterNumber:string;subject:string;unit:string;classification:string;issuerName:string;assigneeName:string;dueDate:string;slaStatus:string;approvalStatus:Approval['status'];progress:Progress;version:number}
const BASE='/api/v1/urmin/dispositions'
async function get<T>(path:string):Promise<T>{const res=await fetch(`${BASE}${path}`,{cache:'no-store',credentials:'same-origin'});if(!res.ok)throw new Error(res.status===403?'not_authorized':`HTTP ${res.status}`);return res.json() as Promise<T>}
async function submit<T>(path:string,body:Record<string,unknown>):Promise<T>{const csrf=await fetch('/api/v1/auth/csrf',{cache:'no-store',credentials:'same-origin'});if(!csrf.ok)throw new Error('Sesi keamanan tidak tersedia');const token:{csrfToken:string}=await csrf.json();const res=await fetch(`${BASE}${path}`,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json','X-CSRF-Token':token.csrfToken},body:JSON.stringify(body)});if(!res.ok){const b:{error?:string}=await res.json().catch(()=>({}));throw new Error(res.status===409?'Data berubah; muat ulang sebelum melanjutkan.':`${res.status}: ${b.error||'Akses atau layanan tidak tersedia'}`)}return res.json() as Promise<T>}
const approvalText:Record<string,string>={not_submitted:'Belum diajukan',pending:'Menunggu Kabagrenmin',approved:'Disetujui Kabagrenmin',revision_requested:'Perlu tindak lanjut'}
function ProgressBar({value}:{value:number}){return <div style={{display:'flex',alignItems:'center',gap:10,minWidth:130}}><div role="progressbar" aria-label="Progres proses surat" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} style={{height:7,background:'var(--border)',borderRadius:20,flex:1,overflow:'hidden'}}><div style={{width:`${value}%`,background:'#d5ad67',height:'100%'}}/></div><strong style={{fontSize:12,fontVariantNumeric:'tabular-nums'}}>{value}%</strong></div>}

export function SubmitFinalR3D3({taskId,version,issuerId,currentUserId,reviewStatus,status}:{taskId:string;version:number;issuerId:string;currentUserId:string;reviewStatus:string;status:string}){
 const [info,setInfo]=useState<{approval:Approval;progress:Progress}|null>(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
 const load=useCallback(()=>get<{approval:Approval;progress:Progress}>(`/${taskId}/final-status`).then(setInfo).catch(()=>setInfo(null)),[taskId])
 useEffect(()=>{setInfo(null);setReason('');setMessage('');setError('');void load()},[load])
 if(issuerId!==currentUserId)return null
 return <section className="r3b-wrap" aria-label="Pengajuan approval pimpinan"><h4 className="sm-history-title">Approval Akhir Kabagrenmin</h4>
  {info?<><ProgressBar value={info.progress.progressPercent}/><p className="r3b-muted">{info.progress.reviewedApproved} dari {info.progress.totalTasks} tugas telah selesai dan direview setuju. Status: <strong>{approvalText[info.approval.status]||info.approval.status}</strong>.</p>
   {info.approval.decisionReason&&<p className="r3b-muted">Catatan pimpinan: {info.approval.decisionReason}</p>}
   {info.approval.status==='not_submitted'&&status==='completed'&&reviewStatus==='approved'&&<form className="r3b-action" onSubmit={async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');setMessage('');try{await submit(`/${taskId}/submit-final`,{reason,version});setReason('');setMessage('Pengajuan review akhir telah dikirim ke pimpinan.');await load()}catch(err){setError(String(err))}finally{setBusy(false)}}}>
    <label className="r3b-wide">Alasan pengajuan (8–1000 karakter)<textarea className="rm-input" minLength={8} maxLength={1000} required rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button type="submit" className="btn primary" disabled={busy||reason.trim().length<8||!info.progress.readyForSubmission}>{busy?'Mengajukan...':'Ajukan Approval Akhir'}</button>
    <p className="r3b-muted">Memerlukan permission <code>urmin.disposisi.final.submit</code>. Pengajuan baru tersedia setelah seluruh tugas disetujui.</p>
   </form>}
  </>:<p className="r3b-muted">Status approval belum dapat dimuat atau akses belum diaktifkan.</p>}
  {error&&<p className="rm-alert" role="alert">{error}</p>}{message&&<p className="rm-success" role="status">{message}</p>}
 </section>
}

export function LeadershipMonitorR3D3(){
 const [items,setItems]=useState<Case[]|null>(null),[selected,setSelected]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[asOf,setAsOf]=useState(''),[limited,setLimited]=useState(false)
 const load=useCallback(async()=>{try{const data=await get<{items:Case[];updatedAt:string;limited:boolean}>('/leadership');setItems(data.items);setAsOf(data.updatedAt);setLimited(data.limited)}catch(e){if(String(e).includes('not_authorized')){setItems(null)}else{setError('Monitoring belum dapat dimuat.')}}},[])
 useEffect(()=>{void load();const timer=window.setInterval(()=>{void load()},60000);return()=>window.clearInterval(timer)},[load])
 if(!items)return null
 const chosen=items.find(c=>c.rootTaskId===selected)
 const pending=items.filter(c=>c.approvalStatus==='pending').length
 const approved=items.filter(c=>c.approvalStatus==='approved').length
 const overdue=items.filter(c=>c.slaStatus==='overdue').length
 const avg=items.length?Math.round(items.reduce((v,c)=>v+c.progress.progressPercent,0)/items.length):0
 async function decide(decision:'approved'|'revision_requested'){
  if(!chosen)return;setBusy(true);setError('');try{await submit(`/${chosen.rootTaskId}/decide-final`,{decision,reason,version:chosen.version});setReason('');setSelected('');await load()}catch(e){setError(String(e))}finally{setBusy(false)}
 }
 return <section className="panel sm-panel" aria-label="Monitoring Approval Kabagrenmin" style={{marginTop:20}}>
  <div className="sm-section-title"><div><span className="eyebrow">MONITORING PIMPINAN · LIVE DATABASE</span><h3>Approval & Progres Disposisi</h3><p>Hanya surat dari unit/klasifikasi dengan grant Kabagrenmin aktif. Refresh otomatis setiap 60 detik.</p></div><button type="button" className="btn" onClick={()=>{void load()}}>Refresh Sekarang</button></div>
  <div className="r3d3-kpis"><div><strong>{items.length}</strong><small>Disposisi Utama Ditampilkan</small></div><div><strong>{pending}</strong><small>Menunggu Approval</small></div><div><strong>{approved}</strong><small>Disetujui Final</small></div><div><strong>{overdue}</strong><small>Lewat Tenggat</small></div><div><strong>{avg}%</strong><small>Rerata Progres Terlihat</small></div></div>
  <p className="r3b-muted">Progres = tugas selesai dan disetujui / seluruh tugas × 90%; menjadi 100% hanya setelah approval final. Dihitung langsung dari database, bukan target atau input manual. {limited?'Daftar dibatasi pada 151 kasus terbaru; angka bukan total database.':''} {asOf&&`Diperbarui: ${new Date(asOf).toLocaleString('id-ID')}`}</p>
  <div className="table-scroll"><table className="data-table"><thead><tr><th>Surat / Unit</th><th>Penanggung Jawab</th><th>Tenggat</th><th>Progres</th><th>Approval Final</th><th>Aksi</th></tr></thead><tbody>{items.map(c=><tr key={c.rootTaskId}><td><strong>{c.letterNumber}</strong><small style={{display:'block'}}>{c.subject} · {c.unit}</small></td><td>{c.assigneeName}</td><td>{c.dueDate}<small style={{display:'block'}}>{c.slaStatus==='overdue'?'Lewat SLA':c.slaStatus}</small></td><td><ProgressBar value={c.progress.progressPercent}/><small>{c.progress.reviewedApproved}/{c.progress.totalTasks} disetujui</small></td><td>{approvalText[c.approvalStatus]||c.approvalStatus}</td><td>{c.approvalStatus==='pending'?<button type="button" className="btn" onClick={()=>{setSelected(c.rootTaskId);setReason('')}}>Review</button>:<span>—</span>}</td></tr>)}</tbody></table></div>
  {items.length===0&&<p className="r3b-muted">Belum ada surat dengan disposisi yang boleh dimonitor.</p>}
  {chosen&&chosen.approvalStatus==='pending'&&<div className="r3b-action r3d-review"><h4 className="sm-history-title r3b-wide">Keputusan Kabagrenmin — {chosen.letterNumber}</h4><p className="r3b-muted r3b-wide">Penerbit atau pelaksana disposisi tidak dapat menyetujui pekerjaannya sendiri. Keputusan sekali dan dicatat dalam audit.</p><label className="r3b-wide">Catatan keputusan (8–1000 karakter)<textarea className="rm-input" rows={2} minLength={8} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label><button type="button" className="btn primary" disabled={busy||reason.trim().length<8} onClick={()=>void decide('approved')}>Setujui Final</button><button type="button" className="btn" disabled={busy||reason.trim().length<8} onClick={()=>void decide('revision_requested')}>Minta Tindak Lanjut</button><button type="button" className="btn" onClick={()=>setSelected('')}>Batal</button></div>}
  {error&&<p role="alert" className="rm-alert">{error}</p>}
 </section>
}
