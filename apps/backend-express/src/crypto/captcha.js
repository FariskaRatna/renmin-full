import { createHash } from 'node:crypto'

/**
 * Proof-of-work CAPTCHA lokal, padanan apps/backend/internal/auth/captcha.go.
 *
 * Difficulty 16 bit: dua byte pertama sha256(nonce + ":" + counter) harus nol.
 * Bukan reCAPTCHA, tanpa layanan eksternal.
 *
 * Sisi klien menghitungnya dengan crypto.subtle, yang HANYA tersedia di secure
 * context. Itu sebabnya SDL tidak bisa login lewat http:// ke alamat IP —
 * batasan itu tetap berlaku setelah migrasi.
 */
const DIFFICULTY = 16
const MAX_COUNTER = 5_000_000
const LIFETIME_SECONDS = 120

/** Padanan proofIsValid (captcha.go:35). */
export function proofIsValid(nonce, counter) {
  if (!Number.isInteger(counter) || counter < 0 || counter > MAX_COUNTER) return false
  const digest = createHash('sha256').update(`${nonce}:${counter}`).digest()
  return digest[0] === 0 && digest[1] === 0
}

/** Hanya untuk pengujian; produksi tidak pernah memecahkan proof sendiri. */
export function solveProof(nonce) {
  for (let counter = 0; counter <= MAX_COUNTER; counter++) {
    if (proofIsValid(nonce, counter)) return counter
  }
  throw new Error('proof-of-work tidak ditemukan')
}

export const CAPTCHA_PARAMS = Object.freeze({ DIFFICULTY, MAX_COUNTER, LIFETIME_SECONDS })
