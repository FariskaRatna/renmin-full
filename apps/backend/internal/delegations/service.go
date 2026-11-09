package delegations

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"siera-delta-lima/backend/internal/roles"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type API struct{ DB *pgxpool.Pool }
type Candidate struct {
	ID                  string     `json:"id"`
	GrantorID           string     `json:"grantorId"`
	GrantorName         string     `json:"grantorName"`
	RoleKey             string     `json:"roleKey"`
	UnitKey             string     `json:"unitKey"`
	ClassificationLimit string     `json:"classificationLimit"`
	ExpiresAt           *time.Time `json:"expiresAt"`
	Permissions         []string   `json:"permissions"`
}
type Row struct {
	ID                  string     `json:"id"`
	GrantorName         string     `json:"grantorName"`
	GranteeName         string     `json:"granteeName"`
	RoleKey             string     `json:"roleKey"`
	UnitKey             string     `json:"unitKey"`
	Scope               string     `json:"scope"`
	ClassificationLimit string     `json:"classificationLimit"`
	Permissions         []string   `json:"permissions"`
	Reason              string     `json:"reason"`
	CreatedAt           time.Time  `json:"createdAt"`
	ExpiresAt           time.Time  `json:"expiresAt"`
	RevokedAt           *time.Time `json:"revokedAt"`
	Version             int64      `json:"version"`
}
type createPayload struct {
	SourceGrantID       string    `json:"sourceGrantId"`
	GranteeID           string    `json:"granteeId"`
	Scope               string    `json:"scope"`
	ClassificationLimit string    `json:"classificationLimit"`
	PermissionKeys      []string  `json:"permissionKeys"`
	ExpiresAt           time.Time `json:"expiresAt"`
	Reason              string    `json:"reason"`
}
type revokePayload struct {
	Version int64  `json:"version"`
	Reason  string `json:"reason"`
}

func send(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func deny(w http.ResponseWriter, code int, msg string) {
	send(w, code, map[string]string{"error": msg})
}
func parse(w http.ResponseWriter, r *http.Request, v any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 32768)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	var more any
	if dec.Decode(&more) != io.EOF {
		return errors.New("invalid_extra_json")
	}
	return nil
}
func reasonValid(s string) bool {
	return len([]rune(strings.TrimSpace(s))) >= 8 && len([]rune(s)) <= 500
}
func permissionUnit(p string) string {
	switch {
	case strings.HasPrefix(p, "urmin."):
		return "urmin"
	case strings.HasPrefix(p, "subbagren."):
		return "subbagren"
	case strings.HasPrefix(p, "subbagsumda."):
		return "subbagsumda"
	case strings.HasPrefix(p, "subbagbinfung."):
		return "subbagbinfung"
	}
	return ""
}
func isAllowedPermission(s string) bool {
	if strings.HasPrefix(s, "identity.") || strings.HasPrefix(s, "audit.") || strings.HasPrefix(s, "dashboard.") {
		return false
	}
	if !(strings.HasPrefix(s, "urmin.") || strings.HasPrefix(s, "subbagren.") || strings.HasPrefix(s, "subbagsumda.") || strings.HasPrefix(s, "subbagbinfung.")) {
		return false
	}
	switch {
	case strings.HasSuffix(s, ".read"), strings.HasSuffix(s, ".create"), strings.HasSuffix(s, ".update"):
		return true
	}
	return false
}
func validatePermissions(list []string) bool {
	if len(list) < 1 || len(list) > 30 {
		return false
	}
	found := map[string]bool{}
	for _, p := range list {
		if !isAllowedPermission(p) || found[p] {
			return false
		}
		found[p] = true
	}
	return true
}
func isSubset(scope, limit, sourceLimit string, sourcePermissions, requested []string) bool {
	if scope != "assigned" && scope != "unit" {
		return false
	}
	if limit != "biasa" && limit != "penting" {
		return false
	}
	if sourceLimit != "penting" && limit == "penting" {
		return false
	}
	allowed := map[string]bool{}
	for _, p := range sourcePermissions {
		allowed[p] = true
	}
	for _, p := range requested {
		if !allowed[p] {
			return false
		}
	}
	return true
}
func isForeignKey(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23503"
}
func (a *API) Routes(r chi.Router) {
	r.Get("/delegation-candidates", a.candidates)
	r.Get("/delegations", a.list)
	r.Post("/delegations", a.create)
	r.Post("/delegations/{delegationID}/revoke", a.revoke)
}
func (a *API) candidates(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	// Only full-unit source grants may be delegated in R2C2B. This prevents an
	// assigned/own source from granting access to another user's documents.
	rows, err := a.DB.Query(ctx, `SELECT g.id::text,u.id::text,u.username,g.role_key,g.unit_key,g.classification_limit,g.expires_at,
 COALESCE(array_agg(DISTINCT rp.permission_key ORDER BY rp.permission_key) FILTER(WHERE rp.permission_key IS NOT NULL),'{}'::text[])
 FROM sdl_access_grants g
 JOIN sdl_users u ON u.id=g.user_id AND u.is_active AND NOT u.must_change_password
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active AND ro.role_key<>'superadmin'
 JOIN sdl_org_units un ON un.unit_key=g.unit_key AND un.is_active
 LEFT JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key NOT LIKE 'identity.%' AND rp.permission_key NOT LIKE 'audit.%' AND rp.permission_key NOT LIKE 'dashboard.%'
 WHERE g.revoked_at IS NULL AND g.scope='unit' AND (g.expires_at IS NULL OR g.expires_at>NOW())
 AND NOT EXISTS(SELECT 1 FROM sdl_role_permissions priv WHERE priv.role_key=g.role_key AND (priv.permission_key LIKE 'identity.%' OR priv.permission_key LIKE 'audit.%'))
 GROUP BY g.id,u.id,u.username,g.role_key,g.unit_key,g.classification_limit,g.expires_at ORDER BY u.username,g.unit_key LIMIT 200`)
	if err != nil {
		deny(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	out := []Candidate{}
	for rows.Next() {
		var c Candidate
		if err := rows.Scan(&c.ID, &c.GrantorID, &c.GrantorName, &c.RoleKey, &c.UnitKey, &c.ClassificationLimit, &c.ExpiresAt, &c.Permissions); err != nil {
			deny(w, 503, "unavailable")
			return
		}
		safe := c.Permissions[:0]
		for _, p := range c.Permissions {
			if isAllowedPermission(p) && permissionUnit(p) == c.UnitKey {
				safe = append(safe, p)
			}
		}
		c.Permissions = safe
		if len(c.Permissions) > 0 {
			out = append(out, c)
		}
	}
	if rows.Err() != nil {
		deny(w, 503, "unavailable")
		return
	}
	send(w, 200, map[string]any{"candidates": out})
}
func (a *API) list(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	rows, err := a.DB.Query(ctx, `SELECT d.id::text,src.username,dst.username,d.role_key,d.unit_key,d.scope,d.classification_limit,d.permission_keys,d.reason,d.created_at,d.expires_at,d.revoked_at,d.version
 FROM sdl_access_delegations d JOIN sdl_users src ON src.id=d.grantor_id JOIN sdl_users dst ON dst.id=d.grantee_id ORDER BY d.created_at DESC LIMIT 300`)
	if err != nil {
		deny(w, 503, "unavailable")
		return
	}
	defer rows.Close()
	out := []Row{}
	for rows.Next() {
		var v Row
		if rows.Scan(&v.ID, &v.GrantorName, &v.GranteeName, &v.RoleKey, &v.UnitKey, &v.Scope, &v.ClassificationLimit, &v.Permissions, &v.Reason, &v.CreatedAt, &v.ExpiresAt, &v.RevokedAt, &v.Version) != nil {
			deny(w, 503, "unavailable")
			return
		}
		out = append(out, v)
	}
	if rows.Err() != nil {
		deny(w, 503, "unavailable")
		return
	}
	send(w, 200, map[string]any{"delegations": out})
}
func (a *API) create(w http.ResponseWriter, r *http.Request) {
	var p createPayload
	if parse(w, r, &p) != nil {
		deny(w, 400, "invalid_request")
		return
	}
	now := time.Now().UTC()
	if !reasonValid(p.Reason) || !validatePermissions(p.PermissionKeys) || !uuidPattern.MatchString(p.SourceGrantID) || !uuidPattern.MatchString(p.GranteeID) ||
		!p.ExpiresAt.After(now.Add(time.Minute)) || p.ExpiresAt.After(now.Add(14*24*time.Hour)) {
		deny(w, 400, "invalid_delegation")
		return
	}
	actor, _ := roles.Actor(r.Context())
	ctx, cancel := context.WithTimeout(r.Context(), 9*time.Second)
	defer cancel()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		deny(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var grantor, role, unit, sourceScope, sourceLimit string
	var expiry *time.Time
	err = tx.QueryRow(ctx, `SELECT g.user_id::text,g.role_key,g.unit_key,g.scope,g.classification_limit,g.expires_at
 FROM sdl_access_grants g JOIN sdl_users u ON u.id=g.user_id AND u.is_active AND NOT u.must_change_password
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active AND ro.role_key<>'superadmin'
 JOIN sdl_org_units un ON un.unit_key=g.unit_key AND un.is_active
 WHERE g.id=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>NOW())
 AND NOT EXISTS(SELECT 1 FROM sdl_role_permissions rp WHERE rp.role_key=g.role_key AND (rp.permission_key LIKE 'identity.%' OR rp.permission_key LIKE 'audit.%')) FOR UPDATE OF g`, p.SourceGrantID).Scan(&grantor, &role, &unit, &sourceScope, &sourceLimit, &expiry)
	if errors.Is(err, pgx.ErrNoRows) {
		deny(w, 409, "source_grant_inactive")
		return
	}
	if err != nil {
		deny(w, 503, "unavailable")
		return
	}
	if sourceScope != "unit" || grantor == p.GranteeID || (expiry != nil && p.ExpiresAt.After(*expiry)) {
		deny(w, 400, "delegation_exceeds_source")
		return
	}
	var eligible bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM sdl_users u JOIN sdl_user_units un ON un.user_id=u.id AND un.unit_key=$2
 WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password
 AND NOT EXISTS(SELECT 1 FROM sdl_user_roles ur WHERE ur.user_id=u.id AND ur.role_key='superadmin'))`, p.GranteeID, unit).Scan(&eligible)
	if err != nil {
		deny(w, 503, "unavailable")
		return
	}
	if !eligible {
		deny(w, 400, "grantee_not_eligible")
		return
	}
	var allowed []string
	err = tx.QueryRow(ctx, `SELECT COALESCE(array_agg(permission_key ORDER BY permission_key),'{}'::text[]) FROM sdl_role_permissions WHERE role_key=$1 AND permission_key=ANY($2::text[])`, role, p.PermissionKeys).Scan(&allowed)
	if err != nil {
		deny(w, 503, "unavailable")
		return
	}
	for _, permission := range p.PermissionKeys {
		if permissionUnit(permission) != unit {
			deny(w, 400, "permission_wrong_unit")
			return
		}
	}
	if !isSubset(p.Scope, p.ClassificationLimit, sourceLimit, allowed, p.PermissionKeys) {
		deny(w, 400, "permissions_outside_source")
		return
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO sdl_access_delegations(source_grant_id,grantor_id,grantee_id,role_key,unit_key,scope,classification_limit,permission_keys,reason,expires_at,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id::text`, p.SourceGrantID, grantor, p.GranteeID, role, unit, p.Scope, p.ClassificationLimit, p.PermissionKeys, strings.TrimSpace(p.Reason), p.ExpiresAt, actor).Scan(&id)
	if isForeignKey(err) {
		deny(w, 409, "referenced_record_changed")
		return
	}
	if err != nil {
		deny(w, 503, "unavailable")
		return
	}
	meta, _ := json.Marshal(map[string]any{"reason": strings.TrimSpace(p.Reason), "from": grantor, "to": p.GranteeID, "unit": unit, "role": role, "permissions": p.PermissionKeys, "expiresAt": p.ExpiresAt})
	_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,'identity.delegation_created','delegation',$2,$3::jsonb)`, actor, id, string(meta))
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`, p.GranteeID)
	}
	if err != nil || tx.Commit(ctx) != nil {
		deny(w, 503, "unavailable")
		return
	}
	send(w, 201, map[string]string{"id": id})
}
func (a *API) revoke(w http.ResponseWriter, r *http.Request) {
	var p revokePayload
	if parse(w, r, &p) != nil || p.Version < 1 || !reasonValid(p.Reason) {
		deny(w, 400, "invalid_request")
		return
	}
	id := chi.URLParam(r, "delegationID")
	if !uuidPattern.MatchString(id) {
		deny(w, 400, "invalid_id")
		return
	}
	actor, _ := roles.Actor(r.Context())
	ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
	defer cancel()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		deny(w, 503, "unavailable")
		return
	}
	defer tx.Rollback(ctx)
	var grantee string
	var version int64
	var revokedAt *time.Time
	err = tx.QueryRow(ctx, `SELECT grantee_id::text,version,revoked_at FROM sdl_access_delegations WHERE id=$1 FOR UPDATE`, id).Scan(&grantee, &version, &revokedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		deny(w, 404, "not_found")
		return
	}
	if err != nil {
		deny(w, 503, "unavailable")
		return
	}
	if revokedAt != nil || version != p.Version {
		deny(w, 409, "delegation_changed")
		return
	}
	_, err = tx.Exec(ctx, `UPDATE sdl_access_delegations SET revoked_at=NOW(),revoked_by=$2,revoked_reason=$3,version=version+1 WHERE id=$1`, id, actor, strings.TrimSpace(p.Reason))
	meta, _ := json.Marshal(map[string]any{"reason": strings.TrimSpace(p.Reason), "grantee": grantee, "versionBefore": version})
	if err == nil {
		_, err = tx.Exec(ctx, `INSERT INTO sdl_audit_events(actor_id,event_key,subject_type,subject_id,metadata) VALUES($1,'identity.delegation_revoked','delegation',$2,$3::jsonb)`, actor, id, string(meta))
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE sdl_sessions SET revoked_at=NOW() WHERE user_id=$1 AND revoked_at IS NULL`, grantee)
	}
	if err != nil || tx.Commit(ctx) != nil {
		deny(w, 503, "unavailable")
		return
	}
	send(w, 200, map[string]any{"revoked": true, "version": version + 1})
}
