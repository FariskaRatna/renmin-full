package auth

import "testing"

func TestPasswordRoundTrip(t *testing.T) {
	h, err := HashPassword("sdl-test-password-is-long-enough")
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword(h, "sdl-test-password-is-long-enough") {
		t.Fatal("valid password rejected")
	}
	if VerifyPassword(h, "invalid") || VerifyPassword("$argon2id$v=19$m=99999999,t=1,p=2$bad$bad", "whatever") {
		t.Fatal("invalid password accepted")
	}
}
func TestPasswordShort(t *testing.T) {
	if _, err := HashPassword("short"); err == nil {
		t.Fatal("short password accepted")
	}
}
func TestMailerRequiresTLS(t *testing.T) {
	if (Mailer{Host: "127.0.0.1", Port: 25, Username: "u", Password: "p", From: "from@example.com"}).Ready() {
		t.Fatal("plaintext SMTP must not pass")
	}
}
