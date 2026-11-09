import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'

type User = {id:string;username:string;displayName:string;active:boolean;protected:boolean;forcePasswordChange?:boolean;primaryUnit:string;grants:{unitKey:string}[]}
type Candidate = {id:string;grantorId:string;grantorName:string;roleKey:string;unitKey:string;classificationLimit:'biasa'|'penting';expiresAt:string|null;permissions:string[]}
type Delegation = {id:string;grantorName:string;granteeName:string;roleKey:string;unitKey:string;scope:'assigned'|'unit';classificationLimit:'biasa'|'penting';permissions:string[];reason:string;createdAt:string;expiresAt:string;revokedAt:string|null;version:number}
const formatDate=(value:string)=>new Date(value).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short'})
function localInputDate(iso:string){const d=new Date(iso);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
async function api<T>(path:string,method:'GET'|'POST'='GET',body?:unknown):Promise<T>{
 const headers:Record<string,string>={}
 if(method==='POST'){
  const r=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
  if(!r.ok)throw Error('Tidak bisa mengambil CSRF token')
  const token:{csrfToken:string}=await r.json()
  headers['X-CSRF-Token']=token.csrfToken;headers['Content-Type']='application/json'
 }
 const res=await fetch(path,{method,headers,credentials:'same-origin',cache:'no-store',body:body===undefined?undefined:JSON.stringify(body)})
 if(!res.ok){const details:{error?:string}=await res.json().catch(()=>({}));if(res.status===401)throw Error('Sesi berakhir. Login kembali.');if(res.status===403)throw Error('Akses ditolak.');if(res.status===409)throw Error('Data grant atau delegasi berubah. Muat ulang terlebih dahulu.');throw Error(`Permintaan gagal (${res.status} · ${details.error||'unavailable'})`)}
 return res.json() as Promise<T>
}
export default function DelegationManagement(){
 const [users,setUsers]=useState<User[]>([])
 const [candidates,setCandidates]=useState<Candidate[]>([])
 const [items,setItems]=useState<Delegation[]>([])
 const [sourceID,setSourceID]=useState(''),[recipientID,setRecipientID]=useState('')
 const [scope,setScope]=useState<'assigned'|'unit'>('assigned'),[classification,setClassification]=useState<'biasa'|'penting'>('biasa')
 const [permissions,setPermissions]=useState<string[]>([])
 const [expires,setExpires]=useState(()=>localInputDate(new Date(Date.now()+24*60*60*1000).toISOString()))
 const [reason,setReason]=useState('')
 const [revoking,setRevoking]=useState<Delegation|null>(null),[revokeReason,setRevokeReason]=useState('')
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState('')
 const reload=useCallback(async()=>{
  const [u,c,d]=await Promise.all([api<{users:User[]}>('/api/v1/admin/users'),api<{candidates:Candidate[]}>('/api/v1/admin/delegation-candidates'),api<{delegations:Delegation[]}>('/api/v1/admin/delegations')])
  setUsers(u.users);setCandidates(c.candidates);setItems(d.delegations)
 },[])
 useEffect(()=>{reload().catch(e=>setError(e instanceof Error?e.message:'Tidak dapat memuat delegasi')).finally(()=>setLoading(false))},[reload])
 const source=useMemo(()=>candidates.find(c=>c.id===sourceID),[sourceID,candidates])
 const recipients=useMemo(()=>users.filter(u=>u.active&&!u.protected&&!u.forcePasswordChange&&u.id!==source?.grantorId&&!!source?.unitKey&&u.grants.some(g=>g.unitKey===source.unitKey)),[users,source])
 function chooseSource(id:string){setSourceID(id);setRecipientID('');setPermissions([]);setScope('assigned');setClassification('biasa');setReason('')}
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!source||busy)return
  setBusy(true);setError('');setMessage('')
  try{
   const expiry=new Date(expires)
   if(!Number.isFinite(expiry.getTime()))throw Error('Isi tanggal akhir yang valid')
   if(permissions.length===0)throw Error('Pilih minimal satu permission yang didelegasikan')
   await api('/api/v1/admin/delegations','POST',{sourceGrantId:sourceID,granteeId:recipientID,scope,classificationLimit:classification,permissionKeys:permissions,expiresAt:expiry.toISOString(),reason})
   await reload();setMessage('Delegasi tersimpan. Sesi penerima dicabut agar login ulang; akses efektif tetap diperiksa backend berdasarkan grant sumber.')
   setRecipientID('');setSourceID('');setPermissions([]);setReason('')
  }catch(e){setError(e instanceof Error?e.message:'Gagal menyimpan delegasi')}
  finally{setBusy(false)}
 }
 async function revoke(){if(!revoking||busy)return;setBusy(true);setError('');setMessage('')
  try{await api(`/api/v1/admin/delegations/${encodeURIComponent(revoking.id)}/revoke`,'POST',{version:revoking.version,reason:revokeReason})
   await reload();setRevoking(null);setRevokeReason('');setMessage('Delegasi dicabut dan session penerima dibatalkan.')
  }catch(e){setError(e instanceof Error?e.message:'Gagal mencabut delegasi')}finally{setBusy(false)}
 }
 const now=Date.now();const activeCount=items.filter(x=>!x.revokedAt&&new Date(x.expiresAt).getTime()>now).length
 return <div className="rm-root dm-root">
  <div className="page-heading"><span className="eyebrow">IDENTITY & ACCESS · R2C2B</span><h1>Delegasi Kewenangan</h1><p>Delegasi sementara berbatas unit, waktu dan permission. Diatur melalui Go API dengan jejak audit PostgreSQL.</p></div>
  <div className="rm-notice"><strong>Aturan:</strong> hanya grant <b>unit</b> yang aktif dapat menjadi sumber. Penerima wajib terdaftar pada unit yang sama. Akses delegasi tidak dapat melampaui role, klasifikasi atau masa berlaku sumber. Approval, ekspor, audit dan administrasi identitas tidak dapat didelegasikan pada fase ini. Enforcement pada dokumen nyata masuk R3.</div>
  {error&&<div className="rm-alert" role="alert">{error}</div>}{message&&<div className="rm-success" role="status">{message}</div>}
  <div className="dm-metrics"><div className="metric-card"><div className="metric-top"><span>Total delegasi tercatat</span></div><div className="metric-value">{items.length}</div><div className="metric-hint">Termasuk yang sudah dicabut dan berakhir</div></div><div className="metric-card"><div className="metric-top"><span>Belum dicabut & belum berakhir</span></div><div className="metric-value">{activeCount}</div><div className="metric-hint">Validitas grant sumber tetap diperiksa setiap akses</div></div></div>
  <div className="dm-columns">
   <section className="panel rm-editor"><div className="rm-editor-head"><div><span className="eyebrow">KEWENANGAN SEMENTARA</span><h2>Buat Delegasi</h2><small>Catatan dan batas waktu wajib diisi</small></div></div>
    <form className="dm-form" onSubmit={submit}>
     <label>Grant sumber (role · unit · pemberi)
      <select className="rm-input" required value={sourceID} onChange={e=>chooseSource(e.target.value)}><option value="">Pilih grant aktif cakupan unit</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.grantorName} · {c.roleKey} · {c.unitKey}</option>)}</select>
     </label>
     {source&&<div className="dm-source"><strong>Sumber: {source.roleKey} · {source.unitKey}</strong><span>Klasifikasi maksimum: {source.classificationLimit} {source.expiresAt?`· hingga ${formatDate(source.expiresAt)}`:'· tanpa expiry sumber'}</span></div>}
     <label>Penerima delegasi
      <select className="rm-input" required disabled={!source} value={recipientID} onChange={e=>setRecipientID(e.target.value)}><option value="">Pilih pengguna di unit yang sama</option>{recipients.map(u=><option value={u.id} key={u.id}>{u.displayName} (@{u.username})</option>)}</select>
     </label>
     {source&&recipients.length===0&&<p className="dm-hint">Belum ada penerima yang eligible. Berikan penempatan unit melalui User Management terlebih dahulu.</p>}
     <div className="dm-split"><label>Cakupan delegasi<select value={scope} className="rm-input" onChange={e=>setScope(e.target.value as 'assigned'|'unit')}><option value="assigned">Assigned only</option><option value="unit">Unit</option></select></label><label>Klasifikasi<select value={classification} className="rm-input" onChange={e=>setClassification(e.target.value as 'biasa'|'penting')}><option value="biasa">Biasa</option>{source?.classificationLimit==='penting'&&<option value="penting">Penting</option>}</select></label></div>
     <fieldset className="dm-permissions" disabled={!source}><legend>Permission yang didelegasikan ({permissions.length})</legend>{source?.permissions.map(p=><label key={p} className="dm-check"><input type="checkbox" checked={permissions.includes(p)} onChange={e=>setPermissions(prev=>e.target.checked?[...prev,p]:prev.filter(x=>x!==p))}/><span>{p}</span></label>)}{!source&&<p className="dm-hint">Pilih grant sumber terlebih dahulu.</p>}</fieldset>
     <label>Berlaku sampai (maksimum 14 hari)
      <input className="rm-input" type="datetime-local" value={expires} onChange={e=>setExpires(e.target.value)} required min={localInputDate(new Date(Date.now()+60_000).toISOString())} max={localInputDate(new Date(Date.now()+14*86400000-60000).toISOString())}/>
     </label>
     <label>Alasan / dasar delegasi<textarea className="rm-input" rows={3} minLength={8} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Contoh: penugasan sementara selama kepala unit menjalankan kegiatan luar" required/></label>
     <button className="btn primary" type="submit" disabled={busy||!source||!recipientID||permissions.length===0||reason.trim().length<8}>{busy?'Memproses...':'Simpan Delegasi'}</button>
    </form>
   </section>
   <section className="panel rm-editor"><div className="rm-editor-head"><div><span className="eyebrow">MONITORING & AUDIT</span><h2>Riwayat Delegasi</h2><small>{loading?'Memuat...':`${items.length} catatan tersimpan di PostgreSQL`}</small></div><button className="btn" onClick={()=>{setError('');reload().catch(e=>setError(e instanceof Error?e.message:'Gagal menyegarkan'))}} disabled={busy}>Refresh</button></div>
    {items.length===0&&!loading?<div className="empty-state"><h3>Belum ada delegasi</h3><p>Delegasi yang tersimpan akan muncul di sini, lengkap dengan masa berlaku dan pencabutannya.</p></div>:<div className="dm-list">{items.map(d=>{const revoked=!!d.revokedAt,expired=new Date(d.expiresAt).getTime()<=now;return <article key={d.id} className="dm-item"><div className="dm-item-top"><strong>{d.grantorName} → {d.granteeName}</strong><span className={`pill ${revoked?'neutral':expired?'amber':'green'}`}>{revoked?'Dicabut':expired?'Kedaluwarsa':'Belum dicabut'}</span></div><p>{d.roleKey} · {d.unitKey} · {d.scope} · {d.classificationLimit}</p><div className="dm-tags">{d.permissions.map(p=><code key={p}>{p}</code>)}</div><small>Dibuat {formatDate(d.createdAt)} · Berakhir {formatDate(d.expiresAt)}</small><small>Alasan: {d.reason}</small>{!revoked&&!expired&&<button className="btn danger xs" type="button" disabled={busy} onClick={()=>{setRevoking(d);setRevokeReason('')}}>Cabut Delegasi</button>}</article>})}</div>}
   </section>
  </div>
  {revoking&&<div className="dm-overlay" role="presentation" onClick={()=>{if(!busy)setRevoking(null)}}><div className="dm-modal" role="dialog" aria-modal="true" aria-label="Konfirmasi cabut delegasi" onClick={e=>e.stopPropagation()}><div className="dm-modal-head"><div><h2>Cabut Delegasi</h2><p>{revoking.grantorName} → {revoking.granteeName}</p></div></div><div className="dm-modal-body"><p>Pencabutan berlaku segera pada pemeriksaan berikutnya. Session penerima juga dicabut.</p><label>Alasan pencabutan<textarea className="rm-input" rows={3} minLength={8} maxLength={500} value={revokeReason} onChange={e=>setRevokeReason(e.target.value)} required/></label></div><div className="dm-modal-foot"><button type="button" className="btn" onClick={()=>setRevoking(null)} disabled={busy}>Batal</button><button type="button" className="btn danger" onClick={revoke} disabled={busy||revokeReason.trim().length<8}>Cabut Sekarang</button></div></div></div>}
 </div>
}
