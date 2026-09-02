CREATE FUNCTION jobs.guard_candidate_job_contribution_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT privacy.current_candidate_deletion_authorized(OLD.owner_user_id) THEN
    RAISE EXCEPTION 'queued job contributions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER job_contributions_candidate_delete_guard
BEFORE DELETE ON jobs.job_contributions
FOR EACH ROW EXECUTE FUNCTION jobs.guard_candidate_job_contribution_delete();

CREATE FUNCTION jobs.guard_candidate_job_contribution_outbox_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  SELECT owner_user_id INTO candidate_user_id
  FROM jobs.job_contributions
  WHERE id = OLD.contribution_id;

  IF candidate_user_id IS NULL
    OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
    RAISE EXCEPTION 'job contribution outbox is append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER job_contribution_outbox_candidate_delete_guard
BEFORE DELETE ON jobs.job_contribution_outbox
FOR EACH ROW EXECUTE FUNCTION jobs.guard_candidate_job_contribution_outbox_delete();

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
      ), '[]'::jsonb),
      'contributions', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', contribution.id,
          'state', contribution.state,
          'source', jsonb_strip_nulls(jsonb_build_object(
            'provider', contribution.provider,
            'pageVariant', contribution.page_variant,
            'sourceUrl', contribution.source_url,
            'externalJobId', contribution.external_job_id,
            'adapterVersion', contribution.adapter_version
          )),
          'posting', jsonb_strip_nulls(jsonb_build_object(
            'companyName', contribution.payload #>> '{posting,companyName}',
            'title', contribution.payload #>> '{posting,title}',
            'locations', contribution.payload #> '{posting,locations}',
            'description', contribution.payload #>> '{posting,description}',
            'department', contribution.payload #>> '{posting,department}',
            'applicationUrl', contribution.payload #>> '{posting,applicationUrl}',
            'employmentType', contribution.payload #>> '{posting,employmentType}',
            'workMode', contribution.payload #>> '{posting,workMode}'
          )),
          'observation', jsonb_build_object('observedAt', contribution.observed_at),
          'approval', jsonb_build_object(
            'consentId', contribution.consent_id,
            'consentVersion', contribution.consent_version,
            'policyVersion', contribution.policy_version,
            'approvedAt', contribution.approved_at
          ),
          'createdAt', contribution.created_at,
          'updatedAt', contribution.updated_at
        )) ORDER BY contribution.created_at, contribution.id)
        FROM jobs.job_contributions AS contribution
        WHERE contribution.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(candidate_event.event
          ORDER BY candidate_event.occurred_at, candidate_event.id)
        FROM (
          SELECT report.id, report.created_at AS occurred_at,
            jsonb_build_object(
              'owner', 'jobs',
              'action', 'jobs.report.created',
              'resourceType', 'job_report',
              'resourceId', report.id,
              'occurredAt', report.created_at
            ) AS event
          FROM jobs.job_reports AS report
          WHERE report.reporter_user_id = candidate_user_id
          UNION ALL
          SELECT contribution.id, contribution.created_at AS occurred_at,
            jsonb_build_object(
              'owner', 'jobs',
              'action', 'jobs.contribution.queued',
              'resourceType', 'job_contribution',
              'resourceId', contribution.id,
              'occurredAt', contribution.created_at
            ) AS event
          FROM jobs.job_contributions AS contribution
          WHERE contribution.owner_user_id = candidate_user_id
        ) AS candidate_event
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
  contribution_outbox_deleted integer;
  contributions_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);

  DELETE FROM jobs.job_contribution_outbox AS contribution_outbox
  USING jobs.job_contributions AS contribution
  WHERE contribution_outbox.contribution_id = contribution.id
    AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS contribution_outbox_deleted = ROW_COUNT;

  DELETE FROM jobs.job_contributions
  WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS contributions_deleted = ROW_COUNT;

  DELETE FROM jobs.job_reports WHERE reporter_user_id = candidate_user_id;
  GET DIAGNOSTICS reports_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'owner', 'jobs',
    'reportsDeleted', reports_deleted,
    'contributionsDeleted', contributions_deleted,
    'contributionOutboxDeleted', contribution_outbox_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION jobs.guard_candidate_job_contribution_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.guard_candidate_job_contribution_outbox_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.delete_candidate_data(uuid, uuid) FROM PUBLIC;
