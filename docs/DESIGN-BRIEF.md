# Design Brief — SIERA DELTA LIMA

## Karakter
Kantor dinas yang tertib dan modern: tenang, berwibawa, efisien.
Bayangkan map arsip resmi dan buku agenda yang tertata rapi — garis tegas, label jelas,
hierarki seperti kop surat. BUKAN tampilan startup SaaS, BUKAN dashboard kripto,
BUKAN website promosi.

## Ciri khas (maksimal dua, dipakai konsisten di semua halaman)
1. Aksen emas tipis sebagai penanda: item aktif, status penting, fokus. Tidak untuk hiasan.
2. Nomor agenda, kode surat, dan tanggal ditulis dengan angka tabular agar rapi berjajar
   seperti buku register.

## Anggaran dekorasi
- Maksimal satu elemen dekoratif per layar (mis. motif tipis di header portal).
- 90% area netral; navy untuk struktur (sidebar, header); emas ≤5% area.
- Warna unit (Urmin hijau, Subbagren biru, Subbagsumda ungu, Subbagbinfung amber)
  hanya sebagai penanda kecil (garis/titik + label), tidak sebagai latar besar.

## Hierarki
- Bedakan tingkat informasi lewat ukuran dan ketebalan huruf, bukan lewat kotak dan warna.
- Data operasional (surat, disposisi, anggaran) tampil sebagai daftar/tabel, bukan kartu.
  Kartu hanya untuk objek yang memang terpisah (mis. pintu masuk tiap unit di portal).
- Konten kerja terlihat tanpa scroll. Tidak ada hero besar di halaman kerja;
  di portal, identitas cukup satu baris yang ringkas.
- Kepadatan "rapi tapi lega": serapat spreadsheet yang nyaman dibaca, ritme spasi 8px.

## Gerak
Hanya umpan balik: hover, tekan, buka/tutup panel, ≤200ms.
Tidak ada animasi masuk, parallax, atau efek melayang.

## Konten
Pakai label, status, format nomor surat, dan nama unit yang benar dari kode aplikasi.
Tidak ada lorem ipsum, statistik palsu, atau teks pemanis ("Selamat datang di platform terpadu...").

## Hindari
Label HURUF KAPITAL berspasi di atas setiap judul · kartu identik dengan bayangan sama ·
ikon dalam lingkaran berwarna di setiap kartu · gradasi hiasan · angka besar + label kecil
tanpa makna · glassmorphism · ilustrasi stok · ikon panah di setiap tombol.

## Proses
1. Tawarkan 2–3 arah dalam bentuk wireframe + satu kalimat karakter masing-masing.
2. Setelah dipilih, bangun SATU halaman dulu.
3. Ambil screenshot (1440 dan 390), lalu kritik sendiri:
   "Apa yang membuat ini terlihat generik? Apa yang berlebihan?" Perbaiki, ulangi.
4. Setelah halaman pertama disetujui, terapkan ke halaman lain dengan gaya yang sama.
5. Selalu pakai skill: frontend-design (arah visual), playwright-cli dengan --browser=msedge
   (screenshot 1440 & 390 dan kritik sendiri), web-design-guidelines (audit akhir).