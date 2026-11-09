/**
 * Verifikasi alur R5H1 dari ujung ke ujung, terhadap backend yang sedang hidup.
 *
 *   Staf Urmin mencatat surat yang butuh disposisi
 *     -> surat masuk ke Kabagrenmin
 *   Kabagrenmin menerima suratnya
 *     -> surat muncul di GET /leadership/directives/letters
 *   Kabagrenmin mengirim ARAHAN ke BAGIAN, menyebut surat itu
 *     -> penerima adalah pemegang jabatan, bukan orang yang dipilih namanya
 *     -> suratnya ikut diserahkan (sdl_urmin_distributions)
 *   Kasubbag melihat arahan di inbox-nya DAN suratnya di inbox distribusi
 *     -> dan rantai disposisi ke dalam unitnya punya distribution_id lagi
 *
 * Harness golden-file tidak bisa menggantikan ini: ia membandingkan BENTUK
 * respons antara dua backend, sedangkan yang diuji di sini adalah baris mana
 * yang tertulis di database dan siapa yang akhirnya bisa membaca surat. Dua
 * backend bisa sama-sama salah dengan cara yang identik dan tetap "paritas".
 *
 * Dijalankan di dalam network Docker karena service `api` tidak pernah
 * diekspos ke host:
 *
 *   CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.harness.yaml"
 *   docker compose $CLI run --rm --build --entrypoint node \
 *     -e SDL_HARNESS_API_BASE=http://api:8080 harness verify/r5h1-flow.js
 *
 * Isi SDL_HARNESS_PEER_BASE untuk sekalian membandingkan bentuk respons dua
 * backend (tahap 7) — berguna selama harness golden-file masih basi.
 *
 * MENULIS KE DATABASE: satu surat masuk, satu arahan, dan distribusi
 * turunannya. Semuanya baris baru; tidak ada yang diubah atau dihapus. Jalankan
 * terhadap database pengembangan, bukan produksi. Sesi yang dicetak dicabut
 * kembali saat selesai.
 */

import { buildActors } from '../harness/actors.js'
import { loadConfig } from '../harness/config.js'
import { HarnessDb } from '../harness/db.js'

const config = loadConfig()
const db = new HarnessDb(config.databaseUrl)

let failures = 0
const log = (...parts) => console.log(...parts)
function check(label, ok, detail = '') {
  if (!ok) failures += 1
  log(`${ok ? '  OK  ' : ' GAGAL'} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Membaca body JSON dari respons harness, atau melempar dengan isinya apa adanya. */
async function json(actor, method, path, options = {}) {
  const res = await actor.client.request(method, path, options)
  const text = Buffer.from(res.bytes).toString('utf8')
  if (!res.isJson) throw new Error(`${method} ${path} -> ${res.status}, bukan JSON: ${text.slice(0, 200)}`)
  return { status: res.status, body: JSON.parse(text) }
}

async function main() {
  await db.ping()
  const actors = await buildActors(config, db, [
    'stafUrmin', 'kabagrenmin', 'kasubbagren', 'kasubbagsumda', 'kaUrmin',
  ])
  for (const [key, actor] of actors) {
    if (!actor.available) throw new Error(`aktor ${key} tidak tersedia: ${actor.reason}`)
  }
  const staf = actors.get('stafUrmin')
  const kabag = actors.get('kabagrenmin')
  const kasubbagren = actors.get('kasubbagren')
  const kasubbagsumda = actors.get('kasubbagsumda')

  // --- 1. Daftar bagian -------------------------------------------------
  log('\n1. GET /leadership/directives/sections')
  const sections = await json(kabag, 'GET', '/api/v1/leadership/directives/sections')
  check('Kabagrenmin boleh membaca daftar bagian', sections.status === 200, `status ${sections.status}`)
  const keys = (sections.body.items ?? []).map((s) => s.key)
  // R5H4: sebelas pilihan -- empat jabatan R5H1 tetap di depan, lalu empat
  // bagian penuh dan tiga Paur Subbagsumda (lihat verify/r5h4 di dokumen R5H4).
  check('sebelas pilihan, empat jabatan R5H1 di depan, urutannya tetap',
    JSON.stringify(keys) === JSON.stringify(['kasubbagren', 'kasubbagsumda', 'kasubbagbinfung', 'kasubbagurmin',
      'subbagren', 'subbagsumda', 'subbagbinfung', 'urmin', 'paur_sumda', 'paur_log', 'paur_ada']),
    keys.join(','))
  // Hanya jabatan yang wajib berpejabat; Paur boleh belum diisi.
  for (const item of (sections.body.items ?? []).filter((s) => s.kind === 'jabatan')) {
    check(`bagian ${item.key} punya pejabat`, item.holders.length > 0,
      item.holders.map((h) => h.name).join(' · ') || 'kosong')
  }

  // Bagian BUKAN endpoint publik: hanya Kabagrenmin yang boleh melihatnya.
  const forbidden = await json(kasubbagren, 'GET', '/api/v1/leadership/directives/sections')
  check('Kasubbagren ditolak dari /sections', forbidden.status === 403, `status ${forbidden.status}`)

  // --- 2. Staf Urmin mencatat surat yang butuh disposisi ----------------
  log('\n2. Staf Urmin mencatat surat (POST /urmin/surat-masuk/intake)')
  const stamp = new Date().toISOString().slice(0, 10)
  const subject = `Uji alur R5H1 ${Date.now()}`
  const intake = await staf.client.request('POST', '/api/v1/urmin/surat-masuk/intake', {
    withCsrf: true,
    multipart: [{
      name: 'payload',
      value: JSON.stringify({
        letterNumber: `R5H1/${Date.now()}`,
        sender: 'Biro SDM Polda',
        letterDate: stamp,
        receivedDate: stamp,
        subject,
        classification: 'biasa',
        derajat: 'biasa',
        reason: 'Pengujian alur arahan ke bagian',
        letterKind: 'undangan',
        eventStart: `${stamp}T09:00`,
        needsDisposition: true,
        mode: 'submit',
      }),
    }],
  })
  const intakeBody = JSON.parse(Buffer.from(intake.bytes).toString('utf8'))
  check('surat tercatat dan dirutekan ke Kabagrenmin', intake.status === 201,
    `status ${intake.status} ${JSON.stringify(intakeBody).slice(0, 180)}`)
  const incomingId = intakeBody?.item?.id
  if (!incomingId) throw new Error(`id surat tidak ada di respons: ${JSON.stringify(intakeBody).slice(0, 300)}`)

  // --- 3. Kabagrenmin menerima suratnya ---------------------------------
  log('\n3. Kabagrenmin menerima surat (POST /urmin/distribution-inbox/{id}/receive)')
  const inbox = await json(kabag, 'GET', '/api/v1/urmin/distribution-inbox/')
  const delivery = (inbox.body.items ?? []).find((d) => d.incomingId === incomingId)
  check('surat muncul di inbox distribusi Kabagrenmin', Boolean(delivery), delivery?.status ?? 'tidak ada')
  const receive = await json(kabag, 'POST', `/api/v1/urmin/distribution-inbox/${delivery.id}/receive`, {
    withCsrf: true, body: { reason: 'Diterima untuk ditindaklanjuti lewat arahan' },
  })
  check('penerimaan tercatat', receive.status === 200, `status ${receive.status}`)

  // Sebelum diterima surat tidak boleh bisa ditautkan; sesudahnya harus bisa.
  const letters = await json(kabag, 'GET', '/api/v1/leadership/directives/letters')
  check('surat masuk daftar yang boleh ditautkan', letters.status === 200 &&
    (letters.body.items ?? []).some((l) => l.id === incomingId),
    `${(letters.body.items ?? []).length} surat terdaftar`)

  // --- 4. Arahan ke dua bagian, menyebut suratnya -----------------------
  log('\n4. Kabagrenmin mengirim arahan ke BAGIAN (POST /leadership/directives)')

  // Payload yang menyebut bagian DAN orang sekaligus harus ditolak.
  const both = await json(kabag, 'POST', '/api/v1/leadership/directives', {
    withCsrf: true,
    body: {
      title: 'Penugasan undangan rapat', body: 'Mohon disiapkan sesuai undangan terlampir.',
      kind: 'persuratan', priority: 'biasa', dueAt: null,
      sections: ['kasubbagren'],
      recipients: [await db.userIdByUsername('staf-subbagren')],
      incomingId,
    },
  })
  check('payload yang menyebut bagian DAN orang ditolak 400', both.status === 400, `status ${both.status}`)

  const created = await json(kabag, 'POST', '/api/v1/leadership/directives', {
    withCsrf: true,
    body: {
      title: 'Penugasan undangan rapat',
      body: 'Mohon disiapkan sesuai undangan terlampir dan laporkan kesiapannya.',
      kind: 'persuratan', priority: 'penting', dueAt: null,
      sections: ['kasubbagren', 'kasubbagsumda'],
      incomingId,
    },
  })
  check('arahan terkirim', created.status === 201,
    `status ${created.status} ${JSON.stringify(created.body).slice(0, 180)}`)
  const directiveId = created.body.id

  // --- 5. Yang tercatat: orang, dengan bagian asalnya --------------------
  log('\n5. GET /leadership/directives/{id}')
  const detail = await json(kabag, 'GET', `/api/v1/leadership/directives/${directiveId}`)
  const recipients = detail.body.recipients ?? []
  check('dua penerima, hasil terjemahan dua bagian', recipients.length === 2,
    recipients.map((r) => `${r.name} [${r.section}]`).join(' · '))
  check('setiap penerima membawa bagian asalnya',
    recipients.every((r) => ['kasubbagren', 'kasubbagsumda'].includes(r.section)),
    recipients.map((r) => r.section).join(','))
  check('arahan menyebut surat asalnya', detail.body.incomingId === incomingId,
    String(detail.body.incomingId))

  // --- 6. Sampai di inbox bagian yang ditunjuk --------------------------
  log('\n6. Inbox bagian yang ditunjuk')
  for (const [label, actor] of [['Kasubbagren', kasubbagren], ['Kasubbagsumda', kasubbagsumda]]) {
    const theirs = await json(actor, 'GET', '/api/v1/leadership/directives/inbox')
    check(`${label}: arahan ada di inbox arahan`,
      (theirs.body.items ?? []).some((d) => d.id === directiveId))

    // Inti R5H1: bukan sekadar pesan. Suratnya ikut.
    const dist = await json(actor, 'GET', '/api/v1/urmin/distribution-inbox/')
    const row = (dist.body.items ?? []).find((d) => d.incomingId === incomingId)
    check(`${label}: SURATNYA ikut masuk inbox distribusi`, Boolean(row),
      row ? `status ${row.status}, unit ${row.unit}` : 'tidak ada')
    check(`${label}: distribusi tercatat atas unitnya sendiri`,
      row?.unit === (label === 'Kasubbagren' ? 'subbagren' : 'subbagsumda'), row?.unit ?? '-')

    // Dan karena ada baris distribusi, naskah surat beserta lampirannya
    // terbuka: canAttachment() punya jalur cadangan recipientOf() yang berlaku
    // justru bagi penerima distribusi yang TIDAK punya urmin.surat_masuk.read
    // (r3b.go:103). Itulah jalur yang dipakai layar Inbox Distribusi.
    const files = await json(actor, 'GET', `/api/v1/urmin/surat-masuk/${incomingId}/attachments`)
    check(`${label}: boleh membuka naskah & lampiran surat`,
      files.status === 200 && files.body.canDownload === true,
      `status ${files.status}, canDownload ${files.body?.canDownload}`)

    // Register surat masuk TETAP tertutup, dan itu bukan cacat R5H1: Kasubbag
    // tidak punya urmin.surat_masuk.read, sehingga Engine A menolak. Surat ini
    // sampai kepadanya sebagai kiriman, bukan sebagai entri register yang
    // boleh ia telusuri bersama surat-surat lain. Diuji supaya perubahan peta
    // permission yang diam-diam membuka register ikut ketahuan.
    const register = await json(actor, 'GET', `/api/v1/urmin/surat-masuk/${incomingId}`)
    check(`${label}: register surat masuk tetap tertutup (404, disengaja)`,
      register.status === 404, `status ${register.status}`)
  }

  // Bagian yang TIDAK ditunjuk tidak boleh kebagian apa pun.
  const outsider = actors.get('kaUrmin')
  const outsiderInbox = await json(outsider, 'GET', '/api/v1/leadership/directives/inbox')
  check('bagian yang tidak ditunjuk tidak menerima arahan',
    !(outsiderInbox.body.items ?? []).some((d) => d.id === directiveId))
  const outsiderDist = await json(outsider, 'GET', '/api/v1/urmin/distribution-inbox/')
  check('bagian yang tidak ditunjuk tidak menerima suratnya',
    !(outsiderDist.body.items ?? []).some((d) => d.incomingId === incomingId))

  // --- 7. Paritas byte dua endpoint baru --------------------------------
  //
  // Hanya berjalan kalau SDL_HARNESS_PEER_BASE diisi. Harness golden-file
  // sedang basi (lihat catatan R5G), jadi inilah satu-satunya alat yang
  // membandingkan BENTUK respons /sections dan /letters antara dua backend.
  // Keduanya dibaca dengan sesi yang sama, dalam detik yang sama.
  const peerBase = process.env.SDL_HARNESS_PEER_BASE?.trim()
  if (peerBase) {
    log(`\n7. Paritas respons terhadap ${peerBase}`)
    const peerActors = await buildActors({ ...config, apiBase: peerBase.replace(/\/+$/, '') }, db, ['kabagrenmin'])
    const peer = peerActors.get('kabagrenmin')

    // Draf ditulis lebih dulu supaya GET /draft di bawah benar-benar membawa
    // 'sections' terisi. Tanpa ini ia hanya membandingkan {"draft":null}, dan
    // field barunya tidak pernah tersentuh.
    const saved = await json(kabag, 'PUT', '/api/v1/leadership/directives/draft', {
      withCsrf: true,
      body: {
        title: 'Draf uji paritas', body: 'Isi draf untuk membandingkan bentuk respons.',
        kind: 'persuratan', priority: 'kilat', dueAt: '',
        recipients: [], sections: ['kasubbagbinfung', 'kasubbagurmin'],
        incomingId, revision: 0,
      },
    })
    check('draf tersimpan untuk uji paritas', saved.status === 200, `status ${saved.status}`)

    for (const path of [
      '/api/v1/leadership/directives/sections',
      '/api/v1/leadership/directives/letters',
      '/api/v1/leadership/directives/draft',
      `/api/v1/leadership/directives/${directiveId}`,
    ]) {
      const here = await kabag.client.request('GET', path)
      const there = await peer.client.request('GET', path)
      const a = Buffer.from(here.bytes).toString('utf8')
      const b = Buffer.from(there.bytes).toString('utf8')
      // Dibandingkan sebagai STRING, bukan objek: urutan kunci adalah bagian
      // kontrak di repo ini, dan JSON.parse menghapusnya.
      check(`${path} byte-identik`, here.status === there.status && a === b,
        here.status !== there.status ? `status ${here.status} vs ${there.status}`
          : `${a.slice(0, 120)}\n          vs ${b.slice(0, 120)}`)
    }
    // Draf uji dibersihkan: ia milik akun nyata, dan meninggalkannya berarti
    // Kabagrenmin menemukan draf yang tidak pernah ia tulis.
    const draft = await json(kabag, 'GET', '/api/v1/leadership/directives/draft')
    if (draft.body.revision) {
      await json(kabag, 'DELETE', '/api/v1/leadership/directives/draft',
        { withCsrf: true, body: { revision: draft.body.revision } })
    }
  } else {
    log('\n7. Paritas dilewati (SDL_HARNESS_PEER_BASE tidak diisi)')
  }

  log(`\n${failures === 0 ? 'SEMUA PEMERIKSAAN LULUS' : `${failures} PEMERIKSAAN GAGAL`} · backend: ${config.apiBase}`)
}

try {
  await main()
} catch (error) {
  failures += 1
  console.error('\nERROR:', error.message)
} finally {
  await db.revokeMintedSessions()
  await db.close()
}
process.exit(failures === 0 ? 0 : 1)
