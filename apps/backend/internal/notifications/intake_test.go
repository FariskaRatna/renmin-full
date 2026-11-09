package notifications

import (
	"strings"
	"testing"
)

func TestIntakeMailHasNoLetterDetails(t *testing.T) {
	subject, body := intakeMailMessage()
	if subject != "Surat Masuk Baru - SIERA DELTA LIMA" {
		t.Fatal("unexpected subject")
	}
	if !strings.Contains(body, "URMIN > Surat Masuk > Inbox") {
		t.Fatal("missing inbox navigation")
	}
	if strings.Contains(body, "Disposisi > Tugas Saya") {
		t.Fatal("wrong navigation")
	}
}
