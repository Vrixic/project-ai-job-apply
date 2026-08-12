CREATE TABLE IF NOT EXISTS profile.resume_fact_imports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  document_version integer NOT NULL CHECK (document_version > 0),
  parser_version text NOT NULL CHECK (char_length(parser_version) BETWEEN 1 AND 64),
  proposal_digest text NOT NULL CHECK (proposal_digest ~ '^[a-f0-9]{64}$'),
  proposal_count integer NOT NULL CHECK (proposal_count BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_id, document_version, parser_version)
);

ALTER TABLE profile.profile_fact_versions
  ADD COLUMN IF NOT EXISTS availability_state text NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS availability_reason text;
ALTER TABLE profile.profile_fact_versions
  ADD CONSTRAINT profile_fact_versions_availability_check CHECK (
    (availability_state = 'available' AND availability_reason IS NULL)
    OR (availability_state = 'invalidated' AND availability_reason = 'source_security_hold')
  );

CREATE TABLE IF NOT EXISTS profile.profile_fact_evidence (
  fact_id uuid NOT NULL,
  fact_version integer NOT NULL CHECK (fact_version > 0),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  document_id uuid NOT NULL,
  document_version integer NOT NULL CHECK (document_version > 0),
  parser_version text NOT NULL CHECK (char_length(parser_version) BETWEEN 1 AND 64),
  block_index integer NOT NULL CHECK (block_index BETWEEN 0 AND 9999),
  start_offset integer NOT NULL CHECK (start_offset BETWEEN 0 AND 199999),
  end_offset integer NOT NULL CHECK (end_offset BETWEEN 1 AND 200000),
  page integer CHECK (page BETWEEN 1 AND 50),
  PRIMARY KEY (fact_id, fact_version, ordinal),
  FOREIGN KEY (fact_id, fact_version)
    REFERENCES profile.profile_fact_versions(fact_id, version) ON DELETE CASCADE,
  CHECK (end_offset > start_offset)
);
CREATE INDEX IF NOT EXISTS profile_fact_evidence_document_idx
  ON profile.profile_fact_evidence(document_id, document_version, fact_id);

CREATE OR REPLACE FUNCTION profile.reject_profile_fact_evidence_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'profile fact evidence is immutable' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS profile_fact_evidence_reject_update
  ON profile.profile_fact_evidence;
CREATE TRIGGER profile_fact_evidence_reject_update
BEFORE UPDATE ON profile.profile_fact_evidence
FOR EACH ROW
EXECUTE FUNCTION profile.reject_profile_fact_evidence_update();
