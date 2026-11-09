-- R5F23A: server-side per-issuer autosave. Drafts are private and never delivered.
CREATE TABLE IF NOT EXISTS sdl_leadership_directive_drafts (
  issuer_id UUID PRIMARY KEY REFERENCES sdl_users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL DEFAULT '' CHECK (char_length(title)<=160),
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body)<=4000),
  kind VARCHAR(24) NOT NULL DEFAULT 'umum' CHECK (kind IN ('umum','persuratan','sprint','lainnya')),
  priority VARCHAR(12) NOT NULL DEFAULT 'biasa' CHECK (priority IN ('biasa','penting','kilat')),
  due_at_local VARCHAR(16) NOT NULL DEFAULT '' CHECK (due_at_local='' OR due_at_local ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$'),
  recipient_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recipient_ids)='array' AND jsonb_array_length(recipient_ids)<=10),
  revision BIGINT NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
