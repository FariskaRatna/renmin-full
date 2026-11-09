-- R3B: append-only private attachments and specifically addressed delivery records.
-- No destructive or legacy data changes.
INSERT INTO sdl_permissions(permission_key,description) VALUES
 ('urmin.surat_masuk.attach','Unggah lampiran ke surat masuk terdaftar dalam cakupan akses'),
 ('urmin.distribusi.receive','Terima dan baca distribusi surat masuk yang secara eksplisit ditujukan kepada pengguna pada unit grant')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE sdl_urmin_incoming_attachments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 incoming_id UUID NOT NULL REFERENCES sdl_urmin_incoming(id) ON DELETE RESTRICT,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 filename VARCHAR(160) NOT NULL,
 mime_type VARCHAR(48) NOT NULL CHECK(mime_type IN ('application/pdf','image/png','image/jpeg')),
 size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
 sha256 CHAR(64) NOT NULL,
 body BYTEA NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT sdl_urmin_attachment_body_size CHECK(octet_length(body)=size_bytes),
 CONSTRAINT sdl_urmin_attachment_filename CHECK(length(btrim(filename)) BETWEEN 1 AND 160)
);
CREATE INDEX sdl_urmin_attachments_incoming_idx ON sdl_urmin_incoming_attachments(incoming_id, created_at, id);

CREATE TABLE sdl_urmin_distributions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 incoming_id UUID NOT NULL REFERENCES sdl_urmin_incoming(id) ON DELETE RESTRICT,
 sent_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 recipient_unit VARCHAR(32) NOT NULL REFERENCES sdl_org_units(unit_key) ON DELETE RESTRICT,
 recipient_user UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 status VARCHAR(16) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','received')),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 received_at TIMESTAMPTZ,
 CONSTRAINT sdl_urmin_distribution_receipt_consistent CHECK ((status='sent' AND received_at IS NULL) OR (status='received' AND received_at IS NOT NULL))
);
CREATE INDEX sdl_urmin_distribution_doc_idx ON sdl_urmin_distributions(incoming_id,sent_at,id);
CREATE INDEX sdl_urmin_distribution_inbox_idx ON sdl_urmin_distributions(recipient_user,status,sent_at DESC);

CREATE TABLE sdl_urmin_distribution_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 distribution_id UUID NOT NULL REFERENCES sdl_urmin_distributions(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 event_key VARCHAR(20) NOT NULL CHECK(event_key IN ('sent','received')),
 reason VARCHAR(500) NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 500),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_urmin_delivery_events_idx ON sdl_urmin_distribution_events(distribution_id,created_at,id);
-- Do not create multiple unacknowledged inbox items for the same letter/recipient.
CREATE UNIQUE INDEX sdl_urmin_delivery_one_pending_idx ON sdl_urmin_distributions(incoming_id,recipient_user) WHERE status='sent';
