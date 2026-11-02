#!/usr/bin/env node
/**
 * Memverifikasi D4: format dan PRESISI timestamp Go lawan Express, di kabel.
 *
 * Kenapa harness tidak bisa melakukannya. `Normalizer` mengganti setiap
 * timestamp dengan `<timestamp>` sebelum membandingkan — itu memang perlu,
 * karena capture dan compare berjalan pada detik yang berbeda. Tapi
 * konsekuensinya satu kelas perbedaan menjadi TIDAK TERLIHAT selamanya:
 * `2026-11-01T03:33:05.780192Z` dan `2026-11-01T03:33:05.780Z` dinormalkan ke
 * placeholder yang sama. Alat ini membandingkan byte MENTAH, tanpa normalisasi.
 *
 * Yang dibandingkan hanya endpoint BACA yang isinya murni dari database, jadi
 * selisih apa pun pasti berasal dari serialisasi — bukan dari waktu permintaan.
 *
 * JALANKAN SESUDAH `harness seed-docs`, bukan sesudah `capture`/`compare`.
 * Kasus dasar endpoint 24 adalah `DELETE /unit-work/{unit}/records/{id}` atas
 * fixture `unitWorkRecordId`, jadi satu run harness penuh MENGHAPUS record yang
 * di-probe di sini. Probe-nya lalu 404 di kedua backend — bukan selisih
 * timestamp, hanya cakupan yang hilang. Status non-200 yang SAMA di kedua sisi
 * karena itu dilaporkan sebagai LEWAT, bukan sebagai kegagalan; yang menjadi
 * kegagalan hanyalah status yang BERBEDA antara keduanya.
 *
 * Jalankan:
 *   docker compose --env-file .env -f infra/compose.dev.yaml \
 *     -f infra/compose.harness.yaml run --rm harness seed-docs
 *   docker compose --env-file .env -f infra/compose.dev.yaml \
 *     -f infra/compose.express.yaml -f infra/compose.harness.yaml \
 *     run --rm --build --entrypoint node harness verify/timestamp-parity.js
 */
import { HttpClient } from '../harness/client.js'
import { HarnessDb } from '../harness/db.js'

const GO_BASE = process.env.SDL_VERIFY_GO_BASE ?? 'http://api:8080'
const EXPRESS_BASE = process.env.SDL_VERIFY_EXPRESS_BASE ?? 'http://api-express:8080'
const ORIGIN = process.env.SDL_HARNESS_ORIGIN ?? 'http://127.0.0.1:5174'

/**
 * Hanya endpoint baca yang seluruh isinya berasal dari baris database.
 *
 * Yang SENGAJA tidak dipakai: `/urmin/dispositions/leadership` (memuat
 * `updatedAt` dari jam permintaan) dan `/admin/audit` (append-only, dua
 * pembacaan bisa berbeda isinya secara sah). Keduanya akan menghasilkan
 * selisih yang benar tapi tidak ada hubungannya dengan D4.
 */
const PROBES = [
  { label: 'dispositions (acceptedAt/completedAt dari now())', actor: 'op-subbagren', path: '/api/v1/urmin/dispositions/' },
  { label: 'unit-work detail (+ event jam dinding)', actor: 'ka-urmin', path: '/api/v1/unit-work/urmin/records/{unitWorkRecordId}' },
  { label: 'urmin registry list', actor: 'ka-urmin', path: '/api/v1/urmin/registry/?kind=surat_keluar' },
  { label: 'surat masuk list', actor: 'ka-urmin', path: '/api/v1/urmin/surat-masuk/' },
  { label: 'usulan list', actor: 'kasubbagren', path: '/api/v1/subbagren/usulan/' },
  // Tidak memuat satu timestamp pun (seluruhnya angka agregat dan tanggal
  // ber-cast ::text). Dibiarkan sebagai penjaga: kalau suatu saat ringkasan
  // anggaran mulai mengembalikan timestamp, ia langsung ikut terbanding.
  { label: 'budget ringkasan', actor: 'kasubbagren', path: '/api/v1/subbagren/budget/?year=2026' },
]

/**
 * Timestamp yang nilainya diambil dari JAM SERVER, bukan dari baris database.
 *
 * Ketiganya mustahil dibandingkan byte per byte: dua pembacaan pada detik yang
 * berbeda memang HARUS berbeda. Yang bisa — dan harus — sama adalah BENTUKNYA,
 * dan di situlah D4 sempat tertinggal: Go memakai RFC3339Nano yang memotong nol
 * di belakang, sedangkan `Date.toJSON()` selalu menulis tepat tiga desimal.
 *
 * Presisinya sendiri tetap berbeda dan itu tidak bisa diperbaiki — Go
 * nanodetik, Node milidetik — jadi yang diuji hanya aturan formatnya:
 * berakhiran Z, dan kalau ada pecahan detik maka digit terakhirnya bukan nol.
 */
const CLOCK_PROBES = [
  {
    label: 'executive overview generatedAt',
    actor: 'kabagrenmin',
    path: '/api/v1/executive/v2/overview?period=90d',
    field: 'generatedAt',
  },
  {
    label: 'dispositions leadership updatedAt',
    actor: 'kabagrenmin',
    path: '/api/v1/urmin/dispositions/leadership',
    field: 'updatedAt',
  },
]

/** Aturan format RFC3339Nano Go: tanpa pecahan, atau pecahan tanpa nol di ekor. */
const GO_RFC3339NANO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{0,8}[1-9])?Z$/

/** Semua string berbentuk waktu, beserta jalur JSON-nya. */
const TIMESTAMPISH = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

function collectTimestamps(value, path, out) {
  if (typeof value === 'string') {
    if (TIMESTAMPISH.test(value)) out.push([path, value])
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectTimestamps(item, `${path}[${i}]`, out))
    return
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) collectTimestamps(value[key], path ? `${path}.${key}` : key, out)
  }
}

async function main() {
  const db = new HarnessDb(process.env.DATABASE_URL)
  const fixtures = await db.loadFixtures()

  const clientConfig = (apiBase) => ({ apiBase, origin: ORIGIN, requestTimeoutMs: 20000 })
  let differing = 0
  let compared = 0
  let skippedProbes = 0
  const samples = []

  process.stdout.write('Paritas presisi timestamp Go <-> Express (byte mentah, tanpa normalisasi)\n\n')

  try {
    for (const probe of PROBES) {
      const userId = await db.userIdByUsername(probe.actor)
      if (!userId) {
        process.stdout.write(`  LEWAT  ${probe.label} — akun ${probe.actor} tidak ada\n`)
        continue
      }
      // Satu token dipakai kedua klien: sesi ada di database, jadi backend mana
      // pun menerimanya. Dengan begitu yang dibandingkan benar-benar hanya
      // serialisasi, bukan perbedaan status login.
      const token = await db.mintSession(userId)

      let path = probe.path
      let missing
      for (const [, key] of path.matchAll(/\{(\w+)\}/g)) {
        if (!fixtures[key]) { missing = key; break }
        path = path.replace(`{${key}}`, encodeURIComponent(fixtures[key]))
      }
      if (missing) {
        process.stdout.write(`  LEWAT  ${probe.label} — fixture ${missing} tidak ada\n`)
        continue
      }

      const bodies = {}
      for (const [name, base] of [['go', GO_BASE], ['express', EXPRESS_BASE]]) {
        const client = new HttpClient(clientConfig(base))
        client.setCookie('sdl_session', token)
        const response = await client.request('GET', path)
        if (response.status !== 200) {
          bodies[name] = { error: `HTTP ${response.status}` }
          continue
        }
        bodies[name] = { text: Buffer.from(response.bytes).toString('utf8') }
      }

      if (bodies.go.error || bodies.express.error) {
        // Status yang SAMA di kedua backend bukan selisih timestamp — ia cuma
        // berarti probe-nya tidak menemukan data. Penyebab yang paling sering:
        // alat ini dijalankan sesudah run harness, yang kasus dasar 24-nya
        // menghapus `unitWorkRecordId`. Dilaporkan sebagai cakupan yang hilang,
        // bukan sebagai kegagalan paritas — melaporkannya sebagai D4 GAGAL
        // membuat orang mengejar bug yang tidak ada.
        if (bodies.go.error === bodies.express.error) {
          skippedProbes++
          process.stdout.write(
            `  LEWAT  ${probe.label} — ${bodies.go.error} di KEDUA backend;` +
            ' jalankan `harness seed-docs` lebih dulu\n',
          )
          continue
        }
        compared++
        differing++
        process.stdout.write(`  GAGAL  ${probe.label} — go:${bodies.go.error ?? 'ok'} express:${bodies.express.error ?? 'ok'}\n`)
        continue
      }

      const goStamps = []
      const expressStamps = []
      collectTimestamps(JSON.parse(bodies.go.text), '', goStamps)
      collectTimestamps(JSON.parse(bodies.express.text), '', expressStamps)

      // Dipasangkan lewat JALUR JSON, bukan lewat urutan kemunculan. Keduanya
      // tidak sama: Go menyerialkan map dengan kunci TERURUT ABJAD sementara
      // Express mengikuti urutan penulisan objek literal, jadi `record` dan
      // `files` bisa bertukar tempat. Pemasangan per-indeks melaporkan itu
      // sebagai dua timestamp berbeda padahal nilainya identik — dan urutan
      // kunci bukan yang sedang diuji di sini (harness pun mengabaikannya,
      // karena ia membandingkan objek hasil parse).
      const expressByPath = new Map(expressStamps)
      let mismatched = 0
      const paths = new Set([...goStamps.map(([p]) => p), ...expressStamps.map(([p]) => p)])
      const goByPath = new Map(goStamps)
      for (const path of paths) {
        compared++
        const go = goByPath.get(path)
        const express = expressByPath.get(path)
        if (go === express) continue
        mismatched++
        if (samples.length < 12) samples.push({ probe: probe.label, path, go, express })
      }
      if (mismatched > 0) differing += mismatched

      process.stdout.write(
        `  ${mismatched === 0 ? 'LULUS' : 'BEDA '}  ${probe.label} — ${paths.size} timestamp, ${mismatched} berbeda\n`,
      )
    }

    process.stdout.write('\nTimestamp jam-permintaan (bentuknya saja; nilainya memang tidak bisa sama)\n\n')

    for (const probe of CLOCK_PROBES) {
      const userId = await db.userIdByUsername(probe.actor)
      if (!userId) {
        process.stdout.write(`  LEWAT  ${probe.label} — akun ${probe.actor} tidak ada\n`)
        continue
      }
      const token = await db.mintSession(userId)

      const seen = {}
      for (const [name, base] of [['go', GO_BASE], ['express', EXPRESS_BASE]]) {
        const client = new HttpClient(clientConfig(base))
        client.setCookie('sdl_session', token)
        const response = await client.request('GET', probe.path)
        if (response.status !== 200) {
          seen[name] = { error: `HTTP ${response.status}` }
          continue
        }
        const body = JSON.parse(Buffer.from(response.bytes).toString('utf8'))
        seen[name] = { value: body[probe.field] }
      }

      // Aturan yang sama seperti di atas: sepakat-gagal bukan selisih format.
      if (seen.go.error && seen.go.error === seen.express.error) {
        skippedProbes++
        process.stdout.write(`  LEWAT  ${probe.label} — ${seen.go.error} di KEDUA backend\n`)
        continue
      }

      compared++
      const goValue = seen.go.value
      const expressValue = seen.express.value
      const bothOk =
        typeof goValue === 'string' && GO_RFC3339NANO.test(goValue) &&
        typeof expressValue === 'string' && GO_RFC3339NANO.test(expressValue)
      if (!bothOk) {
        differing++
        process.stdout.write(
          `  BEDA   ${probe.label}\n` +
          `           go      : ${seen.go.error ?? JSON.stringify(goValue)}\n` +
          `           express : ${seen.express.error ?? JSON.stringify(expressValue)}\n`,
        )
        continue
      }
      process.stdout.write(`  LULUS  ${probe.label}.${probe.field} — go ${goValue} · express ${expressValue}\n`)
    }
  } finally {
    await db.revokeMintedSessions()
    await db.close()
  }

  if (samples.length > 0) {
    process.stdout.write('\nContoh perbedaan:\n')
    for (const s of samples) {
      process.stdout.write(
        `  ${s.probe}\n    ${s.path}\n      go      : ${s.go ?? '(tidak ada)'}\n      express : ${s.express ?? '(tidak ada)'}\n`,
      )
    }
  }

  process.stdout.write(`\n${'='.repeat(60)}\n`)
  // Probe yang dilewati tidak menggagalkan, tapi ia juga BUKAN bukti. Dicetak
  // terpisah supaya "LULUS" tidak pernah terbaca lebih luas daripada yang
  // benar-benar diperiksa.
  const note = skippedProbes > 0
    ? ` ${skippedProbes} probe dilewati — cakupan sebagian, jalankan ulang sesudah seed-docs.`
    : ''
  if (differing === 0) {
    process.stdout.write(
      `D4 LULUS — ${compared} timestamp diperiksa: yang dari database identik byte per byte, ` +
      `yang dari jam server sama formatnya (presisi tidak bisa disamakan).${note}\n`,
    )
    process.exit(0)
  }
  process.stdout.write(`D4 GAGAL — ${differing} dari ${compared} timestamp berbeda.${note}\n`)
  process.exit(1)
}

await main()
