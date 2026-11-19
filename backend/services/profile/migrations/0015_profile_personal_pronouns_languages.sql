-- ADR-062: the personal record may also hold the candidate's pronouns and spoken languages.
-- Additive: every existing row already satisfies the wider check. The API validates the shapes
-- strictly; the database keeps refusing any other top-level key.

ALTER TABLE profile.personal_versions
  DROP CONSTRAINT IF EXISTS personal_versions_content_check;

ALTER TABLE profile.personal_versions
  ADD CONSTRAINT personal_versions_content_check CHECK (
    jsonb_typeof(content) = 'object'
    AND pg_column_size(content) <= 16384
    AND content - ARRAY['fullName', 'email', 'phone', 'address', 'links', 'pronouns', 'languages'] = '{}'::jsonb
  );
