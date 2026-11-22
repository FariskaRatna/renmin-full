# Catatan sesi 2026-11-22: dashboard LRA lengkap, R5H25 Master Data tahap, bug Inbox→disposisi

Sesi ini melanjutkan Subbagren. Tiga topik:

1. Dashboard myinterest menampilkan seluruh isi Excel (lanjutan R5H24).
2. **R5H25**: Superadmin bisa menyalakan/mematikan tahap pekerjaan (migrasi **067**). Dikerjakan lewat
   alur lengkap `/fitur` → `/rencana` → langkah 1–4 → `/verifikasi` → `/review` → perbaikan review.
3. Perbaikan bug lama: disposisi dari Inbox mendarat di halaman Arahan yang kosong.

Semua yang baru **khusus Express**.

## Posisi sekarang

| Hal | Keadaan |
|---|---|
| Repo (`sdl-express`, branch `main`) | `main` = `origin/main` = `6e20609`. R5H24 lanjutan (`d75d2c9`) dan R5H25 (`65b95b3`, `671ec04`, `7863ee5`, `6e20609`) **sudah di-commit dan di-push** oleh pemilik |
| Belum di-commit | Perbaikan hasil `/review` dan bug Inbox, 9 berkas: `master-tahap.js`, `app.js`, `security/scenarios/r5h25.js`, `API-CONTRACT.md`, `R2D5-SECURITY-TESTS.md`, `R5H25-…md`, `R5H23-…md`, `InboxSayaR5H10.tsx`, `TugasDisposisiR5F3.tsx`, ditambah catatan ini dan `R5H24-…md` |
| `origin/staging` | `6db831d` (20 Nov); 5 commit `main` belum di staging. Satu-satunya migrasi tertunda: **067** |
| Server produksi | **Tidak disentuh.** Deploy ditunda atas keputusan pemilik (boleh lanjut kerja dulu) |
| Syarat deploy berikut | Run workflow branch `staging` dengan ☑ **Izinkan migrasi database** (067). Rebuild `api` (manifes), `api-express`, `frontend`. Di log server-check, pastikan `SDL_EXPRESS_PATHS` memuat `/api/v1/admin/master/*` (atau `/api/*`) |
| Database laptop | Migrasi **067 sudah diterapkan**. Tabel saklar kosong (semua tahap aktif). Data uji verify (tahun 2093) sudah dibersihkan |
| Uji yang sudah jalan | Build frontend, build image Go (`go test`), suite keamanan Go PASS dan Express **22/22**, `npm run verify` (30/30, 18/18, 16/16), `verify/r5h25-master-tahap.js`, regresi `r5h13-flow`/`r5h21-flow`, uji Chrome (1440 terang/gelap, 390) |
| Uji yang BELUM jalan | Harness golden `compare`: butuh `harness seed-docs`, yang menghapus data latihan; **menunggu izin**. Golden diperkirakan tidak terdampak |
| Menunggu pemilik | Commit 9 berkas di atas; persetujuan edit CLAUDE.md (lihat bawah); izin harness; jadwal deploy |

## 1. Dashboard myinterest: semua isi Excel tampil (R5H24 lanjutan, `d75d2c9`)

Permintaan pengguna saat paparan: di dashboard harus kelihatan anggaran, realisasi, persen, dan
sisa, sehingga semua yang ada di Excel muncul.

- Panel donat diganti **"Anggaran dan Realisasi per Jenis Belanja"** (lebar penuh): donat tetap
  (komposisi realisasi) + tabel Pagu · Realisasi · % Realisasi (batang mini) · Sisa + Total; sorotan
  donat ↔ baris saling terhubung.
- Tabel baru **"Rincian per Kegiatan dan Jenis Belanja"** di bawah: baris kegiatan bisa dibuka
  per jenis belanja, ada tombol "Buka semua", dan saat dicetak semua rincian terbuka. Tabel rincian
  lama di `MyinterestR5H20.tsx` dihapus karena duplikat.
- Panel Serapan per Kegiatan menampilkan sisa. Nilai negatif (realisasi > pagu) aman ditampilkan.
- Tanpa perubahan backend (data per jenis sudah ada di API).

## 2. R5H25: Master Data tahap pekerjaan (migrasi 067)

Kebutuhan: pengguna menyebut daftar tahap sangat banyak dan banyak yang tidak terpakai;
pemilik ingin mengaturnya tanpa mengubah kode. Rincian ada di `docs/R5H25-MASTER-DATA-TAHAP-PEKERJAAN.md`.

**Keputusan pemilik:**

| Hal | Keputusan |
|---|---|
| Siapa yang mengatur | **Superadmin**, menu khusus Master Data. Saya menyarankan Kasubbagren karena pemisahan Superadmin↔operasional; pemilik memilih Superadmin. Tetap aman: hanya katalog, guard editor role |
| Cakupan | Tahap saja, tanpa urutan |
| Efek nonaktif | Tidak ditawarkan saat menambah tahap; tahap lama tetap utuh dan bisa diubah |
| Pengaman | Tahap syarat sistem dikunci (Revisi RPD "DIPA baru terbit"), minimal satu tahap aktif per jenis, alasan wajib, audit |
| K1–K11 | Disetujui berurutan per langkah: migrasi 067 / R5H15 → **068**; path `/api/v1/admin/master/tahap-pekerjaan` (di bawah pola Caddy R5H8, **tanpa ubah Caddy**); modul `modules/subbagren/master-tahap.js`; tab di halaman Master Data; field `nonaktif` aditif; `400 invalid_request` untuk field asing; PUT tanpa perubahan = 200 tanpa versi/audit; `FOR SHARE` di POST tahap; skenario keamanan `x1_` khusus Express |

**Dibangun:**
- Migrasi `067_master_tahap.sql` (hanya menyimpan pasangan NONAKTIF + satu baris versi), manifes Go/Express.
- `master-tahap.js` (GET/PUT, `tahapNonaktif`, `tolakNonaktif`). `JENIS_LABEL` dipindah ke
  `tahap-katalog.js` (+ `TAHAP_WAJIB`, `katalog(nonaktif)`). `perencanaan.js`: POST tahap menolak
  `409 tahap_nonaktif`, katalog memuat `nonaktif`.
- Frontend: `MasterDataTahapR5H25.tsx/.css` (tab "Subbagren (Tahap Pekerjaan)"), penyaringan pilihan
  tahap baru, label "nonaktif di Master Data", teks bantuan PDF sah mengikuti tahap pengesahan yang aktif.
- `verify/r5h25-master-tahap.js`, skenario `x1_r5h25_master_tahap_admin_guard`, bagian R5H25 di `API-CONTRACT.md`.

**Temuan `/review`** (tidak ada yang wajib), dikerjakan atas permintaan pemilik:
- Alasan berisi NUL atau surrogate tunggal dulu lolos validasi lalu ditolak JSONB Postgres, sehingga
  klien menerima **500**; ini dibuktikan pada kode lama. Sekarang `400 invalid_input`.
- Skenario keamanan diperluas: Origin asing, PUT saat `must_change_password`, role nonaktif, tanpa
  `identity.roles.manage`, seluruh validasi (termasuk `__proto__`), terkunci/minimal/versi, penegakan
  `tahap_nonaktif`, isi audit.
- Router R5H25 dipasang di path-nya sendiri, sehingga guard `/admin` kembali 2× seperti sebelum R5H25
  dan mount lama tidak diubah. GET membaca versi dan daftar dalam satu snapshot.

## 3. Bug: disposisi dari Inbox mendarat di Arahan kosong

- Penyebab: item disposisi di Inbox membuka `view:'arahan'`, padahal halaman Arahan sengaja menyaring
  disposisi surat (`!incomingId`).
- Perbaikan: Inbox membuka `view:'tasks'` dengan recordID `dispo:<id arahan>`; `TugasDisposisiR5F3`
  membuka lembar disposisinya setelah daftar termuat. Arahan biasa tidak berubah.
- Diuji di Chrome: staf-subbagren (menu Disposisi Subbagren) dan op-urmin (Disposisi Urmin) langsung
  melihat **Detail Disposisi**.

## 4. Lain-lain

- Disusun dua daftar pekerjaan seminggu terakhir (gaya bullet dan versi bahasa awam) untuk laporan pemilik.
- Sesi uji Playwright (`tokens.json` di scratchpad) berlaku 8 jam; ditambah sesi Superadmin (`mint-sa.cjs`).
  Superadmin masuk lewat **Manage → Master Data** di header.

## Langkah berikutnya

1. **Pemilik**: commit 9 berkas perbaikan. Usulan:
   - `fix(subbagren): validasi alasan & mount Master Data tahap; perluas uji keamanan R5H25`
   - `fix(frontend): disposisi dari Inbox dibuka di menu Disposisi`
2. **Deploy** saat siap: `staging` ← `main` (ff-only), Run workflow dengan *migrate* dicentang, lalu
   uji singkat. Superadmin: tab Tahap Pekerjaan tampil. Operator: tabel dashboard myinterest tampil.
   Jangan mematikan tahap di produksi sebelum disepakati dengan pengguna.
3. Harness golden `compare`, bila diizinkan (`seed-docs` menghapus data latihan).
4. Kandidat berikutnya: R5H15 Riwayat versi dokumen (migrasi 068); merapikan data uji
   [UJI]/[VERIFY] + data demo; apakah sumber surat harus diterima dulu (masih terbuka dari 11-19).
5. CLAUDE.md: usulan di bawah, menunggu persetujuan.
