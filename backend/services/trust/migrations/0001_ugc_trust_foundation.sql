CREATE SCHEMA IF NOT EXISTS trust;

CREATE TABLE trust.contribution_cases (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL UNIQUE,
  contributor_user_id uuid NOT NULL,
  policy_version text NOT NULL CHECK (
    policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
  ),
  appeal_window_milliseconds bigint NOT NULL CHECK (
    appeal_window_milliseconds BETWEEN 1 AND 31536000000
  ),
  state text NOT NULL CHECK (
    state IN ('needs_review', 'accepted', 'rejected', 'appeal_pending', 'withdrawn', 'taken_down')
  ),
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100),
  appeal_count integer NOT NULL CHECK (appeal_count BETWEEN 0 AND 1),
  adverse_state text CHECK (adverse_state IN ('rejected', 'taken_down')),
  adverse_reviewer_id uuid,
  adverse_decision_at timestamptz,
  appeal_deadline_at timestamptz,
  pending_appeal_evidence_digest_sha256 text CHECK (
    pending_appeal_evidence_digest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  last_action text NOT NULL CHECK (last_action IN (
    'opened', 'review_accepted', 'review_rejected', 'withdrawn', 'taken_down',
    'appeal_filed', 'appeal_upheld', 'appeal_reversed'
  )),
  last_actor_kind text NOT NULL CHECK (last_actor_kind IN ('system', 'reviewer', 'contributor')),
  last_actor_id uuid NOT NULL,
  last_reason_code text NOT NULL CHECK (last_reason_code IN (
    'queued_for_review', 'independently_verified', 'insufficient_evidence',
    'content_mismatch', 'malicious_or_deceptive', 'license_or_policy_block',
    'contributor_withdrawal', 'verified_requester_takedown', 'credible_safety_risk',
    'rights_or_policy_violation', 'new_or_corrected_evidence', 'decision_upheld',
    'decision_reversed'
  )),
  last_evidence_digest_sha256 text CHECK (last_evidence_digest_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT contribution_cases_chronology_ck CHECK (created_at <= updated_at),
  CONSTRAINT contribution_cases_adverse_ck CHECK (
    (adverse_state IS NULL AND adverse_reviewer_id IS NULL AND adverse_decision_at IS NULL
      AND appeal_deadline_at IS NULL)
    OR
    (adverse_state IS NOT NULL AND adverse_reviewer_id IS NOT NULL
      AND adverse_decision_at IS NOT NULL
      AND appeal_deadline_at = adverse_decision_at
        + (appeal_window_milliseconds * interval '1 millisecond'))
  ),
  CONSTRAINT contribution_cases_pending_appeal_ck CHECK (
    (state = 'appeal_pending' AND appeal_count = 1 AND adverse_state IS NOT NULL
      AND pending_appeal_evidence_digest_sha256 IS NOT NULL)
    OR
    (state <> 'appeal_pending' AND pending_appeal_evidence_digest_sha256 IS NULL)
  ),
  CONSTRAINT contribution_cases_initial_state_ck CHECK (
    state <> 'needs_review' OR (
      version = 1 AND appeal_count = 0 AND adverse_state IS NULL
      AND last_action = 'opened' AND last_actor_kind = 'system'
      AND last_reason_code = 'queued_for_review' AND last_evidence_digest_sha256 IS NULL
    )
  )
);

CREATE INDEX contribution_cases_owner_updated_idx
  ON trust.contribution_cases (contributor_user_id, updated_at DESC, id);
CREATE INDEX contribution_cases_review_queue_idx
  ON trust.contribution_cases (updated_at, id)
  WHERE state IN ('needs_review', 'appeal_pending');

CREATE TABLE trust.case_events (
  case_id uuid NOT NULL REFERENCES trust.contribution_cases(id) ON DELETE RESTRICT,
  case_version integer NOT NULL CHECK (case_version BETWEEN 1 AND 100),
  contribution_id uuid NOT NULL,
  policy_version text NOT NULL CHECK (policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'),
  prior_state text,
  resulting_state text NOT NULL CHECK (
    resulting_state IN ('needs_review', 'accepted', 'rejected', 'appeal_pending', 'withdrawn', 'taken_down')
  ),
  action text NOT NULL CHECK (action IN (
    'opened', 'review_accepted', 'review_rejected', 'withdrawn', 'taken_down',
    'appeal_filed', 'appeal_upheld', 'appeal_reversed'
  )),
  actor_kind text NOT NULL CHECK (actor_kind IN ('system', 'reviewer', 'contributor')),
  actor_id uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN (
    'queued_for_review', 'independently_verified', 'insufficient_evidence',
    'content_mismatch', 'malicious_or_deceptive', 'license_or_policy_block',
    'contributor_withdrawal', 'verified_requester_takedown', 'credible_safety_risk',
    'rights_or_policy_violation', 'new_or_corrected_evidence', 'decision_upheld',
    'decision_reversed'
  )),
  evidence_digest_sha256 text CHECK (evidence_digest_sha256 ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (case_id, case_version),
  CONSTRAINT case_events_open_ck CHECK (
    (case_version = 1 AND prior_state IS NULL AND action = 'opened')
    OR (case_version > 1 AND prior_state IS NOT NULL AND action <> 'opened')
  )
);

CREATE INDEX case_events_contribution_occurred_idx
  ON trust.case_events (contribution_id, occurred_at, case_version);

CREATE TABLE trust.reputation_evidence (
  id uuid PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES trust.contribution_cases(id) ON DELETE RESTRICT,
  case_version integer NOT NULL CHECK (case_version BETWEEN 1 AND 100),
  contribution_id uuid NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('contributor', 'source')),
  contributor_user_id uuid,
  source_key_sha256 text CHECK (source_key_sha256 ~ '^[a-f0-9]{64}$'),
  signal_code text NOT NULL CHECK (signal_code IN (
    'contributor_submission_verified', 'contributor_submission_incorrect',
    'contributor_abuse_detected', 'source_observation_corroborated',
    'source_content_conflict', 'source_safety_risk', 'adverse_decision_reversed'
  )),
  reference_digest_sha256 text NOT NULL CHECK (reference_digest_sha256 ~ '^[a-f0-9]{64}$'),
  recorded_by_reviewer_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT reputation_evidence_subject_ck CHECK (
    (subject_kind = 'contributor' AND contributor_user_id IS NOT NULL
      AND source_key_sha256 IS NULL
      AND signal_code IN ('contributor_submission_verified', 'contributor_submission_incorrect',
        'contributor_abuse_detected', 'adverse_decision_reversed'))
    OR
    (subject_kind = 'source' AND contributor_user_id IS NULL
      AND source_key_sha256 IS NOT NULL
      AND signal_code IN ('source_observation_corroborated', 'source_content_conflict',
        'source_safety_risk'))
  )
);

CREATE INDEX reputation_evidence_contributor_idx
  ON trust.reputation_evidence (contributor_user_id, occurred_at, id)
  WHERE subject_kind = 'contributor';
CREATE INDEX reputation_evidence_source_idx
  ON trust.reputation_evidence (source_key_sha256, occurred_at, id)
  WHERE subject_kind = 'source';

CREATE FUNCTION trust.guard_contribution_case()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'trust contribution cases cannot be deleted in place';
  END IF;
  IF NEW.updated_at > clock_timestamp() THEN
    RAISE EXCEPTION 'trust contribution case is future-dated';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.state <> 'needs_review' OR NEW.created_at <> NEW.updated_at THEN
      RAISE EXCEPTION 'trust contribution case initial state is invalid';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.contribution_id IS DISTINCT FROM OLD.contribution_id
      OR NEW.contributor_user_id IS DISTINCT FROM OLD.contributor_user_id
      OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
      OR NEW.appeal_window_milliseconds IS DISTINCT FROM OLD.appeal_window_milliseconds
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.version <> OLD.version + 1
      OR NEW.updated_at < OLD.updated_at
      OR NOT (
        (OLD.state = 'needs_review' AND NEW.state IN ('accepted', 'rejected', 'withdrawn'))
        OR (OLD.state = 'accepted' AND NEW.state IN ('taken_down', 'withdrawn'))
        OR (OLD.state IN ('rejected', 'taken_down') AND NEW.state IN ('appeal_pending', 'withdrawn'))
        OR (OLD.state = 'appeal_pending' AND NEW.state IN ('accepted', 'rejected', 'taken_down', 'withdrawn'))
      )
    THEN
      RAISE EXCEPTION 'trust contribution case transition is invalid';
    END IF;
  END IF;

  IF NEW.last_action = 'opened' THEN
    IF NEW.last_actor_kind <> 'system' OR NEW.last_reason_code <> 'queued_for_review'
      OR NEW.last_evidence_digest_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'trust open attribution is invalid';
    END IF;
  ELSIF NEW.last_action = 'review_accepted' THEN
    IF NEW.last_actor_kind <> 'reviewer' OR NEW.state <> 'accepted'
      OR NEW.last_reason_code <> 'independently_verified'
      OR NEW.last_evidence_digest_sha256 IS NULL THEN
      RAISE EXCEPTION 'trust acceptance attribution is invalid';
    END IF;
  ELSIF NEW.last_action = 'review_rejected' THEN
    IF NEW.last_actor_kind <> 'reviewer' OR NEW.state <> 'rejected'
      OR NEW.last_reason_code NOT IN ('insufficient_evidence', 'content_mismatch',
        'malicious_or_deceptive', 'license_or_policy_block')
      OR NEW.last_evidence_digest_sha256 IS NULL
      OR NEW.adverse_state <> 'rejected' OR NEW.adverse_reviewer_id <> NEW.last_actor_id
      OR NEW.adverse_decision_at <> NEW.updated_at THEN
      RAISE EXCEPTION 'trust rejection attribution is invalid';
    END IF;
  ELSIF NEW.last_action = 'withdrawn' THEN
    IF NEW.last_actor_kind <> 'contributor' OR NEW.last_actor_id <> NEW.contributor_user_id
      OR NEW.state <> 'withdrawn' OR NEW.last_reason_code <> 'contributor_withdrawal'
      OR NEW.last_evidence_digest_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'trust withdrawal attribution is invalid';
    END IF;
  ELSIF NEW.last_action = 'taken_down' THEN
    IF NEW.last_actor_kind <> 'reviewer' OR NEW.state <> 'taken_down'
      OR NEW.last_reason_code NOT IN ('verified_requester_takedown', 'credible_safety_risk',
        'rights_or_policy_violation') OR NEW.last_evidence_digest_sha256 IS NULL
      OR NEW.adverse_state <> 'taken_down' OR NEW.adverse_reviewer_id <> NEW.last_actor_id
      OR NEW.adverse_decision_at <> NEW.updated_at THEN
      RAISE EXCEPTION 'trust takedown attribution is invalid';
    END IF;
  ELSIF NEW.last_action = 'appeal_filed' THEN
    IF NEW.last_actor_kind <> 'contributor' OR NEW.last_actor_id <> NEW.contributor_user_id
      OR NEW.state <> 'appeal_pending' OR NEW.last_reason_code <> 'new_or_corrected_evidence'
      OR NEW.last_evidence_digest_sha256 IS NULL
      OR NEW.pending_appeal_evidence_digest_sha256 <> NEW.last_evidence_digest_sha256
      OR NEW.appeal_count <> 1 OR OLD.appeal_count <> 0
      OR NEW.updated_at > NEW.appeal_deadline_at THEN
      RAISE EXCEPTION 'trust appeal filing is invalid';
    END IF;
  ELSIF NEW.last_action IN ('appeal_upheld', 'appeal_reversed') THEN
    IF NEW.last_actor_kind <> 'reviewer' OR OLD.state <> 'appeal_pending'
      OR NEW.last_actor_id = NEW.adverse_reviewer_id
      OR NEW.last_evidence_digest_sha256 IS NULL OR NEW.appeal_count <> 1
      OR NEW.pending_appeal_evidence_digest_sha256 IS NOT NULL
      OR (NEW.last_action = 'appeal_upheld' AND (
        NEW.last_reason_code <> 'decision_upheld' OR NEW.state <> NEW.adverse_state))
      OR (NEW.last_action = 'appeal_reversed' AND (
        NEW.last_reason_code <> 'decision_reversed' OR NEW.state <> 'accepted')) THEN
      RAISE EXCEPTION 'trust appeal decision is invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER contribution_cases_guard
BEFORE INSERT OR UPDATE OR DELETE ON trust.contribution_cases
FOR EACH ROW EXECUTE FUNCTION trust.guard_contribution_case();

CREATE FUNCTION trust.append_case_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO trust.case_events (
    case_id, case_version, contribution_id, policy_version, prior_state, resulting_state, action,
    actor_kind, actor_id, reason_code, evidence_digest_sha256, occurred_at
  ) VALUES (
    NEW.id, NEW.version, NEW.contribution_id, NEW.policy_version,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.state END,
    NEW.state, NEW.last_action, NEW.last_actor_kind, NEW.last_actor_id,
    NEW.last_reason_code, NEW.last_evidence_digest_sha256, NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER contribution_cases_append_event
AFTER INSERT OR UPDATE ON trust.contribution_cases
FOR EACH ROW EXECUTE FUNCTION trust.append_case_event();

CREATE FUNCTION trust.reject_immutable_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'trust audit and reputation evidence are append-only';
END;
$$;

CREATE TRIGGER case_events_immutable
BEFORE UPDATE OR DELETE ON trust.case_events
FOR EACH ROW EXECUTE FUNCTION trust.reject_immutable_evidence_mutation();

CREATE FUNCTION trust.guard_reputation_evidence()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  owner_id uuid;
  current_version integer;
  stored_contribution_id uuid;
  current_state text;
  current_appeal_count integer;
  current_adverse_state text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'trust reputation evidence is append-only';
  END IF;
  IF NEW.occurred_at > clock_timestamp() THEN
    RAISE EXCEPTION 'trust reputation evidence is future-dated';
  END IF;
  SELECT contributor_user_id, version, contribution_id, state, appeal_count, adverse_state
    INTO owner_id, current_version, stored_contribution_id, current_state,
      current_appeal_count, current_adverse_state
  FROM trust.contribution_cases WHERE id = NEW.case_id;
  IF owner_id IS NULL OR NEW.case_version <> current_version
    OR NEW.contribution_id <> stored_contribution_id
    OR (NEW.subject_kind = 'contributor' AND NEW.contributor_user_id <> owner_id) THEN
    RAISE EXCEPTION 'trust reputation evidence case binding is invalid';
  END IF;
  IF NEW.signal_code = 'contributor_submission_verified' AND current_state <> 'accepted' THEN
    RAISE EXCEPTION 'verified contributor evidence requires an accepted decision';
  END IF;
  IF NEW.signal_code IN ('contributor_submission_incorrect', 'contributor_abuse_detected')
    AND (current_state NOT IN ('rejected', 'taken_down') OR current_appeal_count <> 0
      OR current_adverse_state IS NULL) THEN
    RAISE EXCEPTION 'adverse contributor evidence must remain eligible for appeal';
  END IF;
  IF NEW.signal_code = 'adverse_decision_reversed'
    AND (current_state <> 'accepted' OR current_appeal_count <> 1) THEN
    RAISE EXCEPTION 'reversal evidence requires a completed reversal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reputation_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON trust.reputation_evidence
FOR EACH ROW EXECUTE FUNCTION trust.guard_reputation_evidence();
