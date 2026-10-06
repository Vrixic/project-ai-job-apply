-- D3-077 / proposed ADR-041. Separate Applications-owned restricted value boundary.
-- No legacy answer/hash backfill: approved and ambiguous evidence must remain exact.
CREATE FUNCTION applications.valid_restricted_packet_fields(fields jsonb, has_binding boolean)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  field jsonb;
  field_key text;
  protected_count integer := 0;
  keys text[];
BEGIN
  IF fields IS NULL OR jsonb_typeof(fields) <> 'array' OR jsonb_array_length(fields) > 200 THEN
    RETURN false;
  END IF;
  FOR field IN SELECT value FROM jsonb_array_elements(fields) LOOP
    IF jsonb_typeof(field) <> 'object' THEN RETURN false; END IF;
    SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(field) AS key;
    IF keys IS NULL OR NOT keys <@ ARRAY['fieldKey','value','origin','sourceFactIds','confidence',
       'disposition','reasons','requiresReview','vaultReference','protectedValue']::text[]
       OR NOT field ?& ARRAY['fieldKey','value','origin','sourceFactIds','confidence',
         'disposition','reasons','requiresReview'] THEN RETURN false; END IF;
    field_key := field->>'fieldKey';
    IF field ? 'protectedValue' THEN
      IF field->'protectedValue' IS DISTINCT FROM 'true'::jsonb
        OR field->'value' IS DISTINCT FROM 'null'::jsonb
        OR field->>'disposition' IS DISTINCT FROM 'review'
        OR field->'requiresReview' IS DISTINCT FROM 'true'::jsonb
        OR field_key IN ('documents.resume', 'documents.cover_letter') THEN RETURN false; END IF;
      protected_count := protected_count + 1;
    END IF;
    IF (field_key IN (
        'authorization.us_authorized', 'authorization.sponsorship_required',
        'authorization.export_control', 'disclosure.non_compete', 'disclosure.conflict_of_interest',
        'demographic.gender', 'demographic.race_ethnicity', 'demographic.veteran',
        'demographic.disability', 'attestation.truthful', 'attestation.terms', 'signature.electronic'
      ) OR field ? 'vaultReference' OR COALESCE(field->'reasons', '[]'::jsonb) ? 'restricted_answer')
      AND field->'value' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
  END LOOP;
  RETURN (has_binding AND protected_count > 0) OR (NOT has_binding AND protected_count = 0);
END;
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM applications.packets
    WHERE NOT applications.valid_restricted_packet_fields(fields, false))
    OR EXISTS (SELECT 1 FROM applications.command_receipts
      WHERE operation IN ('create_packet', 'queue_preparation')) THEN
    RAISE EXCEPTION 'restricted packet migration requires an explicit legacy evidence transition'
      USING ERRCODE = '55000';
  END IF;
END $$;

CREATE SCHEMA applications_restricted;
REVOKE ALL ON SCHEMA applications_restricted FROM PUBLIC;
CREATE TABLE applications_restricted.packet_values (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  application_id uuid NOT NULL,
  metadata_sha256 text NOT NULL CHECK (metadata_sha256 ~ '^[a-f0-9]{64}$'),
  ciphertext_sha256 text NOT NULL CHECK (ciphertext_sha256 ~ '^[a-f0-9]{64}$'),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  encryption_key_arn text NOT NULL CHECK (
    encryption_key_arn ~ '^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  ),
  encrypted_data_key bytea NOT NULL CHECK (octet_length(encrypted_data_key) BETWEEN 1 AND 6144),
  iv bytea NOT NULL CHECK (octet_length(iv) = 12),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 800000),
  authentication_tag bytea NOT NULL CHECK (octet_length(authentication_tag) = 16),
  created_at timestamptz NOT NULL,
  CONSTRAINT restricted_packet_application_fk FOREIGN KEY (application_id, owner_user_id)
    REFERENCES applications.applications (id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT restricted_packet_identity_uq
    UNIQUE (id, application_id, owner_user_id, metadata_sha256, ciphertext_sha256)
);
REVOKE ALL ON applications_restricted.packet_values FROM PUBLIC;
CREATE FUNCTION applications_restricted.guard_packet_value_insert()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM identity.require_active_candidate(NEW.owner_user_id);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION applications_restricted.guard_packet_value_insert() FROM PUBLIC;
CREATE TRIGGER restricted_packet_values_active_candidate BEFORE INSERT ON applications_restricted.packet_values
  FOR EACH ROW EXECUTE FUNCTION applications_restricted.guard_packet_value_insert();

CREATE TRIGGER restricted_packet_values_immutable BEFORE UPDATE ON applications_restricted.packet_values
  FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();
CREATE TRIGGER restricted_packet_values_candidate_delete_guard BEFORE DELETE ON applications_restricted.packet_values
  FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();

ALTER TABLE applications.packets
  ADD COLUMN restricted_value_id uuid,
  ADD COLUMN restricted_metadata_sha256 text,
  ADD COLUMN restricted_ciphertext_sha256 text,
  ADD CONSTRAINT packets_restricted_binding_ck CHECK (
    (restricted_value_id IS NULL AND restricted_metadata_sha256 IS NULL AND restricted_ciphertext_sha256 IS NULL)
    OR (restricted_value_id IS NOT NULL AND restricted_metadata_sha256 IS NOT NULL AND restricted_ciphertext_sha256 IS NOT NULL
      AND restricted_metadata_sha256 ~ '^[a-f0-9]{64}$' AND restricted_ciphertext_sha256 ~ '^[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT packets_restricted_fields_ck CHECK (
    applications.valid_restricted_packet_fields(fields, restricted_value_id IS NOT NULL)
  ),
  ADD CONSTRAINT packets_restricted_value_fk
    FOREIGN KEY (restricted_value_id, application_id, owner_user_id, restricted_metadata_sha256, restricted_ciphertext_sha256)
    REFERENCES applications_restricted.packet_values (id, application_id, owner_user_id, metadata_sha256, ciphertext_sha256)
    ON DELETE RESTRICT;

-- Identifier-only owning audit. It records admission/validation, not a claim that a caller
-- displayed a value. No answer/body/digest/MAC/provider error is carried into this table.
CREATE TABLE applications_restricted.packet_read_audit (
  id uuid PRIMARY KEY,
  read_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  application_id uuid NOT NULL,
  packet_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('candidate_review', 'candidate_export', 'authorized_submission')),
  stage text NOT NULL CHECK (stage IN ('admitted', 'validated')),
  export_request_id uuid,
  export_operation_id uuid,
  CHECK ((purpose = 'candidate_export' AND export_request_id IS NOT NULL AND export_operation_id IS NOT NULL)
    OR (purpose <> 'candidate_export' AND export_request_id IS NULL AND export_operation_id IS NULL)),
  created_at timestamptz NOT NULL,
  UNIQUE (read_id, stage),
  FOREIGN KEY (packet_id, application_id, owner_user_id)
    REFERENCES applications.packets (id, application_id, owner_user_id) ON DELETE RESTRICT
);
REVOKE ALL ON applications_restricted.packet_read_audit FROM PUBLIC;
CREATE TRIGGER restricted_packet_read_audit_immutable BEFORE UPDATE ON applications_restricted.packet_read_audit
  FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();
CREATE TRIGGER restricted_packet_read_audit_candidate_delete_guard BEFORE DELETE ON applications_restricted.packet_read_audit
  FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER restricted_packet_read_audit_active_candidate BEFORE INSERT ON applications_restricted.packet_read_audit
  FOR EACH ROW EXECUTE FUNCTION applications_restricted.guard_packet_value_insert();

ALTER TABLE applications.command_receipts
  ADD COLUMN request_hash_scheme text NOT NULL DEFAULT 'sha256.v1',
  ADD COLUMN request_key_arn text,
  ADD CONSTRAINT command_receipts_hash_authority_ck CHECK (
    (request_hash_scheme = 'sha256.v1' AND request_key_arn IS NULL AND operation NOT IN ('create_packet', 'queue_preparation'))
    OR (request_hash_scheme = 'kms-hmac-sha256.v1' AND operation IN ('create_packet', 'queue_preparation')
      AND request_key_arn IS NOT NULL AND request_key_arn ~ '^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
  );

CREATE OR REPLACE FUNCTION applications.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, applications, privacy
AS $$
DECLARE
  applications_deleted integer;
  packets_deleted integer;
  attempts_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);
  DELETE FROM applications.preparation_outbox WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.preparation_audit WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.packet_preparations WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.outbox WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.command_receipts WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.history WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.attempts WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS attempts_deleted = ROW_COUNT;
  DELETE FROM applications.approvals WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications_restricted.packet_read_audit WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.packets WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS packets_deleted = ROW_COUNT;
  DELETE FROM applications_restricted.packet_values WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.applications WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS applications_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'owner', 'applications', 'applicationsDeleted', applications_deleted,
    'packetsDeleted', packets_deleted, 'attemptsDeleted', attempts_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION applications.delete_candidate_data(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION applications.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, applications
AS $$
  SELECT jsonb_build_object(
    'restrictedPacketReferences', jsonb_build_object('schemaVersion', 1, 'packets', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('applicationId', packet.application_id, 'packetId', packet.id,
        'packetHash', packet.packet_hash, 'fieldKeys', (
          SELECT jsonb_agg(field->>'fieldKey' ORDER BY field->>'fieldKey')
          FROM jsonb_array_elements(packet.fields) AS field WHERE field->'protectedValue' = 'true'::jsonb
        )) ORDER BY packet.application_id, packet.version)
      FROM applications.packets packet WHERE packet.owner_user_id = candidate_user_id
        AND packet.restricted_value_id IS NOT NULL
    ), '[]'::jsonb)),
    'applications', jsonb_build_object(
      'schemaVersion', 1,
      'preparations', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', preparation.id, 'applicationId', preparation.application_id,
          'basePacketId', preparation.base_packet_id, 'state', preparation.state,
          'noticeVersion', preparation.notice_version, 'purpose', preparation.purpose,
          'provider', preparation.provider, 'model', preparation.model, 'categories', preparation.categories,
          'approvedAt', preparation.approved_at, 'expiresAt', preparation.expires_at,
          'generationClaimedAt', preparation.generation_claimed_at,
          'resultPacketId', preparation.result_packet_id, 'errorCode', preparation.error_code,
          'createdAt', preparation.created_at, 'updatedAt', preparation.updated_at
        )) ORDER BY preparation.created_at, preparation.id)
        FROM applications.packet_preparations preparation
        WHERE preparation.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'applications', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', application.id, 'canonicalJobId', application.canonical_job_id,
          'status', application.status, 'revision', application.revision,
          'currentPacketId', application.current_packet_id,
          'createdAt', application.created_at, 'updatedAt', application.updated_at
        )) ORDER BY application.created_at, application.id)
        FROM applications.applications application
        WHERE application.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'packets', COALESCE((
        SELECT jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', packet.id, 'applicationId', packet.application_id, 'version', packet.version,
            'packetHash', packet.packet_hash, 'jobRevision', packet.job_revision,
            'formAdapterId', packet.form_adapter_id, 'formVariantId', packet.form_variant_id,
            'formHash', packet.form_hash, 'resumeHash', packet.resume_hash,
            'coverLetterHash', packet.cover_letter_hash, 'createdAt', packet.created_at
          )) || jsonb_build_object('fields', (SELECT COALESCE(jsonb_agg(field - 'protectedValue' ORDER BY position), '[]'::jsonb) FROM jsonb_array_elements(packet.fields) WITH ORDINALITY AS entry(field, position))) ||
          CASE WHEN jsonb_array_length(packet.temporary_materials) = 0 THEN '{}'::jsonb ELSE
            jsonb_build_object('temporaryMaterials', (
              SELECT jsonb_agg(reference - 'ownerUserId' - 'applicationId' ORDER BY reference->>'kind')
              FROM jsonb_array_elements(packet.temporary_materials) AS reference
            )) END
          ORDER BY packet.application_id, packet.version
        )
        FROM applications.packets packet
        WHERE packet.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'approvals', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', approval.id, 'packetId', approval.packet_id,
          'applicationId', approval.application_id, 'packetHash', approval.packet_hash,
          'acknowledgedFieldKeys', to_jsonb(approval.acknowledged_field_keys),
          'approvedAt', approval.approved_at, 'expiresAt', approval.expires_at,
          'invalidatedAt', approval.invalidated_at,
          'invalidationReason', approval.invalidation_reason
        )) ORDER BY approval.approved_at, approval.id)
        FROM applications.approvals approval
        WHERE approval.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'attempts', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', attempt.id, 'applicationId', attempt.application_id,
          'packetId', attempt.packet_id, 'sequence', attempt.sequence,
          'status', attempt.status, 'adapterId', attempt.adapter_id,
          'adapterVersion', attempt.adapter_version, 'startedAt', attempt.started_at,
          'dispatchedAt', attempt.dispatched_at, 'resolvedAt', attempt.resolved_at,
          'evidenceKind', attempt.evidence_kind,
          'evidenceObservedAt', attempt.evidence_observed_at,
          'evidenceProviderReference', attempt.evidence_provider_reference
        )) ORDER BY attempt.application_id, attempt.sequence)
        FROM applications.attempts attempt
        WHERE attempt.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'history', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'applicationId', event.application_id, 'seq', event.seq, 'kind', event.kind,
          'fromStatus', event.from_status, 'toStatus', event.to_status,
          'packetId', event.packet_id, 'attemptId', event.attempt_id,
          'reasonCode', event.reason_code, 'occurredAt', event.occurred_at
        )) ORDER BY event.application_id, event.seq)
        FROM applications.history event
        WHERE event.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'owner', 'applications', 'action', 'applications.' || event.kind,
          'resourceType', 'application', 'resourceId', event.application_id,
          'occurredAt', event.occurred_at
        ) ORDER BY event.occurred_at, event.application_id, event.seq)
        FROM applications.history event
        WHERE event.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
$$;
REVOKE ALL ON FUNCTION applications.export_candidate_data(uuid) FROM PUBLIC;
