import { useEffect, useState } from 'react'
import './LampiranFileCardR5F16.css'

type Props = {file:File;busy:boolean;onPreview:()=>void;onRemove:()=>void}
export function LampiranFileCardR5F16({file,busy,onPreview,onRemove}:Props){
 const isImage=/\.(png|jpe?g)$/i.test(file.name)
 const [thumbnail,setThumbnail]=useState('')
 useEffect(()=>{
  if(!isImage){setThumbnail('');return}
  const url=URL.createObjectURL(file)
  setThumbnail(url)
  return()=>URL.revokeObjectURL(url)
 },[file,isImage])
 return <article className="sdl-r5f16__card">
  <div className="sdl-r5f16__visual">{isImage&&thumbnail?<img src={thumbnail} alt={`Thumbnail ${file.name}`} loading="lazy"/>:<div className="sdl-r5f16__pdf" aria-hidden="true">PDF</div>}</div>
  <div className="sdl-r5f16__info"><strong title={file.name}>{file.name}</strong><small>{(file.size/1024/1024).toFixed(2)} MB · {isImage?'Foto':'Dokumen PDF'}</small><span>Siap diunggah</span></div>
  <div className="sdl-r5f16__actions"><button type="button" className="btn" disabled={busy} onClick={onPreview}>{isImage?'Lihat Foto':'Lihat PDF'}</button><button type="button" className="btn" disabled={busy} onClick={onRemove} aria-label={`Hapus ${file.name}`}>Hapus</button></div>
 </article>
}
