package urmin

import (
	"testing"
	"time"
)

func TestDispositionDueValidation(t *testing.T) {
	today := time.Now().UTC()
	for _, tc := range []struct {
		due string
		ok  bool
	}{
		{today.Format("2006-01-02"), true},
		{today.AddDate(0, 0, 10).Format("2006-01-02"), true},
		{today.AddDate(0, 0, -1).Format("2006-01-02"), false},
		{today.AddDate(1, 0, 1).Format("2006-01-02"), false},
		{"2026-02-30", false},
		{"tomorrow", false},
	} {
		if got := validDispositionDue(tc.due); got != tc.ok {
			t.Errorf("due %q: got %v want %v", tc.due, got, tc.ok)
		}
	}
}
