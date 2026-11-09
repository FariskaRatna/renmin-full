import { createServer } from 'node:http'
import pg from 'pg'

import { createApp } from '../src/app.js'
import { Mailer } from '../src/auth/mailer.js'
import { loadConfig } from '../src/config.js'
import { hashPassword } from '../src/crypto/password.js'
import { signature, tokenHash } from '../src/crypto/tokens.js'
import { run as runMigrations, verify as verifyMigrations } from '../src/migrations/index.js'
import { Browser } from './browser.js'
import {
  AUTH_SECRET_HEX,
  CONFIRM_TOKEN,
  EVIDENCE_KEY_HEX,
  FIXTURE_PASSWORD,
  ORIGIN,
  TEST_DATABASE,
} from './constants.js'

/**
 * Lingkungan uji keamanan, padanan `setup()` di Go.
 *
 * EMPAT PENJAGA sebelum satu baris pun ditulis. Semuanya ada di Go dan
 * semuanya dipertahankan — suite ini membuat user, memberi grant, lalu
 * MENCABUTNYA, dan menjalankannya terhadap database yang keliru akan merusak
 * akun sungguhan:
 *
 *   1. `SDL_SECURITY_TEST_CONFIRM` harus persis `R2D5_EPHEMERAL_ONLY`
 *   2. DSN wajib ada
 *   3. `current_database()` harus persis `sdl_security_test`
 *   4. database harus BENAR-BENAR KOSONG — nol tabel berawalan `sdl_`
 *
 * Penjaga keempat yang paling penting dan paling mudah tergoda untuk
 * dilonggarkan: ia memastikan skema dibangun dari nol setiap kali, sehingga
 * tidak ada sisa data dari run sebelumnya yang membuat sebuah pemeriksaan
 * lulus karena alasan yang salah.
 */
export class SecurityEnv {
  pool
  server
  base
  users = new Map()
  secret

  async setup() {
    if (process.env.SDL_SECURITY_TEST_CONFIRM !== CONFIRM_TOKEN) {
      throw new Error('menolak jalan di luar stack uji keamanan yang terisolasi')
    }
    const dsn = (process.env.SDL_SECURITY_TEST_DATABASE_URL ?? '').trim()
    if (dsn === '') throw new Error('URL database uji terisolasi tidak ada')

    this.pool = new pg.Pool({ connectionString: dsn, max: 8 })

    const { rows: dbRows } = await this.pool.query('SELECT current_database() AS name')
    if (dbRows[0]?.name !== TEST_DATABASE) {
      throw new Error(`menolak menyentuh database non-uji: ${dbRows[0]?.name}`)
    }
    const { rows: tableRows } = await this.pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE 'sdl_%'`,
    )
    if (tableRows[0].n !== 0) {
      throw new Error('database uji harus baru, kosong, dan terisolasi')
    }

    await runMigrations(this.pool)
    await verifyMigrations(this.pool)

    this.secret = Buffer.from(AUTH_SECRET_HEX, 'hex')

    // Lima akun dengan kombinasi yang berbeda. `sa_r2d5` sengaja dibuat dengan
    // otp_enabled=FALSE: itulah yang membuktikan OTP Superadmin WAJIB tanpa
    // peduli nilai di database (mustUseOTP = isSuperadmin || enabled).
    for (const [name, otp, active, superadmin] of [
      ['sa_r2d5', false, true, true],
      ['op_r2d5', false, true, false],
      ['outsider_r2d5', false, true, false],
      ['otp_r2d5', true, true, false],
      ['disabled_r2d5', false, false, false],
    ]) {
      await this.createUser(name, { otp, active, superadmin })
    }

    const op = this.users.get('op_r2d5')
    const outsider = this.users.get('outsider_r2d5')
    await this.attachUnit(op.id, 'urmin')
    await this.attachUnit(outsider.id, 'subbagren')
    await this.grantPermissions('operator', [
      'urmin.surat_masuk.read',
      'urmin.surat_masuk.create',
      'urmin.surat_masuk.update',
    ])
    await this.grant(op.id, 'operator', 'urmin', 'own')
    await this.grant(outsider.id, 'operator', 'subbagren', 'unit')

    // Konfigurasi dibangun lewat loadConfig() yang sama dengan produksi, bukan
    // objek karangan: kalau suatu saat loadConfig menambah penjaga baru, suite
    // ini ikut tunduk padanya alih-alih melewatinya diam-diam.
    const config = loadConfig({
      DATABASE_URL: dsn,
      SDL_AUTH_SECRET: AUTH_SECRET_HEX,
      SDL_EVIDENCE_KEY: EVIDENCE_KEY_HEX,
      SDL_ENV: 'development', // padanan SecureCookie:false di Go
      SDL_ALLOWED_ORIGINS: ORIGIN,
    })

    // Mailer tanpa SMTP. Go memakai `auth.Mailer{}` kosong, yang Ready()-nya
    // false. Inilah yang membuat login OTP dan Superadmin jatuh ke 503
    // email_delivery_unavailable — perilaku fail-closed yang diuji kasus 06.
    const mailer = new Mailer({ host: '', port: 587, username: '', password: '', from: '' })

    const app = createApp({ pool: this.pool, config, mailer })
    this.server = createServer(app)
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve))
    this.base = `http://127.0.0.1:${this.server.address().port}`
    return this
  }

  async teardown() {
    if (this.server) await new Promise((resolve) => this.server.close(resolve))
    if (this.pool) await this.pool.end()
  }

  async createUser(username, { otp = false, active = true, superadmin = false } = {}) {
    const hash = await hashPassword(FIXTURE_PASSWORD)
    const { rows } = await this.pool.query(
      `INSERT INTO sdl_users(username,email,display_name,password_hash,otp_enabled,is_active)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text AS id`,
      [username, `${username}@test.invalid`, `R2D5 ${username}`, hash, otp, active],
    )
    const account = { id: rows[0].id, username, otp, active, superadmin }
    if (superadmin) {
      await this.pool.query(
        `INSERT INTO sdl_user_roles(user_id,role_key) VALUES($1,'superadmin')`,
        [account.id],
      )
    }
    this.users.set(username, account)
    return account
  }

  attachUnit(userId, unit, primary = true) {
    return this.pool.query(
      'INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,$2,$3)',
      [userId, unit, primary],
    )
  }

  async grantPermissions(roleKey, permissions) {
    for (const permission of permissions) {
      await this.pool.query(
        `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES($1,$2)
         ON CONFLICT DO NOTHING`,
        [roleKey, permission],
      )
    }
  }

  createRole(roleKey, displayName) {
    return this.pool.query('INSERT INTO sdl_roles(role_key,display_name) VALUES($1,$2)', [
      roleKey,
      displayName,
    ])
  }

  grant(userId, roleKey, unit, scope, { limit = 'biasa', reason = 'isolated security test only' } = {}) {
    return this.pool.query(
      `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [userId, roleKey, unit, scope, limit, reason, this.users.get('sa_r2d5').id],
    )
  }

  revokeGrants(userId, roleKey) {
    if (roleKey) {
      return this.pool.query(
        'UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1 AND role_key=$2',
        [userId, roleKey],
      )
    }
    return this.pool.query('UPDATE sdl_access_grants SET revoked_at=now() WHERE user_id=$1', [userId])
  }

  /** Browser baru yang sudah memegang cookie dan token CSRF. */
  newBrowser() {
    return new Browser(this.base).bootstrap()
  }

  /** Browser baru yang sudah login sebagai `username`. */
  async newSession(username, expected = 200) {
    const b = await this.newBrowser()
    await b.login(username, expected)
    return b
  }

  /**
   * Menyuntik tantangan OTP langsung ke database, padanan setOTPChallenge().
   *
   * Diperlukan karena tidak ada SMTP: alur normal mengirim kode lewat email,
   * dan tanpa mailer tidak ada cara sah mendapatkannya. Baris disuntik dengan
   * HMAC yang dihitung memakai secret yang sama, sehingga yang diuji tetap
   * verifikasi sungguhan — bukan jalan pintas yang melewati pemeriksaan.
   */
  async setOTPChallenge(user, { expired = false } = {}) {
    const challenge = Buffer.alloc(32, 0x77).toString('base64url')
    const code = '123456'
    const createdSQL = expired ? "NOW()-INTERVAL '10 minutes'" : 'NOW()'
    const expiresSQL = expired ? "NOW()-INTERVAL '1 minute'" : "NOW()+INTERVAL '5 minutes'"
    await this.pool.query(
      `INSERT INTO sdl_login_challenges(challenge_hash,user_id,otp_code_hash,created_at,expires_at)
       VALUES($1,$2,$3,${createdSQL},${expiresSQL})
       ON CONFLICT(challenge_hash) DO UPDATE SET user_id=EXCLUDED.user_id,
         otp_code_hash=EXCLUDED.otp_code_hash,created_at=EXCLUDED.created_at,
         expires_at=EXCLUDED.expires_at,attempts=0,consumed_at=NULL`,
      [
        signature(this.secret, 'challenge', challenge),
        user.id,
        signature(this.secret, 'otp', `${challenge}:${code}`),
      ],
    )
    return { challenge, code }
  }

  /** Superadmin login lewat OTP suntikan; satu-satunya jalur tanpa SMTP. */
  async loginSuperadmin() {
    const b = await this.newBrowser()
    const { challenge, code } = await this.setOTPChallenge(this.users.get('sa_r2d5'))
    const r = await b.call('POST', '/api/v1/auth/verify-otp', { challenge, code }, true)
    if (r.status !== 200) throw new Error(`login superadmin: HTTP ${r.status}: ${r.text}`)
    return b
  }

  /** sha256 hex, padanan tokenDigest() — dipakai mencari baris captcha. */
  digest(value) {
    return tokenHash(value)
  }
}
