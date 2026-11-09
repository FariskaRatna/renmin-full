import { deliverIntakeOne } from './intake.js'

/**
 * Pengiriman notifikasi email URMIN dari outbox transaksional.
 * Port dari internal/notifications/urmin.go.
 *
 * Tiga sifat yang menentukan bentuk berkas ini, dan ketiganya disengaja:
 *
 * 1. **Pengiriman adalah upaya terbaik dan TIDAK PERNAH memberi akses.** Email
 *    hanya memberi tahu bahwa ada pekerjaan; isinya konstan, dan dokumennya
 *    tetap hanya bisa dibuka setelah login sesuai kewenangan.
 * 2. **Tidak ada alamat, subjek tugas, maupun isi pesan yang boleh masuk log.**
 *    Kegagalan dicatat sebagai satu kategori generik. Itu sebabnya log di bawah
 *    tidak membawa satu pun field dinamis.
 * 3. **Klaim berbasis lease, bukan penguncian panjang.** Beberapa replika API
 *    boleh hidup bersamaan: `FOR UPDATE ... SKIP LOCKED` memilih baris berbeda,
 *    dan `lease_until` memulihkan baris yang prosesnya mati di tengah jalan.
 *
 * ATURAN 7 MIGRASI: hanya SATU worker email yang boleh aktif. Selama transisi
 * backend Go dan Express hidup berdampingan di database yang sama, dan kalau
 * keduanya menguras outbox, pengguna nyata menerima email dua kali. Penjagaan
 * itu ada di `startEmailWorker`, bukan di sini.
 */

const TICK_MS = 10_000
const MAX_ATTEMPTS = 6

/** Jeda percobaan ulang dalam menit, diindeks oleh attempts-1 (attempts 1..6). */
const BACKOFF_MINUTES = [1, 2, 5, 10, 20, 30]

/**
 * Padanan message (urmin.go:74). Subjek dan badan pesan SELALU konstan —
 * tidak ada satu pun nilai dari database yang masuk ke sini.
 */
export function message(event) {
  switch (event) {
    case 'assigned':
      return ['Tugas Baru - SIERA DELTA LIMA', 'Anda menerima penugasan disposisi baru.']
    case 'forwarded':
      return ['Tugas Diteruskan - SIERA DELTA LIMA', 'Ada penugasan disposisi yang diteruskan kepada Anda.']
    case 'completed':
      return ['Tugas Selesai - SIERA DELTA LIMA', 'Hasil pekerjaan telah disampaikan dan menunggu pemeriksaan Anda.']
    case 'review_approved':
      return ['Hasil Disetujui - SIERA DELTA LIMA', 'Hasil pekerjaan Anda telah disetujui.']
    case 'review_revision':
      return ['Perlu Perbaikan - SIERA DELTA LIMA', 'Hasil pekerjaan Anda memerlukan tindak lanjut. Periksa catatan pemeriksaan di aplikasi.']
    default:
      return undefined
  }
}

/**
 * Padanan validasi alamat di deliverOne (urmin.go:102).
 *
 * Go memakai `mail.ParseAddress` lalu menuntut `addr.Address == destination`,
 * yang efektif berarti: alamat telanjang, tanpa nama tampilan dan tanpa kurung
 * sudut. Pola di bawah menegakkan hal yang sama.
 *
 * Akhiran `.invalid` ditolak permanen. Itu bukan kehati-hatian berlebihan —
 * ke-13 akun hasil `seed-bagrenmin` beralamat `<username>@siera.invalid`,
 * jadi tanpa pemeriksaan ini setiap deployment uji akan mencoba mengirim ke
 * domain yang dijamin tidak ada, enam kali, per notifikasi.
 */
const BARE_ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/

export function deliverable(address, extraControlChars = '') {
  if (typeof address !== 'string' || !BARE_ADDRESS.test(address)) return false
  if (/[\r\n]/.test(address)) return false
  if (extraControlChars.includes('\0') && address.includes('\0')) return false
  return !address.toLowerCase().endsWith('.invalid')
}

/**
 * Padanan claim (urmin.go:50). Dua pernyataan, dan yang pertama mudah
 * dikira hiasan: ia memulihkan baris yang tersangkut di status `sending`
 * karena prosesnya mati setelah percobaan terakhir. Tanpa itu baris tersebut
 * akan dicoba selamanya oleh klausa lease yang kedaluwarsa.
 */
async function claim(pool) {
  await pool.query(
    `UPDATE sdl_urmin_email_outbox
        SET status='failed',lease_until=NULL,error_code='delivery_interrupted'
      WHERE status='sending' AND attempts>=6 AND lease_until<now()`,
  )

  const { rows } = await pool.query(
    `WITH candidate AS (
       SELECT n.id FROM sdl_urmin_email_outbox n
       JOIN sdl_urmin_disposition_tasks t ON t.id=n.task_id
       WHERE t.unit_key='urmin' AND n.attempts<6 AND
        ((n.status='queued' AND n.available_at<=now()) OR (n.status='sending' AND n.lease_until<now()))
       ORDER BY n.created_at,n.id FOR UPDATE OF n SKIP LOCKED LIMIT 1
     ) UPDATE sdl_urmin_email_outbox n SET status='sending',attempts=attempts+1,
       lease_until=now()+interval '90 seconds',error_code=NULL
       FROM candidate c WHERE n.id=c.id
       RETURNING n.id::text AS id,n.recipient_user::text AS recipient_user,n.event_key,n.attempts`,
  )
  if (rows.length === 0) return undefined
  const row = rows[0]
  return { id: row.id, recipientId: row.recipient_user, event: row.event_key, attempts: Number(row.attempts) }
}

/**
 * Padanan retry (urmin.go:121). `attempts` di sini sudah nilai SESUDAH
 * dinaikkan klaim, jadi rentangnya 1..6 dan indeks backoff-nya attempts-1.
 */
export async function retry(pool, table, job, code, permanent) {
  if (permanent || job.attempts >= MAX_ATTEMPTS) {
    await pool.query(
      `UPDATE ${table} SET status='failed',lease_until=NULL,error_code=$2 WHERE id=$1::uuid`,
      [job.id, code],
    )
    return
  }
  await pool.query(
    `UPDATE ${table} SET status='queued',lease_until=NULL,
        available_at=now()+($2::int * interval '1 minute'),error_code=$3 WHERE id=$1::uuid`,
    [job.id, BACKOFF_MINUTES[job.attempts - 1], code],
  )
}

/** Padanan deliverOne (urmin.go:91). */
export async function deliverOne(pool, mailer) {
  const job = await claim(pool)
  if (!job) return

  let destination
  let active
  try {
    const { rows } = await pool.query('SELECT email,is_active FROM sdl_users WHERE id=$1', [job.recipientId])
    if (rows.length === 0) throw new Error('no_rows')
    destination = rows[0].email
    active = rows[0].is_active === true
  } catch {
    await retry(pool, 'sdl_urmin_email_outbox', job, 'lookup_failed', false)
    return
  }

  // Penerima nonaktif atau beralamat tidak terkirim adalah kegagalan PERMANEN:
  // mencoba ulang enam kali tidak akan mengubah apa pun.
  if (!active || !deliverable(destination)) {
    await retry(pool, 'sdl_urmin_email_outbox', job, 'recipient_unavailable', true)
    return
  }

  const content = message(job.event)
  if (!content) {
    await retry(pool, 'sdl_urmin_email_outbox', job, 'event_invalid', true)
    return
  }

  try {
    await mailer.sendNotification(destination, content[0], content[1])
  } catch {
    await retry(pool, 'sdl_urmin_email_outbox', job, 'smtp_delivery_failed', false)
    return
  }

  // `AND status='sending'` menjaga agar worker lain yang sudah mengambil alih
  // lease yang kedaluwarsa tidak tertimpa hasil kita.
  await pool.query(
    `UPDATE sdl_urmin_email_outbox SET status='sent',sent_at=now(),lease_until=NULL,error_code=NULL
      WHERE id=$1::uuid AND status='sending'`,
    [job.id],
  )
}

/**
 * Padanan Run (urmin.go:25), ditambah penjaga aturan 7.
 *
 * Go menyalakan worker-nya kapan pun SMTP siap dan
 * `SDL_EMAIL_NOTIFICATIONS_ENABLED` bukan "false". Express TIDAK boleh
 * mengikuti pola itu selama transisi: dua backend hidup di satu database, dan
 * dua worker berarti email ganda ke pengguna nyata. Karena itu di sini
 * defaultnya MATI dan menyalakannya butuh `SDL_EMAIL_WORKER_ENABLED=true`
 * secara eksplisit.
 *
 * Peralihannya dengan sengaja dibuat bersisi dua: matikan di Go
 * (`SDL_EMAIL_NOTIFICATIONS_ENABLED=false`), lalu nyalakan di Express. Tidak
 * ada urutan yang membuat keduanya aktif sekaligus tanpa disadari.
 *
 * Mengembalikan fungsi penghenti; `undefined` kalau worker tidak dinyalakan.
 */
export function startEmailWorker({ pool, config, mailer, log }) {
  if (!config.emailNotificationsEnabled) {
    log('INFO', 'urmin email notification worker inactive', { reason: 'notifications_disabled' })
    return undefined
  }
  if (!config.emailWorkerEnabled) {
    log('INFO', 'urmin email notification worker inactive', { reason: 'worker_owned_by_go_backend' })
    return undefined
  }
  if (!mailer.ready()) {
    log('INFO', 'urmin email notification worker inactive', { reason: 'smtp_not_configured' })
    return undefined
  }

  log('INFO', 'urmin email notification worker enabled')
  let timer
  let stopped = false

  const cycle = async () => {
    const started = Date.now()
    try {
      await deliverOne(pool, mailer)
    } catch {
      // Kategori generik saja. Jangan pernah mencatat penerima, rahasia SMTP,
      // judul tugas, maupun isi email.
      log('WARN', 'urmin email notification worker attempt failed', { kind: 'delivery_or_database' })
    }
    try {
      await deliverIntakeOne(pool, mailer)
    } catch {
      log('WARN', 'urmin intake email worker attempt failed', { kind: 'delivery_or_database' })
    }
    if (stopped) return
    // Sisa jeda dihitung dari waktu MULAI, meniru time.Ticker: satu siklus yang
    // lambat tidak menggeser irama, ia hanya memakan jedanya sendiri.
    const remaining = Math.max(0, TICK_MS - (Date.now() - started))
    timer = setTimeout(cycle, remaining)
    timer.unref()
  }

  void cycle()

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
}
