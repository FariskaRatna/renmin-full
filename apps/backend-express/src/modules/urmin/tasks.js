import { isDemoSuperadmin } from '../../access/devdemo.js'
import { recipientEligible, UUID_RE, validDate } from './shared.js'

/**
 * Tugas disposisi, port dari internal/urmin/r3c.go dan r3d.go.
 *
 * Diletakkan terpisah karena dipakai DUA mount: `surat-masuk` memakainya untuk
 * `/disposition-tracking` dan untuk akses lampiran oleh penerima disposisi,
 * sedangkan mount `dispositions` nanti memakainya seluruhnya. Menyalinnya dua
 * kali berarti `taskChainValid` bisa tertinggal di salah satu tempat saat
 * aturan rantainya berubah.
 */

const UNITS = ['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung']

const DISPOSITION_PERMISSIONS = [
  'urmin.disposisi.issue',
  'urmin.disposisi.execute',
  'urmin.disposisi.review',
  'urmin.disposisi.forward',
  'urmin.disposisi.final.submit',
]

export const TASK_SELECT = `SELECT t.id::text AS id,t.distribution_id::text AS distribution_id,t.incoming_id::text AS incoming_id,
  i.letter_number,i.subject,i.classification,t.unit_key,t.issued_by::text AS issued_by,issuer.display_name AS issuer_name,
  t.assigned_to::text AS assigned_to,assignee.display_name AS assignee_name,t.instruction,t.due_date::text AS due_date,
  t.status,t.completion_note,t.created_at,t.accepted_at,t.completed_at,t.version,
  COALESCE(rev.decision,CASE WHEN t.status='completed' THEN 'awaiting_review' ELSE 'not_ready' END) AS review_status,
  rev.reason AS review_reason,reviewer.display_name AS reviewer_name,rev.created_at AS reviewed_at,
  t.parent_task_id::text AS parent_task_id,t.depth
 FROM sdl_urmin_disposition_tasks t
 JOIN sdl_urmin_incoming i ON i.id=t.incoming_id
 JOIN sdl_users issuer ON issuer.id=t.issued_by
 JOIN sdl_users assignee ON assignee.id=t.assigned_to
 LEFT JOIN sdl_urmin_disposition_reviews rev ON rev.disposition_id=t.id
 LEFT JOIN sdl_users reviewer ON reviewer.id=rev.reviewed_by`

/**
 * Padanan dispositionSLA (r3d.go:15).
 *
 * Perhatikan batas "terlambat": tugas selesai dianggap tepat waktu kalau
 * selesainya SEBELUM due + 24 jam, bukan sebelum due. Jadi menyelesaikan pada
 * hari jatuh tempo masih tepat waktu sepanjang hari.
 */
export function dispositionSLA(task, now) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task.dueDate ?? '')) return 'unknown'
  const due = new Date(`${task.dueDate}T00:00:00Z`)
  if (Number.isNaN(due.getTime())) return 'unknown'

  if (task.status === 'completed') {
    if (!task.completedAt) return 'unknown'
    const completed = new Date(task.completedAt)
    if (completed.getTime() >= due.getTime() + 24 * 60 * 60 * 1000) return 'completed_late'
    return 'completed_on_time'
  }
  if (now.toISOString().slice(0, 10) > task.dueDate) return 'overdue'
  return 'on_track'
}

/** Padanan struct dispositionTask (r3c.go:18) beserta scanTask. */
export function mapTask(row, now = new Date()) {
  const task = {
    id: row.id,
    distributionId: row.distribution_id,
    incomingId: row.incoming_id,
    letterNumber: row.letter_number,
    subject: row.subject,
    classification: row.classification,
    unit: row.unit_key,
    issuerId: row.issued_by,
    issuerName: row.issuer_name,
    assigneeId: row.assigned_to,
    assigneeName: row.assignee_name,
    instruction: row.instruction,
    dueDate: row.due_date,
    status: row.status,
    completionNote: row.completion_note ?? null,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at ?? null,
    completedAt: row.completed_at ?? null,
    version: Number(row.version),
    reviewStatus: row.review_status,
    reviewReason: row.review_reason ?? null,
    reviewerName: row.reviewer_name ?? null,
    reviewedAt: row.reviewed_at ?? null,
    slaStatus: '',
    parentTaskId: row.parent_task_id ?? null,
    depth: row.depth,
  }
  task.slaStatus = dispositionSLA(task, now)
  return task
}

export async function loadTask(pool, id) {
  const { rows } = await pool.query(`${TASK_SELECT} WHERE t.id=$1`, [id])
  return rows.length === 0 ? undefined : mapTask(rows[0])
}

/**
 * Padanan dispositionEligible (r3c.go:70).
 *
 * Berbeda dari recipientEligible: scope 'own' DITERIMA di sini, karena yang
 * dialamatkan adalah tugasnya sendiri, bukan register surat Urmin.
 */
export async function dispositionEligible(pool, user, unit, classification, permission) {
  if (!UUID_RE.test(user ?? '') || !UNITS.includes(unit)) return false
  if (classification !== 'biasa' && classification !== 'penting') return false
  if (!DISPOSITION_PERMISSIONS.includes(permission)) return false
  if (await isDemoSuperadmin(pool, user)) return false

  const { rows } = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM sdl_users u
     JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2
     JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=$2 AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at>now())
     JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active AND ro.role_key<>'superadmin'
     JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key=$4
     JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active
     WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
     AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
     AND ($3='biasa' OR g.classification_limit='penting')) AS ok`,
    [user, unit, classification, permission],
  )
  return rows[0].ok === true
}

/**
 * Padanan currentIssuer (r3c.go:95). Mencabut grant atas distribusi asal
 * sekaligus mencabut akses ke seluruh tugas turunannya.
 */
export async function currentIssuer(pool, distributionId, issuer, unit, classification) {
  const { rows } = await pool.query(
    'SELECT recipient_user::text AS owner,recipient_unit,status FROM sdl_urmin_distributions WHERE id=$1',
    [distributionId],
  )
  if (rows.length === 0) return false
  const row = rows[0]
  if (row.owner !== issuer || row.recipient_unit !== unit || row.status !== 'received') return false

  if (!(await recipientEligible(pool, issuer, unit, classification))) return false
  return dispositionEligible(pool, issuer, unit, classification, 'urmin.disposisi.issue')
}

/**
 * Padanan taskChainValid (r3c.go:117).
 *
 * Menelusuri SETIAP hop dari distribusi asal → induk → anak. Tidak ada akses
 * implisit se-unit, tidak ada grant basi, tidak ada siklus, dan tidak ada
 * jalur lebih dari dua kali teruskan (akar depth=0, daun depth<=2).
 */
export async function taskChainValid(pool, task) {
  const seen = new Set()
  let node = task
  for (;;) {
    if (node.depth < 0 || node.depth > 2 || seen.has(node.id)) return false
    seen.add(node.id)

    if (node.parentTaskId === null) {
      if (node.depth !== 0) return false
      return currentIssuer(pool, node.distributionId, node.issuerId, node.unit, node.classification)
    }
    if (node.depth === 0) return false

    const parent = await loadTask(pool, node.parentTaskId)
    if (!parent) return false
    if (
      parent.id === node.id ||
      parent.depth + 1 !== node.depth ||
      parent.incomingId !== node.incomingId ||
      parent.distributionId !== node.distributionId ||
      parent.unit !== node.unit ||
      parent.classification !== node.classification ||
      // Penerus WAJIB penerima tugas induk: rantai tidak boleh melompat orang.
      parent.assigneeId !== node.issuerId ||
      (parent.status !== 'in_progress' && parent.status !== 'completed')
    ) {
      return false
    }
    for (const permission of ['urmin.disposisi.execute', 'urmin.disposisi.forward']) {
      if (!(await dispositionEligible(pool, node.issuerId, node.unit, node.classification, permission))) {
        return false
      }
    }
    node = parent
  }
}

/** Padanan taskParty (r3c.go:153): penerbit selalu, penerima kalau masih layak. */
export async function taskParty(pool, user, task) {
  if (!(await taskChainValid(pool, task))) return false
  if (user === task.issuerId) return true
  if (user !== task.assigneeId) return false
  return dispositionEligible(pool, user, task.unit, task.classification, 'urmin.disposisi.execute')
}

/**
 * Padanan dispositionAttachmentAccess (r3c.go:169).
 *
 * Penerima tugas boleh membaca lampiran privat HANYA dari disposisinya sendiri
 * yang masih hidup. Jalur ini tidak pernah memberi hak melihat register surat
 * Urmin — itu sebabnya ia terpisah dari Engine A, bukan menambah permission.
 */
export async function dispositionAttachmentAccess(pool, user, doc) {
  if (!UUID_RE.test(user ?? '') || doc.status !== 'registered') return false
  const { rows } = await pool.query(
    `${TASK_SELECT} WHERE t.incoming_id=$1 AND t.assigned_to=$2 ORDER BY t.created_at DESC LIMIT 100`,
    [doc.id, user],
  )
  for (const row of rows) {
    if (await taskParty(pool, user, mapTask(row))) return true
  }
  return false
}

/**
 * Padanan validDispositionDue (r3c.go:261): tanggal sah, tidak di masa lalu,
 * dan tidak lebih dari satu tahun ke depan. Dihitung terhadap HARI INI UTC.
 */
export function validDispositionDue(value) {
  if (!validDate(value)) return false
  const today = new Date()
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  const due = new Date(`${value}T00:00:00Z`).getTime()
  if (due < todayUtc) return false
  const limit = new Date(todayUtc)
  limit.setUTCFullYear(limit.getUTCFullYear() + 1)
  return due <= limit.getTime()
}

/** Padanan dispositionReviewEligible (r3d.go:126). Helper murni, tanpa DB. */
export function dispositionReviewEligible(task, reviewer) {
  return (
    reviewer !== '' &&
    reviewer === task.issuerId &&
    task.status === 'completed' &&
    task.reviewStatus === 'awaiting_review'
  )
}

/**
 * Padanan forwardingAllowed (r3d2.go:15).
 *
 * Meneruskan adalah kemampuan BARU yang berdiri sendiri — tidak tersirat dari
 * `execute` maupun dari keanggotaan unit distribusinya. Kedalaman dibatasi 2,
 * jadi tugas pada depth 2 tidak bisa diteruskan lagi.
 */
export async function forwardingAllowed(pool, user, parent) {
  if (parent.assigneeId !== user || parent.status !== 'in_progress' || parent.depth >= 2) {
    return false
  }
  if (!(await taskParty(pool, user, parent))) return false
  return dispositionEligible(pool, user, parent.unit, parent.classification, 'urmin.disposisi.forward')
}

/**
 * Padanan dispositionPathUsers (r3d2.go:28).
 *
 * Mengembalikan SELURUH orang di sepanjang jalur, supaya tugas tidak bisa
 * dialihkan kembali ke penerbitnya atau ke pihak mana pun yang lebih awal —
 * termasuk kakek. Itu pencegahan siklus, bukan sekadar larangan menugasi diri.
 *
 * Melempar kalau rantainya tidak masuk akal; Go mengembalikan error dan
 * pemanggilnya memetakannya ke 503.
 */
export async function dispositionPathUsers(pool, task) {
  const blocked = new Set()
  const seen = new Set()
  let node = task
  for (;;) {
    if (seen.has(node.id) || seen.size > 3) throw new Error('invalid_disposition_chain')
    seen.add(node.id)
    blocked.add(node.issuerId)
    blocked.add(node.assigneeId)
    if (node.parentTaskId === null) return blocked
    const parent = await loadTask(pool, node.parentTaskId)
    if (!parent) throw new Error('invalid_disposition_chain')
    node = parent
  }
}

const LEADERSHIP_PERMISSIONS = ['urmin.disposisi.final.monitor', 'urmin.disposisi.final.approve']

/**
 * Padanan leadershipAllowed (r3d3.go:18).
 *
 * Wewenang pimpinan TIDAK diwarisi dari hak baca. Ia menuntut grant
 * `br_kabagrenmin` yang masih hidup di unit DAN klasifikasi yang sama, untuk
 * setiap pembacaan maupun keputusan. Superadmin dilarang secara eksplisit
 * walau grant-nya keliru diberikan.
 */
export async function leadershipAllowed(pool, user, unit, classification, permission) {
  if (!UUID_RE.test(user ?? '') || !LEADERSHIP_PERMISSIONS.includes(permission)) return false
  if (classification !== 'biasa' && classification !== 'penting') return false
  if (!UNITS.includes(unit)) return false
  if (await isDemoSuperadmin(pool, user)) return false

  const { rows } = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM sdl_users u
     JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2
     JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=$2 AND g.role_key='br_kabagrenmin'
       AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>now())
     JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
     JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active
     JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key=$4
     WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
     AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
     AND ($3='biasa' OR g.classification_limit='penting')) AS ok`,
    [user, unit, classification, permission],
  )
  return rows[0].ok === true
}

/**
 * Padanan finalState (r3d3.go:54). Mengembalikan undefined kalau belum pernah
 * diajukan; pemanggil menggantinya dengan status 'not_submitted'.
 *
 * Field ber-`omitempty` di Go HILANG dari respons saat kosong, bukan muncul
 * sebagai null — jadi hanya yang terisi yang ditulis di sini.
 */
export async function finalState(pool, rootId) {
  const { rows } = await pool.query(
    `SELECT status,submitted_by::text AS submitted_by,submitted_at,decided_by::text AS decided_by,
       decided_at,decision_reason,version
     FROM sdl_urmin_final_approvals WHERE root_task_id=$1`,
    [rootId],
  )
  if (rows.length === 0) return undefined
  const row = rows[0]
  const state = { status: row.status, version: Number(row.version) }
  if (row.submitted_by !== null && row.submitted_by !== '') state.submittedBy = row.submitted_by
  if (row.submitted_at !== null) state.submittedAt = row.submitted_at
  if (row.decided_by !== null) state.decidedBy = row.decided_by
  if (row.decided_at !== null) state.decidedAt = row.decided_at
  if (row.decision_reason !== null) state.decisionReason = row.decision_reason
  return state
}

/** State sintetis untuk kasus yang belum pernah diajukan. */
export function notSubmitted() {
  return { status: 'not_submitted', version: 0 }
}

/**
 * Padanan progressPercent (r3d3.go:72). Sembilan puluh persen pertama mewakili
 * tugas yang sudah ditelaah dan disetujui; sisanya baru terisi oleh
 * persetujuan final. Pembagiannya INTEGER, seperti di Go.
 */
export function progressPercent(reviewed, total, status) {
  if (total <= 0) return 0
  if (status === 'approved') return 100
  return Math.floor((reviewed * 90) / total)
}

/** Dilempar saat ada mata rantai yang grant-nya sudah basi atau dicabut. */
export class ChainInactive extends Error {}

/**
 * Padanan taskProgress (r3d3.go:81).
 *
 * Menelusuri seluruh pohon tugas lewat WITH RECURSIVE, lalu memvalidasi ULANG
 * rantai setiap simpulnya. Itu mahal — satu loadTask plus satu taskChainValid
 * per simpul — tapi disengaja: satu mata rantai yang grant-nya dicabut membuat
 * seluruh kasus tidak bisa disetujui maupun dilaporkan, dan itu harus terdeteksi
 * di sini, bukan saat persetujuan final.
 */
export async function taskProgress(pool, root, finalStatus) {
  const { rows } = await pool.query(
    `WITH RECURSIVE chain AS (
       SELECT id,status FROM sdl_urmin_disposition_tasks WHERE id=$1
       UNION ALL
       SELECT c.id,c.status FROM sdl_urmin_disposition_tasks c JOIN chain p ON c.parent_task_id=p.id
     ) SELECT chain.id::text AS id,chain.status,COALESCE(r.decision,'') AS review
       FROM chain LEFT JOIN sdl_urmin_disposition_reviews r ON r.disposition_id=chain.id`,
    [root.id],
  )
  if (rows.length > 150) throw new Error('chain_exceeds_limit')

  const progress = { totalTasks: rows.length, reviewedApproved: 0, progressPercent: 0, readyForSubmission: rows.length > 0 }
  for (const node of rows) {
    if (node.status === 'completed' && node.review === 'approved') {
      progress.reviewedApproved += 1
    } else {
      progress.readyForSubmission = false
    }
    const task = await loadTask(pool, node.id)
    if (!task) throw new Error('task_vanished')
    if (!(await taskChainValid(pool, task))) throw new ChainInactive()
  }
  progress.progressPercent = progressPercent(progress.reviewedApproved, progress.totalTasks, finalStatus)
  return progress
}

/** Padanan autoCloseSimpleCandidate (r3d3.go:141). */
export function autoCloseSimpleCandidate(root, state, progress) {
  return (
    root.unit === 'urmin' && root.classification === 'biasa' &&
    root.parentTaskId === null && root.depth === 0 && state === 'not_submitted' &&
    progress.totalTasks === 1 && progress.reviewedApproved === 1 && progress.readyForSubmission
  )
}

/**
 * Padanan markSimpleDispositionComplete (r3d3.go:147).
 *
 * Pada alur demo Urmin yang pendek, Kabagrenmin yang menugaskan satu tugas
 * sudah menelaah dan menyetujui hasilnya. Telaah itu SEKALIGUS keputusan
 * penutup — tidak perlu pengajuan final kedua dari orang yang sama.
 *
 * Grant historis dipakai sebagai bukti peran saat menerbitkan, BUKAN sebagai
 * otorisasi: query di bawah sengaja tidak memeriksa `revoked_at` maupun
 * `expires_at`, supaya grant demo yang kedaluwarsa setelah 7 hari tidak
 * memutar balik penyelesaian yang sudah disetujui dari 100% menjadi 90%.
 * Visibilitas dan perubahan tetap lewat taskChainValid yang berlaku sekarang.
 *
 * Memutasi `state` dan `progress` di tempat, seperti pointer di Go.
 */
export async function markSimpleDispositionComplete(pool, root, state, progress) {
  if (!autoCloseSimpleCandidate(root, state.status, progress)) return
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM sdl_access_grants g
        WHERE g.user_id=$1 AND g.unit_key=$2 AND g.role_key='br_kabagrenmin'
          AND ($3='biasa' OR g.classification_limit='penting')
     ) AS ok`,
    [root.issuerId, root.unit, root.classification],
  )
  if (rows[0].ok !== true) return
  state.status = 'approved'
  progress.progressPercent = 100
  progress.readyForSubmission = false
  progress.autoClosed = true
}
