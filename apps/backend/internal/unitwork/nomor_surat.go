package unitwork

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// R5G13: perakitan nomor surat keluar.
//
//	B/ND-157/X/HUM.1.2./2026/Bagrenmin
//	│ │   │   │     │     │      │
//	│ │   │   │     │     │      └─ akhiran unit, dipilih petugas
//	│ │   │   │     │     └──────── tahun, jam sistem
//	│ │   │   │     └────────────── kode arsip, dari master
//	│ │   │   └──────────────────── bulan Romawi, jam sistem
//	│ │   └──────────────────────── urut, satu deret per tahun
//	│ └──────────────────────────── jenis surat, kodenya dari master
//	└────────────────────────────── derajat: Biasa=B, Kilat=K
//
// Enam keputusan pemilik sistem yang tertanam di sini, semuanya tercatat di
// docs/PENOMORAN-SURAT-KELUAR.md:
//
//  1. Deretnya SATU untuk seluruh Bagrenmin, bukan per subbag atau per jenis.
//  2. Direset tiap 1 Januari.
//  3. Nomor diberikan saat DRAF DIBUAT, bukan saat disetujui — konsekuensinya
//     draf yang batal meninggalkan lubang, dan itu diterima.
//  4. Bulan dan tahun dari JAM SISTEM saat nomor dibuat, bukan dari Tanggal
//     Surat. Surat mundur tanggal karena itu bisa bernomor bulan yang berbeda
//     dari tanggal di kop suratnya.
//  5. Derajat hanya Biasa dan Kilat, sama dengan derajat surat masuk.
//  6. Akhiran unit dipilih petugas, tidak ditebak dari isian "Kepada" yang
//     berupa teks bebas.

var derajatKode = map[string]string{"Biasa": "B", "Kilat": "K"}

// Angka Romawi 1..12. Tabel, bukan algoritma: rentangnya tetap dua belas dan
// algoritma umum hanya menambah hal yang bisa salah tanpa menambah kemampuan.
var bulanRomawi = [...]string{"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"}

// Akhiran unit yang sah. "Bagrenmin" untuk surat keluar subdit; selebihnya nama
// unit yang memang terdaftar di sdl_org_units, dengan ejaan yang dipakai di
// seluruh aplikasi.
var akhiranUnit = map[string]bool{
	"Bagrenmin":     true,
	"Urmin":         true,
	"Subbagren":     true,
	"Subbagsumda":   true,
	"Subbagbinfung": true,
}

// Mengambil satu nomor urut untuk tahun berjalan. Atomik: ON CONFLICT DO UPDATE
// mengambil row lock, jadi dua permintaan bersamaan tidak pernah memperoleh
// angka yang sama tanpa perlu SELECT ... FOR UPDATE terpisah.
func ambilNomorUrut(ctx context.Context, tx pgx.Tx, tahun int) (int, error) {
	var nomor int
	err := tx.QueryRow(ctx, `INSERT INTO sdl_surat_nomor_urut(tahun) VALUES($1)
 ON CONFLICT(tahun) DO UPDATE SET nomor_terakhir=sdl_surat_nomor_urut.nomor_terakhir+1,updated_at=now()
 RETURNING nomor_terakhir`, tahun).Scan(&nomor)
	return nomor, err
}

// Alasan sebuah nomor tidak dapat dirakit, dalam bentuk kode error yang sudah
// siap dikirim. String kosong berarti lengkap.
func nomorSuratKurang(fields map[string]string) string {
	if derajatKode[strings.TrimSpace(fields["sifatSurat"])] == "" {
		return "derajat_required"
	}
	if strings.TrimSpace(fields["jenisSurat"]) == "" {
		return "jenis_surat_required"
	}
	if strings.TrimSpace(fields["kodeArsip"]) == "" {
		return "kode_arsip_required"
	}
	if !akhiranUnit[strings.TrimSpace(fields["unitNomor"])] {
		return "unit_nomor_required"
	}
	return ""
}

// Merakit nomor dan mengambil satu angka dari deret tahun berjalan. Dipanggil
// DI DALAM transaksi pembuatan surat, sehingga nomor yang terlanjur diambil
// ikut dibatalkan kalau penyimpanan suratnya gagal — tanpa itu, setiap
// kegagalan penyimpanan akan membakar satu nomor.
func rakitNomorSurat(ctx context.Context, tx pgx.Tx, fields map[string]string, now time.Time) (string, error) {
	derajat := derajatKode[strings.TrimSpace(fields["sifatSurat"])]
	jenis := strings.TrimSpace(fields["jenisSurat"])
	arsip := strings.TrimSpace(fields["kodeArsip"])
	unit := strings.TrimSpace(fields["unitNomor"])

	nomor, err := ambilNomorUrut(ctx, tx, now.Year())
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s/%s-%d/%s/%s/%d/%s",
		derajat, jenis, nomor, bulanRomawi[int(now.Month())-1], arsip, now.Year(), unit), nil
}
