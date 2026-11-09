import sharp from 'sharp'

import { contains, equal, field, notContains, notSuccess, status, truthy } from '../assert.js'
import { FIXTURE_PASSWORD } from '../constants.js'

/**
 * Skenario 01–13, port dari `security_integration_test.go:264`.
 *
 * Semuanya menerima `ctx` bersama dan sebagian MENGISINYA untuk skenario
 * berikutnya — `op` dibuat di 05, `sa` di 07, `outsider` dan `docID` di 09.
 * Ketergantungan itu ada di Go juga dan disengaja: ia yang membuat 11 bisa
 * membuktikan sesi yang SEDANG HIDUP langsung mati saat kebijakan OTP diubah.
 */

/** PNG kecil yang sah, dibuat sekali lalu dipakai ulang. */
let avatarPng
export async function avatarImage() {
  avatarPng ??= await sharp({
    create: { width: 64, height: 64, channels: 4, background: { r: 80, g: 130, b: 180, alpha: 1 } },
  })
    .png()
    .toBuffer()
  return avatarPng
}

export async function publicStatusAndSecureHeaders({ env }) {
  const b = await env.newBrowser()
  const r = await b.call('GET', '/api/v1/system/status')
  status(r, 200, 'status publik')
  equal(r.headers.get('cache-control'), 'no-store', 'Cache-Control')
  equal(r.headers.get('x-content-type-options'), 'nosniff', 'X-Content-Type-Options')
  equal(r.headers.get('x-frame-options'), 'DENY', 'X-Frame-Options')
}

export async function anonymousDenied({ env }) {
  const b = await env.newBrowser()
  for (const path of ['/api/v1/admin/users', '/api/v1/admin/roles', '/api/v1/urmin/surat-masuk/']) {
    status(await b.call('GET', path), 401, `anonim ${path}`)
  }
}

export async function csrfOriginAndToken({ env }) {
  const b = await env.newBrowser()
  // Tanpa Origin dan tanpa header token sama sekali.
  status(await b.call('POST', '/api/v1/auth/logout', {}, false), 403, 'logout tanpa CSRF')
  // Token CSRF BENAR, tapi Origin dari domain asing. Inilah inti double-submit:
  // token saja tidak cukup, karena penyerang bisa memaksa browser korban
  // mengirim cookie-nya. Content-Type sengaja tidak dikirim, meniru Go.
  const foreign = await b.call('POST', '/api/v1/auth/logout', Buffer.from('{}', 'utf8'), false, {
    origin: 'https://attacker.invalid',
    contentType: null,
  })
  status(foreign, 403, 'logout dari Origin asing')
}

export async function captchaInvalidReplayExpiry({ env }) {
  const b = await env.newBrowser()
  const invalid = await b.call(
    'POST',
    '/api/v1/auth/login',
    { username: 'op_r2d5', password: FIXTURE_PASSWORD, captcha: { id: 'invalid', counter: 1 } },
    true,
  )
  status(invalid, 403, 'CAPTCHA tidak dikenal')

  // CAPTCHA sah + password salah -> 401. Lalu KIRIMAN YANG SAMA PERSIS diulang:
  // 403, karena tantangannya sekali pakai. Kalau yang kedua juga 401, CAPTCHA
  // bisa diputar ulang dan seluruh pembatasan brute force kehilangan artinya.
  const challenge = await b.captcha()
  const payload = { username: 'op_r2d5', password: 'bad-password', captcha: challenge }
  status(await b.call('POST', '/api/v1/auth/login', payload, true), 401, 'password salah')
  status(await b.call('POST', '/api/v1/auth/login', payload, true), 403, 'CAPTCHA diputar ulang')

  // Tantangan yang kedaluwarsa ditolak walau belum pernah dipakai.
  const old = await b.captcha()
  await env.pool.query(
    `UPDATE sdl_captcha_challenges
        SET created_at=NOW()-INTERVAL '3 minutes', expires_at=NOW()-INTERVAL '1 minute'
      WHERE challenge_hash=$1`,
    [env.digest(old.id)],
  )
  const expired = await b.call(
    'POST',
    '/api/v1/auth/login',
    { username: 'op_r2d5', password: FIXTURE_PASSWORD, captcha: old },
    true,
  )
  status(expired, 403, 'CAPTCHA kedaluwarsa')
}

export async function passwordOnlyLogin(ctx) {
  const { env } = ctx
  ctx.op = await env.newBrowser()
  const r = await ctx.op.login('op_r2d5', 200)
  const data = JSON.parse(r.text)
  equal(data.otpRequired, false, 'otpRequired')
  equal(data.authenticated, true, 'authenticated')
  status(await ctx.op.call('GET', '/api/v1/auth/me'), 200, 'sesi aktif')
}

export async function otpFailClosedWithoutSmtp({ env }) {
  // Tanpa SMTP, akun ber-OTP TIDAK boleh jatuh ke login password saja. Ia
  // harus gagal tertutup — 503, bukan 200. Superadmin ikut diuji di sini
  // walau otp_enabled-nya FALSE di database: kewajiban OTP-nya keras di kode.
  for (const name of ['otp_r2d5', 'sa_r2d5']) {
    const b = await env.newBrowser()
    await b.login(name, 503)
    status(await b.call('GET', '/api/v1/auth/me'), 401, `${name} tidak boleh punya sesi`)
  }
}

export async function otpExpiryAndSingleUse(ctx) {
  const { env } = ctx
  const b = await env.newBrowser()
  const sa = env.users.get('sa_r2d5')

  const stale = await env.setOTPChallenge(sa, { expired: true })
  status(
    await b.call('POST', '/api/v1/auth/verify-otp', { challenge: stale.challenge, code: stale.code }, true),
    401,
    'OTP kedaluwarsa',
  )

  const fresh = await env.setOTPChallenge(sa)
  const payload = { challenge: fresh.challenge, code: fresh.code }
  status(await b.call('POST', '/api/v1/auth/verify-otp', payload, true), 200, 'OTP sah')
  // Kiriman yang sama persis, langsung sesudahnya: harus 401. Kode OTP yang
  // bisa dipakai dua kali sama berbahayanya dengan tidak ada OTP.
  status(await b.call('POST', '/api/v1/auth/verify-otp', payload, true), 401, 'OTP dipakai ulang')
  ctx.sa = b
}

export async function superadminOperationalDenied({ env, sa }) {
  truthy(sa, 'sesi Superadmin belum ada — skenario 07 gagal lebih dulu')
  status(await sa.call('GET', '/api/v1/admin/users'), 200, 'SA daftar user')
  status(await sa.call('GET', '/api/v1/admin/roles'), 200, 'SA daftar role')

  for (const path of [
    '/api/v1/urmin/surat-masuk/',
    '/api/v1/urmin/surat-masuk/capabilities',
    '/api/v1/admin/delegations',
  ]) {
    status(await sa.call('GET', path), 403, `SA ditolak di ${path}`)
  }

  // Dan tetap ditolak SETELAH diberi unit plus grant penuh. Penolakan
  // Superadmin dari endpoint operasional bukan akibat kurangnya hak akses —
  // ia pemisahan peran yang tidak bisa dibeli dengan grant.
  const superUser = env.users.get('sa_r2d5')
  await env.attachUnit(superUser.id, 'urmin')
  await env.grant(superUser.id, 'operator', 'urmin', 'unit', {
    limit: 'penting',
    reason: 'deliberate negative test grant',
  })
  status(await sa.call('GET', '/api/v1/urmin/surat-masuk/'), 403, 'SA dengan grant penuh')
}

export async function roleScopeAndCrossUnit(ctx) {
  const { env, op } = ctx
  truthy(op, 'sesi operator belum ada — skenario 05 gagal lebih dulu')

  const mine = await op.call('GET', '/api/v1/urmin/surat-masuk/capabilities')
  status(mine, 200, 'kapabilitas operator')
  contains(mine, '"canCreate":true', 'grant scope own ditolak')

  ctx.outsider = await env.newSession('outsider_r2d5')
  const theirs = await ctx.outsider.call('GET', '/api/v1/urmin/surat-masuk/capabilities')
  status(theirs, 200, 'kapabilitas lintas unit')
  // Grant di unit subbagren tidak boleh memberi wewenang apa pun di urmin.
  contains(theirs, '"canCreate":false', 'grant lintas unit diterima')
  status(await ctx.outsider.call('GET', '/api/v1/admin/users'), 403, 'non-SA ke admin')

  const created = await op.call(
    'POST',
    '/api/v1/urmin/surat-masuk/',
    {
      letterNumber: 'SDL-R2D5-001',
      sender: 'Security Test Sender',
      letterDate: '2026-10-18',
      receivedDate: '2026-10-18',
      subject: 'Temporary isolated security integration test',
      classification: 'biasa',
      reason: 'R2D5 isolated test document creation',
    },
    true,
  )
  status(created, 201, 'buat surat masuk')
  ctx.docID = field(created, 'item.id', 'id dokumen')

  // 404, bukan 403: keberadaan dokumen milik unit lain tidak boleh bocor lewat
  // selisih status code.
  status(await ctx.outsider.call('GET', `/api/v1/urmin/surat-masuk/${ctx.docID}`), 404, 'baca lintas unit')
  status(await op.call('GET', `/api/v1/urmin/surat-masuk/${ctx.docID}`), 200, 'baca milik sendiri')
}

export async function profileAvatarAndValidation({ env, op, outsider }) {
  truthy(op && outsider, 'sesi op/outsider belum ada')
  const anon = await env.newBrowser()
  status(await anon.call('GET', '/api/v1/auth/profile/avatar'), 401, 'avatar anonim')

  status(
    await op.call('PATCH', '/api/v1/auth/profile', { displayName: 'Operator Test Updated', phone: '+62 812 3456' }, true),
    200,
    'perbarui profil',
  )

  // Byte mentah bukan gambar: ditolak 400. Tipe disimpulkan dari isi berkas,
  // bukan dari Content-Type — yang di sini justru application/json.
  status(
    await op.call('PUT', '/api/v1/auth/profile/avatar', Buffer.from('not an image', 'utf8'), true),
    400,
    'avatar bukan gambar',
  )
  status(await op.call('PUT', '/api/v1/auth/profile/avatar', await avatarImage(), true), 204, 'unggah avatar')

  const got = await op.call('GET', '/api/v1/auth/profile/avatar')
  status(got, 200, 'baca avatar sendiri')
  equal(got.headers.get('content-type'), 'image/jpeg', 'avatar dikodekan ulang menjadi JPEG')
  truthy(got.body.length > 0, 'body avatar kosong')

  // Avatar bersifat pribadi: pengguna lain tidak melihat avatar siapa pun
  // selain miliknya, dan yang muncul 404 — bukan avatar default.
  status(await outsider.call('GET', '/api/v1/auth/profile/avatar'), 404, 'avatar milik orang lain')
}

export async function otpToggleAndSessionRevocation({ env, op, sa }) {
  truthy(op && sa, 'sesi op/SA belum ada')
  const target = env.users.get('op_r2d5')
  const { rows } = await env.pool.query('SELECT version FROM sdl_users WHERE id=$1', [target.id])
  const body = {
    enabled: true,
    version: Number(rows[0].version),
    reason: 'R2D5 validate sensitive change audit',
    confirmPassword: FIXTURE_PASSWORD,
  }
  status(await sa.call('PATCH', `/api/v1/admin/users/${target.id}/otp`, body, true), 200, 'aktifkan OTP')

  // Sesi yang SEDANG HIDUP harus mati seketika. Bukan saat permintaan
  // berikutnya di-refresh, bukan saat token kedaluwarsa.
  status(await op.call('GET', '/api/v1/auth/me'), 401, 'sesi lama harus dicabut')

  // Dan login berikutnya kini menuntut OTP, yang tanpa SMTP berarti 503.
  const b = await env.newBrowser()
  await b.login('op_r2d5', 503)

  const audit = await env.pool.query(
    `SELECT count(*)::int AS n FROM sdl_audit_events
      WHERE event_key='identity.user_otp_policy_changed' AND subject_id=$1`,
    [target.id],
  )
  equal(audit.rows[0].n, 1, 'jejak audit perubahan kebijakan OTP')

  // Kebijakan OTP Superadmin tidak bisa diubah. Go menerima 403 MAUPUN 409 di
  // sini — yang haram hanya 2xx.
  const protectedSA = await sa.call(
    'PATCH',
    `/api/v1/admin/users/${env.users.get('sa_r2d5').id}/otp`,
    body,
    true,
  )
  notSuccess(protectedSA, 'OTP Superadmin ternyata bisa diubah')
}

export async function logoutAndDisabledAccount({ env, outsider }) {
  truthy(outsider, 'sesi outsider belum ada')
  status(await outsider.call('POST', '/api/v1/auth/logout', {}, true), 204, 'logout')
  status(await outsider.call('GET', '/api/v1/auth/me'), 401, 'sesi sesudah logout')

  const b = await env.newBrowser()
  // Akun nonaktif ditolak 401 — sama dengan password salah, supaya status
  // keaktifan akun tidak bisa disimpulkan dari responsnya.
  await b.login('disabled_r2d5', 401)
}

export async function unauthorizedMutationNoLeak({ env, docID }) {
  const b = await env.newBrowser()
  const r = await b.call(
    'POST',
    '/api/v1/admin/users',
    { username: 'forbidden', email: 'forbidden@test.invalid' },
    true,
  )
  status(r, 401, 'buat user tanpa sesi')
  notContains(r, FIXTURE_PASSWORD, 'password bocor di respons')
  notContains(r, 'password_hash', 'nama kolom hash bocor di respons')

  truthy(docID, 'docID belum ada — skenario 09 gagal lebih dulu')
  const audit = await env.pool.query(
    `SELECT count(*)::int AS n FROM sdl_audit_events
      WHERE event_key='urmin.surat_masuk.created' AND subject_id=$1`,
    [docID],
  )
  equal(audit.rows[0].n, 1, 'jejak audit pembuatan dokumen')
}
