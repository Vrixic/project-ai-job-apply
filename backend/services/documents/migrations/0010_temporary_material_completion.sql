-- ADR-038: minimal ORIGINAL completion metadata only. No content or saved-draft recovery.
-- Existing rows remain NULL; no timestamp/hash backfill and no retention-policy waiver.
ALTER TABLE documents.cover_letters
  ADD COLUMN material_work_id uuid REFERENCES documents.cover_letter_work_authorizations(id),
  ADD COLUMN material_sha256 text,
  ADD COLUMN material_completed_at_ms bigint,
  ADD COLUMN material_expires_at_ms bigint,
  ADD CONSTRAINT cover_letters_temporary_material_ck CHECK (
    (material_work_id IS NULL AND material_sha256 IS NULL
      AND material_completed_at_ms IS NULL AND material_expires_at_ms IS NULL)
    OR
    (material_work_id IS NOT NULL AND material_sha256 IS NOT NULL
      AND material_completed_at_ms IS NOT NULL AND material_expires_at_ms IS NOT NULL
      AND material_sha256 ~ '^[a-f0-9]{64}$'
      AND material_completed_at_ms BETWEEN 0 AND 8639999998200000
      AND material_expires_at_ms = material_completed_at_ms + 1800000
      AND status = 'pending' AND object_version IS NULL AND object_sha256 IS NULL
      AND content_sha256 IS NULL AND size_bytes IS NULL AND prompt_version IS NULL)
  );

CREATE FUNCTION documents.protect_temporary_material_completion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original documents.cover_letter_work_authorizations%ROWTYPE;
  server_now_ms bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.material_work_id IS NOT NULL OR NEW.material_sha256 IS NOT NULL
      OR NEW.material_completed_at_ms IS NOT NULL OR NEW.material_expires_at_ms IS NOT NULL THEN
      RAISE EXCEPTION 'temporary material requires original completion' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW.material_work_id, NEW.material_sha256, NEW.material_completed_at_ms, NEW.material_expires_at_ms)
    IS NOT DISTINCT FROM
    (OLD.material_work_id, OLD.material_sha256, OLD.material_completed_at_ms, OLD.material_expires_at_ms) THEN
    RETURN NEW;
  END IF;
  IF OLD.material_work_id IS NOT NULL OR NEW.material_work_id IS NULL
    OR NEW.material_sha256 IS NULL OR NEW.material_completed_at_ms IS NULL
    OR NEW.material_expires_at_ms IS NULL OR OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'temporary material completion is immutable' USING ERRCODE = '55000';
  END IF;
  PERFORM identity.require_active_candidate(NEW.user_id);
  SELECT * INTO original FROM documents.cover_letter_work_authorizations
    WHERE id = NEW.material_work_id FOR UPDATE;
  server_now_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF original.id IS NULL OR original.document_id <> NEW.id OR original.user_id <> NEW.user_id
    OR original.purpose <> 'provider_dispatch' OR original.state NOT IN ('running', 'settled')
    OR original.started_at IS NULL OR original.provider_failure IS NOT NULL
    OR NEW.material_completed_at_ms < floor(extract(epoch FROM original.started_at) * 1000)::bigint
    OR NEW.material_completed_at_ms > server_now_ms OR server_now_ms >= NEW.material_expires_at_ms
    OR EXISTS (SELECT 1 FROM documents.cover_letter_work_authorizations
      WHERE document_id = NEW.id AND purpose = 'final_document') THEN
    RAISE EXCEPTION 'temporary material original binding rejected' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cover_letters_temporary_material_protect
BEFORE INSERT OR UPDATE ON documents.cover_letters
FOR EACH ROW EXECUTE FUNCTION documents.protect_temporary_material_completion();
REVOKE ALL ON FUNCTION documents.protect_temporary_material_completion() FROM PUBLIC;

-- A memory-only completion must never acquire the legacy saved-object final writer afterward.
CREATE FUNCTION documents.reject_temporary_material_final_writer()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.purpose = 'final_document' AND NEW.state <> 'revoked' AND EXISTS (
    SELECT 1 FROM documents.cover_letters WHERE id = NEW.document_id AND material_work_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'temporary material has no saved final writer' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cover_letter_work_temporary_material_protect
BEFORE INSERT ON documents.cover_letter_work_authorizations
FOR EACH ROW EXECUTE FUNCTION documents.reject_temporary_material_final_writer();
REVOKE ALL ON FUNCTION documents.reject_temporary_material_final_writer() FROM PUBLIC;
