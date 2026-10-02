-- Forward-only dispatch metadata. No candidate values, prompts or provider results.
ALTER TABLE applications.preparation_outbox
  ADD COLUMN nudge_claimed_at timestamptz,
  ADD COLUMN workflow_function_arn text,
  ADD COLUMN durable_execution_name text,
  ADD COLUMN bound_at timestamptz,
  ADD COLUMN dispatch_lease_id uuid,
  ADD COLUMN dispatch_claimed_at timestamptz,
  ADD COLUMN dispatch_expires_at timestamptz,
  ADD COLUMN durable_execution_arn text,
  ADD COLUMN durable_started_at timestamptz,
  ADD COLUMN terminal_status text,
  ADD COLUMN terminal_start_at timestamptz,
  ADD COLUMN terminal_end_at timestamptz,
  ADD CONSTRAINT preparation_outbox_binding_check CHECK (
    (workflow_function_arn IS NULL AND durable_execution_name IS NULL AND bound_at IS NULL)
    OR (workflow_function_arn IS NOT NULL AND length(workflow_function_arn) <= 256
      AND workflow_function_arn ~ '^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]*$'
      AND durable_execution_name IS NOT NULL AND durable_execution_name = 'preparation-' || id::text
      AND bound_at IS NOT NULL AND bound_at >= created_at)
  ),
  ADD CONSTRAINT preparation_outbox_lease_check CHECK (
    (dispatch_lease_id IS NULL AND dispatch_claimed_at IS NULL AND dispatch_expires_at IS NULL)
    OR (dispatch_lease_id IS NOT NULL AND dispatch_claimed_at IS NOT NULL AND dispatch_expires_at IS NOT NULL
      AND bound_at IS NOT NULL AND dispatch_claimed_at >= bound_at
      AND dispatch_expires_at = dispatch_claimed_at + interval '60 seconds'
      AND durable_started_at IS NULL AND terminal_status IS NULL)
  ),
  ADD CONSTRAINT preparation_outbox_started_check CHECK (
    (durable_execution_arn IS NULL AND durable_started_at IS NULL AND published_at IS NULL)
    OR (durable_execution_arn IS NOT NULL AND durable_started_at IS NOT NULL AND published_at IS NOT NULL
      AND workflow_function_arn IS NOT NULL AND durable_started_at >= bound_at
      AND published_at = durable_started_at AND length(durable_execution_arn) <= 1024
      AND left(durable_execution_arn, length(workflow_function_arn || '/durable-execution/' || durable_execution_name || '/'))
        = workflow_function_arn || '/durable-execution/' || durable_execution_name || '/'
      AND substring(durable_execution_arn FROM length(workflow_function_arn || '/durable-execution/' || durable_execution_name || '/') + 1)
        ~ '^[A-Za-z0-9_-]+$')
  ),
  ADD CONSTRAINT preparation_outbox_terminal_check CHECK (
    (terminal_status IS NULL AND terminal_start_at IS NULL AND terminal_end_at IS NULL)
    OR (terminal_status IS NOT NULL AND terminal_status IN ('SUCCEEDED', 'FAILED', 'STOPPED', 'TIMED_OUT')
      AND terminal_start_at IS NOT NULL AND terminal_end_at IS NOT NULL
      AND terminal_end_at >= terminal_start_at AND durable_execution_arn IS NOT NULL)
  ),
  ADD CONSTRAINT preparation_outbox_finite_times_check CHECK (
    isfinite(created_at) AND (bound_at IS NULL OR isfinite(bound_at))
    AND (nudge_claimed_at IS NULL OR (isfinite(nudge_claimed_at) AND nudge_claimed_at >= created_at))
    AND (dispatch_claimed_at IS NULL OR isfinite(dispatch_claimed_at))
    AND (dispatch_expires_at IS NULL OR isfinite(dispatch_expires_at))
    AND (durable_started_at IS NULL OR isfinite(durable_started_at))
    AND (terminal_start_at IS NULL OR isfinite(terminal_start_at))
    AND (terminal_end_at IS NULL OR isfinite(terminal_end_at))
  );

CREATE INDEX preparation_outbox_dispatch_due_idx
  ON applications.preparation_outbox(created_at, id) WHERE terminal_status IS NULL;

CREATE FUNCTION applications.guard_preparation_outbox_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.preparation_id <> OLD.preparation_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.event_type <> OLD.event_type OR NEW.payload <> OLD.payload OR NEW.created_at <> OLD.created_at
    OR (OLD.workflow_function_arn IS NOT NULL AND (
      NEW.workflow_function_arn IS DISTINCT FROM OLD.workflow_function_arn
      OR NEW.durable_execution_name IS DISTINCT FROM OLD.durable_execution_name
      OR NEW.bound_at IS DISTINCT FROM OLD.bound_at))
    OR (OLD.durable_execution_arn IS NOT NULL AND (
      NEW.durable_execution_arn IS DISTINCT FROM OLD.durable_execution_arn
      OR NEW.durable_started_at IS DISTINCT FROM OLD.durable_started_at
      OR NEW.published_at IS DISTINCT FROM OLD.published_at))
    OR (OLD.nudge_claimed_at IS NOT NULL AND (NEW.nudge_claimed_at IS NULL OR NEW.nudge_claimed_at < OLD.nudge_claimed_at))
    OR (OLD.terminal_status IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'preparation outbox identity and execution binding are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.dispatch_lease_id IS NOT NULL AND (
    (NEW.dispatch_lease_id IS NULL AND NEW.durable_execution_arn IS NULL)
    OR (NEW.dispatch_lease_id = OLD.dispatch_lease_id AND (
      NEW.dispatch_claimed_at IS DISTINCT FROM OLD.dispatch_claimed_at
      OR NEW.dispatch_expires_at IS DISTINCT FROM OLD.dispatch_expires_at))
    OR (NEW.dispatch_lease_id IS NOT NULL AND NEW.dispatch_lease_id <> OLD.dispatch_lease_id
      AND NEW.dispatch_claimed_at < OLD.dispatch_expires_at)
  ) THEN
    RAISE EXCEPTION 'preparation dispatch leases cannot renew or rotate early' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER preparation_outbox_update_guard BEFORE UPDATE ON applications.preparation_outbox
  FOR EACH ROW EXECUTE FUNCTION applications.guard_preparation_outbox_update();
REVOKE ALL ON FUNCTION applications.guard_preparation_outbox_update() FROM PUBLIC;
