-- D2 source-aware revalidation foundation. Timing and policy values are injected by the
-- application; this migration contains no production freshness or retry defaults.
CREATE TABLE jobs.source_revalidation_queue (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES jobs.job_sources(id) ON DELETE CASCADE,
  provider text NOT NULL,
  page_variant text NOT NULL,
  signal_kind text NOT NULL,
  signal_digest_sha256 text NOT NULL,
  priority smallint NOT NULL,
  state text NOT NULL,
  attempt integer NOT NULL,
  max_attempts integer NOT NULL,
  available_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claimed_by text,
  last_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT source_revalidation_queue_source_identity_uq UNIQUE (source_id, signal_digest_sha256),
  CONSTRAINT source_revalidation_queue_provider_ck CHECK (
    (provider = 'greenhouse' AND page_variant = 'greenhouse-board-v1') OR
    (provider = 'lever' AND page_variant = 'lever-posting-v1') OR
    (provider = 'ashby' AND page_variant = 'ashby-job-board-v1')
  ),
  CONSTRAINT source_revalidation_queue_signal_kind_ck CHECK (
    signal_kind IN ('community_observation', 'candidate_closed_report', 'policy_suspect')
  ),
  CONSTRAINT source_revalidation_queue_digest_ck CHECK (
    signal_digest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT source_revalidation_queue_priority_ck CHECK (priority IN (1, 2)),
  CONSTRAINT source_revalidation_queue_state_ck CHECK (
    state IN ('pending', 'claimed', 'completed', 'dead')
  ),
  CONSTRAINT source_revalidation_queue_attempt_ck CHECK (
    attempt BETWEEN 0 AND max_attempts AND max_attempts BETWEEN 1 AND 5
  ),
  CONSTRAINT source_revalidation_queue_claim_ck CHECK (
    (state = 'claimed' AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL
      AND claim_expires_at > claimed_at AND claimed_by IS NOT NULL
      AND claimed_by = btrim(claimed_by)
      AND char_length(claimed_by) BETWEEN 3 AND 100
      AND claimed_by ~ '^[A-Za-z0-9:_-]+$')
    OR
    (state <> 'claimed' AND claimed_at IS NULL AND claim_expires_at IS NULL AND claimed_by IS NULL)
  ),
  CONSTRAINT source_revalidation_queue_error_ck CHECK (
    last_error_code IS NULL OR (
      last_error_code = btrim(last_error_code)
      AND char_length(last_error_code) BETWEEN 3 AND 100
      AND last_error_code ~ '^[A-Za-z0-9_.:-]+$'
    )
  ),
  CONSTRAINT source_revalidation_queue_chronology_ck CHECK (
    available_at >= created_at AND updated_at >= created_at
  )
);

CREATE INDEX source_revalidation_queue_claim_idx
  ON jobs.source_revalidation_queue (priority DESC, available_at, created_at, id)
  WHERE state = 'pending';
CREATE INDEX source_revalidation_queue_lease_idx
  ON jobs.source_revalidation_queue (claim_expires_at, id)
  WHERE state = 'claimed';
CREATE INDEX source_revalidation_queue_job_idx
  ON jobs.source_revalidation_queue (job_id, created_at DESC, id);

CREATE FUNCTION jobs.guard_source_revalidation_queue()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'source revalidation queue records require controlled retention cleanup'
      USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.attempt <> 0 OR NEW.last_error_code IS NOT NULL THEN
      RAISE EXCEPTION 'source revalidation queue must begin pending' USING ERRCODE = '55000';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jobs.job_sources source
      WHERE source.id = NEW.source_id AND source.job_id = NEW.job_id
        AND source.provider = NEW.provider
    ) THEN
      RAISE EXCEPTION 'source revalidation identity does not match catalog truth'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('completed', 'dead') THEN
    RAISE EXCEPTION 'terminal source revalidation queue records are immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id <> OLD.id OR NEW.job_id <> OLD.job_id OR NEW.source_id <> OLD.source_id
     OR NEW.provider <> OLD.provider OR NEW.page_variant <> OLD.page_variant
     OR NEW.signal_kind <> OLD.signal_kind
     OR NEW.signal_digest_sha256 <> OLD.signal_digest_sha256
     OR NEW.priority <> OLD.priority OR NEW.max_attempts <> OLD.max_attempts
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'source revalidation queue identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'pending' AND NOT (
    NEW.state = 'claimed' AND NEW.attempt = OLD.attempt + 1 AND NEW.last_error_code IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid source revalidation claim transition' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'claimed' AND NOT (
    NEW.state IN ('pending', 'completed', 'dead') AND NEW.attempt = OLD.attempt
  ) THEN
    RAISE EXCEPTION 'invalid source revalidation completion transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER source_revalidation_queue_guard
BEFORE INSERT OR UPDATE OR DELETE ON jobs.source_revalidation_queue
FOR EACH ROW EXECUTE FUNCTION jobs.guard_source_revalidation_queue();

CREATE TABLE jobs.source_verification_evidence (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id) ON DELETE CASCADE,
  source_id uuid REFERENCES jobs.job_sources(id) ON DELETE CASCADE,
  provider text,
  page_variant text,
  evidence_kind text NOT NULL,
  evidence_digest_sha256 text NOT NULL,
  policy_version text NOT NULL,
  verified_at timestamptz NOT NULL,
  valid_through timestamptz,
  recorded_at timestamptz NOT NULL,
  CONSTRAINT source_verification_evidence_digest_uq UNIQUE (evidence_digest_sha256),
  CONSTRAINT source_verification_evidence_kind_ck CHECK (
    evidence_kind IN (
      'independent_positive_verification',
      'independent_closed_verification',
      'authorized_administrative_block'
    )
  ),
  CONSTRAINT source_verification_evidence_boundary_ck CHECK (
    (
      evidence_kind IN ('independent_positive_verification', 'independent_closed_verification')
      AND source_id IS NOT NULL
      AND (
        (provider = 'greenhouse' AND page_variant = 'greenhouse-board-v1') OR
        (provider = 'lever' AND page_variant = 'lever-posting-v1') OR
        (provider = 'ashby' AND page_variant = 'ashby-job-board-v1')
      )
    ) OR (
      evidence_kind = 'authorized_administrative_block'
      AND source_id IS NULL AND provider IS NULL AND page_variant IS NULL
    )
  ),
  CONSTRAINT source_verification_evidence_digest_ck CHECK (
    evidence_digest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT source_verification_evidence_policy_ck CHECK (
    policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
  ),
  CONSTRAINT source_verification_evidence_chronology_ck CHECK (
    (valid_through IS NULL OR valid_through >= verified_at) AND recorded_at >= verified_at
  )
);

CREATE INDEX source_verification_evidence_job_idx
  ON jobs.source_verification_evidence (job_id, verified_at DESC, id);
CREATE INDEX source_verification_evidence_source_idx
  ON jobs.source_verification_evidence (source_id, verified_at DESC, id)
  WHERE source_id IS NOT NULL;

CREATE FUNCTION jobs.guard_source_verification_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM jobs.job_sources source
      WHERE source.id = NEW.source_id AND source.job_id = NEW.job_id
        AND source.provider = NEW.provider
    ) THEN
      RAISE EXCEPTION 'source verification identity does not match catalog truth'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'source verification evidence is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER source_verification_evidence_append_only
BEFORE INSERT OR UPDATE OR DELETE ON jobs.source_verification_evidence
FOR EACH ROW EXECUTE FUNCTION jobs.guard_source_verification_evidence();
