// R5F24-v5: remove obsolete R5F8 Executive frontend access gate.
import UIFeedbackHost from './UIFeedback'
import { useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import DevelopmentChecklist from './DevelopmentChecklist'
import PortalV3R5F21 from './PortalV3R5F21'
import DirectivesR5F23 from './DirectivesR5F23'
import ExecutiveDecisionR5F24 from './ExecutiveDecisionR5F24'
import './MobileNavR5F23C.css'
import './PortalRefresh.css'
import './WorkspaceConsistency.css'
import './UrminNavigationR5F5.css'
import './AuthPremiumR5F14.css'
import './PortalPremium.css'
import './RenChooser.css'
import RoleManagement from './RoleManagement'
import MasterData from './MasterDataR5G12'
import UserManagement from './UserManagement'
import SuratMasuk from './SuratMasuk'
import UsulanR4A from './UsulanR4A'
import BudgetR4A3 from './BudgetR4A3'
import { InboxDistribusi } from './InboxDistribusiR5F2'
import TugasDisposisi from './TugasDisposisiR5F3'
import SeluruhDisposisi from './SeluruhDisposisiR5H5'
import LocalCaptcha, { solveCaptcha, type CaptchaProof } from './LocalCaptcha'
import MyProfile from './MyProfile'
import UnitWorkR5A from './UnitWorkR5A'
import SumdaR5B from './SumdaR5B'
import BinfungR5C from './BinfungR5C'
import UrminR5D from './UrminR5D'
import SmartUnitDashboard from './SmartUnitDashboard'
import UrminCommandDashboard from './UrminCommandDashboard'

type Theme = 'light' | 'dark'
// Server menolak proof CAPTCHA (captcha_invalid): kedaluwarsa atau sudah dipakai.
class CaptchaRejected extends Error { constructor(){ super('CAPTCHA kedaluwarsa atau sudah dipakai. Verifikasi lagi.') } }
type Screen = { view: 'portal' | 'executive' | 'arahan' | 'executive' | 'inbox' | 'tasks' | 'workspace' | 'roadmap' | 'security' | 'roles' | 'users' | 'master' | 'delegations' | 'profile' | 'login-preview'; unit?: UnitKey; menu?: string; tab?: string; recordID?: string; create?: boolean; sub?: RenSub }
type IconName = 'grid'|'inbox'|'send'|'clipboard'|'calendar'|'archive'|'chart'|'users'|'book'|'file'|'layers'|'target'|'shield'|'folder'|'package'|'wrench'|'graduation'|'search'|'arrow'|'back'|'chevron'|'menu'|'x'|'sun'|'moon'|'bell'|'user'|'lock'|'clock'|'check'|'refresh'|'activity'|'database'|'settings'|'eye'|'list'|'info'|'external'|'key'|'mail'|'plus'
type UnitKey = 'urmin' | 'ren' | 'sumda' | 'binfung'
// SUBBAGREN dibagi dua ruang kerja. Klik SUBBAGREN membuka halaman pilihan
// dulu; modul di sidebar hanya yang termasuk ruang kerja yang dipilih.
// Ini pengelompokan NAVIGASI saja, otorisasi tetap sepenuhnya di backend.
type RenSub = 'progar' | 'pagu'
const renSubs: {id:RenSub;title:string;name:string;description:string;icon:IconName;modules:string[]}[] = [
  {id:'progar',title:'PROGAR',name:'Program & Perencanaan',description:'Dokumen perencanaan, monitoring kinerja & LKIP, serta usulan kebutuhan.',icon:'file',modules:['perencanaan','kinerja','usulan']},
  {id:'pagu',title:'PAGU ANGGARAN',name:'Pagu Anggaran',description:'Register program, pagu dan target kegiatan, serta realisasi anggaran (LRA).',icon:'layers',modules:['program','realisasi']}
]
function renSubOf(s:Screen):RenSub|undefined{
  if(s.unit!=='ren')return undefined
  return renSubs.find(g=>g.modules.includes(s.menu??''))?.id ?? s.sub
}
type Module = { id: string; title: string; icon: IconName; description: string; columns: string[] }
type Unit = { id: UnitKey; title: string; name: string; subtitle: string; description: string; icon: IconName; accent: string; soft: string; modules: Module[] }
type Account = {id:string;username:string;email:string;displayName:string;roles:string[];units:string[];mustChangePassword:boolean}

const icons: Record<IconName, ReactNode> = {
  grid:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  inbox:<><path d="M4 4h16l2 10v6H2v-6z"/><path d="M2 14h6l2 3h4l2-3h6"/></>,
  send:<><path d="m22 2-7 20-4-9-9-4zM22 2 11 13"/></>,
  clipboard:<><rect x="5" y="4" width="14" height="18" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 12h6m-6 4h6"/></>,
  calendar:<><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18"/></>,
  archive:<><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v12h14V9m-10 4h6"/></>,
  chart:<><path d="M4 20V4m0 16h17M8 16l4-5 3 2 5-7"/></>,
  users:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m2 9v-2a6 6 0 0 0-3-5"/></>,
  book:<><path d="M3 5a3 3 0 0 1 3-3h15v18H6a3 3 0 0 0-3 3zM3 5v15a3 3 0 0 1 3-3h15"/></>,
  file:<><path d="M6 2h8l4 4v16H6zM14 2v5h4M9 12h6m-6 4h6"/></>,
  layers:<><path d="m12 2 9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5"/></>,
  target:<><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  shield:<><path d="m12 2 9 4v6c0 6-4 9-9 11-5-2-9-5-9-11V6z"/><path d="m9 12 2 2 4-4"/></>,
  folder:<path d="M3 5h7l2 2h9v13H3z"/>,
  package:<><path d="m12 2 9 5-9 5-9-5zM3 7v10l9 5 9-5V7M12 12v10"/></>,
  wrench:<path d="M15 4a6 6 0 0 0-7 8l-5 5a3 3 0 0 0 4 4l5-5a6 6 0 0 0 8-7l-5 5-4-4z"/>,
  graduation:<><path d="m2 9 10-5 10 5-10 5zM6 11v6c3 3 9 3 12 0v-6M22 9v8"/></>,
  search:<><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  arrow:<path d="M5 12h14m-6-6 6 6-6 6"/>,
  back:<path d="M19 12H5m6-6-6 6 6 6"/>,
  chevron:<path d="m9 5 7 7-7 7"/>,
  menu:<path d="M4 6h16M4 12h16M4 18h16"/>,
  x:<path d="M5 5 19 19M19 5 5 19"/>,
  sun:<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M19 5l-1.5 1.5m-11 11L5 19"/></>,
  moon:<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10"/>,
  bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  user:<><circle cx="12" cy="8" r="4"/><path d="M4 22c0-5 3-8 8-8s8 3 8 8"/></>,
  lock:<><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
  check:<path d="m4 12 5 5L20 6"/>,
  refresh:<><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></>,
  activity:<path d="M2 12h4l3-7 5 14 3-7h5"/>,
  database:<><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0"/></>,
  settings:<><circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/></>,
  eye:<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/></>,
  list:<path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/>,
  info:<><circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/></>,
  external:<path d="M13 4h7v7M20 4l-9 9M20 14v6H4V4h6"/>,
  key:<><circle cx="8" cy="15" r="5"/><path d="m12 11 9-9m-4 4 3 3m-6 0 3 3"/></>,
  mail:<><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
  plus:<path d="M12 5v14M5 12h14"/>
}
function Icon({ name, size=19, className='' }: { name: IconName; size?: number; className?: string }) {
  return <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{icons[name]}</svg>
}

// R5F5: single-entry URMIN navigation. Other unit workspaces remain unchanged.
const urminNav: {id:string; label:string; icon:IconName}[] = [
 {id:'',label:'Dashboard',icon:'grid'},
 {id:'surat-masuk',label:'Surat Masuk',icon:'inbox'},
 {id:'surat-keluar',label:'Surat Keluar',icon:'send'},
 {id:'disposisi',label:'Disposisi',icon:'clipboard'},
 {id:'__unitwork',label:'Berkas Kerja',icon:'folder'},
 {id:'agenda',label:'Agenda & Rapat',icon:'calendar'},
 {id:'arsip',label:'Arsip',icon:'archive'}
]
const urminTabs: Record<string,{id:string;label:string}[]> = {
 'surat-masuk':[{id:'daftar',label:'Daftar Surat'},{id:'riwayat',label:'Riwayat Penerimaan'}],
 // R5G3: tab 'history' (Riwayat) diganti 'arsip'. Riwayat per tugas TIDAK
 // hilang — ia tetap ada di bagian "Riwayat Disposisi" dalam detail tugas,
 // dan endpoint 117 tetap melayaninya.
 // R5H5: 'issued' (Diberikan) diganti 'semua' — monitoring seluruh surat yang
 // diajukan ke Kabagrenmin. Tab 'arsip' dihapus atas permintaan pemilik sistem,
 // 2026-11-05; disposisi yang disetujui tetap terarsip otomatis di menu Arsip.
 'disposisi':[{id:'mine',label:'Tugas Saya'},{id:'semua',label:'Seluruh Disposisi'},{id:'review',label:'Perlu Review'}],
 // R5G12: Master Data menyusul tiga tab lama. Isinya konfigurasi persuratan —
 // jenis surat dan kode arsip — bukan identitas, tapi tempatnya memang di sini
 // karena Superadmin yang mengelola konfigurasi.
 '__admin':[{id:'users',label:'Pengguna'},{id:'roles',label:'Role & Akses'},{id:'security',label:'Kewenangan'},{id:'master',label:'Master Data'}]
}
const defaultUrminTab: Record<string,string>={'surat-masuk':'daftar','disposisi':'mine','__admin':'users'}

const units: Unit[] = [
  {id:'urmin',title:'URMIN',name:'Urusan Administrasi',subtitle:'Layanan administrasi umum dan tata persuratan internal',description:'Persuratan, disposisi, dokumentasi, kearsipan, rapat dan dukungan administrasi umum.',icon:'inbox',accent:'#2b9a80',soft:'#e7f7f1',modules:[
    {id:'surat-masuk',title:'Surat Masuk',icon:'inbox',description:'Register dan monitoring naskah dinas yang diterima.',columns:['Nomor Agenda','Nomor Surat','Surat Dari','Tanggal','Status']},
    {id:'surat-keluar',title:'Surat Keluar',icon:'send',description:'Draft, penelaahan, persetujuan dan pengiriman surat.',columns:['Nomor Agenda','Nomor Surat','Tujuan','Tanggal','Status']},
    {id:'disposisi',title:'Disposisi & Tindak Lanjut',icon:'clipboard',description:'Arahan pimpinan dan monitoring tindak lanjut.',columns:['Referensi','Pemberi Arahan','Tujuan','Tenggat','Status']},
    {id:'agenda',title:'Agenda & Rapat',icon:'calendar',description:'Rapat, undangan, notulen dan tindak lanjut.',columns:['Agenda','Tanggal','Waktu','Lokasi','Status']},
    {id:'arsip',title:'Arsip & Dokumentasi',icon:'archive',description:'Register arsip, retensi dan lokasi penyimpanan.',columns:['Kode Arsip','Jenis','Lokasi','Tanggal','Akses']}
  ]},
  {id:'ren',title:'SUBBAGREN',name:'Subbagian Perencanaan',subtitle:'Perencanaan, program dan pengendalian kinerja',description:'Renstra/Renja/RKA-KL, pengelolaan usulan, anggaran dan laporan kinerja.',icon:'chart',accent:'#4b78ba',soft:'#edf3ff',modules:[
    {id:'perencanaan',title:'Dokumen Perencanaan',icon:'file',description:'Renstra, Renja, RKA-KL, DIPA, TOR/KAK dan RAB.',columns:['Dokumen','Tahun','Referensi','Koordinator','Status']},
    {id:'program',title:'Program & Anggaran',icon:'layers',description:'Register program, pagu dan target kegiatan.',columns:['Kode','Tahun','Pagu','PIC','Status']},
    {id:'realisasi',title:'Realisasi Anggaran (LRA)',icon:'chart',description:'Realisasi, penyerapan dan tindak lanjut deviasi.',columns:['Program','Periode','Pagu','Realisasi','Status']},
    {id:'kinerja',title:'Monitoring Kinerja & LKIP',icon:'target',description:'Indikator, target, capaian dan evaluasi program.',columns:['Indikator','Periode','Target','Realisasi','Status']},
    {id:'usulan',title:'Usulan Kebutuhan',icon:'clipboard',description:'Kompilasi usulan kebutuhan dan anggaran.',columns:['Nomor','Unit Pengusul','Tahun','Estimasi','Status']}
  ]},
  {id:'sumda',title:'SUBBAGSUMDA',name:'Subbagian Sumber Daya',subtitle:'Administrasi personel dan pengelolaan logistik',description:'Administrasi SDM, layanan kepegawaian, pendidikan, BMN dan pemeliharaan.',icon:'users',accent:'#956db9',soft:'#f3effd',modules:[
    {id:'personel',title:'Data Administrasi Personel',icon:'users',description:'Register administrasi personel.',columns:['ID Internal','Personel','Kategori','Unit','Status']},
    {id:'layanan',title:'Pelayanan Kepegawaian',icon:'file',description:'Tracking cuti, UKP, KGB, mutasi, pensiun.',columns:['Pemohon','Layanan','Tanggal','Target','Status']},
    {id:'pendidikan',title:'Pendidikan & Pengembangan SDM',icon:'graduation',description:'Pendidikan, pelatihan dan kompetensi.',columns:['Jenis','Peserta','Tanggal','Penyelenggara','Status']},
    {id:'inventaris',title:'Inventaris & BMN',icon:'package',description:'Barang milik negara, kondisi dan penanggung jawab.',columns:['Kode Aset','Kategori','Kondisi','Lokasi','Status']},
    {id:'pemeliharaan',title:'Pemeliharaan Logistik',icon:'wrench',description:'Permohonan dan monitoring pemeliharaan.',columns:['Aset','Tindakan','Tanggal','Target','Status']}
  ]},
  {id:'binfung',title:'SUBBAGBINFUNG',name:'Subbagian Pembinaan Fungsi',subtitle:'Tata kelola, sistem, metode dan evaluasi organisasi',description:'SOP dan regulasi, PID, RB, SPIP serta Analisis Beban Kerja.',icon:'book',accent:'#ca9250',soft:'#fcf4e9',modules:[
    {id:'sop',title:'SOP, Regulasi & Metode',icon:'book',description:'Register SOP, sistem, metode dan regulasi.',columns:['Kode','Jenis','Versi','Pemilik Proses','Status']},
    {id:'pid',title:'Informasi & Dokumentasi (PID)',icon:'folder',description:'Pengelolaan informasi dan dokumentasi.',columns:['Register','Kategori','Akses','Tanggal','Status']},
    {id:'rb',title:'Reformasi Birokrasi & SPIP',icon:'shield',description:'Rencana aksi, eviden, SPIP, PMPRB dan LKE.',columns:['Area','Periode','Target','Capaian','Status']},
    {id:'abk',title:'Analisis Beban Kerja (ABK)',icon:'layers',description:'Volume kerja dan analisis kebutuhan organisasi.',columns:['Unit','Periode','Volume','Kebutuhan','Status']},
    {id:'pembinaan',title:'Program Pembinaan Fungsi',icon:'users',description:'Kegiatan pembinaan, sasaran, waktu, peserta dan hasil.',columns:['Kode','Kegiatan','Tanggal','PIC','Hasil']},
    {id:'evaluasi',title:'Pembinaan & Evaluasi Organisasi',icon:'target',description:'Monitoring pembinaan fungsi dan rekomendasi.',columns:['Evaluasi','Tanggal','Tenggat','PIC','Status']}
  ]}
]

function HeaderAvatar({revision}:{revision:number}){
 const [error,setError]=useState(false)
 useEffect(()=>setError(false),[revision])
 return error?<Icon name="user" size={18}/>:<img className="header-self-avatar" src={`/api/v1/auth/profile/avatar?v=${revision}`} onError={()=>setError(true)} alt=""/>
}
function Brand({ compact=false }: { compact?: boolean }) {
  const [logoOK,setLogoOK] = useState(true)
  return <div className={compact?"brand brand--compact":"brand"} aria-label="Siera Delta Lima">
    <span className="brand-symbol">{logoOK ? <img src="/logo.png" alt="Logo Siera Delta Lima" onError={()=>setLogoOK(false)}/> : <span className="sdl-logo-fallback">SDL</span>}</span>
    <span className="brand-words"><strong>SIERA <em>DELTA LIMA</em></strong><small>BagRenmin Densus 88 AT Polri</small></span>
  </div>
}
function EmptyState({ title, description, icon='folder' }: { title: string; description: string; icon?: IconName }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={24}/></span><h3>{title}</h3><p>{description}</p><span className="pill neutral"><Icon name="lock" size={12}/> Dalam persiapan</span></div>
}
function Metric({ name, icon, value='—', hint='Belum ada data' }: { name:string; icon:IconName; value?:string; hint?:string }) {
  return <div className="metric-card"><div className="metric-top"><span>{name}</span><span className="metric-icon"><Icon name={icon} size={19}/></span></div><div className="metric-value">{value}</div><div className="metric-hint">{hint}</div></div>
}
function Label({ children, tone='neutral' }: { children:ReactNode; tone?:'neutral'|'amber'|'green'|'blue' }) {
  return <span className={`pill ${tone}`}>{children}</span>
}
function Authentication({onAuthenticated}:{onAuthenticated:(account:Account)=>void}) {
  const [stage,setStage]=useState<'loading'|'credentials'|'otp'>('loading')
  const [username,setUsername]=useState('')
  const [password,setPassword]=useState('')
  const [otp,setOtp]=useState('')
  const [challenge,setChallenge]=useState('')
  const [captchaProof,setCaptchaProof]=useState<CaptchaProof|null>(null)
  const [captchaKey,setCaptchaKey]=useState(0)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [setup,setSetup]=useState<{hasSuperadmin:boolean;smtpConfigured:boolean}|null>(null)
  useEffect(()=>{
    fetch('/api/v1/auth/bootstrap-status',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Service unavailable');return r.json()}).then(setSetup).catch(()=>setError('Layanan belum tersedia. Silakan coba kembali.'))
    fetch('/api/v1/auth/me',{cache:'no-store',credentials:'same-origin'}).then(async r=>{if(r.ok){onAuthenticated(await r.json())}else{setStage('credentials')}}).catch(()=>setStage('credentials'))
  },[onAuthenticated])
  async function post(path:string,payload:unknown){
    const csrfRes=await fetch('/api/v1/auth/csrf',{cache:'no-store',credentials:'same-origin'})
    if(!csrfRes.ok)throw new Error('Tidak dapat memulai sesi aman.')
    const csrf:{csrfToken:string}=await csrfRes.json()
    const response=await fetch(`/api/v1/auth/${path}`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf.csrfToken},body:JSON.stringify(payload)})
    if(!response.ok){
      if(response.status===429)throw new Error('Terlalu banyak percobaan. Coba lagi setelah 15 menit.')
      if(response.status===503)throw new Error('Layanan email OTP belum siap. Hubungi administrator untuk konfigurasi SMTP.')
      if(response.status===403){
        // Dua penolakan berbeda memakai status yang sama. Dulu keduanya tampil
        // sebagai "CAPTCHA kedaluwarsa", padahal csrf_invalid berarti Origin
        // atau cookie CSRF ditolak (mis. SDL_ALLOWED_ORIGINS) — CLAUDE.md,
        // batasan keras 2. Kode error dibaca supaya pesannya jujur.
        const code=await response.json().then((b:{error?:string})=>b.error??'').catch(()=>'')
        if(code==='csrf_invalid')throw new Error('Sesi keamanan ditolak server. Muat ulang halaman (F5) lalu coba lagi.')
        if(path==='login'&&code==='captcha_invalid')throw new CaptchaRejected()
        throw new Error(path==='login'?'Verifikasi keamanan ditolak. Muat ulang halaman lalu coba lagi.':'Sesi verifikasi kedaluwarsa. Ulangi login.')
      }
      throw new Error(path==='login'?'Username atau password tidak sesuai.':'Kode OTP tidak valid atau kedaluwarsa.')
    }
    return response.json()
  }
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy)return;setBusy(true);setError('')
    try {
      if(stage==='credentials'){
        if(!captchaProof)throw new Error('Selesaikan verifikasi sebelum masuk.')
        type LoginResult={challenge?:string;otpRequired?:boolean;authenticated?:boolean}
        let res:LoginResult
        try {
          res=await post('login',{username,password,captcha:captchaProof})
        } catch(err) {
          // Proof hanya berlaku 2 menit dan sekali pakai. Kalau ditolak (laptop
          // sempat tidur, tab di latar belakang menunda pembaruan otomatis),
          // ambil challenge baru dan coba SEKALI lagi — pengguna tidak perlu
          // tahu ada CAPTCHA. Penolakan CAPTCHA tidak dihitung sebagai gagal
          // login oleh server (dicek sebelum throttle, service.go:205).
          if(!(err instanceof CaptchaRejected))throw err
          const fresh=await solveCaptcha()
          if(!fresh)throw new Error('Verifikasi keamanan gagal. Coba lagi.')
          res=await post('login',{username,password,captcha:fresh.proof}).catch(e=>{throw e instanceof CaptchaRejected?new Error('Verifikasi keamanan gagal. Muat ulang halaman lalu coba lagi.'):e})
        }
        setPassword('');setCaptchaProof(null);setCaptchaKey(k=>k+1)
        if(res.authenticated && res.otpRequired===false){
          const me=await fetch('/api/v1/auth/me',{cache:'no-store',credentials:'same-origin'})
          if(!me.ok)throw new Error('Sesi belum dapat diverifikasi.')
          onAuthenticated(await me.json());return
        }
        if(!res.challenge)throw new Error('Server tidak mengembalikan challenge OTP.')
        setChallenge(res.challenge);setStage('otp');setOtp('')
      }else if(stage==='otp'){
        await post('verify-otp',{challenge,code:otp})
        const who=await fetch('/api/v1/auth/me',{credentials:'same-origin',cache:'no-store'})
        if(!who.ok)throw new Error('Sesi belum dapat diverifikasi.')
        onAuthenticated(await who.json())
      }
    } catch(e){if(stage==='credentials'){setCaptchaProof(null);setCaptchaKey(k=>k+1)}setError(e instanceof Error?e.message:'Permintaan gagal. Silakan coba lagi.')}
    finally {setBusy(false)}
  }
  return <div className="auth-shell" style={{minHeight:'100vh'}}>
    <section className="auth-hero"><div className="auth-hero-top"><Brand/><span className="auth-unit-mark">PORTAL INTERNAL</span></div><div className="auth-hero-content"><span className="hero-eyebrow">BAGRENMIN DENSUS 88 AT POLRI</span><h1>One Workspace.<br/><em>Full Visibility.</em></h1></div><div className="auth-hero-foot"><span>SIERA DELTA LIMA</span><span>BagRenmin Densus 88 AT Polri</span></div></section>
    <section className="auth-pane"><div className="auth-form">
      <span className="auth-form-eyebrow">PORTAL PERSONEL</span>
      <h2>{stage==='otp'?'Verifikasi akun':'Selamat datang'}</h2>
      <p>{stage==='otp'?'Masukkan kode enam digit yang dikirim ke email Anda. Kode berlaku lima menit.':'Masuk untuk mengakses ruang kerja BagRenmin.'}</p>
      {setup && !setup.hasSuperadmin && <div className="auth-preview-info"><Icon name="info" size={17}/><span>Akun pengelola belum tersedia. Hubungi administrator.</span></div>}
      {setup && !setup.smtpConfigured && <div className="auth-preview-info"><Icon name="mail" size={17}/><span>Verifikasi email belum tersedia. Hubungi administrator.</span></div>}
      {error && <div className="auth-error" role="alert">{error}</div>}
      {stage==='loading'?<p>Menyiapkan halaman masuk...</p>:<form onSubmit={submit}>
        {stage==='credentials'?<><label htmlFor="sdl-username">Username atau email</label><input id="sdl-username" autoComplete="username" value={username} onChange={e=>setUsername(e.target.value)} required maxLength={254} placeholder="Username atau email"/><label htmlFor="sdl-password">Password</label><input id="sdl-password" autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={256} placeholder="Masukkan password"/><LocalCaptcha key={captchaKey} onVerified={setCaptchaProof}/></>:<><label htmlFor="sdl-otp">Kode OTP 6 digit</label><input id="sdl-otp" value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" pattern="[0-9]{6}" autoComplete="one-time-code" required placeholder="000000" maxLength={6} className="otp-code"/></>}
        <button className="btn primary full" type="submit" disabled={busy||(stage==='otp'&&otp.length!==6)||(stage==='credentials'&&!captchaProof)}><Icon name={stage==='credentials'?'lock':'mail'} size={16}/>{busy?'Memproses...':stage==='credentials'?'Masuk':'Verifikasi & Masuk'}</button>
      </form>}
      {stage==='otp'&&<button type="button" className="text-link" onClick={()=>{setStage('credentials');setChallenge('');setOtp('');setError('')}}><Icon name="back" size={16}/> Kembali ke login</button>}
    </div></section>
  </div>
}


function PasswordRotation({onComplete}:{onComplete:(a:Account)=>void}) {
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();setError('');if(next!==confirm){setError('Konfirmasi password belum sama.');return}if(next.length<14||next.length>256){setError('Password baru harus 14–256 karakter.');return}
  setBusy(true)
  try{const csrf=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'});if(!csrf.ok)throw Error('Token CSRF tidak tersedia')
   const data:{csrfToken:string}=await csrf.json();const changed=await fetch('/api/v1/auth/change-password',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':data.csrfToken},body:JSON.stringify({current,new:next})});if(!changed.ok)throw Error('Password lama salah atau gagal mengubah password.')
   setCurrent('');setNext('');setConfirm('');const me=await fetch('/api/v1/auth/me',{cache:'no-store',credentials:'same-origin'});if(!me.ok)throw Error('Tidak bisa memverifikasi sesi baru.');onComplete(await me.json())
  }catch(e){setError(e instanceof Error?e.message:'Gagal mengubah password')}finally{setBusy(false)}
 }
 return <div className="auth-shell" style={{minHeight:'100vh'}}><section className="auth-hero"><div className="auth-hero-top"><Brand/><span className="auth-unit-mark">PORTAL INTERNAL</span></div><div className="auth-hero-content"><span className="hero-eyebrow">BAGRENMIN DENSUS 88 AT POLRI</span><h1>Ruang kerja<br/><em>siap digunakan.</em></h1><p>Perbarui kata sandi Anda untuk melanjutkan.</p></div><div className="auth-hero-foot"><span>SIERA DELTA LIMA</span><span>BagRenmin Densus 88 AT Polri</span></div></section><section className="auth-pane"><div className="auth-form"><Label tone="amber">WAJIB · PERGANTIAN PASSWORD</Label><h2>Amankan akun Anda</h2><p>Buat kata sandi pribadi baru dengan minimal 14 karakter untuk melanjutkan.</p>{error&&<div className="auth-error" role="alert">{error}</div>}<form onSubmit={submit}><label>Password sementara</label><input type="password" autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)} required/><label>Password baru</label><input type="password" autoComplete="new-password" value={next} onChange={e=>setNext(e.target.value)} required minLength={14} maxLength={256}/><label>Konfirmasi password baru</label><input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/><button className="btn primary full" type="submit" disabled={busy}>{busy?'Memproses...':'Ganti Password & Lanjutkan'}</button></form></div></section></div>
}

function App() {
  const [theme,setTheme] = useState<Theme>(() => {try{return localStorage.getItem('sdl-theme')==='dark'?'dark':'light'}catch{return 'light'}})
  // R5F21C: Portal theme defaults to light and is independent of workspace theme.
  const [portalTheme,setPortalTheme] = useState<Theme>(() => {try{return localStorage.getItem('sdl-portal-theme')==='dark'?'dark':'light'}catch{return 'light'}})
  const [screen,setScreen] = useState<Screen>({view:'portal'})
  const [mobileMenu,setMobileMenu] = useState(false)
  const [lastWorkspaceUnit,setLastWorkspaceUnit] = useState<UnitKey>('urmin')
  const [sidebarCollapsed,setSidebarCollapsed] = useState(()=>{try{return localStorage.getItem('sdl-sidebar-collapsed')==='true'}catch{return false}})
  const [demoAdminEnabled,setDemoAdminEnabled] = useState(false)
  const [account,setAccount] = useState<Account|null>(null)
  const [profileAvatarRevision,setProfileAvatarRevision] = useState(0)
  // R5H6: angka penanda di menu (Surat Masuk, Inbox, Arahan) dihapus atas permintaan
  // pemilik; hitungannya masih dimuat tapi tidak ditampilkan.
  const [,setInboxPending] = useState(0)
  // R5F23 - leadership directives independent from URMIN
  const [,setDirectiveAlerts] = useState(0)
  const [executiveKind,setExecutiveKind] = useState<'leader'|'admin'|null>(null)
  useEffect(()=>{
    if(!account){setExecutiveKind(null);return}
    let active=true
    fetch('/api/v1/executive/v2/access',{credentials:'same-origin',cache:'no-store'})
      .then(async r=>r.ok?await r.json():null)
      .then((payload:{kind?:string}|null)=>{if(active)setExecutiveKind(payload?.kind==='leader'||payload?.kind==='admin'?payload.kind:null)})
      .catch(()=>{if(active)setExecutiveKind(null)})
    return()=>{active=false}
  },[account?.id])
  useEffect(() => { try{localStorage.setItem('sdl-theme',theme)}catch{} },[theme])
  useEffect(() => { try{localStorage.setItem('sdl-portal-theme',portalTheme)}catch{} },[portalTheme])
  useEffect(()=>{try{localStorage.setItem('sdl-sidebar-collapsed',String(sidebarCollapsed))}catch{}},[sidebarCollapsed])
  const isSuperadmin = account?.roles.includes('superadmin') ?? false
  const restrictedSuperadmin = isSuperadmin /* R5F20B: demo mode never unlocks operational workspace */
  // R5G2: Kabagrenmin hanya punya SATU pintu ke surat — Surat Masuk. Menu
  // Disposisi disembunyikan untuknya karena memang kosong: ia tidak pernah
  // menjadi penerima tugas (assigned_to), melainkan penerbitnya, dan panel
  // Monitoring Pimpinan sedang di-hide. Surat yang menunggu tindakannya
  // ditandai langsung di register Surat Masuk.
  //
  // Role-nya datang dari GET /auth/me, yang menggabungkan sdl_user_roles
  // dengan role_key pada grant aktif (service.go:434) — itu sebabnya
  // 'br_kabagrenmin' terbaca di sini meski sdl_user_roles kosong.
  //
  // Ini penyembunyian NAVIGASI, bukan otorisasi: backend tetap satu-satunya
  // yang menegakkan akses, dan Engine A tidak berubah.
  const isKabagrenmin = account?.roles.includes('br_kabagrenmin') ?? false
  // R5H6: bagi Kabagrenmin, menu Surat Masuk berisi surat yang didisposisikan
  // kepadanya saja (lihat SuratMasuk isKabagrenmin), jadi dinamai "Disposisi".
  // Hanya label; id menu tetap 'surat-masuk' sehingga tautan dan rute tidak berubah.
  const visibleUrminNav = isKabagrenmin ? urminNav.filter(item=>item.id!=='disposisi').map(item=>item.id==='surat-masuk'?{...item,label:'Disposisi'}:item) : urminNav
  useEffect(()=>{
    if(!account || restrictedSuperadmin)return
    let alive=true
    async function refreshInbox(){
      try{const r=await fetch('/api/v1/urmin/distribution-inbox/',{credentials:'same-origin',cache:'no-store'});if(!r.ok)return;const data:{pending?:number}=await r.json();if(alive)setInboxPending(data.pending??0)}catch{}
    }
    void refreshInbox()
    const onInboxChanged=()=>{void refreshInbox()}
    window.addEventListener('sdl:inbox-changed',onInboxChanged)
    const interval=window.setInterval(()=>{void refreshInbox()},60000)
    return()=>{alive=false;window.clearInterval(interval);window.removeEventListener('sdl:inbox-changed',onInboxChanged)}
  },[account?.email,restrictedSuperadmin])
  useEffect(()=>{
    if(!account || restrictedSuperadmin){setDirectiveAlerts(0);return}
    let active=true
    const load=async()=>{try{const r=await fetch('/api/v1/leadership/directives/notifications',{cache:'no-store',credentials:'same-origin'});if(!r.ok)return;const d:{total?:number}=await r.json();if(active)setDirectiveAlerts(Math.max(0,Number(d.total||0)))}catch{}}
    void load();const timer=window.setInterval(()=>{void load()},30000)
    return()=>{active=false;window.clearInterval(timer)}
  },[account?.id,restrictedSuperadmin])
  const superadminViews: Screen['view'][] = ['portal', 'executive', 'executive', 'users', 'roles', 'master','profile','roadmap']
  function navigate(next:Screen) {
    if (next.view==='executive' && !executiveKind) return
    // Legacy dashboard links continue to open the same record in its new home.
    // Tab 'inbox' sudah tidak ada di submenu Surat Masuk. Deep-link lama
    // (notifikasi, dashboard) diarahkan ke 'daftar' supaya tidak mendarat di
    // layar yang tidak bisa ditinggalkan lewat navigasi.
    const destination:Screen = next.view==='inbox' && (next.unit??lastWorkspaceUnit)==='urmin'
      ? {view:'workspace',unit:'urmin',menu:'surat-masuk',tab:'daftar',recordID:next.recordID}
      : next.view==='tasks' && (next.unit??lastWorkspaceUnit)==='urmin'
      ? {view:'workspace',unit:'urmin',menu:'disposisi',tab:'mine',recordID:next.recordID}
      : next.view==='workspace' && next.unit==='urmin' && next.menu==='__distribution-inbox'
      ? {...next,menu:'surat-masuk',tab:'daftar'}
      : next.view==='workspace' && next.unit==='urmin' && next.menu==='__tasks'
      ? {...next,menu:'disposisi',tab:'mine'} : next
    // Menu Disposisi disembunyikan untuk Kabagrenmin, tapi deep-link lama
    // (dashboard, notifikasi) masih menunjuk ke sana. Tanpa pengalihan ini ia
    // mendarat di layar yang tidak ada jalan kembalinya lewat sidebar.
    if (isKabagrenmin && destination.view==='workspace' && destination.unit==='urmin' && destination.menu==='disposisi') {
      setScreen({view:'workspace',unit:'urmin',menu:'surat-masuk',tab:'daftar',recordID:destination.recordID})
      setMobileMenu(false)
      return
    }
    if (destination.view==='workspace' && destination.unit==='urmin' && destination.menu==='__admin' && !isSuperadmin) return
    if (restrictedSuperadmin && !superadminViews.includes(destination.view)) return
    if (destination.view==='workspace' && destination.unit) setLastWorkspaceUnit(destination.unit)
    setScreen((destination.view==='inbox'||destination.view==='tasks')?{...destination,unit:lastWorkspaceUnit,sub:destination.sub??(screen.unit===lastWorkspaceUnit?renSubOf(screen):undefined)}:destination)
    setMobileMenu(false)
    window.scrollTo({top:0,behavior:'auto'})
  }
  useEffect(() => {
    if (restrictedSuperadmin && !superadminViews.includes(screen.view)) setScreen({view:'portal'})
  }, [restrictedSuperadmin, screen.view])
  function refresh() {
    const controller=new AbortController()
    const timer=window.setTimeout(()=>controller.abort(),4000)
    fetch('/api/v1/system/status',{cache:'no-store',signal:controller.signal})
      .then(async res=>{if(!res.ok)throw new Error('API not ready');const data:unknown=await res.json();if(!data||typeof data!=='object'||!('status' in data)||data.status!=='ready') throw new Error('API not ready');setDemoAdminEnabled('demoSuperadminWorkspace' in data&&data.demoSuperadminWorkspace===true);})
      .catch(()=>{setDemoAdminEnabled(false)})
      .finally(()=>window.clearTimeout(timer))
  }
  useEffect(()=>{refresh()},[])
  const effectiveScreen: Screen = restrictedSuperadmin && !superadminViews.includes(screen.view) ? {view:'portal'} : screen
  const displayTheme: Theme = account && !account.mustChangePassword && effectiveScreen.view==='portal' ? portalTheme : theme
  useEffect(() => { document.documentElement.dataset.theme=displayTheme },[displayTheme])
  function toggleDisplayTheme() {
    if (effectiveScreen.view==='portal') setPortalTheme(t=>t==='dark'?'light':'dark')
    else setTheme(t=>t==='dark'?'light':'dark')
  }
  useEffect(()=>{
    if(!mobileMenu)return
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setMobileMenu(false)}
    const desktop=()=>{if(window.innerWidth>760)setMobileMenu(false)}
    window.addEventListener('keydown',escape)
    window.addEventListener('resize',desktop)
    return()=>{window.removeEventListener('keydown',escape);window.removeEventListener('resize',desktop)}
  },[mobileMenu])
  const unit=effectiveScreen.unit?units.find(u=>u.id===effectiveScreen.unit):(effectiveScreen.view==='inbox'||effectiveScreen.view==='tasks'?units.find(u=>u.id===lastWorkspaceUnit):undefined)
  const chosenModule=unit?.modules.find(m=>m.id===effectiveScreen.menu)
  const renSub = renSubOf({...effectiveScreen,unit:unit?.id})
  const renSubInfo = renSubs.find(g=>g.id===renSub)
  const renChooser = effectiveScreen.view==='workspace' && unit?.id==='ren' && !renSub && !effectiveScreen.menu
  const sidebarModules = unit?.id==='ren'&&renSubInfo ? unit.modules.filter(m=>renSubInfo.modules.includes(m.id)) : unit?.modules ?? []
  const workspace = !renChooser && (effectiveScreen.view==='workspace'||effectiveScreen.view==='inbox'||effectiveScreen.view==='tasks') && unit
  const workMenu=effectiveScreen.view==='inbox'?'__distribution-inbox':effectiveScreen.view==='tasks'?'__tasks':effectiveScreen.menu
  const workTitle=unit?.id==='urmin'&&workMenu==='surat-masuk'&&isKabagrenmin?'Disposisi':unit?.id==='urmin'&&workMenu==='__unitwork'?'Berkas Kerja':unit?.id==='urmin'&&workMenu==='disposisi'?'Disposisi':unit?.id==='urmin'&&workMenu==='arsip'?'Arsip':unit?.id==='urmin'&&workMenu==='__admin'?'Pengguna & Hak Akses':workMenu==='__unitwork'?'Berkas, Foto & Disposisi':workMenu==='__distribution-inbox'?'Inbox Distribusi':workMenu==='__tasks'?'Tugas Disposisi':chosenModule?.title??renSubInfo?.name??unit?.name??''
  const workSubtitle=unit?.id==='urmin'&&workMenu==='surat-masuk'&&isKabagrenmin?'Surat masuk yang diajukan kepada Anda untuk didisposisikan.':workMenu==='__unitwork'?'Kelola berkas, lampiran, dan tugas internal.':workMenu==='disposisi'&&unit?.id==='urmin'?'Tugas, tindak lanjut, dan review disposisi.':workMenu==='__admin'?'Kelola akun dan kewenangan sesuai hak akses.':workMenu==='__distribution-inbox'?'Surat yang diteruskan kepada Anda.':workMenu==='__tasks'?'Pantau tugas dan tindak lanjut.':chosenModule?.description??renSubInfo?.description??unit?.subtitle??''
  const activeTab=workMenu&&unit?.id==='urmin'?(urminTabs[workMenu]?.some(t=>t.id===effectiveScreen.tab)?effectiveScreen.tab:defaultUrminTab[workMenu]):undefined
  const adminSecurity = <section className="panel sdl-r5f5-admin-note"><h2>Kewenangan</h2><p>Hak akses ditentukan oleh role dan izin yang diberikan. Pengelolaan akun tidak otomatis membuka seluruh data unit.</p><button type="button" className="btn" onClick={()=>navigate({view:'workspace',unit:'urmin',menu:'__admin',tab:'roles'})}><Icon name="key" size={16}/> Lihat Role & Akses</button></section>
  async function logout(){
    try {
      const c=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'});
      if(c.ok){const data:{csrfToken:string}=await c.json();await fetch('/api/v1/auth/logout',{method:'POST',credentials:'same-origin',headers:{'X-CSRF-Token':data.csrfToken}})}
    } finally {setAccount(null);navigate({view:'portal'})}
  }
  if(!account)return <div className="sdl-shell" data-theme={theme}><Authentication onAuthenticated={setAccount}/></div>
  if(account.mustChangePassword)return <div className="sdl-shell" data-theme={theme}><PasswordRotation onComplete={setAccount}/></div>
  return <div className="sdl-shell sdl-shell--active" data-theme={displayTheme}>
    <UIFeedbackHost/>
    <header className="sdl-header">
      <div className="header-left"><button type="button" className="icon-btn hamburger" aria-label={mobileMenu?'Tutup navigasi':'Buka navigasi'} aria-expanded={mobileMenu} aria-controls={workspace?'sdl-work-sidebar':'sdl-mobile-primary-nav'} onClick={()=>setMobileMenu(o=>!o)}><Icon name={mobileMenu?'x':'menu'}/></button><button className="brand-button" onClick={()=>navigate({view:'portal'})}><Brand compact/></button></div>
      <nav className="header-actions sdl-nav-clean" aria-label="Main navigation">
        <button type="button" className={`header-text-btn ${effectiveScreen.view==='portal'?'nav-current':''}`} onClick={()=>navigate({view:'portal'})}><Icon name="grid" size={17}/> <span>Portal</span></button>
        {executiveKind&&<button type="button" className={`header-text-btn ${effectiveScreen.view==='executive'?'nav-current':''}`} onClick={()=>navigate({view:'executive'})}><Icon name="chart" size={17}/> <span>Dashboard</span></button>}
        {!restrictedSuperadmin&&<button type="button" className={`header-text-btn ${effectiveScreen.view==='arahan'?'nav-current':''}`} onClick={()=>navigate({view:'arahan'})}><Icon name="bell" size={17}/> <span>Arahan</span></button>}
        {!(workspace&&unit.id==='urmin')&&!restrictedSuperadmin&&<button type="button" className={`header-text-btn ${effectiveScreen.view==='inbox'?'nav-current':''}`} onClick={()=>navigate({view:'inbox'})}><Icon name="inbox" size={17}/> <span>Inbox</span></button>}
        {!(workspace&&unit.id==='urmin')&&!restrictedSuperadmin&&<button type="button" className={`header-text-btn ${effectiveScreen.view==='tasks'?'nav-current':''}`} onClick={()=>navigate({view:'tasks'})}><Icon name="clipboard" size={17}/> <span>Tasks</span></button>}
        {account.roles.includes('superadmin')&&<details className="sdl-nav-menu"><summary aria-label="Management"><Icon name="settings" size={17}/> <span>Manage</span><Icon name="chevron" size={13}/></summary>
          <div className="sdl-nav-dropdown" role="group" aria-label="Management">
            <button type="button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');navigate({view:'users'})}}><Icon name="users" size={16}/> Users & Access</button>
            <button type="button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');navigate({view:'roles'})}}><Icon name="key" size={16}/> Roles & Permissions</button>
            <button type="button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');navigate({view:'master'})}}><Icon name="folder" size={16}/> Master Data</button>
            <button type="button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');navigate({view:'roadmap'})}}><Icon name="list" size={16}/> Roadmap</button>
          </div>
        </details>}
        <span className="sdl-nav-separator" aria-hidden="true"/>
        <button type="button" className="icon-btn sdl-nav-theme" title={displayTheme==='dark'?'Aktifkan tampilan terang':'Aktifkan tampilan gelap'} aria-label={displayTheme==='dark'?'Light mode':'Dark mode'} onClick={toggleDisplayTheme}><Icon name={displayTheme==='dark'?'sun':'moon'}/></button>
        <details className="sdl-nav-menu sdl-nav-account"><summary aria-label="Account menu"><HeaderAvatar revision={profileAvatarRevision}/><span className="sdl-nav-account-name">{account.displayName}</span><Icon name="chevron" size={13}/></summary>
          <div className="sdl-nav-dropdown sdl-nav-dropdown--right" role="group" aria-label="Account">
            <button type="button" onClick={e=>{e.currentTarget.closest('details')?.removeAttribute('open');navigate({view:'profile'})}}><Icon name="user" size={16}/> My Profile</button>
            <button type="button" className="sdl-nav-signout" onClick={()=>void logout()}><Icon name="lock" size={16}/> Sign Out</button>
          </div>
        </details>
      </nav>
    </header>
    {/* Mobile global nav is separate from the operational workspace sidebar. */}
    {!workspace&&mobileMenu&&<>
      <button type="button" className="sdl-r5f23c-nav-backdrop" aria-label="Tutup navigasi" onClick={()=>setMobileMenu(false)}/>
      <aside id="sdl-mobile-primary-nav" className="sdl-r5f23c-nav-drawer" aria-label="Navigasi seluler">
        <div className="sdl-r5f23c-nav-heading"><strong>Menu SIERA</strong><button type="button" aria-label="Tutup menu" onClick={()=>setMobileMenu(false)}><Icon name="x" size={20}/></button></div>
        <nav aria-label="Navigasi utama seluler">
          <button type="button" className={effectiveScreen.view==='portal'?'is-active':''} onClick={()=>navigate({view:'portal'})}><Icon name="grid" size={18}/> Portal</button>
          {executiveKind&&<button type="button" className={effectiveScreen.view==='executive'?'is-active':''} onClick={()=>navigate({view:'executive'})}><Icon name="chart" size={18}/> Dashboard</button>}
          {!restrictedSuperadmin&&<button type="button" className={effectiveScreen.view==='arahan'?'is-active':''} onClick={()=>navigate({view:'arahan'})}><Icon name="bell" size={18}/> Arahan</button>}
          {!restrictedSuperadmin&&<button type="button" className={effectiveScreen.view==='inbox'?'is-active':''} onClick={()=>navigate({view:'inbox'})}><Icon name="inbox" size={18}/> Inbox</button>}
          {!restrictedSuperadmin&&<button type="button" className={effectiveScreen.view==='tasks'?'is-active':''} onClick={()=>navigate({view:'tasks'})}><Icon name="clipboard" size={18}/> Tasks</button>}
          <button type="button" className={effectiveScreen.view==='roadmap'?'is-active':''} onClick={()=>navigate({view:'roadmap'})}><Icon name="list" size={18}/> Roadmap</button>
          <div className="sdl-r5f23c-nav-divider"/>
          <button type="button" onClick={()=>navigate({view:'profile'})}><Icon name="user" size={18}/> Profil Saya</button>
          {isSuperadmin&&<><button type="button" onClick={()=>navigate({view:'users'})}><Icon name="users" size={18}/> Users & Access</button><button type="button" onClick={()=>navigate({view:'roles'})}><Icon name="key" size={18}/> Roles & Permissions</button><button type="button" onClick={()=>navigate({view:'master'})}><Icon name="folder" size={18}/> Master Data</button></>}
          <button type="button" onClick={()=>{toggleDisplayTheme();setMobileMenu(false)}}><Icon name={displayTheme==='dark'?'sun':'moon'} size={18}/> {displayTheme==='dark'?'Mode Terang':'Mode Gelap'}</button>
          <div className="sdl-r5f23c-nav-divider"/>
          <button type="button" className="sdl-r5f23c-nav-logout" onClick={()=>void logout()}><Icon name="lock" size={18}/> Keluar Akun</button>
        </nav>
      </aside>
    </>}
    {workspace ? <div className="work-layout">
      {mobileMenu&&<button aria-label="Tutup navigasi" className="nav-overlay" onClick={()=>setMobileMenu(false)}/>}
      <aside id="sdl-work-sidebar" className={`work-sidebar ${mobileMenu?'open':''} ${sidebarCollapsed?'sdl-sidebar--collapsed':''}`}>
        <button className="sdl-side-toggle" type="button" title={sidebarCollapsed?"Expand sidebar":"Collapse sidebar"} aria-label={sidebarCollapsed?"Expand sidebar":"Collapse sidebar"} aria-pressed={sidebarCollapsed} onClick={()=>setSidebarCollapsed(v=>!v)}><Icon name="chevron" size={17}/></button>
        <div className="sidebar-unit"><Label tone="amber"><Icon name={unit.icon} size={14}/> {unit.title}</Label><strong>{renSubInfo?.name??unit.name}</strong><p>{renSubInfo?.description??unit.subtitle}</p></div>
        <nav className="sidebar-scroll" aria-label={`Menu ${unit.title}`}>
          {unit.id==='urmin' ? <>
            <div className="sidebar-group">MENU UTAMA</div>
            {visibleUrminNav.map(item=><button key={item.id||'dashboard'} type="button" title={item.label} className={`side-link ${(workMenu===item.id||(!workMenu&&!item.id))?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'workspace',unit:'urmin',menu:item.id||undefined})}><Icon name={item.icon} size={18}/><span>{item.label}</span></button>)}
            {isSuperadmin&&<><div className="sidebar-group">ADMINISTRASI</div><button type="button" title="Pengguna & Hak Akses" className={`side-link ${workMenu==='__admin'?'selected':''}`} onClick={()=>navigate({view:'workspace',unit:'urmin',menu:'__admin',tab:'users'})}><Icon name="users" size={18}/><span>Pengguna & Hak Akses</span></button></>}
          </> : unit.id==='ren' ? <>
            <div className="sidebar-group">MENU UTAMA</div>
            <button type="button" title="Dashboard" className={`side-link ${!chosenModule&&!workMenu?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'workspace',unit:'ren',sub:renSub})}><Icon name="grid" size={18}/><span>Dashboard</span></button>
            {sidebarModules.map(m=><button type="button" key={m.id} title={m.title} className={`side-link ${chosenModule?.id===m.id?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'workspace',unit:'ren',menu:m.id,sub:renSub})}><Icon name={m.icon} size={18}/><span>{m.title}</span></button>)}
            <div className="sidebar-group">DISTRIBUSI & BERKAS</div>
            <button type="button" title="Inbox Distribusi" className={`side-link ${workMenu==='__distribution-inbox'?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'inbox'})}><Icon name="inbox" size={18}/><span>Inbox Distribusi</span></button>
            <button type="button" title="Tugas Disposisi" className={`side-link ${workMenu==='__tasks'?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'tasks'})}><Icon name="clipboard" size={18}/><span>Tugas Disposisi</span></button>
            <button type="button" title="Berkas, Foto & Disposisi" className={`side-link ${workMenu==='__unitwork'?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'workspace',unit:'ren',menu:'__unitwork',sub:renSub})}><Icon name="folder" size={18}/><span>Berkas, Foto & Disposisi</span></button>
          </> : <>
          <div className="sidebar-group">RINGKASAN</div><button title="Dashboard Unit" className={`side-link ${!chosenModule&&!workMenu?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'workspace',unit:unit.id,sub:renSub})}><Icon name="grid" size={18}/> Dashboard Unit</button>
          <div className="sidebar-group">DISTRIBUSI</div><button title="Inbox Distribusi" className={`side-link ${workMenu==='__distribution-inbox'?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'inbox'})}><Icon name="inbox" size={18}/> Inbox Distribusi</button><button title="Tugas Disposisi" className={`side-link ${workMenu==='__tasks'?'selected':''}`} onClick={()=>navigate({view:'tasks'})}><Icon name="clipboard" size={18}/><span>Tugas Disposisi</span></button><div className="sidebar-group">BERKAS & TUGAS AKTIF</div><button title="Berkas, Foto & Disposisi" className={`side-link ${workMenu==='__unitwork'?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'workspace',unit:unit.id,menu:'__unitwork',sub:renSub})}><Icon name="folder" size={18}/> Berkas, Foto & Disposisi</button><div className="sidebar-group">LAYANAN OPERASIONAL</div>{sidebarModules.map(m=><button key={m.id} title={m.title} className={`side-link ${chosenModule?.id===m.id?'selected':''}`} disabled={restrictedSuperadmin} onClick={()=>navigate({view:'workspace',unit:unit.id,menu:m.id})}><Icon name={m.icon} size={18}/><span>{m.title}</span></button>)}
          <div className="sidebar-group">MANAJEMEN</div>{account.roles.includes('superadmin')&&<button title="User & Access Management" className="side-link" onClick={()=>navigate({view:'users'})}><Icon name="users" size={18}/> User & Access Management</button>}<button title="Delegasi Kewenangan" className="side-link restricted-menu" disabled><Icon name="clock" size={18}/> Delegasi Kewenangan</button><button title="Akses & Kewenangan" className="side-link" disabled={restrictedSuperadmin} onClick={()=>navigate({view:'security'})}><Icon name="shield" size={18}/> Akses & Kewenangan</button><button title="Roadmap Pengembangan" className="side-link" onClick={()=>navigate({view:'roadmap'})}><Icon name="list" size={18}/> Roadmap Pengembangan</button>
          </>}
        </nav><div className="sidebar-footer">{unit.id==='ren'&&renSubInfo?<button type="button" title="Kembali ke pilihan Progar / Pagu Anggaran" className="back-to-portal" onClick={()=>navigate({view:'workspace',unit:'ren'})}><Icon name="back" size={16}/> Kembali ke SUBBAGREN</button>:<button title="Kembali ke Portal" className="back-to-portal" onClick={()=>navigate({view:'portal'})}><Icon name="back" size={16}/> Kembali ke Portal</button>}</div>
      </aside>
      <main className="work-main"><div className="content-wrap">
        <div className="breadcrumb"><button onClick={()=>navigate({view:'portal'})}>Portal</button><Icon name="chevron" size={13}/><button onClick={()=>navigate({view:'workspace',unit:unit.id})}>{unit.title}</button>{renSubInfo&&<><Icon name="chevron" size={13}/>{(chosenModule||workMenu)?<button onClick={()=>navigate({view:'workspace',unit:'ren',sub:renSubInfo.id})}>{renSubInfo.title}</button>:<strong>{renSubInfo.title}</strong>}</>}{(chosenModule||workMenu)&&<><Icon name="chevron" size={13}/><strong>{workTitle}</strong></>}</div>
        <div className="section-heading sdl-consistent-heading"><div><span className="eyebrow">{unit.title}{renSubInfo?` · ${renSubInfo.title}`:''}</span><h1>{workTitle}</h1><p>{workSubtitle}</p></div></div>
        {unit.id==='urmin' && workMenu && urminTabs[workMenu] && (workMenu!=='__admin'||isSuperadmin) && <nav className="sdl-r5f5-tabs" aria-label={`Bagian ${workTitle}`}>
          {urminTabs[workMenu].map(tab=><button type="button" key={tab.id} className={`sdl-r5f5-tab ${activeTab===tab.id?'is-active':''}`} aria-current={activeTab===tab.id?'page':undefined} onClick={()=>navigate({view:'workspace',unit:'urmin',menu:workMenu,tab:tab.id})}>{tab.label}</button>)}
        </nav>}

        {unit.id==='urmin'&&workMenu==='__admin'&&isSuperadmin
          ? activeTab==='roles'?<RoleManagement/>:activeTab==='security'?adminSecurity:activeTab==='master'?<MasterData/>:<UserManagement/>
          : unit.id==='urmin'&&workMenu==='surat-masuk'&&activeTab==='inbox'
          ? <InboxDistribusi key="inbox" initialID={effectiveScreen.recordID} workspaceMode="inbox"/>
          : unit.id==='urmin'&&workMenu==='surat-masuk'&&activeTab==='riwayat'
          ? <><p className="sdl-r5f5-context">Riwayat distribusi yang telah diterima oleh akun Anda. Detail setiap surat menampilkan perjalanan penerimaannya.</p><InboxDistribusi key="history" workspaceMode="history"/></>
          : workMenu==='__unitwork' ? <UnitWorkR5A key={unit.id} unit={{urmin:'urmin',ren:'subbagren',sumda:'subbagsumda',binfung:'subbagbinfung'}[unit.id] as 'urmin'|'subbagren'|'subbagsumda'|'subbagbinfung'} userID={account.id} initialRecordID={effectiveScreen.recordID} demoAdmin={isSuperadmin&&demoAdminEnabled}/>
          : unit.id==='sumda'&&['personel','pendidikan','inventaris'].includes(chosenModule?.id||'') ? <SumdaR5B key={chosenModule?.id} kind={chosenModule!.id as 'personel'|'pendidikan'|'inventaris'} openFiles={recordID=>navigate({view:'workspace',unit:'sumda',menu:'__unitwork',recordID})}/>
          : unit.id==='urmin'&&['surat-keluar','agenda','arsip'].includes(chosenModule?.id||'') ? <UrminR5D key={chosenModule?.id} initialID={effectiveScreen.recordID} initialCreate={effectiveScreen.create} kind={({'surat-keluar':'surat_keluar',agenda:'agenda',arsip:'arsip'} as Record<string,'surat_keluar'|'agenda'|'arsip'>)[chosenModule!.id]} openFiles={recordID=>navigate({view:'workspace',unit:'urmin',menu:'__unitwork',recordID})} isKabagrenmin={isKabagrenmin}/>
          : unit.id==='binfung'&&['sop','pid','rb','abk','pembinaan','evaluasi'].includes(chosenModule?.id||'') ? <BinfungR5C key={chosenModule?.id} kind={chosenModule!.id as 'sop'|'pid'|'rb'|'abk'|'pembinaan'|'evaluasi'} openFiles={recordID=>navigate({view:'workspace',unit:'binfung',menu:'__unitwork',recordID})}/>
          : workMenu==='__distribution-inbox' ? <InboxDistribusi initialID={effectiveScreen.recordID}/>
          : workMenu==='__tasks' ? <TugasDisposisi currentUserId={account.id} initialID={effectiveScreen.recordID} onOpenDirective={id=>navigate({view:'arahan',recordID:id})}/>
          : chosenModule?.id==='surat-masuk' && unit.id==='urmin' ? <SuratMasuk initialID={effectiveScreen.recordID} initialCreate={effectiveScreen.create} isKabagrenmin={isKabagrenmin}/>
          : chosenModule?.id==='usulan' && unit.id==='ren' ? <UsulanR4A/>
          : chosenModule?.id==='realisasi' && unit.id==='ren' ? <BudgetR4A3/>
          : chosenModule?.id==='disposisi' && unit.id==='urmin' && activeTab==='semua' ? <SeluruhDisposisi onOpenLetter={incomingID=>navigate({view:'workspace',unit:'urmin',menu:'surat-masuk',tab:'daftar',recordID:incomingID})}/>
          : chosenModule?.id==='disposisi' && unit.id==='urmin' ? <TugasDisposisi key={activeTab||'mine'} currentUserId={account.id} initialID={effectiveScreen.recordID} onOpenDirective={id=>navigate({view:'arahan',recordID:id})} workspaceTab={(activeTab||'mine') as 'mine'|'review'} onOpenLetter={incomingID=>navigate({view:'workspace',unit:'urmin',menu:'surat-masuk',tab:'daftar',recordID:incomingID})}/>
          : chosenModule ? <><div className="panel table-panel"><div className="table-toolbar"><label className="search-box"><Icon name="search" size={17}/><input disabled placeholder="Cari data (tersedia setelah API aktif)" aria-label="Cari data" /></label><Label>0 data tersambung</Label><button className="btn primary" disabled title="Fitur tambah data memerlukan backend dan autentikasi"><Icon name="plus" size={15}/> Tambah Data</button></div><div className="table-scroll"><table className="data-table"><thead><tr>{chosenModule.columns.map(col=><th key={col}>{col}</th>)}</tr></thead></table></div><EmptyState title="Belum ada data operasional" description={`${chosenModule.title} sedang dipersiapkan. Pencarian, tambah/edit dan ekspor baru akan aktif setelah API, permission, dan modul ini selesai.`} icon={chosenModule.icon}/></div><div className="info-strip"><Icon name="info" size={18}/>  </div></>
          : unit.id==='urmin' ? <UrminCommandDashboard accountID={account.id} onOpen={(menu,recordID,create)=>navigate({view:'workspace',unit:'urmin',menu,recordID,create})} onInbox={(distributionID)=>navigate({view:'workspace',unit:'urmin',menu:'disposisi',tab:'mine',recordID:distributionID})} onTask={(taskID)=>navigate({view:'workspace',unit:'urmin',menu:'disposisi',tab:'mine',recordID:taskID})}/>
          : <SmartUnitDashboard unit={unit.id} title={unit.name} accent={unit.accent} onOpen={menu=>navigate({view:'workspace',unit:unit.id,menu,sub:renSub})}/>
        }
      </div></main>
    </div> : <main className={(effectiveScreen.view==='portal'||effectiveScreen.view==='arahan'||effectiveScreen.view==='executive') ? 'portal-main portal-main--wide' : 'portal-main'}>
      {renChooser && unit && <section className="sdl-ren-chooser" aria-label="Pilih ruang kerja SUBBAGREN">
        <div className="breadcrumb"><button onClick={()=>navigate({view:'portal'})}>Portal</button><Icon name="chevron" size={13}/><strong>{unit.title}</strong></div>
        <div className="page-heading"><span className="eyebrow">{unit.title}</span><h1>{unit.name}</h1><p>Pilih ruang kerja yang ingin dibuka.</p></div>
        <div className="sdl-ren-chooser__grid">{renSubs.map(g=><button type="button" key={g.id} className="unit-card" style={{'--unit':unit.accent,'--unit-soft':unit.soft} as CSSProperties} onClick={()=>navigate({view:'workspace',unit:'ren',sub:g.id})}><span className="unit-icon"><Icon name={g.icon} size={24}/></span><strong>{g.title}</strong><p>{g.description}</p><span className="unit-footer">Buka {g.name}<Icon name="arrow" size={14}/></span></button>)}</div>
        <div className="sdl-ren-chooser__footer"><button type="button" className="sdl-ren-back" onClick={()=>navigate({view:'portal'})}><Icon name="back" size={15}/> Kembali ke Portal</button></div>
      </section>}
      {effectiveScreen.view==='portal' && <PortalV3R5F21 isSuperadmin={isSuperadmin} onOpenUnit={id=>navigate({view:'workspace',unit:id})}/> }
      {effectiveScreen.view==='executive' && executiveKind && <ExecutiveDecisionR5F24 onBack={()=>navigate({view:'portal'})} onOpen={area=>{switch(area){
        case 'arahan':navigate({view:'arahan'});break;
        case 'users':navigate({view:'users'});break;
        case 'roles':navigate({view:'roles'});break;
        case 'roadmap':navigate({view:'roadmap'});break;
        case 'urmin':navigate({view:'workspace',unit:'urmin'});break;
        case 'ren':navigate({view:'workspace',unit:'ren'});break;
        case 'sumda':navigate({view:'workspace',unit:'sumda'});break;
        case 'binfung':navigate({view:'workspace',unit:'binfung'});break;
      }}}/>}
      {effectiveScreen.view==='arahan' && !restrictedSuperadmin && <DirectivesR5F23 key={effectiveScreen.recordID||'arahan'} initialID={effectiveScreen.recordID} onNotificationChange={()=>{fetch('/api/v1/leadership/directives/notifications',{cache:'no-store',credentials:'same-origin'}).then(r=>r.ok?r.json():null).then((n:{total?:number}|null)=>{if(n)setDirectiveAlerts(Math.max(0,Number(n.total||0))) }).catch(()=>{})}}/>}
      {effectiveScreen.view==='delegations' && <div className="page-heading"><h1>Akses ditolak</h1><p>Delegasi memerlukan kebijakan persetujuan terpisah dari Superadmin.</p></div>}
      {effectiveScreen.view==='profile' && <MyProfile onBack={()=>navigate({view:'portal'})} onChanged={c=>{if(c.displayName||c.email)setAccount(old=>old?{...old,...(c.displayName?{displayName:c.displayName}:{}),...(c.email?{email:c.email}:{})}:old);if(c.avatar)setProfileAvatarRevision(x=>x+1)}}/>}
      {effectiveScreen.view==='users' && (account.roles.includes('superadmin')?<UserManagement/>:<div className="page-heading"><h1>Akses ditolak</h1></div>)}
      {effectiveScreen.view==='roles' && (account.roles.includes('superadmin')?<RoleManagement/>:<div className="page-heading"><h1>Akses ditolak</h1><p>Hanya Superadmin yang berwenang mengelola role.</p></div>)}
      {effectiveScreen.view==='master' && (account.roles.includes('superadmin')?<MasterData/>:<div className="page-heading"><h1>Akses ditolak</h1><p>Hanya Superadmin yang berwenang mengelola master data.</p></div>)}
      {effectiveScreen.view==='roadmap' && <><div className="page-heading"><span className="eyebrow">ROADMAP</span><h1>Roadmap Pengembangan</h1><p>Progres modul dan layanan SIERA DELTA LIMA.</p></div><DevelopmentChecklist/></>}
      {effectiveScreen.view==='security' && <><div className="page-heading"><span className="eyebrow">SECURITY & ACCESS</span><h1>Kewenangan & RBAC</h1><p>Kelola kewenangan dan akses pengguna.</p></div>{account.roles.includes('superadmin')&&<button className="btn primary" onClick={()=>navigate({view:'roles'})} style={{marginBottom:16}}><Icon name="key" size={16}/> Kelola Role & Permission</button>}{account.roles.includes('superadmin')&&<button className="btn" style={{marginBottom:18,marginLeft:8}} onClick={()=>navigate({view:'users'})}><Icon name="users" size={16}/> Kelola Pengguna & Akses</button>}<div className="metric-grid"><Metric name="Master Unit" icon="layers" value="4" hint="Terdaftar dalam migration R2A"/><Metric name="Role Awal" icon="users" value="4" hint="Definisi role awal R2A"/><Metric name="Sesi Aktif" icon="lock" hint="Sesi aktif"/><Metric name="Audit Aktivitas" icon="shield" hint="Menunggu endpoint audit"/></div><section className="panel security-panel"><div className="panel-title"><div><h3>Aturan akses yang wajib diterapkan</h3><p>Desain kebijakan. Ini belum merupakan hasil audit enforcement.</p></div><Label tone="amber">Pengaturan akses</Label></div><div className="rule-grid">{[{icon:'lock' as IconName,title:'Deny by default',text:'Endpoint dan data ditolak bila tidak ada permission eksplisit.'},{icon:'users' as IconName,title:'Akses sesuai unit',text:'Role tidak otomatis membuka data dari seluruh unit kerja.'},{icon:'shield' as IconName,title:'Superadmin terbatas',text:'Administrasi sistem tidak identik dengan hak membaca seluruh dokumen.'},{icon:'list' as IconName,title:'Audit terukur',text:'Perubahan user, role, session, dan dokumen tercatat sesuai hak akses.'}].map(r=><div className="rule" key={r.title}><span><Icon name={r.icon}/></span><strong>{r.title}</strong><p>{r.text}</p></div>)}</div></section></>}
      </main>}
    <footer className="sdl-footer"><span>© 2026 SIERA DELTA LIMA</span><span>BagRenmin Densus 88 AT Polri</span></footer>
  </div>
}
export default App
