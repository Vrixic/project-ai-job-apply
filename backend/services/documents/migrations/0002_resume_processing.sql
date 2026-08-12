ALTER TABLE documents.resume_documents
  ADD COLUMN IF NOT EXISTS scan_result text,
  ADD COLUMN IF NOT EXISTS parser_version text,
  ADD COLUMN IF NOT EXISTS normalized_sha256 text,
  ADD COLUMN IF NOT EXISTS security_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

ALTER TABLE documents.resume_documents
  DROP CONSTRAINT IF EXISTS resume_documents_scan_result_check;
ALTER TABLE documents.resume_documents
  ADD CONSTRAINT resume_documents_scan_result_check CHECK (
    scan_result IS NULL OR scan_result IN (
      'NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED'
    )
  );
ALTER TABLE documents.resume_documents
  DROP CONSTRAINT IF EXISTS resume_documents_parser_version_check;
ALTER TABLE documents.resume_documents
  ADD CONSTRAINT resume_documents_parser_version_check CHECK (
    parser_version IS NULL OR char_length(parser_version) BETWEEN 1 AND 64
  );
ALTER TABLE documents.resume_documents
  DROP CONSTRAINT IF EXISTS resume_documents_normalized_sha256_check;
ALTER TABLE documents.resume_documents
  ADD CONSTRAINT resume_documents_normalized_sha256_check CHECK (
    normalized_sha256 IS NULL OR normalized_sha256 ~ '^[a-f0-9]{64}$'
  );

ALTER TABLE documents.processing_receipts
  ADD COLUMN IF NOT EXISTS scan_status text,
  ADD COLUMN IF NOT EXISTS scan_result text,
  ADD COLUMN IF NOT EXISTS observed_at timestamptz;
ALTER TABLE documents.processing_receipts
  DROP CONSTRAINT IF EXISTS processing_receipts_scan_status_check;
ALTER TABLE documents.processing_receipts
  ADD CONSTRAINT processing_receipts_scan_status_check CHECK (
    scan_status IS NULL OR scan_status IN ('COMPLETED', 'FAILED', 'SKIPPED')
  );
ALTER TABLE documents.processing_receipts
  DROP CONSTRAINT IF EXISTS processing_receipts_scan_result_check;
ALTER TABLE documents.processing_receipts
  ADD CONSTRAINT processing_receipts_scan_result_check CHECK (
    scan_result IS NULL OR scan_result IN (
      'NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED'
    )
  );

CREATE TABLE IF NOT EXISTS documents.processing_dispositions (
  document_id uuid NOT NULL REFERENCES documents.resume_documents(id) ON DELETE CASCADE,
  source_object_version text NOT NULL CHECK (char_length(source_object_version) BETWEEN 1 AND 1024),
  scan_status text NOT NULL CHECK (scan_status IN ('COMPLETED', 'FAILED', 'SKIPPED')),
  scan_result text NOT NULL CHECK (
    scan_result IN (
      'NO_THREATS_FOUND', 'THREATS_FOUND', 'UNSUPPORTED', 'ACCESS_DENIED', 'FAILED'
    )
  ),
  first_event_id text NOT NULL CHECK (char_length(first_event_id) BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, source_object_version)
);

CREATE OR REPLACE FUNCTION documents.enforce_resume_state_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'awaiting_upload' AND NEW.status IN ('scanning', 'rejected', 'failed'))
    OR (OLD.status = 'scanning' AND NEW.status IN ('parsing', 'rejected', 'failed'))
    OR (OLD.status = 'parsing' AND NEW.status IN ('parsed', 'rejected', 'failed'))
    OR (NEW.status = 'failed' AND NEW.security_hold AND NOT OLD.security_hold)
  ) THEN
    RAISE EXCEPTION 'illegal resume processing state transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resume_documents_enforce_transition
  ON documents.resume_documents;
CREATE TRIGGER resume_documents_enforce_transition
BEFORE UPDATE ON documents.resume_documents
FOR EACH ROW
EXECUTE FUNCTION documents.enforce_resume_state_transition();

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
      'resume.processing.contradiction'
    )
  );
