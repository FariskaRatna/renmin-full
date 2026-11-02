#!/usr/bin/env node
/**
 * GERBANG TAHAP 1 — paritas kriptografi Node <-> Go.
 *
 * Membuktikan implementasi kripto Express identik dengan Go, DUA ARAH.
 * Satu arah saja tidak cukup: enkripsi dan dekripsi yang sama-sama salah akan
 * lolos uji round-trip sendiri sambil tetap tidak kompatibel dengan data lama.
 *
 * Yang diuji:
 *   1. argon2id  — Node hash -> Go verify, dan Go hash -> Node verify
 *   2. argon2id  — penolakan parameter di luar batas
 *   3. HMAC      — signature(purpose, value) dengan pemisah 0x00
 *   4. AES-GCM   — Node seal -> Go open, dan Go seal -> Node open
 *
 * Sisi Go dijalankan di container golang atas SALINAN source backend; tidak
 * ada berkas yang ditambahkan ke apps/backend.
 *
 * Jalankan: node verify/crypto-parity.js
 * Keluar dengan kode 1 kalau ada satu saja ketidakcocokan.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { hashPassword, verifyPassword } from '../src/crypto/password.js'
import { signature } from '../src/crypto/tokens.js'
import { openEvidence, sealEvidence } from '../src/crypto/evidence.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXPRESS_ROOT = resolve(HERE, '..')
const REPO_ROOT = resolve(EXPRESS_ROOT, '../..')
const GO_BACKEND = resolve(REPO_ROOT, 'apps/backend')
const GO_IMAGE = 'golang:1.27.2-alpine3.24'

const results = []
function check(name, passed, detail = '') {
  results.push({ name, passed, detail })
  process.stdout.write(`  ${passed ? 'LULUS' : 'GAGAL'}  ${name}${detail ? ` — ${detail}` : ''}\n`)
}

/** Mengirim sekumpulan perintah ke alat Go dan mengembalikan barisan jawabannya. */
function runGo(commands) {
  const input = commands.map((c) => c.join('\t')).join('\n') + '\n'
  const stdout = execFileSync(
    'docker',
    [
      'run', '--rm', '-i',
      '-v', `${GO_BACKEND}:/src:ro`,
      '-v', `${HERE}:/work:ro`,
      // Cache modul Go. Tanpa ini setiap jalan mengunduh ulang seluruh
      // dependensi, dan proxy.golang.org cukup sering memutusnya di tengah
      // (`unexpected EOF`) sehingga alat ini gagal karena jaringan, bukan
      // karena paritas. `email-parity.js` sudah memasangnya; di sini sempat
      // terlewat.
      '-v', 'sdl_verify_gomodcache:/go/pkg/mod',
      '-e', 'GOTOOLCHAIN=local',
      '-e', 'GOFLAGS=-mod=mod',
      GO_IMAGE,
      'sh', '-ec',
      // notification-shim.go WAJIB ikut: crosscheck.go memanggil
      // `auth.ExportNotificationEmail` yang hanya ada lewat shim itu, jadi
      // tanpa salinan ini SELURUH alat gagal kompilasi — bukan hanya
      // perintah `notif`-nya. Alat ini sempat tidak bisa dijalankan sama
      // sekali karena itu.
      'cp -r /src /build && mkdir -p /build/cmd/crosscheck' +
        ' && cp /work/crosscheck.go /build/cmd/crosscheck/' +
        ' && cp /work/notification-shim.go /build/internal/auth/' +
        ' && cd /build && go run ./cmd/crosscheck',
    ],
    {
      input,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, DOCKER_CONFIG: resolve(REPO_ROOT, 'infra/docker-config') },
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  )
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.includes('\t'))
    .map((line) => {
      const index = line.indexOf('\t')
      return { kind: line.slice(0, index), value: line.slice(index + 1) }
    })
}

const PASSWORDS = [
  'kata-sandi-uji-silang-2026',
  'Passw0rd!dengan-simbol#$%^&*()_+',
  'päßwörd-ünïcödé-pänjäng-sekali-2026',
]

const SIGN_CASES = [
  ['limit-user', 'superadmin'],
  ['otp', 'ABCdef123:654321'],
  ['challenge', 'Zm9vYmFyYmF6'],
  ['captcha-peer', '172.16.173.34'],
  // Kasus yang membuktikan pemisah 0x00 benar-benar berpengaruh: tanpa pemisah,
  // ("ab","c") dan ("a","bc") menghasilkan HMAC yang sama.
  ['ab', 'c'],
  ['a', 'bc'],
  ['', ''],
  ['purpose-dengan-tab', 'nilai biasa'],
]

async function main() {
  process.stdout.write('GERBANG TAHAP 1 — paritas kripto Node <-> Go\n\n')

  // ---- Siapkan bahan sisi Node ----
  const nodeHashes = []
  for (const password of PASSWORDS) nodeHashes.push(await hashPassword(password))

  const secret = randomBytes(32)
  const evidenceKey = randomBytes(32)
  const plaintext = Buffer.from('bukti keuangan rahasia — baris uji 2026', 'utf8')
  const nodeSealed = sealEvidence(evidenceKey, plaintext)

  // ---- Susun satu batch perintah untuk Go ----
  const commands = []
  for (let i = 0; i < PASSWORDS.length; i++) {
    commands.push(['verify', PASSWORDS[i], nodeHashes[i]])
    commands.push(['verify', `${PASSWORDS[i]}x`, nodeHashes[i]])
  }
  for (const password of PASSWORDS) commands.push(['hash', password])
  for (const [purpose, value] of SIGN_CASES) {
    commands.push(['sign', secret.toString('hex'), purpose, value])
  }
  commands.push(['open', evidenceKey.toString('hex'), nodeSealed.toString('hex')])
  commands.push(['seal', evidenceKey.toString('hex'), plaintext.toString('hex')])

  process.stdout.write('Menjalankan primitif Go di container (unduh dependensi bisa lama)...\n\n')
  const replies = runGo(commands)

  let cursor = 0
  const next = (expectedKind) => {
    const reply = replies[cursor++]
    if (!reply || reply.kind !== expectedKind) {
      throw new Error(`jawaban Go tidak sesuai urutan: menunggu "${expectedKind}", dapat ${JSON.stringify(reply)}`)
    }
    return reply.value
  }

  // ---- 1. argon2id: Node hash -> Go verify ----
  process.stdout.write('1. argon2id — hash buatan Node diverifikasi Go\n')
  for (let i = 0; i < PASSWORDS.length; i++) {
    const ok = next('verify')
    const wrong = next('verify')
    check(
      `Go menerima hash Node #${i + 1}`,
      ok === 'true' && wrong === 'false',
      `benar=${ok} salah=${wrong}`,
    )
  }

  // ---- 2. argon2id: Go hash -> Node verify ----
  process.stdout.write('\n2. argon2id — hash buatan Go diverifikasi Node\n')
  for (let i = 0; i < PASSWORDS.length; i++) {
    const goHash = next('hash')
    const ok = await verifyPassword(goHash, PASSWORDS[i])
    const wrong = await verifyPassword(goHash, `${PASSWORDS[i]}x`)
    const shapeOk = /^\$argon2id\$v=19\$m=65536,t=3,p=2\$[^$]{22}\$[^$]{43}$/.test(goHash)
    check(
      `Node menerima hash Go #${i + 1}`,
      ok === true && wrong === false && shapeOk,
      `benar=${ok} salah=${wrong} bentuk=${shapeOk}`,
    )
  }

  // ---- 3. argon2id: penolakan parameter di luar batas ----
  process.stdout.write('\n3. argon2id — penolakan encoding dan parameter menyimpang\n')
  const base = nodeHashes[0]
  const [, , , , salt, digest] = base.split('$')
  const malformed = [
    ['memory di bawah batas', `$argon2id$v=19$m=16384,t=3,p=2$${salt}$${digest}`],
    ['memory di atas batas', `$argon2id$v=19$m=262144,t=3,p=2$${salt}$${digest}`],
    ['time di atas batas', `$argon2id$v=19$m=65536,t=9,p=2$${salt}$${digest}`],
    ['threads di atas batas', `$argon2id$v=19$m=65536,t=3,p=9$${salt}$${digest}`],
    ['versi salah', `$argon2id$v=16$m=65536,t=3,p=2$${salt}$${digest}`],
    ['algoritma salah', `$argon2i$v=19$m=65536,t=3,p=2$${salt}$${digest}`],
    ['urutan parameter tertukar', `$argon2id$v=19$t=3,m=65536,p=2$${salt}$${digest}`],
    ['salt bukan 16 byte', `$argon2id$v=19$m=65536,t=3,p=2$YWJj$${digest}`],
    ['jumlah bagian kurang', `argon2id$v=19$m=65536,t=3,p=2$${salt}$${digest}`],
  ]
  for (const [label, encoded] of malformed) {
    const accepted = await verifyPassword(encoded, PASSWORDS[0])
    check(`Node menolak: ${label}`, accepted === false)
  }

  // ---- 4. HMAC signature ----
  process.stdout.write('\n4. HMAC — signature(purpose, value) dengan pemisah 0x00\n')
  const nodeSignatures = []
  for (const [purpose, value] of SIGN_CASES) {
    const goValue = next('sign')
    const nodeValue = signature(secret, purpose, value)
    nodeSignatures.push(nodeValue)
    check(`sign("${purpose}", "${value}")`, goValue === nodeValue, goValue === nodeValue ? '' : `go=${goValue} node=${nodeValue}`)
  }
  const abC = nodeSignatures[SIGN_CASES.findIndex(([p, v]) => p === 'ab' && v === 'c')]
  const aBc = nodeSignatures[SIGN_CASES.findIndex(([p, v]) => p === 'a' && v === 'bc')]
  check('pemisah 0x00 membedakan ("ab","c") dari ("a","bc")', abC !== aBc)

  // ---- 5. AES-256-GCM ----
  process.stdout.write('\n5. AES-256-GCM — amplop SDL1 dengan AAD\n')
  const goOpened = next('open')
  check(
    'Go mendekripsi blob buatan Node',
    goOpened === plaintext.toString('hex'),
    goOpened.startsWith('ERROR') ? goOpened : '',
  )

  const goSealedHex = next('seal')
  let nodeOpened
  try {
    nodeOpened = openEvidence(evidenceKey, Buffer.from(goSealedHex, 'hex'))
  } catch (error) {
    nodeOpened = Buffer.from(`ERROR ${error.message}`)
  }
  check('Node mendekripsi blob buatan Go', nodeOpened.equals(plaintext), nodeOpened.toString('utf8').startsWith('ERROR') ? nodeOpened.toString('utf8') : '')

  const goSealed = Buffer.from(goSealedHex, 'hex')
  check('amplop Go diawali "SDL1"', goSealed.subarray(0, 4).toString('ascii') === 'SDL1')
  check(
    'panjang amplop konsisten (4 + 12 + len + 16)',
    goSealed.length === 4 + 12 + plaintext.length + 16,
    `aktual=${goSealed.length} harapan=${4 + 12 + plaintext.length + 16}`,
  )

  // AAD terbukti berpengaruh: mengubah byte amplop harus menggagalkan dekripsi.
  const tampered = Buffer.from(goSealed)
  tampered[3] = 0x32 // "SDL1" -> "SDL2"
  let rejected = false
  try {
    openEvidence(evidenceKey, tampered)
  } catch {
    rejected = true
  }
  check('amplop yang diubah ditolak', rejected)

  const wrongKey = randomBytes(32)
  let wrongKeyRejected = false
  try {
    openEvidence(wrongKey, goSealed)
  } catch {
    wrongKeyRejected = true
  }
  check('kunci salah ditolak', wrongKeyRejected)

  // ---- Ringkasan ----
  const failed = results.filter((r) => !r.passed)
  process.stdout.write(`\n${'='.repeat(60)}\n`)
  if (failed.length === 0) {
    process.stdout.write(`GERBANG TAHAP 1 LULUS — ${results.length}/${results.length} pemeriksaan cocok.\n`)
    process.stdout.write('Hash, HMAC, dan enkripsi bukti kompatibel dua arah dengan Go.\n')
    return 0
  }
  process.stdout.write(`GERBANG TAHAP 1 GAGAL — ${failed.length} dari ${results.length} pemeriksaan tidak cocok:\n`)
  for (const item of failed) process.stdout.write(`  - ${item.name}${item.detail ? ` (${item.detail})` : ''}\n`)
  process.stdout.write('\nJANGAN lanjut ke Tahap 2 sebelum semuanya hijau.\n')
  return 1
}

process.exit(await main())
