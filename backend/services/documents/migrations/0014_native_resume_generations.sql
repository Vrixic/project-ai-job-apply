-- ADR-038: original deterministic generation/task/completion metadata; never generated content.
CREATE TABLE documents.native_resume_generations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  base_document_id uuid NOT NULL REFERENCES documents.resume_documents(id) ON DELETE CASCADE,
  base_version integer NOT NULL CHECK (base_version > 0),
  base_sha256 text NOT NULL CHECK (base_sha256 ~ '^[a-f0-9]{64}$'),
  normalized_sha256 text NOT NULL CHECK (normalized_sha256 ~ '^[a-f0-9]{64}$'),
  job_context_sha256 text NOT NULL CHECK (job_context_sha256 ~ '^[a-f0-9]{64}$'),
  canonical_job_id uuid NOT NULL,
  job_revision text NOT NULL CHECK (job_revision ~ '^[a-f0-9]{64}$'),
  application_revision bigint NOT NULL CHECK (application_revision > 0),
  packet_id uuid NOT NULL,
  packet_hash text NOT NULL CHECK (packet_hash ~ '^[a-f0-9]{64}$'),
  allocation_id uuid NOT NULL UNIQUE,
  epoch_id uuid NOT NULL UNIQUE,
  previous_epoch_id uuid,
  cluster_arn text NOT NULL CHECK (char_length(cluster_arn) BETWEEN 1 AND 512),
  task_definition_arn text NOT NULL CHECK (char_length(task_definition_arn) BETWEEN 1 AND 512),
  container_name text NOT NULL CHECK (container_name ~ '^[A-Za-z0-9_-]{1,255}$'),
  task_arn text UNIQUE CHECK (char_length(task_arn) BETWEEN 1 AND 512),
  launch_claimed_at timestamptz,
  configuration_sha256 text CHECK (configuration_sha256 ~ '^[a-f0-9]{64}$'),
  bound_at timestamptz,
  stopped_at_ms bigint,
  observed_at_ms bigint,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','bound','retired','abandoned')),
  content_sha256 text CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  completed_at_ms bigint,
  expires_at_ms bigint,
  ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (user_id,application_id) REFERENCES documents.native_material_admission(user_id,application_id),
  UNIQUE (user_id,application_id,version),
  CHECK ((launch_claimed_at IS NULL) = (configuration_sha256 IS NULL)),
  CHECK (launch_claimed_at IS NULL OR launch_claimed_at >= created_at),
  CHECK (
    (state='pending' AND task_arn IS NULL AND bound_at IS NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='abandoned' AND task_arn IS NULL AND bound_at IS NULL AND launch_claimed_at IS NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='bound' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND launch_claimed_at IS NOT NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='retired' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND launch_claimed_at IS NOT NULL
      AND stopped_at_ms IS NOT NULL AND observed_at_ms IS NOT NULL AND stopped_at_ms >= floor(extract(epoch FROM created_at)*1000)::bigint AND observed_at_ms >= stopped_at_ms)
  ),
  CHECK (bound_at IS NULL OR bound_at >= launch_claimed_at),
  CHECK ((content_sha256 IS NULL AND completed_at_ms IS NULL AND expires_at_ms IS NULL AND ready_at IS NULL)
    OR (content_sha256 IS NOT NULL AND completed_at_ms IS NOT NULL AND expires_at_ms IS NOT NULL
      AND completed_at_ms >= floor(extract(epoch FROM bound_at)*1000)::bigint AND expires_at_ms=completed_at_ms+1800000)),
  CHECK (ready_at IS NULL OR floor(extract(epoch FROM ready_at)*1000)::bigint BETWEEN completed_at_ms AND expires_at_ms-1)
);
CREATE UNIQUE INDEX native_resume_one_unretired ON documents.native_resume_generations(user_id,application_id) WHERE state NOT IN ('retired','abandoned');

CREATE FUNCTION documents.protect_native_resume_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE head documents.native_material_admission; base documents.resume_documents;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state NOT IN ('retired','abandoned') THEN RAISE EXCEPTION 'native resume retirement required' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO head FROM documents.native_material_admission
    WHERE user_id=NEW.user_id AND application_id=NEW.application_id FOR UPDATE;
  IF TG_OP='INSERT' THEN
    PERFORM identity.require_active_candidate(NEW.user_id);
    SELECT * INTO base FROM documents.resume_documents WHERE id=NEW.base_document_id AND user_id=NEW.user_id FOR SHARE;
    IF head.epoch_id IS DISTINCT FROM NEW.epoch_id OR head.sealed_at IS NOT NULL
      OR NEW.state <> 'pending' OR NEW.launch_claimed_at IS NOT NULL OR NEW.content_sha256 IS NOT NULL
      OR base.id IS NULL OR base.version <> NEW.base_version OR base.sha256 IS DISTINCT FROM NEW.base_sha256
      OR base.normalized_sha256 IS DISTINCT FROM NEW.normalized_sha256 OR base.status <> 'parsed' OR base.deleted_at IS NOT NULL OR base.security_hold
      OR EXISTS (SELECT 1 FROM documents.native_material_allocations WHERE user_id=NEW.user_id AND application_id=NEW.application_id
        AND (state NOT IN ('retired','abandoned') OR epoch_id=NEW.epoch_id)) THEN
      RAISE EXCEPTION 'native resume reservation unavailable' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['task_arn','bound_at','state','stopped_at_ms','observed_at_ms','launch_claimed_at','configuration_sha256','content_sha256','completed_at_ms','expires_at_ms','ready_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['task_arn','bound_at','state','stopped_at_ms','observed_at_ms','launch_claimed_at','configuration_sha256','content_sha256','completed_at_ms','expires_at_ms','ready_at'])
    OR (OLD.state IN ('retired','abandoned') AND NEW IS DISTINCT FROM OLD)
    OR (OLD.task_arn IS NOT NULL AND (NEW.task_arn,NEW.bound_at) IS DISTINCT FROM (OLD.task_arn,OLD.bound_at))
    OR (OLD.launch_claimed_at IS NOT NULL AND (NEW.launch_claimed_at,NEW.configuration_sha256) IS DISTINCT FROM (OLD.launch_claimed_at,OLD.configuration_sha256))
    OR (OLD.content_sha256 IS NOT NULL AND (NEW.content_sha256,NEW.completed_at_ms,NEW.expires_at_ms) IS DISTINCT FROM (OLD.content_sha256,OLD.completed_at_ms,OLD.expires_at_ms))
    OR (OLD.ready_at IS NOT NULL AND NEW.ready_at IS DISTINCT FROM OLD.ready_at)
    OR (NEW.state <> OLD.state AND NOT ((OLD.state='pending' AND NEW.state='bound') OR (OLD.state='bound' AND NEW.state='retired') OR (OLD.state='pending' AND NEW.state='abandoned'))) THEN
    RAISE EXCEPTION 'native resume original metadata immutable' USING ERRCODE='55000';
  END IF;
  IF (OLD.launch_claimed_at IS NULL AND NEW.launch_claimed_at IS NOT NULL)
    OR (OLD.content_sha256 IS NULL AND NEW.content_sha256 IS NOT NULL)
    OR (OLD.ready_at IS NULL AND NEW.ready_at IS NOT NULL) THEN
    PERFORM identity.require_active_candidate(NEW.user_id);
    IF head.epoch_id IS DISTINCT FROM NEW.epoch_id OR head.sealed_at IS NOT NULL OR NEW.state IN ('retired','abandoned')
      OR (NEW.completed_at_ms IS NOT NULL AND (NEW.expires_at_ms <= floor(extract(epoch FROM clock_timestamp())*1000)::bigint
        OR NEW.completed_at_ms > floor(extract(epoch FROM clock_timestamp())*1000)::bigint)) THEN
      RAISE EXCEPTION 'native resume admission sealed or expired' USING ERRCODE='55000';
    END IF;
  END IF;
  IF OLD.content_sha256 IS NULL AND NEW.content_sha256 IS NOT NULL AND NEW.state <> 'bound' THEN
    RAISE EXCEPTION 'native resume original task required' USING ERRCODE='55000';
  END IF;
  IF NEW.state='retired' AND NEW.observed_at_ms > floor(extract(epoch FROM clock_timestamp())*1000)::bigint THEN
    RAISE EXCEPTION 'native resume future retirement rejected' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER native_resume_generation_guard BEFORE INSERT OR UPDATE OR DELETE ON documents.native_resume_generations
FOR EACH ROW EXECUTE FUNCTION documents.protect_native_resume_generation();
REVOKE ALL ON FUNCTION documents.protect_native_resume_generation() FROM PUBLIC;

-- Both material kinds share the same locked application fence, including SQL-only writers.
CREATE FUNCTION documents.guard_cover_letter_resume_exclusion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM documents.native_material_admission WHERE user_id=NEW.user_id AND application_id=NEW.application_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM documents.native_resume_generations WHERE user_id=NEW.user_id AND application_id=NEW.application_id
    AND (state NOT IN ('retired','abandoned') OR epoch_id=NEW.epoch_id)) THEN
    RAISE EXCEPTION 'original native resume allocation remains' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER native_resume_exclusion_guard BEFORE INSERT ON documents.native_material_allocations
FOR EACH ROW EXECUTE FUNCTION documents.guard_cover_letter_resume_exclusion();
REVOKE ALL ON FUNCTION documents.guard_cover_letter_resume_exclusion() FROM PUBLIC;

CREATE FUNCTION documents.guard_resume_admission_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM documents.native_resume_generations WHERE user_id=OLD.user_id AND application_id=OLD.application_id) THEN
      RAISE EXCEPTION 'native resume admission has generations' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.epoch_id <> OLD.epoch_id AND EXISTS (SELECT 1 FROM documents.native_resume_generations
    WHERE user_id=OLD.user_id AND application_id=OLD.application_id AND state NOT IN ('retired','abandoned')) THEN
    RAISE EXCEPTION 'native resume retirement required before reopening' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER native_resume_admission_guard BEFORE UPDATE OR DELETE ON documents.native_material_admission
FOR EACH ROW EXECUTE FUNCTION documents.guard_resume_admission_reopen();
REVOKE ALL ON FUNCTION documents.guard_resume_admission_reopen() FROM PUBLIC;

CREATE OR REPLACE FUNCTION documents.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, documents
AS $$
  SELECT jsonb_build_object(
    'documents', jsonb_build_object(
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

CREATE OR REPLACE FUNCTION documents.delete_candidate_data(
  candidate_user_id uuid,
  candidate_request_id uuid,
  exact_object_inventory_empty boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, documents, privacy
AS $$
DECLARE
  documents_deleted integer;
  audit_deleted integer;
  cover_letters_deleted integer;
BEGIN
  IF NOT privacy.candidate_deletion_authorized(candidate_request_id, candidate_user_id) THEN
    RAISE EXCEPTION 'candidate deletion is not authorized' USING ERRCODE = '42501';
  END IF;
  IF NOT exact_object_inventory_empty THEN
    RAISE EXCEPTION 'candidate document objects remain' USING ERRCODE = '55000';
  END IF;
  DELETE FROM documents.audit_events WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS audit_deleted = ROW_COUNT;
  DELETE FROM documents.idempotency_keys WHERE user_id = candidate_user_id;
  DELETE FROM documents.native_resume_generations WHERE user_id = candidate_user_id;
  DELETE FROM documents.cover_letters WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS cover_letters_deleted = ROW_COUNT;
  DELETE FROM documents.native_material_admission WHERE user_id = candidate_user_id;
  DELETE FROM documents.resume_documents WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS documents_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'owner', 'documents',
    'documentsDeleted', documents_deleted,
    'coverLettersDeleted', cover_letters_deleted,
    'auditEventsDeleted', audit_deleted
  );
END;
$$;


REVOKE ALL ON FUNCTION documents.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.delete_candidate_data(uuid, uuid, boolean) FROM PUBLIC;
