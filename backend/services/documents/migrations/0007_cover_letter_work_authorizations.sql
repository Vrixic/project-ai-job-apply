-- Operational identities only. No prompt, candidate value, credential or provider payload.
-- Deadlines prevent a NEW claim; they never settle already claimed external work.
CREATE TABLE documents.cover_letter_work_authorizations (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents.cover_letters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('private_slots', 'provider_dispatch', 'final_document')),
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  consent_expires_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'issued' CHECK (state IN ('issued', 'running', 'settled', 'revoked')),
  started_at timestamptz,
  terminal_at timestamptz,
  UNIQUE (document_id, purpose),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '90 seconds'
    AND (purpose = 'final_document' OR expires_at <= consent_expires_at)),
  CHECK (started_at IS NULL OR (started_at >= issued_at AND started_at < expires_at)),
  CHECK (terminal_at IS NULL OR terminal_at >= COALESCE(started_at, issued_at)),
  CHECK (
    (state = 'issued' AND started_at IS NULL AND terminal_at IS NULL) OR
    (state = 'running' AND started_at IS NOT NULL AND terminal_at IS NULL) OR
    (state = 'settled' AND started_at IS NOT NULL AND terminal_at IS NOT NULL) OR
    (state = 'revoked' AND started_at IS NULL AND terminal_at IS NOT NULL)
  )
);
CREATE INDEX cover_letter_work_authorizations_owner_document_idx
  ON documents.cover_letter_work_authorizations(user_id, document_id);

CREATE FUNCTION documents.protect_cover_letter_work_authorization()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state NOT IN ('settled', 'revoked') OR EXISTS (
      SELECT 1 FROM documents.cover_letters WHERE id = OLD.document_id
    ) THEN
      RAISE EXCEPTION 'cover-letter work is not settled' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state = 'issued' THEN PERFORM identity.require_active_candidate(NEW.user_id); END IF;
    -- Serialize every phase on the owning document, including direct SQL insertion. Different
    -- phases cannot authorize different requests/consent for the same immutable reservation.
    PERFORM 1 FROM documents.cover_letters WHERE id = NEW.document_id FOR UPDATE;
    IF NEW.state NOT IN ('issued', 'revoked') OR NOT EXISTS (
      SELECT 1 FROM documents.cover_letters
      WHERE id = NEW.document_id AND user_id = NEW.user_id
    ) OR EXISTS (
      SELECT 1 FROM documents.cover_letter_work_authorizations
      WHERE document_id = NEW.document_id AND
        (request_sha256 <> NEW.request_sha256 OR consent_expires_at <> NEW.consent_expires_at)
    ) OR (NEW.state = 'revoked' AND NOT EXISTS (
      SELECT 1 FROM documents.cover_letter_work_authorizations WHERE document_id = NEW.document_id
    )) OR (NEW.state = 'issued' AND NEW.purpose = 'final_document' AND NOT EXISTS (
      SELECT 1 FROM documents.cover_letter_work_authorizations
      WHERE document_id = NEW.document_id AND purpose = 'provider_dispatch' AND state = 'settled'
    )) THEN
      RAISE EXCEPTION 'cover-letter work binding rejected' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW IS NOT DISTINCT FROM OLD THEN RETURN NEW; END IF;
  IF NEW.id <> OLD.id OR NEW.document_id <> OLD.document_id OR NEW.user_id <> OLD.user_id
    OR NEW.purpose <> OLD.purpose OR NEW.request_sha256 <> OLD.request_sha256
    OR NEW.consent_expires_at <> OLD.consent_expires_at
    OR NEW.issued_at <> OLD.issued_at OR NEW.expires_at <> OLD.expires_at
    OR NOT (
      (OLD.state = 'issued' AND NEW.state IN ('running', 'revoked')) OR
      (OLD.state = 'running' AND NEW.state = 'settled' AND NEW.started_at = OLD.started_at)
    ) THEN
    RAISE EXCEPTION 'cover-letter work identity and transitions are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.state = 'issued' AND NEW.state = 'running' THEN
    PERFORM identity.require_active_candidate(NEW.user_id);
    IF clock_timestamp() >= NEW.expires_at THEN
      RAISE EXCEPTION 'cover-letter work authorization expired' USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cover_letter_work_authorizations_protect
BEFORE INSERT OR UPDATE OR DELETE ON documents.cover_letter_work_authorizations
FOR EACH ROW EXECUTE FUNCTION documents.protect_cover_letter_work_authorization();

REVOKE ALL ON FUNCTION documents.protect_cover_letter_work_authorization() FROM PUBLIC;
