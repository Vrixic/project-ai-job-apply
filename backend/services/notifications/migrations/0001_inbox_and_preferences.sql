CREATE SCHEMA IF NOT EXISTS notifications;

-- One row per source event ever accepted, so a replayed or duplicated delivery changes nothing.
CREATE TABLE notifications.source_receipts (
  source_service text NOT NULL CHECK (source_service IN ('applications')),
  source_event_id text NOT NULL CHECK (char_length(source_event_id) BETWEEN 8 AND 128),
  owner_user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 3 AND 100),
  received_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('recorded', 'ignored', 'stale')),
  PRIMARY KEY (source_service, source_event_id)
);
CREATE INDEX source_receipts_owner_idx ON notifications.source_receipts (owner_user_id, received_at);

-- The newest source revision seen per aggregate. An older event is stale and changes nothing.
CREATE TABLE notifications.source_cursors (
  owner_user_id uuid NOT NULL,
  source_service text NOT NULL CHECK (source_service IN ('applications')),
  aggregate_id uuid NOT NULL,
  last_revision bigint NOT NULL CHECK (last_revision BETWEEN 1 AND 9007199254740991),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, source_service, aggregate_id)
);

-- A derived projection. It carries a classification and an opaque reference, never candidate
-- content, and acknowledging or dismissing it can never change the source fact.
CREATE TABLE notifications.inbox_items (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  kind text NOT NULL CHECK (
    kind IN ('application_review_needed', 'application_outcome_needed', 'application_confirmed')
  ),
  urgency text NOT NULL CHECK (urgency IN ('low', 'normal', 'high')),
  state text NOT NULL CHECK (state IN ('unread', 'acknowledged', 'dismissed', 'expired')),
  source_service text NOT NULL CHECK (source_service IN ('applications')),
  aggregate_id uuid NOT NULL,
  source_revision bigint NOT NULL CHECK (source_revision BETWEEN 1 AND 9007199254740991),
  dedupe_key text NOT NULL CHECK (char_length(dedupe_key) BETWEEN 8 AND 200),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT inbox_items_owner_dedupe_uq UNIQUE (owner_user_id, dedupe_key),
  CONSTRAINT inbox_items_chronology_ck CHECK (created_at <= updated_at AND created_at < expires_at)
);
CREATE INDEX inbox_items_owner_state_idx
  ON notifications.inbox_items (owner_user_id, state, created_at DESC, id DESC);
CREATE INDEX inbox_items_aggregate_idx
  ON notifications.inbox_items (owner_user_id, source_service, aggregate_id);
CREATE INDEX inbox_items_expiry_idx
  ON notifications.inbox_items (expires_at) WHERE state IN ('unread', 'acknowledged');

-- Delivery preferences. The in-app inbox cannot be turned off (it is the fallback when external
-- delivery fails); email and push are off until the candidate turns them on.
CREATE TABLE notifications.preferences (
  owner_user_id uuid PRIMARY KEY,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 2147483647),
  in_app_enabled boolean NOT NULL DEFAULT true CHECK (in_app_enabled),
  email_enabled boolean NOT NULL DEFAULT false,
  push_enabled boolean NOT NULL DEFAULT false,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  quiet_start_minute smallint NOT NULL DEFAULT 1320 CHECK (quiet_start_minute BETWEEN 0 AND 1439),
  quiet_end_minute smallint NOT NULL DEFAULT 420 CHECK (quiet_end_minute BETWEEN 0 AND 1439),
  time_zone text NOT NULL DEFAULT 'UTC' CHECK (char_length(time_zone) BETWEEN 1 AND 64),
  updated_at timestamptz NOT NULL,
  CONSTRAINT preferences_quiet_window_ck CHECK (
    NOT quiet_hours_enabled OR quiet_start_minute <> quiet_end_minute
  )
);
