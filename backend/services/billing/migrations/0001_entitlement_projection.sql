CREATE SCHEMA IF NOT EXISTS billing;

CREATE TABLE billing.entitlement_accounts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  plan text NOT NULL CHECK (plan IN ('free', 'pro')),
  effective_at timestamptz NOT NULL,
  access_through timestamptz,
  grace_through timestamptz,
  updated_at timestamptz NOT NULL,
  CONSTRAINT entitlement_accounts_identity_uq UNIQUE (id, user_id),
  CONSTRAINT entitlement_accounts_schedule_ck CHECK (
    effective_at <= updated_at
    AND (
    (plan = 'free' AND access_through IS NULL AND grace_through IS NULL)
    OR
    (plan = 'pro' AND access_through IS NOT NULL
      AND effective_at < access_through
      AND (grace_through IS NULL OR access_through <= grace_through))
    )
  )
);

CREATE TABLE billing.entitlement_changes (
  id uuid PRIMARY KEY,
  entitlement_account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
  prior_plan text CHECK (prior_plan IN ('free', 'pro')),
  plan text NOT NULL CHECK (plan IN ('free', 'pro')),
  effective_at timestamptz NOT NULL,
  access_through timestamptz,
  grace_through timestamptz,
  reason_code text NOT NULL CHECK (
    reason_code IN ('synthetic_grant', 'synthetic_revoke', 'provider_projection', 'reconciliation', 'support_adjustment')
  ),
  actor_kind text NOT NULL CHECK (actor_kind IN ('system', 'provider_adapter', 'support')),
  actor_reference uuid NOT NULL,
  trace_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT entitlement_changes_account_fk
    FOREIGN KEY (entitlement_account_id, user_id)
    REFERENCES billing.entitlement_accounts (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT entitlement_changes_identity_uq
    UNIQUE (id, entitlement_account_id, user_id, version),
  CONSTRAINT entitlement_changes_account_version_uq
    UNIQUE (entitlement_account_id, user_id, version),
  CONSTRAINT entitlement_changes_prior_plan_ck CHECK (
    (version = 1 AND prior_plan IS NULL) OR (version > 1 AND prior_plan IS NOT NULL)
  ),
  CONSTRAINT entitlement_changes_attribution_ck CHECK (
    (reason_code = 'synthetic_grant' AND actor_kind = 'system' AND plan = 'pro')
    OR (reason_code = 'synthetic_revoke' AND actor_kind = 'system' AND plan = 'free')
    OR (reason_code = 'reconciliation' AND actor_kind = 'system')
    OR (reason_code = 'provider_projection' AND actor_kind = 'provider_adapter')
    OR (reason_code = 'support_adjustment' AND actor_kind = 'support')
  ),
  CONSTRAINT entitlement_changes_schedule_ck CHECK (
    effective_at <= occurred_at
    AND (
    (plan = 'free' AND access_through IS NULL AND grace_through IS NULL)
    OR
    (plan = 'pro' AND access_through IS NOT NULL
      AND effective_at < access_through
      AND (grace_through IS NULL OR access_through <= grace_through))
    )
  )
);

CREATE INDEX entitlement_changes_user_occurred_idx
  ON billing.entitlement_changes (user_id, occurred_at, id);

CREATE TABLE billing.entitlement_outbox (
  id uuid PRIMARY KEY,
  entitlement_account_id uuid NOT NULL,
  user_id uuid NOT NULL,
  account_version bigint NOT NULL CHECK (account_version BETWEEN 1 AND 9007199254740991),
  event_type text NOT NULL CHECK (event_type = 'subscription.entitlement_changed.v1'),
  subject text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  claim_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  published_at timestamptz,
  failed_at timestamptz,
  last_error_code text CHECK (last_error_code IN ('transient', 'publisher_unavailable', 'lease_expired')),
  CONSTRAINT entitlement_outbox_account_fk
    FOREIGN KEY (entitlement_account_id, user_id)
    REFERENCES billing.entitlement_accounts (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT entitlement_outbox_identity_uq
    UNIQUE (id, entitlement_account_id, user_id, account_version),
  CONSTRAINT entitlement_outbox_account_version_uq UNIQUE (entitlement_account_id, account_version),
  CONSTRAINT entitlement_outbox_change_fk
    FOREIGN KEY (entitlement_account_id, user_id, account_version)
    REFERENCES billing.entitlement_changes (entitlement_account_id, user_id, version)
    ON DELETE RESTRICT,
  CONSTRAINT entitlement_outbox_subject_ck CHECK (
    subject = 'entitlement-account/' || entitlement_account_id::text
  ),
  CONSTRAINT entitlement_outbox_payload_ck CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ? 'entitlementAccountId'
    AND payload ? 'userId'
    AND payload ? 'version'
    AND (payload - 'entitlementAccountId' - 'userId' - 'version') = '{}'::jsonb
    AND jsonb_typeof(payload->'entitlementAccountId') = 'string'
    AND jsonb_typeof(payload->'userId') = 'string'
    AND jsonb_typeof(payload->'version') = 'number'
    AND payload->>'entitlementAccountId' = entitlement_account_id::text
    AND payload->>'userId' = user_id::text
    AND payload->>'version' = account_version::text
  ),
  CONSTRAINT entitlement_outbox_delivery_state_ck CHECK (
    (status = 'pending' AND claim_token IS NULL AND lease_expires_at IS NULL
      AND published_at IS NULL AND failed_at IS NULL AND attempt_count < 5
      AND ((attempt_count = 0 AND last_error_code IS NULL)
        OR (attempt_count BETWEEN 1 AND 4 AND last_error_code IS NOT NULL)))
    OR
    (status = 'processing' AND claim_token IS NOT NULL AND lease_expires_at IS NOT NULL
      AND published_at IS NULL AND failed_at IS NULL AND last_error_code IS NULL
      AND attempt_count BETWEEN 1 AND 5)
    OR
    (status = 'published' AND claim_token IS NULL AND lease_expires_at IS NULL
      AND published_at IS NOT NULL AND failed_at IS NULL AND last_error_code IS NULL
      AND attempt_count BETWEEN 1 AND 5)
    OR
    (status = 'failed' AND claim_token IS NULL AND lease_expires_at IS NULL
      AND published_at IS NULL AND failed_at IS NOT NULL AND last_error_code IS NOT NULL
      AND attempt_count = 5)
  ),
  CONSTRAINT entitlement_outbox_chronology_ck CHECK (
    available_at >= occurred_at
    AND (published_at IS NULL OR published_at >= occurred_at)
    AND (failed_at IS NULL OR failed_at >= occurred_at)
  )
);

CREATE INDEX entitlement_outbox_pending_idx
  ON billing.entitlement_outbox (available_at, occurred_at, id)
  WHERE status = 'pending';

CREATE INDEX entitlement_outbox_processing_lease_idx
  ON billing.entitlement_outbox (lease_expires_at, id)
  WHERE status = 'processing';

CREATE TABLE billing.entitlement_command_receipts (
  user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  entitlement_account_id uuid NOT NULL,
  response_version bigint NOT NULL CHECK (response_version BETWEEN 1 AND 9007199254740991),
  change_id uuid NOT NULL,
  outbox_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, idempotency_key),
  CONSTRAINT entitlement_command_account_fk
    FOREIGN KEY (entitlement_account_id, user_id)
    REFERENCES billing.entitlement_accounts (id, user_id) ON DELETE RESTRICT,
  CONSTRAINT entitlement_command_change_fk
    FOREIGN KEY (change_id, entitlement_account_id, user_id, response_version)
    REFERENCES billing.entitlement_changes (id, entitlement_account_id, user_id, version)
    ON DELETE RESTRICT,
  CONSTRAINT entitlement_command_outbox_fk
    FOREIGN KEY (outbox_event_id, entitlement_account_id, user_id, response_version)
    REFERENCES billing.entitlement_outbox (id, entitlement_account_id, user_id, account_version)
    ON DELETE RESTRICT,
  CONSTRAINT entitlement_command_key_length_ck CHECK (char_length(idempotency_key) BETWEEN 16 AND 128)
);

CREATE OR REPLACE FUNCTION billing.protect_entitlement_account_chronology()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.updated_at > clock_timestamp() THEN
    RAISE EXCEPTION 'billing entitlement account update is future-dated';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'billing entitlement account chronology cannot regress';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entitlement_accounts_chronology_guard
BEFORE INSERT OR UPDATE ON billing.entitlement_accounts
FOR EACH ROW EXECUTE FUNCTION billing.protect_entitlement_account_chronology();

CREATE OR REPLACE FUNCTION billing.protect_entitlement_change_chronology()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  account_version bigint;
  account_updated_at timestamptz;
BEGIN
  IF NEW.occurred_at > clock_timestamp() THEN
    RAISE EXCEPTION 'billing entitlement change is future-dated';
  END IF;
  SELECT version, updated_at INTO account_version, account_updated_at
  FROM billing.entitlement_accounts
  WHERE id = NEW.entitlement_account_id AND user_id = NEW.user_id;
  IF account_version IS NULL
    OR NEW.version IS DISTINCT FROM account_version
    OR NEW.occurred_at IS DISTINCT FROM account_updated_at THEN
    RAISE EXCEPTION 'billing entitlement change chronology does not match its account';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entitlement_changes_chronology_guard
BEFORE INSERT ON billing.entitlement_changes
FOR EACH ROW EXECUTE FUNCTION billing.protect_entitlement_change_chronology();

CREATE OR REPLACE FUNCTION billing.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'billing history is append-only';
END;
$$;

CREATE TRIGGER entitlement_changes_immutable
BEFORE UPDATE OR DELETE ON billing.entitlement_changes
FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();

CREATE TRIGGER entitlement_command_receipts_immutable
BEFORE UPDATE OR DELETE ON billing.entitlement_command_receipts
FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION billing.protect_entitlement_outbox_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.entitlement_account_id IS DISTINCT FROM OLD.entitlement_account_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.account_version IS DISTINCT FROM OLD.account_version
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at THEN
    RAISE EXCEPTION 'billing entitlement outbox payload is immutable';
  END IF;
  IF OLD.status IN ('published', 'failed') THEN
    RAISE EXCEPTION 'billing entitlement outbox terminal state is immutable';
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'processing' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
      RAISE EXCEPTION 'billing entitlement outbox attempt transition is invalid';
    END IF;
  ELSIF OLD.status = 'processing' AND NEW.status = 'processing' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
      RAISE EXCEPTION 'billing entitlement outbox attempt transition is invalid';
    END IF;
  ELSIF OLD.status = 'processing' AND NEW.status IN ('pending', 'published', 'failed') THEN
    IF NEW.attempt_count <> OLD.attempt_count THEN
      RAISE EXCEPTION 'billing entitlement outbox attempt transition is invalid';
    END IF;
  ELSE
    RAISE EXCEPTION 'billing entitlement outbox state transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entitlement_outbox_payload_immutable
BEFORE UPDATE ON billing.entitlement_outbox
FOR EACH ROW EXECUTE FUNCTION billing.protect_entitlement_outbox_payload();

CREATE TRIGGER entitlement_outbox_delete_forbidden
BEFORE DELETE ON billing.entitlement_outbox
FOR EACH ROW EXECUTE FUNCTION billing.reject_append_only_mutation();
