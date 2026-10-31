# SDL Backend — Express

Penulisan ulang `apps/backend` (Go + chi) ke Node/Express.

## Status

Tahap persiapan. Belum melayani trafik apa pun.

## Aturan selama migrasi

1. **`apps/backend/` (Go) tidak boleh dihapus** sampai Express melayani seluruh
   142 endpoint dengan stabil di produksi. Ia adalah rujukan perilaku dan pembanding
   dalam test paritas.
2. **Skema database dipakai bersama.** Satu Postgres, dua backend. File migrasi
   tetap `apps/backend/internal/migrations/sql/*.sql` (33 file) — jangan disalin,
   jangan ditulis ulang. Runner Express membacanya dari sana.
3. **`apps/frontend/` tidak disentuh.** Ia memanggil path relatif `/api/v1/...`
   dan tidak perlu tahu backend mana yang melayani.
4. **Kontrak API beku.** Perbaikan desain menunggu sampai paritas tercapai.

## Dokumen

| File | Isi |
|---|---|
| [`docs/API-CONTRACT.md`](docs/API-CONTRACT.md) | Inventaris 142 endpoint, model otorisasi, parameter kripto, kode error, env. Acuan kebenaran migrasi. |
| [`docs/MIGRATION-PLAN.md`](docs/MIGRATION-PLAN.md) | Tahap 0–6, urutan domain, gerbang kelulusan tiap tahap, daftar risiko. |
| [`docs/DEVIATIONS.md`](docs/DEVIATIONS.md) | Perbedaan sadar antara Express dan Go, serta backlog perbaikan pasca-paritas. |
| [`harness/README.md`](harness/README.md) | Harness golden-file: perekam dan pembanding 142 endpoint. Alat ukur Tahap 0. |

## Stack

JavaScript polos, ESM (`"type": "module"`). Satu `package.json` untuk backend
dan harness — tanpa proyek npm bersarang.

```
express@5   pg      (harness ikut di sini)
```

## Mulai dari mana

Baca `MIGRATION-PLAN.md` Tahap 0 dan Tahap 1. Tahap 1 (verifikasi argon2id terhadap
hash yang sudah ada di database) adalah gerbang yang tidak boleh dilewati — kesalahan
di sana mengunci seluruh user secara permanen.
