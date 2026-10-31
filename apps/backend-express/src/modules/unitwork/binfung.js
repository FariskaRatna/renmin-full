import { createRegistryCrudRouter } from './registry-crud.js'
import { isPlainDigits } from './shared.js'

/**
 * Registry Subbagbinfung, port dari apps/backend/internal/unitwork/binfung.go.
 * Berbagi implementasi CRUD dengan Subbagsumda.
 */
const FIELDS_BY_KIND = Object.freeze({
  sop: ['jenis', 'versi', 'pemilikProses', 'tanggalBerlaku', 'statusDokumen', 'keterangan'],
  pid: ['kategori', 'tingkatAkses', 'tanggalDokumen', 'sumber', 'statusDokumen', 'keterangan'],
  rb: ['areaPerubahan', 'periode', 'target', 'capaian', 'pic', 'statusTindakLanjut'],
  abk: ['unit', 'periode', 'volume', 'kebutuhan', 'pelaksana', 'catatan'],
  pembinaan: ['jenisKegiatan', 'tanggal', 'lokasi', 'penanggungJawab', 'peserta', 'hasil'],
  evaluasi: ['jenis', 'tanggal', 'tenggat', 'pic', 'hasil', 'tindakLanjut'],
})

export function createBinfungRouter({ pool }) {
  return createRegistryCrudRouter({
    pool,
    spec: {
      unit: 'subbagbinfung',
      table: 'sdl_binfung_registry',
      fieldsByKind: FIELDS_BY_KIND,
      dateFields: new Set(['tanggalBerlaku', 'tanggalDokumen', 'tanggal', 'tenggat']),
      numericFields: new Set(['volume', 'kebutuhan']),
      // Berbeda dari sumda: binfung menerima digit pertama 0-9.
      isValidNumber: (value) => isPlainDigits(value),
      invalidRecordCode: 'invalid_binfung_record',
      noteLabel: 'Master Subbagbinfung',
    },
  })
}
