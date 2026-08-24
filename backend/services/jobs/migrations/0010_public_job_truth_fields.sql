ALTER TABLE jobs.canonical_jobs
  ADD COLUMN date_posted timestamptz,
  ADD COLUMN application_url text,
  ADD COLUMN structured_locations jsonb;

ALTER TABLE jobs.canonical_jobs
  ADD CONSTRAINT canonical_jobs_date_posted_ck CHECK (
    date_posted IS NULL OR date_posted <= last_verified_at
  ),
  ADD CONSTRAINT canonical_jobs_application_url_ck CHECK (
    application_url IS NULL OR (
      octet_length(application_url) BETWEEN 1 AND 4096
      AND application_url ~ '^https://'
    )
  ),
  ADD CONSTRAINT canonical_jobs_structured_locations_ck CHECK (
    structured_locations IS NULL OR (
      jsonb_typeof(structured_locations) = 'array'
      AND jsonb_array_length(structured_locations) BETWEEN 1 AND 20
    )
  );

ALTER TABLE jobs.job_sources
  ADD COLUMN date_posted timestamptz,
  ADD COLUMN application_url text,
  ADD COLUMN structured_locations jsonb;

ALTER TABLE jobs.job_sources
  ADD CONSTRAINT job_sources_date_posted_ck CHECK (
    date_posted IS NULL OR date_posted <= last_verified_at
  ),
  ADD CONSTRAINT job_sources_application_url_ck CHECK (
    application_url IS NULL OR (
      octet_length(application_url) BETWEEN 1 AND 4096
      AND application_url ~ '^https://'
    )
  ),
  ADD CONSTRAINT job_sources_structured_locations_ck CHECK (
    structured_locations IS NULL OR (
      jsonb_typeof(structured_locations) = 'array'
      AND jsonb_array_length(structured_locations) BETWEEN 1 AND 20
    )
  );

DROP FUNCTION jobs_public.read_public_job_detail(uuid);

CREATE FUNCTION jobs_public.read_public_job_detail(requested_job_id uuid)
RETURNS TABLE (
  id uuid,
  company_name text,
  title text,
  locations jsonb,
  department text,
  description text,
  status text,
  first_observed_at timestamptz,
  last_verified_at timestamptz,
  expires_at timestamptz,
  valid_through timestamptz,
  work_mode text,
  employment_type text,
  date_posted timestamptz,
  application_url text,
  structured_locations jsonb
)
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
RETURNS NULL ON NULL INPUT
SET search_path = pg_catalog
AS $function$
  WITH RECURSIVE resolution(resolved_id, path) AS (
    SELECT requested_job_id, ARRAY[requested_job_id]
    UNION ALL
    SELECT duplicate.canonical_job_id, resolution.path || duplicate.canonical_job_id
    FROM resolution
    INNER JOIN jobs.duplicate_candidates AS duplicate
      ON duplicate.resolution = 'exact'
      AND CASE
        WHEN duplicate.canonical_job_id = duplicate.job_id THEN duplicate.candidate_job_id
        ELSE duplicate.job_id
      END = resolution.resolved_id
    WHERE NOT duplicate.canonical_job_id = ANY(resolution.path)
  ), canonical AS (
    SELECT resolved_id
    FROM resolution
    ORDER BY pg_catalog.cardinality(path) DESC
    LIMIT 1
  )
  SELECT job.id, company.display_name, job.title, job.locations, job.department,
    job.description, job.status, job.first_observed_at, job.last_verified_at,
    job.expires_at, job.valid_through, job.work_mode, job.employment_type,
    job.date_posted, job.application_url, job.structured_locations
  FROM canonical
  INNER JOIN jobs.canonical_jobs AS job ON job.id = canonical.resolved_id
  INNER JOIN jobs.companies AS company ON company.id = job.company_id
  WHERE job.status = 'active'
    AND job.description IS NOT NULL
    AND pg_catalog.btrim(job.description) <> ''
    AND job.first_observed_at <= job.last_verified_at
    AND job.last_verified_at <= pg_catalog.statement_timestamp()
    AND job.expires_at >= job.last_verified_at
    AND job.expires_at > pg_catalog.statement_timestamp()
    AND (
      job.valid_through IS NULL OR (
        job.valid_through >= job.first_observed_at
        AND job.valid_through <= job.expires_at
        AND job.valid_through > pg_catalog.statement_timestamp()
      )
    )
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION jobs_public.read_public_job_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jobs_public.read_public_job_detail(uuid)
  TO ai_job_apply_public_job_reader;
