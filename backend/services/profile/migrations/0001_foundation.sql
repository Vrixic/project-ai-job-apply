CREATE SCHEMA IF NOT EXISTS identity;
CREATE SCHEMA IF NOT EXISTS profile;
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS identity.users (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS identity.external_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);
CREATE INDEX IF NOT EXISTS external_identities_user_id_idx
  ON identity.external_identities(user_id);

CREATE TABLE IF NOT EXISTS profile.job_preferences (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  preferences jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_preferences_user_id_uq
  ON profile.job_preferences(user_id);

CREATE TABLE IF NOT EXISTS platform.operations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  state text NOT NULL CHECK (
    state IN ('queued', 'running', 'succeeded', 'retryable_failure', 'failed')
  ),
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS operations_user_id_created_at_idx
  ON platform.operations(user_id, created_at);

CREATE TABLE IF NOT EXISTS platform.outbox_events (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  source text NOT NULL,
  subject text NOT NULL,
  data_schema text NOT NULL,
  data jsonb NOT NULL,
  traceparent text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_events_pending_idx
  ON platform.outbox_events(published_at, created_at);

CREATE TABLE IF NOT EXISTS platform.idempotency_keys (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);

CREATE TABLE IF NOT EXISTS platform.audit_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  trace_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_user_time_idx
  ON platform.audit_events(user_id, occurred_at);
