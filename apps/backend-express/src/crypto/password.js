import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Algorithm, Version, hashRaw } from '@node-rs/argon2'

/**
 * Argon2id, kompatibel byte-per-byte dengan apps/backend/internal/auth/password.go.
 *
 * Ini bagian paling tidak bisa diperbaiki di seluruh migrasi. Password yang
 * tersimpan tidak dapat dipulihkan: kalau parameter atau encoding meleset,
 * SELURUH user existing terkunci permanen dan satu-satunya jalan adalah reset
 * massal lewat reset-all-passwords.sh.
 *
 * Parameter diambil dari password.go:16-19 dan TIDAK boleh diubah:
 *   time=3, memory=64 MiB (65536 KiB), threads=2, keyLen=32, salt=16 byte
 *
 * Encoding mengikuti password.go:31 — base64 RawStdEncoding, yaitu alfabet
 * standar (+/) TANPA padding '='. Buffer.toString('base64') di Node selalu
 * menambahkan padding, jadi harus dipangkas manual. Memakai 'base64url'
 * SALAH: alfabetnya -_ dan menghasilkan string berbeda.
 */
const MEMORY_COST = 65536
const TIME_COST = 3
const PARALLELISM = 2
const KEY_LENGTH = 32
const SALT_LENGTH = 16

// Batas yang diterima verifier Go (password.go:61). Nilai di luar rentang ini
// ditolak, sebagai pertahanan terhadap parameter yang dikendalikan penyerang.
const MEMORY_MIN = 32768
const MEMORY_MAX = 131072
const TIME_MIN = 1
const TIME_MAX = 5
const THREADS_MIN = 1
const THREADS_MAX = 4

function encodeRawStd(buffer) {
  return buffer.toString('base64').replace(/=+$/, '')
}

function decodeRawStd(value) {
  return Buffer.from(value, 'base64')
}

async function derive(password, salt, memoryCost, timeCost, parallelism) {
  return hashRaw(password, {
    algorithm: Algorithm.Argon2id,
    version: Version.V0x13,
    memoryCost,
    timeCost,
    parallelism,
    outputLen: KEY_LENGTH,
    salt,
  })
}

/** Padanan auth.HashPassword. Menghasilkan string PHC yang diterima Go. */
export async function hashPassword(password) {
  // BYTE, bukan panjang string. `len()` Go menghitung byte UTF-8; `.length`
  // JavaScript menghitung unit UTF-16. Untuk password ber-karakter non-ASCII
  // keduanya BERBEDA, dan arah selisihnya berbahaya di dua ujung: password
  // 13 karakter beraksen (26 byte) diterima Go tapi ditolak di sini, dan
  // password 200 karakter beraksen (400 byte) diterima di sini tapi ditolak
  // Go. Keduanya hanya muncul pada masukan non-ASCII, jadi tidak pernah
  // terlihat harness — yang seluruh fixture-nya ASCII.
  const bytes = typeof password === 'string' ? Buffer.byteLength(password, 'utf8') : 0
  if (typeof password !== 'string' || bytes < 14 || bytes > 256) {
    throw new Error('password length outside policy')
  }
  const salt = randomBytes(SALT_LENGTH)
  const hash = await derive(password, salt, MEMORY_COST, TIME_COST, PARALLELISM)
  return `$argon2id$v=19$m=${MEMORY_COST},t=${TIME_COST},p=${PARALLELISM}$${encodeRawStd(salt)}$${encodeRawStd(hash)}`
}

/**
 * Padanan auth.VerifyPassword. Mengembalikan false untuk encoding apa pun yang
 * tidak dikenali — tidak pernah melempar, supaya pemanggil tidak bisa
 * membedakan "hash rusak" dari "password salah" lewat alur error.
 */
export async function verifyPassword(encoded, password) {
  if (typeof encoded !== 'string' || typeof password !== 'string') return false

  // Go memecah dengan strings.Split(encoded, "$") dan menuntut 6 bagian dengan
  // bagian pertama kosong — artinya string wajib diawali '$'.
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== '' || parts[1] !== 'argon2id' || parts[2] !== 'v=19') {
    return false
  }

  const params = parts[3].split(',')
  if (params.length !== 3) return false
  const expectedKeys = ['m', 't', 'p']
  const values = []
  for (let i = 0; i < 3; i++) {
    const pair = params[i].split('=')
    if (pair.length !== 2 || pair[0] !== expectedKeys[i]) return false
    if (!/^\d+$/.test(pair[1])) return false
    values.push(Number(pair[1]))
  }
  const [memory, timeCost, threads] = values

  if (
    memory < MEMORY_MIN || memory > MEMORY_MAX ||
    timeCost < TIME_MIN || timeCost > TIME_MAX ||
    threads < THREADS_MIN || threads > THREADS_MAX
  ) {
    return false
  }

  const salt = decodeRawStd(parts[4])
  if (salt.length !== SALT_LENGTH) return false
  const want = decodeRawStd(parts[5])
  if (want.length !== KEY_LENGTH) return false

  let got
  try {
    got = await derive(password, salt, memory, timeCost, threads)
  } catch {
    return false
  }
  return got.length === want.length && timingSafeEqual(got, want)
}

export const PASSWORD_PARAMS = Object.freeze({
  MEMORY_COST,
  TIME_COST,
  PARALLELISM,
  KEY_LENGTH,
  SALT_LENGTH,
})
