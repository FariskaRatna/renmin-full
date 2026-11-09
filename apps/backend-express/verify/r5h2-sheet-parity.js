#!/usr/bin/env node
/**
 * Paritas lembar disposisi (R5H2): sheet.js lawan sheet.go yang ASLI.
 *
 * Setiap kasus dijalankan di dua sisi:
 *
 *   input   body JSON {"sheet":...} -> decode strict (DisallowUnknownFields,
 *           termasuk objek bersarang) -> validSheet -> normalizeSheet.
 *           Hasilnya "reject" (400) atau objek ternormalisasi.
 *   stored  isi kolom jsonb -> decodeSheet. Hasilnya "error" (503) atau objek.
 *
 * Yang dibandingkan adalah teks JSON utuh, jadi URUTAN KUNCI ikut diuji --
 * bukan sekadar kesetaraan nilai. Go dijalankan di container golang atas
 * salinan source backend (lih. go-json-parity.js); apps/backend tidak disentuh.
 * Tidak ada database yang disentuh.
 *
 * Jalankan: node verify/r5h2-sheet-parity.js
 *           node verify/r5h2-sheet-parity.js --node-only   (tanpa Docker)
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { decodeTyped } from '../src/modules/directives/shared.js'
import { decodeSheet, normalizeSheet, validDate, validSheet } from '../src/modules/directives/sheet.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../..')
const GO_BACKEND = resolve(REPO_ROOT, 'apps/backend')
const GO_IMAGE = 'golang:1.27.2-alpine3.24'

const base = {
  letterFrom: 'Kapolda Jawa Barat',
  letterNumber: 'B/123/XI/2026',
  directiveDate: '2026-11-04',
  letterDate: '2026-11-01',
  subject: 'Permohonan data anggaran',
  classification: 'biasa',
  derajat: 'kilat',
  dispositions: ['MONITOR', 'ARSIPKAN'],
  dispositionNote: 'Segera tindak lanjuti',
  agendaNo: null,
}
const withSheet = (patch) => JSON.stringify({ sheet: { ...base, ...patch } })
const without = (key) => {
  const copy = { ...base }
  delete copy[key]
  return JSON.stringify({ sheet: copy })
}
const rep = (ch, n) => ch.repeat(n)
const codes = (n) => Array.from({ length: n }, (_, i) => `K${String(i).padStart(2, '0')}`)

/** [label, mode, body, deviasi-yang-diketahui?] */
const CASES = [
  ['lembar lengkap', 'input', withSheet({})],
  ['sheet absen', 'input', JSON.stringify({})],
  ['sheet null', 'input', JSON.stringify({ sheet: null })],
  ['sheet objek kosong (classification jadi "")', 'input', JSON.stringify({ sheet: {} })],
  ['classification absen', 'input', without('classification')],
  ['derajat absen', 'input', without('derajat')],
  ['dispositions absen -> []', 'input', without('dispositions')],
  ['dispositions null -> []', 'input', withSheet({ dispositions: null })],
  ['agendaNo absen', 'input', without('agendaNo')],
  ['teks absen -> ""', 'input', JSON.stringify({ sheet: { classification: 'penting', derajat: 'biasa' } })],
  ['teks null -> ""', 'input', withSheet({ letterFrom: null, subject: null })],
  ['kunci asing di dalam sheet', 'input', withSheet({ extra: 1 })],
  ['kunci asing di luar sheet', 'input', JSON.stringify({ sheet: base, other: 1 })],
  ['kunci ganda: yang terakhir menang', 'input', '{"sheet":{"classification":"x","classification":"biasa","derajat":"biasa"}}'],
  ['sheet berupa array', 'input', JSON.stringify({ sheet: [] })],
  ['sheet berupa string', 'input', JSON.stringify({ sheet: 'x' })],
  ['sheet berupa angka', 'input', JSON.stringify({ sheet: 1 })],
  ['angka untuk teks', 'input', withSheet({ letterFrom: 12 })],
  ['boolean untuk teks', 'input', withSheet({ subject: true })],
  ['objek untuk teks', 'input', withSheet({ subject: {} })],
  ['dispositions berupa string', 'input', withSheet({ dispositions: 'MONITOR' })],
  ['elemen dispositions angka', 'input', withSheet({ dispositions: [1] })],
  ['elemen dispositions null', 'input', withSheet({ dispositions: [null] })],
  ['agendaNo 5', 'input', withSheet({ agendaNo: 5 })],
  ['agendaNo 0', 'input', withSheet({ agendaNo: 0 })],
  ['agendaNo pecahan', 'input', withSheet({ agendaNo: 1.5 })],
  ['agendaNo string', 'input', withSheet({ agendaNo: '1' })],
  ['classification penting', 'input', withSheet({ classification: 'penting' })],
  ['classification rahasia', 'input', withSheet({ classification: 'rahasia' })],
  ['classification huruf besar', 'input', withSheet({ classification: 'Biasa' })],
  ['derajat penting (bukan derajat)', 'input', withSheet({ derajat: 'penting' })],
  ['derajat biasa', 'input', withSheet({ derajat: 'biasa' })],
  ['letterFrom 200 rune emoji', 'input', withSheet({ letterFrom: rep('\u{1F600}', 200) })],
  ['letterFrom 201 rune', 'input', withSheet({ letterFrom: rep('a', 201) })],
  ['letterFrom 199 + 2 spasi (panjang mentah)', 'input', withSheet({ letterFrom: ` ${rep('a', 199)} ` })],
  ['letterNumber 100', 'input', withSheet({ letterNumber: rep('n', 100) })],
  ['letterNumber 101', 'input', withSheet({ letterNumber: rep('n', 101) })],
  ['subject 250', 'input', withSheet({ subject: rep('é', 250) })],
  ['subject 251', 'input', withSheet({ subject: rep('s', 251) })],
  ['dispositionNote 1000', 'input', withSheet({ dispositionNote: rep('x', 1000) })],
  ['dispositionNote 1001', 'input', withSheet({ dispositionNote: rep('x', 1001) })],
  ['tanggal kosong', 'input', withSheet({ directiveDate: '', letterDate: '' })],
  ['2026-02-30', 'input', withSheet({ letterDate: '2026-02-30' })],
  ['2024-02-29 (kabisat)', 'input', withSheet({ letterDate: '2024-02-29' })],
  ['2023-02-29', 'input', withSheet({ letterDate: '2023-02-29' })],
  ['1900-02-29', 'input', withSheet({ letterDate: '1900-02-29' })],
  ['2000-02-29', 'input', withSheet({ letterDate: '2000-02-29' })],
  ['0000-02-29', 'input', withSheet({ letterDate: '0000-02-29' })],
  ['0099-12-31', 'input', withSheet({ letterDate: '0099-12-31' })],
  ['2026-04-31', 'input', withSheet({ directiveDate: '2026-04-31' })],
  ['2026-13-01', 'input', withSheet({ directiveDate: '2026-13-01' })],
  ['2026-00-10', 'input', withSheet({ directiveDate: '2026-00-10' })],
  ['2026-01-00', 'input', withSheet({ directiveDate: '2026-01-00' })],
  ['2026-1-01', 'input', withSheet({ directiveDate: '2026-1-01' })],
  ['RFC3339 penuh', 'input', withSheet({ directiveDate: '2026-11-04T00:00:00Z' })],
  ['angka Arab-Indic', 'input', withSheet({ directiveDate: '٢٠٢٦-01-01' })],
  ['dispositions 20', 'input', withSheet({ dispositions: codes(20) })],
  ['dispositions 21', 'input', withSheet({ dispositions: codes(21) })],
  ['dispositions ganda', 'input', withSheet({ dispositions: ['MONITOR', 'MONITOR'] })],
  ['kode huruf kecil', 'input', withSheet({ dispositions: ['monitor'] })],
  ['kode satu huruf', 'input', withSheet({ dispositions: ['A'] })],
  ['kode diawali angka', 'input', withSheet({ dispositions: ['1A'] })],
  ['kode garis bawah', 'input', withSheet({ dispositions: ['A_1'] })],
  ['kode 24 karakter', 'input', withSheet({ dispositions: [`A${rep('B', 23)}`] })],
  ['kode 25 karakter', 'input', withSheet({ dispositions: [`A${rep('B', 24)}`] })],
  ['kode dengan spasi', 'input', withSheet({ dispositions: [' MONITOR'] })],
  ['kode dengan newline akhir', 'input', withSheet({ dispositions: ['MONITOR\n'] })],
  ['trim spasi/tab/newline', 'input', withSheet({ letterFrom: ' \t\nPolda\r\n ', subject: '  x  ' })],
  ['trim NBSP, U+3000, U+0085', 'input', withSheet({ letterFrom: ' 　\u0085Polda  ' })],
  ['U+FEFF BUKAN spasi bagi Go', 'input', withSheet({ letterFrom: '﻿Polda﻿' })],
  ['U+200B bukan spasi', 'input', withSheet({ subject: '​x​' })],
  ['tanggal TIDAK di-trim', 'input', withSheet({ letterDate: ' 2026-11-01' })],
  ['HTML dan kutip', 'input', withSheet({ subject: '<b>A & B</b> "c"' })],
  // Isinya sama; encoder Go selalu menulis U+2028 sebagai escape, JSON.stringify
  // tidak. Itu sifat writeJson untuk SEMUA endpoint, bukan sheet.js.
  ['U+2028 di dalam teks', 'input', withSheet({ dispositionNote: 'x y' }), 'escape U+2028 oleh encoder Go'],
  ['surrogate tunggal -> U+FFFD', 'input', '{"sheet":{"classification":"biasa","derajat":"biasa","subject":"a\\ud800b"}}'],
  ['kunci beda kapitalisasi', 'input', JSON.stringify({ sheet: { ...base, LetterFrom: 'x', letterFrom: undefined } }), 'kunci tidak peka huruf besar di Go'],

  ['tersimpan lengkap', 'stored', JSON.stringify(normalizeSheet({ ...base, dispositions: base.dispositions }))],
  ['tersimpan urutan kunci acak', 'stored', '{"agendaNo":null,"subject":"s","derajat":"biasa","classification":"biasa","letterFrom":"f","dispositions":["A1"]}'],
  ['tersimpan objek kosong', 'stored', '{}'],
  ['tersimpan kunci asing diabaikan', 'stored', '{"classification":"biasa","bogus":1}'],
  ['tersimpan dispositions null', 'stored', '{"dispositions":null}'],
  ['tersimpan agendaNo 7', 'stored', '{"agendaNo":7}'],
  ['tersimpan agendaNo pecahan', 'stored', '{"agendaNo":7.5}'],
  ['tersimpan tipe salah', 'stored', '{"subject":5}'],
  ['tersimpan dispositions bukan array', 'stored', '{"dispositions":"A"}'],
  ['tersimpan array', 'stored', '[]'],
]

/** Sisi Node: jalur yang sama dengan handler create/putDraft. */
function runNode(mode, body) {
  if (mode === 'input') {
    const req = { rawBodyBuffer: Buffer.from(body, 'utf8') }
    const decoded = decodeTyped(req, { sheet: 'sheet' })
    if (!decoded.ok || !validSheet(decoded.value.sheet)) return 'reject'
    const normalized = normalizeSheet(decoded.value.sheet)
    return `ok\t${normalized === undefined ? 'null' : JSON.stringify(normalized)}`
  }
  try {
    return `ok\t${JSON.stringify(decodeSheet(JSON.parse(body)))}`
  } catch {
    return 'error'
  }
}

function runGo(cases) {
  const dir = mkdtempSync(join(tmpdir(), 'r5h2-'))
  try {
    writeFileSync(join(dir, 'cases.txt'), `${cases.map(([, mode, body]) => `${mode}\t${body}`).join('\n')}\n`)
    const stdout = execFileSync(
      'docker',
      [
        'run', '--rm',
        '-v', `${GO_BACKEND}:/src:ro`,
        '-v', `${HERE}:/work:ro`,
        '-v', `${dir}:/cases:ro`,
        '-e', 'GOTOOLCHAIN=local',
        '-e', 'GOFLAGS=-mod=mod',
        '-e', 'R5H2_CASES=/cases/cases.txt',
        GO_IMAGE,
        'sh', '-ec',
        'cp -r /src /build && cp /work/r5h2_sheet_parity_test.go /build/internal/directives/ && cd /build && go test ./internal/directives/ -run TestR5H2SheetParity -count=1 -v',
      ],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, MSYS_NO_PATHCONV: '1', DOCKER_CONFIG: resolve(REPO_ROOT, 'infra/docker-config') },
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    )
    return stdout.split('\n').filter((line) => line.startsWith('R5H2\t')).map((line) => line.slice(5))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Pemeriksaan murni tanpa Go, untuk --node-only dan sebagai pagar tambahan.
const SELF = [
  ['validDate("")', validDate(''), true],
  ['validDate 2026-02-30', validDate('2026-02-30'), false],
  ['validDate 2024-02-29', validDate('2024-02-29'), true],
  ['validDate 0000-02-29', validDate('0000-02-29'), true],
  ['validSheet(undefined)', validSheet(undefined), true],
]

let failed = 0
process.stdout.write('Paritas lembar disposisi (R5H2) Node <-> Go\n\n')
for (const [label, got, want] of SELF) {
  const ok = got === want
  if (!ok) failed++
  process.stdout.write(`  ${ok ? 'LULUS' : 'GAGAL'}  [node] ${label}\n`)
}

if (process.argv.includes('--node-only')) {
  for (const [label, mode, body] of CASES) {
    process.stdout.write(`  ----   ${label}: ${runNode(mode, body).slice(0, 80)}\n`)
  }
} else {
  process.stdout.write('\nMenjalankan sheet.go di container...\n\n')
  const replies = runGo(CASES)
  if (replies.length !== CASES.length) {
    process.stdout.write(`Jumlah balasan Go ${replies.length}, kasus ${CASES.length}\n`)
    process.exit(2)
  }
  let known = 0
  for (let i = 0; i < CASES.length; i++) {
    const [label, mode, body, deviation] = CASES[i]
    const expected = replies[i]
    const actual = runNode(mode, body)
    const same = expected === actual
    if (deviation) {
      known++
      process.stdout.write(`  ${same ? 'LULUS' : 'DIKETAHUI'}  ${label} (${deviation})\n`)
      if (!same) process.stdout.write(`      go   : ${expected.slice(0, 200)}\n      node : ${actual.slice(0, 200)}\n`)
      continue
    }
    if (!same) failed++
    process.stdout.write(`  ${same ? 'LULUS' : 'GAGAL'}  ${label}\n`)
    if (!same) {
      process.stdout.write(`      go   : ${expected.slice(0, 300)}\n`)
      process.stdout.write(`      node : ${actual.slice(0, 300)}\n`)
    }
  }
  process.stdout.write(`\n${CASES.length - known} kasus dibandingkan, ${known} deviasi yang diketahui dilaporkan terpisah.\n`)
}

process.stdout.write(`\n${'='.repeat(60)}\n`)
if (failed === 0) {
  process.stdout.write('PARITAS R5H2 LULUS.\n')
  process.exit(0)
}
process.stdout.write(`PARITAS R5H2 GAGAL — ${failed} kasus berbeda.\n`)
process.exit(1)
