-- R5F16: widen ONLY incoming-letter attachment size limit from 5 MiB to 10 MiB.
-- Existing rows remain valid; do not alter data, ownership, or access rights.
ALTER TABLE sdl_urmin_incoming_attachments
 DROP CONSTRAINT sdl_urmin_incoming_attachments_size_bytes_check,
 ADD CONSTRAINT sdl_urmin_incoming_attachments_size_bytes_check
 CHECK (size_bytes BETWEEN 1 AND 10485760);
