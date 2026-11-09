/**
 * R5H1 — penunjukan arahan lewat BAGIAN. Port dari
 * apps/backend/internal/directives/sections.go dan handover.go.
 *
 * Kabagrenmin tidak menunjuk orang, ia menunjuk bagian. Daftar SECTIONS di
 * bawah WAJIB identik dengan `var sections` di sections.go: kunci, label, unit,
 * dan role-nya, berikut urutannya. Perbedaan satu kunci saja berarti dua
 * backend mengirim arahan ke orang yang berbeda dari payload yang sama, dan
 * harness golden-file TIDAK akan menangkapnya -- ia membandingkan bentuk
 * respons, bukan baris yang tertulis di database.
 *
 * Alasan daftarnya hidup di kode dan bukan di tabel ada di sections.go;
 * ringkasnya: 'bagian' bukan unit, dan 'kasubbagurmin' serta 'kabagrenmin'
 * sama-sama berada di unit 'urmin'.
 */

/** Urutannya adalah urutan tampil di layar penyusun arahan. */
/**
 * R5H4 — tiga JENIS pilihan (padanan kindJabatan/kindBagian/kindPaur):
 *   jabatan  hanya pemegang role kepala (perilaku R5H1)
 *   bagian   SELURUH anggota unit: kepala, operator, staf
 *   paur     anggota satu Paur Subbagsumda (sdl_user_paur, migrasi 043)
 * `role` berisi role_key untuk jabatan, kunci Paur untuk paur, '' untuk bagian.
 */
export const SECTIONS = [
  { key: 'kasubbagren', label: 'Kasubbagren', kind: 'jabatan', unit: 'subbagren', role: 'br_kasubbagren' },
  { key: 'kasubbagsumda', label: 'Kasubbagsumda', kind: 'jabatan', unit: 'subbagsumda', role: 'br_kasubbagsumda' },
  { key: 'kasubbagbinfung', label: 'Kasubbagbinfung', kind: 'jabatan', unit: 'subbagbinfung', role: 'br_kasubbagbinfung' },
  // Kepala Urmin. Role-nya 'br_ka_urmin', bukan 'br_kasubbagurmin' -- begitulah
  // seed menamainya sejak awal, dan mengganti role_key akan mencabut grant
  // seluruh akun yang memegangnya.
  { key: 'kasubbagurmin', label: 'Kaurmin', kind: 'jabatan', unit: 'urmin', role: 'br_ka_urmin' },
  { key: 'subbagren', label: 'Subbagren', kind: 'bagian', unit: 'subbagren', role: '' },
  { key: 'subbagsumda', label: 'Subbagsumda', kind: 'bagian', unit: 'subbagsumda', role: '' },
  { key: 'subbagbinfung', label: 'Subbagbinfung', kind: 'bagian', unit: 'subbagbinfung', role: '' },
  { key: 'urmin', label: 'Urmin', kind: 'bagian', unit: 'urmin', role: '' },
  // Kunci yang sama dengan baris sdl_paur di migrasi 043.
  { key: 'paur_sumda', label: 'Paur Sumda', kind: 'paur', unit: 'subbagsumda', role: 'paur_sumda' },
  { key: 'paur_log', label: 'Paur Log', kind: 'paur', unit: 'subbagsumda', role: 'paur_log' },
  { key: 'paur_ada', label: 'Paur ADA', kind: 'paur', unit: 'subbagsumda', role: 'paur_ada' },
]

export function sectionByKey(key) {
  return SECTIONS.find((s) => s.key === key)
}

/**
 * Padanan uniqueSections (api.go). 1..SECTIONS.length kunci bagian yang dikenal, tanpa
 * duplikat. Berbeda dari uniqueRecipients, perbandingannya case-sensitive:
 * kunci bagian adalah konstanta yang kita tulis sendiri, bukan UUID yang
 * datang dengan kapitalisasi sembarang.
 */
export function uniqueSections(keys) {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > SECTIONS.length) return false
  const seen = new Set()
  for (const key of keys) {
    if (typeof key !== 'string' || !sectionByKey(key) || seen.has(key)) return false
    seen.add(key)
  }
  return true
}

/** Padanan validasi bagian pada draf (draft.go): 0..SECTIONS.length, boleh kosong. */
export function uniqueDraftSections(keys) {
  if (!Array.isArray(keys)) return false
  if (keys.length > SECTIONS.length) return false
  const seen = new Set()
  for (const key of keys) {
    if (typeof key !== 'string' || !sectionByKey(key) || seen.has(key)) return false
    seen.add(key)
  }
  return true
}

/**
 * SQL sectionHoldersSQL (sections.go, R5H4), disalin verbatim kecuali alias
 * kolom -- pg mengembalikan objek berkunci nama kolom, dan dua `bool_or(...)`
 * tanpa alias akan saling menimpa di kunci yang sama. Penjelasan saringan per
 * jenis ada di sections.go.
 */
const SECTION_HOLDERS_SQL = `SELECT s.section_key AS section_key,u.id::text AS id,u.display_name AS name,
  bool_or(rp.permission_key IS NOT NULL AND g.scope IN ('unit','assigned')) AS can_biasa,
  bool_or(rp.permission_key IS NOT NULL AND g.scope IN ('unit','assigned') AND g.classification_limit='penting') AS can_penting
 FROM unnest($2::text[],$3::text[],$4::text[],$5::text[]) AS s(section_key,kind,unit_key,ref)
 JOIN sdl_org_units ou ON ou.unit_key=s.unit_key AND ou.is_active
 JOIN sdl_user_units uu ON uu.unit_key=s.unit_key
 JOIN sdl_users u ON u.id=uu.user_id
 JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=s.unit_key
   AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
 LEFT JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key='urmin.distribusi.receive'
 WHERE u.is_active AND NOT u.must_change_password AND u.id<>$1::uuid
   AND NOT EXISTS(SELECT 1 FROM sdl_user_roles sr WHERE sr.user_id=u.id AND sr.role_key='superadmin')
   AND NOT EXISTS(SELECT 1 FROM sdl_access_grants kb WHERE kb.user_id=u.id AND kb.role_key='br_kabagrenmin'
     AND kb.revoked_at IS NULL AND (kb.expires_at IS NULL OR kb.expires_at>NOW()))
   AND (s.kind<>'jabatan' OR EXISTS(SELECT 1 FROM sdl_access_grants j JOIN sdl_roles jr ON jr.role_key=j.role_key AND jr.is_active
     WHERE j.user_id=u.id AND j.role_key=s.ref AND j.unit_key=s.unit_key AND j.scope IN ('unit','assigned')
       AND j.revoked_at IS NULL AND (j.expires_at IS NULL OR j.expires_at>NOW())))
   AND (s.kind<>'paur' OR EXISTS(SELECT 1 FROM sdl_user_paur p WHERE p.user_id=u.id AND p.paur_key=s.ref))
 GROUP BY s.section_key,u.id,u.display_name
 ORDER BY s.section_key,u.display_name`

function sectionArgs() {
  return [SECTIONS.map((s) => s.key), SECTIONS.map((s) => s.kind), SECTIONS.map((s) => s.unit), SECTIONS.map((s) => s.role)]
}

/**
 * Padanan readSections (sections.go). SELALU mengembalikan seluruh pilihan,
 * termasuk yang tidak punya pemegang jabatan (holders kosong): bagian yang
 * hilang dari daftar terbaca di layar sebagai "menu berubah", bagian kosong
 * terbaca sebagai "belum ada pejabatnya" -- dan yang kedua itulah keadaannya.
 *
 * letterBiasa/letterPenting adalah agregat semua-atau-tidak-sama-sekali, sama
 * seperti aturan penolakan di create: satu pemegang jabatan yang tidak
 * memenuhi syarat membuat SELURUH bagian itu tidak bisa dipilih untuk surat
 * tersebut.
 */
export async function readSections(runner, actor) {
  const [keys, kinds, units, refs] = sectionArgs()
  const { rows } = await runner.query(SECTION_HOLDERS_SQL, [actor, keys, kinds, units, refs])
  const byKey = new Map()
  for (const row of rows) {
    const list = byKey.get(row.section_key) ?? []
    list.push({
      id: row.id,
      name: row.name,
      canReceiveBiasa: row.can_biasa === true,
      canReceivePenting: row.can_penting === true,
    })
    byKey.set(row.section_key, list)
  }
  return SECTIONS.map((s) => {
    const holders = byKey.get(s.key) ?? []
    return {
      key: s.key,
      label: s.label,
      kind: s.kind,
      unit: s.unit,
      holders,
      letterBiasa: holders.length > 0 && holders.every((h) => h.canReceiveBiasa),
      letterPenting: holders.length > 0 && holders.every((h) => h.canReceivePenting),
    }
  })
}

/**
 * Bagian tanpa pemegang jabatan. Dibedakan dari kegagalan database supaya
 * pemanggil menjawab 400 ("pilihan ini tidak bisa dikirimi") dan bukan 503
 * ("layanan sedang rusak").
 */
export class SectionVacant extends Error {}

/**
 * Padanan resolveSections (sections.go). Dijalankan pada CLIENT transaksi,
 * bukan pool: jabatan bisa berpindah tangan antara saat layar memuat pilihan
 * dan saat tombol kirim ditekan, dan yang tercatat sebagai penerima adalah
 * pemegang jabatan pada saat COMMIT.
 */
export async function resolveSections(client, keys, actor) {
  const items = await readSections(client, actor)
  const index = new Map(items.map((it) => [it.key, it]))
  const out = []
  // Satu orang bisa memegang dua jabatan sekaligus — pejabat sementara yang
  // merangkap, misalnya. Tanpa penyaringan ini ia menghasilkan dua baris
  // penerima dengan recipient_id sama, melanggar PRIMARY KEY
  // (directive_id, recipient_id), dan pengiriman gagal 503 tanpa petunjuk apa
  // pun tentang sebabnya. Bagian pertama yang menyebutnya yang dicatat:
  // urutan `keys` adalah urutan pilihan Kabagrenmin.
  const seen = new Set()
  for (const key of keys) {
    const item = index.get(key)
    if (!item || item.holders.length === 0) throw new SectionVacant()
    for (const holder of item.holders) {
      if (seen.has(holder.id)) continue
      seen.add(holder.id)
      out.push({ userId: holder.id, section: item.key, unit: item.unit })
    }
  }
  return out
}

/**
 * Padanan linkableLettersSQL (sections.go). Syaratnya SAMA PERSIS dengan
 * LETTER_LINK_SQL di shared.js -- disusun begitu supaya daftar di layar tidak
 * pernah memuat pilihan yang akan ditolak 400 saat dikirim.
 */
export const LINKABLE_LETTERS_SQL = `SELECT i.id::text AS id,i.agenda_no,i.letter_number,i.sender,i.subject,
  i.classification,i.derajat,it.letter_kind,i.letter_date::text AS letter_date,
  d.received_at::text AS received_at,
  (SELECT COUNT(*) FROM sdl_leadership_directives ld WHERE ld.incoming_id=i.id AND ld.issuer_id=$1::uuid)::int AS directive_count
 FROM sdl_urmin_incoming_intake it
 JOIN sdl_urmin_incoming i ON i.id=it.incoming_id
 JOIN sdl_urmin_distributions d ON d.incoming_id=it.incoming_id AND d.recipient_user=$1::uuid AND d.status='received'
 WHERE it.kabag_recipient=$1::uuid AND it.route_status='awaiting_kabag'
 ORDER BY d.received_at DESC,i.agenda_no DESC LIMIT 100`

export function mapLinkableLetter(row) {
  return {
    id: row.id,
    agendaNo: Number(row.agenda_no),
    letterNumber: row.letter_number,
    sender: row.sender,
    subject: row.subject,
    classification: row.classification,
    derajat: row.derajat,
    letterKind: row.letter_kind,
    letterDate: row.letter_date,
    receivedAt: row.received_at ?? null,
    directiveCount: row.directive_count,
  }
}

/**
 * Syarat penerima distribusi, salinan urmin.recipientEligible — sama seperti di
 * handover.go, SENGAJA diulang alih-alih diimpor dari modul urmin. Kalau
 * syaratnya berubah, DUA tempat di backend ini yang harus diubah, dan empat
 * kalau Go ikut dihitung.
 *
 * Baris terakhir yang paling penting: surat 'penting' (berlabel Rahasia di
 * layar) hanya boleh mendarat pada grant ber-classification_limit 'penting'.
 */
const DISTRIBUTION_ELIGIBLE_SQL = `SELECT EXISTS(
 SELECT 1 FROM sdl_users u
  JOIN sdl_user_units uu ON uu.user_id=u.id AND uu.unit_key=$2
  JOIN sdl_access_grants g ON g.user_id=u.id AND g.unit_key=uu.unit_key AND g.revoked_at IS NULL
    AND (g.expires_at IS NULL OR g.expires_at>now()) AND g.scope IN ('unit','assigned')
  JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active AND ro.role_key<>'superadmin'
  JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key='urmin.distribusi.receive'
  JOIN sdl_org_units ou ON ou.unit_key=uu.unit_key AND ou.is_active
 WHERE u.id=$1::uuid AND u.is_active AND NOT u.must_change_password
   AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
   AND ($3='biasa' OR g.classification_limit='penting')) AS ok`

/**
 * ON CONFLICT ... DO NOTHING mengacu ke sdl_urmin_delivery_one_pending_idx
 * (migrasi 010), indeks unik PARSIAL — karena itu klausa WHERE-nya wajib
 * ditulis ulang persis, kalau tidak Postgres tidak menemukan arbiter-nya dan
 * melempar error alih-alih melewati baris.
 */
const HANDOVER_INSERT_SQL = `INSERT INTO sdl_urmin_distributions(incoming_id,sent_by,recipient_unit,recipient_user,reason)
 VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5)
 ON CONFLICT (incoming_id,recipient_user) WHERE status='sent' DO NOTHING
 RETURNING id::text AS id`

/** Bagian yang tidak berhak menerima surat seklasifikasi itu. */
export class HandOverRefused extends Error {}

/**
 * R5H1: arahan yang menyebut surat sekaligus MENYERAHKAN suratnya.
 *
 * Tanpa baris distribusi, penerima arahan tahu ada surat tapi tidak bisa
 * membukanya: seluruh pembacaan surat masuk disaring di level SQL lewat
 * sdl_urmin_distributions. Baris ini juga yang menghidupkan kembali rantai
 * disposisi ke dalam unit penerima — sdl_urmin_disposition_tasks.distribution_id
 * NOT NULL, sehingga tanpa distribusi Kasubbag tidak bisa meneruskan apa pun
 * kepada stafnya.
 *
 * Berjalan pada client transaksi kirim arahan. Tidak ada keadaan setengah jadi:
 * arahan terkirim tanpa suratnya, atau surat berpindah tanpa arahannya,
 * keduanya mustahil.
 */
export async function handOverLetter(client, { incoming, actor, title, targets }) {
  // Klasifikasi dibaca dari surat, bukan dari payload. Klien tidak pernah boleh
  // ikut menentukan seberapa rahasia sebuah surat dianggap.
  const letter = await client.query(
    'SELECT classification FROM sdl_urmin_incoming WHERE id=$1::uuid',
    [incoming],
  )
  // LETTER_LINK_SQL sudah lolos sebelum ini, jadi barisnya pasti ada; kalau
  // tidak, yang rusak adalah asumsinya, bukan payload pengirim — dan itu 503.
  if (letter.rows.length === 0) throw new Error('letter_vanished_mid_transaction')
  const classification = letter.rows[0].classification

  // Memenuhi CHECK length(btrim(reason)) BETWEEN 8 AND 500: awalannya saja
  // sudah 20 karakter, dan judul dibatasi 160 saat validasi.
  const reason = `Arahan Kabagrenmin: ${title}`

  for (const target of targets) {
    const eligible = await client.query(DISTRIBUTION_ELIGIBLE_SQL,
      [target.userId, target.unit, classification])
    // R5H4: anggota yang tidak berwenang atas surat ini DILEWATI, bukan
    // membatalkan pengiriman (padanan handover.go). Arahan sampai ke semua
    // anggota; naskah suratnya hanya ke yang berhak. Pemeriksaan akses surat
    // di modul Urmin tidak berubah.
    if (eligible.rows[0].ok !== true) continue

    const inserted = await client.query(HANDOVER_INSERT_SQL,
      [incoming, actor, target.unit, target.userId, reason])
    // Sudah ada kiriman yang belum diterima untuk surat dan orang ini.
    // Dibiarkan apa adanya: ia sudah memegang akses yang sama, dan peristiwa
    // 'sent'-nya sudah tercatat pada baris yang lebih dulu.
    if (inserted.rows.length === 0) continue
    const distId = inserted.rows[0].id

    await client.query(
      `INSERT INTO sdl_urmin_distribution_events(distribution_id,actor_id,event_key,reason)
       VALUES($1::uuid,$2::uuid,'sent',$3)`,
      [distId, actor, 'Penunjukan bagian lewat arahan pimpinan'],
    )
    // event_key yang sama dengan jalur distribusi mana pun, supaya laporan
    // audit yang sudah ada ikut melihat penyerahan lewat arahan tanpa perlu
    // tahu bahwa R5H1 pernah terjadi.
    await client.query(
      `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
       VALUES($1::uuid,'urmin.distribution.sent','urmin.surat_masuk',$2,
              jsonb_build_object('section',$3::text,'via','arahan'))`,
      [actor, distId, target.section],
    )
  }
}
