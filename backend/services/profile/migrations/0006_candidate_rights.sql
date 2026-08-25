CREATE SCHEMA IF NOT EXISTS privacy;

ALTER TABLE identity.users
  ADD COLUMN account_state text NOT NULL DEFAULT 'active',
  ADD COLUMN quarantined_at timestamptz;

ALTER TABLE identity.users
  ADD CONSTRAINT users_account_state_check
  CHECK (account_state IN ('active', 'quarantined')),
  ADD CONSTRAINT users_quarantine_shape_check
  CHECK (
    (account_state = 'active' AND quarantined_at IS NULL) OR
    (account_state = 'quarantined' AND quarantined_at IS NOT NULL)
  );

CREATE TABLE profile.candidate_data_exports (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  operation_id uuid NOT NULL REFERENCES platform.operations(id) ON DELETE CASCADE,
  format text NOT NULL,
  policy_version text NOT NULL,
  state text NOT NULL,
  artifact_object_key text,
  artifact_object_version text,
  artifact_sha256 text,
  artifact_expires_at timestamptz,
  failure_code text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_data_exports_format_check
    CHECK (format = 'candidate-data-export-v1'),
  CONSTRAINT candidate_data_exports_state_check
    CHECK (state IN ('queued', 'building', 'ready', 'expired', 'failed')),
  CONSTRAINT candidate_data_exports_artifact_sha256_check
    CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT candidate_data_exports_failure_code_check
    CHECK (
      failure_code IS NULL OR failure_code IN (
        'owner_unavailable',
        'inventory_incomplete',
        'artifact_write_failed'
      )
    ),
  CONSTRAINT candidate_data_exports_state_shape_check
    CHECK (
      (state IN ('queued', 'building') AND artifact_object_key IS NULL AND
        artifact_object_version IS NULL AND artifact_sha256 IS NULL AND
        artifact_expires_at IS NULL AND failure_code IS NULL) OR
      (state = 'ready' AND artifact_object_key IS NOT NULL AND
        artifact_object_version IS NOT NULL AND artifact_sha256 IS NOT NULL AND
        artifact_expires_at IS NOT NULL AND failure_code IS NULL) OR
      (state = 'expired' AND artifact_object_key IS NULL AND
        artifact_object_version IS NULL AND artifact_sha256 IS NULL AND
        artifact_expires_at IS NOT NULL AND failure_code IS NULL) OR
      (state = 'failed' AND artifact_object_key IS NULL AND
        artifact_object_version IS NULL AND artifact_sha256 IS NULL AND
        artifact_expires_at IS NULL AND failure_code IS NOT NULL)
    )
);
CREATE INDEX candidate_data_exports_user_requested_idx
  ON profile.candidate_data_exports(user_id, requested_at DESC, id DESC);
CREATE UNIQUE INDEX candidate_data_exports_operation_uq
  ON profile.candidate_data_exports(operation_id);

CREATE TABLE profile.account_deletion_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  operation_id uuid REFERENCES platform.operations(id) ON DELETE CASCADE,
  policy_version text NOT NULL,
  state text NOT NULL,
  version integer NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  completed_at timestamptz,
  backup_expires_at timestamptz,
  backup_expired_at timestamptz,
  CONSTRAINT account_deletion_requests_state_check
    CHECK (state IN (
      'requested',
      'quarantined',
      'active_systems_deleted',
      'subprocessors_pending',
      'completed',
      'backup_expired'
    )),
  CONSTRAINT account_deletion_requests_version_check CHECK (version > 0),
  CONSTRAINT account_deletion_requests_state_shape_check
    CHECK (
      (state = 'requested' AND operation_id IS NULL AND confirmed_at IS NULL AND
        completed_at IS NULL AND backup_expires_at IS NULL AND backup_expired_at IS NULL) OR
      (state IN ('quarantined', 'active_systems_deleted', 'subprocessors_pending') AND
        operation_id IS NOT NULL AND confirmed_at IS NOT NULL AND completed_at IS NULL AND
        backup_expires_at IS NOT NULL AND backup_expired_at IS NULL) OR
      (state = 'completed' AND operation_id IS NOT NULL AND confirmed_at IS NOT NULL AND
        completed_at IS NOT NULL AND backup_expires_at IS NOT NULL AND
        backup_expired_at IS NULL) OR
      (state = 'backup_expired' AND operation_id IS NOT NULL AND confirmed_at IS NOT NULL AND
        completed_at IS NOT NULL AND backup_expires_at IS NOT NULL AND
        backup_expired_at IS NOT NULL)
    )
);
CREATE INDEX account_deletion_requests_user_requested_idx
  ON profile.account_deletion_requests(user_id, requested_at DESC, id DESC);
CREATE UNIQUE INDEX account_deletion_requests_open_user_uq
  ON profile.account_deletion_requests(user_id)
  WHERE state IN ('requested', 'quarantined', 'active_systems_deleted', 'subprocessors_pending');
CREATE UNIQUE INDEX account_deletion_requests_operation_uq
  ON profile.account_deletion_requests(operation_id)
  WHERE operation_id IS NOT NULL;

CREATE TABLE privacy.account_deletion_ledger (
  request_id uuid PRIMARY KEY,
  subject_digest text NOT NULL,
  policy_version text NOT NULL,
  policy_sha256 text NOT NULL,
  state text NOT NULL,
  owner_inventory jsonb NOT NULL,
  subprocessor_inventory jsonb NOT NULL,
  replay_locator_ciphertext bytea,
  confirmed_at timestamptz NOT NULL,
  completed_at timestamptz,
  backup_expires_at timestamptz NOT NULL,
  backup_expired_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_deletion_ledger_subject_digest_check
    CHECK (subject_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT account_deletion_ledger_policy_sha256_check
    CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT account_deletion_ledger_state_check
    CHECK (state IN (
      'quarantined',
      'active_systems_deleted',
      'subprocessors_pending',
      'completed',
      'backup_expired'
    )),
  CONSTRAINT account_deletion_ledger_inventory_check
    CHECK (jsonb_typeof(owner_inventory) = 'object' AND jsonb_typeof(subprocessor_inventory) = 'object'),
  CONSTRAINT account_deletion_ledger_backup_shape_check
    CHECK (
      (state <> 'backup_expired' AND backup_expired_at IS NULL) OR
      (state = 'backup_expired' AND completed_at IS NOT NULL AND
        backup_expired_at IS NOT NULL AND replay_locator_ciphertext IS NULL)
    )
);
CREATE INDEX account_deletion_ledger_backup_expiry_idx
  ON privacy.account_deletion_ledger(state, backup_expires_at);

CREATE OR REPLACE FUNCTION privacy.candidate_deletion_authorized(
  candidate_request_id uuid,
  candidate_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, privacy, profile
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profile.account_deletion_requests AS request
    JOIN privacy.account_deletion_ledger AS ledger ON ledger.request_id = request.id
    WHERE request.id = candidate_request_id
      AND request.user_id = candidate_user_id
      AND request.state IN (
        'quarantined',
        'active_systems_deleted',
        'subprocessors_pending',
        'completed'
      )
      AND ledger.state IN (
        'quarantined',
        'active_systems_deleted',
        'subprocessors_pending',
        'completed'
      )
  )
$$;

CREATE OR REPLACE FUNCTION privacy.current_candidate_deletion_authorized(candidate_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, privacy, profile
AS $$
DECLARE
  candidate_request_id uuid;
BEGIN
  BEGIN
    candidate_request_id := nullif(
      current_setting('app.candidate_deletion_request_id', true),
      ''
    )::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  RETURN candidate_request_id IS NOT NULL
    AND privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION profile.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, identity, platform, profile
AS $$
  SELECT jsonb_build_object(
    'candidate', jsonb_build_object(
      'email', (
        SELECT email FROM identity.external_identities
        WHERE user_id = candidate_user_id AND email IS NOT NULL
        ORDER BY last_seen_at DESC LIMIT 1
      ),
      'createdAt', candidate.created_at,
      'connectedAccounts', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'provider', 'managed_oidc',
          'linkedAt', created_at,
          'lastSeenAt', last_seen_at
        ) ORDER BY created_at, issuer)
        FROM identity.external_identities
        WHERE user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'profile', jsonb_build_object(
      'preferences', (
        SELECT preferences || jsonb_build_object('version', version, 'updatedAt', updated_at)
        FROM profile.job_preferences WHERE user_id = candidate_user_id
      ),
      'facts', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', fact.id,
          'version', version.version,
          'kind', version.kind,
          'key', version.fact_key,
          'value', version.fact_value,
          'verification', version.verification,
          'availability', version.availability_state,
          'sensitivity', version.sensitivity,
          'sourceType', version.source_type,
          'effectiveFrom', version.effective_from,
          'effectiveTo', version.effective_to,
          'createdAt', fact.created_at,
          'updatedAt', version.created_at
        )) ORDER BY fact.created_at, fact.id)
        FROM profile.profile_facts AS fact
        JOIN LATERAL (
          SELECT * FROM profile.profile_fact_versions
          WHERE fact_id = fact.id ORDER BY version DESC LIMIT 1
        ) AS version ON true
        WHERE fact.user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'owner', CASE
            WHEN action LIKE 'identity.%' THEN 'identity'
            ELSE 'profile'
          END,
          'action', action,
          'resourceType', resource_type,
          'resourceId', resource_id,
          'occurredAt', occurred_at
        )) ORDER BY occurred_at, id)
        FROM platform.audit_events WHERE user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
  FROM identity.users AS candidate
  WHERE candidate.id = candidate_user_id
$$;

CREATE OR REPLACE FUNCTION profile.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, privacy, profile
AS $$
DECLARE
  preferences_deleted integer;
  facts_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  DELETE FROM profile.job_preferences WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS preferences_deleted = ROW_COUNT;
  DELETE FROM profile.profile_facts WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS facts_deleted = ROW_COUNT;
  DELETE FROM profile.resume_fact_imports WHERE user_id = candidate_user_id;
  DELETE FROM platform.audit_events
  WHERE user_id = candidate_user_id AND action NOT LIKE 'profile.account-deletion.%';
  RETURN jsonb_build_object(
    'owner', 'profile',
    'preferencesDeleted', preferences_deleted,
    'factsDeleted', facts_deleted
  );
END;
$$;

CREATE OR REPLACE FUNCTION profile.reject_candidate_rights_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.policy_version <> OLD.policy_version OR
     NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION 'candidate-rights ownership and policy identity are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER candidate_data_exports_identity_guard
BEFORE UPDATE ON profile.candidate_data_exports
FOR EACH ROW EXECUTE FUNCTION profile.reject_candidate_rights_identity_change();

CREATE TRIGGER account_deletion_requests_identity_guard
BEFORE UPDATE ON profile.account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION profile.reject_candidate_rights_identity_change();

REVOKE ALL ON SCHEMA privacy FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA privacy FROM PUBLIC;
REVOKE ALL ON FUNCTION privacy.candidate_deletion_authorized(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION privacy.current_candidate_deletion_authorized(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION profile.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION profile.delete_candidate_data(uuid, uuid) FROM PUBLIC;
