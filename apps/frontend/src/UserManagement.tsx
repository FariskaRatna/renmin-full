import { FloatingToast } from './UIFeedback'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'

type Grant = {roleKey:string;unitKey:string;scope:'own'|'assigned'|'unit';classificationLimit:'biasa'|'penting';expiresAt:string|null}
type User = {id:string;username:string;email:string;displayName:string;active:boolean;forcePasswordChange:boolean;version:number;protected:boolean;otpEnabled:boolean;primaryUnit:string;grants:Grant[]}
type Unit = {key:string;name:string;active:boolean}
type Role = {key:string;name:string;active:boolean;permissions:string[]}
type Audit = {id:number;key:string;type:string;subject:string;at:string;actor:string;reason:string}
type Draft = {email:string;displayName:string;active:boolean;version:number;primaryUnit:string;grants:Grant[]}
type Tab = 'profile'|'access'|'security'
type Mode = {kind:'create'}|{kind:'edit';id:string}
const emptyCreate = {username:'',email:'',displayName:'',reason:''}
const blankGrant:Grant = {roleKey:'',unitKey:'',scope:'assigned',classificationLimit:'biasa',expiresAt:null}
const scopes = [{key:'own',label:'Dibuat sendiri'},{key:'assigned',label:'Ditugaskan'},{key:'unit',label:'Satu unit'}] as const
const PAGE_SIZE = 10
const apiPath = '/api/v1/admin'

async function request<T>(path:string,method:'GET'|'POST'|'PATCH'|'PUT'='GET',body?:unknown):Promise<T>{
 const headers:Record<string,string> = {}
 if(method!=='GET'){
  const csrf = await fetch('/api/v1/auth/csrf',{cache:'no-store',credentials:'same-origin'})
  if(!csrf.ok)throw new Error('Gagal mengambil token CSRF. Silakan login kembali.')
  const data:{csrfToken:string} = await csrf.json()
  headers['X-CSRF-Token']=data.csrfToken
  headers['Content-Type']='application/json'
 }
 const res = await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers,body:body===undefined?undefined:JSON.stringify(body)})
 if(!res.ok){
  const fail:{error?:string} = await res.json().catch(()=>({}))
  if(res.status===409)throw new Error('Data sudah berubah atau duplikat. Muat ulang sebelum menyimpan.')
  if(res.status===403)throw new Error('Akses ditolak.')
  if(res.status===401)throw new Error('Sesi berakhir. Silakan login kembali.')
  throw new Error(`Permintaan gagal (${res.status} · ${fail.error||'unavailable'}).`)
 }
 return res.json() as Promise<T>
}
function draftOf(u:User):Draft {return {email:u.email,displayName:u.displayName,active:u.active,version:u.version,primaryUnit:u.primaryUnit,grants:u.grants.map(g=>({...g}))}}
function localDateTime(iso:string|null):string {if(!iso)return '';const d=new Date(iso);return Number.isNaN(d.getTime())?'':new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function initials(name:string){return name.trim().split(/\s+/).slice(0,2).map(x=>x.charAt(0).toUpperCase()).join('')||'U'}
function humanUnit(unitKey:string,units:Unit[]){return units.find(u=>u.key===unitKey)?.name||unitKey||'—'}
function useModalFocus(open:boolean,onClose:()=>void){
 const ref=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  if(!open)return
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
  const overflow=document.body.style.overflow
  document.body.style.overflow='hidden'
  const dialog=ref.current
  dialog?.querySelector<HTMLElement>('input:not([disabled]),button:not([disabled]),select:not([disabled])')?.focus()
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){event.preventDefault();onClose();return}
   if(event.key!=='Tab'||!dialog)return
   const elements=Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')).filter(el=>el.getClientRects().length>0)
   if(elements.length===0)return
   if(event.shiftKey && document.activeElement===elements[0]){event.preventDefault();elements[elements.length-1].focus()}
   else if(!event.shiftKey && document.activeElement===elements[elements.length-1]){event.preventDefault();elements[0].focus()}
  }
  document.addEventListener('keydown',onKey)
  return ()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',onKey);previous?.focus()}
 },[open,onClose])
 return ref
}

export default function UserManagement(){
 const [users,setUsers]=useState<User[]>([]),[units,setUnits]=useState<Unit[]>([]),[roles,setRoles]=useState<Role[]>([]),[audit,setAudit]=useState<Audit[]>([])
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [query,setQuery]=useState(''),[unitFilter,setUnitFilter]=useState('all'),[statusFilter,setStatusFilter]=useState('all'),[otpFilter,setOtpFilter]=useState('all'),[page,setPage]=useState(1)
 const [mode,setMode]=useState<Mode|null>(null),[tab,setTab]=useState<Tab>('profile')
 const [create,setCreate]=useState(emptyCreate),[draft,setDraft]=useState<Draft|null>(null),[reason,setReason]=useState('')
 const [otpSetting,setOtpSetting]=useState(true),[otpReason,setOtpReason]=useState(''),[adminConfirm,setAdminConfirm]=useState('')
 const [secret,setSecret]=useState<{username:string;password:string}|null>(null)
 const [auditOpen,setAuditOpen]=useState(false)
 const latestMode=useRef<Mode|null>(null);latestMode.current=mode
 const refresh=useCallback(async()=>{
  const [ud,unitData,roleData,ad]=await Promise.all([
   request<{users:User[]}>(`${apiPath}/users`),request<{units:Unit[]}>(`${apiPath}/units`),
   request<{roles:Role[]}>(`${apiPath}/roles`),request<{events:Audit[]}>(`${apiPath}/audit`)
  ])
  setUsers(ud.users);setUnits(unitData.units);setRoles(roleData.roles);setAudit(ad.events)
  return ud.users
 },[])
 useEffect(()=>{let mounted=true;void refresh().catch(e=>{if(mounted)setError(e instanceof Error?e.message:'Gagal memuat pengguna')}).finally(()=>{if(mounted)setLoading(false)});return()=>{mounted=false}},[refresh])
 const current=mode?.kind==='edit'?users.find(u=>u.id===mode.id):undefined
 const safeRoles=useMemo(()=>roles.filter(r=>r.active&&r.key!=='superadmin'&&!r.permissions.some(p=>p.startsWith('identity.')||p.startsWith('audit.'))),[roles])
 const filtered=useMemo(()=>users.filter(u=>{
  const haystack=`${u.username} ${u.displayName} ${u.email} ${u.grants.map(g=>g.roleKey).join(' ')}`.toLocaleLowerCase('id-ID')
  if(!haystack.includes(query.trim().toLocaleLowerCase('id-ID')))return false
  if(unitFilter!=='all'&&!u.grants.some(g=>g.unitKey===unitFilter)&&u.primaryUnit!==unitFilter)return false
  if(statusFilter==='active'&&!u.active||statusFilter==='inactive'&&u.active)return false
  if(otpFilter==='on'&&!(u.protected||u.otpEnabled)||otpFilter==='off'&&(u.protected||u.otpEnabled))return false
  return true
 }),[users,query,unitFilter,statusFilter,otpFilter])
 const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE)),safePage=Math.min(page,totalPages)
 const visible=filtered.slice((safePage-1)*PAGE_SIZE,safePage*PAGE_SIZE)
 const closeModal=useCallback(()=>{if(busy)return;setMode(null);setDraft(null);setCreate(emptyCreate);setReason('');setOtpReason('');setAdminConfirm('');setError('')},[busy])
 const modalRef=useModalFocus(mode!==null,closeModal)
 const secretRef=useModalFocus(secret!==null,()=>setSecret(null))
 function openCreate(){setError('');setMessage('');setCreate(emptyCreate);setReason('');setMode({kind:'create'});setTab('profile')}
 function openEdit(u:User,t:Tab='profile'){setError('');setMessage('');setMode({kind:'edit',id:u.id});setTab(t);setDraft(draftOf(u));setOtpSetting(u.protected?true:u.otpEnabled);setReason('');setOtpReason('');setAdminConfirm('')}
 function updateGrant(i:number,next:Partial<Grant>){setDraft(d=>d?{...d,grants:d.grants.map((g,j)=>i===j?{...g,...next}:g)}:d)}
 async function afterUpdate(id:string,notify:string){
  const all=await refresh()
  const changed=all.find(u=>u.id===id)
  if(changed&&latestMode.current?.kind==='edit'&&latestMode.current.id===id){setDraft(draftOf(changed));setOtpSetting(changed.protected?true:changed.otpEnabled)}
  setReason('');setOtpReason('');setAdminConfirm('');setMessage(notify)
 }
 async function createUser(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return
  setBusy(true);setError('');setMessage('')
  try{
   const payload={...create,username:create.username.trim().toLowerCase(),email:create.email.trim().toLowerCase(),displayName:create.displayName.trim(),reason:create.reason.trim()}
   const res=await request<{id:string;temporaryPassword:string}>(`${apiPath}/users`,'POST',payload)
   await refresh().catch(()=>{})
   setMode(null);setDraft(null);setCreate(emptyCreate);setSecret({username:payload.username,password:res.temporaryPassword})
  }catch(e){setError(e instanceof Error?e.message:'Gagal membuat user')}
  finally{setBusy(false)}
 }
 async function saveProfile(){if(!current||!draft||current.protected||busy)return
  if(reason.trim().length<8){setError('Alasan perubahan minimal 8 karakter.');return}
  setBusy(true);setError('');setMessage('')
  try{await request(`${apiPath}/users/${current.id}`,'PATCH',{email:draft.email.trim().toLowerCase(),displayName:draft.displayName.trim(),active:draft.active,version:draft.version,reason:reason.trim()});await afterUpdate(current.id,'Profil tersimpan. Sesi pengguna terdampak telah dicabut.')}
  catch(e){setError(e instanceof Error?e.message:'Gagal menyimpan profil')}
  finally{setBusy(false)}
 }
 async function saveAccess(){if(!current||!draft||current.protected||busy)return
  if(reason.trim().length<8){setError('Alasan perubahan minimal 8 karakter.');return}
  if(draft.grants.some(g=>!g.roleKey||!g.unitKey)){setError('Role dan unit pada setiap assignment wajib diisi.');return}
  if(draft.grants.length>30){setError('Maksimum 30 assignment per pengguna.');return}
  if(draft.grants.length>0&&!draft.primaryUnit){setError('Pilih unit utama dari assignment yang ada.');return}
  if(draft.grants.length===0&&draft.primaryUnit){setError('Kosongkan unit utama jika tidak memiliki assignment.');return}
  if(draft.grants.length>0&&!draft.grants.some(g=>g.unitKey===draft.primaryUnit)){setError('Unit utama harus cocok dengan salah satu assignment.');return}
  if(new Set(draft.grants.map(g=>`${g.unitKey}:${g.roleKey}`)).size!==draft.grants.length){setError('Role yang sama pada unit yang sama tidak boleh diduplikasi.');return}
  setBusy(true);setError('');setMessage('')
  try{await request(`${apiPath}/users/${current.id}/access`,'PUT',{version:draft.version,reason:reason.trim(),primaryUnit:draft.primaryUnit,grants:draft.grants});await afterUpdate(current.id,'Role dan cakupan akses berhasil disimpan. Sesi lama dicabut.')}
  catch(e){setError(e instanceof Error?e.message:'Gagal menyimpan assignment')}
  finally{setBusy(false)}
 }
 async function saveOTP(){if(!current||current.protected||busy)return
  if(current.otpEnabled===otpSetting)return
  if(otpReason.trim().length<8||adminConfirm.length<14){setError('Alasan minimal 8 karakter dan konfirmasi password Superadmin wajib.');return}
  setBusy(true);setError('');setMessage('')
  try{await request(`${apiPath}/users/${current.id}/otp`,'PATCH',{enabled:otpSetting,version:current.version,reason:otpReason.trim(),confirmPassword:adminConfirm});await afterUpdate(current.id,'Kebijakan OTP tersimpan, session dan challenge pengguna dicabut.')}
  catch(e){setError(e instanceof Error?e.message:'Gagal menyimpan OTP')}
  finally{setBusy(false)}
 }
 const verifiedUnitCount=users.filter(u=>u.grants.length>0).length
 return <div className="rm-root um-root r2d3-root">
  <div className="r2d3-title-row"><div className="page-heading"><span className="eyebrow">IDENTITY & ACCESS · R2D3</span><h1>User Management</h1><p>Kelola akun, role per unit, dan kebijakan OTP melalui tabel dan modal. Semua data berasal dari Go API.</p></div><button type="button" className="btn primary r2d3-add" disabled={loading} onClick={openCreate}>＋ Tambah Pengguna</button></div>
  <div className="r2d3-stats" aria-label="Ringkasan pengguna"><div className="panel r2d3-stat"><small>Akun dalam daftar (maks. 500)</small><strong>{users.length}</strong></div><div className="panel r2d3-stat"><small>Akun aktif</small><strong>{users.filter(u=>u.active).length}</strong></div><div className="panel r2d3-stat"><small>Sudah punya role unit</small><strong>{verifiedUnitCount}</strong></div><div className="panel r2d3-stat"><small>OTP aktif</small><strong>{users.filter(u=>u.protected||u.otpEnabled).length}</strong></div></div>
  <div className="rm-notice"><strong>Keamanan:</strong> Superadmin hanya mengelola pengguna dan role. Akun Superadmin dilindungi dan OTP selalu ON. Unit dan role tidak otomatis membuka dokumen; Go API menerapkan RBAC + ABAC per objek.</div>
  {message&&<FloatingToast message={message} kind="success"/>}
  {error&&!mode&&<div className="rm-alert" role="alert">{error}</div>}
  <section className="panel r2d3-users-panel" aria-label="Daftar pengguna">
   <div className="r2d3-table-head"><div><h2>Daftar Pengguna</h2><p>{filtered.length} dari {users.length} akun ditampilkan · maks. 500 akun terbaru dari API</p></div><button type="button" className="btn" disabled={loading||busy} onClick={()=>{setLoading(true);setError('');void refresh().catch(e=>setError(e instanceof Error?e.message:'Gagal memuat')).finally(()=>setLoading(false))}}>↻ Refresh</button></div>
   <div className="r2d3-filters"><label className="r2d3-search">Cari pengguna<input type="search" className="rm-input" placeholder="Nama, username, email, role..." aria-label="Cari pengguna" value={query} onChange={e=>{setQuery(e.target.value);setPage(1)}}/></label>
    <label>Unit<select className="rm-input" value={unitFilter} onChange={e=>{setUnitFilter(e.target.value);setPage(1)}}><option value="all">Semua unit</option>{units.map(u=><option key={u.key} value={u.key}>{u.name}</option>)}</select></label>
    <label>Status<select className="rm-input" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1)}}><option value="all">Semua status</option><option value="active">Aktif</option><option value="inactive">Nonaktif</option></select></label>
    <label>OTP<select className="rm-input" value={otpFilter} onChange={e=>{setOtpFilter(e.target.value);setPage(1)}}><option value="all">Semua kebijakan</option><option value="on">OTP ON</option><option value="off">OTP OFF</option></select></label>
   </div>
   <div className="r2d3-table-scroller"><table className="r2d3-table"><thead><tr><th scope="col">Pengguna</th><th scope="col">Unit utama</th><th scope="col">Role aktif</th><th scope="col">Status</th><th scope="col">OTP</th><th scope="col">Aksi</th></tr></thead>
    <tbody>{loading?<tr><td colSpan={6} className="r2d3-empty">Memuat data pengguna...</td></tr>:visible.length===0?<tr><td colSpan={6} className="r2d3-empty">Tidak ada pengguna sesuai pencarian atau filter.</td></tr>:visible.map(u=><tr key={u.id}>
     <td><div className="r2d3-identity"><span className={`r2d3-avatar${u.protected?' protected':''}`}>{initials(u.displayName)}</span><div><strong>{u.displayName}</strong><small>@{u.username} · {u.email}</small></div></div></td>
     <td>{u.protected?<span className="r2d3-muted">Administrasi sistem</span>:humanUnit(u.primaryUnit,units)}</td>
     <td><div className="r2d3-role-tags">{u.protected?<span className="r2d3-tag gold">Superadmin</span>:u.grants.length?u.grants.slice(0,2).map((g,i)=><span className="r2d3-tag" key={`${g.unitKey}-${g.roleKey}-${i}`} title={`Unit: ${g.unitKey} · Scope: ${g.scope}`}>{roles.find(r=>r.key===g.roleKey)?.name||g.roleKey}</span>):<span className="r2d3-muted">Belum ditetapkan</span>}{u.grants.length>2&&<span className="r2d3-tag">+{u.grants.length-2}</span>}</div></td>
     <td><span className={`r2d3-status ${u.active?'active':'inactive'}`}>{u.active?'Aktif':'Nonaktif'}</span></td>
     <td><span className={`r2d3-status ${u.protected||u.otpEnabled?'active':'inactive'}`}>{u.protected||u.otpEnabled?'ON':'OFF'}</span></td>
     <td><button type="button" className="btn r2d3-edit" onClick={()=>openEdit(u)} aria-label={`Lihat atau edit ${u.displayName}`}>{u.protected?'Lihat':'Edit'}</button></td>
    </tr>)}</tbody></table></div>
   <div className="r2d3-table-foot"><span>{filtered.length?`Menampilkan ${(safePage-1)*PAGE_SIZE+1}–${Math.min(safePage*PAGE_SIZE,filtered.length)} dari ${filtered.length}`:'Tidak ada hasil'}</span><div className="r2d3-pages"><button type="button" className="btn" disabled={safePage<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} aria-label="Halaman sebelumnya">←</button><span>Halaman {safePage} / {totalPages}</span><button type="button" className="btn" disabled={safePage>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} aria-label="Halaman berikutnya">→</button></div></div>
  </section>
  <section className="panel r2d3-audit-panel"><div className="r2d3-table-head"><div><h2>Audit perubahan akun</h2><p>100 event terbaru; tanpa password ataupun kode OTP</p></div><button type="button" className="btn" aria-expanded={auditOpen} onClick={()=>setAuditOpen(v=>!v)}>{auditOpen?'Tutup':'Tampilkan'} riwayat</button></div>{auditOpen&&<div className="um-audit-list">{audit.length===0?<p className="r2d3-muted">Belum ada event yang tersedia.</p>:audit.map(ev=><div key={ev.id}><strong>{ev.key}</strong><small>{new Date(ev.at).toLocaleString('id-ID')} · oleh {ev.actor} · {ev.type} {ev.subject}{ev.reason?' · Alasan: '+ev.reason:''}</small></div>)}</div>}</section>
  {mode&&<div className="r2d3-backdrop"><div ref={modalRef} className="r2d3-dialog" role="dialog" aria-modal="true" aria-labelledby="r2d3-dialog-title" tabIndex={-1}>
   <header className="r2d3-dialog-head"><div><span className="eyebrow">{mode.kind==='create'?'AKUN BARU':'PENGATURAN AKUN'}</span><h2 id="r2d3-dialog-title">{mode.kind==='create'?'Tambah Pengguna':current?.displayName||'Edit Pengguna'}</h2><p>{mode.kind==='create'?'Password sementara hanya akan tampil satu kali.':'Simpan setiap bagian secara terpisah dengan alasan yang jelas.'}</p></div><button type="button" className="r2d3-close" aria-label="Tutup modal" disabled={busy} onClick={closeModal}>✕</button></header>
   {mode.kind==='edit'&&<div className="r2d3-modal-tabs" role="tablist" aria-label="Pengaturan pengguna">{([{key:'profile',label:'Informasi Akun'},{key:'access',label:'Role & Unit'},{key:'security',label:'Security & OTP'}] as const).map(t=><button key={t.key} type="button" role="tab" aria-selected={tab===t.key} className={tab===t.key?'active':''} onClick={()=>{setTab(t.key);setError('');setMessage('');setReason('');setOtpReason('');setAdminConfirm('')}}>{t.label}</button>)}</div>}
   <div className="r2d3-dialog-body">
    {error&&<FloatingToast message={error} kind="error"/>}{message&&<FloatingToast message={message} kind="success"/>}
    {mode.kind==='create'?<form id="r2d3-create-form" onSubmit={createUser} className="r2d3-form"><div className="r2d3-fields"><label>Username *<input className="rm-input" autoComplete="off" required minLength={3} maxLength={64} pattern="[a-z][a-z0-9._-]{2,63}" value={create.username} onChange={e=>setCreate(c=>({...c,username:e.target.value.toLowerCase()}))} placeholder="contoh: operator_urmin"/></label><label>Nama lengkap *<input className="rm-input" required minLength={3} maxLength={160} value={create.displayName} onChange={e=>setCreate(c=>({...c,displayName:e.target.value}))} placeholder="Nama petugas"/></label><label className="r2d3-wide">Email untuk OTP *<input className="rm-input" type="email" required maxLength={254} value={create.email} onChange={e=>setCreate(c=>({...c,email:e.target.value.toLowerCase()}))} placeholder="alamat@email.id"/></label><label className="r2d3-wide">Alasan pembuatan akun *<textarea className="rm-input" required minLength={8} maxLength={500} rows={3} value={create.reason} onChange={e=>setCreate(c=>({...c,reason:e.target.value}))} placeholder="Tuliskan dasar pembuatan akun..."/></label></div><div className="r2d3-helper">OTP default ON. Setelah akun dibuat, berikan role dan unit melalui tombol Edit. Tidak ada password default bersama.</div></form>:
     current&&draft?<>
      {current.protected&&<div className="rm-notice"><strong>Superadmin terlindungi.</strong> Akun bootstrap tidak dapat diubah dari User Management. Nanti data profil pribadi diatur dari My Profile (R2D4).</div>}
      {tab==='profile'&&<div className="r2d3-form"><div className="r2d3-fields"><label>Username<input className="rm-input" readOnly value={current.username}/></label><label>Nama tampilan<input className="rm-input" disabled={busy||current.protected} maxLength={160} value={draft.displayName} onChange={e=>setDraft(d=>d?{...d,displayName:e.target.value}:d)}/></label><label className="r2d3-wide">Email OTP<input className="rm-input" type="email" disabled={busy||current.protected} maxLength={254} value={draft.email} onChange={e=>setDraft(d=>d?{...d,email:e.target.value}:d)}/></label></div><label className="r2d3-account-switch"><span><strong>Status akun</strong><small>{draft.active?'Akun dapat login sesuai kebijakan':'Akun tidak dapat login'}</small></span><input type="checkbox" role="switch" disabled={busy||current.protected} checked={draft.active} onChange={e=>setDraft(d=>d?{...d,active:e.target.checked}:d)}/></label>{!current.protected&&<><label className="r2d3-reason">Alasan perubahan *<textarea className="rm-input" minLength={8} maxLength={500} rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label><p className="r2d3-helper">Perubahan nama, email, atau status akan mencabut sesi akun ini.</p></>}</div>}
      {tab==='access'&&<div className="r2d3-form"><p className="r2d3-helper">Setiap assignment adalah satu role pada satu unit dengan scope dan klasifikasi. Akses dokumen tetap diperiksa Go API per objek.</p>{!current.protected&&<><div className="r2d3-grant-stack">{draft.grants.map((g,i)=><div className="r2d3-grant" key={i}><div className="r2d3-grant-head"><strong>Assignment {i+1}</strong><button type="button" className="btn" disabled={busy} onClick={()=>setDraft(d=>d?{...d,grants:d.grants.filter((_,j)=>j!==i)}:d)}>Hapus</button></div><div className="r2d3-fields"><label>Role<select className="rm-input" disabled={busy} value={g.roleKey} onChange={e=>updateGrant(i,{roleKey:e.target.value})}><option value="">Pilih role</option>{safeRoles.map(r=><option value={r.key} key={r.key}>{r.name}</option>)}</select></label><label>Unit<select className="rm-input" disabled={busy} value={g.unitKey} onChange={e=>updateGrant(i,{unitKey:e.target.value})}><option value="">Pilih unit</option>{units.filter(u=>u.active).map(u=><option key={u.key} value={u.key}>{u.name}</option>)}</select></label></div><div className="r2d2-abac-field"><span className="r2d2-abac-label">Cakupan data</span><div className="r2d2-choice-row">{scopes.map(s=><button type="button" key={s.key} className={g.scope===s.key?'selected':''} aria-pressed={g.scope===s.key} disabled={busy} onClick={()=>updateGrant(i,{scope:s.key})}>{s.label}</button>)}</div></div><div className="r2d2-abac-field"><span className="r2d2-abac-label">Klasifikasi maksimum</span><div className="r2d2-choice-row">{(['biasa','penting'] as const).map(k=><button type="button" key={k} className={g.classificationLimit===k?'selected':''} aria-pressed={g.classificationLimit===k} disabled={busy} onClick={()=>updateGrant(i,{classificationLimit:k})}>{k==='biasa'?'Biasa':'Penting'}</button>)}</div></div><label>Masa berlaku (opsional)<input type="datetime-local" className="rm-input" disabled={busy} value={localDateTime(g.expiresAt)} onChange={e=>updateGrant(i,{expiresAt:e.target.value?new Date(e.target.value).toISOString():null})}/></label></div>)}</div><button type="button" className="btn" disabled={busy||draft.grants.length>=30} onClick={()=>setDraft(d=>d?{...d,grants:[...d.grants,{...blankGrant}]}:d)}>＋ Tambah Assignment</button><label>Unit utama<select className="rm-input" disabled={busy} value={draft.primaryUnit} onChange={e=>setDraft(d=>d?{...d,primaryUnit:e.target.value}:d)}><option value="">{draft.grants.length?'Pilih unit utama':'Tanpa unit'}</option>{[...new Set(draft.grants.map(g=>g.unitKey).filter(Boolean))].map(k=><option key={k} value={k}>{humanUnit(k,units)}</option>)}</select></label><label className="r2d3-reason">Alasan perubahan akses *<textarea className="rm-input" rows={2} minLength={8} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><p className="r2d3-helper">Simpan assignment akan mencabut session pengguna. Akses tidak otomatis berlaku ke semua dokumen unit.</p></>}</div>}
      {tab==='security'&&<div className="r2d3-form"><label className="r2d3-account-switch"><span><strong>OTP saat login</strong><small>{current.protected?'Superadmin selalu wajib OTP':'Default ON. Superadmin dapat mengubah kebijakan pengguna lain.'}</small></span><input role="switch" type="checkbox" disabled={busy||current.protected} checked={current.protected?true:otpSetting} onChange={e=>setOtpSetting(e.target.checked)}/></label>{!current.protected&&<><label className="r2d3-reason">Alasan perubahan OTP *<textarea className="rm-input" rows={2} minLength={8} maxLength={500} value={otpReason} onChange={e=>setOtpReason(e.target.value)}/></label><label>Password Superadmin untuk konfirmasi *<input className="rm-input" type="password" autoComplete="current-password" value={adminConfirm} onChange={e=>setAdminConfirm(e.target.value)}/></label><p className="r2d3-helper">Mengubah OTP mencabut session dan challenge login pengguna yang terdampak. CAPTCHA tetap wajib.</p></>}</div>}
     </>:<div className="r2d3-empty">Pengguna tidak ditemukan. Tutup modal dan muat ulang daftar.</div>}
   </div>
   <footer className="r2d3-dialog-foot"><button type="button" className="btn" disabled={busy} onClick={closeModal}>Tutup</button>{mode.kind==='create'?<button form="r2d3-create-form" type="submit" className="btn primary" disabled={busy||create.reason.trim().length<8}>{busy?'Memproses...':'Buat Pengguna'}</button>:current&&!current.protected&&<button type="button" className="btn primary" disabled={busy||(tab==='security'?(current.otpEnabled===otpSetting||otpReason.trim().length<8||adminConfirm.length<14):reason.trim().length<8)} onClick={()=>void (tab==='profile'?saveProfile():tab==='access'?saveAccess():saveOTP())}>{busy?'Menyimpan...':tab==='profile'?'Simpan Profil':tab==='access'?'Simpan Role & Unit':'Simpan Kebijakan OTP'}</button>}</footer>
  </div></div>}
  {secret&&<div className="r2d3-backdrop"><div ref={secretRef} className="r2d3-dialog r2d3-secret-dialog" role="dialog" aria-modal="true" aria-labelledby="r2d3-secret-title" tabIndex={-1}><div className="r2d3-dialog-head"><div><span className="eyebrow">AKUN BERHASIL DIBUAT</span><h2 id="r2d3-secret-title">Password sementara</h2><p>Username: <b>{secret.username}</b></p></div></div><div className="r2d3-dialog-body"><div className="rm-notice"><strong>Rahasia — hanya sekali tampil.</strong> Serahkan password melalui kanal yang aman. Pengguna wajib menggantinya setelah login pertama dan OTP.</div><code className="r2d3-secret-value">{secret.password}</code><p className="r2d3-helper">Password tidak disimpan di localStorage/browser storage. Menutup dialog akan menghilangkan password dari tampilan.</p></div><div className="r2d3-dialog-foot"><button type="button" className="btn primary" onClick={()=>{setSecret(null);setMessage('Akun dibuat. Tetapkan role dan unit melalui Edit untuk mengaktifkan akses operasional.')}}>Saya sudah mencatat — Tutup</button></div></div></div>}
 </div>
}
