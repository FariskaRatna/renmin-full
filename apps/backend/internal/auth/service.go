package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/devdemo"
)

const (
	sessionCookie   = "sdl_session"
	csrfCookie      = "sdl_csrf"
	otpLifetime     = 5 * time.Minute
	sessionLifetime = 8 * time.Hour
)

type Config struct {
	Secret         []byte
	SecureCookie   bool
	AllowedOrigins []string
	Mailer         Mailer
}
type Service struct {
	db      *pgxpool.Pool
	secret  []byte
	secure  bool
	origins map[string]bool
	mailer  Mailer
}

func New(db *pgxpool.Pool, c Config) (*Service, error) {
	if db == nil || len(c.Secret) < 32 {
		return nil, errors.New("auth database or HMAC secret missing")
	}
	if len(c.AllowedOrigins) == 0 {
		return nil, errors.New("allowed origins missing")
	}
	origins := make(map[string]bool)
	for _, o := range c.AllowedOrigins {
		origins[o] = true
	}
	return &Service{db: db, secret: c.Secret, secure: c.SecureCookie, origins: origins, mailer: c.Mailer}, nil
}

func newRandom(size int) (string, error) {
	raw := make([]byte, size)
	_, err := rand.Read(raw)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}
func (s *Service) signature(purpose, value string) string {
	m := hmac.New(sha256.New, s.secret)
	m.Write([]byte(purpose))
	m.Write([]byte{0})
	m.Write([]byte(value))
	return hex.EncodeToString(m.Sum(nil))
}
func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func write(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func problem(w http.ResponseWriter, status int, code string) {
	write(w, status, map[string]string{"error": code})
}
func readPayload(r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 4096)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return errors.New("additional data or malformed JSON")
	}
	return nil
}
func (s *Service) cookie(w http.ResponseWriter, name, value string, httpOnly bool, expires time.Duration) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: httpOnly, Secure: s.secure, SameSite: http.SameSiteStrictMode, MaxAge: int(expires.Seconds())})
}
func (s *Service) clearCookie(w http.ResponseWriter, name string, httpOnly bool) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: "", Path: "/", HttpOnly: httpOnly, Secure: s.secure, SameSite: http.SameSiteStrictMode, MaxAge: -1})
}
func (s *Service) allowMutation(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if !s.origins[origin] {
		return false
	}
	c, err := r.Cookie(csrfCookie)
	if err != nil {
		return false
	}
	supplied := r.Header.Get("X-CSRF-Token")
	if len(c.Value) < 24 || len(c.Value) > 128 || len(c.Value) != len(supplied) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(c.Value), []byte(supplied)) == 1
}
func (s *Service) csrf(w http.ResponseWriter, _ *http.Request) {
	token, err := newRandom(32)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	s.cookie(w, csrfCookie, token, false, time.Hour)
	write(w, 200, map[string]string{"csrfToken": token})
}
func (s *Service) bootstrapStatus(w http.ResponseWriter, r *http.Request) {
	var configured bool
	err := s.db.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM sdl_user_roles WHERE role_key='superadmin')").Scan(&configured)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	write(w, 200, map[string]bool{"hasSuperadmin": configured, "smtpConfigured": s.mailer.Ready()})
}
func (s *Service) wrapMutation(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.allowMutation(r) {
			problem(w, 403, "csrf_invalid")
			return
		}
		h(w, r)
	}
}

func (s *Service) Routes(r chi.Router) {
	r.Get("/csrf", s.csrf)
	r.Get("/bootstrap-status", s.bootstrapStatus)
	r.Get("/captcha", s.captchaGet)
	r.Post("/login", s.wrapMutation(s.login))
	r.Post("/verify-otp", s.wrapMutation(s.verifyOTP))
	r.Get("/me", s.me)
	r.Post("/logout", s.wrapMutation(s.logout))
	r.Post("/change-password", s.wrapMutation(s.changePassword))
	r.Get("/profile", s.profileGet)
	r.Patch("/profile", s.wrapMutation(s.profileUpdate))
	r.Get("/profile/avatar", s.profileAvatarGet)
	r.Put("/profile/avatar", s.wrapMutation(s.profileAvatarUpload))
	r.Delete("/profile/avatar", s.wrapMutation(s.profileAvatarDelete))
	r.Post("/profile/email/start", s.wrapMutation(s.emailChangeStart))
	r.Post("/profile/email/verify", s.wrapMutation(s.emailChangeVerify))
}

type credentials struct {
	Username string            `json:"username"`
	Password string            `json:"password"`
	Captcha  captchaSubmission `json:"captcha"`
}
type otpPayload struct {
	Challenge string `json:"challenge"`
	Code      string `json:"code"`
}

func (s *Service) throttleKeys(r *http.Request, login string) []string {
	remote, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remote = r.RemoteAddr
	}
	return []string{s.signature("limit-user", strings.ToLower(login)), s.signature("limit-ip", remote)}
}
func (s *Service) locked(ctx context.Context, keys []string) (bool, error) {
	var count int
	err := s.db.QueryRow(ctx, `SELECT COUNT(*) FROM sdl_login_limits WHERE throttle_key=ANY($1::char(64)[]) AND locked_until>NOW()`, keys).Scan(&count)
	return count > 0, err
}
func (s *Service) fail(ctx context.Context, keys []string) {
	for _, key := range keys {
		_, _ = s.db.Exec(ctx, `INSERT INTO sdl_login_limits(throttle_key,failures,window_started_at,locked_until) VALUES($1,1,NOW(),NULL) ON CONFLICT(throttle_key) DO UPDATE SET failures=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE LEAST(sdl_login_limits.failures+1,20) END,window_started_at=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN NOW() ELSE sdl_login_limits.window_started_at END,locked_until=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN NULL WHEN sdl_login_limits.failures>=4 THEN NOW()+INTERVAL '15 minutes' ELSE sdl_login_limits.locked_until END`, key)
	}
}
func (s *Service) clearFailures(ctx context.Context, keys []string) {
	_, _ = s.db.Exec(ctx, "DELETE FROM sdl_login_limits WHERE throttle_key=ANY($1::char(64)[])", keys)
}
func (s *Service) login(w http.ResponseWriter, r *http.Request) {
	var body credentials
	if err := readPayload(r, &body); err != nil || len(body.Username) < 3 || len(body.Username) > 254 || len(body.Password) > 256 || len(body.Password) == 0 {
		problem(w, 400, "invalid_request")
		return
	}
	// A new, solved, single-use local CAPTCHA is mandatory for each login attempt.
	verified, captchaErr := s.consumeCaptcha(r.Context(), r, body.Captcha)
	if captchaErr != nil {
		problem(w, 503, "unavailable")
		return
	}
	if !verified {
		problem(w, 403, "captcha_invalid")
		return
	}
	login := strings.ToLower(strings.TrimSpace(body.Username))
	keys := s.throttleKeys(r, login)
	locked, err := s.locked(r.Context(), keys)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if locked {
		problem(w, 429, "try_later")
		return
	}
	var userID, email, hash string
	var active, otpEnabled, isSuperadmin bool
	err = s.db.QueryRow(r.Context(), `SELECT u.id::text,u.email,u.password_hash,u.is_active,u.otp_enabled,
EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
FROM sdl_users u WHERE lower(u.username)=$1 OR lower(u.email)=$1 LIMIT 1`, login).Scan(&userID, &email, &hash, &active, &otpEnabled, &isSuperadmin)
	// Use an expensive dummy hash when username is unknown to minimize account discovery timing.
	if errors.Is(err, pgx.ErrNoRows) {
		_, _ = HashPassword("sdl-dummy-password-with-sufficient-length")
		s.fail(r.Context(), keys)
		problem(w, 401, "invalid_credentials")
		return
	}
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if !VerifyPassword(hash, body.Password) || !active {
		s.fail(r.Context(), keys)
		problem(w, 401, "invalid_credentials")
		return
	}
	if !mustUseOTP(otpEnabled, isSuperadmin) {
		// Password-only sessions are allowed ONLY by explicit per-user non-admin policy.
		token, tokenErr := newRandom(32)
		if tokenErr != nil {
			problem(w, 503, "unavailable")
			return
		}
		tx, txErr := s.db.Begin(r.Context())
		if txErr != nil {
			problem(w, 503, "unavailable")
			return
		}
		defer tx.Rollback(r.Context())
		// Prevent a race with an administrator switching OTP back ON.
		var currentEnabled, currentSuperadmin, currentActive bool
		txErr = tx.QueryRow(r.Context(), `SELECT u.otp_enabled,u.is_active,
EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin')
FROM sdl_users u WHERE u.id=$1 FOR SHARE`, userID).Scan(&currentEnabled, &currentActive, &currentSuperadmin)
		if txErr != nil {
			problem(w, 503, "unavailable")
			return
		}
		if !currentActive || mustUseOTP(currentEnabled, currentSuperadmin) {
			problem(w, 403, "policy_changed_retry_login")
			return
		}
		_, txErr = tx.Exec(r.Context(), "INSERT INTO sdl_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '8 hours')", tokenHash(token), userID)
		if txErr == nil {
			_, txErr = tx.Exec(r.Context(), "INSERT INTO sdl_audit_events(actor_id,event_key) VALUES($1,'auth.login_without_otp')", userID)
		}
		if txErr != nil || tx.Commit(r.Context()) != nil {
			problem(w, 503, "unavailable")
			return
		}
		s.clearFailures(r.Context(), keys)
		s.cookie(w, sessionCookie, token, true, sessionLifetime)
		write(w, 200, map[string]any{"authenticated": true, "otpRequired": false})
		return
	}
	otpKeys := []string{s.signature("otp-send-user", userID), s.signature("otp-send-peer", keys[1])}
	sendLocked, lockErr := s.locked(r.Context(), otpKeys)
	if lockErr != nil {
		problem(w, 503, "unavailable")
		return
	}
	if sendLocked {
		problem(w, 429, "try_later")
		return
	}
	if !s.mailer.Ready() {
		problem(w, 503, "email_delivery_unavailable")
		return
	}
	challenge, err := newRandom(32)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	codeRand := make([]byte, 4)
	if _, err = rand.Read(codeRand); err != nil {
		problem(w, 503, "unavailable")
		return
	}
	num := uint32(codeRand[0])<<24 | uint32(codeRand[1])<<16 | uint32(codeRand[2])<<8 | uint32(codeRand[3])
	code := fmt.Sprintf("%06d", num%1000000)
	digest := s.signature("otp", challenge+":"+code)
	challengeHash := s.signature("challenge", challenge)
	// Transactionally invalidate earlier pending challenges for this account.
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	_, err = tx.Exec(r.Context(), "UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL", userID)
	if err == nil {
		_, err = tx.Exec(r.Context(), "INSERT INTO sdl_login_challenges(challenge_hash,user_id,otp_code_hash,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes')", challengeHash, userID, digest)
	}
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if err = s.mailer.SendOTP(r.Context(), email, code); err != nil {
		_, _ = s.db.Exec(r.Context(), "UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE challenge_hash=$1", challengeHash)
		_, _ = s.db.Exec(r.Context(), "INSERT INTO sdl_audit_events(actor_id,event_key) VALUES($1,'auth.otp_delivery_failed')", userID)
		problem(w, 503, "email_delivery_unavailable")
		return
	}
	s.clearFailures(r.Context(), keys)
	s.fail(r.Context(), otpKeys) // limits repeated email OTP issuance, even with a valid password
	_, _ = s.db.Exec(r.Context(), "INSERT INTO sdl_audit_events(actor_id,event_key) VALUES($1,'auth.otp_requested')", userID)
	write(w, 200, map[string]any{"challenge": challenge, "otpRequired": true, "expiresInSeconds": 300})
}

// Superadmin OTP remains mandatory regardless of any database policy value.
func mustUseOTP(enabled, isSuperadmin bool) bool { return isSuperadmin || enabled }

func (s *Service) verifyOTP(w http.ResponseWriter, r *http.Request) {
	var body otpPayload
	if err := readPayload(r, &body); err != nil || len(body.Challenge) != 43 || len(body.Code) != 6 {
		problem(w, 400, "invalid_request")
		return
	}
	for _, c := range body.Code {
		if c < '0' || c > '9' {
			problem(w, 400, "invalid_request")
			return
		}
	}
	tx, err := s.db.Begin(r.Context())
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(r.Context())
	var userID, codeHash string
	var attempts int
	var expires time.Time
	var consumed *time.Time
	err = tx.QueryRow(r.Context(), `SELECT user_id::text,otp_code_hash,attempts,expires_at,consumed_at FROM sdl_login_challenges WHERE challenge_hash=$1 FOR UPDATE`, s.signature("challenge", body.Challenge)).Scan(&userID, &codeHash, &attempts, &expires, &consumed)
	if err != nil {
		problem(w, 401, "invalid_otp")
		return
	}
	if consumed != nil || !time.Now().Before(expires) || attempts >= 5 {
		problem(w, 401, "invalid_otp")
		return
	}
	expected := s.signature("otp", body.Challenge+":"+body.Code)
	if subtle.ConstantTimeCompare([]byte(expected), []byte(codeHash)) != 1 {
		_, _ = tx.Exec(r.Context(), "UPDATE sdl_login_challenges SET attempts=LEAST(attempts+1,5) WHERE challenge_hash=$1", s.signature("challenge", body.Challenge))
		_ = tx.Commit(r.Context())
		problem(w, 401, "invalid_otp")
		return
	}
	var active bool
	err = tx.QueryRow(r.Context(), "SELECT is_active FROM sdl_users WHERE id=$1 FOR UPDATE", userID).Scan(&active)
	if err != nil || !active {
		problem(w, 401, "invalid_otp")
		return
	}
	token, err := newRandom(32)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	_, err = tx.Exec(r.Context(), "UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE challenge_hash=$1", s.signature("challenge", body.Challenge))
	if err == nil {
		_, err = tx.Exec(r.Context(), "INSERT INTO sdl_sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '8 hours')", tokenHash(token), userID)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), "INSERT INTO sdl_audit_events(actor_id,event_key) VALUES($1,'auth.login_success')", userID)
	}
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		problem(w, 503, "unavailable")
		return
	}
	s.cookie(w, sessionCookie, token, true, sessionLifetime)
	write(w, 200, map[string]any{"authenticated": true})
}
func (s *Service) currentUser(r *http.Request) (string, error) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || len(c.Value) != 43 {
		return "", errors.New("missing session")
	}
	var userID string
	err = s.db.QueryRow(r.Context(), `SELECT u.id::text FROM sdl_sessions sess JOIN sdl_users u ON u.id=sess.user_id WHERE sess.token_hash=$1 AND sess.expires_at>NOW() AND sess.revoked_at IS NULL AND u.is_active=TRUE`, tokenHash(c.Value)).Scan(&userID)
	return userID, err
}
func (s *Service) me(w http.ResponseWriter, r *http.Request) {
	id, err := s.currentUser(r)
	if err != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	var username, email, name string
	var roles, units []string
	var mustChange bool
	err = s.db.QueryRow(r.Context(), `SELECT username,email,display_name,must_change_password,
 ARRAY(SELECT role_key FROM sdl_user_roles WHERE user_id=$1 UNION SELECT g.role_key FROM sdl_access_grants g JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active=TRUE WHERE g.user_id=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW()) ORDER BY role_key),
 ARRAY(SELECT DISTINCT g.unit_key FROM sdl_access_grants g JOIN sdl_org_units un ON un.unit_key=g.unit_key AND un.is_active=TRUE WHERE g.user_id=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW()) ORDER BY g.unit_key)
 FROM sdl_users WHERE id=$1`, id).Scan(&username, &email, &name, &mustChange, &roles, &units)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	write(w, 200, map[string]any{"id": id, "username": username, "email": email, "displayName": name, "roles": roles, "units": units, "mustChangePassword": mustChange})
}
func (s *Service) logout(w http.ResponseWriter, r *http.Request) {
	id, err := s.currentUser(r)
	if err == nil {
		c, _ := r.Cookie(sessionCookie)
		_, err = s.db.Exec(r.Context(), "UPDATE sdl_sessions SET revoked_at=NOW() WHERE token_hash=$1 AND revoked_at IS NULL", tokenHash(c.Value))
		if err == nil {
			_, _ = s.db.Exec(r.Context(), "INSERT INTO sdl_audit_events(actor_id,event_key) VALUES($1,'auth.logout')", id)
		}
	}
	s.clearCookie(w, sessionCookie, true)
	if err != nil && id != "" {
		problem(w, 503, "unavailable")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// AuthorizeRoleEditor enforces authentication, CSRF/origin on mutations, and
// explicit database-backed Superadmin + role-management permission per request.
// Merely being authenticated or having a frontend menu is never sufficient.
func (s *Service) AuthorizeRoleEditor(r *http.Request) (string, int) {
	id, err := s.currentUser(r)
	if err != nil {
		return "", http.StatusUnauthorized
	}
	if r.Method != http.MethodGet && !s.allowMutation(r) {
		return "", http.StatusForbidden
	}
	var allowed bool
	err = s.db.QueryRow(r.Context(), `SELECT (NOT u.must_change_password) AND EXISTS (
  SELECT 1 FROM sdl_user_roles ur
  JOIN sdl_roles ro ON ro.role_key=ur.role_key AND ro.is_active=TRUE
  JOIN sdl_role_permissions rp ON rp.role_key=ur.role_key
  WHERE ur.user_id=$1 AND ur.role_key='superadmin' AND rp.permission_key='identity.roles.manage'
 ) FROM sdl_users u WHERE u.id=$1`, id).Scan(&allowed)
	if err != nil {
		return "", http.StatusServiceUnavailable
	}
	if !allowed {
		return "", http.StatusForbidden
	}
	return id, http.StatusOK
}

// AuthorizeOperational authenticates an account and rejects Superadmin before
// any operational handler can access resource data. Mutations also require
// Origin+CSRF. Object-level grants are checked independently per document.
func (s *Service) AuthorizeOperational(r *http.Request) (string, int) {
	id, err := s.currentUser(r)
	if err != nil {
		return "", http.StatusUnauthorized
	}
	if r.Method != http.MethodGet && !s.allowMutation(r) {
		return "", http.StatusForbidden
	}
	var eligible bool
	err = s.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM sdl_users u
        WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
        AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin'))`, id).Scan(&eligible)
	if err != nil {
		return "", http.StatusServiceUnavailable
	}
	if !eligible {
		// Local, opt-in demonstration workspace. Never enabled for production.
		demo, err := devdemo.Superadmin(r.Context(), s.db, id)
		if err != nil {
			return "", http.StatusServiceUnavailable
		}
		if !demo {
			return "", http.StatusForbidden
		}
	}
	return id, http.StatusOK
}

// Force first-login rotation of administrator-created temporary credentials.
func (s *Service) changePassword(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if readPayload(r, &p) != nil || len(p.New) < 14 || len(p.New) > 256 || p.New == p.Current {
		problem(w, 400, "invalid_request")
		return
	}
	id, err := s.currentUser(r)
	if err != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	key := s.signature("password-change-user", id)
	locked, err := s.locked(r.Context(), []string{key})
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	if locked {
		problem(w, 429, "try_later")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	tx, err := s.db.Begin(ctx)
	if err != nil {
		problem(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var stored string
	if tx.QueryRow(ctx, `SELECT password_hash FROM sdl_users WHERE id=$1 AND is_active=TRUE FOR UPDATE`, id).Scan(&stored) != nil {
		problem(w, 401, "unauthenticated")
		return
	}
	if !VerifyPassword(stored, p.Current) {
		s.fail(ctx, []string{key})
		problem(w, 401, "invalid_credentials")
		return
	}
	hash, err := HashPassword(p.New)
	if err != nil {
		problem(w, 400, "invalid_new_password")
		return
	}
	_, err = tx.Exec(ctx, `UPDATE sdl_users SET password_hash=$2,must_change_password=FALSE,password_changed_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1`, id, hash)
	if err == nil {
		c, _ := r.Cookie(sessionCookie)
		_, err = tx.Exec(ctx, `UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND token_hash<>$2 AND revoked_at IS NULL`, id, tokenHash(c.Value))
	}
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id) VALUES($1,'identity.password_changed','user',$2)`, id, id)
	}
	if err != nil || tx.Commit(ctx) != nil {
		problem(w, 503, "unavailable")
		return
	}
	s.clearFailures(ctx, []string{key})
	w.WriteHeader(http.StatusNoContent)
}
