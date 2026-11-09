import { contains, field, notContains, status, truthy } from '../assert.js'

/** PDF minimal yang sah, byte-identik dengan yang dipakai suite Go. */
const SAFE_PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF', 'latin1')

/**
 * R3B — distribusi aman: lampiran, penerusan bertarget, dan pencabutan grant.
 * Port dari `r3b_integration_test.go`.
 *
 * Yang dibuktikan dan tidak bisa dilihat harness: dokumen yang didistribusikan
 * ke SATU orang tidak terlihat oleh rekan SE-UNIT yang tidak dialamatkan, dan
 * pencabutan grant langsung menutup akses pada sesi yang sedang hidup.
 */
export async function verifyR3BSecureDistribution({ env, op, outsider, sa }) {
  truthy(op && outsider && sa, 'sesi op/outsider/SA belum ada')

  await env.grantPermissions('operator', [
    'urmin.surat_masuk.attach',
    'urmin.surat_masuk.download',
    'urmin.surat_masuk.distribute',
    'urmin.distribusi.receive',
  ])

  const created = await op.call(
    'POST',
    '/api/v1/urmin/surat-masuk/',
    {
      letterNumber: 'SDL-R3B-TEST-001',
      sender: 'Test Sekretariat',
      letterDate: '2026-10-18',
      receivedDate: '2026-10-18',
      subject: 'R3B isolated attachment and distribution test',
      classification: 'biasa',
      reason: 'R3B verification only in isolated database',
    },
    true,
  )
  status(created, 201, 'buat surat R3B')
  const id = field(created, 'item.id', 'id surat')
  const version = JSON.parse(created.text).item.version

  status(
    await op.call(
      'POST',
      `/api/v1/urmin/surat-masuk/${id}/register`,
      { reason: 'Register for R3B security integration', version },
      true,
    ),
    200,
    'daftarkan surat',
  )

  // Superadmin 403, orang unit lain 404 — selisih yang disengaja.
  status(await sa.call('GET', `/api/v1/urmin/surat-masuk/${id}/attachments`), 403, 'SA lihat lampiran')
  status(
    await outsider.call('GET', `/api/v1/urmin/surat-masuk/${id}/attachments`),
    404,
    'lintas unit lihat lampiran',
  )

  const sent = await op.call(
    'POST',
    `/api/v1/urmin/surat-masuk/${id}/distributions`,
    {
      unit: 'subbagren',
      recipientId: env.users.get('outsider_r2d5').id,
      reason: 'Deliver document only to assigned Subbagren user',
    },
    true,
  )
  status(sent, 201, 'distribusikan surat')
  const deliveryId = field(sent, 'id', 'id distribusi')

  // Pengirim bukan penerima: ia tidak boleh mengonfirmasi penerimaan.
  status(
    await op.call(
      'POST',
      `/api/v1/urmin/distribution-inbox/${deliveryId}/receive`,
      { reason: 'Sender must not acknowledge recipient inbox' },
      true,
    ),
    404,
    'pengirim konfirmasi penerimaan',
  )
  status(
    await op.call(
      'POST',
      `/api/v1/urmin/surat-masuk/${id}/distributions`,
      {
        unit: 'subbagren',
        recipientId: env.users.get('outsider_r2d5').id,
        reason: 'Duplicate pending delivery forbidden',
      },
      true,
    ),
    409,
    'distribusi ganda',
  )

  // Rekan SE-UNIT dengan grant scope `unit` yang TIDAK dialamatkan.
  const other = await env.createUser('other_r3b')
  await env.attachUnit(other.id, 'subbagren')
  await env.grant(other.id, 'operator', 'subbagren', 'unit', {
    reason: 'same-unit unaddressed access must be denied',
  })
  const otherBrowser = await env.newSession('other_r3b')

  const otherInbox = await otherBrowser.call('GET', '/api/v1/urmin/distribution-inbox/')
  status(otherInbox, 200, 'kotak masuk rekan se-unit')
  notContains(otherInbox, deliveryId, 'rekan se-unit tak dialamatkan melihat distribusi')
  status(
    await otherBrowser.call('GET', `/api/v1/urmin/surat-masuk/${id}/attachments`),
    404,
    'rekan se-unit lihat lampiran',
  )

  const inbox = await outsider.call('GET', '/api/v1/urmin/distribution-inbox/')
  status(inbox, 200, 'kotak masuk penerima')
  contains(inbox, deliveryId, 'distribusi yang dialamatkan tidak muncul')
  // Dialamatkan BUKAN berarti boleh membuka registri surat masuknya.
  status(await outsider.call('GET', `/api/v1/urmin/surat-masuk/${id}`), 404, 'penerima buka registri')

  status(
    await outsider.call(
      'POST',
      `/api/v1/urmin/distribution-inbox/${deliveryId}/receive`,
      { reason: 'Missing CSRF must not accept receipt' },
      false,
    ),
    403,
    'terima tanpa CSRF',
  )
  status(
    await outsider.call(
      'POST',
      `/api/v1/urmin/distribution-inbox/${deliveryId}/receive`,
      { reason: 'Received and acknowledged for internal processing' },
      true,
    ),
    200,
    'terima distribusi',
  )
  status(
    await outsider.call(
      'POST',
      `/api/v1/urmin/distribution-inbox/${deliveryId}/receive`,
      { reason: 'A replay confirmation should be rejected' },
      true,
    ),
    409,
    'konfirmasi diputar ulang',
  )
  status(
    await sa.call(
      'POST',
      `/api/v1/urmin/distribution-inbox/${deliveryId}/receive`,
      { reason: 'Superadmin forbidden access to operational inbox' },
      true,
    ),
    403,
    'SA konfirmasi penerimaan',
  )

  const list = await op.call('GET', `/api/v1/urmin/surat-masuk/${id}/distributions`)
  status(list, 200, 'daftar distribusi')
  contains(list, '"status":"received"', 'penerimaan tidak tersimpan')

  // Unggahan: tipe disimpulkan dari isi berkas, bukan dari nama atau header.
  const upload = (filename, data) =>
    op.upload(`/api/v1/urmin/surat-masuk/${id}/attachments`, {
      filename,
      data,
      fields: { reason: 'Upload document evidence for R3B security tests' },
    })

  status(await upload('fake.pdf', Buffer.from('bad', 'utf8')), 400, 'PDF palsu')
  const uploaded = await upload('safe.pdf', SAFE_PDF)
  status(uploaded, 201, 'unggah PDF sah')
  const attachmentId = JSON.parse(uploaded.text).id
  truthy(attachmentId, 'id lampiran kosong')

  const path = `/api/v1/urmin/surat-masuk/${id}/attachments/${attachmentId}/download`
  const download = await outsider.call('GET', path)
  status(download, 200, 'unduh oleh penerima')
  truthy(download.headers.get('content-disposition'), 'Content-Disposition hilang')
  // octet-stream, bukan application/pdf: browser tidak boleh me-render berkas
  // yang diunggah pengguna lain di origin aplikasi.
  truthy(
    download.headers.get('content-type') === 'application/octet-stream',
    `Content-Type unduhan ${download.headers.get('content-type')}, diharapkan application/octet-stream`,
  )
  status(await sa.call('GET', path), 403, 'SA unduh lampiran')

  // Grant dicabut: akses harus hilang SEKETIKA, pada sesi yang sama.
  await env.revokeGrants(env.users.get('outsider_r2d5').id)
  status(await outsider.call('GET', path), 404, 'unduh sesudah grant dicabut')
  const afterRevoke = await outsider.call('GET', '/api/v1/urmin/distribution-inbox/')
  status(afterRevoke, 200, 'kotak masuk sesudah dicabut')
  notContains(afterRevoke, deliveryId, 'penerima yang dicabut masih melihat distribusi')
}
