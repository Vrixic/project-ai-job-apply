-- Cover-letter text lives only in encrypted object storage. Reserve the exact key BEFORE I/O
-- so privacy deletion also inventories abandoned/ambiguous writes. No prompts or draft text in SQL.
CREATE TABLE documents.cover_letters (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  application_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  job_revision text NOT NULL CHECK (job_revision ~ '^[a-f0-9]{64}$'),
  confirmed_facts_hash text NOT NULL CHECK (confirmed_facts_hash ~ '^[a-f0-9]{64}$'),
  object_key text NOT NULL UNIQUE CHECK (
    object_key = 'normalized/' || id::text || '/cover-letter.v1.json'
  ),
  object_version text CHECK (char_length(object_version) BETWEEN 1 AND 1024),
  object_sha256 text CHECK (object_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes integer CHECK (size_bytes BETWEEN 1 AND 32768),
  prompt_version text CHECK (char_length(prompt_version) BETWEEN 1 AND 64),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, application_id, version),
  CHECK (
    (status = 'ready' AND object_version IS NOT NULL AND object_sha256 IS NOT NULL
      AND content_sha256 IS NOT NULL AND size_bytes IS NOT NULL AND prompt_version IS NOT NULL)
    OR
    (status = 'pending' AND object_version IS NULL AND object_sha256 IS NULL
      AND content_sha256 IS NULL AND size_bytes IS NULL AND prompt_version IS NULL)
  )
);
CREATE INDEX cover_letters_owner_application_hash_idx
  ON documents.cover_letters(user_id, application_id, content_sha256);

CREATE FUNCTION documents.protect_cover_letter_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.status = 'ready' AND NEW IS DISTINCT FROM OLD)
    OR NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id
    OR NEW.application_id <> OLD.application_id OR NEW.version <> OLD.version
    OR NEW.job_revision <> OLD.job_revision OR NEW.confirmed_facts_hash <> OLD.confirmed_facts_hash
    OR NEW.object_key <> OLD.object_key OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'cover-letter identity and ready content are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cover_letters_protect_identity
BEFORE UPDATE ON documents.cover_letters
FOR EACH ROW EXECUTE FUNCTION documents.protect_cover_letter_identity();

ALTER TABLE documents.audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE documents.audit_events ADD CONSTRAINT audit_events_action_check CHECK (
  action IN (
    'resume.upload.registered', 'resume.scan.recorded', 'resume.parse.started',
    'resume.parse.completed', 'resume.processing.rejected', 'resume.processing.failed',
    'resume.processing.contradiction', 'resume.deleted', 'resume.purged',
    'cover_letter.reserved', 'cover_letter.ready'
  )
);

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

CREATE OR REPLACE FUNCTION documents.candidate_object_inventory(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, documents
AS $$
  SELECT (SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'documentId', id,
    'sourceObjectKey', source_object_key,
    'sourceObjectVersion', source_object_version,
    'normalizedObjectKey', normalized_object_key,
    'normalizedObjectVersion', normalized_object_version
  )) ORDER BY created_at, id), '[]'::jsonb)
  FROM documents.resume_documents
  WHERE user_id = candidate_user_id) || (SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'documentId', id, 'sourceObjectKey', object_key, 'sourceObjectVersion', object_version
  )) ORDER BY created_at, id), '[]'::jsonb)
  FROM documents.cover_letters WHERE user_id = candidate_user_id)
$$;

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
REVOKE ALL ON FUNCTION documents.candidate_object_inventory(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.delete_candidate_data(uuid, uuid, boolean) FROM PUBLIC;
