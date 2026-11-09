-- R5F22: Additional durable email queue for newly submitted incoming letters.
-- No historical messages are generated. This table does not change R5F12 task emails.
CREATE TABLE sdl_urmin_intake_mail_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    distribution_id UUID NOT NULL REFERENCES sdl_urmin_distributions(id) ON DELETE RESTRICT,
    recipient_user UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
    status VARCHAR(16) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
    attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 6),
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_until TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    error_code VARCHAR(48),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(distribution_id,recipient_user)
);
CREATE INDEX sdl_urmin_intake_mail_queue_idx
  ON sdl_urmin_intake_mail_outbox(status,available_at,created_at)
  WHERE status<>'sent';
