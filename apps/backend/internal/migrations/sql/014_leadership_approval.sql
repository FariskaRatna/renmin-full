-- R3D3. Additive final sign-off of reviewed ROOT dispositions only.
-- Pimpinan approval does not mutate/erase the existing task reviews or distribution.
INSERT INTO sdl_permissions(permission_key,description) VALUES
 ('urmin.disposisi.final.submit','Pemberi tugas mengajukan hasil root yang sudah selesai dan direview untuk persetujuan Kabagrenmin'),
 ('urmin.disposisi.final.approve','Kabagrenmin yang ditunjuk menilai pengajuan final lintas unit dengan grant aktif'),
 ('urmin.disposisi.final.monitor','Kabagrenmin yang ditunjuk memantau progres root dan SLA berdasarkan grant unit aktif')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE sdl_urmin_final_approvals (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 root_task_id UUID NOT NULL UNIQUE REFERENCES sdl_urmin_disposition_tasks(id) ON DELETE RESTRICT,
 submitted_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 submission_reason VARCHAR(1000) NOT NULL CHECK(length(btrim(submission_reason)) BETWEEN 8 AND 1000),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 status VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','revision_requested')),
 decided_by UUID REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decision_reason VARCHAR(1000),
 decided_at TIMESTAMPTZ,
 version BIGINT NOT NULL DEFAULT 1 CHECK(version >= 1),
 CONSTRAINT sdl_final_approval_state CHECK (
  (status='pending' AND decided_by IS NULL AND decision_reason IS NULL AND decided_at IS NULL) OR
  (status<>'pending' AND decided_by IS NOT NULL AND decision_reason IS NOT NULL AND decided_at IS NOT NULL AND decided_by<>submitted_by)
 )
);
CREATE INDEX sdl_final_approval_status_idx ON sdl_urmin_final_approvals(status,submitted_at DESC);
