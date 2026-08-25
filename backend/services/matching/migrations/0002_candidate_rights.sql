DROP TRIGGER matching_audit_events_immutable ON matching.audit_events;
CREATE TRIGGER matching_audit_events_immutable
BEFORE UPDATE ON matching.audit_events
FOR EACH ROW EXECUTE FUNCTION matching.reject_audit_event_mutation();

CREATE OR REPLACE FUNCTION matching.guard_candidate_audit_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT privacy.current_candidate_deletion_authorized(OLD.owner_user_id) THEN
    RAISE EXCEPTION 'matching.audit_events is append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER matching_audit_events_candidate_delete_guard
BEFORE DELETE ON matching.audit_events
FOR EACH ROW EXECUTE FUNCTION matching.guard_candidate_audit_delete();

CREATE OR REPLACE FUNCTION matching.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, matching
AS $$
  SELECT jsonb_build_object(
    'matching', jsonb_build_object(
      'savedJobs', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'requestedJobId', requested_job_id,
          'canonicalJobIdAtSave', resolved_canonical_job_id_at_save,
          'titleAtSave', snapshot_title,
          'companyNameAtSave', snapshot_company_name,
          'locationsAtSave', to_jsonb(snapshot_locations),
          'savedAt', saved_at
        ) ORDER BY saved_at, id)
        FROM matching.saved_jobs WHERE owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'owner', 'matching',
          'action', 'matching.saved-job.' || action,
          'resourceType', 'saved_job',
          'resourceId', saved_job_id,
          'occurredAt', occurred_at
        ) ORDER BY occurred_at, id)
        FROM matching.audit_events WHERE owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
$$;

CREATE OR REPLACE FUNCTION matching.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, matching, privacy
AS $$
DECLARE
  saved_jobs_deleted integer;
  audit_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);
  DELETE FROM matching.audit_events WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS audit_deleted = ROW_COUNT;
  DELETE FROM matching.idempotency_keys WHERE owner_user_id = candidate_user_id;
  DELETE FROM matching.saved_jobs WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS saved_jobs_deleted = ROW_COUNT;
  DELETE FROM matching.saved_job_list_state WHERE owner_user_id = candidate_user_id;
  RETURN jsonb_build_object(
    'owner', 'matching',
    'savedJobsDeleted', saved_jobs_deleted,
    'auditEventsDeleted', audit_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION matching.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION matching.delete_candidate_data(uuid, uuid) FROM PUBLIC;
