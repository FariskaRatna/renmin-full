import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import './SearchSelectR5H8.css'

/**
 * R5H8: dropdown yang bisa dicari, untuk pilihan yang isinya dari Master Data.
 *
 * Dibuka -> kotak cari di paling atas (langsung fokus), daftar yang bisa
 * di-scroll di bawahnya. Keyboard: panah atas/bawah, Enter memilih, Esc menutup.
 *
 * Komponen ini sering diletakkan di dalam <label> formulir. Klik di dalam
 * panel karena itu di-preventDefault: tanpa itu, peramban meneruskan klik ke
 * elemen pertama yang bisa diberi label (tombol pemicu) dan panel langsung
 * tertutup lagi.
 */
export type SearchOption = { value: string; label: string }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('id-ID')

export function SearchSelect({ value, options, onChange, placeholder = 'Pilih...', ariaLabel, disabled = false }: {
  value: string
  options: SearchOption[]
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [active, setActive] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const listId = useId()

  // Nilai tersimpan yang tidak ada di daftar (nama lama di Master Data) tetap
  // bisa tampil dan dipilih, supaya data lama tidak terlihat kosong.
  const all = useMemo(() => value && !options.some(o => o.value === value)
    ? [...options, { value, label: `${value} (nilai lama)` }]
    : options, [options, value])
  const shown = useMemo(() => {
    const t = fold(term.trim())
    return t ? all.filter(o => fold(o.label).includes(t)) : all
  }, [all, term])
  const current = all.find(o => o.value === value)

  useEffect(() => {
    if (!open) return
    setTerm('')
    setActive(Math.max(0, all.findIndex(o => o.value === value)))
    window.setTimeout(() => search.current?.focus(), 0)
    const away = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => { setActive(0) }, [term])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  function pick(v: string) {
    onChange(v)
    setOpen(false)
    trigger.current?.focus()
  }
  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(i + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active].value) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  return <div className={`sdl-ss${open ? ' is-open' : ''}`} ref={wrap}>
    <button type="button" ref={trigger} className="sdl-ss__trigger" disabled={disabled}
      aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
      onClick={() => setOpen(o => !o)}
      onKeyDown={e => { if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open) { e.preventDefault(); setOpen(true) } }}>
      <span className={current ? '' : 'sdl-ss__placeholder'}>{current ? current.label : placeholder}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
    </button>
    {open && <div className="sdl-ss__panel" onClick={e => e.preventDefault()}>
      <div className="sdl-ss__search">
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input ref={search} value={term} onChange={e => setTerm(e.target.value)} onKeyDown={onKey}
          placeholder="Cari..." maxLength={100} role="combobox" aria-expanded="true" aria-controls={listId}
          aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined} aria-label={`Cari ${ariaLabel ?? 'pilihan'}`}/>
      </div>
      <ul className="sdl-ss__list" role="listbox" id={listId} ref={list} aria-label={ariaLabel}>
        {value && !term && <li className="sdl-ss__clear" onMouseDown={e => e.preventDefault()} onClick={() => pick('')}>Kosongkan pilihan</li>}
        {shown.length === 0
          ? <li className="sdl-ss__empty">Tidak ada yang cocok.</li>
          : shown.map((o, i) => <li key={o.value} id={`${listId}-${i}`} data-index={i} role="option" aria-selected={o.value === value}
              className={`${i === active ? 'is-active' : ''}${o.value === value ? ' is-selected' : ''}`}
              onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => pick(o.value)}>
              {o.label}
            </li>)}
      </ul>
    </div>}
  </div>
}
