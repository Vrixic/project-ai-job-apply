-- D3-017: one explicitly requested, short-lived cover-letter preparation. Candidate values
-- already belong to the referenced immutable packet; no prompts or raw draft text enter this state.
ALTER TABLE applications.command_receipts DROP CONSTRAINT command_receipts_operation_check;
ALTER TABLE applications.command_receipts ADD CONSTRAINT command_receipts_operation_check CHECK (
  operation IN ('create_application', 'create_packet', 'approve', 'cancel', 'start_attempt',
    'start_manual_attempt', 'record_result', 'reconcile', 'takeover', 'queue_preparation')
);

CREATE TABLE applications.packet_preparations (
  id uuid PRIMARY KEY,
  application_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  base_packet_id uuid NOT NULL,
  expected_revision bigint NOT NULL CHECK (expected_revision >= 1),
  job_context_hash text NOT NULL CHECK (job_context_hash ~ '^[a-f0-9]{64}$'),
  confirmed_facts_hash text NOT NULL CHECK (confirmed_facts_hash ~ '^[a-f0-9]{64}$'),
  notice_version text NOT NULL CHECK (notice_version = 'openai-cover-letter.v1'),
  provider text NOT NULL DEFAULT 'openai' CHECK (provider = 'openai'),
  model text NOT NULL DEFAULT 'gpt-6-luna' CHECK (model = 'gpt-6-luna'),
  purpose text NOT NULL DEFAULT 'cover_letter' CHECK (purpose = 'cover_letter'),
  categories jsonb NOT NULL DEFAULT '["profile_facts","job_posting"]'::jsonb
    CHECK (categories = '["profile_facts","job_posting"]'::jsonb),
  approved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at = approved_at + interval '15 minutes'),
  generation_claimed_at timestamptz,
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'running', 'succeeded', 'failed')),
  result_packet_id uuid,
  error_code text CHECK (error_code IN (
    'disclosure_expired', 'generation_unavailable', 'no_confirmed_evidence', 'grounding_failed',
    'render_failed', 'bindings_changed', 'application_changed'
  )),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, owner_user_id),
  FOREIGN KEY (application_id, owner_user_id)
    REFERENCES applications.applications(id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (base_packet_id, application_id, owner_user_id)
    REFERENCES applications.packets(id, application_id, owner_user_id) ON DELETE RESTRICT,
  FOREIGN KEY (result_packet_id, application_id, owner_user_id)
    REFERENCES applications.packets(id, application_id, owner_user_id) ON DELETE RESTRICT,
  CHECK (
    (state = 'queued' AND generation_claimed_at IS NULL AND result_packet_id IS NULL AND error_code IS NULL)
    OR (state = 'running' AND generation_claimed_at IS NOT NULL AND result_packet_id IS NULL AND error_code IS NULL)
    OR (state = 'succeeded' AND generation_claimed_at IS NOT NULL AND result_packet_id IS NOT NULL AND error_code IS NULL)
    OR (state = 'failed' AND result_packet_id IS NULL AND error_code IS NOT NULL)
  ),
  CHECK (approved_at = created_at AND updated_at >= created_at
    AND (generation_claimed_at IS NULL OR generation_claimed_at BETWEEN approved_at AND expires_at))
);
CREATE UNIQUE INDEX packet_preparations_one_active_idx
  ON applications.packet_preparations(application_id) WHERE state IN ('queued', 'running');

CREATE TABLE applications.preparation_outbox (
  id uuid PRIMARY KEY,
  preparation_id uuid NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL,
  FOREIGN KEY (preparation_id, owner_user_id)
    REFERENCES applications.packet_preparations(id, owner_user_id) ON DELETE RESTRICT,
  event_type text NOT NULL DEFAULT 'application.packet-preparation.requested.v1'
    CHECK (event_type = 'application.packet-preparation.requested.v1'),
  payload jsonb NOT NULL CHECK (
    jsonb_typeof(payload) = 'object' AND payload ? 'preparationId'
    AND payload - 'preparationId' = '{}'::jsonb
    AND payload->>'preparationId' = preparation_id::text
  ),
  created_at timestamptz NOT NULL,
  published_at timestamptz
);

CREATE TABLE applications.preparation_audit (
  id uuid PRIMARY KEY,
  preparation_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  FOREIGN KEY (preparation_id, owner_user_id)
    REFERENCES applications.packet_preparations(id, owner_user_id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('queued', 'generation_claimed', 'succeeded', 'failed')),
  occurred_at timestamptz NOT NULL,
  UNIQUE (preparation_id, action)
);

CREATE FUNCTION applications.guard_preparation_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.application_id <> OLD.application_id
    OR NEW.owner_user_id <> OLD.owner_user_id OR NEW.base_packet_id <> OLD.base_packet_id
    OR NEW.expected_revision <> OLD.expected_revision OR NEW.job_context_hash <> OLD.job_context_hash
    OR NEW.confirmed_facts_hash <> OLD.confirmed_facts_hash OR NEW.notice_version <> OLD.notice_version
    OR NEW.provider <> OLD.provider OR NEW.model <> OLD.model OR NEW.purpose <> OLD.purpose
    OR NEW.categories <> OLD.categories OR NEW.approved_at <> OLD.approved_at
    OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at
    OR NEW.updated_at < OLD.updated_at
    OR (OLD.generation_claimed_at IS NOT NULL AND NEW.generation_claimed_at IS DISTINCT FROM OLD.generation_claimed_at)
    OR (OLD.state IN ('succeeded', 'failed') AND NEW IS DISTINCT FROM OLD)
    OR (OLD.state = 'running' AND NEW.state = 'queued') THEN
    RAISE EXCEPTION 'packet preparation identity and terminal state are immutable' USING ERRCODE = '55000';
  END IF;
  IF (OLD.state = 'queued' AND NEW.state = 'succeeded')
    OR (OLD.generation_claimed_at IS NULL AND NEW.generation_claimed_at IS NOT NULL
      AND NEW.state <> 'running') THEN
    RAISE EXCEPTION 'generation requires a separate write-ahead claim' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER packet_preparations_update_guard BEFORE UPDATE ON applications.packet_preparations
  FOR EACH ROW EXECUTE FUNCTION applications.guard_preparation_update();
CREATE TRIGGER packet_preparations_candidate_delete_guard BEFORE DELETE ON applications.packet_preparations
  FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER preparation_outbox_candidate_delete_guard BEFORE DELETE ON applications.preparation_outbox
  FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER preparation_audit_candidate_delete_guard BEFORE DELETE ON applications.preparation_audit
  FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
CREATE TRIGGER preparation_audit_immutable BEFORE UPDATE ON applications.preparation_audit
  FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();

CREATE OR REPLACE FUNCTION applications.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, applications
AS $$
  SELECT jsonb_build_object(
    'applications', jsonb_build_object(
      'schemaVersion', 1,
      'preparations', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', preparation.id, 'applicationId', preparation.application_id,
          'basePacketId', preparation.base_packet_id, 'state', preparation.state,
          'noticeVersion', preparation.notice_version, 'purpose', preparation.purpose,
          'provider', preparation.provider, 'model', preparation.model, 'categories', preparation.categories,
          'approvedAt', preparation.approved_at, 'expiresAt', preparation.expires_at,
          'generationClaimedAt', preparation.generation_claimed_at,
          'resultPacketId', preparation.result_packet_id, 'errorCode', preparation.error_code,
          'createdAt', preparation.created_at, 'updatedAt', preparation.updated_at
        )) ORDER BY preparation.created_at, preparation.id)
        FROM applications.packet_preparations preparation
        WHERE preparation.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'applications', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', application.id, 'canonicalJobId', application.canonical_job_id,
          'status', application.status, 'revision', application.revision,
          'currentPacketId', application.current_packet_id,
          'createdAt', application.created_at, 'updatedAt', application.updated_at
        )) ORDER BY application.created_at, application.id)
        FROM applications.applications application
        WHERE application.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'packets', COALESCE((
        SELECT jsonb_agg(
          jsonb_strip_nulls(jsonb_build_object(
            'id', packet.id, 'applicationId', packet.application_id, 'version', packet.version,
            'packetHash', packet.packet_hash, 'jobRevision', packet.job_revision,
            'formAdapterId', packet.form_adapter_id, 'formVariantId', packet.form_variant_id,
            'formHash', packet.form_hash, 'resumeHash', packet.resume_hash,
            'coverLetterHash', packet.cover_letter_hash, 'createdAt', packet.created_at
          )) || jsonb_build_object('fields', packet.fields)
          ORDER BY packet.application_id, packet.version
        )
        FROM applications.packets packet
        WHERE packet.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'approvals', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', approval.id, 'packetId', approval.packet_id,
          'applicationId', approval.application_id, 'packetHash', approval.packet_hash,
          'acknowledgedFieldKeys', to_jsonb(approval.acknowledged_field_keys),
          'approvedAt', approval.approved_at, 'expiresAt', approval.expires_at,
          'invalidatedAt', approval.invalidated_at,
          'invalidationReason', approval.invalidation_reason
        )) ORDER BY approval.approved_at, approval.id)
        FROM applications.approvals approval
        WHERE approval.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'attempts', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', attempt.id, 'applicationId', attempt.application_id,
          'packetId', attempt.packet_id, 'sequence', attempt.sequence,
          'status', attempt.status, 'adapterId', attempt.adapter_id,
          'adapterVersion', attempt.adapter_version, 'startedAt', attempt.started_at,
          'dispatchedAt', attempt.dispatched_at, 'resolvedAt', attempt.resolved_at,
          'evidenceKind', attempt.evidence_kind,
          'evidenceObservedAt', attempt.evidence_observed_at,
          'evidenceProviderReference', attempt.evidence_provider_reference
        )) ORDER BY attempt.application_id, attempt.sequence)
        FROM applications.attempts attempt
        WHERE attempt.owner_user_id = candidate_user_id
      ), '[]'::jsonb),
      'history', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'applicationId', event.application_id, 'seq', event.seq, 'kind', event.kind,
          'fromStatus', event.from_status, 'toStatus', event.to_status,
          'packetId', event.packet_id, 'attemptId', event.attempt_id,
          'reasonCode', event.reason_code, 'occurredAt', event.occurred_at
        )) ORDER BY event.application_id, event.seq)
        FROM applications.history event
        WHERE event.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'owner', 'applications', 'action', 'applications.' || event.kind,
          'resourceType', 'application', 'resourceId', event.application_id,
          'occurredAt', event.occurred_at
        ) ORDER BY event.occurred_at, event.application_id, event.seq)
        FROM applications.history event
        WHERE event.owner_user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
$$;

-- Children are deleted before their parents; the current-packet reference is deferred, so packets
-- and applications may be removed together inside this one privacy-authorized transaction.
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
  DELETE FROM applications.preparation_outbox WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.preparation_audit WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.packet_preparations WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.outbox WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.command_receipts WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.history WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.attempts WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS attempts_deleted = ROW_COUNT;
  DELETE FROM applications.approvals WHERE owner_user_id = candidate_user_id;
  DELETE FROM applications.packets WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS packets_deleted = ROW_COUNT;
  DELETE FROM applications.applications WHERE owner_user_id = candidate_user_id;
  GET DIAGNOSTICS applications_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'owner', 'applications', 'applicationsDeleted', applications_deleted,
    'packetsDeleted', packets_deleted, 'attemptsDeleted', attempts_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION applications.guard_candidate_delete() FROM PUBLIC;
REVOKE ALL ON FUNCTION applications.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION applications.delete_candidate_data(uuid, uuid) FROM PUBLIC;
