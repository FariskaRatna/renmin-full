package subbagren

import "testing"

func TestDraftValidation(t *testing.T) {
	good := Draft{FiscalYear: 2027, SourceUnit: "Unit Pengusul", Title: "Pengembangan aplikasi internal", OutputTarget: "Dokumen perencanaan kegiatan", ProposedBudget: 150000000, Classification: "biasa", Reason: "Usulan awal untuk pembahasan"}
	if !validDraft(good) {
		t.Fatal("valid draft rejected")
	}
	for name, alter := range map[string]func(*Draft){
		"negative_budget":        func(d *Draft) { d.ProposedBudget = -1 },
		"huge_budget":            func(d *Draft) { d.ProposedBudget = 1000000000000001 },
		"future_year":            func(d *Draft) { d.FiscalYear = 2101 },
		"empty_source":           func(d *Draft) { d.SourceUnit = "  " },
		"weak_reason":            func(d *Draft) { d.Reason = "a" },
		"invalid_classification": func(d *Draft) { d.Classification = "secret" },
	} {
		t.Run(name, func(t *testing.T) {
			d := good
			alter(&d)
			if validDraft(d) {
				t.Fatal("unsafe draft accepted")
			}
		})
	}
}
