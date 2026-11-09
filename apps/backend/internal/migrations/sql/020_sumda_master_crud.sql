-- R5B: structured and reversible (soft-delete) Subbagsumda master registry.
-- The linked R5A work record owns file/photo uploads and internal dispositions.
CREATE TABLE sdl_sumda_registry (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 kind VARCHAR(20) NOT NULL CHECK(kind IN ('personel','pendidikan','inventaris')),
 ref_code VARCHAR(64) NOT NULL CHECK(length(btrim(ref_code)) BETWEEN 2 AND 64),
 title VARCHAR(200) NOT NULL CHECK(length(btrim(title)) BETWEEN 3 AND 200),
 fields JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(fields) = 'object'),
 work_record_id UUID NOT NULL UNIQUE REFERENCES sdl_unit_work_records(id) ON DELETE RESTRICT,
 created_by UUID NOT NULL REFERENCES sdl_users(id),
 updated_by UUID NOT NULL REFERENCES sdl_users(id),
 version BIGINT NOT NULL DEFAULT 1 CHECK(version > 0),
 deleted_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX sdl_sumda_registry_code_active ON sdl_sumda_registry(kind,lower(ref_code)) WHERE deleted_at IS NULL;
CREATE INDEX sdl_sumda_registry_list_active ON sdl_sumda_registry(kind,created_at DESC,id) WHERE deleted_at IS NULL;
