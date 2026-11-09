-- R2D4: only additive self-profile fields. Avatar stored in private local PostgreSQL.
ALTER TABLE sdl_users
  ADD COLUMN profile_phone VARCHAR(40) NOT NULL DEFAULT '',
  ADD COLUMN avatar_jpeg BYTEA;

-- One-time email change challenges are stored as HMACs; plaintext OTP is never stored.
CREATE TABLE sdl_profile_email_challenges (
  challenge_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  new_email VARCHAR(254) NOT NULL,
  otp_code_hash CHAR(64) NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT sdl_profile_email_expiry CHECK (expires_at > created_at)
);
CREATE INDEX sdl_profile_email_user_idx ON sdl_profile_email_challenges(user_id,created_at DESC);
