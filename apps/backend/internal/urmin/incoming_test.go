package urmin

import "testing"

func TestValidationDenyByDefault(t *testing.T) {
	valid := payload{LetterNumber: "B/123/2026", Sender: "Sekretariat", LetterDate: "2026-10-17", ReceivedDate: "2026-10-17", Subject: "Undangan rapat", Classification: "biasa", Reason: "Registrasi administrasi", Version: 1}
	if !validPayload(valid) {
		t.Fatal("valid payload rejected")
	}
	cases := []struct {
		name   string
		modify func(*payload)
	}{
		{"secret classification", func(p *payload) { p.Classification = "rahasia" }},
		{"invalid date", func(p *payload) { p.LetterDate = "2026-02-30" }},
		{"empty reason", func(p *payload) { p.Reason = "" }},
		{"short subject", func(p *payload) { p.Subject = "x" }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			v := valid
			c.modify(&v)
			if validPayload(v) {
				t.Fatal("unsafe payload accepted")
			}
		})
	}
}
