import { FloatingToast } from './UIFeedback'
import { useEffect, useState, type FormEvent } from 'react'

type Profile = { username:string; displayName:string; email:string; phone:string; hasAvatar:boolean }

type Props = {onChanged:(changes:{displayName?:string;email?:string;avatar?:boolean})=>void;onBack:()=>void}
async function secureRequest(url:string, method:string, body:BodyInit, contentType?:string){
 const csrfResp=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
 if(!csrfResp.ok)throw new Error('Gagal menyiapkan permintaan aman.')
 const data:{csrfToken:string}=await csrfResp.json()
 const headers:Record<string,string>={'X-CSRF-Token':data.csrfToken}
 if(contentType)headers['Content-Type']=contentType
 const r=await fetch(url,{method,credentials:'same-origin',headers,body,cache:'no-store'})
 if(!r.ok){let code='';try{const e:{error?:string}=await r.json();code=e.error||''}catch{}
  if(r.status===401)throw new Error('Sesi berakhir. Silakan login ulang.')
  if(r.status===409)throw new Error('Email sudah digunakan oleh akun lain.')
  if(r.status===429)throw new Error('Terlalu banyak percobaan. Coba beberapa saat lagi.')
  if(r.status===413)throw new Error('Ukuran foto terlalu besar. Maksimum 2 MB.')
  if(code==='smtp_unavailable')throw new Error('Layanan email verifikasi belum tersedia.')
  if(code==='invalid_credentials')throw new Error('Password lama tidak benar.')
  if(code==='invalid_or_expired_code')throw new Error('Kode OTP salah atau kedaluwarsa.')
  if(code==='invalid_avatar')throw new Error('Format atau resolusi foto tidak didukung.')
  throw new Error('Permintaan ditolak oleh server. Periksa data yang dimasukkan.')
 }
 return r
}
async function toSafeJPEG(file:File):Promise<Blob>{
 if(file.size>2*1024*1024)throw new Error('Maksimum ukuran foto 2 MB.')
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Format foto harus JPG, PNG, atau WebP.')
 const bitmap=await createImageBitmap(file)
 try{
  if(bitmap.width<32||bitmap.height<32||bitmap.width>4096||bitmap.height>4096||bitmap.width*bitmap.height>12000000)throw new Error('Resolusi gambar tidak sesuai (32–4096 px, maksimal 12 MP).')
  const side=Math.min(bitmap.width,bitmap.height)
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Browser tidak dapat memproses gambar.')
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,256,256)
  ctx.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,256,256)
  const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85))
  if(!blob)throw new Error('Gagal memproses foto.')
  return blob
 }finally{bitmap.close()}
}
export default function MyProfile({onChanged,onBack}:Props){
 const [profile,setProfile]=useState<Profile|null>(null)
 const [name,setName]=useState('');const [phone,setPhone]=useState('')
 const [oldPassword,setOldPassword]=useState('');const [nextPassword,setNextPassword]=useState('');const [confirmPassword,setConfirmPassword]=useState('')
 const [nextEmail,setNextEmail]=useState('');const [emailPassword,setEmailPassword]=useState('');const [otp,setOTP]=useState('');const [emailChallenge,setEmailChallenge]=useState('')
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('')
 const [avatarRevision,setAvatarRevision]=useState(0)
 useEffect(()=>{let active=true;fetch('/api/v1/auth/profile',{credentials:'same-origin',cache:'no-store'}).then(async r=>{if(!r.ok)throw new Error('Tidak dapat memuat profil.');return r.json() as Promise<Profile>}).then(p=>{if(active){setProfile(p);setName(p.displayName);setPhone(p.phone)}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Gagal memuat profil')});return()=>{active=false}},[])
 async function perform(action:()=>Promise<void>){setBusy(true);setError('');setMessage('');try{await action()}catch(e){setError(e instanceof Error?e.message:'Gagal memproses permintaan.')}finally{setBusy(false)}}
 function profileSaved(e:FormEvent){e.preventDefault();void perform(async()=>{
  const r=await secureRequest('/api/v1/auth/profile','PATCH',JSON.stringify({displayName:name.trim(),phone:phone.trim()}),'application/json')
  const updated:{displayName:string;phone:string}=await r.json()
  setProfile(p=>p?{...p,...updated}:p);onChanged({displayName:updated.displayName});setMessage('Profil berhasil diperbarui.')
 })}
 function passwordSaved(e:FormEvent){e.preventDefault();if(nextPassword!==confirmPassword){setError('Konfirmasi password baru tidak cocok.');return}void perform(async()=>{
  if(nextPassword.length<14||nextPassword.length>256||oldPassword===nextPassword)throw new Error('Password baru minimal 14 karakter dan harus berbeda.')
  await secureRequest('/api/v1/auth/change-password','POST',JSON.stringify({current:oldPassword,new:nextPassword}),'application/json')
  setOldPassword('');setNextPassword('');setConfirmPassword('');setMessage('Password berhasil diganti. Session perangkat lain dicabut.')
 })}
 function requestEmail(e:FormEvent){e.preventDefault();void perform(async()=>{
  const r=await secureRequest('/api/v1/auth/profile/email/start','POST',JSON.stringify({email:nextEmail.trim(),password:emailPassword}),'application/json')
  const data:{challenge:string}=await r.json();setEmailChallenge(data.challenge);setEmailPassword('');setMessage('OTP sudah dikirim ke email baru. Kode berlaku 5 menit.')
 })}
 function confirmEmail(e:FormEvent){e.preventDefault();void perform(async()=>{
  const r=await secureRequest('/api/v1/auth/profile/email/verify','POST',JSON.stringify({challenge:emailChallenge,code:otp}),'application/json')
  const updated:{email:string}=await r.json();setProfile(p=>p?{...p,email:updated.email}:p);onChanged({email:updated.email});setEmailChallenge('');setOTP('');setNextEmail('');setMessage('Email berhasil diverifikasi dan diganti. Session perangkat lain dicabut.')
 })}
 function changeAvatar(file:File|undefined){if(!file)return;void perform(async()=>{
  const jpeg=await toSafeJPEG(file)
  await secureRequest('/api/v1/auth/profile/avatar','PUT',jpeg,'image/jpeg')
  setProfile(p=>p?{...p,hasAvatar:true}:p);setAvatarRevision(x=>x+1);onChanged({avatar:true});setMessage('Foto profil diperbarui.')
 })}
 function deleteAvatar(){void perform(async()=>{await secureRequest('/api/v1/auth/profile/avatar','DELETE','');setProfile(p=>p?{...p,hasAvatar:false}:p);setAvatarRevision(x=>x+1);onChanged({avatar:true});setMessage('Foto profil dihapus.')})}
 return <div className="sdl-profile">
  <div className="page-heading"><span className="eyebrow">IDENTITY & ACCOUNT · R2D4</span><h1>My Profile</h1><p>Kelola profil pribadi dan keamanan akun. Berlaku bagi seluruh pengguna, termasuk Superadmin.</p></div>
  <button className="btn" onClick={onBack}>← Kembali ke Portal</button>
  {error&&<FloatingToast message={error} kind="error"/>}{message&&<FloatingToast message={message} kind="success"/>}
  {!profile?<div className="panel sdl-profile-loading">Memuat profil dari Go API...</div>:<div className="sdl-profile-grid">
   <section className="panel sdl-profile-card"><h2>Informasi Profil</h2><p>Nama dan nomor kontak dapat diperbarui sendiri. Username dan role dikelola oleh administrator.</p>
    <div className="sdl-avatar-block"><div className="sdl-profile-avatar">{profile.hasAvatar?<img src={`/api/v1/auth/profile/avatar?v=${avatarRevision}`} alt="Foto profil"/>:<span>{profile.displayName.slice(0,2).toUpperCase()}</span>}</div><div><strong>Foto Profil</strong><small>JPG, PNG atau WebP · maksimal 2 MB</small><div className="sdl-profile-actions"><label className="btn" htmlFor="self-avatar-upload">Upload foto</label><input id="self-avatar-upload" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{changeAvatar(e.currentTarget.files?.[0]);e.currentTarget.value=''}} className="sdl-file-hidden"/>{profile.hasAvatar&&<button className="btn" type="button" disabled={busy} onClick={deleteAvatar}>Hapus foto</button>}</div></div></div>
    <form onSubmit={profileSaved} className="sdl-profile-form"><label>Username<input value={profile.username} disabled/></label><label>Nama tampilan<input value={name} onChange={e=>setName(e.target.value)} required minLength={3} maxLength={160}/></label><label>Nomor kontak (opsional)<input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} maxLength={40} placeholder="Contoh: +62 812..."/></label><button className="btn primary" disabled={busy||name.trim().length<3}>Simpan Profil</button></form>
   </section>
   <div className="sdl-profile-side"><section className="panel sdl-profile-card"><h2>Ganti Password</h2><p>Gunakan minimal 14 karakter. Setelah diganti, session perangkat lain akan dicabut.</p><form className="sdl-profile-form" onSubmit={passwordSaved}><label>Password saat ini<input type="password" autoComplete="current-password" value={oldPassword} onChange={e=>setOldPassword(e.target.value)} required/></label><label>Password baru<input type="password" autoComplete="new-password" value={nextPassword} minLength={14} maxLength={256} onChange={e=>setNextPassword(e.target.value)} required/></label><label>Konfirmasi password baru<input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required/></label><button className="btn primary" disabled={busy}>Perbarui Password</button></form></section>
   <section className="panel sdl-profile-card"><h2>Verifikasi Perubahan Email</h2><p>Email aktif: <strong>{profile.email}</strong>. Perubahan email harus dikonfirmasi lewat OTP ke alamat baru; OTP login tetap mengikuti kebijakan akun.</p>
    {!emailChallenge?<form className="sdl-profile-form" onSubmit={requestEmail}><label>Email baru<input type="email" required autoComplete="email" maxLength={254} value={nextEmail} onChange={e=>setNextEmail(e.target.value)}/></label><label>Konfirmasi password saat ini<input type="password" required autoComplete="current-password" value={emailPassword} onChange={e=>setEmailPassword(e.target.value)}/></label><button className="btn primary" disabled={busy}>Kirim Kode Verifikasi</button></form>:<form className="sdl-profile-form" onSubmit={confirmEmail}><label>Kode OTP (6 digit)<input inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" maxLength={6} value={otp} onChange={e=>setOTP(e.target.value.replace(/[^0-9]/g,''))} required/></label><div className="sdl-profile-actions"><button className="btn primary" disabled={busy||otp.length!==6}>Verifikasi Email</button><button className="btn" type="button" onClick={()=>{setEmailChallenge('');setOTP('')}}>Batal</button></div></form>}
   </section></div>
  </div>}
  <div className="sdl-profile-note">Informasi role, unit, status akun, dan kebijakan OTP hanya dapat diatur melalui kewenangan administratif. Perubahan profil tidak memberikan akses ke workspace operasional.</div>
 </div>
}
