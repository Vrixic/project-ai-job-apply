-- Immutable, one-attempt native launch authority. A crash/unknown ACK never permits RunTask again.
-- Original allocation/task retirement and provider work settlement stay independent.
ALTER TABLE documents.native_material_allocations
  ADD COLUMN launch_claimed_at timestamptz,
  ADD COLUMN launch_configuration_sha256 text,
  ADD CONSTRAINT native_material_launch_claim_ck CHECK (
    (launch_claimed_at IS NULL AND launch_configuration_sha256 IS NULL)
    OR (launch_claimed_at IS NOT NULL AND launch_claimed_at >= created_at
      AND launch_configuration_sha256 IS NOT NULL AND launch_configuration_sha256 ~ '^[a-f0-9]{64}$')
  );

CREATE FUNCTION documents.protect_native_material_launch_claim()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.launch_claimed_at IS NOT NULL OR NEW.launch_configuration_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'native launch requires separate admission' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.launch_claimed_at IS NOT NULL THEN
    IF NEW.launch_claimed_at IS DISTINCT FROM OLD.launch_claimed_at
      OR NEW.launch_configuration_sha256 IS DISTINCT FROM OLD.launch_configuration_sha256 THEN
      RAISE EXCEPTION 'native launch claim is immutable' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.launch_claimed_at IS NOT NULL THEN
    PERFORM identity.require_active_candidate(NEW.user_id);
    PERFORM 1 FROM documents.native_material_admission h
      WHERE h.user_id = NEW.user_id AND h.application_id = NEW.application_id
        AND h.epoch_id = NEW.epoch_id AND h.sealed_at IS NULL FOR UPDATE;
    IF NOT FOUND OR OLD.state <> 'pending' OR NEW.state <> 'pending' OR NOT EXISTS (
      SELECT 1 FROM documents.cover_letter_work_authorizations w
      JOIN documents.cover_letters d ON d.id = w.document_id AND d.user_id = w.user_id
      WHERE w.id = NEW.work_id AND w.document_id = NEW.document_id AND w.user_id = NEW.user_id
        AND w.purpose = 'provider_dispatch' AND w.request_sha256 = NEW.request_sha256
        AND w.state = 'issued' AND clock_timestamp() < w.expires_at
        AND clock_timestamp() < w.consent_expires_at AND d.status = 'pending'
        AND d.material_work_id IS NULL
    ) THEN RAISE EXCEPTION 'native launch claim unavailable' USING ERRCODE = '55000'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER native_material_launch_claim_guard BEFORE INSERT OR UPDATE
  ON documents.native_material_allocations FOR EACH ROW
  EXECUTE FUNCTION documents.protect_native_material_launch_claim();
