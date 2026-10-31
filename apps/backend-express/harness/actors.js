import { HttpClient } from './client.js'

/**
 * Aktor = persona dengan sesi tersendiri. Daftar ini mengikuti 13 akun yang
 * dibuat cmd/seed-bagrenmin/main.go:29-44, ditambah anonim dan Superadmin.
 *
 * Scope tiap akun berbeda (own / assigned / unit) dan itu disengaja: endpoint
 * yang sama diuji dari sudut pandang yang berbeda, karena otorisasi SDL
 * memutuskan per dokumen, bukan per endpoint.
 */
export const ACTOR_USERNAMES = {
  opUrmin: 'op-urmin',
  stafUrmin: 'staf-urmin',
  kaUrmin: 'ka-urmin',
  opSubbagren: 'op-subbagren',
  kasubbagren: 'kasubbagren',
  kasubbagsumda: 'kasubbagsumda',
  kasubbagbinfung: 'kasubbagbinfung',
  kabagrenmin: 'kabagrenmin',
}

export const ALL_ACTORS = ['anon', 'superadmin', ...Object.keys(ACTOR_USERNAMES)]

/**
 * Mengembalikan Map<actorKey, {key, client, available, reason}>.
 * available=false berarti endpoint milik aktor itu dilewati dengan alasan tercatat.
 */
export async function buildActors(config, db, wanted) {
  const actors = new Map()

  for (const key of wanted) {
    const client = new HttpClient(config)

    if (key === 'anon') {
      // Anonim tetap mengambil cookie CSRF: tanpa itu setiap mutation gagal di
      // gerbang CSRF (403) sebelum sempat menyentuh gerbang autentikasi (401),
      // sehingga yang terekam bukan perilaku yang dimaksud.
      await client.ensureCsrf()
      actors.set(key, { key, client, available: true, reason: 'tanpa sesi' })
      continue
    }

    const userId =
      key === 'superadmin'
        ? await db.superadminUserId()
        : await db.userIdByUsername(ACTOR_USERNAMES[key])

    if (!userId) {
      actors.set(key, {
        key,
        client,
        available: false,
        reason:
          key === 'superadmin'
            ? 'tidak ada akun superadmin'
            : `akun ${ACTOR_USERNAMES[key]} belum di-seed`,
      })
      continue
    }

    const token = await db.mintSession(userId)
    client.setCookie('sdl_session', token)
    await client.ensureCsrf()
    actors.set(key, { key, client, available: true, reason: 'sesi disuntik langsung' })
  }

  return actors
}
