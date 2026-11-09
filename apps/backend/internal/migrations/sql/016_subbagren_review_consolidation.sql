-- R4A2: Internal review state and immutable decision history.
-- Additive: existing R4A1 proposal status/draft table and history remain unchanged.
-- 'approved' means approved as an INTERNAL proposal, not DIPA/pagu authorization.
INSERT INTO sdl_permissions(permission_key,description) VALUES
 ('subbagren.usulan.review','Review internal submitted Subbagren proposals; separate reviewer from creator'),
 ('subbagren.usulan.consolidate','View grant-scoped summary of internally approved Subbagren proposals')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE sdl_subbagren_review_cases (
 proposal_id UUID PRIMARY KEY REFERENCES sdl_subbagren_proposals(id) ON DELETE RESTRICT,
 review_status VARCHAR(20) NOT NULL CHECK (review_status IN ('pending','revision_requested','approved')),
 revision_count INTEGER NOT NULL DEFAULT 0 CHECK(revision_count BETWEEN 0 AND 100),
 has_revision BOOLEAN NOT NULL DEFAULT FALSE,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_subbagren_review_status_idx ON sdl_subbagren_review_cases(review_status,proposal_id);

CREATE TABLE sdl_subbagren_review_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 proposal_id UUID NOT NULL REFERENCES sdl_subbagren_proposals(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 action VARCHAR(24) NOT NULL CHECK(action IN ('approved','revision_requested','revised','resubmitted')),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 proposal_version BIGINT NOT NULL CHECK(proposal_version>1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(proposal_id,proposal_version)
);
CREATE INDEX sdl_subbagren_review_events_history_idx ON sdl_subbagren_review_events(proposal_id,created_at,id);
