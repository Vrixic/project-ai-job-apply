-- D2 durable contribution processing. Historical intake has no trustworthy installed-client
-- version and remains intentionally nonprocessable. New intake must persist both fields.
ALTER TABLE jobs.job_contributions
  ADD COLUMN client_surface text,
  ADD COLUMN client_version text,
  ADD CONSTRAINT job_contributions_client_ck CHECK (
    (client_surface IS NULL AND client_version IS NULL) OR
    (
      client_surface = 'browser_extension'
      AND client_version ~ '^(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})\.(?:0|[1-9][0-9]{0,5})(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,15})?$'
      AND char_length(client_version) BETWEEN 5 AND 32
    )
  );

CREATE INDEX job_contributions_processable_idx
  ON jobs.job_contributions (created_at, id)
  WHERE client_surface = 'browser_extension' AND client_version IS NOT NULL;

CREATE TABLE jobs.job_contribution_processing_queue (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL UNIQUE
    REFERENCES jobs.job_contributions(id) ON DELETE CASCADE,
  state text NOT NULL,
  attempt integer NOT NULL,
  available_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  claimed_by text,
  last_error_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT job_contribution_processing_queue_state_ck CHECK (
    state IN ('pending', 'claimed', 'parked', 'completed', 'dead')
  ),
  CONSTRAINT job_contribution_processing_queue_attempt_ck CHECK (attempt BETWEEN 0 AND 5),
  CONSTRAINT job_contribution_processing_queue_claim_ck CHECK (
    (state = 'claimed' AND claimed_at IS NOT NULL AND claim_expires_at IS NOT NULL
      AND claim_expires_at > claimed_at AND claimed_by IS NOT NULL
      AND claimed_by = btrim(claimed_by) AND char_length(claimed_by) BETWEEN 3 AND 100
      AND claimed_by ~ '^[A-Za-z0-9:_-]+$')
    OR
    (state <> 'claimed' AND claimed_at IS NULL AND claim_expires_at IS NULL AND claimed_by IS NULL)
  ),
  CONSTRAINT job_contribution_processing_queue_error_ck CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'capability_dependency', 'capability_disabled', 'consent_dependency', 'processing_dependency',
      'provider_pending', 'trust_pending'
    )
  ),
  CONSTRAINT job_contribution_processing_queue_chronology_ck CHECK (
    updated_at >= created_at AND available_at >= created_at
  )
);

CREATE INDEX job_contribution_processing_queue_claim_idx
  ON jobs.job_contribution_processing_queue (available_at, created_at, id)
  WHERE state = 'pending';
CREATE INDEX job_contribution_processing_queue_lease_idx
  ON jobs.job_contribution_processing_queue (claim_expires_at, id)
  WHERE state = 'claimed';

CREATE TABLE jobs.job_contribution_normalizations (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL UNIQUE
    REFERENCES jobs.job_contributions(id) ON DELETE CASCADE,
  proposal_sha256 text NOT NULL,
  normalized_company_name text,
  normalized_title text NOT NULL,
  normalized_locations jsonb NOT NULL,
  normalized_description_sha256 text,
  normalized_department text,
  application_url_sha256 text,
  employment_type text,
  work_mode text,
  exact_identity_keys jsonb NOT NULL,
  fuzzy_fingerprint_sha256 text NOT NULL,
  provider text NOT NULL,
  page_variant text NOT NULL,
  canonical_source_url text NOT NULL,
  canonical_source_url_sha256 text NOT NULL,
  ats_tenant text NOT NULL,
  external_job_id text,
  adapter_version text NOT NULL,
  contributed_content_sha256 text NOT NULL,
  observed_at timestamptz NOT NULL,
  processing_policy_version text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT job_contribution_normalizations_digest_ck CHECK (
    proposal_sha256 ~ '^[a-f0-9]{64}$'
    AND canonical_source_url_sha256 ~ '^[a-f0-9]{64}$'
    AND contributed_content_sha256 ~ '^[a-f0-9]{64}$'
    AND fuzzy_fingerprint_sha256 ~ '^[a-f0-9]{64}$'
    AND (normalized_description_sha256 IS NULL OR normalized_description_sha256 ~ '^[a-f0-9]{64}$')
    AND (application_url_sha256 IS NULL OR application_url_sha256 ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT job_contribution_normalizations_provider_ck CHECK (
    (provider = 'greenhouse' AND page_variant = 'greenhouse-board-v1') OR
    (provider = 'lever' AND page_variant = 'lever-posting-v1') OR
    (provider = 'ashby' AND page_variant = 'ashby-job-board-v1')
  ),
  CONSTRAINT job_contribution_normalizations_shape_ck CHECK (
    normalized_title = btrim(normalized_title)
    AND char_length(normalized_title) BETWEEN 1 AND 240
    AND (normalized_company_name IS NULL OR char_length(normalized_company_name) BETWEEN 1 AND 200)
    AND (normalized_department IS NULL OR char_length(normalized_department) BETWEEN 1 AND 200)
    AND jsonb_typeof(normalized_locations) = 'array'
    AND jsonb_array_length(normalized_locations) <= 20
    AND jsonb_typeof(exact_identity_keys) = 'array'
    AND jsonb_array_length(exact_identity_keys) BETWEEN 1 AND 2
    AND canonical_source_url ~ '^https://'
    AND char_length(canonical_source_url) BETWEEN 9 AND 4096
    AND ats_tenant = btrim(ats_tenant) AND char_length(ats_tenant) BETWEEN 1 AND 200
    AND adapter_version = 'd2-job-page-v1'
  ),
  CONSTRAINT job_contribution_normalizations_attributes_ck CHECK (
    employment_type IS NULL OR employment_type IN
      ('full_time', 'part_time', 'contract', 'internship', 'unknown')
  ),
  CONSTRAINT job_contribution_normalizations_work_mode_ck CHECK (
    work_mode IS NULL OR work_mode IN ('remote', 'hybrid', 'on_site', 'unknown')
  ),
  CONSTRAINT job_contribution_normalizations_policy_ck CHECK (
    processing_policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
  )
);

CREATE TABLE jobs.job_contribution_independent_verifications (
  id uuid PRIMARY KEY REFERENCES jobs.source_verification_evidence(id),
  contribution_id uuid NOT NULL UNIQUE
    REFERENCES jobs.job_contributions(id) ON DELETE CASCADE,
  normalization_id uuid NOT NULL UNIQUE
    REFERENCES jobs.job_contribution_normalizations(id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id),
  source_id uuid NOT NULL REFERENCES jobs.job_sources(id),
  provider text NOT NULL,
  page_variant text NOT NULL,
  canonical_source_url_sha256 text NOT NULL,
  evidence_digest_sha256 text NOT NULL,
  verified_content_sha256 text NOT NULL,
  source_policy_version text NOT NULL,
  verified_at timestamptz NOT NULL,
  processing_policy_version text NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT job_contribution_independent_verifications_provider_ck CHECK (
    (provider = 'greenhouse' AND page_variant = 'greenhouse-board-v1') OR
    (provider = 'lever' AND page_variant = 'lever-posting-v1') OR
    (provider = 'ashby' AND page_variant = 'ashby-job-board-v1')
  ),
  CONSTRAINT job_contribution_independent_verifications_digest_ck CHECK (
    canonical_source_url_sha256 ~ '^[a-f0-9]{64}$'
    AND evidence_digest_sha256 ~ '^[a-f0-9]{64}$'
    AND verified_content_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT job_contribution_independent_verifications_policy_ck CHECK (
    source_policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
    AND processing_policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
  ),
  CONSTRAINT job_contribution_independent_verifications_chronology_ck CHECK (
    created_at >= verified_at
  )
);

CREATE INDEX job_contribution_independent_verifications_source_idx
  ON jobs.job_contribution_independent_verifications (source_id, verified_at DESC, id);

CREATE TABLE jobs.job_contribution_trust_decisions (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL REFERENCES jobs.job_contributions(id) ON DELETE CASCADE,
  status text NOT NULL,
  trust_policy_version text NOT NULL,
  processing_policy_version text NOT NULL,
  decided_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT job_contribution_trust_decisions_identity_uq UNIQUE (contribution_id, id),
  CONSTRAINT job_contribution_trust_decisions_status_ck CHECK (
    status IN ('accepted', 'rejected', 'withdrawn', 'taken_down')
  ),
  CONSTRAINT job_contribution_trust_decisions_policy_ck CHECK (
    trust_policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
    AND processing_policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
  ),
  CONSTRAINT job_contribution_trust_decisions_chronology_ck CHECK (created_at >= decided_at)
);

CREATE INDEX job_contribution_trust_decisions_current_idx
  ON jobs.job_contribution_trust_decisions (contribution_id, decided_at DESC, id DESC);

CREATE TABLE jobs.job_contribution_state_events (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL REFERENCES jobs.job_contributions(id) ON DELETE CASCADE,
  state text NOT NULL,
  reason_code text NOT NULL,
  processing_policy_version text NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT job_contribution_state_events_semantic_uq
    UNIQUE (contribution_id, state, reason_code),
  CONSTRAINT job_contribution_state_events_state_ck CHECK (
    state IN (
      'queued', 'normalized', 'awaiting_independent_verification',
      'independently_verified', 'awaiting_trust', 'rejected',
      'ready_for_publication', 'published', 'consent_invalid',
      'withdrawn', 'taken_down', 'removed'
    )
  ),
  CONSTRAINT job_contribution_state_events_reason_ck CHECK (
    reason_code IN (
      'normalization_complete', 'consent_not_current',
      'provider_temporarily_unavailable', 'provider_observation_mismatch',
      'provider_posting_closed', 'independent_verification_complete',
      'trust_review_required', 'trust_policy_rejected', 'trust_withdrawal',
      'trust_takedown', 'publication_gates_complete', 'publication_complete',
      'terminal_reconciliation_complete'
    )
  ),
  CONSTRAINT job_contribution_state_events_policy_ck CHECK (
    processing_policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
  )
);

CREATE INDEX job_contribution_state_events_owner_view_idx
  ON jobs.job_contribution_state_events (contribution_id, occurred_at, id);

CREATE TABLE jobs.job_contribution_reconciliations (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL REFERENCES jobs.job_contributions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  state text NOT NULL,
  normalization_id uuid NOT NULL REFERENCES jobs.job_contribution_normalizations(id),
  independent_verification_id uuid NOT NULL
    REFERENCES jobs.job_contribution_independent_verifications(id),
  trust_decision_id uuid NOT NULL REFERENCES jobs.job_contribution_trust_decisions(id),
  job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id),
  source_id uuid NOT NULL REFERENCES jobs.job_sources(id),
  terminal_reason text,
  processing_policy_version text NOT NULL,
  capability_policy_version text NOT NULL,
  capability_configuration_digest_sha256 text NOT NULL,
  capability_evaluated_at timestamptz NOT NULL,
  capability_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT job_contribution_reconciliations_kind_uq UNIQUE (contribution_id, kind),
  CONSTRAINT job_contribution_reconciliations_kind_ck CHECK (kind IN ('publication', 'removal')),
  CONSTRAINT job_contribution_reconciliations_state_ck CHECK (state IN ('prepared', 'applied')),
  CONSTRAINT job_contribution_reconciliations_terminal_ck CHECK (
    (kind = 'publication' AND terminal_reason IS NULL) OR
    (kind = 'removal' AND terminal_reason IN ('withdrawn', 'taken_down'))
  ),
  CONSTRAINT job_contribution_reconciliations_policy_ck CHECK (
    processing_policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
    AND capability_policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
    AND capability_configuration_digest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT job_contribution_reconciliations_chronology_ck CHECK (
    updated_at >= created_at
    AND capability_evaluated_at <= created_at
    AND capability_expires_at > capability_evaluated_at
  )
);

CREATE TABLE jobs.job_contribution_processing_outbox (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL REFERENCES jobs.job_contributions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  subject text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT job_contribution_processing_outbox_semantic_uq UNIQUE (contribution_id, event_type),
  CONSTRAINT job_contribution_processing_outbox_event_ck CHECK (
    (event_type = 'job.normalized.v1'
      AND data = jsonb_build_object(
        'contributionId', contribution_id::text,
        'normalizationId', data->>'normalizationId'
      )
      AND data->>'normalizationId' ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    OR
    (event_type = 'job.verified.v1'
      AND data = jsonb_build_object(
        'jobId', data->>'jobId',
        'sourceId', data->>'sourceId',
        'verificationId', data->>'verificationId'
      )
      AND data->>'jobId' ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND data->>'sourceId' ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND data->>'verificationId' ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ),
  CONSTRAINT job_contribution_processing_outbox_subject_ck CHECK (
    subject = contribution_id::text
  )
);

CREATE INDEX job_contribution_processing_outbox_pending_idx
  ON jobs.job_contribution_processing_outbox (created_at, id);

CREATE FUNCTION jobs.guard_job_contribution_processing_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    RAISE EXCEPTION 'job contribution processing evidence is append-only' USING ERRCODE = '55000';
  END IF;
  SELECT owner_user_id INTO candidate_user_id
  FROM jobs.job_contributions WHERE id = OLD.contribution_id;
  IF candidate_user_id IS NULL
    OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
    RAISE EXCEPTION 'job contribution processing evidence is append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE FUNCTION jobs.guard_job_contribution_processing_queue()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT owner_user_id INTO candidate_user_id
    FROM jobs.job_contributions WHERE id = OLD.contribution_id;
    IF candidate_user_id IS NULL
      OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
      RAISE EXCEPTION 'job contribution processing queue requires candidate deletion authority'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.attempt <> 0 OR NEW.last_error_code IS NOT NULL THEN
      RAISE EXCEPTION 'job contribution processing queue must begin pending'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('completed', 'dead') THEN
    RAISE EXCEPTION 'terminal job contribution processing work is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id <> OLD.id OR NEW.contribution_id <> OLD.contribution_id
    OR NEW.created_at <> OLD.created_at
    OR (OLD.state <> 'parked' AND NEW.attempt < OLD.attempt)
    OR NEW.attempt > OLD.attempt + 1 THEN
    RAISE EXCEPTION 'job contribution processing queue identity is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'pending' AND NOT (
    NEW.state = 'claimed' AND NEW.attempt = OLD.attempt + 1
    AND NEW.last_error_code IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid job contribution processing claim transition'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'claimed' AND NOT (
    NEW.state IN ('pending', 'parked', 'completed', 'dead') AND NEW.attempt = OLD.attempt
  ) THEN
    RAISE EXCEPTION 'invalid job contribution processing completion transition'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'parked' AND NOT (
    NEW.state = 'pending' AND NEW.attempt = 0 AND NEW.last_error_code IS NULL
  ) THEN
    RAISE EXCEPTION 'parked job contribution work requires an explicit signal'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_contribution_processing_queue_guard
BEFORE INSERT OR UPDATE OR DELETE ON jobs.job_contribution_processing_queue
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_processing_queue();

CREATE TRIGGER job_contribution_normalizations_append_only
BEFORE UPDATE OR DELETE ON jobs.job_contribution_normalizations
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_processing_append_only();
CREATE TRIGGER job_contribution_independent_verifications_append_only
BEFORE UPDATE OR DELETE ON jobs.job_contribution_independent_verifications
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_processing_append_only();
CREATE TRIGGER job_contribution_trust_decisions_append_only
BEFORE UPDATE OR DELETE ON jobs.job_contribution_trust_decisions
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_processing_append_only();
CREATE TRIGGER job_contribution_state_events_append_only
BEFORE UPDATE OR DELETE ON jobs.job_contribution_state_events
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_processing_append_only();
CREATE TRIGGER job_contribution_processing_outbox_append_only
BEFORE UPDATE OR DELETE ON jobs.job_contribution_processing_outbox
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_processing_append_only();

CREATE FUNCTION jobs.guard_job_contribution_reconciliation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_user_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT owner_user_id INTO candidate_user_id
    FROM jobs.job_contributions WHERE id = OLD.contribution_id;
    IF candidate_user_id IS NULL
      OR NOT privacy.current_candidate_deletion_authorized(candidate_user_id) THEN
      RAISE EXCEPTION 'job contribution reconciliation is immutable' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.state <> 'prepared' OR NEW.state <> 'applied'
    OR NEW.id <> OLD.id OR NEW.contribution_id <> OLD.contribution_id
    OR NEW.kind <> OLD.kind OR NEW.normalization_id <> OLD.normalization_id
    OR NEW.independent_verification_id <> OLD.independent_verification_id
    OR NEW.trust_decision_id <> OLD.trust_decision_id
    OR NEW.job_id <> OLD.job_id OR NEW.source_id <> OLD.source_id
    OR NEW.terminal_reason IS DISTINCT FROM OLD.terminal_reason
    OR NEW.processing_policy_version <> OLD.processing_policy_version
    OR NEW.capability_policy_version <> OLD.capability_policy_version
    OR NEW.capability_configuration_digest_sha256 <>
      OLD.capability_configuration_digest_sha256
    OR NEW.capability_evaluated_at <> OLD.capability_evaluated_at
    OR NEW.capability_expires_at <> OLD.capability_expires_at
    OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'invalid job contribution reconciliation transition' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_contribution_reconciliations_guard
BEFORE UPDATE OR DELETE ON jobs.job_contribution_reconciliations
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_reconciliation();

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
          'id', id, 'requestedJobId', requested_job_id, 'canonicalJobId', canonical_job_id,
          'reason', reason, 'createdAt', created_at
        ) ORDER BY created_at, id)
        FROM jobs.job_reports WHERE reporter_user_id = candidate_user_id
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
  processing_outbox_deleted integer;
  processing_queue_deleted integer;
  reconciliations_deleted integer;
  state_events_deleted integer;
  trust_decisions_deleted integer;
  independent_verifications_deleted integer;
  normalizations_deleted integer;
  contributions_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);

  DELETE FROM jobs.job_contribution_processing_outbox AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS processing_outbox_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_processing_queue AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS processing_queue_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_reconciliations AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS reconciliations_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_state_events AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS state_events_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_trust_decisions AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS trust_decisions_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_independent_verifications AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS independent_verifications_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_normalizations AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS normalizations_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contribution_outbox AS child
  USING jobs.job_contributions AS contribution
  WHERE child.contribution_id = contribution.id AND contribution.owner_user_id = candidate_user_id;
  GET DIAGNOSTICS contribution_outbox_deleted = ROW_COUNT;
  DELETE FROM jobs.job_contributions WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS contributions_deleted = ROW_COUNT;
  DELETE FROM jobs.job_reports WHERE reporter_user_id = candidate_user_id;
  GET DIAGNOSTICS reports_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'owner', 'jobs', 'reportsDeleted', reports_deleted,
    'contributionsDeleted', contributions_deleted,
    'contributionOutboxDeleted', contribution_outbox_deleted,
    'processingOutboxDeleted', processing_outbox_deleted,
    'processingQueueDeleted', processing_queue_deleted,
    'reconciliationsDeleted', reconciliations_deleted,
    'stateEventsDeleted', state_events_deleted,
    'trustDecisionsDeleted', trust_decisions_deleted,
    'independentVerificationsDeleted', independent_verifications_deleted,
    'normalizationsDeleted', normalizations_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION jobs.guard_job_contribution_processing_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.guard_job_contribution_processing_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.guard_job_contribution_reconciliation() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs.delete_candidate_data(uuid, uuid) FROM PUBLIC;
