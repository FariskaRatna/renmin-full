/**
 * Pemeriksaan untuk suite keamanan, padanan `status()` dan pola
 * `bytes.Contains` di Go.
 *
 * Setiap kegagalan MENYERTAKAN body respons. Di suite keamanan selisih antara
 * 403 dan 404 sering disengaja (404 dipakai supaya keberadaan record milik
 * unit lain tidak bocor lewat selisih status code), jadi "HTTP 404 diharapkan
 * 403" tanpa body adalah petunjuk yang hampir tidak berguna.
 */

export class SecurityAssertionError extends Error {}

function short(text, limit = 400) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat
}

export function status(response, want, label = '') {
  if (response.status === want) return response
  throw new SecurityAssertionError(
    `${label ? `${label}: ` : ''}HTTP ${response.status} diharapkan ${want} — ${short(response.text)}`,
  )
}

export function contains(response, needle, label = '') {
  const text = typeof response === 'string' ? response : response.text
  if (text.includes(needle)) return
  throw new SecurityAssertionError(
    `${label ? `${label}: ` : ''}respons tidak memuat ${JSON.stringify(needle)} — ${short(text)}`,
  )
}

export function notContains(response, needle, label = '') {
  const text = typeof response === 'string' ? response : response.text
  if (!text.includes(needle)) return
  throw new SecurityAssertionError(
    `${label ? `${label}: ` : ''}respons SEHARUSNYA tidak memuat ${JSON.stringify(needle)} — ${short(text)}`,
  )
}

export function equal(actual, want, label) {
  if (actual === want) return
  throw new SecurityAssertionError(`${label}: ${JSON.stringify(actual)} diharapkan ${JSON.stringify(want)}`)
}

export function truthy(value, label) {
  if (value) return
  throw new SecurityAssertionError(label)
}

/** Status mana pun selain 2xx. Dipakai saat Go sengaja menerima 403 ATAU 409. */
export function notSuccess(response, label) {
  if (response.status < 200 || response.status >= 300) return
  throw new SecurityAssertionError(`${label}: HTTP ${response.status} — seharusnya ditolak`)
}

/** Membaca field dari body JSON, dengan pesan yang jelas kalau bentuknya meleset. */
export function field(response, path, label) {
  let value
  try {
    value = JSON.parse(response.text)
  } catch {
    throw new SecurityAssertionError(`${label}: body bukan JSON — ${short(response.text)}`)
  }
  for (const key of path.split('.')) {
    if (value === null || typeof value !== 'object') {
      throw new SecurityAssertionError(`${label}: jalur "${path}" terputus — ${short(response.text)}`)
    }
    value = value[key]
  }
  if (value === undefined || value === null || value === '') {
    throw new SecurityAssertionError(`${label}: "${path}" kosong — ${short(response.text)}`)
  }
  return value
}
