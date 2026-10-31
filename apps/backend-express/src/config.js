/**
 * Konfigurasi proses, padanan apps/backend/cmd/api/main.go.
 *
 * Semua pemeriksaan "menolak start" di Go direplikasi apa adanya. Backend yang
 * menyala dengan konfigurasi setengah benar lebih berbahaya daripada backend
 * yang menolak menyala.
 */

function hexKey(name, { required }) {
  const raw = (process.env[name] ?? '').trim()
  if (raw === '') {
    if (required) throw new Error(`${name} must be 32 random bytes (64 hex characters)`)
    return undefined
  }
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    if (required) throw new Error(`${name} must be 32 random bytes (64 hex characters)`)
    // SDL_EVIDENCE_KEY yang tidak valid TIDAK menggagalkan start. Ia membuat
    // operasi berkas bukti fail-closed, sama seperti router.go:119 yang
    // membiarkan kuncinya nil.
    return undefined
  }
  return Buffer.from(raw, 'hex')
}

export function loadConfig(env = process.env) {
  const databaseUrl = (env.DATABASE_URL ?? '').trim()
  if (!databaseUrl) throw new Error('DATABASE_URL is not configured')

  const secret = hexKey('SDL_AUTH_SECRET', { required: true })
  const evidenceKey = hexKey('SDL_EVIDENCE_KEY', { required: false })

  const isProduction = (env.SDL_ENV ?? '') !== 'development'
  const secureCookie = env.SDL_COOKIE_SECURE === 'true'
  if (isProduction && !secureCookie) {
    throw new Error('secure session cookies required outside development')
  }

  // Allowlist Origin. Tetap allowlist, tidak pernah "*". Default-nya alamat dev
  // lokal; di balik reverse proxy HTTPS, SDL_ALLOWED_ORIGINS WAJIB diisi karena
  // browser mengirim Origin berisi alamat publik — dan penolakannya muncul di
  // UI sebagai pesan CAPTCHA gagal, bukan pesan CSRF.
  let allowedOrigins = ['http://127.0.0.1:5174', 'http://localhost:5174']
  const rawOrigins = (env.SDL_ALLOWED_ORIGINS ?? '').trim()
  if (rawOrigins !== '') {
    allowedOrigins = rawOrigins.split(',').map((o) => o.trim()).filter(Boolean)
  }

  // Port SMTP dipaksa 465 atau 587; nilai lain apa pun jatuh ke 587.
  const smtpPort = env.SDL_SMTP_PORT === '465' ? 465 : 587

  return {
    databaseUrl,
    secret,
    evidenceKey,
    isProduction,
    secureCookie,
    allowedOrigins,
    httpAddr: env.HTTP_ADDR || ':8080',
    demoSuperadminWorkspace: env.SDL_DEV_SUPERADMIN_WORKSPACE === 'true',
    emailNotificationsEnabled: env.SDL_EMAIL_NOTIFICATIONS_ENABLED !== 'false',
    smtp: {
      host: env.SDL_SMTP_HOST ?? '',
      port: smtpPort,
      username: env.SDL_SMTP_USER ?? '',
      password: env.SDL_SMTP_PASSWORD ?? '',
      from: env.SDL_SMTP_FROM ?? '',
    },
  }
}

/** ":8080" -> { host: undefined, port: 8080 }; "127.0.0.1:8080" -> { host, port } */
export function parseAddr(addr) {
  const index = addr.lastIndexOf(':')
  if (index < 0) return { host: undefined, port: Number(addr) }
  const host = addr.slice(0, index)
  return { host: host === '' ? undefined : host, port: Number(addr.slice(index + 1)) }
}
