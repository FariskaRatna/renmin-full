import { confirmDialog, showToast } from './UIFeedback'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Pager, usePaged } from './PaginationR5H5'
import './SumdaR5B.css'

type Kind = 'personel' | 'pendidikan' | 'inventaris'
type Rank = {code:string;shortName:string;fullName:string;group:string}
type Entry = { id: string; kind: Kind; code: string; title: string; classification: 'biasa' | 'penting'; fields: Record<string, string>; workRecordId: string; version: number; createdAt: string }
type Field = { key: string; label: string; input?: 'number' | 'date' | 'select' | 'textarea'; choices?: string[]; placeholder?: string }
type Draft = { kind: Kind; code: string; title: string; classification: 'biasa' | 'penting'; fields: Record<string, string>; version: number }
type Glyph = 'plus' | 'search' | 'refresh' | 'edit' | 'archive' | 'attachment' | 'close' | 'check' | 'personel' | 'pendidikan' | 'inventaris' | 'arrow' | 'info' | 'list' | 'shield' | 'calendar'

const symbols: Record<Glyph, ReactNode> = {
  plus: <path d="M12 5v14M5 12h14"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  refresh: <><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/></>,
  edit: <><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L9 17l-4 1 1-4z"/></>,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v12h14V9m-10 4h6"/></>,
  attachment: <><path d="M9 12.5 16.5 5a3.2 3.2 0 0 1 4.5 4.5L10.5 20a5.5 5.5 0 0 1-7.8-7.8L13 2"/></>,
  close: <path d="M5 5 19 19M19 5 5 19"/>,
  check: <path d="m4 12 5 5L20 6"/>,
  personel: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  pendidikan: <><path d="m2 9 10-5 10 5-10 5zM6 11v6c3 3 9 3 12 0v-6M22 9v8"/></>,
  inventaris: <><path d="m12 2 9 5-9 5-9-5zM3 7v10l9 5 9-5V7M12 12v10"/></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10h.01"/></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1"/></>,
  shield: <><path d="m12 2 9 4v6c0 6-4 9-9 11-5-2-9-5-9-11V6z"/><path d="m9 12 2 2 4-4"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 10h18"/></>
}
function Icon({name, size=18}: {name: Glyph; size?: number}) { return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{symbols[name]}</svg> }

const schema: Record<Kind, { title: string; singular: string; code: string; name: string; icon: Glyph; helper: string; fields: Field[] }> = {
  personel: { title: 'Data Administrasi Personel', singular: 'Personel', code: 'ID/NRP Internal', name: 'Nama Personel', icon: 'personel', helper: 'Kelola data administrasi personel secara terpusat.', fields: [
    {key:'pangkat',label:'Pangkat Polri',input:'select'},
    {key:'jabatan',label:'Jabatan',placeholder:'Masukkan jabatan personel'},
    {key:'status',label:'Status Personel',input:'select',choices:['Aktif','Mutasi','Pensiun','Lainnya']},
    {key:'unitKerja',label:'Unit Kerja',placeholder:'Nama unit kerja'},
    {key:'keterangan',label:'Keterangan',input:'textarea',placeholder:'Catatan tambahan (opsional)'}
  ]},
  pendidikan: { title: 'Pendidikan & Pengembangan SDM', singular: 'Pendidikan', code: 'Kode Diklat', name: 'Nama Pendidikan / Pelatihan', icon: 'pendidikan', helper: 'Catat kegiatan pendidikan, pelatihan, dan pengembangan personel.', fields: [
    {key:'jenis',label:'Jenis Pendidikan',placeholder:'Contoh: Pelatihan teknis'},
    {key:'penyelenggara',label:'Penyelenggara',placeholder:'Instansi penyelenggara'},
    {key:'tanggalMulai',label:'Tanggal Mulai',input:'date'},
    {key:'tanggalSelesai',label:'Tanggal Selesai',input:'date'},
    {key:'peserta',label:'Peserta / Referensi Personel',placeholder:'Nama atau referensi peserta'},
    {key:'hasil',label:'Hasil / Keterangan',input:'textarea',placeholder:'Hasil kegiatan atau catatan (opsional)'}
  ]},
  inventaris: { title: 'Inventaris & BMN', singular: 'Aset', code: 'Kode Aset', name: 'Nama Barang / Aset', icon: 'inventaris', helper: 'Pantau barang, kondisi, lokasi, dan penanggung jawab aset.', fields: [
    {key:'kategori',label:'Kategori Aset',placeholder:'Contoh: Peralatan kantor'},
    {key:'kondisi',label:'Kondisi Barang',input:'select',choices:['Baik','Rusak Ringan','Rusak Berat','Lainnya']},
    {key:'lokasi',label:'Lokasi Penyimpanan',placeholder:'Ruangan / lokasi'},
    {key:'jumlah',label:'Jumlah Barang',input:'number',placeholder:'1'},
    {key:'penanggungJawab',label:'Penanggung Jawab',placeholder:'Nama petugas'},
    {key:'keterangan',label:'Keterangan',input:'textarea',placeholder:'Catatan tambahan (opsional)'}
  ]}
}

const url = '/api/v1/subbagsumda/registry/'
function errorMessage(raw: string) { return ({
  access_denied: 'Akun belum memiliki akses aktif ke data ini. Periksa grant Subbagsumda.',
  duplicate_code: 'Kode sudah digunakan untuk kategori data ini.',
  stale_version: 'Data telah berubah di sesi lain. Muat ulang data lalu coba lagi.',
  active_disposition: 'Masih ada disposisi aktif. Selesaikan tugas tersebut sebelum mengarsipkan.',
  invalid_sumda_record: 'Periksa kode, nama, tanggal, jumlah, dan panjang isian.',
  not_found: 'Data tidak ditemukan atau sudah diarsipkan.',
  invalid_polri_rank:'Pilih pangkat dari daftar resmi yang tersedia.'
} as Record<string, string>)[raw] || raw }
async function call<T>(endpoint: string, method = 'GET', payload?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if(method !== 'GET') {
    const csrf = await fetch('/api/v1/auth/csrf', {credentials:'same-origin',cache:'no-store'})
    if(!csrf.ok) throw Error('Sesi/CSRF tidak tersedia. Silakan login kembali.')
    const token: {csrfToken:string} = await csrf.json()
    headers['X-CSRF-Token'] = token.csrfToken
    headers['Content-Type'] = 'application/json'
  }
  const r = await fetch(endpoint, {method,credentials:'same-origin',cache:'no-store',headers,...(payload === undefined ? {} : {body:JSON.stringify(payload)})})
  if(!r.ok) {
    const e: {error?:string} = await r.json().catch(() => ({}))
    throw Error(errorMessage(e.error || `Permintaan gagal (HTTP ${r.status})`))
  }
  return r.json() as Promise<T>
}
const blank = (kind: Kind): Draft => ({kind,code:'',title:'',classification:'biasa',fields:{},version:0})
const readableDate = (iso: string) => {const date = new Date(iso);return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('id-ID',{day:'2-digit',month:'short',year:'numeric'})}
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0,2).map(x => x.charAt(0).toLocaleUpperCase('id-ID')).join('') || '–'

export default function SumdaR5B({kind,openFiles}: {kind:Kind;openFiles:(id:string)=>void}) {
  const def = schema[kind]
  const [records,setRecords] = useState<Entry[]>([])
  const [selected,setSelected] = useState<Entry|null>(null)
  const [form,setForm] = useState<Draft>(() => blank(kind))
  const [editing,setEditing] = useState(false)
  const [search,setSearch] = useState('')
  const [appliedSearch,setAppliedSearch] = useState('')
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [limited,setLimited] = useState(false)
  const [sort,setSort] = useState<'latest'|'az'>('latest')
  const [ranks,setRanks] = useState<Rank[]>([])
  const [rankError,setRankError] = useState('')

  async function load(q = '') {
    const data = await call<{items:Entry[];limited:boolean}>(`${url}?kind=${kind}&q=${encodeURIComponent(q)}`)
    setRecords(data.items)
    setLimited(data.limited)
    setAppliedSearch(q)
  }
  useEffect(() => {
    let alive = true
    setRecords([]); setSelected(null); setForm(blank(kind)); setEditing(false)
    setSearch(''); setAppliedSearch(''); setError(''); setNotice(''); setLimited(false); setLoading(true)
    call<{items:Entry[];limited:boolean}>(`${url}?kind=${kind}`).then(data => {
      if(alive) {setRecords(data.items);setLimited(data.limited)}
    }).catch(e => {if(alive) setError(e instanceof Error?e.message:'Tidak bisa memuat data')}).finally(() => {if(alive) setLoading(false)})
    return () => {alive = false}
  }, [kind])
  useEffect(() => {
    if(kind!=='personel')return
    let alive=true
    call<{items:Rank[]}>(`${url}ranks`).then(data=>{if(alive){setRanks(data.items);setRankError('')}}).catch(()=>{if(alive)setRankError('Daftar pangkat belum tersedia. Coba muat ulang.')})
    return()=>{alive=false}
  },[kind])
  useEffect(() => {
    if(!editing) return
    const close = (event: KeyboardEvent) => {if(event.key === 'Escape' && !busy) setEditing(false)}
    window.addEventListener('keydown',close)
    return () => window.removeEventListener('keydown',close)
  }, [editing,busy])

  useEffect(()=>{if(notice)showToast(notice,'success')},[notice])
  useEffect(()=>{if(error)showToast(error,'error')},[error])
  const sorted = useMemo(() => [...records].sort((a,b) => sort==='az' ? a.title.localeCompare(b.title,'id') : new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime()),[records,sort])

  // R5H5: paginasi seperti menu Disposisi.
  const {pageItems:pagedSorted,pager}=usePaged(sorted,[kind,sorted.length])
  const flagged = records.filter(p => p.classification==='penting').length
  const detail = (p:Entry) => kind==='personel' ? [p.fields.jabatan,p.fields.unitKerja].filter(Boolean).join(' · ') : kind==='pendidikan' ? [p.fields.jenis,p.fields.penyelenggara].filter(Boolean).join(' · ') : [p.fields.kategori,p.fields.lokasi].filter(Boolean).join(' · ')

  function newRecord() {setSelected(null);setForm(blank(kind));setEditing(true);setError('');setNotice('')}
  function edit(p:Entry) {setSelected(p);setForm({kind,code:p.code,title:p.title,classification:p.classification,fields:{...p.fields},version:p.version});setEditing(true);setError('');setNotice('')}
  async function run(action:()=>Promise<void>,message:string) {
    if(busy) return
    setBusy(true);setError('');setNotice('')
    try {await action();setNotice(message)}
    catch(e) {setError(e instanceof Error?e.message:'Gagal menghubungi API')}
    finally {setBusy(false)}
  }
  function save(e:FormEvent<HTMLFormElement>) {
    e.preventDefault()
    void run(async () => {
      if(selected) {
        await call(`${url}${selected.id}`,'PATCH',form)
      } else {
        await call<{id:string}>(url,'POST',form)
      }
      await load(appliedSearch)
      setEditing(false)
      setSelected(null)
    }, 'Data berhasil disimpan.')
  }
  async function remove(p:Entry) {
    if(!await confirmDialog(`Arsipkan ${p.title}? Riwayat tetap tersimpan.`,{confirmLabel:"Arsipkan",danger:true})) return
    void run(async () => {
      await call(`${url}${p.id}`,'DELETE',{})
      setSelected(null);setEditing(false)
      await load(appliedSearch)
    }, 'Data berhasil diarsipkan.')
  }
  function searchRecords(e:FormEvent<HTMLFormElement>) {e.preventDefault();void run(() => load(search.trim()),'')}
  function resetSearch() {setSearch('');void run(()=>load(''),'')}
  function changeField(key:string,value:string) {setForm(v=>({...v,fields:{...v.fields,[key]:value}}))}

  return <div className="sumda-r5b">
    <section className="sumda-overview" aria-label="Ringkasan data">
      <div className="sumda-overview-mark"><Icon name={def.icon} size={24}/></div>
      <div className="sumda-overview-title"><span className="sumda-eyebrow">MASTER DATA / SUBBAGSUMDA</span><h2>{def.title}</h2><p>{def.helper}</p></div>
      <div className="sumda-overview-stats">
        <div className="sumda-stat"><span>Data ditampilkan</span><strong>{loading?'–':records.length}</strong></div>
        <div className="sumda-stat"><span>Klasifikasi penting</span><strong>{loading?'–':flagged}</strong></div>
      </div>
    </section>

    <section className="sumda-card sumda-register" aria-label={`Daftar ${def.singular}`}>
      <div className="sumda-card-head">
        <div><span className="sumda-eyebrow">PERSONEL & ASET</span><h3>Daftar {def.singular}</h3></div>
        <button className="sumda-button sumda-button-primary" type="button" onClick={newRecord}><Icon name="plus" size={18}/> Tambah {def.singular}</button>
      </div>
      <div className="sumda-toolbar">
        <form className="sumda-search" onSubmit={searchRecords} role="search">
          <Icon name="search" size={18}/>
          <input value={search} onChange={e=>setSearch(e.target.value)} maxLength={100} aria-label={`Cari ${def.singular}`} placeholder={`Cari ${def.code.toLowerCase()}, nama...`}/>
          <button type="submit" disabled={busy}>{busy?'Memuat...':'Cari'}</button>
        </form>
        <div className="sumda-toolbar-controls">
          <label className="sumda-sort-label" htmlFor={`sumda-sort-${kind}`}>Urutkan</label>
          <select id={`sumda-sort-${kind}`} value={sort} onChange={e=>setSort(e.target.value as 'latest'|'az')} aria-label="Urutan daftar"><option value="latest">Terbaru</option><option value="az">Nama A–Z</option></select>
          <button className="sumda-icon-button" type="button" onClick={()=>{void run(()=>load(appliedSearch),'')}} disabled={busy} title="Muat ulang" aria-label="Muat ulang"><Icon name="refresh" size={18}/></button>
          {(appliedSearch||search)&&<button className="sumda-button sumda-button-quiet" type="button" onClick={resetSearch} disabled={busy}>Reset</button>}
        </div>
      </div>
      {limited&&<div className="sumda-inline-note"><Icon name="info" size={16}/> Maksimal 100 data ditampilkan. Persempit kata pencarian untuk melihat hasil lainnya.</div>}
      {loading ? <div className="sumda-empty" role="status"><div className="sumda-empty-icon"><Icon name="refresh" size={24}/></div><h4>Memuat data...</h4><p></p></div>
      : sorted.length===0 ? <div className="sumda-empty"><div className="sumda-empty-icon"><Icon name={appliedSearch?'search':def.icon} size={30}/></div><h4>{appliedSearch?'Tidak ada hasil yang cocok':'Belum ada data terdaftar'}</h4><p>{appliedSearch?'Coba kata kunci lain atau reset pencarian.':'Belum ada data. Tambahkan data pertama Anda.'}</p><button type="button" className="sumda-button sumda-button-primary" onClick={appliedSearch?resetSearch:newRecord}>{appliedSearch?<Icon name="refresh" size={17}/>:<Icon name="plus" size={17}/>} {appliedSearch?'Tampilkan semua':`Tambah ${def.singular} pertama`}</button></div>
      : <div className="sumda-table-scroll"><table className="sumda-table"><thead><tr><th>{def.code}</th><th>Nama / Keterangan</th><th>Informasi</th><th>Klasifikasi</th><th>Tanggal input</th><th className="sumda-actions-title">Aksi</th></tr></thead><tbody>{pagedSorted.map(p=><tr key={p.id}>
         <td><span className="sumda-code">{p.code}</span></td>
         <td><div className="sumda-person-cell"><span className="sumda-avatar" aria-hidden="true">{initials(p.title)}</span><strong>{p.title}</strong></div></td>
         <td className="sumda-secondary-cell">{detail(p)||'–'}</td>
         <td><span className={`sumda-classification ${p.classification==='penting'?'is-important':''}`}>{p.classification==='penting'?'Penting':'Biasa'}</span></td>
         <td className="sumda-secondary-cell">{readableDate(p.createdAt)}</td>
         <td><div className="sumda-actions"><button type="button" className="sumda-action" title="Edit data" onClick={()=>edit(p)}><Icon name="edit" size={16}/> <span>Edit</span></button><button type="button" className="sumda-action sumda-action-attachment" title="Buka lampiran dan disposisi" onClick={()=>openFiles(p.workRecordId)}><Icon name="attachment" size={16}/> <span>File & Disposisi</span></button><button type="button" className="sumda-action sumda-action-danger" title="Arsipkan data" onClick={()=>remove(p)} disabled={busy}><Icon name="archive" size={16}/><span className="sumda-sr-only">Arsipkan</span></button></div></td>
        </tr>)}</tbody></table></div>}<Pager pager={pager} label="data"/>
      <footer className="sumda-list-footer"><span><Icon name="list" size={15}/> {loading?'Memuat...':`${records.length} data ditampilkan${limited?' (maks. 100)':''}`}</span><span></span></footer>
    </section>



    

    {editing&&<div className="sumda-dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setEditing(false)}}>
      <section className="sumda-dialog" role="dialog" aria-modal="true" aria-labelledby="sumda-dialog-title" aria-describedby="sumda-dialog-hint">
        <div className="sumda-dialog-head"><div className="sumda-dialog-emblem"><Icon name={def.icon} size={22}/></div><div><span className="sumda-eyebrow">{selected?'UBAH DATA':'ENTRI BARU'} / SUBBAGSUMDA</span><h2 id="sumda-dialog-title">{selected?'Edit':'Tambah'} {def.singular}</h2><p id="sumda-dialog-hint">Isi data di bawah ini. Kolom dengan tanda * wajib diisi.</p></div><button type="button" className="sumda-dialog-close" onClick={()=>!busy&&setEditing(false)} aria-label="Tutup formulir" disabled={busy}><Icon name="close" size={20}/></button></div>
        <form id="sumda-edit-form" className="sumda-dialog-form" onSubmit={save}>
          <div className="sumda-form-block"><div className="sumda-form-section"><span className="sumda-form-step">01</span><div><h3>Informasi utama</h3><p>Identitas dan nama {def.singular.toLowerCase()}.</p></div></div><div className="sumda-form-grid">
            <label className="sumda-field"><span>{def.code} <b aria-label="wajib diisi">*</b></span><input autoFocus required minLength={2} maxLength={64} value={form.code} onChange={e=>setForm(v=>({...v,code:e.target.value}))} placeholder={`Masukkan ${def.code.toLowerCase()}`}/></label>
            <label className="sumda-field"><span>{def.name} <b aria-label="wajib diisi">*</b></span><input required minLength={3} maxLength={200} value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))} placeholder={`Masukkan ${def.name.toLowerCase()}`}/></label>
          </div></div>
          <div className="sumda-form-block"><div className="sumda-form-section"><span className="sumda-form-step">02</span><div><h3>Detail {def.singular}</h3><p>Lengkapi informasi pendukung yang relevan.</p></div></div>{kind==='personel'&&rankError&&<div className="sumda-message sumda-message-error" role="alert">{rankError}</div>}<div className="sumda-form-grid">
            {def.fields.map(f=><label className={`sumda-field ${f.input==='textarea'?'sumda-field-wide':''}`} key={f.key}><span>{f.label}</span>{f.input==='select'?<select value={form.fields[f.key]||''} onChange={e=>changeField(f.key,e.target.value)} disabled={f.key==='pangkat'&&ranks.length===0}><option value="">Pilih {f.label.toLowerCase()}</option>{f.key==='pangkat'?<>{form.fields.pangkat&&!ranks.some(x=>x.code===form.fields.pangkat)&&<option value={form.fields.pangkat}>Legacy: {form.fields.pangkat} (ubah ke pangkat valid)</option>}{ranks.map(x=><option key={x.code} value={x.code}>{x.shortName} — {x.fullName}</option>)}</>:f.choices?.map(x=><option key={x} value={x}>{x}</option>)}</select>:f.input==='textarea'?<textarea rows={3} maxLength={200} value={form.fields[f.key]||''} onChange={e=>changeField(f.key,e.target.value)} placeholder={f.placeholder||'Tambahkan keterangan...'}/>:<input type={f.input||'text'} min={f.input==='number'?1:undefined} step={f.input==='number'?1:undefined} maxLength={f.input==='number'?undefined:200} value={form.fields[f.key]||''} onChange={e=>changeField(f.key,e.target.value)} placeholder={f.placeholder||''}/>}</label>)}
          </div></div>
          <div className="sumda-form-block"><div className="sumda-form-section"><span className="sumda-form-step">03</span><div><h3>Pengaturan akses data</h3><p>Pilih klasifikasi sesuai dokumen yang dicatat.</p></div></div><div className="sumda-form-grid"><label className="sumda-field"><span>Klasifikasi</span><select value={form.classification} onChange={e=>setForm(v=>({...v,classification:e.target.value as 'biasa'|'penting'}))}><option value="biasa">Biasa</option><option value="penting">Penting</option></select></label><div className="sumda-classification-help"><Icon name="info" size={18}/><span>Data penting hanya dapat diakses oleh akun dengan grant klasifikasi yang sesuai.</span></div></div></div>
        </form>
        <div className="sumda-dialog-foot"><span/><div className="sumda-dialog-buttons"><button type="button" className="sumda-button sumda-button-cancel" disabled={busy} onClick={()=>setEditing(false)}>Batal</button><button type="submit" form="sumda-edit-form" className="sumda-button sumda-button-primary" disabled={busy}><Icon name="check" size={18}/>{busy?'Menyimpan...':selected?'Simpan Perubahan':'Simpan Data'}</button></div></div>
      </section>
    </div>}
  </div>
}
