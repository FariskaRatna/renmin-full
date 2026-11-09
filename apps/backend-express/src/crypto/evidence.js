import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Enkripsi bukti keuangan, padanan apps/backend/internal/subbagren/evidence_crypto.go.
 *
 * Format amplop berversi "SDL1":
 *
 *   "SDL1" (4 byte) || nonce (12 byte) || ciphertext || tag (16 byte)
 *
 * dengan amplop "SDL1" dipakai sebagai ADDITIONAL AUTHENTICATED DATA pada
 * Seal/Open. Itu detail yang paling mudah terlewat: AAD tidak terlihat di
 * susunan byte, tapi kalau tidak disetel, dekripsi gagal total.
 *
 * Di Go, gcm.Seal mengembalikan ciphertext dengan tag ditempel di belakang.
 * Node memisahkan keduanya (getAuthTag/setAuthTag), jadi penggabungan dan
 * pemisahan harus dilakukan manual di sini.
 *
 * Tidak ada fallback plaintext. Kunci yang bukan 32 byte selalu gagal —
 * fail-closed, sama seperti Go.
 */
const ENVELOPE = Buffer.from('SDL1', 'ascii')
const NONCE_LENGTH = 12 // gcm.NonceSize() standar
const TAG_LENGTH = 16 // gcm.Overhead()
const KEY_LENGTH = 32

export class EvidenceKeyError extends Error {
  constructor() {
    super('financial evidence encryption key unavailable')
    this.name = 'EvidenceKeyError'
  }
}

export function sealEvidence(key, data) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) throw new EvidenceKeyError()
  const nonce = randomBytes(NONCE_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  cipher.setAAD(ENVELOPE)
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()])
  return Buffer.concat([ENVELOPE, nonce, ciphertext, cipher.getAuthTag()])
}

export function openEvidence(key, encoded) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) throw new EvidenceKeyError()
  const start = ENVELOPE.length + NONCE_LENGTH
  if (
    !Buffer.isBuffer(encoded) ||
    encoded.length < start + TAG_LENGTH ||
    !encoded.subarray(0, ENVELOPE.length).equals(ENVELOPE)
  ) {
    throw new Error('invalid encrypted evidence envelope')
  }
  const nonce = encoded.subarray(ENVELOPE.length, start)
  const tag = encoded.subarray(encoded.length - TAG_LENGTH)
  const ciphertext = encoded.subarray(start, encoded.length - TAG_LENGTH)

  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAAD(ENVELOPE)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

export const EVIDENCE_FORMAT = Object.freeze({ ENVELOPE, NONCE_LENGTH, TAG_LENGTH, KEY_LENGTH })
