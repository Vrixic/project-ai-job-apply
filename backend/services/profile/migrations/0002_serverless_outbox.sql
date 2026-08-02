ALTER TABLE platform.outbox_events
  ADD COLUMN dispatch_target text NOT NULL DEFAULT 'temporal',
  ADD COLUMN nudge_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN nudge_claimed_at timestamptz,
  ADD COLUMN nudge_next_attempt_at timestamptz,
  ADD COLUMN nudged_at timestamptz,
  ADD COLUMN nudge_last_error_code text,
  ADD COLUMN durable_start_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN durable_started_at timestamptz,
  ADD COLUMN durable_execution_name text,
  ADD COLUMN durable_execution_arn text,
  ADD COLUMN durable_last_error_code text;

ALTER TABLE platform.outbox_events
  ADD CONSTRAINT outbox_events_dispatch_target_check
  CHECK (dispatch_target IN ('temporal', 'lambda_durable')),
  ADD CONSTRAINT outbox_events_nudge_attempts_check
  CHECK (nudge_attempts >= 0),
  ADD CONSTRAINT outbox_events_durable_start_attempts_check
  CHECK (durable_start_attempts >= 0);

CREATE INDEX outbox_events_lambda_nudge_idx
  ON platform.outbox_events (
    dispatch_target,
    published_at,
    nudge_next_attempt_at,
    nudge_claimed_at,
    created_at
  )
  WHERE dispatch_target = 'lambda_durable' AND published_at IS NULL;

CREATE UNIQUE INDEX outbox_events_durable_execution_name_uq
  ON platform.outbox_events (durable_execution_name)
  WHERE durable_execution_name IS NOT NULL;
