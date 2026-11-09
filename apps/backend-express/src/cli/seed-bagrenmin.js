#!/usr/bin/env node
/**
 * Provisioning 13 akun operasional BagRenmin, port dari
 * `apps/backend/cmd/seed-bagrenmin/main.go`.
 *
 * Alat PENGEMBANGAN LOKAL sekali jalan. Tidak pernah terpasang di HTTP API,
 * dan menolak jalan di luar `SDL_ENV=development` pada database selain
 * `sdl_root_dev`.
 *
 * Seluruhnya satu transaksi SERIALIZABLE: 13 role, 12 akun baru, plus
 * rekonsiliasi satu akun lama (`op-urmin`). Kalau ada satu saja yang gagal,
 * tidak ada yang tertulis — provisioning identitas setengah jadi jauh lebih
 * sulit dibereskan daripada yang gagal seluruhnya.
 *
 * Dijalankan:
 *   SDL_SEED_SUPERADMIN_USERNAME=<user> node src/cli/seed-bagrenmin.js -apply
 * dengan TIGA baris di stdin: password Superadmin, password awal, konfirmasi.
 */
import { hashPassword, verifyPassword } from '../crypto/password.js'
import { createPool } from '../db.js'

/**
 * Kolom kelima dan keenam adalah SCOPE dan BATAS KLASIFIKASI, dan keduanya
 * menentukan lebih banyak daripada yang terlihat. Urmin memberi `own` kepada
 * operator dan staf; tiga unit lain memberi `assigned`, yang di modul
 * Perencanaan/Anggaran TIDAK PERNAH cocok dengan dokumen apa pun karena
 * `AssignedUserIDs` tak pernah diisi handler. Lihat
 * `docs/PERTANYAAN-KONFIGURASI-AKSES.md` — asimetri itu sedang ditanyakan ke
 * pemilik sistem dan SENGAJA direplikasi apa adanya di sini sampai ada
 * jawaban.
 */
export const ACCOUNTS = [
  { username: 'op-urmin', name: 'Operator Urmin BagRenmin', unit: 'urmin', role: 'br_op_urmin', scope: 'own', classification: 'biasa' },
  { username: 'staf-urmin', name: 'Staf Urmin BagRenmin', unit: 'urmin', role: 'br_staf_urmin', scope: 'own', classification: 'biasa' },
  { username: 'ka-urmin', name: 'Kepala Urmin BagRenmin', unit: 'urmin', role: 'br_ka_urmin', scope: 'unit', classification: 'penting' },
  { username: 'op-subbagren', name: 'Operator Subbagren BagRenmin', unit: 'subbagren', role: 'br_op_subbagren', scope: 'assigned', classification: 'biasa' },
  { username: 'staf-subbagren', name: 'Staf Subbagren BagRenmin', unit: 'subbagren', role: 'br_staf_subbagren', scope: 'assigned', classification: 'biasa' },
  { username: 'kasubbagren', name: 'Kasubbagren BagRenmin', unit: 'subbagren', role: 'br_kasubbagren', scope: 'unit', classification: 'penting' },
  { username: 'op-subbagsumda', name: 'Operator Subbagsumda BagRenmin', unit: 'subbagsumda', role: 'br_op_subbagsumda', scope: 'assigned', classification: 'biasa' },
  { username: 'staf-subbagsumda', name: 'Staf Subbagsumda BagRenmin', unit: 'subbagsumda', role: 'br_staf_subbagsumda', scope: 'assigned', classification: 'biasa' },
  { username: 'kasubbagsumda', name: 'Kasubbagsumda BagRenmin', unit: 'subbagsumda', role: 'br_kasubbagsumda', scope: 'unit', classification: 'penting' },
  { username: 'op-subbagbinfung', name: 'Operator Subbagbinfung BagRenmin', unit: 'subbagbinfung', role: 'br_op_subbagbinfung', scope: 'assigned', classification: 'biasa' },
  { username: 'staf-subbagbinfung', name: 'Staf Subbagbinfung BagRenmin', unit: 'subbagbinfung', role: 'br_staf_subbagbinfung', scope: 'assigned', classification: 'biasa' },
  { username: 'kasubbagbinfung', name: 'Kasubbagbinfung BagRenmin', unit: 'subbagbinfung', role: 'br_kasubbagbinfung', scope: 'unit', classification: 'penting' },
  { username: 'kabagrenmin', name: 'Kabagrenmin', unit: 'urmin', role: 'br_kabagrenmin', scope: 'unit', classification: 'penting' },
]

/**
 * Kewenangan yang ditinjau satu per satu, BUKAN pemberian borongan. Tidak ada
 * `identity.*`, `audit.*`, maupun apa pun yang berbau superadmin — dan
 * `rosterValid()` di bawah menegakkannya, jadi menambahkannya di sini akan
 * menggagalkan alat ini alih-alih diam-diam lolos.
 */
export const ROLES = [
  { key: 'br_op_urmin', name: 'Operator Urmin', description: 'Petugas register dan distribusi surat yang dibuat sendiri.', permissions: ['urmin.surat_masuk.read', 'urmin.surat_masuk.create', 'urmin.surat_masuk.update', 'urmin.surat_masuk.attach', 'urmin.surat_masuk.download', 'urmin.surat_masuk.distribute'] },
  { key: 'br_staf_urmin', name: 'Staf Urmin', description: 'Staf administrasi surat yang dibuat sendiri.', permissions: ['urmin.surat_masuk.read', 'urmin.surat_masuk.create', 'urmin.surat_masuk.update', 'urmin.surat_masuk.attach', 'urmin.surat_masuk.download', 'urmin.agenda.read'] },
  { key: 'br_ka_urmin', name: 'Kepala Urmin', description: 'Pengawasan dokumen Urmin dalam lingkup unit.', permissions: ['urmin.surat_masuk.read', 'urmin.surat_masuk.create', 'urmin.surat_masuk.update', 'urmin.surat_masuk.attach', 'urmin.surat_masuk.download', 'urmin.surat_masuk.distribute', 'urmin.distribusi.receive', 'urmin.disposisi.read', 'urmin.agenda.read', 'dashboard.unit.read'] },
  { key: 'br_op_subbagren', name: 'Operator Subbagren', description: 'Petugas Subbagren dan inbox yang ditugaskan.', permissions: ['subbagren.perencanaan.read', 'subbagren.perencanaan.create', 'subbagren.perencanaan.update', 'urmin.distribusi.receive'] },
  { key: 'br_staf_subbagren', name: 'Staf Subbagren', description: 'Staf Subbagren dan inbox yang ditugaskan.', permissions: ['subbagren.perencanaan.read', 'subbagren.perencanaan.create', 'subbagren.perencanaan.update', 'subbagren.anggaran.read', 'subbagren.kinerja.read', 'urmin.distribusi.receive'] },
  { key: 'br_kasubbagren', name: 'Kasubbagren', description: 'Pimpinan operasional unit Subbagren.', permissions: ['subbagren.perencanaan.read', 'subbagren.perencanaan.create', 'subbagren.perencanaan.update', 'subbagren.perencanaan.approve', 'subbagren.anggaran.read', 'subbagren.anggaran.update', 'subbagren.kinerja.read', 'urmin.distribusi.receive', 'dashboard.unit.read'] },
  { key: 'br_op_subbagsumda', name: 'Operator Subbagsumda', description: 'Petugas personel/inventaris dan inbox yang ditugaskan.', permissions: ['subbagsumda.personel.read', 'subbagsumda.personel.create', 'subbagsumda.inventaris.read', 'subbagsumda.inventaris.create', 'urmin.distribusi.receive'] },
  { key: 'br_staf_subbagsumda', name: 'Staf Subbagsumda', description: 'Staf personel/inventaris dan inbox yang ditugaskan.', permissions: ['subbagsumda.personel.read', 'subbagsumda.personel.create', 'subbagsumda.personel.update', 'subbagsumda.inventaris.read', 'subbagsumda.inventaris.create', 'subbagsumda.inventaris.update', 'urmin.distribusi.receive'] },
  { key: 'br_kasubbagsumda', name: 'Kasubbagsumda', description: 'Pimpinan operasional unit Subbagsumda.', permissions: ['subbagsumda.personel.read', 'subbagsumda.personel.create', 'subbagsumda.personel.update', 'subbagsumda.inventaris.read', 'subbagsumda.inventaris.create', 'subbagsumda.inventaris.update', 'urmin.distribusi.receive', 'dashboard.unit.read'] },
  { key: 'br_op_subbagbinfung', name: 'Operator Subbagbinfung', description: 'Petugas SOP dan inbox yang ditugaskan.', permissions: ['subbagbinfung.sop.read', 'subbagbinfung.sop.create', 'urmin.distribusi.receive'] },
  { key: 'br_staf_subbagbinfung', name: 'Staf Subbagbinfung', description: 'Staf SOP/evaluasi dan inbox yang ditugaskan.', permissions: ['subbagbinfung.sop.read', 'subbagbinfung.sop.create', 'subbagbinfung.sop.update', 'subbagbinfung.evaluasi.read', 'urmin.distribusi.receive'] },
  { key: 'br_kasubbagbinfung', name: 'Kasubbagbinfung', description: 'Pimpinan operasional unit Subbagbinfung.', permissions: ['subbagbinfung.sop.read', 'subbagbinfung.sop.create', 'subbagbinfung.sop.update', 'subbagbinfung.sop.approve', 'subbagbinfung.evaluasi.read', 'subbagbinfung.evaluasi.update', 'urmin.distribusi.receive', 'dashboard.unit.read'] },
  { key: 'br_kabagrenmin', name: 'Kabagrenmin', description: 'Pimpinan BagRenmin, akses baca empat unit tanpa hak admin identitas.', permissions: ['urmin.surat_masuk.read', 'urmin.surat_masuk.download', 'urmin.distribusi.receive', 'urmin.surat_masuk.distribute', 'subbagren.perencanaan.read', 'subbagren.anggaran.read', 'subbagren.kinerja.read', 'subbagsumda.personel.read', 'subbagsumda.inventaris.read', 'subbagbinfung.sop.read', 'subbagbinfung.evaluasi.read', 'dashboard.unit.read', 'dashboard.cross_unit.read', 'urmin.surat_keluar.approve'] },
]

const KABAG_UNITS = ['urmin', 'subbagren', 'subbagsumda', 'subbagbinfung']

/** Pemeriksaan rencana SEBELUM menyentuh database. Padanan rosterValid(). */
export function rosterValid() {
  if (ACCOUNTS.length !== 13 || ROLES.length !== 13) throw new Error('expected 13 accounts and roles')
  const roleMap = new Map()
  for (const role of ROLES) {
    if (roleMap.has(role.key)) throw new Error(`duplicate role: ${role.key}`)
    if (role.key.startsWith('superadmin') || role.permissions.length === 0) {
      throw new Error('unsafe role definition')
    }
    for (const permission of role.permissions) {
      if (permission.startsWith('identity.') || permission.startsWith('audit.')) {
        throw new Error('privileged permission forbidden')
      }
    }
    roleMap.set(role.key, role)
  }
  const seen = new Set()
  for (const account of ACCOUNTS) {
    if (seen.has(account.username)) throw new Error(`duplicate username: ${account.username}`)
    seen.add(account.username)
    if (!roleMap.has(account.role)) throw new Error(`role undefined: ${account.role}`)
    if (!['own', 'assigned', 'unit'].includes(account.scope)) throw new Error('invalid scope')
    if (!['biasa', 'penting'].includes(account.classification)) throw new Error('invalid classification')
  }
}

/** `op-urmin` sudah ada sebelumnya; ia direkonsiliasi, bukan dibuat ulang. */
export function newAccounts() {
  return ACCOUNTS.filter((a) => a.username !== 'op-urmin')
}

/**
 * Tiga baris dari stdin: password Superadmin, password awal, konfirmasinya.
 * Lewat STDIN saja — argumen CLI terlihat di `ps` dan tersimpan di riwayat shell.
 */
export function readSecretLines(raw) {
  // bufio.Scanner membuang baris kosong di UJUNG masukan, bukan yang di tengah.
  const lines = raw.slice(0, 1200).split('\n').map((s) => s.replace(/\r$/, ''))
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  if (lines.length > 3) throw new Error('unexpected extra input')
  if (lines.length !== 3 || lines[1] !== lines[2] || lines[0].length === 0) {
    throw new Error('invalid or unconfirmed credentials')
  }
  if (lines[0].length > 256 || lines[1].length < 14 || lines[1].length > 256) {
    throw new Error('password length outside policy')
  }
  return { adminPassword: lines[0], initialPassword: lines[1] }
}

export async function provision(pool, adminUsername, adminPassword, initialPassword) {
  rosterValid()
  if (process.env.SDL_ENV !== 'development') throw new Error('REFUSED: development environment required')
  if (!adminUsername) throw new Error('Superadmin username is required')

  const client = await pool.connect()
  try {
    // SERIALIZABLE, bukan READ COMMITTED: rencana ini membaca lalu menulis
    // tabel identitas yang sama, dan dua provisioning bersamaan tidak boleh
    // sama-sama lolos pemeriksaan tabrakan.
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')

    const db = await client.query('SELECT current_database() AS name')
    if (db.rows[0].name !== 'sdl_root_dev') throw new Error('REFUSED: only sdl_root_dev is allowed')

    await client.query('SELECT pg_advisory_xact_lock(20261018, 13)')

    const migrated = await client.query(
      `SELECT EXISTS(SELECT 1 FROM sdl_schema_migrations
        WHERE filename='sql/010_urmin_attachments_distribution.sql') AS ok`,
    )
    if (!migrated.rows[0].ok) throw new Error('REFUSED: R3B migration 010 is required')

    // Superadmin dibuktikan dengan PASSWORD-nya, bukan sekadar namanya: alat
    // ini membuat 12 akun berwenang, dan yang menyetujuinya harus orang yang
    // benar-benar memegang kredensial Superadmin.
    const admin = await client.query(
      `SELECT u.id::text AS id, u.password_hash FROM sdl_users u
         JOIN sdl_user_roles sur ON sur.user_id=u.id AND sur.role_key='superadmin'
        WHERE lower(u.username)=lower($1) AND u.is_active=TRUE AND u.must_change_password=FALSE`,
      [adminUsername],
    )
    if (admin.rows.length === 0 || !(await verifyPassword(admin.rows[0].password_hash, adminPassword))) {
      throw new Error('REFUSED: Superadmin verification failed')
    }
    const adminID = admin.rows[0].id

    // Tepat SATU akun lama direkonsiliasi. Identitas, kredensial, kebijakan
    // OTP, dan profilnya tidak pernah disentuh.
    const existing = await client.query(
      `SELECT id::text AS id, is_active FROM sdl_users WHERE lower(username)='op-urmin' FOR UPDATE`,
    )
    if (existing.rows.length === 0 || !existing.rows[0].is_active) {
      throw new Error('REFUSED: expected active existing op-urmin account not found')
    }
    const existingID = existing.rows[0].id

    const state = await client.query(
      `SELECT
        (SELECT count(*)::int FROM sdl_user_roles WHERE user_id=$1) AS direct_roles,
        (SELECT count(*)::int FROM sdl_access_grants WHERE user_id=$1) AS grants,
        (SELECT count(*)::int FROM sdl_user_units WHERE user_id=$1 AND unit_key<>'urmin') AS foreign_units`,
      [existingID],
    )
    const { direct_roles: directRoles, grants, foreign_units: foreignUnits } = state.rows[0]
    if (directRoles !== 0 || grants !== 0 || foreignUnits !== 0) {
      throw new Error('REFUSED: op-urmin now has an existing role, grant, or non-Urmin unit; manual review required')
    }

    const fresh = newAccounts()
    const usernames = fresh.map((a) => a.username)
    const emails = fresh.map((a) => `${a.username}@siera.invalid`)
    const roleKeys = ROLES.map((r) => r.key)

    const collision = await client.query(
      `SELECT (SELECT count(*) FROM sdl_users WHERE lower(username)=ANY($1::text[]) OR lower(email)=ANY($2::text[]))
            + (SELECT count(*) FROM sdl_roles WHERE role_key=ANY($3::text[])) AS n`,
      [usernames, emails, roleKeys],
    )
    if (Number(collision.rows[0].n) !== 0) {
      throw new Error('REFUSED: a target new user/email/role already exists; no changes made')
    }

    // Setiap permission dalam rencana WAJIB sudah ada di katalog. Salah ketik
    // di satu kunci akan diam-diam menghasilkan role tanpa wewenang itu.
    for (const role of ROLES) {
      const known = await client.query(
        'SELECT count(*)::int AS n FROM sdl_permissions WHERE permission_key=ANY($1::text[])',
        [role.permissions],
      )
      if (known.rows[0].n !== role.permissions.length) {
        throw new Error(`REFUSED: unknown permission in role ${role.key}`)
      }
    }

    // Satu hash argon2id dengan salt acak SENDIRI per akun, walau password
    // awalnya sama. Salt bersama akan membuat 12 hash identik di database.
    const hashes = []
    for (let i = 0; i < fresh.length; i++) hashes.push(await hashPassword(initialPassword))

    for (const role of ROLES) {
      await client.query(
        `INSERT INTO sdl_roles(role_key,display_name,description,is_system,is_active,updated_by)
         VALUES($1,$2,$3,FALSE,TRUE,$4)`,
        [role.key, role.name, role.description, adminID],
      )
      for (const permission of role.permissions) {
        await client.query('INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES($1,$2)', [
          role.key,
          permission,
        ])
      }
    }

    const insertGrant = async (userId, role, unit, scope, classification, primary) => {
      await client.query('INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,$2,$3)', [
        userId, unit, primary,
      ])
      await client.query(
        `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by)
         VALUES($1,$2,$3,$4,$5,'Bootstrap akun berjenjang BagRenmin untuk pengujian operasional',$6)`,
        [userId, role, unit, scope, classification, adminID],
      )
    }

    for (const [i, account] of fresh.entries()) {
      const email = `${account.username}@siera.invalid`
      const created = await client.query(
        `INSERT INTO sdl_users(username,email,display_name,password_hash,is_active,otp_enabled,otp_required,must_change_password)
         VALUES($1,$2,$3,$4,TRUE,FALSE,FALSE,TRUE) RETURNING id::text AS id`,
        [account.username, email, account.name, hashes[i]],
      )
      const userId = created.rows[0].id

      if (account.username === 'kabagrenmin') {
        // Kabagrenmin memegang grant di KEEMPAT unit; hanya urmin yang primer.
        for (const unit of KABAG_UNITS) {
          await insertGrant(userId, account.role, unit, account.scope, account.classification, unit === 'urmin')
        }
      } else {
        await insertGrant(userId, account.role, account.unit, account.scope, account.classification, true)
      }

      await client.query(
        `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
         VALUES($1,'identity.user_created','user',$2,$3::jsonb)`,
        [adminID, userId, JSON.stringify({
          username: account.username,
          unit: account.unit,
          role: account.role,
          otpEnabled: false,
          mustChangePassword: true,
          source: 'local_superadmin_verified_seed',
          reason: 'Permintaan bootstrap akun operasional BagRenmin',
        })],
      )
    }

    // Rekonsiliasi op-urmin: hanya unit dan grant yang ditambahkan. Email,
    // password, OTP, dan riwayatnya tetap sebagaimana adanya.
    await client.query(
      `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,'urmin',TRUE)
       ON CONFLICT(user_id,unit_key) DO UPDATE SET is_primary=TRUE`,
      [existingID],
    )
    await client.query(
      `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by)
       VALUES($1,'br_op_urmin','urmin','own','biasa','Rekonsiliasi role operator Urmin untuk akun lama tanpa perubahan identitas',$2)`,
      [existingID, adminID],
    )
    await client.query(
      `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
       VALUES($1,'identity.access_granted','user',$2,$3::jsonb)`,
      [adminID, existingID, JSON.stringify({
        username: 'op-urmin',
        role: 'br_op_urmin',
        unit: 'urmin',
        scope: 'own',
        classification: 'biasa',
        credentialsUnchanged: true,
        source: 'local_superadmin_verified_seed_reconcile02',
      })],
    )
    await client.query(
      `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
       VALUES($1,'identity.bulk_users_provisioned','batch','bagrenmin',$2::jsonb)`,
      [adminID, JSON.stringify({
        newAccounts: fresh.length,
        linkedExistingAccounts: 1,
        roles: ROLES.length,
        otp: 'disabled_for_new_accounts_only',
        forcePasswordChangeForNew: true,
        source: 'local_superadmin_verified_seed_reconcile02',
      })],
    )

    await client.query('COMMIT')
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Rollback yang gagal tidak boleh menutupi error aslinya.
    }
    throw error
  } finally {
    client.release()
  }
}

async function readStdin(limit = 1200) {
  const chunks = []
  let total = 0
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
    total += chunk.length
    if (total >= limit) break
  }
  return Buffer.concat(chunks).subarray(0, limit).toString('utf8')
}

async function main() {
  try {
    rosterValid()
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`)
    process.exit(1)
  }
  const args = process.argv.slice(2)
  if (args.length !== 1 || args[0] !== '-apply') {
    process.stderr.write('ERROR: only -apply supported; use local installer/runner\n')
    process.exit(2)
  }

  const adminUsername = (process.env.SDL_SEED_SUPERADMIN_USERNAME ?? '').trim()
  let secrets
  try {
    secrets = readSecretLines(await readStdin())
  } catch {
    process.stderr.write('ERROR: credential input invalid\n')
    process.exit(1)
  }

  const databaseUrl = (process.env.DATABASE_URL ?? '').trim()
  if (databaseUrl === '') {
    process.stderr.write('ERROR: database config missing\n')
    process.exit(1)
  }

  const pool = createPool(databaseUrl)
  try {
    await provision(pool, adminUsername, secrets.adminPassword, secrets.initialPassword)
  } catch (error) {
    process.stderr.write(`ERROR: ${error.message}\n`)
    await pool.end().catch(() => {})
    process.exit(1)
  }
  await pool.end().catch(() => {})

  process.stdout.write(
    `SUCCESS: ${newAccounts().length} NEW operational accounts + 1 EXISTING op-urmin linked, ` +
    `${ROLES.length} role templates created atomically. ` +
    'Existing op-urmin credentials/OTP preserved. Superadmin unchanged.\n',
  )
  process.stdout.write(
    'EMAIL: synthetic @siera.invalid placeholders; replace with verified real addresses before email workflows.\n',
  )
}

// Hanya jalan sebagai program, bukan saat di-import alat uji.
if (process.argv[1] && process.argv[1].endsWith('seed-bagrenmin.js')) await main()
