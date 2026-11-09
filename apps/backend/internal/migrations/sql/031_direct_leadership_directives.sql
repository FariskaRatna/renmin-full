-- R5F23 Arahan Pimpinan: direct, one-way instructions independent from Urmin.
-- All records and acknowledgements are append-only from the user's perspective.
CREATE TABLE IF NOT EXISTS sdl_leadership_directives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  title VARCHAR(160) NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 8 AND 4000),
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('umum','persuratan','sprint','lainnya')),
  priority VARCHAR(12) NOT NULL DEFAULT 'biasa' CHECK (priority IN ('biasa','penting','kilat')),
  due_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT directive_due_future CHECK (due_at IS NULL OR due_at >= created_at)
);
CREATE INDEX IF NOT EXISTS sdl_directive_issuer_idx ON sdl_leadership_directives(issuer_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS sdl_leadership_directive_recipients (
  directive_id UUID NOT NULL REFERENCES sdl_leadership_directives(id) ON DELETE RESTRICT,
  recipient_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  read_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  issuer_seen_at TIMESTAMPTZ,
  PRIMARY KEY(directive_id,recipient_id),
  CONSTRAINT directive_ack_after_read CHECK (acknowledged_at IS NULL OR read_at IS NOT NULL),
  CONSTRAINT directive_seen_after_ack CHECK (issuer_seen_at IS NULL OR acknowledged_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sdl_directive_recipient_idx ON sdl_leadership_directive_recipients(recipient_id,acknowledged_at,directive_id);
CREATE TABLE IF NOT EXISTS sdl_leadership_directive_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  directive_id UUID NOT NULL REFERENCES sdl_leadership_directives(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
  recipient_id UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
  event_key VARCHAR(24) NOT NULL CHECK (event_key IN ('sent','read','acknowledged','ack_seen')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sdl_directive_events_idx ON sdl_leadership_directive_events(directive_id,created_at,id);
