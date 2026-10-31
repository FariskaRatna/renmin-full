/**
 * Helper respons, padanan write()/problem() di internal/auth/service.go:79-86
 * dan writeJSON() di internal/httpapi/router.go:276.
 *
 * Go memakai json.NewEncoder(w).Encode(), yang SELALU menambahkan newline di
 * akhir. Direplikasi di sini supaya byte-nya identik, bukan sekadar JSON yang
 * setara.
 */
export function writeJson(res, status, body) {
  res.status(status)
  res.set('Content-Type', 'application/json; charset=utf-8')
  res.send(`${JSON.stringify(body)}\n`)
}

/** Envelope error seragam: { "error": "<kode_snake_case>" }. */
export function problem(res, status, code) {
  writeJson(res, status, { error: code })
}

/** 204 tanpa body. */
export function noContent(res) {
  res.status(204).end()
}
