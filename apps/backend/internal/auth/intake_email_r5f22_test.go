package auth

import (
	"strings"
	"testing"
)

func TestIntakeNotificationPointsToInbox(t *testing.T) {
	raw, err := buildNotificationEmail("test@example.com", "kabag@example.com",
		"Surat Masuk Baru - SIERA DELTA LIMA", "Ada surat baru yang memerlukan arahan.")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(raw, "Surat Masuk") || !strings.Contains(raw, "Inbox") {
		t.Fatal("incoming-letter navigation missing")
	}
	if strings.Contains(raw, "Disposisi") {
		t.Fatal("unexpected task navigation")
	}
}
