-- Keep immutable processing events separate from their mutable delivery lifecycle. A transport
-- retry always republishes the same event identifier; delivery state never alters event truth.
CREATE TABLE jobs.job_contribution_processing_event_deliveries (
  event_id uuid PRIMARY KEY
    REFERENCES jobs.job_contribution_processing_outbox(id) ON DELETE CASCADE,
  state text NOT NULL,
  attempt integer NOT NULL,
  available_at timestamptz NOT NULL,
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claimed_by text,
  last_error_code text,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT job_contribution_processing_event_deliveries_state_ck CHECK (
    state IN ('pending', 'claimed', 'published', 'dead')
  ),
  CONSTRAINT job_contribution_processing_event_deliveries_attempt_ck CHECK (
    attempt BETWEEN 0 AND 5
  ),
  CONSTRAINT job_contribution_processing_event_deliveries_claim_ck CHECK (
    (
      state = 'claimed' AND claim_token IS NOT NULL AND claimed_at IS NOT NULL
      AND claim_expires_at IS NOT NULL AND claim_expires_at > claimed_at
      AND claimed_by IS NOT NULL AND claimed_by = btrim(claimed_by)
      AND char_length(claimed_by) BETWEEN 3 AND 100
      AND claimed_by ~ '^[A-Za-z0-9:_-]+$' AND acknowledged_at IS NULL
    ) OR (
      state = 'published' AND claim_token IS NOT NULL AND claimed_at IS NULL
      AND claim_expires_at IS NULL AND claimed_by IS NULL
      AND acknowledged_at IS NOT NULL AND acknowledged_at >= created_at
    ) OR (
      state IN ('pending', 'dead') AND claim_token IS NULL AND claimed_at IS NULL
      AND claim_expires_at IS NULL AND claimed_by IS NULL AND acknowledged_at IS NULL
    )
  ),
  CONSTRAINT job_contribution_processing_event_deliveries_error_ck CHECK (
    last_error_code IS NULL OR last_error_code IN ('lease_expired', 'transport_unavailable')
  ),
  CONSTRAINT job_contribution_processing_event_deliveries_terminal_ck CHECK (
    (state = 'published' AND last_error_code IS NULL)
    OR (state = 'dead' AND last_error_code IS NOT NULL)
    OR state IN ('pending', 'claimed')
  ),
  CONSTRAINT job_contribution_processing_event_deliveries_chronology_ck CHECK (
    available_at >= created_at AND updated_at >= created_at
  )
);

CREATE INDEX job_contribution_processing_event_deliveries_claim_idx
  ON jobs.job_contribution_processing_event_deliveries (available_at, created_at, event_id)
  WHERE state = 'pending';
CREATE INDEX job_contribution_processing_event_deliveries_lease_idx
  ON jobs.job_contribution_processing_event_deliveries (claim_expires_at, event_id)
  WHERE state = 'claimed';

-- Existing immutable events become pending without inventing a policy clock or delivery attempt.
INSERT INTO jobs.job_contribution_processing_event_deliveries (
  event_id, state, attempt, available_at, created_at, updated_at
)
SELECT event.id, 'pending', 0, event.created_at, event.created_at, event.created_at
FROM jobs.job_contribution_processing_outbox AS event
ON CONFLICT (event_id) DO NOTHING;

CREATE FUNCTION jobs.guard_job_contribution_processing_event_delivery()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT contribution.owner_user_id INTO candidate_user_id
    FROM jobs.job_contribution_processing_outbox AS event
    JOIN jobs.job_contributions AS contribution ON contribution.id = event.contribution_id
    WHERE event.id = OLD.event_id;
    IF candidate_user_id IS NULL
      OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
      RAISE EXCEPTION 'job contribution event delivery requires candidate deletion authority'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.attempt <> 0 OR NEW.last_error_code IS NOT NULL
      OR NEW.claim_token IS NOT NULL OR NEW.acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION 'job contribution event delivery must begin pending'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('published', 'dead') THEN
    RAISE EXCEPTION 'terminal job contribution event delivery is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.event_id <> OLD.event_id OR NEW.created_at <> OLD.created_at
    OR NEW.attempt < OLD.attempt OR NEW.attempt > OLD.attempt + 1 THEN
    RAISE EXCEPTION 'job contribution event delivery identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'pending' AND NOT (
    NEW.state = 'claimed' AND NEW.attempt = OLD.attempt + 1
    AND NEW.last_error_code IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid job contribution event delivery claim'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'claimed' AND NOT (
    NEW.state IN ('pending', 'published', 'dead') AND NEW.attempt = OLD.attempt
  ) THEN
    RAISE EXCEPTION 'invalid job contribution event delivery completion'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_contribution_processing_event_deliveries_guard
BEFORE INSERT OR UPDATE OR DELETE ON jobs.job_contribution_processing_event_deliveries
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_processing_event_delivery();

CREATE OR REPLACE FUNCTION jobs.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs, privacy
AS $$
DECLARE
  reports_deleted integer;
  contribution_outbox_deleted integer;
  processing_delivery_deleted integer;
  processing_outbox_deleted integer;
  processing_queue_deleted integer;
  reconciliations_deleted integer;
  state_events_deleted integer;
  trust_decisions_deleted integer;
  independent_verifications_deleted integer;
  normalizations_deleted integer;
  contributions_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);

  DELETE FROM jobs.job_contribution_processing_event_deliveries AS delivery
  USING jobs.job_contribution_processing_outbox AS event,
    jobs.job_contributions AS contribution
  WHERE delivery.event_id = event.id AND event.contribution_id = contribution.id
    AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS processing_delivery_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_processing_outbox AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS processing_outbox_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_processing_queue AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS processing_queue_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_reconciliations AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS reconciliations_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_state_events AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS state_events_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_trust_decisions AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS trust_decisions_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_independent_verifications AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS independent_verifications_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_normalizations AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS normalizations_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_outbox AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS contribution_outbox_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contributions WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS contributions_deleted = ROW_COUNT;
  DELETE FROM jobs.job_reports WHERE reporter_user_id = candidate_user_id;
  GET DIAGNOSTICS reports_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'owner', 'jobs', 'reportsDeleted', reports_deleted,
    'contributionsDeleted', contributions_deleted,
    'contributionOutboxDeleted', contribution_outbox_deleted,
    'processingEventDeliveriesDeleted', processing_delivery_deleted,
    'processingOutboxDeleted', processing_outbox_deleted,
    'processingQueueDeleted', processing_queue_deleted,
    'reconciliationsDeleted', reconciliations_deleted,
    'stateEventsDeleted', state_events_deleted,
    'trustDecisionsDeleted', trust_decisions_deleted,
    'independentVerificationsDeleted', independent_verifications_deleted,
    'normalizationsDeleted', normalizations_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION jobs.guard_job_contribution_processing_event_delivery() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.delete_candidate_data(uuid, uuid) FROM PUBLIC;
