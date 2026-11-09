-- Session tokens and OTP codes must only be persisted as keyed/cryptographic hashes.
CREATE TABLE sdl_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT sdl_sessions_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX sdl_sessions_user_idx ON sdl_sessions(user_id);
CREATE INDEX sdl_sessions_expires_idx ON sdl_sessions(expires_at) WHERE revoked_at IS NULL;

CREATE TABLE sdl_login_challenges (
  challenge_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  otp_code_hash CHAR(64) NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT sdl_challenge_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT sdl_challenge_attempts_check CHECK (attempts BETWEEN 0 AND 5)
);
CREATE INDEX sdl_login_challenges_expires_idx ON sdl_login_challenges(expires_at) WHERE consumed_at IS NULL;
CREATE INDEX sdl_login_challenges_user_idx ON sdl_login_challenges(user_id);

-- Database-backed throttle state for multi-process deployments; no raw password/OTP is logged.
CREATE TABLE sdl_login_limits (
  throttle_key CHAR(64) PRIMARY KEY,
  failures SMALLINT NOT NULL DEFAULT 0,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  CONSTRAINT sdl_login_limits_failures_check CHECK (failures BETWEEN 0 AND 20)
);

CREATE TABLE sdl_audit_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id UUID REFERENCES sdl_users(id) ON DELETE SET NULL,
  event_key VARCHAR(100) NOT NULL,
  subject_type VARCHAR(64),
  subject_id VARCHAR(100),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sdl_audit_event_key_check CHECK (event_key ~ '^[a-z][a-z0-9_.-]{2,99}$'),
  CONSTRAINT sdl_audit_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX sdl_audit_events_actor_idx ON sdl_audit_events(actor_id, created_at DESC);
CREATE INDEX sdl_audit_events_created_idx ON sdl_audit_events(created_at DESC);
CREATE INDEX sdl_audit_events_event_idx ON sdl_audit_events(event_key, created_at DESC);
