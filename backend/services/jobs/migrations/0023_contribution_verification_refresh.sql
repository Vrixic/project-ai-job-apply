-- Preserve all historical singleton evidence before admitting append-only refresh generations.
-- No contributor payload, Trust case, decision, or evidence timestamp is rewritten.
ALTER TABLE jobs.job_contribution_trust_decisions ADD COLUMN evidence_digest_sha256 text;
-- The old schema guaranteed exactly one proof. This backfill makes its formerly implicit
-- acceptance binding explicit, before either singleton constraint is removed.
DROP TRIGGER job_contribution_trust_decisions_append_only ON jobs.job_contribution_trust_decisions;
UPDATE jobs.job_contribution_trust_decisions AS decision
SET evidence_digest_sha256 = verification.evidence_digest_sha256
FROM jobs.job_contribution_independent_verifications AS verification
WHERE decision.contribution_id = verification.contribution_id AND decision.status = 'accepted';
CREATE TRIGGER job_contribution_trust_decisions_append_only
BEFORE UPDATE OR DELETE ON jobs.job_contribution_trust_decisions
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_processing_append_only();
ALTER TABLE jobs.job_contribution_trust_decisions
  ADD CONSTRAINT job_contribution_trust_decisions_evidence_ck CHECK (
    evidence_digest_sha256 IS NULL OR evidence_digest_sha256 ~ '^[a-f0-9]{64}$'
  );

ALTER TABLE jobs.job_contribution_independent_verifications
  DROP CONSTRAINT job_contribution_independent_verifications_contribution_id_key,
  DROP CONSTRAINT job_contribution_independent_verifications_normalization_id_key,
  ADD CONSTRAINT job_contribution_verification_digest_uq UNIQUE (contribution_id, evidence_digest_sha256);
CREATE INDEX job_contribution_verification_latest_idx
  ON jobs.job_contribution_independent_verifications (contribution_id, verified_at DESC, id DESC);

ALTER TABLE jobs.job_contribution_processing_queue
  ADD COLUMN verification_refresh_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN last_verification_refresh_at timestamptz,
  ADD COLUMN verification_refresh_outcome text,
  ADD CONSTRAINT job_contribution_verification_refresh_ck CHECK (
    verification_refresh_attempts BETWEEN 0 AND 3 AND (
      (verification_refresh_attempts = 0 AND last_verification_refresh_at IS NULL
        AND verification_refresh_outcome IS NULL) OR
      (verification_refresh_attempts > 0 AND last_verification_refresh_at IS NOT NULL
        AND isfinite(last_verification_refresh_at) AND verification_refresh_outcome IS NOT NULL
        AND verification_refresh_outcome IN ('pending', 'verified', 'unavailable', 'mismatch', 'closed', 'superseded'))
    )
  );

CREATE OR REPLACE FUNCTION jobs.guard_job_contribution_processing_queue()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT owner_user_id INTO candidate_user_id
    FROM jobs.job_contributions WHERE id = OLD.contribution_id;
    IF candidate_user_id IS NULL
      OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
      RAISE EXCEPTION 'job contribution processing queue requires candidate deletion authority'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.attempt <> 0 OR NEW.last_error_code IS NOT NULL
      OR NEW.completed_trust_decision_id IS NOT NULL OR NEW.verification_refresh_attempts <> 0 THEN
      RAISE EXCEPTION 'job contribution processing queue must begin pending' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'dead' THEN
    RAISE EXCEPTION 'exhausted job contribution processing work is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.id <> OLD.id OR NEW.contribution_id <> OLD.contribution_id
    OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at
    OR (OLD.state NOT IN ('parked', 'completed') AND NEW.attempt < OLD.attempt)
    OR NEW.attempt > OLD.attempt + 1 THEN
    RAISE EXCEPTION 'job contribution processing queue identity is immutable' USING ERRCODE = '55000';
  END IF;
  -- Only a currently leased attempt can reserve/complete a refresh. Lease identity and
  -- ordinary queue state cannot change in the same metadata update. Lifetime budget never resets.
  IF NEW.verification_refresh_attempts IS DISTINCT FROM OLD.verification_refresh_attempts
    OR NEW.last_verification_refresh_at IS DISTINCT FROM OLD.last_verification_refresh_at
    OR NEW.verification_refresh_outcome IS DISTINCT FROM OLD.verification_refresh_outcome THEN
    IF OLD.state <> 'claimed' OR NEW.state <> 'claimed'
      OR (to_jsonb(NEW) - ARRAY['verification_refresh_attempts','last_verification_refresh_at','verification_refresh_outcome'])
        IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['verification_refresh_attempts','last_verification_refresh_at','verification_refresh_outcome'])
      OR NOT (
        (NEW.verification_refresh_attempts = OLD.verification_refresh_attempts + 1
          AND NEW.verification_refresh_outcome = 'pending'
          AND (OLD.last_verification_refresh_at IS NULL OR
            NEW.last_verification_refresh_at >= OLD.last_verification_refresh_at + interval '1 hour')) OR
        (NEW.verification_refresh_attempts = OLD.verification_refresh_attempts
          AND NEW.last_verification_refresh_at = OLD.last_verification_refresh_at
          AND OLD.verification_refresh_outcome = 'pending'
          AND NEW.verification_refresh_outcome IN ('verified','unavailable','mismatch','closed','superseded'))
      ) THEN
      RAISE EXCEPTION 'invalid bounded contribution verification refresh' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.completed_trust_decision_id IS DISTINCT FROM OLD.completed_trust_decision_id AND NOT (
    OLD.state = 'claimed' AND NEW.state = 'completed'
    AND (NEW.completed_trust_decision_id IS NULL OR EXISTS (
      SELECT 1 FROM jobs.job_contribution_trust_decisions
      WHERE id = NEW.completed_trust_decision_id AND contribution_id = NEW.contribution_id
    ))
  ) THEN
    RAISE EXCEPTION 'completed Trust decision must bind the owned processing attempt' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'completed' AND NOT (
    NEW.state = 'pending' AND NEW.attempt = 0 AND NEW.last_error_code IS NULL
    AND jobs.contribution_requires_trust_processing(OLD.contribution_id, OLD.completed_trust_decision_id)
  ) THEN
    RAISE EXCEPTION 'completed contribution work requires a new actionable Trust decision' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'pending' AND NOT (
    NEW.state = 'claimed' AND NEW.attempt = OLD.attempt + 1 AND NEW.last_error_code IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid job contribution processing claim transition' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'claimed' AND NOT (
    NEW.state IN ('pending', 'parked', 'completed', 'dead') AND NEW.attempt = OLD.attempt
  ) THEN
    RAISE EXCEPTION 'invalid job contribution processing completion transition' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'parked' AND NOT (
    NEW.state = 'pending' AND NEW.attempt = 0 AND NEW.last_error_code IS NULL
  ) THEN
    RAISE EXCEPTION 'parked job contribution work requires an explicit signal' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
