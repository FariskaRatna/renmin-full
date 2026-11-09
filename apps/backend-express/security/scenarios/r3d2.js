import { contains, field, notContains, status, truthy } from '../assert.js'
import { dueInDays } from './r3c.js'

/**
 * R3D2 — rantai disposisi berjenjang induk-anak.
 * Port dari `r3d2_integration_test.go`.
 *
 * Empat aturan rantai yang diuji, dan tidak satu pun bisa dilihat harness
 * karena semuanya butuh urutan:
 *   · tugas yang masih `pending` tidak bisa diteruskan — terima dulu;
 *   · penerusan tidak boleh berbalik ke atas (ke penerbit);
 *   · kedalaman berhenti di 2;
 *   · induk tidak bisa diselesaikan selama anaknya belum ditelaah.
 */
export async function verifyR3D2Hierarchy({ env, op, sa }) {
  truthy(op && sa, 'sesi op/SA belum ada')

  const newUnitUser = async (name) => {
    const u = await env.createUser(name)
    await env.attachUnit(u.id, 'subbagren')
    await env.grant(u.id, 'operator', 'subbagren', 'assigned', {
      reason: 'R3D2 isolated hierarchy validation',
    })
    return { browser: await env.newSession(name), id: u.id }
  }

  const manager = await newUnitUser('r3d2_manager')
  const worker = await newUnitUser('r3d2_worker')
  const junior = await newUnitUser('r3d2_junior')
  const trainee = await newUnitUser('r3d2_trainee')
  const outsider = await newUnitUser('r3d2_unassigned')

  await env.grantPermissions('operator', [
    'urmin.distribusi.receive',
    'urmin.disposisi.issue',
    'urmin.disposisi.execute',
    'urmin.disposisi.review',
  ])

  const created = await op.call(
    'POST',
    '/api/v1/urmin/surat-masuk/',
    {
      letterNumber: 'R3D2-HIERARCHY-001',
      sender: 'Test-only unit',
      letterDate: new Date().toISOString().slice(0, 10), // R5H5: relatif, daftar aktif kini ±15 hari
      receivedDate: new Date().toISOString().slice(0, 10),
      subject: 'R3D2 parent child chain security validation',
      classification: 'biasa',
      reason: 'Register ephemeral document for R3D2 security checks',
    },
    true,
  )
  status(created, 201, 'buat surat R3D2')
  const letterID = field(created, 'item.id', 'id surat')
  const version = JSON.parse(created.text).item.version

  status(
    await op.call(
      'POST',
      `/api/v1/urmin/surat-masuk/${letterID}/register`,
      { reason: 'Register R3D2 temporary letter', version },
      true,
    ),
    200,
    'daftarkan surat',
  )
  const sent = await op.call(
    'POST',
    `/api/v1/urmin/surat-masuk/${letterID}/distributions`,
    { unit: 'subbagren', recipientId: manager.id, reason: 'Route test letter to designated hierarchy owner' },
    true,
  )
  status(sent, 201, 'distribusikan')
  const deliveryId = field(sent, 'id', 'id distribusi')

  status(
    await manager.browser.call(
      'POST',
      `/api/v1/urmin/distribution-inbox/${deliveryId}/receive`,
      { reason: 'Manager accepts hierarchy test letter' },
      true,
    ),
    200,
    'terima distribusi',
  )

  const due = dueInDays(9)
  const rootIssued = await manager.browser.call(
    'POST',
    `/api/v1/urmin/distribution-inbox/${deliveryId}/dispositions`,
    { assigneeId: worker.id, instruction: 'Coordinate response and assign separate subtasks', dueDate: due },
    true,
  )
  status(rootIssued, 201, 'terbitkan tugas akar')
  const rootID = field(rootIssued, 'id', 'id tugas akar')
  const rootURL = `/api/v1/urmin/dispositions/${rootID}`

  const forward = (actor, body, csrf = true) => actor.call('POST', `${rootURL}/forward`, body, csrf)

  status(
    await forward(worker.browser, {
      assigneeId: junior.id,
      instruction: 'Do the initial document review',
      dueDate: due,
      version: 1,
    }),
    403,
    'teruskan saat induk masih pending',
  )
  status(
    await worker.browser.call('POST', `${rootURL}/accept`, { reason: 'Parent task accepted before delegation', version: 1 }, true),
    200,
    'terima tugas akar',
  )
  status(await worker.browser.call('GET', `${rootURL}/forward-candidates`), 403, 'calon tanpa permission forward')
  status(
    await forward(worker.browser, {
      assigneeId: junior.id,
      instruction: 'Do the initial document review',
      dueDate: due,
      version: 2,
    }),
    403,
    'teruskan tanpa permission',
  )

  await env.grantPermissions('operator', ['urmin.disposisi.forward'])

  const candidates = await worker.browser.call('GET', `${rootURL}/forward-candidates`)
  status(candidates, 200, 'daftar calon penerusan')
  contains(candidates, junior.id, 'calon ke bawah tidak muncul')
  // Penerbit tidak boleh muncul sebagai calon: itu akan menutup siklus.
  notContains(candidates, manager.id, 'penerbit muncul sebagai calon penerusan')

  status(
    await forward(worker.browser, {
      assigneeId: manager.id,
      instruction: 'Attempt to route the task backwards',
      dueDate: due,
      version: 2,
    }),
    403,
    'teruskan balik ke penerbit',
  )
  status(
    await forward(outsider.browser, {
      assigneeId: junior.id,
      instruction: 'Unauthorized user tries forwarding',
      dueDate: due,
      version: 2,
    }),
    404,
    'teruskan oleh non-pihak',
  )
  status(
    await forward(sa, {
      assigneeId: junior.id,
      instruction: 'Superadmin cannot delegate operational work',
      dueDate: due,
      version: 2,
    }),
    403,
    'teruskan oleh SA',
  )
  status(
    await forward(
      worker.browser,
      { assigneeId: junior.id, instruction: 'Junior reviews the registration details', dueDate: due, version: 2 },
      false,
    ),
    403,
    'teruskan tanpa CSRF',
  )
  // Tenggat anak tidak boleh melewati tenggat induk.
  status(
    await forward(worker.browser, {
      assigneeId: junior.id,
      instruction: 'Junior reviews the registration details',
      dueDate: dueInDays(10),
      version: 2,
    }),
    409,
    'tenggat anak melewati induk',
  )

  const childCreated = await forward(worker.browser, {
    assigneeId: junior.id,
    instruction: 'Junior reviews the registration details',
    dueDate: due,
    version: 2,
  })
  status(childCreated, 201, 'teruskan ke junior')
  const child = JSON.parse(childCreated.text)
  truthy(child.id, 'id anak kosong')
  truthy(child.parentTaskId === rootID, `parentTaskId ${child.parentTaskId}, diharapkan ${rootID}`)
  truthy(child.depth === 1, `depth ${child.depth}, diharapkan 1`)

  status(
    await worker.browser.call('POST', `${rootURL}/complete`, { reason: 'Completion must be blocked until child is reviewed', version: 3 }, true),
    409,
    'selesaikan induk sebelum anak ditelaah',
  )

  const childURL = `/api/v1/urmin/dispositions/${child.id}`
  status(
    await junior.browser.call('POST', `${childURL}/accept`, { reason: 'Junior accepted subtask', version: 1 }, true),
    200,
    'junior terima subtugas',
  )
  const leafCreated = await junior.browser.call(
    'POST',
    `${childURL}/forward`,
    { assigneeId: trainee.id, instruction: 'Trainee checks supporting details', dueDate: due, version: 2 },
    true,
  )
  status(leafCreated, 201, 'teruskan ke trainee')
  const leaf = JSON.parse(leafCreated.text)
  truthy(leaf.id, 'id cucu kosong')
  truthy(leaf.depth === 2, `depth ${leaf.depth}, diharapkan 2`)

  const leafURL = `/api/v1/urmin/dispositions/${leaf.id}`
  status(
    await trainee.browser.call('POST', `${leafURL}/accept`, { reason: 'Trainee begins delegated review', version: 1 }, true),
    200,
    'trainee terima',
  )
  // Plafon kedalaman: dari depth 2 tidak ada penerusan lagi.
  status(await trainee.browser.call('GET', `${leafURL}/forward-candidates`), 403, 'plafon kedalaman')
  status(
    await trainee.browser.call('POST', `${leafURL}/complete`, { reason: 'Trainee confirmed the supporting documents', version: 2 }, true),
    200,
    'trainee selesaikan',
  )
  status(
    await junior.browser.call('POST', `${childURL}/complete`, { reason: 'Cannot finish until grandchild reviewed', version: 3 }, true),
    409,
    'selesaikan anak sebelum cucu ditelaah',
  )
  status(
    await junior.browser.call('POST', `${leafURL}/review`, { decision: 'approved', reason: 'Trainee evidence meets requirements', version: 3 }, true),
    200,
    'junior telaah cucu',
  )
  status(
    await junior.browser.call('POST', `${childURL}/complete`, { reason: 'Reviewed the full nested set of findings', version: 3 }, true),
    200,
    'junior selesaikan anak',
  )
  status(
    await worker.browser.call('POST', `${childURL}/review`, { decision: 'approved', reason: 'Junior review meets the assignment criteria', version: 4 }, true),
    200,
    'worker telaah anak',
  )
  status(
    await worker.browser.call('POST', `${rootURL}/complete`, { reason: 'All subtask outcomes have been reviewed', version: 3 }, true),
    200,
    'selesaikan akar',
  )
  status(
    await manager.browser.call('POST', `${rootURL}/review`, { decision: 'approved', reason: 'Complete hierarchy reviewed and accepted', version: 4 }, true),
    200,
    'penerbit telaah akar',
  )

  status(await outsider.browser.call('GET', `${leafURL}/history`), 404, 'riwayat cucu oleh non-pihak')
  status(await junior.browser.call('GET', `${leafURL}/history`), 200, 'riwayat cucu oleh induknya')
  status(await trainee.browser.call('GET', `/api/v1/urmin/surat-masuk/${letterID}`), 404, 'trainee buka registri')

  // Mencabut grant LEWAT TENGAH rantai memutus akses cucu, bukan hanya akses
  // orang yang dicabut: rantai divalidasi ulang dari akar setiap kali.
  await env.revokeGrants(junior.id)
  status(await trainee.browser.call('GET', `${leafURL}/history`), 404, 'pencabutan leluhur memutus rantai')
}
