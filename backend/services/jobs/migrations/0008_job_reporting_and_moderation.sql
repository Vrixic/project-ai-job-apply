CREATE TABLE jobs.job_reports (
  id uuid PRIMARY KEY,
  reporter_user_id uuid NOT NULL,
  requested_job_id uuid NOT NULL,
  canonical_job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id),
  reason text NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT job_reports_reason_ck CHECK (
    reason IN (
      'job_closed',
      'job_not_found',
      'job_inaccurate',
      'suspected_scam',
      'duplicate_listing',
      'other_catalog_issue'
    )
  ),
  CONSTRAINT job_reports_idempotency_hash_ck CHECK (
    idempotency_key_hash ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT job_reports_request_hash_ck CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT job_reports_owner_job_uq UNIQUE (reporter_user_id, canonical_job_id),
  CONSTRAINT job_reports_owner_idempotency_uq UNIQUE (reporter_user_id, idempotency_key_hash)
);

CREATE INDEX job_reports_owner_created_idx
  ON jobs.job_reports (reporter_user_id, created_at, id);
CREATE INDEX job_reports_canonical_reason_created_idx
  ON jobs.job_reports (canonical_job_id, reason, created_at, id);

CREATE TABLE jobs.moderation_cases (
  id uuid PRIMARY KEY,
  target_kind text NOT NULL,
  job_id uuid REFERENCES jobs.canonical_jobs(id),
  source_id text,
  adapter_version text,
  adapter_config_sha256 text,
  status text NOT NULL,
  resolution text,
  version integer NOT NULL,
  opened_by text NOT NULL,
  open_reason_code text NOT NULL,
  opened_at timestamptz NOT NULL,
  resolved_by text,
  resolution_reason_code text,
  resolved_at timestamptz,
  CONSTRAINT moderation_cases_target_kind_ck CHECK (target_kind IN ('job', 'source')),
  CONSTRAINT moderation_cases_target_shape_ck CHECK (
    (
      target_kind = 'job'
      AND job_id IS NOT NULL
      AND source_id IS NULL
      AND adapter_version IS NULL
      AND adapter_config_sha256 IS NULL
    ) OR (
      target_kind = 'source'
      AND job_id IS NULL
      AND source_id IS NOT NULL
      AND adapter_version IS NOT NULL
      AND adapter_config_sha256 IS NOT NULL
    )
  ),
  CONSTRAINT moderation_cases_source_id_ck CHECK (
    source_id IS NULL OR source_id ~ '^[a-z0-9][a-z0-9-]{2,63}$'
  ),
  CONSTRAINT moderation_cases_adapter_version_ck CHECK (
    adapter_version IS NULL OR (
      char_length(adapter_version) BETWEEN 1 AND 100
      AND adapter_version = btrim(adapter_version)
      AND adapter_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  ),
  CONSTRAINT moderation_cases_adapter_config_ck CHECK (
    adapter_config_sha256 IS NULL OR adapter_config_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT moderation_cases_state_ck CHECK (
    (
      status = 'open'
      AND resolution IS NULL
      AND version = 0
      AND resolved_by IS NULL
      AND resolution_reason_code IS NULL
      AND resolved_at IS NULL
    ) OR (
      status = 'resolved'
      AND resolution IN ('no_action', 'block_job', 'pause_source')
      AND version = 1
      AND resolved_by IS NOT NULL
      AND resolution_reason_code IS NOT NULL
      AND resolved_at IS NOT NULL
      AND opened_at <= resolved_at
    )
  ),
  CONSTRAINT moderation_cases_resolution_target_ck CHECK (
    resolution IS NULL
    OR resolution = 'no_action'
    OR (target_kind = 'job' AND resolution = 'block_job')
    OR (target_kind = 'source' AND resolution = 'pause_source')
  ),
  CONSTRAINT moderation_cases_operator_ck CHECK (
    opened_by = btrim(opened_by)
    AND char_length(opened_by) BETWEEN 3 AND 200
    AND opened_by ~ '^[A-Za-z0-9:_-]+$'
    AND (
      resolved_by IS NULL OR (
        resolved_by = btrim(resolved_by)
        AND char_length(resolved_by) BETWEEN 3 AND 200
        AND resolved_by ~ '^[A-Za-z0-9:_-]+$'
      )
    )
  ),
  CONSTRAINT moderation_cases_open_reason_ck CHECK (
    open_reason_code IN ('candidate_reports', 'catalog_integrity', 'source_integrity')
  ),
  CONSTRAINT moderation_cases_resolution_reason_ck CHECK (
    resolution_reason_code IS NULL OR resolution_reason_code IN (
      'insufficient_evidence',
      'report_confirmed',
      'catalog_policy_violation',
      'source_integrity_failure'
    )
  )
);

CREATE UNIQUE INDEX moderation_cases_open_job_uq
  ON jobs.moderation_cases (job_id)
  WHERE status = 'open' AND target_kind = 'job';
CREATE UNIQUE INDEX moderation_cases_open_source_uq
  ON jobs.moderation_cases (source_id, adapter_version, adapter_config_sha256)
  WHERE status = 'open' AND target_kind = 'source';
CREATE INDEX moderation_cases_source_control_idx
  ON jobs.moderation_cases (source_id, adapter_version, adapter_config_sha256, resolved_at, id)
  WHERE status = 'resolved' AND resolution = 'pause_source';

CREATE TABLE jobs.moderation_events (
  case_id uuid NOT NULL REFERENCES jobs.moderation_cases(id),
  version integer NOT NULL,
  action text NOT NULL,
  target_kind text NOT NULL,
  job_id uuid REFERENCES jobs.canonical_jobs(id),
  source_id text,
  adapter_version text,
  adapter_config_sha256 text,
  operator_id text NOT NULL,
  reason_code text NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (case_id, version),
  CONSTRAINT moderation_events_action_ck CHECK (
    action IN ('opened', 'resolved_no_action', 'resolved_block_job', 'resolved_pause_source')
  ),
  CONSTRAINT moderation_events_target_kind_ck CHECK (target_kind IN ('job', 'source')),
  CONSTRAINT moderation_events_target_shape_ck CHECK (
    (
      target_kind = 'job'
      AND job_id IS NOT NULL
      AND source_id IS NULL
      AND adapter_version IS NULL
      AND adapter_config_sha256 IS NULL
    ) OR (
      target_kind = 'source'
      AND job_id IS NULL
      AND source_id IS NOT NULL
      AND adapter_version IS NOT NULL
      AND adapter_config_sha256 IS NOT NULL
    )
  ),
  CONSTRAINT moderation_events_source_id_ck CHECK (
    source_id IS NULL OR source_id ~ '^[a-z0-9][a-z0-9-]{2,63}$'
  ),
  CONSTRAINT moderation_events_adapter_version_ck CHECK (
    adapter_version IS NULL OR (
      char_length(adapter_version) BETWEEN 1 AND 100
      AND adapter_version = btrim(adapter_version)
      AND adapter_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    )
  ),
  CONSTRAINT moderation_events_adapter_config_ck CHECK (
    adapter_config_sha256 IS NULL OR adapter_config_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT moderation_events_version_action_ck CHECK (
    (version = 0 AND action = 'opened')
    OR (version = 1 AND action <> 'opened')
  ),
  CONSTRAINT moderation_events_operator_ck CHECK (
    operator_id = btrim(operator_id)
    AND char_length(operator_id) BETWEEN 3 AND 200
    AND operator_id ~ '^[A-Za-z0-9:_-]+$'
  ),
  CONSTRAINT moderation_events_reason_ck CHECK (
    reason_code IN (
      'candidate_reports',
      'catalog_integrity',
      'source_integrity',
      'insufficient_evidence',
      'report_confirmed',
      'catalog_policy_violation',
      'source_integrity_failure'
    )
  )
);

CREATE INDEX moderation_events_occurred_idx
  ON jobs.moderation_events (occurred_at, case_id, version);

CREATE FUNCTION jobs.guard_job_report()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'jobs.job_reports is immutable';
  END IF;
  IF NEW.created_at > clock_timestamp() THEN
    RAISE EXCEPTION 'job report chronology is invalid';
  END IF;
  IF NOT EXISTS (
    WITH RECURSIVE resolution(id, path) AS (
      SELECT NEW.requested_job_id, ARRAY[NEW.requested_job_id]
      UNION ALL
      SELECT duplicate.canonical_job_id, resolution.path || duplicate.canonical_job_id
      FROM resolution
      INNER JOIN jobs.duplicate_candidates AS duplicate
        ON duplicate.resolution = 'exact'
        AND CASE
          WHEN duplicate.canonical_job_id = duplicate.job_id THEN duplicate.candidate_job_id
          ELSE duplicate.job_id
        END = resolution.id
      WHERE NOT duplicate.canonical_job_id = ANY(resolution.path)
    ), canonical AS (
      SELECT id FROM resolution ORDER BY cardinality(path) DESC LIMIT 1
    )
    SELECT 1
    FROM canonical
    INNER JOIN jobs.canonical_jobs AS job ON job.id = canonical.id
    WHERE canonical.id = NEW.canonical_job_id
      AND job.status = 'active'
      AND job.expires_at > NEW.created_at
      AND (job.valid_through IS NULL OR job.valid_through > NEW.created_at)
      AND job.description IS NOT NULL
      AND btrim(job.description) <> ''
  ) THEN
    RAISE EXCEPTION 'job report target is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_reports_guard
BEFORE INSERT OR UPDATE OR DELETE ON jobs.job_reports
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_report();

CREATE FUNCTION jobs.guard_moderation_case()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  previous_job_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'jobs.moderation_cases is immutable after creation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' OR NEW.version <> 0 OR NEW.opened_at > clock_timestamp() THEN
      RAISE EXCEPTION 'moderation case initial state is invalid';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' OR OLD.version <> 0
    OR NEW.status <> 'resolved' OR NEW.version <> 1
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.target_kind IS DISTINCT FROM OLD.target_kind
    OR NEW.job_id IS DISTINCT FROM OLD.job_id
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.adapter_version IS DISTINCT FROM OLD.adapter_version
    OR NEW.adapter_config_sha256 IS DISTINCT FROM OLD.adapter_config_sha256
    OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
    OR NEW.open_reason_code IS DISTINCT FROM OLD.open_reason_code
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.resolved_at > clock_timestamp()
  THEN
    RAISE EXCEPTION 'moderation case transition is invalid';
  END IF;

  IF NEW.resolution = 'block_job' THEN
    SELECT status INTO previous_job_status
    FROM jobs.canonical_jobs
    WHERE id = NEW.job_id
    FOR UPDATE;
    IF previous_job_status IS NULL
      OR previous_job_status NOT IN ('pending', 'active', 'suspect_stale')
    THEN
      RAISE EXCEPTION 'moderation block target is unavailable';
    END IF;
    UPDATE jobs.canonical_jobs
    SET status = 'blocked', status_reason = 'moderation_blocked', updated_at = NEW.resolved_at
    WHERE id = NEW.job_id;
    INSERT INTO jobs.status_events (id, job_id, from_status, to_status, reason, occurred_at)
    VALUES (NEW.id, NEW.job_id, previous_job_status, 'blocked', 'moderation_blocked', NEW.resolved_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER moderation_cases_guard
BEFORE INSERT OR UPDATE OR DELETE ON jobs.moderation_cases
FOR EACH ROW EXECUTE FUNCTION jobs.guard_moderation_case();

CREATE FUNCTION jobs.append_moderation_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO jobs.moderation_events (
    case_id, version, action, target_kind, job_id, source_id, adapter_version,
    adapter_config_sha256, operator_id, reason_code, occurred_at
  ) VALUES (
    NEW.id,
    NEW.version,
    CASE
      WHEN NEW.version = 0 THEN 'opened'
      ELSE 'resolved_' || NEW.resolution
    END,
    NEW.target_kind,
    NEW.job_id,
    NEW.source_id,
    NEW.adapter_version,
    NEW.adapter_config_sha256,
    CASE WHEN NEW.version = 0 THEN NEW.opened_by ELSE NEW.resolved_by END,
    CASE WHEN NEW.version = 0 THEN NEW.open_reason_code ELSE NEW.resolution_reason_code END,
    CASE WHEN NEW.version = 0 THEN NEW.opened_at ELSE NEW.resolved_at END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER moderation_cases_append_event
AFTER INSERT OR UPDATE ON jobs.moderation_cases
FOR EACH ROW EXECUTE FUNCTION jobs.append_moderation_event();

CREATE FUNCTION jobs.guard_moderation_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'jobs.moderation_events is append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jobs.moderation_cases AS moderation_case
    WHERE moderation_case.id = NEW.case_id
      AND moderation_case.version = NEW.version
      AND moderation_case.target_kind = NEW.target_kind
      AND moderation_case.job_id IS NOT DISTINCT FROM NEW.job_id
      AND moderation_case.source_id IS NOT DISTINCT FROM NEW.source_id
      AND moderation_case.adapter_version IS NOT DISTINCT FROM NEW.adapter_version
      AND moderation_case.adapter_config_sha256 IS NOT DISTINCT FROM NEW.adapter_config_sha256
      AND NEW.action = CASE
        WHEN moderation_case.version = 0 THEN 'opened'
        ELSE 'resolved_' || moderation_case.resolution
      END
      AND NEW.operator_id = CASE
        WHEN moderation_case.version = 0 THEN moderation_case.opened_by
        ELSE moderation_case.resolved_by
      END
      AND NEW.reason_code = CASE
        WHEN moderation_case.version = 0 THEN moderation_case.open_reason_code
        ELSE moderation_case.resolution_reason_code
      END
      AND NEW.occurred_at = CASE
        WHEN moderation_case.version = 0 THEN moderation_case.opened_at
        ELSE moderation_case.resolved_at
      END
  ) THEN
    RAISE EXCEPTION 'moderation event does not match its case';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER moderation_events_append_only
BEFORE INSERT OR UPDATE OR DELETE ON jobs.moderation_events
FOR EACH ROW EXECUTE FUNCTION jobs.guard_moderation_event();
