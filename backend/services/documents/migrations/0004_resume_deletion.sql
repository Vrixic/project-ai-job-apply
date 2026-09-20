-- Candidate-initiated resume deletion (D3-026, ADR-033).
--
-- A deleted resume is a tombstone: the row, its object keys and its versions stay so the exact
-- object inventory used by candidate data deletion (0003) still names every stored object until a
-- separate purge removes the bytes. Deleting hides the resume from the candidate, frees the plan
-- slot, and makes it unusable for tailoring; it never changes processing state.
ALTER TABLE documents.resume_documents
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Only a resume whose processing has ended can be deleted, so a late scan or parse result can
-- never land on a row the candidate already removed.
ALTER TABLE documents.resume_documents
  DROP CONSTRAINT IF EXISTS resume_documents_deleted_terminal_check;
ALTER TABLE documents.resume_documents
  ADD CONSTRAINT resume_documents_deleted_terminal_check CHECK (
    deleted_at IS NULL OR status IN ('parsed', 'rejected', 'failed')
  );

-- A deletion is permanent: it cannot be cleared or moved, so no path can quietly un-delete a
-- resume whose bytes may already have been purged.
CREATE OR REPLACE FUNCTION documents.protect_resume_identity_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id <> OLD.id
    OR NEW.user_id <> OLD.user_id
    OR NEW.version <> OLD.version
    OR NEW.file_name <> OLD.file_name
    OR NEW.media_type <> OLD.media_type
    OR NEW.size_bytes <> OLD.size_bytes
    OR NEW.sha256 <> OLD.sha256
    OR NEW.source_object_key <> OLD.source_object_key
    OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'resume identity fields are immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    RAISE EXCEPTION 'a deleted resume cannot be restored' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

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
      'resume.deleted'
    )
  );
