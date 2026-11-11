import { Router } from 'express'

/**
 * R5H8: sepuluh pilihan dropdown umum (migrasi 047, tabel sdl_opsi_dropdown).
 * EXPRESS SAJA -- Go tidak mengenal tabel ini. Kalau prefix dikembalikan ke Go,
 * frontend jatuh ke daftar bawaannya sendiri (OpsiDropdownR5H8.ts).
 *
 * Satu sumber untuk Master Data Superadmin (didaftarkan ke SETS di
 * master-data.js) dan daftar baca operasional per unit:
 *
 *   GET /api/v1/urmin/opsi-dropdown/
 *   GET /api/v1/subbagsumda/opsi-dropdown/
 *   GET /api/v1/subbagbinfung/opsi-dropdown/
 *
 * `registry`/`kind`/`field` menunjuk tempat NAMA pilihan tersimpan, dipakai
 * untuk menolak penghapusan pilihan yang masih dipakai data.
 * Semua nilai di larik ini konstanta, tidak pernah berasal dari request.
 */
export const OPSI_DROPDOWN = [
  { set: 'arsip-jenis', unit: 'urmin', registry: 'sdl_urmin_registry', kind: 'arsip', field: 'jenisArsip' },
  { set: 'arsip-status', unit: 'urmin', registry: 'sdl_urmin_registry', kind: 'arsip', field: 'statusArsip' },
  // Migrasi 048. Pilih-banyak: tersimpan sebagai nama-nama digabung ", ".
  { set: 'agenda-hadir', unit: 'urmin', registry: 'sdl_urmin_registry', kind: 'agenda', field: 'yangMenghadiri', multi: true },
  { set: 'personel-status', unit: 'subbagsumda', registry: 'sdl_sumda_registry', kind: 'personel', field: 'status' },
  { set: 'kondisi-barang', unit: 'subbagsumda', registry: 'sdl_sumda_registry', kind: 'inventaris', field: 'kondisi' },
  { set: 'sop-jenis', unit: 'subbagbinfung', registry: 'sdl_binfung_registry', kind: 'sop', field: 'jenis' },
  { set: 'sop-status', unit: 'subbagbinfung', registry: 'sdl_binfung_registry', kind: 'sop', field: 'statusDokumen' },
  { set: 'pid-kategori', unit: 'subbagbinfung', registry: 'sdl_binfung_registry', kind: 'pid', field: 'kategori' },
  { set: 'pid-tingkat-akses', unit: 'subbagbinfung', registry: 'sdl_binfung_registry', kind: 'pid', field: 'tingkatAkses' },
  { set: 'pid-status', unit: 'subbagbinfung', registry: 'sdl_binfung_registry', kind: 'pid', field: 'statusDokumen' },
  { set: 'rb-status', unit: 'subbagbinfung', registry: 'sdl_binfung_registry', kind: 'rb', field: 'statusTindakLanjut' },
]

/** EXISTS satu parameter ($1 = kode): data yang masih memakai NAMA pilihan itu. */
export function opsiDropdownInUse(o) {
  const match = o.multi
    ? `x.name=ANY(string_to_array(r.fields->>'${o.field}', ', '))`
    : `r.fields->>'${o.field}'=x.name`
  return `SELECT EXISTS(SELECT 1 FROM ${o.registry} r JOIN sdl_opsi_dropdown x ON x.set_key='${o.set}' AND x.code=$1
	 WHERE r.deleted_at IS NULL AND r.kind='${o.kind}' AND ${match})`
}

export function createOpsiDropdownRouter({ pool, unit }) {
  const sets = OPSI_DROPDOWN.filter((o) => o.unit === unit).map((o) => o.set)
  const router = Router()
  router.get('/', async (req, res, next) => {
    try {
      let rows
      try {
        rows = (await pool.query(
          'SELECT set_key,code,name FROM sdl_opsi_dropdown WHERE set_key=ANY($1) ORDER BY set_key,seq',
          [sets],
        )).rows
      } catch {
        res.set('Cache-Control', 'no-store')
        res.status(503).json({ error: 'database_unavailable' })
        return
      }
      const out = Object.fromEntries(sets.map((s) => [s, []]))
      for (const r of rows) out[r.set_key].push({ code: r.code, name: r.name })
      res.set('Cache-Control', 'no-store')
      res.status(200).json(out)
    } catch (error) {
      next(error)
    }
  })
  return router
}
