import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Normalizer } from './normalize.js'
import { classify, REGISTRY, VARIANTS } from './registry.js'

const CASE_ID_SEPARATOR = '__'

/**
 * Nilai pengganti untuk path param saat fixture belum ada di database.
 *
 * Hanya dipakai oleh aktor anonim. Tanpa sesi, kedua guard menolak di gerbang
 * autentikasi SEBELUM handler sempat mencari record, jadi ID-nya tidak perlu
 * nyata — yang diukur adalah gerbangnya, bukan datanya. Ini membuat baseline
 * anonim mencakup seluruh 142 endpoint walau database masih kosong.
 *
 * Aktor bersesi tetap dilewati kalau fixture tidak ada: bagi mereka ID palsu
 * hanya akan menghasilkan 404 yang tidak mewakili apa pun.
 *
 * Efek samping yang berguna: kalau ada endpoint yang menjawab 404 (bukan 401)
 * untuk ID acak tanpa sesi, itu kebocoran informasi sebelum autentikasi — dan
 * golden file akan merekamnya.
 */
const SYNTHETIC_UUID = '00000000-0000-4000-8000-000000000000'
const SYNTHETIC_BY_KEY = {
  roleKey: 'role-tidak-ada',
  unitKey: 'unit-tidak-ada',
}

function syntheticFor(fixtureKey) {
  return SYNTHETIC_BY_KEY[fixtureKey] ?? SYNTHETIC_UUID
}

function slug(path) {
  return (
    path
      .replace(/^\//, '')
      .replace(/[/]/g, '_')
      .replace(/[{}]/g, '')
      .replace(/[?=&]/g, '-')
      .replace(/[^A-Za-z0-9._-]/g, '') || 'root'
  )
}

/** Perkalian kartesian untuk param enumerasi seperti {unit}. */
function expandLiterals(path, expand) {
  if (!expand) return [path]
  let variants = [path]
  for (const [name, values] of Object.entries(expand)) {
    const next = []
    for (const variant of variants) {
      for (const value of values) next.push(variant.replaceAll(`{${name}}`, value))
    }
    variants = next
  }
  return variants
}

/** Kasus untuk satu entri registry (atau satu varian), seluruh aktor dan ekspansi. */
function casesForEndpoint(endpoint, fixtures, actors, config, cases, skipped) {
  const safety = classify(endpoint)
  // Anonim selalu ikut pada entri dasar: ia memetakan gerbang autentikasi untuk
  // seluruh 142 endpoint tanpa menyentuh data, dan itu baseline paling berharga.
  // Varian tidak — tanpa sesi hasilnya identik dengan entri dasarnya.
  const actorKeys = endpoint.variant ? [...endpoint.actors] : ['anon', ...endpoint.actors]

  for (const literalPath of expandLiterals(endpoint.path, endpoint.expand)) {
    for (const actorKey of actorKeys) {
      const caseId = [
        String(endpoint.n).padStart(3, '0'),
        endpoint.method,
        slug(literalPath),
        actorKey,
        // Hanya varian yang mendapat segmen kelima, sehingga nama berkas golden
        // entri dasar tidak berubah sama sekali.
        ...(endpoint.variant ? [`v-${endpoint.variant}`] : []),
      ].join(CASE_ID_SEPARATOR)

      // Isi path param dari fixture. Anonim boleh memakai nilai sintetis.
      let resolved = literalPath
      let missingFixture
      let synthetic = false
      for (const [param, fixtureKey] of Object.entries(endpoint.params ?? {})) {
        let value = fixtures[fixtureKey]
        if (!value && actorKey === 'anon') {
          value = syntheticFor(fixtureKey)
          synthetic = true
        }
        if (!value) {
          missingFixture = fixtureKey
          break
        }
        resolved = resolved.replaceAll(`{${param}}`, encodeURIComponent(value))
      }

      if (missingFixture) {
        skipped.push({ caseId, n: endpoint.n, reason: `fixture "${missingFixture}" tidak ada di database` })
        continue
      }

      const actor = actors.get(actorKey)
      if (!actor) {
        skipped.push({ caseId, n: endpoint.n, reason: `aktor ${actorKey} tidak dibangun` })
        continue
      }
      if (!actor.available) {
        skipped.push({ caseId, n: endpoint.n, reason: `aktor ${actorKey}: ${actor.reason}` })
        continue
      }

      // Kelas keamanan hanya membatasi aktor bersesi.
      if (actorKey !== 'anon' && safety === 'mutating' && !config.allowMutations) {
        skipped.push({
          caseId,
          n: endpoint.n,
          reason: 'mutating; perlu SDL_HARNESS_ALLOW_MUTATIONS=true pada database sekali pakai',
        })
        continue
      }

      cases.push({ caseId, endpoint, actorKey, safety, path: resolved, synthetic })
    }
  }
}

/**
 * Menyusun daftar kasus yang akan dijalankan, plus daftar yang dilewati
 * beserta alasannya. Keduanya dikembalikan — cakupan yang hilang harus terlihat.
 *
 * Dua fase, dan urutannya menentukan sah atau tidaknya seluruh perbandingan:
 *
 *   1. Entri dasar REGISTRY. Hampir semuanya membaca, atau menulis dengan body
 *      `{}` yang berhenti di validasi — jadi data praktis tidak berubah.
 *   2. VARIANTS, jalur sukses yang benar-benar mengubah baris.
 *
 * Fase tulis ditaruh di belakang supaya efeknya tidak pernah terlihat oleh
 * kasus fase satu. Kalau dicampur, satu create yang berhasil di endpoint 21
 * akan menggeser hitungan di endpoint 77 dan seluruh golden file yang sudah
 * terbukti cocok harus direkam ulang. Dengan pemisahan ini, menambah varian
 * hanya menambah berkas baru.
 */
export function buildCases(fixtures, actors, config) {
  const cases = []
  const writeCases = []
  const skipped = []

  const inScope = (endpoint) =>
    config.onlyMounts.length === 0 || config.onlyMounts.includes(endpoint.mount)

  for (const endpoint of REGISTRY) {
    if (!inScope(endpoint)) continue
    casesForEndpoint(endpoint, fixtures, actors, config, cases, skipped)
  }
  for (const variant of VARIANTS) {
    if (!inScope(variant)) continue
    casesForEndpoint(variant, fixtures, actors, config, writeCases, skipped)
  }

  return { cases: [...cases, ...writeCases], skipped }
}

async function execute(testCase, actor) {
  const endpoint = testCase.endpoint
  const method = endpoint.method
  const normalizer = new Normalizer()
  const needsBody = method !== 'GET'
  const response = await actor.client.request(method, testCase.path, {
    body: needsBody ? (endpoint.body ?? {}) : undefined,
    withCsrf: needsBody,
  })

  // Path dinormalisasi lebih dulu supaya UUID di path dan UUID yang sama di
  // body mendapat placeholder yang sama — relasinya tetap terlihat, sementara
  // golden file berhenti berubah di setiap capture hanya karena ID baru.
  const normalizedPath = testCase.path
    .split('/')
    .map((segment) => normalizer.value(decodeURIComponent(segment)))
    .join('/')

  let body
  if (response.bytes.byteLength === 0) {
    body = null
  } else if (response.isJson) {
    const text = new TextDecoder().decode(response.bytes)
    try {
      body = normalizer.value(JSON.parse(text))
    } catch {
      body = { kind: 'malformed-json', text }
    }
  } else {
    body = normalizer.binary(response.bytes)
  }

  // Daftar yang hanya bertambah (audit log) tidak pernah sama antara capture
  // dan compare, karena run harness itu sendiri ikut menulis ke dalamnya.
  // Yang dibandingkan tinggal bentuknya: jumlah dan isi dibuang, nama field
  // dipertahankan sehingga rename tetap terbaca sebagai perbedaan.
  if (endpoint.appendOnly && body && typeof body === 'object' && !Array.isArray(body)) {
    for (const field of endpoint.appendOnly) {
      const list = body[field]
      if (!Array.isArray(list)) continue
      body[field] = {
        kind: 'append-only',
        fields: list.length > 0 ? Object.keys(list[0]).sort() : [],
      }
    }
  }

  // Daftar yang ORDER BY-nya tidak punya tiebreaker: urutannya ditentukan
  // Postgres secara sembarang saat ada nilai seri, jadi berbeda antar eksekusi
  // pada backend yang SAMA sekalipun. Diurutkan ulang supaya isinya tetap
  // dibanding penuh tanpa urutan ikut dinilai. Lihat DEVIATIONS.md.
  if (endpoint.unordered && body && typeof body === 'object' && !Array.isArray(body)) {
    for (const field of endpoint.unordered) {
      const list = body[field]
      if (!Array.isArray(list)) continue
      body[field] = [...list].sort((a, b) =>
        JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0,
      )
    }
  }

  return {
    n: endpoint.n,
    mount: endpoint.mount,
    method,
    pathTemplate: endpoint.path,
    path: normalizedPath,
    actor: testCase.actorKey,
    safety: testCase.safety,
    ...(endpoint.variant ? { variant: endpoint.variant } : {}),
    status: response.status,
    headers: normalizer.headers(response.headers),
    body,
    // Menandai bahwa path param memakai ID sintetis, bukan record nyata.
    // Tanpa ini, 401 dari ID palsu bisa terbaca seolah menguji data sungguhan.
    ...(testCase.synthetic ? { syntheticParams: true } : {}),
    ...(endpoint.note ? { note: endpoint.note } : {}),
  }
}

function goldenPath(config, testCase) {
  return join(config.goldenDir, testCase.endpoint.mount, `${testCase.caseId}.json`)
}

async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export async function runCapture(config, cases, skipped, actors) {
  const touched = new Set()
  for (const testCase of cases) {
    const actor = actors.get(testCase.actorKey)
    const record = await execute(testCase, actor)
    await writeJson(goldenPath(config, testCase), record)
    touched.add(testCase.endpoint.n)
    process.stdout.write(`  rekam ${testCase.caseId} -> ${record.status}\n`)
  }
  return {
    target: config.target,
    totalEndpoints: REGISTRY.length,
    endpointsTouched: touched.size,
    casesRun: cases.length,
    casesSkipped: skipped.length,
    mismatches: 0,
    skipped,
  }
}

function diff(expected, actual, path, out, caseId) {
  if (JSON.stringify(expected) === JSON.stringify(actual)) return
  const bothObjects =
    expected && actual && typeof expected === 'object' && typeof actual === 'object' &&
    !Array.isArray(expected) && !Array.isArray(actual)
  if (bothObjects) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)])
    for (const key of [...keys].sort()) {
      diff(expected[key], actual[key], path ? `${path}.${key}` : key, out, caseId)
    }
    return
  }
  out.push({ caseId, field: path || '(root)', expected, actual })
}

export async function runCompare(config, cases, skipped, actors) {
  const mismatches = []
  const touched = new Set()

  for (const testCase of cases) {
    const actor = actors.get(testCase.actorKey)
    const actual = await execute(testCase, actor)
    touched.add(testCase.endpoint.n)

    let expected
    try {
      expected = JSON.parse(await readFile(goldenPath(config, testCase), 'utf8'))
    } catch {
      mismatches.push({
        caseId: testCase.caseId,
        field: '(golden)',
        expected: 'file golden belum ada — jalankan capture terhadap backend Go dulu',
        actual: `HTTP ${actual.status}`,
      })
      continue
    }

    // Hanya status, header, dan body yang dibandingkan. Field lain (path yang
    // sudah dinormalisasi, catatan) bersifat informatif.
    const strip = (record) => ({
      status: record.status,
      headers: record.headers,
      body: record.body,
    })
    const before = mismatches.length
    diff(strip(expected), strip(actual), '', mismatches, testCase.caseId)
    process.stdout.write(
      `  banding ${testCase.caseId} -> ${actual.status} ${mismatches.length > before ? 'BEDA' : 'cocok'}\n`,
    )
  }

  return {
    summary: {
      target: config.target,
      totalEndpoints: REGISTRY.length,
      endpointsTouched: touched.size,
      casesRun: cases.length,
      casesSkipped: skipped.length,
      mismatches: mismatches.length,
      skipped,
    },
    mismatches,
  }
}

export async function writeSummary(config, summary, mismatches = []) {
  await writeJson(join(config.goldenDir, '_summary.json'), { ...summary, mismatches })
}
