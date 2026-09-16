-- Add an honest audit reason for explicitly authorized development-only acceptance tests.
-- Runtime authorization remains deny-by-default and binds the exact contribution/evidence.
-- No historical case/event is rewritten and no reviewer authority is granted here.
ALTER TABLE trust.contribution_cases
  DROP CONSTRAINT contribution_cases_last_reason_code_check,
  ADD CONSTRAINT contribution_cases_last_reason_code_check CHECK (last_reason_code IN (
    'queued_for_review', 'independently_verified', 'insufficient_evidence',
    'content_mismatch', 'malicious_or_deceptive', 'license_or_policy_block',
    'contributor_withdrawal', 'verified_requester_takedown', 'credible_safety_risk',
    'rights_or_policy_violation', 'development_test_removal',
    'new_or_corrected_evidence', 'decision_upheld', 'decision_reversed'
  ));
ALTER TABLE trust.case_events
  DROP CONSTRAINT case_events_reason_code_check,
  ADD CONSTRAINT case_events_reason_code_check CHECK (reason_code IN (
    'queued_for_review', 'independently_verified', 'insufficient_evidence',
    'content_mismatch', 'malicious_or_deceptive', 'license_or_policy_block',
    'contributor_withdrawal', 'verified_requester_takedown', 'credible_safety_risk',
    'rights_or_policy_violation', 'development_test_removal',
    'new_or_corrected_evidence', 'decision_upheld', 'decision_reversed'
  ));

-- Preserve all existing transition, attribution and independent-review checks verbatim.
DO $migration$
DECLARE
  definition text := pg_get_functiondef('trust.guard_contribution_case()'::regprocedure);
  old_fragment text := '''rights_or_policy_violation'') OR NEW.last_evidence_digest_sha256 IS NULL';
  new_fragment text := '''rights_or_policy_violation'', ''development_test_removal'') OR NEW.last_evidence_digest_sha256 IS NULL';
BEGIN
  IF (length(definition) - length(replace(definition, old_fragment, ''))) / length(old_fragment) <> 1 THEN
    RAISE EXCEPTION 'Unexpected Trust takedown guard definition';
  END IF;
  EXECUTE replace(definition, old_fragment, new_fragment);
END;
$migration$;
