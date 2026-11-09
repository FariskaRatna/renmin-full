# R5H4 — Arahan ke jabatan, seluruh bagian, atau Paur

2026-11-04 · migrasi `043_arahan_paur.sql` · diubah di Go **dan** Express bersamaan

## Yang diminta pemilik sistem

> Kalau Kabag memilih Kasubbag, yang menerima kepalanya saja. Kalau memilih
> bagian, semua staf dan kepalanya. Subbagsumda tetap ada, tetapi juga dipecah
> menjadi tiga Paur (Sumda, Log, ADA). Arahan muncul di menu Disposisi dan di
> menu Arahan.

R5H1 berhenti di Kasubbag: arahan sampai ke pemegang jabatan, lalu Kasubbag
seharusnya mendisposisikannya ke staf. Langkah kedua itu tidak pernah bisa
berjalan karena tidak satu role pun memegang `urmin.disposisi.issue`
(`PERTANYAAN-KONFIGURASI-AKSES.md`, Pertanyaan 1). R5H4 membuat arahan bisa
langsung sampai ke staf tanpa langkah itu.

## Sebelas pilihan, tiga jenis

| Jenis | Pilihan | Penerima |
|---|---|---|
| jabatan | Kasubbagren · Kasubbagsumda · Kasubbagbinfung · Kaurmin | pemegang role kepala (scope unit/assigned) — perilaku R5H1 |
| bagian | Subbagren · Subbagsumda · Subbagbinfung · Urmin | seluruh anggota unit yang punya grant aktif di unit itu |
| paur | Paur Sumda · Paur Log · Paur ADA | anggota Paur itu (`sdl_user_paur`) |

Gerbang orang tidak berubah: aktif, password sudah dirotasi, bukan Superadmin,
bukan Kabagrenmin, bukan pengirim. "Subbagsumda" sebagai bagian mencakup
seluruh anggota unit, termasuk semua anggota ketiga Paur.

Pilihan boleh digabung. Orang yang terjaring dua kali (mis. Kasubbagren lewat
jabatan dan lewat bagian Subbagren) dicatat sekali, dengan pilihan pertama
sebagai asalnya. Pilihan tanpa anggota (mis. Paur yang belum diisi) tetap
ditolak 400.

## Klasifikasi: arahan ke semua, naskah ke yang berhak

Dua keputusan pemilik sistem, diambil berurutan:

1. Klasifikasi tidak membatasi siapa yang menerima **arahan**. Lembar
   disposisi Rahasia sampai ke seluruh anggota pilihan.
2. **Naskah surat** yang tertaut tetap mengikuti aturan akses Urmin yang lama.

Akibatnya di kode:

- `sheetAllowed` tidak lagi menuntut grant `penting` pada setiap penerima.
- `handOverLetter` **melewati** penerima yang tidak berhak atas surat (dulu
  menolak seluruh arahan 400). Penerima itu mendapat arahannya, tidak mendapat
  baris `sdl_urmin_distributions`.
- `urmin.recipientEligible` **tidak disentuh**. Tanpa baris distribusi dan
  tanpa izin baca register, naskahnya tertutup (404) bagi mereka. Diuji di
  `verify/r5h4-flow.js` langkah 4.

Yang tetap dicegah: lembar `biasa` atas surat `penting` (lembar tidak boleh
menurunkan klasifikasi surat).

Siapa yang tidak menerima naskah, dalam konfigurasi seed saat ini:

- staf/operator berbatas `biasa`, untuk surat Rahasia;
- staf dan operator **Urmin** untuk surat apa pun: grant mereka ber-scope
  `own` dan role-nya tidak memegang `urmin.distribusi.receive`.

Layar penyusun menampilkannya per pilihan ("naskah surat hanya untuk 1/3").

## Paur bukan unit

`sdl_org_units` tetap empat baris. Setiap grant, scope Engine A/B, dan
penyaringan SQL bersandar pada unit; menjadikan Paur unit berarti setiap akun
Paur kehilangan aksesnya ke data Subbagsumda sampai grant-nya ditulis ulang.

Paur hanyalah pengelompokan orang di dalam satu unit:

- `sdl_paur(paur_key, unit_key, label)` — tiga baris di Subbagsumda.
- `sdl_user_paur(user_id PK, paur_key, is_head, assigned_by, assigned_at)` —
  satu orang paling banyak satu Paur. `is_head` hanya ditampilkan; kepala dan
  staf sama-sama menerima arahan Paur-nya.

Keanggotaan Paur **tidak memberi akses apa pun**, karena itu ia diatur lewat
endpoint terpisah dari `/users/{id}/access` dan tidak mencabut sesi.

Superadmin mengaturnya di Pengguna → Edit → tab **Paur** (tampil untuk anggota
unit yang punya Paur). Syarat: orangnya anggota unit Paur itu
(`paur_unit_mismatch`).

## Tampilan

- **Buat Arahan**: daftar tujuan memuat kesebelas pilihan dengan keterangan
  jenis ("KEPALA SAJA", "SELURUH BAGIAN", "PAUR SUBBAGSUMDA") dan jumlah orang.
  Ringkasan pengiriman menghitung orang setelah duplikat disaring.
- **Tugas Disposisi**: arahan untuk akun ini digabung ke daftar ("Arahan Baru"
  / "Dibaca" / "Diterima"), tombol "Buka Arahan" membuka detailnya di menu
  Arahan, tempat konfirmasi dilakukan.

## Verifikasi

```bash
CLI="--env-file .env -f infra/compose.dev.yaml -f infra/compose.express.yaml -f infra/compose.harness.yaml"
docker compose $CLI run --rm --build --entrypoint node \
  -e SDL_HARNESS_PEER_BASE=http://api-express:8080 harness verify/r5h4-flow.js
docker compose $CLI run --rm --build --entrypoint node \
  -e SDL_HARNESS_API_BASE=http://api-express:8080 -e SDL_HARNESS_PEER_BASE=http://api:8080 harness verify/r5h4-flow.js
```

Menulis ke database pengembangan (surat, arahan, distribusi) dan menempatkan
`staf-subbagsumda` di Paur Sumda serta `op-subbagsumda` sebagai kepala Paur Log.

Status 2026-11-04: Go dan Express lulus semua pemeriksaan, empat respons GET
byte-identik; `go test ./...` hijau; kedua suite keamanan 21/21.

## Belum dikerjakan

- **Harness golden-file** belum direkam ulang untuk 153 (bentuknya berubah) dan
  untuk 156/157 (baru).
- **Isi Paur di produksi** belum ada: daftar orang per Paur perlu diisi
  Superadmin lewat layar Pengguna setelah migrasi 043 diterapkan.
- `docs/PERTANYAAN-KONFIGURASI-AKSES.md` Pertanyaan 1 (disposisi berjenjang)
  masih terbuka; R5H4 tidak memberi kewenangan disposisi kepada siapa pun.
