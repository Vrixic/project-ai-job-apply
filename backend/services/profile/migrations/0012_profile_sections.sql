-- Structured candidate Profile (ADR-052). Plain saved records, append-only versions, owner scoped.
-- Standard sensitivity only; restricted answers stay in profile.restricted_answers.

CREATE TABLE IF NOT EXISTS profile.personal_versions (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content jsonb NOT NULL CHECK (
    jsonb_typeof(content) = 'object'
    AND pg_column_size(content) <= 16384
    AND content - ARRAY['fullName', 'email', 'phone', 'address', 'links'] = '{}'::jsonb
  ),
  origin text NOT NULL CHECK (origin IN ('entered', 'imported')),
  import_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, version),
  CHECK ((origin = 'imported') = (import_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS profile.entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  section text NOT NULL CHECK (
    section IN ('education', 'workExperience', 'skill', 'applicationAnswer')
  ),
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order BETWEEN 0 AND 999),
  natural_key text CHECK (natural_key IS NULL OR char_length(natural_key) BETWEEN 1 AND 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((section IN ('skill', 'applicationAnswer')) = (natural_key IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS profile_entries_user_section_idx
  ON profile.entries(user_id, section, display_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS profile_entries_natural_key_idx
  ON profile.entries(user_id, section, natural_key)
  WHERE natural_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS profile.entry_versions (
  entry_id uuid NOT NULL REFERENCES profile.entries(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content jsonb NOT NULL CHECK (
    jsonb_typeof(content) = 'object' AND pg_column_size(content) <= 32768
  ),
  origin text NOT NULL CHECK (origin IN ('entered', 'imported')),
  import_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entry_id, version),
  CHECK ((origin = 'imported') = (import_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS profile.import_drafts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  import_id uuid NOT NULL,
  section text NOT NULL CHECK (section IN ('personal', 'education', 'workExperience', 'skill')),
  draft_values jsonb NOT NULL CHECK (
    jsonb_typeof(draft_values) = 'object' AND pg_column_size(draft_values) <= 32768
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_import_drafts_user_idx
  ON profile.import_drafts(user_id, created_at, id);

CREATE OR REPLACE FUNCTION profile.reject_profile_section_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'profile section versions are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS personal_versions_reject_update ON profile.personal_versions;
CREATE TRIGGER personal_versions_reject_update
BEFORE UPDATE ON profile.personal_versions
FOR EACH ROW
EXECUTE FUNCTION profile.reject_profile_section_version_update();

DROP TRIGGER IF EXISTS entry_versions_reject_update ON profile.entry_versions;
CREATE TRIGGER entry_versions_reject_update
BEFORE UPDATE ON profile.entry_versions
FOR EACH ROW
EXECUTE FUNCTION profile.reject_profile_section_version_update();

-- Defense in depth: the API validates strictly, and the database refuses unknown keys, missing
-- required keys, over-long bullets and reversed date ranges for every section.
CREATE OR REPLACE FUNCTION profile.validate_entry_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  entry_section text;
  allowed text[];
  required text[];
  required_key text;
  bullet jsonb;
BEGIN
  SELECT section INTO entry_section FROM profile.entries WHERE id = NEW.entry_id;
  IF entry_section IS NULL THEN
    RAISE EXCEPTION 'profile entry not found' USING ERRCODE = '23503';
  END IF;
  IF entry_section = 'education' THEN
    allowed := ARRAY['school', 'degree', 'fieldOfStudy', 'startDate', 'endDate'];
    required := ARRAY['school'];
  ELSIF entry_section = 'workExperience' THEN
    allowed := ARRAY['company', 'title', 'location', 'startDate', 'endDate', 'bullets'];
    required := ARRAY['company', 'title', 'startDate'];
  ELSIF entry_section = 'skill' THEN
    allowed := ARRAY['name', 'category'];
    required := ARRAY['name'];
  ELSE
    allowed := ARRAY['question', 'answer'];
    required := ARRAY['question', 'answer'];
  END IF;
  IF NEW.content - allowed <> '{}'::jsonb THEN
    RAISE EXCEPTION 'profile entry has an unknown field' USING ERRCODE = '23514';
  END IF;
  FOREACH required_key IN ARRAY required LOOP
    IF jsonb_typeof(NEW.content -> required_key) IS DISTINCT FROM 'string'
      OR (NEW.content ->> required_key) !~ '\S' THEN
      RAISE EXCEPTION 'profile entry is missing a required field' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF NEW.content ? 'startDate' AND NEW.content ? 'endDate'
    AND (NEW.content ->> 'endDate') < (NEW.content ->> 'startDate') THEN
    RAISE EXCEPTION 'profile entry date range is reversed' USING ERRCODE = '23514';
  END IF;
  IF NEW.content ? 'bullets' THEN
    IF jsonb_typeof(NEW.content -> 'bullets') <> 'array'
      OR jsonb_array_length(NEW.content -> 'bullets') > 20 THEN
      RAISE EXCEPTION 'profile entry bullets are invalid' USING ERRCODE = '23514';
    END IF;
    FOR bullet IN SELECT value FROM jsonb_array_elements(NEW.content -> 'bullets') LOOP
      IF jsonb_typeof(bullet) <> 'string'
        OR char_length(bullet #>> '{}') NOT BETWEEN 1 AND 500
        OR (bullet #>> '{}') !~ '\S' THEN
        RAISE EXCEPTION 'profile entry bullets are invalid' USING ERRCODE = '23514';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entry_versions_validate_insert ON profile.entry_versions;
CREATE TRIGGER entry_versions_validate_insert
BEFORE INSERT ON profile.entry_versions
FOR EACH ROW
EXECUTE FUNCTION profile.validate_entry_version();
