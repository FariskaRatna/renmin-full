package subbagren

import "testing"

func TestR4A3BudgetAmountAndDateValidation(t *testing.T) {
	for _, tc := range []struct {
		value int64
		ok    bool
	}{{0, false}, {-1, false}, {1, true}, {1000000000000000, true}, {1000000000000001, false}} {
		if amountOK(tc.value) != tc.ok {
			t.Errorf("amount=%d accepted=%v want %v", tc.value, amountOK(tc.value), tc.ok)
		}
	}
	for _, tc := range []struct {
		date string
		ok   bool
	}{{"2026-10-20", true}, {"2027-02-28", true}, {"2027-02-29", false}, {"2026-13-01", false}, {"invalid", false}, {"2019-01-01", false}} {
		_, got := validDate(tc.date)
		if got != tc.ok {
			t.Errorf("date=%s accepted=%v want %v", tc.date, got, tc.ok)
		}
	}
}
