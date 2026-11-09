-- Role baca-saja untuk koneksi DBeaver sehari-hari. BUKAN migrasi: ini role
-- operasional, jangan dipindah ke apps/backend/internal/migrations/sql/.
--
-- Jalankan di server dari folder instalasi:
--   docker compose $CF exec -T db sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
--     < scripts/sql/dbeaver-readonly-role.sql
-- Lalu beri password (interaktif, tidak masuk history shell):
--   docker compose $CF exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\password sdl_readonly"'
--
-- Aman dijalankan ulang (mis. setelah migrasi menambah kolom di sdl_users).
--
-- Yang disembunyikan dari role ini:
--   sdl_users.password_hash            hash argon2id
--   sdl_sessions                       hash token sesi
--   sdl_login_challenges               hash OTP login
--   sdl_profile_email_challenges       hash OTP ganti email
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sdl_readonly') THEN
    CREATE ROLE sdl_readonly LOGIN;
  END IF;
END $$;

ALTER ROLE sdl_readonly SET default_transaction_read_only = on;

GRANT CONNECT ON DATABASE sdl_root_dev TO sdl_readonly;
GRANT USAGE ON SCHEMA public TO sdl_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO sdl_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO sdl_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE sdl_app IN SCHEMA public
  GRANT SELECT ON TABLES TO sdl_readonly;

REVOKE ALL ON sdl_sessions, sdl_login_challenges, sdl_profile_email_challenges
  FROM sdl_readonly;

-- sdl_users: semua kolom kecuali password_hash, dibaca dari skema yang ada.
REVOKE ALL ON sdl_users FROM sdl_readonly;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
    INTO cols
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'sdl_users'
     AND column_name <> 'password_hash';
  EXECUTE format('GRANT SELECT (%s) ON sdl_users TO sdl_readonly', cols);
END $$;

COMMIT;
