-- R5F12: Transactional, non-sensitive email notification queue for URMIN dispositions.
-- Existing tasks and users are preserved. No historical email is generated.
CREATE TABLE sdl_urmin_email_outbox (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 task_id UUID NOT NULL REFERENCES sdl_urmin_disposition_tasks(id) ON DELETE RESTRICT,
 recipient_user UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 event_key VARCHAR(32) NOT NULL CHECK (event_key IN ('assigned','forwarded','completed','review_approved','review_revision')),
 status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
 attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
 available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_until TIMESTAMPTZ,
 sent_at TIMESTAMPTZ,
 error_code VARCHAR(48),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(task_id,recipient_user,event_key)
);
CREATE INDEX sdl_urmin_email_queue_idx ON sdl_urmin_email_outbox(status,available_at,created_at) WHERE status<>'sent';
