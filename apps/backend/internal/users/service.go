package users

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/auth"
)

var namePattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{2,63}$`)
var keyPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{2,63}$`)

type API struct{ DB *pgxpool.Pool }
type contextKey struct{}

func WithActor(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, contextKey{}, id)
}
func actor(ctx context.Context) string { id, _ := ctx.Value(contextKey{}).(string); return id }

type Grant struct {
	RoleKey             string     `json:"roleKey"`
	UnitKey             string     `json:"unitKey"`
	Scope               string     `json:"scope"`
	ClassificationLimit string     `json:"classificationLimit"`
	ExpiresAt           *time.Time `json:"expiresAt"`
}
type User struct {
	ID                  string  `json:"id"`
	Username            string  `json:"username"`
	Email               string  `json:"email"`
	DisplayName         string  `json:"displayName"`
	Active              bool    `json:"active"`
	ForcePasswordChange bool    `json:"forcePasswordChange"`
	Version             int64   `json:"version"`
	Protected           bool    `json:"protected"`
	OTPEnabled          bool    `json:"otpEnabled"`
	PrimaryUnit         string  `json:"primaryUnit"`
	Grants              []Grant `json:"grants"`
}
type Unit struct {
	Key    string `json:"key"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}
type createPayload struct {
	Username    string `json:"username"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Reason      string `json:"reason"`
}
type updatePayload struct {
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Active      bool   `json:"active"`
	Version     int64  `json:"version"`
	Reason      string `json:"reason"`
}
type grantPayload struct {
	Version     int64   `json:"version"`
	Reason      string  `json:"reason"`
	PrimaryUnit string  `json:"primaryUnit"`
	Grants      []Grant `json:"grants"`
}

func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func reject(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]string{"error": code})
}
func decode(r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 32768)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	var next any
	if d.Decode(&next) != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}
func validReason(reason string) bool {
	return len([]rune(strings.TrimSpace(reason))) >= 8 && len([]rune(reason)) <= 500
}
func validEmail(e string) bool {
	if len(e) < 6 || len(e) > 254 || e != strings.ToLower(strings.TrimSpace(e)) {
		return false
	}
	a, err := mail.ParseAddress(e)
	return err == nil && a.Address == e && strings.Contains(e, "@")
}
func validName(n string) bool { return len([]rune(strings.TrimSpace(n))) >= 3 && len([]rune(n)) <= 160 }
func isUniqueViolation(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}
func audit(ctx context.Context, tx pgx.Tx, actor, event, subject string, meta any) error {
	b, e := json.Marshal(meta)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,$2,'user',$3,$4::jsonb)`, actor, event, subject, string(b))
	return e
}
func (a *API) Routes(r chi.Router) {
	r.Get("/users", a.list)
	r.Post("/users", a.create)
	r.Patch("/users/{userID}", a.update)
	r.Put("/users/{userID}/access", a.setAccess)
	r.Get("/units", a.units)
	r.Get("/audit", a.auditEvents)
	r.Patch("/users/{userID}/otp", a.updateOTP)
}

func (a *API) list(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := a.DB.Query(ctx, `SELECT u.id::text,u.username,u.email,u.display_name,u.is_active,u.must_change_password,u.version,u.otp_enabled,EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin'),COALESCE((SELECT unit_key FROM sdl_user_units WHERE user_id=u.id AND is_primary LIMIT 1),'') FROM sdl_users u ORDER BY u.created_at DESC LIMIT 500`)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	result := []User{}
	for rows.Next() {
		var u User
		u.Grants = []Grant{}
		if rows.Scan(&u.ID, &u.Username, &u.Email, &u.DisplayName, &u.Active, &u.ForcePasswordChange, &u.Version, &u.OTPEnabled, &u.Protected, &u.PrimaryUnit) != nil {
			reject(w, 503, "unavailable")
			return
		}
		result = append(result, u)
	}
	if rows.Err() != nil {
		reject(w, 503, "unavailable")
		return
	}
	// A grant is never represented as a global role. Return active role-unit-scope tuples.
	for i := range result {
		gr, err := a.DB.Query(ctx, `SELECT g.role_key,g.unit_key,g.scope,g.classification_limit,g.expires_at FROM sdl_access_grants g JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active=TRUE JOIN sdl_org_units un ON un.unit_key=g.unit_key AND un.is_active=TRUE WHERE g.user_id=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW()) ORDER BY g.unit_key,g.role_key`, result[i].ID)
		if err != nil {
			reject(w, 503, "unavailable")
			return
		}
		for gr.Next() {
			var g Grant
			if gr.Scan(&g.RoleKey, &g.UnitKey, &g.Scope, &g.ClassificationLimit, &g.ExpiresAt) != nil {
				gr.Close()
				reject(w, 503, "unavailable")
				return
			}
			result[i].Grants = append(result[i].Grants, g)
		}
		e := gr.Err()
		gr.Close()
		if e != nil {
			reject(w, 503, "unavailable")
			return
		}
	}
	respond(w, 200, map[string]any{"users": result})
}
func (a *API) units(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `SELECT unit_key,display_name,is_active FROM sdl_org_units ORDER BY unit_key`)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	out := []Unit{}
	for rows.Next() {
		var u Unit
		if rows.Scan(&u.Key, &u.Name, &u.Active) != nil {
			reject(w, 503, "unavailable")
			return
		}
		out = append(out, u)
	}
	if rows.Err() != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"units": out})
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var p createPayload
	if decode(r, &p) != nil {
		reject(w, 400, "invalid_request")
		return
	}
	p.Username = strings.ToLower(strings.TrimSpace(p.Username))
	p.Email = strings.ToLower(strings.TrimSpace(p.Email))
	p.DisplayName = strings.TrimSpace(p.DisplayName)
	if !namePattern.MatchString(p.Username) || !validEmail(p.Email) || !validName(p.DisplayName) || !validReason(p.Reason) {
		reject(w, 400, "invalid_input")
		return
	}
	buf := make([]byte, 27)
	if _, err := rand.Read(buf); err != nil {
		reject(w, 503, "unavailable")
		return
	}
	temporary := base64.RawURLEncoding.EncodeToString(buf)
	passwordHash, err := auth.HashPassword(temporary)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 7*time.Second)
	defer cancel()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var userID string
	err = tx.QueryRow(ctx, `INSERT INTO sdl_users(username,email,display_name,password_hash,must_change_password,is_active) VALUES($1,$2,$3,$4,TRUE,TRUE) RETURNING id::text`, p.Username, p.Email, p.DisplayName, passwordHash).Scan(&userID)
	if isUniqueViolation(err) {
		reject(w, 409, "user_exists")
		return
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if err = audit(ctx, tx, actor(ctx), "identity.user_created", userID, map[string]any{"username": p.Username, "reason": strings.TrimSpace(p.Reason), "requiresPasswordChange": true}); err != nil {
		reject(w, 503, "unavailable")
		return
	}
	if tx.Commit(ctx) != nil {
		reject(w, 503, "unavailable")
		return
	}
	// Temporary password is returned ONLY in this no-store response, never persisted or logged in plaintext.
	respond(w, 201, map[string]string{"id": userID, "temporaryPassword": temporary})
}
func (a *API) update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "userID")
	var p updatePayload
	if decode(r, &p) != nil {
		reject(w, 400, "invalid_request")
		return
	}
	p.Email = strings.ToLower(strings.TrimSpace(p.Email))
	p.DisplayName = strings.TrimSpace(p.DisplayName)
	if !validEmail(p.Email) || !validName(p.DisplayName) || p.Version < 1 || !validReason(p.Reason) {
		reject(w, 400, "invalid_input")
		return
	}
	if id == actor(r.Context()) {
		reject(w, 403, "self_change_denied")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var current int64
	var protected bool
	err = tx.QueryRow(ctx, `SELECT u.version,EXISTS(SELECT 1 FROM sdl_user_roles WHERE user_id=u.id AND role_key='superadmin') FROM sdl_users u WHERE u.id=$1 FOR UPDATE`, id).Scan(&current, &protected)
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
	if current != p.Version {
		reject(w, 409, "user_changed_reload")
		return
	}
	_, err = tx.Exec(ctx, `UPDATE sdl_users SET email=$2,display_name=$3,is_active=$4,version=version+1,updated_at=NOW() WHERE id=$1`, id, p.Email, p.DisplayName, p.Active)
	if isUniqueViolation(err) {
		reject(w, 409, "email_exists")
		return
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`, id)
	}
	if err == nil {
		err = audit(ctx, tx, actor(ctx), "identity.user_updated", id, map[string]any{"active": p.Active, "reason": strings.TrimSpace(p.Reason), "versionBefore": current})
	}
	if err != nil || tx.Commit(ctx) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"version": current + 1})
}
func validateGrants(in []Grant) bool {
	if len(in) > 30 {
		return false
	}
	seen := map[string]bool{}
	for _, g := range in {
		if !keyPattern.MatchString(g.RoleKey) || !namePattern.MatchString(g.UnitKey) {
			return false
		}
		if g.RoleKey == "superadmin" || (g.Scope != "own" && g.Scope != "assigned" && g.Scope != "unit") || (g.ClassificationLimit != "biasa" && g.ClassificationLimit != "penting") {
			return false
		}
		if g.ExpiresAt != nil && !g.ExpiresAt.After(time.Now().Add(time.Minute)) {
			return false
		}
		k := g.UnitKey + ":" + g.RoleKey
		if seen[k] {
			return false
		}
		seen[k] = true
	}
	return true
}
func (a *API) setAccess(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "userID")
	var p grantPayload
	if decode(r, &p) != nil {
		reject(w, 400, "invalid_request")
		return
	}
	if id == actor(r.Context()) {
		reject(w, 403, "self_change_denied")
		return
	}
	if p.Version < 1 || !validReason(p.Reason) || !validateGrants(p.Grants) {
		reject(w, 400, "invalid_grants")
		return
	}
	if len(p.Grants) > 0 && p.PrimaryUnit == "" {
		reject(w, 400, "primary_unit_required")
		return
	}
	if len(p.Grants) == 0 && p.PrimaryUnit != "" {
		reject(w, 400, "invalid_primary_unit")
		return
	}
	hasPrimary := len(p.Grants) == 0
	for _, g := range p.Grants {
		if g.UnitKey == p.PrimaryUnit {
			hasPrimary = true
		}
	}
	if !hasPrimary {
		reject(w, 400, "primary_unit_not_assigned")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var version int64
	var protected bool
	err = tx.QueryRow(ctx, `SELECT u.version,EXISTS(SELECT 1 FROM sdl_user_roles WHERE user_id=u.id AND role_key='superadmin') FROM sdl_users u WHERE u.id=$1 FOR UPDATE`, id).Scan(&version, &protected)
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
	if p.Version != version {
		reject(w, 409, "user_changed_reload")
		return
	}
	// No identity/audit administrative power may be distributed in this phase.
	for _, g := range p.Grants {
		var safe bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_roles ro JOIN sdl_org_units un ON un.unit_key=$2 AND un.is_active=TRUE WHERE ro.role_key=$1 AND ro.is_active=TRUE AND ro.role_key<>'superadmin' AND NOT EXISTS(SELECT 1 FROM sdl_role_permissions rp WHERE rp.role_key=ro.role_key AND (rp.permission_key LIKE 'identity.%' OR rp.permission_key LIKE 'audit.%')))`, g.RoleKey, g.UnitKey).Scan(&safe)
		if err != nil {
			reject(w, 503, "unavailable")
			return
		}
		if !safe {
			reject(w, 400, "privileged_or_inactive_role")
			return
		}
	}
	// Preserve history by revoking old grants, not deleting them.
	_, err = tx.Exec(ctx, `UPDATE sdl_access_grants SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`, id)
	if err == nil {
		_, err = tx.Exec(ctx, `DELETE FROM sdl_user_units WHERE user_id=$1`, id)
	}
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	seenUnit := map[string]bool{}
	for _, g := range p.Grants {
		if !seenUnit[g.UnitKey] {
			_, err = tx.Exec(ctx, `INSERT INTO sdl_user_units(user_id,unit_key,is_primary) VALUES($1,$2,$3)`, id, g.UnitKey, g.UnitKey == p.PrimaryUnit)
			if err != nil {
				break
			}
			seenUnit[g.UnitKey] = true
		}
		_, err = tx.Exec(ctx, `INSERT INTO sdl_access_grants(user_id,role_key,unit_key,scope,classification_limit,expires_at,grant_reason,granted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, g.RoleKey, g.UnitKey, g.Scope, g.ClassificationLimit, g.ExpiresAt, strings.TrimSpace(p.Reason), actor(ctx))
		if err != nil {
			break
		}
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE sdl_users SET version=version+1,updated_at=NOW() WHERE id=$1`, id)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`, id)
	}
	if err == nil {
		err = audit(ctx, tx, actor(ctx), "identity.user_access_changed", id, map[string]any{"reason": strings.TrimSpace(p.Reason), "grants": p.Grants, "primaryUnit": p.PrimaryUnit, "versionBefore": version})
	}
	if err != nil || tx.Commit(ctx) != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"version": version + 1})
}
func (a *API) auditEvents(w http.ResponseWriter, r *http.Request) {
	// Only this protected admin router exposes audit previews; sanitized metadata is not copied into UI.
	rows, err := a.DB.Query(r.Context(), `SELECT ev.id,ev.event_key,COALESCE(ev.subject_type,''),COALESCE(ev.subject_id,''),ev.created_at,COALESCE(au.username,'system'),LEFT(COALESCE(ev.metadata->>'reason',''),500) FROM sdl_audit_events ev LEFT JOIN sdl_users au ON au.id=ev.actor_id ORDER BY ev.id DESC LIMIT 100`)
	if err != nil {
		reject(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	type event struct {
		ID      int64     `json:"id"`
		Key     string    `json:"key"`
		Type    string    `json:"type"`
		Subject string    `json:"subject"`
		At      time.Time `json:"at"`
		Actor   string    `json:"actor"`
		Reason  string    `json:"reason"`
	}
	out := []event{}
	for rows.Next() {
		var e event
		if rows.Scan(&e.ID, &e.Key, &e.Type, &e.Subject, &e.At, &e.Actor, &e.Reason) != nil {
			reject(w, 503, "unavailable")
			return
		}
		out = append(out, e)
	}
	if rows.Err() != nil {
		reject(w, 503, "unavailable")
		return
	}
	respond(w, 200, map[string]any{"events": out})
}
