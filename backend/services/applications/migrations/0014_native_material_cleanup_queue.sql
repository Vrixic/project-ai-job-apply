-- Durable identifier-only continuation of accepted owner material withdrawal.
CREATE TABLE applications.native_material_cleanup_queue (
  request_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','native_tasks_settled')),
  after_application_id uuid,
  claim_token uuid,
  lease_expires_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  FOREIGN KEY (request_id,owner_user_id) REFERENCES applications.native_material_withdrawals(id,owner_user_id) ON DELETE RESTRICT,
  CHECK ((state='processing') = (claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state='processing' OR (claim_token IS NULL AND lease_expires_at IS NULL)),
  CHECK ((state='native_tasks_settled') = (completed_at IS NOT NULL)),
  CHECK (state<>'native_tasks_settled' OR after_application_id IS NULL)
);
CREATE INDEX native_material_cleanup_available_idx ON applications.native_material_cleanup_queue(available_at,request_id)
  WHERE state <> 'native_tasks_settled';
CREATE FUNCTION applications.guard_native_material_cleanup_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.request_id <> OLD.request_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR (OLD.state='native_tasks_settled' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'native cleanup identity and settlement are immutable' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER native_material_cleanup_immutable BEFORE UPDATE ON applications.native_material_cleanup_queue
  FOR EACH ROW EXECUTE FUNCTION applications.guard_native_material_cleanup_queue();
CREATE TRIGGER native_material_cleanup_candidate_delete BEFORE DELETE ON applications.native_material_cleanup_queue
  FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
INSERT INTO applications.native_material_cleanup_queue(request_id,owner_user_id)
  SELECT id,owner_user_id FROM applications.native_material_withdrawals;

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
  DELETE FROM applications.native_material_cleanup_queue WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.native_material_withdrawals WHERE owner_user_id = candidate_user_id;
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
