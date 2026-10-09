-- Proposed ADR-043: post-0009 archive boundary. Not invoked by the migration driver yet.
-- The future explicit transition must install this boundary and transfer original receipts
-- atomically. This file does not move records or disable any immutability/delete guard.
ALTER TABLE applications.command_receipts DROP CONSTRAINT command_receipts_operation_check;
ALTER TABLE applications.command_receipts ADD CONSTRAINT command_receipts_operation_check CHECK (
  operation IN ('create_application', 'create_packet', 'approve', 'cancel', 'start_attempt',
    'start_manual_attempt', 'record_result', 'reconcile', 'takeover', 'queue_preparation',
    'archived_legacy')
);
ALTER TABLE applications.command_receipts DROP CONSTRAINT command_receipts_hash_authority_ck;
ALTER TABLE applications.command_receipts ADD CONSTRAINT command_receipts_hash_authority_ck CHECK (
  (request_hash_scheme = 'sha256.v1' AND request_key_arn IS NULL
    AND operation NOT IN ('create_packet', 'queue_preparation', 'archived_legacy'))
  OR (request_hash_scheme = 'kms-hmac-sha256.v1' AND operation IN ('create_packet', 'queue_preparation')
    AND request_key_arn IS NOT NULL AND request_key_arn ~ '^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
  OR (request_hash_scheme = 'legacy-ciphertext-sha256.v1' AND operation = 'archived_legacy'
    AND request_key_arn IS NULL)
);

CREATE TABLE applications_restricted.legacy_receipts (
  owner_user_id uuid NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
  application_id uuid NOT NULL,
  protection_id uuid NOT NULL UNIQUE,
  original_operation text NOT NULL CHECK (original_operation IN ('create_packet', 'queue_preparation')),
  metadata_sha256 text NOT NULL CHECK (metadata_sha256 ~ '^[a-f0-9]{64}$'),
  encryption_key_arn text NOT NULL CHECK (
    encryption_key_arn ~ '^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
  ),
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 1 AND 6144),
  PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT legacy_receipt_marker_fk FOREIGN KEY (owner_user_id, idempotency_key)
    REFERENCES applications.command_receipts(owner_user_id, idempotency_key)
    DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT legacy_receipt_application_fk FOREIGN KEY (application_id, owner_user_id)
    REFERENCES applications.applications(id, owner_user_id) ON DELETE RESTRICT
);
REVOKE ALL ON applications_restricted.legacy_receipts FROM PUBLIC;

CREATE FUNCTION applications_restricted.check_legacy_receipt_pair() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, applications, applications_restricted AS $$
DECLARE
  receipt_owner uuid;
  receipt_key text;
  marker applications.command_receipts%ROWTYPE;
  archived applications_restricted.legacy_receipts%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    receipt_owner := OLD.owner_user_id; receipt_key := OLD.idempotency_key;
  ELSE
    receipt_owner := NEW.owner_user_id; receipt_key := NEW.idempotency_key;
  END IF;
  SELECT * INTO marker FROM applications.command_receipts
    WHERE owner_user_id=receipt_owner AND idempotency_key=receipt_key;
  SELECT * INTO archived FROM applications_restricted.legacy_receipts
    WHERE owner_user_id=receipt_owner AND idempotency_key=receipt_key;
  IF marker.operation IS DISTINCT FROM 'archived_legacy' THEN
    IF archived.owner_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'legacy receipt marker mismatch' USING ERRCODE='23514';
    END IF;
  ELSIF archived.owner_user_id IS NULL OR archived.application_id <> marker.application_id
    OR marker.request_hash_scheme <> 'legacy-ciphertext-sha256.v1'
    OR marker.request_key_arn IS NOT NULL
    OR marker.request_hash <> encode(sha256(archived.ciphertext), 'hex') THEN
    RAISE EXCEPTION 'legacy receipt marker mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION applications_restricted.check_legacy_receipt_pair() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER legacy_receipt_marker_pair
AFTER INSERT OR UPDATE OR DELETE ON applications.command_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION applications_restricted.check_legacy_receipt_pair();
CREATE CONSTRAINT TRIGGER legacy_receipt_archive_pair
AFTER INSERT OR UPDATE OR DELETE ON applications_restricted.legacy_receipts
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
EXECUTE FUNCTION applications_restricted.check_legacy_receipt_pair();
CREATE TRIGGER legacy_receipts_immutable BEFORE UPDATE ON applications_restricted.legacy_receipts
  FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();
CREATE TRIGGER legacy_receipts_candidate_delete BEFORE DELETE ON applications_restricted.legacy_receipts
  FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER legacy_receipts_active_candidate BEFORE INSERT ON applications_restricted.legacy_receipts
  FOR EACH ROW EXECUTE FUNCTION applications_restricted.guard_packet_value_insert();

CREATE OR REPLACE FUNCTION applications.delete_candidate_data(
  candidate_user_id uuid, candidate_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, applications, privacy AS $$
DECLARE
  applications_deleted integer;
  packets_deleted integer;
  attempts_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE='42501';
  END IF;
  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);
  DELETE FROM applications.native_material_cleanup_queue WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.native_material_withdrawals WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.preparation_outbox WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.preparation_audit WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.packet_preparations WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.outbox WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications_restricted.legacy_receipts WHERE owner_user_id = candidate_user_id;
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
  RETURN jsonb_build_object('owner', 'applications', 'applicationsDeleted', applications_deleted,
    'packetsDeleted', packets_deleted, 'attemptsDeleted', attempts_deleted);
END;
$$;
REVOKE ALL ON FUNCTION applications.delete_candidate_data(uuid, uuid) FROM PUBLIC;
