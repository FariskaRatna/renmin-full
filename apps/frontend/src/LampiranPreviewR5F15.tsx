import { useEffect, useState } from 'react'
import './LampiranPreviewR5F15.css'

type RemoteFile = {url:string;name:string;mime:string}
type Props = {file?:File;stored?:RemoteFile;onClose:()=>void}
const fileType = (name:string):'pdf'|'image'|null => /\.pdf$/i.test(name)?'pdf':/\.(jpg|jpeg|png)$/i.test(name)?'image':null

export function LampiranPreviewR5F15({file,stored,onClose}:Props) {
 const [url,setURL]=useState('')
 const [error,setError]=useState('')
 const name=file?.name??stored?.name??''
 const kind=fileType(name)
 useEffect(()=>{
  const ctrl=new AbortController()
  let objectURL:string|undefined
  let mounted=true
  async function open(){
   try {
    setURL('');setError('')
    if(!kind)throw Error('Format ini tidak tersedia untuk preview.')
    let raw:Blob
    if(file){
     raw=file
    } else if (stored){
     const result=await fetch(stored.url,{credentials:'same-origin',cache:'no-store',signal:ctrl.signal})
     if(!result.ok)throw Error(result.status===401?'Sesi berakhir. Login kembali.':'Tidak memiliki izin membuka lampiran atau berkas tidak ditemukan.')
     if(result.type==='opaque')throw Error('Berkas tidak dapat diakses.')
     const payload=await result.blob()
     const expected=kind==='pdf'?'application/pdf':/\.png$/i.test(name)?'image/png':'image/jpeg'
     if(payload.size>10*1024*1024||payload.size===0)throw Error('Ukuran berkas tidak dapat dipreview.')
     raw=new Blob([payload],{type:expected})
    } else throw Error('Berkas tidak tersedia.')
    if(ctrl.signal.aborted)return
    const expected=kind==='pdf'?'application/pdf':/\.png$/i.test(name)?'image/png':'image/jpeg'
    objectURL=URL.createObjectURL(new Blob([raw],{type:expected}))
    if(mounted)setURL(objectURL)
   }catch(e){if(mounted&&!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Gagal memuat preview.')}
  }
  void open()
  return()=>{mounted=false;ctrl.abort();if(objectURL)URL.revokeObjectURL(objectURL)}
 },[file,stored?.url,stored?.mime,stored?.name,kind,name])
 useEffect(()=>{
  const handler=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();onClose()}}
  window.addEventListener('keydown',handler,true)
  return()=>window.removeEventListener('keydown',handler,true)
 },[onClose])
 return <div className="sdl-r5f15__shade" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section className="sdl-r5f15__modal" role="dialog" aria-modal="true" aria-label={`Preview ${name}`}>
   <header><div><strong>Preview Lampiran</strong><p title={name}>{name}</p></div><button type="button" className="btn" autoFocus onClick={onClose} aria-label="Tutup preview">Tutup</button></header>
   <div className="sdl-r5f15__viewer">
    {error?<p role="alert">{error}</p>:!url?<p>Memuat lampiran...</p>:kind==='image'?<img src={url} alt={`Pratinjau ${name}`}/>:<iframe src={url} title={`Pratinjau PDF ${name}`} sandbox="allow-same-origin"/>}
   </div>
   <footer>Hanya untuk pemeriksaan dokumen. Lampiran baru belum tersimpan sebelum pengajuan berhasil.</footer>
  </section>
 </div>
}
