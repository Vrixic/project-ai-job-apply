-- Identifier-only background observation of original execution receipts. Candidate deletion
-- already deletes the owning outbox rows. No execution, packet or generation state is changed.
ALTER TABLE applications.outbox ADD COLUMN resume_execution_checked_at timestamptz;
ALTER TABLE applications.outbox ADD COLUMN resume_execution_inspection_token uuid;
ALTER TABLE applications.outbox ADD COLUMN resume_execution_terminal_status text;
ALTER TABLE applications.outbox ADD COLUMN resume_execution_notified_at timestamptz;
ALTER TABLE applications.outbox ADD CONSTRAINT outbox_resume_observation_ck CHECK ((
  (resume_execution_checked_at IS NULL AND resume_execution_inspection_token IS NULL
    AND resume_execution_terminal_status IS NULL AND resume_execution_notified_at IS NULL)
  OR (resume_dispatch_result='started' AND resume_execution_arn IS NOT NULL
    AND resume_execution_checked_at IS NOT NULL AND resume_execution_inspection_token IS NOT NULL
    AND (resume_execution_terminal_status IS NULL OR resume_execution_terminal_status IN
      ('SUCCEEDED','FAILED','TIMED_OUT','STOPPED'))
    AND (resume_execution_notified_at IS NULL OR resume_execution_terminal_status IN
      ('FAILED','TIMED_OUT','STOPPED')))
) IS TRUE);
CREATE INDEX outbox_resume_execution_observation_due
  ON applications.outbox(resume_workflow_arn,resume_execution_checked_at NULLS FIRST,id)
  WHERE resume_dispatch_result='started' AND resume_execution_notified_at IS NULL
    AND resume_execution_terminal_status IS DISTINCT FROM 'SUCCEEDED';
CREATE FUNCTION applications.guard_native_resume_execution_observation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.resume_execution_terminal_status IS NOT NULL AND
      NEW.resume_execution_terminal_status IS DISTINCT FROM OLD.resume_execution_terminal_status)
    OR (OLD.resume_execution_notified_at IS NOT NULL AND
      NEW.resume_execution_notified_at IS DISTINCT FROM OLD.resume_execution_notified_at) THEN
    RAISE EXCEPTION 'original execution observation is immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outbox_resume_execution_observation_guard BEFORE UPDATE ON applications.outbox
  FOR EACH ROW EXECUTE FUNCTION applications.guard_native_resume_execution_observation();

-- Published resume receipts permit observation metadata only. Keep the original payload,
-- dispatch receipt, status and every other column under the existing immutable guard.
DROP TRIGGER outbox_payload_immutable ON applications.outbox;
CREATE TRIGGER outbox_payload_immutable BEFORE UPDATE ON applications.outbox
  FOR EACH ROW WHEN (NOT ((
    OLD.status='published'
    AND OLD.event_type='application.resume-preparation.requested.v1'
    AND OLD.resume_dispatch_result='started'
    AND (to_jsonb(NEW)-ARRAY['resume_execution_checked_at','resume_execution_inspection_token',
      'resume_execution_terminal_status','resume_execution_notified_at'])
      = (to_jsonb(OLD)-ARRAY['resume_execution_checked_at','resume_execution_inspection_token',
      'resume_execution_terminal_status','resume_execution_notified_at'])
  ) IS TRUE)) EXECUTE FUNCTION applications.protect_outbox_payload();
