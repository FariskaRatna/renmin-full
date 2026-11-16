/**
 * Helper bersama verify/r5h11..r5h14 (Subbagren). Bukan skenario uji sendiri.
 *
 *   sahDipa(op, ka, tahun, opsi)  -> id DIPA/Revisi DIPA yang SUDAH disahkan
 *   cleanupRen(sql, tahun)        -> hapus seluruh data Subbagren tahun uji,
 *                                    urut mengikuti foreign key
 */
export const PDF_UJI = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1')

async function req(a, method, path, body, extra = {}) {
  const res = await a.client.request(method, `/api/v1/subbagren/perencanaan${path}`, { withCsrf: method !== 'GET', ...(body !== undefined ? { body } : {}), ...extra })
  const text = Buffer.from(res.bytes).toString('utf8')
  let json = null; try { json = JSON.parse(text) } catch {}
  if (res.status >= 300) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 160)}`)
  return json
}

/** Operator mengunggah DIPA + PDF, Kasubbagren mengesahkan. */
export async function sahDipa(op, ka, tahun, { judul = `DIPA uji ${tahun}`, jenis = 'dipa', penggantiDari = '', sahkan = true } = {}) {
  const d = await req(op, 'POST', '/dokumen', {
    tahun, jenis, judul, nomor: `SP-${judul}`, tanggal: `${tahun}-01-02`, programId: '', kegiatanId: '', keterangan: '', penggantiDari,
  })
  await req(op, 'POST', `/dokumen/${d.id}/berkas`, undefined, { multipart: [{ name: 'file', filename: 'dipa.pdf', contentType: 'application/pdf', bytes: PDF_UJI }] })
  if (sahkan) await req(ka, 'POST', `/dokumen/${d.id}/review`, { keputusan: 'disahkan', catatan: '', version: 2 })
  return d.id
}

export async function cleanupRen(sql, tahun) {
  const prog = `SELECT id FROM sdl_ren_program WHERE tahun=${Number(tahun)}`
  const keg = `SELECT id FROM sdl_ren_kegiatan WHERE program_id IN (${prog})`
  const pagu = `SELECT id FROM sdl_ren_pagu WHERE kegiatan_id IN (${keg})`
  const real = `SELECT id FROM sdl_ren_realisasi WHERE pagu_id IN (${pagu})`
  const ind = `SELECT id FROM sdl_ren_indikator WHERE kegiatan_id IN (${keg})`
  await sql.query(`DELETE FROM sdl_ren_realisasi_bukti WHERE realisasi_id IN (${real})`)
  await sql.query(`DELETE FROM sdl_ren_realisasi WHERE pagu_id IN (${pagu})`)
  await sql.query(`DELETE FROM sdl_ren_pagu WHERE kegiatan_id IN (${keg})`)
  await sql.query(`DELETE FROM sdl_ren_capaian WHERE indikator_id IN (${ind})`)
  await sql.query(`DELETE FROM sdl_ren_indikator WHERE kegiatan_id IN (${keg})`)
  await sql.query(`DELETE FROM sdl_ren_dokumen_berkas WHERE dokumen_id IN (SELECT id FROM sdl_ren_dokumen WHERE tahun=${Number(tahun)})`)
  // Revisi menunjuk dokumen lama: hapus dari ujung rantai.
  for (let i = 0; i < 10; i++) {
    const r = await sql.query(`DELETE FROM sdl_ren_dokumen d WHERE d.tahun=${Number(tahun)}
      AND NOT EXISTS(SELECT 1 FROM sdl_ren_dokumen x WHERE x.pengganti_dari=d.id)`)
    if (!r.rowCount) break
  }
  await sql.query(`DELETE FROM sdl_ren_kegiatan WHERE program_id IN (${prog})`)
  await sql.query(`DELETE FROM sdl_ren_program WHERE tahun=${Number(tahun)}`)
}
