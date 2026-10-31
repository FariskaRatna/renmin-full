import { createApp } from './app.js'
import { loadConfig, parseAddr } from './config.js'
import { createPool } from './db.js'

/**
 * Bootstrap proses, padanan cmd/api/main.go.
 *
 * Flag CLI yang sama: --migrate, --bootstrap-superadmin, --healthcheck.
 * Ketiganya belum diimplementasikan di Tahap 2; backend Go masih memegangnya.
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

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('-healthcheck') || args.includes('--healthcheck')) {
    await healthcheck()
    return
  }

  let config
  try {
    config = loadConfig()
  } catch (error) {
    log('ERROR', error.message)
    process.exit(1)
  }

  const pool = createPool(config.databaseUrl)
  try {
    await pool.query('SELECT 1')
  } catch {
    log('ERROR', 'database connection check failed')
    process.exit(1)
  }

  // Go menolak start kalau skema tidak konsisten (migrations.Verify). Selama
  // masa transisi, backend Go yang menerapkan dan memverifikasi migrasi, jadi
  // di sini cukup dipastikan ledger-nya ada.
  try {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM sdl_schema_migrations')
    if (rows[0].n === 0) throw new Error('empty ledger')
    log('INFO', 'schema ledger present', { migrations: rows[0].n })
  } catch {
    log('ERROR', 'database migrations missing or inconsistent; apply them with the Go backend first')
    process.exit(1)
  }

  log('INFO', 'origin allowlist', { origins: config.allowedOrigins.join(' ') })

  const app = createApp({ pool, config })
  const { host, port } = parseAddr(config.httpAddr)

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
