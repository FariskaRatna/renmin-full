package directives

import (
	"encoding/json"
	"strings"
	"testing"
)

func validBaseSheet() *sheet {
	return &sheet{Classification: "biasa", Derajat: "biasa", Dispositions: []string{"MONITOR"}}
}

func TestValidSheetAcceptsNilAndMinimal(t *testing.T) {
	if !validSheet(nil) {
		t.Fatal("nil sheet must be valid (directive without sheet)")
	}
	if !validSheet(validBaseSheet()) {
		t.Fatal("minimal sheet rejected")
	}
	full := &sheet{LetterFrom: "Kapolda", LetterNumber: "B/ND-1/X/2026", DirectiveDate: "2026-11-04", LetterDate: "2026-02-28", Subject: "Undangan", Classification: "penting", Derajat: "kilat", Dispositions: []string{"MONITOR", "ARSIPKAN"}, DispositionNote: "Hadir mewakili"}
	if !validSheet(full) {
		t.Fatal("full sheet rejected")
	}
}

func TestValidSheetRejects(t *testing.T) {
	agenda := int64(7)
	cases := map[string]func(s *sheet){
		"agenda supplied":        func(s *sheet) { s.AgendaNo = &agenda },
		"empty classification":   func(s *sheet) { s.Classification = "" },
		"unknown classification": func(s *sheet) { s.Classification = "rahasia" },
		"unknown derajat":        func(s *sheet) { s.Derajat = "penting" },
		"bad date shape":         func(s *sheet) { s.LetterDate = "04-11-2026" },
		"impossible date":        func(s *sheet) { s.DirectiveDate = "2026-02-30" },
		"duplicate disposition":  func(s *sheet) { s.Dispositions = []string{"MONITOR", "MONITOR"} },
		"lowercase disposition":  func(s *sheet) { s.Dispositions = []string{"monitor"} },
		"too many dispositions": func(s *sheet) {
			s.Dispositions = nil
			for i := 0; i < maxDispositions+1; i++ {
				s.Dispositions = append(s.Dispositions, "K"+strings.Repeat("A", i%20+1)+string(rune('A'+i%26)))
			}
		},
		"subject too long":  func(s *sheet) { s.Subject = strings.Repeat("é", 251) },
		"note too long":     func(s *sheet) { s.DispositionNote = strings.Repeat("a", 1001) },
		"invalid utf8 from": func(s *sheet) { s.LetterFrom = "\xff" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			s := validBaseSheet()
			mutate(s)
			if validSheet(s) {
				t.Fatalf("%s: accepted", name)
			}
		})
	}
}

func TestValidSheetCountsRunesNotBytes(t *testing.T) {
	s := validBaseSheet()
	s.Subject = strings.Repeat("é", 250)
	if !validSheet(s) {
		t.Fatal("250 two-byte runes must fit the 250-rune subject limit")
	}
}

func TestNormalizeSheetTrimsAndNeverNullsDispositions(t *testing.T) {
	n := normalizeSheet(&sheet{LetterFrom: "  Kapolda ", Subject: " Undangan\n", Classification: "biasa", Derajat: "biasa"})
	if n.LetterFrom != "Kapolda" || n.Subject != "Undangan" {
		t.Fatalf("not trimmed: %+v", n)
	}
	b, _ := json.Marshal(n)
	want := `{"letterFrom":"Kapolda","letterNumber":"","directiveDate":"","letterDate":"","subject":"Undangan","classification":"biasa","derajat":"biasa","dispositions":[],"dispositionNote":"","agendaNo":null}`
	if string(b) != want {
		t.Fatalf("serialized sheet\n got %s\nwant %s", b, want)
	}
	if normalizeSheet(nil) != nil {
		t.Fatal("nil must stay nil")
	}
}

func TestCreateRejectsUnknownSheetField(t *testing.T) {
	var p createRequest
	dec := json.NewDecoder(strings.NewReader(`{"title":"abc","sheet":{"classification":"biasa","derajat":"biasa","extra":1}}`))
	dec.DisallowUnknownFields()
	if dec.Decode(&p) == nil {
		t.Fatal("unknown field inside sheet must be rejected")
	}
}

func TestSummaryOmitsMissingSheet(t *testing.T) {
	b, _ := json.Marshal(summary{})
	if strings.Contains(string(b), "sheet") {
		t.Fatalf("directive without sheet must serialize as before 041: %s", b)
	}
	b, _ = json.Marshal(directiveDraft{})
	if strings.Contains(string(b), "sheet") {
		t.Fatalf("draft without sheet must serialize as before 041: %s", b)
	}
}
