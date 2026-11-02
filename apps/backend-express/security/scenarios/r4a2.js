import { contains, equal, field, status } from '../assert.js'

/**
 * R4A2 — telaah internal dan konsolidasi.
 * Port dari `r4a2_integration_test.go`.
 *
 * Aturan maker-checker yang diuji, dan yang paling penting di antaranya:
 * PEMBUAT tidak bisa menelaah usulannya sendiri **walau diberi permission
 * review secara eksplisit**. Itu dibuktikan dengan benar-benar memberi
 * permission itu lebih dulu, lalu memanggilnya.
 */
export async function verifyR4A2ReviewConsolidation({ env, sa }) {
  const writer = await env.createUser('r4a2_author')
  const reviewer = await env.createUser('r4a2_reviewer')
  const outsider = await env.createUser('r4a2_outside')
  await env.attachUnit(writer.id, 'subbagren')
  await env.attachUnit(reviewer.id, 'subbagren')
  await env.attachUnit(outsider.id, 'urmin')

  await env.createRole('br_r4a2_writer', 'br_r4a2_writer')
  await env.createRole('br_r4a2_review', 'br_r4a2_review')
  await env.grant(writer.id, 'br_r4a2_writer', 'subbagren', 'own', { reason: 'R4A2 isolated regression grant' })
  await env.grant(reviewer.id, 'br_r4a2_review', 'subbagren', 'unit', { reason: 'R4A2 isolated regression grant' })
  await env.grantPermissions('br_r4a2_writer', [
    'subbagren.usulan.read',
    'subbagren.usulan.create',
    'subbagren.usulan.update',
    'subbagren.usulan.submit',
  ])
  await env.grantPermissions('br_r4a2_review', ['subbagren.usulan.read', 'subbagren.usulan.consolidate'])

  const w = await env.newSession('r4a2_author')
  const rev = await env.newSession('r4a2_reviewer')
  const x = await env.newSession('r4a2_outside')

  const url = '/api/v1/subbagren/usulan/'
  const created = await w.call(
    'POST',
    url,
    {
      fiscalYear: 2027,
      sourceUnit: 'Subsatker Uji',
      title: 'Usulan test review dan anggaran',
      outputTarget: 'Dokumen internal untuk penelaahan dan audit',
      proposedBudget: 25000000,
      classification: 'biasa',
      reason: 'Catatan awal perencanaan test R4A2',
    },
    true,
  )
  status(created, 201, 'buat usulan')
  const id = field(created, 'item.id', 'id usulan')
  const detail = url + id

  status(
    await w.call('POST', `${detail}/submit`, { version: 1, reason: 'Usulan awal diajukan untuk review internal' }, true),
    200,
    'ajukan usulan',
  )

  const reviewBody = {
    version: 2,
    decision: 'revision_requested',
    reason: 'Mohon lengkapi target output sesuai catatan',
  }
  status(await rev.call('POST', `${detail}/review`, reviewBody, true), 404, 'telaah tanpa permission')
  await env.grantPermissions('br_r4a2_review', ['subbagren.usulan.review'])
  status(await rev.call('POST', `${detail}/review`, reviewBody, false), 403, 'telaah tanpa CSRF')
  status(await x.call('POST', `${detail}/review`, reviewBody, true), 404, 'telaah oleh unit lain')
  status(await sa.call('GET', detail), 403, 'SA baca detail usulan')

  // Permission review diberikan ke PEMBUAT, lalu dibuktikan tetap ditolak.
  await env.grantPermissions('br_r4a2_writer', ['subbagren.usulan.review'])
  status(await w.call('POST', `${detail}/review`, reviewBody, true), 403, 'pembuat menelaah usulannya sendiri')

  status(await rev.call('POST', `${detail}/review`, reviewBody, true), 200, 'telaah oleh pemeriksa')
  status(await rev.call('POST', `${detail}/review`, reviewBody, true), 409, 'telaah kedua')

  const afterReview = await w.call('GET', detail)
  status(afterReview, 200, 'baca sesudah telaah')
  contains(afterReview, '"reviewStatus":"revision_requested"', 'status revisi hilang')
  contains(afterReview, '"canRevise":true', 'flag canRevise hilang')

  status(
    await w.call('POST', `${detail}/resubmit`, { version: 3, reason: 'Ajukan ulang setelah koreksi' }, true),
    409,
    'ajukan ulang tanpa revisi nyata',
  )

  const revision = {
    version: 3,
    fiscalYear: 2027,
    sourceUnit: 'Subsatker Uji',
    title: 'Usulan test hasil revisi',
    outputTarget: 'Dokumen diperbaiki agar sesuai hasil evaluasi',
    proposedBudget: 30000000,
    classification: 'penting',
    reason: 'Revisi dan peningkatan klasifikasi untuk test',
  }
  status(await w.call('PATCH', `${detail}/revision`, revision, true), 403, 'revisi menaikkan klasifikasi')
  revision.classification = 'biasa'
  status(await rev.call('PATCH', `${detail}/revision`, revision, true), 404, 'pemeriksa merevisi')
  status(await w.call('PATCH', `${detail}/revision`, revision, true), 200, 'revisi oleh pembuat')
  status(await w.call('PATCH', `${detail}/revision`, revision, true), 409, 'revisi dengan versi basi')

  status(
    await rev.call('POST', `${detail}/review`, { version: 4, decision: 'approved', reason: 'Persetujuan internal sebelum submit ulang' }, true),
    409,
    'telaah sebelum diajukan ulang',
  )
  status(
    await w.call('POST', `${detail}/resubmit`, { version: 4, reason: 'Mengajukan ulang usulan yang telah direvisi' }, true),
    200,
    'ajukan ulang',
  )
  status(
    await rev.call('POST', `${detail}/review`, { version: 5, decision: 'approved', reason: 'Target internal telah ditelaah dan memenuhi kebutuhan' }, true),
    200,
    'setujui usulan',
  )
  status(
    await rev.call('POST', `${detail}/review`, { version: 6, decision: 'approved', reason: 'Keputusan kedua ini tidak boleh terjadi' }, true),
    409,
    'keputusan kedua',
  )
  status(await w.call('PATCH', `${detail}/revision`, revision, true), 409, 'revisi sesudah disetujui')

  const summary = await rev.call('GET', `${url}consolidation?year=2027`)
  status(summary, 200, 'konsolidasi')
  contains(summary, '"totalBudget":"30000000"', 'total anggaran konsolidasi')
  contains(summary, '"basis":"approved_internal_only"', 'basis konsolidasi')

  status(await w.call('GET', `${url}consolidation?year=2027`), 403, 'konsolidasi oleh pembuat')
  status(await x.call('GET', `${url}consolidation?year=2027`), 403, 'konsolidasi oleh unit lain')
  status(await rev.call('GET', `${url}consolidation?year=1900`), 400, 'tahun tidak masuk akal')

  const detailAfter = await rev.call('GET', detail)
  status(detailAfter, 200, 'baca detail akhir')
  contains(detailAfter, '"reviewStatus":"approved"', 'status akhir')
  contains(detailAfter, '"action":"resubmitted"', 'riwayat pengajuan ulang')

  const events = await env.pool.query(
    'SELECT count(*)::int AS n FROM sdl_subbagren_review_events WHERE proposal_id=$1',
    [id],
  )
  equal(events.rows[0].n, 4, 'jumlah event telaah')

  await env.revokeGrants(reviewer.id, 'br_r4a2_review')
  status(await rev.call('GET', detail), 404, 'baca sesudah grant dicabut')
  status(await rev.call('GET', `${url}consolidation?year=2027`), 403, 'konsolidasi sesudah grant dicabut')
}
