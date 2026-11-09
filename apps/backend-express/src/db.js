import pg from 'pg'

import { goTimestamp } from './time.js'

/**
 * Pool Postgres, parameter mengikuti cmd/api/main.go:50-52.
 *
 * SQL ditulis mentah, tanpa ORM. Query Go penuh FOR UPDATE, FOR SHARE,
 * ON CONFLICT, array Postgres, dan subquery EXISTS berlapis — menerjemahkannya
 * ke ORM adalah penulisan ulang kedua di dalam yang pertama. Placeholder $1
 * sudah sama antara pgx dan node-postgres, jadi query bisa disalin hampir
 * verbatim.
 */
const OID_TIMESTAMP = 1114
const OID_TIMESTAMPTZ = 1184

/**
 * Timestamp diserahkan sebagai STRING ber-format Go, bukan sebagai `Date`.
 * Ini perbaikan D4; aturannya sendiri ada di `src/time.js` supaya hanya ditulis
 * satu kali. Dipasang sebagai type parser, BUKAN dipanggil per-field: satu
 * kolom yang terlewat sudah cukup untuk mengembalikan D4, dan harness tidak
 * akan mengeluh karena ia menormalkan setiap timestamp lebih dulu.
 * Dibuktikan lewat `verify/timestamp-parity.js` yang membanding byte mentah.
 */
pg.types.setTypeParser(OID_TIMESTAMPTZ, goTimestamp)
pg.types.setTypeParser(OID_TIMESTAMP, goTimestamp)

export function createPool(databaseUrl) {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 8, // cfg.MaxConns
    idleTimeoutMillis: 5 * 60 * 1000, // cfg.MaxConnIdleTime
    connectionTimeoutMillis: 5000,
    // Zona sesi dipaksa UTC supaya keluaran teks timestamptz selalu berakhiran
    // `+00`, yang dibutuhkan jalur cepat goTimestamp(). pgx tidak terpengaruh
    // ini — ia memakai protokol biner dan selalu menghasilkan UTC — jadi
    // memaksanya di sini justru menyamakan keduanya.
    //
    // Dikirim sebagai PARAMETER STARTUP, bukan lewat hook `pool.on('connect')`
    // yang menjalankan `SET TIME ZONE`. Hook itu tidak di-await oleh `pg`:
    // query pertama bisa berangkat sebelum SET-nya selesai, dan koneksi itu
    // lalu melayani permintaan dengan zona waktu server. Balapan yang jarang,
    // senyap, dan tepat mengenai D4. Parameter startup diterapkan server
    // sebelum koneksi dinyatakan siap, jadi tidak ada celahnya.
    options: '-c timezone=UTC',
  })
}

/**
 * Menjalankan fn di dalam transaksi. Rollback otomatis saat fn melempar,
 * padanan `defer tx.Rollback(ctx)` di Go.
 */
export async function withTransaction(pool, fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
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
}

/** true kalau error Postgres adalah pelanggaran unique constraint. */
export function isUniqueViolation(error) {
  return error?.code === '23505'
}
