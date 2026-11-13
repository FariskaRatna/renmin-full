# R5H12 — Realisasi Anggaran per Kegiatan

Status: dibangun lokal 2026-11-13, belum di-commit, belum dideploy.

## Keputusan

- Pemilik meminta alur **Program → Kegiatan → Pagu → Realisasi** tersambung.
- Realisasi dicatat per kegiatan dan memotong **Pagu Anggaran R5H11** yang disetujui.
- Pagu lama berbasis Usulan (R4A3) **tidak dihapus**: endpoint backend utuh,
  layar LRA lama menjadi **arsip baca** (formulir Register Pagu, Catat
  Realisasi, dan Unggah Bukti disembunyikan) di balik tombol "Lihat LRA lama".
  Mudah dibalik: cukup tampilkan lagi formulirnya.

## Alur

1. PAGU ANGGARAN → **Realisasi Anggaran (LRA)**: setiap kegiatan berpagu
   disetujui tampil dengan pagu, terserap, sisa, dan batang serapan.
2. Operator (atau Kasubbagren) **Catat Realisasi**: tanggal (harus di tahun
   anggaran pagunya), jumlah, nomor bukti (SPM/SP2D/kuitansi), uraian.
3. **Unggah Bukti** bayar: satu berkas PDF/JPG/PNG ≤ 5 MB, disimpan terenkripsi.
   Bisa diganti selama realisasi belum diputuskan.
4. Kasubbagren **Verifikasi** (wajib ada bukti) atau **Tolak** dengan alasan.
   Pencatat tidak boleh memverifikasi catatannya sendiri.
5. Hanya realisasi terverifikasi yang mengurangi sisa pagu. Server menolak
   verifikasi yang membuat total melampaui pagu (kunci baris pagu, aman
   terhadap dua verifikasi bersamaan).

## Hak akses (migrasi 050)

| Jabatan | Catat + unggah bukti | Verifikasi | Baca |
|---|---|---|---|
| Operator Subbagren | ✓ | – | ✓ |
| Kasubbagren | ✓ | ✓ (bukan catatannya sendiri) | ✓ |
| Staf Subbagren, Kabagrenmin | – | – | ✓ |

## Verifikasi

- `verify/r5h12-flow.js` terhadap Express lokal.
- `go test ./internal/migrations/` lulus; `npm run build` lulus.

## Deploy

- Butuh `-migrate` (050) dan rebuild image Go (verifikasi checksum migrasi).
- `SDL_EVIDENCE_KEY` harus valid di api-express; tanpa itu unggah bukti
  menjawab 503 `evidence_encryption_unavailable` (fail-closed).
