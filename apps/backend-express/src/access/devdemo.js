/**
 * Workspace demo Superadmin, port dari apps/backend/internal/devdemo.
 *
 * Sengaja berlapis tiga: SDL_ENV harus development, SDL_DEV_SUPERADMIN_WORKSPACE
 * harus persis "true", DAN nama database harus persis sdl_root_dev. Tiga-tiganya
 * harus terpenuhi; satu saja meleset maka demo mati.
 *
 * Ini satu-satunya jalan Superadmin menyentuh endpoint operasional, dan ia
 * tidak boleh pernah aktif di produksi.
 */
function databaseName(databaseUrl) {
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '')
  } catch {
    return ''
  }
}

export function demoEnabled(env = process.env) {
  if (env.SDL_ENV !== 'development') return false
  if (env.SDL_DEV_SUPERADMIN_WORKSPACE !== 'true') return false
  return databaseName(env.DATABASE_URL ?? '') === 'sdl_root_dev'
}

/**
 * Memeriksa identitas yang benar-benar login, role aktif, dan rotasi password
 * pertama yang sudah selesai — sebelum pengecualian demo apa pun berlaku.
 */
export async function isDemoSuperadmin(pool, userId, env = process.env) {
  if (!demoEnabled(env) || !userId) return false
  const { rows } = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM sdl_users u
        JOIN sdl_user_roles ur ON ur.user_id=u.id AND ur.role_key='superadmin'
        JOIN sdl_roles r ON r.role_key=ur.role_key AND r.is_active
       WHERE u.id::text=$1 AND u.is_active AND NOT u.must_change_password) AS ok`,
    [userId],
  )
  return rows[0].ok
}
