-- R5F23B - Private attachments for direct Arahan Pimpinan, 100 MiB per file.
-- Draft uploads remain with the issuer until the directive is sent.
CREATE TABLE IF NOT EXISTS sdl_leadership_directive_files (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 issuer_id UUID NOT NULL REFERENCES sdl_users(id) ON DELETE RESTRICT,
 directive_id UUID REFERENCES sdl_leadership_directives(id) ON DELETE RESTRICT,
 filename VARCHAR(180) NOT NULL,
 mime_type VARCHAR(32) NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
 size_bytes BIGINT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600),
 sha256 CHAR(64) NOT NULL,
 file_data BYTEA NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CONSTRAINT directive_file_size_matches CHECK (octet_length(file_data) = size_bytes)
);
CREATE INDEX IF NOT EXISTS sdl_directive_files_owner_draft_idx ON sdl_leadership_directive_files(issuer_id,created_at) WHERE directive_id IS NULL;
CREATE INDEX IF NOT EXISTS sdl_directive_files_sent_idx ON sdl_leadership_directive_files(directive_id,created_at) WHERE directive_id IS NOT NULL;
