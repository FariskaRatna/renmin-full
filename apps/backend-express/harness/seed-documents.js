import { createHash } from 'node:crypto'
import pg from 'pg'

import { sealEvidence } from '../src/crypto/evidence.js'
import { PDF_BYTES } from './files.js'

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
 * Selain `sdl_role_permissions`, identitas (user, grant, unit, sesi) tidak
 * disentuh sama sekali. Satu-satunya sentuhan lain adalah penghapusan baris
 * usang di `dropObsoleteDirectRole` — pembersihan sisa tambalan B9, bukan
 * tambalan baru.
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
  // R5G7: berkas kerja untuk satu arsip yang diinput MANUAL. Perlu sendiri
  // karena sdl_urmin_registry.work_record_id ber-UNIQUE.
  workUrminArsip: 'a0000000-0000-4000-8000-000000000006',
  workFile: 'a1000000-0000-4000-8000-000000000001',
  workTask: 'a2000000-0000-4000-8000-000000000001',

  // ---- sasaran varian jalur tulis unit-work (Engine B) ----
  //
  // Satu berkas per varian. Tidak ada indeks unik yang memaksanya di sini —
  // alasannya murni aturan 2 harness: `version` di body hanya bisa dipastikan
  // `1` kalau tidak ada varian lain yang menyentuh record yang sama lebih dulu.
  //
  // Seluruhnya di unit `urmin` klasifikasi `biasa`, dimiliki op-urmin
  // (scope `own`). Pemiliknya sengaja BUKAN pelaku varian: ka-urmin lolos lewat
  // scope `unit`, dan itu justru cabang Engine B yang ingin dibuktikan.
  workWriteUpdate: 'a0000000-0000-4000-8000-000000000011',
  workWriteDelete: 'a0000000-0000-4000-8000-000000000012',
  workWriteAssign: 'a0000000-0000-4000-8000-000000000013',
  workWriteReceive: 'a0000000-0000-4000-8000-000000000014',
  workWriteComplete: 'a0000000-0000-4000-8000-000000000015',
  workWriteCancel: 'a0000000-0000-4000-8000-000000000016',

  taskWriteReceive: 'a2000000-0000-4000-8000-000000000011',
  taskWriteComplete: 'a2000000-0000-4000-8000-000000000012',
  taskWriteCancel: 'a2000000-0000-4000-8000-000000000013',

  // ---- sasaran varian jalur tulis urmin-registry (surat keluar) ----
  //
  // Di sini satu berkas kerja per register BUKAN pilihan gaya:
  // `sdl_urmin_registry.work_record_id` ber-UNIQUE, jadi satu berkas kerja
  // hanya boleh menopang satu register.
  workRegistryUpdate: 'a0000000-0000-4000-8000-000000000021',
  workRegistryDelete: 'a0000000-0000-4000-8000-000000000022',
  workRegistrySubmit: 'a0000000-0000-4000-8000-000000000023',
  workRegistryApprove: 'a0000000-0000-4000-8000-000000000024',
  workRegistryReject: 'a0000000-0000-4000-8000-000000000025',

  registryWriteUpdate: 'b0000000-0000-4000-8000-000000000011',
  registryWriteDelete: 'b0000000-0000-4000-8000-000000000012',
  registryWriteSubmit: 'b0000000-0000-4000-8000-000000000013',
  registryWriteApprove: 'b0000000-0000-4000-8000-000000000014',
  registryWriteReject: 'b0000000-0000-4000-8000-000000000015',

  // Pengajuan surat keluar menolak 409 `pdf_required_before_submit` kalau
  // berkas kerjanya tidak punya satu pun lampiran PDF yang belum dihapus.
  fileRegistrySubmit: 'a1000000-0000-4000-8000-000000000011',
  fileRegistryApprove: 'a1000000-0000-4000-8000-000000000012',
  fileRegistryReject: 'a1000000-0000-4000-8000-000000000013',

  registrySurat: 'b0000000-0000-4000-8000-000000000001',
  registryAgenda: 'b0000000-0000-4000-8000-000000000002',
  registryArsip: 'b0000000-0000-4000-8000-000000000003',
  sumda: 'b1000000-0000-4000-8000-000000000001',
  binfung: 'b2000000-0000-4000-8000-000000000001',

  incomingRegistered: 'c0000000-0000-4000-8000-000000000001',
  incomingDraft: 'c0000000-0000-4000-8000-000000000002',
  // Sasaran varian jalur sukses surat masuk. Semuanya klasifikasi 'biasa' dan
  // dibuat op-urmin: grant op-urmin ber-scope 'own' dengan batas 'biasa', jadi
  // ia hanya lolos Engine A untuk surat miliknya sendiri yang tidak 'penting'.
  incomingWriteEdit: 'c0000000-0000-4000-8000-000000000011',
  incomingWriteRegister: 'c0000000-0000-4000-8000-000000000012',
  incomingWriteDistribute: 'c0000000-0000-4000-8000-000000000013',
  incomingWriteInbox: 'c0000000-0000-4000-8000-000000000014',
  // Sasaran varian unggah lampiran (endpoint 103). Berdiri sendiri, bukan
  // menumpang surat 013: lampiran yang bertambah ikut terbaca endpoint 102 dan
  // 110, jadi berbagi record akan membuat golden varian lain bergantung pada
  // urutan eksekusi. Statusnya 'registered' karena r3b.go:241 menolak 409
  // not_registered untuk apa pun selain itu.
  incomingWriteAttach: 'c0000000-0000-4000-8000-000000000016',
  // R5G2: sasaran tautan arahan -> surat. Satu-satunya fixture surat yang punya
  // baris intake, karena ia satu-satunya yang perlu `route_status` dan
  // `kabag_recipient` terisi. Ditanam paling akhir supaya fixture `incomingId`
  // (ORDER BY created_at LIMIT 1) tetap menunjuk incomingRegistered.
  incomingKabagArahan: 'c0000000-0000-4000-8000-000000000017',
  // R5G5 (2.2a): surat milik STAF-URMIN sendiri yang menunggu Kabagrenmin dan
  // BELUM dibuka. Pemiliknya penting: grant staf-urmin ber-scope 'own', jadi
  // satu-satunya surat yang bisa ia lihat adalah buatannya sendiri — dan itulah
  // skenario yang hendak dibuktikan, bahwa pengaju tahu suratnya belum dibuka.
  incomingStafMenunggu: 'c0000000-0000-4000-8000-000000000019',
  distributionWriteInbox: 'c2000000-0000-4000-8000-000000000002',
  distributionKabagArahan: 'c2000000-0000-4000-8000-000000000003',
  distributionStafMenunggu: 'c2000000-0000-4000-8000-000000000004',
  attachment: 'c1000000-0000-4000-8000-000000000001',
  distribution: 'c2000000-0000-4000-8000-000000000001',
  dispositionTask: 'c3000000-0000-4000-8000-000000000001',
  // R5G6: satu bukti hasil tindak lanjut yang sudah terunggah, supaya endpoint
  // 146 punya berkas nyata untuk diunduh tanpa bergantung pada varian 144.
  dispositionFile: 'c4000000-0000-4000-8000-000000000001',

  // ---- rantai disposisi untuk varian jalur tulis (116–126) ----
  //
  // Satu surat terdaftar sendiri, lalu LIMA distribusi berstatus 'received'
  // kepada kasubbagren. Kelimanya perlu karena
  // `sdl_disposition_open_one_idx` UNIQUE(distribution_id,assigned_to) hanya
  // mengizinkan SATU tugas terbuka per penerima per distribusi: empat varian
  // yang menuntut tugas 'pending'/'in_progress' milik op-subbagren karena itu
  // tidak bisa berbagi distribusi. Tugas yang sudah 'completed' tidak kena
  // indeks itu, jadi kelimanya menumpang satu distribusi yang sama.
  //
  // Penerbitnya WAJIB kasubbagren: `currentIssuer()` menuntut penerbit adalah
  // penerima distribusinya sendiri, dan distribusinya sudah 'received'.
  // Pelaksananya op-subbagren — orang yang berbeda, karena
  // `sdl_disposition_not_self` menolak penerbit == pelaksana dan karena justru
  // pemisahan itu yang sedang diuji.
  incomingDisposition: 'c0000000-0000-4000-8000-000000000015',
  distributionDispositionDone: 'c2000000-0000-4000-8000-000000000011',
  distributionDispositionAccept: 'c2000000-0000-4000-8000-000000000012',
  distributionDispositionComplete: 'c2000000-0000-4000-8000-000000000013',
  distributionDispositionCandidates: 'c2000000-0000-4000-8000-000000000014',
  distributionDispositionForward: 'c2000000-0000-4000-8000-000000000015',

  taskWriteHistory: 'c3000000-0000-4000-8000-000000000011',
  taskWriteAccept: 'c3000000-0000-4000-8000-000000000012',
  taskWriteComplete: 'c3000000-0000-4000-8000-000000000013',
  taskWriteReview: 'c3000000-0000-4000-8000-000000000014',
  taskWriteCandidates: 'c3000000-0000-4000-8000-000000000015',
  taskWriteForward: 'c3000000-0000-4000-8000-000000000016',
  taskWriteFinalStatus: 'c3000000-0000-4000-8000-000000000017',
  taskWriteSubmitFinal: 'c3000000-0000-4000-8000-000000000018',
  taskWriteDecideFinal: 'c3000000-0000-4000-8000-000000000019',

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
  // Rantai anggaran. Tiap tahap butuh usulan sendiri karena
  // sdl_subbagren_pagu UNIQUE(proposal_id): satu usulan hanya boleh punya satu
  // pagu, jadi varian pendaftaran pagu mustahil berbagi usulan dengan varian
  // lain yang pagunya sudah ditanam.
  proposalWritePaguRegister: 'd0000000-0000-4000-8000-000000000021',
  proposalWritePaguVerify: 'd0000000-0000-4000-8000-000000000022',
  proposalWriteRealisasiRecord: 'd0000000-0000-4000-8000-000000000023',
  proposalWriteChain: 'd0000000-0000-4000-8000-000000000024',
  // Rantai tersendiri untuk varian unggah bukti (endpoint 69). Tidak bisa
  // menumpang rantai di atasnya: evidence.go:189 menolak 409
  // active_evidence_exists kalau realisasinya sudah punya bukti berstatus
  // 'pending' atau 'approved', dan realisasiWriteChain memang punya.
  proposalWriteEvidence: 'd0000000-0000-4000-8000-000000000025',
  paguWriteVerify: 'd1000000-0000-4000-8000-000000000002',
  paguWriteRecord: 'd1000000-0000-4000-8000-000000000003',
  paguWriteChain: 'd1000000-0000-4000-8000-000000000004',
  paguWriteEvidence: 'd1000000-0000-4000-8000-000000000005',
  realisasiWriteChain: 'd2000000-0000-4000-8000-000000000002',
  realisasiWriteEvidence: 'd2000000-0000-4000-8000-000000000003',
  evidenceWriteChain: 'd3000000-0000-4000-8000-000000000002',
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
  // R5G6. WAJIB ada di daftar ini dan SEBELUM tabel tugasnya: FK-nya
  // ON DELETE RESTRICT, jadi TRUNCATE atas sdl_urmin_disposition_tasks akan
  // gagal selama anaknya tidak ikut dikosongkan dalam pernyataan yang sama.
  'sdl_urmin_disposition_files',
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
  // R5G13. WAJIB dikosongkan: tanpa ini deret nomor surat terus menanjak
  // antar-run, sehingga capture memperoleh 1 dan compare memperoleh 2 untuk
  // surat yang sama. Berbeda dari master jenis surat dan kode arsip yang justru
  // DIPULIHKAN — deret bukan data referensi, ia penghitung milik run ini.
  'sdl_surat_nomor_urut',
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
    // Pelaksana disposisi, sekaligus yang meneruskan. Lihat catatan DISPOSISI
    // di bawah daftar ini.
    'urmin.disposisi.execute', 'urmin.disposisi.forward',
  ],
  br_staf_subbagren: [
    'subbagren.usulan.read', 'subbagren.usulan.create', 'subbagren.usulan.update',
    'subbagren.usulan.submit',
    // SASARAN penerusan, bukan pelakunya: ia butuh `execute` supaya lolos
    // `dispositionEligible`, tapi sengaja TIDAK diberi `forward` — rantai
    // berhenti padanya, dan itu bagian dari yang diuji.
    'urmin.disposisi.execute',
  ],
  br_kasubbagren: [
    'subbagren.usulan.read', 'subbagren.usulan.create', 'subbagren.usulan.update',
    'subbagren.usulan.submit', 'subbagren.usulan.review', 'subbagren.usulan.consolidate',
    'subbagren.anggaran.pagu.verify', 'subbagren.anggaran.realisasi.verify',
    'subbagren.anggaran.bukti.read', 'subbagren.anggaran.bukti.verify',
    'subbagren.anggaran.reconcile',
    // Penerbit disposisi: ia pula yang menelaah hasilnya dan mengajukannya ke
    // pimpinan. Ketiganya memang satu peran — yang dipisahkan adalah penerbit
    // lawan pelaksana, dan penerbit lawan PEMUTUS akhir (kabagrenmin).
    'urmin.disposisi.issue', 'urmin.disposisi.review', 'urmin.disposisi.final.submit',
  ],
  // Kabagrenmin dipakai sebagai PENCATAT anggaran di harness, bukan karena
  // begitu seharusnya di lapangan, melainkan karena ia satu-satunya jalan
  // menjalankan kode pendaftaran pagu dan pencatatan realisasi sama sekali.
  //
  // Konfigurasi produksi memberi 'pagu.register' dan 'realisasi.record' HANYA
  // kepada br_op_subbagren, dan grant op-subbagren ber-scope 'assigned'
  // (sdl_access_grants). Engine A meloloskan scope 'assigned' hanya kalau
  // doc.AssignedUserIDs memuat pemanggil (access/policy.go), sementara seluruh
  // handler subbagren tidak pernah mengisi field itu. Akibatnya kedua operasi
  // itu TIDAK TERJANGKAU oleh siapa pun — lihat MIGRATION-PLAN.md.
  //
  // Kabagrenmin ber-scope 'unit' di subbagren dan merupakan orang yang BERBEDA
  // dari kasubbagren, sehingga aturan maker-checker ('self_verification_denied')
  // tetap bisa diuji sebagai jalur sukses, bukan sebagai penolakan.
  br_kabagrenmin: [
    'subbagren.usulan.read', 'subbagren.usulan.consolidate',
    'subbagren.anggaran.reconcile', 'subbagren.anggaran.bukti.read',
    'subbagren.anggaran.pagu.register', 'subbagren.anggaran.realisasi.record',
    // `bukti.upload` ada di sini karena alasan yang sama persis dengan dua
    // kunci di atasnya, bukan sebagai pelonggaran baru: katalog memberikannya
    // HANYA kepada br_op_subbagren, yang grant-nya ber-scope 'assigned' dan
    // karena itu tidak pernah lolos Engine A. Tanpa ini endpoint 69 mustahil
    // dijalankan jalur suksesnya oleh siapa pun, dan dukungan multipart di
    // harness tidak akan membuktikan apa-apa selain 404.
    'subbagren.anggaran.bukti.upload',
    // Pimpinan: memantau dan memutuskan, tidak pernah menerbitkan maupun
    // mengerjakan. Endpoint 126 menolak pemutus yang pernah menyentuh satu
    // tugas mana pun di rantainya, jadi pemisahan ini bukan kerapian belaka —
    // tanpa itu seluruh varian persetujuan final akan 403 self_approval_denied.
    'urmin.disposisi.final.monitor', 'urmin.disposisi.final.approve',
  ],
}

/**
 * DISPOSISI — temuan 2026-10-31, lebih luas daripada kasus anggaran.
 *
 * Dari 12 permission `urmin.disposisi.*` di katalog `sdl_permissions`,
 * **sebelas tidak dimiliki role mana pun**; hanya `urmin.disposisi.read` yang
 * diberikan, dan hanya kepada `br_ka_urmin`. Akibatnya endpoint 115
 * (menerbitkan disposisi) dan SELURUH mount `dispositions` (11 endpoint)
 * tidak terjangkau siapa pun pada konfigurasi seed apa adanya.
 *
 * `issue` diberikan ke kasubbagren dan `execute` ke op-subbagren supaya
 * penerbit dan pelaksana tetap orang yang berbeda — aturan rantai disposisi
 * bersandar pada pemisahan itu dan akan hilang kalau keduanya satu akun.
 *
 * Seperti biasa: **ini tambalan uji, bukan usulan konfigurasi produksi.**
 */
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
  await dropObsoleteDirectRole(client)
  return added
}

/**
 * Pembersihan, bukan tambalan.
 *
 * Antara dua sesi 2026-11-01 harness sempat menyisipkan satu baris
 * `sdl_user_roles` untuk kabagrenmin, karena `outgoingManager()` waktu itu
 * menuntut peran LANGSUNG dan bukan grant berskop seperti pemeriksaan lain —
 * temuan B9. Query-nya kini sudah diperbaiki di kedua backend, jadi tambalan
 * itu tidak diperlukan lagi.
 *
 * Barisnya dihapus aktif, bukan sekadar berhenti disisipkan: `sdl_user_roles`
 * TIDAK ikut `TRUNCATE` (ia tabel identitas), jadi di database mana pun yang
 * sempat menjalankan harness versi itu barisnya masih tertinggal — dan selama
 * ia ada, endpoint 50/51 lolos lewat jalur LAMA dan perbaikan B9 tidak
 * terbukti apa-apa. Hijau karena alasan yang salah.
 *
 * Aman: satu-satunya penulis `sdl_user_roles` di seluruh codebase adalah
 * bootstrap Superadmin (`auth/bootstrap.go:64`), dan baris itu ber-role_key
 * 'superadmin' sehingga tidak tersentuh predikat di bawah.
 */
async function dropObsoleteDirectRole(client) {
  await client.query("DELETE FROM sdl_user_roles WHERE role_key='br_kabagrenmin'")
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Tujuh field surat keluar yang dikenal `urminregisterFields` (urmin_register.go:18). */
function outgoingFields(nomorSurat, perihal) {
  return {
    nomorSurat,
    tujuan: 'Kepala Bagian Perencanaan Polda',
    tanggalSurat: '2026-10-01',
    perihal,
    sifatSurat: 'Biasa',
    // Wajib '' atau 'Draft': urmin_register.go:184 menolak nilai lain supaya
    // status administrasi tidak bisa dipalsukan lewat CRUD biasa.
    statusAdministrasi: 'Draft',
    keterangan: 'Data uji harness untuk jalur tulis surat keluar.',
  }
}

/**
 * Padanan outgoingContentHash (outgoing_review.go:291) — implementasi KETIGA,
 * di luar Go dan Express.
 *
 * Tiga detail serialisasi Go yang harus ditiru persis, dan ketiganya diam-diam
 * mengubah digest kalau salah:
 *
 *   1. Urutan field struct: code, title, fields, files. `JSON.stringify`
 *      mempertahankan urutan penyisipan, jadi objeknya dirakit berurutan.
 *   2. `fields` bertipe map[string]any, dan `json.Marshal` SELALU mengurutkan
 *      kunci map. Kunci di sini semuanya ASCII, jadi urutan bytewise Go dan
 *      urutan UTF-16 JavaScript kebetulan sama.
 *   3. Go meng-escape `<`, `>`, dan `&` menjadi </>/& secara
 *      default. Nilai fixture sengaja menghindari ketiganya supaya perbedaan
 *      itu tidak pernah terpicu.
 */
function outgoingContentHash(code, title, fields, files) {
  const sorted = {}
  for (const key of Object.keys(fields).sort()) sorted[key] = fields[key]
  return sha256Hex(Buffer.from(JSON.stringify({ code, title, fields: sorted, files }), 'utf8'))
}

async function userIds(client) {
  const { rows } = await client.query('SELECT lower(username) AS username, id::text AS id FROM sdl_users')
  const byName = new Map(rows.map((row) => [row.username, row.id]))

  const required = [
    'ka-urmin', 'staf-urmin', 'op-urmin',
    'kasubbagren', 'op-subbagren', 'staf-subbagren',
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
      [ID.workUrminArsip, 'urmin', 'Arsip', 'Berkas kerja arsip Urmin', u['op-urmin'], 5],
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

    // ---- R5G12: master data persuratan, dipulihkan bukan dikosongkan ----
    //
    // `sdl_surat_jenis` dan `sdl_surat_kode_arsip` SENGAJA tidak masuk daftar
    // TRUNCATE: isinya datang dari migrasi 037/038, bukan dari seed ini, dan
    // mengosongkannya berarti menghapus data yang tidak bisa dipulihkan karena
    // migrasinya sudah tercatat diterapkan.
    //
    // Yang dilakukan di sini kebalikannya: memastikan baris yang seharusnya ada
    // memang ada, dan membuang sisa kode uji yang mungkin tertinggal kalau satu
    // rangkaian varian gagal di tengah jalan. Itu membuat harness tidak bisa
    // merusak master data secara permanen — pelajaran dari probe DELETE yang
    // sempat menghapus satu-satunya jenis surat.
    await client.query(
      "INSERT INTO sdl_surat_jenis(code,name) VALUES('ND','Nota Dinas') ON CONFLICT(code) DO NOTHING",
    )
    await client.query("DELETE FROM sdl_surat_jenis WHERE code IN ('ZX','ZY','ZZ')")

    // ---- registry per unit ----
    for (const [id, kind, ref, title, work, owner, minute] of [
      [ID.registrySurat, 'surat_keluar', 'SK-2026-001', 'Surat keluar uji harness', ID.workUrmin, u['op-urmin'], 6],
      [ID.registryAgenda, 'agenda', 'AG-2026-001', 'Agenda uji harness', ID.workUrminAgenda, u['op-urmin'], 7],
      // R5G7: arsip yang diinput manual. `fields` kosong, TANPA kunci 'sumber'
      // — persis bentuk seluruh arsip yang dibuat sebelum R5G7. Keberadaannya
      // membuat kategori 'manual' terbukti BERISI, bukan sekadar kosong, dan
      // sekaligus membuktikan ia tidak bocor ke kategori 'disposisi'.
      [ID.registryArsip, 'arsip', 'AR-2026-001', 'Arsip input manual uji harness', ID.workUrminArsip, u['op-urmin'], 8],
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

    // ---- Engine B: sasaran varian jalur tulis unit-work ----
    //
    // Stempel waktu sengaja di menit 200+ supaya SELURUH fixture lama
    // (`unitWorkRecordId`, `unitWorkFileId`, `unitWorkTaskId`,
    // `urminRegistryId`) yang dicari dengan `ORDER BY created_at LIMIT 1`
    // tetap menunjuk baris yang sama. Menambah fixture di sini tidak boleh
    // menggeser satu pun kasus dasar.
    for (const [id, title, minute] of [
      [ID.workWriteUpdate, 'Berkas uji penyuntingan unit-work', 200],
      [ID.workWriteDelete, 'Berkas uji penghapusan unit-work', 201],
      [ID.workWriteAssign, 'Berkas uji penugasan unit-work', 202],
      [ID.workWriteReceive, 'Berkas uji penerimaan tugas unit-work', 203],
      [ID.workWriteComplete, 'Berkas uji penyelesaian tugas unit-work', 204],
      [ID.workWriteCancel, 'Berkas uji pembatalan tugas unit-work', 205],
    ]) {
      await client.query(
        `INSERT INTO sdl_unit_work_records(id,unit_key,category,title,description,classification,created_by,updated_by,created_at,updated_at)
         VALUES($1,'urmin','Persuratan',$2,'Data uji harness untuk jalur tulis unit-work.','biasa',$3,$3,$4,$4)`,
        [id, title, u['op-urmin'], at(minute)],
      )
    }

    // Tiga tugas internal, satu per transisi. Pemberinya ka-urmin dan
    // penerimanya staf-urmin — pemisahan itu yang membuat varian 29/30
    // (dijalankan penerima) dan 31 (dijalankan pemberi) benar-benar menguji
    // cabang `who == to` lawan `who == from` di taskAction, bukan sekadar
    // lewat karena kebetulan satu orang.
    for (const [id, record, status, instruction, minute] of [
      [ID.taskWriteReceive, ID.workWriteReceive, 'pending',
        'Mohon terima tugas ini sebagai uji transisi pending ke received.', 206],
      [ID.taskWriteComplete, ID.workWriteComplete, 'received',
        'Mohon selesaikan tugas ini sebagai uji transisi received ke completed.', 207],
      [ID.taskWriteCancel, ID.workWriteCancel, 'pending',
        'Tugas ini akan dibatalkan pemberinya sebagai uji transisi cancelled.', 208],
    ]) {
      await client.query(
        `INSERT INTO sdl_unit_work_tasks(id,record_id,from_user,to_user,instruction,status,response,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,'',$7,$7)`,
        [id, record, u['ka-urmin'], u['staf-urmin'], instruction, status, at(minute)],
      )
    }

    // ---- Engine B: sasaran varian jalur tulis urmin-registry ----
    //
    // Lima berkas kerja + lima register surat keluar. Tiga di antaranya
    // dilengkapi lampiran PDF karena `outgoingSubmit` menolak 409
    // `pdf_required_before_submit` tanpa satu pun PDF yang belum dihapus.
    for (const [work, register, code, title, nomor, perihal, file, minute] of [
      [ID.workRegistryUpdate, ID.registryWriteUpdate, 'SK-2026-911',
        'Surat keluar uji penyuntingan', 'SK/911/XI/2026', 'Permintaan data dukung perencanaan', null, 210],
      [ID.workRegistryDelete, ID.registryWriteDelete, 'SK-2026-912',
        'Surat keluar uji penghapusan', 'SK/912/XI/2026', 'Pemberitahuan pembatalan kegiatan', null, 212],
      [ID.workRegistrySubmit, ID.registryWriteSubmit, 'SK-2026-913',
        'Surat keluar uji pengajuan', 'SK/913/XI/2026', 'Permohonan persetujuan pelaksanaan', ID.fileRegistrySubmit, 214],
      [ID.workRegistryApprove, ID.registryWriteApprove, 'SK-2026-914',
        'Surat keluar uji persetujuan', 'SK/914/XI/2026', 'Permohonan persetujuan anggaran', ID.fileRegistryApprove, 216],
      [ID.workRegistryReject, ID.registryWriteReject, 'SK-2026-915',
        'Surat keluar uji penolakan', 'SK/915/XI/2026', 'Permohonan persetujuan perjalanan', ID.fileRegistryReject, 218],
    ]) {
      const fields = outgoingFields(nomor, perihal)
      await client.query(
        `INSERT INTO sdl_unit_work_records(id,unit_key,category,title,description,classification,created_by,updated_by,created_at,updated_at)
         VALUES($1,'urmin','Register Urmin surat_keluar',$2,'','biasa',$3,$3,$4,$4)`,
        [work, title, u['op-urmin'], at(minute)],
      )
      if (file !== null) {
        await client.query(
          `INSERT INTO sdl_unit_work_files(id,record_id,file_name,media_type,byte_size,sha256,file_data,uploaded_by,created_at)
           VALUES($1,$2,'konsep-surat.pdf','application/pdf',$3,$4,$5,$6,$7)`,
          [file, work, PDF_BYTES.length, sha256Hex(PDF_BYTES), PDF_BYTES, u['op-urmin'], at(minute)],
        )
      }
      await client.query(
        `INSERT INTO sdl_urmin_registry(id,kind,ref_code,title,fields,work_record_id,created_by,updated_by,created_at,updated_at)
         VALUES($1,'surat_keluar',$2,$3,$4::jsonb,$5,$6,$6,$7,$7)`,
        [register, code, title, JSON.stringify(fields), work, u['op-urmin'], at(minute)],
      )
    }

    // Empat workflow tahap 'draft'; yang kelima sengaja ditanam sudah
    // 'submitted' beserta `content_sha256`-nya.
    //
    // Hash itu DIHITUNG DI JAVASCRIPT mengikuti serialisasi `outgoingContentHash`
    // milik Go. Kalau varian 50 menjawab 200, artinya Go DAN Express sama-sama
    // menghasilkan digest yang sama dengan implementasi ketiga di sini —
    // pembuktian tiga arah, bukan dua. Kalau rumusnya meleset, KEDUA backend
    // menjawab 409 document_integrity_changed dan perbandingannya tetap hijau;
    // jadi angka 200 pada capture wajib diperiksa dengan mata, bukan diasumsikan.
    for (const [register, minute] of [
      [ID.registryWriteUpdate, 211],
      [ID.registryWriteDelete, 213],
      [ID.registryWriteSubmit, 215],
      [ID.registryWriteReject, 219],
    ]) {
      await client.query(
        `INSERT INTO sdl_outgoing_workflows(register_id,stage,version,last_note,updated_at)
         VALUES($1,'draft',1,'',$2)`,
        [register, at(minute)],
      )
    }

    await client.query(
      `INSERT INTO sdl_outgoing_workflows(register_id,stage,version,content_sha256,submitted_at,last_actor,last_note,updated_at)
       VALUES($1,'submitted',2,$2,$3,$4,$5,$3)`,
      [
        ID.registryWriteApprove,
        outgoingContentHash(
          'SK-2026-914',
          'Surat keluar uji persetujuan',
          outgoingFields('SK/914/XI/2026', 'Permohonan persetujuan anggaran'),
          [{ id: ID.fileRegistryApprove, sha256: sha256Hex(PDF_BYTES) }],
        ),
        at(217), u['ka-urmin'], 'Diajukan untuk persetujuan Kabagrenmin.',
      ],
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

    // Sasaran varian jalur sukses. Ditanam SESUDAH dua surat di atas supaya
    // fixture `incomingId` (ORDER BY created_at LIMIT 1) tetap menunjuk
    // incomingRegistered dan seluruh kasus dasar tidak bergeser.
    //
    // Ketiganya sengaja TIDAK punya baris di sdl_urmin_incoming_intake:
    // endpoint register menolak 409 use_intake_submission untuk surat
    // ber-intake, dan distribusi hanya bebas untuk surat warisan R3B.
    for (const [id, number, subject, status, minute] of [
      [ID.incomingWriteEdit, '011/UJI/2026', 'Sasaran uji penyuntingan surat masuk', 'draft', 30],
      [ID.incomingWriteRegister, '012/UJI/2026', 'Sasaran uji pendaftaran surat masuk', 'draft', 31],
      [ID.incomingWriteDistribute, '013/UJI/2026', 'Sasaran uji distribusi surat masuk', 'registered', 32],
      [ID.incomingWriteInbox, '014/UJI/2026', 'Sasaran uji kotak masuk distribusi', 'registered', 33],
    ]) {
      await client.query(
        `INSERT INTO sdl_urmin_incoming(id,letter_number,sender,letter_date,received_date,subject,classification,status,created_by,updated_by,created_at,updated_at)
         VALUES($1,$2,'Bagian Perencanaan Polda','2026-09-20','2026-09-22',$3,'biasa',$4,$5,$5,$6,$6)`,
        [id, number, subject, status, u['op-urmin'], at(minute)],
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

    // Sasaran rantai kotak masuk: varian 112 menerimanya, lalu varian 115
    // menerbitkan disposisi di atasnya. Ditujukan ke kasubbagren karena
    // penerbit disposisi wajib punya `urmin.distribusi.receive` DAN
    // `urmin.disposisi.issue`; pelaksananya op-subbagren, orang yang berbeda.
    await client.query(
      `INSERT INTO sdl_urmin_distributions(id,incoming_id,sent_by,recipient_unit,recipient_user,status,reason,sent_at)
       VALUES($1,$2,$3,'subbagren',$4,'sent',$5,$6)`,
      [ID.distributionWriteInbox, ID.incomingWriteInbox, u['ka-urmin'], u['kasubbagren'],
        'Diteruskan ke Kasubbagren untuk uji rantai kotak masuk.', at(34)],
    )

    // ---- R5G2: surat yang menunggu Kabagrenmin dan SUDAH ia terima ----
    //
    // Tiga baris yang harus lengkap bersama, karena `letterLinkAllowed`
    // menuntut ketiganya sekaligus: baris intake ber-`route_status`
    // 'awaiting_kabag', `kabag_recipient` = kabagrenmin, DAN distribusi kepada
    // orang itu yang sudah berstatus 'received'. Kurang satu saja, varian 90
    // bervariasi 'arahan-dari-surat' akan 400 — dan 400 itu benar, bukan bug.
    //
    // `intake_route_consistency` di migrasi 024 juga mengikat: 'awaiting_kabag'
    // mewajibkan submitted_at terisi DAN needs_disposition TRUE.
    await client.query(
      `INSERT INTO sdl_urmin_incoming(id,letter_number,sender,letter_date,received_date,subject,classification,status,created_by,updated_by,created_at,updated_at)
       VALUES($1,'017/UJI/2026','Bagian Perencanaan Polda','2026-09-20','2026-09-22',
              'Sasaran uji arahan pimpinan dari surat masuk','biasa','registered',$2,$2,$3,$3)`,
      [ID.incomingKabagArahan, u['op-urmin'], at(40)],
    )
    await client.query(
      `INSERT INTO sdl_urmin_incoming_intake(incoming_id,letter_kind,needs_disposition,route_status,kabag_recipient,submitted_at,updated_at)
       VALUES($1,'permintaan',TRUE,'awaiting_kabag',$2,$3,$3)`,
      [ID.incomingKabagArahan, u['kabagrenmin'], at(41)],
    )
    await client.query(
      `INSERT INTO sdl_urmin_distributions(id,incoming_id,sent_by,recipient_unit,recipient_user,status,reason,sent_at,received_at)
       VALUES($1,$2,$3,'urmin',$4,'received',$5,$6,$7)`,
      [ID.distributionKabagArahan, ID.incomingKabagArahan, u['op-urmin'], u['kabagrenmin'],
        'Surat masuk menunggu arahan Kabagrenmin untuk uji harness.', at(41), at(42)],
    )

    // ---- R5G5 (2.2a): surat staf-urmin yang BELUM dibuka Kabagrenmin ----
    //
    // Pasangan dari fixture R5G2 di atas, dan perbedaannya satu-satunya yang
    // penting: distribusinya berstatus 'sent', bukan 'received'. Itu yang
    // membuat workflowStatus-nya berhenti di 'awaiting_kabag' — tepat keadaan
    // yang ingin dilihat pengajunya sebagai "Belum dibuka".
    //
    // Dibuat staf-urmin supaya lolos grant ber-scope 'own' miliknya.
    await client.query(
      `INSERT INTO sdl_urmin_incoming(id,letter_number,sender,letter_date,received_date,subject,classification,status,created_by,updated_by,created_at,updated_at)
       VALUES($1,'019/UJI/2026','Bagian Perencanaan Polda','2026-09-20','2026-09-22',
              'Sasaran uji pemantauan surat menunggu Kabagrenmin','biasa','registered',$2,$2,$3,$3)`,
      [ID.incomingStafMenunggu, u['staf-urmin'], at(43)],
    )
    await client.query(
      `INSERT INTO sdl_urmin_incoming_intake(incoming_id,letter_kind,needs_disposition,route_status,kabag_recipient,submitted_at,updated_at)
       VALUES($1,'undangan',TRUE,'awaiting_kabag',$2,$3,$3)`,
      [ID.incomingStafMenunggu, u['kabagrenmin'], at(44)],
    )
    await client.query(
      `INSERT INTO sdl_urmin_distributions(id,incoming_id,sent_by,recipient_unit,recipient_user,status,reason,sent_at)
       VALUES($1,$2,$3,'urmin',$4,'sent',$5,$6)`,
      [ID.distributionStafMenunggu, ID.incomingStafMenunggu, u['staf-urmin'], u['kabagrenmin'],
        'Surat masuk diajukan staf dan menunggu dibuka Kabagrenmin.', at(44)],
    )

    await client.query(
      `INSERT INTO sdl_urmin_disposition_tasks(id,distribution_id,incoming_id,unit_key,issued_by,assigned_to,instruction,due_date,status,depth,version,created_at,updated_at)
       VALUES($1,$2,$3,'subbagren',$4,$5,$6,'2026-11-30','pending',0,1,$7,$7)`,
      [ID.dispositionTask, ID.distribution, ID.incomingRegistered,
        u['kasubbagren'], u['op-subbagren'],
        'Siapkan bahan jawaban dan laporkan hasilnya.', at(15)],
    )


    // ---- rantai disposisi: sasaran varian jalur tulis 117–126 ----
    //
    // Catatan: tugas di atas (ID.dispositionTask) SENGAJA dibiarkan rantainya
    // tidak sah — distribusinya masih 'sent' dan penerimanya bukan penerbit
    // tugasnya, sehingga `currentIssuer()` menolaknya. Ia merekam bentuk
    // penolakan 403/404 untuk kasus dasar, dan tidak boleh "diperbaiki".
    // Varian di bawah memakai rantai terpisah yang benar-benar sah.
    await client.query(
      `INSERT INTO sdl_urmin_incoming(id,letter_number,sender,letter_date,received_date,subject,classification,status,created_by,updated_by,created_at,updated_at)
       VALUES($1,'015/UJI/2026','Bagian Perencanaan Polda','2026-09-20','2026-09-22',$2,'biasa','registered',$3,$3,$4,$4)`,
      [ID.incomingDisposition, 'Sasaran uji rantai disposisi', u['op-urmin'], at(35)],
    )

    // Sasaran varian unggah lampiran (endpoint 103). Ditanam PALING AKHIR di
    // antara surat masuk, dan itu disengaja: `agenda_no` kolom identity yang
    // dialokasikan menurut urutan INSERT dan ikut terserialisasi apa adanya ke
    // JSON. Menyisipkannya di tengah akan menggeser nomor agenda setiap surat
    // sesudahnya dan membuat seluruh golden surat masuk berubah tanpa ada
    // perilaku backend yang berbeda.
    //
    // Milik op-urmin dan berklasifikasi 'biasa' karena grant op-urmin
    // ber-scope 'own' berbatas 'biasa'; 'registered' karena r3b.go:241
    // menolak 409 not_registered untuk status lain.
    await client.query(
      `INSERT INTO sdl_urmin_incoming(id,letter_number,sender,letter_date,received_date,subject,classification,status,created_by,updated_by,created_at,updated_at)
       VALUES($1,'016/UJI/2026','Bagian Perencanaan Polda','2026-09-20','2026-09-22',$2,'biasa','registered',$3,$3,$4,$4)`,
      [ID.incomingWriteAttach, 'Sasaran uji unggah lampiran surat masuk', u['op-urmin'], at(50)],
    )

    // Lima distribusi 'received' kepada kasubbagren. Status 'received' bukan
    // kenyamanan: `currentIssuer()` menolak distribusi yang belum diambil, dan
    // tanpanya SELURUH rantai di bawahnya tidak sah.
    for (const [id, reason, minute] of [
      [ID.distributionDispositionDone, 'Diteruskan untuk uji disposisi yang sudah selesai.', 36],
      [ID.distributionDispositionAccept, 'Diteruskan untuk uji penerimaan tugas disposisi.', 37],
      [ID.distributionDispositionComplete, 'Diteruskan untuk uji penyelesaian tugas disposisi.', 38],
      [ID.distributionDispositionCandidates, 'Diteruskan untuk uji daftar calon penerusan.', 39],
      [ID.distributionDispositionForward, 'Diteruskan untuk uji penerusan disposisi berjenjang.', 40],
    ]) {
      await client.query(
        `INSERT INTO sdl_urmin_distributions(id,incoming_id,sent_by,recipient_unit,recipient_user,status,reason,sent_at,received_at)
         VALUES($1,$2,$3,'subbagren',$4,'received',$5,$6,$6)`,
        [id, ID.incomingDisposition, u['ka-urmin'], u['kasubbagren'], reason, at(minute)],
      )
    }

    // Tugas TERBUKA: satu distribusi masing-masing, karena
    // `sdl_disposition_open_one_idx` hanya mengizinkan satu tugas pending atau
    // in_progress per (distribusi, pelaksana) dan pelaksananya sama semua.
    //
    // Tenggat dua tugas penerusan dibuat jauh lebih panjang: endpoint 122
    // menolak 409 `child_due_after_parent` kalau tenggat anak melewati induk.
    for (const [id, distribution, instruction, due, status, accepted, minute] of [
      [ID.taskWriteAccept, ID.distributionDispositionAccept,
        'Uji penerimaan disposisi: terima tugas ini lalu kerjakan.',
        '2027-03-31', 'pending', null, 41],
      [ID.taskWriteComplete, ID.distributionDispositionComplete,
        'Uji penyelesaian disposisi: selesaikan dan laporkan hasilnya.',
        '2027-03-31', 'in_progress', at(42), 42],
      [ID.taskWriteCandidates, ID.distributionDispositionCandidates,
        'Uji daftar calon penerusan disposisi berjenjang.',
        '2027-12-31', 'in_progress', at(43), 43],
      [ID.taskWriteForward, ID.distributionDispositionForward,
        'Uji penerusan disposisi berjenjang kepada staf pelaksana.',
        '2027-12-31', 'in_progress', at(44), 44],
    ]) {
      await client.query(
        `INSERT INTO sdl_urmin_disposition_tasks(id,distribution_id,incoming_id,unit_key,issued_by,assigned_to,instruction,due_date,status,accepted_at,depth,version,created_at,updated_at)
         VALUES($1,$2,$3,'subbagren',$4,$5,$6,$7::date,$8,$9,0,1,$10,$10)`,
        [id, distribution, ID.incomingDisposition, u['kasubbagren'], u['op-subbagren'],
          instruction, due, status, accepted, at(minute)],
      )
    }

    // Tugas SELESAI: tidak kena indeks tugas-terbuka, jadi kelimanya boleh
    // menumpang satu distribusi yang sama. `completed_at` jauh sebelum tenggat
    // supaya `dispositionSLA` tetap 'completed_on_time' dan tidak berubah
    // seiring berjalannya waktu nyata.
    for (const [id, instruction, minute] of [
      [ID.taskWriteHistory, 'Uji riwayat disposisi: laporkan hasil telaah berkas.', 45],
      [ID.taskWriteReview, 'Uji telaah disposisi: hasil pekerjaan menunggu penilaian penerbit.', 46],
      [ID.taskWriteFinalStatus, 'Uji pembacaan status persetujuan final disposisi.', 47],
      [ID.taskWriteSubmitFinal, 'Uji pengajuan persetujuan final disposisi kepada pimpinan.', 48],
      [ID.taskWriteDecideFinal, 'Uji keputusan akhir pimpinan atas disposisi yang diajukan.', 49],
    ]) {
      await client.query(
        `INSERT INTO sdl_urmin_disposition_tasks(id,distribution_id,incoming_id,unit_key,issued_by,assigned_to,instruction,due_date,status,accepted_at,completed_at,completion_note,depth,version,created_at,updated_at)
         VALUES($1,$2,$3,'subbagren',$4,$5,$6,'2027-03-31','completed',$7,$8,$9,0,1,$7,$8)`,
        [id, ID.distributionDispositionDone, ID.incomingDisposition,
          u['kasubbagren'], u['op-subbagren'], instruction,
          at(minute), at(minute + 100),
          'Pekerjaan telah diselesaikan dan hasilnya dilaporkan.'],
      )
    }

    // R5G6: satu bukti hasil tindak lanjut yang sudah terunggah.
    //
    // Ditempelkan pada ID.taskWriteHistory, BUKAN ID.dispositionTask. Fixture
    // `dispositionTaskId` menunjuk tugas yang distribusinya masih 'sent',
    // sehingga `taskChainValid` menolaknya dan SELURUH pihak mendapat 404 di
    // sana — itu memang gunanya, sebagai sasaran probe. Tugas ini sebaliknya
    // punya distribusi 'received' dan dua pihak yang sah: kasubbagren sebagai
    // penerbit dan op-subbagren sebagai pelaksana.
    //
    // Diunggah op-subbagren, satu-satunya pihak yang boleh mengunggah.
    await client.query(
      `INSERT INTO sdl_urmin_disposition_files(id,disposition_id,uploaded_by,filename,mime_type,size_bytes,sha256,body,created_at)
       VALUES($1,$2,$3,'bukti-tindak-lanjut.pdf','application/pdf',$4,$5,$6,$7)`,
      [ID.dispositionFile, ID.taskWriteHistory, u['op-subbagren'],
        PDF_BYTES.length, sha256Hex(PDF_BYTES), PDF_BYTES, at(150)],
    )

    // Riwayat hanya untuk sasaran endpoint 117. Telaah TIDAK disimpan sebagai
    // event — ia baris tersendiri yang disusulkan handler di ekor daftar.
    for (const [event, reason, minute] of [
      ['issued', 'Tugas diterbitkan kepada pelaksana yang ditunjuk.', 45],
      ['accepted', 'Tugas diterima dan mulai dikerjakan pelaksana.', 60],
      ['completed', 'Pekerjaan telah diselesaikan dan hasilnya dilaporkan.', 145],
    ]) {
      await client.query(
        `INSERT INTO sdl_urmin_disposition_events(disposition_id,actor_id,event_key,reason,created_at)
         VALUES($1,$2,$3,$4,$5)`,
        [ID.taskWriteHistory, event === 'issued' ? u['kasubbagren'] : u['op-subbagren'],
          event, reason, at(minute)],
      )
    }

    // Telaah 'approved' adalah prasyarat `readyForSubmission`. Sasaran
    // endpoint 120 sengaja TIDAK punya baris di sini: ia harus berstatus
    // 'awaiting_review', kalau tidak varian telaahnya 409 review_state_conflict.
    for (const [task, minute] of [
      [ID.taskWriteHistory, 160],
      [ID.taskWriteFinalStatus, 161],
      [ID.taskWriteSubmitFinal, 162],
      [ID.taskWriteDecideFinal, 163],
    ]) {
      await client.query(
        `INSERT INTO sdl_urmin_disposition_reviews(disposition_id,reviewed_by,decision,reason,created_at)
         VALUES($1,$2,'approved',$3,$4)`,
        [task, u['kasubbagren'], 'Hasil pekerjaan sudah sesuai instruksi dan dapat diterima.', at(minute)],
      )
    }

    // Satu pengajuan final berstatus 'pending' — sasaran endpoint 126.
    // Pengajunya kasubbagren; pemutusnya kabagrenmin, orang yang berbeda,
    // karena `sdl_final_approval_state` menolak decided_by == submitted_by.
    await client.query(
      `INSERT INTO sdl_urmin_final_approvals(root_task_id,submitted_by,submission_reason,submitted_at,status,version)
       VALUES($1,$2,$3,$4,'pending',1)`,
      [ID.taskWriteDecideFinal, u['kasubbagren'],
        'Seluruh tugas pada kasus ini telah selesai dan ditelaah.', at(170)],
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

    // ---- rantai anggaran: sasaran varian jalur sukses ----
    //
    // Berbeda dari usulan, varian anggaran BERANTAI, bukan berdiri sendiri:
    // verifikasi realisasi (67) menuntut buktinya sudah 'approved' (71), yang
    // menuntut pagu induknya 'verified'. Urutan eksekusinya ditentukan urutan
    // deklarasi di VARIANTS, bukan nomor endpoint.
    //
    // Pembuat baris selalu op-subbagren atau kabagrenmin, tidak pernah
    // kasubbagren: ketiga handler verifikasi menolak 403
    // 'self_verification_denied' kalau pemeriksa == pembuat.
    for (const [id, title, minute] of [
      [ID.proposalWritePaguRegister, 'Sasaran uji pendaftaran pagu', 40],
      [ID.proposalWritePaguVerify, 'Sasaran uji verifikasi pagu', 41],
      [ID.proposalWriteRealisasiRecord, 'Sasaran uji pencatatan realisasi', 42],
      [ID.proposalWriteChain, 'Sasaran uji rantai bukti dan realisasi', 43],
      [ID.proposalWriteEvidence, 'Sasaran uji unggah bukti', 52],
    ]) {
      await client.query(
        `INSERT INTO sdl_subbagren_proposals(id,fiscal_year,source_unit,title,output_target,proposed_budget,classification,status,created_by,updated_by,version,created_at,updated_at)
         VALUES($1,2026,'Subbagren',$2,'Tersedianya bahan perencanaan yang terverifikasi',300000000,'biasa','submitted',$3,$3,1,$4,$4)`,
        [id, title, u['op-subbagren'], at(minute)],
      )
      // Pendaftaran pagu menuntut telaah internal 'approved' lebih dulu
      // (budget.go: 409 internal_review_required). Keempatnya dibuat approved
      // supaya prasyarat itu tidak menjadi variabel tersembunyi.
      await client.query(
        `INSERT INTO sdl_subbagren_review_cases(proposal_id,review_status,revision_count,has_revision,updated_by,updated_at)
         VALUES($1,'approved',0,false,$2,$3)`,
        [id, u['kasubbagren'], at(minute)],
      )
    }

    // Pagu: satu 'pending' untuk diverifikasi varian 65, dua 'verified' sebagai
    // induk realisasi. Nomor otorisasi dipakai harness sebagai penanda fixture —
    // tidak pernah diubah transisi mana pun, berbeda dari status.
    //
    // Dua constraint skema mengatur bentuk baris ini, dan keduanya sudah
    // menggagalkan seed sekali:
    //   pagu_review_consistent  status != 'pending' WAJIB punya reviewed_by
    //                           dan reviewed_at; status 'pending' wajib kosong.
    //   pagu_separation         reviewed_by tidak boleh sama dengan created_by.
    // Maker-checker di sini bukan cuma aturan handler — database ikut menegakkan.
    for (const [id, proposal, authNumber, status, minute] of [
      [ID.paguWriteVerify, ID.proposalWritePaguVerify, 'DIPA-2026-9002', 'pending', 44],
      [ID.paguWriteRecord, ID.proposalWriteRealisasiRecord, 'DIPA-2026-9003', 'verified', 45],
      [ID.paguWriteChain, ID.proposalWriteChain, 'DIPA-2026-9004', 'verified', 46],
      [ID.paguWriteEvidence, ID.proposalWriteEvidence, 'DIPA-2026-9005', 'verified', 53],
    ]) {
      const reviewed = status !== 'pending'
      await client.query(
        `INSERT INTO sdl_subbagren_pagu(id,proposal_id,amount,authorization_number,authorization_issuer,authorization_date,status,created_by,reviewed_by,review_reason,reviewed_at,version,created_at)
         VALUES($1,$2,200000000,$3,'Biro Perencanaan Polda','2026-01-15',$4,$5,$6,$7,$8,$9,$10)`,
        [id, proposal, authNumber, status, u['op-subbagren'],
          reviewed ? u['kasubbagren'] : null,
          reviewed ? 'Dokumen otorisasi sudah dicocokkan dengan arsip.' : '',
          reviewed ? at(minute) : null,
          reviewed ? 2 : 1,
          at(minute)],
      )
    }

    // Realisasi rantai: 50 juta dari pagu 200 juta, belum ada realisasi
    // terverifikasi lain di bawahnya, jadi uji plafon di budget.go
    // (amount > paguAmount-used) lolos dengan sisa yang jelas.
    await client.query(
      `INSERT INTO sdl_subbagren_realisasi(id,pagu_id,amount,transaction_date,evidence_reference,description,status,created_by,version,created_at)
       VALUES($1,$2,50000000,'2026-05-20','SP2D-2026-900001','Pembayaran rantai uji bukti dan realisasi','pending',$3,1,$4)`,
      [ID.realisasiWriteChain, ID.paguWriteChain, u['op-subbagren'], at(47)],
    )

    // Bukti rantai disegel dengan kunci yang sama. Verifikasi realisasi membuka
    // amplop ini dan mencocokkan sha256 plaintext-nya; kalau segelnya tidak
    // sah, yang muncul 409 evidence_integrity_failure, bukan kegagalan seed.
    await client.query(
      `INSERT INTO sdl_subbagren_evidence(id,realisasi_id,uploaded_by,filename,mime_type,size_bytes,sha256,body,status,version,created_at)
       VALUES($1,$2,$3,'bukti-rantai-uji.pdf','application/pdf',$4,$5,$6,'pending',1,$7)`,
      [ID.evidenceWriteChain, ID.realisasiWriteChain, u['op-subbagren'],
        PDF_BYTES.length, sha256Hex(PDF_BYTES), sealEvidence(evidenceKey, PDF_BYTES), at(48)],
    )

    // Realisasi untuk varian unggah bukti (endpoint 69). SENGAJA tanpa baris
    // bukti apa pun: evidence.go:189 menolak 409 active_evidence_exists kalau
    // sudah ada bukti 'pending' atau 'approved', jadi satu-satunya realisasi
    // yang jalur unggahnya bisa diuji adalah yang masih kosong. Statusnya
    // wajib 'pending' (evidence.go:127).
    await client.query(
      `INSERT INTO sdl_subbagren_realisasi(id,pagu_id,amount,transaction_date,evidence_reference,description,status,created_by,version,created_at)
       VALUES($1,$2,30000000,'2026-05-25','SP2D-2026-900002','Pembayaran sasaran uji unggah bukti','pending',$3,1,$4)`,
      [ID.realisasiWriteEvidence, ID.paguWriteEvidence, u['op-subbagren'], at(54)],
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
