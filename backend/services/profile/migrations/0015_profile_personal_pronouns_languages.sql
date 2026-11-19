-- ADR-062: the personal record may also hold the candidate's pronouns and spoken languages.
-- Additive: every existing row already satisfies the wider check. The API validates the shapes
-- strictly; the database keeps refusing any other top-level key.

-- The original check was declared inline, so it is found by its definition rather than an assumed
-- name, and the migration fails if it cannot be replaced exactly.
DO $$
DECLARE
  existing record;
BEGIN
  FOR existing IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'profile.personal_versions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%fullName%'
  LOOP
    EXECUTE format('ALTER TABLE profile.personal_versions DROP CONSTRAINT %I', existing.conname);
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'profile.personal_versions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%fullName%'
  ) THEN
    RAISE EXCEPTION 'personal record key check was not replaced';
  END IF;
END;
$$;

ALTER TABLE profile.personal_versions
  ADD CONSTRAINT personal_versions_content_check CHECK (
    jsonb_typeof(content) = 'object'
    AND pg_column_size(content) <= 16384
    AND content - ARRAY['fullName', 'email', 'phone', 'address', 'links', 'pronouns', 'languages'] = '{}'::jsonb
  );
