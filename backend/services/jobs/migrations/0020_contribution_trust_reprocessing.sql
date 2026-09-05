-- Remember the authoritative decision actually completed, not whichever decision
-- happened to arrive while an earlier processing attempt was still in flight.
ALTER TABLE jobs.job_contribution_processing_queue
  ADD COLUMN completed_trust_decision_id uuid
    REFERENCES jobs.job_contribution_trust_decisions(id);

-- Existing completed rows have NULL markers. Only actionable authoritative
-- decisions can wake them: an unconsumed acceptance before publication, or an
-- unconsumed withdrawal/takedown. No provider signal can reset terminal work.
CREATE FUNCTION jobs.contribution_requires_trust_processing(target uuid, completed_decision uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM (
      SELECT id, status FROM jobs.job_contribution_trust_decisions
      WHERE contribution_id = target ORDER BY decided_at DESC, id DESC LIMIT 1
    ) AS decision
    WHERE decision.id IS DISTINCT FROM completed_decision
      AND NOT EXISTS (SELECT 1 FROM jobs.job_contribution_state_events
        WHERE contribution_id = target AND state = 'consent_invalid')
      AND (
        (decision.status = 'accepted' AND NOT EXISTS (
          SELECT 1 FROM jobs.job_contribution_reconciliations
          WHERE contribution_id = target AND kind = 'publication' AND state = 'applied'
        )) OR
        (decision.status IN ('withdrawn', 'taken_down') AND NOT EXISTS (
          SELECT 1 FROM jobs.job_contribution_reconciliations
          WHERE contribution_id = target AND kind = 'removal' AND state = 'applied'
            AND trust_decision_id = decision.id
        ))
      )
  )
$$;

REVOKE ALL ON FUNCTION jobs.contribution_requires_trust_processing(uuid, uuid) FROM PUBLIC;

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
      OR NEW.completed_trust_decision_id IS NOT NULL THEN
      RAISE EXCEPTION 'job contribution processing queue must begin pending'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state = 'dead' THEN
    RAISE EXCEPTION 'exhausted job contribution processing work is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id <> OLD.id OR NEW.contribution_id <> OLD.contribution_id
    OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at
    OR (OLD.state NOT IN ('parked', 'completed') AND NEW.attempt < OLD.attempt)
    OR NEW.attempt > OLD.attempt + 1 THEN
    RAISE EXCEPTION 'job contribution processing queue identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.completed_trust_decision_id IS DISTINCT FROM OLD.completed_trust_decision_id AND NOT (
    OLD.state = 'claimed' AND NEW.state = 'completed'
    AND (NEW.completed_trust_decision_id IS NULL OR EXISTS (
      SELECT 1 FROM jobs.job_contribution_trust_decisions
      WHERE id = NEW.completed_trust_decision_id AND contribution_id = NEW.contribution_id
    ))
  ) THEN
    RAISE EXCEPTION 'completed Trust decision must bind the owned processing attempt'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'completed' AND NOT (
    NEW.state = 'pending' AND NEW.attempt = 0 AND NEW.last_error_code IS NULL
    AND jobs.contribution_requires_trust_processing(OLD.contribution_id, OLD.completed_trust_decision_id)
  ) THEN
    RAISE EXCEPTION 'completed contribution work requires a new actionable Trust decision'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'pending' AND NOT (
    NEW.state = 'claimed' AND NEW.attempt = OLD.attempt + 1 AND NEW.last_error_code IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid job contribution processing claim transition'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'claimed' AND NOT (
    NEW.state IN ('pending', 'parked', 'completed', 'dead') AND NEW.attempt = OLD.attempt
  ) THEN
    RAISE EXCEPTION 'invalid job contribution processing completion transition'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'parked' AND NOT (
    NEW.state = 'pending' AND NEW.attempt = 0 AND NEW.last_error_code IS NULL
  ) THEN
    RAISE EXCEPTION 'parked job contribution work requires an explicit signal'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
