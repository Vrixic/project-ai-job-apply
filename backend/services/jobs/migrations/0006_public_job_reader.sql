DO $role$
DECLARE
  existing_role record;
BEGIN
  SELECT rolcanlogin, rolinherit, rolsuper, rolcreatedb, rolcreaterole,
    rolreplication, rolbypassrls, rolconnlimit
  INTO existing_role
  FROM pg_catalog.pg_roles
  WHERE rolname = 'ai_job_apply_public_job_reader';

  IF NOT FOUND THEN
    CREATE ROLE ai_job_apply_public_job_reader
      LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT 1 PASSWORD NULL;
  ELSIF existing_role.rolcanlogin IS DISTINCT FROM true
    OR existing_role.rolinherit IS DISTINCT FROM false
    OR existing_role.rolsuper IS DISTINCT FROM false
    OR existing_role.rolcreatedb IS DISTINCT FROM false
    OR existing_role.rolcreaterole IS DISTINCT FROM false
    OR existing_role.rolreplication IS DISTINCT FROM false
    OR existing_role.rolbypassrls IS DISTINCT FROM false
    OR existing_role.rolconnlimit IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'The public job reader role boundary is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    INNER JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = membership.roleid
    WHERE membership.member = 'ai_job_apply_public_job_reader'::regrole
      AND NOT (
        granted_role.rolname = 'rds_iam'
        AND NOT membership.admin_option
        AND NOT membership.inherit_option
        AND NOT membership.set_option
      )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = 'ai_job_apply_public_job_reader'::regrole
  ) THEN
    RAISE EXCEPTION 'The public job reader role has an unexpected membership';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rds_iam')
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.member = 'ai_job_apply_public_job_reader'::regrole
        AND membership.roleid = (
          SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'rds_iam'
        )
    ) THEN
    GRANT rds_iam TO ai_job_apply_public_job_reader
      WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
  ELSIF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'rds_iam')
    AND (
      (
        SELECT count(*)
        FROM pg_catalog.pg_auth_members AS membership
        WHERE membership.member = 'ai_job_apply_public_job_reader'::regrole
          AND membership.roleid = (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'rds_iam'
          )
      ) <> 1
      OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_auth_members AS membership
        WHERE membership.member = 'ai_job_apply_public_job_reader'::regrole
          AND membership.roleid = (
            SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'rds_iam'
          )
          AND NOT membership.admin_option
          AND NOT membership.inherit_option
          AND NOT membership.set_option
      )
    ) THEN
    RAISE EXCEPTION 'The public job reader RDS IAM membership options are invalid';
  END IF;

  ALTER ROLE ai_job_apply_public_job_reader PASSWORD NULL;
END
$role$;

DO $database_privileges$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE ALL PRIVILEGES ON DATABASE %I FROM ai_job_apply_public_job_reader',
    pg_catalog.current_database()
  );
  EXECUTE pg_catalog.format(
    'GRANT CONNECT ON DATABASE %I TO ai_job_apply_public_job_reader',
    pg_catalog.current_database()
  );
  EXECUTE pg_catalog.format(
    'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC',
    pg_catalog.current_database()
  );
  EXECUTE pg_catalog.format(
    'ALTER ROLE ai_job_apply_public_job_reader IN DATABASE %I SET default_transaction_read_only = on',
    pg_catalog.current_database()
  );
END
$database_privileges$;

REVOKE USAGE, CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA jobs_public AUTHORIZATION CURRENT_USER;

REVOKE ALL PRIVILEGES ON SCHEMA jobs FROM ai_job_apply_public_job_reader;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA jobs FROM ai_job_apply_public_job_reader;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA jobs FROM ai_job_apply_public_job_reader;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA jobs FROM ai_job_apply_public_job_reader;
REVOKE ALL PRIVILEGES ON SCHEMA jobs_public FROM PUBLIC, ai_job_apply_public_job_reader;

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
  valid_through timestamptz
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
    job.expires_at, job.valid_through
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
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA jobs_public
  FROM ai_job_apply_public_job_reader;
GRANT USAGE ON SCHEMA jobs_public TO ai_job_apply_public_job_reader;
GRANT EXECUTE ON FUNCTION jobs_public.read_public_job_detail(uuid)
  TO ai_job_apply_public_job_reader;

ALTER DEFAULT PRIVILEGES IN SCHEMA jobs_public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
