-- R5C: Six Subbagbinfung administrative registers linked to R5A files/photos and dispositions.
-- Additive schema; no changes to existing identities, permissions, or business records.
CREATE TABLE sdl_binfung_registry (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kind VARCHAR(20) NOT NULL CHECK(kind IN ('sop','pid','rb','abk','pembinaan','evaluasi')),
 ref_code VARCHAR(64) NOT NULL CHECK(length(btrim(ref_code)) BETWEEN 2 AND 64),
 title VARCHAR(200) NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 200),
 fields JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(fields)='object'),
 work_record_id UUID NOT NULL UNIQUE REFERENCES sdl_unit_work_records(id) ON DELETE RESTRICT,
 created_by UUID NOT NULL REFERENCES sdl_users(id),
 updated_by UUID NOT NULL REFERENCES sdl_users(id),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version > 0),
 deleted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sdl_binfung_registry_code_active ON sdl_binfung_registry(kind,lower(ref_code)) WHERE deleted_at IS NULL;
CREATE INDEX sdl_binfung_registry_list_active ON sdl_binfung_registry(kind,created_at DESC,id) WHERE deleted_at IS NULL;
