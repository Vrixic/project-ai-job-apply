-- Positive never-launched cancellation is distinct from observed task retirement.
-- Existing claims, task identity and terminal receipts remain immutable. No content is added.
ALTER TABLE documents.native_material_allocations
  DROP CONSTRAINT native_material_allocations_state_check,
  DROP CONSTRAINT native_material_allocations_check,
  ADD CONSTRAINT native_material_allocations_state_check CHECK (state IN ('pending','bound','retired','abandoned')),
  ADD CONSTRAINT native_material_allocations_check CHECK (
    (state='pending' AND task_arn IS NULL AND bound_at IS NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='abandoned' AND task_arn IS NULL AND bound_at IS NULL AND launch_claimed_at IS NULL
      AND launch_configuration_sha256 IS NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='bound' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='retired' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND stopped_at_ms IS NOT NULL
      AND observed_at_ms IS NOT NULL AND stopped_at_ms >= floor(extract(epoch FROM created_at)*1000)::bigint
      AND observed_at_ms >= stopped_at_ms)
  );
DROP INDEX documents.native_material_one_unretired_allocation;
CREATE UNIQUE INDEX native_material_one_unretired_allocation
  ON documents.native_material_allocations(user_id,application_id) WHERE state NOT IN ('retired','abandoned');

CREATE OR REPLACE FUNCTION documents.protect_native_material_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state NOT IN ('retired','abandoned') OR EXISTS (SELECT 1 FROM documents.cover_letters WHERE id = OLD.document_id) THEN
      RAISE EXCEPTION 'native allocation is not retired' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM identity.require_active_candidate(NEW.user_id);
    PERFORM 1 FROM documents.native_material_admission
      WHERE user_id = NEW.user_id AND application_id = NEW.application_id AND epoch_id = NEW.epoch_id
        AND sealed_at IS NULL FOR UPDATE;
    IF NOT FOUND OR NEW.state <> 'pending' OR NOT EXISTS (
      SELECT 1 FROM documents.cover_letters d JOIN documents.cover_letter_work_authorizations w
        ON w.document_id = d.id AND w.user_id = d.user_id
      WHERE d.id = NEW.document_id AND d.user_id = NEW.user_id AND d.application_id = NEW.application_id
        AND d.status = 'pending' AND d.material_work_id IS NULL AND w.id = NEW.work_id
        AND w.purpose = 'provider_dispatch' AND w.state = 'issued' AND w.request_sha256 = NEW.request_sha256
        AND clock_timestamp() < w.expires_at AND clock_timestamp() < w.consent_expires_at
        AND NOT EXISTS (SELECT 1 FROM documents.native_material_admission h
          WHERE h.user_id = NEW.user_id AND h.application_id = NEW.application_id
            AND h.minimum_work_issued_at IS NOT NULL AND w.issued_at <= h.minimum_work_issued_at)
        AND NOT EXISTS (SELECT 1 FROM documents.cover_letter_work_authorizations prior_work
          WHERE prior_work.document_id = d.id AND prior_work.purpose IN ('private_slots', 'final_document'))
    ) THEN RAISE EXCEPTION 'native launch intent is unavailable' USING ERRCODE = '55000'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.application_id <> OLD.application_id
    OR NEW.epoch_id <> OLD.epoch_id OR NEW.document_id <> OLD.document_id OR NEW.work_id <> OLD.work_id
    OR NEW.request_sha256 <> OLD.request_sha256 OR NEW.cluster_arn <> OLD.cluster_arn
    OR NEW.task_definition_arn <> OLD.task_definition_arn OR NEW.container_name <> OLD.container_name
    OR NEW.created_at <> OLD.created_at OR (OLD.task_arn IS NOT NULL AND NEW.task_arn IS DISTINCT FROM OLD.task_arn)
    OR (OLD.bound_at IS NOT NULL AND NEW.bound_at IS DISTINCT FROM OLD.bound_at)
    OR (OLD.state IN ('retired','abandoned') AND NEW IS DISTINCT FROM OLD)
    OR (NEW.state <> OLD.state AND NOT ((OLD.state = 'pending' AND NEW.state = 'bound') OR (OLD.state = 'bound' AND NEW.state = 'retired') OR (OLD.state = 'pending' AND NEW.state = 'abandoned'))) THEN
    RAISE EXCEPTION 'native allocation identity and terminal proof are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.state = 'abandoned' THEN
    PERFORM 1 FROM documents.native_material_admission
      WHERE user_id=NEW.user_id AND application_id=NEW.application_id
        AND epoch_id=NEW.epoch_id AND sealed_at IS NOT NULL FOR UPDATE;
    IF NOT FOUND OR OLD.launch_claimed_at IS NOT NULL OR NEW.launch_claimed_at IS NOT NULL THEN
      RAISE EXCEPTION 'native no-launch cancellation unavailable' USING ERRCODE='55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION documents.protect_native_material_admission()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM documents.native_material_allocations
      WHERE user_id = OLD.user_id AND application_id = OLD.application_id) THEN
      RAISE EXCEPTION 'native admission still has allocations' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.user_id <> OLD.user_id OR NEW.application_id <> OLD.application_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'native admission identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.epoch_id <> OLD.epoch_id THEN
    PERFORM identity.require_active_candidate(NEW.user_id);
    IF OLD.sealed_at IS NULL OR NEW.sealed_at IS NOT NULL OR EXISTS (
      SELECT 1 FROM documents.native_material_allocations
      WHERE user_id = OLD.user_id AND application_id = OLD.application_id AND state NOT IN ('retired','abandoned')
    ) THEN RAISE EXCEPTION 'native admission cannot reopen' USING ERRCODE = '55000'; END IF;
  ELSIF OLD.sealed_at IS NOT NULL AND NEW.sealed_at IS DISTINCT FROM OLD.sealed_at THEN
    RAISE EXCEPTION 'native admission seal is immutable' USING ERRCODE = '55000';
  END IF;
  IF (OLD.minimum_work_issued_at IS NOT NULL AND (NEW.minimum_work_issued_at IS NULL
      OR NEW.minimum_work_issued_at < OLD.minimum_work_issued_at))
    OR (NEW.epoch_id <> OLD.epoch_id AND NEW.minimum_work_issued_at IS DISTINCT FROM OLD.minimum_work_issued_at) THEN
    RAISE EXCEPTION 'native fresh-work barrier is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION documents.guard_native_material_document_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'ready' AND EXISTS (SELECT 1 FROM documents.native_material_allocations WHERE document_id = OLD.id) THEN
      RAISE EXCEPTION 'native material cannot become a saved document' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM documents.native_material_allocations WHERE document_id = OLD.id AND state NOT IN ('retired','abandoned')) THEN
    RAISE EXCEPTION 'native material task retirement is unresolved' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

-- Preserve both allocation and generation portability metadata.
CREATE OR REPLACE FUNCTION documents.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, documents
AS $$
  SELECT jsonb_build_object(
    'documents', jsonb_build_object(
      'nativeMaterialAllocations', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', id, 'applicationId', application_id, 'generationId', document_id,
          'epochId', epoch_id, 'state', state, 'createdAt', created_at,
          'boundAt', bound_at, 'stoppedAtEpochMs', stopped_at_ms, 'observedAtEpochMs', observed_at_ms
        )) ORDER BY created_at, id)
        FROM documents.native_material_allocations WHERE user_id = candidate_user_id
      ), '[]'::jsonb),
      'nativeResumeGenerations', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id',id,'applicationId',application_id,'version',version,'baseDocumentId',base_document_id,
          'baseVersion',base_version,'baseSha256',base_sha256,'jobContextSha256',job_context_sha256,
          'state',state,'createdAt',created_at,'completedAtMs',completed_at_ms,'expiresAtMs',expires_at_ms,
          'contentSha256',content_sha256,'readyAt',ready_at
        )) ORDER BY created_at,id) FROM documents.native_resume_generations WHERE user_id=candidate_user_id
      ), '[]'::jsonb),
      'coverLetters', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', id, 'applicationId', application_id, 'version', version, 'status', status,
          'jobRevision', job_revision, 'confirmedFactsHash', confirmed_facts_hash,
          'contentSha256', content_sha256, 'promptVersion', prompt_version,
          'nativeReady', CASE WHEN material_source_fact_ids IS NOT NULL THEN jsonb_build_object(
            'schemaVersion', 1, 'sourceFactIds', material_source_fact_ids, 'confidence', material_confidence,
            'material', jsonb_build_object('schemaVersion', 1, 'kind', 'cover_letter',
              'generationId', id, 'ownerUserId', user_id, 'applicationId', application_id,
              'version', version, 'contentSha256', material_sha256,
              'completedAtMs', material_completed_at_ms, 'expiresAtMs', material_expires_at_ms)
          ) END,
          'model', CASE WHEN status = 'ready' THEN jsonb_build_object(
            'provider', 'openai', 'model', 'gpt-6-luna', 'version', 'gpt-6-luna'
          ) END, 'createdAt', created_at
        )) ORDER BY created_at, id)
        FROM documents.cover_letters WHERE user_id = candidate_user_id
      ), '[]'::jsonb),
      'resumes', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', id, 'fileName', file_name, 'mediaType', media_type,
          'sizeBytes', size_bytes, 'sha256', sha256, 'status', status,
          'failureCode', failure_code, 'pageCount', page_count,
          'characterCount', character_count, 'createdAt', created_at, 'updatedAt', updated_at
        )) ORDER BY created_at, id)
        FROM documents.resume_documents WHERE user_id = candidate_user_id
      ), '[]'::jsonb)
    ),
    'audit', jsonb_build_object(
      'events', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'owner', 'documents', 'action', action, 'resourceType', CASE WHEN action LIKE 'cover_letter.%' THEN 'cover_letter' ELSE 'resume_document' END,
          'resourceId', document_id, 'occurredAt', created_at
        ) ORDER BY created_at, id)
        FROM documents.audit_events WHERE user_id = candidate_user_id
      ), '[]'::jsonb)
    )
  )
$$;
REVOKE ALL ON FUNCTION documents.export_candidate_data(uuid) FROM PUBLIC;
