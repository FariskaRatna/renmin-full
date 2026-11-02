import { contains, field, notContains, status, truthy } from '../assert.js'

/** Tanggal YYYY-MM-DD, `n` hari dari sekarang (UTC), padanan time.Now().AddDate. */
export function dueInDays(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
}

/**
 * R3C + R3D1 — rantai disposisi dan telaah hasilnya.
 * Port dari `r3c_integration_test.go`.
 *
 * Inti yang diuji: tugas disposisi adalah kewenangan PER ORANG, bukan per
 * unit. Rekan se-unit yang tidak ditugaskan tidak melihat tugasnya, pelaksana
 * tidak boleh menelaah pekerjaannya sendiri, dan penerbit tidak boleh
 * menerima tugas yang ia terbitkan.
 */
export async function verifyR3CDisposition({ env, op, sa }) {
  truthy(op && sa, 'sesi op/SA belum ada')

  const add = async (name) => {
    const user = await env.createUser(name)
    await env.attachUnit(user.id, 'subbagren')
    await env.grant(user.id, 'operator', 'subbagren', 'assigned', {
      reason: 'R3C isolated security verification',
    })
    return { browser: await env.newSession(name), id: user.id }
  }

  const manager = await add('r3c_manager')
  const worker = await add('r3c_worker')
  const bystander = await add('r3c_unassigned')

  await env.grantPermissions('operator', ['urmin.distribusi.receive'])

  const created = await op.call(
    'POST',
    '/api/v1/urmin/surat-masuk/',
    {
      letterNumber: 'R3C-SECURITY-001',
      sender: 'Internal security test',
      letterDate: '2026-10-19',
      receivedDate: '2026-10-19',
      subject: 'Disposition scope and history verification',
      classification: 'biasa',
      reason: 'Isolated R3C test-only incoming document',
    },
    true,
  )
  status(created, 201, 'buat surat R3C')
  const letter = field(created, 'item.id', 'id surat')
  const version = JSON.parse(created.text).item.version

  status(
    await op.call(
      'POST',
      `/api/v1/urmin/surat-masuk/${letter}/register`,
      { reason: 'Register for isolated R3C integration', version },
      true,
    ),
    200,
    'daftarkan surat',
  )

  const sent = await op.call(
    'POST',
    `/api/v1/urmin/surat-masuk/${letter}/distributions`,
    { unit: 'subbagren', recipientId: manager.id, reason: 'Address manager explicitly for R3C disposition' },
    true,
  )
  status(sent, 201, 'distribusikan')
  const distributionId = field(sent, 'id', 'id distribusi')

  const issueURL = `/api/v1/urmin/distribution-inbox/${distributionId}/dispositions`
  const payload = {
    assigneeId: worker.id,
    instruction: 'Review the letter and submit written findings',
    dueDate: dueInDays(7),
  }

  // Belum diterima -> belum ada penerbit yang sah.
  status(await manager.browser.call('POST', issueURL, payload, true), 409, 'terbitkan sebelum diterima')
  status(
    await manager.browser.call(
      'POST',
      `/api/v1/urmin/distribution-inbox/${distributionId}/receive`,
      { reason: 'Manager acknowledges R3C distribution' },
      true,
    ),
    200,
    'terima distribusi',
  )
  // Sudah penerima yang sah, tapi permission `issue` belum ada.
  status(await manager.browser.call('POST', issueURL, payload, true), 403, 'terbitkan tanpa permission')

  await env.grantPermissions('operator', ['urmin.disposisi.issue', 'urmin.disposisi.execute'])

  const candidates = await manager.browser.call(
    'GET',
    `/api/v1/urmin/distribution-inbox/${distributionId}/disposition-candidates`,
  )
  status(candidates, 200, 'daftar calon pelaksana')
  contains(candidates, worker.id, 'pelaksana yang memenuhi syarat tidak muncul')

  const issued = await manager.browser.call('POST', issueURL, payload, true)
  status(issued, 201, 'terbitkan disposisi')
  const taskID = field(issued, 'id', 'id tugas')
  status(await manager.browser.call('POST', issueURL, payload, true), 409, 'disposisi ganda')

  status(await sa.call('GET', '/api/v1/urmin/dispositions/'), 403, 'SA lihat disposisi')

  const mine = await worker.browser.call('GET', '/api/v1/urmin/dispositions/')
  status(mine, 200, 'daftar tugas pelaksana')
  contains(mine, taskID, 'pelaksana tidak melihat tugasnya')

  const theirs = await bystander.browser.call('GET', '/api/v1/urmin/dispositions/')
  status(theirs, 200, 'daftar tugas rekan se-unit')
  notContains(theirs, taskID, 'rekan se-unit tak ditugaskan melihat tugas')

  status(
    await bystander.browser.call('GET', `/api/v1/urmin/dispositions/${taskID}/history`),
    404,
    'riwayat oleh non-pihak',
  )
  status(
    await bystander.browser.call('GET', `/api/v1/urmin/surat-masuk/${letter}/attachments`),
    404,
    'lampiran oleh non-pihak',
  )
  // Pelaksana BOLEH membuka lampiran suratnya — itu bagian dari tugasnya.
  status(
    await worker.browser.call('GET', `/api/v1/urmin/surat-masuk/${letter}/attachments`),
    200,
    'lampiran oleh pelaksana',
  )

  const acceptURL = `/api/v1/urmin/dispositions/${taskID}/accept`
  status(
    await manager.browser.call('POST', acceptURL, { reason: 'Issuer cannot acknowledge subordinate task', version: 1 }, true),
    404,
    'penerbit menerima tugasnya sendiri',
  )
  status(
    await worker.browser.call('POST', acceptURL, { reason: 'Missing CSRF must fail', version: 1 }, false),
    403,
    'terima tanpa CSRF',
  )
  status(
    await worker.browser.call('POST', acceptURL, { reason: 'Assignment accepted by the responsible worker', version: 1 }, true),
    200,
    'terima tugas',
  )
  status(
    await worker.browser.call('POST', acceptURL, { reason: 'Replay must not change anything', version: 1 }, true),
    409,
    'terima diputar ulang',
  )

  const completeURL = `/api/v1/urmin/dispositions/${taskID}/complete`
  status(
    await worker.browser.call('POST', completeURL, { reason: 'Written findings submitted and recorded', version: 2 }, true),
    200,
    'selesaikan tugas',
  )
  status(
    await worker.browser.call('POST', completeURL, { reason: 'Duplicated completion must not succeed', version: 3 }, true),
    409,
    'penyelesaian ganda',
  )

  // R3D1: hanya penerbit asli, dan hanya dengan permission review eksplisit.
  const reviewURL = `/api/v1/urmin/dispositions/${taskID}/review`
  const reviewBody = {
    decision: 'approved',
    reason: 'Reviewed and accepted after validating the written response',
    version: 3,
  }
  status(await worker.browser.call('POST', reviewURL, reviewBody, true), 404, 'pelaksana menelaah dirinya sendiri')
  status(await bystander.browser.call('POST', reviewURL, reviewBody, true), 404, 'non-pihak menelaah')
  status(await sa.call('POST', reviewURL, reviewBody, true), 403, 'SA menelaah')
  status(await manager.browser.call('POST', reviewURL, reviewBody, true), 403, 'penerbit tanpa permission review')

  await env.grantPermissions('operator', ['urmin.disposisi.review'])

  status(await manager.browser.call('POST', reviewURL, reviewBody, false), 403, 'telaah tanpa CSRF')
  status(await manager.browser.call('POST', reviewURL, reviewBody, true), 200, 'telaah oleh penerbit')
  status(await manager.browser.call('POST', reviewURL, reviewBody, true), 409, 'telaah kedua')

  const history = await manager.browser.call('GET', `/api/v1/urmin/dispositions/${taskID}/history`)
  status(history, 200, 'riwayat lengkap')
  contains(history, '"status":"completed"', 'status completed hilang')
  contains(history, '"action":"completed"', 'event completed hilang')
  contains(history, '"action":"approved"', 'event approved hilang')

  // Punya tugas atas sebuah surat BUKAN izin membaca registri suratnya.
  status(await worker.browser.call('GET', `/api/v1/urmin/surat-masuk/${letter}`), 404, 'pelaksana buka registri')

  await env.revokeGrants(worker.id)
  const afterRevoke = await worker.browser.call('GET', '/api/v1/urmin/dispositions/')
  status(afterRevoke, 200, 'daftar tugas sesudah dicabut')
  notContains(afterRevoke, taskID, 'pelaksana yang dicabut masih melihat tugas')
  status(
    await worker.browser.call('GET', `/api/v1/urmin/surat-masuk/${letter}/attachments`),
    404,
    'lampiran sesudah dicabut',
  )
}
