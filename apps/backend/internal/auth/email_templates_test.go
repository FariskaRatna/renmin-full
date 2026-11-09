package auth

import (
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"strings"
	"testing"
)

func getParts(t *testing.T, message string) (string, string) {
	t.Helper()
	parsed, err := mail.ReadMessage(strings.NewReader(message))
	if err != nil {
		t.Fatal(err)
	}
	mediatype, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
	if err != nil || mediatype != "multipart/alternative" {
		t.Fatalf("wrong content type: %s, %v", mediatype, err)
	}
	mr := multipart.NewReader(parsed.Body, params["boundary"])
	parts := []string{}
	for {
		part, err := mr.NextRawPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		if part.Header.Get("Content-Transfer-Encoding") != "quoted-printable" {
			t.Fatal("expected quoted-printable")
		}
		decoded, err := io.ReadAll(quotedprintable.NewReader(part))
		if err != nil {
			t.Fatal(err)
		}
		parts = append(parts, string(decoded))
	}
	if len(parts) != 2 {
		t.Fatalf("want 2 parts, got %d", len(parts))
	}
	return parts[0], parts[1]
}

func TestOTPTemplatePreservesCodeAndLifetime(t *testing.T) {
	msg, err := buildOTPEmail("sender@example.com", "person@example.com", "123456")
	if err != nil {
		t.Fatal(err)
	}
	textPart, htmlPart := getParts(t, msg)
	for _, p := range []string{textPart, htmlPart} {
		if !strings.Contains(p, "123456") || !strings.Contains(p, "5 menit") {
			t.Fatal("missing code/expiry")
		}
		if strings.Contains(p, "http://") || strings.Contains(p, "https://") {
			t.Fatal("unexpected external content")
		}
	}
	if _, err := buildOTPEmail("sender@example.com", "person@example.com", "123456\r\nX-Bad:1"); err == nil {
		t.Fatal("OTP injection should fail")
	}
}

func TestNotificationTemplateEscapesHTML(t *testing.T) {
	msg, err := buildNotificationEmail("sender@example.com", "person@example.com", "Tugas Baru - SIERA DELTA LIMA", "Pemberitahuan <b>test</b>")
	if err != nil {
		t.Fatal(err)
	}
	textPart, htmlPart := getParts(t, msg)
	if !strings.Contains(textPart, "<b>test</b>") {
		t.Fatal("plain text lost")
	}
	if strings.Contains(htmlPart, "<b>test</b>") || !strings.Contains(htmlPart, "&lt;b&gt;test&lt;/b&gt;") {
		t.Fatal("html not escaped")
	}
	if !strings.Contains(htmlPart, "BagRenmin Densus 88 AT Polri") {
		t.Fatal("missing branding")
	}
	if _, err := buildNotificationEmail("sender@example.com", "person@example.com", "Subj\r\nBcc: nope", "ok"); err == nil {
		t.Fatal("header injection should fail")
	}
}

func TestMailFromUsesBrandedSenderWithoutChangingEnvelope(t *testing.T) {
 for _, msgFn := range []func() (string,error){
  func()(string,error){return buildOTPEmail("system@example.com","recipient@example.com","123456")},
  func()(string,error){return buildNotificationEmail("system@example.com","recipient@example.com","Tugas Baru - SIERA DELTA LIMA","Ada penugasan baru.")},
 } {
  msg,err:=msgFn();if err!=nil{t.Fatal(err)}
  parsed,err:=mail.ReadMessage(strings.NewReader(msg));if err!=nil{t.Fatal(err)}
  addr,err:=mail.ParseAddress(parsed.Header.Get("From"));if err!=nil{t.Fatal(err)}
  if addr.Name!="No-Reply Siera Delta Lima" || addr.Address!="system@example.com" {t.Fatalf("unexpected From header: %q", parsed.Header.Get("From"))}
 }
}
