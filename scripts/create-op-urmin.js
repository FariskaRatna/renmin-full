#!/usr/bin/env node
/**
 * Membuat akun `op-urmin` yang dituntut seed-bagrenmin.
 *
 * Kenapa perlu: seeder mendeskripsikan dirinya sebagai "12 akun BARU + 1 akun
 * LAMA". Akun lama itu `op-urmin`, dan ia menolak jalan kalau tidak menemukannya
 * (cmd/seed-bagrenmin/main.go:176):
 *
 *   REFUSED: expected active existing op-urmin account not found
 *
 * Di server yang sudah lama hidup, akun itu peninggalan putaran sebelumnya.
 * Di database lokal yang baru, ia tidak pernah ada. Script ini mengisinya.
 *
 * Prasyarat seeder untuk op-urmin (main.go:180-190): aktif, dan TANPA role
 * langsung, TANPA access grant, TANPA unit selain urmin. `POST /api/v1/admin/users`
 * menghasilkan tepat itu — user aktif tanpa role/grant/unit apa pun.
 *
 * Cara kerjanya memakai jalur yang sebenarnya, bukan INSERT mentah:
 *   1. cetak sesi Superadmin langsung di sdl_sessions (OTP via SMTP tidak bisa
 *      diotomasi, sama seperti yang dilakukan harness)
 *   2. ambil cookie CSRF, lalu panggil endpoint admin lewat proxy Vite
 *   3. cabut sesi itu kembali
 *
 * Password sementara yang dikembalikan API dicetak sekali ke layar dan tidak
 * disimpan di mana pun. Akun ini dipaksa ganti password saat login pertama.
 */
import { createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SDL_SETUP_BASE_URL ?? 'http://127.0.0.1:5174'
const ORIGIN = process.env.SDL_SETUP_ORIGIN ?? 'http://127.0.0.1:5174'
const USERNAME = 'op-urmin'

function psql(sql) {
  return execFileSync(
    'docker',
    [
      'compose', '--env-file', '.env', '-f', 'infra/compose.dev.yaml',
      'exec', '-T', 'db',
      'psql', '-U', process.env.SDL_DB_USER ?? 'sdl_app',
      '-d', process.env.SDL_DB_NAME ?? 'sdl_root_dev',
      '-At', '-c', sql,
    ],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DOCKER_CONFIG: resolve(ROOT, 'infra/docker-config') },
    },
  ).trim()
}

function cookieHeader(jar) {
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
}

function absorb(jar, response) {
  for (const raw of response.headers.getSetCookie?.() ?? []) {
    const pair = raw.split(';')[0] ?? ''
    const i = pair.indexOf('=')
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
  }
}

const exists = psql(`SELECT EXISTS(SELECT 1 FROM sdl_users WHERE lower(username)='${USERNAME}')`)
if (exists === 't') {
  console.log(`Akun ${USERNAME} sudah ada. Tidak ada perubahan.`)
  process.exit(0)
}

const superadminId = psql(
  `SELECT u.id::text FROM sdl_users u
     JOIN sdl_user_roles r ON r.user_id=u.id AND r.role_key='superadmin'
    WHERE u.is_active AND NOT u.must_change_password
    ORDER BY u.created_at LIMIT 1`,
)
if (!superadminId) {
  console.error('GAGAL: tidak ada Superadmin aktif. Jalankan "bootstrap" lebih dulu.')
  process.exit(1)
}

const token = randomBytes(32).toString('base64url')
const tokenHash = createHash('sha256').update(token).digest('hex')
psql(
  `INSERT INTO sdl_sessions(token_hash,user_id,expires_at)
   VALUES ('${tokenHash}','${superadminId}', NOW() + INTERVAL '10 minutes')`,
)

const jar = new Map([['sdl_session', token]])
let exitCode = 0
try {
  const csrfResponse = await fetch(`${BASE}/api/v1/auth/csrf`, {
    headers: { Origin: ORIGIN, Cookie: cookieHeader(jar) },
  })
  if (!csrfResponse.ok) throw new Error(`GET /auth/csrf -> HTTP ${csrfResponse.status}`)
  absorb(jar, csrfResponse)
  const csrfToken = jar.get('sdl_csrf')

  const createResponse = await fetch(`${BASE}/api/v1/admin/users`, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      Cookie: cookieHeader(jar),
      'X-CSRF-Token': csrfToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: USERNAME,
      email: `${USERNAME}@siera.invalid`,
      displayName: 'Operator Urmin BagRenmin',
      reason: 'Prasyarat seed-bagrenmin pada database lokal yang baru dibuat.',
    }),
  })

  const text = await createResponse.text()
  if (createResponse.status !== 201) {
    throw new Error(`POST /admin/users -> HTTP ${createResponse.status}: ${text}`)
  }
  const body = JSON.parse(text)
  console.log(`\nAkun ${USERNAME} dibuat.`)
  console.log(`  id                 : ${body.id}`)
  console.log(`  password sementara : ${body.temporaryPassword}`)
  console.log('\nPassword itu hanya ditampilkan sekali dan tidak disimpan di mana pun.')
  console.log('Akun ini wajib ganti password saat login pertama; seed tidak mengubahnya.')
  console.log('\nLanjutkan dengan: local-setup.cmd seed')
} catch (error) {
  console.error(`GAGAL: ${error.message}`)
  exitCode = 1
} finally {
  psql(`UPDATE sdl_sessions SET revoked_at=NOW() WHERE token_hash='${tokenHash}'`)
}

process.exit(exitCode)
