package unitwork

import "testing"

func TestR5DUrminRegisterValidation(t *testing.T) {
	good := []urminregisterInput{
		{Kind: "surat_keluar", Code: "SK-26-01", Title: "Surat pemberitahuan rapat", Classification: "biasa", Fields: map[string]string{"tujuan": "Bagian umum", "tanggalSurat": "2026-10-22", "statusAdministrasi": "Draft"}},
		{Kind: "agenda", Code: "AG-001", Title: "Rapat evaluasi triwulan", Classification: "penting", Fields: map[string]string{"tanggal": "2026-10-22", "waktu": "09:30", "lokasi": "Ruang Rapat"}},
		{Kind: "arsip", Code: "AR-26-01", Title: "Arsip program kerja", Classification: "biasa", Fields: map[string]string{"tanggalDokumen": "2026-10-01", "jenisArsip": "Administrasi"}},
	}
	for i, item := range good {
		if !urminregisterValid(item) {
			t.Fatalf("valid case %d rejected", i)
		}
	}
	bad := []urminregisterInput{
		{Kind: "not-real", Code: "AA-01", Title: "Wrong record", Classification: "biasa", Fields: map[string]string{}},
		{Kind: "surat_keluar", Code: "X", Title: "Valid title", Classification: "biasa", Fields: map[string]string{}},
		{Kind: "agenda", Code: "AG-01", Title: "Valid agenda", Classification: "biasa", Fields: map[string]string{"tanggal": "2026-99-99"}},
		{Kind: "agenda", Code: "AG-02", Title: "Valid agenda", Classification: "biasa", Fields: map[string]string{"waktu": "27:70"}},
		{Kind: "arsip", Code: "AR-01", Title: "Valid archive", Classification: "rahasia", Fields: map[string]string{}},
		{Kind: "surat_keluar", Code: "SK-01", Title: "Valid letter", Classification: "biasa", Fields: map[string]string{"unrecognized": "junk"}},
	}
	for i, item := range bad {
		if urminregisterValid(item) {
			t.Fatalf("invalid case %d accepted", i)
		}
	}
}
