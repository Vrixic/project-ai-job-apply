-- D2 queued-intake foundation only. This migration deliberately creates no foreign key,
-- trigger, or write path into canonical_jobs or job_sources. A later reviewed workflow
-- migration must independently verify a contribution before catalog provenance can change.
CREATE TABLE jobs.job_contributions (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  state text NOT NULL,
  provider text NOT NULL,
  page_variant text NOT NULL,
  source_url text NOT NULL,
  external_job_id text,
  content_sha256 text NOT NULL,
  adapter_version text NOT NULL,
  observed_at timestamptz NOT NULL,
  approved_at timestamptz NOT NULL,
  consent_id uuid NOT NULL,
  consent_version text NOT NULL,
  policy_version text NOT NULL,
  preview_digest_sha256 text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key_hash text NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT job_contributions_state_ck CHECK (state = 'queued'),
  CONSTRAINT job_contributions_provider_ck CHECK (provider IN ('greenhouse', 'lever', 'ashby')),
  CONSTRAINT job_contributions_page_variant_ck CHECK (
    page_variant IN ('greenhouse-board-v1', 'lever-posting-v1', 'ashby-job-board-v1')
  ),
  CONSTRAINT job_contributions_source_url_ck CHECK (
    source_url = btrim(source_url)
    AND char_length(source_url) BETWEEN 9 AND 4096
    AND source_url ~ '^https://'
  ),
  CONSTRAINT job_contributions_external_id_ck CHECK (
    external_job_id IS NULL OR (
      external_job_id = btrim(external_job_id)
      AND char_length(external_job_id) BETWEEN 1 AND 200
    )
  ),
  CONSTRAINT job_contributions_content_hash_ck CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT job_contributions_adapter_version_ck CHECK (
    adapter_version = 'd2-job-page-v1'
  ),
  CONSTRAINT job_contributions_provider_boundary_ck CHECK (
    (
      provider = 'greenhouse'
      AND page_variant = 'greenhouse-board-v1'
      AND adapter_version = 'd2-job-page-v1'
      AND source_url ~ '^https://(boards\.greenhouse\.io|job-boards\.greenhouse\.io)/[A-Za-z0-9._~-]+/jobs/[A-Za-z0-9._~-]+/?$'
    ) OR (
      provider = 'lever'
      AND page_variant = 'lever-posting-v1'
      AND adapter_version = 'd2-job-page-v1'
      AND source_url ~ '^https://(jobs\.lever\.co|jobs\.eu\.lever\.co)/[A-Za-z0-9._~-]+/[A-Za-z0-9._~-]+/?$'
    ) OR (
      provider = 'ashby'
      AND page_variant = 'ashby-job-board-v1'
      AND adapter_version = 'd2-job-page-v1'
      AND source_url ~ '^https://jobs\.ashbyhq\.com/[A-Za-z0-9._~-]+/[A-Za-z0-9._~-]+/?$'
    )
  ),
  CONSTRAINT job_contributions_consent_version_ck CHECK (
    consent_version = 'ugc-contribution-preview.v1'
  ),
  CONSTRAINT job_contributions_policy_version_ck CHECK (
    policy_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'
  ),
  CONSTRAINT job_contributions_preview_digest_ck CHECK (
    preview_digest_sha256 ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT job_contributions_payload_ck CHECK (
    jsonb_typeof(payload) = 'object'
    AND pg_column_size(payload) <= 65536
  ),
  CONSTRAINT job_contributions_hashes_ck CHECK (
    idempotency_key_hash ~ '^[a-f0-9]{64}$'
    AND request_hash ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT job_contributions_chronology_ck CHECK (
    observed_at <= approved_at
    AND approved_at <= created_at
    AND updated_at = created_at
  ),
  CONSTRAINT job_contributions_owner_idempotency_uq
    UNIQUE (owner_user_id, idempotency_key_hash)
);

CREATE INDEX job_contributions_owner_created_idx
  ON jobs.job_contributions (owner_user_id, created_at DESC, id);
CREATE INDEX job_contributions_queued_idx
  ON jobs.job_contributions (created_at, id)
  WHERE state = 'queued';

CREATE TABLE jobs.job_contribution_outbox (
  id uuid PRIMARY KEY,
  contribution_id uuid NOT NULL REFERENCES jobs.job_contributions(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  subject text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT job_contribution_outbox_contribution_uq UNIQUE (contribution_id),
  CONSTRAINT job_contribution_outbox_event_type_ck CHECK (event_type = 'job.contributed.v1'),
  CONSTRAINT job_contribution_outbox_subject_ck CHECK (subject = contribution_id::text),
  CONSTRAINT job_contribution_outbox_data_ck CHECK (
    data = jsonb_build_object('contributionId', contribution_id::text)
  )
);

CREATE INDEX job_contribution_outbox_pending_idx
  ON jobs.job_contribution_outbox (created_at, id);

CREATE FUNCTION jobs.guard_queued_job_contribution()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'queued job contributions are immutable';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER job_contributions_queued_immutable
BEFORE UPDATE ON jobs.job_contributions
FOR EACH ROW EXECUTE FUNCTION jobs.guard_queued_job_contribution();

CREATE FUNCTION jobs.guard_job_contribution_outbox()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'job contribution outbox is append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER job_contribution_outbox_append_only
BEFORE UPDATE ON jobs.job_contribution_outbox
FOR EACH ROW EXECUTE FUNCTION jobs.guard_job_contribution_outbox();
