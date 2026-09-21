-- Byte purge of deleted resumes (D3-027, ADR-034).
--
-- Deletion (0004) leaves a tombstone. These two owner-defined functions let the candidate-rights maintenance runtime finish
-- the job without touching Documents tables directly: one names the tombstones that are ready to purge, the other removes a
-- tombstone's row, idempotency entries (which store the file name), receipts, and dispositions once the caller attests that
-- every stored object under the document's prefixes is gone.

ALTER TABLE documents.audit_events
  DROP CONSTRAINT IF EXISTS audit_events_action_check;
ALTER TABLE documents.audit_events
  ADD CONSTRAINT audit_events_action_check CHECK (
    action IN (
      'resume.upload.registered',
      'resume.scan.recorded',
      'resume.parse.started',
      'resume.parse.completed',
      'resume.processing.rejected',
      'resume.processing.failed',
      'resume.processing.contradiction',
      'resume.deleted',
      'resume.purged'
    )
  );

-- A resume that a malware scan held keeps its bytes as evidence for this long after the candidate deleted it.
CREATE OR REPLACE FUNCTION documents.security_hold_evidence_window()
RETURNS interval
LANGUAGE sql
IMMUTABLE
AS $$ SELECT interval '30 days' $$;

-- Identifiers only: which tombstones the sweep may work on now, oldest first, and how many are still waiting out a hold.
CREATE OR REPLACE FUNCTION documents.pending_resume_purges(batch_limit integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, documents
AS $$
DECLARE
  eligible jsonb;
  held_waiting integer;
BEGIN
  IF batch_limit IS NULL OR batch_limit < 1 OR batch_limit > 100 THEN
    RAISE EXCEPTION 'resume purge batch limit must be between 1 and 100' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('userId', user_id, 'documentId', id) ORDER BY deleted_at, id), '[]'::jsonb)
    INTO eligible
    FROM (
      SELECT user_id, id, deleted_at
      FROM documents.resume_documents
      WHERE deleted_at IS NOT NULL
        AND (NOT security_hold OR deleted_at <= now() - documents.security_hold_evidence_window())
      ORDER BY deleted_at, id
      LIMIT batch_limit
    ) AS due;
  SELECT count(*)::integer INTO held_waiting
    FROM documents.resume_documents
    WHERE deleted_at IS NOT NULL
      AND security_hold
      AND deleted_at > now() - documents.security_hold_evidence_window();
  RETURN jsonb_build_object('eligible', eligible, 'heldWaiting', held_waiting);
END;
$$;

CREATE OR REPLACE FUNCTION documents.complete_resume_purge(
  candidate_user_id uuid,
  purge_document_id uuid,
  objects_absent boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, documents
AS $$
DECLARE
  tombstone record;
  keys_deleted integer;
BEGIN
  IF objects_absent IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'resume document objects remain' USING ERRCODE = '55000';
  END IF;
  -- The same per-candidate lock registration and deletion take, so a purge orders against an upload for this candidate.
  PERFORM pg_advisory_xact_lock(hashtext(candidate_user_id::text || ':documents.resume-slot'));
  SELECT id, deleted_at, security_hold INTO tombstone
    FROM documents.resume_documents
    WHERE id = purge_document_id AND user_id = candidate_user_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'absent');
  END IF;
  IF tombstone.deleted_at IS NULL THEN
    RAISE EXCEPTION 'resume is not deleted' USING ERRCODE = '55000';
  END IF;
  IF tombstone.security_hold AND tombstone.deleted_at > now() - documents.security_hold_evidence_window() THEN
    RAISE EXCEPTION 'resume is within its security-hold evidence window' USING ERRCODE = '55000';
  END IF;
  -- The stored upload response names the document and carries its file name. A response written as a JSON string
  -- (older clients) is unwrapped before the lookup.
  DELETE FROM documents.idempotency_keys
    WHERE user_id = candidate_user_id
      AND (CASE WHEN jsonb_typeof(response) = 'string' THEN (response #>> '{}')::jsonb ELSE response END)
            -> 'document' ->> 'id' = purge_document_id::text;
  GET DIAGNOSTICS keys_deleted = ROW_COUNT;
  -- Receipts and dispositions go with the row (ON DELETE CASCADE).
  DELETE FROM documents.resume_documents WHERE id = purge_document_id AND user_id = candidate_user_id;
  INSERT INTO documents.audit_events (id, user_id, action, document_id, trace_id, metadata)
  VALUES (gen_random_uuid(), candidate_user_id, 'resume.purged', purge_document_id, 'resume-purge',
          jsonb_build_object('version', 1));
  RETURN jsonb_build_object('purged', true, 'idempotencyKeysDeleted', keys_deleted);
END;
$$;

REVOKE ALL ON FUNCTION documents.security_hold_evidence_window() FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.pending_resume_purges(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION documents.complete_resume_purge(uuid, uuid, boolean) FROM PUBLIC;
