# R5H1 — Arahan ditujukan ke bagian, dan membawa suratnya

2026-11-04 · migrasi `040_arahan_bagian.sql` · diubah di Go **dan** Express bersamaan

## Alur yang diminta

```
Staf Urmin                 Kabagrenmin                     Bagian yang ditunjuk
----------                 -----------                     --------------------
catat surat masuk
needsDisposition=true
      │
      └── distribusi ────►  Surat Masuk
                            (tempat MELIHAT saja,
                             lalu tekan "Terima")
                                  │
                                  └── menu ARAHAN ────────►  Inbox Arahan
                                      pilih BAGIAN,          + Inbox Distribusi
                                      sebut suratnya            (suratnya ikut)
                                                                    │
                                                                    └── disposisi
                                                                        ke staf unit
```

Penunjukan **lewat bagian, bukan orang**. Empat pilihan: Kasubbagren,
Kasubbagsumda, Kasubbagbinfung, Kasubbagurmin. Siapa orangnya ditentukan sistem
saat kirim, dari pemegang jabatan yang berlaku waktu itu.

## Apa yang sebenarnya diperbaiki

Tiga hal yang sebelumnya putus, dan ketiganya putus di tempat yang berbeda:

| Sebelum | Sesudah |
|---|---|
| Penerima arahan dipilih per orang lewat `GET /candidates` | Dipilih per bagian lewat `GET /sections` |
| Backend menerima `incomingId` sejak R5G2, tapi **layar tidak pernah mengirimnya** | Layar punya pemilih surat, diisi `GET /letters` |
| Penerima arahan tahu ada surat tapi **tidak bisa membukanya**, dan **tidak bisa meneruskannya** ke stafnya | Pengiriman arahan ikut menulis `sdl_urmin_distributions` |

Yang ketiga adalah inti R5H1. Catatan R5G menyebut formulir "Distribusi ke Unit
/ Petugas" dilepas dari layar sementara
`sdl_urmin_disposition_tasks.distribution_id` tetap `NOT NULL`, sehingga **tidak
ada disposisi baru yang bisa dibuat sama sekali**. Penggantinya direncanakan
lewat Arahan tapi desainnya belum dibuat. Inilah desainnya: Arahan **adalah**
instrumen distribusi Kabagrenmin, bukan pesan di sampingnya.

## Keputusan desain

### Penerima tetap ORANG, bagian hanya cara memilih

`sdl_leadership_directive_recipients.recipient_id` tetap FK ke `sdl_users` dan
tetap `NOT NULL`. Migrasi 040 hanya menambahkan `section_key TEXT` sebagai
catatan **asal pilihan**.

Alternatifnya — menjadikan penerima sebuah unit — akan menghapus kemampuan
menjawab "siapa yang belum membaca". Seluruh status baca/terima, notifikasi,
dan jejak audit arahan bergantung pada identitas perorangan.

`section_key` nullable, dan `NULL` punya arti: "dipilih lewat daftar orang".
Itu keadaan seluruh baris sebelum 040 dan jalur `recipients` yang masih hidup
di kontrak. Bukan data yang hilang, melainkan pembeda dua cara penunjukan.

### Daftar bagian hidup di KODE, bukan tabel

`apps/backend/internal/directives/sections.go` ↔
`apps/backend-express/src/modules/directives/sections.js`. Wajib identik.

| `key` | `unit` | `role_key` |
|---|---|---|
| `kasubbagren` | `subbagren` | `br_kasubbagren` |
| `kasubbagsumda` | `subbagsumda` | `br_kasubbagsumda` |
| `kasubbagbinfung` | `subbagbinfung` | `br_kasubbagbinfung` |
| `kasubbagurmin` | `urmin` | **`br_ka_urmin`** |

Dua alasan:

1. **'Bagian' bukan unit.** `sdl_org_units` hanya punya empat baris, dan
   `kasubbagurmin` maupun `kabagrenmin` sama-sama berada di unit `urmin`. Tabel
   unit tidak bisa membedakan jabatan di dalam satu unit.
2. Peta bagian → (unit, role) adalah keputusan struktur organisasi. Di tabel,
   Role Editor bisa mengubah tujuan arahan tanpa seorang pun meninjau.

Pola yang sama sudah dipakai `isKabag()`, yang menuntut `br_kabagrenmin`
secara harfiah. `TestSectionTableMatchesSeededRoles` mengunci keempat pasangan
itu — terutama `br_ka_urmin`, yang gampang ditulis `br_kasubbagurmin` dan
gejalanya di layar adalah "belum ada pejabat aktif", terbaca seperti data yang
belum di-seed alih-alih salah ketik.

### Dua cara menunjuk, tepat satu per pengiriman

`sections` **dan** `recipients` terisi bersamaan → **400**. Tidak digabung:
menggabungkannya membuat "arahan ini ditujukan kepada siapa" punya dua jawaban
yang sah, dan keduanya berbeda begitu seorang pemegang jabatan juga disebut
namanya satu per satu.

Jalur `recipients` tetap hidup karena kontrak API beku selama migrasi, bukan
karena masih ada yang memanggilnya. Layar tidak lagi memakainya.

**Draf adalah pengecualian:** ia menerima keduanya terisi. Draf adalah kertas
buram privat yang tidak pernah terkirim, dan autosave tidak boleh mulai gagal
saat penulisnya sedang berpindah dari satu cara menunjuk ke cara yang lain.
Gerbangnya hanya saat kirim — aturan yang sama sudah dipakai `incomingId` di
R5G2.

### Penerjemahan bagian → orang terjadi di dalam TRANSAKSI kirim

Bukan di layar. Jabatan bisa berpindah tangan antara saat daftar bagian dimuat
dan saat tombol kirim ditekan; yang tercatat sebagai penerima adalah pemegang
jabatan pada saat `COMMIT`.

Hasil terjemahan tetap dilewatkan ke saringan penerima yang lama, walau
`resolveSections` sudah lebih ketat. Satu gerbang yang menentukan siapa boleh
menjadi penerima arahan, apa pun cara memilihnya.

### Penyerahan surat: semua-atau-tidak-sama-sekali

`POST /` dengan `incomingId` **dan** `sections` menulis, di transaksi yang sama:

- `sdl_urmin_distributions` — satu baris per penerima, `recipient_unit` = unit
  bagiannya
- `sdl_urmin_distribution_events('sent')`
- `sdl_audit_events('urmin.distribution.sent')`, metadata
  `{section, via:'arahan'}` — `event_key` yang sama dengan jalur distribusi mana
  pun, supaya laporan audit yang sudah ada ikut melihatnya tanpa perlu tahu
  R5H1 pernah terjadi

Satu bagian yang tidak berwenang atas klasifikasi surat membatalkan **seluruh**
pengiriman, termasuk arahannya. Arahan yang sampai tanpa suratnya adalah
instruksi yang tidak bisa dikerjakan.

`ON CONFLICT (incoming_id,recipient_user) WHERE status='sent' DO NOTHING`
mengacu ke indeks unik **parsial** `sdl_urmin_delivery_one_pending_idx` (010).
Klausa `WHERE`-nya wajib ditulis ulang persis, kalau tidak Postgres tidak
menemukan arbiter-nya dan melempar error alih-alih melewati baris. Yang dicegah:
satu surat menumpuk sebagai dua item inbox yang sama-sama belum diterima.
Kalau kiriman sebelumnya sudah `received`, indeksnya tidak berlaku dan baris
baru tetap masuk — arahan kedua atas surat yang sama memang peristiwa baru.

`distributionEligibleSQL` adalah **salinan** `urmin.recipientEligible`
(`r3b.go:69`), bukan pemanggilan. Paket `directives` tidak mengimpor `urmin`
sama sekali, dan membuka jalur impor itu demi satu query menukar satu duplikasi
SQL dengan satu simpul ketergantungan antar-modul yang jauh lebih mahal
dicabut. Kalau syaratnya berubah, **empat** tempat yang harus diubah (Go: urmin
+ directives; Express: urmin + directives).

## Yang TIDAK berubah, dan itu disengaja

**Register surat masuk tetap tertutup bagi Kasubbag.** `GET
/urmin/surat-masuk/{id}` menjawab 404 — mereka tidak punya
`urmin.surat_masuk.read`, dan Engine A menolak. Yang terbuka adalah **naskah
dan lampirannya** lewat `GET /urmin/surat-masuk/{id}/attachments`, karena
`canAttachment()` punya jalur cadangan `recipientOf()` yang berlaku justru bagi
penerima distribusi tanpa izin baca register (`r3b.go:103`). Itulah jalur yang
dipakai layar Inbox Distribusi.

Surat sampai kepada mereka sebagai **kiriman**, bukan sebagai entri register
yang boleh ditelusuri bersama surat-surat lain. `verify/r5h1-flow.js` menguji
404 itu secara eksplisit, supaya perubahan peta permission yang diam-diam
membuka register ikut ketahuan.

**Tidak ada email tambahan.** Penyerahan surat lewat arahan **tidak** mengisi
`sdl_urmin_intake_mail_outbox`, berbeda dari jalur intake di `r5f7.go:440`.
Arahannya sendiri sudah menjadi pemberitahuan; menambah email kedua berarti dua
pesan untuk satu peristiwa.

**Paur Subbagsumda belum ada.** Sistem tidak punya konsep sub-unit sama sekali.
Arahan berhenti di Kasubbagsumda, yang kemudian membagi ke tiga Paur-nya lewat
disposisi di dalam unitnya sendiri. Menambahkannya nanti menuntut migrasi
sub-unit/jabatan, role, grant, dan akunnya — bukan sekadar empat baris di
`sections.go`.

## Yang masih menghalangi langkah berikutnya

**Kasubbag belum bisa membuat disposisi ke stafnya.** R5H1 menutup penyebab
*struktural* (tidak ada `distribution_id`), tapi penyebab *perizinan* masih ada:
`urmin.disposisi.issue` dan `urmin.disposisi.execute` **tidak dimiliki satu pun
dari 13 role hasil seed**. `r3c.go:111` menuntut yang pertama pada penerbit dan
`r3c.go:321` menuntut yang kedua pada penerima.

Ini keluarga masalah yang sama dengan
`docs/PERTANYAAN-KONFIGURASI-AKSES.md` — peta permission, bukan cacat kode, dan
sama di Go maupun Express. Memperbaikinya adalah keputusan pemilik sistem:
role mana yang pantas menerbitkan disposisi, dan role mana yang mengerjakannya.

## Verifikasi

`apps/backend-express/verify/r5h1-flow.js` — menjalankan seluruh rantai di atas
terhadap backend yang hidup, lalu membandingkan bentuk respons dua backend.

```bash
CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml"
docker compose $CLI run --rm --build --entrypoint node harness verify/r5h1-flow.js
docker compose $CLI run --rm -e SDL_HARNESS_API_BASE=http://api-express:8080 \
  --entrypoint node harness verify/r5h1-flow.js
docker compose $CLI run --rm -e SDL_HARNESS_PEER_BASE=http://api-express:8080 \
  --entrypoint node harness verify/r5h1-flow.js   # + paritas byte tahap 7
```

Ia **menulis** ke database: satu surat masuk, satu arahan, distribusi
turunannya. Semuanya baris baru. Jalankan terhadap database pengembangan.

Alat ini ada karena harness golden-file tidak bisa menggantikannya dalam dua
hal: ia membandingkan **bentuk** respons antar backend, bukan baris mana yang
tertulis dan siapa yang akhirnya bisa membaca surat — dua backend bisa
sama-sama salah dengan cara identik dan tetap "paritas" — dan sejak R5G ia
memang sedang basi.

### Satu cacat lama yang ikut ketahuan

Tahap 7 menemukan **Express menempatkan `incomingId` pada posisi yang salah**
di endpoint 87 dan 91: tepat sesudah `acknowledged`, sedangkan Go
menserialisasi mengikuti urutan deklarasi struct dan menaruhnya **sesudah**
`myReadAt`, `myAcknowledgedAt`, dan `recipients`.

Cacat R5G2, bukan R5H1. Golden file yang basi tidak menangkapnya. Diperbaiki di
`shared.js` dengan memisahkan `appendIncomingId()` dari `mapSummary()`, dan
pemanggilnya wajib memanggil ia paling akhir.
