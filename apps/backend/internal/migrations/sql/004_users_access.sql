-- R2C2A: additive only. Existing Superadmin and its global role remain unchanged.
ALTER TABLE sdl_users
 ADD COLUMN version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
 ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- A grant binds a specific role + unit + scope to one user; no implicit cross-product.
-- Privileged global superadmin assignment stays in the protected legacy bootstrap table.
CREATE TABLE sdl_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  role_key VARCHAR(64) NOT NULL REFERENCES sdl_roles(role_key) ON DELETE RESTRICT,
  unit_key VARCHAR(32) NOT NULL REFERENCES sdl_org_units(unit_key) ON DELETE RESTRICT,
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('own','assigned','unit')),
  classification_limit VARCHAR(12) NOT NULL DEFAULT 'biasa' CHECK (classification_limit IN ('biasa','penting')),
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  grant_reason VARCHAR(500) NOT NULL,
  granted_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT grant_expiry CHECK(expires_at IS NULL OR expires_at > granted_at)
);
CREATE INDEX sdl_grants_user_idx ON sdl_access_grants(user_id, granted_at DESC);
CREATE INDEX sdl_grants_active_idx ON sdl_access_grants(user_id,unit_key,role_key) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX sdl_grants_unique_active ON sdl_access_grants(user_id,unit_key,role_key) WHERE revoked_at IS NULL;
COMMENT ON TABLE sdl_access_grants IS 'Scoped, auditable RBAC+ABAC assignment. Not an unconditional document authorization.';
