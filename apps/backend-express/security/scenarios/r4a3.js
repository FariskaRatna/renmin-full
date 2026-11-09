import { contains, equal, field, status } from '../assert.js'
import { approvedProof } from './r4a3b.js'

/**
 * R4A3 — realisasi anggaran terverifikasi.
 * Port dari `r4a3_integration_test.go`.
 *
 * Rantai penuh usulan → telaah → pagu → realisasi → bukti → verifikasi, dengan
 * tiga pengaman yang hanya terlihat kalau dijalankan berurutan:
 *   · pagu menolak usulan yang telaah internalnya belum disetujui;
 *   · realisasi tidak bisa diverifikasi sebelum buktinya disetujui orang lain;
 *   · plafon dihitung dari realisasi TERVERIFIKASI, jadi 60jt+40jt > 90jt
 *     ditolak walau buktinya sudah lengkap.
 */
export async function verifyR4A3Budget({ env, sa }) {
  const maker = await env.createUser('r4a3_maker')
  const checker = await env.createUser('r4a3_checker')
  const outside = await env.createUser('r4a3_outside')
  await env.attachUnit(maker.id, 'subbagren')
  await env.attachUnit(checker.id, 'subbagren')
  await env.attachUnit(outside.id, 'urmin')

  await env.createRole('br_r4a3_maker', 'br_r4a3_maker')
  await env.createRole('br_r4a3_checker', 'br_r4a3_checker')
  await env.grant(maker.id, 'br_r4a3_maker', 'subbagren', 'own', {
    reason: 'R4A3 independent maker checker security test',
  })
  await env.grant(checker.id, 'br_r4a3_checker', 'subbagren', 'unit', {
    reason: 'R4A3 independent maker checker security test',
  })
  await env.grantPermissions('br_r4a3_maker', [
    'subbagren.usulan.read',
    'subbagren.usulan.create',
    'subbagren.usulan.submit',
    'subbagren.anggaran.read',
    'subbagren.anggaran.pagu.register',
    'subbagren.anggaran.realisasi.record',
    'subbagren.anggaran.bukti.upload',
    'subbagren.anggaran.bukti.read',
  ])
  await env.grantPermissions('br_r4a3_checker', [
    'subbagren.usulan.read',
    'subbagren.usulan.review',
    'subbagren.anggaran.read',
    'subbagren.anggaran.pagu.verify',
    'subbagren.anggaran.realisasi.verify',
    'subbagren.anggaran.bukti.verify',
    'subbagren.anggaran.bukti.read',
    'subbagren.anggaran.reconcile',
  ])

  const m = await env.newSession('r4a3_maker')
  const v = await env.newSession('r4a3_checker')
  const x = await env.newSession('r4a3_outside')

  const root = '/api/v1/subbagren/usulan/'
  const created = await m.call(
    'POST',
    root,
    {
      fiscalYear: 2026,
      sourceUnit: 'Kebutuhan Test R4A3',
      title: 'Kebutuhan Pengujian Realisasi',
      outputTarget: 'Hasil kegiatan tahunan untuk audit internal',
      proposedBudget: 100000000,
      classification: 'biasa',
      reason: 'Registrasi awal proposal untuk pengujian pagu',
    },
    true,
  )
  status(created, 201, 'buat usulan')
  const id = field(created, 'item.id', 'id usulan')
  status(
    await m.call('POST', `${root}${id}/submit`, { version: 1, reason: 'Diajukan untuk review sebelum pagu' }, true),
    200,
    'ajukan usulan',
  )

  const budget = '/api/v1/subbagren/budget/'
  const paguReq = {
    proposalId: id,
    amount: 90000000,
    authorizationNumber: 'DIPA-TEST-2026-001',
    authorizationIssuer: 'Instansi Penerbit Dokumen',
    authorizationDate: '2026-10-19',
    reason: 'Pencatatan referensi dokumen pagu test',
  }
  // Diajukan belum berarti ditelaah: pagu menolak sampai telaah internal lulus.
  status(await m.call('POST', `${budget}pagu`, paguReq, true), 409, 'pagu sebelum telaah internal')
  status(
    await v.call('POST', `${root}${id}/review`, { version: 2, decision: 'approved', reason: 'Usulan disetujui untuk diproses secara internal' }, true),
    200,
    'setujui telaah internal',
  )

  status(await m.call('POST', `${budget}pagu`, paguReq, false), 403, 'daftar pagu tanpa CSRF')
  status(await x.call('POST', `${budget}pagu`, paguReq, true), 404, 'daftar pagu oleh unit lain')
  status(await sa.call('GET', `${budget}?year=2026`), 403, 'SA baca anggaran')

  const registered = await m.call('POST', `${budget}pagu`, paguReq, true)
  status(registered, 201, 'daftarkan pagu')
  const paguID = field(registered, 'id', 'id pagu')
  status(await m.call('POST', `${budget}pagu`, paguReq, true), 409, 'pagu ganda untuk satu usulan')

  const review = { version: 1, decision: 'verified', reason: 'Bukti referensi pagu diverifikasi independen' }
  status(await m.call('POST', `${budget}pagu/${paguID}/review`, review, true), 404, 'verifikasi pagu tanpa permission')
  await env.grantPermissions('br_r4a3_maker', ['subbagren.anggaran.pagu.verify'])
  // Permission ADA, tetapi pencatat tetap tidak boleh memverifikasi catatannya.
  status(await m.call('POST', `${budget}pagu/${paguID}/review`, review, true), 403, 'pencatat memverifikasi pagunya sendiri')
  status(await v.call('POST', `${budget}pagu/${paguID}/review`, review, true), 200, 'verifikasi pagu')
  status(await v.call('POST', `${budget}pagu/${paguID}/review`, review, true), 409, 'verifikasi pagu kedua')

  const transaction = {
    paguId: paguID,
    amount: 60000000,
    transactionDate: '2026-10-19',
    evidenceReference: 'BKU-R4A3-TEST-0001',
    description: 'Pembayaran kegiatan hasil pengujian integrasi',
    reason: 'Input transaksi untuk verifikasi independen',
  }
  const firstTx = await m.call('POST', `${budget}realisasi`, transaction, true)
  status(firstTx, 201, 'catat realisasi pertama')
  const firstID = field(firstTx, 'id', 'id realisasi pertama')

  const beforeVerify = await v.call('GET', `${budget}?year=2026`)
  status(beforeVerify, 200, 'ringkasan sebelum verifikasi')
  // Realisasi yang belum diverifikasi TIDAK ikut dihitung.
  contains(beforeVerify, '"realizationVerified":"0"', 'realisasi belum terverifikasi ikut dihitung')
  contains(beforeVerify, '"paguVerified":"90000000"', 'pagu terverifikasi')

  status(await v.call('POST', `${budget}realisasi/${firstID}/review`, review, true), 409, 'verifikasi tanpa bukti disetujui')
  await approvedProof(m, v, firstID)
  status(await v.call('POST', `${budget}realisasi/${firstID}/review`, review, true), 200, 'verifikasi realisasi pertama')
  status(await v.call('POST', `${budget}realisasi/${firstID}/review`, review, true), 409, 'verifikasi kedua')

  const secondTx = await m.call(
    'POST',
    `${budget}realisasi`,
    { ...transaction, amount: 40000000, evidenceReference: 'BKU-R4A3-TEST-0002' },
    true,
  )
  status(secondTx, 201, 'catat realisasi kedua')
  const secondID = field(secondTx, 'id', 'id realisasi kedua')
  await approvedProof(m, v, secondID)
  // 60jt + 40jt melampaui pagu 90jt — ditolak walau buktinya lengkap.
  status(await v.call('POST', `${budget}realisasi/${secondID}/review`, review, true), 409, 'plafon pagu terlampaui')

  const totals = await v.call('GET', `${budget}?year=2026`)
  status(totals, 200, 'ringkasan sesudah verifikasi')
  contains(totals, '"realizationVerified":"60000000"', 'total realisasi terverifikasi')
  contains(totals, '"remaining":"30000000"', 'sisa pagu')
  contains(totals, '"basis":"verified_only"', 'basis perhitungan')

  status(await x.call('GET', `${budget}?year=2026`), 403, 'ringkasan oleh unit lain')
  status(await v.call('GET', `${budget}?year=1900`), 400, 'tahun tidak masuk akal')

  await env.revokeGrants(checker.id, 'br_r4a3_checker')
  status(await v.call('GET', `${budget}?year=2026`), 403, 'ringkasan sesudah grant dicabut')
  status(
    await v.call('POST', `${budget}realisasi/${secondID}/review`, { version: 1, decision: 'rejected', reason: 'Ditolak setelah grant dicabut' }, true),
    404,
    'verifikasi sesudah grant dicabut',
  )

  const events = await env.pool.query(
    `SELECT count(*)::int AS n FROM sdl_subbagren_budget_events
      WHERE subject_type IN ('pagu','realisasi') AND subject_id IN ($1::uuid,$2::uuid,$3::uuid)`,
    [paguID, firstID, secondID],
  )
  equal(events.rows[0].n, 5, 'jumlah event anggaran yang tidak bisa diubah')
}
