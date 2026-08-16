CREATE SCHEMA IF NOT EXISTS matching;

CREATE OR REPLACE FUNCTION matching.valid_bounded_locations(value text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT cardinality(value) BETWEEN 1 AND 20
    AND array_position(value, NULL) IS NULL
    AND coalesce(bool_and(char_length(item) BETWEEN 1 AND 240 AND item = btrim(item)), false)
  FROM unnest(value) AS item;
$$;

CREATE TABLE matching.saved_job_list_state (
  owner_user_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0)
);

CREATE TABLE matching.saved_jobs (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  requested_job_id uuid NOT NULL,
  resolved_canonical_job_id_at_save uuid NOT NULL,
  snapshot_company_id uuid NOT NULL,
  snapshot_company_name text NOT NULL CHECK (
    char_length(snapshot_company_name) BETWEEN 1 AND 200
    AND snapshot_company_name = btrim(snapshot_company_name)
  ),
  snapshot_verified_domain text CHECK (
    char_length(snapshot_verified_domain) BETWEEN 1 AND 253
    AND snapshot_verified_domain = btrim(snapshot_verified_domain)
    AND snapshot_verified_domain ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
  ),
  snapshot_title text NOT NULL CHECK (
    char_length(snapshot_title) BETWEEN 1 AND 240
    AND snapshot_title = btrim(snapshot_title)
  ),
  snapshot_locations text[] NOT NULL CHECK (matching.valid_bounded_locations(snapshot_locations)),
  snapshot_department text CHECK (
    char_length(snapshot_department) BETWEEN 1 AND 200
    AND snapshot_department = btrim(snapshot_department)
  ),
  snapshot_first_observed_at timestamptz NOT NULL,
  snapshot_last_verified_at timestamptz NOT NULL,
  snapshot_expires_at timestamptz NOT NULL,
  saved_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT saved_jobs_owner_requested_job_uq UNIQUE (owner_user_id, requested_job_id),
  CONSTRAINT saved_jobs_snapshot_time_order_ck CHECK (
    snapshot_first_observed_at <= snapshot_last_verified_at
    AND snapshot_last_verified_at < snapshot_expires_at
  )
);

CREATE INDEX saved_jobs_owner_page_idx
  ON matching.saved_jobs (owner_user_id, saved_at DESC, id DESC);

CREATE TABLE matching.idempotency_keys (
  owner_user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  saved_job_id uuid NOT NULL,
  requested_job_id uuid NOT NULL,
  resolved_canonical_job_id_at_save uuid NOT NULL,
  snapshot_company_id uuid NOT NULL,
  snapshot_company_name text NOT NULL CHECK (
    char_length(snapshot_company_name) BETWEEN 1 AND 200
    AND snapshot_company_name = btrim(snapshot_company_name)
  ),
  snapshot_verified_domain text CHECK (
    char_length(snapshot_verified_domain) BETWEEN 1 AND 253
    AND snapshot_verified_domain = btrim(snapshot_verified_domain)
    AND snapshot_verified_domain ~ '^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$'
  ),
  snapshot_title text NOT NULL CHECK (
    char_length(snapshot_title) BETWEEN 1 AND 240
    AND snapshot_title = btrim(snapshot_title)
  ),
  snapshot_locations text[] NOT NULL CHECK (matching.valid_bounded_locations(snapshot_locations)),
  snapshot_department text CHECK (
    char_length(snapshot_department) BETWEEN 1 AND 200
    AND snapshot_department = btrim(snapshot_department)
  ),
  snapshot_first_observed_at timestamptz NOT NULL,
  snapshot_last_verified_at timestamptz NOT NULL,
  snapshot_expires_at timestamptz NOT NULL,
  saved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  idempotency_expires_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT matching_idempotency_key_length_ck
    CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
  CONSTRAINT matching_idempotency_snapshot_time_order_ck CHECK (
    snapshot_first_observed_at <= snapshot_last_verified_at
    AND snapshot_last_verified_at < snapshot_expires_at
  ),
  CONSTRAINT matching_idempotency_retention_ck CHECK (
    idempotency_expires_at = created_at + interval '24 hours'
  )
);

CREATE INDEX matching_idempotency_keys_owner_expiry_idx
  ON matching.idempotency_keys (owner_user_id, idempotency_expires_at);

CREATE TABLE matching.audit_events (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  saved_job_id uuid NOT NULL,
  requested_job_id uuid NOT NULL,
  resolved_canonical_job_id_at_save uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('saved', 'unsaved')),
  occurred_at timestamptz NOT NULL
);

CREATE INDEX matching_audit_events_owner_occurred_idx
  ON matching.audit_events (owner_user_id, occurred_at, id);

CREATE OR REPLACE FUNCTION matching.reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'matching.audit_events is append-only';
END;
$$;

CREATE TRIGGER matching_audit_events_immutable
BEFORE UPDATE OR DELETE ON matching.audit_events
FOR EACH ROW EXECUTE FUNCTION matching.reject_audit_event_mutation();
