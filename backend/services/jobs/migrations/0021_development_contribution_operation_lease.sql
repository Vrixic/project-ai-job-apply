-- A development capability has no deployment expiry. Only its per-operation authorization
-- lease may renew after fresh application gates, without changing reconciliation identity.
ALTER TABLE jobs.job_contribution_reconciliations
  DROP CONSTRAINT job_contribution_reconciliations_chronology_ck,
  ADD CONSTRAINT job_contribution_reconciliations_chronology_ck CHECK (
    updated_at >= created_at
    AND capability_expires_at > capability_evaluated_at
    AND (
      capability_evaluated_at <= created_at
      OR (
        kind = 'publication'
        AND capability_policy_version = 'd2-development-greenhouse-v1'
        AND capability_configuration_digest_sha256 =
          '8405c7ba82d4d5d127b9bfb0f2f753533d6709d0b89e148a02a1db89c03f1f3b'
        AND capability_evaluated_at <= updated_at
        AND capability_expires_at = capability_evaluated_at + interval '60 seconds'
      )
    )
  );

CREATE OR REPLACE FUNCTION jobs.guard_job_contribution_reconciliation()
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
      RAISE EXCEPTION 'job contribution reconciliation is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state = 'prepared' AND NEW.state = 'prepared'
    AND OLD.kind = 'publication'
    AND OLD.capability_policy_version = 'd2-development-greenhouse-v1'
    AND OLD.capability_configuration_digest_sha256 =
      '8405c7ba82d4d5d127b9bfb0f2f753533d6709d0b89e148a02a1db89c03f1f3b'
    AND current_setting('ai_job_apply.development_contribution_lease', true) = 'renew'
    AND (to_jsonb(NEW) - ARRAY['capability_evaluated_at', 'capability_expires_at', 'updated_at'])
      = (to_jsonb(OLD) - ARRAY['capability_evaluated_at', 'capability_expires_at', 'updated_at'])
    AND NEW.capability_evaluated_at >= OLD.capability_expires_at
    AND NEW.capability_evaluated_at <= NEW.updated_at
    AND NEW.capability_expires_at = NEW.capability_evaluated_at + interval '60 seconds'
    AND NEW.updated_at >= OLD.updated_at THEN
    RETURN NEW;
  END IF;
  IF OLD.state <> 'prepared' OR NEW.state <> 'applied'
    OR NEW.id <> OLD.id OR NEW.contribution_id <> OLD.contribution_id
    OR NEW.kind <> OLD.kind OR NEW.normalization_id <> OLD.normalization_id
    OR NEW.independent_verification_id <> OLD.independent_verification_id
    OR NEW.trust_decision_id <> OLD.trust_decision_id
    OR (OLD.job_id IS NOT NULL AND NEW.job_id <> OLD.job_id)
    OR (OLD.source_id IS NOT NULL AND NEW.source_id <> OLD.source_id)
    OR NEW.job_id IS NULL OR NEW.source_id IS NULL
    OR NEW.terminal_reason IS DISTINCT FROM OLD.terminal_reason
    OR NEW.processing_policy_version <> OLD.processing_policy_version
    OR NEW.capability_policy_version <> OLD.capability_policy_version
    OR NEW.capability_configuration_digest_sha256 <>
      OLD.capability_configuration_digest_sha256
    OR NEW.capability_evaluated_at <> OLD.capability_evaluated_at
    OR NEW.capability_expires_at <> OLD.capability_expires_at
    OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'invalid job contribution reconciliation transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
