import { createHash } from 'node:crypto'

/**
 * Proof-of-work CAPTCHA lokal SDL.
 *
 * Padanan proofIsValid di apps/backend/internal/auth/captcha.go:35 —
 *   sha256(nonce + ":" + counter) dengan dua byte pertama nol.
 *
 * Difficulty 16 bit, jadi rata-rata ~65.536 percobaan. Server menolak
 * counter > 5.000.000.
 */
const MAX_COUNTER = 5_000_000

export function solveCaptcha(nonce) {
  for (let counter = 0; counter <= MAX_COUNTER; counter++) {
    const digest = createHash('sha256').update(`${nonce}:${counter}`).digest()
    if (digest[0] === 0 && digest[1] === 0) return counter
  }
  throw new Error(`proof-of-work tidak ditemukan di bawah ${MAX_COUNTER} percobaan`)
}
