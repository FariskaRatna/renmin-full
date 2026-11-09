package urmin

import "testing"

func TestDispositionHierarchyLimits(t *testing.T) {
	for _, c := range []struct {
		depth   int
		status  string
		allowed bool
	}{
		{0, "in_progress", true}, {1, "in_progress", true}, {2, "in_progress", false}, {0, "pending", false}, {1, "completed", false},
	} {
		got := c.depth < 2 && c.status == "in_progress"
		if got != c.allowed {
			t.Errorf("depth=%d status=%s: got %t", c.depth, c.status, got)
		}
	}
}
