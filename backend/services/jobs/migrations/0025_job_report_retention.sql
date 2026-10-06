-- D1P-06: expire candidate linkage, preserving only per-job fixed-reason totals.
-- Serialize linkage creation and expiry by canonical job; never infer moderation authority.
LOCK TABLE jobs.job_reports, jobs.moderation_cases IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE jobs.job_report_case_links (
  report_id uuid PRIMARY KEY REFERENCES jobs.job_reports(id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES jobs.moderation_cases(id)
);
CREATE INDEX job_report_case_links_case_idx ON jobs.job_report_case_links(case_id);

CREATE TABLE jobs.job_report_retention_totals (
  canonical_job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id),
  reason text NOT NULL CHECK (reason IN (
    'job_closed', 'job_not_found', 'job_inaccurate', 'suspected_scam',
    'duplicate_listing', 'other_catalog_issue'
  )),
  report_count bigint NOT NULL CHECK (report_count > 0),
  PRIMARY KEY (canonical_job_id, reason)
);
CREATE INDEX job_reports_retention_created_idx ON jobs.job_reports(created_at, id);

-- Existing records have no explicit linkage. Use the first same-job case whose review
-- interval overlaps receipt or begins within the original 90-day retention window.
-- This associates integrity evidence; it does not assert that a reviewer read a report.
INSERT INTO jobs.job_report_case_links(report_id, case_id)
SELECT report.id, linked.id
FROM jobs.job_reports AS report
CROSS JOIN LATERAL (
  SELECT moderation_case.id
  FROM jobs.moderation_cases AS moderation_case
  WHERE moderation_case.target_kind = 'job'
    AND moderation_case.job_id = report.canonical_job_id
    AND moderation_case.opened_at <= report.created_at + interval '90 days'
    AND (moderation_case.resolved_at IS NULL OR moderation_case.resolved_at >= report.created_at)
  ORDER BY moderation_case.opened_at, moderation_case.id
  LIMIT 1
) AS linked;

CREATE FUNCTION jobs.lock_job_report_retention()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, jobs, privacy
AS $$
DECLARE
  target_job_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'job_reports' THEN
    target_job_id := NEW.canonical_job_id;
  ELSIF NEW.target_kind = 'job' THEN
    target_job_id := NEW.job_id;
  END IF;
  IF target_job_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('jobs:report-retention:' || target_job_id::text, 0));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_reports_retention_lock
BEFORE INSERT ON jobs.job_reports
FOR EACH ROW EXECUTE FUNCTION jobs.lock_job_report_retention();
CREATE TRIGGER moderation_cases_report_retention_lock
BEFORE INSERT ON jobs.moderation_cases
FOR EACH ROW EXECUTE FUNCTION jobs.lock_job_report_retention();

CREATE FUNCTION jobs.guard_job_report_case_link()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, jobs, privacy
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Only the report's own guarded deletion may cascade its link away.
    IF pg_trigger_depth() > 1 AND NOT EXISTS (
      SELECT 1 FROM jobs.job_reports WHERE id = OLD.report_id
    ) THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'report case linkage is immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP <> 'INSERT' OR NOT EXISTS (
    SELECT 1 FROM jobs.job_reports AS report
    JOIN jobs.moderation_cases AS moderation_case
      ON moderation_case.job_id = report.canonical_job_id
    WHERE report.id = NEW.report_id AND moderation_case.id = NEW.case_id
      AND moderation_case.target_kind = 'job'
      AND moderation_case.opened_at <= report.created_at + interval '90 days'
      AND (moderation_case.status = 'open' OR moderation_case.resolved_at >= report.created_at)
      AND report.created_at + interval '90 days' > clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'report case linkage is invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER job_report_case_links_guard
BEFORE INSERT OR UPDATE OR DELETE ON jobs.job_report_case_links
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_report_case_link();

CREATE FUNCTION jobs.link_job_report_case()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, jobs, privacy
AS $$
BEGIN
  IF TG_TABLE_NAME = 'job_reports' THEN
    INSERT INTO jobs.job_report_case_links(report_id, case_id)
    SELECT NEW.id, moderation_case.id FROM jobs.moderation_cases AS moderation_case
    WHERE moderation_case.target_kind = 'job' AND moderation_case.job_id = NEW.canonical_job_id
      AND moderation_case.opened_at <= NEW.created_at + interval '90 days'
      AND (moderation_case.status = 'open' OR moderation_case.resolved_at >= NEW.created_at)
    ORDER BY moderation_case.opened_at, moderation_case.id LIMIT 1;
  ELSIF NEW.target_kind = 'job' THEN
    INSERT INTO jobs.job_report_case_links(report_id, case_id)
    SELECT report.id, NEW.id FROM jobs.job_reports AS report
    WHERE report.canonical_job_id = NEW.job_id
      AND report.created_at + interval '90 days' > clock_timestamp()
      AND NOT EXISTS (
        SELECT 1 FROM jobs.job_report_case_links WHERE report_id = report.id
      );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER job_reports_link_case
AFTER INSERT ON jobs.job_reports
FOR EACH ROW EXECUTE FUNCTION jobs.link_job_report_case();
CREATE TRIGGER moderation_cases_link_reports
AFTER INSERT ON jobs.moderation_cases
FOR EACH ROW EXECUTE FUNCTION jobs.link_job_report_case();

CREATE FUNCTION jobs.job_report_retention_due(report_identifier uuid)
RETURNS boolean LANGUAGE sql
SET search_path = pg_catalog, jobs, privacy
AS $$
  SELECT EXISTS (
    SELECT 1 FROM jobs.job_reports AS report
    LEFT JOIN jobs.job_report_case_links AS link ON link.report_id = report.id
    LEFT JOIN jobs.moderation_cases AS moderation_case ON moderation_case.id = link.case_id
    WHERE report.id = report_identifier
      AND report.created_at + interval '90 days' <= clock_timestamp()
      AND (link.report_id IS NULL OR (
        moderation_case.status = 'resolved'
        AND moderation_case.resolved_at + interval '30 days' <= clock_timestamp()
      ))
  )
$$;

CREATE OR REPLACE FUNCTION jobs.guard_candidate_job_report_delete()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, jobs, privacy
AS $$
BEGIN
  -- Candidate deletion remains immediate and does not create additional retention proof.
  IF privacy.current_candidate_deletion_authorized(OLD.reporter_user_id) THEN
    RETURN OLD;
  END IF;
  IF NOT jobs.job_report_retention_due(OLD.id) THEN
    RAISE EXCEPTION 'jobs.job_reports is immutable' USING ERRCODE = '55000';
  END IF;
  INSERT INTO jobs.job_report_retention_totals(canonical_job_id, reason, report_count)
  VALUES (OLD.canonical_job_id, OLD.reason, 1)
  ON CONFLICT (canonical_job_id, reason) DO UPDATE
    SET report_count = jobs.job_report_retention_totals.report_count + 1;
  RETURN OLD;
END;
$$;

CREATE FUNCTION jobs.purge_expired_job_reports(batch_limit integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, jobs, privacy
AS $$
DECLARE
  candidate record;
  deleted_count integer := 0;
BEGIN
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 1000 THEN
    RAISE EXCEPTION 'report retention batch limit is invalid' USING ERRCODE = '22023';
  END IF;
  FOR candidate IN
    SELECT id, canonical_job_id FROM jobs.job_reports
    WHERE created_at + interval '90 days' <= clock_timestamp()
      AND jobs.job_report_retention_due(id)
    ORDER BY created_at, id LIMIT batch_limit
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended('jobs:report-retention:' || candidate.canonical_job_id::text, 0)
    );
    -- A case or another cleaner may have won while the job lock was pending.
    PERFORM 1 FROM jobs.job_reports WHERE id = candidate.id FOR UPDATE SKIP LOCKED;
    IF FOUND AND jobs.job_report_retention_due(candidate.id) THEN
      DELETE FROM jobs.job_reports WHERE id = candidate.id;
      deleted_count := deleted_count + 1;
    END IF;
  END LOOP;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON jobs.job_report_case_links, jobs.job_report_retention_totals FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.lock_job_report_retention() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.guard_job_report_case_link() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.link_job_report_case() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.job_report_retention_due(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.guard_candidate_job_report_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.purge_expired_job_reports(integer) FROM PUBLIC;
