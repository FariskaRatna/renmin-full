-- R5F7: additive metadata for flexible incoming-letter intake.
-- The R3A/R3B letter register, attachments, distribution and history are retained.
CREATE TABLE sdl_urmin_incoming_intake (
 incoming_id UUID PRIMARY KEY REFERENCES sdl_urmin_incoming(id) ON DELETE RESTRICT,
 letter_kind VARCHAR(24) NOT NULL CHECK (letter_kind IN ('undangan','permintaan','pemberitahuan','lainnya')),
 response_due DATE,
 event_start TIMESTAMP WITHOUT TIME ZONE,
 event_end TIMESTAMP WITHOUT TIME ZONE,
 event_location VARCHAR(240) NOT NULL DEFAULT '',
 event_agenda VARCHAR(500) NOT NULL DEFAULT '',
 details VARCHAR(1000) NOT NULL DEFAULT '',
 needs_disposition BOOLEAN NOT NULL,
 route_status VARCHAR(24) NOT NULL CHECK (route_status IN ('draft','recorded','awaiting_kabag')),
 kabag_recipient UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 submitted_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT intake_route_consistency CHECK (
   (route_status='draft' AND submitted_at IS NULL AND kabag_recipient IS NULL)
   OR (route_status='recorded' AND submitted_at IS NOT NULL AND needs_disposition=FALSE AND kabag_recipient IS NULL)
   OR (route_status='awaiting_kabag' AND submitted_at IS NOT NULL AND needs_disposition=TRUE AND kabag_recipient IS NOT NULL)
 ),
 CONSTRAINT intake_event_order CHECK (event_end IS NULL OR (event_start IS NOT NULL AND event_end>=event_start))
);
CREATE INDEX sdl_urmin_intake_due_idx ON sdl_urmin_incoming_intake(response_due) WHERE response_due IS NOT NULL;
CREATE INDEX sdl_urmin_intake_kabag_idx ON sdl_urmin_incoming_intake(kabag_recipient,submitted_at DESC) WHERE route_status='awaiting_kabag';

-- Additional capability for the named Kabagrenmin role to pass an incoming
-- letter to an explicitly addressed unit recipient after receipt.
-- Only existing roles are updated; no broad admin permission is introduced.
INSERT INTO sdl_role_permissions(role_key,permission_key)
 SELECT r.role_key,p.permission_key FROM sdl_roles r CROSS JOIN sdl_permissions p
 WHERE r.role_key='br_kabagrenmin' AND p.permission_key='urmin.surat_masuk.distribute'
 ON CONFLICT DO NOTHING;
