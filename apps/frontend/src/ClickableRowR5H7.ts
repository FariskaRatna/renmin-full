import type { KeyboardEvent, MouseEvent } from 'react'
import './ClickableRowR5H7.css'

/**
 * R5H7: baris tabel yang dibuka dengan mengkliknya langsung -- pengganti
 * tombol "Detail"/"Buka"/"Lihat Surat" di setiap baris (permintaan pemilik,
 * 2026-11-10). Satu helper supaya semua daftar berperilaku sama:
 *
 *   <tr {...clickRow(() => open(id), { label: `Buka ${nomor}`, active })}>
 *
 * - Klik di mana pun pada baris membuka detail.
 * - Enter / Spasi saat baris difokus (Tab) juga membuka -- tetap bisa dipakai
 *   tanpa tetikus.
 * - Tombol, tautan, dan isian DI DALAM baris tidak ikut membuka detail;
 *   mereka tetap menjalankan tindakannya sendiri.
 */
const INTERACTIVE = 'button,a,input,select,textarea,label,[role="button"]:not(tr)'

function fromInside(target: EventTarget, row: EventTarget): boolean {
  const el = target as Element | null
  if (!el || typeof el.closest !== 'function') return false
  const hit = el.closest(INTERACTIVE)
  return Boolean(hit && hit !== row)
}

export function clickRow(open: () => void, opts: { label: string; active?: boolean; disabled?: boolean }) {
  return {
    tabIndex: opts.disabled ? -1 : 0,
    role: 'button' as const,
    'aria-label': opts.label,
    'aria-disabled': opts.disabled || undefined,
    className: `sdl-click-row${opts.active ? ' is-active' : ''}${opts.disabled ? ' is-disabled' : ''}`,
    onClick: (e: MouseEvent<HTMLTableRowElement>) => {
      if (opts.disabled || fromInside(e.target, e.currentTarget)) return
      open()
    },
    onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
      if (opts.disabled || e.target !== e.currentTarget) return
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open() }
    },
  }
}
