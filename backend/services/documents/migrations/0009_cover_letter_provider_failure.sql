-- Value-free proof from the original provider actor only. Existing rows stay unclassified.
-- Expiry, pending slots, quarantine and generic maintenance fences are not failure receipts.
ALTER TABLE documents.cover_letter_work_authorizations
  ADD COLUMN provider_failure text,
  ADD CONSTRAINT cover_letter_provider_failure_valid CHECK (
    provider_failure IS NULL OR (
      purpose = 'provider_dispatch' AND state = 'settled'
      AND provider_failure IN ('output_rejected', 'not_dispatched', 'failed', 'cancelled', 'incomplete')
    )
  );

-- Preserve the existing identity/transition trigger unchanged. Failure proof may be written
-- only with the original running-to-settled transition; never retrofit old NULL settlements.
CREATE FUNCTION documents.protect_cover_letter_provider_failure()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.provider_failure IS NOT NULL THEN
      RAISE EXCEPTION 'provider failure requires original settlement' USING ERRCODE = '55000';
    END IF;
  ELSIF NEW.provider_failure IS DISTINCT FROM OLD.provider_failure THEN
    IF OLD.provider_failure IS NOT NULL OR OLD.state <> 'running' OR NEW.state <> 'settled'
      OR OLD.purpose <> 'provider_dispatch' OR NEW.provider_failure IS NULL THEN
      RAISE EXCEPTION 'provider failure proof is immutable' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cover_letter_provider_failure_protect
BEFORE INSERT OR UPDATE ON documents.cover_letter_work_authorizations
FOR EACH ROW EXECUTE FUNCTION documents.protect_cover_letter_provider_failure();
REVOKE ALL ON FUNCTION documents.protect_cover_letter_provider_failure() FROM PUBLIC;
