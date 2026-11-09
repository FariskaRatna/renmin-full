-- R5D: functional outgoing-letter register, meeting agendas and archive metadata.
-- Register-only: no official issue/signature/delivery is implied by CRUD status.
CREATE TABLE sdl_urmin_registry (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kind VARCHAR(24) NOT NULL CHECK(kind IN ('surat_keluar','agenda','arsip')),
 ref_code VARCHAR(64) NOT NULL CHECK(length(btrim(ref_code)) BETWEEN 2 AND 64),
 title VARCHAR(200) NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 200),
 fields JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(fields)='object'),
 work_record_id UUID NOT NULL UNIQUE REFERENCES sdl_unit_work_records(id) ON DELETE RESTRICT,
 created_by UUID NOT NULL REFERENCES sdl_users(id),
 updated_by UUID NOT NULL REFERENCES sdl_users(id),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version>0),
 deleted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sdl_urmin_registry_active_code ON sdl_urmin_registry(kind,lower(ref_code)) WHERE deleted_at IS NULL;
CREATE INDEX sdl_urmin_registry_active_list ON sdl_urmin_registry(kind,created_at DESC,id) WHERE deleted_at IS NULL;
