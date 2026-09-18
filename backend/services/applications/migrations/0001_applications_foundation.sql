CREATE SCHEMA IF NOT EXISTS applications;

-- The Applications bounded context is the sole owner of Application, ApplicationPacket,
-- ApplicationAttempt, submission evidence, and technical history (ADR-024). History ends at
-- confirmed submission: no table or value models a post-submission hiring outcome.

CREATE TABLE applications.applications (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  canonical_job_id uuid NOT NULL,
  status text NOT NULL CHECK (
    status IN (
      'preparing', 'review_required', 'approved', 'submitting', 'takeover',
      'reconciliation_required', 'applied', 'cancelled'
    )
  ),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
  current_packet_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT applications_identity_uq UNIQUE (id, owner_user_id),
  CONSTRAINT applications_chronology_ck CHECK (created_at <= updated_at)
);

-- One live application per candidate and job; a cancelled one may be started again.
CREATE UNIQUE INDEX applications_owner_job_live_uq
  ON applications.applications (owner_user_id, canonical_job_id)
  WHERE status <> 'cancelled';

CREATE INDEX applications_owner_updated_idx
  ON applications.applications (owner_user_id, updated_at DESC, id DESC);

CREATE TABLE applications.packets (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  version integer NOT NULL CHECK (version BETWEEN 1 AND 100000),
  packet_hash text NOT NULL CHECK (packet_hash ~ '^[a-f0-9]{64}$'),
  job_revision text NOT NULL CHECK (job_revision ~ '^[a-f0-9]{64}$'),
  form_adapter_id text CHECK (char_length(form_adapter_id) BETWEEN 1 AND 64),
  form_variant_id text CHECK (char_length(form_variant_id) BETWEEN 1 AND 64),
  form_hash text CHECK (form_hash ~ '^[a-f0-9]{64}$'),
  resume_hash text CHECK (resume_hash ~ '^[a-f0-9]{64}$'),
  cover_letter_hash text CHECK (cover_letter_hash ~ '^[a-f0-9]{64}$'),
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array' AND jsonb_array_length(fields) <= 200),
  created_at timestamptz NOT NULL,
  CONSTRAINT packets_application_fk
    FOREIGN KEY (application_id, owner_user_id)
    REFERENCES applications.applications (id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT packets_identity_uq UNIQUE (id, application_id, owner_user_id),
  CONSTRAINT packets_application_version_uq UNIQUE (application_id, version),
  CONSTRAINT packets_application_hash_uq UNIQUE (application_id, packet_hash),
  CONSTRAINT packets_form_binding_ck CHECK (
    (form_adapter_id IS NULL AND form_variant_id IS NULL AND form_hash IS NULL)
    OR (form_adapter_id IS NOT NULL AND form_variant_id IS NOT NULL AND form_hash IS NOT NULL)
  )
);

ALTER TABLE applications.applications
  ADD CONSTRAINT applications_current_packet_fk
  FOREIGN KEY (current_packet_id, id, owner_user_id)
  REFERENCES applications.packets (id, application_id, owner_user_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE applications.approvals (
  id uuid PRIMARY KEY,
  packet_id uuid NOT NULL,
  application_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  packet_hash text NOT NULL CHECK (packet_hash ~ '^[a-f0-9]{64}$'),
  consent_id uuid NOT NULL,
  acknowledged_field_keys text[] NOT NULL CHECK (cardinality(acknowledged_field_keys) <= 200),
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  invalidation_reason text CHECK (
    invalidation_reason IN (
      'packet_hash_mismatch', 'approval_expired', 'job_changed', 'form_changed',
      'resume_changed', 'cover_letter_changed', 'superseded', 'attempt_requires_review',
      'cancelled'
    )
  ),
  CONSTRAINT approvals_packet_fk
    FOREIGN KEY (packet_id, application_id, owner_user_id)
    REFERENCES applications.packets (id, application_id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT approvals_time_ck CHECK (
    approved_at < expires_at
    AND ((invalidated_at IS NULL AND invalidation_reason IS NULL)
      OR (invalidated_at IS NOT NULL AND invalidation_reason IS NOT NULL
        AND invalidated_at >= approved_at))
  )
);

-- At most one live approval per application.
CREATE UNIQUE INDEX approvals_application_live_uq
  ON applications.approvals (application_id)
  WHERE invalidated_at IS NULL;

CREATE TABLE applications.attempts (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  packet_id uuid NOT NULL,
  packet_hash text NOT NULL CHECK (packet_hash ~ '^[a-f0-9]{64}$'),
  approval_id uuid NOT NULL REFERENCES applications.approvals (id) ON DELETE RESTRICT,
  sequence integer NOT NULL CHECK (sequence >= 1),
  scope_key text NOT NULL CHECK (scope_key ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (
    status IN (
      'started', 'dispatched', 'confirmed', 'ambiguous', 'failed_no_effect',
      'failed_requires_review', 'taken_over', 'abandoned', 'reconciled_not_submitted'
    )
  ),
  adapter_id text NOT NULL CHECK (char_length(adapter_id) BETWEEN 1 AND 64),
  adapter_version text NOT NULL CHECK (char_length(adapter_version) BETWEEN 1 AND 64),
  started_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  resolved_at timestamptz,
  evidence_kind text CHECK (
    evidence_kind IN ('provider_confirmation_page', 'provider_api_response', 'user_attested')
  ),
  evidence_fingerprint text CHECK (evidence_fingerprint ~ '^[a-f0-9]{64}$'),
  evidence_observed_at timestamptz,
  evidence_provider_reference text CHECK (char_length(evidence_provider_reference) BETWEEN 1 AND 200),
  CONSTRAINT attempts_packet_fk
    FOREIGN KEY (packet_id, application_id, owner_user_id)
    REFERENCES applications.packets (id, application_id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT attempts_application_sequence_uq UNIQUE (application_id, sequence),
  CONSTRAINT attempts_evidence_ck CHECK (
    (status = 'confirmed' AND evidence_kind IS NOT NULL AND evidence_fingerprint IS NOT NULL
      AND evidence_observed_at IS NOT NULL)
    OR (status <> 'confirmed' AND evidence_kind IS NULL AND evidence_fingerprint IS NULL
      AND evidence_observed_at IS NULL AND evidence_provider_reference IS NULL)
  ),
  -- Dispatch time exists exactly when the attempt was sent to the provider. An attempt taken
  -- over by the candidate before dispatch may later be confirmed without ever being dispatched.
  CONSTRAINT attempts_dispatch_ck CHECK (
    (status = 'started' AND dispatched_at IS NULL)
    OR (status IN ('dispatched', 'failed_requires_review') AND dispatched_at IS NOT NULL)
    OR status NOT IN ('started', 'dispatched', 'failed_requires_review')
  ),
  CONSTRAINT attempts_resolution_ck CHECK (
    (status IN ('started', 'dispatched') AND resolved_at IS NULL)
    OR (status NOT IN ('started', 'dispatched') AND resolved_at IS NOT NULL)
  ),
  CONSTRAINT attempts_chronology_ck CHECK (
    (dispatched_at IS NULL OR dispatched_at >= started_at)
    AND (resolved_at IS NULL OR resolved_at >= started_at)
  )
);

-- Database-level duplicate-submit guard: one scope-holding attempt per (user, application,
-- packet). An ambiguous, dispatched, confirmed, or taken-over attempt blocks another dispatch
-- for the same packet until it is confirmed or explicitly reconciled as not submitted.
CREATE UNIQUE INDEX attempts_scope_holding_uq
  ON applications.attempts (scope_key)
  WHERE status IN ('started', 'dispatched', 'ambiguous', 'confirmed', 'taken_over');

CREATE INDEX attempts_application_idx
  ON applications.attempts (application_id, sequence);

CREATE TABLE applications.history (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  seq bigint NOT NULL CHECK (seq >= 1),
  kind text NOT NULL CHECK (
    kind IN (
      'application_created', 'packet_created', 'approval_recorded', 'approval_invalidated',
      'attempt_started', 'attempt_dispatched', 'attempt_failed_no_effect',
      'attempt_failed_requires_review', 'takeover_requested', 'takeover_abandoned',
      'submission_ambiguous', 'reconciliation_recorded', 'submission_confirmed',
      'application_cancelled'
    )
  ),
  from_status text,
  to_status text NOT NULL,
  packet_id uuid,
  attempt_id uuid,
  reason_code text CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  occurred_at timestamptz NOT NULL,
  CONSTRAINT history_application_fk
    FOREIGN KEY (application_id, owner_user_id)
    REFERENCES applications.applications (id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT history_application_seq_uq UNIQUE (application_id, seq)
);

CREATE INDEX history_owner_application_idx
  ON applications.history (owner_user_id, application_id, seq);

CREATE TABLE applications.command_receipts (
  owner_user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  operation text NOT NULL CHECK (
    operation IN ('create_application', 'create_packet', 'approve', 'cancel', 'start_attempt',
      'record_result', 'reconcile', 'takeover')
  ),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  application_id uuid NOT NULL,
  response_revision bigint NOT NULL CHECK (response_revision >= 1),
  -- Fixed outcome code and subject (for example the started attempt) so a replay is exact.
  outcome_code text CHECK (char_length(outcome_code) BETWEEN 1 AND 200),
  subject_id uuid,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner_user_id, idempotency_key),
  CONSTRAINT command_receipts_key_length_ck CHECK (char_length(idempotency_key) BETWEEN 16 AND 128),
  CONSTRAINT command_receipts_application_fk
    FOREIGN KEY (application_id, owner_user_id)
    REFERENCES applications.applications (id, owner_user_id) ON DELETE RESTRICT
);

CREATE TABLE applications.outbox (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  application_revision bigint NOT NULL CHECK (application_revision >= 1),
  event_type text NOT NULL CHECK (
    event_type IN ('application.status_changed.v1', 'application.applied.v1')
  ),
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
  CONSTRAINT outbox_application_fk
    FOREIGN KEY (application_id, owner_user_id)
    REFERENCES applications.applications (id, owner_user_id) ON DELETE RESTRICT,
  CONSTRAINT outbox_application_revision_event_uq UNIQUE (application_id, application_revision, event_type),
  CONSTRAINT outbox_subject_ck CHECK (subject = 'application/' || application_id::text),
  -- Identifiers and a status only: never packet values, artifacts, URLs, or provider bodies.
  CONSTRAINT outbox_payload_ck CHECK (
    jsonb_typeof(payload) = 'object'
    AND payload ?& ARRAY['applicationId', 'userId', 'revision', 'status']
    AND (payload - 'applicationId' - 'userId' - 'revision' - 'status') = '{}'::jsonb
    AND payload->>'applicationId' = application_id::text
    AND payload->>'userId' = owner_user_id::text
    AND payload->>'revision' = application_revision::text
  ),
  CONSTRAINT outbox_delivery_state_ck CHECK (
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
  CONSTRAINT outbox_chronology_ck CHECK (
    available_at >= occurred_at
    AND (published_at IS NULL OR published_at >= occurred_at)
    AND (failed_at IS NULL OR failed_at >= occurred_at)
  )
);

CREATE INDEX outbox_pending_idx
  ON applications.outbox (available_at, occurred_at, id)
  WHERE status = 'pending';

CREATE INDEX outbox_processing_lease_idx
  ON applications.outbox (lease_expires_at, id)
  WHERE status = 'processing';

-- Guards ------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION applications.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'applications % is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER packets_immutable
BEFORE UPDATE OR DELETE ON applications.packets
FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();

CREATE TRIGGER history_immutable
BEFORE UPDATE OR DELETE ON applications.history
FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();

CREATE TRIGGER command_receipts_immutable
BEFORE UPDATE OR DELETE ON applications.command_receipts
FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION applications.guard_application_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.canonical_job_id IS DISTINCT FROM OLD.canonical_job_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'applications identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('applied', 'cancelled') THEN
    RAISE EXCEPTION 'applications terminal state is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'applications revision must advance by one' USING ERRCODE = '55000';
  END IF;
  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'applications chronology cannot regress' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (
    ('preparing', 'review_required'), ('preparing', 'cancelled'),
    ('review_required', 'approved'), ('review_required', 'cancelled'),
    ('approved', 'review_required'), ('approved', 'submitting'), ('approved', 'cancelled'),
    ('submitting', 'approved'), ('submitting', 'review_required'), ('submitting', 'takeover'),
    ('submitting', 'applied'), ('submitting', 'reconciliation_required'),
    ('takeover', 'approved'), ('takeover', 'applied'), ('takeover', 'reconciliation_required'),
    ('reconciliation_required', 'applied'), ('reconciliation_required', 'approved')
  )) THEN
    RAISE EXCEPTION 'applications status transition % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER applications_transition_guard
BEFORE UPDATE ON applications.applications
FOR EACH ROW EXECUTE FUNCTION applications.guard_application_transition();

CREATE OR REPLACE FUNCTION applications.guard_approval_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.packet_id IS DISTINCT FROM OLD.packet_id
    OR NEW.application_id IS DISTINCT FROM OLD.application_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.packet_hash IS DISTINCT FROM OLD.packet_hash
    OR NEW.consent_id IS DISTINCT FROM OLD.consent_id
    OR NEW.acknowledged_field_keys IS DISTINCT FROM OLD.acknowledged_field_keys
    OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'applications approval evidence is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'applications approval invalidation is final' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approvals_update_guard
BEFORE UPDATE ON applications.approvals
FOR EACH ROW EXECUTE FUNCTION applications.guard_approval_update();

CREATE TRIGGER approvals_delete_forbidden
BEFORE DELETE ON applications.approvals
FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION applications.guard_attempt_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.application_id IS DISTINCT FROM OLD.application_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.packet_id IS DISTINCT FROM OLD.packet_id
    OR NEW.packet_hash IS DISTINCT FROM OLD.packet_hash
    OR NEW.approval_id IS DISTINCT FROM OLD.approval_id
    OR NEW.sequence IS DISTINCT FROM OLD.sequence
    OR NEW.scope_key IS DISTINCT FROM OLD.scope_key
    OR NEW.adapter_id IS DISTINCT FROM OLD.adapter_id
    OR NEW.adapter_version IS DISTINCT FROM OLD.adapter_version
    OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'applications attempt identity is immutable' USING ERRCODE = '55000';
  END IF;
  -- Write-ahead dispatch time is recorded once and can never be cleared or moved.
  IF OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at THEN
    RAISE EXCEPTION 'applications attempt dispatch time is immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = NEW.status)
    OR (OLD.status, NEW.status) IN (
      ('started', 'dispatched'), ('started', 'failed_no_effect'), ('started', 'abandoned'),
      ('started', 'taken_over'),
      ('dispatched', 'confirmed'), ('dispatched', 'ambiguous'),
      ('dispatched', 'failed_requires_review'), ('dispatched', 'taken_over'),
      ('ambiguous', 'confirmed'), ('ambiguous', 'reconciled_not_submitted'),
      ('taken_over', 'confirmed'), ('taken_over', 'ambiguous'),
      ('taken_over', 'reconciled_not_submitted'), ('taken_over', 'abandoned')
    )
  ) THEN
    RAISE EXCEPTION 'applications attempt transition % -> % is not allowed', OLD.status, NEW.status
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('confirmed', 'failed_no_effect', 'failed_requires_review', 'abandoned',
    'reconciled_not_submitted') AND OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE EXCEPTION 'applications attempt terminal state is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attempts_update_guard
BEFORE UPDATE ON applications.attempts
FOR EACH ROW EXECUTE FUNCTION applications.guard_attempt_update();

CREATE TRIGGER attempts_delete_forbidden
BEFORE DELETE ON applications.attempts
FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION applications.protect_outbox_payload()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.application_id IS DISTINCT FROM OLD.application_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.application_revision IS DISTINCT FROM OLD.application_revision
    OR NEW.event_type IS DISTINCT FROM OLD.event_type
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at THEN
    RAISE EXCEPTION 'applications outbox payload is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('published', 'failed') THEN
    RAISE EXCEPTION 'applications outbox terminal state is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'processing' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
      RAISE EXCEPTION 'applications outbox attempt transition is invalid' USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'processing' AND NEW.status = 'processing' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1 THEN
      RAISE EXCEPTION 'applications outbox attempt transition is invalid' USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'processing' AND NEW.status IN ('pending', 'published', 'failed') THEN
    IF NEW.attempt_count <> OLD.attempt_count THEN
      RAISE EXCEPTION 'applications outbox attempt transition is invalid' USING ERRCODE = '55000';
    END IF;
  ELSE
    RAISE EXCEPTION 'applications outbox state transition is invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_payload_immutable
BEFORE UPDATE ON applications.outbox
FOR EACH ROW EXECUTE FUNCTION applications.protect_outbox_payload();

CREATE TRIGGER outbox_delete_forbidden
BEFORE DELETE ON applications.outbox
FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();
