-- R5A: Four-unit functional documents, photos and internal dispositions.
-- Additive storage; no role/user auto grants and no changes to previous records.
CREATE TABLE sdl_unit_work_records (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 unit_key VARCHAR(32) NOT NULL REFERENCES sdl_org_units(unit_key) ON DELETE RESTRICT,
 category VARCHAR(100) NOT NULL CHECK(length(btrim(category)) BETWEEN 2 AND 100),
 title VARCHAR(240) NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 240),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=4000),
 classification VARCHAR(12) NOT NULL DEFAULT 'biasa' CHECK(classification IN ('biasa','penting')),
 created_by UUID NOT NULL REFERENCES sdl_users(id),
 updated_by UUID NOT NULL REFERENCES sdl_users(id),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 deleted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_unit_work_records_unit_idx ON sdl_unit_work_records(unit_key,created_at DESC,id) WHERE deleted_at IS NULL;
CREATE TABLE sdl_unit_work_files (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 record_id UUID NOT NULL REFERENCES sdl_unit_work_records(id) ON DELETE RESTRICT,
 file_name VARCHAR(180) NOT NULL,
 media_type VARCHAR(40) NOT NULL CHECK(media_type IN ('application/pdf','image/jpeg','image/png')),
 byte_size INT NOT NULL CHECK(byte_size>0 AND byte_size<=5242880),
 sha256 CHAR(64) NOT NULL,
 file_data BYTEA NOT NULL,
 uploaded_by UUID NOT NULL REFERENCES sdl_users(id),
 removed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT file_exact_size CHECK(octet_length(file_data)=byte_size)
);
CREATE INDEX sdl_unit_work_files_record_idx ON sdl_unit_work_files(record_id,created_at) WHERE removed_at IS NULL;
CREATE TABLE sdl_unit_work_tasks (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 record_id UUID NOT NULL REFERENCES sdl_unit_work_records(id) ON DELETE RESTRICT,
 from_user UUID NOT NULL REFERENCES sdl_users(id),
 to_user UUID NOT NULL REFERENCES sdl_users(id),
 instruction VARCHAR(1000) NOT NULL CHECK(length(btrim(instruction)) BETWEEN 5 AND 1000),
 due_date DATE,
 status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','received','completed','cancelled')),
 response VARCHAR(1000) NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT no_self_task CHECK(from_user<>to_user)
);
CREATE INDEX sdl_unit_work_tasks_record_idx ON sdl_unit_work_tasks(record_id,created_at DESC);
CREATE INDEX sdl_unit_work_tasks_inbox_idx ON sdl_unit_work_tasks(to_user,status,created_at DESC);
CREATE TABLE sdl_unit_work_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 record_id UUID NOT NULL REFERENCES sdl_unit_work_records(id) ON DELETE RESTRICT,
 task_id UUID REFERENCES sdl_unit_work_tasks(id) ON DELETE RESTRICT,
 actor_id UUID NOT NULL REFERENCES sdl_users(id),
 action VARCHAR(35) NOT NULL,
 note VARCHAR(1000) NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_unit_work_events_record_idx ON sdl_unit_work_events(record_id,id);
