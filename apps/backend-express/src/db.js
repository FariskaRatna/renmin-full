import pg from 'pg'

/**
 * Pool Postgres, parameter mengikuti cmd/api/main.go:50-52.
 *
 * SQL ditulis mentah, tanpa ORM. Query Go penuh FOR UPDATE, FOR SHARE,
 * ON CONFLICT, array Postgres, dan subquery EXISTS berlapis — menerjemahkannya
 * ke ORM adalah penulisan ulang kedua di dalam yang pertama. Placeholder $1
 * sudah sama antara pgx dan node-postgres, jadi query bisa disalin hampir
 * verbatim.
 */
export function createPool(databaseUrl) {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 8, // cfg.MaxConns
    idleTimeoutMillis: 5 * 60 * 1000, // cfg.MaxConnIdleTime
    connectionTimeoutMillis: 5000,
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
