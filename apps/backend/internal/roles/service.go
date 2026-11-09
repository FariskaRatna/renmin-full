package roles

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxBody = 16384

var roleKeyRx = regexp.MustCompile(`^[a-z][a-z0-9_.-]{2,63}$`)
var permissionKeyRx = regexp.MustCompile(`^[a-z][a-z0-9_.-]{2,99}$`)

// This capability cannot be delegated from this editor. It is reserved for
// the immutable Superadmin definition and cannot be removed from it.
const sealedPermission = "identity.roles.manage"

type API struct{ DB *pgxpool.Pool }
type Role struct {
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	System      bool     `json:"system"`
	Active      bool     `json:"active"`
	Version     int64    `json:"version"`
	Permissions []string `json:"permissions"`
}
type Permission struct {
	Key         string `json:"key"`
	Description string `json:"description"`
}
type rolePayload struct {
	Reason      string   `json:"reason"`
	Key         string   `json:"key"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Active      bool     `json:"active"`
	Version     int64    `json:"version"`
	Permissions []string `json:"permissions"`
}
type contextActorKey struct{}

func Actor(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(contextActorKey{}).(string)
	return id, ok
}
func WithActor(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, contextActorKey{}, id)
}
func errJSON(w http.ResponseWriter, status int, code string) {
	jsonOut(w, status, map[string]string{"error": code})
}
func jsonOut(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func decode(r *http.Request, out *rolePayload) error {
	r.Body = http.MaxBytesReader(nil, r.Body, maxBody)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return err
	}
	var more any
	if err := d.Decode(&more); err != io.EOF {
		return errors.New("unexpected trailing JSON")
	}
	return nil
}
func validate(p rolePayload, creating bool) (string, []string, bool) {
	if creating && !roleKeyRx.MatchString(p.Key) {
		return "invalid_role_key", nil, false
	}
	if len(strings.TrimSpace(p.Name)) < 3 || len([]rune(p.Name)) > 120 || len([]rune(p.Description)) > 500 || len(strings.TrimSpace(p.Reason)) < 8 || len([]rune(p.Reason)) > 500 {
		return "invalid_metadata", nil, false
	}
	if len(p.Permissions) > 200 {
		return "too_many_permissions", nil, false
	}
	keys := append([]string{}, p.Permissions...)
	slices.Sort(keys)
	for i, k := range keys {
		if !permissionKeyRx.MatchString(k) || k == sealedPermission {
			return "reserved_or_invalid_permission", nil, false
		}
		if i > 0 && k == keys[i-1] {
			return "duplicate_permission", nil, false
		}
	}
	if !creating && p.Version < 1 {
		return "missing_version", nil, false
	}
	return "", keys, true
}
func (a *API) Routes(r chi.Router) {
	r.Get("/permissions", a.permissions)
	r.Get("/roles", a.list)
	r.Post("/roles", a.create)
	r.Put("/roles/{roleKey}", a.update)
}
func (a *API) permissions(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), "SELECT permission_key,description FROM sdl_permissions ORDER BY permission_key")
	if err != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	result := []Permission{}
	for rows.Next() {
		var p Permission
		if rows.Scan(&p.Key, &p.Description) != nil {
			errJSON(w, 503, "unavailable")
			return
		}
		result = append(result, p)
	}
	if rows.Err() != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	jsonOut(w, 200, map[string]any{"permissions": result})
}
func (a *API) list(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `SELECT ro.role_key,ro.display_name,ro.description,ro.is_system,ro.is_active,ro.version,
 COALESCE(array_agg(rp.permission_key::text ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL),'{}'::text[])
 FROM sdl_roles ro LEFT JOIN sdl_role_permissions rp ON rp.role_key=ro.role_key
 GROUP BY ro.role_key ORDER BY ro.is_system DESC,ro.role_key`)
	if err != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	result := []Role{}
	for rows.Next() {
		var x Role
		if err := rows.Scan(&x.Key, &x.Name, &x.Description, &x.System, &x.Active, &x.Version, &x.Permissions); err != nil {
			errJSON(w, 503, "unavailable")
			return
		}
		result = append(result, x)
	}
	if rows.Err() != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	jsonOut(w, 200, map[string]any{"roles": result})
}
func knownPermissions(ctx context.Context, tx pgx.Tx, perms []string) error {
	if len(perms) == 0 {
		return nil
	}
	var count int
	err := tx.QueryRow(ctx, "SELECT count(*) FROM sdl_permissions WHERE permission_key=ANY($1::text[])", perms).Scan(&count)
	if err != nil {
		return err
	}
	if count != len(perms) {
		return errors.New("unknown permission")
	}
	return nil
}
func addPermissions(ctx context.Context, tx pgx.Tx, key string, perms []string) error {
	for _, p := range perms {
		if _, err := tx.Exec(ctx, "INSERT INTO sdl_role_permissions(role_key,permission_key) VALUES($1,$2)", key, p); err != nil {
			return err
		}
	}
	return nil
}
func writeAudit(ctx context.Context, tx pgx.Tx, actor, event, role string, metadata any) error {
	payload, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata)
 VALUES($1,$2,'role',$3,$4::jsonb)`, actor, event, role, string(payload))
	return err
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var p rolePayload
	if decode(r, &p) != nil {
		errJSON(w, 400, "invalid_request")
		return
	}
	code, keys, ok := validate(p, true)
	if !ok {
		errJSON(w, 400, code)
		return
	}
	actor, ok := Actor(r.Context())
	if !ok {
		errJSON(w, 401, "unauthenticated")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	if err = knownPermissions(ctx, tx, keys); err != nil {
		errJSON(w, 400, "unknown_permission")
		return
	}
	_, err = tx.Exec(ctx, `INSERT INTO sdl_roles(role_key,display_name,description,is_active,updated_by)
 VALUES($1,$2,$3,$4,$5)`, p.Key, strings.TrimSpace(p.Name), strings.TrimSpace(p.Description), p.Active, actor)
	if err != nil {
		if isDuplicate(err) {
			errJSON(w, 409, "role_exists")
		} else {
			errJSON(w, 503, "unavailable")
		}
		return
	}
	if err = addPermissions(ctx, tx, p.Key, keys); err == nil {
		err = writeAudit(ctx, tx, actor, "identity.role_created", p.Key, map[string]any{"name": p.Name, "permissions": keys, "active": p.Active, "reason": strings.TrimSpace(p.Reason)})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	jsonOut(w, 201, map[string]any{"key": p.Key, "version": 1})
}
func (a *API) update(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "roleKey")
	if !roleKeyRx.MatchString(key) {
		errJSON(w, 400, "invalid_role_key")
		return
	}
	if key == "superadmin" {
		errJSON(w, 403, "protected_system_role")
		return
	}
	var p rolePayload
	if decode(r, &p) != nil {
		errJSON(w, 400, "invalid_request")
		return
	}
	code, keys, ok := validate(p, false)
	if !ok {
		errJSON(w, 400, code)
		return
	}
	if p.Key != "" && p.Key != key {
		errJSON(w, 400, "immutable_role_key")
		return
	}
	actor, ok := Actor(r.Context())
	if !ok {
		errJSON(w, 401, "unauthenticated")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var version int64
	err = tx.QueryRow(ctx, "SELECT version FROM sdl_roles WHERE role_key=$1 FOR UPDATE", key).Scan(&version)
	if errors.Is(err, pgx.ErrNoRows) {
		errJSON(w, 404, "role_missing")
		return
	}
	if err != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	if version != p.Version {
		errJSON(w, 409, "role_changed_reload")
		return
	}
	if err = knownPermissions(ctx, tx, keys); err != nil {
		errJSON(w, 400, "unknown_permission")
		return
	}
	var before []string
	err = tx.QueryRow(ctx, `SELECT COALESCE(array_agg(permission_key::text ORDER BY permission_key),'{}'::text[]) FROM sdl_role_permissions WHERE role_key=$1`, key).Scan(&before)
	if err != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	_, err = tx.Exec(ctx, `UPDATE sdl_roles SET display_name=$2,description=$3,is_active=$4,version=version+1,updated_at=NOW(),updated_by=$5 WHERE role_key=$1`, key, strings.TrimSpace(p.Name), strings.TrimSpace(p.Description), p.Active, actor)
	if err == nil {
		_, err = tx.Exec(ctx, "DELETE FROM sdl_role_permissions WHERE role_key=$1", key)
	}
	if err == nil {
		err = addPermissions(ctx, tx, key, keys)
	}
	if err == nil {
		err = writeAudit(ctx, tx, actor, "identity.role_updated", key, map[string]any{"versionBefore": version, "permissionsBefore": before, "permissionsAfter": keys, "active": p.Active, "reason": strings.TrimSpace(p.Reason)})
	}
	// Role policy is re-evaluated from DB on requests. Clear old sessions for any
	// account affected by this permission change (except acting Superadmin).
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE sdl_sessions SET revoked_at=NOW() WHERE revoked_at IS NULL
 AND user_id IN (SELECT user_id FROM sdl_user_roles WHERE role_key=$1 UNION SELECT user_id FROM sdl_access_grants WHERE role_key=$1 AND revoked_at IS NULL) AND user_id<>$2`, key, actor)
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		errJSON(w, 503, "unavailable")
		return
	}
	jsonOut(w, 200, map[string]any{"key": key, "version": version + 1})
}
