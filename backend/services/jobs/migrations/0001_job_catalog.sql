CREATE SCHEMA IF NOT EXISTS jobs;

CREATE TABLE jobs.companies (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  verified_domain text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX companies_identity_uq
  ON jobs.companies (normalized_name, verified_domain) NULLS NOT DISTINCT;
CREATE INDEX companies_normalized_name_idx ON jobs.companies (normalized_name);

CREATE TABLE jobs.canonical_jobs (
  id uuid PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES jobs.companies(id),
  title text NOT NULL,
  normalized_title text NOT NULL,
  locations jsonb NOT NULL,
  normalized_locations text[] NOT NULL,
  department text,
  normalized_department text,
  description text,
  description_hash text,
  dedupe_fingerprint text NOT NULL,
  status text NOT NULL,
  status_reason text,
  first_observed_at timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  valid_through timestamptz,
  consecutive_verification_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT canonical_jobs_status_ck CHECK (
    status IN ('pending', 'active', 'suspect_stale', 'expired', 'withdrawn', 'blocked')
  ),
  CONSTRAINT canonical_jobs_live_description_ck CHECK (
    status IN ('expired', 'withdrawn', 'blocked') OR description IS NOT NULL
  ),
  CONSTRAINT canonical_jobs_failure_count_ck CHECK (consecutive_verification_failures >= 0)
);

CREATE INDEX canonical_jobs_company_title_idx
  ON jobs.canonical_jobs (company_id, normalized_title);
CREATE INDEX canonical_jobs_status_expires_idx ON jobs.canonical_jobs (status, expires_at);
CREATE INDEX canonical_jobs_dedupe_fingerprint_idx
  ON jobs.canonical_jobs (dedupe_fingerprint);

CREATE TABLE jobs.job_sources (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provenance text NOT NULL,
  ats_tenant text,
  external_job_id text,
  employer_requisition_id text,
  verified_company_domain text,
  source_url text NOT NULL,
  canonical_url text NOT NULL,
  canonical_url_hash text NOT NULL,
  content_hash text NOT NULL,
  adapter_version text,
  raw_snapshot jsonb,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  last_verified_at timestamptz NOT NULL,
  valid_through timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_sources_provider_ck CHECK (
    provider IN ('greenhouse', 'lever', 'ashby', 'workday', 'ugc', 'other')
  ),
  CONSTRAINT job_sources_provenance_ck CHECK (
    provenance IN ('permitted_api', 'authorized_fixture', 'explicit_ugc')
  ),
  CONSTRAINT job_sources_content_hash_ck CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT job_sources_canonical_url_hash_ck CHECK (canonical_url_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX job_sources_job_id_idx ON jobs.job_sources (job_id);
CREATE UNIQUE INDEX job_sources_ats_identity_uq
  ON jobs.job_sources (provider, ats_tenant, external_job_id)
  WHERE ats_tenant IS NOT NULL AND external_job_id IS NOT NULL;
CREATE UNIQUE INDEX job_sources_requisition_identity_uq
  ON jobs.job_sources (verified_company_domain, employer_requisition_id)
  WHERE verified_company_domain IS NOT NULL AND employer_requisition_id IS NOT NULL;
CREATE UNIQUE INDEX job_sources_canonical_url_hash_uq
  ON jobs.job_sources (canonical_url_hash);

CREATE TABLE jobs.duplicate_candidates (
  job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id) ON DELETE CASCADE,
  candidate_job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id) ON DELETE CASCADE,
  classification text NOT NULL,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  resolution text,
  PRIMARY KEY (job_id, candidate_job_id),
  CONSTRAINT duplicate_candidates_order_ck CHECK (job_id::text < candidate_job_id::text),
  CONSTRAINT duplicate_candidates_classification_ck CHECK (
    classification IN ('exact', 'probable', 'related_repost', 'not_duplicate')
  )
);

CREATE TABLE jobs.status_events (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs.canonical_jobs(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT status_events_from_status_ck CHECK (
    from_status IS NULL OR from_status IN (
      'pending', 'active', 'suspect_stale', 'expired', 'withdrawn', 'blocked'
    )
  ),
  CONSTRAINT status_events_to_status_ck CHECK (
    to_status IN ('pending', 'active', 'suspect_stale', 'expired', 'withdrawn', 'blocked')
  )
);

CREATE INDEX status_events_job_occurred_idx ON jobs.status_events (job_id, occurred_at);
