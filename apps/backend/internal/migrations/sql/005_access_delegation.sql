-- R2C2B: auditable short-lived, unit-bound delegation of a subset of existing rights.
-- No UPDATE/DELETE/TRUNCATE/DROP, no default grants, no automatic document access.
CREATE TABLE sdl_access_delegations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 source_grant_id UUID NOT NULL REFERENCES sdl_access_grants(id) ON DELETE RESTRICT,
 grantor_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 grantee_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 role_key VARCHAR(64) NOT NULL REFERENCES sdl_roles(role_key) ON DELETE RESTRICT,
 unit_key VARCHAR(32) NOT NULL REFERENCES sdl_org_units(unit_key) ON DELETE RESTRICT,
 scope VARCHAR(20) NOT NULL CHECK(scope IN ('assigned','unit')),
 classification_limit VARCHAR(12) NOT NULL CHECK(classification_limit IN ('biasa','penting')),
 permission_keys TEXT[] NOT NULL CHECK(cardinality(permission_keys) BETWEEN 1 AND 30),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 expires_at TIMESTAMPTZ NOT NULL,
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 revoked_at TIMESTAMPTZ,
 revoked_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 revoked_reason VARCHAR(500),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>=1),
 CONSTRAINT delegation_distinct_users CHECK(grantor_id <> grantee_id),
 CONSTRAINT delegation_time_window CHECK(expires_at>created_at AND expires_at<=created_at+INTERVAL '14 days'),
 CONSTRAINT delegation_revocation_reason CHECK(revoked_at IS NULL OR (revoked_by IS NOT NULL AND length(btrim(revoked_reason)) BETWEEN 8 AND 500))
);
CREATE INDEX sdl_delegation_grantee_idx ON sdl_access_delegations(grantee_id,expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX sdl_delegation_source_idx ON sdl_access_delegations(source_grant_id) WHERE revoked_at IS NULL;
CREATE INDEX sdl_delegation_history_idx ON sdl_access_delegations(created_at DESC);
COMMENT ON TABLE sdl_access_delegations IS 'Unit-restricted, short-lived delegation with revocation and a permission subset. Effective rights require active source grant and role at request time.';
