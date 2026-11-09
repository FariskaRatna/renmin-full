-- R4A3B: private immutable financial evidence, independent evidence review.
-- Existing verified realizations remain unchanged. New verification requires approved evidence.
INSERT INTO sdl_permissions(permission_key,description) VALUES
 ('subbagren.anggaran.bukti.read','View/download approved or pending financial evidence in granted unit/classification'),
 ('subbagren.anggaran.bukti.upload','Upload immutable financial evidence to pending realization'),
 ('subbagren.anggaran.bukti.verify','Review financial evidence independently of its maker'),
 ('subbagren.anggaran.reconcile','View per-unit verified budget reconciliation and missing proof status')
ON CONFLICT(permission_key) DO NOTHING;
-- No automatic role grants. No mutation to earlier financial records.
CREATE TABLE sdl_subbagren_evidence (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 realisasi_id UUID NOT NULL REFERENCES sdl_subbagren_realisasi(id) ON DELETE RESTRICT,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 mime_type VARCHAR(32) NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg')),
 size_bytes INT NOT NULL CHECK(size_bytes>0 AND size_bytes<=5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL CHECK(octet_length(body)>28 AND octet_length(body)<=5242944),
 status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewer_id UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 review_reason VARCHAR(500),
 reviewed_at TIMESTAMPTZ,
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT evidence_review_consistent CHECK(
  (status='pending' AND reviewer_id IS NULL AND reviewed_at IS NULL) OR
  (status<>'pending' AND reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)),
 CONSTRAINT evidence_independent_check CHECK(reviewer_id IS NULL OR reviewer_id<>uploaded_by)
);
CREATE UNIQUE INDEX sdl_subbagren_evidence_active_uq ON sdl_subbagren_evidence(realisasi_id) WHERE status IN ('pending','approved');
CREATE INDEX sdl_subbagren_evidence_realisasi_idx ON sdl_subbagren_evidence(realisasi_id,created_at DESC,id);
CREATE TABLE sdl_subbagren_evidence_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 evidence_id UUID NOT NULL REFERENCES sdl_subbagren_evidence(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 action VARCHAR(24) NOT NULL CHECK(action IN ('uploaded','approved','rejected','downloaded')),
 reason VARCHAR(500) NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_subbagren_evidence_events_subject_idx ON sdl_subbagren_evidence_events(evidence_id,id);
