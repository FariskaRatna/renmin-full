# Catatan sesi 2026-11-24: Subbagsumda R5H30, R5H31, R5H32

Sesi panjang (berlanjut dari 2026-11-23) yang menuntaskan menu Subbagsumda sesuai referensi
`docs/reference/Subbagsumda.html`. Tiga rilis, masing-masing lewat alur penuh `/fitur` → `/rencana` →
`/implementasi` → `/verifikasi` → `/review` → perbaikan review → PR oleh pemilik:

1. **R5H30** Cuti & Perizinan + Kesejahteraan (migrasi **071**) — PR #6.
2. **R5H31** Kinerja & Pembinaan + Inventaris/BMN (migrasi **072**) — PR #7.
3. **R5H32** Persuratan & Arsip + Laporan & Analitik (migrasi **073**), ditambah sidebar Sumda mengikuti referensi — PR #8.

Semuanya **khusus Express**; Go hanya menerima berkas migrasi, manifes, dan seed.

## Posisi sekarang

| Hal | Keadaan |
|---|---|
| Repo (`sdl-express`, branch `main`) | `main` = `origin/main` = `fdc9772` (merge PR #8). R5H27–R5H32 semuanya sudah di `main` |
| Belum di-commit | Catatan ini + perbaikan baris Status dokumen rilis R5H27–R5H32 |
| `origin/staging` | `172f831` (merge PR #3, R5H28; migrasi terakhir **069**). 42 commit `main` belum di staging. Migrasi tertunda untuk deploy: **070, 071, 072, 073** |
| Server produksi | **Tidak disentuh** sesi ini |
| Syarat deploy berikut | Workflow `staging` dengan ☑ **Izinkan migrasi database** (070–073). Rebuild `api` (manifes), `api-express`, `frontend`. Cek `SDL_EVIDENCE_KEY` produksi sah (lampiran PDF fail-closed). `/api/v1/subbagsumda/*` sudah di `SDL_EXPRESS_PATHS` |
| Database laptop | Migrasi sampai **073** sudah diterapkan. Data demo yang tertinggal: surat `[UJI] Pemberitahuan SK pensiun personel` + arsipnya (Musnah). Data uji verify (`UJI-R5H3*-`) dibersihkan otomatis |
| Uji yang sudah jalan (R5H32) | Build frontend, build image Go (`go test`), `npm run verify`, verify R5H27–R5H32 (R5H32: 140/0), suite Go PASS, suite Express **28/28**, uji mutasi 9 celah (masing-masing hanya x7 merah), demo Edge 1440/390 + cetak |
| Uji yang BELUM jalan | Harness golden: 127 `/admin/permissions` & 128 `/admin/roles` berubah karena permission 071–073 → **rekam ulang oleh pemilik** (butuh `seed-docs`, menghapus data latihan) |
| Menunggu pemilik | Persetujuan edit CLAUDE.md (usulan di bawah); rekam ulang golden; jadwal deploy; konfirmasi aturan bisnis sementara (K29–K49 R5H32, K43-style R5H30/R5H31) setelah paparan ke pengguna |

## 1. R5H30 — Cuti & Perizinan + Kesejahteraan (migrasi 071, PR #6)

- Pengajuan cuti (Tahunan/Sakit/Alasan penting/Besar/Lainnya) dengan jatah 12 hari tahunan, hitung hari kerja +
  peringatan, kalender ketidakhadiran; diputus Kasubbagsumda.
- Layanan kesejahteraan (persiapan pensiun, MPP, ASABRI, kartu identitas, lainnya); keputusan bisa menerapkan status
  ke Master Personel (konfirmasi).
- **Prinsip K43 R5H30** (dipakai lagi di R5H31/R5H32): migrasi hanya aturan struktural; aturan bisnis di Express,
  karena pemilik akan memaparkan sistem ke pengguna sebelum alurnya pasti.
- Catatan cuti Sakit dan lampirannya disamarkan di SQL bagi yang tidak berhak; maker-checker "pernah mengubah".

## 2. R5H31 — Kinerja & Pembinaan + Inventaris/BMN (migrasi 072, PR #7)

- Penilaian kinerja per periode (Draft → Diajukan → Disetujui/Selesai) + tindak lanjut pembinaan; isi penilaian hanya
  untuk pencatat dan pemegang `kinerja.read` (disamarkan di SQL).
- Inventaris/BMN menggantikan registry lama: kode BMN, kondisi, PJ, jadwal & riwayat pemeliharaan, usulan penghapusan
  diputus Kasubbag (bukan pengusul, lampiran wajib sejak usulan). DEVIATIONS **B10** (executive `assets_care` tetap
  menghitung registry lama).
- Pelajaran review S1: angka agregat yang terlihat semua pembaca bisa membocorkan data tersamar lewat korelasi → angka
  hanya bagi pemegang hak, selainnya `null`.

## 3. R5H32 — Persuratan & Arsip + Laporan & Analitik (migrasi 073, PR #8)

Dokumen: `docs/R5H32-SUMDA-ARSIP-LAPORAN.md` (K1–K51).

- **Persuratan & Arsip:** register arsip dokumen (SK, nota dinas, surat eksternal, berita acara) — lokasi simpan,
  retensi (tanda ≤ 30 hari), PDF tersegel (peran DOKUMEN/BA_MUSNAH), tautan ke Surat Masuk/Keluar R5H21 yang sudah
  dikirim/diterima (satu surat satu arsip, kunci baris), Aktif ⇄ Inaktif → Musnah (Kasubbag, alasan + BA).
- **Arsip Terbatas (K29):** tersembunyi utuh bagi selain pencatat/Kasubbag/Kabag — tidak tampil, tidak dihitung,
  404 identik UUID fiktif; diputus dengan satu predikat `bolehArsip` di SQL di semua jalur (daftar, detail, lampiran,
  detail personel, dashboard, analitik, ekspor).
- **Laporan & Analitik:** ringkasan + grafik lintas modul dalam satu transaksi baca; blok kinerja/aset/arsip `null`
  tanpa haknya; ringkasan register; cetak browser (gaya cetak dicakup kelas body). **Ekspor CSV** 10 modul hanya
  Kasubbag/Kabag: BOM, `;`, penangkal formula, tanpa catatan/teks bebas, maks. 10.000 baris (413), audit
  `{modul,jumlah,filter}` sebelum kirim.
- `surat_id` **tanpa FK**: gladi membuktikan `TRUNCATE sdl_urmin_registry CASCADE` (harness) merambat ke `sdl_surat_antar`;
  dengan FK seluruh arsip ikut terhapus.
- **Keputusan baru sesi ini:**
  - K29–K49 disetujui **sementara** ("oke lanjut ke /implementasi").
  - **K50:** sidebar Sumda disamakan dengan referensi — WORKSPACE (Dashboard, Master Personel, Monitoring Pensiun) ·
    ADMINISTRASI SDM (Karier, Diklat, Cuti, Kesejahteraan, Kinerja) · DUKUNGAN & LAPORAN (Inventaris/BMN, Persuratan &
    Arsip, Laporan). Surat Masuk/Keluar jadi **tab** di Persuratan & Arsip (badge pindah; rute lama tetap). Inbox
    Distribusi, Disposisi, dan Berkas, Foto & Disposisi dihapus dari sidebar Sumda (ada di header / tautan darurat).
  - **K51** (review S1): menautkan surat ke arsip Terbatas hanya oleh pemegang `arsip.restricted`. Sisa yang diterima:
    bila Kasubbag sendiri menautkannya, kesimpulan "surat ini subjek arsip rahasia" masih mungkin bagi pemegang
    persuratan. Penutupan penuh (arsip Terbatas tanpa tautan surat) belum diambil.
- Perbaikan review lain: S2 surat tidak lagi sah tidak ditampilkan, S3 `suratId` hanya bagi pemegang persuratan, S4
  penangkal formula diperkuat (NFKC, spasi/baris baru di depan), S5 ekspor dengan `statement_timeout`; S6 (nama/NRP
  bagi role kustom tanpa `personel.read`) diterima sebagai keputusan.

## Catatan kerja

- Uji mutasi: commit dulu, salin cadangan ke scratchpad, mutasi, jalankan suite, pulihkan dari cadangan, `git diff --stat`
  = 0. Jangan `git checkout --` (bisa menghapus perbaikan yang belum di-commit).
- Skenario keamanan x6/x7 memundurkan stempel CAPTCHA di awal (batas 60/menit per IP lintas suite).
- Frontend lokal: `SDL_API_UPSTREAM=http://api-express:8080 docker compose … up -d --build --wait frontend`;
  container frontend harus dibangun ulang setelah mengubah `App.tsx`.
- Kalimat "Disposisi Kabagrenmin ada di menu **Disposisi**" di layar Surat Masuk R5H21 kini merujuk tombol **Tasks** di
  header untuk Sumda; dipakai bersama tiga subbag, belum diubah.

## Langkah berikutnya

1. Pemilik menyetujui (atau mengubah) usulan perubahan CLAUDE.md di bawah.
2. Rekam ulang golden 127/128 (satu siklus penuh; `seed-docs` menghapus data latihan).
3. Deploy ke staging → produksi dengan ☑ Izinkan migrasi (070–073); rebuild `api`, `api-express`, `frontend`.
4. Paparan ke pengguna; tetapkan aturan bisnis yang masih sementara (R5H30–R5H32), termasuk opsi penutupan penuh K51.
5. R5H15 (riwayat versi dokumen Subbagren) kini memakai migrasi **074**.
