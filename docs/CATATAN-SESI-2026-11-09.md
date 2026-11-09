# Catatan sesi 2026-11-09

Ringkasan pekerjaan dan keputusan hari ini, untuk melanjutkan di sesi berikutnya.

## Posisi sekarang

| Hal | Keadaan |
|---|---|
| Repo | Monorepo **github.com/FariskaRatna/renmin-full** (private), branch `main` + `staging` |
| Server 172.16.173.34 | Di-deploy lewat CI/CD dari `staging` (commit `bb93dc0`): R5H5 + migrasi 044 + menu Progar/Pagu |
| Belum di-push | `37e094c` perbaikan CAPTCHA (+ catatan ini). Perlu: push `main` → merge ke `staging` → Approve |
| Menunggu dari pemilik | Output query akun produksi (lihat "Langkah berikutnya") |

## 1. Frontend SUBBAGREN: Progar / Pagu Anggaran

- Klik SUBBAGREN → halaman pilihan **Progar** / **Pagu Anggaran** (bukan langsung workspace).
- Progar: Dokumen Perencanaan, Monitoring Kinerja & LKIP, Usulan Kebutuhan.
  Pagu Anggaran: Program & Anggaran, Realisasi Anggaran (LRA).
- Sidebar SUBBAGREN diringkas seperti URMIN (MENU UTAMA + DISTRIBUSI & BERKAS);
  grup MANAJEMEN dibuang dari SUBBAGREN.
- Kembali: tombol "Kembali ke Portal" di bawah kartu pilihan, "Kembali ke
  SUBBAGREN" di kaki sidebar, atau breadcrumb. Tombol "Ganti Progar/Pagu" dan
  tombol kembali di atas judul sengaja dihapus atas permintaan pemilik.
- Dashboard di dalam Progar/Pagu masih ringkasan gabungan lima modul.
- Berkas: `apps/frontend/src/App.tsx`, `apps/frontend/src/RenChooser.css`.

## 2. Monorepo dan CI/CD

- `renmin-fe` (apps/frontend) dan `renmin-be` (apps/backend-express) digabung
  dengan riwayatnya (commit `8c839a3`). `.git` lama dicadangkan di
  `D88/_backup-git-20261109/`. `mockup/` tetap repo sendiri dan di-.gitignore.
- `.gitignore`, `.gitattributes` (semua teks LF; `.cmd` CRLF), tiga `.dockerignore`.
- CI/CD: `.github/workflows/deploy.yml` + `scripts/deploy.sh`, panduan
  `docs/CICD.md`. Push `main` = cek saja. Push `staging` = cek → deploy ke
  environment GitHub **staging** (= server produksi 172.16.173.34) setelah Approve.
  Runner self-hosted berlabel `sdl-staging` di server.
- Migrasi tidak pernah otomatis: SQL baru membuat deploy berhenti sebelum
  menyentuh server; jalankan lewat **Run workflow** + centang "Izinkan migrasi".
- Deploy pertama (migrasi 044) berhasil; frontend server terverifikasi memuat menu baru.

Alur sehari-hari:

```bash
git push                                            # main: cek saja
git checkout staging && git merge --ff-only main && git push && git checkout main
# lalu GitHub → Actions → Review deployments → Approve
```

## 3. Uji URMIN di produksi (op-urmin, kabagrenmin, staf-urmin)

| Alur | Hasil |
|---|---|
| Semua menu URMIN (12 halaman) | Lulus, tanpa error JavaScript |
| Surat masuk "cukup dicatat" dan draft | Lulus, tanpa email |
| Surat masuk → Kabagrenmin (dibuka, otomatis "diterima") | Lulus |
| Surat keluar: buat → ajukan → kembalikan (alasan < 8 huruf ditolak) → revisi → ajukan ulang → setujui | Lulus; nomor tetap `B/ND-1/XI/BIN.2.1./2026/Urmin` |
| Arahan Kabag → bagian Urmin → staf membaca & menerima; Kabag melihat status per orang | Lulus |
| Arahan **dengan surat** ke bagian/jabatan mana pun | **Tidak bisa** — lihat bagian 5 |

Data uji tertinggal di produksi (semua berlabel `[UJI]`): surat masuk
SM-2026-2, -3, -4; surat keluar `B/ND-1/XI/BIN.2.1./2026/Urmin` (pemilik
menyetujui nomor urut 1/2026 terpakai); arahan "[UJI] Arahan uji otomatis ke
bagian Urmin".

Email: op-urmin memakai Gmail sungguhan; kabagrenmin dan staf-urmin masih
`@siera.invalid` (tidak terkirim ke siapa pun).

Temuan kecil (belum dikerjakan):

1. Toast sukses tampil dua kali dan beberapa request ganda — kemungkinan
   `React.StrictMode` karena server menjalankan Vite dev server.
2. Detail surat tanpa disposisi meminta `disposition-tracking` → 404 (tidak terlihat pengguna).
3. Setelah Kabag mengembalikan surat keluar, modal Kabag menampilkan tombol "Ajukan ke Kabagrenmin".
4. Kabag melihat draft surat masuk milik op-urmin di daftar — perlu keputusan pemilik.
5. Kotak "Berkas Surat" tidak menampilkan nama file yang dipilih.

## 4. CAPTCHA

- Penyebab pesan "CAPTCHA kedaluwarsa atau sudah dipakai": proof dihitung saat
  halaman login dibuka dan hanya berlaku 2 menit (`captcha.go:63`).
- Pemilik semula ingin CAPTCHA dihapus, lalu **memutuskan mempertahankannya
  tetapi tidak terlihat**.
- Perbaikan `37e094c` (frontend saja): proof diperbarui 25 detik sebelum
  kedaluwarsa; `captcha_invalid` → ambil challenge baru dan coba sekali lagi;
  `csrf_invalid` punya pesan sendiri. Aturan server tidak berubah.

## 5. Keputusan disposisi (jawaban Pertanyaan 1, `PERTANYAAN-KONFIGURASI-AKSES.md`)

- **Disposisi hanya oleh Kabagrenmin**, lewat menu Arahan. Disposisi berjenjang
  (Kasubbag/Kaurmin menerbitkan tugas lagi) **sengaja tidak dipakai**.
- Penerima: **seluruh anggota bagian** yang dipilih Kabag.
- Tindak lanjut: **cukup membaca dan menerima** (tidak ada laporan hasil).

Kenapa arahan dengan surat belum bisa sampai di produksi — penerima wajib:
password awal sudah diganti; anggota unit; grant scope `unit`/`assigned` yang
role-nya punya `urmin.distribusi.receive`; untuk surat penting, grant
`classification_limit='penting'`. Saat ini tidak ada akun yang memenuhi.

Usulan konfigurasi (belum dijalankan): role baru **"Penerima Surat Arahan"**
berisi hanya `urmin.distribusi.receive`; setiap anggota bagian diberi grant
tambahan scope `assigned` dengan role itu. Grant lama tidak diubah, karena Engine
B (`unitwork/work.go:107-125`) hanya melihat scope — mengubah `own` → `unit`
membuka seluruh Berkas Kerja unit, `own` → `assigned` mencabut hak membuat berkas.

## Langkah berikutnya

1. Push dan deploy `37e094c` (CAPTCHA), lalu uji: biarkan halaman login 3 menit, login.
2. Jalankan query baca-saja ini di server dan kirim hasilnya:

   ```bash
   docker exec sdl-foundation-r1-db-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -P pager=off -c "
   SELECT u.username, u.must_change_password AS wajib_ganti_pw, g.unit_key AS unit,
          g.role_key AS role, g.scope, g.classification_limit AS klas,
          EXISTS(SELECT 1 FROM sdl_role_permissions rp WHERE rp.role_key=g.role_key
                 AND rp.permission_key=\$\$urmin.distribusi.receive\$\$) AS bisa_terima_surat
   FROM sdl_users u
   JOIN sdl_access_grants g ON g.user_id=u.id AND g.revoked_at IS NULL
   WHERE u.is_active
   ORDER BY g.unit_key, u.username;"'
   ```

3. Dari hasil itu: tiru di laptop, uji "arahan + surat → seluruh bagian →
   baca & terima", lalu susun daftar langkah Superadmin untuk produksi.
4. Catat keputusan disposisi di `PERTANYAAN-KONFIGURASI-AKSES.md`.
5. Arsipkan repo lama `renmin-fe` dan `renmin-be` di GitHub (kalau belum).
