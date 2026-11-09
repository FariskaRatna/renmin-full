-- R5F21: Additive Portal publication tables. No operational records are copied.
CREATE TABLE IF NOT EXISTS sdl_portal_posts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kind TEXT NOT NULL CHECK (kind IN ('berita','pengumuman','sop','peraturan','agenda')),
 title TEXT NOT NULL CHECK (char_length(title) BETWEEN 3 AND 160),
 summary TEXT NOT NULL DEFAULT '' CHECK (char_length(summary)<=600),
 body TEXT NOT NULL DEFAULT '' CHECK (char_length(body)<=8000),
 owner_unit TEXT NOT NULL CHECK (owner_unit IN ('urmin','subbagren','subbagsumda','subbagbinfung')),
 cover_url TEXT NOT NULL DEFAULT '' CHECK (char_length(cover_url)<=1000),
 reference_no TEXT NOT NULL DEFAULT '' CHECK (char_length(reference_no)<=160),
 starts_at TIMESTAMPTZ,
 pinned BOOLEAN NOT NULL DEFAULT FALSE,
 published BOOLEAN NOT NULL DEFAULT FALSE,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version>0),
 created_by UUID NOT NULL REFERENCES sdl_users(id),
 updated_by UUID NOT NULL REFERENCES sdl_users(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (kind <> 'agenda' OR starts_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS sdl_portal_posts_visible_idx ON sdl_portal_posts(published,kind,starts_at,created_at);
CREATE TABLE IF NOT EXISTS sdl_portal_publication_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 post_id UUID NOT NULL REFERENCES sdl_portal_posts(id),
 actor_id UUID NOT NULL REFERENCES sdl_users(id),
 action TEXT NOT NULL CHECK (action IN ('create','update')),
 old_version INTEGER,
 new_version INTEGER NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
