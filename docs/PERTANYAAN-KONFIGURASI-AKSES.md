# Tiga Pertanyaan Konfigurasi Akses untuk Pemilik Sistem

**Tanggal:** 1 November 2026
**Untuk:** Pemilik sistem SIERA DELTA LIMA
**Dari:** Tim migrasi backend
**Status:** menunggu keputusan

---

## Ringkasan satu halaman

Saat menyiapkan pengujian migrasi, kami menemukan bahwa **27 dari 142 fungsi
aplikasi tidak bisa dipakai oleh satu pun akun yang ada** — bukan karena rusak,
melainkan karena hak aksesnya tidak pernah diberikan kepada siapa pun.

Yang terdampak tiga kelompok:

| Modul | Fungsi yang mati | Akibat bagi pengguna |
|---|---|---|
| **Usulan Perencanaan** | 7 dari 10 | Daftar usulan tampil kosong; tidak ada yang bisa membuka, menyunting, mengajukan, atau menelaah usulan |
| **Anggaran** (pagu, realisasi, bukti) | 9 dari 11 | Tidak ada yang bisa mendaftarkan pagu, mencatat realisasi, atau mengunggah bukti bayar |
| **Disposisi** | 11 (10 + penerbitan disposisi) | Seluruh alur disposisi berjenjang tidak bisa dijalankan sama sekali |

**Tiga hal yang perlu ditegaskan lebih dulu:**

1. **Ini bukan akibat migrasi ke Express.** Backend lama (Go) dan backend baru
   berperilaku sama persis. Kami menemukannya *karena* migrasi memaksa setiap
   fungsi dijalankan satu per satu, bukan karena migrasi menyebabkannya.
2. **Ini bukan kerusakan program.** Kodenya ada, lengkap, dan terbukti bekerja
   begitu hak aksesnya diberikan. Yang kurang adalah pengaturannya.
3. **Gejalanya menipu.** Aplikasi **tidak menampilkan pesan error**. Yang
   terlihat hanya halaman kosong dan tombol yang mati — persis seperti sistem
   yang memang belum ada datanya.

Kami perlu keputusan Bapak/Ibu pada tiga pertanyaan di bawah sebelum trafik
dialihkan ke backend baru. Mengubahnya sekarang jauh lebih murah daripada
setelah pengguna terbiasa dengan keadaan yang sekarang.

---

## Latar: bagaimana izin di SDL bekerja

Supaya tiga pertanyaan di bawah bisa dinilai, satu hal perlu dipahami dulu.
Di SDL, seseorang boleh melakukan sesuatu hanya kalau **DUA syarat terpenuhi
sekaligus**:

**Syarat 1 — Daftar kewenangan (melekat pada jabatan).**
Misalnya "boleh mendaftarkan pagu". Ini ditempelkan ke *jabatan*, bukan ke
orang: semua yang berjabatan Operator Subbagren mendapat daftar yang sama.

**Syarat 2 — Luas jangkauan (melekat pada orang).**
Sampai mana dokumen yang boleh disentuh. Ada tiga pilihan:

| Jangkauan | Artinya |
|---|---|
| `sendiri` | hanya dokumen yang dibuat oleh dirinya sendiri |
| `satu unit` | semua dokumen di unitnya |
| `ditugaskan` | hanya dokumen yang secara eksplisit ditugaskan kepadanya |

Analoginya: **syarat 1 adalah kunci, syarat 2 adalah pintu mana yang boleh
dibuka.** Punya kunci tanpa pintu sama tidak bergunanya dengan punya pintu
tanpa kunci. Ketiga pertanyaan di bawah muncul dari ketidakcocokan antara
keduanya.

---

## Pertanyaan 1 — Alur disposisi tidak bisa dijalankan siapa pun

### Keadaan sekarang

Sistem menyediakan 12 jenis kewenangan untuk disposisi: menerbitkan,
menerima tugas, mengerjakan, meneruskan ke bawahan, menelaah hasil,
mengajukan ke pimpinan, memutuskan, dan seterusnya.

**Hanya satu yang pernah diberikan kepada jabatan mana pun**, yaitu "melihat
disposisi", kepada Kepala Urmin. Sebelas sisanya tidak dimiliki siapa pun.

Akibatnya seluruh alur disposisi berjenjang — mulai dari Kasubbag menerbitkan
disposisi atas surat yang diterimanya, sampai persetujuan akhir Kabagrenmin —
**tidak bisa dijalankan sama sekali.** Fiturnya lengkap dan sudah diuji
bekerja, tapi tidak ada akun yang bisa memulainya.

### Yang dilihat pengguna

Halaman disposisi terbuka normal dan menampilkan daftar kosong. Kabagrenmin
yang membuka dasbor pemantauan disposisi mendapat pesan "akses ditolak".
Tidak ada petunjuk bahwa penyebabnya pengaturan, bukan ketiadaan data.

### Yang kami butuhkan

Pembagian tugas yang benar menurut Bapak/Ibu. Perlu ditentukan **jabatan mana
yang berhak atas tiap langkah**. Saat pengujian kami memakai pembagian
sementara di bawah ini — ini **tebakan kami, bukan usulan resmi**, dan dibuat
semata-mata supaya alurnya bisa diuji:

| Langkah | Jabatan yang kami pakai saat uji |
|---|---|
| Menerbitkan disposisi | Kasubbagren |
| Mengerjakan tugas disposisi | Operator Subbagren |
| Meneruskan ke bawahan | Operator Subbagren |
| Menelaah hasil pekerjaan | Kasubbagren |
| Mengajukan ke pimpinan | Kasubbagren |
| Memutuskan (persetujuan akhir) | Kabagrenmin |

Satu hal yang **sebaiknya dipertahankan** apa pun keputusannya: penerbit,
pelaksana, dan pemutus akhir harus **orang yang berbeda**. Sistem sudah
menolak kalau ketiganya sama — itu pengaman bawaan, dan pembagian apa pun
yang menyatukan mereka akan membuat alurnya mentok dengan sendirinya.

> ### ◻ Keputusan yang kami butuhkan
>
> Mohon tentukan jabatan untuk tiap langkah pada tabel di atas. Kalau
> pembagian sementara itu sudah sesuai, cukup konfirmasi — kami akan
> memindahkannya menjadi konfigurasi resmi.
>
> **Alternatifnya:** kalau fitur disposisi berjenjang memang belum akan
> dipakai dalam waktu dekat, katakan demikian. Kami akan mencatatnya sebagai
> "sengaja dinonaktifkan" supaya tidak terus-menerus muncul sebagai temuan.

---

## Pertanyaan 2 — Operator tidak bisa menginput data perencanaan dan anggaran

### Keadaan sekarang

Ini kasus "punya pintu tapi tidak punya kunci, **dan** kuncinya tidak cocok
dengan pintu mana pun".

Ada dua masalah bertumpuk:

**(a) Kewenangannya tidak diberikan ke siapa pun.** Mendaftarkan pagu,
mencatat realisasi, mengunggah bukti bayar, memverifikasi — tidak satu pun
melekat pada jabatan mana pun.

**(b) Sekalipun diberikan, Operator dan Staf tetap tidak bisa memakainya.**
Jangkauan akses mereka disetel `ditugaskan`. Pada modul Perencanaan dan
Anggaran, **tidak ada mekanisme penugasan dokumen** — jadi jangkauan
`ditugaskan` di sana tidak pernah cocok dengan dokumen apa pun. Hasilnya
selalu nihil.

Ini berbeda dari Urmin. Di Urmin, Operator dan Staf disetel `sendiri`, dan
jangkauan itu bekerja normal — Operator Urmin bisa mencatat dan mengurus
surat buatannya sendiri. **Perbedaan setelan antara Urmin dan tiga unit
lainnya inilah yang kami tidak tahu disengaja atau tidak.**

Setelan saat ini per jabatan:

| Unit | Operator | Staf | Kepala |
|---|---|---|---|
| Urmin | `sendiri` | `sendiri` | `satu unit` |
| **Subbagren** | **`ditugaskan`** | **`ditugaskan`** | `satu unit` |
| **Subbagsumda** | **`ditugaskan`** | **`ditugaskan`** | `satu unit` |
| **Subbagbinfung** | **`ditugaskan`** | **`ditugaskan`** | `satu unit` |

Catatan penting supaya tidak salah paham: jangkauan `ditugaskan` **tetap
berguna** di modul Berkas Kerja Unit, karena di sana penugasan memang ada
(atasan menugaskan berkas ke staf, lalu staf bisa membukanya). Masalahnya
khusus di modul Perencanaan dan Anggaran.

### Yang dilihat pengguna

Kasubbagren membuka menu Usulan Perencanaan dan melihat **daftar kosong**,
padahal datanya ada di database. Tombol "Buat Usulan" tidak aktif. Tidak ada
pesan kesalahan apa pun.

### Pilihan yang tersedia

| Pilihan | Yang berubah | Pertimbangan |
|---|---|---|
| **A. Operator & Staf jadi `sendiri`** (disamakan dengan Urmin) | Operator bisa menginput dan mengurus usulan buatannya sendiri; Kepala tetap melihat seluruh unit | Paling sesuai praktik kerja biasa: operator menginput, kepala memverifikasi. **Rekomendasi kami.** |
| **B. Hanya Kepala yang menginput** | Kewenangan input diberikan ke Kasubbag/Kabagrenmin saja; Operator dan Staf hanya membaca | Perencanaan dan anggaran dianggap pekerjaan pimpinan. Konsekuensinya seluruh input data dikerjakan pejabat. |
| **C. Biarkan apa adanya** | Modul Perencanaan dan Anggaran tetap tidak terpakai | Masuk akal **hanya kalau** modul ini memang belum akan dipakai |

Perlu kami sampaikan untuk pilihan apa pun: aturan **"pemeriksa tidak boleh
orang yang sama dengan pencatat"** sudah ditegakkan sampai ke level database.
Jadi kalau satu jabatan diberi kewenangan mencatat *dan* memverifikasi
sekaligus, orang tersebut tetap tidak akan bisa memverifikasi catatannya
sendiri. Itu pengaman, bukan kerusakan.

> ### ◻ Keputusan yang kami butuhkan
>
> 1. Pilih **A**, **B**, atau **C** di atas.
> 2. Kalau **A**: apakah perubahan jangkauan menjadi `sendiri` berlaku untuk
>    ketiga unit (Subbagren, Subbagsumda, Subbagbinfung), atau Subbagren saja?
> 3. Apakah perbedaan setelan Urmin (`sendiri`) lawan tiga unit lain
>    (`ditugaskan`) dulu memang **disengaja**? Jawaban ini penting — kalau
>    disengaja, berarti ada pertimbangan yang belum kami ketahui dan kami
>    tidak akan menyamakannya.

---

## Pertanyaan 3 — Daftar kewenangan dan program tidak memakai nama yang sama

### Keadaan sekarang

Ini yang paling teknis dari ketiganya, tapi intinya sederhana: **dua pihak
memakai istilah berbeda untuk hal yang sama.**

Saat akun dibuat, jabatan Subbagren diberi kewenangan bernama
`subbagren.perencanaan.*` — kira-kira "urusan perencanaan".

Tetapi program yang menangani usulan memeriksa kewenangan bernama
`subbagren.usulan.*`, dan program anggaran memeriksa
`subbagren.anggaran.pagu.*`, `.realisasi.*`, dan `.bukti.*`.

Nama-nama yang diperiksa program itu **ada dan terdaftar** di sistem, tetapi
tidak pernah ditempelkan ke jabatan mana pun. Jadi seperti satpam yang
diperintahkan memeriksa "kartu biru", sementara semua pegawai dibekali "kartu
hijau" — keduanya kartu resmi, tapi tidak pernah cocok.

### Kemungkinan penyebabnya

Kami melihat dua kemungkinan dan **tidak bisa memastikan yang mana** tanpa
keterangan Bapak/Ibu:

1. **Memang belum selesai disetel.** Nama kewenangan berganti saat fitur
   usulan dan anggaran dikembangkan, tetapi daftar pemberian hak akses saat
   pembuatan akun tidak ikut diperbarui.
2. **Memang dirancang diberikan belakangan.** Mungkin rencananya Superadmin
   yang menempelkan kewenangan ini lewat menu Manajemen Peran setelah akun
   dibuat — dan langkah itu belum pernah dijalankan di server produksi.

Kalau jawabannya nomor 2, maka tidak ada yang perlu diubah pada program; yang
perlu dilakukan hanya menjalankan langkah penempelan itu di produksi.

> ### ◻ Keputusan yang kami butuhkan
>
> Apakah kewenangan `subbagren.usulan.*` dan `subbagren.anggaran.*`:
>
> - **(i)** seharusnya ikut diberikan otomatis saat akun dibuat — kalau ya,
>   kami perbaiki program pembuat akunnya; atau
> - **(ii)** memang sengaja diberikan manual oleh Superadmin lewat menu
>   Manajemen Peran — kalau ya, kami siapkan panduan langkahnya dan tidak
>   menyentuh program apa pun.

---

## Yang akan kami kerjakan setelah ada jawaban

| Jawaban | Tindakan kami |
|---|---|
| Pertanyaan 1 | Memasukkan pembagian kewenangan disposisi ke program pembuat akun |
| Pertanyaan 2, pilihan A atau B | Menyesuaikan jangkauan akses dan/atau daftar kewenangan |
| Pertanyaan 3, jawaban (i) | Memperbaiki daftar kewenangan di program pembuat akun |
| Pertanyaan 3, jawaban (ii) | Menulis panduan langkah untuk Superadmin, tanpa mengubah program |

Setelah itu kami akan **menguji ulang seluruh 142 fungsi** terhadap
konfigurasi yang baru, dan melaporkan fungsi mana saja yang berubah dari mati
menjadi hidup.

**Catatan penting mengenai akun yang sudah ada:** menambah kewenangan pada
jabatan **tidak mengubah kata sandi, tidak menghapus akun, dan tidak
menyentuh data yang sudah masuk.** Yang berubah hanya daftar hak akses. Kalau
ternyata keliru, mencabutnya kembali juga aman.

---

## Lampiran A — Daftar lengkap fungsi yang terdampak

27 fungsi berikut terbukti **bekerja** saat hak aksesnya diberikan, dan
**mati** pada konfigurasi produksi apa adanya.

**Usulan Perencanaan — 7 dari 10 fungsi**

| No | Fungsi |
|---|---|
| 55 | Membuka detail satu usulan |
| 56 | Menyunting usulan yang masih draf |
| 57 | Mengajukan usulan untuk ditelaah |
| 58 | Menelaah usulan (setuju / minta revisi) |
| 59 | Memperbaiki usulan yang diminta revisi |
| 60 | Mengajukan ulang setelah perbaikan |
| 61 | Melihat konsolidasi usulan setahun |

**Anggaran — 9 dari 11 fungsi**

| No | Fungsi |
|---|---|
| 64 | Mendaftarkan pagu anggaran |
| 65 | Memverifikasi pagu |
| 66 | Mencatat realisasi anggaran |
| 67 | Memverifikasi realisasi |
| 68 | Melihat daftar bukti bayar |
| 69 | Mengunggah bukti bayar |
| 70 | Mengunduh bukti bayar |
| 71 | Menyetujui bukti bayar |
| 72 | Melihat rekonsiliasi anggaran |

**Disposisi — 11 fungsi**

| No | Fungsi |
|---|---|
| 115 | Menerbitkan disposisi atas distribusi yang diterima |
| 117 | Melihat riwayat satu disposisi |
| 118 | Menerima tugas disposisi |
| 119 | Menyelesaikan tugas disposisi |
| 120 | Menelaah hasil pekerjaan disposisi |
| 121 | Melihat calon penerima penerusan |
| 122 | Meneruskan disposisi ke bawahan |
| 123 | Dasbor pemantauan disposisi untuk pimpinan |
| 124 | Melihat status persetujuan akhir |
| 125 | Mengajukan persetujuan akhir ke pimpinan |
| 126 | Keputusan akhir pimpinan |

### Yang TIDAK terdampak

Supaya gambarannya seimbang: **115 fungsi lain tidak terdampak** oleh ketiga
temuan ini — termasuk seluruh persuratan Urmin (surat masuk, lampiran,
distribusi, surat keluar sampai persetujuan Kabagrenmin), berkas kerja
keempat unit, registri Subbagsumda dan Subbagbinfung, portal, arahan
pimpinan, dasbor eksekutif, serta seluruh fungsi login dan administrasi
identitas.

Perlu kami sebutkan agar tidak menyesatkan: "tidak terdampak" berarti izinnya
lolos, bukan berarti setiap fungsi itu sudah diuji end-to-end dari sisi
tampilan. Pengujian kami mengukur perilaku backend, bukan alur layar.

---

## Lampiran B — Cara temuan ini diukur

Supaya angka 27 bisa ditelusuri ulang dan tidak perlu dipercaya begitu saja:

1. Peta kewenangan produksi disusun ulang dari sumbernya — program pembuat
   akun (`cmd/seed-bagrenmin/main.go`) dan berkas migrasi database — lalu
   seluruh tambalan khusus pengujian dihapus dari database percobaan.
2. Seluruh 142 fungsi dijalankan dua kali terhadap **backend Go** (bukan
   Express), sekali dengan tambalan dan sekali tanpa, memakai kedelapan akun
   uji dengan jabatan yang berbeda-beda.
3. Sebuah fungsi dihitung "mati" hanya kalau ia **berhasil** pada percobaan
   pertama dan **tidak berhasil oleh satu akun pun** pada percobaan kedua.

Penolakan karena isian tidak lengkap sengaja **tidak** dihitung sebagai
"mati" — permintaan seperti itu justru membuktikan izinnya lolos dan program
sempat berjalan. Tanpa pemisahan ini, angkanya akan tampak 47, bukan 27.

Pengukuran dilakukan terhadap backend **Go yang sekarang melayani produksi**,
bukan terhadap Express. Jadi temuan ini berlaku untuk sistem yang sedang
berjalan hari ini, terlepas dari migrasi.

---

## Lampiran C — Rujukan teknis

Untuk tim teknis yang akan mengerjakan tindak lanjutnya:

| Hal | Lokasi |
|---|---|
| Daftar kewenangan per jabatan saat pembuatan akun | `apps/backend/cmd/seed-bagrenmin/main.go` baris 48–61 (`var roles`) |
| Setelan jangkauan akses per akun | berkas yang sama, baris 30–44 (`var accounts`, kolom kelima) |
| Aturan pemeriksaan izin (Engine A) | `apps/backend/internal/access/policy.go` |
| Sebab jangkauan `ditugaskan` tidak pernah cocok | `AssignedUserIDs` pada `policy.go` tidak pernah diisi handler mana pun |
| Tambalan khusus pengujian | `apps/backend-express/harness/seed-documents.js`, konstanta `HARNESS_ROLE_PERMISSIONS` — **bukan konfigurasi produksi** |
| Catatan temuan versi teknis | `apps/backend-express/docs/MIGRATION-PLAN.md` |

**Peringatan untuk pelaksana:** tabel `sdl_role_permissions` **tidak** ikut
terhapus saat data dokumen direset. Mengubah isinya di server produksi
bersifat permanen sampai diubah lagi secara eksplisit — ambil cadangan
database sebelum menyentuhnya.
