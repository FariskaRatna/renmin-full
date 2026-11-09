#!/usr/bin/env node
/**
 * Menguji mesin keadaan outbox email: klaim, lease, backoff, dan batas enam
 * percobaan.
 *
 * SQL-nya disalin verbatim dari Go, jadi yang berisiko bukan query-nya
 * melainkan alur JavaScript di sekelilingnya — cabang mana yang permanen,
 * mana yang dijadwal ulang, dan kapan `attempts` dibaca. Itu yang diuji di
 * sini, dan harness tidak bisa menyentuhnya sama sekali karena worker tidak
 * punya endpoint.
 *
 * SELURUH pengujian berjalan di dalam SATU transaksi yang selalu di-ROLLBACK,
 * termasuk fixture-nya. Database tidak berubah sedikit pun, jadi alat ini aman
 * dijalankan di antara capture dan compare.
 *
 * Jalankan (butuh akses database):
 *   docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.harness.yaml \
 *     run --rm --build --entrypoint node harness verify/email-worker.js
 */
import pg from 'pg'

import { deliverIntakeOne } from '../src/notifications/intake.js'
import { deliverOne } from '../src/notifications/urmin.js'

const OUTBOX = 'sdl_urmin_email_outbox'
const INTAKE = 'sdl_urmin_intake_mail_outbox'

let failures = 0

function check(label, condition, detail = '') {
  if (!condition) failures++
  process.stdout.write(`  ${condition ? 'LULUS' : 'GAGAL'}  ${label}\n`)
  if (!condition && detail) process.stdout.write(`      ${detail}\n`)
}

/** Mailer palsu. `ready()` selalu true — worker-nya yang sedang diuji, bukan SMTP. */
function stubMailer(mode) {
  const sent = []
  return {
    sent,
    ready: () => true,
    async sendNotification(destination, subject, body) {
      if (mode === 'fail') throw new Error('smtp unreachable')
      sent.push({ destination, subject, body })
    },
  }
}

async function userId(client, username) {
  const { rows } = await client.query('SELECT id::text AS id FROM sdl_users WHERE lower(username)=$1', [username])
  if (rows.length === 0) throw new Error(`akun ${username} belum di-seed`)
  return rows[0].id
}

/**
 * Fixture minimum untuk kedua antrean. Unit WAJIB `urmin`: klausa
 * `t.unit_key='urmin'` di klaim disposisi dan `d.recipient_unit='urmin'` di
 * klaim intake menyaringnya, dan seluruh data seed harness ada di subbagren —
 * itu sebabnya outbox di database uji selalu kosong.
 */
async function seedFixtures(client) {
  const issuer = await userId(client, 'ka-urmin')
  const assignee = await userId(client, 'staf-urmin')

  const letter = await client.query(
    `INSERT INTO sdl_urmin_incoming(letter_number,sender,letter_date,received_date,subject,classification,status,created_by,updated_by)
     VALUES('900/UJI-WORKER/2026','Uji Worker','2026-09-01','2026-09-02','Sasaran uji worker email','biasa','registered',$1,$1)
     RETURNING id::text AS id`,
    [issuer],
  )
  const distribution = await client.query(
    `INSERT INTO sdl_urmin_distributions(incoming_id,sent_by,recipient_unit,recipient_user,status,reason)
     VALUES($1,$2,'urmin',$3,'sent','Distribusi untuk uji worker email.')
     RETURNING id::text AS id`,
    [letter.rows[0].id, issuer, assignee],
  )
  const task = await client.query(
    `INSERT INTO sdl_urmin_disposition_tasks(distribution_id,incoming_id,unit_key,issued_by,assigned_to,instruction,due_date)
     VALUES($1,$2,'urmin',$3,$4,'Instruksi uji worker email outbox.','2027-12-31')
     RETURNING id::text AS id`,
    [distribution.rows[0].id, letter.rows[0].id, issuer, assignee],
  )
  return { assignee, distributionId: distribution.rows[0].id, taskId: task.rows[0].id }
}

async function queueDisposition(client, taskId, assignee, event = 'assigned') {
  const { rows } = await client.query(
    `INSERT INTO ${OUTBOX}(task_id,recipient_user,event_key) VALUES($1,$2,$3) RETURNING id::text AS id`,
    [taskId, assignee, event],
  )
  return rows[0].id
}

async function row(client, table, id) {
  const { rows } = await client.query(
    `SELECT status,attempts,error_code,sent_at,lease_until,
            EXTRACT(EPOCH FROM (available_at - now()))::int AS delay_seconds
       FROM ${table} WHERE id=$1::uuid`,
    [id],
  )
  return rows[0]
}

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 })
  const client = await pool.connect()
  await client.query('BEGIN')

  try {
    process.stdout.write('Mesin keadaan outbox email (semua di dalam transaksi yang di-ROLLBACK)\n\n')
    const { assignee, distributionId, taskId } = await seedFixtures(client)

    // ---- 1. Alamat .invalid: gagal PERMANEN, bukan dijadwal ulang ----
    //
    // Ke-13 akun seed beralamat <username>@siera.invalid. Tanpa penjaga ini
    // setiap deployment uji akan mencoba enam kali per notifikasi ke domain
    // yang dijamin tidak ada.
    let id = await queueDisposition(client, taskId, assignee)
    await deliverOne(client, stubMailer('ok'))
    let state = await row(client, OUTBOX, id)
    check('.invalid -> failed permanen',
      state.status === 'failed' && state.error_code === 'recipient_unavailable' && state.attempts === 1,
      JSON.stringify(state))

    // Mulai sini alamatnya dibuat terkirim. Aman: seluruhnya di-ROLLBACK.
    await client.query("UPDATE sdl_users SET email='staf-urmin@uji.example' WHERE id=$1", [assignee])
    await client.query(`DELETE FROM ${OUTBOX} WHERE id=$1::uuid`, [id])

    // ---- 2. SMTP gagal: dijadwal ulang dengan backoff satu menit ----
    id = await queueDisposition(client, taskId, assignee)
    await deliverOne(client, stubMailer('fail'))
    state = await row(client, OUTBOX, id)
    check('SMTP gagal -> queued, attempts 1, backoff ~60 detik',
      state.status === 'queued' && state.attempts === 1 &&
      state.error_code === 'smtp_delivery_failed' && state.lease_until === null &&
      state.delay_seconds > 50 && state.delay_seconds <= 60,
      JSON.stringify(state))

    // ---- 3. Backoff dihormati: belum waktunya, tidak diklaim ----
    const sender = stubMailer('ok')
    await deliverOne(client, sender)
    state = await row(client, OUTBOX, id)
    check('available_at di masa depan -> tidak diklaim',
      state.attempts === 1 && state.status === 'queued' && sender.sent.length === 0,
      JSON.stringify(state))

    // ---- 4. Sesudah jatuh tempo: terkirim ----
    await client.query(`UPDATE ${OUTBOX} SET available_at=now() WHERE id=$1::uuid`, [id])
    const delivered = stubMailer('ok')
    await deliverOne(client, delivered)
    state = await row(client, OUTBOX, id)
    check('jatuh tempo -> sent, lease dilepas',
      state.status === 'sent' && state.attempts === 2 &&
      state.sent_at !== null && state.lease_until === null && state.error_code === null,
      JSON.stringify(state))
    check('subjek dan badan pesan sesuai peta message()',
      delivered.sent.length === 1 &&
      delivered.sent[0].subject === 'Tugas Baru - SIERA DELTA LIMA' &&
      delivered.sent[0].body === 'Anda menerima penugasan disposisi baru.',
      JSON.stringify(delivered.sent))

    // ---- 5. Batas enam percobaan ----
    await client.query(`DELETE FROM ${OUTBOX} WHERE id=$1::uuid`, [id])
    id = await queueDisposition(client, taskId, assignee)
    await client.query(`UPDATE ${OUTBOX} SET attempts=5 WHERE id=$1::uuid`, [id])
    await deliverOne(client, stubMailer('fail'))
    state = await row(client, OUTBOX, id)
    check('percobaan ke-6 gagal -> failed, tidak dijadwal lagi',
      state.status === 'failed' && state.attempts === 6 && state.error_code === 'smtp_delivery_failed',
      JSON.stringify(state))

    // ---- 6. Pemulihan baris yang tersangkut di 'sending' ----
    //
    // Proses yang mati setelah percobaan terakhir meninggalkan lease yang
    // kedaluwarsa. Tanpa pernyataan pemulihan di awal claim(), baris itu
    // akan diklaim ulang selamanya oleh cabang lease.
    await client.query(
      `UPDATE ${OUTBOX} SET status='sending',attempts=6,lease_until=now()-interval '5 minutes',error_code=NULL
        WHERE id=$1::uuid`,
      [id],
    )
    await deliverOne(client, stubMailer('ok'))
    state = await row(client, OUTBOX, id)
    check("'sending' basi dengan 6 percobaan -> delivery_interrupted",
      state.status === 'failed' && state.error_code === 'delivery_interrupted',
      JSON.stringify(state))

    // ---- 7. Intake: password sementara memblokir, berbeda dari disposisi ----
    const { rows: intakeRows } = await client.query(
      `INSERT INTO ${INTAKE}(distribution_id,recipient_user) VALUES($1,$2) RETURNING id::text AS id`,
      [distributionId, assignee],
    )
    const intakeId = intakeRows[0].id
    await client.query('UPDATE sdl_users SET must_change_password=TRUE WHERE id=$1', [assignee])
    await deliverIntakeOne(client, stubMailer('ok'))
    state = await row(client, INTAKE, intakeId)
    check('intake + must_change_password -> gagal permanen',
      state.status === 'failed' && state.error_code === 'recipient_unavailable',
      JSON.stringify(state))

    // ---- 8. Intake: jalur sukses ----
    await client.query('UPDATE sdl_users SET must_change_password=FALSE WHERE id=$1', [assignee])
    await client.query(
      `UPDATE ${INTAKE} SET status='queued',attempts=0,error_code=NULL,available_at=now() WHERE id=$1::uuid`,
      [intakeId],
    )
    const intakeSender = stubMailer('ok')
    await deliverIntakeOne(client, intakeSender)
    state = await row(client, INTAKE, intakeId)
    check('intake siap -> sent dengan subjek surat masuk',
      state.status === 'sent' && state.attempts === 1 &&
      intakeSender.sent.length === 1 &&
      intakeSender.sent[0].subject === 'Surat Masuk Baru - SIERA DELTA LIMA',
      JSON.stringify({ state, sent: intakeSender.sent }))
  } finally {
    await client.query('ROLLBACK')
    client.release()
    await pool.end()
  }

  process.stdout.write(`\n${'='.repeat(60)}\n`)
  if (failures === 0) {
    process.stdout.write('WORKER EMAIL LULUS — seluruh transisi outbox sesuai perilaku Go.\n')
    process.exit(0)
  }
  process.stdout.write(`WORKER EMAIL GAGAL — ${failures} pemeriksaan tidak sesuai.\n`)
  process.exit(1)
}

await main()
