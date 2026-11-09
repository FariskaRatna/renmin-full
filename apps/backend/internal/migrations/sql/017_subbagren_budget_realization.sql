-- R4A3A: finance ledgers separate from INTERNAL approved proposals.
-- Document reference is metadata, not an uploaded/verifiably authentic document.
-- Never interpret internal approval or a proposal estimate as an authorized pagu.
INSERT INTO sdl_permissions(permission_key,description) VALUES
 ('subbagren.anggaran.read','Read budget and realization records within active Subbagren grant'),
 ('subbagren.anggaran.pagu.register','Register document-referenced authorized pagu for internally reviewed proposal'),
 ('subbagren.anggaran.pagu.verify','Independently verify a registered pagu based on external authorization evidence'),
 ('subbagren.anggaran.realisasi.record','Record realization with mandatory evidence reference'),
 ('subbagren.anggaran.realisasi.verify','Independently verify realization against remaining approved pagu')
ON CONFLICT (permission_key) DO NOTHING;
-- Intentionally NO automatic role grants, no user changes, no inherited financial authority.
CREATE TABLE sdl_subbagren_pagu (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 proposal_id UUID NOT NULL UNIQUE REFERENCES sdl_subbagren_proposals(id) ON DELETE RESTRICT,
 amount BIGINT NOT NULL CHECK(amount>0 AND amount<=1000000000000000),
 authorization_number VARCHAR(160) NOT NULL CHECK(length(btrim(authorization_number)) BETWEEN 6 AND 160),
 authorization_issuer VARCHAR(160) NOT NULL CHECK(length(btrim(authorization_issuer)) BETWEEN 5 AND 160),
 authorization_date DATE NOT NULL,
 status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 reviewed_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 review_reason VARCHAR(500),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_at TIMESTAMPTZ,
 CONSTRAINT pagu_review_consistent CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
 CONSTRAINT pagu_separation CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE INDEX sdl_subbagren_pagu_status_idx ON sdl_subbagren_pagu(status,created_at DESC);
CREATE TABLE sdl_subbagren_realisasi (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 pagu_id UUID NOT NULL REFERENCES sdl_subbagren_pagu(id) ON DELETE RESTRICT,
 amount BIGINT NOT NULL CHECK(amount>0 AND amount<=1000000000000000),
 transaction_date DATE NOT NULL,
 evidence_reference VARCHAR(200) NOT NULL CHECK(length(btrim(evidence_reference)) BETWEEN 8 AND 200),
 description VARCHAR(500) NOT NULL CHECK(length(btrim(description)) BETWEEN 8 AND 500),
 status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected')),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 reviewed_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 review_reason VARCHAR(500),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_at TIMESTAMPTZ,
 CONSTRAINT realisasi_review_consistent CHECK ((status='pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status<>'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
 CONSTRAINT realisasi_separation CHECK(reviewed_by IS NULL OR reviewed_by<>created_by)
);
CREATE INDEX sdl_subbagren_realisasi_pagu_idx ON sdl_subbagren_realisasi(pagu_id,status,created_at DESC);
CREATE TABLE sdl_subbagren_budget_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 subject_type VARCHAR(16) NOT NULL CHECK(subject_type IN ('pagu','realisasi')),
 subject_id UUID NOT NULL,
 actor_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 action VARCHAR(24) NOT NULL CHECK(action IN ('registered','recorded','verified','rejected')),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_subbagren_budget_events_subject_idx ON sdl_subbagren_budget_events(subject_type,subject_id,id);
