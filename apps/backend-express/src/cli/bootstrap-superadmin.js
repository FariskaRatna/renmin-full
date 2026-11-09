import { hashPassword } from '../crypto/password.js'

/**
 * Bootstrap Superadmin pertama, port dari `internal/auth/bootstrap.go`.
 *
 * Empat nilai dibaca dari STDIN, dipisah baris baru:
 *
 *   username \n email \n display name \n password
 *
 * **Tidak pernah dari argv dan tidak pernah dari environment.** Argumen CLI
 * terlihat di `ps` bagi setiap pengguna di mesin itu dan tersimpan di riwayat
 * shell; environment bocor ke setiap proses anak dan ke `docker inspect`.
 * Inilah akun yang mengendalikan seluruh akun lain — batasannya disengaja,
 * jangan dilonggarkan demi kenyamanan skrip.
 */

const VALID_USERNAME = /^[a-z][a-z0-9._-]{2,63}$/

/**
 * Padanan `mail.ParseAddress` Go yang DIIKUTI pemeriksaan
 * `address.Address != email`. Gabungan keduanya menolak bentuk yang sah
 * menurut RFC tapi tidak kita inginkan — `"Nama" <a@b.c>` ter-parse dengan
 * baik tetapi alamat hasilnya berbeda dari masukannya, jadi ditolak.
 * Yang lolos hanya alamat telanjang.
 */
function plainAddress(value) {
  if (value.length < 3 || value.length > 254) return false
  if (/[\s<>",;()[\]\\]/.test(value)) return false
  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return false
  const domain = value.slice(at + 1)
  // Go menuntut domain yang sah; titik tunggal di ujung atau label kosong
  // ditolak oleh parser-nya.
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return false
  if (domain.includes('..')) return false
  return true
}

/** Membaca seluruh stdin, dibatasi 4096 byte seperti `io.LimitReader` di Go. */
async function readLimited(source, limit = 4096) {
  const chunks = []
  let total = 0
  for await (const chunk of source) {
    chunks.push(chunk)
    total += chunk.length
    if (total >= limit) break
  }
  return Buffer.concat(chunks).subarray(0, limit).toString('utf8')
}

/**
 * @param {import('pg').Pool} pool
 * @param {NodeJS.ReadableStream} source  biasanya process.stdin
 */
export async function bootstrapSuperadmin(pool, source) {
  const raw = await readLimited(source)

  // Go membaca EMPAT baris dengan ReadString('\n'). Tiga yang pertama
  // di-TrimSpace; yang keempat — password — TIDAK, kecuali CR/LF di ujungnya.
  // Spasi di awal atau akhir password adalah bagian dari password.
  const parts = raw.split('\n')
  if (parts.length < 4) throw new Error('missing bootstrap input')
  const [username, email, name] = parts.slice(0, 3).map((s) => s.replace(/\r$/, '').trim())
  const password = parts.slice(3).join('\n').replace(/\n$/, '').replace(/\r$/, '')

  if (
    !VALID_USERNAME.test(username) ||
    !plainAddress(email) ||
    name.length < 3 ||
    name.length > 160 ||
    /[\r\n]/.test(name)
  ) {
    throw new Error('invalid bootstrap identity')
  }

  // Kebijakan panjang 14–256 byte ditegakkan hashPassword(), sama seperti di Go.
  const hash = await hashPassword(password)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Lock terpisah dari lock migrasi (20261017). Dua bootstrap yang berjalan
    // bersamaan tidak boleh sama-sama melihat tabel kosong.
    await client.query('SELECT pg_advisory_xact_lock(20261018)')

    const { rows } = await client.query('SELECT EXISTS(SELECT 1 FROM sdl_users) AS present')
    // Bukan "belum ada superadmin", melainkan "tabel user BENAR-BENAR kosong".
    // Lebih ketat, dan disengaja: bootstrap hanya untuk instalasi baru, bukan
    // jalan belakang menambah Superadmin di sistem yang sudah berjalan.
    if (rows[0].present) throw new Error('bootstrap denied: user table is not empty')

    const inserted = await client.query(
      `INSERT INTO sdl_users(username,email,display_name,password_hash,is_active,otp_required)
       VALUES($1,$2,$3,$4,TRUE,TRUE) RETURNING id::text AS id`,
      [username, email, name, hash],
    )
    const userId = inserted.rows[0].id

    await client.query(`INSERT INTO sdl_user_roles(user_id,role_key) VALUES($1,'superadmin')`, [userId])
    await client.query(
      `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id)
       VALUES($1,'identity.superadmin.bootstrapped','user',$2)`,
      [userId, userId],
    )
    await client.query('COMMIT')
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // Rollback yang gagal tidak boleh menutupi error aslinya.
    }
    throw error
  } finally {
    client.release()
  }

  process.stdout.write('STATUS: Superadmin created. OTP email is mandatory; configure SMTP before login.\n')
}
