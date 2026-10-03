-- Identifier-only inventory, reserved before a single original background creation.
-- No response payload, prompt, candidate value, credential or timeout-based settlement.
CREATE TABLE documents.cover_letter_provider_responses (
  work_id uuid PRIMARY KEY REFERENCES documents.cover_letter_work_authorizations(id) ON DELETE CASCADE,
  document_id uuid NOT NULL,
  user_id uuid NOT NULL,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'acknowledged', 'disposed')),
  response_id text UNIQUE CHECK (response_id ~ '^resp_[a-zA-Z0-9]{1,128}$'),
  response_created_at bigint CHECK (response_created_at BETWEEN 1 AND 9007199254740991),
  acknowledged_at timestamptz,
  disposed_at timestamptz,
  terminal_status text CHECK (terminal_status IN ('completed', 'cancelled', 'failed', 'incomplete')),
  CHECK (
    (state = 'reserved' AND response_id IS NULL AND response_created_at IS NULL
      AND acknowledged_at IS NULL AND disposed_at IS NULL AND terminal_status IS NULL) OR
    (state = 'acknowledged' AND response_id IS NOT NULL AND response_created_at IS NOT NULL
      AND acknowledged_at IS NOT NULL AND acknowledged_at >= reserved_at AND disposed_at IS NULL AND terminal_status IS NULL) OR
    (state = 'disposed' AND response_id IS NOT NULL AND response_created_at IS NOT NULL
      AND acknowledged_at IS NOT NULL AND disposed_at IS NOT NULL
      AND acknowledged_at >= reserved_at AND disposed_at >= acknowledged_at AND terminal_status IS NOT NULL)
  )
);
CREATE INDEX cover_letter_provider_responses_owner_document_idx
  ON documents.cover_letter_provider_responses(user_id, document_id);

CREATE FUNCTION documents.protect_cover_letter_provider_response()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  original documents.cover_letter_work_authorizations%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state <> 'disposed' OR EXISTS (
      SELECT 1 FROM documents.cover_letters WHERE id = OLD.document_id
    ) THEN
      RAISE EXCEPTION 'provider response disposal is not acknowledged' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Identity-first lock order, matching original admission and quarantine/deletion.
    PERFORM identity.require_active_candidate(NEW.user_id);
  END IF;
  SELECT * INTO original FROM documents.cover_letter_work_authorizations
    WHERE id = NEW.work_id FOR UPDATE;
  IF NOT FOUND OR original.purpose <> 'provider_dispatch'
    OR original.document_id <> NEW.document_id OR original.user_id <> NEW.user_id
    OR original.request_sha256 <> NEW.request_sha256
    OR original.state NOT IN ('running', 'settled') THEN
    RAISE EXCEPTION 'provider response work binding rejected' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'reserved' OR original.state <> 'running'
      OR NEW.reserved_at < original.started_at
      OR NEW.reserved_at > clock_timestamp()
      OR clock_timestamp() >= original.expires_at
      OR clock_timestamp() >= original.consent_expires_at THEN
      RAISE EXCEPTION 'provider response reservation rejected' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NEW.acknowledged_at > clock_timestamp() OR NEW.disposed_at > clock_timestamp() THEN
    RAISE EXCEPTION 'provider response acknowledgement is in the future' USING ERRCODE = '55000';
  END IF;
  IF NEW.work_id <> OLD.work_id OR NEW.document_id <> OLD.document_id
    OR NEW.user_id <> OLD.user_id OR NEW.request_sha256 <> OLD.request_sha256
    OR NEW.reserved_at <> OLD.reserved_at
    OR NOT (
      (OLD.state = 'reserved' AND NEW.state = 'acknowledged') OR
      (OLD.state = 'acknowledged' AND NEW.state = 'disposed'
        AND NEW.response_id = OLD.response_id AND NEW.response_created_at = OLD.response_created_at
        AND NEW.acknowledged_at = OLD.acknowledged_at)
    ) THEN
    RAISE EXCEPTION 'provider response identity and transitions are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cover_letter_provider_responses_protect
BEFORE INSERT OR UPDATE OR DELETE ON documents.cover_letter_provider_responses
FOR EACH ROW EXECUTE FUNCTION documents.protect_cover_letter_provider_response();
REVOKE ALL ON FUNCTION documents.protect_cover_letter_provider_response() FROM PUBLIC;
