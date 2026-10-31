# Rencana Migrasi Backend: Go → Express

> Pendamping `API-CONTRACT.md`. Dokumen itu menjawab **"apa yang harus sama"**;
> dokumen ini menjawab **"dengan urutan apa, dan kapan boleh dianggap selesai"**.

---

## LANJUT DARI SINI

*Diperbarui 2026-10-31. Baca bagian ini lebih dulu sebelum menyentuh kode.*

### Keadaan saat sesi 2026-10-31 berhenti

| Hal | Keadaan |
|---|---|
| Endpoint | **93/142** diporting, ke-93 cocok dengan baseline Go |
| Harness | 331 kasus, **0 dilewati**, 22 fixture |
| Database | `sdl_root_dev` di volume `sdl-foundation-r1_sdl_root_r1_pgdata` — **berisi sisa run `compare` terakhir** |
| Golden file | direkam dari Go **setelah** `seed-docs`, valid |
| Snapshot pra-mutasi | `pg_dump -Fc` sempat diambil ke scratchpad sesi; **tidak permanen**, jangan diandalkan |

**Langkah pertama saat melanjutkan:** nyalakan Docker Desktop, tunggu engine
siap, lalu jalankan `harness seed-docs` sebelum apa pun yang membandingkan.
Database sekarang memuat keadaan sisa compare, bukan fixture bersih.

Keputusan yang menunggu, belum diambil:

1. Lanjut porting `leadership/directives` (18), **atau**
2. Isi body mutasi nyata di registry lebih dulu, supaya jalur tulis
   (transisi status, optimistic locking, maker-checker) ikut teruji sebelum
   49 endpoint sisanya menumpuk di atasnya.

Satu pertanyaan terbuka untuk pemilik sistem: apakah role operasional memang
sengaja tidak diberi permission `subbagren.usulan.*` dan
`subbagren.anggaran.pagu.*`/`.realisasi.*`/`.bukti.*`? Lihat
[Peringatan tentang `seed-docs` dan permission](#peringatan-tentang-seed-docs-dan-permission).

### Posisi sekarang: 93/142 endpoint — ke-93 terverifikasi

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

Yang **masih** belum terbukti: jalur mutasi yang sukses. Registry mengirim body
`{}` untuk hampir semua POST/PATCH, jadi mutasi berhenti di validasi (400) dan
tidak pernah mencapai transisi status, optimistic locking, maupun maker-checker.
Lihat [Utang harness](#utang-harness).

| Selesai | n | Tersisa | n |
|---|---|---|---|
| `root` + `system` | 3 | `directives` | 18 |
| `auth` | 15 | `surat-masuk` | 15 |
| `admin` | 16 | `distribution-inbox` | 5 |
| `sumda` | 6 | `dispositions` | 11 |
| `binfung` | 5 | | |
| `portal` | 3 | | |
| `executive` | 2 | | |
| `urmin-registry` | 9 | | |
| `unit-work` | 13 | | |
| `usulan` | 10 | | |
| `budget` | 11 | | |

### Pelajaran dari porting `usulan`

`src/access/database.js` **tidak bisa di-parse** sampai 2026-10-31: komentarnya
berisi `identity.*` diikuti `/audit.*`, dan urutan bintang-garis-miring menutup
blok komentar lebih awal. Tidak ada yang menyadarinya karena Engine A belum
pernah di-`import` oleh modul mana pun — `usulan` adalah yang pertama.

Artinya: **berkas yang sudah ditulis tapi belum dipasang di `app.js` tidak
terbukti apa-apa**, bahkan tidak terbukti bisa di-parse. Tanpa TypeScript, satu-
satunya yang memeriksa adalah `node --check` dan harness. Jalankan
`node --check` atas setiap berkas baru sebelum build.

### Langkah berikutnya, berurutan

1. **`leadership/directives`** (18) — terbesar. Sumber: `internal/directives/`
   (`api.go`, `draft.go`, `attachments.go`). Perhatikan urutan route: 6 segmen
   statis harus didaftarkan sebelum `/:id`.
2. **`urmin/surat-masuk`** (15) — termasuk `POST /intake` (`r5f7.go`, ~270 baris)
   yang menggabungkan create/update + attach + register + distribute dalam satu
   transaksi. Kerjakan paling akhir di domainnya.
3. **`urmin/distribution-inbox`** (5)
4. **`urmin/dispositions`** (11) — rantai disposisi berjenjang + approval final.
   **Jebakan urutan**: `/leadership` wajib didaftarkan sebelum `/:taskId/*`.

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

`seed-docs` karena itu menambahkan 28 baris `sdl_role_permissions` supaya kedua
mesin otorisasi benar-benar dijalankan. **Peta role→permission di
`HARNESS_ROLE_PERMISSIONS` bukan konfigurasi produksi** dan tidak boleh
dijadikan rujukan untuk itu. Scope dan batas klasifikasi sengaja tidak disentuh,
karena justru di situ Engine A membeda-bedakan.

Apakah konfigurasi produksi itu sendiri keliru adalah pertanyaan terpisah yang
**belum dijawab** — bisa jadi memang disengaja, bisa jadi permission-nya
diberikan Superadmin lewat `/admin` setelah seed. Perlu dikonfirmasi ke pemilik
sistem, bukan diputuskan dari sini.

#### Masih terbuka

1. **Body request nyata di registry** — ini sekarang **batas terbesar** yang
   tersisa. Hampir semua POST/PATCH masih mengirim `{}`, jadi mutasi berhenti di
   validasi (400) dan tidak pernah mencapai transisi status, optimistic locking,
   `FOR UPDATE`, maupun maker-checker. Fixture-nya sudah ada; yang kurang tinggal
   body-nya.

   Jebakan yang menunggu di situ: begitu mutasi benar-benar berhasil, capture
   akan meninggalkan keadaan yang berbeda dari titik berangkatnya. `seed-docs`
   sebelum capture **dan** sebelum compare menjadi mutlak, bukan sekadar
   disarankan.

   Khusus `budget`, yang masih belum teruji karena ini: maker-checker, plafon
   pagu, dan urutan penguncian.

   Batasan keras #7 di `CLAUDE.md` kini **terpenuhi sebagian**. Endpoint 70
   menjawab 200 dengan plaintext utuh: Go membuka amplop yang disegel Node, dan
   Express menghasilkan byte yang sama. Yang masih kurang adalah uji terhadap
   **record produksi lama** — bukti hasil `seed-docs` tetap record baru.
   Lakukan terhadap database produksi sebelum trafik dialihkan.

   Dua jalan, dan pilihannya tidak sepele:
   - *Seed dokumen deterministik* — paling bersih, tapi perlu script baru.
   - *Isi body nyata di registry* supaya `create` menghasilkan fixture untuk run
     berikutnya. Lebih murah, tapi **membuat capture tidak idempoten**: tiap run
     menambah record, sehingga golden file endpoint daftar berubah terus.
     Perlu pembersihan setelah run, atau database sekali pakai.
2. **Format timestamp tidak pernah dibandingkan.** Normalizer mengganti setiap
   timestamp dengan `<timestamp>`, jadi perbedaan format Go ↔ Express tidak
   akan pernah terdeteksi harness. Lihat D4 di `DEVIATIONS.md` — ini belum
   diverifikasi, bukan sudah terbukti aman.

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
```

Keduanya menjalankan Go di container atas **salinan** source; `apps/backend`
tidak pernah ditambahi berkas.

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

## Tahap 5 — Worker latar

- [ ] `notifications.Run()` — ticker **10 detik**, memproses `sdl_urmin_email_outbox`
      dan `sdl_urmin_intake_mail_outbox`.
- [ ] Pola `claim` → `deliver` → `retry`, dengan penandaan permanen vs sementara.
- [ ] Aktif kecuali `SDL_EMAIL_NOTIFICATIONS_ENABLED="false"`.
- [ ] **Pastikan hanya satu instance yang memproses outbox.** Selama masa transisi,
      Go dan Express berjalan bersamaan — kalau keduanya menjalankan worker,
      email terkirim dua kali. Matikan worker di sisi Go begitu Express mengambil alih,
      dan verifikasi `claim` memakai penguncian baris.

---

## Tahap 6 — Peralihan & pembersihan

- [ ] Jalankan paralel: Caddy mengarahkan sebagian prefix ke Express, sisanya ke Go.
- [ ] Alihkan prefix satu per satu, bukan sekaligus. Amati log antar peralihan.
- [ ] Setelah 142/142 dilayani Express dan stabil: matikan worker Go, lalu service Go.
- [ ] Perbarui `infra/compose.*.yaml`, `Dockerfile`, `sdl-run.sh`, `sdl-stop.sh`,
      `scripts/*.sh`.
- [ ] Porting utilitas `cmd/`: `reset-all-passwords`, `seed-bagrenmin`
      (masing-masing punya Dockerfile + compose sendiri).
- [ ] `.env.example` — nilainya tidak berubah; perbarui rujukan baris file di komentar
      (sekarang menunjuk ke `service.go:345` dan `LocalCaptcha.tsx:24`).
- [ ] Hapus `apps/backend/` **hanya setelah** Express melayani produksi dengan stabil.
- [ ] Kerjakan `DEVIATIONS.md` sebagai backlog perbaikan terpisah.

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
