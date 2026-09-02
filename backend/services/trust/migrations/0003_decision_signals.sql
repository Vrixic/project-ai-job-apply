-- Give every authoritative Trust transition one stable identifier and keep immutable event truth
-- separate from its mutable delivery lifecycle. The identifier is deterministic from the case and
-- version, so migration backfill and ambiguity-safe retries converge on the same value.
CREATE FUNCTION trust.case_transition_event_id(case_id uuid, case_version integer)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT (
    substr(md5('trust-case-transition-v1:' || case_id::text || ':' || case_version::text), 1, 12)
    || '8'
    || substr(md5('trust-case-transition-v1:' || case_id::text || ':' || case_version::text), 14, 3)
    || '8'
    || substr(md5('trust-case-transition-v1:' || case_id::text || ':' || case_version::text), 18, 15)
  )::uuid
$$;

DROP TRIGGER case_events_immutable ON trust.case_events;
ALTER TABLE trust.case_events ADD COLUMN event_id uuid;
UPDATE trust.case_events
SET event_id = trust.case_transition_event_id(case_id, case_version);
ALTER TABLE trust.case_events ALTER COLUMN event_id SET NOT NULL;
ALTER TABLE trust.case_events
  ADD CONSTRAINT case_events_event_id_uq UNIQUE (event_id);
CREATE TRIGGER case_events_immutable
BEFORE UPDATE ON trust.case_events
FOR EACH ROW EXECUTE FUNCTION trust.reject_immutable_evidence_mutation();

CREATE TABLE trust.contribution_decision_outbox (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL,
  case_version integer NOT NULL CHECK (case_version BETWEEN 1 AND 100),
  contribution_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type = 'trust.contribution-decision.changed.v1'),
  subject text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT contribution_decision_outbox_case_event_fk
    FOREIGN KEY (case_id, case_version)
    REFERENCES trust.case_events(case_id, case_version) ON DELETE RESTRICT,
  CONSTRAINT contribution_decision_outbox_event_identity_uq UNIQUE (case_id, case_version),
  CONSTRAINT contribution_decision_outbox_subject_ck CHECK (subject = contribution_id::text),
  CONSTRAINT contribution_decision_outbox_data_ck CHECK (
    data = jsonb_build_object(
      'decisionId', id::text,
      'contributionId', contribution_id::text
    )
  )
);

CREATE INDEX contribution_decision_outbox_created_idx
  ON trust.contribution_decision_outbox (created_at, id);

CREATE TABLE trust.contribution_decision_deliveries (
  event_id uuid PRIMARY KEY
    REFERENCES trust.contribution_decision_outbox(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('pending', 'claimed', 'published', 'dead')),
  attempt integer NOT NULL CHECK (attempt BETWEEN 0 AND 5),
  available_at timestamptz NOT NULL,
  claim_token uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claimed_by text,
  last_error_code text CHECK (
    last_error_code IS NULL OR last_error_code IN ('lease_expired', 'transport_unavailable')
  ),
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT contribution_decision_deliveries_claim_ck CHECK (
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
  CONSTRAINT contribution_decision_deliveries_terminal_ck CHECK (
    (state = 'published' AND last_error_code IS NULL)
    OR (state = 'dead' AND last_error_code IS NOT NULL)
    OR state IN ('pending', 'claimed')
  ),
  CONSTRAINT contribution_decision_deliveries_chronology_ck CHECK (
    available_at >= created_at AND updated_at >= created_at
  )
);

CREATE INDEX contribution_decision_deliveries_pending_idx
  ON trust.contribution_decision_deliveries (available_at, created_at, event_id)
  WHERE state = 'pending';
CREATE INDEX contribution_decision_deliveries_lease_idx
  ON trust.contribution_decision_deliveries (claim_expires_at, event_id)
  WHERE state = 'claimed';

-- Backfill existing append-only decisions without selecting a live delivery policy or transport.
INSERT INTO trust.contribution_decision_outbox (
  id, case_id, case_version, contribution_id, event_type, subject, data, created_at
)
SELECT event.event_id, event.case_id, event.case_version, event.contribution_id,
  'trust.contribution-decision.changed.v1', event.contribution_id::text,
  jsonb_build_object(
    'decisionId', event.event_id::text,
    'contributionId', event.contribution_id::text
  ), event.occurred_at
FROM trust.case_events AS event;

INSERT INTO trust.contribution_decision_deliveries (
  event_id, state, attempt, available_at, created_at, updated_at
)
SELECT event.id, 'pending', 0, event.created_at, event.created_at, event.created_at
FROM trust.contribution_decision_outbox AS event;

-- Future case transitions append their decision event and identifier-only outbox row atomically.
CREATE OR REPLACE FUNCTION trust.append_case_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transition_event_id uuid;
BEGIN
  transition_event_id := trust.case_transition_event_id(NEW.id, NEW.version);
  INSERT INTO trust.case_events (
    event_id, case_id, case_version, contribution_id, policy_version, prior_state,
    resulting_state, action, actor_kind, actor_id, reason_code, evidence_digest_sha256, occurred_at
  ) VALUES (
    transition_event_id, NEW.id, NEW.version, NEW.contribution_id, NEW.policy_version,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state, NEW.last_action, NEW.last_actor_kind, NEW.last_actor_id,
    NEW.last_reason_code, NEW.last_evidence_digest_sha256, NEW.updated_at
  );
  INSERT INTO trust.contribution_decision_outbox (
    id, case_id, case_version, contribution_id, event_type, subject, data, created_at
  ) VALUES (
    transition_event_id, NEW.id, NEW.version, NEW.contribution_id,
    'trust.contribution-decision.changed.v1', NEW.contribution_id::text,
    jsonb_build_object(
      'decisionId', transition_event_id::text,
      'contributionId', NEW.contribution_id::text
    ), NEW.updated_at
  );
  INSERT INTO trust.contribution_decision_deliveries (
    event_id, state, attempt, available_at, created_at, updated_at
  ) VALUES (
    transition_event_id, 'pending', 0, NEW.updated_at, NEW.updated_at, NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE FUNCTION trust.guard_contribution_decision_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    RAISE EXCEPTION 'trust contribution decision events are append-only' USING ERRCODE = '55000';
  END IF;
  SELECT contributor_user_id INTO candidate_user_id
  FROM trust.contribution_cases WHERE id = OLD.case_id;
  IF candidate_user_id IS NULL
    OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
    RAISE EXCEPTION 'trust contribution decision events are append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER contribution_decision_outbox_guard
BEFORE UPDATE OR DELETE ON trust.contribution_decision_outbox
FOR EACH ROW EXECUTE FUNCTION trust.guard_contribution_decision_outbox();

CREATE FUNCTION trust.guard_contribution_decision_delivery()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT trust_case.contributor_user_id INTO candidate_user_id
    FROM trust.contribution_decision_outbox AS event
    JOIN trust.contribution_cases AS trust_case ON trust_case.id = event.case_id
    WHERE event.id = OLD.event_id;
    IF candidate_user_id IS NULL
      OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
      RAISE EXCEPTION 'trust contribution decision delivery requires candidate deletion authority'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.attempt <> 0 OR NEW.last_error_code IS NOT NULL
      OR NEW.claim_token IS NOT NULL OR NEW.acknowledged_at IS NOT NULL THEN
      RAISE EXCEPTION 'trust contribution decision delivery must begin pending'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('published', 'dead') THEN
    RAISE EXCEPTION 'terminal trust contribution decision delivery is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.event_id <> OLD.event_id OR NEW.created_at <> OLD.created_at
    OR NEW.attempt < OLD.attempt OR NEW.attempt > OLD.attempt + 1 THEN
    RAISE EXCEPTION 'trust contribution decision delivery identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'pending' AND NOT (
    NEW.state = 'claimed' AND NEW.attempt = OLD.attempt + 1 AND NEW.last_error_code IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid trust contribution decision delivery claim'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'claimed' AND NOT (
    NEW.state IN ('pending', 'published', 'dead') AND NEW.attempt = OLD.attempt
  ) THEN
    RAISE EXCEPTION 'invalid trust contribution decision delivery completion'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contribution_decision_deliveries_guard
BEFORE INSERT OR UPDATE OR DELETE ON trust.contribution_decision_deliveries
FOR EACH ROW EXECUTE FUNCTION trust.guard_contribution_decision_delivery();

-- Candidate export includes the stable domain decision identifier but intentionally excludes the
-- transport outbox and delivery lifecycle.
CREATE OR REPLACE FUNCTION trust.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, trust
AS $$
  SELECT jsonb_build_object(
    'trust', jsonb_build_object(
      'schemaVersion', 1,
      'cases', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', trust_case.id,
          'contributionId', trust_case.contribution_id,
          'policyVersion', trust_case.policy_version,
          'appealWindowMilliseconds', trust_case.appeal_window_milliseconds,
          'state', trust_case.state,
          'version', trust_case.version,
          'appealCount', trust_case.appeal_count,
          'adverseState', trust_case.adverse_state,
          'adverseDecisionAt', trust_case.adverse_decision_at,
          'appealDeadlineAt', trust_case.appeal_deadline_at,
          'pendingAppealEvidenceDigestSha256',
            trust_case.pending_appeal_evidence_digest_sha256,
          'lastAction', trust_case.last_action,
          'lastActorKind', trust_case.last_actor_kind,
          'lastReasonCode', trust_case.last_reason_code,
          'lastEvidenceDigestSha256', trust_case.last_evidence_digest_sha256,
          'createdAt', trust_case.created_at,
          'updatedAt', trust_case.updated_at
        ) ORDER BY trust_case.created_at, trust_case.id)
        FROM trust.contribution_cases AS trust_case
        WHERE trust_case.contributor_user_id = candidate_user_id
      ), '[]'::jsonb),
      'caseEvents', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'eventId', event.event_id,
          'caseId', event.case_id,
          'caseVersion', event.case_version,
          'contributionId', event.contribution_id,
          'policyVersion', event.policy_version,
          'priorState', event.prior_state,
          'resultingState', event.resulting_state,
          'action', event.action,
          'actorKind', event.actor_kind,
          'reasonCode', event.reason_code,
          'evidenceDigestSha256', event.evidence_digest_sha256,
          'occurredAt', event.occurred_at
        ) ORDER BY event.occurred_at, event.case_id, event.case_version)
        FROM trust.case_events AS event
        INNER JOIN trust.contribution_cases AS trust_case ON trust_case.id = event.case_id
        WHERE trust_case.contributor_user_id = candidate_user_id
      ), '[]'::jsonb),
      'contributorReputationEvidence', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', evidence.id,
          'caseId', evidence.case_id,
          'caseVersion', evidence.case_version,
          'contributionId', evidence.contribution_id,
          'signalCode', evidence.signal_code,
          'referenceDigestSha256', evidence.reference_digest_sha256,
          'occurredAt', evidence.occurred_at
        ) ORDER BY evidence.occurred_at, evidence.id)
        FROM trust.reputation_evidence AS evidence
        INNER JOIN trust.contribution_cases AS trust_case ON trust_case.id = evidence.case_id
        WHERE trust_case.contributor_user_id = candidate_user_id
          AND evidence.subject_kind = 'contributor'
          AND evidence.contributor_user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
$$;

CREATE OR REPLACE FUNCTION trust.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, privacy, trust
AS $$
DECLARE
  cases_deleted integer;
  case_events_deleted integer;
  reputation_evidence_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);

  DELETE FROM trust.contribution_decision_deliveries AS delivery
  USING trust.contribution_decision_outbox AS event,
    trust.contribution_cases AS trust_case
  WHERE delivery.event_id = event.id AND event.case_id = trust_case.id
    AND trust_case.contributor_user_id = candidate_user_id;

  DELETE FROM trust.contribution_decision_outbox AS event
  USING trust.contribution_cases AS trust_case
  WHERE event.case_id = trust_case.id
    AND trust_case.contributor_user_id = candidate_user_id;

  DELETE FROM trust.reputation_evidence AS evidence
  USING trust.contribution_cases AS trust_case
  WHERE evidence.case_id = trust_case.id
    AND trust_case.contributor_user_id = candidate_user_id;
  GET DIAGNOSTICS reputation_evidence_deleted = ROW_COUNT;

  DELETE FROM trust.case_events AS event
  USING trust.contribution_cases AS trust_case
  WHERE event.case_id = trust_case.id
    AND trust_case.contributor_user_id = candidate_user_id;
  GET DIAGNOSTICS case_events_deleted = ROW_COUNT;

  DELETE FROM trust.contribution_cases
  WHERE contributor_user_id = candidate_user_id;
  GET DIAGNOSTICS cases_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'owner', 'trust',
    'casesDeleted', cases_deleted,
    'caseEventsDeleted', case_events_deleted,
    'reputationEvidenceDeleted', reputation_evidence_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION trust.case_transition_event_id(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION trust.guard_contribution_decision_outbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION trust.guard_contribution_decision_delivery() FROM PUBLIC;
REVOKE ALL ON FUNCTION trust.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION trust.delete_candidate_data(uuid, uuid) FROM PUBLIC;
