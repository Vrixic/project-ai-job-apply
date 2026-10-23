-- Email and push delivery for the Notifications owner (ADR-056). The inbox stays the fallback:
-- nothing here changes an inbox item or a source fact.

-- One email destination per candidate. A code proves ownership before any notification is sent.
CREATE TABLE notifications.email_destinations (
  owner_user_id uuid PRIMARY KEY,
  address text NOT NULL CHECK (
    char_length(address) BETWEEN 3 AND 254 AND address = lower(address) AND address !~ '[[:cntrl:][:space:]]'
  ),
  state text NOT NULL CHECK (state IN ('pending', 'verified', 'suppressed')),
  suppressed_reason text CHECK (suppressed_reason IN ('permanent_failure', 'complaint')),
  -- A request waiting for the dispatcher to generate and email a code.
  code_requested_at timestamptz,
  code_hash text CHECK (code_hash IS NULL OR code_hash ~ '^[0-9a-f]{64}$'),
  code_expires_at timestamptz,
  code_attempts smallint NOT NULL DEFAULT 0 CHECK (code_attempts BETWEEN 0 AND 100),
  request_window_started_at timestamptz NOT NULL,
  request_window_count smallint NOT NULL DEFAULT 1 CHECK (request_window_count BETWEEN 0 AND 100),
  verified_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT email_destinations_state_ck CHECK (
    (state = 'verified' AND verified_at IS NOT NULL AND suppressed_reason IS NULL) OR
    (state = 'pending' AND verified_at IS NULL AND suppressed_reason IS NULL) OR
    (state = 'suppressed' AND suppressed_reason IS NOT NULL)
  )
);
CREATE INDEX email_destinations_code_due_idx
  ON notifications.email_destinations (code_requested_at) WHERE code_requested_at IS NOT NULL;

-- A browser push subscription. The push carries no payload, so no encryption keys are stored.
CREATE TABLE notifications.push_subscriptions (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  endpoint text NOT NULL CHECK (endpoint ~ '^https://[^/]+/' AND char_length(endpoint) <= 2048),
  endpoint_hash text NOT NULL CHECK (endpoint_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('active', 'expired')),
  created_at timestamptz NOT NULL,
  last_success_at timestamptz,
  expired_at timestamptz,
  CONSTRAINT push_subscriptions_endpoint_uq UNIQUE (endpoint_hash),
  CONSTRAINT push_subscriptions_state_ck CHECK ((state = 'expired') = (expired_at IS NOT NULL))
);
CREATE INDEX push_subscriptions_owner_idx
  ON notifications.push_subscriptions (owner_user_id, state);

-- One delivery per inbox item and channel.
CREATE TABLE notifications.delivery_attempts (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  inbox_item_id uuid NOT NULL REFERENCES notifications.inbox_items (id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('email', 'push')),
  state text NOT NULL CHECK (state IN ('scheduled', 'sending', 'sent', 'failed', 'skipped')),
  not_before timestamptz NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  lease_until timestamptz,
  outcome_code text CHECK (outcome_code IS NULL OR char_length(outcome_code) BETWEEN 1 AND 64),
  provider_reference text CHECK (provider_reference IS NULL OR char_length(provider_reference) <= 200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  sent_at timestamptz,
  CONSTRAINT delivery_attempts_item_channel_uq UNIQUE (inbox_item_id, channel),
  CONSTRAINT delivery_attempts_sent_ck CHECK ((state = 'sent') = (sent_at IS NOT NULL)),
  CONSTRAINT delivery_attempts_lease_ck CHECK ((state = 'sending') = (lease_until IS NOT NULL))
);
CREATE INDEX delivery_attempts_due_idx
  ON notifications.delivery_attempts (not_before) WHERE state IN ('scheduled', 'sending');
CREATE INDEX delivery_attempts_owner_idx ON notifications.delivery_attempts (owner_user_id);

-- The export and deletion functions now cover the delivery data as well.
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
      ), '[]'::jsonb),
      'emailDestination', (
        SELECT jsonb_build_object(
          'address', address,
          'state', state,
          'verifiedAt', verified_at,
          'createdAt', created_at
        )
        FROM notifications.email_destinations WHERE owner_user_id = candidate_user_id
      ),
      'pushSubscriptions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', id,
          'endpointHost', substring(endpoint FROM '^https://([^/]+)/'),
          'state', state,
          'createdAt', created_at,
          'lastSuccessAt', last_success_at
        ) ORDER BY created_at, id)
        FROM notifications.push_subscriptions WHERE owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'deliveries', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'inboxItemId', inbox_item_id,
          'channel', channel,
          'state', state,
          'outcomeCode', outcome_code,
          'createdAt', created_at,
          'sentAt', sent_at
        ) ORDER BY created_at, id)
        FROM notifications.delivery_attempts WHERE owner_user_id = candidate_user_id
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
  deliveries_deleted integer;
  items_deleted integer;
  preferences_deleted integer;
  receipts_deleted integer;
  cursors_deleted integer;
  email_destinations_deleted integer;
  push_subscriptions_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  DELETE FROM notifications.delivery_attempts WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS deliveries_deleted = ROW_COUNT;
  DELETE FROM notifications.inbox_items WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS items_deleted = ROW_COUNT;
  DELETE FROM notifications.preferences WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS preferences_deleted = ROW_COUNT;
  DELETE FROM notifications.source_receipts WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS receipts_deleted = ROW_COUNT;
  DELETE FROM notifications.source_cursors WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS cursors_deleted = ROW_COUNT;
  DELETE FROM notifications.email_destinations WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS email_destinations_deleted = ROW_COUNT;
  DELETE FROM notifications.push_subscriptions WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS push_subscriptions_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'owner', 'notifications',
    'itemsDeleted', items_deleted,
    'preferencesDeleted', preferences_deleted,
    'receiptsDeleted', receipts_deleted,
    'cursorsDeleted', cursors_deleted,
    'deliveriesDeleted', deliveries_deleted,
    'emailDestinationsDeleted', email_destinations_deleted,
    'pushSubscriptionsDeleted', push_subscriptions_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION notifications.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION notifications.delete_candidate_data(uuid, uuid) FROM PUBLIC;
