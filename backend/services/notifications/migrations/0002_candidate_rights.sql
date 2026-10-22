-- Candidate export and account deletion for the Notifications owner (ADR-055). The inbox and
-- preferences are derived, so export lists them and deletion removes every row for the candidate
-- only inside a privacy-ledger-authorized account deletion.

CREATE OR REPLACE FUNCTION notifications.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, notifications
AS $$
  SELECT jsonb_build_object(
    'notifications', jsonb_build_object(
      'preferences', (
        SELECT jsonb_build_object(
          'version', version,
          'inAppEnabled', in_app_enabled,
          'emailEnabled', email_enabled,
          'pushEnabled', push_enabled,
          'quietHours', jsonb_build_object(
            'enabled', quiet_hours_enabled,
            'startMinute', quiet_start_minute,
            'endMinute', quiet_end_minute,
            'timeZone', time_zone
          ),
          'updatedAt', updated_at
        )
        FROM notifications.preferences WHERE owner_user_id = candidate_user_id
      ),
      'inbox', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'kind', kind,
          'urgency', urgency,
          'state', state,
          'applicationId', aggregate_id,
          'createdAt', created_at,
          'expiresAt', expires_at
        ) ORDER BY created_at, id)
        FROM notifications.inbox_items WHERE owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
$$;

CREATE OR REPLACE FUNCTION notifications.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, notifications, privacy
AS $$
DECLARE
  items_deleted integer;
  preferences_deleted integer;
  receipts_deleted integer;
  cursors_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  DELETE FROM notifications.inbox_items WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS items_deleted = ROW_COUNT;
  DELETE FROM notifications.preferences WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS preferences_deleted = ROW_COUNT;
  DELETE FROM notifications.source_receipts WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS receipts_deleted = ROW_COUNT;
  DELETE FROM notifications.source_cursors WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS cursors_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'owner', 'notifications',
    'itemsDeleted', items_deleted,
    'preferencesDeleted', preferences_deleted,
    'receiptsDeleted', receipts_deleted,
    'cursorsDeleted', cursors_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION notifications.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notifications.delete_candidate_data(uuid, uuid) FROM PUBLIC;
