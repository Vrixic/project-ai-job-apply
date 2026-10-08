-- The existing transactional outbox owns resume preparation delivery. No candidate content.
ALTER TABLE applications.outbox DROP CONSTRAINT outbox_event_type_check;
ALTER TABLE applications.outbox ADD CONSTRAINT outbox_event_type_check CHECK (
  event_type IN ('application.status_changed.v1', 'application.applied.v1',
    'application.resume-preparation.requested.v1')
);
ALTER TABLE applications.outbox ADD COLUMN resume_packet_id uuid;
ALTER TABLE applications.outbox ADD COLUMN resume_workflow_arn text;
ALTER TABLE applications.outbox ADD CONSTRAINT outbox_resume_packet_fk
  FOREIGN KEY (resume_packet_id, application_id, owner_user_id)
  REFERENCES applications.packets(id, application_id, owner_user_id) ON DELETE RESTRICT;
ALTER TABLE applications.outbox ADD CONSTRAINT outbox_resume_scope_ck CHECK (
  (event_type = 'application.resume-preparation.requested.v1'
    AND resume_packet_id IS NOT NULL AND payload->>'status' = 'review_required'
    AND (resume_workflow_arn IS NULL OR resume_workflow_arn ~
      '^arn:aws:lambda:us-east-2:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]{0,8}$'))
  OR (event_type <> 'application.resume-preparation.requested.v1'
    AND resume_packet_id IS NULL AND resume_workflow_arn IS NULL)
);
CREATE FUNCTION applications.guard_native_resume_outbox_binding()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.resume_packet_id IS DISTINCT FROM OLD.resume_packet_id
    OR (OLD.resume_workflow_arn IS NOT NULL AND NEW.resume_workflow_arn IS DISTINCT FROM OLD.resume_workflow_arn)
    OR (OLD.resume_workflow_arn IS NULL AND NEW.resume_workflow_arn IS NOT NULL
      AND NEW.status <> 'processing') THEN
    RAISE EXCEPTION 'resume request packet and original workflow binding are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER outbox_native_resume_binding_guard BEFORE UPDATE ON applications.outbox
  FOR EACH ROW EXECUTE FUNCTION applications.guard_native_resume_outbox_binding();
