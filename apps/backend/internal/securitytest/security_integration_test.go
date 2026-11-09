//go:build r2d5integration

package securitytest

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/auth"
	"siera-delta-lima/backend/internal/httpapi"
	"siera-delta-lima/backend/internal/migrations"
)

const origin = "http://127.0.0.1:5174"
const fixturePassword = "SDL-R2D5-Temporary-Test-Only-Password!"

type account struct {
	id       string
	username string
	otp      bool
	active   bool
	super    bool
}
type testEnv struct {
	db     *pgxpool.Pool
	srv    *httptest.Server
	secret []byte
	users  map[string]account
}
type browser struct {
	client   *http.Client
	token    string
	endpoint string
}

func (e *testEnv) createUser(t *testing.T, ctx context.Context, username string, otp, active, super bool) account {
	t.Helper()
	ph, err := auth.HashPassword(fixturePassword)
	if err != nil {
		t.Fatalf("test password hashing: %v", err)
	}
	var id string
	err = e.db.QueryRow(ctx, `INSERT INTO sdl_users(username,email,display_name,password_hash,otp_enabled,is_active) VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`, username, username+"@test.invalid", "R2D5 "+username, ph, otp, active).Scan(&id)
	if err != nil {
		t.Fatalf("seed test user: %v", err)
	}
	if super {
		if _, err = e.db.Exec(ctx, `INSERT INTO sdl_user_roles(user_id,role_key) VALUES($1,'superadmin')`, id); err != nil {
			t.Fatal(err)
		}
	}
	return account{id: id, username: username, otp: otp, active: active, super: super}
}
func setup(t *testing.T) *testEnv {
	t.Helper()
	if os.Getenv("SDL_SECURITY_TEST_CONFIRM") != "R2D5_EPHEMERAL_ONLY" {
		t.Fatal("refusing to run outside explicitly isolated security test")
	}
	dsn := os.Getenv("SDL_SECURITY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("isolated test database URL is missing")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("isolated DB: %v", err)
	}
	t.Cleanup(pool.Close)
	var dbname string
	if err = pool.QueryRow(ctx, "SELECT current_database()").Scan(&dbname); err != nil || dbname != "sdl_security_test" {
		t.Fatal("refusing to touch non-test database")
	}
	var n int
	if err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'sdl_%'`).Scan(&n); err != nil || n != 0 {
		t.Fatal("test DB must be fresh, empty, and isolated")
	}
	if err = migrations.Run(ctx, pool); err != nil {
		t.Fatalf("schema migration in test DB: %v", err)
	}
	if err = migrations.Verify(ctx, pool); err != nil {
		t.Fatalf("schema verification: %v", err)
	}
	e := &testEnv{db: pool, secret: bytes.Repeat([]byte{0x5d}, 32), users: map[string]account{}}
	t.Setenv("SDL_EVIDENCE_KEY", hex.EncodeToString(bytes.Repeat([]byte{0x4a}, 32)))
	for _, tc := range []struct {
		name               string
		otp, active, super bool
	}{
		{"sa_r2d5", false, true, true}, // intentionally false to prove hard mandatory superadmin OTP
		{"op_r2d5", false, true, false},
		{"outsider_r2d5", false, true, false},
		{"otp_r2d5", true, true, false},
		{"disabled_r2d5", false, false, false},
	} {
		e.users[tc.name] = e.createUser(t, ctx, tc.name, tc.otp, tc.active, tc.super)
	}
	op := e.users["op_r2d5"]
	outside := e.users["outsider_r2d5"]
	for _, row := range []struct{ id, unit string }{{op.id, "urmin"}, {outside.id, "subbagren"}} {
		if _, err = e.db.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,$2,true)`, row.id, row.unit); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{"urmin.surat_masuk.read", "urmin.surat_masuk.create", "urmin.surat_masuk.update"} {
		if _, err = e.db.Exec(ctx, `INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES('operator',$1) ON CONFLICT DO NOTHING`, p); err != nil {
			t.Fatal(err)
		}
	}
	for _, row := range []struct{ id, unit, scope string }{{op.id, "urmin", "own"}, {outside.id, "subbagren", "unit"}} {
		if _, err = e.db.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,'operator',$2,$3,'biasa','isolated R2D5 integration test only',$4)`, row.id, row.unit, row.scope, e.users["sa_r2d5"].id); err != nil {
			t.Fatal(err)
		}
	}
	a, err := auth.New(pool, auth.Config{Secret: e.secret, SecureCookie: false, AllowedOrigins: []string{origin}, Mailer: auth.Mailer{}})
	if err != nil {
		t.Fatal(err)
	}
	e.srv = httptest.NewServer(httpapi.NewRouterWithAuth(pool, a))
	t.Cleanup(e.srv.Close)
	return e
}
func (e *testEnv) newBrowser(t *testing.T) *browser {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	b := &browser{client: &http.Client{Jar: jar, Timeout: 15 * time.Second}, endpoint: e.srv.URL}
	r, body := b.call(t, "GET", "/api/v1/auth/csrf", nil, false)
	if r.StatusCode != 200 {
		t.Fatalf("CSRF bootstrap %d: %s", r.StatusCode, string(body))
	}
	var parsed struct {
		CSRFToken string `json:"csrfToken"`
	}
	if json.Unmarshal(body, &parsed) != nil || len(parsed.CSRFToken) < 24 {
		t.Fatal("missing CSRF token")
	}
	b.token = parsed.CSRFToken
	return b
}
func (b *browser) call(t *testing.T, method, path string, payload any, mutation bool) (*http.Response, []byte) {
	t.Helper()
	var reader io.Reader
	if payload != nil {
		switch x := payload.(type) {
		case []byte:
			reader = bytes.NewReader(x)
		default:
			raw, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			reader = bytes.NewReader(raw)
		}
	}
	req, err := http.NewRequest(method, b.endpoint+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if mutation {
		req.Header.Set("Origin", origin)
		req.Header.Set("X-CSRF-Token", b.token)
	}
	resp, err := b.client.Do(req)
	if err != nil {
		t.Fatalf("HTTP %s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 3<<20))
	if err != nil {
		t.Fatal(err)
	}
	return resp, raw
}
func status(t *testing.T, r *http.Response, body []byte, want int) {
	t.Helper()
	if r.StatusCode != want {
		t.Fatalf("HTTP %d expected %d: %s", r.StatusCode, want, string(body))
	}
}
func (b *browser) captcha(t *testing.T) map[string]any {
	t.Helper()
	r, raw := b.call(t, "GET", "/api/v1/auth/captcha", nil, false)
	status(t, r, raw, 200)
	var c struct {
		ID         string `json:"id"`
		Nonce      string `json:"nonce"`
		Difficulty int    `json:"difficulty"`
	}
	if err := json.Unmarshal(raw, &c); err != nil || c.ID == "" || c.Nonce == "" || c.Difficulty != 16 {
		t.Fatal("bad local CAPTCHA challenge")
	}
	for i := uint32(0); i < 5000000; i++ {
		h := sha256.Sum256([]byte(c.Nonce + ":" + strconv.FormatUint(uint64(i), 10)))
		if h[0] == 0 && h[1] == 0 {
			return map[string]any{"id": c.ID, "counter": i}
		}
	}
	t.Fatal("CAPTCHA could not be solved in the permitted range")
	return nil
}
func (b *browser) login(t *testing.T, name string, expected int) []byte {
	t.Helper()
	challenge := b.captcha(t)
	r, raw := b.call(t, "POST", "/api/v1/auth/login", map[string]any{"username": name, "password": fixturePassword, "captcha": challenge}, true)
	status(t, r, raw, expected)
	return raw
}
func digestSecret(secret []byte, purpose, value string) string {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(purpose))
	h.Write([]byte{0})
	h.Write([]byte(value))
	return hex.EncodeToString(h.Sum(nil))
}
func tokenDigest(s string) string { d := sha256.Sum256([]byte(s)); return hex.EncodeToString(d[:]) }
func (e *testEnv) setOTPChallenge(t *testing.T, user account, expires bool) (string, string) {
	t.Helper()
	challenge := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{0x77}, 32))
	code := "123456"
	createdSQL := "NOW()"
	expiresSQL := "NOW()+INTERVAL '5 minutes'"
	if expires {
		createdSQL = "NOW()-INTERVAL '10 minutes'"
		expiresSQL = "NOW()-INTERVAL '1 minute'"
	}
	query := fmt.Sprintf(`INSERT INTO sdl_login_challenges(challenge_hash,user_id,otp_code_hash,created_at,expires_at) VALUES($1,$2,$3,%s,%s) ON CONFLICT(challenge_hash) DO UPDATE SET user_id=EXCLUDED.user_id,otp_code_hash=EXCLUDED.otp_code_hash,created_at=EXCLUDED.created_at,expires_at=EXCLUDED.expires_at,attempts=0,consumed_at=NULL`, createdSQL, expiresSQL)
	if _, err := e.db.Exec(context.Background(), query, digestSecret(e.secret, "challenge", challenge), user.id, digestSecret(e.secret, "otp", challenge+":"+code)); err != nil {
		t.Fatal(err)
	}
	return challenge, code
}
func (e *testEnv) loginSuperadminUsingFixtureOTP(t *testing.T) *browser {
	t.Helper()
	b := e.newBrowser(t)
	challenge, code := e.setOTPChallenge(t, e.users["sa_r2d5"], false)
	r, body := b.call(t, "POST", "/api/v1/auth/verify-otp", map[string]string{"challenge": challenge, "code": code}, true)
	status(t, r, body, 200)
	return b
}
func TestR2D5EndToEndSecurity(t *testing.T) {
	e := setup(t)
	var op, outsider, sa *browser
	var docID string
	t.Run("01_public_status_and_secure_headers", func(t *testing.T) {
		b := e.newBrowser(t)
		r, body := b.call(t, "GET", "/api/v1/system/status", nil, false)
		status(t, r, body, 200)
		if r.Header.Get("Cache-Control") != "no-store" || r.Header.Get("X-Content-Type-Options") != "nosniff" || r.Header.Get("X-Frame-Options") != "DENY" {
			t.Fatal("HTTP security headers missing")
		}
	})
	t.Run("02_anonymous_admin_and_documents_denied", func(t *testing.T) {
		b := e.newBrowser(t)
		for _, path := range []string{"/api/v1/admin/users", "/api/v1/admin/roles", "/api/v1/urmin/surat-masuk/"} {
			r, body := b.call(t, "GET", path, nil, false)
			status(t, r, body, 401)
		}
	})
	t.Run("03_csrf_origin_and_token_required", func(t *testing.T) {
		b := e.newBrowser(t)
		r, body := b.call(t, "POST", "/api/v1/auth/logout", map[string]any{}, false)
		status(t, r, body, 403)
		req, err := http.NewRequest("POST", b.endpoint+"/api/v1/auth/logout", bytes.NewReader([]byte("{}")))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Origin", "https://attacker.invalid")
		req.Header.Set("X-CSRF-Token", b.token)
		r, err = b.client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		r.Body.Close()
		if r.StatusCode != 403 {
			t.Fatal("foreign origin accepted")
		}
	})
	t.Run("04_captcha_invalid_replay_and_expiry", func(t *testing.T) {
		b := e.newBrowser(t)
		r, body := b.call(t, "POST", "/api/v1/auth/login", map[string]any{"username": "op_r2d5", "password": fixturePassword, "captcha": map[string]any{"id": "invalid", "counter": 1}}, true)
		status(t, r, body, 403)
		c := b.captcha(t)
		p := map[string]any{"username": "op_r2d5", "password": "bad-password", "captcha": c}
		r, body = b.call(t, "POST", "/api/v1/auth/login", p, true)
		status(t, r, body, 401)
		r, body = b.call(t, "POST", "/api/v1/auth/login", p, true)
		status(t, r, body, 403)
		old := b.captcha(t)
		if _, err := e.db.Exec(context.Background(), `UPDATE sdl_captcha_challenges SET created_at=NOW()-INTERVAL '3 minutes', expires_at=NOW()-INTERVAL '1 minute' WHERE challenge_hash=$1`, tokenDigest(old["id"].(string))); err != nil {
			t.Fatal(err)
		}
		r, body = b.call(t, "POST", "/api/v1/auth/login", map[string]any{"username": "op_r2d5", "password": fixturePassword, "captcha": old}, true)
		status(t, r, body, 403)
	})
	t.Run("05_non_superadmin_otp_off_login", func(t *testing.T) {
		op = e.newBrowser(t)
		body := op.login(t, "op_r2d5", 200)
		var data map[string]any
		if json.Unmarshal(body, &data) != nil || data["otpRequired"] != false || data["authenticated"] != true {
			t.Fatal("password-only policy not honored")
		}
		r, raw := op.call(t, "GET", "/api/v1/auth/me", nil, false)
		status(t, r, raw, 200)
	})
	t.Run("06_otp_on_and_superadmin_fail_closed_without_smtp", func(t *testing.T) {
		for _, name := range []string{"otp_r2d5", "sa_r2d5"} {
			b := e.newBrowser(t)
			b.login(t, name, 503)
			r, body := b.call(t, "GET", "/api/v1/auth/me", nil, false)
			status(t, r, body, 401)
		}
	})
	t.Run("07_expired_otp_denied_and_valid_otp_single_use", func(t *testing.T) {
		b := e.newBrowser(t)
		s := e.users["sa_r2d5"]
		challenge, code := e.setOTPChallenge(t, s, true)
		payload := map[string]any{"challenge": challenge, "code": code}
		r, body := b.call(t, "POST", "/api/v1/auth/verify-otp", payload, true)
		status(t, r, body, 401)
		challenge, code = e.setOTPChallenge(t, s, false)
		payload = map[string]any{"challenge": challenge, "code": code}
		r, body = b.call(t, "POST", "/api/v1/auth/verify-otp", payload, true)
		status(t, r, body, 200)
		r, body = b.call(t, "POST", "/api/v1/auth/verify-otp", payload, true)
		status(t, r, body, 401)
		sa = b
	})
	t.Run("08_superadmin_operational_and_delegation_access_denied", func(t *testing.T) {
		r, body := sa.call(t, "GET", "/api/v1/admin/users", nil, false)
		status(t, r, body, 200)
		r, body = sa.call(t, "GET", "/api/v1/admin/roles", nil, false)
		status(t, r, body, 200)
		for _, path := range []string{"/api/v1/urmin/surat-masuk/", "/api/v1/urmin/surat-masuk/capabilities", "/api/v1/admin/delegations"} {
			r, body = sa.call(t, "GET", path, nil, false)
			status(t, r, body, 403)
		}
		super := e.users["sa_r2d5"]
		if _, err := e.db.Exec(context.Background(), `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,'urmin',true)`, super.id); err != nil {
			t.Fatal(err)
		}
		if _, err := e.db.Exec(context.Background(), `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,grant_reason,granted_by) VALUES($1,'operator','urmin','unit','penting','deliberate negative test grant',$1)`, super.id); err != nil {
			t.Fatal(err)
		}
		r, body = sa.call(t, "GET", "/api/v1/urmin/surat-masuk/", nil, false)
		status(t, r, body, 403)
	})
	t.Run("09_role_scope_and_cross_unit_document_enforced", func(t *testing.T) {
		r, body := op.call(t, "GET", "/api/v1/urmin/surat-masuk/capabilities", nil, false)
		status(t, r, body, 200)
		if !bytes.Contains(body, []byte(`"canCreate":true`)) {
			t.Fatal("valid own-scope grant rejected")
		}
		outsider = e.newBrowser(t)
		outsider.login(t, "outsider_r2d5", 200)
		r, body = outsider.call(t, "GET", "/api/v1/urmin/surat-masuk/capabilities", nil, false)
		status(t, r, body, 200)
		if !bytes.Contains(body, []byte(`"canCreate":false`)) {
			t.Fatal("cross-unit grant accepted")
		}
		r, body = outsider.call(t, "GET", "/api/v1/admin/users", nil, false)
		status(t, r, body, 403)
		p := map[string]any{"letterNumber": "SDL-R2D5-001", "sender": "Security Test Sender", "letterDate": "2026-10-18", "receivedDate": "2026-10-18", "subject": "Temporary isolated security integration test", "classification": "biasa", "reason": "R2D5 isolated test document creation"}
		r, body = op.call(t, "POST", "/api/v1/urmin/surat-masuk/", p, true)
		status(t, r, body, 201)
		var created struct {
			Item struct {
				ID string `json:"id"`
			} `json:"item"`
		}
		if json.Unmarshal(body, &created) != nil || created.Item.ID == "" {
			t.Fatalf("could not obtain test document id")
		}
		docID = created.Item.ID
		r, body = outsider.call(t, "GET", "/api/v1/urmin/surat-masuk/"+docID, nil, false)
		status(t, r, body, 404)
		r, body = op.call(t, "GET", "/api/v1/urmin/surat-masuk/"+docID, nil, false)
		status(t, r, body, 200)
	})
	t.Run("09b_r3b_secure_distribution", func(t *testing.T) {
		verifyR3BSecureDistribution(t, e, op, outsider, sa)
	})
	t.Run("09c_r3c_r3d1_disposition_review", func(t *testing.T) {
		verifyR3CDisposition(t, e, op, sa)
	})
	t.Run("09d_r3d2_parent_child_hierarchy", func(t *testing.T) {
		verifyR3D2Hierarchy(t, e, op, sa)
	})
	t.Run("09e_r3d3_leadership_final_approval", func(t *testing.T) {
		verifyR3D3Leadership(t, e, op, sa)
	})
	t.Run("09f_r4a1_subbagren_usulan_access", func(t *testing.T) {
		verifyR4A1Usulan(t, e, sa)
	})
	t.Run("09g_r4a2_internal_review_consolidation", func(t *testing.T) {
		verifyR4A2ReviewConsolidation(t, e, sa)
	})
	t.Run("09h_r4a3_verified_budget_realization", func(t *testing.T) {
		verifyR4A3Budget(t, e, sa)
	})
	t.Run("09i_r4a3b_private_evidence_reconciliation", func(t *testing.T) { verifyR4A3BProof(t, e, sa) })
	t.Run("10_protected_profile_avatar_and_input_validation", func(t *testing.T) {
		b := e.newBrowser(t)
		r, body := b.call(t, "GET", "/api/v1/auth/profile/avatar", nil, false)
		status(t, r, body, 401)
		r, body = op.call(t, "PATCH", "/api/v1/auth/profile", map[string]any{"displayName": "Operator Test Updated", "phone": "+62 812 3456"}, true)
		status(t, r, body, 200)
		r, body = op.call(t, "PUT", "/api/v1/auth/profile/avatar", []byte("not an image"), true)
		status(t, r, body, 400)
		pic := image.NewRGBA(image.Rect(0, 0, 64, 64))
		for y := 0; y < 64; y++ {
			for x := 0; x < 64; x++ {
				pic.Set(x, y, color.RGBA{R: 80, G: 130, B: 180, A: 255})
			}
		}
		var buf bytes.Buffer
		if err := png.Encode(&buf, pic); err != nil {
			t.Fatal(err)
		}
		r, body = op.call(t, "PUT", "/api/v1/auth/profile/avatar", buf.Bytes(), true)
		status(t, r, body, 204)
		r, body = op.call(t, "GET", "/api/v1/auth/profile/avatar", nil, false)
		status(t, r, body, 200)
		if r.Header.Get("Content-Type") != "image/jpeg" || len(body) == 0 {
			t.Fatal("avatar not private re-encoded jpeg")
		}
		r, body = outsider.call(t, "GET", "/api/v1/auth/profile/avatar", nil, false)
		status(t, r, body, 404)
	})
	t.Run("11_otp_toggle_audit_and_live_session_revocation", func(t *testing.T) {
		target := e.users["op_r2d5"]
		var version int64
		if err := e.db.QueryRow(context.Background(), "SELECT version FROM sdl_users WHERE id=$1", target.id).Scan(&version); err != nil {
			t.Fatal(err)
		}
		body := map[string]any{"enabled": true, "version": version, "reason": "R2D5 validate sensitive change audit", "confirmPassword": fixturePassword}
		r, raw := sa.call(t, "PATCH", "/api/v1/admin/users/"+target.id+"/otp", body, true)
		status(t, r, raw, 200)
		r, raw = op.call(t, "GET", "/api/v1/auth/me", nil, false)
		status(t, r, raw, 401)
		b := e.newBrowser(t)
		b.login(t, "op_r2d5", 503)
		var total int
		err := e.db.QueryRow(context.Background(), `SELECT COUNT(*) FROM sdl_audit_events WHERE event_key='identity.user_otp_policy_changed' AND subject_id=$1`, target.id).Scan(&total)
		if err != nil || total != 1 {
			t.Fatalf("OTP audit event not recorded: %v count %d", err, total)
		}
		// Protected SA policy may return 403 or 409, but must never return 2xx.
		r, raw = sa.call(t, "PATCH", "/api/v1/admin/users/"+e.users["sa_r2d5"].id+"/otp", body, true)
		if r.StatusCode >= 200 && r.StatusCode < 300 {
			t.Fatal("Superadmin OTP was modifiable")
		}
	})
	t.Run("12_logout_and_disabled_account_rejected", func(t *testing.T) {
		r, body := outsider.call(t, "POST", "/api/v1/auth/logout", map[string]any{}, true)
		status(t, r, body, 204)
		r, body = outsider.call(t, "GET", "/api/v1/auth/me", nil, false)
		status(t, r, body, 401)
		b := e.newBrowser(t)
		b.login(t, "disabled_r2d5", 401)
	})
	t.Run("13_unauthorized_mutation_and_no_secret_leak", func(t *testing.T) {
		b := e.newBrowser(t)
		r, body := b.call(t, "POST", "/api/v1/admin/users", map[string]any{"username": "forbidden", "email": "forbidden@test.invalid"}, true)
		status(t, r, body, 401)
		if bytes.Contains(body, []byte(fixturePassword)) || bytes.Contains(body, []byte("password_hash")) {
			t.Fatal("secret leaked")
		}
		var count int
		if err := e.db.QueryRow(context.Background(), `SELECT COUNT(*) FROM sdl_audit_events WHERE event_key='urmin.surat_masuk.created' AND subject_id=$1`, docID).Scan(&count); err != nil || count != 1 {
			t.Fatalf("missing document audit record: %v %d", err, count)
		}
	})
}
