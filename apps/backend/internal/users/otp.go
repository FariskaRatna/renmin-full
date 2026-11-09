package users

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"siera-delta-lima/backend/internal/auth"
)

type otpSettingRequest struct {
	Enabled         bool   `json:"enabled"`
	Version         int64  `json:"version"`
	Reason          string `json:"reason"`
	ConfirmPassword string `json:"confirmPassword"`
}

// Superadmin-only route enforced by router. Re-authentication with the current
// password is mandatory because disabling MFA is a sensitive access change.
func (a *API) updateOTP(w http.ResponseWriter, r *http.Request) {
	var p otpSettingRequest
	if decode(r, &p) != nil || p.Version < 1 || !validReason(p.Reason) || len(p.ConfirmPassword) < 14 || len(p.ConfirmPassword) > 256 {
		reject(w, 400, "invalid_request")
		return
	}
	target := chi.URLParam(r, "userID")
	admin := actor(r.Context())
	if target == admin {
		reject(w, 403, "self_change_denied")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	keyBytes := sha256.Sum256([]byte("otp-admin-confirm:" + admin))
	throttleKey := hex.EncodeToString(keyBytes[:])
	var blocked bool
	if err := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_login_limits WHERE throttle_key=$1 AND locked_until>NOW())`, throttleKey).Scan(&blocked); err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if blocked {
		reject(w, 429, "try_later")
		return
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var hash string
	err = tx.QueryRow(ctx, `SELECT password_hash FROM sdl_users WHERE id=$1 AND is_active=TRUE FOR UPDATE`, admin).Scan(&hash)
	if err != nil {
		reject(w, 403, "access_denied")
		return
	}
	if !auth.VerifyPassword(hash, p.ConfirmPassword) {
		// Persistent throttle independent of rollback of the target-user transaction.
		_, _ = a.DB.Exec(ctx, `INSERT INTO sdl_login_limits(throttle_key,failures,window_started_at,locked_until) VALUES($1,1,NOW(),NULL)
ON CONFLICT(throttle_key) DO UPDATE SET
 failures=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN 1 ELSE LEAST(sdl_login_limits.failures+1,20) END,
 window_started_at=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN NOW() ELSE sdl_login_limits.window_started_at END,
 locked_until=CASE WHEN sdl_login_limits.window_started_at<NOW()-INTERVAL '15 minutes' THEN NULL WHEN sdl_login_limits.failures>=4 THEN NOW()+INTERVAL '15 minutes' ELSE sdl_login_limits.locked_until END`, throttleKey)
		reject(w, 403, "reauthentication_failed")
		return
	}
	var currentVersion int64
	var protected bool
	err = tx.QueryRow(ctx, `SELECT u.version, EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin') FROM sdl_users u WHERE u.id=$1 FOR UPDATE`, target).Scan(&currentVersion, &protected)
	if errors.Is(err, pgx.ErrNoRows) {
		reject(w, 404, "user_missing")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if protected {
		reject(w, 403, "protected_user")
		return
	}
	if currentVersion != p.Version {
		reject(w, 409, "user_changed_reload")
		return
	}
	_, err = tx.Exec(ctx, `UPDATE sdl_users SET otp_enabled=$2,version=version+1,updated_at=NOW() WHERE id=$1`, target, p.Enabled)
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`, target)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE sdl_login_challenges SET consumed_at=NOW() WHERE user_id=$1 AND consumed_at IS NULL`, target)
	}
	if err == nil {
		err = audit(ctx, tx, admin, "identity.user_otp_policy_changed", target, map[string]any{"enabled": p.Enabled, "reason": strings.TrimSpace(p.Reason), "versionBefore": currentVersion})
	}
	if err != nil || tx.Commit(ctx) != nil {
		reject(w, 503, "unavailable")
		return
	}
	_, _ = a.DB.Exec(ctx, `DELETE FROM sdl_login_limits WHERE throttle_key=$1`, throttleKey)
	respond(w, 200, map[string]any{"version": currentVersion + 1, "otpEnabled": p.Enabled})
}
