import { FloatingToast } from './UIFeedback'
import {useCallback,useEffect,useState,type FormEvent} from 'react'
import { Pager, usePaged } from './PaginationR5H5'

type Proposal={id:string;number:number;fiscalYear:number;sourceUnit:string;title:string;outputTarget:string;proposedBudget:number;classification:'biasa'|'penting';status:'draft'|'submitted';reviewStatus?:'draft'|'pending'|'revision_requested'|'approved';revisionCount?:number;createdBy:string;version:number;createdAt:string}
type History={action:string;fromStatus:string|null;toStatus:string;reason:string;actor:string;version:number;at:string}
type ReviewEvent={action:string;reason:string;actor:string;version:number;at:string}
type ConsolidationRow={fiscalYear:number;sourceUnit:string;count:number;totalBudget:string}
type Draft={fiscalYear:number;sourceUnit:string;title:string;outputTarget:string;proposedBudget:string;classification:'biasa'|'penting';reason:string}
const newDraft=():Draft=>({fiscalYear:new Date().getFullYear()+1,sourceUnit:'',title:'',outputTarget:'',proposedBudget:'0',classification:'biasa',reason:''})
const reviewLabel=(p:Proposal)=>p.status==='draft'?'Draft':p.reviewStatus==='approved'?'Disetujui Internal':p.reviewStatus==='revision_requested'?'Perlu Revisi':'Menunggu Review'
const money=(value:number)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value)
async function request<T>(path:string,method:'GET'|'POST'|'PATCH'='GET',body?:unknown):Promise<T>{
 const headers:Record<string,string>={}
 if(method!=='GET'){
  const c=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'})
  if(!c.ok)throw Error('Token CSRF tidak tersedia. Login kembali.')
  const data:{csrfToken:string}=await c.json()
  headers['Content-Type']='application/json';headers['X-CSRF-Token']=data.csrfToken
 }
 const response=await fetch(path,{method,headers,credentials:'same-origin',cache:'no-store',body:body===undefined?undefined:JSON.stringify(body)})
 if(!response.ok){
  if(response.status===401)throw Error('Sesi berakhir, silakan login kembali.')
  if(response.status===403||response.status===404)throw Error('Tidak ada akses ke usulan ini atau izin belum aktif.')
  if(response.status===409)throw Error('Status/versi sudah berubah. Muat ulang sebelum melanjutkan.')
  throw Error(`Permintaan gagal (HTTP ${response.status}).`)
 }
 return response.json() as Promise<T>
}
export default function UsulanR4A(){
 const [items,setItems]=useState<Proposal[]>([])

  // R5H5: paginasi seperti menu Disposisi.
  const {pageItems:pagedItems,pager}=usePaged(items,[items.length])
 const [selected,setSelected]=useState<Proposal|null>(null)
 const [history,setHistory]=useState<History[]>([])
 const [reviewHistory,setReviewHistory]=useState<ReviewEvent[]>([])
 const [canReview,setCanReview]=useState(false)
 const [canRevise,setCanRevise]=useState(false)
 const [canResubmit,setCanResubmit]=useState(false)
 const [canConsolidate,setCanConsolidate]=useState(false)
 const [reviewDecision,setReviewDecision]=useState<'approved'|'revision_requested'>('approved')
 const [reviewReason,setReviewReason]=useState('')
 const [summaryYear,setSummaryYear]=useState(new Date().getFullYear()+1)
 const [summary,setSummary]=useState<ConsolidationRow[]|null>(null)
 const [canCreate,setCanCreate]=useState(false)
 const [canUpdate,setCanUpdate]=useState(false)
 const [canSubmit,setCanSubmit]=useState(false)
 const [form,setForm]=useState<Draft>(newDraft)
 const [formMode,setFormMode]=useState<'new'|'edit'|'revision'|null>(null)
 const [submitReason,setSubmitReason]=useState('')
 const [busy,setBusy]=useState(false)
 const [loading,setLoading]=useState(true)
 const [limited,setLimited]=useState(false)
 const [error,setError]=useState('')
 const [message,setMessage]=useState('')
 const reload=useCallback(async()=>{
  const [list,caps]=await Promise.all([request<{items:Proposal[];limited:boolean}>('/api/v1/subbagren/usulan/'),request<{canCreate:boolean;canConsolidate:boolean}>('/api/v1/subbagren/usulan/capabilities')])
  setItems(list.items);setLimited(list.limited);setCanCreate(caps.canCreate);setCanConsolidate(caps.canConsolidate)
 },[])
 const open=useCallback(async(id:string)=>{
  const data=await request<{item:Proposal;history:History[];reviewHistory:ReviewEvent[];canUpdate:boolean;canSubmit:boolean;canReview:boolean;canRevise:boolean;canResubmit:boolean}>(`/api/v1/subbagren/usulan/${id}`)
  setSelected(data.item);setHistory(data.history);setReviewHistory(data.reviewHistory);setCanUpdate(data.canUpdate);setCanSubmit(data.canSubmit);setCanReview(data.canReview);setCanRevise(data.canRevise);setCanResubmit(data.canResubmit);setSubmitReason('');setReviewReason('');setFormMode(null)
 },[])
 useEffect(()=>{let alive=true;void reload().catch(e=>{if(alive)setError(e instanceof Error?e.message:'Tidak dapat memuat usulan')}).finally(()=>{if(alive)setLoading(false)});return()=>{alive=false}},[reload])
 function create(){setForm(newDraft());setFormMode('new');setSelected(null);setMessage('');setError('')}
 function edit(){if(!selected||!canUpdate)return;setForm({fiscalYear:selected.fiscalYear,sourceUnit:selected.sourceUnit,title:selected.title,outputTarget:selected.outputTarget,proposedBudget:String(selected.proposedBudget),classification:selected.classification,reason:''});setFormMode('edit');setError('')}
 function revise(){if(!selected||!canRevise)return;setForm({fiscalYear:selected.fiscalYear,sourceUnit:selected.sourceUnit,title:selected.title,outputTarget:selected.outputTarget,proposedBudget:String(selected.proposedBudget),classification:selected.classification,reason:''});setFormMode('revision');setError('')}
 function update<K extends keyof Draft>(key:K,value:Draft[K]){setForm(prev=>({...prev,[key]:value}))}
 async function save(e:FormEvent<HTMLFormElement>){e.preventDefault();if(busy||!formMode)return;setBusy(true);setError('');setMessage('')
  try{
   const payload={...form,proposedBudget:Number(form.proposedBudget),version:selected?.version}
   const response=formMode==='new'?await request<{item:Proposal}>('/api/v1/subbagren/usulan/','POST',payload):await request<{item:Proposal}>(`/api/v1/subbagren/usulan/${selected?.id}${formMode==='revision'?'/revision':''}`,'PATCH',payload)
   setFormMode(null);await reload();await open(response.item.id);setMessage(formMode==='revision'?'Revisi tercatat. Klik Ajukan Ulang agar reviewer dapat memeriksa kembali.':'Draft dan histori tersimpan.')
  }catch(e){setError(e instanceof Error?e.message:'Gagal menyimpan')}finally{setBusy(false)}
 }
 async function submit(){if(!selected||!canSubmit||busy||submitReason.trim().length<8)return;setBusy(true);setError('');setMessage('')
  try{await request(`/api/v1/subbagren/usulan/${selected.id}/submit`,'POST',{version:selected.version,reason:submitReason});await reload();await open(selected.id);setMessage('Usulan diajukan dan menunggu review internal Kasubbagren.')}
  catch(e){setError(e instanceof Error?e.message:'Gagal mengajukan usulan')}finally{setBusy(false)}
 }
 async function review(){if(!selected||!canReview||busy||reviewReason.trim().length<8)return;setBusy(true);setError('');setMessage('')
  try{await request(`/api/v1/subbagren/usulan/${selected.id}/review`,'POST',{version:selected.version,decision:reviewDecision,reason:reviewReason});await reload();await open(selected.id);setMessage(reviewDecision==='approved'?'Usulan disetujui INTERNAL; bukan pengesahan pagu atau DIPA.':'Usulan dikembalikan untuk revisi pengusul.')}
  catch(e){setError(e instanceof Error?e.message:'Gagal menyimpan review')}finally{setBusy(false)}
 }
 async function resubmit(){if(!selected||!canResubmit||busy||submitReason.trim().length<8)return;setBusy(true);setError('');setMessage('')
  try{await request(`/api/v1/subbagren/usulan/${selected.id}/resubmit`,'POST',{version:selected.version,reason:submitReason});await reload();await open(selected.id);setMessage('Revisi diajukan ulang; menunggu keputusan reviewer.')}
  catch(e){setError(e instanceof Error?e.message:'Gagal mengajukan ulang')}finally{setBusy(false)}
 }
 async function consolidate(){if(busy)return;setBusy(true);setError('');try{const response=await request<{items:ConsolidationRow[]}>(`/api/v1/subbagren/usulan/consolidation?year=${summaryYear}`);setSummary(response.items)}catch(e){setError(e instanceof Error?e.message:'Konsolidasi gagal')}finally{setBusy(false)}}
 return <div className="sm-root">
  <div className="sm-top-note"><strong>Usulan & Konsolidasi</strong><span>Kelola dan review usulan anggaran.</span></div>
  {error&&<FloatingToast message={error} kind="error"/>}{message&&<FloatingToast message={message} kind="success"/>}
  <section className="panel sm-panel">
   <div className="sm-toolbar"><strong>Usulan internal Subbagren</strong><button className="btn primary" type="button" onClick={create} disabled={!canCreate||busy} title={canCreate?'Buat draft':'Permission subbagren.usulan.create belum aktif'}>+ Draft Usulan</button></div>
   {limited&&<p className="sm-hint">Daftar dibatasi pada 150 record dari 151 terbaru sebelum filter hak akses. Gunakan detail untuk audit.</p>}
   <div className="table-scroll"><table className="data-table"><thead><tr><th>No.</th><th>Tahun</th><th>Unit Pengusul</th><th>Nama Kegiatan</th><th>Estimasi (Rp)</th><th>Status</th></tr></thead><tbody>{pagedItems.map(item=><tr key={item.id}><td><button type="button" className="sm-link" onClick={()=>open(item.id).catch(e=>setError(String(e)))}>USL-{item.number}</button></td><td>{item.fiscalYear}</td><td>{item.sourceUnit}</td><td>{item.title}</td><td>{money(item.proposedBudget)}</td><td><span className={`sm-state ${item.status}`}>{reviewLabel(item)}</span></td></tr>)}</tbody></table></div><Pager pager={pager} label="usulan"/>
   {!loading&&items.length===0&&<div className="sm-empty">Belum ada usulan yang dapat diakses oleh akun ini.</div>}{loading&&<div className="sm-empty">Memuat usulan...</div>}
  </section>
  {formMode&&<section className="panel sm-panel"><div className="sm-section-title"><h3>{formMode==='new'?'Tambah Draft Usulan':formMode==='revision'?'Revisi Usulan yang Dikembalikan':'Ubah Draft Usulan'}</h3><button className="btn" type="button" onClick={()=>setFormMode(null)}>Batal</button></div>
   <form className="sm-form" onSubmit={save}>
    <label>Tahun Anggaran<input required type="number" min={2020} max={2100} className="rm-input" value={form.fiscalYear} onChange={e=>update('fiscalYear',Number(e.target.value))}/></label>
    <label>Unit/Satker Pengusul<input required minLength={3} maxLength={160} className="rm-input" value={form.sourceUnit} onChange={e=>update('sourceUnit',e.target.value)}/></label>
    <label className="sm-span">Nama Program/Kegiatan<input required minLength={5} maxLength={300} className="rm-input" value={form.title} onChange={e=>update('title',e.target.value)}/></label>
    <label className="sm-span">Target Output<textarea required minLength={5} maxLength={600} className="rm-input" rows={2} value={form.outputTarget} onChange={e=>update('outputTarget',e.target.value)}/></label>
    <label>Estimasi Anggaran (Rupiah)<input required min={0} max={1000000000000000} step={1} type="number" className="rm-input" value={form.proposedBudget} onChange={e=>update('proposedBudget',e.target.value)}/></label>
    <label>Klasifikasi<select className="rm-input" value={form.classification} onChange={e=>update('classification',e.target.value as Draft['classification'])}><option value="biasa">Biasa</option><option value="penting">Penting</option></select></label>
    <label className="sm-span">Alasan pencatatan/perubahan (wajib)<textarea required rows={2} minLength={8} maxLength={500} className="rm-input" value={form.reason} onChange={e=>update('reason',e.target.value)}/></label>
    <div className="sm-span sm-actions"><button className="btn primary" type="submit" disabled={busy||form.reason.trim().length<8||!Number.isSafeInteger(Number(form.proposedBudget))}>{busy?'Menyimpan...':formMode==='revision'?'Simpan Revisi':'Simpan Draft'}</button></div>
   </form>
  </section>}
  {canConsolidate&&<section className="panel sm-panel"><div className="sm-section-title"><div><h3>Konsolidasi Usulan Disetujui Internal</h3><p>Hanya data dengan permission read + consolidate aktif dan klasifikasi yang diizinkan. Bukan DIPA.</p></div></div><div className="sm-toolbar"><label>Tahun Anggaran <input className="rm-input" type="number" min={2020} max={2100} value={summaryYear} onChange={e=>setSummaryYear(Number(e.target.value))}/></label><button type="button" className="btn primary" disabled={busy} onClick={consolidate}>Hitung Konsolidasi</button></div>{summary!==null&&<div className="table-scroll"><table className="data-table"><thead><tr><th>Tahun</th><th>Unit Pengusul</th><th>Jumlah Disetujui</th><th>Total Estimasi</th></tr></thead><tbody>{summary.map(r=><tr key={`${r.fiscalYear}-${r.sourceUnit}`}><td>{r.fiscalYear}</td><td>{r.sourceUnit}</td><td>{r.count}</td><td>Rp {new Intl.NumberFormat('id-ID').format(BigInt(r.totalBudget))}</td></tr>)}</tbody></table>{summary.length===0&&<p className="sm-hint">Belum ada usulan disetujui internal yang boleh diakses pada tahun ini.</p>}</div>}</section>}
  {selected&&!formMode&&<section className="panel sm-panel">
   <div className="sm-section-title"><div><span className="eyebrow">DETAIL USULAN · USL-{selected.number}</span><h3>{selected.title}</h3><p>Status {reviewLabel(selected)} · Versi {selected.version} · Tahun {selected.fiscalYear}</p></div>{canUpdate&&<button className="btn" type="button" onClick={edit}>Edit Draft</button>}{canRevise&&<button className="btn" type="button" onClick={revise}>Revisi Usulan</button>}</div>
   <dl className="sm-details"><div><dt>Unit pengusul</dt><dd>{selected.sourceUnit}</dd></div><div><dt>Estimasi</dt><dd>{money(selected.proposedBudget)}</dd></div><div><dt>Klasifikasi</dt><dd>{selected.classification}</dd></div><div className="sm-span"><dt>Target output</dt><dd>{selected.outputTarget}</dd></div></dl>
   {canSubmit&&<div className="sm-register"><strong>Ajukan untuk review</strong><p>Pengajuan mengunci draft; belum mengesahkan pagu atau DIPA.</p><label>Alasan pengajuan<textarea className="rm-input" rows={2} minLength={8} maxLength={500} value={submitReason} onChange={e=>setSubmitReason(e.target.value)}/></label><button className="btn primary" type="button" disabled={busy||submitReason.trim().length<8} onClick={submit}>Ajukan Usulan</button></div>}
   {canReview&&<div className="sm-register"><strong>Review Internal Kasubbagren</strong><p>Persetujuan ini hanya untuk konsolidasi usulan. Tidak menetapkan pagu/DIPA.</p><label>Keputusan<select className="rm-input" value={reviewDecision} onChange={e=>setReviewDecision(e.target.value as 'approved'|'revision_requested')}><option value="approved">Setujui internal</option><option value="revision_requested">Kembalikan untuk revisi</option></select></label><label>Alasan wajib (8–500 karakter)<textarea className="rm-input" minLength={8} maxLength={500} rows={2} value={reviewReason} onChange={e=>setReviewReason(e.target.value)}/></label><button className="btn primary" type="button" disabled={busy||reviewReason.trim().length<8} onClick={review}>Simpan Keputusan</button></div>}
   {selected.reviewStatus==='revision_requested'&&<div className="sm-register"><strong>Usulan dikembalikan</strong><p>{canRevise?'Silakan perbarui dengan tombol Revisi Usulan.':'Menunggu perbaikan oleh pembuat usulan.'}</p>{canResubmit&&<><label>Alasan pengajuan ulang<textarea className="rm-input" minLength={8} maxLength={500} rows={2} value={submitReason} onChange={e=>setSubmitReason(e.target.value)}/></label><button className="btn primary" type="button" disabled={busy||submitReason.trim().length<8} onClick={resubmit}>Ajukan Ulang</button></>}</div>}
   <h4 className="sm-history-title">Audit Trail Usulan</h4><div className="sm-history">{[...history.map(h=>({action:h.action,actor:h.actor,at:h.at,version:h.version,reason:h.reason})),...reviewHistory].sort((a,b)=>a.version-b.version).map(h=><div className="sm-history-row" key={h.version}><span className="sm-history-dot"/><div><strong>{h.action}</strong><small>{h.actor} · {new Date(h.at).toLocaleString('id-ID')} · Versi {h.version}</small><p>{h.reason}</p></div></div>)}</div>
  </section>}
 </div>
}
