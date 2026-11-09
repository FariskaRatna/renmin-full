package unitwork

import "testing"

func TestOutgoingReviewStages(t *testing.T) {
	cases := []struct {
		stage          string
		submit, review bool
	}{
		{"draft", true, false}, {"rejected", true, false}, {"submitted", false, true}, {"approved", false, false},
		{"signed", false, false}, {"sent", false, false}, {"", false, false},
	}
	for _, c := range cases {
		if got := outgoingCanSubmit(c.stage); got != c.submit {
			t.Errorf("submit(%q)=%t", c.stage, got)
		}
		if got := outgoingCanReview(c.stage); got != c.review {
			t.Errorf("review(%q)=%t", c.stage, got)
		}
	}
}
