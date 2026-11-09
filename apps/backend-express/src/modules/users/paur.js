import { Router } from 'express'

import { withTransaction } from '../../db.js'
import { BODY_LIMITS, parsePayload, rawBody } from '../../http/payload.js'
import { problem, writeJson } from '../../http/respond.js'

/**
 * R5H4 — keanggotaan Paur (migrasi 043). Port dari
 * apps/backend/internal/users/paur.go; dipasang di bawah /api/v1/admin
 * dengan guard yang sama seperti /users.
 *
 * Keanggotaan Paur TIDAK memberi akses apa pun. Satu-satunya pembacanya
 * adalah pemilihan penerima arahan (modules/directives/sections.js).
 */

const PAUR_KEY_PATTERN = /^paur_[a-z]{2,24}$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function validReason(reason) {
  if (typeof reason !== 'string') return false
  return [...reason.trim()].length >= 8 && [...reason].length <= 500
}

export function createPaurRouter({ pool }) {
  const router = Router()
  const json = rawBody(BODY_LIMITS.USERS)
  const handle = (fn) => async (req, res, next) => {
    try {
      await fn(req, res)
    } catch (error) {
      next(error)
    }
  }

  // ---- 156. GET /paur ----
  router.get('/paur', handle(async (req, res) => {
    let items
    let members
    try {
      items = (await pool.query('SELECT paur_key,label,unit_key FROM sdl_paur ORDER BY paur_key')).rows
        .map((r) => ({ key: r.paur_key, label: r.label, unit: r.unit_key }))
      members = (await pool.query('SELECT user_id::text AS user_id,paur_key,is_head FROM sdl_user_paur ORDER BY paur_key,user_id')).rows
        .map((r) => ({ userId: r.user_id, paurKey: r.paur_key, isHead: r.is_head === true }))
    } catch {
      problem(res, 503, 'unavailable')
      return
    }
    writeJson(res, 200, { items, members })
  }))

  // ---- 157. PUT /users/:userID/paur ----
  router.put('/users/:userID/paur', json, handle(async (req, res) => {
    const id = req.params.userID
    const payload = parsePayload(req, ['paurKey', 'isHead', 'reason'])
    if (!payload.ok) {
      problem(res, 400, 'invalid_request')
      return
    }
    const p = payload.value
    // Tipe salah = galat decode di Go (400 invalid_request); absen = zero value.
    const paurKey = p.paurKey === undefined ? null : p.paurKey
    if ((paurKey !== null && typeof paurKey !== 'string')
      || (p.isHead !== undefined && typeof p.isHead !== 'boolean')
      || (p.reason !== undefined && typeof p.reason !== 'string')) {
      problem(res, 400, 'invalid_request')
      return
    }
    const isHead = p.isHead === true
    const reason = p.reason ?? ''
    if (!validReason(reason) || (paurKey !== null && !PAUR_KEY_PATTERN.test(paurKey)) || (paurKey === null && isHead)) {
      problem(res, 400, 'invalid_input')
      return
    }
    if (!UUID_PATTERN.test(id)) {
      problem(res, 404, 'user_missing')
      return
    }
    if (id === req.actor) {
      problem(res, 403, 'self_change_denied')
      return
    }

    let outcome
    try {
      outcome = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `SELECT EXISTS(SELECT 1 FROM sdl_user_roles WHERE user_id=u.id AND role_key='superadmin') AS protected
             FROM sdl_users u WHERE u.id=$1 FOR UPDATE`,
          [id],
        )
        if (rows.length === 0) return { kind: 'user_missing' }
        if (rows[0].protected) return { kind: 'protected_user' }

        const prev = await client.query('SELECT paur_key,is_head FROM sdl_user_paur WHERE user_id=$1', [id])
        const before = prev.rows[0]?.paur_key ?? null
        const beforeHead = prev.rows[0]?.is_head === true

        if (paurKey === null) {
          await client.query('DELETE FROM sdl_user_paur WHERE user_id=$1', [id])
        } else {
          const member = await client.query(
            `SELECT EXISTS(SELECT 1 FROM sdl_paur p JOIN sdl_user_units uu ON uu.unit_key=p.unit_key AND uu.user_id=$2
               WHERE p.paur_key=$1) AS ok`,
            [paurKey, id],
          )
          if (member.rows[0].ok !== true) return { kind: 'paur_unit_mismatch' }
          await client.query(
            `INSERT INTO sdl_user_paur(user_id,paur_key,is_head,assigned_by) VALUES($1,$2,$3,$4)
             ON CONFLICT (user_id) DO UPDATE SET paur_key=EXCLUDED.paur_key,is_head=EXCLUDED.is_head,
               assigned_by=EXCLUDED.assigned_by,assigned_at=now()`,
            [id, paurKey, isHead, req.actor],
          )
        }
        // Urutan kunci = urutan literal map Go yang di-marshal (alfabetis).
        await client.query(
          `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
           VALUES($1,'identity.user_paur_updated','user',$2,$3::jsonb)`,
          [req.actor, id, JSON.stringify({
            isHeadAfter: isHead, isHeadBefore: beforeHead, paurAfter: paurKey, paurBefore: before, reason: reason.trim(),
          })],
        )
        return { kind: 'ok' }
      })
    } catch {
      problem(res, 503, 'unavailable')
      return
    }

    const failures = {
      user_missing: [404, 'user_missing'],
      protected_user: [403, 'protected_user'],
      paur_unit_mismatch: [400, 'paur_unit_mismatch'],
    }
    if (failures[outcome.kind]) {
      problem(res, failures[outcome.kind][0], failures[outcome.kind][1])
      return
    }
    // Go menserialisasi map[string]any dengan kunci terurut alfabetis.
    writeJson(res, 200, { isHead, paurKey })
  }))

  return router
}
