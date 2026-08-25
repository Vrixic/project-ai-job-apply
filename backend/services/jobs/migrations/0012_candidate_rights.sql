DROP TRIGGER job_reports_guard ON jobs.job_reports;
CREATE TRIGGER job_reports_guard
BEFORE INSERT OR UPDATE ON jobs.job_reports
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_report();

CREATE OR REPLACE FUNCTION jobs.guard_candidate_job_report_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT privacy.current_candidate_deletion_authorized(OLD.reporter_user_id) THEN
    RAISE EXCEPTION 'jobs.job_reports is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER job_reports_candidate_delete_guard
BEFORE DELETE ON jobs.job_reports
FOR EACH ROW EXECUTE FUNCTION jobs.guard_candidate_job_report_delete();

CREATE OR REPLACE FUNCTION jobs.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, jobs
AS $$
  SELECT jsonb_build_object(
    'jobs', jsonb_build_object(
      'reports', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'requestedJobId', requested_job_id,
          'canonicalJobId', canonical_job_id,
          'reason', reason,
          'createdAt', created_at
        ) ORDER BY created_at, id)
        FROM jobs.job_reports WHERE reporter_user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'owner', 'jobs',
          'action', 'jobs.report.created',
          'resourceType', 'job_report',
          'resourceId', id,
          'occurredAt', created_at
        ) ORDER BY created_at, id)
        FROM jobs.job_reports WHERE reporter_user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
$$;

CREATE OR REPLACE FUNCTION jobs.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, jobs, privacy
AS $$
DECLARE
  reports_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);
  DELETE FROM jobs.job_reports WHERE reporter_user_id = candidate_user_id;
  GET DIAGNOSTICS reports_deleted = ROW_COUNT;
  RETURN jsonb_build_object('owner', 'jobs', 'reportsDeleted', reports_deleted);
END;
$$;

REVOKE ALL ON FUNCTION jobs.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.delete_candidate_data(uuid, uuid) FROM PUBLIC;
