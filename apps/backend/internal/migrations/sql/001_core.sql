-- SDL R2A: additive bootstrap. Never drops prior data.
CREATE TABLE sdl_org_units (
  unit_key VARCHAR(32) PRIMARY KEY,
  display_name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sdl_org_units_key_check CHECK (unit_key ~ '^[a-z][a-z0-9_]{1,31}$')
);

INSERT INTO sdl_org_units (unit_key, display_name) VALUES
  ('urmin', 'Urmin'),
  ('subbagren', 'Subbagren'),
  ('subbagsumda', 'Subbagsumda'),
  ('subbagbinfung', 'Subbagbinfung')
ON CONFLICT (unit_key) DO NOTHING;

CREATE TABLE sdl_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(64) NOT NULL,
  email VARCHAR(254) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  otp_required BOOLEAN NOT NULL DEFAULT TRUE,
  password_changed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sdl_username_check CHECK (username ~ '^[a-z][a-z0-9._-]{2,63}$'),
  CONSTRAINT sdl_password_hash_check CHECK (length(password_hash) >= 40)
);
CREATE UNIQUE INDEX sdl_users_username_uniq ON sdl_users (lower(username));
CREATE UNIQUE INDEX sdl_users_email_uniq ON sdl_users (lower(email));
CREATE INDEX sdl_users_active_idx ON sdl_users (is_active);

CREATE TABLE sdl_roles (
  role_key VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(120) NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sdl_roles_key_check CHECK (role_key ~ '^[a-z][a-z0-9_.-]{2,63}$')
);

CREATE TABLE sdl_permissions (
  permission_key VARCHAR(100) PRIMARY KEY,
  description TEXT NOT NULL,
  CONSTRAINT sdl_permission_key_check CHECK (permission_key ~ '^[a-z][a-z0-9_.-]{2,99}$')
);

CREATE TABLE sdl_role_permissions (
  role_key VARCHAR(64) NOT NULL REFERENCES sdl_roles(role_key) ON DELETE RESTRICT,
  permission_key VARCHAR(100) NOT NULL REFERENCES sdl_permissions(permission_key) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_key, permission_key)
);

CREATE TABLE sdl_user_roles (
  user_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  role_key VARCHAR(64) NOT NULL REFERENCES sdl_roles(role_key) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_key)
);
CREATE INDEX sdl_user_roles_role_idx ON sdl_user_roles(role_key);

CREATE TABLE sdl_user_units (
  user_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  unit_key VARCHAR(32) NOT NULL REFERENCES sdl_org_units(unit_key) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, unit_key)
);
CREATE UNIQUE INDEX sdl_user_units_primary_uniq ON sdl_user_units(user_id) WHERE is_primary;
CREATE INDEX sdl_user_units_unit_idx ON sdl_user_units(unit_key);

-- A system administrator is not automatically granted document read/write rights.
INSERT INTO sdl_roles(role_key, display_name, is_system) VALUES
 ('superadmin', 'Superadmin', TRUE),
 ('administrator', 'Administrator Unit', TRUE),
 ('operator', 'Operator', TRUE),
 ('pimpinan', 'Pimpinan', TRUE)
ON CONFLICT (role_key) DO NOTHING;

INSERT INTO sdl_permissions(permission_key, description) VALUES
 ('identity.users.manage', 'Kelola pengguna sesuai lingkup kewenangan'),
 ('identity.roles.manage', 'Kelola role dan permission'),
 ('identity.units.manage', 'Kelola keanggotaan unit'),
 ('audit.events.read', 'Lihat audit administratif sesuai kewenangan'),
 ('urmin.surat.read', 'Lihat surat dalam unit yang ditugaskan'),
 ('urmin.surat.create', 'Buat surat dalam unit yang ditugaskan'),
 ('urmin.surat.update', 'Perbarui surat dalam unit yang ditugaskan'),
 ('urmin.disposisi.manage', 'Proses disposisi sesuai alur dan penugasan'),
 ('subbagren.data.read', 'Lihat administrasi perencanaan sesuai lingkup'),
 ('subbagsumda.data.read', 'Lihat administrasi sumber daya sesuai lingkup'),
 ('subbagbinfung.data.read', 'Lihat administrasi pembinaan fungsi sesuai lingkup'),
 ('dashboard.summary.read', 'Lihat ringkasan sesuai data yang diizinkan')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO sdl_role_permissions(role_key, permission_key) VALUES
 ('superadmin','identity.users.manage'),
 ('superadmin','identity.roles.manage'),
 ('superadmin','identity.units.manage'),
 ('superadmin','audit.events.read')
ON CONFLICT DO NOTHING;
