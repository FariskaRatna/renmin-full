-- R3A. Additive Urmin surat masuk register with immutable event history.
-- No legacy table or record is modified.
CREATE TABLE sdl_urmin_incoming (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agenda_no BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
 unit_key VARCHAR(32) NOT NULL DEFAULT 'urmin' REFERENCES sdl_org_units(unit_key) ON DELETE RESTRICT,
 letter_number VARCHAR(120) NOT NULL,
 sender VARCHAR(240) NOT NULL,
 letter_date DATE NOT NULL,
 received_date DATE NOT NULL,
 subject VARCHAR(1000) NOT NULL,
 classification VARCHAR(12) NOT NULL CHECK (classification IN ('biasa','penting')),
 status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','registered')),
 created_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 updated_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT urmin_incoming_unit CHECK (unit_key='urmin'),
 CONSTRAINT urmin_letter_number_notblank CHECK(length(btrim(letter_number))>=3),
 CONSTRAINT urmin_sender_notblank CHECK(length(btrim(sender))>=3),
 CONSTRAINT urmin_subject_notblank CHECK(length(btrim(subject))>=3)
);
CREATE INDEX sdl_urmin_incoming_created_idx ON sdl_urmin_incoming(created_at DESC,id);
CREATE INDEX sdl_urmin_incoming_status_idx ON sdl_urmin_incoming(status,received_date DESC);
CREATE INDEX sdl_urmin_incoming_creator_idx ON sdl_urmin_incoming(created_by,created_at DESC);

CREATE TABLE sdl_urmin_incoming_history (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 incoming_id UUID NOT NULL REFERENCES sdl_urmin_incoming(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 action VARCHAR(20) NOT NULL CHECK (action IN ('created','edited','registered')),
 from_status VARCHAR(20),
 to_status VARCHAR(20) NOT NULL,
 reason VARCHAR(500) NOT NULL,
 version BIGINT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX sdl_urmin_history_version_idx ON sdl_urmin_incoming_history(incoming_id,version);
CREATE INDEX sdl_urmin_history_time_idx ON sdl_urmin_incoming_history(incoming_id,created_at,id);
