package urmin

import "testing"

func TestR5F20SimpleClosureScope(t *testing.T) {
	base := dispositionTask{Unit: "urmin", Classification: "biasa", Depth: 0}
	done := progressInfo{Total: 1, Approved: 1, Ready: true}
	if !autoCloseSimpleCandidate(base, "not_submitted", done) {
		t.Fatal("single reviewed Urmin task should qualify")
	}
	base.Unit = "subbagren"
	if autoCloseSimpleCandidate(base, "not_submitted", done) {
		t.Fatal("other units still require formal final")
	}
	base.Unit = "urmin"
	base.Classification = "penting"
	if autoCloseSimpleCandidate(base, "not_submitted", done) {
		t.Fatal("important classification requires existing process")
	}
	base.Classification = "biasa"
	if autoCloseSimpleCandidate(base, "pending", done) {
		t.Fatal("existing pending approval must not be bypassed")
	}
	if autoCloseSimpleCandidate(base, "approved", done) {
		t.Fatal("existing approved decision must be preserved")
	}
	if autoCloseSimpleCandidate(base, "not_submitted", progressInfo{Total: 2, Approved: 2, Ready: true}) {
		t.Fatal("multiple tasks require existing process")
	}
	if autoCloseSimpleCandidate(base, "not_submitted", progressInfo{Total: 1, Approved: 0, Ready: false}) {
		t.Fatal("unfinished tasks cannot close")
	}
}
