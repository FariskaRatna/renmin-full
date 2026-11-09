# Catatan sesi 2026-11-04 — uji alur, R5H4, dan persiapan peralihan ke Express

Ringkasan percakapan dengan Claude Code. Rincian teknis ada di dokumen yang
dirujuk; catatan ini merekam **apa yang diminta, apa yang diputuskan, dan di
mana posisinya sekarang**.

## 1. Pengujian tiga alur

Permintaan: uji (1) surat masuk sampai disposisi, (2) surat keluar sampai
disposisi, (3) disposisi dari Kabagrenmin ke staf.

- **Lewat API, Go dan Express**: semua lulus, kecuali disposisi berjenjang
  Kasubbag → staf (403). Sebabnya konfigurasi: tidak ada role yang memegang
  `urmin.disposisi.issue/execute/review/forward`
  (`PERTANYAAN-KONFIGURASI-AKSES.md`, Pertanyaan 1, masih menunggu keputusan).
- **Surat keluar tidak punya tahap disposisi.** Alurnya draf → ajukan (wajib
  PDF) → tolak/revisi → setujui → terkunci. Kaitannya ke disposisi hanya field
  `rujukanArahan`.
- **Lewat browser** (Chrome yang digerakkan otomatis, terlihat di layar):
  ketiga alur dijalankan dan bisa ditonton. Saat itu Kabag hanya bisa
  mengirim ke 4 Kasubbag, bukan langsung ke staf.

Temuan kecil: satu kali layar Kabag putih/crash (tidak terulang); modal Surat
Keluar tidak tertutup dengan Escape.

## 2. Perubahan R5H4 — arahan ke jabatan, seluruh bagian, atau Paur

Keputusan pemilik sistem dalam sesi ini:

| Pertanyaan | Keputusan |
|---|---|
| Arti memilih tujuan | Kasubbag = kepala saja; bagian = kepala + semua staf; Paur = anggota Paur |
| Subbagsumda | Tetap ada sebagai bagian, **ditambah** tiga Paur: Sumda, Log, ADA |
| Klasifikasi Rahasia | Arahan sampai ke **semua** anggota; **naskah surat** tetap hanya untuk yang berwenang (aturan akses Urmin tidak diubah) |
| Pengisian anggota Paur | Lewat menu Pengguna (Superadmin), tab Paur |
| Tampilan untuk staf | Arahan muncul di menu Arahan **dan** digabung ke daftar Tugas Disposisi |

Dikerjakan di Go dan Express bersamaan: migrasi `043_arahan_paur.sql`, 11
pilihan tujuan, endpoint baru `GET /admin/paur` dan
`PUT /admin/users/{id}/paur`, serta tiga layar frontend.
Detail: `docs/R5H4-ARAHAN-BAGIAN-PAUR.md` dan `API-CONTRACT.md`.

Verifikasi: `verify/r5h4-flow.js` dan `verify/r5h1-flow.js` lulus di kedua
backend (respons byte-identik), `go test ./...` hijau, suite keamanan 21/21
dan 21/21, demo browser 6/6.

## 3. Deploy dan peralihan ke Express

Pemilik ingin produksi (172.16.173.34) beralih dari Go ke Express;
`api-express` **belum pernah dijalankan** di server.

Disiapkan dan digladi di lokal (Caddy HTTPS seperti server):

- Caddyfile kini bisa memecah per prefix lewat `SDL_EXPRESS_PATHS` di `.env`.
- `infra/compose.email-express.yaml` untuk memindahkan worker email. Dibuat
  karena worker Go ternyata tidak bisa dimatikan lewat `.env`.
- Golden direkam ulang dari Go, Express cocok **431/431**. Login HTTPS dan 25
  langkah UI lulus lewat Express **dengan Go dimatikan**. Rollback teruji.

Runbook server: **`docs/PERALIHAN-EXPRESS-PRODUKSI.md`**.

## Posisi sekarang / langkah berikutnya

> Diperbarui akhir sesi 2026-11-04 (±23.30 WIB). Rincian tiap perubahan ada di
> bagian 4 di bawah.

### Deploy ke server 172.16.173.34

Perlengkapan deploy dibuat sesi ini: `docs/DEPLOY-SERVER.md` (Fase 1 + bagian
"Deploy ulang"), `scripts/package-release.sh`, `scripts/server-backup.sh`,
`scripts/server-check.sh pre|post`. Fakta server: folder di
`~/renmin/1.siera-delta-lima`, user `devops`, produksi sebelumnya di migrasi
**033** (nama ledger berprefiks `sql/`).

- [x] Fase 1 deploy pertama (paket `sdl-release-20261104-2137`): backup
      `~/sdl-backup/20261104-144435`, migrasi 034–043, `api-express` berdampingan.
      Pemilik melaporkan **selesai**; keluaran `server-check.sh post` **belum
      dilihat** — minta di awal sesi berikutnya.
- [ ] **Deploy ulang frontend** dengan `sdl-release-20261104-2331` (hanya
      `frontend`, tanpa `-migrate`) — panduan sudah diberikan, belum dijalankan.
- [ ] Setelah deploy: isi anggota Paur lewat menu Pengguna (Superadmin, tab Paur).
- [ ] Fase 2: alihkan prefix bertahap ke Express (5 langkah), lalu Fase 3
      worker email.

### Keputusan yang masih ditunggu dari pemilik

- [ ] **HAM.1.2.** — kemungkinan besar maksudnya HUM.1.2. (BUKU TAMU) yang sudah
      ada. Kalau memang kode HAM baru, perlu nama perkaranya → migrasi 044.
- [ ] `SDL_DEV_SUPERADMIN_WORKSPACE=true` di produksi (status melaporkan
      `demoSuperadminWorkspace:true`) — dimatikan atau tidak.
- [ ] Disposisi berjenjang (`PERTANYAAN-KONFIGURASI-AKSES.md`).
- [ ] Apakah staf (bukan hanya ka-urmin) juga menerima kiriman surat asal saat
      arahan ditujukan ke bagian — perubahan aturan backend.

### Utang teknis / setelah paritas

- [ ] Cari surat keluar lewat angka register (perlu backend, kedua sisi).
- [ ] Rekam ulang golden untuk endpoint 153–157 (belum masuk harness).
- [ ] Temuan UI lama: layar Kabag sempat putih sekali; modal Surat Keluar tidak
      tertutup dengan Escape.

## Keadaan lingkungan lokal setelah sesi

- Database lokal sudah di-`seed-docs` oleh harness: data dokumen adalah
  fixture, dan role lokal mendapat **izin disposisi khusus harness** (bukan
  konfigurasi produksi).
- `staf-subbagsumda` ada di Paur Sumda, `op-subbagsumda` kepala Paur Log.
- Ada akun uji gladi: `gladi-go`, `gladi-express`.
- Golden file lama dicadangkan di scratchpad sesi (sementara).
- Data demo malam ini ada di DB lokal: surat `DEMO-A/…`, arahan "Arahan demo …"
  dan "Arahan umum …", draf surat keluar "Uji kode otomatis …". Frontend lokal
  sudah memuat semua perubahan bagian 4.

## 4. Tambahan malam — dua perubahan frontend (tanpa perubahan API/DB)

Keputusan pemilik sistem:

| Hal | Keputusan |
|---|---|
| Penerimaan surat | **Membuka detail = menerima**, untuk **semua penerima** (bukan hanya Kabagrenmin). Alasan baku `Diterima saat membuka detail` tercatat di riwayat dan audit |
| Rujukan Surat Keluar | **Rujukan Surat mengikuti Rujukan Arahan**: arahan yang berasal dari surat (`incomingId`) mengisi dan mengunci Rujukan Surat; arahan tanpa surat membiarkan pilihan manual |

Berkas: `SuratMasuk.tsx` (layar yang dipakai Kabag dan penerima lain, termasuk
tombol "Inbox"), `InboxDistribusiR5F2.tsx` (form alasan dihapus; kini hanya
dipakai tab Riwayat Penerimaan), `UrminR5D.tsx` (Rujukan Arahan dipindah ke
depan Rujukan Surat). Endpoint 112 tetap dipanggil dengan alasan baku — kontrak
API tidak berubah, golden tidak terpengaruh.

Verifikasi: `npm run build` lulus; demo browser 13/13 (Kabag dan ka-urmin
menerima otomatis lewat Detail, Rujukan Surat terkunci/terbuka sesuai arahan).

Catatan: surat asal arahan ke bagian Urmin diserahkan ke **ka-urmin**, bukan ke
staf — aturan penerima distribusi yang sudah ada (`recipientEligible`).

Masih terbuka: kode arsip **HAM.1.2.** menunggu nama perkaranya (migrasi 044).
Pertanyaan "hanya undangan?" terjawab: semua jenis surat bisa dikaitkan ke
arahan; syaratnya surat sudah diterima Kabag — kini otomatis saat dibuka.

Tambahan: pemilih **Surat terkait** di layar Buat Arahan kini punya kotak cari
(nomor surat, perihal, pengirim, atau agenda; Enter memilih bila hasilnya satu,
Escape menutup). Penyaringan di layar atas daftar `/letters` yang sudah dimuat
(maks. 100) — tidak ada endpoint baru. `DirectivesR5F23.tsx` + `.css`.

Tambahan: **Kode Register Internal surat keluar dibangkitkan otomatis**
(`SK-YYYYMMDD-HHMMSS-XXXX`, pola sama dengan Kode Agenda R5G4) dan tampil
sebagai teks, bukan isian. Nomor surat memang sudah otomatis sejak R5G13 dari
satu deret per tahun (`sdl_surat_nomor_urut`, kunci `tahun` saja) yang dipakai
bersama semua subbag; subbag hanya menentukan segmen terakhir lewat Lingkup
Surat. Diuji: draf tersimpan `SK-20261104-231919-E412` dengan nomor
`B/ND-3/XI/HUM.1.2./2026/Bagrenmin`. Empat kode galat penyusun nomor
(`derajat_required` dll.) kini diterjemahkan; sebelumnya tampil mentah.

"HAM.1.2." kemungkinan besar maksudnya **HUM.1.2. (BUKU TAMU)** — sudah ada di
master sejak 037 dan dipakai sebagai contoh di permintaan asli. Kode berprefiks
HAM tidak ada di berkas sumber xlsx. Menunggu konfirmasi pemilik.

Koreksi pemilik: **Kode Register = nomor urut pada nomor surat** (`B/ND-157/...`
→ `157`). Ditampilkan begitu di daftar dan form (`nomorUrut()` di
`UrminR5D.tsx`); sebelum disimpan tertulis "Terbit otomatis setelah disimpan".
`ref_code` yang tersimpan tetap kunci teknis `SK-…` karena (a) nomor baru ada
setelah backend menyimpan, (b) angka urut berulang tiap tahun sementara
`ref_code` unik per kind (indeks 023), (c) kontrak API beku. Konsekuensi: kotak
cari daftar (server, `title`/`ref_code`) belum menemukan surat lewat angka
register — kalau dibutuhkan, itu perubahan backend di kedua sisi.
