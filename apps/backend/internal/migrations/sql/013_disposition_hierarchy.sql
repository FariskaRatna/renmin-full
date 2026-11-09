-- R3D2: additive parent-child link, existing tasks remain roots (depth=0).
-- Existing permissions, grants, task status and review history are preserved.
INSERT INTO sdl_permissions(permission_key,description) VALUES
 ('urmin.disposisi.forward','Penerima tugas dapat meneruskan disposisi secara berjenjang kepada petugas yang ditunjuk dalam unit yang sama')
ON CONFLICT (permission_key) DO NOTHING;

ALTER TABLE sdl_urmin_disposition_tasks
 ADD COLUMN parent_task_id UUID REFERENCES sdl_urmin_disposition_tasks(id) ON DELETE RESTRICT,
 ADD COLUMN depth SMALLINT NOT NULL DEFAULT 0 CHECK(depth BETWEEN 0 AND 2);

CREATE INDEX sdl_disposition_parent_idx ON sdl_urmin_disposition_tasks(parent_task_id,created_at,id) WHERE parent_task_id IS NOT NULL;
CREATE UNIQUE INDEX sdl_disposition_child_open_idx ON sdl_urmin_disposition_tasks(parent_task_id,assigned_to) WHERE parent_task_id IS NOT NULL AND status IN ('pending','in_progress');
