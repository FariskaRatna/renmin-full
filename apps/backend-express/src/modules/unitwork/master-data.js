import { Router } from 'express'

import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { SURAT_OPSI, suratOpsiInUse } from './surat-opsi.js'

/**
 * Pengelolaan master data persuratan oleh Superadmin, port dari
 * apps/backend/internal/unitwork/master_data.go.
 *
 * Himpunan yang dikelola (R5H2 menambah yang ketiga, disposisi):
 *
 *   jenis-surat  -> sdl_surat_jenis       (ND = Nota Dinas, dst.)
 *   kode-arsip   -> sdl_surat_kode_arsip  (HUM.1.2. = BUKU TAMU, dst.)
 *   disposisi    -> sdl_disposisi_opsi    (MONITOR = Monitor, dst.)
 *
 * Derajat dan klasifikasi TIDAK ada di sini, atas keputusan pemilik sistem dan
 * dengan alasan berbeda untuk masing-masing. Derajat terikat CHECK constraint
 * di `sdl_urmin_incoming` (migrasi 034), sehingga "bisa dikelola" hanya akan
 * jadi ilusi: menambah nilai ketiga tetap menuntut migrasi. Klasifikasi lebih
 * serius — ia yang dibaca permit() untuk memutuskan siapa boleh membuka
 * dokumen, jadi menjadikannya data yang bisa disunting berarti satu salah klik
 * di Settings menggeser hak akses di empat unit sekaligus.
 */

/**
 * Padanan registryUse (master_data.go): kode jenis surat dan kode arsip
 * tersimpan sebagai teks di JSONB surat.
 */
function registryUse(field) {
  return `SELECT EXISTS(SELECT 1 FROM sdl_urmin_registry WHERE deleted_at IS NULL AND fields->>'${field}'=$1)`
}

/**
 * inUseSQL: query EXISTS satu parameter ($1 = kode), padanan masterSet.inUseSQL
 * (R5H2 menggantikan usedAs). Nilainya konstanta di sini, tidak pernah berasal
 * dari request. Dibaca dengan rowMode 'array' karena kolomnya tidak beralias,
 * sama persis dengan Go.
 */
const SETS = {
  'jenis-surat': {
    table: 'sdl_surat_jenis',
    codeRe: /^[A-Z0-9][A-Z0-9/-]{0,11}$/,
    nameMax: 120,
    inUseSQL: registryUse('jenisSurat'),
  },
  'kode-arsip': {
    table: 'sdl_surat_kode_arsip',
    codeRe: /^[A-Z]{2,5}(\.[0-9]+)+\.$/,
    nameMax: 250,
    inUseSQL: registryUse('kodeArsip'),
  },
  // R5H2: pilihan centang "Disposisi Kabagrenmin" pada arahan (migrasi 041).
  // Kodenya tersimpan di larik `dispositions` dalam JSONB `sheet`. Hanya arahan
  // TERKIRIM yang menahan penghapusan: draf yang ditinggalkan tidak boleh
  // mengunci opsi selamanya (padanan master_data.go).
  disposisi: {
    table: 'sdl_disposisi_opsi',
    codeRe: /^[A-Z][A-Z0-9_]{1,23}$/,
    nameMax: 120,
    inUseSQL: `SELECT EXISTS(SELECT 1 FROM sdl_leadership_directives WHERE sheet->'dispositions' ? $1)`,
  },
}

// R5H3: enam pilihan dropdown Surat Keluar, padanan init() di surat_opsi.go.
// noComma: nama di daftar pilih-banyak tidak boleh memuat koma.
for (const o of SURAT_OPSI) {
  SETS[o.set] = { table: o.table, codeRe: /^[A-Z][A-Z0-9_]{1,23}$/, nameMax: 120, inUseSQL: suratOpsiInUse(o), noComma: o.multi }
}

/** Padanan kodeArsipParts (master_data.go). "HUM.1.2." -> ["HUM", 2] */
function kodeArsipParts(code) {
  const parts = code.replace(/\.$/, '').split('.')
  return [parts[0], parts.slice(1).filter(Boolean).length]
}

function deny(res, status, code) {
  res.set('Cache-Control', 'no-store')
  res.status(status).json({ error: code })
}

function pickSet(req, res) {
  const set = SETS[req.params.set]
  if (!set) {
    deny(res, 404, 'not_found')
    return undefined
  }
  return set
}

/**
 * Validasi payload {code,name}. Mengembalikan undefined kalau sudah menjawab.
 *
 * `code` dinormalkan ke huruf besar dan `name` dirapatkan spasinya sebelum
 * diperiksa, supaya "  Nota   Dinas " dan "Nota Dinas" tidak menjadi dua baris
 * yang berbeda.
 */
function readBody(req, res, set) {
  // parsePayload sekaligus menolak field asing, padanan DisallowUnknownFields
  // di Go. Tanpa itu, salah ketik nama field akan diam-diam diabaikan.
  const payload = parsePayload(req, ['code', 'name'])
  if (!payload.ok) {
    deny(res, 400, 'invalid_request')
    return undefined
  }
  const raw = payload.value
  const code = String(raw.code ?? '').trim().toUpperCase()
  const name = String(raw.name ?? '').split(/\s+/).filter(Boolean).join(' ')
  if (!set.codeRe.test(code)) {
    deny(res, 400, 'invalid_code')
    return undefined
  }
  const n = [...name].length
  if (n < 2 || n > set.nameMax || (set.noComma && name.includes(','))) {
    deny(res, 400, 'invalid_name')
    return undefined
  }
  return { code, name }
}

export function createMasterDataRouter({ pool }) {
  const router = Router()
  // 4096 B, batas yang sama dengan readPayload di Go (master_data.go).
  const json = rawBody(BODY_LIMITS.AUTH)

  const handle = (fn) => async (req, res, next) => {
    try { await fn(req, res) } catch (error) { next(error) }
  }

  router.get('/master/:set', handle(async (req, res) => {
    const set = pickSet(req, res)
    if (!set) return
    const q = String(req.query.q ?? '').trim()
    if ([...q].length > 100) {
      deny(res, 400, 'invalid_search')
      return
    }
    let rows
    try {
      const result = await pool.query(
        `SELECT code,name FROM ${set.table}
          WHERE ($1='' OR name ILIKE '%'||$1||'%' OR code ILIKE '%'||$1||'%')
          ORDER BY code LIMIT 201`,
        [q],
      )
      rows = result.rows
    } catch {
      deny(res, 503, 'database_unavailable')
      return
    }
    const limited = rows.length > 200
    const items = (limited ? rows.slice(0, 200) : rows).map((r) => ({ code: r.code, name: r.name }))
    res.set('Cache-Control', 'no-store')
    res.status(200).json({ items, limited })
  }))

  router.post('/master/:set', json, handle(async (req, res) => {
    const set = pickSet(req, res)
    if (!set) return
    const v = readBody(req, res, set)
    if (!v) return
    try {
      if (set.table === 'sdl_surat_kode_arsip') {
        // prefix dan depth diturunkan dari kodenya, bukan diminta ke pemanggil:
        // keduanya selalu bisa dihitung, dan memintanya hanya membuka peluang
        // mereka tidak cocok dengan kodenya.
        const [prefix, depth] = kodeArsipParts(v.code)
        await pool.query(
          'INSERT INTO sdl_surat_kode_arsip(code,name,prefix,depth) VALUES($1,$2,$3,$4)',
          [v.code, v.name, prefix, depth],
        )
      } else {
        await pool.query(`INSERT INTO ${set.table}(code,name) VALUES($1,$2)`, [v.code, v.name])
      }
    } catch (error) {
      if (error?.code === '23505') { deny(res, 409, 'duplicate'); return }
      deny(res, 503, 'database_unavailable')
      return
    }
    res.set('Cache-Control', 'no-store')
    res.status(201).json(v)
  }))

  router.patch('/master/:set/:code', json, handle(async (req, res) => {
    const set = pickSet(req, res)
    if (!set) return
    const code = String(req.params.code ?? '').trim().toUpperCase()
    if (!set.codeRe.test(code)) {
      deny(res, 404, 'not_found')
      return
    }
    const v = readBody(req, res, set)
    if (!v) return
    // Kodenya tidak bisa diubah lewat PATCH; ia kunci primer dan sudah
    // tercetak di nomor surat yang terlanjur terbit. Mengganti nama cukup.
    if (v.code !== code) {
      deny(res, 400, 'code_immutable')
      return
    }
    let result
    try {
      result = set.table === 'sdl_surat_kode_arsip'
        ? await pool.query('UPDATE sdl_surat_kode_arsip SET name=$2 WHERE code=$1', [code, v.name])
        : await pool.query(`UPDATE ${set.table} SET name=$2,updated_at=now() WHERE code=$1`, [code, v.name])
    } catch (error) {
      if (error?.code === '23505') { deny(res, 409, 'duplicate'); return }
      deny(res, 503, 'database_unavailable')
      return
    }
    if ((result.rowCount ?? 0) !== 1) {
      deny(res, 404, 'not_found')
      return
    }
    res.set('Cache-Control', 'no-store')
    res.status(200).json({ code, name: v.name })
  }))

  router.delete('/master/:set/:code', handle(async (req, res) => {
    const set = pickSet(req, res)
    if (!set) return
    const code = String(req.params.code ?? '').trim().toUpperCase()
    if (!set.codeRe.test(code)) {
      deny(res, 404, 'not_found')
      return
    }
    try {
      // Tidak ada foreign key dari surat ke master ini — kodenya tersimpan
      // sebagai teks di JSONB. Penghapusan karena itu tidak merusak surat yang
      // sudah ada, TAPI membuat kodenya yatim: tercetak di nomor surat tanpa
      // keterangan apa pun di master. Ditolak selama masih terpakai.
      const used = await pool.query({ text: set.inUseSQL, values: [code], rowMode: 'array' })
      if (used.rows[0][0] === true) {
        deny(res, 409, 'code_in_use')
        return
      }
      const result = await pool.query(`DELETE FROM ${set.table} WHERE code=$1`, [code])
      if ((result.rowCount ?? 0) !== 1) {
        deny(res, 404, 'not_found')
        return
      }
    } catch {
      deny(res, 503, 'database_unavailable')
      return
    }
    res.set('Cache-Control', 'no-store')
    res.status(200).json({ deleted: true })
  }))

  return router
}
