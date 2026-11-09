import { randomUUID } from 'node:crypto'

/**
 * Middleware global, padanan NewRouterWithAuth (internal/httpapi/router.go:34-44).
 *
 * JANGAN ganti dengan helmet() bawaan. Helmet menambah HSTS, CSP, dan lainnya
 * yang mengubah perilaku di balik Caddy dan membuat respons berbeda dari
 * baseline Go. Yang dipasang di Go persis empat header ini, tidak lebih.
 */
export function securityHeaders(req, res, next) {
  res.set('X-Content-Type-Options', 'nosniff')
  res.set('X-Frame-Options', 'DENY')
  res.set('Referrer-Policy', 'no-referrer')
  res.set('Cache-Control', 'no-store')
  next()
}

/** Padanan chi middleware.RequestID. */
export function requestId(req, res, next) {
  req.requestId = req.get('X-Request-Id') || randomUUID()
  next()
}

/**
 * Padanan chi middleware.Recoverer: panic menjadi 500 TANPA body.
 *
 * Di Express, handler async yang menolak TIDAK otomatis sampai ke sini pada
 * Express 4. Proyek ini memakai Express 5, yang meneruskan rejected promise ke
 * error handler — tapi handler tetap ditulis dengan try/catch di tempat yang
 * berisiko, supaya tidak bergantung pada perilaku versi.
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err)
  process.stderr.write(
    `${JSON.stringify({
      time: new Date().toISOString(),
      level: 'ERROR',
      msg: 'unhandled request error',
      path: req.originalUrl,
      requestId: req.requestId,
      error: err?.message ?? String(err),
    })}\n`,
  )
  res.status(500).end()
}

/** 404 untuk path yang tidak terdaftar — chi menjawab 404 dengan body "404 page not found\n". */
export function notFound(req, res) {
  res.status(404).set('Content-Type', 'text/plain; charset=utf-8').send('404 page not found\n')
}
