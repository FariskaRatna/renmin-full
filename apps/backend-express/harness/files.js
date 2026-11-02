/**
 * Byte berkas uji, satu-satunya sumber untuk seed maupun unggahan harness.
 *
 * Isinya tidak boleh diubah sembarangan. Ketiga validator berkas di Go
 * (`urmin/r3b.go:127`, `subbagren/evidence.go:46`, `unitwork/work.go:556`)
 * menolak kalau salah satu dari tiga hal ini hilang:
 *
 *   1. awalan `%PDF-` — dipakai http.DetectContentType untuk menyimpulkan
 *      `application/pdf`; Content-Type yang dikirim klien diabaikan total;
 *   2. `%%EOF` yang berada di 2048 byte TERAKHIR;
 *   3. panjang > 0.
 *
 * Nama berkasnya ikut diperiksa terpisah lewat `^[a-zA-Z0-9 _().-]{1,160}$`,
 * jadi nama dengan koma, garis miring, atau huruf beraksen akan ditolak 400
 * invalid_file_type — bukan karena isinya, melainkan karena namanya.
 */
export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
)

/**
 * Peta yang dirujuk `multipart` di registry lewat kuncinya (`file: 'pdf'`).
 * Registry sengaja tetap berisi data murni tanpa Buffer di dalamnya.
 */
export const FIXTURE_FILES = {
  pdf: { bytes: PDF_BYTES, contentType: 'application/pdf' },
}
