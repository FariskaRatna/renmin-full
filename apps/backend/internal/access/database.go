package access

import (
	"context"
	"siera-delta-lima/backend/internal/devdemo"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Must be used by every operational record handler. This is an identity
// exclusion and is intentionally NOT editable through frontend role grants.
const operationalEligibilityQuery = "SELECT EXISTS(SELECT 1 FROM sdl_users u WHERE u.id=$1 AND u.is_active AND NOT u.must_change_password AND NOT EXISTS (SELECT 1 FROM sdl_user_roles sur WHERE sur.user_id=u.id AND sur.role_key='superadmin'))"

// EvaluateForUser is the R3 integration entry point. The calling handler MUST
// load Resource from PostgreSQL, never trust metadata supplied by the client.
// Superadmin is expressly denied operational resource access, even if a unit grant
// is accidentally present. Session identity does not bypass ABAC checks.
// Returning an error must be handled as DENY (service unavailable), not allow.
func EvaluateForUser(ctx context.Context, db *pgxpool.Pool, userID, permission string, resource Resource, now time.Time) (Decision, error) {
	denied := Decision{false, "no_matching_grant"}
	if db == nil || userID == "" || permission == "" {
		return denied, nil
	}
	if demo, err := devdemo.Superadmin(ctx, db, userID); err != nil {
		return denied, err
	} else if demo {
		// R5F20B: Superadmin is administrative only, including in local demo.
		return denied, nil
	}
	var eligible bool
	err := db.QueryRow(ctx, operationalEligibilityQuery, userID).Scan(&eligible)
	if err != nil {
		return denied, err
	}
	if !eligible {
		return denied, nil
	}
	// Effective permission is the INTERSECTION of role permission and its *same*
	// grant's constraints. A separate grant cannot lend a wider scope to a role.
	// Delegations must retain an active unit-level source grant, a live matching
	// role permission, an eligible same-unit recipient and an unexpired lease.
	const sql = `SELECT g.unit_key,g.scope,g.classification_limit,g.expires_at
 FROM sdl_access_grants g
 JOIN sdl_roles ro ON ro.role_key=g.role_key AND ro.is_active
 JOIN sdl_role_permissions rp ON rp.role_key=g.role_key AND rp.permission_key=$2
 JOIN sdl_org_units ou ON ou.unit_key=g.unit_key AND ou.is_active
 JOIN sdl_user_units uu ON uu.user_id=g.user_id AND uu.unit_key=g.unit_key
 WHERE g.user_id=$1 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>$3)
 UNION ALL
 SELECT d.unit_key,d.scope,d.classification_limit,LEAST(d.expires_at,COALESCE(source.expires_at,d.expires_at))
 FROM sdl_access_delegations d
 JOIN sdl_access_grants source ON source.id=d.source_grant_id
  AND source.user_id=d.grantor_id AND source.role_key=d.role_key AND source.unit_key=d.unit_key
  AND source.scope='unit' AND source.revoked_at IS NULL
 JOIN sdl_users origin ON origin.id=d.grantor_id AND origin.is_active AND NOT origin.must_change_password
 JOIN sdl_roles ro ON ro.role_key=d.role_key AND ro.is_active AND ro.role_key<>'superadmin'
 JOIN sdl_role_permissions rp ON rp.role_key=d.role_key AND rp.permission_key=$2
 JOIN sdl_org_units ou ON ou.unit_key=d.unit_key AND ou.is_active
 JOIN sdl_user_units uuo ON uuo.user_id=d.grantor_id AND uuo.unit_key=d.unit_key
 JOIN sdl_user_units uur ON uur.user_id=d.grantee_id AND uur.unit_key=d.unit_key
 WHERE d.grantee_id=$1 AND d.revoked_at IS NULL AND d.expires_at>$3
 AND (source.expires_at IS NULL OR source.expires_at>$3)
 AND (source.expires_at IS NULL OR d.expires_at<=source.expires_at)
 AND (source.classification_limit='penting' OR d.classification_limit='biasa')
 AND $2=ANY(d.permission_keys)
 AND ($2 LIKE 'urmin.%.read' OR $2 LIKE 'urmin.%.create' OR $2 LIKE 'urmin.%.update'
 OR $2 LIKE 'subbagren.%.read' OR $2 LIKE 'subbagren.%.create' OR $2 LIKE 'subbagren.%.update'
 OR $2 LIKE 'subbagsumda.%.read' OR $2 LIKE 'subbagsumda.%.create' OR $2 LIKE 'subbagsumda.%.update'
 OR $2 LIKE 'subbagbinfung.%.read' OR $2 LIKE 'subbagbinfung.%.create' OR $2 LIKE 'subbagbinfung.%.update')
 AND NOT EXISTS(SELECT 1 FROM sdl_role_permissions blocked WHERE blocked.role_key=d.role_key AND (blocked.permission_key LIKE 'identity.%' OR blocked.permission_key LIKE 'audit.%'))
 `
	rows, err := db.Query(ctx, sql, userID, permission, now)
	if err != nil {
		return denied, err
	}
	defer rows.Close()
	grants := []Grant{}
	for rows.Next() {
		var g Grant
		g.RoleActive = true
		g.HasPermission = true
		if err := rows.Scan(&g.Unit, &g.Scope, &g.ClassificationLimit, &g.ExpiresAt); err != nil {
			return denied, err
		}
		grants = append(grants, g)
	}
	if err := rows.Err(); err != nil {
		return denied, err
	}
	return Evaluate(userID, permission, resource, grants, now), nil
}
