package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCSRFRequiresOriginAndMatchingCookie(t *testing.T) {
	svc := &Service{origins: map[string]bool{"http://127.0.0.1:5174": true}}
	req := httptest.NewRequest("POST", "http://127.0.0.1:5174/api/v1/auth/logout", strings.NewReader(""))
	req.Header.Set("Origin", "http://127.0.0.1:5174")
	req.Header.Set("X-CSRF-Token", strings.Repeat("x", 43))
	req.AddCookie(&http.Cookie{Name: csrfCookie, Value: strings.Repeat("x", 43)})
	if !svc.allowMutation(req) {
		t.Fatal("same-origin request rejected")
	}
	req.Header.Set("Origin", "https://evil.invalid")
	if svc.allowMutation(req) {
		t.Fatal("cross origin request accepted")
	}
	req.Header.Set("Origin", "http://127.0.0.1:5174")
	req.Header.Set("X-CSRF-Token", strings.Repeat("y", 43))
	if svc.allowMutation(req) {
		t.Fatal("mismatched token accepted")
	}
}
