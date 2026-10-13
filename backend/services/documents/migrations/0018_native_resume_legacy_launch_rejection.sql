-- Separate immutable proof for legacy claims; never backfill the absent original request digest.
ALTER TABLE documents.native_resume_generations
  ADD COLUMN legacy_launch_rejection_evidence_sha256 text CHECK (legacy_launch_rejection_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT native_resume_legacy_rejection_evidence_ck CHECK (
    legacy_launch_rejection_evidence_sha256 IS NULL
    OR (state='launch_rejected' AND launch_request_sha256 IS NULL)
  ),
  DROP CONSTRAINT native_resume_generation_state_shape_ck;
ALTER TABLE documents.native_resume_generations ADD CONSTRAINT native_resume_generation_state_shape_ck
CHECK (
    (state='pending' AND task_arn IS NULL AND bound_at IS NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='launch_rejected' AND task_arn IS NULL AND bound_at IS NULL AND launch_claimed_at IS NOT NULL
      AND ((launch_request_sha256 IS NOT NULL AND legacy_launch_rejection_evidence_sha256 IS NULL)
        OR (launch_request_sha256 IS NULL AND legacy_launch_rejection_evidence_sha256 IS NOT NULL))
      AND launch_rejection_request_id IS NOT NULL AND launch_rejected_at IS NOT NULL
      AND stopped_at_ms IS NULL AND observed_at_ms IS NULL AND content_sha256 IS NULL)
    OR (state='abandoned' AND task_arn IS NULL AND bound_at IS NULL AND launch_claimed_at IS NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='bound' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND launch_claimed_at IS NOT NULL AND stopped_at_ms IS NULL AND observed_at_ms IS NULL)
    OR (state='retired' AND task_arn IS NOT NULL AND bound_at IS NOT NULL AND launch_claimed_at IS NOT NULL
      AND stopped_at_ms IS NOT NULL AND observed_at_ms IS NOT NULL AND stopped_at_ms >= floor(extract(epoch FROM created_at)*1000)::bigint AND observed_at_ms >= stopped_at_ms)
  );

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
      OR NEW.legacy_launch_rejection_evidence_sha256 IS NOT NULL
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
    OR ((NEW.launch_rejection_request_id,NEW.launch_rejected_at,NEW.legacy_launch_rejection_evidence_sha256)
      IS DISTINCT FROM (OLD.launch_rejection_request_id,OLD.launch_rejected_at,OLD.legacy_launch_rejection_evidence_sha256)
      AND NOT (OLD.state='pending' AND NEW.state='launch_rejected' AND OLD.launch_claimed_at IS NOT NULL
        AND OLD.task_arn IS NULL AND OLD.content_sha256 IS NULL
        AND ((OLD.launch_request_sha256 IS NOT NULL AND OLD.legacy_launch_rejection_evidence_sha256 IS NULL
            AND NEW.legacy_launch_rejection_evidence_sha256 IS NULL)
          OR (OLD.launch_request_sha256 IS NULL AND OLD.legacy_launch_rejection_evidence_sha256 IS NULL
            AND NEW.legacy_launch_rejection_evidence_sha256 IS NOT NULL
            AND head.epoch_id=NEW.epoch_id AND head.sealed_at IS NOT NULL))))
    OR (NEW.state='launch_rejected' AND NEW.launch_rejected_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'native resume rejection metadata immutable' USING ERRCODE='55000';
  END IF;
  IF NEW.observation_attempted_at IS DISTINCT FROM OLD.observation_attempted_at AND (
    OLD.state <> 'bound' OR NEW.state <> 'bound' OR NEW.observation_attempted_at IS NULL
    OR NEW.observation_attempted_at > clock_timestamp()
    OR NEW.observation_attempted_at < COALESCE(OLD.observation_attempted_at, OLD.bound_at)
  ) THEN RAISE EXCEPTION 'native resume observation timestamp rejected' USING ERRCODE='55000'; END IF;
  IF (to_jsonb(NEW) - ARRAY['legacy_launch_rejection_evidence_sha256','launch_request_sha256','launch_rejection_request_id','launch_rejected_at','observation_attempted_at','task_arn','bound_at','state','stopped_at_ms','observed_at_ms','launch_claimed_at','configuration_sha256','content_sha256','completed_at_ms','expires_at_ms','ready_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['legacy_launch_rejection_evidence_sha256','launch_request_sha256','launch_rejection_request_id','launch_rejected_at','observation_attempted_at','task_arn','bound_at','state','stopped_at_ms','observed_at_ms','launch_claimed_at','configuration_sha256','content_sha256','completed_at_ms','expires_at_ms','ready_at'])
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
