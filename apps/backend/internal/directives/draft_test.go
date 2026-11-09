package directives

import "testing"

func TestValidDraftAllowsIncompleteContent(t *testing.T) {
	d := directiveDraft{Kind: "umum", Priority: "biasa", Recipients: []string{}}
	if !validDraft(d) {
		t.Fatal("autosave must allow empty content")
	}
	d.Title = "Catatan rapat yang belum selesai"
	d.Recipients = []string{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
	if !validDraft(d) {
		t.Fatal("valid partial draft rejected")
	}
	d.Recipients = append(d.Recipients, d.Recipients[0])
	if validDraft(d) {
		t.Fatal("duplicate recipients accepted")
	}
	d.Recipients = []string{}
	d.DueAt = "2026-02-30T14:30"
	if validDraft(d) {
		t.Fatal("invalid calendar date accepted")
	}
	d.DueAt = "2026-10-24T14:30"
	if !validDraft(d) {
		t.Fatal("valid date rejected")
	}
	d.Kind = "chat"
	if validDraft(d) {
		t.Fatal("unexpected kind accepted")
	}
}
