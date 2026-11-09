-- R3C: Explicitly addressed, per-distribution disposition tasks with append-only history.
-- Additive: existing letters, deliveries, users, and grants remain unchanged.
INSERT INTO sdl_permissions(permission_key,description) VALUES
 ('urmin.disposisi.issue','Pemberi disposisi yang telah menerima distribusi boleh memberi tugas kepada petugas pada unit yang sama'),
 ('urmin.disposisi.execute','Petugas yang ditunjuk dapat menerima dan menyelesaikan tugas disposisi')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE sdl_urmin_disposition_tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 distribution_id UUID NOT NULL REFERENCES sdl_urmin_distributions(id) ON DELETE RESTRICT,
 incoming_id UUID NOT NULL REFERENCES sdl_urmin_incoming(id) ON DELETE RESTRICT,
 unit_key VARCHAR(32) NOT NULL REFERENCES sdl_org_units(unit_key) ON DELETE RESTRICT,
 issued_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 assigned_to UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 instruction VARCHAR(1000) NOT NULL CHECK(length(btrim(instruction)) BETWEEN 8 AND 1000),
 due_date DATE NOT NULL,
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
 completion_note VARCHAR(1000),
 accepted_at TIMESTAMPTZ,
 completed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>=1),
 CONSTRAINT sdl_disposition_not_self CHECK(issued_by<>assigned_to),
 CONSTRAINT sdl_disposition_status_consistency CHECK(
   (status='pending' AND accepted_at IS NULL AND completed_at IS NULL AND completion_note IS NULL) OR
   (status='in_progress' AND accepted_at IS NOT NULL AND completed_at IS NULL AND completion_note IS NULL) OR
   (status='completed' AND accepted_at IS NOT NULL AND completed_at IS NOT NULL AND completion_note IS NOT NULL)
 )
);
CREATE UNIQUE INDEX sdl_disposition_open_one_idx ON sdl_urmin_disposition_tasks(distribution_id,assigned_to) WHERE status IN ('pending','in_progress');
CREATE INDEX sdl_disposition_assignee_idx ON sdl_urmin_disposition_tasks(assigned_to,status,due_date,id);
CREATE INDEX sdl_disposition_issuer_idx ON sdl_urmin_disposition_tasks(issued_by,created_at DESC,id);
CREATE INDEX sdl_disposition_incoming_idx ON sdl_urmin_disposition_tasks(incoming_id,created_at DESC,id);

CREATE TABLE sdl_urmin_disposition_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 disposition_id UUID NOT NULL REFERENCES sdl_urmin_disposition_tasks(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 event_key VARCHAR(20) NOT NULL CHECK(event_key IN ('issued','accepted','completed')),
 reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 1000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_disposition_events_idx ON sdl_urmin_disposition_events(disposition_id,created_at,id);
