import { FloatingToast } from './UIFeedback'
import { useCallback, useEffect, useMemo, useState } from 'react'

type Role = { key:string; name:string; description:string; active:boolean; system:boolean; version:number; permissions:string[] }
type Permission = { key:string; description:string }
type Grant = { roleKey:string; unitKey:string; scope:'own'|'assigned'|'unit'; classificationLimit:'biasa'|'penting'; expiresAt:string|null }
type User = { id:string; username:string; displayName:string; active:boolean; protected:boolean; forcePasswordChange:boolean; grants:Grant[] }
type Draft = { key:string; name:string; description:string; active:boolean; version:number; permissions:string[] }
type View = 'simple'|'advanced'
const reserved = 'identity.roles.manage'
const protectedRole = 'superadmin'
const emptyDraft:Draft = {key:'',name:'',description:'',active:true,version:1,permissions:[]}
const groupNames:Record<string,string> = {identity:'Administrasi pengguna & role',audit:'Audit & aktivitas',urmin:'Urmin · Persuratan',subbagren:'Subbagren · Perencanaan',subbagsumda:'Subbagsumda · Sumber daya',subbagbinfung:'Subbagbinfung · Pembinaan fungsi',dashboard:'Dashboard & monitoring'}
const actionNames:Record<string,string> = {read:'Lihat data',create:'Tambah data',update:'Edit data',delete:'Hapus data',approve:'Setujui',download:'Unduh file',export:'Ekspor data',manage:'Kelola',register:'Registrasi',assign:'Tugaskan',revoke:'Cabut akses'}
const scopeNames:Record<string,string> = {own:'Dibuat sendiri',assigned:'Ditugaskan',unit:'Dalam unit'}
const unitNames:Record<string,string> = {urmin:'Urmin',subbagren:'Subbagren',subbagsumda:'Subbagsumda',subbagbinfung:'Subbagbinfung'}
const allowedOperationalPrefixes = ['urmin.','subbagren.','subbagsumda.','subbagbinfung.']
function labelFor(key:string):string {const parts=key.split('.');return `${actionNames[parts[parts.length-1]]??parts[parts.length-1]}${parts.length>2?' · '+parts.slice(1,-1).join(' / ').replaceAll('_',' '):''}`}
async function request<T>(path:string,body?:unknown, method:'GET'|'POST'|'PUT'='GET'):Promise<T>{
  const headers:Record<string,string> = {}
  if(method !== 'GET'){
    const csrfResponse = await fetch('/api/v1/auth/csrf',{cache:'no-store',credentials:'same-origin'})
    if(!csrfResponse.ok)throw new Error('Gagal menyiapkan permintaan aman.')
    const token:{csrfToken:string} = await csrfResponse.json()
    headers['X-CSRF-Token'] = token.csrfToken
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers,body:body===undefined?undefined:JSON.stringify(body)})
  if(!response.ok){
    if(response.status===401)throw new Error('Sesi berakhir. Silakan login kembali.')
    if(response.status===403)throw new Error('Akses ditolak.')
    if(response.status===409)throw new Error('Role berubah di tempat lain. Muat ulang dahulu.')
    throw new Error(`Permintaan gagal (${response.status}). Tidak ada perubahan disimpan.`)
  }
  return response.json() as Promise<T>
}
export default function RoleManagement(){
  const [roles,setRoles]=useState<Role[]>([])
  const [catalog,setCatalog]=useState<Permission[]>([])
  const [users,setUsers]=useState<User[]>([])
  const [selected,setSelected]=useState('operator')
  const [draft,setDraft]=useState<Draft>(emptyDraft)
  const [newRole,setNewRole]=useState(false)
  const [view,setView]=useState<View>('simple')
  const [previewUser,setPreviewUser]=useState('')
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [search,setSearch]=useState('')
  const [reason,setReason]=useState('')
  const refresh=useCallback(async()=>{
    const [roleData,permissionData,userData]=await Promise.all([
      request<{roles:Role[]}>('/api/v1/admin/roles'),
      request<{permissions:Permission[]}>('/api/v1/admin/permissions'),
      request<{users:User[]}>('/api/v1/admin/users')
    ])
    setRoles(roleData.roles);setCatalog(permissionData.permissions);setUsers(userData.users)
    return roleData.roles
  },[])
  useEffect(()=>{refresh().then(all=>{
    const item=all.find(x=>x.key==='operator')??all.find(x=>x.key!==protectedRole)??all[0]
    if(item){setSelected(item.key);setDraft({key:item.key,name:item.name,description:item.description,active:item.active,version:item.version,permissions:[...item.permissions]})}
  }).catch(e=>setError(e instanceof Error?e.message:'Gagal memuat hak akses.')).finally(()=>setLoading(false))},[refresh])
  const selectedRole=roles.find(r=>r.key===selected)
  const isProtected=!newRole&&selected===protectedRole
  const editable=!busy&&!isProtected
  const groups=useMemo(()=>{
    const map=new Map<string,Permission[]>()
    catalog.forEach(p=>{const group=p.key.split('.')[0];const entries=map.get(group)??[];entries.push(p);map.set(group,entries)})
    return [...map].map(([key,permissions])=>({key,name:groupNames[key]??key,permissions}))
  },[catalog])
  const filteredRoles=roles.filter(r=>`${r.key} ${r.name}`.toLowerCase().includes(search.toLowerCase()))
  const currentUser=users.find(u=>u.id===previewUser)
  const savedRoleMap=useMemo(()=>new Map(roles.map(r=>[r.key,r])),[roles])
  // This preview displays DB-saved potential grant capabilities only. It must
  // NEVER be interpreted as an object-specific ALLOW decision from Go ABAC.
  const preview=useMemo(()=>{
    if(!currentUser||currentUser.protected||!currentUser.active||currentUser.forcePasswordChange)return []
    const now=Date.now()
    return currentUser.grants.flatMap(grant=>{
      if(grant.expiresAt && new Date(grant.expiresAt).getTime()<=now)return []
      const role=savedRoleMap.get(grant.roleKey)
      if(!role||!role.active||role.key===protectedRole)return []
      return role.permissions.filter(p=>allowedOperationalPrefixes.some(prefix=>p.startsWith(prefix)) && p.startsWith(grant.unitKey+'.')).map(permission=>({permission,role:role.name,unit:grant.unitKey,scope:grant.scope,classification:grant.classificationLimit,expires:grant.expiresAt}))
    })
  },[currentUser,savedRoleMap])
  const changes=useMemo(()=>{
    if(newRole)return true
    if(!selectedRole)return false
    return draft.name!==selectedRole.name||draft.description!==selectedRole.description||draft.active!==selectedRole.active||draft.permissions.slice().sort().join('|')!==selectedRole.permissions.slice().sort().join('|')
  },[draft,newRole,selectedRole])
  function selectRole(role:Role){setSelected(role.key);setNewRole(false);setDraft({key:role.key,name:role.name,description:role.description,active:role.active,version:role.version,permissions:[...role.permissions]});setError('');setMessage('');setReason('')}
  function addRole(){setNewRole(true);setSelected('');setDraft({...emptyDraft});setError('');setMessage('');setReason('')}
  function toggle(key:string){if(!editable||key===reserved)return;setDraft(d=>({...d,permissions:d.permissions.includes(key)?d.permissions.filter(p=>p!==key):[...d.permissions,key]}));setMessage('')}
  async function save(){
    if(!editable||!changes)return
    setBusy(true);setError('');setMessage('')
    try{
      const data={key:draft.key.trim().toLowerCase(),name:draft.name.trim(),description:draft.description.trim(),active:draft.active,version:draft.version,permissions:draft.permissions,reason:reason.trim()}
      if(data.key===protectedRole)throw new Error('Role Superadmin tidak dapat dibuat/diubah melalui editor ini.')
      if(reason.trim().length<8)throw new Error('Isi alasan perubahan minimal 8 karakter untuk audit.')
      if(data.name.length<3||data.key.length<3)throw new Error('Nama dan kode role harus minimal tiga karakter.')
      if(!/^[a-z][a-z0-9_.-]{2,63}$/.test(data.key))throw new Error('Kode role tidak valid.')
      if(newRole)await request('/api/v1/admin/roles',data,'POST')
      else await request(`/api/v1/admin/roles/${encodeURIComponent(draft.key)}`,data,'PUT')
      const all=await refresh();const updated=all.find(r=>r.key===data.key)
      if(updated)selectRole(updated)
      setMessage(`Role ${data.name} berhasil disimpan.`)
    }catch(e){setError(e instanceof Error?e.message:'Gagal menyimpan role.')}
    finally{setBusy(false)}
  }
  return <div className="rm-root r2d2-root">
    <div className="page-heading"><span className="eyebrow">R2D2 · IDENTITY & ACCESS</span><h1>Role & Permission</h1><p>Atur siapa boleh melakukan apa. Nyalakan izin per tindakan, pilih role, lalu simpan dengan alasan perubahan.</p></div>
    <div className="rm-notice"><strong>Aturan tetap:</strong> Pengelolaan pengguna dan role terpisah dari pengaturan akses dokumen. Toggle ini mengatur <b>RBAC</b>, bukan membuka dokumen secara otomatis. <b>ABAC</b> (unit, scope, klasifikasi, penugasan, status surat) tetap diperiksa sistem.</div>
    {error&&<FloatingToast message={error} kind="error"/>}{message&&<FloatingToast message={message} kind="success"/>}
    {loading?<div className="panel rm-wait">Memuat role, permission, dan grant tersimpan dari Go API...</div>:<div className="rm-layout">
      <aside className="panel rm-aside"><div className="rm-aside-head"><div><strong>Role</strong><small>{roles.length} role tersimpan</small></div><button className="btn primary" type="button" onClick={addRole} disabled={busy}>+ Role</button></div>
        <input className="rm-input" aria-label="Cari role" placeholder="Cari role..." value={search} onChange={e=>setSearch(e.target.value)}/>
        <div className="rm-list">{filteredRoles.map(role=><button key={role.key} type="button" className={`rm-role ${!newRole&&selected===role.key?'selected':''}`} onClick={()=>selectRole(role)} disabled={busy}><span><strong>{role.name}</strong><small>{role.key} · {role.permissions.length} izin</small></span><span className={`rm-dot ${role.active?'active':''}`}/></button>)}</div>
      </aside>
      <section className="panel rm-editor">
        <div className="rm-editor-head"><div><span className="eyebrow">{newRole?'ROLE BARU':'ROLE DETAIL'}</span><h2>{newRole?'Buat role baru':selectedRole?.name??'Pilih role'}</h2><small>{isProtected?'Role sistem terkunci':'Hak akses baru berlaku setelah disimpan'}</small></div><span className="rm-badge">{isProtected?'Protected':changes?'Ada perubahan draft':'Tersimpan'}</span></div>
        <div className="rm-fields"><label>Kode role<input className="rm-input" value={draft.key} disabled={!newRole||busy} onChange={e=>setDraft(d=>({...d,key:e.target.value.toLowerCase().trim()}))} maxLength={64} placeholder="operator_urmin"/></label><label>Nama role<input className="rm-input" value={draft.name} disabled={!editable} onChange={e=>setDraft(d=>({...d,name:e.target.value}))} maxLength={120}/></label><label className="rm-wide">Keterangan<textarea className="rm-input" value={draft.description} disabled={!editable} rows={2} maxLength={500} onChange={e=>setDraft(d=>({...d,description:e.target.value}))}/></label><label className="rm-switch"><input type="checkbox" checked={draft.active} disabled={!editable} onChange={e=>setDraft(d=>({...d,active:e.target.checked}))}/> Role aktif</label></div>
        <div className="rm-permission-head"><div><h3>Hak akses per modul</h3><p>{draft.permissions.length} izin ON{changes?' · perubahan belum disimpan':''}</p></div><div className="r2d2-tabs" aria-label="Tampilan editor"><button type="button" className={view==='simple'?'active':''} aria-pressed={view==='simple'} onClick={()=>setView('simple')}>Sederhana</button><button type="button" className={view==='advanced'?'active':''} aria-pressed={view==='advanced'} onClick={()=>setView('advanced')}>Lanjutan</button></div></div>
        <div className="r2d2-groups">{groups.map(g=><section className="r2d2-group" key={g.key}><div className="r2d2-group-head"><h4>{g.name}</h4><span>{g.permissions.filter(p=>draft.permissions.includes(p.key)).length} / {g.permissions.length} ON</span></div><div className="r2d2-permissions">{g.permissions.map(p=>{const on=draft.permissions.includes(p.key);const locked=p.key===reserved||isProtected;return <div className="r2d2-permission" key={p.key}><div className="r2d2-permission-info"><strong>{labelFor(p.key)}</strong><small>{p.description}</small>{view==='advanced'&&<code>{p.key}</code>}{p.key===reserved&&<small>Hanya untuk Superadmin · tidak bisa diberikan ke role lain</small>}</div><button className={`r2d2-switch ${on?'on':''}`} type="button" role="switch" aria-checked={on} aria-label={`${labelFor(p.key)} — ${g.name}`} disabled={!editable||locked} onClick={()=>toggle(p.key)}><span className="r2d2-switch-knob"/></button><span className="r2d2-switch-label">{on?'ON':'OFF'}</span></div>})}</div></section>)}</div>
        <label className="rm-reason">Alasan pembuatan / perubahan (wajib diaudit)<textarea className="rm-input" rows={2} value={reason} maxLength={500} disabled={!editable} onChange={e=>setReason(e.target.value)} placeholder="Minimal 8 karakter, contoh: penyesuaian sesuai tugas unit"/></label>
        <div className="rm-footer"><span>{isProtected?'Role Superadmin terkunci.':changes?'Perubahan masih draft dan BELUM aktif.':'Hak akses ini sudah tersimpan. Pemberian ke user dilakukan di User Management.'}</span><button className="btn primary" type="button" disabled={!editable||!changes||draft.name.trim().length<3||reason.trim().length<8} onClick={()=>void save()}>{busy?'Menyimpan...':newRole?'Buat Role':'Simpan Perubahan'}</button></div>
      </section>
    </div>}
    {!loading&&<section className="panel r2d2-preview"><div className="rm-editor-head"><div><span className="eyebrow">PRATINJAU · READ ONLY</span><h2>Ringkasan akses pengguna</h2><small>Hanya menampilkan izin aktif; tidak mengubah akses.</small></div></div>
      <label className="r2d2-preview-select">Pilih pengguna<select className="rm-input" value={previewUser} onChange={e=>setPreviewUser(e.target.value)}><option value="">Pilih untuk melihat grant...</option>{users.map(user=><option key={user.id} value={user.id}>{user.displayName} (@{user.username})</option>)}</select></label>
      {!currentUser?<div className="r2d2-preview-empty">Pilih pengguna untuk melihat role, unit, cakupan, dan izin operasional potensial yang tersimpan.</div>:currentUser.protected?<div className="r2d2-preview-empty"><strong>Akses operasional mengikuti kebijakan akun.</strong> Pengelolaan identitas dan akses dokumen tetap diperiksa secara terpisah.</div>:!currentUser.active?<div className="r2d2-preview-empty">Akun nonaktif — tidak ada akses.</div>:currentUser.forcePasswordChange?<div className="r2d2-preview-empty">Pengguna wajib mengganti password terlebih dahulu — akses operasional ditahan.</div>:<><p className="r2d2-preview-explain">Ditemukan <b>{preview.length} kemungkinan izin</b> dari pasangan role dan grant yang aktif. Cakupan tidak digabung lintas role; setiap baris menggunakan grant sumbernya sendiri.</p>{preview.length===0?<div className="r2d2-preview-empty">Belum ada izin operasional dari grant aktif.</div>:<div className="r2d2-preview-list">{preview.map((item,i)=><div className="r2d2-preview-item" key={`${item.permission}-${item.role}-${item.unit}-${i}`}><strong>{labelFor(item.permission)}</strong><span>{unitNames[item.unit]??item.unit} · {item.role} · {scopeNames[item.scope]??item.scope} · maks. {item.classification}{item.expires?` · hingga ${new Date(item.expires).toLocaleString('id-ID')}`:''}</span>{view==='advanced'&&<code>{item.permission}</code>}</div>)}</div>}</>}
      <div className="rm-notice r2d2-preview-warning"><strong>Bukan izin dokumen final:</strong> keputusan ALLOW/DENY aktual bergantung pada dokumen yang diminta, pembuat/penerima tugas, klasifikasi, status workflow, delegasi dan grant terbaru. Akses diperiksa kembali saat data dibuka. Daftar ini belum menyertakan izin delegasi.</div>
    </section>}
  </div>
}
