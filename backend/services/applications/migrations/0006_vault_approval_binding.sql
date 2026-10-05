-- Exact selected-answer revisions participate in approval invalidation.
ALTER TABLE applications.approvals
  DROP CONSTRAINT approvals_invalidation_reason_check;
ALTER TABLE applications.approvals
  ADD CONSTRAINT approvals_invalidation_reason_check CHECK (
    invalidation_reason IN (
      'packet_hash_mismatch', 'approval_expired', 'job_changed', 'form_changed',
      'resume_changed', 'cover_letter_changed', 'superseded', 'attempt_requires_review',
      'cancelled', 'vault_answer_changed'
    )
  );
