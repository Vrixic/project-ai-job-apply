-- Reviewer/appeal evidence is not necessarily independent provider truth. Keep both immutable
-- meanings separate. Existing decisions deliberately remain NULL: historical acceptance cannot
-- fabricate a provider-proof basis during migration or be silently republished by a new reader.
ALTER TABLE trust.contribution_cases
  ADD COLUMN independent_evidence_digest_sha256 text CHECK (
    independent_evidence_digest_sha256 ~ '^[a-f0-9]{64}$'
  );
ALTER TABLE trust.case_events
  ADD COLUMN independent_evidence_digest_sha256 text CHECK (
    independent_evidence_digest_sha256 ~ '^[a-f0-9]{64}$'
  );

CREATE FUNCTION trust.guard_accepted_independent_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.independent_evidence_digest_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'trust opened case cannot establish independent evidence';
    END IF;
  ELSIF NEW.last_action IN ('review_accepted', 'appeal_reversed') THEN
    IF NEW.state <> 'accepted' OR NEW.independent_evidence_digest_sha256 IS NULL
      OR (NEW.last_action = 'review_accepted' AND
        NEW.independent_evidence_digest_sha256 IS DISTINCT FROM NEW.last_evidence_digest_sha256)
    THEN
      RAISE EXCEPTION 'trust acceptance requires a bound independent evidence basis';
    END IF;
  ELSIF NEW.last_action = 'withdrawn' THEN
    IF NEW.independent_evidence_digest_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'trust withdrawal must clear the active independent evidence basis';
    END IF;
  ELSIF NEW.independent_evidence_digest_sha256 IS DISTINCT FROM
    OLD.independent_evidence_digest_sha256 THEN
    RAISE EXCEPTION 'trust nonaccepting transition cannot change independent evidence';
  END IF;
  RETURN NEW;
END;
$$;

-- Runs after the original case guard, preserving all existing actor/state/appeal invariants.
CREATE TRIGGER contribution_cases_independent_evidence_guard
BEFORE INSERT OR UPDATE ON trust.contribution_cases
FOR EACH ROW EXECUTE FUNCTION trust.guard_accepted_independent_evidence();

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
    resulting_state, action, actor_kind, actor_id, reason_code, evidence_digest_sha256,
    independent_evidence_digest_sha256, occurred_at
  ) VALUES (
    transition_event_id, NEW.id, NEW.version, NEW.contribution_id, NEW.policy_version,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state, NEW.last_action, NEW.last_actor_kind, NEW.last_actor_id,
    NEW.last_reason_code, NEW.last_evidence_digest_sha256,
    NEW.independent_evidence_digest_sha256, NEW.updated_at
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

-- Direct inserts must not attach a fabricated basis or decision to an unrelated case version.
-- Existing event UPDATE/DELETE and candidate-deletion guards remain unchanged.
CREATE FUNCTION trust.guard_case_event_independent_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM trust.contribution_cases AS trust_case
    WHERE trust_case.id = NEW.case_id AND trust_case.version = NEW.case_version
      AND NEW.event_id = trust.case_transition_event_id(NEW.case_id, NEW.case_version)
      AND trust_case.contribution_id = NEW.contribution_id
      AND trust_case.policy_version = NEW.policy_version
      AND trust_case.state = NEW.resulting_state
      AND trust_case.last_action = NEW.action
      AND trust_case.last_actor_kind = NEW.actor_kind
      AND trust_case.last_actor_id = NEW.actor_id
      AND trust_case.last_reason_code = NEW.reason_code
      AND trust_case.last_evidence_digest_sha256 IS NOT DISTINCT FROM NEW.evidence_digest_sha256
      AND trust_case.independent_evidence_digest_sha256 IS NOT DISTINCT FROM
        NEW.independent_evidence_digest_sha256
      AND trust_case.updated_at = NEW.occurred_at
  ) THEN
    RAISE EXCEPTION 'trust decision event must bind the exact case evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER case_events_independent_evidence_guard
BEFORE INSERT ON trust.case_events
FOR EACH ROW EXECUTE FUNCTION trust.guard_case_event_independent_evidence();

REVOKE ALL ON FUNCTION trust.guard_accepted_independent_evidence() FROM PUBLIC;
REVOKE ALL ON FUNCTION trust.guard_case_event_independent_evidence() FROM PUBLIC;

-- Additive candidate-owned evidence export; reviewer identifiers and transport stay private.
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
          'independentEvidenceDigestSha256', trust_case.independent_evidence_digest_sha256,
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
          'independentEvidenceDigestSha256', event.independent_evidence_digest_sha256,
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

REVOKE ALL ON FUNCTION trust.export_candidate_data(uuid) FROM PUBLIC;
