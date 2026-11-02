# Rencana Migrasi Backend: Go → Express

> Pendamping `API-CONTRACT.md`. Dokumen itu menjawab **"apa yang harus sama"**;
> dokumen ini menjawab **"dengan urutan apa, dan kapan boleh dianggap selesai"**.

---

## LANJUT DARI SINI

*Diperbarui 2026-11-01 (sesi kedua). Baca bagian ini lebih dulu sebelum
menyentuh kode.*

### Keadaan saat sesi 2026-11-01 berhenti

| Hal | Keadaan |
|---|---|
| Endpoint | **142/142 diporting, ke-142 cocok dengan baseline Go.** Paritas fungsional tercapai |
| Harness | **382 kasus, 0 dilewati, 0 beda**, 142/142 endpoint tersentuh — termasuk **51 varian jalur tulis** |
| Jalur tulis | **Tuntas.** Tiga endpoint multipart terakhir (69, 103, 109) masuk 2026-11-01 |
| Timestamp | **D4 selesai.** `verify/timestamp-parity.js` — 79/79 byte-identik. Harness buta terhadap kelas ini; alat itu yang menjaganya |
| Uji keamanan | **Diporting 2026-11-01, 21/21 LULUS** dan diuji-mutasi. `scripts/security-test-express.sh`. Harness bukan penggantinya — ia mengukur bentuk, bukan siapa yang berhak |
| Perkakas siklus hidup | **Keempatnya diporting 2026-11-01** dan diuji A/B terhadap Go. `apps/backend/` tidak lagi dibutuhkan untuk membangun database baru |
| Worker email | **Tahap 5 selesai.** Diporting, diverifikasi 16/16 (isi email byte-identik) + 9/9 (mesin keadaan outbox). **Default MATI** — lihat penjaga aturan 7 |
| Database | `sdl_root_dev` di volume `sdl-foundation-r1_sdl_root_r1_pgdata` — ditinggalkan **tepat sesudah `seed-docs`** (bersih, 2026-11-01) |
| Golden file | direkam ulang dari Go 2026-11-01 **setelah** `seed-docs`, valid — mencakup tiga varian multipart baru |
| Snapshot pra-mutasi | `pg_dump -Fc` sempat diambil ke scratchpad sesi; **tidak permanen**, jangan diandalkan |

**Langkah pertama saat melanjutkan:** nyalakan Docker Desktop, tunggu engine
siap, lalu jalankan `harness seed-docs` sebelum apa pun yang membandingkan.
Database sekarang memuat keadaan sisa compare, bukan fixture bersih.

**Tidak ada endpoint yang tersisa, dan tidak ada lagi mesin otorisasi yang
belum pernah menulis.** Engine B akhirnya terbukti lewat mutasi yang berhasil.
Yang tersisa:

1. **Tiga pertanyaan konfigurasi yang masih menunggu pemilik sistem** —
   permission disposisi, scope anggaran, permission usulan. Ketiganya
   membuat kode yang benar tidak terjangkau akun mana pun, dan harness
   menambalnya khusus uji. Tidak memblokir cutover secara teknis, tapi
   memblokir kegunaan fiturnya di lapangan.

   **Sudah dirumuskan menjadi dokumen keputusan 2026-11-01:**
   [`docs/PERTANYAAN-KONFIGURASI-AKSES.md`](../../../docs/PERTANYAAN-KONFIGURASI-AKSES.md)
   (di root repo, bahasa non-teknis, siap dikirim ke pemilik sistem).
   Dampaknya ikut **diukur**, bukan diperkirakan: peta permission produksi
   direkonstruksi dari `cmd/seed-bagrenmin`, tambalan harness dihapus dari
   database percobaan, lalu 142 endpoint dijalankan dua kali terhadap **Go**.
   Hasilnya **27 endpoint** hijau-dengan-tambalan dan mati-tanpa-tambalan:
   usulan 7/10, budget 9/11, dispositions 10/11, plus endpoint 115.

   Satu detail metodologi yang menentukan angkanya: **400 tidak dihitung
   sebagai "diblokir"**. Kasus dasar mengirim body `{}`, dan 400 justru
   berarti permintaannya SAMPAI ke handler. Menghitungnya akan memberi 47,
   bukan 27. Yang dipakai hanya selisih hijau→tidak-hijau antar dua rekaman.

   Gejalanya di lapangan **bukan pesan error**: `GET /subbagren/usulan/`
   menjawab `200 {"items":[]}` dan `capabilities` menjawab semua `false`,
   jadi layar tampak kosong dengan tombol mati — persis seperti sistem yang
   memang belum ada datanya. Itu sebabnya ia tidak pernah dilaporkan.

   **B8 dan B9 sudah selesai 2026-11-01** di kedua backend atas persetujuan
   pemilik sistem; alur persetujuan surat keluar kini benar-benar jalan
   dengan konfigurasi seed apa adanya. Lihat
   [Dua temuan dari varian Engine B](#dua-temuan-dari-varian-engine-b).
2. ~~**Perkakas siklus hidup.**~~ **SELESAI 2026-11-01.** Keempatnya ada di
   Express dan diuji A/B terhadap Go:

   | Perkakas | Lokasi Express | Pembuktian |
   |---|---|---|
   | `--migrate` | `src/migrations/` + `src/server.js` | Go `-migrate` menerima DB hasil Express tanpa menerapkan ulang |
   | `--bootstrap-superadmin` | `src/cli/bootstrap-superadmin.js` | hash-nya diverifikasi `auth.VerifyPassword` Go (true/false) |
   | `seed-bagrenmin` | `src/cli/seed-bagrenmin.js` | **171/171 baris keadaan identik** dengan hasil Go |
   | `reset-all-passwords` | `src/cli/reset-all-passwords.js` | **7/7 baris identik**; seluruh penolakan + kode keluar sama |

   Dijalankan lewat `infra/compose.express-cli.yaml`, yang memakai image
   `api-express` yang SAMA dengan server — bukan image per-perkakas. Di Go
   tiap perkakas biner terpisah karena begitu cara Go dipaketkan; di Node
   seluruh `src/` sudah ada di satu image, dan image kedua hanya menambah
   hal yang bisa tertinggal versinya.

   **Urutan flag ikut direplikasi, dan itu bukan detail kosmetik:** Go
   membaca `SDL_AUTH_SECRET` SESUDAH cabang `--migrate` dan
   `--bootstrap-superadmin` (main.go:96). Express semula memanggil
   `loadConfig()` lebih dulu, yang akan menuntut secret untuk pekerjaan yang
   tidak memerlukannya — persis di lingkungan database baru yang belum punya
   secret. Sudah dibetulkan.

   Roster 13 akun + 13 role **diverifikasi silang secara mekanis** terhadap
   source Go (parse `var accounts` / `var roles`, bandingkan field demi
   field, 91 permission) — bukan dipercaya hasil ketikan.

   Runner migrasinya sendiri diporting lebih dulu karena suite keamanan
   membutuhkannya. Ia membaca 33 SQL yang sama (aturan 6: tidak disalin),
   yang kini ikut masuk image lewat `additional_contexts` di
   `compose.express.yaml` — padanan `//go:embed`. Tanpa itu `--migrate` hanya
   berguna dari checkout source. Empat detail yang menentukan:

   - `filename` disimpan BERIKUT prefiks `sql/`, karena `fs.Glob` Go
     mengembalikan jalur ber-prefiks. Basename saja → Go melaporkan seluruh
     33 migrasi hilang.
   - checksum sha256 atas **byte mentah**; membaca sebagai string lalu
     menormalkan akhir baris mengubahnya.
   - SELURUH berkas dalam **SATU** transaksi, bukan satu per berkas.
   - SQL dikirim tanpa parameter supaya `pg` memakai simple query protocol —
     padanan `pgx.QueryExecModeSimpleProtocol`. Satu berkas memuat banyak
     pernyataan DDL dan extended protocol hanya menerima satu.

   Satu perubahan perilaku start yang disengaja: Express kini menjalankan
   `verify()` PENUH (33 berkas hadir **dan** checksum cocok), bukan lagi
   sekadar memeriksa ledger-nya ada. Itu menyamakannya dengan Go, yang
   menolak menyala di atas skema yang bergeser.

3. **Tahap 6 — peralihan Caddy per prefix.** Belum disentuh — **satu-satunya
   pekerjaan teknis yang tersisa sebelum cutover.**

   Yang masih menunggu di luar teknis: jawaban pemilik sistem atas
   `docs/PERTANYAAN-KONFIGURASI-AKSES.md`.

**Suite keamanan diporting 2026-11-01 — 21/21 LULUS.**
`apps/backend-express/security/` + `scripts/security-test-express.sh`, port
satu-lawan-satu dari `internal/securitytest` dengan nama skenario identik.

Alasannya bukan kerapian: **suite Go tetap hijau sambil berhenti relevan**
begitu satu prefix dialihkan ke Express. Ia tidak akan merah, ia hanya tidak
lagi menguji backend yang melayani — dan kegagalan diam seperti itu persis
yang tidak boleh dibiarkan ada di lapisan otorisasi.

Suite-nya **diuji-mutasi**, bukan sekadar dijalankan sampai hijau: menghapus
allowlist `Origin` membuat skenario 03 merah dan hanya 03; menghapus
penolakan Superadmin dari endpoint operasional membuat **7 skenario** merah
sekaligus. Keduanya dipulihkan. Suite yang lulus percobaan pertama tanpa
pernah dibuktikan bisa merah tidak membuktikan apa-apa.

Dijalankan **di dalam proses** lewat `createApp()`, padanan
`httptest.NewServer` di Go — jadi ia menguji kode di working tree, bukan image
`api-express` yang terakhir di-build.

**Tahap 5 (worker email) selesai 2026-11-01**, berikut penjaga aturan 7-nya.
Lihat [Tahap 5](#tahap-5--worker-latar--selesai-2026-11-01).

### Tiga cacat yang ditemukan saat memporting perkakas, semuanya sudah dibetulkan

Ketiganya tidak terlihat harness, dan dua di antaranya ada di kode produksi:

1. **`loadConfig(env)` mengabaikan parameternya.** `hexKey()` di dalamnya
   membaca `process.env`, bukan `env` yang diteruskan. Tak terlihat di
   produksi (yang memang memanggilnya dengan `process.env`); langsung
   tertabrak suite keamanan yang menyuntik konfigurasinya sendiri.

2. **Panjang password dihitung dalam unit UTF-16, bukan byte.** `len()` Go
   menghitung byte UTF-8; `.length` JavaScript menghitung unit UTF-16. Untuk
   password non-ASCII keduanya berbeda, dan selisihnya berbahaya di DUA ujung:
   13 karakter beraksen (26 byte) diterima Go tapi ditolak Express, sedangkan
   200 karakter beraksen (400 byte) diterima Express tapi ditolak Go. Lima
   titik disamakan menjadi `Buffer.byteLength`: `crypto/password.js`,
   login dan ganti-password di `auth/routes.js`, ganti-email di
   `auth/profile.js`, dan `confirmPassword` di `modules/users/index.js`.
   Harness tidak akan pernah melihatnya — seluruh fixture-nya ASCII.

3. **`SET TIME ZONE 'UTC'` dikirim tanpa di-await.** Hook `pool.on('connect')`
   tidak ditunggu `pg`, jadi query pertama bisa berangkat sebelum zona
   waktunya ditetapkan dan koneksi itu melayani permintaan dengan zona server.
   Balapan yang jarang, senyap, dan tepat mengenai D4. Diganti parameter
   startup `options: '-c timezone=UTC'`, yang diterapkan server sebelum
   koneksi dinyatakan siap.

Satu lagi di perkakas verifikasi, bukan di produksi: **`verify:crypto` sudah
rusak dan tidak bisa dijalankan sama sekali** — ia tidak menyalin
`notification-shim.go`, sehingga `crosscheck.go` gagal kompilasi sejak
perintah `notif` ditambahkan, dan ia juga tidak memasang volume cache modul
Go sehingga gagal karena jaringan. Dokumen ini sempat mencantumkannya sebagai
"gerbang yang sudah lulus 30/30" padahal alatnya mati. Sudah diperbaiki;
30/30 kembali hijau.

**D4 dan multipart harness selesai 2026-11-01.** Keduanya dikerjakan bersama
karena keduanya menutup lubang yang sama: hal yang harness **tidak bisa**
lihat, bukan hal yang belum sempat dijalankan.

- **D4** — teks timestamp Postgres kini diserahkan apa adanya lewat type
  parser `pg` (`src/db.js` + `src/time.js`); `Date` dibuang dari jalur itu
  karena ia hanya menyimpan milidetik dan selalu menulis tiga desimal.
  Dibuktikan `verify/timestamp-parity.js` — 79/79 timestamp cocok byte per
  byte, termasuk dua field jam-server yang hanya bisa diuji bentuknya.
- **Multipart** — `harness/client.js` merakit `multipart/form-data` sendiri
  dengan boundary tetap, dan endpoint 69, 103, serta 109 kini punya varian
  jalur sukses (201 di kedua backend). Harness menjadi **382 kasus**.

Aturan kerja sejak `directives` berlaku sampai akhir: **satu domain selesai
hanya kalau varian jalur tulisnya ikut ditulis di potongan yang sama**, bukan
ditambal belakangan (aturan 4 `CLAUDE.md`).

**Dua temuan yang perlu jawaban pemilik sistem.** Keduanya bukan masalah
migrasi — Go dan Express sama-sama berperilaku begitu, jadi harness tetap
hijau — tapi keduanya berdampak ke produksi:

- [Sebelas permission disposisi tidak dimiliki role mana pun](#sebelas-permission-disposisi-tidak-dimiliki-role-mana-pun)
  — mematikan SELURUH mount `dispositions`. Sekarang domain itu sudah
  diporting dan terbukti cocok, jadi yang tersisa murni pertanyaan
  konfigurasi: kodenya benar, tapi tidak ada akun yang bisa memanggilnya.
- [Tiga operasi anggaran tidak terjangkau siapa pun](#tiga-operasi-anggaran-tidak-terjangkau-siapa-pun)
  — anggaran tidak bisa dicatat sama sekali lewat API.

Satu pertanyaan terbuka untuk pemilik sistem: apakah role operasional memang
sengaja tidak diberi permission `subbagren.usulan.*` dan
`subbagren.anggaran.pagu.*`/`.realisasi.*`/`.bukti.*`? Lihat
[Peringatan tentang `seed-docs` dan permission](#peringatan-tentang-seed-docs-dan-permission).

### Bagaimana posisi ini dicapai

**Penghambat verifikasi sudah hilang.** `seed` dijalankan 2026-10-31: 14 user,
16 grant aktif, 12 akun OTP mati. Baseline Go direkam ulang dengan
`SDL_HARNESS_ALLOW_MUTATIONS=true` (262 kasus, 142/142 endpoint tersentuh,
ke-10 aktor bersesi), lalu Express dibanding terhadapnya.

Hasil: **93/93 endpoint yang sudah diporting cocok.** 49 sisanya menjawab 404
karena memang belum ditulis. Nol perbedaan perilaku ditemukan terhadap Go.

**Angka itu sekarang jauh lebih berarti daripada sebelumnya.** Sejak
`harness seed-docs` ada, database berisi dokumen deterministik dan harness
menjalankan **331 kasus tanpa satu pun dilewati** (sebelumnya 262 jalan, 69
dilewati). Endpoint daftar tidak lagi mengembalikan `items: []`, jadi pemetaan
kolom, konversi tipe, urutan, dan dekorasi ikut terbanding.

Yang terbukti sekarang, dan tidak terbukti sebelumnya:

- **Penyaringan scope Engine A.** `GET /subbagren/usulan/` mengembalikan 3 usulan
  untuk `kasubbagren` (scope `unit`, batas `penting`) dan **0** untuk
  `op-subbagren` (scope `assigned`, sementara handler subbagren tidak pernah
  mengisi `assignedUserIds`). Selisih itu persis yang ingin ditangkap.
- **Aritmetika anggaran.** `GET /subbagren/budget/?year=2026` mengembalikan
  1 pagu + 1 realisasi dengan `remaining` penuh, karena realisasinya masih
  `pending` dan basisnya hanya `verified`.
- **Interop bukti terenkripsi lewat HTTP.** Endpoint 70 menjawab 200 dengan
  plaintext 69 byte: Go membuka amplop AES-GCM yang disegel `sealEvidence`
  **milik Node**, lalu Express menghasilkan byte yang sama. Ini lebih kuat
  daripada `verify:crypto`, yang hanya menguji fungsinya, bukan endpoint-nya.

Sejak 2026-10-31 jalur mutasi yang **berhasil** juga terbukti, lewat 48 varian
di delapan domain: `usulan` (transisi status, optimistic locking, maker-checker,
siklus revisi), `budget` (plafon pagu dan integritas AES-GCM di dalam
transaksi keuangan), `directives` (draf ber-revisi dan penerbitan),
`surat-masuk` (pencatatan, penyuntingan, pendaftaran, distribusi),
`distribution-inbox` (terima → terbitkan disposisi), `dispositions`
(terima → selesaikan → telaah → teruskan → ajukan → putuskan), `unit-work`
(CRUD berkas plus siklus tugas internal terima/selesai/batal), dan
`urmin-registry` (surat keluar dari draf sampai keputusan pimpinan).
Seluruhnya **cocok byte per byte di Express**.
Lihat [Varian jalur sukses](#varian-jalur-sukses-mekanik-harness).

| Selesai | n | Tersisa | n |
|---|---|---|---|
| `root` + `system` | 3 | — | 0 |
| `auth` | 15 | | |
| `admin` | 16 | | |
| `sumda` | 6 | | |
| `binfung` | 5 | | |
| `portal` | 3 | | |
| `executive` | 2 | | |
| `urmin-registry` | 9 | | |
| `unit-work` | 13 | | |
| `usulan` | 10 | | |
| `budget` | 11 | | |
| `directives` | 18 | | |
| `surat-masuk` | 15 | | |
| `distribution-inbox` | 5 | | |
| `dispositions` | 11 | | |

### Pelajaran dari porting `usulan`

`src/access/database.js` **tidak bisa di-parse** sampai 2026-10-31: komentarnya
berisi `identity.*` diikuti `/audit.*`, dan urutan bintang-garis-miring menutup
blok komentar lebih awal. Tidak ada yang menyadarinya karena Engine A belum
pernah di-`import` oleh modul mana pun — `usulan` adalah yang pertama.

Artinya: **berkas yang sudah ditulis tapi belum dipasang di `app.js` tidak
terbukti apa-apa**, bahkan tidak terbukti bisa di-parse. Tanpa TypeScript, satu-
satunya yang memeriksa adalah `node --check` dan harness. Jalankan
`node --check` atas setiap berkas baru sebelum build.

### Pelajaran dari porting `directives`

Diporting 2026-10-31, **39 kasus cocok di percobaan pertama** — porting pertama
yang tidak butuh satu pun putaran perbaikan. Yang membuatnya begitu: Engine A
sudah terbukti lebih dulu lewat `usulan` dan `budget`, jadi lapisan di bawahnya
tidak perlu didiagnosis sambil jalan.

`directives` tidak memakai Engine A maupun Engine B. Ia punya pemeriksaan
**ketiga** yang berdiri sendiri, `isKabag()` — satu query yang menuntut grant
`br_kabagrenmin` aktif secara langsung dan mengecualikan Superadmin secara
eksplisit. Sepuluh dari 18 endpoint bergantung padanya. Jangan mencoba
menyatukannya dengan dua engine yang lain.

Empat hal yang mudah salah saat memporting, dan semuanya sudah dibereskan:

- **`omitempty` menghilangkan field, bukan membuatnya null.** `myReadAt`,
  `myAcknowledgedAt`, dan `recipients` LENYAP dari respons saat kosong.
  Sebaliknya `readAt`/`acknowledgedAt` di dalam `recipient` TIDAK memakai
  omitempty, jadi keduanya tetap muncul bernilai null — termasuk di
  `/candidates`, tempat keduanya sama sekali tidak relevan.
- **`%q` selalu mengutip.** Go memakai `fmt.Sprintf("attachment; filename=%q")`,
  sedangkan helper `contentDisposition()` di `http/multipart.js` meniru
  `mime.FormatMediaType` yang membiarkan nama sederhana tanpa kutip. Memakai
  helper itu akan membuat header berbeda untuk hampir setiap berkas. Modul ini
  punya `goQuote()` sendiri.
- **Unggahan lampiran bukan multipart.** Body-nya byte mentah dan nama berkas
  datang lewat header `X-File-Name`, di-decode dengan `url.QueryUnescape` —
  yang menerjemahkan `+` menjadi spasi, tidak seperti `decodeURIComponent`.
- **Dua angka berbeda dari modul evidence.** Ekor PDF dicari di **4096** byte
  terakhir (evidence: 2048) dan batas piksel **40 juta** (evidence: 20 juta).

Dua keanehan direplikasi apa adanya, keduanya calon isi `DEVIATIONS.md`:

1. **`deny(w, 413)` menghasilkan `{"error":""}`.** Peta kode di `api.go:63`
   tidak memuat 413, dan kunci yang hilang mengembalikan string kosong. Jadi
   unggahan yang kebesaran dijawab 413 dengan error string KOSONG, bukan
   `payload_too_large`.
2. **Kegagalan database saat menghapus draf bisa menjadi 409.** `draft.go:163`
   memeriksa `rev != p.Revision` SEBELUM `err != nil`; saat query gagal, `rev`
   tertinggal 0, sehingga permintaan dengan revisi bukan-nol dijawab
   `draft_conflict` alih-alih 503.

### Pelajaran dari porting `surat-masuk`

Diporting 2026-10-31, **36 kasus cocok di percobaan pertama**, domain kedua
berturut-turut tanpa putaran perbaikan.

Struktur paketnya dipecah tiga karena helper-nya dipakai lintas mount:
`shared.js` (Engine A urmin, validasi, `recipientEligible`, `validateFile`,
`kabagForIntake`, `distributionAllowed`), `tasks.js` (rantai disposisi), dan
`surat-masuk.js` (15 endpoint). **`tasks.js` sudah menanggung sebagian besar
`dispositions` yang belum diporting** — jangan ditulis ulang nanti.

Empat hal yang mudah salah:

- **Lampiran punya jalur akses KEDUA di luar Engine A.** Penerima distribusi
  dan penerima disposisi boleh mengunduh lampiran tanpa punya hak baca atas
  register surat. Tapi jalur kedua itu hanya berlaku untuk `read` dan
  `download` — permission `attach` tidak pernah lolos lewatnya.
- **Tiga kegagalan multipart menghasilkan tiga kode berbeda.** Body yang bukan
  multipart → 413 `invalid_attachment` (ParseMultipartForm gagal), field
  berkas tidak ada → 400 `file_required`, isi berkas kebesaran → 413
  `file_too_large`. `readSingleFile()` sebelumnya tidak bisa membedakan yang
  pertama dari yang kedua; sekarang ia menandainya `unparsable`.
- **Otorisasi berjalan SEBELUM parsing body.** Itu sebabnya endpoint 103
  menjawab 413, bukan 401/403, untuk body JSON dari aktor yang berwenang.
- **`validateFile` urmin berbeda lagi dari dua modul lain.** Nama berkas wajib
  cocok pola ketat `[a-zA-Z0-9 _().-]{1,160}`, ekor PDF dicari di 2048 byte
  terakhir, batas piksel 20 juta. Tiga modul, tiga kombinasi angka.

Endpoint 103 (unggah lampiran) dan 109 (intake) mendapat varian jalur tulisnya
**2026-11-01**, sesudah `harness/client.js` bisa merakit multipart. Keduanya
201 di kedua backend. Catatan di atas tetap berlaku dan justru makin terlihat
di sana: kasus DASAR 103 mengirim JSON dan karena itu menjawab **413**, bukan
400 — parsing body terjadi sesudah otorisasi lolos.

### Pelajaran dari porting `distribution-inbox`

Diporting 2026-10-31, **11 kasus cocok di percobaan pertama**. Domain terkecil
tapi paling padat secara otorisasi: mount ini adalah **engsel** antara surat
masuk dan disposisi.

- **Otorisasinya bukan Engine A untuk penerima.** Hak baca di sini lahir dari
  relasi distribusi (`recipientEligible`), bukan dari hak baca atas register
  Urmin. Seorang operator Subbagren boleh membaca surat yang didistribusikan
  kepadanya tanpa pernah boleh membuka register Urmin.
- **Endpoint 113 punya dua jalur otorisasi yang saling eksklusif.** Penerima
  dinilai lewat relasi distribusinya; siapa pun selain penerima dinilai lewat
  Engine A atas surat induknya — itu yang membuat pengirim tetap bisa melihat
  jejaknya.
- **Status `received` ikut di klausa WHERE endpoint 114**, bukan diperiksa
  sesudahnya. Jadi distribusi yang belum diterima menjadi 404, bukan 409:
  keberadaannya tidak dibocorkan sebelum penerimanya mengambilnya.
- **Kegagalan insert tugas dipetakan ke 409, bukan 503** (`r3c.go:340`).
  Constraint tabel itulah penjaga terakhirnya, dan Go memperlakukan setiap
  kegagalan di titik itu sebagai konflik.

Rantai variannya membuktikan sesuatu yang tidak bisa dibuktikan kasus tunggal:
varian 115 **mustahil** lolos sebelum varian 112 dijalankan, karena
`currentIssuer()` menuntut distribusinya berstatus `received`. Urutan deklarasi
di `VARIANTS` yang menegakkannya.

### Pelajaran dari porting `dispositions`

Diporting 2026-11-01, domain terakhir. **34 kasus cocok setelah satu putaran
perbaikan** — dan perbaikan itu bukan di modul baru, melainkan di `tasks.js`
yang sudah berbulan dianggap selesai.

**Porting ini hampir seluruhnya perakitan, bukan keputusan.** Lima belas helper
rantainya sudah hidup di `src/modules/urmin/tasks.js` sejak `surat-masuk` dan
`distribution-inbox`; `dispositions.js` tinggal merangkai urutan pemeriksaan
dan memetakan kode kesalahan. Itu sebabnya 11 endpoint selesai dalam satu
potongan sementara `directives` yang 18 butuh satu sesi penuh.

**`validDate` tidak pernah di-`import` di `tasks.js`.** `validDispositionDue()`
memanggilnya, tapi berkas itu hanya mengimpor `recipientEligible` dan `UUID_RE`.
Cacatnya diam selama berhari-hari karena `distribution-inbox` punya salinan
`validDispositionDue` sendiri, sehingga versi di `tasks.js` **tidak pernah
dipanggil satu kali pun** sampai endpoint 122 memakainya — lalu 500
`validDate is not defined`.

Ini pengulangan persis pelajaran `usulan`, dengan bentuk yang lebih licik:
di sana yang tidak terbukti adalah berkas yang belum dipasang; di sini yang
tidak terbukti adalah **fungsi yang sudah dipasang tapi belum pernah
dipanggil**. `node --check` meloloskan keduanya — ia memeriksa sintaks, bukan
resolusi nama. Tanpa TypeScript, satu-satunya yang membuktikan sebuah fungsi
benar-benar ada adalah harness yang menjalankannya.

Pelajaran turunannya: **salinan helper yang "sementara" membeli waktu dengan
utang.** Salinan `validDispositionDue` di `distribution-inbox.js` bukan sekadar
duplikasi — ia yang membuat cacat di versi aslinya tidak terlihat.

Tiga hal yang mudah salah, semuanya sudah dibereskan:

- **Urutan pemeriksaan berbeda antara dua kelompok endpoint.** Pada 118–122
  UUID diperiksa **sebelum** body, jadi `taskId` sampah menjawab 404 walau
  body-nya juga cacat. Pada 125/126 sebaliknya: `rootForFinal()` jalan lebih
  dulu, sehingga tugas ANAK menjawab 404 walau body-nya kosong. Menyeragamkan
  keduanya akan menggeser kode respons di belasan kasus dasar.
- **Dua ragam 503 yang tidak boleh tertukar.** Go membedakan `unavailable`
  (query gagal) dari `authorization_unavailable` (pemeriksaan izin gagal) di
  hampir setiap handler. Di Express keduanya dibungkus eksplisit lewat
  `data()` dan `authz()`; tanpa itu semua kegagalan jatuh ke satu kode dan
  perbedaannya ikut terekam golden file.
- **`ChainInactive` dilewati di dasbor, tapi menjadi 503 di endpoint tunggal.**
  Rantai yang grant-nya dicabut membuat kasusnya hilang diam-diam dari
  `/leadership` (`continue`), sedangkan `/final-status` yang meminta satu kasus
  tertentu justru gagal. Perbedaan itu disengaja di Go dan disalin apa adanya.

**`markSimpleDispositionComplete` memakai grant HISTORIS, bukan otorisasi.**
Query-nya sengaja tidak memeriksa `revoked_at` maupun `expires_at`, supaya
grant demo yang kedaluwarsa setelah 7 hari tidak memutar balik penyelesaian
100% menjadi 90%. Ini satu-satunya tempat di seluruh codebase yang membaca
`sdl_access_grants` tanpa pemeriksaan masa berlaku — jangan "diperbaiki".

#### Sembilan tugas fixture, lima distribusi

Rantai uji disposisi butuh lebih banyak fixture daripada domain mana pun
sebelumnya, dan bentuknya ditentukan satu indeks:
`sdl_disposition_open_one_idx` UNIQUE `(distribution_id, assigned_to)` WHERE
status ∈ {pending, in_progress}. Karena pelaksananya op-subbagren untuk
semuanya, **empat varian yang menuntut tugas terbuka tidak bisa berbagi
distribusi** — masing-masing dapat distribusinya sendiri. Lima tugas yang
sudah `completed` tidak kena indeks itu dan menumpang satu distribusi.

Tugas lama `ID.dispositionTask` **sengaja dibiarkan rantainya tidak sah**:
distribusinya masih `sent` dan penerimanya bukan penerbit tugasnya, sehingga
`currentIssuer()` menolaknya. Ia merekam bentuk penolakan 403/404 untuk kasus
dasar, dan "memperbaikinya" akan menghapus cakupan itu.

Tiga permission baru ditambahkan ke `HARNESS_ROLE_PERMISSIONS`, dengan
pemisahan peran dijaga: penerbit (`kasubbagren`) mendapat `review` dan
`final.submit`, pelaksana (`op-subbagren`) mendapat `forward`, pimpinan
(`kabagrenmin`) mendapat `final.monitor` dan `final.approve`. Pemisahan itu
bukan kerapian — endpoint 126 menolak pemutus yang pernah menyentuh satu tugas
mana pun di rantainya, jadi menggabungkan peran akan membuat seluruh varian
persetujuan final menjadi 403 `self_approval_denied`.

`staf-subbagren` diberi `execute` tapi **sengaja tidak** `forward`: ia sasaran
penerusan, dan rantai memang harus berhenti padanya.

### Varian Engine B (`unit-work` + `urmin-registry`)

Ditulis 2026-11-01, menutup utang terakhir sebelum cutover: **Engine B
menopang 33 endpoint di empat mount dan belum pernah dijalankan oleh satu pun
mutasi yang berhasil.** Tujuh belas varian ditambahkan; enam belas di antaranya
langsung cocok, satu membongkar cacat harness, dan dua membongkar cacat
produksi yang sudah ada sejak R5F10.

**Yang akhirnya terbukti tentang Engine B.** Ia tidak memakai `permission_key`
sama sekali — scope grant (`own`/`assigned`/`unit`) dicocokkan langsung dengan
verb. Dua cabang yang paling mudah salah diporting sekarang punya kasus
hijaunya sendiri:

- **Scope `unit` menang atas kepemilikan.** Seluruh berkas fixture dimiliki
  op-urmin (scope `own`), sementara varian 21/23/24/28/31 dijalankan ka-urmin
  lewat scope `unit`. Kalau Express diam-diam menuntut kepemilikan, kelimanya
  merah sekaligus.
- **Scope `own` bisa menang lewat TABEL LAIN.** Varian 29 dan 30 dijalankan
  staf-urmin, yang ber-scope `own` atas berkas milik orang lain. Ia lolos
  semata karena ada tugas untuknya — satu-satunya tempat Engine B melihat ke
  `sdl_unit_work_tasks` sebelum memutuskan.

Pemisahan pemberi dan penerima tugas juga nyata, bukan kosmetik: varian 29/30
dijalankan **penerima** (`who == to_user`) dan varian 31 oleh **pemberi**
(`who == from_user`). Satu akun untuk keduanya akan menghapus justru perbedaan
yang ingin diukur.

**Tiga endpoint daftar tidak pernah mencapai handler-nya.** Endpoint 33, 38,
dan 43 menuntut `?kind=` dan tanpanya berhenti di 400 `invalid_kind` — jadi
pemetaan kolom, decode JSONB `fields`, dan penyaringan Engine B per baris tidak
pernah dijalankan sama sekali. Registry sekarang mengirim `?kind=personel`,
`?kind=sop`, dan `?kind=surat_keluar`. Keluarga yang sama dengan `?year=` pada
endpoint 61/62/72, dan ditemukan dengan cara yang sama: membaca status golden
file alih-alih mempercayai bahwa "cocok" berarti "teruji".

**Kasus dasar 47 menghancurkan fixture untuk 48–51.** `DELETE /urmin/registry/{id}`
berhasil di fase dasar dan meng-soft-delete register beserta berkas kerjanya,
sehingga keempat endpoint sesudahnya menjawab 404 — bukan karena logikanya,
melainkan karena datanya sudah hilang. Varian memakai register tersendiri, jadi
tidak terkena. Pola ini layak dicurigai di mount lain mana pun yang punya
DELETE di tengah urutan nomornya.

**Hash isi surat keluar terbukti TIGA arah.** Sasaran varian 50 ditanam sudah
berstatus `submitted` beserta `content_sha256` yang **dihitung di JavaScript**
oleh `seed-documents.js`, meniru serialisasi `outgoingContentHash` milik Go
(urutan field struct, kunci map yang diurutkan, escaping HTML). Go dan Express
sama-sama melewati pemeriksaan `document_integrity_changed` atas digest itu —
artinya ketiga implementasi sepakat byte per byte. Kalau rumusnya meleset,
keduanya menjawab 409 dan perbandingannya **tetap hijau**; jadi yang membuktikan
bukan warna harness, melainkan membaca status 200/503 pada capture.

**Satu cacat harness: jam dinding presisi menit lolos dari normalizer.**
`TIMESTAMP_RE` menuntut detik, sedangkan `unitwork/work.go:523` merender
event dengan `to_char(... 'YYYY-MM-DD HH24:MI')`. Capture dan compare jatuh di
menit yang berbeda, dan satu-satunya beda dari 379 kasus adalah `08:14` lawan
`08:22`. Kasus dasar tidak pernah menampakkannya karena daftar event-nya kosong;
baru varian baca-ulang 22 yang mengisinya. Sudah diperbaiki, tapi **hanya untuk
bentuk berspasi** — bentuk ber-`T` tetap menuntut detik supaya nilai
`validDateTimeLocal` (`2026-10-01T09:00`), yang DATA, tidak ikut tertelan
`<timestamp>`.

#### Dua temuan dari varian Engine B

Keduanya **bukan cacat migrasi** — Go dan Express sama-sama berperilaku begitu,
jadi harness tetap hijau — tapi keduanya mematikan alur persetujuan surat keluar
di produksi. Detail lengkap di `DEVIATIONS.md` B8 dan B9.

**B9 — `outgoingManager()` menuntut tabel yang tidak pernah diisi.** Ia menuntut
baris di `sdl_user_roles` (peran langsung) selain grant berskop. `seed-bagrenmin`
tidak pernah menulis ke tabel itu; isinya hanya satu baris `superadmin`. Jadi
fungsi itu false untuk siapa pun → endpoint 50/51 menjawab 403 dan `canReview`
pada endpoint 48 selalu false. Ke-22 pemakai `sdl_user_roles` yang lain hanya
membacanya untuk mendeteksi `superadmin`, jadi **yang menyimpang query-nya,
bukan seed-nya.**

**Diperbaiki 2026-11-01**, juga atas persetujuan eksplisit pemilik sistem:
JOIN ke `sdl_user_roles` dibuang, wewenangnya murni dari grant — sejalan dengan
`directives.isKabag`, `executiveV2Access`, dan `access.EvaluateForUser`.
Tabel itu tetap dibaca di query yang sama, tapi hanya untuk menolak Superadmin.

Satu jebakan saat mencabut tambalannya, dan ia nyaris terlewat:
**`sdl_user_roles` tidak ikut `TRUNCATE`** karena ia tabel identitas. Berhenti
menyisipkan barisnya tidak cukup — baris dari sesi sebelumnya masih ada di
database, dan selama ia ada, endpoint 50/51 lolos lewat jalur LAMA dan
perbaikan B9 terlihat hijau tanpa membuktikan apa pun. `seed-docs` karena itu
**menghapusnya aktif** (`dropObsoleteDirectRole`). Terverifikasi sesudahnya:
`sdl_user_roles` hanya berisi `superadmin`, dan `canReview` untuk kabagrenmin
tetap `true`.

**B8 — dan di baliknya, SQL yang tidak sah.** Setelah B9 ditambal di harness,
endpoint 50/51 akhirnya menjalankan query-nya untuk pertama kalinya dalam
sejarah aplikasi ini — dan gagal:

```
ERROR: inconsistent types deduced for parameter $2
DETAIL: text versus character varying
```

`UPDATE ... SET stage=$2, approved_at=CASE WHEN $2='approved' ...` memakai `$2`
di dua tempat dengan tipe berbeda. **Persetujuan dan penolakan surat keluar
tidak pernah bisa berhasil**, di backend mana pun; setiap surat yang diajukan
menggantung di `submitted` selamanya. `sqlerr` memetakannya ke 503
`database_unavailable`, yang terbaca seperti database bermasalah.

Express menyalin query-nya verbatim, jadi ia gagal persis sama dan varian 50/51
sempat merekam 503 di kedua sisi.

**Diperbaiki 2026-11-01 atas persetujuan eksplisit pemilik sistem.** Kedua
pemakaian disamakan menjadi `$2::varchar`, di `outgoing_review.go:255` dan
`outgoing-review.js:311` pada perubahan yang sama, lalu golden-nya direkam ulang
dalam satu siklus capture/compare penuh: 50 → 200 `approved`, 51 → 200
`rejected`, 379/379 tetap cocok. `approved_at` terisi hanya pada persetujuan,
jadi ekspresi CASE-nya memang berjalan benar — bukan sekadar lolos parse.

Ini **satu-satunya kali source Go disentuh selama migrasi**. Aturan 2 ("Go
adalah oracle") tidak dilanggar karena tidak ada perilaku benar yang bisa
dibandingkan: statement-nya tidak sah, jadi satu-satunya keluaran yang mungkin
adalah 503. Syarat yang menjaga oracle tetap utuh: **kedua backend diperbaiki
bersamaan**, lalu direkam ulang. Memperbaiki satu sisi saja akan merusaknya.

Dengan B9 ikut beres, **alur persetujuan surat keluar benar-benar jalan untuk
pertama kalinya** — dengan konfigurasi seed apa adanya, tanpa tambalan harness
apa pun.

Tiga hal yang membuat temuan ini layak diingat caranya, bukan cuma isinya:

1. **Cacat kedua bersembunyi di balik cacat pertama.** Selama B9 menolak 403,
   SQL di B8 tidak pernah sempat dijalankan. Menambal satu lapisan otorisasi
   "khusus uji" ternyata bukan sekadar membuka cakupan — ia membuka cacat.
2. **Tidak ada test Go yang menangkapnya.** `outgoing_review_test.go` 21 baris
   dan hanya menguji dua helper murni (`outgoingCanSubmit`/`outgoingCanReview`).
   Query-nya tidak pernah disentuh satu test pun, dan `go test ./...` tetap
   hijau sebelum maupun sesudah perbaikan.
3. **Hash isi dokumen jadi terbukti langsung, bukan tersirat.** Sebelum
   perbaikan, 503 hanya menyiratkan pemeriksaan `document_integrity_changed`
   sudah terlewati. Sesudahnya, 200 pada varian 50 membuktikannya terang-terangan:
   digest yang ditanam `seed-documents.js` dalam JavaScript diterima Go
   **dan** Express.

### Varian jalur sukses (mekanik harness)

Kasus mutasi yang berhasil **ditambahkan**, bukan menggantikan body `{}`. Entri
dasar tetap mengirim `{}` dan tetap merekam bentuk respons validasi 400 — itu
bagian dari kontrak dan membuangnya adalah regresi cakupan. Jalur sukses hidup
di `VARIANTS` (`harness/registry.js`), terpisah dari `REGISTRY` supaya
pemeriksaan "persis 142 endpoint" tetap menjadi pengaman yang utuh.

Tiga aturan yang membuatnya tidak rapuh:

1. **Varian dijalankan di fase terakhir**, sesudah seluruh kasus dasar
   (`buildCases` di `run.js`). Kalau dicampur, satu create yang berhasil di
   endpoint 21 menggeser hitungan di endpoint 77, dan golden file yang sudah
   terbukti cocok harus direkam ulang setiap kali varian ditambah.
2. **Satu record per varian**, ditanam `seed-documents.js` pada state yang
   dituntut handler. Berbagi record membuat `version` di body bergantung pada
   urutan eksekusi — justru kerapuhan yang ingin dihindari. Dengan record
   sendiri, `version: 1` selalu benar.
3. **Fixture-nya dicari lewat judul, bukan lewat state.** Predikat seperti
   `WHERE status='draft'` terlihat lebih bersih tapi menipu: begitu varian
   berhasil, state record berubah dan fixture yang sama menunjuk baris lain di
   run berikutnya. Judul tidak pernah diubah transisi mana pun.

Varian tidak dijalankan aktor anonim (hasilnya identik dengan entri dasar) dan
selalu berkelas `mutating`, jadi ikut terkunci di balik
`SDL_HARNESS_ALLOW_MUTATIONS`.

Kepemilikan record bukan selera — handler Go menuntutnya:

| Varian | Pembuat record | Alasan di source |
|---|---|---|
| 56 `sunting-draf` | op-subbagren | kasubbagren menyunting lewat scope `unit` |
| 57 `ajukan` | op-subbagren | `submit` tidak memeriksa kepemilikan |
| 58 `telaah-setuju` | op-subbagren | `review.go:177` — 403 `self_review_denied` kalau pembuat == peninjau |
| 59 `perbaiki-revisi` | **kasubbagren** | `review.go:233` — 404 kalau `created_by != user` |
| 60 `ajukan-ulang` | **kasubbagren** | `review.go:301` — idem |

Seluruhnya dijalankan `kasubbagren`: `br_op_subbagren` ber-scope `assigned`
sementara handler subbagren tidak pernah mengisi `assignedUserIds`, jadi ia
tidak lolos Engine A untuk satu pun di antaranya.

**Menambah varian menggeser golden file entri dasar.** Bukan karena mutasinya —
fase tulis sudah mencegah itu — melainkan karena baris seed yang baru ikut
muncul di endpoint daftar dan konsolidasi. Jadi setiap kali `seed-documents.js`
bertambah, siklusnya wajib penuh: `seed-docs` → `capture` (Go) → `seed-docs` →
`compare` (Express). Yang dijaga bukan byte golden file, melainkan kesamaannya.

#### Rantai `budget`: urutan deklarasi itu bermakna

Varian `usulan` berdiri sendiri; varian `budget` **berantai**. Verifikasi
realisasi (67) menolak `409 approved_evidence_required` kalau bukti bayarnya
belum disetujui (71), dan persetujuan bukti menuntut pagu induknya sudah
`verified`. Karena `VARIANTS` dijalankan **menurut urutan deklarasi, bukan
nomor endpoint**, urutannya sengaja dibuat 64 → 65 → 66 → **71 → 67**.
Menukar 71 dan 67 akan membuat 67 gagal, dan gejalanya terlihat seperti cacat
Express padahal murni urutan.

Rantai itu sekaligus menjalankan tiga hal yang sebelumnya tidak pernah
tersentuh di kedua backend:

- **Integritas bukti di dalam transaksi keuangan.** Verifikasi realisasi
  membuka amplop AES-GCM dan mencocokkan ulang `sha256` plaintext-nya sebelum
  menyetujui. Ini lebih dalam daripada endpoint 70 yang hanya mengunduh.
- **Plafon pagu.** `amount > paguAmount - used` dengan `used` dihitung dari
  realisasi berstatus `verified` saja.
- **Aritmetika yang dihitung ulang, bukan kolom tersimpan.** Varian 62 membaca
  ringkasan sesudah seluruh rantai: `DIPA-2026-9004` bergerak dari
  `verifiedRealization` 0 / `remaining` 200jt menjadi 50jt / 150jt, dan total
  `remaining` 600jt → 750jt. Tanpa pembacaan ulang ini, respons mutasi saja
  tidak membuktikan ringkasannya ikut benar.

Pelajaran yang memakan satu siklus: **skema ikut menegakkan maker-checker.**
`pagu_review_consistent` menuntut baris non-`pending` punya `reviewed_by` dan
`reviewed_at`, dan `pagu_separation` menuntut `reviewed_by <> created_by`
(idem untuk realisasi). Baris seed yang ditanam langsung berstatus `verified`
harus memenuhi keduanya — seed gagal kalau tidak, bukan diam-diam salah.

#### Sebelas permission disposisi tidak dimiliki role mana pun

Ditemukan 2026-10-31 saat menggarap `distribution-inbox`. **Lebih luas
daripada kasus anggaran**, dan menyangkut domain yang belum diporting.

Dari 12 permission `urmin.disposisi.*` di katalog `sdl_permissions`, hanya
`urmin.disposisi.read` yang pernah diberikan ke sebuah role (`br_ka_urmin`).
Sebelas sisanya — `issue`, `execute`, `review`, `forward`, `complete`,
`create`, `update`, `manage`, `final.submit`, `final.approve`,
`final.monitor` — **dimiliki nol role**:

```sql
SELECT p.permission_key, COUNT(rp.role_key)
  FROM sdl_permissions p
  LEFT JOIN sdl_role_permissions rp ON rp.permission_key=p.permission_key
 WHERE p.permission_key LIKE 'urmin.disposisi%' GROUP BY 1;
```

Akibatnya endpoint 115 (menerbitkan disposisi) dan **seluruh mount
`dispositions` (11 endpoint)** tidak terjangkau siapa pun pada konfigurasi
seed apa adanya. Rantai disposisi berjenjang, telaah, penerusan, sampai
persetujuan final — semuanya kode yang tidak pernah bisa dijalankan.

Supaya kodenya tetap teruji, `seed-docs` memberi `urmin.disposisi.issue`
kepada `br_kasubbagren` dan `urmin.disposisi.execute` kepada
`br_op_subbagren` — dua akun berbeda, sehingga pemisahan penerbit dan
pelaksana yang menjadi sandaran seluruh rantai tetap terjaga.
**Tambalan uji, bukan usulan konfigurasi produksi.**

Saat memporting `dispositions` nanti, permission tambahan akan dibutuhkan
lagi (`review`, `forward`, `final.submit`). Tambahkan di
`HARNESS_ROLE_PERMISSIONS` dengan pembagian peran yang sama, jangan berikan
semuanya ke satu akun — itu akan menghapus justru perbedaan yang ingin diukur.

#### Tiga operasi anggaran tidak terjangkau siapa pun

Ditemukan 2026-10-31, **bukan cacat migrasi** — Go dan Express sama-sama
berperilaku begitu, jadi harness tetap hijau. Tapi ia berdampak ke produksi.

`subbagren.anggaran.pagu.register`, `subbagren.anggaran.realisasi.record`, dan
`subbagren.anggaran.bukti.upload` hanya dimiliki role `br_op_subbagren`.
Grant `op-subbagren` ber-scope **`assigned`** (`sdl_access_grants`), dan
`access/policy.go` meloloskan scope itu hanya kalau `doc.AssignedUserIDs`
memuat pemanggil — sementara **seluruh handler subbagren tidak pernah mengisi
field tersebut**. Akibatnya ketiga operasi itu selalu ditolak, untuk semua
orang: pendaftar tidak punya scope yang lolos, dan yang punya scope lolos
(`kasubbagren`, `kabagrenmin`) tidak punya permission-nya.

Artinya **anggaran tidak bisa dicatat sama sekali lewat API** pada konfigurasi
seed apa adanya. Ini satu keluarga dengan pertanyaan terbuka tentang
`subbagren.usulan.*`, tapi lebih tajam: di sana permission-nya tidak diberikan
ke role mana pun, di sini permission-nya diberikan tapi ke role yang scope-nya
tidak mungkin lolos.

Supaya kodenya tetap teruji, `seed-docs` memberikan `pagu.register` dan
`realisasi.record` kepada `br_kabagrenmin` (scope `unit`, dan orang yang
berbeda dari `kasubbagren` sehingga maker-checker tetap bisa diuji sebagai
jalur sukses). **Itu tambalan harness, bukan usulan perbaikan produksi** —
perbaikan sebenarnya bisa saja mengubah scope grant, bukan peta permission.
Tanyakan ke pemilik sistem sebelum menyentuh `cmd/seed-bagrenmin`.

`bukti.upload` (endpoint 69) menyusul **2026-11-01**, dengan tambalan yang
sama persis dan atas alasan yang sama: kunci itu pun hanya dimiliki
`br_op_subbagren`. Yang menahannya selama ini bukan permission-nya melainkan
multipart — dan setelah klien harness bisa merakitnya, ternyata ia masih
butuh satu hal lagi: rantai usulan→pagu→realisasi **tersendiri** yang
realisasinya belum punya bukti sama sekali. Realisasi yang sudah punya bukti
`pending`/`approved` berhenti di 409 `active_evidence_exists`, jadi rantai
yang sudah ada tidak bisa dipakai ulang.

Satu temuan untuk `DEVIATIONS.md` nanti: respons sukses 56 dan 57 memuat
`reviewStatus: ""`, bukan `"draft"`. `decorateReview` memang mengembalikan
`"draft"` untuk usulan berstatus draft, tapi handler `mutate` tidak pernah
memanggilnya. Express sudah mereplikasi ini apa adanya — jangan "diperbaiki"
selama kontrak masih beku.

### Langkah berikutnya, berurutan

Seluruh 142 endpoint sudah diporting dan cocok. Yang berikut bukan lagi
porting, melainkan menutup cakupan dan menyiapkan peralihan.

1. ~~**Jawaban pemilik sistem atas B8 dan B9.**~~ **Selesai 2026-11-01**, di
   kedua backend pada perubahan yang sama, golden 50/51 direkam ulang.

2. ~~**Verifikasi D4.**~~ **Selesai 2026-11-01.** Dugaannya benar dan lebih
   luas: `Date` JavaScript hanya menyimpan milidetik, jadi mikrodetik yang
   Go teruskan memang HILANG, bukan cuma berbeda format. Diperbaiki di
   sumbernya — type parser `pg` menyerahkan teks Postgres apa adanya
   (`src/time.js`, dipasang di `src/db.js`) — dan dibuktikan
   `verify/timestamp-parity.js`, yang membandingkan byte mentah tanpa
   normalisasi: **79/79 cocok**.

   Dua timestamp di antaranya berasal dari jam server, bukan dari database
   (`executive` `generatedAt`, `dispositions/leadership` `updatedAt`).
   Nilainya mustahil sama antara dua panggilan, jadi yang diuji aturan
   formatnya: Go memotong nol di belakang pecahan detik, `Date.toJSON()`
   tidak pernah. Keduanya kini lewat `goTime()`. Presisinya tetap berbeda
   (Go nanodetik, Node milidetik) dan itu memang tidak bisa diperbaiki.

3. ~~**Dukungan multipart di `harness/client.js`.**~~ **Selesai 2026-11-01.**
   Klien merakit `multipart/form-data` sendiri dengan **boundary tetap** —
   `FormData` bawaan Node mengarang boundary baru tiap panggilan, dan ketiga
   endpoint ini menimbang SELURUH body lewat `http.MaxBytesReader`, bukan
   hanya isi berkasnya. Endpoint 69, 103, dan 109 kini punya varian jalur
   sukses; harness menjadi **382 kasus, seluruhnya cocok**.

   Dua prasyarat yang tidak kelihatan sampai dicoba, keduanya soal
   KETERJANGKAUAN, bukan soal multipart:

   - endpoint 69 menolak 409 `active_evidence_exists` kalau realisasinya
     sudah punya bukti `pending`/`approved`, jadi ia butuh rantai
     usulan→pagu→realisasi sendiri yang buktinya masih kosong;
   - `subbagren.anggaran.bukti.upload` hanya dimiliki `br_op_subbagren`,
     yang grant-nya ber-scope `assigned` dan karena itu tidak pernah lolos
     Engine A. Seperti `pagu.register` dan `realisasi.record` sebelumnya,
     kunci itu diberikan ke `br_kabagrenmin` **di seed harness saja**.

4. **Tahap 5 — worker email.** Aturan 7 `CLAUDE.md`: selama transisi kedua
   backend hidup, dan kalau keduanya memproses outbox, pengguna nyata
   menerima email dua kali. **Selesai 2026-11-01.**

5. **Tahap 6 — peralihan lewat Caddy per prefix.** Bukan feature flag di
   kode; rollback harus tetap satu baris config + reload. **Satu-satunya
   butir yang masih terbuka di daftar ini.**

Aturan 4 `CLAUDE.md` tetap berlaku untuk sisa pekerjaan: satu potongan selesai
hanya kalau pembuktiannya ikut ditulis di potongan yang sama.

### Bentuk paket `subbagren` di Express

Go menaruh `usulan.go`, `review.go`, `budget.go`, dan `evidence.go` dalam satu
package sehingga helper-nya dipakai bersama begitu saja. Di Express berkasnya
terpisah, jadi bagian bersama dikumpulkan di `src/modules/subbagren/shared.js`:
`respond`/`fail`, `textOk`/`validReason`, `typedDecode`, `parseGoInt`,
`parseDateOnly`, `mapProposal`, `createPermitted` (Engine A), dan
`loadReviewCase`. **Jangan menyalin ulang logika otorisasi ke modul baru** —
dua salinan `permitted()` adalah cara paling mudah membuat satu di antaranya
tertinggal saat kebijakan berubah.

Tiga hal dari `usulan` dan `budget` yang akan berulang:

- **Urutan rute statis sebelum `/:id`.** chi mencocokkan rute statis lebih dulu
  tanpa peduli urutan pendaftaran; Express tidak.
- **Izin diuji terhadap salinan record yang statusnya dipaksa `draft`.**
  Engine A menolak `*.update` di luar draft, sehingga alur revisi mati tanpa
  salinan itu.
- **Penolakan otorisasi menjadi 404, bukan 403**, supaya keberadaan record milik
  unit lain tidak bocor lewat selisih status code.

### Alur kerja per domain

```bash
# 1. Tulis modul di src/modules/<nama>/
# 2. Pasang di src/app.js
# 3. Deploy + banding
docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml \
  up -d --build --wait api-express

SDL_HARNESS_TARGET=express SDL_HARNESS_ONLY_MOUNTS=<mount> \
SDL_HARNESS_API_BASE=http://api-express:8080 \
docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.harness.yaml \
  run --rm -e SDL_HARNESS_TARGET -e SDL_HARNESS_ONLY_MOUNTS -e SDL_HARNESS_API_BASE \
  harness compare
```

Dari CMD/PowerShell pakai `local-setup.cmd` (lihat `CLAUDE.md`).

**`SDL_HARNESS_ALLOW_MUTATIONS=true` wajib** pada `capture` maupun `compare`.
Tanpanya harness tidak membersihkan `must_change_password` (`harness/index.js`),
ke-13 akun hasil seed tetap terblokir, dan golden file merekam 403 di mana-mana —
terlihat seolah RBAC rusak. Nilai flag harus sama di kedua sisi, kalau tidak
cakupan kasusnya berbeda dan perbandingannya tidak setara.

**`harness seed-docs` wajib dijalankan DUA KALI: sebelum `capture` dan lagi
sebelum `compare`.** Kasus mutating benar-benar mengubah baris, jadi kalau
compare berangkat dari keadaan yang ditinggalkan capture, selisihnya adalah
akibat urutan — bukan perbedaan backend. Urutan yang benar:

```powershell
Set-Location "F:\Website_project\d88\sdl"
$env:SDL_HARNESS_ALLOW_MUTATIONS = "true"
$dev = '-f','infra/compose.dev.yaml'
$exp = '-f','infra/compose.express.yaml'
$h   = '-f','infra/compose.harness.yaml'

# 1. reset data -> rekam baseline Go
docker compose --env-file .env @dev @h run --rm --build harness seed-docs
docker compose --env-file .env @dev @h run --rm `
  -e SDL_HARNESS_TARGET=go -e SDL_HARNESS_API_BASE=http://api:8080 harness capture

# 2. reset data lagi -> banding Express dari keadaan yang SAMA
docker compose --env-file .env @dev @h run --rm harness seed-docs
docker compose --env-file .env @dev @exp @h run --rm `
  -e SDL_HARNESS_TARGET=express -e SDL_HARNESS_API_BASE=http://api-express:8080 harness compare
```

`seed-docs` mengosongkan 37 tabel dokumen dengan `RESTART IDENTITY` lalu menanam
ulang data tetap. `RESTART IDENTITY` bukan hiasan: `sdl_subbagren_proposals.number`
dan `sdl_urmin_incoming.agenda_no` adalah kolom identity yang ikut diserialkan
sebagai angka biasa dan **tidak** dinormalkan harness.

### Utang harness

#### Sudah dibereskan 2026-10-31

- **Tiga query fixture salah nama kolom.** `roadmapId` dan `distributionId`
  mencari `created_at`, `outgoingId` mencari `id` — ketiganya gagal dijalankan,
  bukan sekadar kosong. Diperbaiki di `harness/db.js`: roadmap diurut
  `section,sort_order,id`; distribusi `sent_at`; dan `sdl_outgoing_workflows`
  berkunci `register_id`, bukan `id`.
- **Daftar audit tidak dinormalkan.** Endpoint 141 selalu merah palsu karena
  capture dan compare sama-sama menulis event. Registry sekarang menandainya
  `appendOnly: ['events']`; yang dibanding tinggal nama fieldnya.
- **`GET /admin/users` berurutan acak.** Endpoint 136 merah di satu run dan
  hijau di run berikutnya. Penyebabnya `ORDER BY` tanpa tiebreaker di Go,
  bukan cacat Express — lihat B6 di `DEVIATIONS.md`. Ditandai
  `unordered: ['users']`.
- **Nol dokumen di database.** Diselesaikan lewat `harness seed-docs`
  (`harness/seed-documents.js`). 69 kasus yang dulu dilewati kini jalan:
  **331 kasus, 0 dilewati**, 22 fixture terisi.
- **Penomoran placeholder UUID tidak stabil pada daftar `unordered`.**
  Ditemukan 2026-10-31 saat `directives` masuk. Endpoint 136 merah dengan isi
  yang **identik baris per baris dan urutan yang sudah sama** — yang berbeda
  hanya `<uuid:1>` lawan `<uuid:3>`. Penyebabnya melingkar: `Normalizer.value()`
  membagikan nomor saat menelusuri, sedangkan pengurutan `unordered` terjadi
  sesudahnya, sehingga nomornya terlanjur mengikuti urutan baris mentah dari
  `ORDER BY created_at DESC` yang memang tanpa tiebreaker (B6).

  Diperbaiki di dua tempat: kunci pengurutan `unordered` kini **menghapus**
  nomor placeholder, dan `Normalizer.renumber()` menomori ulang seluruh record
  **paling akhir**, sesudah `appendOnly` dan `unordered`. Selama ini lolos
  karena kebetulan Postgres mengembalikan urutan yang sama.

  Gejalanya layak diingat: perbandingan merah tapi datanya sama persis. Itu
  tanda cacat normalisasi, bukan cacat backend.
- **Tiga endpoint baca tidak pernah mencapai handler.** Endpoint 62 dan 72
  menuntut `?year=`, dan tanpanya berhenti di 400 — seluruh perhitungan
  pagu/realisasi/rekonsiliasi tidak pernah dijalankan. Registry sekarang
  mengirim `?year=2026` untuk 61, 62, dan 72.

#### Peringatan tentang `seed-docs` dan permission

`seed-bagrenmin` memberi role permission `subbagren.perencanaan.*`, sedangkan
handler usulan memeriksa `subbagren.usulan.*` dan handler anggaran memeriksa
`subbagren.anggaran.pagu.*` / `.realisasi.*` / `.bukti.*`. Kunci-kunci itu ada di
katalog `sdl_permissions` tapi **tidak diberikan ke role mana pun**. Akibatnya,
dengan konfigurasi produksi apa adanya, tidak ada satu akun operasional pun yang
bisa membaca usulan — endpoint-nya ada tapi tak terjangkau.

`seed-docs` karena itu menambahkan baris `sdl_role_permissions` supaya kedua
mesin otorisasi benar-benar dijalankan. **Peta role→permission di
`HARNESS_ROLE_PERMISSIONS` bukan konfigurasi produksi** dan tidak boleh
dijadikan rujukan untuk itu. Scope dan batas klasifikasi sengaja tidak disentuh,
karena justru di situ Engine A membeda-bedakan.

Tambalan identitas kedua sempat ada antara dua sesi 2026-11-01 — satu baris
`sdl_user_roles` untuk kabagrenmin — lalu **dicabut** begitu B9 diperbaiki di
source. Yang tersisa hanya penghapusnya (`dropObsoleteDirectRole`), karena
tabel itu tidak ikut `TRUNCATE` dan baris tertinggal akan membuat endpoint
50/51 lolos lewat jalur lama. Selain `sdl_role_permissions`, identitas tidak
disentuh.

Apakah konfigurasi produksi itu sendiri keliru adalah pertanyaan terpisah yang
**belum dijawab** — bisa jadi memang disengaja, bisa jadi permission-nya
diberikan Superadmin lewat `/admin` setelah seed. Perlu dikonfirmasi ke pemilik
sistem, bukan diputuskan dari sini.

#### Masih terbuka

1. **Body request nyata di registry — selesai untuk delapan domain.**
   Mekaniknya terbukti 48 kali (lihat
   [Varian jalur sukses](#varian-jalur-sukses-mekanik-harness)). Kedua mesin
   otorisasi kini punya mutasi berhasil: Engine A sejak `usulan`, Engine B
   sejak [varian `unit-work`/`urmin-registry`](#varian-engine-b-unit-work--urmin-registry).

   **Daftar "belum pernah dijalankan" kini kosong.** Tiga endpoint multipart
   (69 unggah bukti, 103 unggah lampiran, 109 intake) adalah penghuni
   terakhirnya dan masuk 2026-11-01, sesudah `harness/client.js` bisa merakit
   `multipart/form-data`. Endpoint 50/51 sempat di sini karena jalur suksesnya
   **tidak ada** (B8); sesudah perbaikan 2026-11-01 keduanya punya varian hijau.

   Batasan keras #7 di `CLAUDE.md` kini **terpenuhi lebih jauh**. Selain
   endpoint 70 yang mengunduh, verifikasi realisasi (67) membuka amplop
   AES-GCM **di dalam transaksi keuangan** dan mencocokkan ulang `sha256`
   plaintext-nya; Express menghasilkan keputusan yang sama persis. Yang masih
   kurang tetap sama: uji terhadap **record produksi lama** — bukti hasil
   `seed-docs` tetap record baru. Lakukan terhadap database produksi sebelum
   trafik dialihkan.
2. **Format timestamp tidak pernah dibandingkan harness.** Normalizer
   mengganti setiap timestamp dengan `<timestamp>`, jadi perbedaan format
   Go ↔ Express tidak akan pernah terdeteksi olehnya — berapa kali pun ia
   dijalankan. Yang menutupi celah itu alat terpisah:

   ```bash
   docker compose --env-file .env -f infra/compose.dev.yaml \
     -f infra/compose.express.yaml -f infra/compose.harness.yaml \
     run --rm --build --entrypoint node harness verify/timestamp-parity.js
   ```

   Ia membandingkan byte mentah, dipasangkan lewat JALUR JSON dan bukan lewat
   urutan kemunculan — Go menyerialkan map dengan kunci terurut abjad
   sementara Express mengikuti urutan objek literal, dan pemasangan
   per-indeks melaporkan selisih urutan itu sebagai selisih nilai. Status
   terakhir: **79/79 cocok (2026-11-01)**. Jalankan ulang setelah menyentuh
   serialisasi mana pun; harness tidak akan menolong di sini.

Mutasi mengubah database sungguhan. Ambil snapshot dulu:
`docker exec <db> pg_dump -U sdl_app -d sdl_root_dev -Fc -f /tmp/pre.dump`.

### Keputusan yang sudah diambil — jangan diulang bahas

- JavaScript polos ESM, bukan TypeScript. Satu `package.json`, tanpa proyek bersarang.
- SQL mentah lewat `pg`, bukan ORM.
- `@node-rs/argon2` (biner siap pakai), bukan paket `argon2` yang butuh node-gyp.
- `busboy` untuk multipart, `sharp` untuk avatar, `nodemailer` untuk SMTP.
- Sesi tetap di database, bukan JWT.
- Kontrak API beku; perbaikan desain masuk `DEVIATIONS.md`.
- Express berjalan berdampingan sebagai service `api-express`; trafik belum dialihkan.

### Gerbang yang sudah lulus — tidak perlu diulang

```
npm run verify:crypto    30/30   argon2id · HMAC · AES-GCM, dua arah vs Go
npm run verify:gojson    18/18   serialisasi JSON byte-identik vs encoding/json
npm run verify:email     16/16   isi email notifikasi byte-identik vs Go
npm run verify                   ketiganya berurutan
```

Ketiganya menjalankan Go di container atas **salinan** source; `apps/backend`
tidak pernah ditambahi berkas. `verify:email` menyalin shim kecil ke dalam
paket `auth` pada salinan itu, supaya `buildNotificationEmail` yang tidak
diekspor tetap bisa dipanggil.

Dua alat lagi butuh database dan karena itu dijalankan dari image harness —
service `db` tidak pernah diekspos ke host:

```bash
# Mesin keadaan outbox. Seluruhnya di dalam transaksi yang selalu di-ROLLBACK,
# jadi aman dijalankan di antara capture dan compare.
docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.harness.yaml \
  run --rm --build --entrypoint node harness verify/email-worker.js        # 9/9

# D4: format DAN presisi timestamp, byte mentah tanpa normalisasi. Butuh KEDUA
# backend hidup sekaligus karena ia memanggil keduanya dengan satu token sesi
# yang sama — yang dibanding hanya serialisasinya, bukan perbedaan login.
docker compose --env-file .env -f infra/compose.dev.yaml \
  -f infra/compose.express.yaml -f infra/compose.harness.yaml \
  run --rm --build --entrypoint node harness verify/timestamp-parity.js    # 79/79
```

Cache modul Go disimpan di volume `sdl_verify_gomodcache`. Tanpa itu setiap
jalan mengunduh ulang seluruh dependensi, dan `proxy.golang.org` cukup sering
memutusnya di tengah (`unexpected EOF`) sehingga alatnya gagal karena jaringan,
bukan karena paritas.

---

### Hubungan dengan `docs/MIGRASI-EXPRESS-REACT.md`

Dokumen itu (2026-10-27) adalah **rencana strategis**: peta padanan teknologi
Go→Node, analisis risiko keamanan per lapisan, dan estimasi 14–21 minggu.
Masih berlaku dan tidak digantikan — baca §3, §4, §7, dan §9 di sana.

Dokumen ini adalah **rencana eksekusi** untuk dipakai sehari-hari. Dua angka
di dokumen lama sudah dikoreksi di sini: jumlah endpoint **142** (bukan 174,
yang ikut menghitung file `_test.go` dan handler yang tidak terpasang), dan nama
guard **`AuthorizeRoleEditor`** (tidak ada fungsi bernama `AuthorizeIdentity`
di source). Dokumen lama juga menyebut `internal/delegations` perlu diporting —
tidak: itu kode mati yang digantikan handler 403.

---

## Prinsip

Lima aturan yang memutuskan banyak pertanyaan kecil di sepanjang jalan:

1. **Paritas dulu, perbaikan belakangan.** Setiap keanehan di Go direplikasi apa adanya.
   Yang pantas diperbaiki dicatat di `DEVIATIONS.md`, dikerjakan setelah Express
   melayani 100% trafik.
2. **Go backend tetap hidup sampai akhir.** Ia adalah *oracle* — rujukan saat ragu dan
   pembanding otomatis dalam test. Menghapusnya lebih awal berarti kehilangan
   satu-satunya definisi perilaku yang akurat.
3. **Skema database tidak ikut bermigrasi.** 33 file SQL dipakai ulang persis. Satu
   database, dua backend. Tidak ada dual-write, tidak ada sinkronisasi.
4. **Potong per domain, bukan per layer.** Satu domain diselesaikan tuntas
   (route → authz → handler → test) sebelum domain berikutnya dimulai. Migrasi
   "semua model dulu, semua controller kemudian" membuat tidak ada yang bisa diuji
   sampai semuanya selesai.
5. **Peralihan lewat reverse proxy, bukan lewat flag di kode.** Caddy mengarahkan
   per prefix. Rollback = satu baris config + reload, bukan rebuild.

---

## Tahap 0 — Fondasi & jaring pengaman

**Tujuan:** punya alat untuk membuktikan paritas, sebelum ada yang perlu dibuktikan.

- [ ] Siapkan skeleton Express di `apps/backend-express/`.
      Sudah terpasang: `express@5`, `pg`. Menyusul: `argon2`, `nodemailer`,
      dan pustaka validasi.
- [x] Jalankan Go backend + Postgres dev. Selesai lewat `scripts/local-setup.sh up`:
      33 migrasi diterapkan, ketiga container sehat, `/api/v1/system/status` → `ready`.
- [~] Seed data uji yang **deterministik**. `bootstrap`, `prepare-seed`, dan `seed`
      sudah dijalankan (2026-10-31): 14 user, 16 grant, ke-10 aktor harness bersesi.
      **Yang masih kurang: dokumen.** Belum ada satu pun record per klasifikasi,
      sehingga 70 kasus ber-path-param dilewati.
- [x] **Bangun harness golden-file.** Selesai: `apps/backend-express/harness/`
      (lihat README-nya). JavaScript ESM, memakai `package.json` yang sama dengan
      backend Express. Registry 142 endpoint bernomor sesuai `API-CONTRACT.md` §5,
      10 persona aktor, normalisasi nilai volatil, tiga kelas keamanan
      (68 read · 23 probe · 51 mutating), perintah `capture` / `compare` / `list`.
      Berjalan di network Docker lewat `infra/compose.harness.yaml` karena
      service `api` tidak diekspos ke host.
- [x] Harness yang sama bisa diarahkan ke Express (`SDL_HARNESS_TARGET=express`)
      dan membandingkan hasilnya. Ini definisi "selesai" untuk tahap berikutnya.
- [ ] **Isi body request nyata di registry.** 124 endpoint domain masih berjalan
      dengan body `{}` — yang terekam baru bentuk respons validasi. Jalur sukses
      butuh body sebenarnya, diisi bertahap per domain di Tahap 4.
- [ ] **Dukungan multipart** untuk endpoint unggah (lampiran 10 MiB, avatar 2 MiB,
      evidence 5 MiB). Sekarang hanya terekam sebagai penolakan bentuk.
- [ ] **Porting suite keamanan `internal/securitytest` (9 file, 1 692 baris)**,
      sebelum satu endpoint pun ditulis. Suite ini memakai build tag
      `r2d5integration` sehingga **tidak ikut** `go test ./...`; ia dijalankan
      terpisah lewat `scripts/security-test-r2d5.sh` dengan Postgres ephemeral.
      Jadikan ia alat ukur netral: harus lulus melawan backend Go sekarang,
      lalu melawan Express nanti.

> Golden file dan suite keamanan mengukur dua hal berbeda dan keduanya diperlukan.
> Golden file menangkap **bentuk** respons (field, status, header); suite keamanan
> menangkap **siapa yang boleh** mendapatkannya. Endpoint bisa cocok byte-per-byte
> dengan golden file sambil tetap membocorkan data ke role yang salah.
- [ ] Port runner migrasi: baca `apps/backend/internal/migrations/sql/*.sql`,
      urut nama file, SHA-256 per file, ledger di `sdl_schema_migrations`,
      advisory lock, **tolak kalau checksum berubah**. Perilaku ini sudah benar di Go
      (`migrations/migrate.go`) — tiru, jangan ganti dengan tool migrasi umum yang
      ledger-nya berbeda bentuk.
- [ ] Padanan flag CLI: `--migrate`, `--bootstrap-superadmin` (stdin-only),
      `--healthcheck`.

**Gerbang keluar:** golden file untuk seluruh 142 endpoint tersimpan, harness
melaporkan 142/142 cocok saat dijalankan terhadap Go backend itu sendiri, dan
suite keamanan hasil porting lulus melawan backend Go yang sedang berjalan.

> Jalankan `capture` dengan mutasi **mati** dulu terhadap database dev biasa.
> Baseline anonim mencakup seluruh 142 endpoint tanpa menyentuh data, dan itu
> sudah memetakan seluruh gerbang autentikasi. Baru setelah ada database sekali
> pakai, jalankan ulang dengan `SDL_HARNESS_ALLOW_MUTATIONS=true` untuk 51 kasus
> sisanya.

---

## Tahap 1 — Kriptografi & sesi (gerbang paling berisiko)

**Tujuan:** buktikan Express bisa menerima identitas yang sudah ada di database.
Tidak ada endpoint HTTP di tahap ini — murni unit test.

**Status: LULUS** — `npm run verify:crypto`, 30/30 pemeriksaan cocok.
Implementasi di `src/crypto/`, penguji di `verify/crypto-parity.js`.

Sisi Go dijalankan di container `golang:1.27.2-alpine3.24` atas **salinan**
source backend, jadi tidak ada berkas yang ditambahkan ke `apps/backend`.

- [x] **Verifikasi argon2id terhadap hash produksi.** Diuji dengan `password_hash`
      nyata milik `op-urmin` yang dibuat `auth.HashPassword` lewat
      `POST /api/v1/admin/users`: password benar → `true`, salah → `false`.
      Parameter terkonfirmasi dari database: `m=65536, t=3, p=2`, salt 22 char
      dan hash 43 char base64 **tanpa padding** (kalau ber-padding akan 24 dan 44).
- [x] Test *membuat* hash baru di Express lalu memverifikasinya di **Go**
      (`VerifyPassword`). Dua arah lolos untuk 3 password, termasuk yang memuat
      simbol dan karakter non-ASCII.
- [x] Penolakan parameter menyimpang: memory/time/threads di luar batas, versi
      salah, algoritma salah, urutan parameter tertukar, salt bukan 16 byte,
      jumlah bagian kurang — 9 kasus, semuanya ditolak.
- [x] HMAC `signature(purpose, value)` = `HMAC-SHA256(secret, purpose || 0x00 || value)`.
      Identik dengan Go untuk 8 kasus. Dibuktikan pula bahwa pemisah `0x00` memang
      berpengaruh: tanpa itu `("ab","c")` dan `("a","bc")` akan bertabrakan.
- [x] `tokenHash(token)` = `sha256(token)` hex lowercase — `src/crypto/tokens.js`.
- [x] Token acak 32 byte → base64url **raw** → panjang tepat **43 char**.
- [x] Proof-of-work captcha: `sha256(nonce + ":" + counter)`, dua byte pertama nol.
- [x] **AES-256-GCM evidence** (`subbagren/evidence_crypto.go`). Dua arah lolos,
      plus amplop yang diubah dan kunci salah sama-sama ditolak. Format:
      prefix envelope ASCII `"SDL1"` · nonce 96-bit acak · ciphertext+tag,
      dengan **envelope `"SDL1"` dipakai sebagai AAD** pada `Seal`/`Open`.
      Kunci 32 byte dari `SDL_EVIDENCE_KEY`; panjang ≠ 32 → gagal, tanpa fallback
      plaintext. Di Node: `crypto.createCipheriv('aes-256-gcm', key, nonce)`
      lalu `setAAD(Buffer.from('SDL1'))`.

      Uji round-trip sendiri TIDAK cukup — enkripsi dan dekripsi yang sama-sama
      salah akan lolos sambil tetap tidak kompatibel. Karena itu yang diuji
      adalah silang: blob Node dibuka Go, blob Go dibuka Node.

      **Masih terbuka:** belum ada record `sdl_subbagren_evidence` lama di
      database lokal untuk diuji. Lakukan sebelum domain `subbagren/budget`
      diporting di Tahap 4.
- [ ] Cookie: `sdl_session` (HttpOnly, 8 jam), `sdl_csrf` (non-HttpOnly, 1 jam),
      keduanya `Path=/`, `SameSite=Strict`, `Secure` dari env. Dikerjakan
      bersama Tahap 2, karena baru berarti saat ada respons HTTP.

**Gerbang keluar:** semua test di atas hijau. Tercapai untuk lapisan kripto.
Kesalahan di lapisan ini tidak terlihat sampai user sungguhan gagal login, dan
pada titik itu password mereka tidak bisa dipulihkan.

### Catatan pustaka

Paket `argon2` klasik butuh kompilasi native (node-gyp + Visual Studio Build
Tools) dan sering gagal di Windows. Yang dipakai adalah **`@node-rs/argon2`**,
yang mengirim biner siap pakai untuk win32-x64 maupun linux-musl — jadi sama
mulusnya di laptop Windows dan di image Alpine.

Hash dibuat lewat `hashRaw` dengan salt yang dikendalikan sendiri, lalu string
PHC dirakit manual. Ini disengaja: keluaran PHC bawaan pustaka belum tentu
memakai konvensi padding yang sama dengan `base64.RawStdEncoding` milik Go.

---

## Tahap 2 — Auth (15 endpoint)

**Tujuan:** bisa login sebagai user nyata di Express.

**Status: SELESAI** — harness melaporkan **19/19 kasus cocok** untuk mount
`root`, `system`, dan `auth`, termasuk `GET /auth/me` dengan sesi Superadmin
sungguhan.

```bash
SDL_HARNESS_TARGET=express \
SDL_HARNESS_ONLY_MOUNTS=root,system,auth \
SDL_HARNESS_API_BASE=http://api-express:8080 \
docker compose --env-file .env \
  -f infra/compose.dev.yaml -f infra/compose.harness.yaml \
  run --rm -e SDL_HARNESS_TARGET -e SDL_HARNESS_ONLY_MOUNTS -e SDL_HARNESS_API_BASE \
  harness compare
```

Express berjalan berdampingan dengan Go sebagai service `api-express`
(`infra/compose.express.yaml`), berbagi database yang sama. Trafik belum
dialihkan ke sana.

Uji perilaku tambahan di luar golden file:

| Skenario | Hasil |
|---|---|
| Password benar (hash buatan Go) | sampai ke cabang OTP → 503 `email_delivery_unavailable` |
| Password salah | 401 `invalid_credentials` |
| Username tidak ada | 401 `invalid_credentials` yang sama persis |
| CAPTCHA dipakai ulang | 403 `captcha_invalid` |
| Tanpa header `X-CSRF-Token` | 403 `csrf_invalid` |
| `Origin` di luar allowlist | 403 `csrf_invalid` |

Baris pertama adalah buktinya: untuk mencapai cabang OTP, verifikasi argon2
terhadap hash nyata buatan Go harus sudah lolos di dalam server Express yang
sedang berjalan.

- [ ] Middleware: 4 security header, request ID, error handler global (pengganti
      `middleware.Recoverer`, **harus menangkap rejection dari handler async**).
- [ ] `allowMutation`: allowlist Origin + double-submit CSRF (bandingkan konstan-waktu).
- [ ] 15 endpoint `/api/v1/auth/*` sesuai §5.3 kontrak.
- [ ] Throttle `sdl_login_limits` — salin SQL `ON CONFLICT` apa adanya dari
      `auth/service.go:191`. Logikanya (reset jendela vs increment vs lock) rumit
      dan mudah salah kalau ditulis ulang.
- [ ] Alur OTP: challenge 43 char, kode 6 digit, hidup 5 menit, maks 5 percobaan,
      sekali pakai, challenge lama dibatalkan transaksional.
- [ ] Jalur tanpa-OTP: `FOR SHARE` + cek ulang policy dalam transaksi →
      `403 policy_changed_retry_login`.
- [ ] Hash dummy saat username tidak ditemukan (anti-enumerasi timing).
- [ ] SMTP: kirim OTP, dan **batalkan challenge** kalau pengiriman gagal, plus tulis
      audit `auth.otp_delivery_failed`.
- [ ] `AuthorizeOperational` dan `AuthorizeRoleEditor` — dua query SQL di
      `service.go:470` dan `:490`, salin apa adanya.

**Gerbang keluar:** login Superadmin (wajib OTP via SMTP) dan login satu user
operasional berhasil di Express; `GET /me` cocok byte-per-byte dengan golden file.

> Ini juga alasan SMTP dikerjakan di tahap awal, bukan akhir: tanpa OTP yang
> terkirim, tidak ada cara login sebagai Superadmin untuk menguji sisanya.

---

## Tahap 3 — Lapisan otorisasi

**Tujuan:** kedua engine otorisasi berjalan dan teruji, sebelum ada handler domain
yang memakainya.

**Status: KODE SELESAI, test porting belum.**

| Berkas | Isi |
|---|---|
| `src/access/policy.js` | Engine A, fungsi murni — port `access/policy.go` |
| `src/access/database.js` | Engine A, pemuat grant termasuk cabang delegasi |
| `src/access/devdemo.js` | jalur demo Superadmin berlapis tiga |
| `src/modules/unitwork/permit.js` | Engine B, berbasis scope tanpa `permission_key` |
| `src/auth/guards.js` | `requireOperational` / `requireRoleEditor` sebagai middleware |

> **Catatan jujur soal kekuatan verifikasi.** Perbandingan golden file untuk
> `sumda` dan `binfung` baru mencakup jalur **anonim**, karena 12 akun
> operasional belum di-seed. Yang terbukti barulah gerbang autentikasi; logika
> Engine B, penyaringan per baris, dan optimistic locking **belum teruji sama
> sekali**. Jalankan `local-setup.cmd seed` sebelum menganggap domain ini beres.

- [ ] **Engine A** (`internal/access/policy.go`) — fungsi murni, 73 baris.
      Porting langsung + porting **test-nya juga**: `policy_test.go` sudah mencakup
      deny-by-default, unit scoping, ownership, expiry, klasifikasi, assigned scope,
      dan larangan lintas-unit. Empat test itu adalah spesifikasi keamanan gratis.
- [ ] Pemuat grant dari database (`access/database.go`).
- [ ] **Engine B** (`unitwork.permit`) — terpisah, berbasis scope, **tanpa**
      `permission_key`. Jangan digabung dengan Engine A.
- [ ] Tiga pengecekan ad-hoc: `isKabag()`, `portal.editor()`, `executiveV2Access()`.
- [ ] `devdemo.Superadmin()` — jalur demo, pastikan mati kecuali
      `SDL_DEV_SUPERADMIN_WORKSPACE=true`.

**Gerbang keluar:** port dari `policy_test.go` dan `role_guard_test.go` hijau di Express.

---

## Tahap 4 — Domain, per potongan

Urutan dipilih dari yang paling sederhana ke paling berbelit, supaya pola
(handler, transaksi, audit, error) sudah mapan sebelum menyentuh yang sulit.

**Kemajuan: 72/142 endpoint.** `root` 3 · `auth` 15 · `admin` 16 · `sumda` 6 ·
`binfung` 5 · `portal` 3 · `executive` 2 · `urmin-registry` 9 · `unit-work` 13.

| Urutan | Domain | Endpoint | Engine | Catatan |
|---|---|---|---|---|
| 1 | `admin/roles` + `roadmap` + deny-delegasi | 9 | — | **SELESAI** — 27/27 cocok (bersama users) |
| 2 | `admin/users` | 7 | — | **SELESAI** |
| 3 | `subbagbinfung/registry` | 5 | B | **SELESAI** — 11/11 cocok, tapi baru jalur anonim |
| 4 | `subbagsumda/registry` | 6 | B | **SELESAI** — idem, + master pangkat |
| 5 | `portal/posts` | 3 | ad-hoc | **SELESAI** — 9/9 cocok. Superadmin baca 200, tulis 403 |
| 6 | `executive/v2` | 2 | ad-hoc | **SELESAI** — 4/4 cocok termasuk 5 metrik admin terhitung |
| 7 | `urmin/registry` | 9 | B | **SELESAI** — 9/9 cocok. Modul sendiri, bukan factory bersama |
| 8 | `unit-work` | 13 | B | **SELESAI** — 22/22 cocok. Multipart via busboy |
| 9 | `subbagren/usulan` | 10 | A | workflow review berjenjang |
| 10 | `subbagren/budget` | 11 | A | + AES-GCM evidence, upload bukti. Verifikasi dekripsi record lama |
| 11 | `leadership/directives` | 18 | A + isKabag | draft, lampiran, inbox/sent |
| 12 | `urmin/surat-masuk` | 15 | A | termasuk `POST /intake` gabungan |
| 13 | `urmin/distribution-inbox` | 5 | A | |
| 14 | `urmin/dispositions` | 11 | A | rantai disposisi + approval final |

Untuk **tiap** potongan, definisi selesai yang sama:

- [ ] Route terdaftar dengan **urutan statis-sebelum-parameter** (§6 kontrak)
- [ ] Guard dan permission sesuai tabel §5
- [ ] Batas ukuran body per route (bukan global)
- [ ] Validasi strict (field asing ditolak di endpoint yang Go menolaknya)
- [ ] Batas transaksi sama persis — perhatikan `FOR UPDATE` / `FOR SHARE`
- [ ] Penulisan `sdl_audit_events` dengan `event_key` yang sama
- [ ] Harness golden file hijau untuk seluruh endpoint potongan itu
- [ ] Caddy dialihkan untuk prefix ini → Express; diamati; siap rollback

**Catatan tiga domain tersulit:**

- **`urmin/surat-masuk`** — `GET /` memfilter otorisasi **per baris** setelah query.
  Lambat, tapi disengaja. Jangan diubah jadi filter SQL; semantik scope dan
  klasifikasi akan bergeser tanpa terlihat di test manapun.
- **`POST /urmin/surat-masuk/intake`** (`r5f7.go`, ~270 baris) — satu transaksi yang
  membuat/mengubah dokumen, melampirkan file, mendaftarkan, dan mendistribusikan,
  lalu menulis ke outbox email. Kerjakan terakhir di domainnya, setelah semua
  potongannya sendiri sudah berjalan terpisah.
- **`urmin/dispositions`** — `taskChainValid()` memvalidasi rantai disposisi berjenjang
  dengan parent. Di sini pula jebakan `/leadership` vs `/{taskId}` (§5.15).

---

## Tahap 5 — Worker latar ✅ SELESAI 2026-11-01

- [x] `notifications.Run()` — ticker **10 detik**, memproses `sdl_urmin_email_outbox`
      dan `sdl_urmin_intake_mail_outbox`. Diporting ke
      `src/notifications/urmin.js` + `intake.js`, mengikuti pembagian berkas Go.
- [x] Pola `claim` → `deliver` → `retry`, dengan penandaan permanen vs sementara.
- [x] **Hanya satu instance yang memproses outbox** — ditegakkan di kode, bukan
      di prosedur. Lihat di bawah.

### Penjaga aturan 7: opt-in, bukan opt-out

Go menyalakan worker-nya kapan pun SMTP siap dan
`SDL_EMAIL_NOTIFICATIONS_ENABLED` bukan `"false"` — **default menyala**. Kalau
Express mengikuti pola itu, dua backend yang berbagi satu database akan
sama-sama menguras outbox, dan pengguna nyata menerima setiap notifikasi dua
kali.

Express karena itu menuntut `SDL_EMAIL_WORKER_ENABLED=true` secara eksplisit,
**default MATI**. Peralihannya bersisi dua dan sengaja tidak bisa dibalik
urutannya tanpa sadar:

```
1. SDL_EMAIL_NOTIFICATIONS_ENABLED=false  pada service api        (Go berhenti)
2. SDL_EMAIL_WORKER_ENABLED=true          pada service api-express (Express ambil alih)
```

Alasan penolakan selalu dicatat di log saat start, jadi keadaan "worker mana
yang hidup" bisa dibaca tanpa menebak:

```
urmin email notification worker inactive  reason=worker_owned_by_go_backend
urmin email notification worker inactive  reason=smtp_not_configured
urmin email notification worker inactive  reason=notifications_disabled
urmin email notification worker enabled
```

`SDL_EMAIL_NOTIFICATIONS_ENABLED=false` tetap dihormati Express sebagai sakelar
induk, jadi menyetelnya mematikan **kedua** backend sekaligus.

### Verifikasi: dua alat, karena harness tidak bisa menyentuhnya

Worker tidak punya endpoint, jadi seluruh kasus harness tidak membuktikan apa
pun tentangnya. Dua alat dibuat khusus:

| Alat | Membuktikan |
|---|---|
| `npm run verify:email` | Isi email **byte-identik** dengan Go — 16/16 bagian (teks polos + HTML untuk 8 kasus), termasuk arah navigasi R5F22 dan escaping HTML |
| `verify/email-worker.js` | Mesin keadaan outbox: klaim, lease, backoff, batas 6 percobaan, pemulihan baris tersangkut — 9/9 |

`verify:email` memanggil `buildNotificationEmail` Go yang **tidak diekspor**,
lewat shim yang disalin ke dalam paket `auth` pada SALINAN source di container
(`verify/notification-shim.go`). `apps/backend` tidak ditambahi berkas apa pun,
pola yang sama dengan `crosscheck.go`. Amplop MIME-nya sengaja tidak dibanding:
boundary-nya acak dan header `Date` berisi jam saat itu (D2).

`email-worker.js` menjalankan SELURUH pengujiannya di dalam satu transaksi yang
selalu di-ROLLBACK, fixture dan semuanya — aman dijalankan di antara `capture`
dan `compare`. Ia butuh akses database, dan service `db` tidak pernah diekspos
ke host, jadi ia dijalankan dari image harness:

```bash
docker compose --env-file .env -f infra/compose.dev.yaml -f infra/compose.harness.yaml \
  run --rm --build --entrypoint node harness verify/email-worker.js
```

### Tiga hal yang mudah salah saat memporting worker ini

- **`attempts` yang dibaca `retry()` adalah nilai SESUDAH dinaikkan klaim.**
  Query klaim melakukan `attempts=attempts+1 ... RETURNING n.attempts`, jadi
  rentangnya 1..6 dan indeks backoff-nya `attempts-1`. Membacanya sebagai nilai
  sebelum kenaikan menggeser seluruh jadwal percobaan ulang satu langkah.
- **Pernyataan pertama di `claim()` bukan hiasan.** Ia memulihkan baris yang
  tersangkut di `sending` karena prosesnya mati setelah percobaan terakhir.
  Tanpa itu, cabang lease-kedaluwarsa akan mengklaimnya selamanya.
- **Dua antrean memvalidasi penerima dengan aturan BERBEDA**, dan itu asimetri
  di Go yang direplikasi apa adanya: intake menuntut
  `NOT must_change_password` dan menolak NUL pada alamat; disposisi tidak
  memeriksa keduanya. Masuk akal untuk intake — emailnya menyuruh orang login,
  dan akun yang belum merotasi password tidak bisa berbuat apa-apa selain itu.

Keduanya juga menolak alamat berakhiran `.invalid` secara **permanen**. Itu
bukan kehati-hatian berlebihan: ke-13 akun `seed-bagrenmin` beralamat
`<username>@siera.invalid`, jadi tanpa penjaga itu setiap deployment uji
mencoba enam kali per notifikasi ke domain yang dijamin tidak ada.

---

## Tahap 6 — Peralihan & pembersihan

**Keadaan 2026-11-01: ini satu-satunya tahap yang belum disentuh.** Seluruh
prasyaratnya sudah selesai — paritas 142/142, harness 382/382, uji keamanan
21/21, dan keempat perkakas siklus hidup.

### Hambatan yang harus dibereskan DULU: Caddy tidak pernah melihat `/api`

Rencana ini mengandaikan Caddy bisa mengalihkan per prefix. **Hari ini ia
tidak bisa**, dan itu bukan soal menulis satu baris config:

```
Browser ──► Caddy ──► frontend:5173 (Vite) ──/api──► api:8080
            ^                                        ^
            satu-satunya upstream                    target tunggal,
            (infra/Caddyfile)                        hardcoded di
                                                     vite.config.ts:17
```

`reverse_proxy frontend:5173` adalah SATU-SATUNYA upstream Caddy. Yang
memecah `/api` adalah Vite, dengan target tunggal `http://api:8080`. Jadi
tidak ada tempat di config Caddy yang bisa diarahkan ke `api-express`.

Dua jalan, dan hanya satu yang konsisten dengan **aturan 5** ("peralihan lewat
Caddy per prefix, bukan feature flag di kode; rollback = satu baris config +
reload"):

- **Tambahkan `handle /api/*` di Caddy** yang menunjuk langsung ke `api` atau
  `api-express`, melewati Vite untuk trafik API. Rollback tetap satu baris +
  reload. **Ini yang sesuai aturan 5.**
- Memecah di `vite.config.ts` — melanggar aturan 5 (perubahan kode, bukan
  config) dan menyentuh `apps/frontend/` yang menurut aturan 3 tidak disentuh.

Konsekuensi yang perlu diperiksa saat menempuh jalan pertama: hari ini
permintaan API sampai ke backend LEWAT Vite, yang melakukan
`changeOrigin: true`. Memotong Vite mengubah header `Origin`/`Host` yang
diterima backend — dan `SDL_ALLOWED_ORIGINS` menolak mutation dengan 403 yang
**muncul di UI sebagai pesan CAPTCHA gagal** (batasan keras #2). Uji login
sungguhan lewat HTTPS sesudah perubahan itu, jangan hanya `curl /healthz`.

- [ ] Jalankan paralel: Caddy mengarahkan sebagian prefix ke Express, sisanya ke Go.
- [ ] Alihkan prefix satu per satu, bukan sekaligus. Amati log antar peralihan.
- [ ] **Jalankan `scripts/security-test-express.sh` sebelum prefix PERTAMA
      dialihkan.** Begitu trafik berpindah, `security-test-r2d5.sh` tetap hijau
      sambil berhenti menguji backend yang melayani.
- [ ] Setelah 142/142 dilayani Express dan stabil: matikan worker Go, lalu service Go.
      **Urutan worker email bersisi dua** (aturan 7): matikan di Go DULU, baru
      nyalakan `SDL_EMAIL_WORKER_ENABLED=true` di Express. Terbalik = email ganda.
- [ ] Perbarui `infra/compose.*.yaml`, `Dockerfile`, `sdl-run.sh`, `sdl-stop.sh`,
      `scripts/*.sh` — termasuk mengalihkan `scripts/local-setup.sh` dari
      perkakas Go ke `infra/compose.express-cli.yaml`.
- [x] ~~Porting utilitas `cmd/`~~ — **selesai 2026-11-01.** `--migrate`,
      `--bootstrap-superadmin`, `seed-bagrenmin`, `reset-all-passwords`,
      semuanya di `src/cli/` + `src/migrations/`, diuji A/B terhadap Go.
- [ ] `.env.example` — nilainya tidak berubah; perbarui rujukan baris file di komentar
      (sekarang menunjuk ke `service.go:345` dan `LocalCaptcha.tsx:24`).
- [ ] Hapus `apps/backend/` **hanya setelah** Express melayani produksi dengan stabil.
      Catatan: hambatan teknisnya sudah hilang — database baru kini bisa
      dibangun tanpa biner Go sama sekali.
- [ ] Kerjakan `DEVIATIONS.md` sebagai backlog perbaikan terpisah.

Dua hal yang BUKAN bagian tahap ini dan jangan ikut dikerjakan di sini:
jawaban pemilik sistem atas `docs/PERTANYAAN-KONFIGURASI-AKSES.md` (27
endpoint tak terjangkau — bukan cacat migrasi), dan backlog `DEVIATIONS.md`.

---

## Yang paling mungkin menggagalkan migrasi ini

Diurutkan berdasarkan biaya kalau terlewat:

| Risiko | Akibat | Penangkal |
|---|---|---|
| Parameter argon2 meleset | **Semua user terkunci permanen**, password tidak bisa dipulihkan | Gerbang Tahap 1, uji dua arah dengan hash nyata |
| Envelope AES-GCM tidak identik | **Bukti keuangan lama tak terbaca**, kerusakan senyap | Gerbang Tahap 1, dekripsi record lama dari DB |
| Satu pemeriksaan otorisasi hilang saat porting | Kebocoran data lintas unit, tanpa error apa pun | Suite `securitytest` diporting di Tahap 0, sebelum endpoint |
| Urutan route Express | Endpoint statis tidak pernah tereksekusi (`/leadership`, `/inbox`, `/draft`) | Audit urutan tiap potongan; golden file menangkapnya |
| `SDL_ALLOWED_ORIGINS` tidak diisi | Semua mutation `403`, **muncul sebagai pesan CAPTCHA gagal** di UI | Tegaskan di Tahap 2; cek log allowlist saat start |
| Dua engine authz digabung | Perubahan hak akses yang halus dan senyap | Tahap 3 memisahkannya eksplisit + porting test |
| `DisallowUnknownFields` hilang | Payload asing diterima diam-diam | validasi mode strict di endpoint auth |
| Worker email ganda saat transisi | Email terkirim dua kali ke pengguna nyata | Tahap 5; satu worker aktif |
| `must_change_password` tidak dicek | User yang belum rotasi password bisa menembus guard | Ada di kedua guard; uji eksplisit |
| Superadmin lolos ke endpoint operasional | Pelanggaran pemisahan peran | `role_guard_test.go` diporting |
| Batas body jadi global | Upload 10 MiB tertolak, atau body auth 4 KB jadi longgar | Limit per route |
| HTTPS/secure context hilang | `crypto.subtle` mati → **captcha tidak bisa dihitung → tidak bisa login** | Pertahankan konfigurasi Caddy apa adanya |

---

## Catatan tentang pilihan teknologi

Beberapa keputusan yang lebih baik diambil sekarang daripada di tengah jalan:

- **Query: SQL mentah lewat `pg`, bukan ORM.** Seluruh backend Go memakai SQL mentah,
  banyak di antaranya dengan `FOR UPDATE`, `ON CONFLICT`, array Postgres, dan
  subquery `EXISTS` berlapis. Menerjemahkannya ke ORM adalah penulisan ulang kedua
  di dalam penulisan ulang pertama — dua sumber kesalahan, bukan satu. Query-nya
  bisa disalin hampir verbatim; hanya placeholder `$1` yang sudah sama di `pg`.
- **JavaScript polos (ESM), bukan TypeScript.** Keputusan pemilik proyek.
  Konsekuensinya: tidak ada pemeriksa yang menjaga bentuk respons tetap konsisten
  di waktu tulis, jadi **harness golden-file memikul seluruh beban itu**. Jalankan
  `compare` setiap selesai satu potongan domain, bukan sekali di akhir tahap —
  ketidakcocokan yang ditemukan lebih awal jauh lebih murah dicari penyebabnya.
- **Validasi harus menolak field asing**, karena Go memakai `DisallowUnknownFields`
  di endpoint auth. Pustaka apa pun boleh; yang wajib adalah mode strict-nya aktif.
- **Jangan pakai `helmet()` default** — set empat header secara eksplisit (§1.3).
- **Sesi tetap di database, bukan JWT** (§2.1). Keputusan ini sudah dibuat oleh
  desain yang ada; mengubahnya bukan bagian dari migrasi.

---

## Urutan eksekusi ringkas

```
Tahap 0  fondasi + golden file         ← alat ukur dulu
Tahap 1  kripto & sesi                 ← GERBANG: jangan lanjut kalau merah
Tahap 2  auth (15)                     ← bisa login
Tahap 3  dua engine authz              ← pondasi semua domain
Tahap 4  14 potongan domain (124)      ← alihkan per prefix via Caddy
Tahap 5  worker email                  ← hati-hati pengiriman ganda
Tahap 6  peralihan penuh + bersih-bersih
```
