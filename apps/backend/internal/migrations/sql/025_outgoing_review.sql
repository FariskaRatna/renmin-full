-- R5F10: an authoritative outgoing-letter review workflow. Existing manually-entered
-- statusAdministrasi is historical only and never authorizes a signature or delivery.
-- Backfill does NOT infer approval, signing, or delivery from old manual labels.
CREATE TABLE sdl_outgoing_workflows (
  register_id UUID PRIMARY KEY REFERENCES sdl_urmin_registry(id) ON DELETE RESTRICT,
  stage VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (stage IN ('draft','submitted','approved','rejected','legacy')),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  content_sha256 CHAR(64),
  submitted_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  last_actor UUID REFERENCES sdl_users(id),
  last_note VARCHAR(500) NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE sdl_outgoing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id UUID NOT NULL REFERENCES sdl_urmin_registry(id) ON DELETE RESTRICT,
  actor_id UUID NOT NULL REFERENCES sdl_users(id),
  event_key VARCHAR(28) NOT NULL CHECK (event_key IN ('submitted','approved','rejected')),
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_outgoing_events_order ON sdl_outgoing_events(register_id, created_at DESC, id DESC);
INSERT INTO sdl_outgoing_workflows(register_id,stage)
  SELECT id,CASE WHEN COALESCE(fields->>'statusAdministrasi','') NOT IN ('','Draft')
    THEN 'legacy' ELSE 'draft' END
  FROM sdl_urmin_registry WHERE kind='surat_keluar' 
  ON CONFLICT(register_id) DO NOTHING;
INSERT INTO sdl_permissions(permission_key,description)
  VALUES('urmin.surat_keluar.approve','Persetujuan surat keluar oleh Kabagrenmin')
  ON CONFLICT(permission_key) DO NOTHING;
INSERT INTO sdl_role_permissions(role_key,permission_key)
  SELECT 'br_kabagrenmin','urmin.surat_keluar.approve'
  WHERE EXISTS(SELECT 1 FROM sdl_roles WHERE role_key='br_kabagrenmin')
  ON CONFLICT(role_key,permission_key) DO NOTHING;
