import { Router } from 'express'

import { writeJson } from '../../http/respond.js'
import { createRolesRouter } from '../roles/index.js'
import { createRoadmapRouter } from '../roadmap/index.js'
import { createUsersRouter } from '../users/index.js'

/**
 * Perakitan /api/v1/admin, padanan router.go:226-256.
 *
 * URUTAN PENDAFTARAN PENTING. Go memasang roles, lalu roadmap, lalu penolak
 * delegasi, lalu users. Di Express urutan itu dipertahankan, dan rute statis
 * `/delegations` serta `/delegation-candidates` didaftarkan sebelum apa pun
 * yang bisa menangkapnya lebih dulu.
 */
export function createAdminRouter({ pool, config }) {
  const router = Router()

  router.use(createRolesRouter({ pool, config }))
  router.use(createRoadmapRouter({ pool, config }))

  /**
   * Delegasi SENGAJA ditutup rapat.
   *
   * Superadmin adalah administrator identitas dan role, bukan administrator
   * delegasi atau operasional. Endpoint-nya dicadangkan tapi gagal tertutup
   * sampai ada kebijakan persetujuan non-Superadmin yang khusus.
   *
   * Di Go ini memakai HandleFunc, yang berlaku untuk SEMUA method — jadi
   * router.all(), bukan router.get(). Paket internal/delegations (411 baris)
   * tidak pernah dipasang; hanya perilaku 403-nya yang diporting.
   */
  const denyDelegation = (req, res) => {
    writeJson(res, 403, { error: 'access_denied' })
  }
  router.all('/delegations', denyDelegation)
  router.all('/delegations/*splat', denyDelegation)
  router.all('/delegation-candidates', denyDelegation)

  router.use(createUsersRouter({ pool, config }))

  return router
}
