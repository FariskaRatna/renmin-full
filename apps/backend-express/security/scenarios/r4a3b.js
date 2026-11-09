import sharp from 'sharp'

import { contains, status, truthy } from '../assert.js'

/**
 * PNG kecil yang sah. Dibuat SEKALI lalu dipakai ulang: skenario ini
 * membandingkan byte hasil unduhan dengan byte yang diunggah, jadi keduanya
 * harus berasal dari buffer yang sama persis.
 */
let cachedProof
export async function proofPNG() {
  cachedProof ??= await sharp({
    create: { width: 2, height: 2, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
  })
    .png()
    .toBuffer()
  return cachedProof
}

/** Unggah bukti; `csrf=false` membuktikan multipart tidak melewati gerbang CSRF. */
export async function proofUpload(browser, realisasiId, filename, data, csrf = true) {
  return browser.upload(`/api/v1/subbagren/budget/realisasi/${realisasiId}/evidence`, {
    filename,
    data,
    csrf,
    // Go menulis field `reason` LEBIH DULU, baru berkasnya (r4a3b:24-31) —
    // kebalikan dari urutan di R3B. Diikuti apa adanya supaya jalur kode yang
    // dijalankan sama.
    fieldsFirst: true,
    fields: { reason: 'Bukti transaksi harus ditelaah independen' },
  })
}

/** Unggah bukti lalu setujui oleh pemeriksa independen; mengembalikan id bukti. */
export async function approvedProof(maker, checker, realisasiId) {
  const uploaded = await proofUpload(maker, realisasiId, 'bukti.png', await proofPNG())
  status(uploaded, 201, 'unggah bukti')
  const id = JSON.parse(uploaded.text).id
  truthy(id, 'id bukti kosong')
  const reviewed = await checker.call(
    'POST',
    `/api/v1/subbagren/budget/realisasi/${realisasiId}/evidence/${id}/review`,
    { version: 1, decision: 'approved', reason: 'Bukti cocok dengan transaksi dan dokumen sumber' },
    true,
  )
  status(reviewed, 200, 'setujui bukti')
  return id
}

/**
 * R4A3B — bukti keuangan privat dan rekonsiliasi.
 * Port dari `r4a3b_integration_test.go`. Berjalan SESUDAH 09h dan memakai
 * realisasi yang ditinggalkannya.
 *
 * Pemeriksaan terpenting ada di ekor: byte bukti diubah LANGSUNG DI DATABASE,
 * lalu unduhan harus 503 dan verifikasi realisasi harus 409. Itu membuktikan
 * sha256 benar-benar dicocokkan ulang saat dibaca, bukan hanya saat ditulis —
 * satu-satunya cara mengetahui amplop AES-GCM-nya memang dijaga.
 */
export async function verifyR4A3BProof({ env, sa }) {
  const maker = await env.newSession('r4a3_maker')
  const outsider = await env.newSession('r4a3_outside')

  // Grant pemeriksa dari 09h sudah dicabut; pemeriksa baru dibuat di sini.
  const checkerUser = await env.createUser('r4a3b_checker')
  await env.attachUnit(checkerUser.id, 'subbagren')
  await env.createRole('br_r4a3b_checker', 'R4A3B independent checker')
  await env.grant(checkerUser.id, 'br_r4a3b_checker', 'subbagren', 'unit', {
    reason: 'Financial proof verification test',
  })
  await env.grantPermissions('br_r4a3b_checker', [
    'subbagren.usulan.read',
    'subbagren.anggaran.read',
    'subbagren.anggaran.bukti.read',
    'subbagren.anggaran.bukti.verify',
    'subbagren.anggaran.reconcile',
    'subbagren.anggaran.realisasi.verify',
  ])
  const check = await env.newSession('r4a3b_checker')

  const { rows } = await env.pool.query(
    `SELECT id::text AS id FROM sdl_subbagren_realisasi WHERE status='pending'
      ORDER BY created_at DESC LIMIT 1`,
  )
  truthy(rows[0]?.id, 'tidak ada realisasi pending dari 09h')
  const realID = rows[0].id
  const root = '/api/v1/subbagren/budget/'

  status(
    await proofUpload(maker, realID, 'fake.png', Buffer.from('<script>bad file</script>', 'utf8')),
    400,
    'berkas palsu berekstensi png',
  )
  status(await proofUpload(maker, realID, 'file.png', await proofPNG(), false), 403, 'unggah tanpa CSRF')
  status(await proofUpload(outsider, realID, 'file.png', await proofPNG()), 404, 'unggah oleh unit lain')
  // Sudah ada bukti yang disetujui: tidak boleh ditimpa atau diganti.
  status(await proofUpload(maker, realID, 'file.png', await proofPNG()), 409, 'ganti bukti yang sudah disetujui')

  const proof = await env.pool.query(
    `SELECT id::text AS id FROM sdl_subbagren_evidence WHERE realisasi_id=$1 AND status='approved'`,
    [realID],
  )
  truthy(proof.rows[0]?.id, 'bukti approved tidak ditemukan')
  const proofID = proof.rows[0].id
  const path = `${root}realisasi/${realID}/evidence/${proofID}/download`

  status(await outsider.call('GET', path), 404, 'unduh oleh unit lain')
  status(await sa.call('GET', path), 403, 'unduh oleh SA')

  const download = await check.call('GET', path)
  status(download, 200, 'unduh oleh pemeriksa')
  truthy(download.body.equals(await proofPNG()), 'byte berkas berubah saat disimpan/dibaca')
  contains(download.headers.get('content-disposition') ?? '', 'attachment', 'Content-Disposition unduhan')
  truthy(
    download.headers.get('x-content-type-options') === 'nosniff',
    'header nosniff hilang pada unduhan',
  )

  // Pengunggah diberi permission verifikasi, lalu dibuktikan tetap ditolak.
  await env.grantPermissions('br_r4a3_maker', ['subbagren.anggaran.bukti.verify'])
  status(
    await maker.call(
      'POST',
      `${root}realisasi/${realID}/evidence/${proofID}/review`,
      { version: 2, decision: 'rejected', reason: 'Should be denied for maker' },
      true,
    ),
    403,
    'pengunggah memverifikasi buktinya sendiri',
  )
  status(
    await check.call(
      'POST',
      `${root}realisasi/${realID}/evidence/${proofID}/review`,
      { version: 1, decision: 'approved', reason: 'Replay approval is prohibited' },
      true,
    ),
    409,
    'persetujuan diputar ulang',
  )

  const recon = await check.call('GET', `${root}reconciliation?year=2026`)
  status(recon, 200, 'rekonsiliasi')
  contains(recon, '"basis":"verified_only_scoped"', 'basis rekonsiliasi')
  // Angka ini TIDAK boleh mengaku sebagai LRA resmi.
  contains(recon, '"officialLRA":false', 'rekonsiliasi mengaku resmi')
  status(await outsider.call('GET', `${root}reconciliation?year=2026`), 404, 'rekonsiliasi oleh unit lain')

  // Byte bukti dirusak langsung di database.
  await env.pool.query(
    'UPDATE sdl_subbagren_evidence SET body=set_byte(body,25,(get_byte(body,25)+1)%256) WHERE id=$1',
    [proofID],
  )
  status(await check.call('GET', path), 503, 'unduh bukti yang rusak')
  status(
    await check.call(
      'POST',
      `${root}realisasi/${realID}/review`,
      { version: 1, decision: 'verified', reason: 'Should reject corrupted proof' },
      true,
    ),
    409,
    'verifikasi realisasi dengan bukti rusak',
  )

  await env.revokeGrants(checkerUser.id, 'br_r4a3b_checker')
  status(await check.call('GET', path), 404, 'unduh sesudah grant dicabut')
}
