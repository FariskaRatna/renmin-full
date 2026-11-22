import { equal, status } from '../assert.js'

/**
 * R5H25 — Master Data tahap pekerjaan (migrasi 067). EXPRESS SAJA: tidak ada padanan
 * di suite Go, jadi namanya berawalan `x1_` dan diletakkan SETELAH skenario 1:1.
 *
 * Yang dibuktikan, karena harness golden tidak bisa melihatnya:
 *   - saklar hanya bisa dibaca/diubah lewat AuthorizeRoleEditor (anonim 401,
 *     akun operasional Subbagren yang sah 403, Superadmin 200);
 *   - mutasi Superadmin tetap wajib CSRF;
 *   - Superadmin yang belum merotasi password ditolak;
 *   - pemisahan Superadmin <-> operasional tidak bocor: katalog menu kerja tetap 403
 *     bagi Superadmin, padahal ia bisa mengatur saklarnya.
 */
const ADMIN = '/api/v1/admin/master/tahap-pekerjaan'
const KATALOG = '/api/v1/subbagren/perencanaan/tahap-katalog'

export async function verifyR5H25MasterTahap({ env }) {
  const ren = await env.createUser('ren_r5h25')
  await env.attachUnit(ren.id, 'subbagren')
  await env.createRole('br_r5h25_test', 'R5H25 Test Role')
  await env.grantPermissions('br_r5h25_test', ['subbagren.progar.read', 'subbagren.progar.manage'])
  await env.grant(ren.id, 'br_r5h25_test', 'subbagren', 'unit', { reason: 'Isolated R5H25 grant only' })

  const anon = await env.newBrowser()
  const op = await env.newSession('ren_r5h25')
  const sa = await env.loginSuperadmin()
  const body = (version) => ({ aktif: { unduh_myinterest: true }, reason: 'Uji keamanan R5H25 terisolasi', version })

  status(await anon.call('GET', ADMIN), 401, 'anonim baca saklar')
  status(await anon.call('PUT', `${ADMIN}/lap_lra`, body(0), true), 401, 'anonim ubah saklar')

  // Akun operasional ini SAH di menu kerja (katalog 200), jadi 403 di bawah murni dari guard admin.
  status(await op.call('GET', KATALOG), 200, 'operator baca katalog menu kerja')
  status(await op.call('GET', ADMIN), 403, 'operator baca saklar')
  status(await op.call('PUT', `${ADMIN}/lap_lra`, body(0), true), 403, 'operator ubah saklar')

  const list = await sa.call('GET', ADMIN)
  status(list, 200, 'Superadmin baca saklar')
  const version = JSON.parse(list.text).version
  status(await sa.call('PUT', `${ADMIN}/lap_lra`, body(version), false), 403, 'Superadmin ubah tanpa CSRF')
  const noop = await sa.call('PUT', `${ADMIN}/lap_lra`, body(version), true)
  status(noop, 200, 'Superadmin ubah dengan CSRF')
  equal(JSON.parse(noop.text).changed, 0, 'PUT tanpa perubahan nyata')
  status(await sa.call('GET', KATALOG), 403, 'Superadmin tetap ditolak di katalog menu kerja')

  const saId = env.users.get('sa_r2d5').id
  await env.pool.query('UPDATE sdl_users SET must_change_password=TRUE WHERE id=$1', [saId])
  try {
    status(await sa.call('GET', ADMIN), 403, 'Superadmin must_change_password baca saklar')
  } finally {
    await env.pool.query('UPDATE sdl_users SET must_change_password=FALSE WHERE id=$1', [saId])
  }
}
