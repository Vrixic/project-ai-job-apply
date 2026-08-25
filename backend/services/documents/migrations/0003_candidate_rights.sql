CREATE OR REPLACE FUNCTION documents.export_candidate_data(candidate_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, documents
AS $$
  SELECT jsonb_build_object(
    'documents', jsonb_build_object(
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
          'owner', 'documents', 'action', action, 'resourceType', 'resume_document',
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
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'documentId', id,
    'sourceObjectKey', source_object_key,
    'sourceObjectVersion', source_object_version,
    'normalizedObjectKey', normalized_object_key,
    'normalizedObjectVersion', normalized_object_version
  )) ORDER BY created_at, id), '[]'::jsonb)
  FROM documents.resume_documents
  WHERE user_id = candidate_user_id
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
  DELETE FROM documents.resume_documents WHERE user_id = candidate_user_id;
  GET DIAGNOSTICS documents_deleted = ROW_COUNT;
  RETURN jsonb_build_object(
    'owner', 'documents',
    'documentsDeleted', documents_deleted,
    'auditEventsDeleted', audit_deleted
  );
END;
$$;

REVOKE ALL ON FUNCTION documents.export_candidate_data(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.candidate_object_inventory(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.delete_candidate_data(uuid, uuid, boolean) FROM PUBLIC;
