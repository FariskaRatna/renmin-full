import { confirmDialog, FloatingToast } from './UIFeedback'
import {useCallback,useEffect,useState,type FormEvent} from 'react'

type Pagu={id:string;proposalId:string;proposalTitle:string;fiscalYear:number;classification:string;amount:string;authorizationNumber:string;authorizationIssuer:string;authorizationDate:string;status:'pending'|'verified'|'rejected';createdBy:string;version:number;verifiedRealization:string;remaining:string}
type Realisasi={id:string;paguId:string;amount:string;transactionDate:string;evidenceReference:string;description:string;status:'pending'|'verified'|'rejected';createdBy:string;version:number}
type Proposal={id:string;title:string;number:number;fiscalYear:number;reviewStatus?:string}
type Overview={pagus:Pagu[];realizations:Realisasi[];totals:{paguVerified:string;realizationVerified:string;remaining:string};basis:string;limited:boolean}
type Proof={id:string;realisasiId:string;filename:string;mime:string;size:number;sha256:string;status:string;uploadedBy:string;version:number;reviewReason:string|null}
type Reconcile={year:number;units:{unit:string;paguVerified:string;realizationVerified:string;pendingTransactions:number;rejectedTransactions:number;missingEvidence:number;pendingEvidence:number;rejectedEvidence:number}[];limited:boolean;basis:string;officialLRA:false}
type RequestBody=Record<string,string|number>
type Capabilities={read:boolean;register:boolean;verifyPagu:boolean;record:boolean;verifyRealization:boolean;uploadEvidence:boolean;readEvidence:boolean;reviewEvidence:boolean;reconcile:boolean}
const base='/api/v1/subbagren/budget/'
const formatRp=(n:string)=>{try{return 'Rp '+new Intl.NumberFormat('id-ID').format(BigInt(n))}catch{return 'Rp —'}}
const stateName=(s:string)=>s==='verified'?'Terverifikasi':s==='rejected'?'Ditolak':'Menunggu Verifikasi'
async function api<T>(path:string,method:'GET'|'POST'='GET',body?:RequestBody):Promise<T>{
 const headers:Record<string,string>={}
 if(method!=='GET'){
  const r=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
  if(!r.ok)throw new Error('Sesi/CSRF tidak tersedia. Login kembali.')
  const j:{csrfToken:string}=await r.json();headers['X-CSRF-Token']=j.csrfToken;headers['Content-Type']='application/json'
 }
 const r=await fetch(path,{method,headers,body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'same-origin'})
 if(!r.ok){if(r.status===403||r.status===404)throw new Error('Tidak ada akses atau grant belum aktif.');if(r.status===409)throw new Error('Konflik data atau sisa pagu tidak mencukupi. Muat ulang.');throw new Error(`Gagal (HTTP ${r.status})`)}
 return r.json() as Promise<T>
}
async function evidenceFileUpload(path:string,file:File,reason:string){
 const csrf=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
 if(!csrf.ok)throw new Error('CSRF/Sesi tidak tersedia.')
 const {csrfToken}:{csrfToken:string}=await csrf.json()
 const payload=new FormData();payload.set('file',file);payload.set('reason',reason)
 const res=await fetch(path,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'X-CSRF-Token':csrfToken},body:payload})
 if(!res.ok)throw new Error(`Upload bukti gagal (HTTP ${res.status}). Pastikan permission, tipe/ukuran, dan status transaksi.`)
 return res.json()
}
const reasonDefault='Verifikasi independen berdasarkan dokumen dan bukti yang diperiksa'
export default function BudgetR4A3(){
 const [year,setYear]=useState(new Date().getFullYear())
 const [overview,setOverview]=useState<Overview|null>(null)
 const [approved,setApproved]=useState<Proposal[]>([])
 const [capabilities,setCapabilities]=useState<Capabilities|null>(null)
 const [error,setError]=useState('')
 const [info,setInfo]=useState('')
 const [busy,setBusy]=useState(false)
 const [pagu,setPagu]=useState({proposalId:'',amount:'',authorizationNumber:'',authorizationIssuer:'',authorizationDate:new Date().toISOString().slice(0,10),reason:''})
 const [real,setReal]=useState({paguId:'',amount:'',transactionDate:new Date().toISOString().slice(0,10),evidenceReference:'',description:'',reason:''})
 const [reviewNote,setReviewNote]=useState(reasonDefault)
 const [selectedReal,setSelectedReal]=useState('')
 const [proofFile,setProofFile]=useState<File|null>(null)
 const [proofs,setProofs]=useState<Proof[]>([])
 const [reconcile,setReconcile]=useState<Reconcile|null>(null)
 const [proofReason,setProofReason]=useState('Dokumen bukti transaksi dilampirkan untuk verifikasi')
 const refresh=useCallback(async()=>{
  const [records,proposals,caps]=await Promise.all([api<Overview>(`${base}?year=${year}`),api<{items:Proposal[]}>('/api/v1/subbagren/usulan/'),api<Capabilities>(`${base}capabilities`)])
  setOverview(records);setCapabilities(caps);setApproved(proposals.items.filter(p=>p.fiscalYear===year&&p.reviewStatus==='approved'))
  if(caps.reconcile){setReconcile(await api<Reconcile>(`${base}reconciliation?year=${year}`))}else{setReconcile(null)}
 },[year])
 useEffect(()=>{void refresh().catch(e=>setError(e instanceof Error?e.message:'Gagal mengambil data'))},[refresh])
 async function execute<T>(fn:()=>Promise<T>,message:string){if(busy)return;setBusy(true);setError('');setInfo('');try{await fn();await refresh();setInfo(message)}catch(e){setError(e instanceof Error?e.message:'Operasi gagal')}finally{setBusy(false)}}
 function submitPagu(e:FormEvent){e.preventDefault();if(!pagu.proposalId||!/^[1-9][0-9]{0,14}$/.test(pagu.amount))return setError('Nominal pagu wajib angka positif maksimal 15 digit.');void execute(()=>api(`${base}pagu`,'POST',{...pagu,amount:Number(pagu.amount)}),'Pagu berhasil diajukan.')}
 function submitReal(e:FormEvent){e.preventDefault();if(!real.paguId||!/^[1-9][0-9]{0,14}$/.test(real.amount))return setError('Nominal realisasi wajib angka positif maksimal 15 digit.');void execute(()=>api(`${base}realisasi`,'POST',{...real,amount:Number(real.amount)}),'Realisasi berhasil dicatat.')}
 const proofPath=(id:string)=>`${base}realisasi/${id}/evidence`
 async function loadProofs(id:string){setSelectedReal(id);if(!id){setProofs([]);return}const got=await api<{items:Proof[]}>(proofPath(id));setProofs(got.items)}
 function uploadProof(e:FormEvent){e.preventDefault();if(!selectedReal||!proofFile)return setError('Pilih transaksi dan file bukti.');if(proofFile.size>5*1024*1024)return setError('Batas file 5 MiB.');if(proofReason.trim().length<8)return setError('Alasan minimal 8 karakter.');void execute(async()=>{await evidenceFileUpload(proofPath(selectedReal),proofFile,proofReason);await loadProofs(selectedReal);setProofFile(null)},'Bukti berhasil diunggah.')}
 async function reviewProof(id:string,version:number,decision:'approved'|'rejected'){if(reviewNote.trim().length<8)return setError('Alasan minimal 8 karakter.');if(!await confirmDialog(`${decision==='approved'?'Setujui':'Tolak'} bukti ini?`,{confirmLabel:decision==='approved'?'Setujui':'Tolak',danger:decision==='rejected'}))return;void execute(async()=>{await api(`${proofPath(selectedReal)}/${id}/review`,'POST',{version,decision,reason:reviewNote});await loadProofs(selectedReal)},`Bukti ${decision} tercatat.`)}
 async function decide(kind:'pagu'|'realisasi',id:string,version:number,decision:'verified'|'rejected'){
  if(reviewNote.trim().length<8)return setError('Alasan verifikasi wajib minimal 8 karakter.')
  if(!await confirmDialog(`${decision==='verified'?'Verifikasi':'Tolak'} ${kind} ini?`,{confirmLabel:decision==='verified'?'Verifikasi':'Tolak',danger:decision==='rejected'}))return
  void execute(()=>api(`${base}${kind}/${id}/review`,'POST',{decision,version,reason:reviewNote}),`Keputusan ${stateName(decision)} tercatat dalam audit.`)
 }
 return <div className="sm-root">
  <div className="sm-top-note"><strong>Pagu & Realisasi Anggaran</strong><span>Ringkasan pagu, bukti, dan realisasi.</span></div>
  
  {error&&<FloatingToast message={error} kind="error"/>}{info&&<FloatingToast message={info} kind="success"/>}
  <section className="panel sm-panel">
   <div className="sm-toolbar"><strong>Monitoring berbasis transaksi verified</strong><label>Tahun Anggaran <input type="number" min={2020} max={2100} value={year} onChange={e=>setYear(Number(e.target.value))} style={{width:90}}/></label><button className="btn" onClick={()=>void refresh().catch(e=>setError(String(e)))} disabled={busy}>Refresh</button></div>
   {overview?<><div className="metric-grid">
    <div className="panel" style={{padding:16}}><small>Pagu Terverifikasi</small><h3>{formatRp(overview.totals.paguVerified)}</h3></div>
    <div className="panel" style={{padding:16}}><small>Realisasi Terverifikasi</small><h3>{formatRp(overview.totals.realizationVerified)}</h3></div>
    <div className="panel" style={{padding:16}}><small>Sisa Pagu</small><h3>{formatRp(overview.totals.remaining)}</h3></div>
    <div className="panel" style={{padding:16}}><small>Serapan verified</small><h3>{Number(overview.totals.paguVerified)>0?(Number(overview.totals.realizationVerified)/Number(overview.totals.paguVerified)*100).toFixed(1)+'%':'—'}</h3></div>
   </div><p className="sm-hint">Hanya transaksi terverifikasi yang dihitung. {overview.limited?'Tampilan terbatas; belum layak untuk konsolidasi final.':''}</p></>:<p>Memuat monitoring atau menunggu permission anggaran.read...</p>}
  </section>
  <section className="panel sm-panel"><h3>Register Pagu Berbasis Dokumen Anggaran</h3><p className="sm-hint">Usulan harus sudah Disetujui Internal. Pagu tetap Pending sampai diverifikasi oleh petugas lain berdasarkan dokumen resmi.</p>
   <form className="sm-form" onSubmit={submitPagu} style={{display:'grid',gap:10,marginTop:14}}>
    <label>Usulan disetujui internal <select required value={pagu.proposalId} onChange={e=>setPagu(p=>({...p,proposalId:e.target.value}))}><option value="">Pilih usulan</option>{approved.map(x=><option key={x.id} value={x.id}>{`USL-${x.number} · ${x.title}`}</option>)}</select></label>
    <label>Pagu (Rp) <input required inputMode="numeric" pattern="[1-9][0-9]*" value={pagu.amount} onChange={e=>setPagu(p=>({...p,amount:e.target.value}))} placeholder="90000000"/></label>
    <label>Nomor Dokumen Otorisasi <input required minLength={6} maxLength={160} value={pagu.authorizationNumber} onChange={e=>setPagu(p=>({...p,authorizationNumber:e.target.value}))}/></label>
    <label>Instansi Penerbit <input required minLength={5} maxLength={160} value={pagu.authorizationIssuer} onChange={e=>setPagu(p=>({...p,authorizationIssuer:e.target.value}))}/></label>
    <label>Tanggal Dokumen <input required type="date" value={pagu.authorizationDate} onChange={e=>setPagu(p=>({...p,authorizationDate:e.target.value}))}/></label>
    <label>Alasan Pencatatan <textarea required minLength={8} maxLength={500} value={pagu.reason} onChange={e=>setPagu(p=>({...p,reason:e.target.value}))}/></label>
    <button className="btn primary" disabled={busy||!approved.length||!capabilities?.register}>Register Pagu (Pending)</button>
   </form>
  </section>
  <section className="panel sm-panel"><h3>Daftar Pagu</h3><div className="table-scroll"><table className="data-table"><thead><tr><th>Kegiatan</th><th>Nomor Dokumen</th><th>Jumlah</th><th>Terverifikasi</th><th>Sisa</th><th>Status / Tindakan</th></tr></thead><tbody>{overview?.pagus.map(b=><tr key={b.id}><td>{b.proposalTitle}</td><td>{b.authorizationNumber}</td><td>{formatRp(b.amount)}</td><td>{formatRp(b.verifiedRealization)}</td><td>{formatRp(b.remaining)}</td><td>{stateName(b.status)}{b.status==='pending'&&capabilities?.verifyPagu&&<div><button className="btn" disabled={busy} onClick={()=>decide('pagu',b.id,b.version,'verified')}>Verifikasi</button> <button className="btn" disabled={busy} onClick={()=>decide('pagu',b.id,b.version,'rejected')}>Tolak</button></div>}</td></tr>)}</tbody></table></div></section>
  <section className="panel sm-panel"><h3>Catat Realisasi (Pending Verifikasi)</h3><p className="sm-hint">Gunakan referensi bukti resmi; transaksi Pending atau Ditolak tidak masuk angka serapan.</p>
   <form className="sm-form" onSubmit={submitReal} style={{display:'grid',gap:10,marginTop:14}}>
    <label>Pagu Terverifikasi <select required value={real.paguId} onChange={e=>setReal(p=>({...p,paguId:e.target.value}))}><option value="">Pilih pagu</option>{overview?.pagus.filter(b=>b.status==='verified').map(b=><option key={b.id} value={b.id}>{b.proposalTitle} — {formatRp(b.remaining)} tersisa</option>)}</select></label>
    <label>Jumlah Realisasi (Rp) <input required inputMode="numeric" pattern="[1-9][0-9]*" value={real.amount} onChange={e=>setReal(p=>({...p,amount:e.target.value}))}/></label>
    <label>Tanggal Transaksi <input required type="date" value={real.transactionDate} onChange={e=>setReal(p=>({...p,transactionDate:e.target.value}))}/></label>
    <label>Referensi Bukti (nomor BKU/SP2D, bukan upload) <input required minLength={8} maxLength={200} value={real.evidenceReference} onChange={e=>setReal(p=>({...p,evidenceReference:e.target.value}))}/></label>
    <label>Uraian Realisasi <textarea required minLength={8} maxLength={500} value={real.description} onChange={e=>setReal(p=>({...p,description:e.target.value}))}/></label>
    <label>Alasan Pencatatan <textarea required minLength={8} maxLength={500} value={real.reason} onChange={e=>setReal(p=>({...p,reason:e.target.value}))}/></label>
    <button className="btn primary" disabled={busy||!capabilities?.record}>Catat Realisasi (Pending)</button>
   </form>
  </section>
  <section className="panel sm-panel"><h3>Bukti Realisasi Privat</h3><p className="sm-hint">Pilih transaksi, unggah satu bukti PDF/JPG/PNG maksimal 5 MiB. Bukti disimpan secara privat dan harus disetujui sebelum realisasi diverifikasi.</p>
   <label>Transaksi <select value={selectedReal} onChange={e=>void loadProofs(e.target.value).catch(err=>setError(String(err)))}><option value="">Pilih transaksi</option>{overview?.realizations.map(t=><option key={t.id} value={t.id}>{t.transactionDate} · {t.evidenceReference} · {stateName(t.status)}</option>)}</select></label>
   {selectedReal&&<><form className="sm-form" onSubmit={uploadProof} style={{display:'grid',gap:10,marginTop:12}}>
    <label>File bukti <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e=>setProofFile(e.currentTarget.files?.[0]||null)} /></label>
    <label>Alasan upload <textarea required minLength={8} maxLength={500} value={proofReason} onChange={e=>setProofReason(e.target.value)}/></label>
    <button className="btn primary" disabled={busy||!proofFile||!capabilities?.uploadEvidence||overview?.realizations.find(v=>v.id===selectedReal)?.status!=='pending'}>Upload Bukti (Pending)</button>
   </form>
   <div className="table-scroll"><table className="data-table"><thead><tr><th>File</th><th>Ukuran</th><th>Status</th><th>Action</th></tr></thead><tbody>{proofs.map(p=><tr key={p.id}><td>{p.filename}</td><td>{Math.ceil(p.size/1024)} KiB</td><td>{p.status}</td><td>{capabilities?.readEvidence&&<a className="btn" href={`${proofPath(selectedReal)}/${p.id}/download`}>Unduh</a>}{p.status==='pending'&&capabilities?.reviewEvidence&&<><button type="button" className="btn" disabled={busy} onClick={()=>reviewProof(p.id,p.version,'approved')}>Setujui Bukti</button><button type="button" className="btn" disabled={busy} onClick={()=>reviewProof(p.id,p.version,'rejected')}>Tolak Bukti</button></>}</td></tr>)}</tbody></table></div>
   </>}
  </section>
  {reconcile&&<section className="panel sm-panel"><h3>Rekonsiliasi Internal per Unit Pengusul</h3><p className="sm-hint">Dari transaksi scoped yang berhak dilihat user. Nilai hanya verified; angka parsial {reconcile.limited?'ADA (batas data), tidak boleh dipakai untuk total final.':'tidak terindikasi pada batas tampilan.'} Bukan LRA resmi.</p><div className="table-scroll"><table className="data-table"><thead><tr><th>Unit / Pengusul</th><th>Pagu</th><th>Realisasi</th><th>Pending</th><th>Ditolak</th><th>Tanpa bukti</th><th>Bukti menunggu</th></tr></thead><tbody>{reconcile.units.map(x=><tr key={x.unit}><td>{x.unit}</td><td>{formatRp(x.paguVerified)}</td><td>{formatRp(x.realizationVerified)}</td><td>{x.pendingTransactions}</td><td>{x.rejectedTransactions}</td><td>{x.missingEvidence}</td><td>{x.pendingEvidence}</td></tr>)}</tbody></table></div></section>}
  <section className="panel sm-panel"><label>Alasan untuk keputusan Verifikasi / Tolak <textarea minLength={8} maxLength={500} value={reviewNote} onChange={e=>setReviewNote(e.target.value)} style={{width:'100%'}}/></label><h3>Daftar Realisasi</h3><p className="sm-hint">Verifikasi realisasi baru membutuhkan bukti yang sudah Approved dan lolos pemeriksaan integritas.</p><div className="table-scroll"><table className="data-table"><thead><tr><th>Tanggal</th><th>Bukti</th><th>Uraian</th><th>Jumlah</th><th>Status / Tindakan</th></tr></thead><tbody>{overview?.realizations.map(t=><tr key={t.id}><td>{t.transactionDate}</td><td>{t.evidenceReference}</td><td>{t.description}</td><td>{formatRp(t.amount)}</td><td>{stateName(t.status)}{t.status==='pending'&&capabilities?.verifyRealization&&<div><button className="btn" disabled={busy} onClick={()=>decide('realisasi',t.id,t.version,'verified')}>Verifikasi</button> <button className="btn" disabled={busy} onClick={()=>decide('realisasi',t.id,t.version,'rejected')}>Tolak</button></div>}</td></tr>)}</tbody></table></div></section>
 </div>
}
