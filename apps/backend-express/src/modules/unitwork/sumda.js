import { createRegistryCrudRouter } from './registry-crud.js'
import { isPlainDigits } from './shared.js'

/**
 * Registry Subbagsumda, port dari apps/backend/internal/unitwork/sumda.go.
 * Berbagi implementasi CRUD dengan Subbagbinfung; yang berbeda dideklarasikan
 * di bawah sebagai data.
 */
const FIELDS_BY_KIND = Object.freeze({
  personel: ['pangkat', 'jabatan', 'status', 'unitKerja', 'keterangan'],
  pendidikan: ['jenis', 'penyelenggara', 'tanggalMulai', 'tanggalSelesai', 'peserta', 'hasil'],
  inventaris: ['kategori', 'kondisi', 'lokasi', 'jumlah', 'penanggungJawab', 'keterangan'],
})

/** Daftar pangkat Polri selalu dilayani dari PostgreSQL, tidak pernah di-hardcode. */
function registerRanksRoute(router, { pool, handle, respond, sqlError }) {
  router.get('/ranks', handle(async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT code,short_name,full_name,rank_group FROM sdl_polri_rank_master
          WHERE is_active=TRUE ORDER BY sort_order`,
      )
      respond(res, 200, {
        items: rows.map((row) => ({
          code: row.code,
          shortName: row.short_name,
          fullName: row.full_name,
          group: row.rank_group,
        })),
      })
    } catch (error) {
      sqlError(res, error)
    }
  }))
}

/** Pangkat yang diisi harus ada di master dan masih aktif. */
async function validateRank(pool, input) {
  if (input.kind !== 'personel') return undefined
  const pangkat = String(input.fields?.pangkat ?? '').trim()
  if (pangkat === '') return undefined

  const { rows } = await pool.query(
    'SELECT EXISTS(SELECT 1 FROM sdl_polri_rank_master WHERE code=$1 AND is_active=TRUE) AS ok',
    [input.fields.pangkat],
  )
  return rows[0].ok ? undefined : 'invalid_polri_rank'
}

export function createSumdaRouter({ pool }) {
  return createRegistryCrudRouter({
    pool,
    spec: {
      unit: 'subbagsumda',
      table: 'sdl_sumda_registry',
      fieldsByKind: FIELDS_BY_KIND,
      dateFields: new Set(['tanggalMulai', 'tanggalSelesai']),
      numericFields: new Set(['jumlah']),
      // "jumlah" tidak boleh berawalan nol — Go memeriksa digit pertama 1-9.
      isValidNumber: (value) => isPlainDigits(value) && value[0] >= '1' && value[0] <= '9',
      invalidRecordCode: 'invalid_sumda_record',
      noteLabel: 'Master Subbagsumda',
      // Pendidikan: tanggal selesai tidak boleh mendahului tanggal mulai.
      extraValidation: (fields, kind) => {
        if (kind !== 'pendidikan') return true
        const start = fields.tanggalMulai ?? ''
        const end = fields.tanggalSelesai ?? ''
        if (start === '' || end === '') return true
        return end >= start
      },
      extraCheck: validateRank,
      extraRoutes: registerRanksRoute,
    },
  })
}
