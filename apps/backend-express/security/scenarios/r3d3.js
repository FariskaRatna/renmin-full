import { contains, field, status, truthy } from '../assert.js'
import { dueInDays } from './r3c.js'

/**
 * R3D3 — persetujuan akhir pimpinan.
 * Port dari `r3d3_integration_test.go`.
 *
 * Pemisahan yang diuji: penerbit mengajukan, PIMPINAN memutuskan, dan keduanya
 * tidak boleh orang yang sama — bahkan ketika penerbit diberi grant Kabag yang
 * identik. Itu dibuktikan secara eksplisit di tengah skenario.
 */
export async function verifyR3D3Leadership({ env, op, sa }) {
  truthy(op && sa, 'sesi op/SA belum ada')

  await env.createRole('br_kabagrenmin', 'R3D3 Test Kabagrenmin')
  await env.grantPermissions('operator', [
    'urmin.distribusi.receive',
    'urmin.disposisi.issue',
    'urmin.disposisi.execute',
    'urmin.disposisi.review',
    'urmin.disposisi.final.submit',
  ])

  const makeUser = async (name, role) => {
    const u = await env.createUser(name)
    await env.attachUnit(u.id, 'subbagren')
    await env.grant(u.id, role, 'subbagren', 'unit', { reason: 'R3D3 isolated grant only' })
    return { browser: await env.newSession(name), id: u.id }
  }

  const manager = await makeUser('r3d3_issuer', 'operator')
  const worker = await makeUser('r3d3_worker', 'operator')
  const lead = await makeUser('r3d3_leader', 'br_kabagrenmin')
  const other = await makeUser('r3d3_outsider', 'operator')

  const created = await op.call(
    'POST',
    '/api/v1/urmin/surat-masuk/',
    {
      letterNumber: 'R3D3-SECURITY-001',
      sender: 'Integration test only',
      letterDate: '2026-10-20',
      receivedDate: '2026-10-20',
      subject: 'Isolated final approval workflow review',
      classification: 'biasa',
      reason: 'Register synthetic document to test final approval',
    },
    true,
  )
  status(created, 201, 'buat surat R3D3')
  const letterID = field(created, 'item.id', 'id surat')
  const version = JSON.parse(created.text).item.version

  status(
    await op.call(
      'POST',
      `/api/v1/urmin/surat-masuk/${letterID}/register`,
      { reason: 'Register the R3D3 synthetic test letter', version },
      true,
    ),
    200,
    'daftarkan surat',
  )
  const sent = await op.call(
    'POST',
    `/api/v1/urmin/surat-masuk/${letterID}/distributions`,
    { unit: 'subbagren', recipientId: manager.id, reason: 'Designated manager receives temporary document' },
    true,
  )
  status(sent, 201, 'distribusikan')
  const distID = field(sent, 'id', 'id distribusi')

  status(
    await manager.browser.call(
      'POST',
      `/api/v1/urmin/distribution-inbox/${distID}/receive`,
      { reason: 'Manager accepts the final approval test' },
      true,
    ),
    200,
    'terima distribusi',
  )

  const rootIssued = await manager.browser.call(
    'POST',
    `/api/v1/urmin/distribution-inbox/${distID}/dispositions`,
    { assigneeId: worker.id, instruction: 'Prepare document for executive sign off', dueDate: dueInDays(8) },
    true,
  )
  status(rootIssued, 201, 'terbitkan tugas')
  const rootID = field(rootIssued, 'id', 'id tugas')
  const url = `/api/v1/urmin/dispositions/${rootID}`

  status(
    await manager.browser.call('POST', `${url}/submit-final`, { reason: 'Attempt before any work is complete', version: 1 }, true),
    409,
    'ajukan final sebelum pekerjaan selesai',
  )

  status(await lead.browser.call('GET', '/api/v1/urmin/dispositions/leadership'), 403, 'dasbor tanpa permission')
  await env.grantPermissions('br_kabagrenmin', ['urmin.disposisi.final.monitor'])
  const dashboard = await lead.browser.call('GET', '/api/v1/urmin/dispositions/leadership')
  status(dashboard, 200, 'dasbor pimpinan')
  contains(dashboard, rootID, 'kasus akar tidak muncul di dasbor')

  status(await other.browser.call('GET', '/api/v1/urmin/dispositions/leadership'), 403, 'dasbor oleh operator biasa')
  status(await sa.call('GET', '/api/v1/urmin/dispositions/leadership'), 403, 'dasbor oleh SA')

  status(
    await worker.browser.call('POST', `${url}/accept`, { reason: 'Operator begins disposition task', version: 1 }, true),
    200,
    'terima tugas',
  )
  status(
    await worker.browser.call('POST', `${url}/complete`, { reason: 'Operator completed all requested paperwork', version: 2 }, true),
    200,
    'selesaikan tugas',
  )
  status(
    await manager.browser.call('POST', `${url}/review`, { decision: 'approved', reason: 'All work has been checked by manager', version: 3 }, true),
    200,
    'telaah penerbit',
  )

  status(
    await other.browser.call('POST', `${url}/submit-final`, { reason: 'Attempt unrelated submit', version: 3 }, true),
    404,
    'ajukan final oleh non-pihak',
  )
  status(
    await manager.browser.call('POST', `${url}/submit-final`, { reason: 'Submit completed reviews to Kabagrenmin', version: 3 }, true),
    201,
    'ajukan final',
  )
  status(
    await manager.browser.call('POST', `${url}/submit-final`, { reason: 'Repeat same final approval submission', version: 3 }, true),
    409,
    'ajukan final dua kali',
  )

  const pending = await lead.browser.call('GET', `${url}/final-status`)
  status(pending, 200, 'status final menunggu')
  contains(pending, '"progressPercent":90', 'progres seharusnya 90 sebelum keputusan')

  status(
    await lead.browser.call('POST', `${url}/decide-final`, { decision: 'approved', reason: 'Executive approval after review', version: 1 }, true),
    403,
    'putuskan tanpa permission approve',
  )
  await env.grantPermissions('br_kabagrenmin', ['urmin.disposisi.final.approve'])
  status(
    await lead.browser.call('POST', `${url}/decide-final`, { decision: 'approved', reason: 'Try without CSRF integrity', version: 1 }, false),
    403,
    'putuskan tanpa CSRF',
  )

  // Penerbit diberi grant Kabag yang SAMA PERSIS. Ia tetap tidak boleh
  // memutuskan kasusnya sendiri — pemisahan ini tidak bisa dibeli dengan hak
  // akses.
  await env.grant(manager.id, 'br_kabagrenmin', 'subbagren', 'unit', {
    reason: 'Prove self-approval blocked',
  })
  status(
    await manager.browser.call('POST', `${url}/decide-final`, { decision: 'approved', reason: 'Illicit self approval by original issuer', version: 1 }, true),
    403,
    'penerbit menyetujui kasusnya sendiri',
  )

  status(
    await lead.browser.call('POST', `${url}/decide-final`, { decision: 'approved', reason: 'Kabagrenmin independently approves complete case', version: 1 }, true),
    200,
    'pimpinan memutuskan',
  )
  status(
    await lead.browser.call('POST', `${url}/decide-final`, { decision: 'revision_requested', reason: 'Attempt to overturn immutable approval', version: 1 }, true),
    409,
    'membatalkan keputusan final',
  )

  const done = await lead.browser.call('GET', `${url}/final-status`)
  status(done, 200, 'status final selesai')
  contains(done, '"progressPercent":100', 'progres 100 hanya setelah persetujuan akhir')

  await env.revokeGrants(lead.id)
  status(await lead.browser.call('GET', '/api/v1/urmin/dispositions/leadership'), 403, 'dasbor sesudah dicabut')
  status(await lead.browser.call('GET', `${url}/final-status`), 404, 'status final sesudah dicabut')
}
