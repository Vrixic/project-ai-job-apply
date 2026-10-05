-- ADR-038: original scalar metadata only. No content, timestamp backfill or saved-draft recovery.
ALTER TABLE applications.approvals DROP CONSTRAINT approvals_invalidation_reason_check;
ALTER TABLE applications.approvals ADD CONSTRAINT approvals_invalidation_reason_check CHECK (
  invalidation_reason IN (
    'packet_hash_mismatch', 'approval_expired', 'job_changed', 'form_changed',
    'resume_changed', 'cover_letter_changed', 'superseded', 'attempt_requires_review',
    'cancelled', 'vault_answer_changed', 'temporary_material_expired', 'temporary_material_changed'
  )
);
CREATE FUNCTION applications.valid_temporary_material_bindings(
  materials jsonb, candidate uuid, application uuid, resume_hash text, cover_letter_hash text,
  packet_created_at timestamptz
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  reference jsonb;
  keys text[];
  kinds text[] := ARRAY[]::text[];
  kind text;
  completion numeric;
  expiry numeric;
  revision numeric;
BEGIN
  IF materials IS NULL OR jsonb_typeof(materials) <> 'array' OR jsonb_array_length(materials) > 2 THEN
    RETURN false;
  END IF;
  FOR reference IN SELECT value FROM jsonb_array_elements(materials) LOOP
    IF jsonb_typeof(reference) <> 'object' THEN RETURN false; END IF;
    SELECT array_agg(key ORDER BY key) INTO keys FROM jsonb_object_keys(reference) AS key;
    IF keys IS DISTINCT FROM ARRAY['applicationId','completedAtMs','contentSha256','expiresAtMs',
      'generationId','kind','ownerUserId','schemaVersion','version']::text[] THEN RETURN false; END IF;
    IF jsonb_typeof(reference->'schemaVersion') <> 'number' OR reference->>'schemaVersion' <> '1'
      OR jsonb_typeof(reference->'kind') <> 'string'
      OR jsonb_typeof(reference->'generationId') <> 'string'
      OR jsonb_typeof(reference->'ownerUserId') <> 'string'
      OR jsonb_typeof(reference->'applicationId') <> 'string'
      OR jsonb_typeof(reference->'contentSha256') <> 'string'
      OR jsonb_typeof(reference->'completedAtMs') <> 'number'
      OR jsonb_typeof(reference->'expiresAtMs') <> 'number'
      OR jsonb_typeof(reference->'version') <> 'number' THEN RETURN false; END IF;
    kind := reference->>'kind';
    IF kind NOT IN ('cover_letter', 'tailored_resume') OR kind = ANY(kinds)
      OR reference->>'ownerUserId' <> candidate::text
      OR reference->>'applicationId' <> application::text
      OR reference->>'generationId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
      OR reference->>'contentSha256' !~ '^[a-f0-9]{64}$'
      OR reference->>'contentSha256' IS DISTINCT FROM
        (CASE WHEN kind = 'cover_letter' THEN cover_letter_hash ELSE resume_hash END) THEN RETURN false; END IF;
    kinds := array_append(kinds, kind);
    completion := (reference->>'completedAtMs')::numeric;
    expiry := (reference->>'expiresAtMs')::numeric;
    revision := (reference->>'version')::numeric;
    IF revision < 1 OR revision > 9007199254740991 OR revision <> trunc(revision)
      OR completion < 0 OR completion > 8639999998200000 OR completion <> trunc(completion)
      OR expiry <> completion + 1800000
      OR completion > floor(extract(epoch FROM packet_created_at) * 1000)
      OR expiry <= floor(extract(epoch FROM packet_created_at) * 1000) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION applications.valid_temporary_material_bindings(jsonb, uuid, uuid, text, text, timestamptz) FROM PUBLIC;

ALTER TABLE applications.packets ADD COLUMN temporary_materials jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE applications.packets ADD CONSTRAINT packets_temporary_materials_ck CHECK (
  applications.valid_temporary_material_bindings(temporary_materials, owner_user_id, application_id,
    resume_hash, cover_letter_hash, created_at)
);

CREATE FUNCTION applications.protect_temporary_material_packet_edit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous jsonb;
  original jsonb;
  replacement jsonb;
  bound_hash text;
BEGIN
  IF NOT applications.valid_temporary_material_bindings(NEW.temporary_materials, NEW.owner_user_id,
    NEW.application_id, NEW.resume_hash, NEW.cover_letter_hash, NEW.created_at) THEN
    RAISE EXCEPTION 'temporary material packet binding rejected' USING ERRCODE = '55000';
  END IF;
  -- Serialize on the application even for direct insertion, without reading another owner.
  PERFORM 1 FROM applications.applications WHERE id = NEW.application_id
    AND owner_user_id = NEW.owner_user_id FOR UPDATE;
  SELECT packet.temporary_materials INTO previous FROM applications.applications AS application
    JOIN applications.packets AS packet ON packet.id = application.current_packet_id
    WHERE application.id = NEW.application_id AND application.owner_user_id = NEW.owner_user_id;
  FOR original IN SELECT value FROM jsonb_array_elements(COALESCE(previous, '[]'::jsonb)) LOOP
    bound_hash := CASE WHEN original->>'kind' = 'cover_letter' THEN NEW.cover_letter_hash ELSE NEW.resume_hash END;
    IF bound_hash IS NULL THEN CONTINUE; END IF;
    SELECT value INTO replacement FROM jsonb_array_elements(NEW.temporary_materials)
      WHERE value->>'kind' = original->>'kind';
    IF replacement IS NULL OR (replacement->>'generationId' = original->>'generationId' AND (
      replacement->'completedAtMs' IS DISTINCT FROM original->'completedAtMs'
      OR replacement->'expiresAtMs' IS DISTINCT FROM original->'expiresAtMs'
      OR (replacement->>'version')::numeric < (original->>'version')::numeric
      OR (replacement->'version' = original->'version' AND replacement->'contentSha256' IS DISTINCT FROM original->'contentSha256')
    )) THEN
      RAISE EXCEPTION 'temporary material replacement binding rejected' USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER packets_temporary_material_edit BEFORE INSERT ON applications.packets
FOR EACH ROW EXECUTE FUNCTION applications.protect_temporary_material_packet_edit();
REVOKE ALL ON FUNCTION applications.protect_temporary_material_packet_edit() FROM PUBLIC;

-- Only new approval/dispatch authority is checked. Confirmation and ambiguous-submission
-- reconciliation retain their original technical evidence after material expiry.
CREATE FUNCTION applications.protect_temporary_material_admission()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reference jsonb;
  deadline numeric;
  server_now_ms numeric;
BEGIN
  IF TG_TABLE_NAME = 'attempts' THEN
    IF NEW.status NOT IN ('started','dispatched') THEN
      IF TG_OP <> 'INSERT' OR NEW.status <> 'taken_over' THEN RETURN NEW; END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN
      IF NEW.status = OLD.status THEN RETURN NEW; END IF;
    END IF;
  END IF;
  server_now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000);
  FOR reference IN SELECT value FROM applications.packets,
    LATERAL jsonb_array_elements(temporary_materials)
    WHERE id = NEW.packet_id AND application_id = NEW.application_id AND owner_user_id = NEW.owner_user_id
  LOOP
    deadline := (reference->>'expiresAtMs')::numeric;
    IF server_now_ms < (reference->>'completedAtMs')::numeric OR server_now_ms >= deadline THEN
      RAISE EXCEPTION 'temporary material admission unavailable' USING ERRCODE = '55000';
    END IF;
    IF TG_TABLE_NAME = 'approvals' THEN
      IF floor(extract(epoch FROM NEW.approved_at) * 1000) < (reference->>'completedAtMs')::numeric
        OR extract(epoch FROM NEW.expires_at) * 1000 > deadline THEN
        RAISE EXCEPTION 'temporary material admission unavailable' USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER approvals_temporary_material_admission BEFORE INSERT ON applications.approvals
FOR EACH ROW EXECUTE FUNCTION applications.protect_temporary_material_admission();
CREATE TRIGGER attempts_temporary_material_admission BEFORE INSERT OR UPDATE ON applications.attempts
FOR EACH ROW EXECUTE FUNCTION applications.protect_temporary_material_admission();
REVOKE ALL ON FUNCTION applications.protect_temporary_material_admission() FROM PUBLIC;

-- Portable metadata omits internal ownership IDs and never carries generated content.
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
          )) || jsonb_build_object('fields', packet.fields) ||
          CASE WHEN jsonb_array_length(packet.temporary_materials) = 0 THEN '{}'::jsonb ELSE
            jsonb_build_object('temporaryMaterials', (
              SELECT jsonb_agg(reference - 'ownerUserId' - 'applicationId' ORDER BY reference->>'kind')
              FROM jsonb_array_elements(packet.temporary_materials) AS reference
            )) END
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
