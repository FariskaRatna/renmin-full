import { createApp } from './app.js'
import { Mailer } from './auth/mailer.js'
import { bootstrapSuperadmin } from './cli/bootstrap-superadmin.js'
import { loadConfig, parseAddr } from './config.js'
import { createPool } from './db.js'
import { run as runMigrations, verify as verifyMigrations } from './migrations/index.js'
import { startEmailWorker } from './notifications/urmin.js'

/**
 * Bootstrap proses, padanan cmd/api/main.go.
 *
 * Flag CLI yang sama dan URUTAN YANG SAMA: `--healthcheck` lebih dulu (ia
 * tidak menyentuh database sama sekali), lalu `--migrate` yang berjalan
 * SEBELUM verifikasi skema, lalu verifikasi, baru `--bootstrap-superadmin`.
 *
 * Urutan itu bukan gaya. `--migrate` harus jalan sebelum verifikasi karena
 * database barulah yang paling butuh migrasi dan pasti gagal verifikasi;
 * sebaliknya bootstrap dijalankan SESUDAH verifikasi karena ia menulis ke
 * tabel yang skemanya baru saja dipastikan benar.
 *
 * Worker email outbox dijalankan dari sini, bukan dari createApp — meniru
 * main.go yang memulainya di samping server HTTP, bukan di dalam router.
 */
function log(level, msg, extra = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra })}\n`)
}

async function healthcheck() {
  try {
    const response = await fetch('http://127.0.0.1:8080/readyz', { signal: AbortSignal.timeout(2000) })
    process.exit(response.ok ? 0 : 1)
  } catch {
    process.exit(1)
  }
}

/** Flag diterima dengan satu maupun dua tanda hubung, seperti paket flag Go. */
function hasFlag(args, name) {
  return args.includes(`-${name}`) || args.includes(`--${name}`)
}

async function main() {
  const args = process.argv.slice(2)
  if (hasFlag(args, 'healthcheck')) {
    await healthcheck()
    return
  }

  // SENGAJA hanya DATABASE_URL di sini, bukan loadConfig() penuh. Go membaca
  // SDL_AUTH_SECRET SESUDAH cabang --migrate dan --bootstrap-superadmin
  // (main.go:96), sehingga keduanya bisa dijalankan terhadap lingkungan yang
  // belum punya secret sama sekali — justru keadaan database yang baru dibuat.
  // Memanggil loadConfig() lebih dulu akan menuntut secret untuk pekerjaan
  // yang tidak memerlukannya.
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim()
  if (databaseUrl === '') {
    log('ERROR', 'DATABASE_URL is not configured')
    process.exit(1)
  }

  const pool = createPool(databaseUrl)
  try {
    await pool.query('SELECT 1')
  } catch {
    log('ERROR', 'database connection check failed')
    process.exit(1)
  }

  // `--migrate` berhenti sesudah menerapkan skema, tidak melanjutkan ke
  // server. Migrasi TIDAK PERNAH jalan otomatis saat start normal — itu
  // disengaja di Go dan dipertahankan di sini.
  if (hasFlag(args, 'migrate')) {
    try {
      const { applied, skipped } = await runMigrations(pool)
      log('INFO', 'schema migrations applied', { applied: applied.length, skipped })
      await pool.end().catch(() => {})
      process.exit(0)
    } catch (error) {
      log('ERROR', 'schema migration failed', { error: error.message })
      process.exit(1)
    }
  }

  // Verifikasi penuh, padanan migrations.Verify(): bukan sekadar "ledger ada",
  // melainkan ke-33 berkas hadir DAN checksum-nya cocok. Backend yang menyala
  // di atas skema yang bergeser lebih berbahaya daripada backend yang menolak
  // menyala. 33 SQL-nya ikut di dalam image (lihat Dockerfile) — padanan
  // `//go:embed` di Go.
  try {
    const n = await verifyMigrations(pool)
    log('INFO', 'schema verified', { migrations: n })
  } catch (error) {
    log('ERROR', 'database migrations missing or inconsistent', { error: error.message })
    process.exit(1)
  }

  // Bootstrap SESUDAH verifikasi skema: ia menulis ke sdl_users dan
  // sdl_user_roles, dan menulis ke skema yang belum dipastikan benar adalah
  // cara membuat akun Superadmin yang setengah jadi.
  if (hasFlag(args, 'bootstrap-superadmin')) {
    try {
      await bootstrapSuperadmin(pool, process.stdin)
      await pool.end().catch(() => {})
      process.exit(0)
    } catch (error) {
      log('ERROR', 'bootstrap rejected', { error: error.message })
      process.exit(1)
    }
  }

  // Baru di sini konfigurasi penuh dibaca — termasuk SDL_AUTH_SECRET dan
  // penjaga SDL_COOKIE_SECURE yang mematikan proses di luar development.
  let config
  try {
    config = loadConfig()
  } catch (error) {
    log('ERROR', error.message)
    process.exit(1)
  }

  log('INFO', 'origin allowlist', { origins: config.allowedOrigins.join(' ') })

  const mailer = new Mailer(config.smtp)
  const app = createApp({ pool, config, mailer })
  const { host, port } = parseAddr(config.httpAddr)

  // Worker outbox, padanan `go notifications.Run(...)` di main.go:139.
  // Default MATI selama transisi — lihat aturan 7 di startEmailWorker.
  const stopEmailWorker = startEmailWorker({ pool, config, mailer, log })

  const server = app.listen(port, host, () => {
    log('INFO', 'SDL Express API started', { addr: config.httpAddr })
  })

  // Timeout disamakan dengan http.Server di main.go.
  server.headersTimeout = 5000
  server.requestTimeout = 15000
  server.keepAliveTimeout = 65000
  server.maxHeadersCount = 0

  const shutdown = () => {
    log('INFO', 'SDL Express API stopping')
    if (stopEmailWorker) stopEmailWorker()
    server.close(async () => {
      await pool.end().catch(() => {})
      log('INFO', 'SDL Express API stopped')
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

await main()
