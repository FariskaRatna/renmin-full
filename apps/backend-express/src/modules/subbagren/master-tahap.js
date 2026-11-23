import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { jenisDalgar } from './dalgar.js'
import { HttpError } from './progar.js'
import { JENIS_LABEL, JENIS_TAHAP, PEKERJAAN, TAHAP_WAJIB, tahapTerkunci } from './tahap-katalog.js'

/**
 * R5H25 (migrasi 067): Master Data tahap pekerjaan aktif/nonaktif.
 * docs/R5H25-MASTER-DATA-TAHAP-PEKERJAAN.md. EXPRESS SAJA.
 *
 * Dipasang di /api/v1/admin/master/tahap-pekerjaan di belakang AuthorizeRoleEditor (Superadmin +
 * identity.roles.manage + CSRF), sama dengan master data persuratan R5G12/R5H8.
 * Superadmin hanya melihat katalog (nama jenis/tahap + saklar), tidak pernah
 * dokumen atau angka anggaran.
 *
 *   GET /master/tahap-pekerjaan          {version, jenis:[{key,label,kelompok,tahap:[{key,label,aktif,terkunci,alasanKunci?}]}]}
 *   PUT /master/tahap-pekerjaan/:jenis   {aktif:{<tahap>:bool,…}, reason, version} -> {version, changed}
 *
 * Hanya pasangan NONAKTIF yang disimpan; baris yatim (pasangan yang sudah tidak
 * ada di JENIS_TAHAP) dan pasangan terkunci (TAHAP_WAJIB) diabaikan saat dibaca.
 * Operator menerima hasilnya lewat GET /subbagren/perencanaan/tahap-katalog
 * (field `nonaktif`), dan POST tahap baru ditolak 409 tahap_nonaktif.
 */

// eslint-disable-next-line no-control-regex
const KENDALI = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const sahPasangan = (jenis, pekerjaan) => Boolean(JENIS_TAHAP[jenis]?.includes(pekerjaan))

/** Baris tabel -> pasangan nonaktif yang berlaku { jenis: [tahap…] }; yatim & terkunci dibuang. */
function saringNonaktif(rows) {
  const set = new Set(rows.filter((r) => sahPasangan(r.jenis, r.pekerjaan) && !tahapTerkunci(r.jenis, r.pekerjaan)).map((r) => `${r.jenis}\u0000${r.pekerjaan}`))
  const out = {}
  for (const [jenis, list] of Object.entries(JENIS_TAHAP)) {
    const off = list.filter((p) => set.has(`${jenis}\u0000${p}`))
    if (off.length) out[jenis] = off
  }
  return out
}

/** Pasangan nonaktif yang berlaku: { jenis: [tahap…] } (urut sesuai katalog). */
export async function tahapNonaktif(runner) {
  return saringNonaktif((await runner.query('SELECT jenis,pekerjaan FROM sdl_ren_tahap_nonaktif')).rows)
}

/**
 * Dipanggil di dalam transaksi POST tahap (setelah dokumen dikunci). FOR SHARE pada
 * baris versi menyerialkan dengan PUT Superadmin yang memegang FOR UPDATE.
 */
export async function tolakNonaktif(c, jenis, pekerjaan) {
  if (tahapTerkunci(jenis, pekerjaan)) return
  await c.query('SELECT 1 FROM sdl_ren_tahap_master_versi WHERE id=1 FOR SHARE')
  const r = await c.query('SELECT 1 FROM sdl_ren_tahap_nonaktif WHERE jenis=$1 AND pekerjaan=$2', [jenis, pekerjaan])
  if (r.rowCount) throw new HttpError(409, 'tahap_nonaktif')
}

function reply(res, status, value) {
  res.set('Cache-Control', 'no-store')
  res.status(status).json(value)
}

export function createMasterTahapRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.AUTH)
  const handle = (fn) => async (req, res, next) => {
    try { await fn(req, res) } catch (error) {
      if (error instanceof HttpError) { reply(res, error.status, { error: error.code }); return }
      next(error)
    }
  }

  router.get('/', handle(async (_req, res) => {
    // Versi dan daftar dibaca dalam SATU pernyataan (satu snapshot) supaya versi yang dikirim
    // ke UI selalu cocok dengan saklar yang ditampilkan.
    const snap = (await pool.query(
      `SELECT v.version, COALESCE(json_agg(json_build_object('jenis',n.jenis,'pekerjaan',n.pekerjaan)) FILTER (WHERE n.jenis IS NOT NULL),'[]') AS rows
         FROM sdl_ren_tahap_master_versi v LEFT JOIN sdl_ren_tahap_nonaktif n ON TRUE WHERE v.id=1 GROUP BY v.version`)).rows[0]
    const nonaktif = saringNonaktif(snap?.rows ?? [])
    const jenis = Object.entries(JENIS_TAHAP).map(([key, list]) => ({
      key, label: JENIS_LABEL[key] ?? key, kelompok: jenisDalgar(key) ? 'dalgar' : 'progar',
      tahap: list.map((p) => {
        const alasan = TAHAP_WAJIB[key]?.[p]
        return { key: p, label: PEKERJAAN[p].label, aktif: !(nonaktif[key] ?? []).includes(p), terkunci: Boolean(alasan), ...(alasan ? { alasanKunci: alasan } : {}) }
      }),
    }))
    reply(res, 200, { version: snap?.version ?? 0, jenis })
  }))

  router.put('/:jenis', json, handle(async (req, res) => {
    const payload = parsePayload(req, ['aktif', 'reason', 'version'])
    if (!payload.ok) throw new HttpError(400, 'invalid_request')
    const { aktif, reason, version } = payload.value
    const jenis = req.params.jenis
    const list = Object.hasOwn(JENIS_TAHAP, jenis) ? JENIS_TAHAP[jenis] : null
    if (!list || aktif === null || typeof aktif !== 'object' || Array.isArray(aktif)) throw new HttpError(400, 'invalid_input')
    const ubah = Object.entries(aktif)
    if (!ubah.length || ubah.some(([p, on]) => !list.includes(p) || typeof on !== 'boolean')) throw new HttpError(400, 'invalid_input')
    const alasan = typeof reason === 'string' ? reason.trim() : ''
    // Karakter kendali (selain tab/baris baru) dan surrogate tunggal ditolak di sini: JSONB
    // Postgres menolak \u0000/surrogate sehingga tanpa ini klien menerima 500, bukan 400.
    if (alasan.length < 8 || [...alasan].length > 500 || KENDALI.test(alasan) || !alasan.isWellFormed()) throw new HttpError(400, 'invalid_input')
    if (!Number.isInteger(version) || version < 0) throw new HttpError(400, 'invalid_input')

    const out = await withTransaction(pool, async (c) => {
      const cur = (await c.query('SELECT version FROM sdl_ren_tahap_master_versi WHERE id=1 FOR UPDATE')).rows[0]
      if (!cur) throw new HttpError(503, 'database_unavailable')
      if (cur.version !== version) throw new HttpError(409, 'version_conflict')
      const before = new Set((await c.query('SELECT pekerjaan FROM sdl_ren_tahap_nonaktif WHERE jenis=$1', [jenis])).rows
        .map((r) => r.pekerjaan).filter((p) => list.includes(p) && !tahapTerkunci(jenis, p)))
      const after = new Set(before)
      for (const [p, on] of ubah) {
        if (!on && tahapTerkunci(jenis, p)) throw new HttpError(409, 'tahap_terkunci')
        if (on) after.delete(p); else after.add(p)
      }
      if (!list.some((p) => !after.has(p))) throw new HttpError(409, 'minimal_satu_tahap')
      const nyalakan = [...before].filter((p) => !after.has(p))
      const matikan = [...after].filter((p) => !before.has(p))
      // Tanpa perubahan nyata: versi dan audit tidak disentuh (keputusan K7).
      if (!nyalakan.length && !matikan.length) return { version: cur.version, changed: 0 }
      if (nyalakan.length) await c.query('DELETE FROM sdl_ren_tahap_nonaktif WHERE jenis=$1 AND pekerjaan=ANY($2::text[])', [jenis, nyalakan])
      if (matikan.length) {
        await c.query(
          `INSERT INTO sdl_ren_tahap_nonaktif(jenis,pekerjaan,updated_by) SELECT $1,p,$3 FROM unnest($2::text[]) AS p
            ON CONFLICT (jenis,pekerjaan) DO NOTHING`, [jenis, matikan, req.actor])
      }
      const next = (await c.query('UPDATE sdl_ren_tahap_master_versi SET version=version+1 WHERE id=1 RETURNING version')).rows[0].version
      const urut = (s) => list.filter((p) => s.has(p))
      await c.query(
        `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,'master.tahap.update','ren.tahap',$2,$3::jsonb)`,
        [req.actor, jenis, JSON.stringify({ reason: alasan, versionBefore: cur.version, nonaktifBefore: urut(before), nonaktifAfter: urut(after), dinyalakan: nyalakan, dimatikan: matikan })])
      return { version: next, changed: nyalakan.length + matikan.length }
    })
    reply(res, 200, out)
  }))

  return router
}
