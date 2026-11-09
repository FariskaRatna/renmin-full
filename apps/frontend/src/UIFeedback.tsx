import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './UIFeedback.css'

type NoticeKind = 'success' | 'error' | 'info'
type Toast = { id: number; kind: NoticeKind; message: string }
type Confirmation = { message: string; resolve: (answer: boolean) => void; confirmLabel: string; danger: boolean }
const TOAST_EVENT = 'sdl:ui-toast'
const CONFIRM_EVENT = 'sdl:ui-confirm'
let counter = 0

export function showToast(message: string, kind: NoticeKind = 'success') {
  if (!message.trim()) return
  const clean = message.replace(/\b(?:PostgreSQL|database)\b/gi, 'sistem').replace(/\s+/g, ' ').trim()
  window.dispatchEvent(new CustomEvent<Toast>(TOAST_EVENT, {detail:{id:++counter,kind,message:clean}}))
}
export function confirmDialog(message: string, options?: {confirmLabel?:string;danger?:boolean}): Promise<boolean> {
  return new Promise(resolve => {
    const event = new CustomEvent<Confirmation>(CONFIRM_EVENT,{detail:{message,resolve,confirmLabel:options?.confirmLabel||'Ya, lanjutkan',danger:options?.danger??false},cancelable:true})
    if (!window.dispatchEvent(event)) resolve(false)
  })
}

export function FloatingToast({message,kind='success'}:{message:string;kind?:NoticeKind}) {
  useEffect(()=>{if(message)showToast(message,kind)},[message,kind])
  return null
}

export default function UIFeedbackHost() {
  const [toasts,setToasts]=useState<Toast[]>([])
  const [queue,setQueue]=useState<Confirmation[]>([])
  const confirmButton = useRef<HTMLButtonElement>(null)
  const active = queue[0]
  useEffect(()=>{
    const onToast=(event:Event)=>setToasts(current=>[...current.slice(-3),(event as CustomEvent<Toast>).detail])
    const onConfirm=(event:Event)=>setQueue(current=>[...current,(event as CustomEvent<Confirmation>).detail])
    window.addEventListener(TOAST_EVENT,onToast)
    window.addEventListener(CONFIRM_EVENT,onConfirm)
    return ()=>{window.removeEventListener(TOAST_EVENT,onToast);window.removeEventListener(CONFIRM_EVENT,onConfirm)}
  },[])
  useEffect(()=>{
    if(!toasts.length)return
    const id=toasts[0].id
    const timer=window.setTimeout(()=>setToasts(current=>current.filter(n=>n.id!==id)),4200)
    return ()=>window.clearTimeout(timer)
  },[toasts])
  useEffect(()=>{
    if(!active)return
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null
    const oldOverflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    confirmButton.current?.focus()
    function keydown(event:KeyboardEvent){if(event.key==='Escape'){event.preventDefault();answer(false)}}
    window.addEventListener('keydown',keydown)
    return ()=>{document.body.style.overflow=oldOverflow;window.removeEventListener('keydown',keydown);previous?.focus()}
  },[active])
  function answer(ok:boolean){
    setQueue(current=>{
      if(current.length){current[0].resolve(ok);return current.slice(1)}
      return current
    })
  }
  return createPortal(<>
    <div className="sdl-toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map(n=><div className={`sdl-toast sdl-toast-${n.kind}`} role={n.kind==='error'?'alert':'status'} key={n.id}>
        <span className="sdl-toast-mark">{n.kind==='success'?'✓':n.kind==='error'?'!':'i'}</span>
        <span className="sdl-toast-text">{n.message}</span>
        <button type="button" onClick={()=>setToasts(t=>t.filter(x=>x.id!==n.id))} aria-label="Tutup notifikasi">×</button>
      </div>)}
    </div>
    {active&&<div className="sdl-confirm-shade" onMouseDown={e=>{if(e.target===e.currentTarget)answer(false)}}>
      <section className="sdl-confirm-panel" role="alertdialog" aria-modal="true" aria-labelledby="sdl-confirm-title" aria-describedby="sdl-confirm-description">
        <div className={`sdl-confirm-symbol${active.danger?' danger':''}`}>?</div>
        <h2 id="sdl-confirm-title">Konfirmasi tindakan</h2>
        <p id="sdl-confirm-description">{active.message}</p>
        <div className="sdl-confirm-actions">
          <button type="button" className="sdl-confirm-cancel" onClick={()=>answer(false)}>Batal</button>
          <button ref={confirmButton} type="button" className={`sdl-confirm-accept${active.danger?' danger':''}`} onClick={()=>answer(true)}>{active.confirmLabel}</button>
        </div>
      </section>
    </div>}
  </>,document.body)
}
