import busboy from 'busboy'

/**
 * Pembacaan satu berkas dari body multipart, padanan r.FormFile() di Go.
 *
 * Go menerapkan DUA batas yang berbeda dan keduanya penting:
 *
 *   1. MaxBytesReader pada seluruh body (mis. 6 MiB di unitwork/work.go:579)
 *   2. io.LimitReader pada isi berkasnya saja (5 MiB + 1 byte), lalu menolak
 *      kalau hasilnya melewati 5 MiB
 *
 * Byte ekstra di batas kedua itu disengaja: ia membuat berkas yang tepat
 * melebihi batas tetap terbaca satu byte lebih banyak, sehingga bisa dikenali
 * sebagai "terlalu besar" alih-alih terpotong diam-diam.
 *
 * `fields` berisi field non-berkas, padanan r.FormValue(). `fileCount`
 * menghitung berapa berkas yang dikirim pada field sasaran — Go membedakan
 * "satu berkas" dari "dua berkas" (evidence.go:144), dan tanpa hitungan itu
 * kiriman kedua hanya terbuang diam-diam. Naikkan `maxFiles` ke 2 supaya
 * kelebihannya sampai ke busboy dan bisa dihitung; isinya tetap hanya berkas
 * pertama yang dibaca.
 *
 * @returns {Promise<{file?: {buffer: Buffer, filename: string}, fields: object,
 *                    fileCount: number, error?: string}>}
 *          error 'too_large' kalau melewati batas, 'missing' kalau tidak ada berkas
 */
export function readSingleFile(req, { fieldName, maxBodyBytes, maxFileBytes, maxFiles = 1 }) {
  return new Promise((resolve) => {
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      resolve(result)
    }

    let parser
    try {
      parser = busboy({
        headers: req.headers,
        limits: {
          files: maxFiles,
          fileSize: maxFileBytes + 1, // satu byte ekstra, seperti io.LimitReader di Go
          fields: 20,
        },
      })
    } catch {
      finish({ error: 'missing' })
      return
    }

    let bodySize = 0
    req.on('data', (chunk) => {
      bodySize += chunk.length
      // `bodyExceeded` membedakan batas body dari batas berkas. Go memisahkan
      // keduanya: body yang kebesaran menggagalkan ParseMultipartForm, berkas
      // yang kebesaran lolos parse lalu tertangkap io.LimitReader — dan kode
      // errornya berbeda (evidence.go:132 vs :156).
      if (bodySize > maxBodyBytes) finish({ error: 'too_large', bodyExceeded: true })
    })

    const chunks = []
    const fields = {}
    let filename = ''
    let truncated = false
    let received = false
    let fileCount = 0

    parser.on('field', (name, value) => {
      // Field pertama yang menang, seperti r.FormValue().
      if (!(name in fields)) fields[name] = value
    })

    parser.on('file', (name, stream, info) => {
      if (name !== fieldName) {
        stream.resume()
        return
      }
      fileCount += 1
      // Hanya berkas pertama yang dibaca; sisanya cukup dihitung.
      if (received) {
        stream.resume()
        return
      }
      received = true
      filename = info.filename ?? ''
      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('limit', () => {
        truncated = true
      })
    })

    parser.on('close', () => {
      if (!received) {
        finish({ error: 'missing', fields, fileCount })
        return
      }
      const buffer = Buffer.concat(chunks)
      if (truncated || buffer.length > maxFileBytes || buffer.length === 0) {
        finish({ error: 'too_large', fields, fileCount })
        return
      }
      finish({ file: { buffer, filename }, fields, fileCount })
    })

    parser.on('error', () => finish({ error: 'missing' }))

    req.pipe(parser)
  })
}

/**
 * Padanan safeName (work.go:543): ambil basename, buang path, potong 180 byte,
 * dan jangan pernah kembalikan string kosong.
 */
export function safeName(raw) {
  const normalized = String(raw ?? '').replaceAll('\\', '/')
  const segments = normalized.split('/')
  let name = (segments[segments.length - 1] ?? '').trim()
  if (name.length > 180) name = name.slice(0, 180)
  if (name === '' || name === '.' || name === '/') return 'file'
  return name
}

/**
 * Padanan fileType (work.go:556): deteksi tipe dari magic bytes, BUKAN dari
 * Content-Type yang dikirim klien. Hanya PDF, JPEG, dan PNG yang diterima.
 */
export function detectFileType(buffer) {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF') {
    return 'application/pdf'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(png)) {
    return 'image/png'
  }
  return ''
}

/**
 * Padanan mime.FormatMediaType untuk Content-Disposition.
 * Nama berkas ASCII sederhana ditulis apa adanya; selain itu dikutip dan
 * di-escape, sama seperti perilaku Go.
 */
export function contentDisposition(kind, filename) {
  const safe = filename.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  if (/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(filename)) {
    return `${kind}; filename=${filename}`
  }
  return `${kind}; filename="${safe}"`
}
