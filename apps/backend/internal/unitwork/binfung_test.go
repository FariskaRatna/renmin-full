package unitwork

import "testing"

func TestR5CBinfungValidation(t *testing.T) {
	valid := []binfungInput{
		{Kind: "sop", Code: "SOP-001", Title: "SOP Tata Naskah", Classification: "biasa", Fields: map[string]string{"jenis": "SOP", "statusDokumen": "Aktif"}},
		{Kind: "pid", Code: "PID-001", Title: "Register Informasi", Classification: "biasa", Fields: map[string]string{"kategori": "Laporan"}},
		{Kind: "rb", Code: "RB-001", Title: "Rencana Aksi Reformasi", Classification: "biasa", Fields: map[string]string{"periode": "2026"}},
		{Kind: "abk", Code: "ABK-001", Title: "ABK Administrasi", Classification: "biasa", Fields: map[string]string{"volume": "0", "kebutuhan": "7"}},
		{Kind: "pembinaan", Code: "BIN-001", Title: "Pembinaan Dokumen", Classification: "biasa", Fields: map[string]string{"tanggal": "2026-10-22"}},
		{Kind: "evaluasi", Code: "EVA-001", Title: "Evaluasi Triwulan", Classification: "penting", Fields: map[string]string{"tenggat": "2026-11-02"}},
	}
	for i, v := range valid {
		if !binfungValid(v) {
			t.Fatalf("valid case %d rejected", i)
		}
	}
	bad := []binfungInput{
		{Kind: "unknown", Code: "Z-01", Title: "Unknown record", Classification: "biasa"},
		{Kind: "sop", Code: "S", Title: "Short", Classification: "biasa"},
		{Kind: "sop", Code: "SOP-01", Title: "Valid name", Classification: "biasa", Fields: map[string]string{"unauthorized": "leak"}},
		{Kind: "pid", Code: "PID-01", Title: "Valid name", Classification: "biasa", Fields: map[string]string{"tanggalDokumen": "2026-99-99"}},
		{Kind: "abk", Code: "ABK-01", Title: "Valid name", Classification: "biasa", Fields: map[string]string{"volume": "-1"}},
		{Kind: "evaluasi", Code: "EVA-01", Title: "Valid name", Classification: "rahasia"},
	}
	for i, v := range bad {
		if binfungValid(v) {
			t.Fatalf("bad case %d accepted", i)
		}
	}
}
