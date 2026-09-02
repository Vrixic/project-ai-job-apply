DROP TRIGGER contribution_cases_guard ON trust.contribution_cases;
CREATE TRIGGER contribution_cases_guard
BEFORE INSERT OR UPDATE ON trust.contribution_cases
FOR EACH ROW EXECUTE FUNCTION trust.guard_contribution_case();

CREATE FUNCTION trust.guard_candidate_case_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT privacy.current_candidate_deletion_authorized(OLD.contributor_user_id) THEN
    RAISE EXCEPTION 'trust contribution cases cannot be deleted in place'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER contribution_cases_candidate_delete_guard
BEFORE DELETE ON trust.contribution_cases
FOR EACH ROW EXECUTE FUNCTION trust.guard_candidate_case_delete();

DROP TRIGGER case_events_immutable ON trust.case_events;
CREATE TRIGGER case_events_immutable
BEFORE UPDATE ON trust.case_events
FOR EACH ROW EXECUTE FUNCTION trust.reject_immutable_evidence_mutation();

CREATE FUNCTION trust.guard_candidate_case_event_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  SELECT contributor_user_id INTO candidate_user_id
  FROM trust.contribution_cases
  WHERE id = OLD.case_id;

  IF candidate_user_id IS NULL
    OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
    RAISE EXCEPTION 'trust audit and reputation evidence are append-only'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER case_events_candidate_delete_guard
BEFORE DELETE ON trust.case_events
FOR EACH ROW EXECUTE FUNCTION trust.guard_candidate_case_event_delete();

DROP TRIGGER reputation_evidence_guard ON trust.reputation_evidence;
CREATE TRIGGER reputation_evidence_guard
BEFORE INSERT OR UPDATE ON trust.reputation_evidence
FOR EACH ROW EXECUTE FUNCTION trust.guard_reputation_evidence();

CREATE FUNCTION trust.guard_candidate_reputation_evidence_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  SELECT contributor_user_id INTO candidate_user_id
  FROM trust.contribution_cases
  WHERE id = OLD.case_id;

  IF candidate_user_id IS NULL
    OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
    RAISE EXCEPTION 'trust audit and reputation evidence are append-only'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER reputation_evidence_candidate_delete_guard
BEFORE DELETE ON trust.reputation_evidence
FOR EACH ROW EXECUTE FUNCTION trust.guard_candidate_reputation_evidence_delete();

CREATE FUNCTION trust.export_candidate_data(candidate_user_id uuid)
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

CREATE FUNCTION trust.delete_candidate_data(
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

REVOKE ALL ON FUNCTION trust.guard_candidate_case_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION trust.guard_candidate_case_event_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION trust.guard_candidate_reputation_evidence_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION trust.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION trust.delete_candidate_data(uuid, uuid) FROM PUBLIC;
