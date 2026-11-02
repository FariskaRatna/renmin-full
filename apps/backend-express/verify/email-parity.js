#!/usr/bin/env node
/**
 * Membuktikan isi email notifikasi Express identik byte-per-byte dengan Go.
 *
 * Kenapa perlu alat sendiri: worker outbox **tidak tersentuh harness sama
 * sekali**. Harness membandingkan respons HTTP, sedangkan worker tidak punya
 * endpoint — ia ticker yang membaca tabel dan berbicara ke SMTP. Jadi satu-
 * satunya keluaran yang bisa salah tanpa ketahuan adalah isi emailnya sendiri,
 * dan itu justru yang dibaca pengguna.
 *
 * Yang dibandingkan hanya BADAN pesannya (teks polos dan HTML). Amplop MIME
 * sengaja tidak: boundary-nya acak dan header Date berisi jam saat itu, jadi
 * perbandingan byte mustahil. Perbedaan amplop sudah tercatat sebagai D2 di
 * DEVIATIONS.md dan memang diterima.
 *
 * Jalankan: node verify/email-parity.js   (butuh Docker)
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildNotificationHtml, buildNotificationPlainText } from '../src/auth/mailer.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../..')
const GO_BACKEND = resolve(REPO_ROOT, 'apps/backend')
const GO_IMAGE = 'golang:1.27.2-alpine3.24'

const FROM = 'no-reply@siera.example'
const TO = 'penerima@siera.example'

/**
 * Kelima pesan disposisi ditambah pesan surat masuk. Yang terakhir itu
 * satu-satunya yang mengubah arah navigasi (URMIN > Surat Masuk > Inbox),
 * jadi tanpa ia cabang R5F22 tidak pernah teruji.
 */
const CASES = [
  ['assigned', 'Tugas Baru - SIERA DELTA LIMA', 'Anda menerima penugasan disposisi baru.'],
  ['forwarded', 'Tugas Diteruskan - SIERA DELTA LIMA', 'Ada penugasan disposisi yang diteruskan kepada Anda.'],
  ['completed', 'Tugas Selesai - SIERA DELTA LIMA', 'Hasil pekerjaan telah disampaikan dan menunggu pemeriksaan Anda.'],
  ['review_approved', 'Hasil Disetujui - SIERA DELTA LIMA', 'Hasil pekerjaan Anda telah disetujui.'],
  ['review_revision', 'Perlu Perbaikan - SIERA DELTA LIMA', 'Hasil pekerjaan Anda memerlukan tindak lanjut. Periksa catatan pemeriksaan di aplikasi.'],
  [
    'intake (R5F22)',
    'Surat Masuk Baru - SIERA DELTA LIMA',
    'Ada Surat Masuk baru yang memerlukan arahan atau disposisi Anda. Silakan login, kemudian buka URMIN > Surat Masuk > Inbox.',
  ],
  // Subjek tanpa akhiran baku: menguji fallback judul "Pemberitahuan Tugas".
  ['fallback judul', 'Pemberitahuan', 'Badan pesan uji fallback.'],
  // Karakter yang di-escape html.EscapeString. Tidak pernah muncul pada pesan
  // nyata, tapi kalau suatu saat muncul, escaping-nya harus sama persis.
  ['escaping HTML', 'Uji Escape - SIERA DELTA LIMA', 'Tanda <kurung> & "kutip" serta \'apostrof\'.'],
]

function runGo(commands) {
  const input = `${commands.map((c) => c.join('\t')).join('\n')}\n`
  const stdout = execFileSync(
    'docker',
    [
      'run', '--rm', '-i',
      '-v', `${GO_BACKEND}:/src:ro`,
      '-v', `${HERE}:/work:ro`,
      // Cache modul Go disimpan di volume bernama. Tanpa ini setiap jalan
      // mengunduh ulang seluruh dependensi, dan proxy.golang.org cukup sering
      // memutus unduhan di tengah ("unexpected EOF") sehingga alat ini gagal
      // karena jaringan, bukan karena paritasnya.
      '-v', 'sdl_verify_gomodcache:/go/pkg/mod',
      '-e', 'GOTOOLCHAIN=local',
      '-e', 'GOFLAGS=-mod=mod',
      GO_IMAGE,
      'sh', '-ec',
      // Shim disalin ke dalam paket auth pada SALINAN source, supaya
      // buildNotificationEmail yang tidak diekspor tetap bisa dipanggil.
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
    .filter((line) => line.includes('\t'))
    .map((line) => line.slice(line.indexOf('\t') + 1).trim())
}

/** Decode quoted-printable: soft line break dulu, baru oktet ber-escape. */
function decodeQuotedPrintable(text) {
  const withoutSoftBreaks = text.replace(/=\r?\n/g, '')
  const bytes = []
  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    const char = withoutSoftBreaks[i]
    if (char === '=' && i + 2 < withoutSoftBreaks.length) {
      bytes.push(parseInt(withoutSoftBreaks.slice(i + 1, i + 3), 16))
      i += 2
      continue
    }
    bytes.push(char.charCodeAt(0))
  }
  // Go menormalkan teks ke LF sebelum encode; writer QP yang memakai CRLF di
  // kabel. Dikembalikan ke LF supaya sebanding dengan string sumber di Node.
  return Buffer.from(bytes).toString('utf8').replace(/\r\n/g, '\n')
}

/** Membongkar multipart/alternative menjadi [teks polos, html]. */
function splitParts(message) {
  const boundary = /boundary="?([^"\r\n;]+)"?/.exec(message)
  if (!boundary) throw new Error('boundary tidak ditemukan di header')
  const chunks = message.split(`--${boundary[1]}`)
  const bodies = []
  for (const chunk of chunks) {
    const separator = chunk.indexOf('\r\n\r\n')
    if (separator < 0) continue
    const headers = chunk.slice(0, separator)
    if (!headers.includes('Content-Type: text/')) continue
    bodies.push(decodeQuotedPrintable(chunk.slice(separator + 4).replace(/\r\n$/, '')))
  }
  if (bodies.length !== 2) throw new Error(`diharapkan 2 bagian, dapat ${bodies.length}`)
  return bodies
}

process.stdout.write('Paritas isi email notifikasi Node <-> Go\n\n')
process.stdout.write('Menjalankan buildNotificationEmail Go di container...\n\n')

const replies = runGo(CASES.map(([, subject, body]) => ['notif', FROM, TO, subject, body]))

let failed = 0
for (let i = 0; i < CASES.length; i++) {
  const [label, subject, body] = CASES[i]
  if (replies[i].startsWith('ERROR')) {
    failed++
    process.stdout.write(`  GAGAL  ${label}\n      go   : ${replies[i]}\n`)
    continue
  }
  const [goPlain, goHtml] = splitParts(Buffer.from(replies[i], 'hex').toString('utf8'))

  for (const [part, expected, actual] of [
    ['teks polos', goPlain, buildNotificationPlainText(subject, body)],
    ['html', goHtml, buildNotificationHtml(subject, body)],
  ]) {
    const ok = expected === actual
    if (!ok) failed++
    process.stdout.write(`  ${ok ? 'LULUS' : 'GAGAL'}  ${label} / ${part}\n`)
    if (!ok) {
      process.stdout.write(`      go   : ${JSON.stringify(expected)}\n`)
      process.stdout.write(`      node : ${JSON.stringify(actual)}\n`)
    }
  }
}

const total = CASES.length * 2
process.stdout.write(`\n${'='.repeat(60)}\n`)
if (failed === 0) {
  process.stdout.write(`PARITAS EMAIL LULUS — ${total}/${total} bagian byte identik.\n`)
  process.exit(0)
}
process.stdout.write(`PARITAS EMAIL GAGAL — ${failed} dari ${total} bagian berbeda.\n`)
process.exit(1)
