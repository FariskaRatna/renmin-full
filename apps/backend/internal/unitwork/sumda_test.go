package unitwork

import "testing"

func TestR5BSumdaValidation(t *testing.T) {
	valid := sumdaInput{Kind: "inventaris", Code: "BMN-001", Title: "Laptop Operator", Classification: "biasa", Fields: map[string]string{"jumlah": "2", "kondisi": "Baik"}}
	if !sumdaValid(valid) {
		t.Fatal("valid BMN refused")
	}
	checks := []sumdaInput{
		{Kind: "inventaris", Code: "BMN-001", Title: "Laptop Operator", Classification: "biasa", Fields: map[string]string{"jumlah": "-1"}},
		{Kind: "inventaris", Code: "BMN-001", Title: "Laptop Operator", Classification: "biasa", Fields: map[string]string{"jumlah": "0"}},
		{Kind: "personel", Code: "ABC", Title: "Nama Personel", Classification: "biasa", Fields: map[string]string{"alamatRumah": "private"}},
		{Kind: "pendidikan", Code: "DIK-1", Title: "Diklat Pengelolaan", Classification: "biasa", Fields: map[string]string{"tanggalMulai": "2026-10-20", "tanggalSelesai": "2026-10-19"}},
		{Kind: "unknown", Code: "XX", Title: "Some thing", Classification: "biasa"},
	}
	for i, v := range checks {
		if sumdaValid(v) {
			t.Fatalf("bad case %d accepted", i)
		}
	}
}
