-- R4A1: Internal Subbagren planning proposal register. Additive only.
-- These records are NOT DIPA commitments, formal budget approvals or external submissions.
INSERT INTO sdl_permissions(permission_key,description) VALUES
 ('subbagren.usulan.read','Lihat usulan perencanaan dan anggaran sesuai grant Subbagren'),
 ('subbagren.usulan.create','Buat draft usulan perencanaan di Subbagren'),
 ('subbagren.usulan.update','Ubah draft usulan sendiri/sesuai grant Subbagren'),
 ('subbagren.usulan.submit','Ajukan draft usulan untuk penelaahan Subbagren')
ON CONFLICT (permission_key) DO NOTHING;
-- Deliberately no role permission auto-grants or changes to any role/user.
CREATE TABLE sdl_subbagren_proposals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 unit_key VARCHAR(32) NOT NULL DEFAULT 'subbagren' REFERENCES sdl_org_units(unit_key) ON DELETE RESTRICT,
 fiscal_year INT NOT NULL CHECK(fiscal_year BETWEEN 2020 AND 2100),
 source_unit VARCHAR(160) NOT NULL CHECK(length(btrim(source_unit)) BETWEEN 3 AND 160),
 title VARCHAR(300) NOT NULL CHECK(length(btrim(title)) BETWEEN 5 AND 300),
 output_target VARCHAR(600) NOT NULL CHECK(length(btrim(output_target)) BETWEEN 5 AND 600),
 proposed_budget BIGINT NOT NULL CHECK(proposed_budget >= 0 AND proposed_budget <= 1000000000000000),
 classification VARCHAR(12) NOT NULL CHECK(classification IN ('biasa','penting')),
 status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','submitted')),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_subbagren_proposal_unit CHECK(unit_key='subbagren')
);
CREATE INDEX sdl_subbagren_proposal_year_idx ON sdl_subbagren_proposals(fiscal_year DESC,created_at DESC,id);
CREATE INDEX sdl_subbagren_proposal_owner_idx ON sdl_subbagren_proposals(created_by,created_at DESC);
CREATE TABLE sdl_subbagren_proposal_history (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 proposal_id UUID NOT NULL REFERENCES sdl_subbagren_proposals(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 action VARCHAR(16) NOT NULL CHECK(action IN ('created','updated','submitted')),
 from_status VARCHAR(16),
 to_status VARCHAR(16) NOT NULL CHECK(to_status IN ('draft','submitted')),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 version BIGINT NOT NULL CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(proposal_id,version)
);
CREATE INDEX sdl_subbagren_proposal_history_idx ON sdl_subbagren_proposal_history(proposal_id,id);
