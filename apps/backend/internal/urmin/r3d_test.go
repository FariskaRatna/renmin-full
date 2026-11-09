package urmin

import (
	"testing"
	"time"
)

func TestDispositionSLA(t *testing.T) {
	now := time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC)
	due := time.Date(2026, 10, 18, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		task dispositionTask
		want string
	}{
		{dispositionTask{DueDate: "2026-10-21", Status: "pending"}, "on_track"},
		{dispositionTask{DueDate: "2026-10-18", Status: "pending"}, "overdue"},
		{dispositionTask{DueDate: "2026-10-18", Status: "completed", CompletedAt: timePtr(due.Add(23 * time.Hour))}, "completed_on_time"},
		{dispositionTask{DueDate: "2026-10-18", Status: "completed", CompletedAt: timePtr(due.Add(25 * time.Hour))}, "completed_late"},
	}
	for _, tc := range cases {
		if got := dispositionSLA(tc.task, now); got != tc.want {
			t.Errorf("%+v got %s want %s", tc.task, got, tc.want)
		}
	}
}
func timePtr(t time.Time) *time.Time { return &t }
func TestReviewEligibility(t *testing.T) {
	ok := dispositionTask{IssuerID: "issuer", Status: "completed", ReviewStatus: "awaiting_review"}
	if !dispositionReviewEligible(ok, "issuer") {
		t.Fatal("valid issuer not eligible")
	}
	if dispositionReviewEligible(ok, "other") {
		t.Fatal("other user may review")
	}
	ok.ReviewStatus = "approved"
	if dispositionReviewEligible(ok, "issuer") {
		t.Fatal("review replay allowed")
	}
	ok.ReviewStatus = "awaiting_review"
	ok.Status = "in_progress"
	if dispositionReviewEligible(ok, "issuer") {
		t.Fatal("premature review allowed")
	}
}
