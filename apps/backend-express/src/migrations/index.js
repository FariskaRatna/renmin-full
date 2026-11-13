import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Runner migrasi skema, port dari `apps/backend/internal/migrations/migrate.go`.
 *
 * Berkas SQL-nya **tidak disalin** (aturan 6 migrasi): modul ini membaca 33
 * berkas yang sama dari `apps/backend/internal/migrations/sql/`. Dua salinan
 * skema berarti dua kebenaran, dan yang kedua akan tertinggal diam-diam.
 *
 * Empat detail yang kalau meleset membuat backend Go MENOLAK START terhadap
 * database yang sama — ledger-nya dibagi, jadi runner ini wajib menulis persis
 * apa yang Go harapkan:
 *
 *   1. `filename` disimpan BERIKUT prefiks `sql/` (`sql/001_core.sql`), karena
 *      Go memakai `fs.Glob(sqlFiles, "sql/*.sql")` yang mengembalikan jalur
 *      ber-prefiks. Menyimpan basename saja membuat `Verify()` Go melaporkan
 *      seluruh 33 migrasi hilang.
 *   2. Checksum adalah sha256 atas **byte mentah** berkas, hex huruf kecil.
 *      Membaca sebagai string lalu menormalkan akhir baris akan mengubahnya.
 *   3. Urutannya hasil sort leksikografis atas nama ber-prefiks, sama seperti
 *      `sort.Strings` di Go.
 *   4. SELURUH berkas diterapkan dalam **SATU** transaksi, bukan satu
 *      transaksi per berkas. Go membuka `tx` sekali di luar loop; kegagalan di
 *      berkas ke-20 karena itu mengembalikan database ke keadaan semula, bukan
 *      meninggalkannya separuh termigrasi.
 */

const LOCK_KEY = 20261017

const CREATE_LEDGER = `CREATE TABLE IF NOT EXISTS sdl_schema_migrations (
 filename TEXT PRIMARY KEY,
 checksum CHAR(64) NOT NULL,
 applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`

/**
 * Manifes eksplisit, padanan `TestEmbeddedMigrationOrderAndSafety` di Go.
 *
 * Di Go ia sebuah test sehingga `docker compose build` gagal kalau daftarnya
 * bergeser. Express tidak punya test runner yang jalan saat build, jadi
 * pemeriksaan yang sama ditempatkan di JALUR EKSEKUSI: berkas asing, hilang,
 * atau berubah urutan membuat runner MENOLAK JALAN, bukan diam-diam menerapkan
 * sesuatu yang belum ditinjau.
 *
 * Menambah migrasi berarti memperbarui DUA daftar — di sini dan di
 * `migrate_test.go`. Itu disengaja: selama dua backend hidup, keduanya harus
 * sepakat tentang apa isi skema.
 */
export const MANIFEST = [
  'sql/001_core.sql',
  'sql/002_security.sql',
  'sql/003_role_editor.sql',
  'sql/004_users_access.sql',
  'sql/005_access_delegation.sql',
  'sql/006_superadmin_limited.sql',
  'sql/007_urmin_incoming.sql',
  'sql/008_local_captcha_otp_policy.sql',
  'sql/009_self_profile.sql',
  'sql/010_urmin_attachments_distribution.sql',
  'sql/011_urmin_dispositions.sql',
  'sql/012_disposition_review_sla.sql',
  'sql/013_disposition_hierarchy.sql',
  'sql/014_leadership_approval.sql',
  'sql/015_subbagren_usulan.sql',
  'sql/016_subbagren_review_consolidation.sql',
  'sql/017_subbagren_budget_realization.sql',
  'sql/018_subbagren_evidence_reconciliation.sql',
  'sql/019_unit_berkas_tugas.sql',
  'sql/020_sumda_master_crud.sql',
  'sql/021_polri_rank_master.sql',
  'sql/022_binfung_master_crud.sql',
  'sql/023_urmin_register_crud.sql',
  'sql/024_urmin_flexible_intake.sql',
  'sql/025_outgoing_review.sql',
  'sql/026_urmin_email_outbox.sql',
  'sql/027_urmin_attachment_10mb.sql',
  'sql/028_project_roadmap.sql',
  'sql/029_bagrenmin_portal.sql',
  'sql/030_urmin_intake_mail_outbox.sql',
  'sql/031_direct_leadership_directives.sql',
  'sql/032_leadership_directive_drafts.sql',
  'sql/033_leadership_directive_files.sql',
  'sql/034_urmin_derajat_doc_kind.sql',
  'sql/035_directive_incoming_link.sql',
  'sql/036_disposition_files.sql',
  'sql/037_surat_kode_arsip.sql',
  'sql/038_surat_jenis.sql',
  'sql/039_surat_nomor_urut.sql',
  'sql/040_arahan_bagian.sql',
  'sql/041_arahan_lembar_disposisi.sql',
  'sql/042_surat_keluar_opsi.sql',
  'sql/043_arahan_paur.sql',
  'sql/044_berkas_pendukung.sql',
  'sql/045_ttd_kabag.sql',
  'sql/046_nomor_reservasi.sql',
  'sql/047_opsi_dropdown.sql',
  'sql/048_opsi_agenda_hadir.sql',
  'sql/049_progar_pagu.sql',
]

/**
 * Lokasi 33 berkas SQL. Dapat ditimpa `SDL_MIGRATIONS_DIR` karena di dalam
 * container jalur relatif terhadap source tidak selalu ada — stack uji
 * keamanan mem-bind-mount direktori yang sama read-only.
 */
export function migrationsDir(env = process.env) {
  const override = (env.SDL_MIGRATIONS_DIR ?? '').trim()
  if (override !== '') return override
  return resolve(import.meta.dirname, '../../../backend/internal/migrations/sql')
}

/** Daftar migrasi terurut beserta isi dan checksum-nya. */
export async function load(dir = migrationsDir()) {
  let entries
  try {
    entries = await readdir(dir)
  } catch (error) {
    throw new Error(`cannot read migration directory ${dir}: ${error.message}`)
  }
  const names = entries.filter((n) => n.endsWith('.sql')).map((n) => `sql/${n}`).sort()
  if (names.length === 0) throw new Error(`empty SQL migration set in ${dir}`)

  if (names.length !== MANIFEST.length) {
    throw new Error(`expected ${MANIFEST.length} migration files, found ${names.length} in ${dir}`)
  }
  for (let i = 0; i < names.length; i++) {
    if (names[i] !== MANIFEST[i]) {
      throw new Error(`migration ${i + 1}: expected ${MANIFEST[i]}, found ${names[i]}`)
    }
  }

  const out = []
  for (const name of names) {
    // Dibaca sebagai Buffer, BUKAN string. sha256 Go dihitung atas byte mentah;
    // dekode-lalu-encode-ulang akan mengubah checksum pada berkas apa pun yang
    // bukan ASCII murni, dan Go lalu menolak start dengan "checksum mismatch".
    const data = await readFile(join(dir, name.slice('sql/'.length)))
    out.push({
      name,
      statement: data.toString('utf8'),
      checksum: createHash('sha256').update(data).digest('hex'),
    })
  }
  return out
}

/**
 * Menerapkan migrasi yang belum tercatat. Idempoten, dan menolak kalau isi
 * berkas yang SUDAH diterapkan berubah — mengedit migrasi yang sudah berjalan
 * adalah cara paling mudah membuat dua lingkungan diam-diam berbeda skema.
 *
 * @returns {Promise<{applied: string[], skipped: number}>}
 */
export async function run(pool) {
  const items = await load()
  const client = await pool.connect()
  const applied = []
  try {
    await client.query('BEGIN')
    // Lock tingkat transaksi: dua proses yang start bersamaan tidak boleh
    // menerapkan berkas yang sama dua kali. Dilepas otomatis saat COMMIT.
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY])
    await client.query(CREATE_LEDGER)
    for (const m of items) {
      const { rows } = await client.query(
        'SELECT checksum FROM sdl_schema_migrations WHERE filename=$1',
        [m.name],
      )
      if (rows.length > 0) {
        if (rows[0].checksum !== m.checksum) {
          throw new Error(`migration checksum changed: ${m.name}`)
        }
        continue
      }
      // SATU berkas memuat BANYAK perintah DDL. Dikirim tanpa parameter supaya
      // `pg` memakai simple query protocol — padanan
      // pgx.QueryExecModeSimpleProtocol di Go. Menambahkan parameter apa pun
      // akan memaksa extended protocol, yang hanya menerima satu pernyataan.
      await client.query(m.statement)
      await client.query(
        'INSERT INTO sdl_schema_migrations(filename, checksum) VALUES($1, $2)',
        [m.name, m.checksum],
      )
      applied.push(m.name)
    }
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
  return { applied, skipped: items.length - applied.length }
}

/**
 * Padanan `migrations.Verify()`: menolak kalau ada migrasi yang belum
 * diterapkan atau checksum-nya bergeser. Go memanggilnya di setiap start
 * normal dan menolak menyala kalau gagal.
 */
export async function verify(pool) {
  const items = await load()
  for (const m of items) {
    const { rows } = await pool.query(
      'SELECT checksum FROM sdl_schema_migrations WHERE filename=$1',
      [m.name],
    )
    if (rows.length === 0) throw new Error(`missing migration ${m.name}`)
    if (rows[0].checksum !== m.checksum) throw new Error(`schema checksum mismatch: ${m.name}`)
  }
  return items.length
}
