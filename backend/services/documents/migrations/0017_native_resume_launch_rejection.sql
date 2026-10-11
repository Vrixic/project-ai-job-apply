-- Scalar rejection metadata only. Legacy claimed rows keep a null request digest and stay unresolved.
ALTER TABLE documents.native_resume_generations
  ADD COLUMN launch_request_sha256 text CHECK (launch_request_sha256 ~ '^[a-f0-9]{64}$'),
  ADD COLUMN launch_rejection_request_id uuid,
  ADD COLUMN launch_rejected_at timestamptz,
  DROP CONSTRAINT native_resume_generations_state_check,
  ADD CONSTRAINT native_resume_generations_state_check
    CHECK (state IN ('pending','bound','retired','abandoned','launch_rejected')),
  ADD CONSTRAINT native_resume_launch_request_ck CHECK (launch_request_sha256 IS NULL OR launch_claimed_at IS NOT NULL),
  ADD CONSTRAINT native_resume_launch_rejection_ck CHECK (
    (state='launch_rejected' AND launch_rejected_at >= launch_claimed_at AND launch_rejection_request_id IS NOT NULL)
    OR (state<>'launch_rejected' AND launch_rejected_at IS NULL AND launch_rejection_request_id IS NULL)
  );
-- The original state-shape constraint was unnamed. Resolve exactly one by its bound-task columns.
DO $$
DECLARE names text[];
BEGIN
  SELECT array_agg(conname::text) INTO names FROM pg_constraint
    WHERE conrelid='documents.native_resume_generations'::regclass AND contype='c'
      AND pg_get_constraintdef(oid) LIKE '%state%'
      AND pg_get_constraintdef(oid) LIKE '%bound_at%';
  IF cardinality(names) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'native resume state constraint ambiguous'; END IF;
  EXECUTE format('ALTER TABLE documents.native_resume_generations DROP CONSTRAINT %I', names[1]);
END;
$$;
ALTER TABLE documents.native_resume_generations ADD CONSTRAINT native_resume_generation_state_shape_ck
CHECK (
    (state='pending' AND task_arn IS NULL AND bound_at IS NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='launch_rejected' AND task_arn IS NULL AND bound_at IS NULL AND launch_claimed_at IS NOT NULL
      AND launch_request_sha256 IS NOT NULL AND launch_rejection_request_id IS NOT NULL AND launch_rejected_at IS NOT NULL
      AND stopped_at_ms IS NULL AND observed_at_ms IS NULL AND content_sha256 IS NULL)
    OR (state='abandoned' AND task_arn IS NULL AND bound_at IS NULL AND launch_claimed_at IS NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='bound' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND launch_claimed_at IS NOT NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='retired' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND launch_claimed_at IS NOT NULL
      AND stopped_at_ms IS NOT NULL AND observed_at_ms IS NOT NULL AND stopped_at_ms >= floor(extract(epoch FROM created_at)*1000)::bigint AND observed_at_ms >= stopped_at_ms)
  );
DROP INDEX documents.native_resume_one_unretired;
CREATE UNIQUE INDEX native_resume_one_unretired ON documents.native_resume_generations(user_id,application_id)
  WHERE state NOT IN ('retired','abandoned','launch_rejected');

CREATE OR REPLACE FUNCTION documents.protect_native_resume_generation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE head documents.native_material_admission; base documents.resume_documents;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state NOT IN ('retired','abandoned','launch_rejected') THEN RAISE EXCEPTION 'native resume retirement required' USING ERRCODE='55000'; END IF;
    RETURN OLD;
  END IF;
  SELECT * INTO head FROM documents.native_material_admission
    WHERE user_id=NEW.user_id AND application_id=NEW.application_id FOR UPDATE;
  IF TG_OP='INSERT' THEN
    PERFORM identity.require_active_candidate(NEW.user_id);
    SELECT * INTO base FROM documents.resume_documents WHERE id=NEW.base_document_id AND user_id=NEW.user_id FOR SHARE;
    IF head.epoch_id IS DISTINCT FROM NEW.epoch_id OR head.sealed_at IS NOT NULL
      OR NEW.launch_request_sha256 IS NOT NULL OR NEW.launch_rejection_request_id IS NOT NULL OR NEW.launch_rejected_at IS NOT NULL
      OR EXISTS (SELECT 1 FROM documents.native_resume_generations WHERE user_id=NEW.user_id AND application_id=NEW.application_id
        AND epoch_id=NEW.epoch_id AND state='launch_rejected')
      OR NEW.observation_attempted_at IS NOT NULL OR NEW.state <> 'pending' OR NEW.launch_claimed_at IS NOT NULL OR NEW.content_sha256 IS NOT NULL
      OR base.id IS NULL OR base.version <> NEW.base_version OR base.sha256 IS DISTINCT FROM NEW.base_sha256
      OR base.normalized_sha256 IS DISTINCT FROM NEW.normalized_sha256 OR base.status <> 'parsed' OR base.deleted_at IS NOT NULL OR base.security_hold
      OR EXISTS (SELECT 1 FROM documents.native_material_allocations WHERE user_id=NEW.user_id AND application_id=NEW.application_id
        AND (state NOT IN ('retired','abandoned') OR epoch_id=NEW.epoch_id)) THEN
      RAISE EXCEPTION 'native resume reservation unavailable' USING ERRCODE='55000';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.launch_claimed_at IS NOT NULL AND NEW.launch_request_sha256 IS DISTINCT FROM OLD.launch_request_sha256)
    OR (OLD.launch_claimed_at IS NULL AND NEW.launch_request_sha256 IS NOT NULL AND NEW.launch_claimed_at IS NULL)
    OR ((NEW.launch_rejection_request_id,NEW.launch_rejected_at) IS DISTINCT FROM (OLD.launch_rejection_request_id,OLD.launch_rejected_at)
      AND NOT (OLD.state='pending' AND NEW.state='launch_rejected' AND OLD.launch_claimed_at IS NOT NULL
        AND OLD.launch_request_sha256 IS NOT NULL AND OLD.task_arn IS NULL AND OLD.content_sha256 IS NULL))
    OR (NEW.state='launch_rejected' AND NEW.launch_rejected_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'native resume rejection metadata immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.observation_attempted_at IS DISTINCT FROM OLD.observation_attempted_at AND (
    OLD.state <> 'bound' OR NEW.state <> 'bound' OR NEW.observation_attempted_at IS NULL
    OR NEW.observation_attempted_at > clock_timestamp()
    OR NEW.observation_attempted_at < COALESCE(OLD.observation_attempted_at, OLD.bound_at)
  ) THEN RAISE EXCEPTION 'native resume observation timestamp rejected' USING ERRCODE='55000'; END IF;
  IF (to_jsonb(NEW) - ARRAY['launch_request_sha256','launch_rejection_request_id','launch_rejected_at','observation_attempted_at','task_arn','bound_at','state','stopped_at_ms','observed_at_ms','launch_claimed_at','configuration_sha256','content_sha256','completed_at_ms','expires_at_ms','ready_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['launch_request_sha256','launch_rejection_request_id','launch_rejected_at','observation_attempted_at','task_arn','bound_at','state','stopped_at_ms','observed_at_ms','launch_claimed_at','configuration_sha256','content_sha256','completed_at_ms','expires_at_ms','ready_at'])
    OR (OLD.state IN ('retired','abandoned','launch_rejected') AND NEW IS DISTINCT FROM OLD)
    OR (OLD.task_arn IS NOT NULL AND (NEW.task_arn,NEW.bound_at) IS DISTINCT FROM (OLD.task_arn,OLD.bound_at))
    OR (OLD.launch_claimed_at IS NOT NULL AND (NEW.launch_claimed_at,NEW.configuration_sha256) IS DISTINCT FROM (OLD.launch_claimed_at,OLD.configuration_sha256))
    OR (OLD.content_sha256 IS NOT NULL AND (NEW.content_sha256,NEW.completed_at_ms,NEW.expires_at_ms) IS DISTINCT FROM (OLD.content_sha256,OLD.completed_at_ms,OLD.expires_at_ms))
    OR (OLD.ready_at IS NOT NULL AND NEW.ready_at IS DISTINCT FROM OLD.ready_at)
    OR (NEW.state <> OLD.state AND NOT ((OLD.state='pending' AND NEW.state='bound') OR (OLD.state='bound' AND NEW.state='retired') OR (OLD.state='pending' AND NEW.state='abandoned') OR (OLD.state='pending' AND NEW.state='launch_rejected'))) THEN
    RAISE EXCEPTION 'native resume original metadata immutable' USING ERRCODE='55000';
  END IF;
  IF (OLD.launch_claimed_at IS NULL AND NEW.launch_claimed_at IS NOT NULL)
    OR (OLD.content_sha256 IS NULL AND NEW.content_sha256 IS NOT NULL)
    OR (OLD.ready_at IS NULL AND NEW.ready_at IS NOT NULL) THEN
    PERFORM identity.require_active_candidate(NEW.user_id);
    IF head.epoch_id IS DISTINCT FROM NEW.epoch_id OR head.sealed_at IS NOT NULL OR NEW.state IN ('retired','abandoned','launch_rejected')
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


CREATE OR REPLACE FUNCTION documents.guard_cover_letter_resume_exclusion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM documents.native_material_admission WHERE user_id=NEW.user_id AND application_id=NEW.application_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM documents.native_resume_generations WHERE user_id=NEW.user_id AND application_id=NEW.application_id
    AND (state NOT IN ('retired','abandoned','launch_rejected') OR epoch_id=NEW.epoch_id)) THEN
    RAISE EXCEPTION 'original native resume allocation remains' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION documents.guard_resume_admission_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM documents.native_resume_generations WHERE user_id=OLD.user_id AND application_id=OLD.application_id) THEN
      RAISE EXCEPTION 'native resume admission has generations' USING ERRCODE='55000';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.epoch_id <> OLD.epoch_id AND EXISTS (SELECT 1 FROM documents.native_resume_generations
    WHERE user_id=OLD.user_id AND application_id=OLD.application_id AND state NOT IN ('retired','abandoned','launch_rejected')) THEN
    RAISE EXCEPTION 'native resume retirement required before reopening' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
