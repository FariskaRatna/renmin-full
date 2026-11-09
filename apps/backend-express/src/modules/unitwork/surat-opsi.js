import { Router } from 'express'

/**
 * R5H3: enam daftar pilihan dropdown formulir Surat Keluar (migrasi 042).
 * Padanan apps/backend/internal/unitwork/surat_opsi.go.
 *
 * Satu sumber untuk Master Data Superadmin (didaftarkan ke SETS di
 * master-data.js) dan daftar baca operasional GET /api/v1/urmin/surat-opsi/.
 * Urutan larik ini = urutan kunci di respons, sama dengan struct Go.
 */
export const SURAT_OPSI = [
  { set: 'jalur-surat', field: 'jalurSurat', table: 'sdl_surat_jalur', multi: false },
  { set: 'penandatangan', field: 'penandatangan', table: 'sdl_surat_penandatangan', multi: false },
  { set: 'pemberi-nomor', field: 'pemberiNomor', table: 'sdl_surat_pemberi_nomor', multi: false },
  { set: 'verifikator', field: 'verifikator', table: 'sdl_surat_verifikator', multi: true },
  { set: 'tembusan', field: 'tembusan', table: 'sdl_surat_tembusan', multi: true },
  { set: 'tipe-surat', field: 'tipeSurat', table: 'sdl_surat_tipe', multi: false },
]

/** Padanan suratOpsiInUse: surat menyimpan NAMA pilihan, bukan kodenya. */
export function suratOpsiInUse(o) {
  const match = o.multi
    ? `x.name=ANY(string_to_array(r.fields->>'${o.field}', ', '))`
    : `r.fields->>'${o.field}'=x.name`
  return `SELECT EXISTS(SELECT 1 FROM sdl_urmin_registry r JOIN ${o.table} x ON x.code=$1
	 WHERE r.deleted_at IS NULL AND r.kind='surat_keluar' AND ${match})`
}

export function createSuratOpsiRouter({ pool }) {
  const router = Router()

  router.get('/', async (req, res, next) => {
    try {
      const out = {}
      for (const o of SURAT_OPSI) {
        let rows
        try {
          rows = (await pool.query(`SELECT code,name FROM ${o.table} ORDER BY name`)).rows
        } catch {
          res.set('Cache-Control', 'no-store')
          res.status(503).json({ error: 'database_unavailable' })
          return
        }
        out[o.field] = rows.map((r) => ({ code: r.code, name: r.name }))
      }
      res.set('Cache-Control', 'no-store')
      res.status(200).json(out)
    } catch (error) {
      next(error)
    }
  })

  return router
}
