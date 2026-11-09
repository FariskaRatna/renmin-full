import express from 'express'

import { createAuthRouter } from './auth/routes.js'
import { Mailer } from './auth/mailer.js'
import { requireOperational, requireRoleEditor } from './auth/guards.js'
import { errorHandler, notFound, requestId, securityHeaders } from './http/middleware.js'
import { writeJson } from './http/respond.js'
import { createAdminRouter } from './modules/admin/index.js'
import { createBinfungRouter } from './modules/unitwork/binfung.js'
import { createSumdaRouter } from './modules/unitwork/sumda.js'
import { createKodeArsipRouter, createJenisSuratRouter } from './modules/unitwork/kode-arsip.js'
import { createSuratOpsiRouter } from './modules/unitwork/surat-opsi.js'
import { createMasterDataRouter } from './modules/unitwork/master-data.js'
import { createUrminRegisterRouter } from './modules/unitwork/urmin-register.js'
import { createUnitWorkRouter } from './modules/unitwork/work.js'
import { createPortalRouter } from './modules/portal/index.js'
import { createBudgetRouter } from './modules/subbagren/budget.js'
import { createUsulanRouter } from './modules/subbagren/usulan.js'
import { createExecutiveRouter } from './modules/executive/index.js'
import { createDirectivesRouter } from './modules/directives/index.js'
import { createDispositionsRouter } from './modules/urmin/dispositions.js'
import { createDistributionInboxRouter } from './modules/urmin/distribution-inbox.js'
import { createSuratMasukRouter } from './modules/urmin/surat-masuk.js'

/**
 * Perakitan router, padanan NewRouterWithAuth (internal/httpapi/router.go:32).
 *
 * URUTAN PENDAFTARAN ADALAH KONTRAK. chi memakai radix tree sehingga segmen
 * statis selalu menang atas parameter, apa pun urutan deklarasinya. Express
 * mencocokkan BERURUTAN — route statis wajib didaftarkan sebelum `:param` yang
 * setara, kalau tidak ia tidak akan pernah tereksekusi.
 *
 * Tahap 2 baru memasang /api/v1/auth. Mount lain menyusul di Tahap 4.
 */
export function createApp({ pool, config, mailer: injectedMailer }) {
  const app = express()

  // Go membaca RemoteAddr langsung dan SENGAJA tidak mempercayai header
  // X-Forwarded-For. 'trust proxy' dibiarkan mati supaya req.socket.remoteAddress
  // tetap jadi sumber IP, sama seperti remoteIP() di captcha.go:26.
  app.set('trust proxy', false)
  app.disable('x-powered-by')
  app.set('etag', false)

  app.use(requestId)
  app.use(securityHeaders)

  // Satu Mailer dipakai bersama lapisan auth dan worker outbox, meniru
  // main.go yang membuat `smtpMailer` sekali lalu menyerahkannya ke keduanya.
  const mailer = injectedMailer ?? new Mailer(config.smtp)

  // ---- Di luar /api/v1 ----
  app.get('/healthz', (req, res) => {
    writeJson(res, 200, { status: 'alive' })
  })

  app.get('/readyz', async (req, res) => {
    const ready = await pingDatabase(pool)
    if (!ready) {
      writeJson(res, 503, { status: 'unavailable' })
      return
    }
    writeJson(res, 200, { status: 'ready' })
  })

  // ---- /api/v1 ----
  const v1 = express.Router()
  v1.use('/auth', createAuthRouter({ pool, config, mailer }))

  // Modul identitas: Superadmin + identity.roles.manage.
  v1.use('/admin', requireRoleEditor(pool, config), createAdminRouter({ pool, config }))
  // R5G12: master data persuratan. Guard Superadmin yang sama dengan /admin
  // lainnya — ini konfigurasi, bukan pekerjaan unit. Mount terpisah supaya
  // /master/:set tidak bersaing dengan route ber-parameter di createAdminRouter.
  v1.use('/admin', requireRoleEditor(pool, config), createMasterDataRouter({ pool }))

  // Modul operasional: Superadmin justru DITOLAK di sini.
  const operational = requireOperational(pool, config)
  v1.use('/subbagsumda/registry', operational, createSumdaRouter({ pool, config }))
  v1.use('/subbagbinfung/registry', operational, createBinfungRouter({ pool, config }))
  v1.use('/urmin/registry', operational, createUrminRegisterRouter({ pool, config }))
  // R5G10: master kode arsip. Mount sendiri, BUKAN sub-path /urmin/registry —
  // di sana ia akan bersaing dengan /:id, dan Express mencocokkan route secara
  // berurutan sehingga segmen statis tidak otomatis menang.
  v1.use('/urmin/kode-arsip', operational, createKodeArsipRouter({ pool }))
  v1.use('/urmin/jenis-surat', operational, createJenisSuratRouter({ pool }))
  v1.use('/urmin/surat-opsi', operational, createSuratOpsiRouter({ pool }))
  v1.use('/unit-work', operational, createUnitWorkRouter({ pool, config }))
  v1.use('/subbagren/usulan', operational, createUsulanRouter({ pool, config }))
  v1.use('/subbagren/budget', operational, createBudgetRouter({ pool, config }))
  v1.use('/leadership/directives', operational, createDirectivesRouter({ pool, config }))
  v1.use('/urmin/surat-masuk', operational, createSuratMasukRouter({ pool, config }))
  v1.use('/urmin/distribution-inbox', operational, createDistributionInboxRouter({ pool, config }))
  v1.use('/urmin/dispositions', operational, createDispositionsRouter({ pool, config }))

  // Guard ad-hoc, bukan salah satu dari dua engine. Keduanya memasang
  // pemeriksanya sendiri di dalam router.
  v1.use('/portal/posts', createPortalRouter({ pool, config }))
  v1.use('/executive/v2', createExecutiveRouter({ pool, config }))

  v1.get('/system/status', async (req, res) => {
    const ready = await pingDatabase(pool)
    if (!ready) {
      writeJson(res, 503, {
        service: 'siera-delta-lima',
        phase: 'urmin-r5d',
        status: 'unavailable',
      })
      return
    }
    writeJson(res, 200, {
      service: 'siera-delta-lima',
      phase: 'urmin-r5d',
      status: 'ready',
      demoSuperadminWorkspace: config.demoSuperadminWorkspace,
    })
  })

  app.use('/api/v1', v1)

  app.use(notFound)
  app.use(errorHandler)

  return app
}

/** Padanan db.Ping dengan timeout 2 detik (router.go:49). */
async function pingDatabase(pool) {
  if (!pool) return false
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
    ])
    return true
  } catch {
    return false
  }
}
