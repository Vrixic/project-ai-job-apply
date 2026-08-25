CREATE FUNCTION jobs_public.read_public_job_sitemap(
  after_last_modified_at timestamptz,
  after_job_id uuid,
  requested_limit integer
)
RETURNS TABLE (
  job_id uuid,
  last_modified_at timestamptz
)
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
BEGIN
  IF requested_limit IS NULL OR requested_limit < 1 OR requested_limit > 101 THEN
    RAISE EXCEPTION 'The public sitemap page limit is invalid';
  END IF;
  IF (after_last_modified_at IS NULL) <> (after_job_id IS NULL) THEN
    RAISE EXCEPTION 'The public sitemap cursor is incomplete';
  END IF;
  IF after_last_modified_at IS NOT NULL
    AND after_last_modified_at > pg_catalog.statement_timestamp() THEN
    RAISE EXCEPTION 'The public sitemap cursor is in the future';
  END IF;

  RETURN QUERY
  SELECT job.id, job.last_verified_at
  FROM jobs.canonical_jobs AS job
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
    AND NOT EXISTS (
      SELECT 1
      FROM jobs.duplicate_candidates AS duplicate
      WHERE duplicate.resolution = 'exact'
        AND (
          CASE
            WHEN duplicate.canonical_job_id = duplicate.job_id
              THEN duplicate.candidate_job_id
            ELSE duplicate.job_id
          END
        ) = job.id
    )
    AND (
      after_last_modified_at IS NULL
      OR job.last_verified_at < after_last_modified_at
      OR (job.last_verified_at = after_last_modified_at AND job.id > after_job_id)
    )
  ORDER BY job.last_verified_at DESC, job.id ASC
  LIMIT requested_limit;
END
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION jobs_public.read_public_job_sitemap(
  timestamptz, uuid, integer
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION jobs_public.read_public_job_sitemap(timestamptz, uuid, integer)
  TO ai_job_apply_public_job_reader;
