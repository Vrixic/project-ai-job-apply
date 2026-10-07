-- Scalar grounding only; never generated text, provider output or reusable saved material.
-- Old rows remain NULL. Publish separately AFTER in-memory verification and rendering.
ALTER TABLE documents.cover_letters
  ADD COLUMN material_source_fact_ids uuid[],
  ADD COLUMN material_confidence double precision,
  ADD CONSTRAINT cover_letters_material_ready_ck CHECK (
    (material_source_fact_ids IS NULL AND material_confidence IS NULL)
    OR (material_source_fact_ids IS NOT NULL AND material_confidence IS NOT NULL
      AND material_work_id IS NOT NULL AND status = 'pending'
      AND array_ndims(material_source_fact_ids) = 1
      AND array_lower(material_source_fact_ids, 1) = 1
      AND cardinality(material_source_fact_ids) BETWEEN 1 AND 40
      AND array_position(material_source_fact_ids, NULL) IS NULL
      AND material_confidence > 0 AND material_confidence <= 1)
  );

CREATE FUNCTION documents.protect_native_material_ready()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original documents.cover_letter_work_authorizations%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.material_source_fact_ids IS NOT NULL OR NEW.material_confidence IS NOT NULL THEN
      RAISE EXCEPTION 'native readiness requires original completion' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.material_source_fact_ids, NEW.material_confidence) IS NOT DISTINCT FROM
     (OLD.material_source_fact_ids, OLD.material_confidence) THEN RETURN NEW; END IF;
  IF OLD.material_source_fact_ids IS NOT NULL OR OLD.material_work_id IS NULL
    OR NEW.material_source_fact_ids IS NULL OR NEW.material_confidence IS NULL
    OR (NEW.material_work_id, NEW.material_sha256, NEW.material_completed_at_ms, NEW.material_expires_at_ms)
       IS DISTINCT FROM (OLD.material_work_id, OLD.material_sha256, OLD.material_completed_at_ms, OLD.material_expires_at_ms)
    OR cardinality(NEW.material_source_fact_ids) <> (SELECT count(DISTINCT id) FROM unnest(NEW.material_source_fact_ids) id)
    OR NEW.material_expires_at_ms <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint THEN
    RAISE EXCEPTION 'native readiness binding rejected' USING ERRCODE = '55000';
  END IF;
  PERFORM identity.require_active_candidate(NEW.user_id);
  SELECT * INTO original FROM documents.cover_letter_work_authorizations WHERE id=NEW.material_work_id FOR UPDATE;
  IF original.id IS NULL OR original.document_id <> NEW.id OR original.user_id <> NEW.user_id
    OR original.purpose <> 'provider_dispatch' OR original.state <> 'settled' OR original.provider_failure IS NOT NULL THEN
    RAISE EXCEPTION 'native readiness requires settled original work' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cover_letters_native_ready_guard BEFORE INSERT OR UPDATE ON documents.cover_letters
FOR EACH ROW EXECUTE FUNCTION documents.protect_native_material_ready();
REVOKE ALL ON FUNCTION documents.protect_native_material_ready() FROM PUBLIC;

-- Portability retains scalar original metadata, including expired references; never content.
CREATE OR REPLACE FUNCTION documents.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, documents
AS $$
  SELECT jsonb_build_object(
    'documents', jsonb_build_object(
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
