-- A deleted resume whose native resume generation is bound to a task that no longer exists could never be purged.
--
-- A generation bound to a task settles only by that task's own terminal description (ADR-040), and ECS keeps a stopped
-- task's description for about an hour. A retirement receipt that was not recorded inside that hour is therefore lost for
-- good: the generation stays 'bound', the delete guard (protect_native_resume_generation) refuses the cascade, and the
-- resume's purge fails on every sweep forever. Migration 0020 made that visible; this makes it settle.
--
-- complete_resume_purge takes an optional list of task ARNs the caller has just shown are gone: the caller asked ECS and
-- got no description of the task at all, or got one that says STOPPED. A bound generation of the resume being purged is
-- retired inside the purge transaction only when ALL of these hold for EVERY generation that is still unsettled (all or
-- nothing: if any one is not covered, nothing is written):
--   * its task ARN is on that list, so a task nobody checked is never settled;
--   * a launch was claimed and a task is bound (the shape of a real launch);
--   * its retention ended more than a day ago (a completed generation expires 30 minutes after completion; one that never
--     completed counts from its binding), so ECS had a full day to describe it and an observer to retire it normally;
--   * the resume is tombstoned and past any security-hold window, which the purge has already checked.
-- The row is deleted by the same transaction, so the retirement times written to satisfy the table's checks (both set to
-- now: the task stopped no later than it was found gone) never persist. The only trace is a count in the value-free
-- 'resume.purged' audit metadata. Anything else that is unsettled still returns the typed 0020 result and deletes nothing;
-- that result now also names the task ARNs the caller may check ('proofTasks', for the caller only, never for a log).
--
-- The three-argument function remains and behaves as before for a caller that has no evidence to give.

CREATE OR REPLACE FUNCTION documents.complete_resume_purge(
  candidate_user_id uuid,
  purge_document_id uuid,
  objects_absent boolean,
  absent_task_arns text[]
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
  grace_ms constant bigint := 86400000;
  settled_absent integer := 0;
  unsettled jsonb;
  proof_tasks jsonb;
  uncovered bigint;
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
  -- What the caller's evidence covers: a bound generation with a claimed launch, whose task is on the list, and whose
  -- retention ended more than a day ago. The purge settles by evidence only if the evidence covers EVERY generation that is
  -- still unsettled; otherwise nothing is written, so a generation is never left retired with an invented stop time.
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
         ),
         jsonb_agg(g.task_arn ORDER BY g.id) FILTER (
           WHERE g.state = 'bound'
             AND g.task_arn IS NOT NULL
             AND g.launch_claimed_at IS NOT NULL
             AND COALESCE(g.expires_at_ms, floor(extract(epoch FROM g.bound_at) * 1000)::bigint) < now_ms - grace_ms
         ),
         count(*) FILTER (
           WHERE NOT (
             g.state = 'bound'
             AND g.task_arn IS NOT NULL
             AND g.launch_claimed_at IS NOT NULL
             AND g.task_arn = ANY (COALESCE(absent_task_arns, ARRAY[]::text[]))
             AND COALESCE(g.expires_at_ms, floor(extract(epoch FROM g.bound_at) * 1000)::bigint) < now_ms - grace_ms
           )
         )
    INTO unsettled, proof_tasks, uncovered
    FROM documents.native_resume_generations g
    WHERE g.user_id = candidate_user_id
      AND g.base_document_id = purge_document_id
      AND g.state NOT IN ('retired', 'abandoned', 'launch_rejected');
  IF unsettled IS NOT NULL AND uncovered > 0 THEN
    RETURN jsonb_build_object(
      'purged', false,
      'reason', 'native_generation_unsettled',
      'unsettled', unsettled,
      'proofTasks', COALESCE(proof_tasks, '[]'::jsonb)
    );
  END IF;
  IF unsettled IS NOT NULL THEN
    -- Every unsettled generation is covered. The rows are deleted by this same transaction, so the retirement times
    -- written to satisfy the table's checks (both now: the task stopped no later than it was found gone) never persist.
    UPDATE documents.native_resume_generations g
      SET state = 'retired', stopped_at_ms = now_ms, observed_at_ms = now_ms
      WHERE g.user_id = candidate_user_id
        AND g.base_document_id = purge_document_id
        AND g.state = 'bound'
        AND g.task_arn = ANY (COALESCE(absent_task_arns, ARRAY[]::text[]));
    GET DIAGNOSTICS settled_absent = ROW_COUNT;
  END IF;
  -- The stored upload response names the document and carries its file name. A response written as a JSON string
  -- (older clients) is unwrapped before the lookup.
  DELETE FROM documents.idempotency_keys
    WHERE user_id = candidate_user_id
      AND (CASE WHEN jsonb_typeof(response) = 'string' THEN (response #>> '{}')::jsonb ELSE response END)
            -> 'document' ->> 'id' = purge_document_id::text;
  GET DIAGNOSTICS keys_deleted = ROW_COUNT;
  -- Receipts, dispositions and the generations settled above go with the row (ON DELETE CASCADE).
  DELETE FROM documents.resume_documents WHERE id = purge_document_id AND user_id = candidate_user_id;
  INSERT INTO documents.audit_events (id, user_id, action, document_id, trace_id, metadata)
  VALUES (gen_random_uuid(), candidate_user_id, 'resume.purged', purge_document_id, 'resume-purge',
          CASE
            WHEN settled_absent > 0
              THEN jsonb_build_object('version', 1, 'nativeGenerationsSettledTaskAbsent', settled_absent)
            ELSE jsonb_build_object('version', 1)
          END);
  RETURN jsonb_build_object('purged', true, 'idempotencyKeysDeleted', keys_deleted)
    || CASE
         WHEN settled_absent > 0 THEN jsonb_build_object('nativeGenerationsSettledTaskAbsent', settled_absent)
         ELSE '{}'::jsonb
       END;
END;
$$;

REVOKE ALL ON FUNCTION documents.complete_resume_purge(uuid, uuid, boolean, text[]) FROM PUBLIC;

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
BEGIN
  RETURN documents.complete_resume_purge(candidate_user_id, purge_document_id, objects_absent, ARRAY[]::text[]);
END;
$$;

REVOKE ALL ON FUNCTION documents.complete_resume_purge(uuid, uuid, boolean) FROM PUBLIC;
