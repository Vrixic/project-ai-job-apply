CREATE SCHEMA IF NOT EXISTS documents;

CREATE TABLE IF NOT EXISTS documents.resume_documents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  file_name text NOT NULL CHECK (
    char_length(file_name) BETWEEN 1 AND 255
    AND file_name !~ '[[:cntrl:]/\\]'
  ),
  media_type text NOT NULL CHECK (
    media_type IN (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  ),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  source_object_key text NOT NULL UNIQUE CHECK (
    source_object_key = 'quarantine/' || id::text || '/source'
  ),
  source_object_version text,
  normalized_object_key text,
  normalized_object_version text,
  status text NOT NULL CHECK (
    status IN ('awaiting_upload', 'scanning', 'parsing', 'parsed', 'rejected', 'failed')
  ),
  failure_code text CHECK (
    failure_code IS NULL OR failure_code IN (
      'malware_detected',
      'scan_unsupported',
      'scan_failed',
      'object_mismatch',
      'invalid_document',
      'parse_failed'
    )
  ),
  page_count integer CHECK (page_count BETWEEN 1 AND 50),
  character_count integer CHECK (character_count BETWEEN 1 AND 200000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status IN ('rejected', 'failed')) = (failure_code IS NOT NULL)),
  CHECK (
    status <> 'parsed' OR (
      normalized_object_key IS NOT NULL
      AND normalized_object_version IS NOT NULL
      AND page_count IS NOT NULL
      AND character_count IS NOT NULL
    )
  )
);
CREATE INDEX IF NOT EXISTS resume_documents_user_created_idx
  ON documents.resume_documents(user_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS documents.idempotency_keys (
  user_id uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  scope text NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 16 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  response jsonb NOT NULL CHECK (pg_column_size(response) <= 65536),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, scope, key)
);

CREATE TABLE IF NOT EXISTS documents.processing_receipts (
  event_id text PRIMARY KEY CHECK (char_length(event_id) BETWEEN 1 AND 256),
  document_id uuid NOT NULL REFERENCES documents.resume_documents(id) ON DELETE CASCADE,
  source_object_version text NOT NULL CHECK (char_length(source_object_version) BETWEEN 1 AND 1024),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents.audit_events (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES identity.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (
    action IN ('resume.upload.registered', 'resume.scan.recorded', 'resume.parse.completed')
  ),
  document_id uuid NOT NULL,
  trace_id text NOT NULL CHECK (char_length(trace_id) BETWEEN 1 AND 128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(metadata) <= 4096),
  created_at timestamptz NOT NULL DEFAULT now()
);

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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS resume_documents_protect_identity
  ON documents.resume_documents;
CREATE TRIGGER resume_documents_protect_identity
BEFORE UPDATE ON documents.resume_documents
FOR EACH ROW
EXECUTE FUNCTION documents.protect_resume_identity_fields();
