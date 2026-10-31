/**
 * ENGINE A — mesin kebijakan RBAC + grant berskop.
 * Port langsung dari apps/backend/internal/access/policy.go.
 *
 * Fungsi murni: tidak menyentuh database, tidak menyentuh jam sistem. Seluruh
 * masukan diberikan pemanggil, sehingga perilakunya dapat diuji tanpa apa pun.
 *
 * Menolak secara default. Izin diberikan HANYA kalau permission RBAC dan grant
 * berskop yang cocok sama-sama lolos. Superadmin tidak pernah mendapat hak di
 * sini — pengecualiannya diurus pemanggil, bukan mesin ini.
 *
 * Dipakai oleh: urmin, subbagren, directives, executive/v2.
 * JANGAN digabung dengan Engine B (unitwork.permit) — keduanya memutuskan
 * dengan cara yang berbeda, dan penggabungan mengubah hak akses secara senyap.
 */

/** Prefix permission wajib cocok dengan unit dokumen. */
const UNIT_BY_PREFIX = Object.freeze({
  'urmin.': 'urmin',
  'subbagren.': 'subbagren',
  'subbagsumda.': 'subbagsumda',
  'subbagbinfung.': 'subbagbinfung',
})

const VALID_CLASSIFICATIONS = Object.freeze(['biasa', 'penting'])

/** Hasil keputusan. `reason` ikut dibawa supaya penolakan bisa ditelusuri. */
function deny(reason) {
  return { allow: false, reason }
}

function allow(reason) {
  return { allow: true, reason }
}

/**
 * @param {string} userId
 * @param {string} permission            mis. "urmin.surat_masuk.read"
 * @param {object} resource              { unit, creatorId, assignedUserIds, classification, status }
 * @param {object[]} grants              { roleActive, hasPermission, unit, scope, classificationLimit, expiresAt }
 * @param {Date} now
 */
export function evaluate(userId, permission, resource, grants, now) {
  if (!userId || !permission || !resource?.unit) return deny('invalid_context')

  // Grant berskop satu unit tidak boleh mengizinkan endpoint modul lain.
  for (const [prefix, unit] of Object.entries(UNIT_BY_PREFIX)) {
    if (permission.startsWith(prefix) && resource.unit !== unit) {
      return deny('permission_unit_mismatch')
    }
  }

  if (!VALID_CLASSIFICATIONS.includes(resource.classification)) {
    return deny('classification_denied')
  }

  // Batas alur kerja: ubah hanya saat draft, setujui hanya saat review.
  if (permission.endsWith('.update') && resource.status !== 'draft') return deny('workflow_denied')
  if (permission.endsWith('.approve') && resource.status !== 'review') return deny('workflow_denied')

  for (const grant of grants) {
    if (!grant.roleActive || !grant.hasPermission || grant.unit !== resource.unit) continue
    if (grant.expiresAt && now >= new Date(grant.expiresAt)) continue

    // Dokumen "penting" hanya terbuka untuk grant yang batas klasifikasinya
    // juga "penting".
    if (resource.classification === 'penting' && grant.classificationLimit !== 'penting') continue

    switch (grant.scope) {
      case 'unit':
        return allow('unit_grant')
      case 'own':
        if (resource.creatorId === userId) return allow('owner_grant')
        break
      case 'assigned':
        if ((resource.assignedUserIds ?? []).includes(userId)) return allow('assigned_grant')
        break
      default:
        break
    }
  }

  return deny('no_matching_grant')
}
