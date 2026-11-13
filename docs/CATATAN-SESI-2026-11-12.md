# Catatan sesi 2026-11-11 s.d. 2026-11-12 — redesign UI (mockup)

Sesi ini hanya mengerjakan **tampilan**: audit UI frontend produksi dan prototipe
redesign di folder `mockup/`. **Tidak ada perubahan di `apps/`, backend, skema,
atau kontrak API.**

## Posisi sekarang

| Hal | Keadaan |
|---|---|
| Repo utama (`sdl-express`, branch `main`) | **Belum di-commit:** `docs/AUDIT-UI-2026-11-12.md` (baru), catatan ini. Juga belum di-commit tapi **bukan dari sesi ini**: `CLAUDE.md` (M), `.claude/`, `.github/workflows/claude-review.yml`, `design/` |
| Repo `mockup/` (git sendiri, `mockup-renmin`) | Folder `redesign/` seluruhnya **untracked**, belum di-commit/push |
| Server produksi | Tidak tersentuh. Tidak ada yang perlu di-deploy dari sesi ini |
| `apps/frontend/` | Tidak diubah. Porting desain baru **belum dimulai** — menunggu permintaan pemilik lewat `/rencana` → `/implementasi` |
| Menunggu pemilik | Lihat "Keputusan terbuka" di bawah |

**Sisa salinan konflik OneDrive** (`*-LTP-038*`) masih ada, tidak disentuh:
`apps/backend-express/harness/golden/_summary-LTP-038.json`,
`infra/docker-config/buildx/activity/default-LTP-038`, `mockup/.git/index-LTP-038`.
Yang di folder golden perlu dicek pemilik sebelum merekam/membandingkan harness.

## 1. Audit UI frontend produksi

- Hasil: `docs/AUDIT-UI-2026-11-12.md` — 45 temuan (file:baris), rasio kontras
  terhitung terang/gelap, 25 perbaikan cepat, inventaris semua footer + CSS-nya.
- Tiga masalah terbesar: (1) `--muted` #8191a4 hanya 3.0–3.2:1 dan 245 deklarasi
  teks <12px; (2) nilai klasifikasi `penting` tampil sebagai "Rahasia" **dan**
  "Penting" di layar berbeda (risiko salah baca kerahasiaan); (3) footer
  `position:fixed` + header sticky memakan ±22% layar ponsel, hamburger mati di
  761–900px.
- Temuan lain yang perlu diingat: logo hero Portal dimuat dari Wikimedia
  (`PortalV3R5F21.tsx:9`, gagal di jaringan internal); konfirmasi destruktif
  memfokuskan tombol setuju (`UIFeedback.tsx:52`); UI keputusan final Kabag di
  Disposisi disembunyikan (`TugasDisposisiR5F3.tsx:475-483`).

## 2. Prototipe redesign — `mockup/redesign/index.html`

Satu file HTML mandiri (CSS/JS inline, tanpa aset luar), 8+ halaman:
login, Portal, Urmin (dashboard, surat masuk + detail, surat keluar, disposisi),
dashboard Subbagren/Subbagsumda/Subbagbinfung, Pengguna & Role (Superadmin),
**Dashboard Pimpinan**. Light/dark, 320–1440px, keadaan memuat/kosong/error.
Diuji di headless Chrome per halaman (tanpa error JS, tanpa scroll horizontal,
tanpa teks <12px).

Cara buka: `cd mockup && python -m http.server 8777` →
`http://127.0.0.1:8777/redesign/`. Peran ditentukan dari username saat login
(password/OTP bebas): mengandung `hendra`/`kabag` → Kabagrenmin, `admin` →
Superadmin, lainnya → Operator Urmin. Bilah prototipe (simulasi keadaan data)
tersembunyi, muncul dengan **Alt+Shift+P**.

File lain di `mockup/redesign/`: `index-v3.html` + `rd.css` + `rd.js` (arsip
redesign v3 yang ditolak), `DESAIN.md` (alasan desain v3 + acuan ISO/BNPT),
`logo-densus88.png`, `foto-login/` (3 foto + `BACA.md` berisi sumber & lisensi).

### Keputusan desain pemilik (berlaku untuk porting nanti)

| Topik | Keputusan |
|---|---|
| Arah umum | Penyempurnaan dari tampilan produksi, **bukan desain ulang**. Redesign v3 (sidebar tunggal, gradasi, emas) ditolak sebagai "terlalu generic AI" |
| Warna | Netral/monokrom, satu warna merek navy. **Semua emas/cokelat dihapus** (garis aktif, tautan, eyebrow, warna unit Binfung). Warna lain hanya untuk status |
| Wordmark | "SIERA DELTA LIMA" **satu warna** |
| Logo | Lambang Densus 88 (`/logo.png`, lokal) di header dan login; **tidak** di pita Portal |
| Header | Bentuk & ukuran = produksi (teks nav 12px/700, tombol 38px, ikon 17px/1.7, avatar 30px). Tanpa lonceng & tanpa search. Item aktif = pil + bingkai `--border-input` (tanpa garis emas). Label Bahasa Indonesia |
| Footer | Dihapus: `.sdl-footer` global, `.auth-hero-foot`, footer pemilih Subbagren, `.sumda-list-footer` (keterangan "100 data terbaru" pindah ke pager) |
| Login | Kartu di tengah, tanpa label "Langkah", kredensial → kode OTP otomatis, versi `SIERA DELTA LIMA v0.1.0 · 2026` di kanan bawah (versi dari `package.json` saat porting). Latar: 3 foto Densus (wajah tertutup) **hitam-putih + blur + lapisan navy**, berganti tiap 6 detik |
| Portal | Kepala = **pita navy datar** (±105px, sebelumnya hero 217px) berisi judul + slogan, tanpa tanggal/peran/logo. Tab = blok segmented (aktif berisi navy). Tile unit & label kategori monokrom |
| Tipografi | Skala 12/13/14/16/20/24(28); tidak ada teks <12px; nav 12px atas permintaan pemilik |
| Token | `--muted` #5f6f84 (5.13:1), `--focus` #2f5f9e/#8fb6e8, `--border-input` #76869a/#6b7f99 |
| Grafik (Dashboard Pimpinan) | Palet status khusus grafik `#0ca30c` / `#3987e5` / `#d03b3b` (lolos `validate_palette.js` terang+gelap), satu sumbu, legenda + tabel + tooltip keyboard |

### Foto login

Dari Wikimedia Commons, lisensi bebas (1 × CC0, 2 × domain publik Tribrata
News Polri). Ditolak: foto dengan wajah warga sipil terlihat, dan foto lokasi
serangan Thamrin 2016. `3.jpg` hanya 600px — ganti dengan foto resmi Humas
sebelum produksi. Detail di `mockup/redesign/foto-login/BACA.md`.

## 3. Catatan alat

- Hook `guard-files.sh` sempat gagal di awal sesi (Git Bash tidak ditemukan),
  sehingga file `mockup/redesign/` v3 ditulis lewat PowerShell atas izin pemilik.
  Di tengah sesi hook kembali berfungsi; sisa pekerjaan memakai Edit/Write biasa.
- Panduan BNPT (`design/…BNPT…pdf`) dibaca lewat `pypdf` yang dipasang di
  scratchpad sesi (bukan di proyek). Dipakai sebagai referensi prinsip saja.

## Keputusan terbuka (menunggu pemilik)

1. Label klasifikasi Sumda/Binfung/Usulan: "Penting" (produksi) atau "Rahasia"
   (prototipe, seragam dengan Surat Masuk)?
2. Warna status "menunggu" (`--st-warn` #8a5a12, amber-cokelat): biarkan, atau
   ganti abu gelap + ikon jam?
3. Dialog password sementara tidak bisa ditutup Esc — setuju?
4. Tile SPIP membuka Subbagbinfung (bukan halaman "sedang disiapkan") — setuju?
5. Sidebar unit selain Urmin hanya berisi "Dashboard" di prototipe — tampilkan
   modul di sidebar seperti Urmin?
6. Disposisi: UI keputusan final Kabag disembunyikan di produksi → alur buntu.
7. Toolbar filter Disposisi di prototipe menyisakan ruang kosong di kiri — perlu
   dirapikan sebelum porting.

## Langkah berikutnya

1. Pemilik meninjau `mockup/redesign/` (dan mempresentasikan Dashboard Pimpinan).
2. Commit: `docs/AUDIT-UI-2026-11-12.md` + catatan ini di repo utama; folder
   `redesign/` di repo `mockup/` (pertimbangkan Deployment Protection sebelum
   deploy Vercel — prototipe memuat lambang resmi dan foto personel).
3. Bila disetujui, porting bertahap lewat `/rencana`:
   (a) token `style.css` (`--muted`, `--focus`, `--border-input`) — dampak
   terbesar, risiko rendah; (b) label klasifikasi seragam; (c) header + hapus
   footer (bersihkan aturan tinggi sidebar `PortalRefresh.css:104-166`);
   (d) login; (e) Portal; (f) Dashboard Pimpinan.
4. Perbarui `docs/UIUX-DESIGN-SYSTEM.md` mengikuti keputusan di atas (usulan di
   bawah, menunggu persetujuan).
