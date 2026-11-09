import { resolve } from 'node:path'

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} wajib diisi`)
  return value
}

/**
 * Konfigurasi harness.
 *
 * apiBase          base URL backend yang diuji. Di dalam network Docker: http://api:8080
 * databaseUrl      DSN Postgres yang dipakai backend; harness memakainya untuk
 *                  mencetak sesi dan membaca fixture
 * origin           nilai header Origin. WAJIB ada di allowlist SDL_ALLOWED_ORIGINS
 *                  backend, kalau tidak setiap mutation ditolak 403 csrf_invalid —
 *                  dan di UI gejalanya tersamar sebagai CAPTCHA gagal
 *                  (lihat docs/API-CONTRACT.md 2.2)
 * goldenDir        direktori output golden file
 * allowMutations   mutation dengan sesi valid mengubah database. Default mati.
 *                  Nyalakan HANYA terhadap database sekali pakai
 * target           label backend yang diuji, ikut tercatat di ringkasan
 */
export function loadConfig() {
  const here = resolve(import.meta.dirname)
  return {
    apiBase: (process.env.SDL_HARNESS_API_BASE ?? 'http://api:8080').replace(/\/+$/, ''),
    databaseUrl: required('DATABASE_URL'),
    origin: process.env.SDL_HARNESS_ORIGIN ?? 'http://127.0.0.1:5174',
    goldenDir: process.env.SDL_HARNESS_GOLDEN_DIR ?? resolve(here, 'golden'),
    allowMutations: process.env.SDL_HARNESS_ALLOW_MUTATIONS === 'true',
    target: process.env.SDL_HARNESS_TARGET ?? 'go',
    requestTimeoutMs: Number(process.env.SDL_HARNESS_TIMEOUT_MS ?? '20000'),
    // Daftar mount yang diuji, dipisah koma. Kosong = semuanya.
    // Dipakai selama migrasi bertahap: Express baru melayani sebagian prefix,
    // dan membandingkan prefix yang belum diporting hanya menghasilkan 404
    // yang tidak berarti apa-apa.
    onlyMounts: (process.env.SDL_HARNESS_ONLY_MOUNTS ?? '')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  }
}
