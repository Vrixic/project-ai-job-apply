-- D1P-06: portable owner reports include only their exact linked review status.
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
          'id', report.id, 'requestedJobId', report.requested_job_id,
          'canonicalJobId', report.canonical_job_id, 'reason', report.reason,
          'createdAt', report.created_at,
          'status', CASE WHEN linked_case.status = 'open' THEN 'under_review'
            WHEN linked_case.status = 'resolved' THEN 'resolved' ELSE 'received' END
        ) ORDER BY report.created_at, report.id)
        FROM jobs.job_reports AS report
        LEFT JOIN jobs.job_report_case_links AS link ON link.report_id = report.id
        LEFT JOIN jobs.moderation_cases AS linked_case ON linked_case.id = link.case_id
        WHERE report.reporter_user_id = candidate_user_id
      ), '[]'::jsonb),
      'contributions', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', contribution.id,
          'state', COALESCE(state_event.state, contribution.state),
          'client', CASE WHEN contribution.client_surface IS NULL THEN NULL ELSE
            jsonb_build_object('surface', contribution.client_surface, 'version', contribution.client_version)
          END,
          'source', jsonb_strip_nulls(jsonb_build_object(
            'provider', contribution.provider, 'pageVariant', contribution.page_variant,
            'sourceUrl', contribution.source_url, 'externalJobId', contribution.external_job_id,
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
            'consentId', contribution.consent_id, 'consentVersion', contribution.consent_version,
            'policyVersion', contribution.policy_version, 'approvedAt', contribution.approved_at
          ),
          'processingHistory', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'state', event.state, 'reasonCode', event.reason_code,
              'policyVersion', event.processing_policy_version, 'occurredAt', event.occurred_at
            ) ORDER BY event.occurred_at, event.id)
            FROM jobs.job_contribution_state_events AS event
            WHERE event.contribution_id = contribution.id
          ), '[]'::jsonb),
          'trustHistory', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'status', decision.status, 'policyVersion', decision.trust_policy_version,
              'decidedAt', decision.decided_at
            ) ORDER BY decision.decided_at, decision.id)
            FROM jobs.job_contribution_trust_decisions AS decision
            WHERE decision.contribution_id = contribution.id
          ), '[]'::jsonb),
          'publication', CASE WHEN publication.id IS NULL THEN NULL ELSE jsonb_build_object(
            'jobId', publication.job_id, 'state', publication.state,
            'createdAt', publication.created_at, 'updatedAt', publication.updated_at
          ) END,
          'createdAt', contribution.created_at, 'updatedAt', contribution.updated_at
        )) ORDER BY contribution.created_at, contribution.id)
        FROM jobs.job_contributions AS contribution
        LEFT JOIN LATERAL (
          SELECT event.state FROM jobs.job_contribution_state_events AS event
          WHERE event.contribution_id = contribution.id
          ORDER BY event.occurred_at DESC, event.id DESC LIMIT 1
        ) AS state_event ON true
        LEFT JOIN jobs.job_contribution_reconciliations AS publication
          ON publication.contribution_id = contribution.id AND publication.kind = 'publication'
        WHERE contribution.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(candidate_event.event ORDER BY candidate_event.occurred_at, candidate_event.id)
        FROM (
          SELECT report.id, report.created_at AS occurred_at,
            jsonb_build_object(
              'owner', 'jobs', 'action', 'jobs.report.created',
              'resourceType', 'job_report', 'resourceId', report.id,
              'occurredAt', report.created_at
            ) AS event
          FROM jobs.job_reports AS report WHERE report.reporter_user_id = candidate_user_id
          UNION ALL
          SELECT contribution.id, contribution.created_at AS occurred_at,
            jsonb_build_object(
              'owner', 'jobs', 'action', 'jobs.contribution.queued',
              'resourceType', 'job_contribution', 'resourceId', contribution.id,
              'occurredAt', contribution.created_at
            ) AS event
          FROM jobs.job_contributions AS contribution
          WHERE contribution.owner_user_id = candidate_user_id
          UNION ALL
          SELECT event.id, event.occurred_at,
            jsonb_build_object(
              'owner', 'jobs', 'action', 'jobs.contribution.state_changed',
              'resourceType', 'job_contribution', 'resourceId', event.contribution_id,
              'occurredAt', event.occurred_at
            ) AS event
          FROM jobs.job_contribution_state_events AS event
          JOIN jobs.job_contributions AS contribution ON contribution.id = event.contribution_id
          WHERE contribution.owner_user_id = candidate_user_id
        ) AS candidate_event
      ), '[]'::jsonb)
    )
  )
$$;

REVOKE ALL ON FUNCTION jobs.export_candidate_data(uuid) FROM PUBLIC;
