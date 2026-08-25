DROP TRIGGER entitlement_changes_immutable ON billing.entitlement_changes;
CREATE TRIGGER entitlement_changes_immutable
BEFORE UPDATE ON billing.entitlement_changes
FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();

DROP TRIGGER entitlement_command_receipts_immutable ON billing.entitlement_command_receipts;
CREATE TRIGGER entitlement_command_receipts_immutable
BEFORE UPDATE ON billing.entitlement_command_receipts
FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();

DROP TRIGGER entitlement_outbox_delete_forbidden ON billing.entitlement_outbox;

CREATE OR REPLACE FUNCTION billing.guard_candidate_history_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT privacy.current_candidate_deletion_authorized(OLD.user_id) THEN
    RAISE EXCEPTION 'billing history is append-only' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER entitlement_changes_candidate_delete_guard
BEFORE DELETE ON billing.entitlement_changes
FOR EACH ROW EXECUTE FUNCTION billing.guard_candidate_history_delete();
CREATE TRIGGER entitlement_command_receipts_candidate_delete_guard
BEFORE DELETE ON billing.entitlement_command_receipts
FOR EACH ROW EXECUTE FUNCTION billing.guard_candidate_history_delete();
CREATE TRIGGER entitlement_outbox_candidate_delete_guard
BEFORE DELETE ON billing.entitlement_outbox
FOR EACH ROW EXECUTE FUNCTION billing.guard_candidate_history_delete();

CREATE OR REPLACE FUNCTION billing.export_candidate_data(
  candidate_user_id uuid,
  generated_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
  SELECT jsonb_build_object(
    'billing', jsonb_build_object(
      'entitlement', COALESCE((
        SELECT jsonb_strip_nulls(jsonb_build_object(
          'plan', plan, 'version', version, 'effectiveAt', effective_at,
          'accessThrough', access_through, 'graceThrough', grace_through
        ))
        FROM billing.entitlement_accounts WHERE user_id = candidate_user_id
      ), jsonb_build_object('plan', 'free', 'version', 0, 'effectiveAt', generated_at))
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'owner', 'billing', 'action', 'billing.entitlement.changed',
          'resourceType', 'entitlement_account', 'resourceId', entitlement_account_id,
          'occurredAt', occurred_at
        ) ORDER BY occurred_at, id)
        FROM billing.entitlement_changes WHERE user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
$$;

CREATE OR REPLACE FUNCTION billing.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing, privacy
AS $$
DECLARE
  accounts_deleted integer;
  changes_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.candidate_deletion_request_id', candidate_request_id::text, true);
  DELETE FROM billing.entitlement_command_receipts WHERE user_id = candidate_user_id;
  DELETE FROM billing.entitlement_outbox WHERE user_id = candidate_user_id;
  DELETE FROM billing.entitlement_changes WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS changes_deleted = ROW_COUNT;
  DELETE FROM billing.entitlement_accounts WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS accounts_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'owner', 'billing', 'accountsDeleted', accounts_deleted, 'changesDeleted', changes_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION billing.export_candidate_data(uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.delete_candidate_data(uuid, uuid) FROM PUBLIC;
