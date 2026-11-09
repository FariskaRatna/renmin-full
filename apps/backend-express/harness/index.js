import { loadConfig } from './config.js'
import { HarnessDb } from './db.js'
import { ALL_ACTORS, buildActors } from './actors.js'
import { assertRegistryComplete, classify, REGISTRY, VARIANTS } from './registry.js'
import { buildCases, runCapture, runCompare, writeSummary } from './run.js'
import { seedDocuments } from './seed-documents.js'

function usage() {
  process.stderr.write(
    [
      'Pemakaian: node harness/index.js <capture|compare|list|seed-docs>',
      '',
      '  capture    panggil tiap endpoint dan simpan respons sebagai golden file',
      '  compare    panggil tiap endpoint dan bandingkan dengan golden file',
      '  list       tampilkan rencana kasus tanpa menyentuh backend',
      '  seed-docs  KOSONGKAN tabel dokumen lalu isi ulang dengan data tetap',
      '',
      'seed-docs bersifat merusak dan harus dijalankan SEBELUM capture dan lagi',
      'SEBELUM compare: kasus mutating mengubah baris, jadi kedua backend harus',
      'berangkat dari keadaan yang sama. Tabel identitas tidak disentuh.',
      '',
      'Env:',
      '  DATABASE_URL                    wajib',
      '  SDL_HARNESS_API_BASE            default http://api:8080',
      '  SDL_HARNESS_ORIGIN              default http://127.0.0.1:5174',
      '  SDL_HARNESS_TARGET              label backend (go|express)',
      '  SDL_HARNESS_ALLOW_MUTATIONS     "true" untuk menjalankan kasus mutating',
      '  SDL_EVIDENCE_KEY                wajib untuk seed-docs (64 hex)',
      '',
    ].join('\n'),
  )
  process.exit(2)
}

function printPlan() {
  const byMount = new Map()
  const bySafety = new Map()
  for (const endpoint of REGISTRY) {
    byMount.set(endpoint.mount, (byMount.get(endpoint.mount) ?? 0) + 1)
    const safety = classify(endpoint)
    bySafety.set(safety, (bySafety.get(safety) ?? 0) + 1)
  }
  process.stdout.write(`Registry: ${REGISTRY.length} endpoint\n\nPer mount:\n`)
  for (const [mount, count] of [...byMount].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(count).padStart(3)}  ${mount}\n`)
  }
  process.stdout.write('\nPer kelas keamanan:\n')
  for (const [safety, count] of [...bySafety].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(count).padStart(3)}  ${safety}\n`)
  }

  // Cakupan jalur tulis harus terbaca sebagai angka tersendiri. Tanpa ini,
  // "331 kasus, 0 dilewati" terbaca seolah mutasi ikut teruji padahal tidak.
  process.stdout.write(`\nVarian jalur sukses (fase tulis, dijalankan paling akhir): ${VARIANTS.length}\n`)
  if (VARIANTS.length === 0) {
    process.stdout.write('  belum ada — seluruh POST/PATCH masih berhenti di validasi 400\n')
    return
  }
  const variantsByMount = new Map()
  for (const variant of VARIANTS) {
    if (!variantsByMount.has(variant.mount)) variantsByMount.set(variant.mount, [])
    variantsByMount.get(variant.mount).push(`${variant.n}:${variant.variant}`)
  }
  for (const [mount, list] of [...variantsByMount].sort()) {
    process.stdout.write(`  ${mount}\n    ${list.join(', ')}\n`)
  }
}

async function main() {
  const command = process.argv[2]
  if (!command || !['capture', 'compare', 'list', 'seed-docs'].includes(command)) usage()

  assertRegistryComplete()

  if (command === 'list') {
    printPlan()
    return
  }

  if (command === 'seed-docs') {
    const { databaseUrl } = loadConfig()
    // Kunci bukti wajib ada. Bukti plaintext tidak pernah sah, jadi lebih baik
    // seed gagal terang-terangan daripada menanam baris yang tidak bisa dibuka.
    const raw = (process.env.SDL_EVIDENCE_KEY ?? '').trim()
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error('SDL_EVIDENCE_KEY harus 64 hex; seed-docs menanam bukti terenkripsi.')
    }
    process.stdout.write('Mengosongkan tabel dokumen dan menanam data tetap...\n')
    const result = await seedDocuments(databaseUrl, Buffer.from(raw, 'hex'))
    process.stdout.write(
      `Selesai. ${result.tables} tabel dokumen direset, fixture deterministik siap.\n` +
      `         ${result.grantedPermissions} permission role ditambahkan (khusus harness, bukan konfigurasi produksi).\n` +
      'Jalankan lagi sebelum compare supaya kedua backend berangkat dari keadaan sama.\n',
    )
    return
  }

  const config = loadConfig()
  process.stdout.write(
    `Target   : ${config.target} (${config.apiBase})\n` +
      `Origin   : ${config.origin}\n` +
      `Mutasi   : ${config.allowMutations ? 'DIIZINKAN — database akan berubah' : 'dimatikan'}\n` +
      `Golden   : ${config.goldenDir}\n\n`,
  )

  const db = new HarnessDb(config.databaseUrl)
  let exitCode = 0

  try {
    await db.ping()

    // Preflight: backend hidup? /healthz tidak lewat /api, jadi ia juga
    // membuktikan harness menembak API langsung, bukan lewat proxy Vite.
    const health = await fetch(`${config.apiBase}/healthz`).catch(() => undefined)
    if (!health || !health.ok) {
      throw new Error(
        `backend tidak menjawab di ${config.apiBase}/healthz. ` +
          'Jalankan harness di dalam network Docker (lihat infra/compose.harness.yaml).',
      )
    }

    if (config.allowMutations) {
      const cleared = await db.clearMustChangePassword()
      if (cleared > 0) {
        process.stdout.write(
          `Preflight: must_change_password dibersihkan untuk ${cleared} akun non-Superadmin.\n` +
            '           Tanpa ini semua endpoint operasional menjawab 403 dan golden file salah.\n\n',
        )
      }
    }

    process.stdout.write('Memuat fixture dari database...\n')
    const fixtures = await db.loadFixtures()
    process.stdout.write(`  ${Object.keys(fixtures).length} fixture ditemukan\n\n`)

    process.stdout.write('Membangun sesi aktor...\n')
    const actors = await buildActors(config, db, ALL_ACTORS)
    for (const actor of actors.values()) {
      process.stdout.write(`  ${actor.available ? 'ok  ' : 'LEWAT'} ${actor.key} — ${actor.reason}\n`)
    }
    process.stdout.write('\n')

    const { cases, skipped } = buildCases(fixtures, actors, config)
    process.stdout.write(`Rencana: ${cases.length} kasus dijalankan, ${skipped.length} dilewati\n\n`)

    if (command === 'capture') {
      const summary = await runCapture(config, cases, skipped, actors)
      await writeSummary(config, summary)
      process.stdout.write(
        `\nSelesai. ${summary.casesRun} kasus direkam, ` +
          `${summary.endpointsTouched}/${summary.totalEndpoints} endpoint tersentuh.\n`,
      )
    } else {
      const { summary, mismatches } = await runCompare(config, cases, skipped, actors)
      await writeSummary(config, summary, mismatches)
      if (mismatches.length > 0) {
        process.stdout.write(`\n${mismatches.length} perbedaan:\n`)
        for (const mismatch of mismatches.slice(0, 40)) {
          process.stdout.write(
            `  ${mismatch.caseId} · ${mismatch.field}\n` +
              `      golden : ${JSON.stringify(mismatch.expected)}\n` +
              `      aktual : ${JSON.stringify(mismatch.actual)}\n`,
          )
        }
        if (mismatches.length > 40) {
          process.stdout.write(`  ... ${mismatches.length - 40} lagi di golden/_summary.json\n`)
        }
        exitCode = 1
      } else {
        process.stdout.write(`\nSemua ${summary.casesRun} kasus cocok dengan golden file.\n`)
      }
    }

    if (skipped.length > 0) {
      // Cakupan yang hilang harus terlihat. Harness yang diam soal ini
      // terbaca seolah sudah menguji segalanya.
      process.stdout.write(`\n${skipped.length} kasus dilewati (rincian di golden/_summary.json):\n`)
      const reasons = new Map()
      for (const entry of skipped) reasons.set(entry.reason, (reasons.get(entry.reason) ?? 0) + 1)
      for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
        process.stdout.write(`  ${String(count).padStart(3)}  ${reason}\n`)
      }
    }
  } catch (error) {
    process.stderr.write(`\nGAGAL: ${error.message}\n`)
    exitCode = 1
  } finally {
    await db.revokeMintedSessions().catch(() => undefined)
    await db.close().catch(() => undefined)
  }

  process.exit(exitCode)
}

await main()
