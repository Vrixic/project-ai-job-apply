-- D1P-06: discard closed case/operator detail after 365 days without undoing controls.
LOCK TABLE jobs.moderation_cases, jobs.moderation_events IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE jobs.job_moderation_blocks (
  job_id uuid PRIMARY KEY REFERENCES jobs.canonical_jobs(id),
  last_action_at timestamptz NOT NULL
);
CREATE TABLE jobs.source_moderation_pauses (
  source_id text NOT NULL CHECK (source_id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  adapter_version text NOT NULL CHECK (
    char_length(adapter_version) BETWEEN 1 AND 100
    AND adapter_version = btrim(adapter_version)
    AND adapter_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
  ),
  adapter_config_sha256 text NOT NULL CHECK (adapter_config_sha256 ~ '^[a-f0-9]{64}$'),
  last_action_at timestamptz NOT NULL,
  PRIMARY KEY (source_id, adapter_version, adapter_config_sha256)
);
CREATE INDEX moderation_cases_retention_idx ON jobs.moderation_cases(resolved_at, id)
  WHERE status = 'resolved';

INSERT INTO jobs.job_moderation_blocks(job_id, last_action_at)
SELECT job_id, max(resolved_at) FROM jobs.moderation_cases
WHERE status = 'resolved' AND resolution = 'block_job' GROUP BY job_id;
INSERT INTO jobs.source_moderation_pauses(source_id, adapter_version, adapter_config_sha256, last_action_at)
SELECT source_id, adapter_version, adapter_config_sha256, max(resolved_at)
FROM jobs.moderation_cases WHERE status = 'resolved' AND resolution = 'pause_source'
GROUP BY source_id, adapter_version, adapter_config_sha256;

CREATE FUNCTION jobs.guard_moderation_control()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, jobs, privacy
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'source_moderation_pauses' THEN
      RAISE EXCEPTION 'moderation control is still required' USING ERRCODE = '55000';
    END IF;
    IF OLD.last_action_at + interval '365 days' <= clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM jobs.canonical_jobs WHERE id = OLD.job_id AND status = 'blocked')
      AND NOT EXISTS (SELECT 1 FROM jobs.moderation_cases WHERE job_id = OLD.job_id AND resolution = 'block_job')
    THEN
      RETURN OLD;
    END IF;
    -- D1 has no source resume/retirement authority. Its exact pause remains a live control.
    RAISE EXCEPTION 'moderation control is still required' USING ERRCODE = '55000';
  END IF;
  IF NEW.last_action_at > clock_timestamp() OR (TG_OP = 'UPDATE' AND NEW.last_action_at < OLD.last_action_at) THEN
    RAISE EXCEPTION 'moderation control chronology is invalid' USING ERRCODE = '55000';
  END IF;
  IF TG_TABLE_NAME = 'job_moderation_blocks' THEN
    IF (TG_OP = 'UPDATE' AND NEW.job_id IS DISTINCT FROM OLD.job_id) OR NOT EXISTS (
      SELECT 1 FROM jobs.moderation_cases WHERE target_kind = 'job' AND job_id = NEW.job_id
        AND status = 'resolved' AND resolution = 'block_job' AND resolved_at = NEW.last_action_at
    ) THEN
      RAISE EXCEPTION 'job block control is invalid' USING ERRCODE = '55000';
    END IF;
  ELSE
    IF (TG_OP = 'UPDATE' AND (
      NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.adapter_version IS DISTINCT FROM OLD.adapter_version
      OR NEW.adapter_config_sha256 IS DISTINCT FROM OLD.adapter_config_sha256
    )) OR NOT EXISTS (
      SELECT 1 FROM jobs.moderation_cases WHERE target_kind = 'source' AND source_id = NEW.source_id
        AND adapter_version = NEW.adapter_version AND adapter_config_sha256 = NEW.adapter_config_sha256
        AND status = 'resolved' AND resolution = 'pause_source' AND resolved_at = NEW.last_action_at
    ) THEN
      RAISE EXCEPTION 'source pause control is invalid' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER job_moderation_blocks_guard BEFORE INSERT OR UPDATE OR DELETE ON jobs.job_moderation_blocks
FOR EACH ROW EXECUTE FUNCTION jobs.guard_moderation_control();
CREATE TRIGGER source_moderation_pauses_guard BEFORE INSERT OR UPDATE OR DELETE ON jobs.source_moderation_pauses
FOR EACH ROW EXECUTE FUNCTION jobs.guard_moderation_control();

CREATE FUNCTION jobs.append_moderation_control()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, jobs, privacy
AS $$
BEGIN
  IF NEW.resolution = 'block_job' THEN
    INSERT INTO jobs.job_moderation_blocks(job_id, last_action_at) VALUES (NEW.job_id, NEW.resolved_at)
    ON CONFLICT (job_id) DO UPDATE SET last_action_at = EXCLUDED.last_action_at;
  ELSIF NEW.resolution = 'pause_source' THEN
    INSERT INTO jobs.source_moderation_pauses(source_id, adapter_version, adapter_config_sha256, last_action_at)
    VALUES (NEW.source_id, NEW.adapter_version, NEW.adapter_config_sha256, NEW.resolved_at)
    ON CONFLICT (source_id, adapter_version, adapter_config_sha256) DO UPDATE SET last_action_at = EXCLUDED.last_action_at;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER moderation_cases_append_control AFTER UPDATE ON jobs.moderation_cases
FOR EACH ROW EXECUTE FUNCTION jobs.append_moderation_control();

CREATE FUNCTION jobs.moderation_case_retention_due(case_identifier uuid)
RETURNS boolean LANGUAGE sql
SET search_path = pg_catalog, jobs, privacy
AS $$
  SELECT EXISTS (
    SELECT 1 FROM jobs.moderation_cases AS moderation_case
    WHERE moderation_case.id = case_identifier AND moderation_case.status = 'resolved'
      AND moderation_case.resolved_at + interval '365 days' <= clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM jobs.job_report_case_links WHERE case_id = moderation_case.id)
      AND (
        moderation_case.resolution = 'no_action' OR (
          moderation_case.resolution = 'block_job' AND EXISTS (
            SELECT 1 FROM jobs.job_moderation_blocks WHERE job_id = moderation_case.job_id
              AND last_action_at >= moderation_case.resolved_at
          )
        ) OR (
          moderation_case.resolution = 'pause_source' AND EXISTS (
            SELECT 1 FROM jobs.source_moderation_pauses WHERE source_id = moderation_case.source_id
              AND adapter_version = moderation_case.adapter_version
              AND adapter_config_sha256 = moderation_case.adapter_config_sha256
              AND last_action_at >= moderation_case.resolved_at
          )
        )
      )
  )
$$;

-- Preserve the original insert/update invariants and add only deadline-guarded deletion.
DROP TRIGGER moderation_cases_guard ON jobs.moderation_cases;
CREATE TRIGGER moderation_cases_guard BEFORE INSERT OR UPDATE ON jobs.moderation_cases
FOR EACH ROW EXECUTE FUNCTION jobs.guard_moderation_case();
DROP TRIGGER moderation_events_append_only ON jobs.moderation_events;
CREATE TRIGGER moderation_events_append_only BEFORE INSERT OR UPDATE ON jobs.moderation_events
FOR EACH ROW EXECUTE FUNCTION jobs.guard_moderation_event();

CREATE FUNCTION jobs.guard_expired_moderation_delete()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, jobs, privacy
AS $$
DECLARE
  target_case_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'moderation_cases' THEN target_case_id := OLD.id;
  ELSE target_case_id := OLD.case_id;
  END IF;
  IF NOT jobs.moderation_case_retention_due(target_case_id) THEN
    RAISE EXCEPTION 'moderation evidence is immutable before expiry' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER moderation_cases_retention_delete_guard BEFORE DELETE ON jobs.moderation_cases
FOR EACH ROW EXECUTE FUNCTION jobs.guard_expired_moderation_delete();
CREATE TRIGGER moderation_events_retention_delete_guard BEFORE DELETE ON jobs.moderation_events
FOR EACH ROW EXECUTE FUNCTION jobs.guard_expired_moderation_delete();

CREATE FUNCTION jobs.purge_expired_moderation_cases(batch_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, jobs, privacy
AS $$
DECLARE
  candidate record;
  cases_deleted integer := 0;
  events_deleted integer := 0;
  controls_deleted integer := 0;
  affected integer;
BEGIN
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 1000 THEN
    RAISE EXCEPTION 'moderation retention batch limit is invalid' USING ERRCODE = '22023';
  END IF;
  FOR candidate IN
    SELECT id FROM jobs.moderation_cases
    WHERE resolved_at <= statement_timestamp() - interval '365 days'
      AND jobs.moderation_case_retention_due(id)
    ORDER BY resolved_at, id LIMIT batch_limit FOR UPDATE SKIP LOCKED
  LOOP
    IF jobs.moderation_case_retention_due(candidate.id) THEN
      DELETE FROM jobs.moderation_events WHERE case_id = candidate.id;
      GET DIAGNOSTICS affected = ROW_COUNT;
      events_deleted := events_deleted + affected;
      DELETE FROM jobs.moderation_cases WHERE id = candidate.id;
      cases_deleted := cases_deleted + 1;
    END IF;
  END LOOP;
  FOR candidate IN
    SELECT block.job_id FROM jobs.job_moderation_blocks AS block
    WHERE block.last_action_at <= statement_timestamp() - interval '365 days'
      AND NOT EXISTS (SELECT 1 FROM jobs.canonical_jobs WHERE id = block.job_id AND status = 'blocked')
      AND NOT EXISTS (SELECT 1 FROM jobs.moderation_cases WHERE job_id = block.job_id AND resolution = 'block_job')
    ORDER BY block.last_action_at, block.job_id LIMIT batch_limit FOR UPDATE OF block SKIP LOCKED
  LOOP
    DELETE FROM jobs.job_moderation_blocks WHERE job_id = candidate.job_id;
    controls_deleted := controls_deleted + 1;
  END LOOP;
  RETURN jsonb_build_object('casesDeleted', cases_deleted, 'eventsDeleted', events_deleted, 'controlsDeleted', controls_deleted);
END;
$$;

REVOKE ALL ON jobs.job_moderation_blocks, jobs.source_moderation_pauses FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.guard_moderation_control() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.append_moderation_control() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.moderation_case_retention_due(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.guard_expired_moderation_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.purge_expired_moderation_cases(integer) FROM PUBLIC;
