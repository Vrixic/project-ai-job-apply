-- Original delivery metadata only. Legacy published rows remain explicitly ambiguous.
ALTER TABLE applications.outbox ADD COLUMN resume_execution_arn text;
ALTER TABLE applications.outbox ADD COLUMN resume_dispatch_result text;
ALTER TABLE applications.outbox ADD CONSTRAINT outbox_resume_execution_ck CHECK ((
  (resume_execution_arn IS NULL AND resume_dispatch_result IS NULL)
  OR (event_type='application.resume-preparation.requested.v1' AND status='published'
    AND resume_workflow_arn IS NOT NULL AND (
      (resume_dispatch_result='no_resume' AND resume_execution_arn IS NULL)
      OR (resume_dispatch_result='started' AND resume_execution_arn IS NOT NULL
        AND length(resume_execution_arn) <= 1024
        AND left(resume_execution_arn,length(resume_workflow_arn || '/durable-execution/resume-' || id::text || '/'))
          = resume_workflow_arn || '/durable-execution/resume-' || id::text || '/'
        AND substring(resume_execution_arn FROM length(resume_workflow_arn || '/durable-execution/resume-' || id::text || '/')+1)
          ~ '^[A-Za-z0-9_-]{1,128}$')
    ))
) IS TRUE);
CREATE FUNCTION applications.guard_native_resume_execution_receipt()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.resume_dispatch_result IS NOT NULL AND (
      NEW.resume_dispatch_result IS DISTINCT FROM OLD.resume_dispatch_result
      OR NEW.resume_execution_arn IS DISTINCT FROM OLD.resume_execution_arn))
    OR (OLD.resume_dispatch_result IS NULL AND NEW.resume_dispatch_result IS NOT NULL
      AND (OLD.status <> 'processing' OR NEW.status <> 'published'
        OR OLD.claim_token IS NULL OR OLD.lease_expires_at <= clock_timestamp())) THEN
    RAISE EXCEPTION 'original resume execution receipt is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outbox_native_resume_execution_guard BEFORE UPDATE ON applications.outbox
  FOR EACH ROW EXECUTE FUNCTION applications.guard_native_resume_execution_receipt();
CREATE INDEX outbox_native_resume_execution_scan ON applications.outbox(resume_workflow_arn,id)
  WHERE event_type='application.resume-preparation.requested.v1' AND resume_workflow_arn IS NOT NULL;
