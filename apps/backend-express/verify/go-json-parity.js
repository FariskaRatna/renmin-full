#!/usr/bin/env node
/**
 * Membuktikan marshalGo() menghasilkan byte yang identik dengan json.Marshal Go.
 *
 * Ini bukan kerapian kosmetik. outgoingContentHash menyimpan SHA-256 dari
 * hasil serialisasi sebagai sidik jari dokumen surat keluar. Selama transisi,
 * surat bisa di-submit lewat Go dan disetujui lewat Express — kalau byte-nya
 * berbeda sedikit saja, setiap surat semacam itu ditolak dengan
 * 409 document_integrity_changed padahal tidak ada yang berubah.
 *
 * Jalankan: node verify/go-json-parity.js
 */
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { marshalGo } from '../src/modules/unitwork/go-json.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../..')
const GO_BACKEND = resolve(REPO_ROOT, 'apps/backend')
const GO_IMAGE = 'golang:1.27.2-alpine3.24'

/**
 * Kasus uji dipilih untuk menyentuh setiap perbedaan yang diketahui antara
 * JSON.stringify dan encoding/json.
 */
const CASES = [
  { label: 'objek sederhana', value: { b: '2', a: '1' } },
  { label: 'urutan kunci terbalik', value: { zebra: 'z', alpha: 'a', mid: 'm' } },
  { label: 'kunci angka dan huruf', value: { '10': 'x', '2': 'y', b: 'z', A: 'w' } },
  { label: 'escape HTML', value: { html: '<b>tebal</b> & "kutip"' } },
  { label: 'ampersand saja', value: { v: 'a&b' } },
  { label: 'kurung sudut saja', value: { v: '<<>>' } },
  { label: 'backslash dan kutip', value: { v: 'c:\\path\\"x"' } },
  { label: 'baris baru dan tab', value: { v: 'baris1\nbaris2\tkolom' } },
  { label: 'karakter kontrol', value: { v: '\u0001\u001f' } },
  { label: 'pemisah baris Unicode', value: { v: 'a\u2028b\u2029c' } },
  { label: 'non-ASCII', value: { v: 'päßwörd — émoji ✓' } },
  { label: 'nilai kosong', value: { a: '', b: null } },
  { label: 'array berurutan', value: { files: [{ id: 'b', sha256: '2' }, { id: 'a', sha256: '1' }] } },
  { label: 'bersarang', value: { outer: { z: { y: 'x' }, a: [1, 2, 3] } } },
  { label: 'boolean dan angka', value: { ok: true, no: false, n: 42, f: 1.5 } },
  { label: 'objek kosong', value: {} },
  { label: 'spasi biasa tidak ter-escape', value: { v: 'a b  c' } },
  {
    label: 'bentuk nyata outgoingContentHash',
    value: {
      code: 'SK/2026/001',
      title: 'Surat <Penting> & Rahasia',
      fields: { tujuan: 'Kapolri', perihal: 'Laporan', nomorSurat: 'B/1/I/2026', sifatSurat: 'biasa' },
      files: [{ id: '0f1e2d3c', sha256: 'abc123' }],
    },
  },
]

function runGo(commands) {
  const input = `${commands.map((c) => c.join('\t')).join('\n')}\n`
  const stdout = execFileSync(
    'docker',
    [
      'run', '--rm', '-i',
      '-v', `${GO_BACKEND}:/src:ro`,
      '-v', `${HERE}:/work:ro`,
      '-e', 'GOTOOLCHAIN=local',
      '-e', 'GOFLAGS=-mod=mod',
      GO_IMAGE,
      'sh', '-ec',
      // Shim ikut disalin walaupun kasus "notif" bukan urusan berkas ini:
      // crosscheck.go satu-satunya dan ia memanggil auth.ExportNotificationEmail,
      // jadi tanpa shim seluruh program gagal kompilasi (lih. email-parity.js).
      'cp -r /src /build && mkdir -p /build/cmd/crosscheck && cp /work/crosscheck.go /build/cmd/crosscheck/ && cp /work/notification-shim.go /build/internal/auth/ && cd /build && go run ./cmd/crosscheck',
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

process.stdout.write('Paritas serialisasi JSON Node <-> Go\n\n')
process.stdout.write('Menjalankan json.Marshal Go di container...\n\n')

// Nilai dikirim sebagai JSON mentah; Go mem-parse-nya ke any lalu
// me-marshal ulang — persis perlakuan yang dialami kolom fields jsonb.
const replies = runGo(CASES.map((testCase) => ['gojson', JSON.stringify(testCase.value)]))

let failed = 0
for (let i = 0; i < CASES.length; i++) {
  const expected = Buffer.from(replies[i], 'hex').toString('utf8')
  const actual = marshalGo(CASES[i].value)
  const ok = expected === actual
  if (!ok) failed++
  process.stdout.write(`  ${ok ? 'LULUS' : 'GAGAL'}  ${CASES[i].label}\n`)
  if (!ok) {
    process.stdout.write(`      go   : ${expected}\n`)
    process.stdout.write(`      node : ${actual}\n`)
  }
}

process.stdout.write(`\n${'='.repeat(60)}\n`)
if (failed === 0) {
  process.stdout.write(`PARITAS JSON LULUS — ${CASES.length}/${CASES.length} byte identik.\n`)
  process.exit(0)
}
process.stdout.write(`PARITAS JSON GAGAL — ${failed} dari ${CASES.length} kasus berbeda.\n`)
process.exit(1)
