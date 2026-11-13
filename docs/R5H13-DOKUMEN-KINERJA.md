# R5H13 — Dokumen Perencanaan dan Monitoring Kinerja & LKIP

Status: dibangun lokal 2026-11-13, belum di-commit, belum dideploy.

## Keputusan pemilik sistem (2026-11-13)

| Hal | Keputusan |
|---|---|
| Dokumen Perencanaan | Draft sampai **disahkan Kasubbagren**; pengunggah tidak boleh mengesahkan sendiri. Revisi = dokumen baru yang menggantikan dokumen sah; versi lama tetap bisa dibuka |
| Indikator kinerja | Melekat **per kegiatan** (Program Anggaran) |
| Periode | **Triwulan** (TW I–IV), nilai **kumulatif** (TW IV = setahun) |
| Output LKIP | Rekap di layar + **unduh Excel** |

## Alur

**Dokumen Perencanaan** (PROGAR): Unggah Dokumen (jenis, judul, nomor, tanggal,
keterkaitan program/kegiatan opsional) → Lampirkan PDF (≤ 20 MB, terenkripsi)
→ Kasubbagren **Sahkan**/Tolak → dokumen sah terkunci; perubahan lewat
**Buat Revisi**. Dokumen lama ditandai "Digantikan revisi" dan disembunyikan
kecuali "Tampilkan versi lama" dicentang.

**Monitoring Kinerja & LKIP** (PROGAR): setiap kegiatan menampilkan serapan
anggaran dari Realisasi (R5H12). Operator/Kasubbagren menambah indikator
(nama, satuan, target kumulatif TW I–IV), lalu mengisi capaian per triwulan
dengan catatan/kendala. Persentase per triwulan = capaian ÷ target triwulan
itu. "Tahunan" = capaian triwulan terakhir yang diisi ÷ target TW IV; warnanya
menunjukkan sesuai/di bawah target triwulan terakhir. **Unduh Excel LKIP**
menghasilkan rekap capaian + pagu/realisasi/serapan per kegiatan, dan daftar
dokumen sah.

## Hak akses

| Jabatan | Unggah dokumen, kelola indikator, isi capaian | Sahkan dokumen | Baca + Excel |
|---|---|---|---|
| Operator Subbagren | ✓ | – | ✓ |
| Kasubbagren | ✓ | ✓ (bukan unggahannya sendiri) | ✓ |
| Staf Subbagren, Kabagrenmin | – | – | ✓ |

Capaian tidak memerlukan persetujuan (tidak diminta); setiap perubahan tercatat
di audit beserta nama pengisinya.

## Teknis

- Migrasi `051_dokumen_kinerja.sql`; backend `modules/subbagren/perencanaan.js`;
  penulis XLSX tanpa dependensi `src/http/xlsx.js` (zlib bawaan Node ≥ 22).
- Frontend `DokumenR5H13.tsx`, `KinerjaR5H13.tsx`.

## Verifikasi

- `verify/r5h13-flow.js` **42/42 LULUS**; regresi `r5h11` dan `r5h12` tetap lulus.
- Excel dibaca dengan openpyxl tanpa peringatan; demo Chrome (unggah DIPA →
  sahkan → indikator → capaian TW I–III → unduh Excel) lulus.

## Deploy

- `-migrate` (051) + rebuild image Go; `SDL_EVIDENCE_KEY` valid di api-express.
