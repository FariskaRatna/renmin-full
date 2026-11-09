-- R2D1: add CAPTCHA replay protection and per-user OTP policy. No data reset.
ALTER TABLE sdl_users ADD COLUMN otp_enabled BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE sdl_captcha_challenges (
  challenge_hash CHAR(64) PRIMARY KEY,
  client_hash CHAR(64) NOT NULL,
  nonce VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  CONSTRAINT sdl_captcha_expiry CHECK(expires_at > created_at)
);
CREATE INDEX sdl_captcha_client_recent ON sdl_captcha_challenges(client_hash,created_at DESC);
CREATE INDEX sdl_captcha_expiry ON sdl_captcha_challenges(expires_at);
