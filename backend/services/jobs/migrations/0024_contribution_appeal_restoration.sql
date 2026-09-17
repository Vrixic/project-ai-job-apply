-- A reversed takedown restores the contribution association without rewriting the original
-- publication, removal, provider evidence, or catalog truth. Trust permits at most one appeal,
-- so one append-only restoration reconciliation per contribution is sufficient.
ALTER TABLE jobs.job_contribution_reconciliations
  DROP CONSTRAINT job_contribution_reconciliations_kind_ck,
  DROP CONSTRAINT job_contribution_reconciliations_terminal_ck,
  ADD CONSTRAINT job_contribution_reconciliations_kind_ck
    CHECK (kind IN ('publication', 'removal', 'restoration')),
  ADD CONSTRAINT job_contribution_reconciliations_terminal_ck CHECK (
    (kind IN ('publication', 'restoration') AND terminal_reason IS NULL) OR
    (kind = 'removal' AND terminal_reason IN ('withdrawn', 'taken_down'))
  );

ALTER TABLE jobs.job_contribution_state_events
  DROP CONSTRAINT job_contribution_state_events_reason_ck,
  ADD CONSTRAINT job_contribution_state_events_reason_ck CHECK (
    reason_code IN (
      'normalization_complete', 'consent_not_current',
      'provider_temporarily_unavailable', 'provider_observation_mismatch',
      'provider_posting_closed', 'provider_probable_duplicate',
      'independent_verification_complete', 'trust_review_required',
      'trust_policy_rejected', 'trust_withdrawal', 'trust_takedown',
      'publication_gates_complete', 'publication_complete', 'appeal_reversal',
      'terminal_reconciliation_complete'
    )
  );

-- A completed row needs new work when an accepted appeal follows an applied takedown and that
-- exact accepted decision has not already been restored. Initial publication behavior is unchanged.
CREATE OR REPLACE FUNCTION jobs.contribution_requires_trust_processing(
  target uuid,
  completed_decision uuid
)
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
        (decision.status = 'accepted' AND (
          NOT EXISTS (
            SELECT 1 FROM jobs.job_contribution_reconciliations
            WHERE contribution_id = target AND kind = 'publication' AND state = 'applied'
          ) OR (
            EXISTS (
              SELECT 1 FROM jobs.job_contribution_reconciliations
              WHERE contribution_id = target AND kind = 'removal' AND state = 'applied'
                AND terminal_reason = 'taken_down'
            ) AND NOT EXISTS (
              SELECT 1 FROM jobs.job_contribution_reconciliations
              WHERE contribution_id = target AND kind = 'restoration' AND state = 'applied'
                AND trust_decision_id = decision.id
            )
          )
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

-- Recover already-copied appeal reversals that the previous predicate incorrectly treated as
-- complete. The existing queue trigger independently revalidates this exact predicate.
UPDATE jobs.job_contribution_processing_queue
SET state = 'pending', attempt = 0, available_at = now(),
  claimed_at = NULL, claim_expires_at = NULL, claimed_by = NULL,
  last_error_code = NULL, updated_at = now()
WHERE state = 'completed'
  AND jobs.contribution_requires_trust_processing(
    contribution_id,
    completed_trust_decision_id
  );
