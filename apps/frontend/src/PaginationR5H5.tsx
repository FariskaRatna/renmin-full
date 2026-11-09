import { useEffect, useState } from 'react'
import './PaginationR5H5.css'

/**
 * R5H5: paginasi bersama untuk semua daftar, meniru paginasi menu Disposisi
 * (TugasDisposisiR5F3): ukuran halaman 5/10/50/100, "Menampilkan x–y dari z",
 * Sebelumnya / Halaman n dari m / Berikutnya.
 *
 * Paginasi dilakukan DI SINI, atas data yang sudah lolos otorisasi server dan
 * sudah disaring di layar. Server menyaring izin per baris sesudah LIMIT, jadi
 * paginasi di server akan menghasilkan halaman yang jumlahnya tidak tetap.
 *
 * `resetKeys`: setiap kali salah satunya berubah (pencarian, filter, tab),
 * kembali ke halaman 1 — kalau tidak, menyaring 80 baris menjadi 6 selagi di
 * halaman 4 menghasilkan layar kosong yang terbaca seperti "tidak ada data".
 */
export const PAGE_SIZES = [5, 10, 50, 100] as const

export function usePaged<T>(items: T[], resetKeys: unknown[] = [], initialSize = 10) {
  const [size, setSize] = useState(initialSize)
  const [page, setPage] = useState(1)
  const resetSignature = JSON.stringify(resetKeys)
  useEffect(() => { setPage(1) }, [size, resetSignature])
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const current = Math.min(page, pageCount)
  const start = (current - 1) * size
  return {
    pageItems: items.slice(start, start + size),
    pager: { total, size, page: current, pageCount, start, setSize, setPage },
  }
}

export type PagerState = ReturnType<typeof usePaged>['pager']

export function Pager({ pager, label = 'data' }: { pager: PagerState; label?: string }) {
  const { total, size, page, pageCount, start, setSize, setPage } = pager
  if (total === 0) return null
  return <div className="sdl-pager-r5h5" aria-label={`Navigasi halaman ${label}`}>
    <span className="sdl-pager-r5h5__info">Menampilkan {start + 1}–{Math.min(start + size, total)} dari {total}</span>
    <label className="sdl-pager-r5h5__size"><span className="sdl-pager-r5h5__sr">Jumlah {label} per halaman</span>
      <select value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label={`Jumlah ${label} per halaman`}>
        {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per halaman</option>)}
      </select>
    </label>
    <div className="sdl-pager-r5h5__nav">
      <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Sebelumnya</button>
      <span aria-live="polite">Halaman {page} dari {pageCount}</span>
      <button type="button" className="btn" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Berikutnya</button>
    </div>
  </div>
}
