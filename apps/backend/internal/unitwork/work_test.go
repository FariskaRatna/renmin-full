package unitwork

import "testing"

func TestFourUnitRoutesAndMedia(t *testing.T) {
	for _, u := range []string{"urmin", "subbagren", "subbagsumda", "subbagbinfung"} {
		if !allowedUnit(u) {
			t.Fatalf("must allow unit %q", u)
		}
	}
	for _, u := range []string{"superadmin", "other", "", "../urmin"} {
		if allowedUnit(u) {
			t.Fatalf("must deny unit %q", u)
		}
	}
	cases := []struct {
		value []byte
		want  string
	}{
		{[]byte("%PDF-1.7 test"), "application/pdf"},
		{[]byte{0xff, 0xd8, 0xff, 0x00}, "image/jpeg"},
		{[]byte{137, 80, 78, 71, 13, 10, 26, 10}, "image/png"},
		{[]byte("<script>alert(1)</script>"), ""},
	}
	for _, tc := range cases {
		if got := fileType(tc.value); got != tc.want {
			t.Errorf("file signature %q: expected %q", got, tc.want)
		}
	}
	if got := safeName("../../private/photo.jpg"); got != "photo.jpg" {
		t.Fatalf("unsafe filename %q", got)
	}
	if !validInput(recordInput{Category: "Dokumen", Title: "Rapat 2026", Classification: "biasa"}) {
		t.Fatal("valid document rejected")
	}
	if validInput(recordInput{Category: "A", Title: "X", Classification: "rahasia"}) {
		t.Fatal("invalid document accepted")
	}
}
