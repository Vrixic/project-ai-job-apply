-- A deleted resume whose native resume generation is not settled could never be purged, and nothing said why.
--
-- The purge deletes the tombstoned resume row, which cascades to the generations built from it, and the guard on
-- those generations (protect_native_resume_generation) refuses to delete one that is not retired, abandoned or
-- launch-rejected. The refusal reached the sweep as a bare SQLSTATE 55000 at the last step, every sweep, forever.
--
-- complete_resume_purge now looks first:
--   * a generation that is still pending with no launch claim and no task never started anything. The table already
--     allows pending -> abandoned for exactly that row, and the resume it was built from is deleted, so it is abandoned
--     here and no longer blocks the purge;
--   * any other unsettled generation (a launch was claimed, or a task is bound) cannot be settled from SQL: its task
--     is the only proof, and a task that no longer exists stays unknown by design. The function then returns a typed,
--     non-throwing result naming only states and booleans, never an identifier, so the sweep can say what blocks it.
-- Nothing is deleted when anything remains unsettled, and the sweep still counts it as a failure, so the alarm stays.

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
  now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  unsettled jsonb;
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
  -- Settle what is provably safe, then report what is not.
  UPDATE documents.native_resume_generations
    SET state = 'abandoned'
    WHERE user_id = candidate_user_id
      AND base_document_id = purge_document_id
      AND state = 'pending'
      AND task_arn IS NULL
      AND launch_claimed_at IS NULL;
  SELECT jsonb_agg(
           jsonb_build_object(
             'state', g.state,
             'hasTask', g.task_arn IS NOT NULL,
             'launchClaimed', g.launch_claimed_at IS NOT NULL,
             'expired', g.expires_at_ms IS NOT NULL AND g.expires_at_ms < now_ms,
             'overdueHours', CASE
               WHEN g.expires_at_ms IS NOT NULL AND g.expires_at_ms < now_ms
                 THEN ((now_ms - g.expires_at_ms) / 3600000)::integer
             END
           )
           ORDER BY g.id
         )
    INTO unsettled
    FROM documents.native_resume_generations g
    WHERE g.user_id = candidate_user_id
      AND g.base_document_id = purge_document_id
      AND g.state NOT IN ('retired', 'abandoned', 'launch_rejected');
  IF unsettled IS NOT NULL THEN
    RETURN jsonb_build_object('purged', false, 'reason', 'native_generation_unsettled', 'unsettled', unsettled);
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

REVOKE ALL ON FUNCTION documents.complete_resume_purge(uuid, uuid, boolean) FROM PUBLIC;
