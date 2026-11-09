package urmin

import "testing"

func TestR3D3ProgressIsDerivedFromReviews(t *testing.T) {
	cases := []struct {
		approved, total int
		state           string
		want            int
	}{
		{0, 0, "not_submitted", 0}, {0, 3, "not_submitted", 0}, {1, 3, "not_submitted", 30}, {2, 3, "not_submitted", 60}, {3, 3, "pending", 90}, {3, 3, "revision_requested", 90}, {3, 3, "approved", 100},
	}
	for _, c := range cases {
		if got := progressPercent(c.approved, c.total, c.state); got != c.want {
			t.Errorf("progress %v: got %d want %d", c, got, c.want)
		}
	}
}
