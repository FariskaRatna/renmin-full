import { useEffect, useRef, useState } from 'react'

export type CaptchaProof = { id: string; counter: number }
type Challenge = { id: string; nonce: string; difficulty: number; expiresInSeconds: number }

// Proof diperbarui sekian detik sebelum challenge kedaluwarsa. Server memberi
// 120 detik (captcha.go:63); jeda 25 detik menutup waktu menghitung proof
// berikutnya plus perjalanan request login.
const REFRESH_MARGIN_SECONDS = 25

/**
 * Mengambil challenge baru dari server dan menghitung proof-of-work-nya.
 *
 * Dipakai komponen di bawah dan oleh form login saat server menolak proof
 * (`captcha_invalid`): challenge sekali pakai dan berumur 2 menit, jadi proof
 * yang dihitung saat halaman dibuka sudah tidak berlaku kalau pengguna baru
 * menekan Masuk beberapa menit kemudian.
 */
export async function solveCaptcha(isCancelled: () => boolean = () => false): Promise<{ proof: CaptchaProof; expiresInSeconds: number } | null> {
  if (!crypto.subtle) throw new Error('Browser memerlukan konteks localhost/HTTPS untuk Web Crypto.')
  const res = await fetch('/api/v1/auth/captcha', { cache: 'no-store', credentials: 'same-origin' })
  if (!res.ok) throw new Error(res.status === 429 ? 'Permintaan terlalu banyak. Coba lagi nanti.' : 'CAPTCHA lokal belum tersedia.')
  const puzzle = await res.json() as Challenge
  if (!/^[A-Za-z0-9_-]{43}$/.test(puzzle.id) || !/^[A-Za-z0-9_-]{24}$/.test(puzzle.nonce) || puzzle.difficulty !== 16) throw new Error('Challenge tidak valid.')
  const enc = new TextEncoder()
  const begin = Date.now()
  for (let i = 0; i <= 5000000; i++) {
    if (isCancelled()) return null
    // Delay periodically to keep mobile browsers responsive.
    if (i % 256 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0))
    if (Date.now() - begin > 90000) throw new Error('Waktu verifikasi habis. Coba lagi.')
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${puzzle.nonce}:${i}`)))
    if (digest[0] === 0 && digest[1] === 0) return { proof: { id: puzzle.id, counter: i }, expiresInSeconds: puzzle.expiresInSeconds }
  }
  throw new Error('Verifikasi gagal. Coba lagi.')
}

// Deliberately fully local: the browser uses Web Crypto, Go issues and validates
// the single-use challenge. There are no third-party scripts or API requests.
export default function LocalCaptcha({onVerified}:{onVerified:(proof:CaptchaProof|null)=>void}) {
  const [state,setState]=useState<'idle'|'solving'|'verified'|'failed'>('idle')
  const [error,setError]=useState('')
  const cancelled=useRef(false)
  const solving=useRef(false)
  const refreshTimer=useRef<number|undefined>(undefined)
  // React StrictMode replays effect setup/cleanup in development.
  // Reset the cancellation flag on every setup, otherwise the solver stops
  // immediately after its first await and leaves the UI stuck on "Proses...".
  useEffect(() => {
    cancelled.current = false
    // Dimulai otomatis. Proof-of-work dihitung browser dan tidak ada yang perlu
    // dibaca atau diketik pengguna, jadi klik manual hanya menambah satu langkah
    // tanpa menambah keamanan. Tombolnya tetap ada untuk mencoba ulang saat
    // gagal — challenge sekali pakai, jadi percobaan baru butuh challenge baru.
    //
    // Aman terhadap StrictMode: setup kedua mengembalikan cancelled ke false,
    // sehingga solver dari setup pertama melanjutkan loop-nya, dan panggilan
    // kedua berhenti di penjaga solving di awal verify().
    void verify()
    return () => { cancelled.current = true; window.clearTimeout(refreshTimer.current) }
  }, [])

  async function verify() {
    if (solving.current) return
    solving.current = true
    window.clearTimeout(refreshTimer.current)
    setState('solving');setError('');onVerified(null)
    try {
      const solved = await solveCaptcha(() => cancelled.current)
      if (!solved || cancelled.current) return
      onVerified(solved.proof);setState('verified')
      // Proof berumur pendek. Halaman login yang dibiarkan terbuka (pengguna
      // pergi sebentar sebelum mengetik password) tetap punya proof yang
      // berlaku: perbarui diam-diam sebelum challenge kedaluwarsa.
      const refreshIn = Math.max(10, solved.expiresInSeconds - REFRESH_MARGIN_SECONDS) * 1000
      refreshTimer.current = window.setTimeout(() => { if (!cancelled.current) void verify() }, refreshIn)
    } catch(e){if(!cancelled.current){setState('failed');setError(e instanceof Error?e.message:'Gagal memverifikasi perangkat')}}
    finally { solving.current = false }
  }
  // Tidak ditampilkan selama jalurnya normal: pengguna tidak punya keputusan
  // untuk diambil di sini, dan proof sudah dihitung sendiri sebelum kredensial
  // selesai diketik.
  //
  // Kegagalan TETAP ditampilkan, dan itu bukan inkonsistensi. Tombol "Masuk"
  // terkunci sampai proof ada (App.tsx:217), jadi tanpa pesan ini kegagalan
  // CAPTCHA muncul sebagai tombol mati tanpa sebab — kelas gejala menyesatkan
  // yang sama dengan yang dicatat di CLAUDE.md (konteks non-secure dan
  // SDL_ALLOWED_ORIGINS kosong keduanya mendarat di sini).
  if (state !== 'failed') return null
  return <div className="sdl-local-captcha" role="group" aria-label="Verifikasi keamanan lokal">
    <div className="sdl-local-captcha-row">
      <span aria-hidden="true" className="sdl-local-shield">◆</span>
      <div><strong>Verifikasi keamanan gagal</strong>
      <small>Login terkunci sampai verifikasi berhasil</small></div>
      <button type="button" className="btn" onClick={()=>void verify()}>Coba lagi</button>
    </div>
    {error&&<small role="alert" className="sdl-local-error">{error}</small>}
  </div>
}
