CREATE TABLE jobs.ingestion_checkpoints (
  execution_id text PRIMARY KEY,
  schema_version smallint NOT NULL,
  source_id text NOT NULL,
  adapter_version text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  state text NOT NULL,
  revision bigint NOT NULL,
  attempt smallint NOT NULL,
  withdrawal_inferred boolean NOT NULL,
  lease_id uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  prior_progress_unknown boolean,
  settled_attempt smallint,
  settled_lease_id uuid,
  settled_at timestamptz,
  settlement_key text,
  progress_known boolean,
  observation_count smallint,
  created_count smallint,
  updated_count smallint,
  retry_reason text,
  retry_at timestamptz,
  pause_reason text,
  failure_code text,
  exhausted_dispatch_id uuid,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT ingestion_checkpoints_execution_id_ck
    CHECK (execution_id ~ '^[a-f0-9]{64}$'),
  CONSTRAINT ingestion_checkpoints_contract_ck CHECK (
    schema_version = 1
    AND source_id ~ '^synthetic-[a-z0-9][a-z0-9-]{0,53}$'
    AND adapter_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
    AND revision BETWEEN 0 AND 9007199254740991
    AND attempt BETWEEN 1 AND 5
    AND withdrawal_inferred = false
    AND updated_at >= created_at
  ),
  CONSTRAINT ingestion_checkpoints_state_ck CHECK (
    (
      state = 'pending'
      AND lease_id IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL
      AND prior_progress_unknown IS NULL
      AND settled_attempt IS NULL AND settled_lease_id IS NULL AND settled_at IS NULL
      AND settlement_key IS NULL AND progress_known IS NULL
      AND observation_count IS NULL AND created_count IS NULL AND updated_count IS NULL
      AND retry_reason IS NULL AND retry_at IS NULL AND pause_reason IS NULL
      AND failure_code IS NULL AND exhausted_dispatch_id IS NULL
    ) OR (
      state = 'claimed'
      AND lease_id IS NOT NULL AND leased_at IS NOT NULL AND lease_expires_at IS NOT NULL
      AND prior_progress_unknown IS NOT NULL
      AND leased_at >= scheduled_for AND lease_expires_at > leased_at
      AND lease_expires_at <= leased_at + interval '15 minutes'
      AND lease_id::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      AND settled_attempt IS NULL AND settled_lease_id IS NULL AND settled_at IS NULL
      AND settlement_key IS NULL AND progress_known IS NULL
      AND observation_count IS NULL AND created_count IS NULL AND updated_count IS NULL
      AND retry_reason IS NULL AND retry_at IS NULL AND pause_reason IS NULL
      AND failure_code IS NULL AND exhausted_dispatch_id IS NULL
    ) OR (
      state IN ('retry_wait', 'paused', 'succeeded', 'dead_lettered')
      AND lease_id IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL
      AND prior_progress_unknown IS NULL
      AND settled_attempt BETWEEN 1 AND 5 AND settled_lease_id IS NOT NULL
      AND settled_at IS NOT NULL AND settled_at >= scheduled_for
      AND settled_lease_id::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      AND settlement_key ~ '^[a-f0-9]{64}$'
      AND progress_known IS NOT NULL
      AND observation_count BETWEEN 0 AND 100
      AND created_count BETWEEN 0 AND 100
      AND updated_count BETWEEN 0 AND 100
      AND observation_count = created_count + updated_count
      AND (progress_known OR observation_count = 0)
      AND (
        state = 'retry_wait'
        AND attempt = settled_attempt + 1
        AND retry_reason IN ('rate_limited', 'source_unavailable', 'timeout')
        AND retry_at > settled_at AND retry_at <= settled_at + interval '15 minutes'
        AND pause_reason IS NULL AND failure_code IS NULL AND exhausted_dispatch_id IS NULL
        OR state = 'paused'
        AND attempt = settled_attempt AND retry_reason IS NULL AND retry_at IS NULL
        AND pause_reason IN ('source_disabled', 'attempt_aborted') AND failure_code IS NULL
        AND exhausted_dispatch_id IS NULL
        OR state = 'succeeded'
        AND attempt = settled_attempt AND retry_reason IS NULL AND retry_at IS NULL
        AND pause_reason IS NULL AND failure_code IS NULL AND exhausted_dispatch_id IS NULL
        OR state = 'dead_lettered'
        AND attempt = settled_attempt AND retry_reason IS NULL AND retry_at IS NULL
        AND pause_reason IS NULL
        AND failure_code IN (
          'attempt_limit_exhausted', 'ingestion_attempt_failed',
          'source_contract_rejected'
        )
        AND exhausted_dispatch_id IS NULL
        AND (failure_code = 'attempt_limit_exhausted' OR progress_known = false)
      )
    ) OR (
      state = 'dead_lettered'
      AND lease_id IS NULL AND leased_at IS NULL AND lease_expires_at IS NULL
      AND prior_progress_unknown IS NULL
      AND settled_attempt IS NULL AND settled_lease_id IS NULL AND settled_at IS NULL
      AND settlement_key IS NULL AND progress_known IS NULL
      AND observation_count IS NULL AND created_count IS NULL AND updated_count IS NULL
      AND retry_reason IS NULL AND retry_at IS NULL AND pause_reason IS NULL
      AND failure_code = 'recovery_generation_exhausted'
      AND exhausted_dispatch_id IS NOT NULL
      AND exhausted_dispatch_id::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    )
  )
);

CREATE INDEX ingestion_checkpoints_due_idx
  ON jobs.ingestion_checkpoints (state, retry_at, lease_expires_at, execution_id)
  WHERE state IN ('claimed', 'retry_wait', 'paused');

CREATE FUNCTION jobs.valid_ingestion_checkpoint_event(value jsonb, checkpoint_state text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT jsonb_typeof(value) = 'object'
    AND ARRAY(SELECT key FROM jsonb_object_keys(value) AS keys(key) ORDER BY key COLLATE "C") =
      CASE checkpoint_state
        WHEN 'pending' THEN ARRAY[
          'adapterVersion', 'attempt', 'executionId', 'revision', 'scheduledFor',
          'schemaVersion', 'sourceId', 'state', 'withdrawalInferred'
        ]
        WHEN 'claimed' THEN ARRAY[
          'adapterVersion', 'attempt', 'executionId', 'leaseExpiresAt', 'leaseId',
          'leasedAt', 'priorProgressUnknown', 'revision', 'scheduledFor', 'schemaVersion',
          'sourceId', 'state', 'withdrawalInferred'
        ]
        WHEN 'retry_wait' THEN ARRAY[
          'adapterVersion', 'attempt', 'createdCount', 'executionId', 'observationCount',
          'progressKnown', 'retryAt', 'retryReason', 'revision', 'scheduledFor', 'schemaVersion',
          'settledAt', 'settledAttempt', 'settledLeaseId', 'settlementKey', 'sourceId',
          'state', 'updatedCount', 'withdrawalInferred'
        ]
        WHEN 'paused' THEN ARRAY[
          'adapterVersion', 'attempt', 'createdCount', 'executionId', 'observationCount',
          'pauseReason', 'progressKnown', 'revision', 'scheduledFor', 'schemaVersion',
          'settledAt', 'settledAttempt', 'settledLeaseId', 'settlementKey', 'sourceId',
          'state', 'updatedCount', 'withdrawalInferred'
        ]
        WHEN 'succeeded' THEN ARRAY[
          'adapterVersion', 'attempt', 'createdCount', 'executionId', 'observationCount',
          'progressKnown', 'revision', 'scheduledFor', 'schemaVersion', 'settledAt',
          'settledAttempt', 'settledLeaseId', 'settlementKey', 'sourceId', 'state',
          'updatedCount', 'withdrawalInferred'
        ]
        WHEN 'dead_lettered' THEN CASE
          WHEN value->>'failureCode' = 'recovery_generation_exhausted' THEN ARRAY[
            'adapterVersion', 'attempt', 'executionId', 'exhaustedDispatchId', 'failureCode',
            'revision', 'scheduledFor', 'schemaVersion', 'sourceId', 'state',
            'withdrawalInferred'
          ]
          ELSE ARRAY[
          'adapterVersion', 'attempt', 'createdCount', 'executionId', 'failureCode',
          'observationCount', 'progressKnown', 'revision', 'scheduledFor', 'schemaVersion',
          'settledAt', 'settledAttempt', 'settledLeaseId', 'settlementKey', 'sourceId',
          'state', 'updatedCount', 'withdrawalInferred'
          ] END
        ELSE ARRAY[]::text[]
      END;
$$;

CREATE TABLE jobs.ingestion_run_events (
  execution_id text NOT NULL REFERENCES jobs.ingestion_checkpoints(execution_id),
  revision bigint NOT NULL,
  state text NOT NULL,
  attempt smallint NOT NULL,
  occurred_at timestamptz NOT NULL,
  checkpoint jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (execution_id, revision),
  CONSTRAINT ingestion_run_events_shape_ck CHECK (
    execution_id ~ '^[a-f0-9]{64}$'
    AND revision BETWEEN 0 AND 9007199254740991
    AND state IN ('pending', 'claimed', 'retry_wait', 'paused', 'succeeded', 'dead_lettered')
    AND attempt BETWEEN 1 AND 5
    AND jobs.valid_ingestion_checkpoint_event(checkpoint, state)
    AND checkpoint->>'executionId' = execution_id
    AND (checkpoint->>'revision')::bigint = revision
    AND checkpoint->>'state' = state
    AND (checkpoint->>'attempt')::smallint = attempt
  )
);

CREATE INDEX ingestion_run_events_occurred_idx
  ON jobs.ingestion_run_events (occurred_at, execution_id, revision);

CREATE TABLE jobs.ingestion_dispatches (
  id uuid PRIMARY KEY,
  execution_id text NOT NULL REFERENCES jobs.ingestion_checkpoints(execution_id),
  generation integer NOT NULL,
  checkpoint_revision bigint NOT NULL,
  durable_execution_name text NOT NULL,
  durable_function_arn text NOT NULL,
  activity_function_arn text NOT NULL,
  adapter_config_sha256 text NOT NULL,
  state text NOT NULL,
  claim_id uuid,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  publish_attempts smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error_code text,
  durable_execution_arn text,
  durable_execution_id text,
  terminal_status text,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (execution_id, generation),
  UNIQUE (durable_execution_name),
  FOREIGN KEY (execution_id, checkpoint_revision)
    REFERENCES jobs.ingestion_run_events(execution_id, revision),
  CONSTRAINT ingestion_dispatches_identity_ck CHECK (
    id::text ~ '^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
    AND execution_id ~ '^[a-f0-9]{64}$'
    AND generation BETWEEN 1 AND 20
    AND checkpoint_revision BETWEEN 0 AND 9007199254740991
    AND durable_execution_name ~ '^[a-f0-9]{64}$'
    AND durable_function_arn ~ '^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]*$'
    AND activity_function_arn ~ '^arn:(aws|aws-us-gov|aws-cn):lambda:[a-z0-9-]+:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:[1-9][0-9]*$'
    AND adapter_config_sha256 ~ '^[a-f0-9]{64}$'
    AND publish_attempts BETWEEN 0 AND 5
    AND (last_error_code IS NULL OR last_error_code IN (
      'IngestionDispatchFailure', 'IngestionNudgeNotAccepted', 'NudgeStartUnconfirmed',
      'RecoveryGenerationLimit', 'ServiceUnavailableException', 'ThrottlingException',
      'TimeoutError', 'TooManyRequestsException', 'TransportRecoveryExhausted'
    ))
    AND updated_at >= created_at
  ),
  CONSTRAINT ingestion_dispatches_state_ck CHECK (
    (state = 'pending' AND publish_attempts BETWEEN 0 AND 4
      AND claim_id IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
      AND (last_error_code IS NULL OR last_error_code IN (
        'IngestionDispatchFailure', 'IngestionNudgeNotAccepted', 'NudgeStartUnconfirmed',
        'ServiceUnavailableException', 'ThrottlingException', 'TimeoutError',
        'TooManyRequestsException'))
      AND durable_execution_arn IS NULL AND durable_execution_id IS NULL AND terminal_status IS NULL)
    OR (state = 'claimed' AND publish_attempts BETWEEN 0 AND 4
      AND claim_id IS NOT NULL AND claimed_at IS NOT NULL
      AND (last_error_code IS NULL OR last_error_code IN (
        'IngestionDispatchFailure', 'IngestionNudgeNotAccepted', 'NudgeStartUnconfirmed',
        'ServiceUnavailableException', 'ThrottlingException', 'TimeoutError',
        'TooManyRequestsException'))
      AND claim_expires_at > claimed_at AND claim_expires_at <= claimed_at + interval '1 minute'
      AND durable_execution_arn IS NULL AND durable_execution_id IS NULL AND terminal_status IS NULL)
    OR (state = 'nudged' AND publish_attempts BETWEEN 1 AND 5
      AND claim_id IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
      AND last_error_code IS NULL
      AND durable_execution_arn IS NULL AND durable_execution_id IS NULL AND terminal_status IS NULL)
    OR (state = 'started' AND publish_attempts BETWEEN 1 AND 5
      AND claim_id IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
      AND last_error_code IS NULL
      AND durable_execution_arn = durable_function_arn || '/durable-execution/' || durable_execution_name || '/' || durable_execution_id
      AND durable_execution_id ~ '^[A-Za-z0-9_-]+$' AND length(durable_execution_arn) <= 1024
      AND terminal_status IS NULL)
    OR (state = 'terminal' AND publish_attempts BETWEEN 1 AND 5
      AND claim_id IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
      AND (last_error_code IS NULL OR last_error_code = 'TransportRecoveryExhausted')
      AND durable_execution_arn = durable_function_arn || '/durable-execution/' || durable_execution_name || '/' || durable_execution_id
      AND durable_execution_id ~ '^[A-Za-z0-9_-]+$' AND length(durable_execution_arn) <= 1024
      AND terminal_status IN ('FAILED', 'STOPPED', 'SUCCEEDED', 'TIMED_OUT'))
    OR (state = 'publish_failed' AND publish_attempts = 5
      AND claim_id IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
      AND last_error_code IN (
        'IngestionDispatchFailure', 'IngestionNudgeNotAccepted',
        'ServiceUnavailableException', 'ThrottlingException', 'TimeoutError',
        'TooManyRequestsException')
      AND durable_execution_arn IS NULL AND durable_execution_id IS NULL AND terminal_status IS NULL)
    OR (state = 'recovery_exhausted' AND publish_attempts BETWEEN 1 AND 5
      AND claim_id IS NULL AND claimed_at IS NULL AND claim_expires_at IS NULL
      AND ((last_error_code = 'TransportRecoveryExhausted' AND publish_attempts = 5
        AND durable_execution_arn IS NULL AND durable_execution_id IS NULL
        AND terminal_status IS NULL)
      OR (last_error_code = 'RecoveryGenerationLimit' AND generation = 20 AND (
        (durable_execution_arn IS NULL AND durable_execution_id IS NULL AND terminal_status IS NULL)
        OR (
          durable_execution_arn = durable_function_arn || '/durable-execution/' || durable_execution_name || '/' || durable_execution_id
          AND durable_execution_id ~ '^[A-Za-z0-9_-]+$' AND length(durable_execution_arn) <= 1024
          AND terminal_status IN ('FAILED', 'STOPPED', 'SUCCEEDED', 'TIMED_OUT')
        )
      )))
  )
));

CREATE INDEX ingestion_dispatches_pending_idx
  ON jobs.ingestion_dispatches (next_attempt_at, created_at, id)
  WHERE state IN ('pending', 'claimed');

ALTER TABLE jobs.ingestion_checkpoints
  ADD CONSTRAINT ingestion_checkpoints_exhausted_dispatch_fk
  FOREIGN KEY (exhausted_dispatch_id) REFERENCES jobs.ingestion_dispatches(id);

CREATE FUNCTION jobs.guard_ingestion_checkpoint()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ingestion checkpoints are retained audit truth';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.revision <> 0 OR NEW.attempt <> 1
      OR NEW.created_at > clock_timestamp() OR NEW.updated_at <> NEW.created_at
      OR NEW.scheduled_for > clock_timestamp() THEN
      RAISE EXCEPTION 'ingestion checkpoints must begin at the exact pending occurrence';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.execution_id IS DISTINCT FROM OLD.execution_id
      OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
      OR NEW.source_id IS DISTINCT FROM OLD.source_id
      OR NEW.adapter_version IS DISTINCT FROM OLD.adapter_version
      OR NEW.scheduled_for IS DISTINCT FROM OLD.scheduled_for
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.revision <> OLD.revision + 1
      OR NEW.updated_at <= OLD.updated_at
      OR NEW.updated_at > clock_timestamp()
      OR (NEW.leased_at IS NOT NULL AND NEW.leased_at > clock_timestamp())
      OR (NEW.settled_at IS NOT NULL AND NEW.settled_at > clock_timestamp()) THEN
      RAISE EXCEPTION 'ingestion checkpoint identity, revision, or chronology is invalid';
    END IF;
    allowed :=
      (
        NEW.state = 'claimed'
        AND NEW.attempt = OLD.attempt
        AND NEW.leased_at >= OLD.updated_at
        AND (
          (OLD.state = 'pending' AND NEW.prior_progress_unknown = false)
          OR (
            OLD.state = 'claimed'
            AND OLD.lease_expires_at <= NEW.leased_at
            AND NEW.prior_progress_unknown = true
          )
          OR (
            OLD.state = 'retry_wait'
            AND OLD.retry_at <= NEW.leased_at
            AND NEW.prior_progress_unknown = NOT OLD.progress_known
          )
          OR (
            OLD.state = 'paused'
            AND NEW.prior_progress_unknown = NOT OLD.progress_known
          )
        )
      )
      OR (
        NEW.state = 'paused'
        AND OLD.state IN ('pending', 'claimed', 'retry_wait')
        AND NEW.attempt = OLD.attempt
        AND NEW.settled_attempt = OLD.attempt
        AND (OLD.state <> 'claimed' OR NEW.settled_lease_id = OLD.lease_id)
        AND (OLD.state <> 'claimed' OR NEW.settled_at BETWEEN OLD.leased_at AND OLD.lease_expires_at)
        AND (OLD.state <> 'claimed' OR NOT OLD.prior_progress_unknown OR NEW.progress_known = false)
      )
      OR (
        OLD.state = 'claimed'
        AND NEW.state IN ('retry_wait', 'succeeded', 'dead_lettered')
        AND NEW.settled_attempt = OLD.attempt
        AND NEW.settled_lease_id = OLD.lease_id
        AND NEW.settled_at BETWEEN OLD.leased_at AND OLD.lease_expires_at
        AND (NOT OLD.prior_progress_unknown OR NEW.progress_known = false)
      )
      OR (
        OLD.state IN ('pending', 'claimed', 'retry_wait')
        AND NEW.state = 'dead_lettered'
        AND NEW.attempt = OLD.attempt
        AND NEW.failure_code = 'recovery_generation_exhausted'
        AND NEW.exhausted_dispatch_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jobs.ingestion_dispatches AS exhausted
          WHERE exhausted.id=NEW.exhausted_dispatch_id
            AND exhausted.execution_id=NEW.execution_id
            AND exhausted.generation=20
            AND exhausted.state='recovery_exhausted'
            AND exhausted.last_error_code='RecoveryGenerationLimit'
        )
      );
    IF NOT allowed THEN
      RAISE EXCEPTION 'ingestion checkpoint state transition is invalid';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ingestion_checkpoints_guard
BEFORE INSERT OR UPDATE OR DELETE ON jobs.ingestion_checkpoints
FOR EACH ROW EXECUTE FUNCTION jobs.guard_ingestion_checkpoint();

CREATE FUNCTION jobs.append_ingestion_run_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO jobs.ingestion_run_events (
    execution_id, revision, state, attempt, occurred_at, checkpoint
  ) VALUES (
    NEW.execution_id,
    NEW.revision,
    NEW.state,
    NEW.attempt,
    CASE WHEN NEW.failure_code='recovery_generation_exhausted'
      THEN NEW.updated_at
      ELSE COALESCE(NEW.settled_at, NEW.leased_at, NEW.scheduled_for)
    END,
    jsonb_build_object(
      'schemaVersion', NEW.schema_version,
      'executionId', NEW.execution_id,
      'sourceId', NEW.source_id,
      'adapterVersion', NEW.adapter_version,
      'scheduledFor', to_char(NEW.scheduled_for AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'state', NEW.state,
      'revision', NEW.revision,
      'attempt', NEW.attempt,
      'withdrawalInferred', NEW.withdrawal_inferred
    ) || jsonb_strip_nulls(jsonb_build_object(
      'leaseId', NEW.lease_id,
      'leasedAt', to_char(NEW.leased_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'leaseExpiresAt', to_char(NEW.lease_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'priorProgressUnknown', NEW.prior_progress_unknown,
      'settledAttempt', NEW.settled_attempt,
      'settledLeaseId', NEW.settled_lease_id,
      'settledAt', to_char(NEW.settled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'settlementKey', NEW.settlement_key,
      'progressKnown', NEW.progress_known,
      'observationCount', NEW.observation_count,
      'createdCount', NEW.created_count,
      'updatedCount', NEW.updated_count,
      'retryReason', NEW.retry_reason,
      'retryAt', to_char(NEW.retry_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'pauseReason', NEW.pause_reason,
      'failureCode', NEW.failure_code,
      'exhaustedDispatchId', NEW.exhausted_dispatch_id
    ))
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER ingestion_checkpoints_append_event
AFTER INSERT OR UPDATE ON jobs.ingestion_checkpoints
FOR EACH ROW EXECUTE FUNCTION jobs.append_ingestion_run_event();

CREATE FUNCTION jobs.guard_ingestion_run_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ingestion run events are append-only';
END;
$$;

CREATE TRIGGER ingestion_run_events_append_only
BEFORE INSERT OR UPDATE OR DELETE ON jobs.ingestion_run_events
FOR EACH ROW EXECUTE FUNCTION jobs.guard_ingestion_run_event();

CREATE FUNCTION jobs.guard_ingestion_dispatch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed boolean;
  checkpoint_current boolean;
  previous_terminal boolean;
  root_runtime_compatible boolean;
  scheduled_for timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ingestion dispatches are retained audit truth';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM jobs.ingestion_checkpoints AS checkpoint
      WHERE checkpoint.execution_id=NEW.execution_id
        AND checkpoint.revision=NEW.checkpoint_revision
        AND checkpoint.state NOT IN ('succeeded', 'dead_lettered')
    ), max(checkpoint.scheduled_for) FROM jobs.ingestion_checkpoints AS checkpoint
      WHERE checkpoint.execution_id=NEW.execution_id
    INTO checkpoint_current, scheduled_for;
    SELECT EXISTS (
      SELECT 1 FROM jobs.ingestion_dispatches AS previous
      WHERE previous.execution_id=NEW.execution_id
        AND previous.generation=NEW.generation-1
        AND previous.state = 'terminal'
    ) INTO previous_terminal;
    SELECT EXISTS (
      SELECT 1 FROM jobs.ingestion_dispatches AS root
      WHERE root.execution_id=NEW.execution_id AND root.generation=1
        AND root.adapter_config_sha256=NEW.adapter_config_sha256
        AND regexp_replace(root.durable_function_arn, ':[0-9]+$', '') =
            regexp_replace(NEW.durable_function_arn, ':[0-9]+$', '')
        AND regexp_replace(root.activity_function_arn, ':[0-9]+$', '') =
            regexp_replace(NEW.activity_function_arn, ':[0-9]+$', '')
    ) INTO root_runtime_compatible;
    IF NEW.state <> 'pending'
      OR NEW.publish_attempts <> 0
      OR NEW.last_error_code IS NOT NULL
      OR NEW.created_at > clock_timestamp()
      OR NEW.updated_at <> NEW.created_at
      OR NOT checkpoint_current
      OR (NEW.generation=1 AND NEW.checkpoint_revision <> 0)
      OR (NEW.generation=1 AND NEW.next_attempt_at <> scheduled_for)
      OR (NEW.generation>1 AND (NOT previous_terminal OR NOT root_runtime_compatible)) THEN
      RAISE EXCEPTION 'ingestion dispatches must begin pending and unpublished';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.execution_id IS DISTINCT FROM OLD.execution_id
    OR NEW.generation IS DISTINCT FROM OLD.generation
    OR NEW.checkpoint_revision IS DISTINCT FROM OLD.checkpoint_revision
    OR NEW.durable_execution_name IS DISTINCT FROM OLD.durable_execution_name
    OR NEW.durable_function_arn IS DISTINCT FROM OLD.durable_function_arn
    OR NEW.activity_function_arn IS DISTINCT FROM OLD.activity_function_arn
    OR NEW.adapter_config_sha256 IS DISTINCT FROM OLD.adapter_config_sha256
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.updated_at <= OLD.updated_at
    OR NEW.updated_at > clock_timestamp()
    OR (NEW.claimed_at IS NOT NULL AND NEW.claimed_at > clock_timestamp())
    OR NEW.next_attempt_at > clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION 'ingestion dispatch identity or chronology is invalid';
  END IF;
  IF OLD.state IN ('started', 'terminal') AND (
    NEW.durable_execution_arn IS DISTINCT FROM OLD.durable_execution_arn
    OR NEW.durable_execution_id IS DISTINCT FROM OLD.durable_execution_id
  ) THEN
    RAISE EXCEPTION 'ingestion durable execution identity is immutable after start';
  END IF;
  allowed :=
    (OLD.state = 'pending' AND NEW.state = 'claimed'
      AND NEW.claimed_at >= OLD.updated_at
      AND NEW.publish_attempts = OLD.publish_attempts
      AND NEW.next_attempt_at = OLD.next_attempt_at
      AND NEW.last_error_code IS NOT DISTINCT FROM OLD.last_error_code)
    OR (
      OLD.state = 'claimed'
      AND NEW.state = 'claimed'
      AND NEW.claimed_at >= OLD.claim_expires_at
      AND NEW.claim_id IS DISTINCT FROM OLD.claim_id
      AND NEW.publish_attempts = OLD.publish_attempts
      AND NEW.next_attempt_at = OLD.next_attempt_at
      AND NEW.last_error_code IS NOT DISTINCT FROM OLD.last_error_code
    )
    OR (OLD.state = 'claimed' AND NEW.state = 'nudged'
      AND NEW.publish_attempts = OLD.publish_attempts + 1
      AND NEW.next_attempt_at = OLD.next_attempt_at AND NEW.last_error_code IS NULL)
    OR (OLD.state = 'pending' AND NEW.state = 'nudged'
      AND OLD.publish_attempts BETWEEN 1 AND 4
      AND NEW.publish_attempts = OLD.publish_attempts
      AND NEW.next_attempt_at = OLD.next_attempt_at AND NEW.last_error_code IS NULL)
    OR (OLD.state = 'publish_failed' AND NEW.state = 'nudged'
      AND NEW.publish_attempts = 5
      AND NEW.next_attempt_at = OLD.next_attempt_at AND NEW.last_error_code IS NULL)
    OR (OLD.state = 'recovery_exhausted' AND NEW.state = 'nudged'
      AND OLD.last_error_code = 'TransportRecoveryExhausted'
      AND OLD.durable_execution_arn IS NULL AND OLD.durable_execution_id IS NULL
      AND NEW.publish_attempts = 5
      AND NEW.next_attempt_at = OLD.next_attempt_at AND NEW.last_error_code IS NULL)
    OR (OLD.state = 'claimed' AND NEW.state IN ('pending', 'publish_failed')
      AND NEW.publish_attempts = OLD.publish_attempts + 1
      AND NEW.next_attempt_at > OLD.next_attempt_at AND NEW.last_error_code IS NOT NULL)
    OR (OLD.state = 'nudged' AND NEW.state = 'started'
      AND NEW.publish_attempts = OLD.publish_attempts
      AND NEW.next_attempt_at = OLD.next_attempt_at
      AND NEW.last_error_code IS NOT DISTINCT FROM OLD.last_error_code)
    OR (OLD.state = 'nudged' AND NEW.state = 'pending'
      AND OLD.publish_attempts < 5
      AND NEW.publish_attempts = OLD.publish_attempts
      AND NEW.next_attempt_at > OLD.next_attempt_at
      AND NEW.last_error_code = 'NudgeStartUnconfirmed')
    OR (OLD.state IN ('nudged', 'started') AND NEW.state = 'terminal'
      AND NEW.publish_attempts = OLD.publish_attempts
      AND NEW.next_attempt_at = OLD.next_attempt_at
      AND NEW.last_error_code IS NOT DISTINCT FROM OLD.last_error_code)
    OR (OLD.state = 'recovery_exhausted' AND NEW.state = 'terminal'
      AND OLD.last_error_code = 'TransportRecoveryExhausted'
      AND OLD.durable_execution_arn IS NULL AND OLD.durable_execution_id IS NULL
      AND NEW.publish_attempts = OLD.publish_attempts
      AND NEW.next_attempt_at = OLD.next_attempt_at
      AND NEW.last_error_code IS NOT DISTINCT FROM OLD.last_error_code)
    OR (OLD.state IN ('nudged', 'publish_failed') AND NEW.state = 'recovery_exhausted'
      AND NEW.publish_attempts = OLD.publish_attempts
      AND NEW.next_attempt_at = OLD.next_attempt_at
      AND NEW.publish_attempts = 5
      AND NEW.last_error_code = 'TransportRecoveryExhausted'
      AND NEW.durable_execution_arn IS NULL AND NEW.durable_execution_id IS NULL
      AND NEW.terminal_status IS NULL)
    OR (OLD.state = 'terminal' AND NEW.state = 'recovery_exhausted'
      AND OLD.generation = 20 AND NEW.generation = 20
      AND NEW.publish_attempts = OLD.publish_attempts
      AND NEW.next_attempt_at = OLD.next_attempt_at
      AND NEW.last_error_code = 'RecoveryGenerationLimit'
      AND NEW.durable_execution_arn IS NOT DISTINCT FROM OLD.durable_execution_arn
      AND NEW.durable_execution_id IS NOT DISTINCT FROM OLD.durable_execution_id
      AND NEW.terminal_status IS NOT DISTINCT FROM OLD.terminal_status);
  IF NOT allowed THEN
    RAISE EXCEPTION 'ingestion dispatch transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ingestion_dispatches_guard
BEFORE INSERT OR UPDATE OR DELETE ON jobs.ingestion_dispatches
FOR EACH ROW EXECUTE FUNCTION jobs.guard_ingestion_dispatch();
