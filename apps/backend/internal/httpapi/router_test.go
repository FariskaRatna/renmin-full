package httpapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakeDB struct{ err error }

func (f fakeDB) Ping(context.Context) error { return f.err }

func TestHealthAlwaysAlive(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	resp := httptest.NewRecorder()
	NewRouter(fakeDB{errors.New("no DB")}).ServeHTTP(resp, req)
	if resp.Code != 200 {
		t.Fatalf("expected 200, got %d", resp.Code)
	}
}

func TestReadiness(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want int
	}{
		{nil, 200}, {errors.New("down"), 503},
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/system/status", nil)
		rec := httptest.NewRecorder()
		NewRouter(fakeDB{tc.err}).ServeHTTP(rec, req)
		if rec.Code != tc.want {
			t.Fatalf("want %d, got %d", tc.want, rec.Code)
		}
		if strings.Contains(rec.Body.String(), "down") {
			t.Fatal("internal error leaked")
		}
		if rec.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("missing no-store")
		}
	}
}

func TestMissingRoutesNotFound(t *testing.T) {
	rec := httptest.NewRecorder()
	NewRouter(fakeDB{}).ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/users", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unexpected route: %d", rec.Code)
	}
}
