#!/usr/bin/env node
/**
 * Rotasi paksa SELURUH password pengguna, port dari
 * `apps/backend/cmd/reset-all-passwords/main.go`.
 *
 * **Destruktif dan tidak bisa dipulihkan.** Batasan keras #6 di `CLAUDE.md`:
 * password lama tidak tersimpan di mana pun, jadi tidak ada jalan kembali.
 * Dijalankan lewat `scripts/reset-all-passwords.sh`, tidak pernah lewat HTTP.
 *
 * Empat penjaga, dan tidak satu pun boleh dilonggarkan:
 *   1. `SDL_ENV` harus `development`;
 *   2. `current_database()` harus persis `sdl_root_dev`;
 *   3. jumlah akun harus PERSIS seperti yang dikonfirmasi pemanggil — kalau
 *      berubah sejak konfirmasi, transaksinya dibatalkan;
 *   4. harus ada minimal satu Superadmin yang tersisa.
 *
 * Penjaga ketiga adalah yang paling mudah dianggap berlebihan. Ia mencegah
 * skenario nyata: operator mengonfirmasi "12 akun", lalu antara konfirmasi dan
 * eksekusi ada akun yang dibuat — dan tanpa pemeriksaan itu, akun yang tidak
 * pernah disetujui ikut terkunci.
 */
import { hashPassword } from '../crypto/password.js'
import { createPool } from '../db.js'

/**
 * Dua baris: jumlah akun yang diharapkan, lalu password sementara.
 *
 * Go menuntut KEDUANYA diakhiri baris baru dan TIDAK ADA apa pun sesudahnya
 * (`reader.ReadByte()` harus mengembalikan EOF). Ketatnya disengaja: masukan
 * yang tergabung atau terpotong di pipa tidak boleh ditafsirkan sebagai
 * konfirmasi.
 */
export function readInput(raw) {
  const limited = raw.slice(0, 1024)
  const firstBreak = limited.indexOf('\n')
  if (firstBreak < 0) throw new Error('missing expected user count')
  const secondBreak = limited.indexOf('\n', firstBreak + 1)
  if (secondBreak < 0) throw new Error('missing temporary password')
  if (secondBreak !== limited.length - 1) throw new Error('unexpected extra input')

  const countText = limited.slice(0, firstBreak).trim()
  // Go memakai strconv.Atoi: hanya digit desimal dengan tanda opsional.
  const count = /^[+-]?\d+$/.test(countText) ? Number(countText) : Number.NaN
  if (!Number.isInteger(count) || count < 1 || count > 5000) {
    throw new Error('invalid expected user count')
  }

  // Hanya '\n' di ujung yang dibuang; spasi adalah bagian dari password.
  const password = limited.slice(firstBreak + 1, secondBreak)
  const bytes = Buffer.byteLength(password, 'utf8')
  if (bytes < 14 || bytes > 256 || /[\r\n\0]/.test(password)) {
    throw new Error('temporary password violates application policy')
  }
  return { count, password }
}

export async function apply(pool, expected, password) {
  if (process.env.SDL_ENV !== 'development') throw new Error('REFUSED: not a development environment')

  const client = await pool.connect()
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')

    const db = await client.query('SELECT current_database() AS name')
    if (db.rows[0].name !== 'sdl_root_dev') throw new Error('REFUSED: unexpected database')

    await client.query('SELECT pg_advisory_xact_lock(20261021, 51)')

    // FOR UPDATE: barisnya dikunci sampai commit, jadi tidak ada akun yang
    // bisa berubah di antara penghitungan dan penulisan.
    const { rows: users } = await client.query(
      'SELECT id::text AS id, username FROM sdl_users ORDER BY username FOR UPDATE',
    )
    if (users.length !== expected) {
      throw new Error(
        `account count changed since CLI confirmation: expected ${expected}, now ${users.length}`,
      )
    }

    const admins = await client.query(
      `SELECT count(DISTINCT ur.user_id)::int AS n FROM sdl_user_roles ur
         JOIN sdl_users u ON u.id=ur.user_id WHERE ur.role_key='superadmin'`,
    )
    if (admins.rows[0].n < 1) throw new Error('REFUSED: no Superadmin found')

    // Satu hash dengan salt acak SENDIRI per pengguna, walau password
    // sementaranya sama. Salt bersama akan membuat seluruh baris identik dan
    // satu hash yang pecah berarti semuanya pecah.
    for (const user of users) {
      const hash = await hashPassword(password)
      const updated = await client.query(
        `UPDATE sdl_users SET password_hash=$2, must_change_password=TRUE,
                password_changed_at=NOW(), updated_at=NOW(), version=version+1
          WHERE id=$1::uuid`,
        [user.id, hash],
      )
      if (updated.rowCount !== 1) throw new Error('unexpected affected rows')
      await client.query(
        `INSERT INTO sdl_audit_events(event_key,subject_type,subject_id,metadata)
         VALUES('identity.password_reset_bulk','user',$1,
                jsonb_build_object('source','local_development_cli','force_change',true))`,
        [user.id],
      )
    }

    // Sesi dan tantangan OTP yang masih hidup ikut dimatikan: password baru
    // tidak ada artinya kalau sesi lama tetap bisa dipakai.
    await client.query('UPDATE sdl_sessions SET revoked_at=NOW() WHERE revoked_at IS NULL')
    await client.query('UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE consumed_at IS NULL')

    await client.query('COMMIT')
    return users.length
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Rollback yang gagal tidak boleh menutupi error aslinya.
    }
    throw error
  } finally {
    client.release()
  }
}

async function readStdin(limit = 1024) {
  const chunks = []
  let total = 0
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
    total += chunk.length
    if (total >= limit) break
  }
  return Buffer.concat(chunks).subarray(0, limit).toString('utf8')
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || args[0] !== '-apply') {
    process.stderr.write('REFUSED: requires -apply via local interactive wrapper\n')
    process.exit(2)
  }

  let input
  try {
    input = readInput(await readStdin())
  } catch (error) {
    process.stderr.write(`REFUSED: ${error.message}\n`)
    process.exit(2)
  }

  const databaseUrl = (process.env.DATABASE_URL ?? '').trim()
  if (databaseUrl === '') {
    process.stderr.write('REFUSED: missing database connection\n')
    process.exit(2)
  }

  const pool = createPool(databaseUrl)
  try {
    await pool.query('SELECT 1')
  } catch {
    process.stderr.write('ERROR: database unavailable\n')
    await pool.end().catch(() => {})
    process.exit(1)
  }

  let changed
  try {
    changed = await apply(pool, input.count, input.password)
  } catch (error) {
    // Tidak pernah menampilkan connection string, parameter SQL, atau password.
    process.stderr.write(`ERROR: password reset transaction rolled back: ${error.message}\n`)
    await pool.end().catch(() => {})
    process.exit(1)
  }
  await pool.end().catch(() => {})

  process.stdout.write(
    `SUCCESS: ${changed} user password hashes rotated atomically; ` +
    'force-change enabled; sessions and OTP challenges revoked.\n',
  )
}

if (process.argv[1] && process.argv[1].endsWith('reset-all-passwords.js')) await main()
