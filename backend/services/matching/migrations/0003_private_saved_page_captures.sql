CREATE OR REPLACE FUNCTION matching.valid_private_capture_text(value text, maximum_length integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT maximum_length > 0
    AND char_length(value) BETWEEN 1 AND maximum_length
    AND value = btrim(value)
    AND value !~ '[<>[:cntrl:]]'
    AND position(U&'\202A' IN value) = 0
    AND position(U&'\202B' IN value) = 0
    AND position(U&'\202C' IN value) = 0
    AND position(U&'\202D' IN value) = 0
    AND position(U&'\202E' IN value) = 0
    AND position(U&'\2066' IN value) = 0
    AND position(U&'\2067' IN value) = 0
    AND position(U&'\2068' IN value) = 0
    AND position(U&'\2069' IN value) = 0;
$$;

CREATE TABLE matching.private_saved_page_captures (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  provider text NOT NULL CHECK (provider IN ('greenhouse', 'lever', 'ashby')),
  page_variant text NOT NULL CHECK (
    page_variant IN ('greenhouse-board-v1', 'lever-posting-v1', 'ashby-job-board-v1')
  ),
  source_url text NOT NULL CHECK (char_length(source_url) BETWEEN 1 AND 2048),
  adapter_version text NOT NULL CHECK (adapter_version = 'd2-job-page-v1'),
  snapshot_title text NOT NULL CHECK (
    matching.valid_private_capture_text(snapshot_title, 240)
  ),
  snapshot_company text CHECK (
    snapshot_company IS NULL OR matching.valid_private_capture_text(snapshot_company, 240)
  ),
  snapshot_location text CHECK (
    snapshot_location IS NULL OR matching.valid_private_capture_text(snapshot_location, 500)
  ),
  snapshot_description text CHECK (
    snapshot_description IS NULL OR matching.valid_private_capture_text(snapshot_description, 12000)
  ),
  snapshot_external_job_id text CHECK (
    snapshot_external_job_id IS NULL OR
    matching.valid_private_capture_text(snapshot_external_job_id, 200)
  ),
  captured_at timestamptz NOT NULL,
  saved_at timestamptz NOT NULL,
  CONSTRAINT private_saved_page_capture_provider_boundary_ck CHECK (
    (provider = 'greenhouse'
      AND page_variant = 'greenhouse-board-v1'
      AND source_url ~ '^https://(boards\.greenhouse\.io|job-boards\.greenhouse\.io)/[A-Za-z0-9._~-]+/jobs/[A-Za-z0-9._~-]+/?$')
    OR
    (provider = 'lever'
      AND page_variant = 'lever-posting-v1'
      AND source_url ~ '^https://(jobs\.lever\.co|jobs\.eu\.lever\.co)/[A-Za-z0-9._~-]+/[A-Za-z0-9._~-]+/?$')
    OR
    (provider = 'ashby'
      AND page_variant = 'ashby-job-board-v1'
      AND source_url ~ '^https://jobs\.ashbyhq\.com/[A-Za-z0-9._~-]+/[A-Za-z0-9._~-]+/?$')
  ),
  CONSTRAINT private_saved_page_capture_time_ck CHECK (
    captured_at <= saved_at + interval '5 minutes'
  ),
  CONSTRAINT private_saved_page_capture_owner_source_uq
    UNIQUE (owner_user_id, provider, page_variant, source_url),
  CONSTRAINT private_saved_page_capture_owner_identity_uq UNIQUE (id, owner_user_id)
);

CREATE INDEX private_saved_page_captures_owner_saved_idx
  ON matching.private_saved_page_captures (owner_user_id, saved_at DESC, id DESC);

CREATE TABLE matching.private_saved_page_capture_commands (
  owner_user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  capture_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  idempotency_expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT private_saved_page_capture_command_key_ck CHECK (
    char_length(idempotency_key) BETWEEN 16 AND 128
  ),
  CONSTRAINT private_saved_page_capture_command_retention_ck CHECK (
    idempotency_expires_at = created_at + interval '24 hours'
  )
);

CREATE INDEX private_saved_page_capture_commands_owner_expiry_idx
  ON matching.private_saved_page_capture_commands (owner_user_id, idempotency_expires_at);

CREATE TABLE matching.private_saved_page_capture_resolutions (
  capture_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  resolution_id uuid NOT NULL UNIQUE,
  canonical_job_id uuid NOT NULL,
  verification_evidence_id uuid NOT NULL,
  resolved_at timestamptz NOT NULL,
  CONSTRAINT private_saved_page_capture_resolution_owner_fk
    FOREIGN KEY (capture_id, owner_user_id)
    REFERENCES matching.private_saved_page_captures (id, owner_user_id)
    ON DELETE CASCADE
);

CREATE INDEX private_saved_page_capture_resolutions_owner_idx
  ON matching.private_saved_page_capture_resolutions (owner_user_id, resolved_at, capture_id);

CREATE TABLE matching.private_saved_page_capture_audit_events (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  capture_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'resolved', 'deleted')),
  canonical_job_id uuid,
  verification_evidence_id uuid,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT private_saved_page_capture_audit_resolution_ck CHECK (
    (action = 'resolved' AND canonical_job_id IS NOT NULL AND verification_evidence_id IS NOT NULL)
    OR
    (action IN ('created', 'deleted') AND canonical_job_id IS NULL AND verification_evidence_id IS NULL)
  )
);

CREATE INDEX private_saved_page_capture_audit_owner_idx
  ON matching.private_saved_page_capture_audit_events (owner_user_id, occurred_at, id);

CREATE OR REPLACE FUNCTION matching.reject_private_capture_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'matching private saved-page captures are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER matching_private_saved_page_captures_immutable
BEFORE UPDATE ON matching.private_saved_page_captures
FOR EACH ROW EXECUTE FUNCTION matching.reject_private_capture_update();

CREATE TRIGGER matching_private_saved_page_capture_resolutions_immutable
BEFORE UPDATE ON matching.private_saved_page_capture_resolutions
FOR EACH ROW EXECUTE FUNCTION matching.reject_private_capture_update();

CREATE OR REPLACE FUNCTION matching.guard_private_capture_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND privacy.current_candidate_deletion_authorized(OLD.owner_user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'matching private saved-page capture audit is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER matching_private_saved_page_capture_audit_immutable
BEFORE UPDATE OR DELETE ON matching.private_saved_page_capture_audit_events
FOR EACH ROW EXECUTE FUNCTION matching.guard_private_capture_audit_mutation();

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
      ), '[]'::jsonb),
      'privateSavedPageCaptures', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', c.id,
          'provider', c.provider,
          'pageVariant', c.page_variant,
          'sourceUrl', c.source_url,
          'adapterVersion', c.adapter_version,
          'title', c.snapshot_title,
          'company', c.snapshot_company,
          'location', c.snapshot_location,
          'description', c.snapshot_description,
          'externalJobId', c.snapshot_external_job_id,
          'capturedAt', c.captured_at,
          'savedAt', c.saved_at,
          'resolution', CASE WHEN r.capture_id IS NULL THEN NULL ELSE jsonb_build_object(
            'canonicalJobId', r.canonical_job_id,
            'verificationEvidenceId', r.verification_evidence_id,
            'resolvedAt', r.resolved_at
          ) END
        ) ORDER BY c.saved_at, c.id)
        FROM matching.private_saved_page_captures c
        LEFT JOIN matching.private_saved_page_capture_resolutions r ON r.capture_id = c.id
        WHERE c.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(event ORDER BY occurred_at, id)
        FROM (
          SELECT id, occurred_at, jsonb_build_object(
            'owner', 'matching',
            'action', 'matching.saved-job.' || action,
            'resourceType', 'saved_job',
            'resourceId', saved_job_id,
            'occurredAt', occurred_at
          ) AS event
          FROM matching.audit_events WHERE owner_user_id = candidate_user_id
          UNION ALL
          SELECT id, occurred_at, jsonb_build_object(
            'owner', 'matching',
            'action', 'matching.private-saved-page-capture.' || action,
            'resourceType', 'private_saved_page_capture',
            'resourceId', capture_id,
            'occurredAt', occurred_at
          ) AS event
          FROM matching.private_saved_page_capture_audit_events
          WHERE owner_user_id = candidate_user_id
        ) candidate_audit
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
  private_captures_deleted integer;
  audit_deleted integer;
  private_capture_audit_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);
  DELETE FROM matching.audit_events WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS audit_deleted = ROW_COUNT;
  DELETE FROM matching.private_saved_page_capture_audit_events
    WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS private_capture_audit_deleted = ROW_COUNT;
  DELETE FROM matching.private_saved_page_capture_commands
    WHERE owner_user_id = candidate_user_id;
  DELETE FROM matching.private_saved_page_captures WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS private_captures_deleted = ROW_COUNT;
  DELETE FROM matching.idempotency_keys WHERE owner_user_id = candidate_user_id;
  DELETE FROM matching.saved_jobs WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS saved_jobs_deleted = ROW_COUNT;
  DELETE FROM matching.saved_job_list_state WHERE owner_user_id = candidate_user_id;
  RETURN jsonb_build_object(
    'owner', 'matching',
    'savedJobsDeleted', saved_jobs_deleted,
    'privateSavedPageCapturesDeleted', private_captures_deleted,
    'auditEventsDeleted', audit_deleted,
    'privateSavedPageCaptureAuditEventsDeleted', private_capture_audit_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION matching.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION matching.delete_candidate_data(uuid, uuid) FROM PUBLIC;
