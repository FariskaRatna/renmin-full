import { deliverable, retry } from './urmin.js'

/**
 * Antrean email surat masuk (R5F22), port dari internal/notifications/intake.go.
 *
 * Tabelnya SENGAJA terpisah dari outbox tugas disposisi: semantik keduanya
 * berbeda, dan memisahkannya berarti pesan yang sudah ada tidak perlu
 * disentuh sama sekali. Seperti outbox satunya, tidak ada alamat maupun isi
 * pesan yang disimpan — hanya rujukan ke distribusi dan penerimanya.
 */

const INTAKE_SUBJECT = 'Surat Masuk Baru - SIERA DELTA LIMA'

const INTAKE_BODY =
  'Ada Surat Masuk baru yang memerlukan arahan atau disposisi Anda. ' +
  'Silakan login, kemudian buka URMIN > Surat Masuk > Inbox.'

/**
 * Padanan claimIntake (intake.go:29).
 *
 * Perhatikan JOIN-nya: ia menuntut distribusinya masih ada DAN penerimanya
 * masih cocok DAN unit penerimanya `urmin`. Jadi distribusi yang berubah atau
 * salah unit tidak pernah menghasilkan email, dan itu diperiksa di SETIAP
 * klaim, bukan sekali saat antrean diisi.
 */
async function claimIntake(pool) {
  await pool.query(
    `UPDATE sdl_urmin_intake_mail_outbox
        SET status='failed',lease_until=NULL,error_code='delivery_interrupted'
      WHERE status='sending' AND attempts>=6 AND lease_until<now()`,
  )

  const { rows } = await pool.query(
    `WITH candidate AS (
       SELECT n.id FROM sdl_urmin_intake_mail_outbox n
       JOIN sdl_urmin_distributions d
         ON d.id=n.distribution_id AND d.recipient_user=n.recipient_user
            AND d.recipient_unit='urmin'
       WHERE n.attempts<6 AND
         ((n.status='queued' AND n.available_at<=now())
         OR (n.status='sending' AND n.lease_until<now()))
       ORDER BY n.created_at,n.id
       FOR UPDATE OF n SKIP LOCKED LIMIT 1
     ) UPDATE sdl_urmin_intake_mail_outbox n
         SET status='sending',attempts=n.attempts+1,
             lease_until=now()+interval '90 seconds',error_code=NULL
         FROM candidate c WHERE n.id=c.id
         RETURNING n.id::text AS id,n.recipient_user::text AS recipient_user,n.attempts`,
  )
  if (rows.length === 0) return undefined
  const row = rows[0]
  return { id: row.id, recipientId: row.recipient_user, attempts: Number(row.attempts) }
}

/**
 * Padanan deliverIntakeOne (intake.go:58).
 *
 * Dua hal berbeda dari jalur disposisi, keduanya disalin apa adanya:
 *
 *  - Penerima wajib **sudah merotasi password sementara**
 *    (`NOT must_change_password`). Masuk akal: email ini menyuruh orang
 *    login, dan akun yang belum merotasi password tidak bisa berbuat apa-apa
 *    selain itu. Jalur disposisi tidak memeriksanya.
 *  - Alamat juga ditolak kalau mengandung NUL, sedangkan jalur disposisi
 *    hanya menolak CR dan LF. Asimetri di Go, bukan kekeliruan port.
 */
export async function deliverIntakeOne(pool, mailer) {
  const job = await claimIntake(pool)
  if (!job) return

  let address
  let active
  let passwordReady
  try {
    const { rows } = await pool.query(
      `SELECT email,is_active,NOT must_change_password AS password_ready
         FROM sdl_users WHERE id=$1::uuid`,
      [job.recipientId],
    )
    if (rows.length === 0) throw new Error('no_rows')
    address = rows[0].email
    active = rows[0].is_active === true
    passwordReady = rows[0].password_ready === true
  } catch {
    await retry(pool, 'sdl_urmin_intake_mail_outbox', job, 'lookup_failed', false)
    return
  }

  if (!active || !passwordReady || !deliverable(address, '\0')) {
    await retry(pool, 'sdl_urmin_intake_mail_outbox', job, 'recipient_unavailable', true)
    return
  }

  try {
    await mailer.sendNotification(address, INTAKE_SUBJECT, INTAKE_BODY)
  } catch {
    await retry(pool, 'sdl_urmin_intake_mail_outbox', job, 'smtp_delivery_failed', false)
    return
  }

  await pool.query(
    `UPDATE sdl_urmin_intake_mail_outbox
        SET status='sent',sent_at=now(),lease_until=NULL,error_code=NULL
      WHERE id=$1::uuid AND status='sending'`,
    [job.id],
  )
}
