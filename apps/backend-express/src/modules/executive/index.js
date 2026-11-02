import { Router } from 'express'

import { authorizeOperational, authorizeRoleEditor } from '../../auth/guards.js'
import { writeJson } from '../../http/respond.js'
import { goTime } from '../../time.js'

/**
 * Ringkasan keputusan eksekutif, port dari
 * apps/backend/internal/httpapi/executive_v2.go.
 *
 * SATU-SATUNYA tempat Superadmin boleh membaca data operasional — dan bahkan di
 * sini yang dikembalikan hanya angka agregat. Tidak pernah dokumen sumber,
 * nama orang, lampiran, atau bukti keuangan individual.
 *
 * Dua peran dilayani dengan kumpulan metrik yang sama sekali berbeda:
 *   admin  -> Superadmin, metrik identitas dan hak akses
 *   leader -> Kabagrenmin, metrik operasional lintas unit
 */

const PERIOD_OFFSETS = Object.freeze({
  '30d': 30,
  '90d': 90,
  '365d': 365,
})

/**
 * Padanan executiveV2Number: query yang gagal mengembalikan null, BUKAN error.
 * Itu degradasi yang disengaja — satu metrik yang tidak bisa dihitung tidak
 * boleh menjatuhkan seluruh dasbor. Jumlah metrik yang berhasil dilaporkan
 * lewat sourcesAvailable.
 */
async function countOrNull(pool, sql, params = []) {
  try {
    const { rows } = await pool.query(sql, params)
    return Number(Object.values(rows[0])[0])
  } catch {
    return null
  }
}

/**
 * Padanan executiveV2Access. Mengembalikan 'admin', 'leader', atau '' (ditolak).
 * Sesi admin TIDAK BISA jatuh ke akses operasional.
 */
async function resolveAccess(pool, req, config) {
  const asEditor = await authorizeRoleEditor(pool, req, config)
  if (asEditor.status === 200) {
    const { rows } = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM sdl_users u
          JOIN sdl_user_roles sr ON sr.user_id=u.id AND sr.role_key='superadmin'
          JOIN sdl_roles ro ON ro.role_key=sr.role_key AND ro.is_active
         WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password) AS ok`,
      [asEditor.userId],
    )
    return rows[0].ok ? { kind: 'admin', userId: asEditor.userId } : { kind: '' }
  }

  const asOperational = await authorizeOperational(pool, req, config)
  if (asOperational.status !== 200) return { kind: '' }

  // Jalur pemimpin menuntut grant br_kabagrenmin ber-scope unit di urmin,
  // DAN permission dashboard.cross_unit.read.
  const { rows } = await pool.query(
    `SELECT EXISTS(
       SELECT 1 FROM sdl_users u
         JOIN sdl_access_grants g ON g.user_id=u.id AND g.role_key='br_kabagrenmin'
              AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
         JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
         JOIN sdl_user_units uu ON uu.user_id=g.user_id AND uu.unit_key=g.unit_key
         JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active
         JOIN sdl_role_permissions rp ON rp.role_key=g.role_key
              AND rp.permission_key='dashboard.cross_unit.read'
        WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password
          AND g.unit_key='urmin' AND g.scope='unit'
          AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sa
                          WHERE sa.user_id=u.id AND sa.role_key='superadmin')) AS ok`,
    [asOperational.userId],
  )
  return rows[0].ok ? { kind: 'leader', userId: asOperational.userId } : { kind: '' }
}

/** Mengumpulkan metrik dan sorotan, sekaligus menjaga urutannya tetap sama. */
function createCollector() {
  const metrics = []
  const attention = []
  return {
    metrics,
    attention,
    add(key, label, unit, detail, action, scope, value) {
      metrics.push({ key, label, unit, value, detail, action, scope })
    },
    /** Sorotan hanya muncul kalau nilainya ada DAN lebih dari nol. */
    flag(key, severity, title, description, action, unit, value) {
      if (value !== null && value > 0) {
        attention.push({ key, severity, title, description, count: value, action, unit })
      }
    },
  }
}

async function collectAdminMetrics(pool, collector) {
  const { add, flag } = collector
  const total = await countOrNull(pool, 'SELECT count(*) FROM sdl_users')
  const active = await countOrNull(pool, 'SELECT count(*) FROM sdl_users WHERE is_active')
  const rotate = await countOrNull(pool, 'SELECT count(*) FROM sdl_users WHERE is_active AND must_change_password')
  const grants = await countOrNull(
    pool,
    'SELECT count(*) FROM sdl_access_grants WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())',
  )
  const expiring = await countOrNull(
    pool,
    "SELECT count(*) FROM sdl_access_grants WHERE revoked_at IS NULL AND expires_at>now() AND expires_at<=now()+interval '7 days'",
  )

  add('users_total', 'Akun Terdaftar', 'AKUN', 'Seluruh akun yang tercatat', 'users', 'system', total)
  add('users_active', 'Akun Aktif', 'AKUN', 'Akun yang aktif saat ini', 'users', 'system', active)
  add('users_rotate', 'Wajib Ganti Password', 'AKUN', 'Akun aktif yang belum menyelesaikan pergantian password', 'users', 'system', rotate)
  add('grants_active', 'Akses Aktif', 'GRANT', 'Grant kewenangan yang masih berlaku', 'roles', 'system', grants)
  add('grants_expiring', 'Akses Segera Berakhir', 'GRANT', 'Grant yang berakhir dalam 7 hari', 'roles', 'system', expiring)

  flag('users_rotate', 'warning', 'Akun membutuhkan tindakan', 'Pastikan pergantian password selesai sebelum akun digunakan.', 'users', 'Administrasi', rotate)
  flag('grants_expiring', 'warning', 'Grant akses mendekati kedaluwarsa', 'Periksa kebutuhan perpanjangan atau pencabutan akses.', 'roles', 'Hak Akses', expiring)
}

async function collectLeaderMetrics(pool, collector, { since, leaderId }) {
  const { add, flag } = collector

  const incoming = await countOrNull(pool, "SELECT count(*) FROM sdl_urmin_incoming WHERE status='registered' AND created_at >= $1", [since])
  const outgoing = await countOrNull(pool, "SELECT count(*) FROM sdl_urmin_registry WHERE kind='surat_keluar' AND deleted_at IS NULL AND created_at >= $1", [since])
  const tasks = await countOrNull(pool, "SELECT count(*) FROM sdl_urmin_disposition_tasks WHERE status IN ('pending','in_progress')")
  const overdue = await countOrNull(
    pool,
    "SELECT count(*) FROM sdl_urmin_disposition_tasks WHERE status IN ('pending','in_progress') AND due_date<(now() AT TIME ZONE 'Asia/Jakarta')::date",
  )
  const awaiting = await countOrNull(
    pool,
    `SELECT count(*) FROM sdl_urmin_incoming_intake i
      WHERE i.route_status='awaiting_kabag'
        AND NOT EXISTS(SELECT 1 FROM sdl_urmin_distributions d
                        WHERE d.incoming_id=i.incoming_id AND d.sent_by=i.kabag_recipient
                          AND d.recipient_user<>d.sent_by)`,
  )

  add('incoming', 'Surat Masuk', 'SURAT', 'Terdaftar pada periode terpilih', 'urmin', 'urmin', incoming)
  add('outgoing', 'Surat Keluar', 'SURAT', 'Terdaftar pada periode terpilih', 'urmin', 'urmin', outgoing)
  add('active_tasks', 'Disposisi Berjalan', 'TUGAS', 'Kondisi aktif saat ini', 'urmin', 'urmin', tasks)
  add('overdue_tasks', 'Disposisi Terlambat', 'TUGAS', 'Melewati tenggat dan belum selesai', 'urmin', 'urmin', overdue)
  add('awaiting_leader', 'Menunggu Arahan Kabag', 'SURAT', 'Surat masuk yang belum ditindaklanjuti Kabag', 'urmin', 'urmin', awaiting)

  flag('overdue_tasks', 'danger', 'Disposisi melewati tenggat', 'Tinjau tugas yang terlambat dan tentukan tindak lanjut.', 'urmin', 'URMIN', overdue)
  flag('awaiting_leader', 'warning', 'Surat menunggu arahan', 'Buka Inbox URMIN untuk menindaklanjuti surat yang menunggu.', 'urmin', 'URMIN', awaiting)

  // Metrik arahan hanya ditambahkan kalau pemanggil lolos guard operasional.
  if (leaderId) {
    const unack = await countOrNull(
      pool,
      `SELECT count(*) FROM sdl_leadership_directive_recipients rr
         JOIN sdl_leadership_directives d ON d.id=rr.directive_id
        WHERE d.issuer_id=$1::uuid AND rr.acknowledged_at IS NULL`,
      [leaderId],
    )
    const urgent = await countOrNull(
      pool,
      `SELECT count(*) FROM sdl_leadership_directive_recipients rr
         JOIN sdl_leadership_directives d ON d.id=rr.directive_id
        WHERE d.issuer_id=$1::uuid AND rr.acknowledged_at IS NULL
          AND d.due_at IS NOT NULL AND d.due_at<now()`,
      [leaderId],
    )
    add('unack', 'Arahan Belum Diterima', 'PENERIMA', 'Konfirmasi staf yang belum masuk', 'arahan', 'arahan', unack)
    add('urgent_directives', 'Arahan Melewati Tenggat', 'PENERIMA', 'Penerima belum konfirmasi dan tenggat terlewati', 'arahan', 'arahan', urgent)
    flag('urgent_directives', 'danger', 'Arahan perlu eskalasi', 'Tenggat telah lewat dan konfirmasi belum diterima.', 'arahan', 'Arahan Pimpinan', urgent)
    flag('unack', 'warning', 'Konfirmasi arahan belum lengkap', 'Pantau penerima yang belum mengonfirmasi instruksi.', 'arahan', 'Arahan Pimpinan', unack)
  }

  const pendingBudget = await countOrNull(pool, "SELECT count(*) FROM sdl_subbagren_pagu WHERE status='pending'")
  add('pagu_pending', 'Pagu Menunggu Verifikasi', 'ITEM', 'Pengajuan dengan status menunggu', 'ren', 'ren', pendingBudget)
  flag('pagu_pending', 'warning', 'Pagu perlu verifikasi', 'Tinjau antrean perencanaan dan pengendalian anggaran.', 'ren', 'SUBBAGREN', pendingBudget)

  const assets = await countOrNull(
    pool,
    `SELECT count(*) FROM sdl_sumda_registry s
       JOIN sdl_unit_work_records w ON w.id=s.work_record_id AND w.deleted_at IS NULL
      WHERE s.deleted_at IS NULL AND s.kind='inventaris'
        AND lower(trim(s.fields->>'kondisi')) IN ('rusak','rusak berat','rusak ringan','tidak layak')`,
  )
  add('assets_care', 'Inventaris Perlu Perhatian', 'ASET', 'Kondisi rusak atau tidak layak pada register', 'sumda', 'sumda', assets)
  flag('assets_care', 'warning', 'Inventaris perlu penanganan', 'Periksa data kondisi aset dan kebutuhan pemeliharaan.', 'sumda', 'SUBBAGSUMDA', assets)

  const sop = await countOrNull(
    pool,
    `SELECT count(*) FROM sdl_binfung_registry s
       JOIN sdl_unit_work_records w ON w.id=s.work_record_id AND w.deleted_at IS NULL
      WHERE s.deleted_at IS NULL AND s.kind='sop'
        AND lower(trim(coalesce(s.fields->>'statusDokumen',''))) NOT IN ('final','disahkan','berlaku','approved')`,
  )
  add('sop_draft', 'SOP Belum Final', 'ITEM', 'Berdasarkan status metadata, bukan pengesahan resmi', 'binfung', 'binfung', sop)
  flag('sop_draft', 'info', 'SOP perlu penyelesaian', 'Periksa dokumen SOP yang belum berstatus final.', 'binfung', 'SUBBAGBINFUNG', sop)
}

/** Tren 6 bulan surat masuk. Gagal = trendAvailable false, bukan error. */
async function collectTrend(pool) {
  try {
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc('month',created_at AT TIME ZONE 'Asia/Jakarta'),'YYYY-MM') AS month,
              count(*) AS value
         FROM sdl_urmin_incoming
        WHERE status='registered'
          AND created_at >= (date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta') - interval '5 months'
        GROUP BY 1 ORDER BY 1`,
    )
    return { trend: rows.map((row) => ({ month: row.month, value: Number(row.value) })), trendAvailable: true }
  } catch {
    return { trend: null, trendAvailable: false }
  }
}

export function createExecutiveRouter({ pool, config }) {
  const router = Router()

  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      next(error)
    }
  }

  // ---- GET /access ----
  router.get('/access', handle(async (req, res) => {
    let access
    try {
      access = await resolveAccess(pool, req, config)
    } catch {
      writeJson(res, 503, { error: 'summary_unavailable' })
      return
    }
    if (access.kind === '') {
      writeJson(res, 403, { error: 'access_denied' })
      return
    }
    writeJson(res, 200, { kind: access.kind })
  }))

  // ---- GET /overview ----
  router.get('/overview', handle(async (req, res) => {
    let access
    try {
      access = await resolveAccess(pool, req, config)
    } catch {
      writeJson(res, 503, { error: 'summary_unavailable' })
      return
    }
    if (access.kind === '') {
      writeJson(res, 403, { error: 'access_denied' })
      return
    }

    let period = String(req.query.period ?? '').trim()
    let since = new Date(Date.UTC(2000, 0, 1))
    if (period === '') period = '90d'
    if (period in PERIOD_OFFSETS) {
      since = new Date(Date.now() - PERIOD_OFFSETS[period] * 24 * 60 * 60 * 1000)
    } else if (period !== 'all') {
      writeJson(res, 400, { error: 'invalid_period' })
      return
    }

    const collector = createCollector()
    // trend tetap null untuk jalur admin — di Go ia slice nil, yang
    // diserialkan sebagai null, bukan array kosong.
    let trendResult = { trend: null, trendAvailable: false }

    if (access.kind === 'admin') {
      await collectAdminMetrics(pool, collector)
    } else {
      const operational = await authorizeOperational(pool, req, config)
      await collectLeaderMetrics(pool, collector, {
        since,
        leaderId: operational.status === 200 ? operational.userId : undefined,
      })
      trendResult = await collectTrend(pool)
    }

    const available = collector.metrics.filter((metric) => metric.value !== null).length

    writeJson(res, 200, {
      kind: access.kind,
      generatedAt: goTime(),
      period,
      metrics: collector.metrics,
      attention: collector.attention,
      trend: trendResult.trend,
      trendAvailable: trendResult.trendAvailable,
      sourcesAvailable: available,
      sourcesTotal: collector.metrics.length,
      asOf: 'live',
    })
  }))

  return router
}
