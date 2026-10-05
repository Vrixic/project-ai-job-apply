-- ADR-038/040: native launch intent and positive exact-task retirement metadata only.
-- Nothing here settles provider work, certifies all-copy purge or admits candidate content.
CREATE TABLE documents.native_material_admission (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  epoch_id uuid NOT NULL UNIQUE,
  sealed_at timestamptz,
  minimum_work_issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, application_id),
  CHECK (sealed_at IS NULL OR sealed_at >= created_at),
  CHECK (sealed_at IS NULL OR minimum_work_issued_at = sealed_at)
);

CREATE TABLE documents.native_material_allocations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  application_id uuid NOT NULL,
  epoch_id uuid NOT NULL,
  document_id uuid NOT NULL UNIQUE REFERENCES documents.cover_letters(id) ON DELETE CASCADE,
  work_id uuid NOT NULL UNIQUE REFERENCES documents.cover_letter_work_authorizations(id),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  cluster_arn text NOT NULL CHECK (char_length(cluster_arn) BETWEEN 1 AND 512),
  task_definition_arn text NOT NULL CHECK (char_length(task_definition_arn) BETWEEN 1 AND 512),
  container_name text NOT NULL CHECK (container_name ~ '^[A-Za-z0-9_-]{1,255}$'),
  task_arn text UNIQUE CHECK (char_length(task_arn) BETWEEN 1 AND 512),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'bound', 'retired')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  bound_at timestamptz,
  stopped_at_ms bigint,
  observed_at_ms bigint,
  FOREIGN KEY (user_id, application_id) REFERENCES documents.native_material_admission(user_id, application_id),
  UNIQUE (epoch_id),
  CHECK (
    (state = 'pending' AND task_arn IS NULL AND bound_at IS NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state = 'bound' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state = 'retired' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND stopped_at_ms IS NOT NULL
      AND observed_at_ms IS NOT NULL AND stopped_at_ms >= floor(extract(epoch FROM created_at) * 1000)::bigint
      AND observed_at_ms >= stopped_at_ms)
  ),
  CHECK (bound_at IS NULL OR bound_at >= created_at)
);
CREATE UNIQUE INDEX native_material_one_unretired_allocation
  ON documents.native_material_allocations(user_id, application_id) WHERE state <> 'retired';

CREATE FUNCTION documents.protect_native_material_admission()
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
      WHERE user_id = OLD.user_id AND application_id = OLD.application_id AND state <> 'retired'
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
CREATE TRIGGER native_material_admission_guard BEFORE UPDATE OR DELETE ON documents.native_material_admission
  FOR EACH ROW EXECUTE FUNCTION documents.protect_native_material_admission();

CREATE FUNCTION documents.protect_native_material_allocation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'retired' OR EXISTS (SELECT 1 FROM documents.cover_letters WHERE id = OLD.document_id) THEN
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
    OR (OLD.state = 'retired' AND NEW IS DISTINCT FROM OLD)
    OR (NEW.state <> OLD.state AND NOT ((OLD.state = 'pending' AND NEW.state = 'bound') OR (OLD.state = 'bound' AND NEW.state = 'retired'))) THEN
    RAISE EXCEPTION 'native allocation identity and terminal proof are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER native_material_allocation_guard BEFORE INSERT OR UPDATE OR DELETE ON documents.native_material_allocations
  FOR EACH ROW EXECUTE FUNCTION documents.protect_native_material_allocation();

CREATE FUNCTION documents.guard_native_material_document_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status = 'ready' AND EXISTS (SELECT 1 FROM documents.native_material_allocations WHERE document_id = OLD.id) THEN
      RAISE EXCEPTION 'native material cannot become a saved document' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM documents.native_material_allocations WHERE document_id = OLD.id AND state <> 'retired') THEN
    RAISE EXCEPTION 'native material task retirement is unresolved' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER cover_letters_native_retirement_guard BEFORE UPDATE OR DELETE ON documents.cover_letters
  FOR EACH ROW EXECUTE FUNCTION documents.guard_native_material_document_delete();

CREATE FUNCTION documents.guard_native_material_provider_claim()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Existing cleanup records immutable revoked no-authority tombstones for never-issued
    -- phases. Preserve that fence; only live saved-slot authority is forbidden here.
    IF NEW.purpose <> 'provider_dispatch' AND NEW.state <> 'revoked' AND EXISTS (
      SELECT 1 FROM documents.native_material_allocations WHERE document_id = NEW.document_id
    ) THEN RAISE EXCEPTION 'native material cannot authorize saved slots' USING ERRCODE = '55000'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.purpose = 'provider_dispatch' AND OLD.state = 'issued' AND NEW.state = 'running'
    AND EXISTS (SELECT 1 FROM documents.native_material_allocations WHERE document_id = NEW.document_id) THEN
    -- Hold the admission row through the ORIGINAL work claim transaction. Sealing uses this
    -- same row lock, so a late native startup cannot newly claim work after sealing commits.
    PERFORM 1 FROM documents.native_material_admission h JOIN documents.native_material_allocations a
      ON a.user_id = h.user_id AND a.application_id = h.application_id
      WHERE a.document_id = NEW.document_id AND a.work_id = NEW.id AND a.user_id = NEW.user_id
        AND a.state = 'bound' AND h.epoch_id = a.epoch_id AND h.sealed_at IS NULL FOR UPDATE OF h;
    IF NOT FOUND THEN RAISE EXCEPTION 'native provider admission is closed' USING ERRCODE = '55000'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cover_letter_native_claim_guard BEFORE INSERT OR UPDATE ON documents.cover_letter_work_authorizations
  FOR EACH ROW EXECUTE FUNCTION documents.guard_native_material_provider_claim();

-- Portable technical metadata excludes deployment ARNs, work grants and request digests.
CREATE OR REPLACE FUNCTION documents.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, documents
AS $$
  SELECT jsonb_build_object(
    'documents', jsonb_build_object(
      'nativeMaterialAdmissions', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'applicationId', application_id, 'epochId', epoch_id,
          'sealedAt', sealed_at, 'createdAt', created_at
        )) ORDER BY created_at, application_id)
        FROM documents.native_material_admission WHERE user_id = candidate_user_id
      ), '[]'::jsonb),
      'nativeMaterialAllocations', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', id, 'applicationId', application_id, 'generationId', document_id,
          'epochId', epoch_id, 'state', state, 'createdAt', created_at,
          'boundAt', bound_at, 'stoppedAtEpochMs', stopped_at_ms, 'observedAtEpochMs', observed_at_ms
        )) ORDER BY created_at, id)
        FROM documents.native_material_allocations WHERE user_id = candidate_user_id
      ), '[]'::jsonb),
      'coverLetters', COALESCE((
        SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', id, 'applicationId', application_id, 'version', version, 'status', status,
          'jobRevision', job_revision, 'confirmedFactsHash', confirmed_facts_hash,
          'contentSha256', content_sha256, 'promptVersion', prompt_version,
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


-- Existing privacy authority and provider writer checks remain mandatory.
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
