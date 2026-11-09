-- R3D1: one immutable review per completed disposition. No legacy row changes.
INSERT INTO sdl_permissions(permission_key,description) VALUES
 ('urmin.disposisi.review','Pemberi tugas berwenang menilai hasil disposisi yang telah selesai')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE sdl_urmin_disposition_reviews (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 disposition_id UUID NOT NULL UNIQUE REFERENCES sdl_urmin_disposition_tasks(id) ON DELETE RESTRICT,
 reviewed_by UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 decision VARCHAR(32) NOT NULL CHECK(decision IN ('approved','revision_requested')),
 reason VARCHAR(1000) NOT NULL CHECK(length(btrim(reason)) BETWEEN 8 AND 1000),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sdl_disposition_reviews_actor_idx ON sdl_urmin_disposition_reviews(reviewed_by,created_at DESC);
