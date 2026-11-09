import { contains, equal, field, status } from '../assert.js'

/**
 * R4A1 — akses usulan Subbagren.
 * Port dari `r4a1_integration_test.go`.
 *
 * Dua hal yang tidak bisa dilihat harness: naik klasifikasi ke `penting`
 * ditolak bagi pemegang batas `biasa`, dan usulan yang SUDAH diajukan menjadi
 * tidak bisa disunting — dibuktikan dengan mencoba menyuntingnya setelahnya,
 * bukan dengan membaca flag di respons.
 */
export async function verifyR4A1Usulan({ env, sa }) {
  const writer = await env.createUser('r4a1_writer')
  const stranger = await env.createUser('r4a1_stranger')
  await env.attachUnit(writer.id, 'subbagren')
  await env.attachUnit(stranger.id, 'urmin')

  await env.createRole('br_r4a1_test', 'R4A1 Test Role')
  await env.grant(writer.id, 'br_r4a1_test', 'subbagren', 'own', { reason: 'Isolated R4A1 grant only' })

  const w = await env.newSession('r4a1_writer')
  const x = await env.newSession('r4a1_stranger')

  const url = '/api/v1/subbagren/usulan/'
  const draft = {
    fiscalYear: 2027,
    sourceUnit: 'Subsatker Dummy',
    title: 'Pengembangan administrasi internal',
    outputTarget: 'Dokumen kegiatan operasional internal',
    proposedBudget: 150000000,
    classification: 'biasa',
    reason: 'Mencatat usulan dummy untuk audit',
  }

  // Grant saja tidak memberi wewenang apa pun: permission belum ada.
  status(await w.call('POST', url, draft, true), 403, 'buat tanpa permission')
  status(await sa.call('GET', url), 403, 'SA baca usulan')
  status(await x.call('POST', url, draft, true), 403, 'unit lain buat usulan')

  await env.grantPermissions('br_r4a1_test', [
    'subbagren.usulan.read',
    'subbagren.usulan.create',
    'subbagren.usulan.update',
  ])

  status(await w.call('POST', url, draft, false), 403, 'buat tanpa CSRF')
  status(await w.call('POST', url, { ...draft, proposedBudget: -100 }, true), 400, 'anggaran negatif')
  // Batas klasifikasi grant adalah `biasa`; membuat dokumen `penting` ditolak.
  status(await w.call('POST', url, { ...draft, classification: 'penting' }, true), 403, 'naik ke klasifikasi penting')

  const created = await w.call('POST', url, draft, true)
  status(created, 201, 'buat usulan')
  const id = field(created, 'item.id', 'id usulan')
  equal(JSON.parse(created.text).item.version, 1, 'versi awal')
  const detail = url + id

  status(await x.call('GET', detail), 404, 'unit lain baca detail')
  const mine = await w.call('GET', detail)
  status(mine, 200, 'baca detail sendiri')
  contains(mine, '"canUpdate":true', 'pemilik seharusnya bisa menyunting drafnya')

  const list = await w.call('GET', url)
  status(list, 200, 'daftar usulan')
  contains(list, id, 'draf yang baru dibuat tidak ada di daftar')

  const update = {
    version: 1,
    fiscalYear: 2027,
    sourceUnit: 'Subsatker Dummy',
    title: 'Usulan kegiatan hasil koreksi',
    outputTarget: 'Dokumen keluaran kegiatan internal',
    proposedBudget: 200000000,
    classification: 'biasa',
    reason: 'Perubahan estimasi sesuai telaah awal',
  }
  status(await w.call('PATCH', detail, { ...update, version: 10, title: 'Usulan berubah untuk audit', outputTarget: 'Dokumen keluaran yang baru dibuat', proposedBudget: 1000000, reason: 'Perbarui draft dummy untuk test' }, true), 409, 'versi basi')
  status(await w.call('PATCH', detail, update, true), 200, 'sunting draf')

  // 404, bukan 403: permission `submit` belum ada.
  status(await w.call('POST', `${detail}/submit`, { version: 2, reason: 'Ajukan usulan internal untuk penelaahan' }, true), 404, 'ajukan tanpa permission')
  await env.grantPermissions('br_r4a1_test', ['subbagren.usulan.submit'])
  status(await w.call('POST', `${detail}/submit`, { version: 2, reason: 'Ajukan usulan internal untuk penelaahan' }, true), 200, 'ajukan usulan')

  // Sudah diajukan = tidak bisa disunting lagi.
  status(await w.call('PATCH', detail, update, true), 404, 'sunting sesudah diajukan')

  const after = await w.call('GET', detail)
  status(after, 200, 'baca sesudah diajukan')
  contains(after, '"action":"submitted"', 'riwayat pengajuan hilang')

  const history = await env.pool.query(
    'SELECT count(*)::int AS n FROM sdl_subbagren_proposal_history WHERE proposal_id=$1',
    [id],
  )
  equal(history.rows[0].n, 3, 'riwayat append-only')

  await env.revokeGrants(writer.id, 'br_r4a1_test')
  status(await w.call('GET', detail), 404, 'baca sesudah grant dicabut')
}
