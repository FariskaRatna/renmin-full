import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask } from 'pdfjs-dist'
import './LampiranPreviewR5F15.css'

type RemoteFile = {url:string;name:string;mime:string}
// R5H13: maxBytes/title/note opsional; bawaan tetap seperti semula (Surat Masuk).
type Props = {file?:File;stored?:RemoteFile;onClose:()=>void;maxBytes?:number;title?:string;note?:string}
const fileType = (name:string):'pdf'|'image'|null => /\.pdf$/i.test(name)?'pdf':/\.(jpg|jpeg|png)$/i.test(name)?'image':null
const MAX_PAGES = 60

/**
 * R5H13: PDF digambar dengan pdf.js ke kanvas, BUKAN lewat <iframe sandbox>.
 * Chrome memblokir penampil PDF bawaannya di iframe ber-sandbox (yang tampil
 * hanya ikon berkas rusak), sehingga pratinjau PDF sebelumnya tidak tampil di
 * Chrome. Dengan pdf.js tidak ada plugin PDF browser yang berjalan dan tidak
 * ada skrip dari dalam PDF yang dieksekusi (pdf.js hanya menggambar).
 */
export function LampiranPreviewR5F15({file,stored,onClose,maxBytes=10*1024*1024,title='Preview Lampiran',note='Hanya untuk pemeriksaan dokumen. Lampiran baru belum tersimpan sebelum pengajuan berhasil.'}:Props) {
 const [url,setURL]=useState('')
 const [error,setError]=useState('')
 const [pages,setPages]=useState(0)
 const [rendering,setRendering]=useState(false)
 const [blob,setBlob]=useState<Blob|null>(null)
 const pagesRef=useRef<HTMLDivElement|null>(null)
 const name=file?.name??stored?.name??''
 const kind=fileType(name)
 useEffect(()=>{
  const ctrl=new AbortController()
  let objectURL:string|undefined
  let mounted=true
  async function open(){
   try {
    setURL('');setError('');setBlob(null);setPages(0)
    if(!kind)throw Error('Format ini tidak tersedia untuk preview.')
    let raw:Blob
    if(file){
     raw=file
    } else if (stored){
     const result=await fetch(stored.url,{credentials:'same-origin',cache:'no-store',signal:ctrl.signal})
     if(!result.ok)throw Error(result.status===401?'Sesi berakhir. Login kembali.':'Tidak memiliki izin membuka lampiran atau berkas tidak ditemukan.')
     if(result.type==='opaque')throw Error('Berkas tidak dapat diakses.')
     const payload=await result.blob()
     if(payload.size>maxBytes||payload.size===0)throw Error('Ukuran berkas tidak dapat dipreview.')
     raw=payload
    } else throw Error('Berkas tidak tersedia.')
    if(ctrl.signal.aborted)return
    if(kind==='pdf'){if(mounted)setBlob(raw);return}
    const expected=/\.png$/i.test(name)?'image/png':'image/jpeg'
    objectURL=URL.createObjectURL(new Blob([raw],{type:expected}))
    if(mounted)setURL(objectURL)
   }catch(e){if(mounted&&!ctrl.signal.aborted)setError(e instanceof Error?e.message:'Gagal memuat preview.')}
  }
  void open()
  return()=>{mounted=false;ctrl.abort();if(objectURL)URL.revokeObjectURL(objectURL)}
 },[file,stored?.url,stored?.mime,stored?.name,kind,name,maxBytes])

 // Gambar setiap halaman PDF selebar panel pratinjau.
 useEffect(()=>{
  const host=pagesRef.current
  if(!blob||!host)return
  let cancelled=false
  let task:PDFDocumentLoadingTask|null=null
  void (async()=>{
   setRendering(true)
   try{
    const pdfjs=await import('pdfjs-dist')
    const worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    pdfjs.GlobalWorkerOptions.workerSrc=worker.default
    task=pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer())})
    const doc=await task.promise
    if(cancelled)return
    setPages(doc.numPages)
    host.replaceChildren()
    const width=Math.max(260,(host.parentElement?.clientWidth??800)-40)
    const dpr=window.devicePixelRatio||1
    for(let n=1;n<=Math.min(doc.numPages,MAX_PAGES)&&!cancelled;n++){
     const page=await doc.getPage(n)
     const base=page.getViewport({scale:1})
     const vp=page.getViewport({scale:Math.min(width/base.width,2)})
     const canvas=document.createElement('canvas')
     canvas.width=Math.floor(vp.width*dpr);canvas.height=Math.floor(vp.height*dpr)
     canvas.style.width=`${vp.width}px`;canvas.style.height=`${vp.height}px`
     canvas.setAttribute('aria-label',`Halaman ${n} dari ${doc.numPages}`)
     host.appendChild(canvas)
     await page.render({canvas,viewport:vp,transform:dpr!==1?[dpr,0,0,dpr,0,0]:undefined}).promise
    }
   }catch(e){
    if(!cancelled)setError(e instanceof Error&&/password/i.test(e.message)?'PDF terkunci kata sandi dan tidak dapat dipreview.':'PDF tidak dapat ditampilkan.')
   }finally{if(!cancelled)setRendering(false)}
  })()
  return()=>{cancelled=true;void task?.destroy()}
 },[blob])

 useEffect(()=>{
  const handler=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopImmediatePropagation();onClose()}}
  window.addEventListener('keydown',handler,true)
  return()=>window.removeEventListener('keydown',handler,true)
 },[onClose])
 const pdf=kind==='pdf'&&!error
 return <div className="sdl-r5f15__shade" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section className="sdl-r5f15__modal" role="dialog" aria-modal="true" aria-label={`Preview ${name}`}>
   <header><div><strong>{title}</strong><p title={name}>{name}{pages>0?` · ${pages} halaman`:''}</p></div><button type="button" className="btn" autoFocus onClick={onClose} aria-label="Tutup preview">Tutup</button></header>
   <div className={`sdl-r5f15__viewer${pdf?' is-pdf':''}`}>
    {error?<p role="alert">{error}</p>
     :pdf?<>{pages===0&&<p>{rendering?'Menampilkan PDF...':'Memuat lampiran...'}</p>}<div ref={pagesRef} className="sdl-r5f15__pages" role="document" aria-label={`Pratinjau PDF ${name}`}/>{pages>MAX_PAGES&&<p>Menampilkan {MAX_PAGES} halaman pertama dari {pages}.</p>}</>
     :!url?<p>Memuat lampiran...</p>:<img src={url} alt={`Pratinjau ${name}`}/>}
   </div>
   <footer>{note}</footer>
  </section>
 </div>
}
