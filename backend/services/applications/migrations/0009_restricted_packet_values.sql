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
