import { createHash } from 'node:crypto'
import pg from 'pg'

import { sealEvidence } from '../src/crypto/evidence.js'

/**
 * Seed dokumen deterministik untuk harness.
 *
 * Tanpa ini, database hanya berisi user dan grant. Akibatnya dua hal, dan yang
 * kedua lebih merugikan daripada yang pertama:
 *
 *   1. Seluruh endpoint ber-path-param dilewati — tidak ada ID untuk diisi.
 *   2. Seluruh endpoint daftar mengembalikan `items: []`. Perbandingan "cocok"
 *      pada array kosong tidak membuktikan apa pun tentang pemetaan kolom,
 *      konversi tipe, urutan, maupun dekorasi.
 *
 * ## Kenapa ini RESET, bukan sekadar INSERT
 *
 * Begitu fixture nyata ada, kasus mutating benar-benar mengubah baris. Capture
 * (Go) akan berangkat dari keadaan S0 dan meninggalkan S1; compare (Express)
 * lalu berangkat dari S1 dan hasilnya tidak mungkin cocok dengan golden file.
 * Keduanya WAJIB berangkat dari keadaan yang sama, jadi perintah ini dijalankan
 * sebelum capture DAN sebelum compare.
 *
 * `RESTART IDENTITY` bukan hiasan: `sdl_subbagren_proposals.number` dan
 * `sdl_urmin_incoming.agenda_no` adalah kolom identity yang ikut diserialkan ke
 * JSON sebagai angka biasa — harness tidak menormalkannya. Tanpa restart,
 * nomornya bertambah di setiap seed dan golden file langsung meleset.
 *
 * ## Kenapa role ikut ditambahi permission
 *
 * `seed-bagrenmin` memberi role permission `subbagren.perencanaan.*`, sedangkan
 * handler usulan memeriksa `subbagren.usulan.*` dan handler anggaran memeriksa
 * `subbagren.anggaran.pagu.*` / `.realisasi.*` / `.bukti.*`. Kunci-kunci itu ada
 * di katalog `sdl_permissions` tapi **tidak pernah diberikan ke role mana pun**.
 * Akibatnya tidak ada satu aktor pun yang bisa membaca usulan, dan seluruh
 * endpoint itu menjawab kosong tanpa pernah menyentuh logika sebenarnya.
 *
 * Harness adalah uji DIFERENSIAL Go lawan Express, bukan tiruan konfigurasi
 * produksi. Supaya kedua mesin otorisasi benar-benar dijalankan, permission yang
 * kurang ditambahkan di sini. **Peta role→permission di bawah bukan konfigurasi
 * produksi** dan tidak boleh dijadikan rujukan untuk itu.
 *
 * Scope dan batas klasifikasi sengaja TIDAK disentuh — justru di situ Engine A
 * membeda-bedakan, dan itulah yang ingin diuji. Konsekuensinya terlihat jelas:
 * `br_op_subbagren` ber-scope 'assigned', sedangkan handler subbagren tidak
 * pernah mengisi assignedUserIds, jadi ia tetap tidak melihat apa pun. Itu
 * perilaku Go yang sah dan harus direplikasi Express, bukan dibetulkan di sini.
 *
 * Selain tabel `sdl_role_permissions`, tabel identitas lain (user, grant, unit,
 * sesi) tidak disentuh.
 */

/**
 * UUID tetap supaya seed bisa diulang tanpa menggeser apa pun. Nilainya sendiri
 * tidak muncul di golden file — normalizer menggantinya dengan <uuid:n> — tapi
 * ID yang tetap membuat selisih antar-run bisa dibaca manusia saat menelusuri.
 */
const ID = {
  workUrmin: 'a0000000-0000-4000-8000-000000000001',
  workSubbagren: 'a0000000-0000-4000-8000-000000000002',
  workSumda: 'a0000000-0000-4000-8000-000000000003',
  workBinfung: 'a0000000-0000-4000-8000-000000000004',
  // Registry berelasi 1:1 dengan work record (UNIQUE work_record_id), jadi
  // entri agenda butuh berkas kerjanya sendiri.
  workUrminAgenda: 'a0000000-0000-4000-8000-000000000005',
  workFile: 'a1000000-0000-4000-8000-000000000001',
  workTask: 'a2000000-0000-4000-8000-000000000001',

  registrySurat: 'b0000000-0000-4000-8000-000000000001',
  registryAgenda: 'b0000000-0000-4000-8000-000000000002',
  sumda: 'b1000000-0000-4000-8000-000000000001',
  binfung: 'b2000000-0000-4000-8000-000000000001',

  incomingRegistered: 'c0000000-0000-4000-8000-000000000001',
  incomingDraft: 'c0000000-0000-4000-8000-000000000002',
  attachment: 'c1000000-0000-4000-8000-000000000001',
  distribution: 'c2000000-0000-4000-8000-000000000001',
  dispositionTask: 'c3000000-0000-4000-8000-000000000001',

  proposalApproved: 'd0000000-0000-4000-8000-000000000001',
  proposalDraft: 'd0000000-0000-4000-8000-000000000002',
  proposalPenting: 'd0000000-0000-4000-8000-000000000003',
  // Lima baris berikut HANYA untuk varian jalur sukses, satu per transisi.
  // Sengaja tidak memakai ulang tiga baris di atas: setiap mutasi yang berhasil
  // menaikkan version, jadi record bersama membuat `version` di body bergantung
  // pada urutan eksekusi varian. Satu record satu varian = `version: 1` selalu
  // benar, dan kegagalan satu varian tidak menjatuhkan varian lain.
  proposalWriteUpdate: 'd0000000-0000-4000-8000-000000000011',
  proposalWriteSubmit: 'd0000000-0000-4000-8000-000000000012',
  proposalWriteReview: 'd0000000-0000-4000-8000-000000000013',
  proposalWriteRevision: 'd0000000-0000-4000-8000-000000000014',
  proposalWriteResubmit: 'd0000000-0000-4000-8000-000000000015',
  pagu: 'd1000000-0000-4000-8000-000000000001',
  realisasi: 'd2000000-0000-4000-8000-000000000001',
  evidence: 'd3000000-0000-4000-8000-000000000001',

  directive: 'e0000000-0000-4000-8000-000000000001',
  directiveFile: 'e1000000-0000-4000-8000-000000000001',
  portalPost: 'f0000000-0000-4000-8000-000000000001',
}

/**
 * Waktu tetap dan BERBEDA untuk setiap baris. Fixture dipilih lewat
 * `ORDER BY created_at LIMIT 1`; kalau dua baris berbagi stempel waktu,
 * Postgres memutus seri sesukanya dan fixture-nya berubah antar-run — persis
 * kegagalan B6 di DEVIATIONS.md.
 */
const T0 = Date.UTC(2026, 9, 1, 1, 0, 0) // 2026-10-01T01:00:00Z
const at = (minutes) => new Date(T0 + minutes * 60_000).toISOString()

/** Tabel dokumen yang dikosongkan. Tabel identitas tidak ada di daftar ini. */
const DOCUMENT_TABLES = [
  'sdl_subbagren_evidence_events',
  'sdl_subbagren_evidence',
  'sdl_subbagren_realisasi',
  'sdl_subbagren_pagu',
  'sdl_subbagren_budget_events',
  'sdl_subbagren_review_events',
  'sdl_subbagren_review_cases',
  'sdl_subbagren_proposal_history',
  'sdl_subbagren_proposals',
  'sdl_urmin_final_approvals',
  'sdl_urmin_disposition_reviews',
  'sdl_urmin_disposition_events',
  'sdl_urmin_disposition_tasks',
  'sdl_urmin_distribution_events',
  'sdl_urmin_distributions',
  'sdl_urmin_incoming_intake',
  'sdl_urmin_incoming_history',
  'sdl_urmin_incoming_attachments',
  'sdl_urmin_incoming',
  'sdl_urmin_email_outbox',
  'sdl_urmin_intake_mail_outbox',
  'sdl_outgoing_events',
  'sdl_outgoing_workflows',
  'sdl_urmin_registry',
  'sdl_sumda_registry',
  'sdl_binfung_registry',
  'sdl_unit_work_events',
  'sdl_unit_work_files',
  'sdl_unit_work_tasks',
  'sdl_unit_work_records',
  'sdl_leadership_directive_events',
  'sdl_leadership_directive_files',
  'sdl_leadership_directive_recipients',
  'sdl_leadership_directive_drafts',
  'sdl_leadership_directives',
  'sdl_portal_publication_events',
  'sdl_portal_posts',
]

/** PDF minimal yang sah: cukup untuk disegel, di-hash, dan diunduh kembali. */
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
)

/**
 * Permission tambahan khusus harness. Lihat catatan modul: ini BUKAN
 * konfigurasi produksi.
 *
 * Pembagiannya mengikuti peran: operator mencatat, kepala memverifikasi — jadi
 * aturan maker-checker tetap bisa diuji. Memberi semua permission kepada semua
 * role akan menghapus justru perbedaan yang ingin diukur.
 */
const HARNESS_ROLE_PERMISSIONS = {
  br_op_subbagren: [
    'subbagren.usulan.read', 'subbagren.usulan.create', 'subbagren.usulan.update',
    'subbagren.usulan.submit',
    'subbagren.anggaran.read', 'subbagren.anggaran.pagu.register',
    'subbagren.anggaran.realisasi.record',
    'subbagren.anggaran.bukti.read', 'subbagren.anggaran.bukti.upload',
  ],
  br_staf_subbagren: [
    'subbagren.usulan.read', 'subbagren.usulan.create', 'subbagren.usulan.update',
    'subbagren.usulan.submit',
  ],
  br_kasubbagren: [
    'subbagren.usulan.read', 'subbagren.usulan.create', 'subbagren.usulan.update',
    'subbagren.usulan.submit', 'subbagren.usulan.review', 'subbagren.usulan.consolidate',
    'subbagren.anggaran.pagu.verify', 'subbagren.anggaran.realisasi.verify',
    'subbagren.anggaran.bukti.read', 'subbagren.anggaran.bukti.verify',
    'subbagren.anggaran.reconcile',
  ],
  br_kabagrenmin: [
    'subbagren.usulan.read', 'subbagren.usulan.consolidate',
    'subbagren.anggaran.reconcile', 'subbagren.anggaran.bukti.read',
  ],
}

async function grantHarnessPermissions(client) {
  let added = 0
  for (const [role, permissions] of Object.entries(HARNESS_ROLE_PERMISSIONS)) {
    const result = await client.query(
      `INSERT INTO sdl_role_permissions(role_key,permission_key)
       SELECT $1,unnest($2::text[]) ON CONFLICT DO NOTHING`,
      [role, permissions],
    )
    added += result.rowCount ?? 0
  }
  return added
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function userIds(client) {
  const { rows } = await client.query('SELECT lower(username) AS username, id::text AS id FROM sdl_users')
  const byName = new Map(rows.map((row) => [row.username, row.id]))

  const required = [
    'ka-urmin', 'staf-urmin', 'op-urmin',
    'kasubbagren', 'op-subbagren',
    'kasubbagsumda', 'op-subbagsumda',
    'kasubbagbinfung', 'op-subbagbinfung',
    'kabagrenmin',
  ]
  const missing = required.filter((name) => !byName.has(name))
  if (missing.length > 0) {
    throw new Error(
      `akun operasional belum ada: ${missing.join(', ')}.\n` +
      '       Jalankan "local-setup.cmd seed" lebih dulu.',
    )
  }
  return Object.fromEntries(required.map((name) => [name, byName.get(name)]))
}

export async function seedDocuments(databaseUrl, evidenceKey) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
  const client = await pool.connect()

  try {
    const u = await userIds(client)
    await client.query('BEGIN')

    await client.query(`TRUNCATE ${DOCUMENT_TABLES.join(',')} RESTART IDENTITY CASCADE`)
    const grantedPermissions = await grantHarnessPermissions(client)

    // ---- unit-work: satu record per unit, dasar bagi seluruh registry ----
    for (const [id, unit, category, title, owner, minute] of [
      [ID.workUrmin, 'urmin', 'Persuratan', 'Berkas kerja persuratan Urmin', u['op-urmin'], 0],
      [ID.workSubbagren, 'subbagren', 'Perencanaan', 'Berkas kerja perencanaan Subbagren', u['op-subbagren'], 1],
      [ID.workSumda, 'subbagsumda', 'Personel', 'Berkas kerja personel Subbagsumda', u['op-subbagsumda'], 2],
      [ID.workBinfung, 'subbagbinfung', 'Pembinaan', 'Berkas kerja pembinaan Subbagbinfung', u['op-subbagbinfung'], 3],
      [ID.workUrminAgenda, 'urmin', 'Agenda', 'Berkas kerja agenda Urmin', u['op-urmin'], 4],
    ]) {
      await client.query(
        `INSERT INTO sdl_unit_work_records(id,unit_key,category,title,description,classification,created_by,updated_by,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,'biasa',$6,$6,$7,$7)`,
        [id, unit, category, title, `Data uji harness untuk unit ${unit}.`, owner, at(minute)],
      )
    }

    await client.query(
      `INSERT INTO sdl_unit_work_files(id,record_id,file_name,media_type,byte_size,sha256,file_data,uploaded_by,created_at)
       VALUES($1,$2,'lampiran-kerja.pdf','application/pdf',$3,$4,$5,$6,$7)`,
      [ID.workFile, ID.workUrmin, PDF_BYTES.length, sha256Hex(PDF_BYTES), PDF_BYTES, u['op-urmin'], at(4)],
    )

    // Tugas internal: pemberi dan penerima wajib berbeda orang.
    await client.query(
      `INSERT INTO sdl_unit_work_tasks(id,record_id,from_user,to_user,instruction,status,response,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,'pending','',$6,$6)`,
      [ID.workTask, ID.workUrmin, u['ka-urmin'], u['staf-urmin'],
        'Mohon tindak lanjuti berkas kerja persuratan ini.', at(5)],
    )

    // ---- registry per unit ----
    for (const [id, kind, ref, title, work, owner, minute] of [
      [ID.registrySurat, 'surat_keluar', 'SK-2026-001', 'Surat keluar uji harness', ID.workUrmin, u['op-urmin'], 6],
      [ID.registryAgenda, 'agenda', 'AG-2026-001', 'Agenda uji harness', ID.workUrminAgenda, u['op-urmin'], 7],
    ]) {
      await client.query(
        `INSERT INTO sdl_urmin_registry(id,kind,ref_code,title,fields,work_record_id,created_by,updated_by,created_at,updated_at)
         VALUES($1,$2,$3,$4,'{}'::jsonb,$5,$6,$6,$7,$7)`,
        [id, kind, ref, title, work, owner, at(minute)],
      )
    }

    // Surat keluar punya workflow pasangannya; tahap draft supaya penyuntingan
    // work-record pasangannya tidak terkunci (shared.js lockOutgoingEditing).
    await client.query(
      `INSERT INTO sdl_outgoing_workflows(register_id,stage,version,last_note,updated_at)
       VALUES($1,'draft',1,'',$2)`,
      [ID.registrySurat, at(8)],
    )

    await client.query(
      `INSERT INTO sdl_sumda_registry(id,kind,ref_code,title,fields,work_record_id,created_by,updated_by,created_at,updated_at)
       VALUES($1,'personel','PRS-2026-001','Data personel uji harness','{}'::jsonb,$2,$3,$3,$4,$4)`,
      [ID.sumda, ID.workSumda, u['op-subbagsumda'], at(9)],
    )

    await client.query(
      `INSERT INTO sdl_binfung_registry(id,kind,ref_code,title,fields,work_record_id,created_by,updated_by,created_at,updated_at)
       VALUES($1,'sop','SOP-2026-001','SOP uji harness','{}'::jsonb,$2,$3,$3,$4,$4)`,
      [ID.binfung, ID.workBinfung, u['op-subbagbinfung'], at(10)],
    )

    // ---- surat masuk, lampiran, distribusi, disposisi ----
    for (const [id, number, sender, subject, classification, status, minute] of [
      [ID.incomingRegistered, '001/UJI/2026', 'Bagian Perencanaan Polda', 'Permintaan data uji harness', 'biasa', 'registered', 11],
      [ID.incomingDraft, '002/UJI/2026', 'Bagian Sumber Daya Polda', 'Nota dinas klasifikasi penting', 'penting', 'draft', 12],
    ]) {
      await client.query(
        `INSERT INTO sdl_urmin_incoming(id,letter_number,sender,letter_date,received_date,subject,classification,status,created_by,updated_by,created_at,updated_at)
         VALUES($1,$2,$3,'2026-09-20','2026-09-22',$4,$5,$6,$7,$7,$8,$8)`,
        [id, number, sender, subject, classification, status, u['op-urmin'], at(minute)],
      )
    }

    await client.query(
      `INSERT INTO sdl_urmin_incoming_attachments(id,incoming_id,uploaded_by,filename,mime_type,size_bytes,sha256,body,created_at)
       VALUES($1,$2,$3,'surat-masuk.pdf','application/pdf',$4,$5,$6,$7)`,
      [ID.attachment, ID.incomingRegistered, u['op-urmin'],
        PDF_BYTES.length, sha256Hex(PDF_BYTES), PDF_BYTES, at(13)],
    )

    await client.query(
      `INSERT INTO sdl_urmin_distributions(id,incoming_id,sent_by,recipient_unit,recipient_user,status,reason,sent_at)
       VALUES($1,$2,$3,'subbagren',$4,'sent',$5,$6)`,
      [ID.distribution, ID.incomingRegistered, u['ka-urmin'], u['op-subbagren'],
        'Diteruskan ke Subbagren untuk penyiapan bahan.', at(14)],
    )

    await client.query(
      `INSERT INTO sdl_urmin_disposition_tasks(id,distribution_id,incoming_id,unit_key,issued_by,assigned_to,instruction,due_date,status,depth,version,created_at,updated_at)
       VALUES($1,$2,$3,'subbagren',$4,$5,$6,'2026-11-30','pending',0,1,$7,$7)`,
      [ID.dispositionTask, ID.distribution, ID.incomingRegistered,
        u['kasubbagren'], u['op-subbagren'],
        'Siapkan bahan jawaban dan laporkan hasilnya.', at(15)],
    )

    // ---- usulan Subbagren ----
    // P1 'biasa' sudah disetujui: prasyarat pagu.
    // P2 'biasa' masih draft: jalur penyuntingan.
    // P3 'penting' dibuat Kasubbagren: menguji penyaringan klasifikasi —
    //    op-subbagren berbatas 'biasa' TIDAK boleh melihatnya.
    for (const [id, title, classification, status, owner, minute] of [
      [ID.proposalApproved, 'Usulan kegiatan uji harness tahun 2026', 'biasa', 'submitted', u['op-subbagren'], 16],
      [ID.proposalDraft, 'Draf usulan kegiatan uji harness', 'biasa', 'draft', u['op-subbagren'], 17],
      [ID.proposalPenting, 'Usulan klasifikasi penting uji harness', 'penting', 'submitted', u['kasubbagren'], 18],
    ]) {
      await client.query(
        `INSERT INTO sdl_subbagren_proposals(id,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by,updated_by,version,created_at,updated_at)
         VALUES($1,2026,'Subbagren',$2,'Tersedianya bahan perencanaan yang terverifikasi',250000000,$3,$4,$5,$5,1,$6,$6)`,
        [id, title, classification, status, owner, at(minute)],
      )
    }

    await client.query(
      `INSERT INTO sdl_subbagren_review_cases(proposal_id,review_status,revision_count,has_revision,updated_by,updated_at)
       VALUES($1,'approved',0,false,$2,$3),($4,'pending',0,false,$5,$6)`,
      [ID.proposalApproved, u['kasubbagren'], at(19),
        ID.proposalPenting, u['kasubbagren'], at(20)],
    )

    // ---- usulan: sasaran varian jalur sukses, satu record per transisi ----
    //
    // Kepemilikan di bawah bukan selera, melainkan tuntutan handler Go:
    //
    //   review     menolak 403 self_review_denied kalau created_by == peninjau,
    //              jadi pembuatnya WAJIB op-subbagren (usulan.go/review.go:177).
    //   revision   menolak 404 kalau created_by != pemanggil (review.go:233),
    //   resubmit   idem (review.go:301) — jadi dua itu WAJIB milik kasubbagren.
    //
    // Seluruh varian dijalankan kasubbagren karena br_op_subbagren ber-scope
    // 'assigned' sementara handler subbagren tidak pernah mengisi
    // assignedUserIds; ia tidak lolos Engine A untuk apa pun di sini.
    //
    // Menit 30+ dipilih supaya fixture `proposalId` (ORDER BY created_at LIMIT 1)
    // tetap menunjuk proposalApproved di menit 16 dan kasus dasar tidak bergeser.
    for (const [id, title, status, owner, minute] of [
      [ID.proposalWriteUpdate, 'Sasaran uji penyuntingan draf', 'draft', u['op-subbagren'], 30],
      [ID.proposalWriteSubmit, 'Sasaran uji pengajuan draf', 'draft', u['op-subbagren'], 31],
      [ID.proposalWriteReview, 'Sasaran uji telaah maker-checker', 'submitted', u['op-subbagren'], 32],
      [ID.proposalWriteRevision, 'Sasaran uji perbaikan revisi', 'submitted', u['kasubbagren'], 33],
      [ID.proposalWriteResubmit, 'Sasaran uji pengajuan ulang', 'submitted', u['kasubbagren'], 34],
    ]) {
      await client.query(
        `INSERT INTO sdl_subbagren_proposals(id,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by,updated_by,version,created_at,updated_at)
         VALUES($1,2026,'Subbagren',$2,'Tersedianya bahan perencanaan yang terverifikasi',120000000,'biasa',$3,$4,$4,1,$5,$5)`,
        [id, title, status, owner, at(minute)],
      )
    }

    // Status telaah yang dituntut tiap transisi. Yang berstatus draft tidak
    // butuh baris di sini — decorateReview memotong lebih awal (review.go:38).
    await client.query(
      `INSERT INTO sdl_subbagren_review_cases(proposal_id,review_status,revision_count,has_revision,updated_by,updated_at)
       VALUES($1,'pending',0,false,$4,$5),
             ($2,'revision_requested',0,false,$4,$6),
             ($3,'revision_requested',0,true,$4,$7)`,
      [ID.proposalWriteReview, ID.proposalWriteRevision, ID.proposalWriteResubmit,
        u['kasubbagren'], at(32), at(33), at(34)],
    )

    // Pagu terverifikasi; pemeriksa wajib orang lain daripada pendaftarnya.
    await client.query(
      `INSERT INTO sdl_subbagren_pagu(id,proposal_id,amount,authorization_number,authorization_issuer,authorization_date,status,created_by,reviewed_by,review_reason,reviewed_at,version,created_at)
       VALUES($1,$2,200000000,'DIPA-2026-0001','Biro Perencanaan Polda','2026-01-15','verified',$3,$4,$5,$6,2,$7)`,
      [ID.pagu, ID.proposalApproved, u['op-subbagren'], u['kasubbagren'],
        'Dokumen otorisasi sudah dicocokkan dengan arsip.', at(21), at(21)],
    )

    await client.query(
      `INSERT INTO sdl_subbagren_realisasi(id,pagu_id,amount,transaction_date,evidence_reference,description,status,created_by,version,created_at)
       VALUES($1,$2,75000000,'2026-06-10','SP2D-2026-000123','Pembayaran kegiatan uji harness tahap pertama','pending',$3,1,$4)`,
      [ID.realisasi, ID.pagu, u['op-subbagren'], at(22)],
    )

    // Bukti disegel dengan sealEvidence milik proyek, bukan byte karangan:
    // amplop "SDL1" + nonce + ciphertext + tag, dengan amplop sebagai AAD.
    // Kalau kuncinya tidak ada, biarkan gagal — bukti plaintext tidak pernah sah.
    const sealed = sealEvidence(evidenceKey, PDF_BYTES)
    await client.query(
      `INSERT INTO sdl_subbagren_evidence(id,realisasi_id,uploaded_by,filename,mime_type,size_bytes,sha256,body,status,version,created_at)
       VALUES($1,$2,$3,'bukti-bayar.pdf','application/pdf',$4,$5,$6,'pending',1,$7)`,
      [ID.evidence, ID.realisasi, u['op-subbagren'],
        PDF_BYTES.length, sha256Hex(PDF_BYTES), sealed, at(23)],
    )

    // ---- arahan pimpinan ----
    await client.query(
      `INSERT INTO sdl_leadership_directives(id,issuer_id,title,body,kind,priority,created_at)
       VALUES($1,$2,'Arahan uji harness',$3,'umum','biasa',$4)`,
      [ID.directive, u['kabagrenmin'],
        'Seluruh unit agar menyiapkan bahan evaluasi triwulan sesuai format yang berlaku.', at(24)],
    )
    await client.query(
      `INSERT INTO sdl_leadership_directive_recipients(directive_id,recipient_id)
       VALUES($1,$2),($1,$3)`,
      [ID.directive, u['ka-urmin'], u['kasubbagren']],
    )
    await client.query(
      `INSERT INTO sdl_leadership_directive_files(id,issuer_id,filename,mime_type,size_bytes,sha256,file_data,created_at)
       VALUES($1,$2,'lampiran-arahan.pdf','application/pdf',$3,$4,$5,$6)`,
      [ID.directiveFile, u['kabagrenmin'],
        PDF_BYTES.length, sha256Hex(PDF_BYTES), PDF_BYTES, at(25)],
    )

    // ---- portal ----
    await client.query(
      `INSERT INTO sdl_portal_posts(id,kind,title,summary,body,owner_unit,published,version,created_by,updated_by,created_at,updated_at)
       VALUES($1,'pengumuman','Pengumuman uji harness','Ringkasan pengumuman uji.','Isi pengumuman untuk keperluan uji harness.','urmin',true,1,$2,$2,$3,$3)`,
      [ID.portalPost, u['kabagrenmin'], at(26)],
    )

    await client.query('COMMIT')
    return { tables: DOCUMENT_TABLES.length, grantedPermissions }
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Rollback yang gagal tidak boleh menutupi error aslinya.
    }
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}
