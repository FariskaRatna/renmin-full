import { createHash, randomBytes } from 'node:crypto'
import pg from 'pg'

/**
 * Akses database langsung. Dipakai untuk dua hal yang tidak bisa dilakukan
 * lewat HTTP:
 *
 *  1. Mencetak sesi tanpa melewati login. Superadmin SELALU wajib OTP via SMTP
 *     (mustUseOTP, service.go:345) dan kode OTP disimpan ter-hash, jadi tidak
 *     ada cara mengotomasi login Superadmin dari luar. Sesi disuntik langsung.
 *  2. Membaca ID nyata untuk mengisi path param seperti /{id} dan /{taskId}.
 */
export class HarnessDb {
  #pool
  #mintedTokens = []

  constructor(databaseUrl) {
    this.#pool = new pg.Pool({ connectionString: databaseUrl, max: 4 })
  }

  async close() {
    await this.#pool.end()
  }

  async #one(sql, params = []) {
    const { rows } = await this.#pool.query(sql, params)
    return rows[0]
  }

  async ping() {
    await this.#pool.query('SELECT 1')
  }

  async userIdByUsername(username) {
    const row = await this.#one(
      'SELECT id::text AS id FROM sdl_users WHERE lower(username)=lower($1)',
      [username],
    )
    return row?.id
  }

  async superadminUserId() {
    const row = await this.#one(
      `SELECT u.id::text AS id FROM sdl_users u
         JOIN sdl_user_roles ur ON ur.user_id=u.id AND ur.role_key='superadmin'
        WHERE u.is_active ORDER BY u.created_at LIMIT 1`,
    )
    return row?.id
  }

  /**
   * must_change_password=TRUE memblokir AuthorizeOperational DAN
   * AuthorizeRoleEditor. seed-bagrenmin membuat ke-13 akun dengan nilai TRUE
   * (cmd/seed-bagrenmin/main.go:240), jadi tanpa langkah ini seluruh endpoint
   * operasional menjawab 403 dan golden file merekam kondisi yang salah.
   *
   * Hanya dijalankan saat mutasi diizinkan — ini menulis ke database.
   */
  async clearMustChangePassword() {
    const result = await this.#pool.query(
      `UPDATE sdl_users SET must_change_password=FALSE
        WHERE must_change_password=TRUE
          AND NOT EXISTS (SELECT 1 FROM sdl_user_roles ur
                           WHERE ur.user_id=sdl_users.id AND ur.role_key='superadmin')`,
    )
    return result.rowCount ?? 0
  }

  /**
   * Token sesi = 32 byte acak, base64url tanpa padding (43 char).
   * Yang disimpan adalah sha256(token) hex — service.go:76 tokenHash().
   */
  async mintSession(userId) {
    const token = randomBytes(32).toString('base64url')
    if (token.length !== 43) throw new Error(`panjang token ${token.length}, seharusnya 43`)
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await this.#pool.query(
      `INSERT INTO sdl_sessions(token_hash,user_id,expires_at)
       VALUES($1,$2,NOW()+INTERVAL '8 hours')`,
      [tokenHash, userId],
    )
    this.#mintedTokens.push(tokenHash)
    return token
  }

  /** Cabut semua sesi yang dicetak harness, supaya tidak tertinggal di database. */
  async revokeMintedSessions() {
    if (this.#mintedTokens.length === 0) return
    await this.#pool.query(
      'UPDATE sdl_sessions SET revoked_at=NOW() WHERE token_hash = ANY($1::char(64)[])',
      [this.#mintedTokens],
    )
  }

  /**
   * ID nyata untuk mengisi path param. Setiap kunci yang tidak ditemukan
   * membuat endpoint terkait dilewati dengan alasan tercatat, bukan dikarang.
   */
  async loadFixtures() {
    const lookups = [
      ['userId', 'SELECT id::text AS v FROM sdl_users ORDER BY created_at LIMIT 1'],
      ['roleKey', "SELECT role_key AS v FROM sdl_roles WHERE role_key<>'superadmin' ORDER BY role_key LIMIT 1"],
      ['unitKey', 'SELECT unit_key AS v FROM sdl_org_units ORDER BY unit_key LIMIT 1'],
      // Tabel ini tidak punya created_at; id-nya varchar yang ditulis tangan.
      ['roadmapId', 'SELECT id::text AS v FROM sdl_project_roadmap_records ORDER BY section, sort_order, id LIMIT 1'],
      ['portalPostId', 'SELECT id::text AS v FROM sdl_portal_posts ORDER BY created_at LIMIT 1'],
      ['incomingId', 'SELECT id::text AS v FROM sdl_urmin_incoming ORDER BY created_at LIMIT 1'],
      ['attachmentId', 'SELECT id::text AS v FROM sdl_urmin_incoming_attachments ORDER BY created_at LIMIT 1'],
      ['distributionId', 'SELECT id::text AS v FROM sdl_urmin_distributions ORDER BY sent_at, id LIMIT 1'],
      ['dispositionTaskId', 'SELECT id::text AS v FROM sdl_urmin_disposition_tasks ORDER BY created_at LIMIT 1'],
      // Kunci primernya register_id (1:1 dengan register), bukan kolom id sendiri.
      ['outgoingId', 'SELECT register_id::text AS v FROM sdl_outgoing_workflows ORDER BY updated_at, register_id LIMIT 1'],
      ['unitWorkRecordId', 'SELECT id::text AS v FROM sdl_unit_work_records ORDER BY created_at LIMIT 1'],
      ['unitWorkFileId', 'SELECT id::text AS v FROM sdl_unit_work_files ORDER BY created_at LIMIT 1'],
      ['unitWorkTaskId', 'SELECT id::text AS v FROM sdl_unit_work_tasks ORDER BY created_at LIMIT 1'],
      ['sumdaId', 'SELECT id::text AS v FROM sdl_sumda_registry ORDER BY created_at LIMIT 1'],
      ['binfungId', 'SELECT id::text AS v FROM sdl_binfung_registry ORDER BY created_at LIMIT 1'],
      ['urminRegistryId', 'SELECT id::text AS v FROM sdl_urmin_registry ORDER BY created_at LIMIT 1'],
      ['proposalId', 'SELECT id::text AS v FROM sdl_subbagren_proposals ORDER BY created_at LIMIT 1'],
      ['paguId', 'SELECT id::text AS v FROM sdl_subbagren_pagu ORDER BY created_at LIMIT 1'],
      ['realisasiId', 'SELECT id::text AS v FROM sdl_subbagren_realisasi ORDER BY created_at LIMIT 1'],
      ['evidenceId', 'SELECT id::text AS v FROM sdl_subbagren_evidence ORDER BY created_at LIMIT 1'],
      ['directiveId', 'SELECT id::text AS v FROM sdl_leadership_directives ORDER BY created_at LIMIT 1'],
      ['directiveFileId', 'SELECT id::text AS v FROM sdl_leadership_directive_files ORDER BY created_at LIMIT 1'],

      // ---- sasaran varian jalur sukses ----
      //
      // Dipilih lewat judul yang ditanam seed-documents.js, bukan lewat state.
      // Predikat state terlihat lebih bersih tapi menipu: begitu satu varian
      // berhasil, state record-nya BERUBAH, dan fixture yang sama akan menunjuk
      // baris lain di run berikutnya. Judul tidak pernah diubah oleh transisi
      // mana pun, jadi ia satu-satunya penanda yang stabil.
      //
      // Fixture dimuat sekali di awal run, jadi varian selalu menyasar baris
      // yang dimaksud walau fase tulis sudah menggeser statusnya.
      ...[
        ['proposalUpdateId', 'Sasaran uji penyuntingan draf'],
        ['proposalSubmitId', 'Sasaran uji pengajuan draf'],
        ['proposalReviewId', 'Sasaran uji telaah maker-checker'],
        ['proposalRevisionId', 'Sasaran uji perbaikan revisi'],
        ['proposalResubmitId', 'Sasaran uji pengajuan ulang'],
      ].map(([key, title]) => [
        key,
        'SELECT id::text AS v FROM sdl_subbagren_proposals WHERE title=$1 LIMIT 1',
        [title],
      ]),
    ]

    const fixtures = {}
    for (const [key, sql, params = []] of lookups) {
      try {
        const row = await this.#one(sql, params)
        if (row?.v) fixtures[key] = row.v
      } catch (error) {
        // Tabel belum ada (migrasi tertinggal) bukan alasan membatalkan seluruh
        // run — endpoint yang bergantung padanya akan dilewati dengan alasan jelas.
        process.stderr.write(`  fixture ${key} gagal: ${error.message}\n`)
      }
    }
    return fixtures
  }
}
