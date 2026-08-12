CREATE TABLE IF NOT EXISTS profile.profile_facts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS profile_facts_user_created_idx
  ON profile.profile_facts(user_id, created_at, id);

CREATE OR REPLACE FUNCTION profile.is_valid_profile_fact_value(candidate jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE jsonb_typeof(candidate)
    WHEN 'string' THEN
      char_length(candidate #>> '{}') BETWEEN 1 AND 10000
      AND (candidate #>> '{}') ~ '\S'
    WHEN 'number' THEN true
    WHEN 'boolean' THEN true
    WHEN 'array' THEN
      jsonb_array_length(candidate) BETWEEN 1 AND 100
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(candidate) AS item
        WHERE jsonb_typeof(item) <> 'string'
          OR char_length(item #>> '{}') NOT BETWEEN 1 AND 500
          OR (item #>> '{}') !~ '\S'
      )
    ELSE false
  END
$$;

CREATE TABLE IF NOT EXISTS profile.profile_fact_versions (
  fact_id uuid NOT NULL REFERENCES profile.profile_facts(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  kind text NOT NULL CHECK (
    kind IN ('identity', 'employment', 'education', 'project', 'skill', 'certification', 'preference')
  ),
  fact_key text NOT NULL CHECK (char_length(fact_key) BETWEEN 1 AND 120 AND fact_key ~ '\S'),
  fact_value jsonb NOT NULL CHECK (
    profile.is_valid_profile_fact_value(fact_value)
    AND pg_column_size(fact_value) <= 65536
  ),
  verification text NOT NULL CHECK (verification IN ('proposed', 'confirmed', 'rejected')),
  sensitivity text NOT NULL CHECK (sensitivity IN ('standard', 'confidential', 'restricted')),
  source_type text NOT NULL CHECK (source_type IN ('user', 'resume', 'import', 'derived')),
  source_reference text NOT NULL CHECK (
    char_length(source_reference) BETWEEN 1 AND 200 AND source_reference ~ '\S'
  ),
  effective_from date,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (fact_id, version),
  CHECK (effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS profile_fact_versions_latest_idx
  ON profile.profile_fact_versions(fact_id, version DESC);

CREATE OR REPLACE FUNCTION profile.reject_profile_fact_version_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'profile fact versions are immutable'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS profile_fact_versions_reject_update
  ON profile.profile_fact_versions;
CREATE TRIGGER profile_fact_versions_reject_update
BEFORE UPDATE ON profile.profile_fact_versions
FOR EACH ROW
EXECUTE FUNCTION profile.reject_profile_fact_version_update();
