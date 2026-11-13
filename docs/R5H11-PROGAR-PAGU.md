# R5H11 — Program Anggaran (PROGAR) dan Pagu Anggaran

Status: dibangun lokal 2026-11-13, belum di-commit, belum dideploy.

## Keputusan pemilik sistem (2026-11-13)

| Hal | Keputusan |
|---|---|
| Struktur | Dua tingkat: **Program → Kegiatan**. Pagu dicatat per kegiatan |
| Pagu lama (R4A3, berbasis Usulan) | **Terpisah**, tidak diubah |
| Yang menginput | **Operator dan Kasubbagren**; Staf dan Kabagrenmin membaca |
| Persetujuan | Pagu **draft sampai disetujui Kasubbagren**; pencatat tidak boleh menyetujui inputannya sendiri |

## Alur

1. PROGAR → **Program Anggaran**: tambah program per tahun anggaran, lalu kegiatannya.
2. PAGU ANGGARAN → **Pagu Anggaran**: daftar kegiatan diambil dari program tahun
   yang sama. "Catat Pagu" per kegiatan (jumlah, dasar/dokumen sumber).
3. Kasubbagren **Setujui** atau **Tolak** (dengan alasan). Pagu yang disetujui
   terkunci. Setelah ditolak, pagu baru boleh dicatat; alasan penolakan
   terakhir tetap terlihat.
4. Satu kegiatan paling banyak satu pagu hidup (draft/disetujui). Kegiatan
   berpagu dan program berisi kegiatan tidak bisa dihapus.

## Teknis

- Migrasi `049_progar_pagu.sql`: `sdl_ren_program`, `sdl_ren_kegiatan`,
  `sdl_ren_pagu`; 3 permission baru, diberikan ke role BagRenmin yang sudah ada.
  Seed Go dan Express ikut membawa permission yang sama untuk database baru.
- Backend: `apps/backend-express/src/modules/subbagren/progar.js` (Express saja).
  Kontrak: `API-CONTRACT.md` bagian R5H11.
- Frontend: `ProgarR5H11.tsx` (satu komponen, mode `program`/`pagu`).
- Hak akses memakai permission pada grant unit `subbagren`, **tanpa melihat
  scope** — scope `assigned` milik Operator tidak pernah cocok di register
  tingkat unit (lihat `PERTANYAAN-KONFIGURASI-AKSES.md` pertanyaan 2).

## Verifikasi

- `verify/r5h11-flow.js`: **39/39 LULUS** terhadap Express lokal (hak per
  jabatan, duplikat, versi basi, catat → setujui/tolak → catat ulang,
  larangan menyetujui sendiri, total, perlindungan hapus, audit).
- `go test ./internal/migrations/` lulus; `npm run build` frontend lulus.
- Belum: uji tampilan di browser.

## Deploy

- Butuh `-migrate` (049) dan **rebuild image Go juga**: Go memverifikasi
  checksum seluruh migrasi saat start, termasuk 049.
- `/api/v1/subbagren/*` sudah dilayani Express di server; tidak perlu
  mengubah `SDL_EXPRESS_PATHS`.
- Akun yang password awalnya belum diganti (`must_change_password`) tetap
  tidak bisa memakai modul ini.
