/**
 * Pemformatan waktu ala Go. Satu-satunya tempat aturannya ditulis — inilah
 * "helper bersama" yang diminta D4 di `docs/DEVIATIONS.md`.
 *
 * `encoding/json` Go menyerialkan `time.Time` sebagai RFC3339Nano, yang
 * MEMBUANG nol di belakang pecahan detik dan membuang titiknya sekalian kalau
 * pecahannya nol seluruhnya:
 *
 *   780192000 ns  ->  2026-11-01T03:33:05.780192Z
 *   780000000 ns  ->  2026-11-01T03:33:05.78Z
 *           0 ns  ->  2026-11-01T03:33:05Z
 *
 * `Date.prototype.toJSON()` tidak pernah melakukan keduanya: ia SELALU menulis
 * tepat tiga desimal. Perbedaannya kecil di mata, tapi harness mustahil
 * melihatnya — `Normalizer` mengganti setiap timestamp dengan `<timestamp>`
 * sebelum membandingkan, jadi tidak ada jumlah run yang akan memunculkannya.
 */

/**
 * Dua sumber timestamp, dua jalur berbeda, dan memakai yang salah menghasilkan
 * kerusakan yang berbeda pula:
 *
 *   dari DATABASE   -> `goTimestamp()` di bawah, dipasang sebagai type parser
 *                      `pg` (lihat db.js). Teks Postgres dipakai apa adanya
 *                      karena `Date` hanya menyimpan milidetik dan akan
 *                      MEMBUANG mikrodetik yang Go teruskan.
 *   dari JAM SERVER -> `goTime()`. Di sini Date memang satu-satunya sumber,
 *                      jadi yang bisa disamakan hanya FORMAT-nya. Presisinya
 *                      tetap berbeda (Go nanodetik, Node milidetik) dan itu
 *                      tidak bisa diperbaiki — nilainya pun memang tidak
 *                      pernah sama antara dua panggilan.
 */
export function goTime(date = new Date()) {
  return date.toISOString().replace(/\.?0+Z$/, 'Z')
}

/**
 * Padanan untuk teks timestamp mentah dari Postgres. Dipasang sebagai type
 * parser di `db.js`, bukan dipanggil per-field: satu kolom yang terlewat sudah
 * cukup untuk mengembalikan D4, dan tidak ada uji yang akan mengeluhkannya.
 *
 * Pemotongan nol di belakang TIDAK dilakukan di sini karena Postgres sudah
 * melakukannya pada keluaran teksnya sendiri, dan hasilnya kebetulan sama
 * persis dengan aturan Go: `.780192` tetap, `.500000` menjadi `.5`, dan
 * pecahan nol penuh tidak ditulis sama sekali. Yang tersisa hanya menukar
 * pemisah tanggal/jam dan menormalkan zona waktunya.
 */
export function goTimestamp(value) {
  if (value === null) return null
  if (value === 'infinity' || value === '-infinity') return value

  const isoish = value.replace(' ', 'T')

  // Jalur cepat: sesi dipaksa UTC oleh createPool(), jadi inilah bentuk nyata.
  if (isoish.endsWith('+00')) return `${isoish.slice(0, -3)}Z`
  // timestamp WITHOUT TIME ZONE: pgx membacanya sebagai UTC, jadi begitu pula
  // di sini. Praktis tidak pernah terpakai — dua kolom yang ada selalu
  // di-SELECT dengan cast ::text.
  if (!/[+-]\d{2}(:\d{2})?$/.test(isoish)) return `${isoish}Z`

  // Jaring pengaman kalau zona sesi ternyata bukan UTC. Pecahan detik dipisah
  // lebih dulu: pergeseran offset selalu kelipatan menit, jadi digit pecahannya
  // tidak pernah berubah dan bisa ditempel kembali tanpa kehilangan presisi.
  const fraction = /\.(\d+)/.exec(isoish)
  // Postgres menulis offset jam bulat sebagai `+07`, dan `new Date()` menolak
  // bentuk itu — hasilnya Invalid Date, lalu teks mentah berzona non-UTC lolos
  // apa adanya ke respons. Dilengkapi menjadi `+07:00` lebih dulu.
  const withoutFraction = isoish.replace(/\.\d+/, '').replace(/([+-]\d{2})$/, '$1:00')
  const instant = new Date(withoutFraction)
  if (Number.isNaN(instant.getTime())) return isoish
  const utc = goTime(instant)
  return fraction ? utc.replace('Z', `.${fraction[1]}Z`) : utc
}
