import { evaluate } from './policy.js'
import { isDemoSuperadmin } from './devdemo.js'

/**
 * Pemuat grant untuk Engine A, port dari internal/access/database.go.
 *
 * Titik masuk yang WAJIB dipakai setiap handler record operasional. Resource
 * harus dimuat dari PostgreSQL oleh handler — metadata dari klien tidak pernah
 * boleh dipercaya.
 *
 * Error diperlakukan sebagai DENY (503), bukan allow. Itu keputusan desain:
 * otorisasi yang tidak bisa dipastikan berarti ditolak.
 */

const OPERATIONAL_ELIGIBILITY = `
  SELECT EXISTS(SELECT 1 FROM sdl_users u
     WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
       AND NOT EXISTS (SELECT 1 FROM sdl_user_roles sur
                        WHERE sur.user_id=u.id AND sur.role_key='superadmin')) AS ok`

/**
 * Permission efektif adalah IRISAN antara permission milik role dan batasan
 * pada grant yang SAMA. Grant lain tidak bisa meminjamkan scope yang lebih luas
 * kepada sebuah role.
 *
 * Cabang kedua (UNION ALL) menangani delegasi, dan syaratnya berlapis:
 * grant sumber harus masih hidup dan ber-scope 'unit', pemberi harus aktif,
 * role tidak boleh superadmin, kedua pihak harus satu unit, masa berlaku
 * delegasi tidak boleh melampaui sumbernya, batas klasifikasi tidak boleh naik,
 * permission harus ada di daftar delegasi, hanya verb read/create/update yang
 * bisa didelegasikan, dan role dengan permission identity.% atau audit.%
 * diblokir. (Ditulis dengan wildcard SQL, bukan tanda bintang: urutan karakter
 * bintang-garis-miring menutup blok komentar ini lebih awal.)
 *
 * Disalin verbatim. Menulis ulang SQL ini dengan kata-kata sendiri adalah cara
 * tercepat kehilangan satu syarat tanpa ada yang menyadarinya.
 */
const GRANT_QUERY = `
SELECT g.unit_key,g.scope,g.classification_limit,g.expires_at
 FROM sdl_access_grants g
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
 JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key=$2
 JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active
 JOIN sdl_user_units uu ON uu.user_id=g.user_id AND uu.unit_key=g.unit_key
 WHERE g.user_id=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>$3)
 UNION ALL
 SELECT d.unit_key,d.scope,d.classification_limit,LEAST(d.expires_at,COALESCE(source.expires_at,d.expires_at))
 FROM sdl_access_delegations d
 JOIN sdl_access_grants source ON source.id=d.source_grant_id
  AND source.user_id=d.grantor_id AND source.role_key=d.role_key AND source.unit_key=d.unit_key
  AND source.scope='unit' AND source.revoked_at IS NULL
 JOIN sdl_users origin ON origin.id=d.grantor_id AND origin.is_active AND NOT origin.must_change_password
 JOIN sdl_roles ro ON ro.role_key=d.role_key AND ro.is_active AND ro.role_key<>'superadmin'
 JOIN sdl_role_permissions rp ON rp.role_key=d.role_key AND rp.permission_key=$2
 JOIN sdl_org_units ou ON ou.unit_key=d.unit_key AND ou.is_active
 JOIN sdl_user_units uuo ON uuo.user_id=d.grantor_id AND uuo.unit_key=d.unit_key
 JOIN sdl_user_units uur ON uur.user_id=d.grantee_id AND uur.unit_key=d.unit_key
 WHERE d.grantee_id=$1 AND d.revoked_at IS NULL AND d.expires_at>$3
 AND (source.expires_at IS NULL OR source.expires_at>$3)
 AND (source.expires_at IS NULL OR d.expires_at<=source.expires_at)
 AND (source.classification_limit='penting' OR d.classification_limit='biasa')
 AND $2=ANY(d.permission_keys)
 AND ($2 LIKE 'urmin.%.read' OR $2 LIKE 'urmin.%.create' OR $2 LIKE 'urmin.%.update'
 OR $2 LIKE 'subbagren.%.read' OR $2 LIKE 'subbagren.%.create' OR $2 LIKE 'subbagren.%.update'
 OR $2 LIKE 'subbagsumda.%.read' OR $2 LIKE 'subbagsumda.%.create' OR $2 LIKE 'subbagsumda.%.update'
 OR $2 LIKE 'subbagbinfung.%.read' OR $2 LIKE 'subbagbinfung.%.create' OR $2 LIKE 'subbagbinfung.%.update')
 AND NOT EXISTS(SELECT 1 FROM sdl_role_permissions blocked WHERE blocked.role_key=d.role_key
                AND (blocked.permission_key LIKE 'identity.%' OR blocked.permission_key LIKE 'audit.%'))`

const DENIED = Object.freeze({ allow: false, reason: 'no_matching_grant' })

/**
 * @returns {Promise<{allow: boolean, reason: string}>}
 * @throws kalau database gagal — pemanggil WAJIB memetakannya ke 503, bukan allow.
 */
export async function evaluateForUser(pool, userId, permission, resource, now = new Date()) {
  if (!pool || !userId || !permission) return DENIED

  // Superadmin bersifat administratif saja, termasuk di workspace demo lokal.
  if (await isDemoSuperadmin(pool, userId)) return DENIED

  const eligibility = await pool.query(OPERATIONAL_ELIGIBILITY, [userId])
  if (!eligibility.rows[0].ok) return DENIED

  const { rows } = await pool.query(GRANT_QUERY, [userId, permission, now])
  const grants = rows.map((row) => ({
    roleActive: true,
    hasPermission: true,
    unit: row.unit_key,
    scope: row.scope,
    classificationLimit: row.classification_limit,
    expiresAt: row.expires_at,
  }))

  return evaluate(userId, permission, resource, grants, now)
}
