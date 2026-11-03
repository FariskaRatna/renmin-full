import { useCallback, useEffect, useMemo, useState, type ReactNode, type MouseEvent } from 'react'
import './ProjectRoadmapR5F19.css'

type Section='overview'|'roadmap'|'curve'|'milestone'|'risk'|'version'
type RecordRow={id:string;section:string;order:number;data:string[];status:string;managementNote:string;version:number;updatedAt:string}
type Snapshot={day:string;completed:number;total:number}
type Result={records:RecordRow[];snapshots:Snapshot[];targetDate:string;baselineDate:string}
const TABS:{id:Section;title:string}[]=[{id:'overview',title:'Dashboard'},{id:'roadmap',title:'Master Roadmap'},{id:'curve',title:'Kurva S'},{id:'milestone',title:'Milestone'},{id:'risk',title:'Keputusan & Risiko'},{id:'version',title:'Jejak Versi'}]
const STATUS=['Teruji','Terpasang - perlu uji','Berjalan sebagian','Perlu keputusan','Belum mulai']
const UNITS=['Semua Unit','URMIN','SUBBAGREN','SUBBAGSUMDA','SUBBAGBINFUNG','LINTAS UNIT']
function percentage(n:number,total:number){return total>0?Math.round(n/total*1000)/10:0}
function statusClass(s:string){return s==='Teruji'?'is-done':s==='Belum mulai'?'is-new':s==='Perlu keputusan'?'is-decision':s.includes('sebagian')?'is-partial':'is-review'}
function yymmdd(d:string){return new Date(`${d}T12:00:00+07:00`).getTime()}
function fmt(d:string){const dt=new Date(`${d}T12:00:00+07:00`);return Number.isNaN(dt.getTime())?d:dt.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Jakarta'})}
function csvDownload(records:RecordRow[]){
 const names=['ID','Unit','Area','Pekerjaan','Prioritas','Status','Fase','Definition of Done','Bukti','Catatan awal','Catatan perkembangan']
 const csvCell=(x:unknown)=>`"${String(x??'').replace(/^[=+@\t\r-]/,'\u2019$&').replace(/"/g,'""')}"`
 const lines=[names.map(csvCell).join(';'),...records.map(r=>[...r.data.slice(0,10).map((x,i)=>i===5?r.status:x),r.managementNote].map(csvCell).join(';'))]
 const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob)
 const a=document.createElement('a');a.href=url;a.download='siera-delta-lima-roadmap.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
}
function SChart({snapshots,total,completed}:{snapshots:Snapshot[];total:number;completed:number}){
 const w=920,h=294,L=54,R=20,T=18,B=38
 const start=yymmdd('2026-10-23'),end=yymmdd('2026-12-31')
 const x=(ms:number)=>L+(ms-start)/(end-start)*(w-L-R)
 const y=(p:number)=>h-B-p/100*(h-T-B)
 const baseline=percentage(5,41)
 const planned=Array.from({length:70},(_,i)=>{const p=i/69;return {x:x(start+(end-start)*p),y:y(baseline+(100-baseline)*(p*p*(3-2*p)))}})
 const real=snapshots.filter(s=>yymmdd(s.day)>=start&&yymmdd(s.day)<=end).sort((a,b)=>a.day.localeCompare(b.day)).map(s=>({x:x(yymmdd(s.day)),y:y(percentage(s.completed,s.total)),value:percentage(s.completed,s.total),day:s.day}))
 const planLine=planned.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
 const realLine=real.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
 const dates=['2026-10-23','2026-10-31','2026-11-15','2026-11-30','2026-12-15','2026-12-31']
 return <div className="sdl-rm-chart">
  <div className="sdl-rm-chart__legend"><span><i className="sdl-rm-line planned"/>Rencana (simulasi distribusi)</span><span><i className="sdl-rm-line actual"/>Realisasi terverifikasi</span></div>
  <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Kurva S rencana menuju 100 persen pada 31 Desember 2026, realisasi saat ini ${percentage(completed,total)} persen dari ${completed} dari ${total} pekerjaan yang telah teruji`}>
   {[0,25,50,75,100].map(t=><g key={t}><line x1={L} y1={y(t)} x2={w-R} y2={y(t)} stroke="currentColor" opacity=".10"/><text x={L-10} y={y(t)+4} fontSize="12" textAnchor="end" fill="currentColor" opacity=".6">{t}%</text></g>)}
   {dates.map(date=><text key={date} x={x(yymmdd(date))} y={h-11} fontSize="11" textAnchor="middle" fill="currentColor" opacity=".64">{fmt(date).replace(' 2026','')}</text>)}
   <path d={planLine} fill="none" stroke="#c49b53" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"/>
   {real.length>1&&<path d={realLine} fill="none" stroke="#338b82" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round"/>}
   {real.map((p,i)=><g key={i}><circle cx={p.x} cy={p.y} r="5" fill="#338b82" stroke="var(--card,#fff)" strokeWidth="2"/><title>{fmt(p.day)}: {p.value}% teruji</title></g>)}
   <circle cx={x(end)} cy={y(100)} r="4" fill="#c49b53"/>
  </svg>
  <p className="sdl-rm-hint">Kurva rencana adalah <strong>skenario distribusi progres</strong> dari baseline 23 Oktober menuju target 31 Desember, belum baseline jadwal yang disahkan. Realisasi hanya memakai snapshot status <strong>Teruji</strong>, tanpa mengarang data historis. Persentase dihitung dari jumlah item (bukan bobot effort).</p>
 </div>
}
function Table({head,children}:{head:string[];children:ReactNode}){return <div className="sdl-rm-table-wrap"><table className="sdl-rm-table"><thead><tr>{head.map((x,i)=><th key={i}>{x}</th>)}</tr></thead><tbody>{children}</tbody></table></div>}
export default function ProjectRoadmapR5F19(){
 const [data,setData]=useState<Result|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('')
 const [tab,setTab]=useState<Section>('overview'),[unit,setUnit]=useState('Semua Unit'),[status,setStatus]=useState('Semua Status'),[term,setTerm]=useState('')
 const [edit,setEdit]=useState<RecordRow|null>(null),[nextStatus,setNextStatus]=useState(''),[note,setNote]=useState(''),[saving,setSaving]=useState(false),[toast,setToast]=useState('')
 const load=useCallback(async()=>{setLoading(true);setError('');try{const r=await fetch('/api/v1/admin/project-roadmap',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error(r.status===403?'Anda tidak memiliki akses Roadmap.':`Gagal memuat Roadmap (${r.status}).`);const value:Result=await r.json();if(!Array.isArray(value.records)||!Array.isArray(value.snapshots))throw Error('Format data tidak dikenali.');setData(value)}catch(e){setError(e instanceof Error?e.message:'Gagal memuat Roadmap.')}finally{setLoading(false)}},[])
 useEffect(()=>{void load()},[load])
 useEffect(()=>{if(!toast)return;const handle=window.setTimeout(()=>setToast(''),3500);return()=>window.clearTimeout(handle)},[toast])
 const all=useMemo(()=>data?.records.filter(r=>r.section==='roadmap')??[],[data])
 const milestones=useMemo(()=>data?.records.filter(r=>r.section==='milestone')??[],[data])
 const risks=useMemo(()=>data?.records.filter(r=>r.section==='risk')??[],[data])
 const versions=useMemo(()=>data?.records.filter(r=>r.section==='version')??[],[data])
 const done=all.filter(r=>r.status==='Teruji').length
 const partial=all.filter(r=>r.status==='Berjalan sebagian'||r.status==='Terpasang - perlu uji').length
 const blocked=all.filter(r=>r.status==='Perlu keputusan').length
 const visible=useMemo(()=>all.filter(r=> (unit==='Semua Unit'||r.data[1]===unit)&&(status==='Semua Status'||r.status===status)&&(!term||[r.id,...r.data,r.managementNote].join(' ').toLocaleLowerCase('id-ID').includes(term.toLocaleLowerCase('id-ID')))),[all,unit,status,term])
 const grouped=useMemo(()=>UNITS.slice(1).map(key=>({key,rows:all.filter(r=>r.data[1]===key)})),[all])
 const openEdit=(r:RecordRow)=>{setEdit(r);setNextStatus(r.status);setNote(r.managementNote)}
 const save=async()=>{if(!edit||saving)return;setSaving(true);try{
  const cr=await fetch('/api/v1/auth/csrf',{credentials:'same-origin',cache:'no-store'});if(!cr.ok)throw Error('Sesi tidak valid. Silakan masuk kembali.');const {csrfToken}:{csrfToken:string}=await cr.json()
  const r=await fetch(`/api/v1/admin/project-roadmap/${encodeURIComponent(edit.id)}`,{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({status:nextStatus,managementNote:note,version:edit.version})})
  if(!r.ok)throw Error(r.status===409?'Data sudah diperbarui di sesi lain. Segarkan daftar terlebih dahulu.':`Perubahan belum tersimpan (${r.status}).`)
  setEdit(null);await load();setToast('Perubahan roadmap berhasil disimpan.')
 }catch(e){setToast(e instanceof Error?e.message:'Gagal menyimpan perubahan.')}finally{setSaving(false)}}
 const days=Math.ceil((yymmdd('2026-12-31')-Date.now())/86400000)
 return <section className="sdl-rm" aria-label="Roadmap Pengembangan">
  <header className="sdl-rm-header"><div><span className="sdl-rm-eyebrow">PROJECT DELIVERY TRACKER</span><h2>SIERA DELTA LIMA</h2><p>Baseline 23 Oktober 2026 · BagRenmin Densus 88 AT Polri</p></div><div className="sdl-rm-deadline"><span>Target selesai keseluruhan</span><strong>31 Desember 2026</strong><small>{days>=0?`${days} hari kalender tersisa`:`Target terlewati ${Math.abs(days)} hari`}</small></div></header>
  {toast&&<div role="status" className="sdl-rm-toast"><span>{toast}</span><button type="button" aria-label="Tutup notifikasi" onClick={()=>setToast('')}>×</button></div>}
  <nav className="sdl-rm-tabs" aria-label="Tab Roadmap">{TABS.map(t=><button type="button" key={t.id} onClick={()=>setTab(t.id)} className={tab===t.id?'active':''} aria-current={tab===t.id?'page':undefined}>{t.title}</button>)}</nav>
  {loading&&<div className="sdl-rm-state">Memuat progres roadmap…</div>}
  {error&&<div className="sdl-rm-state" role="alert">{error} <button className="sdl-rm-btn" onClick={()=>void load()}>Coba lagi</button></div>}
  {!loading&&!error&&data&&<>
   {tab==='overview'&&<>
    <div className="sdl-rm-metrics"><div><span>Total Pekerjaan</span><strong>{all.length}</strong><small>4 unit dan lintas unit</small></div><div><span>Teruji</span><strong>{done}</strong><small>Sesuai bukti verifikasi</small></div><div><span>Terpasang / Sebagian</span><strong>{partial}</strong><small>Masih perlu UAT</small></div><div><span>Perlu Keputusan</span><strong>{blocked}</strong><small>Butuh penetapan proses</small></div></div>
    <div className="sdl-rm-split"><div className="sdl-rm-pane"><div className="sdl-rm-pane-head"><h3>Progress Terverifikasi</h3><button className="sdl-rm-link" onClick={()=>setTab('curve')}>Lihat Kurva S →</button></div><div className="sdl-rm-big-number">{percentage(done,all.length)}<small>%</small></div><div className="sdl-rm-track"><span style={{width:`${percentage(done,all.length)}%`}}/></div><p>{done} dari {all.length} pekerjaan sudah berstatus Teruji. Ini bukan estimasi beban kerja.</p><div className="sdl-rm-mini-chart"><SChart snapshots={data.snapshots} total={all.length} completed={done}/></div></div>
    <div className="sdl-rm-pane"><h3>Progres per Unit</h3>{grouped.map(g=><div className="sdl-rm-unit" key={g.key}><div><b>{g.key}</b><span>{g.rows.filter(r=>r.status==='Teruji').length} / {g.rows.length} teruji</span></div><div className="sdl-rm-track"><span style={{width:`${percentage(g.rows.filter(r=>r.status==='Teruji').length,g.rows.length)}%`}}/></div></div>)}<div className="sdl-rm-overview-note"><strong>Fokus saat ini</strong><p>Sederhanakan approval akhir, notifikasi Surat Masuk ke Kabagrenmin, kemudian implementasi MoM per unit.</p></div></div></div>
    <div className="sdl-rm-pane"><div className="sdl-rm-pane-head"><h3>Prioritas P0 yang belum tuntas</h3><button className="sdl-rm-link" onClick={()=>{setStatus('Semua Status');setUnit('Semua Unit');setTab('roadmap')}}>Master Roadmap →</button></div><div className="sdl-rm-priority-grid">{all.filter(r=>r.data[4]==='P0'&&r.status!=='Teruji').slice(0,8).map(r=><button type="button" key={r.id} onClick={()=>openEdit(r)}><span>{r.id} · {r.data[1]}</span><strong>{r.data[3]}</strong><small>{r.status}</small></button>)}</div></div>
   </>}
   {tab==='curve'&&<div className="sdl-rm-pane"><div className="sdl-rm-pane-head"><h3>Kurva S — Rencana vs Realisasi</h3><span className="sdl-rm-tag">Deadline 31 Des 2026</span></div><SChart snapshots={data.snapshots} total={all.length} completed={done}/><div className="sdl-rm-explain"><strong>Metodologi</strong><p>Kurva rencana adalah ilustrasi penyebaran progres yang dimulai dari baseline teruji per 23 Oktober 2026 dan mencapai 100% tepat pada 31 Desember 2026. Bukan jadwal resmi tiap pekerjaan. Realisasi hanya dibuat dari snapshot data hasil perubahan status di aplikasi; perubahan status tercatat per hari WIB.</p></div></div>}
   {tab==='roadmap'&&<div className="sdl-rm-pane"><div className="sdl-rm-pane-head"><h3>Master Roadmap</h3><button className="sdl-rm-btn" type="button" onClick={()=>csvDownload(visible)}>Export CSV</button></div><div className="sdl-rm-filters"><input value={term} onChange={e=>setTerm(e.target.value)} placeholder="Cari pekerjaan, ID, catatan…" aria-label="Cari pekerjaan"/><select aria-label="Filter unit" value={unit} onChange={e=>setUnit(e.target.value)}>{UNITS.map(v=><option key={v}>{v}</option>)}</select><select aria-label="Filter status" value={status} onChange={e=>setStatus(e.target.value)}>{['Semua Status',...STATUS].map(v=><option key={v}>{v}</option>)}</select></div><p className="sdl-rm-table-count">Menampilkan {visible.length} dari {all.length} pekerjaan. Status dan catatan tersimpan di aplikasi serta memiliki histori perubahan.</p><Table head={['ID','Unit / Area','Pekerjaan / Deliverable','Prioritas','Status Aktual','Fase','Kriteria Selesai','Aksi']}>{visible.map(r=><tr key={r.id}><td><b>{r.id}</b></td><td>{r.data[1]}<small>{r.data[2]}</small></td><td className="sdl-rm-description"><strong>{r.data[3]}</strong>{r.managementNote&&<small>Update: {r.managementNote}</small>}</td><td><span className={`sdl-rm-priority ${r.data[4]==='P0'?'critical':''}`}>{r.data[4]}</span></td><td><span className={`sdl-rm-status ${statusClass(r.status)}`}>{r.status}</span></td><td>{r.data[6]}</td><td className="sdl-rm-dod">{r.data[7]}</td><td><button className="sdl-rm-link" onClick={()=>openEdit(r)}>Update</button></td></tr>)}</Table>{visible.length===0&&<div className="sdl-rm-state">Tidak ada pekerjaan yang cocok dengan filter.</div>}</div>}
   {tab==='milestone'&&<div className="sdl-rm-pane"><h3>Milestone Pengembangan</h3><p className="sdl-rm-table-count">Gelombang dari baseline roadmap 23 Oktober 2026. Target keseluruhan 31 Desember 2026; tanggal masing-masing gelombang belum ditetapkan.</p><Table head={['Gelombang','Fokus','Output / Kriteria','Dependensi','Status','Catatan']}>{milestones.map(r=><tr key={r.id}>{r.data.slice(0,6).map((v,i)=><td key={i}>{v}</td>)}</tr>)}</Table></div>}
   {tab==='risk'&&<div className="sdl-rm-pane"><h3>Keputusan & Risiko</h3><p className="sdl-rm-table-count">Item yang memerlukan keputusan proses bisnis atau dokumen acuan stakeholder.</p><Table head={['ID','Area','Hal yang perlu diputuskan','Usulan','Status','Dampak','Dasar']}>{risks.map(r=><tr key={r.id}>{r.data.slice(0,7).map((v,i)=><td key={i}>{v}</td>)}</tr>)}</Table></div>}
   {tab==='version'&&<div className="sdl-rm-pane"><h3>Jejak Versi & Verifikasi</h3><p className="sdl-rm-table-count">Jejak pengembangan berbasis bukti, bukan klaim semua modul sudah selesai.</p><Table head={['Versi','Fitur','Bukti','Status','Catatan']}>{versions.map(r=><tr key={r.id}>{r.data.slice(0,5).map((v,i)=><td key={i}>{v}</td>)}</tr>)}</Table></div>}
  </>}
  {edit&&<div className="sdl-rm-modal-backdrop" role="presentation" onMouseDown={(e:MouseEvent<HTMLDivElement>)=>{if(e.target===e.currentTarget&&!saving)setEdit(null)}}><div role="dialog" aria-modal="true" aria-labelledby="sdl-rm-modal-label" className="sdl-rm-modal"><header><div><span className="sdl-rm-eyebrow">UPDATE ROADMAP · {edit.id}</span><h3 id="sdl-rm-modal-label">{edit.data[3]}</h3></div><button aria-label="Tutup" disabled={saving} onClick={()=>setEdit(null)}>×</button></header><div className="sdl-rm-modal-body"><div><strong>Kriteria Selesai</strong><p>{edit.data[7]}</p></div><div><strong>Bukti awal</strong><p>{edit.data[8]||'Belum tersedia'}</p></div><label>Status Aktual<select value={nextStatus} onChange={e=>setNextStatus(e.target.value)}>{STATUS.map(s=><option key={s}>{s}</option>)}</select></label><label>Catatan Perkembangan<textarea rows={4} maxLength={1500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Ringkasan perubahan, hasil pengujian, atau blocker…"/></label><small>Pastikan status Teruji hanya dipilih apabila hasil pengujian sudah mempunyai bukti.</small></div><footer><button type="button" className="sdl-rm-btn" disabled={saving} onClick={()=>setEdit(null)}>Batal</button><button type="button" className="sdl-rm-btn primary" disabled={saving||!STATUS.includes(nextStatus)} onClick={()=>void save()}>{saving?'Menyimpan…':'Simpan Perubahan'}</button></footer></div></div>}
 </section>
}
