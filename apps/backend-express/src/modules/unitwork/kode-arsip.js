import { Router } from 'express'

/**
 * Pencarian master kode klasifikasi arsip, port dari
 * apps/backend/internal/unitwork/kode_arsip.go.
 *
 * Dipakai pada segmen keempat nomor surat dinas:
 *
 *   B/ND-157/X/HUM.1.2./2026/Bagrenmin
 *              ^^^^^^^^
 *
 * Arah pencariannya NAMA -> KODE, bukan sebaliknya: petugas mengetik "buku
 * tamu" dan sistem menjawab HUM.1.2.. Kodenya tetap bisa dicari langsung untuk
 * yang sudah hafal, tapi itu bonus, bukan alur utamanya.
 *
 * Tabelnya data referensi murni — tanpa kepemilikan, klasifikasi akses, atau
 * jejak audit. Karena itu endpoint ini hanya berada di balik guard operasional
 * dan tidak memanggil permit(): tidak ada yang bisa dilanggar, dan setiap akun
 * yang boleh menyusun surat memang perlu membacanya.
 */

const PREFIX_RE = /^[A-Z]{2,5}$/
const LIMIT = 50

export function createKodeArsipRouter({ pool }) {
  const router = Router()

  router.get('/', async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim()
      if ([...q].length > 100) {
        res.set('Cache-Control', 'no-store')
        res.status(400).json({ error: 'invalid_search' })
        return
      }
      const prefix = String(req.query.prefix ?? '').trim().toUpperCase()
      if (prefix !== '' && !PREFIX_RE.test(prefix)) {
        res.set('Cache-Control', 'no-store')
        res.status(400).json({ error: 'invalid_prefix' })
        return
      }

      let rows
      try {
        // Dibatasi 50 dan diurut kode supaya hasilnya tetap bisa ditebak.
        // Pencarian kosong mengembalikan 50 pertama, bukan seluruh 701 baris:
        // daftar sepanjang itu tidak menolong siapa pun di kotak pencarian.
        //
        // LIMIT 51 = LIMIT + 1, satu baris lebih untuk mendeteksi sisa.
        const result = await pool.query(
          `SELECT code,name,depth FROM sdl_surat_kode_arsip
            WHERE ($1='' OR name ILIKE '%'||$1||'%' OR code ILIKE '%'||$1||'%')
              AND ($2='' OR prefix=$2)
            ORDER BY code LIMIT 51`,
          [q, prefix],
        )
        rows = result.rows
      } catch {
        res.set('Cache-Control', 'no-store')
        res.status(503).json({ error: 'database_unavailable' })
        return
      }

      // Satu baris lebih diambil hanya untuk tahu apakah masih ada sisanya; ia
      // tidak ikut dikirim.
      const limited = rows.length > LIMIT
      const items = (limited ? rows.slice(0, LIMIT) : rows)
        .map((row) => ({ code: row.code, name: row.name, depth: row.depth }))
      res.set('Cache-Control', 'no-store')
      res.status(200).json({ items, limited })
    } catch (error) {
      next(error)
    }
  })

  return router
}

/**
 * R5G12: daftar jenis surat untuk formulir surat keluar. Guard operasional,
 * alasannya sama dengan kode arsip — data referensi yang sama untuk semua unit.
 *
 * Tanpa pencarian dan tanpa batas: daftarnya pendek (satu baris per
 * 2026-11-03) dan memang dimaksudkan tampil seluruhnya sebagai dropdown.
 */
export function createJenisSuratRouter({ pool }) {
  const router = Router()

  router.get('/', async (req, res, next) => {
    try {
      let rows
      try {
        const result = await pool.query('SELECT code,name FROM sdl_surat_jenis ORDER BY code')
        rows = result.rows
      } catch {
        res.set('Cache-Control', 'no-store')
        res.status(503).json({ error: 'database_unavailable' })
        return
      }
      res.set('Cache-Control', 'no-store')
      res.status(200).json({ items: rows.map((r) => ({ code: r.code, name: r.name })) })
    } catch (error) {
      next(error)
    }
  })

  return router
}
