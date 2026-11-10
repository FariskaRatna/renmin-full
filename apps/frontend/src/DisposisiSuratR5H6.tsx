import { useCallback, useEffect, useMemo, useState } from 'react'
import './DisposisiSuratR5H6.css'
import './DirectivesR5F23.css'
import { ChipPicker } from './DirectivesR5F23'

/**
 * R5H6: disposisi Kabagrenmin langsung dari detail Surat Masuk.
 *
 * Sebelumnya Kabagrenmin membuka surat, pindah ke menu Arahan, menekan
 * "Buat Arahan", lalu memilih surat yang sama lagi. Pemilik meminta alurnya
 * tetap di Surat Masuk: buka detail → tentukan Kepada, Disposisi, Disposisi
 * lainnya, Klasifikasi dan Derajat → kirim.
 *
 * Backend TIDAK berubah. Yang dikirim tetap POST /leadership/directives dengan
 * incomingId + sections + sheet — jalur yang sama persis dengan layar Arahan,
 * termasuk penyerahan surat dan lampirannya ke bagian tujuan (handOverLetter).
 * Judul dan isi arahan wajib di server (3 dan 8 huruf); keduanya diisi dari
 * surat dan pilihan disposisi, jadi Kabagrenmin tidak perlu mengetik apa pun.
 * draftRevision sengaja tidak dikirim: draft Arahan milik Kabagrenmin tidak
 * disentuh.
 *
 * Penerima melihat lembar yang sama di detail surat dan mengonfirmasi
 * penerimaannya di sini juga.
 */

type Letter={id:string;letterNumber:string;sender:string;letterDate:string;subject:string;classification:'biasa'|'penting';derajat:'biasa'|'kilat'}
type Sheet={letterFrom:string;letterNumber:string;directiveDate:string;letterDate:string;subject:string;classification:string;derajat:string;dispositions:string[];dispositionNote:string;agendaNo?:number|null}
type Option={code:string;name:string}
type SectionHolder={id:string;name:string;canReceiveBiasa:boolean;canReceivePenting:boolean}
type Section={key:string;label:string;kind:'jabatan'|'bagian'|'paur';unit:string;holders:SectionHolder[]}
type Recipient={id:string;name:string;unit:string;section?:string;readAt:string|null;acknowledgedAt:string|null}
type Directive={id:string;title:string;issuerName:string;createdAt:string;total:number;read:number;acknowledged:number;myReadAt?:string|null;myAcknowledgedAt?:string|null;recipients?:Recipient[];incomingId?:string;agendaSurat?:string;sheet?:Sheet}

const kindCap:Record<string,string>={jabatan:'KEPALA SAJA',bagian:'SELURUH BAGIAN',paur:'PAUR SUBBAGSUMDA'}
const todayJakarta=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
const fmt=(d?:string|null)=>d?new Date(d).toLocaleString('id-ID',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Jakarta'})+' WIB':'—'

async function call<T>(path:string,method:'GET'|'POST'='GET',body?:unknown):Promise<T>{
 const headers:Record<string,string>={}
 if(method!=='GET'){
  const c=await fetch('/api/v1/auth/csrf',{cache:'no-store',credentials:'same-origin'})
  if(!c.ok)throw Error('Sesi keamanan tidak tersedia.')
  const t:{csrfToken:string}=await c.json();headers['X-CSRF-Token']=t.csrfToken
 }
 if(body!==undefined)headers['Content-Type']='application/json'
 const r=await fetch('/api/v1/leadership/directives'+path,{method,credentials:'same-origin',cache:'no-store',headers,...(body!==undefined?{body:JSON.stringify(body)}:{})})
 if(!r.ok)throw Error(r.status===403?'Anda tidak memiliki kewenangan untuk tindakan ini.':r.status===400?'Disposisi ditolak. Periksa tujuan dan pilihan disposisi, lalu muat ulang surat.':r.status===404?'Disposisi tidak ditemukan.':'Layanan disposisi belum dapat digunakan.')
 return r.json() as Promise<T>
}

// Isi arahan wajib minimal 8 huruf di server. Disusun dari pilihan disposisi
// supaya daftar Arahan (yang hanya menampilkan judul & isi) tetap bermakna.
function bodyOf(letter:Letter,names:string[],note:string){
 const parts=[`Disposisi Kabagrenmin atas surat ${letter.letterNumber} dari ${letter.sender}.`]
 if(names.length)parts.push(`Disposisi: ${names.join('; ')}.`)
 if(note.trim())parts.push(note.trim())
 return parts.join('\n').slice(0,4000)
}

export function DisposisiSuratR5H6({letter,onChanged}:{letter:Letter;onChanged?:()=>void}){
 const [canIssue,setCanIssue]=useState(false),[linkable,setLinkable]=useState(false)
 const [sections,setSections]=useState<Section[]>([]),[options,setOptions]=useState<Option[]>([])
 const [sent,setSent]=useState<Directive[]>([]),[received,setReceived]=useState<Directive[]>([])
 const [picked,setPicked]=useState<string[]>([]),[dispo,setDispo]=useState<string[]>([]),[note,setNote]=useState('')
 const [klas,setKlas]=useState<string>(letter.classification),[derajat,setDerajat]=useState<string>(letter.derajat||'biasa')
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [confirmOpen,setConfirmOpen]=useState(false)

 const load=useCallback(async()=>{
  setLoading(true)
  try{
   const meta=await call<{canIssue:boolean}>('/meta')
   const opts=await call<{items:Option[]}>('/disposition-options').catch(()=>({items:[] as Option[]}))
   setOptions(opts.items||[]);setCanIssue(meta.canIssue)
   if(meta.canIssue){
    const [letters,secs,out]=await Promise.all([
     call<{items:{id:string}[]}>('/letters'),
     call<{items:Section[]}>('/sections'),
     call<{items:Directive[]}>('/sent'),
    ])
    setLinkable((letters.items||[]).some(l=>l.id===letter.id))
    setSections(secs.items||[])
    const mine=(out.items||[]).filter(d=>d.incomingId===letter.id)
    // Detail memuat daftar penerima per orang; /sent hanya hitungan.
    setSent(await Promise.all(mine.map(d=>call<Directive>('/'+d.id).catch(()=>d))))
    // Disposisi tidak lagi tampil di menu Arahan, jadi di sinilah Kabag
    // melihat konfirmasi penerima. Tanpa ack-seen, angka notifikasi Arahan
    // (ackUnseen) tidak akan pernah turun.
    const seen=mine.filter(d=>d.acknowledged>0)
    if(seen.length){await Promise.all(seen.map(d=>call('/'+d.id+'/ack-seen','POST').catch(()=>null)));window.dispatchEvent(new Event('sdl:inbox-changed'))}
   }else{
    const inbox=await call<{items:Directive[]}>('/inbox')
    // Detail (bukan ringkasan /inbox) supaya No. Agenda surat keluar ikut terbaca.
    const mine=(inbox.items||[]).filter(d=>d.incomingId===letter.id)
    setReceived(await Promise.all(mine.map(d=>call<Directive>('/'+d.id).then(full=>({...d,...full})).catch(()=>d))))
   }
   setError('')
  }catch(e){setError(e instanceof Error?e.message:'Gagal memuat disposisi.')}
  finally{setLoading(false)}
 },[letter.id])
 useEffect(()=>{void load()},[load])

 // Penerima: membuka surat = membaca disposisinya, sama seperti membuka
 // detail di menu Arahan. Konfirmasi "diterima" tetap tindakan sendiri.
 useEffect(()=>{
  const unread=received.filter(d=>!d.myReadAt)
  if(!unread.length)return
  void Promise.all(unread.map(d=>call('/'+d.id+'/read','POST').catch(()=>null))).then(()=>{window.dispatchEvent(new Event('sdl:inbox-changed'));void load()})
 },[received,load])

 const optionName=useMemo(()=>Object.fromEntries(options.map(o=>[o.code,o.name])) as Record<string,string>,[options])
 const sectionLabel=useMemo(()=>Object.fromEntries(sections.map(s=>[s.key,s.label])) as Record<string,string>,[sections])
 const recipientCount=useMemo(()=>new Set(picked.flatMap(k=>sections.find(s=>s.key===k)?.holders.map(h=>h.id)??[])).size,[picked,sections])
 const toggle=(list:string[],set:(v:string[])=>void,key:string)=>set(list.includes(key)?list.filter(x=>x!==key):[...list,key])

 async function send(){
  if(busy||picked.length===0)return
  setBusy(true);setError('');setConfirmOpen(false)
  try{
   const sheet:Sheet={letterFrom:letter.sender,letterNumber:letter.letterNumber,directiveDate:todayJakarta(),letterDate:letter.letterDate||'',subject:letter.subject,classification:klas,derajat,dispositions:[...dispo],dispositionNote:note.trim()}
   const priority=derajat==='kilat'?'kilat':klas==='penting'?'penting':'biasa'
   const title=`Disposisi: ${letter.subject}`.slice(0,160)
   await call<{id:string}>('/','POST',{title:title.length>=3?title:'Disposisi surat',body:bodyOf(letter,dispo.map(c=>optionName[c]||c),note),kind:'umum',priority,dueAt:null,sections:picked,incomingId:letter.id,sheet})
   setPicked([]);setDispo([]);setNote('')
   setMessage('Disposisi terkirim. Surat beserta lampirannya diserahkan ke bagian yang dituju.')
   window.dispatchEvent(new Event('sdl:inbox-changed'))
   await load();onChanged?.()
  }catch(e){setError(e instanceof Error?e.message:'Gagal mengirim disposisi.')}
  finally{setBusy(false)}
 }
 async function accept(id:string){
  if(busy)return
  setBusy(true);setError('')
  try{await call('/'+id+'/acknowledge','POST');setMessage('Disposisi diterima.');window.dispatchEvent(new Event('sdl:inbox-changed'));await load()}
  catch(e){setError(e instanceof Error?e.message:'Gagal mengonfirmasi.')}
  finally{setBusy(false)}
 }

 if(loading&&!sent.length&&!received.length)return null
 if(!error&&!canIssue&&received.length===0)return null
 // R5H6: satu surat hanya didisposisikan SEKALI (keputusan pemilik). Begitu ada
 // disposisi terkirim, form tidak ditampilkan lagi. Penguncian ini di layar;
 // backend belum menolak disposisi kedua.
 const canSend=canIssue&&linkable&&sent.length===0
 if(!error&&canIssue&&!linkable&&sent.length===0)return null

 // R5H6 (rev.): lembar yang sudah terkirim memakai gaya grid data surat
 // (.sm-details) supaya terbaca sebagai bagian dari detail surat yang sama,
 // dan status penerima berupa tabel biasa.
 const dateOnly=(v?:string)=>v?new Date(`${v.slice(0,10)}T12:00:00Z`).toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}):'—'
 const sectionsOf=(d:Directive)=>[...new Set((d.recipients||[]).map(r=>r.section).filter((x):x is string=>Boolean(x)))].map(x=>sectionLabel[x]||x).join(', ')
 const sheetView=(d:Directive,who:{label:string;value:string})=><dl className="sm-details sm-dispo__details">
  <div><dt>{who.label}</dt><dd>{who.value}</dd></div>
  <div><dt>No. Agenda</dt><dd>{d.agendaSurat??d.sheet?.agendaNo??'Belum terisi'}</dd></div>
  <div><dt>Tanggal Disposisi</dt><dd>{dateOnly(d.sheet?.directiveDate||d.createdAt)}</dd></div>
  <div><dt>Klasifikasi / Derajat</dt><dd>{d.sheet?.classification==='penting'?'Rahasia':'Biasa'} / {d.sheet?.derajat==='kilat'?'Kilat':'Biasa'}</dd></div>
  <div className="sm-span"><dt>Disposisi Kabagrenmin</dt><dd>{d.sheet?.dispositions.length?d.sheet.dispositions.map(c=>optionName[c]||c).join(', '):'—'}</dd></div>
  {d.sheet?.dispositionNote&&<div className="sm-span"><dt>Disposisi Lainnya</dt><dd className="sm-dispo__pre">{d.sheet.dispositionNote}</dd></div>}
 </dl>
 const stateOf=(r:{readAt:string|null;acknowledgedAt:string|null})=>r.acknowledgedAt?{text:'Diterima',tone:'ok',at:r.acknowledgedAt}:r.readAt?{text:'Dibaca',tone:'info',at:r.readAt}:{text:'Belum dibaca',tone:'warn',at:null}

 return <section className="sm-dispo" aria-label="Disposisi Kabagrenmin">
  <h4 className="sm-history-title sm-dispo__title">{canSend?'Disposisi Kabagrenmin':canIssue?'Disposisi Terkirim':'Disposisi untuk Anda'}</h4>
  {error&&<p className="sm-dispo__alert is-error" role="alert">{error}</p>}
  {message&&<p className="sm-dispo__alert" role="status">{message}</p>}

  {sent.map(d=><div className="sm-dispo__block" key={d.id}>
   <div className="sm-dispo__meta"><span>Dikirim {fmt(d.createdAt)}</span><span className={`sm-badge tone-${d.total>0&&d.acknowledged===d.total?'ok':'info'}`}>{d.acknowledged} dari {d.total} diterima</span></div>
   {sheetView(d,{label:'Kepada',value:sectionsOf(d)||`${d.total} staf`})}
   {d.recipients&&d.recipients.length>0&&<div className="table-scroll"><table className="data-table sm-dispo__table"><thead><tr><th>Penerima</th><th>Status</th><th>Waktu</th></tr></thead><tbody>{d.recipients.map(r=>{const st=stateOf(r);return <tr key={r.id}><td>{r.name}</td><td><span className={`sm-badge tone-${st.tone}`}>{st.text}</span></td><td>{st.at?fmt(st.at):'—'}</td></tr>})}</tbody></table></div>}
  </div>)}

  {received.map(d=><div className="sm-dispo__block" key={d.id}>
   <div className="sm-dispo__meta"><span>Dikirim {fmt(d.createdAt)}</span>{d.myAcknowledgedAt&&<span className="sm-badge tone-ok">Diterima {fmt(d.myAcknowledgedAt)}</span>}</div>
   {sheetView(d,{label:'Dari',value:d.issuerName})}
   {!d.myAcknowledgedAt&&<div className="sm-dispo__actions"><button type="button" className="btn primary" disabled={busy} onClick={()=>void accept(d.id)}>{busy?'Memproses…':'Terima Disposisi'}</button></div>}
  </div>)}

  {canSend&&<div className="sm-dispo__form">
   <div className="sm-dispo__grid">
    <div className="sdl-arahan__compose-card">
     <fieldset className="sdl-arahan__sheet sm-dispo__agenda" disabled><legend>Lembar disposisi</legend>
      <label className="is-wide"><span>No. Agenda</span><input value="" readOnly placeholder="Terisi otomatis saat bagian yang ditugasi membuat surat keluar"/></label>
     </fieldset>
     <div className="sdl-arahan__receiver-head"><span>Kepada <b>{picked.length}/{sections.length||11}</b></span><span className="sdl-arahan__small">Jabatan, seluruh bagian, atau Paur</span></div>
     <ChipPicker ariaLabel="Tujuan disposisi" cap="TUJUAN DISPOSISI" placeholder={picked.length?'Tambah tujuan…':'Ketik atau pilih Kasubbag, bagian, atau Paur…'} empty={sections.length===0?'Daftar tujuan belum dapat dimuat.':'Semua tujuan sudah dipilih.'}
      options={sections.map(s=>({key:s.key,label:s.label,detail:`${kindCap[s.kind]||s.unit.toUpperCase()} · ${s.kind==='jabatan'&&s.holders.length===1?s.holders[0].name:`${s.holders.length} orang`}`,blocked:s.holders.length===0?(s.kind==='paur'?'Belum ada anggota Paur ini.':'Belum ada anggota aktif.'):''}))}
      picked={picked} labelOf={k=>sectionLabel[k]||k} disabled={busy} onToggle={k=>toggle(picked,setPicked,k)}/>
     <div className="sdl-arahan__receiver-head"><span>Disposisi Kabagrenmin <b>{dispo.length}</b></span><span className="sdl-arahan__small">Pilihan dikelola di Master Data</span></div>
     <ChipPicker ariaLabel="Disposisi Kabagrenmin" cap="PILIHAN DISPOSISI" placeholder={dispo.length?'Tambah disposisi…':'Ketik atau pilih disposisi…'} empty={options.length===0?'Belum ada pilihan disposisi di Master Data.':'Semua pilihan sudah dipilih.'}
      options={options.map(o=>({key:o.code,label:o.name,detail:o.code,blocked:''}))}
      picked={dispo} labelOf={c=>optionName[c]||c} disabled={busy} onToggle={c=>toggle(dispo,setDispo,c)}/>
     <div className="sdl-arahan__sheet-note"><label htmlFor={`sm-dispo-note-${letter.id}`}>Disposisi lainnya <i>(di luar daftar)</i></label><textarea id={`sm-dispo-note-${letter.id}`} maxLength={1000} rows={3} value={note} disabled={busy} onChange={e=>setNote(e.target.value)} placeholder="Tulis disposisi yang tidak ada di daftar…"/></div>
    </div>
    <aside className="sdl-arahan__settings">
     <div className="sdl-arahan__setting-block"><span className="sdl-arahan__setting-label">Klasifikasi</span><div className="sdl-arahan__priority-switch" role="group" aria-label="Klasifikasi">{[['biasa','Biasa'],['penting','Rahasia']].map(([v,l])=>{const locked=v==='biasa'&&letter.classification==='penting';return <button type="button" key={v} className={klas===v?`active ${v}`:''} aria-pressed={klas===v} disabled={busy||locked} title={locked?'Surat ini berklasifikasi Rahasia.':undefined} onClick={()=>setKlas(v)}>{l}</button>})}</div></div>
     <div className="sdl-arahan__setting-block"><span className="sdl-arahan__setting-label">Derajat</span><div className="sdl-arahan__priority-switch" role="group" aria-label="Derajat">{[['biasa','Biasa'],['kilat','Kilat']].map(([v,l])=><button type="button" key={v} className={derajat===v?`active ${v}`:''} aria-pressed={derajat===v} disabled={busy} onClick={()=>setDerajat(v)}>{l}</button>)}</div></div>
     <div className="sdl-arahan__send-summary"><span>Ringkasan pengiriman</span><strong>{picked.length} tujuan · {recipientCount} orang</strong><small>{picked.length?picked.map(k=>sectionLabel[k]||k).join(' · '):'Belum ada tujuan yang dipilih.'}</small><small>Surat beserta lampirannya ikut diserahkan. Setelah dikirim, disposisi tidak dapat diubah.</small></div>
     <button type="button" className="sdl-arahan__primary sdl-arahan__send" disabled={busy||picked.length===0} onClick={()=>setConfirmOpen(true)}>{busy?'Mengirim…':'Kirim Disposisi →'}</button>
    </aside>
   </div>
  </div>}

  {confirmOpen&&<div className="sdl-sm-r5f6__backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setConfirmOpen(false)}}><section className="sdl-sm-r5f6__dialog sdl-sm-r5f6__dialog--compact" role="dialog" aria-modal="true" aria-label="Konfirmasi disposisi"><header className="sdl-sm-r5f6__modal-head"><div><span className="eyebrow">KONFIRMASI DISPOSISI</span><h2>Kirim disposisi?</h2><p>Surat beserta lampirannya diserahkan ke {recipientCount} orang di {picked.map(k=>sectionLabel[k]||k).join(', ')}.</p></div></header><div className="sdl-sm-r5f6__confirm-text"><strong>{letter.letterNumber}</strong><span>{dispo.length?dispo.map(c=>optionName[c]||c).join(' · '):'Tanpa pilihan disposisi'}{note.trim()?' · ada disposisi lainnya':''}</span><span>Setelah dikirim, disposisi tidak dapat diubah.</span></div><footer className="sdl-sm-r5f6__actions"><button type="button" className="btn" disabled={busy} onClick={()=>setConfirmOpen(false)}>Kembali</button><button type="button" className="btn primary" disabled={busy} onClick={()=>void send()}>Ya, Kirim</button></footer></section></div>}
 </section>
}
