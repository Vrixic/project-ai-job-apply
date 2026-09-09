import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationVersions = [
  "0001_job_catalog",
  "0002_duplicate_resolution",
  "0003_duplicate_resolution_audit_guard",
  "0004_job_search",
  "0005_ingestion_orchestration",
  "0006_public_job_reader",
  "0007_matchable_job_attributes",
  "0008_job_reporting_and_moderation",
  "0009_provider_ingestion_sources",
  "0010_public_job_truth_fields",
  "0011_positive_source_withdrawal",
  "0012_candidate_rights",
  "0013_public_job_sitemap",
  "0014_job_contribution_intake",
  "0015_source_revalidation_lifecycle",
  "0016_job_contribution_candidate_rights",
  "0017_job_contribution_processing",
  "0018_job_contribution_processing_delivery",
  "0019_job_contribution_provider_publication",
  "0020_contribution_trust_reprocessing",
  "0021_development_contribution_operation_lease",
  "0022_development_contribution_provider_leases",
  "0023_contribution_verification_refresh",
] as const;
const migrations = await Promise.all(
  migrationVersions.map(async (version) => {
    const migrationPath = fileURLToPath(
      new URL(`../../migrations/${version}.sql`, import.meta.url),
    );
    const sql = (await readFile(migrationPath, "utf8")).replaceAll("\r\n", "\n");
    return { version, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }),
);
const ingestionTriggerFunctions = [
  "guard_ingestion_checkpoint",
  "append_ingestion_run_event",
  "guard_ingestion_run_event",
  "guard_ingestion_dispatch",
] as const;
const ingestionMigration = migrations.find(
  (migration) => migration.version === "0005_ingestion_orchestration",
);
if (!ingestionMigration) throw new Error("The ingestion migration source is missing");
const expectedIngestionTriggerBodies = ingestionTriggerFunctions.map((functionName) => {
  const match = new RegExp(
    `CREATE FUNCTION jobs\\.${functionName}\\(\\)\\s+RETURNS trigger[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    "u",
  ).exec(ingestionMigration.sql);
  if (!match?.[1]) throw new Error(`The ${functionName} trigger function source is invalid`);
  return match[1];
});
const publicReaderMigration = migrations.find(
  (migration) => migration.version === "0010_public_job_truth_fields",
);
if (!publicReaderMigration) throw new Error("The public reader migration source is missing");
const publicReaderBodyMatch =
  /CREATE FUNCTION jobs_public\.read_public_job_detail\(requested_job_id uuid\)[\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/u.exec(
    publicReaderMigration.sql,
  );
if (!publicReaderBodyMatch?.[1]) throw new Error("The public reader function source is invalid");
const expectedPublicReaderBody = publicReaderBodyMatch[1];
const publicSitemapMigration = migrations.find(
  (migration) => migration.version === "0013_public_job_sitemap",
);
if (!publicSitemapMigration) throw new Error("The public sitemap migration source is missing");
const publicSitemapBodyMatch =
  /CREATE FUNCTION jobs_public\.read_public_job_sitemap\([\s\S]*?AS \$function\$([\s\S]*?)\$function\$;/u.exec(
    publicSitemapMigration.sql,
  );
if (!publicSitemapBodyMatch?.[1]) throw new Error("The public sitemap function source is invalid");
const expectedPublicSitemapBody = publicSitemapBodyMatch[1];
const reportingTriggerFunctions = [
  "guard_job_report",
  "guard_moderation_case",
  "append_moderation_event",
  "guard_moderation_event",
] as const;
const reportingMigration = migrations.find(
  (migration) => migration.version === "0008_job_reporting_and_moderation",
);
if (!reportingMigration) throw new Error("The reporting migration source is missing");
const expectedReportingTriggerBodies = reportingTriggerFunctions.map((functionName) => {
  const match = new RegExp(
    `CREATE FUNCTION jobs\\.${functionName}\\(\\)\\s+RETURNS trigger[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    "u",
  ).exec(reportingMigration.sql);
  if (!match?.[1]) throw new Error(`The ${functionName} trigger function source is invalid`);
  return match[1];
});
const revalidationTriggerFunctions = [
  "guard_source_revalidation_queue",
  "guard_source_verification_evidence",
] as const;
const revalidationMigration = migrations.find(
  (migration) => migration.version === "0015_source_revalidation_lifecycle",
);
if (!revalidationMigration) throw new Error("The revalidation migration source is missing");
const expectedRevalidationTriggerBodies = revalidationTriggerFunctions.map((functionName) => {
  const match = new RegExp(
    `CREATE FUNCTION jobs\\.${functionName}\\(\\)\\s+RETURNS trigger[\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
    "u",
  ).exec(revalidationMigration.sql);
  if (!match?.[1]) throw new Error(`The ${functionName} trigger function source is invalid`);
  return match[1];
});

const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
try {
  await client.begin(async (transaction) => {
    await transaction.unsafe(`
      CREATE SCHEMA IF NOT EXISTS jobs;
      CREATE TABLE IF NOT EXISTS jobs.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await transaction`SELECT pg_advisory_xact_lock(hashtext('ai-job-apply:jobs-migrations'))`;

    for (const migration of migrations) {
      const existing = await transaction<{ checksum: string }[]>`
        SELECT checksum FROM jobs.schema_migrations WHERE version = ${migration.version}
      `;
      if (existing.length > 0 && existing[0]?.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }
      if (existing.length === 0) {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO jobs.schema_migrations (version, checksum)
          VALUES (${migration.version}, ${migration.checksum})
        `;
      }
    }

    // Reassert the no-password boundary on every verifier run. PostgreSQL intentionally masks
    // role secrets from non-superuser catalog views, while ALTER ROLE has exact server semantics.
    await transaction.unsafe("ALTER ROLE ai_job_apply_public_job_reader PASSWORD NULL");

    const [verification] = await transaction<
      {
        tableCount: number;
        migrationCount: number;
        identityIndexCount: number;
        sourceWithdrawalColumnCount: number;
        sourceWithdrawalIndexCount: number;
        sourceWithdrawalConstraintDefinitions: string[];
        moderationIndexCount: number;
        searchIndexCount: number;
        searchColumnPresent: boolean;
        searchTriggerCount: number;
        ingestionTriggerCount: number;
        ingestionTriggerFunctionCount: number;
        ingestionTriggerFunctionBodies: string[];
        ingestionIndexCount: number;
        ingestionForeignKeyCount: number;
        ingestionSourceConstraintDefinitions: string[];
        publicSchemaCount: number;
        publicReaderRoleCount: number;
        publicReaderFunctionCount: number;
        publicReaderFunctionBody: string | null;
        publicSitemapFunctionCount: number;
        publicSitemapFunctionBody: string | null;
        publicReaderGrantCount: number;
        publicReaderMembershipViolationCount: number;
        publicReaderMembershipCount: number;
        publicReaderDirectGrantViolationCount: number;
        publicReaderOwnershipCount: number;
        publicReaderSettingCount: number;
        rdsIamRoleCount: number;
        matchableColumnCount: number;
        matchableConstraintDefinitions: string[];
        reportingTriggerCount: number;
        reportingTriggerFunctionCount: number;
        reportingTriggerFunctionBodies: string[];
        reportingIndexCount: number;
        contributionIndexCount: number;
        contributionTriggerCount: number;
        contributionForeignKeyCount: number;
        contributionCatalogForeignKeyCount: number;
        contributionCandidateRightsFunctionCount: number;
        contributionCandidateRightsSecurityDefinerCount: number;
        contributionCandidateRightsPublicExecuteViolationCount: number;
        contributionCandidateDeleteGuardBodyCount: number;
        revalidationIndexCount: number;
        revalidationTriggerCount: number;
        revalidationTriggerFunctionCount: number;
        revalidationTriggerFunctionBodies: string[];
        revalidationForeignKeyCount: number;
        processingTableCount: number;
        processingTriggerCount: number;
        processingTriggerFunctionCount: number;
        processingProviderObservationColumnCount: number;
        processingNullableCatalogColumnCount: number;
        processingCatalogForeignKeyCount: number;
        processingPublicationConstraintCount: number;
      }[]
    >`
      SELECT
        (
          (to_regclass('jobs.companies') IS NOT NULL)::int +
          (to_regclass('jobs.canonical_jobs') IS NOT NULL)::int +
          (to_regclass('jobs.job_sources') IS NOT NULL)::int +
          (to_regclass('jobs.duplicate_candidates') IS NOT NULL)::int +
          (to_regclass('jobs.duplicate_resolution_events') IS NOT NULL)::int +
          (to_regclass('jobs.status_events') IS NOT NULL)::int +
          (to_regclass('jobs.schema_migrations') IS NOT NULL)::int +
          (to_regclass('jobs.catalog_search_state') IS NOT NULL)::int +
          (to_regclass('jobs.ingestion_checkpoints') IS NOT NULL)::int +
          (to_regclass('jobs.ingestion_run_events') IS NOT NULL)::int +
          (to_regclass('jobs.ingestion_dispatches') IS NOT NULL)::int
          + (to_regclass('jobs.job_reports') IS NOT NULL)::int
          + (to_regclass('jobs.moderation_cases') IS NOT NULL)::int
          + (to_regclass('jobs.moderation_events') IS NOT NULL)::int
          + (to_regclass('jobs.job_contributions') IS NOT NULL)::int
          + (to_regclass('jobs.job_contribution_outbox') IS NOT NULL)::int
          + (to_regclass('jobs.source_revalidation_queue') IS NOT NULL)::int
          + (to_regclass('jobs.source_verification_evidence') IS NOT NULL)::int
          + (to_regclass('jobs.job_contribution_processing_queue') IS NOT NULL)::int
          + (to_regclass('jobs.job_contribution_normalizations') IS NOT NULL)::int
          + (to_regclass('jobs.job_contribution_independent_verifications') IS NOT NULL)::int
          + (to_regclass('jobs.job_contribution_trust_decisions') IS NOT NULL)::int
          + (to_regclass('jobs.job_contribution_state_events') IS NOT NULL)::int
          + (to_regclass('jobs.job_contribution_reconciliations') IS NOT NULL)::int
          + (to_regclass('jobs.job_contribution_processing_outbox') IS NOT NULL)::int
          + (to_regclass('jobs.job_contribution_processing_event_deliveries') IS NOT NULL)::int
        )::int AS "tableCount",
        (
          SELECT count(*)::int FROM jobs.schema_migrations
          WHERE version = ANY(${migrationVersions as unknown as string[]})
        ) AS "migrationCount",
        (
          SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'jobs'
            AND indexname IN (
              'job_sources_ats_identity_uq',
              'job_sources_requisition_identity_uq',
              'job_sources_canonical_url_hash_uq'
            )
        ) AS "identityIndexCount",
        (
          SELECT count(*)::int
          FROM pg_attribute AS attribute
          INNER JOIN pg_type AS data_type ON data_type.oid = attribute.atttypid
          WHERE attribute.attrelid = 'jobs.job_sources'::regclass
            AND attribute.attname = 'withdrawn_at'
            AND data_type.typname = 'timestamptz'
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND NOT attribute.attnotnull
            AND NOT attribute.atthasdef
            AND attribute.attgenerated = ''
            AND attribute.attidentity = ''
        ) AS "sourceWithdrawalColumnCount",
        (
          SELECT count(*)::int
          FROM pg_index AS index_definition
          INNER JOIN pg_class AS index_relation
            ON index_relation.oid = index_definition.indexrelid
          WHERE index_definition.indrelid = 'jobs.job_sources'::regclass
            AND index_relation.relname = 'job_sources_active_job_idx'
            AND index_definition.indisvalid
            AND index_definition.indisready
            AND NOT index_definition.indisunique
            AND pg_get_expr(index_definition.indpred, index_definition.indrelid) =
              '(withdrawn_at IS NULL)'::text
            AND (
              SELECT array_agg(attribute.attname ORDER BY key.ordinality)
              FROM unnest(index_definition.indkey) WITH ORDINALITY
                key(attribute_number, ordinality)
              INNER JOIN pg_attribute AS attribute
                ON attribute.attrelid = index_definition.indrelid
               AND attribute.attnum = key.attribute_number
              WHERE key.ordinality <= index_definition.indnkeyatts
            ) = ARRAY['job_id']::name[]
        ) AS "sourceWithdrawalIndexCount",
        ARRAY(
          SELECT pg_get_constraintdef(constraint_definition.oid, true)
          FROM pg_constraint AS constraint_definition
          WHERE constraint_definition.conrelid = 'jobs.job_sources'::regclass
            AND constraint_definition.conname = 'job_sources_withdrawn_at_ck'
            AND constraint_definition.contype = 'c'
            AND constraint_definition.convalidated
            AND NOT constraint_definition.connoinherit
        ) AS "sourceWithdrawalConstraintDefinitions",
        (
          SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'jobs'
            AND indexname IN (
              'duplicate_candidates_exact_loser_uq',
              'duplicate_resolution_events_pair_occurred_idx'
            )
        ) AS "moderationIndexCount"
        , (
          SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'jobs'
            AND indexname IN (
              'canonical_jobs_search_document_gin',
              'canonical_jobs_normalized_locations_gin',
              'canonical_jobs_normalized_title_idx',
              'canonical_jobs_active_verified_idx'
            )
        ) AS "searchIndexCount",
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'jobs'
            AND table_name = 'canonical_jobs'
            AND column_name = 'search_document'
            AND is_generated = 'ALWAYS'
        ) AS "searchColumnPresent"
        , (
          SELECT count(*)::int FROM pg_trigger
          WHERE tgname IN (
            'canonical_jobs_search_revision',
            'companies_search_revision',
            'duplicate_candidates_search_revision'
          ) AND NOT tgisinternal
        ) AS "searchTriggerCount"
        , (
          SELECT count(*)::int
          FROM pg_trigger trigger
          JOIN (VALUES
            ('jobs.ingestion_checkpoints'::regclass, 'ingestion_checkpoints_guard',
              'jobs.guard_ingestion_checkpoint()'::regprocedure, 31::smallint),
            ('jobs.ingestion_checkpoints'::regclass, 'ingestion_checkpoints_append_event',
              'jobs.append_ingestion_run_event()'::regprocedure, 21::smallint),
            ('jobs.ingestion_run_events'::regclass, 'ingestion_run_events_append_only',
              'jobs.guard_ingestion_run_event()'::regprocedure, 31::smallint),
            ('jobs.ingestion_dispatches'::regclass, 'ingestion_dispatches_guard',
              'jobs.guard_ingestion_dispatch()'::regprocedure, 31::smallint)
          ) expected(table_oid, trigger_name, function_oid, trigger_type)
            ON expected.table_oid = trigger.tgrelid
           AND expected.trigger_name = trigger.tgname
           AND expected.function_oid = trigger.tgfoid
           AND expected.trigger_type = trigger.tgtype
          WHERE NOT trigger.tgisinternal AND trigger.tgenabled = 'O'
        ) AS "ingestionTriggerCount"
        , (
          SELECT count(*)::int
          FROM pg_proc function_definition
          JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          JOIN pg_language language ON language.oid = function_definition.prolang
          WHERE namespace.nspname = 'jobs'
            AND function_definition.proname = ANY(${ingestionTriggerFunctions as unknown as string[]})
            AND function_definition.pronargs = 0
            AND language.lanname = 'plpgsql'
            AND function_definition.provolatile = 'v'
            AND NOT function_definition.prosecdef
            AND function_definition.proconfig IS NULL
        ) AS "ingestionTriggerFunctionCount"
        , ARRAY(
          SELECT function_definition.prosrc
          FROM unnest(${ingestionTriggerFunctions as unknown as string[]}::text[])
            WITH ORDINALITY expected(function_name, ordinal)
          JOIN pg_proc function_definition ON function_definition.proname = expected.function_name
          JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          WHERE namespace.nspname = 'jobs' AND function_definition.pronargs = 0
          ORDER BY expected.ordinal
        ) AS "ingestionTriggerFunctionBodies"
        , (
          SELECT count(*)::int
          FROM pg_index index_definition
          JOIN pg_class index_relation ON index_relation.oid = index_definition.indexrelid
          JOIN (VALUES
            ('jobs.ingestion_checkpoints'::regclass, 'ingestion_checkpoints_due_idx',
              ARRAY['state', 'retry_at', 'lease_expires_at', 'execution_id']::name[],
              '(state = ANY (ARRAY[''claimed''::text, ''retry_wait''::text, ''paused''::text]))'::text),
            ('jobs.ingestion_run_events'::regclass, 'ingestion_run_events_occurred_idx',
              ARRAY['occurred_at', 'execution_id', 'revision']::name[], NULL::text),
            ('jobs.ingestion_dispatches'::regclass, 'ingestion_dispatches_pending_idx',
              ARRAY['next_attempt_at', 'created_at', 'id']::name[],
              '(state = ANY (ARRAY[''pending''::text, ''claimed''::text]))'::text)
          ) expected(table_oid, index_name, key_columns, predicate)
            ON expected.table_oid = index_definition.indrelid
           AND expected.index_name = index_relation.relname
          WHERE index_definition.indisvalid AND index_definition.indisready
            AND NOT index_definition.indisunique
            AND pg_get_expr(index_definition.indpred, index_definition.indrelid)
              IS NOT DISTINCT FROM expected.predicate
            AND (
              SELECT array_agg(attribute.attname ORDER BY key.ordinality)
              FROM unnest(index_definition.indkey) WITH ORDINALITY key(attribute_number, ordinality)
              JOIN pg_attribute attribute
                ON attribute.attrelid = index_definition.indrelid
               AND attribute.attnum = key.attribute_number
              WHERE key.ordinality <= index_definition.indnkeyatts
            ) = expected.key_columns
        ) AS "ingestionIndexCount"
        , (
          SELECT count(*)::int
          FROM pg_constraint constraint_definition
          JOIN (VALUES
            (
              'ingestion_dispatches_execution_id_fkey',
              'jobs.ingestion_dispatches'::regclass,
              'jobs.ingestion_checkpoints'::regclass,
              ARRAY['execution_id']::name[], ARRAY['execution_id']::name[]
            ),
            (
              'ingestion_dispatches_execution_id_checkpoint_revision_fkey',
              'jobs.ingestion_dispatches'::regclass,
              'jobs.ingestion_run_events'::regclass,
              ARRAY['execution_id', 'checkpoint_revision']::name[],
              ARRAY['execution_id', 'revision']::name[]
            ),
            (
              'ingestion_checkpoints_exhausted_dispatch_fk',
              'jobs.ingestion_checkpoints'::regclass,
              'jobs.ingestion_dispatches'::regclass,
              ARRAY['exhausted_dispatch_id']::name[], ARRAY['id']::name[]
            )
          ) expected(
            constraint_name, table_oid, referenced_table_oid,
            local_columns, referenced_columns
          )
            ON expected.constraint_name = constraint_definition.conname
           AND expected.table_oid = constraint_definition.conrelid
           AND expected.referenced_table_oid = constraint_definition.confrelid
          WHERE constraint_definition.contype = 'f' AND constraint_definition.convalidated
            AND NOT constraint_definition.condeferrable
            AND NOT constraint_definition.condeferred
            AND constraint_definition.confupdtype = 'a'
            AND constraint_definition.confdeltype = 'a'
            AND constraint_definition.confmatchtype = 's'
            AND (
              SELECT array_agg(attribute.attname ORDER BY key.ordinality)
              FROM unnest(constraint_definition.conkey) WITH ORDINALITY key(attribute_number, ordinality)
              JOIN pg_attribute attribute
                ON attribute.attrelid = constraint_definition.conrelid
               AND attribute.attnum = key.attribute_number
            ) = expected.local_columns
            AND (
              SELECT array_agg(attribute.attname ORDER BY key.ordinality)
              FROM unnest(constraint_definition.confkey) WITH ORDINALITY key(attribute_number, ordinality)
              JOIN pg_attribute attribute
                ON attribute.attrelid = constraint_definition.confrelid
               AND attribute.attnum = key.attribute_number
            ) = expected.referenced_columns
        ) AS "ingestionForeignKeyCount"
        , ARRAY(
          SELECT pg_get_constraintdef(constraint_definition.oid, true)
          FROM pg_constraint AS constraint_definition
          WHERE constraint_definition.conrelid = 'jobs.ingestion_checkpoints'::regclass
            AND constraint_definition.conname = 'ingestion_checkpoints_contract_ck'
            AND constraint_definition.contype = 'c'
            AND constraint_definition.convalidated
            AND NOT constraint_definition.connoinherit
        ) AS "ingestionSourceConstraintDefinitions"
        , (
          SELECT count(*)::int
          FROM pg_namespace
          WHERE nspname = 'jobs_public'
            AND nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        ) AS "publicSchemaCount"
        , (
          SELECT count(*)::int
          FROM pg_roles
          WHERE rolname = 'ai_job_apply_public_job_reader'
            AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb
            AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls
            AND rolconnlimit = 1
            AND (
              NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam')
              OR pg_has_role('ai_job_apply_public_job_reader', 'rds_iam', 'MEMBER')
            )
        ) AS "publicReaderRoleCount"
        , (
          SELECT count(*)::int
          FROM pg_proc function_definition
          INNER JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          INNER JOIN pg_language language ON language.oid = function_definition.prolang
          WHERE namespace.nspname = 'jobs_public'
            AND function_definition.proname = 'read_public_job_detail'
            AND function_definition.pronargs = 1
            AND pg_get_function_identity_arguments(function_definition.oid) = 'requested_job_id uuid'
            AND pg_get_function_result(function_definition.oid) =
              'TABLE(id uuid, company_name text, title text, locations jsonb, department text, description text, status text, first_observed_at timestamp with time zone, last_verified_at timestamp with time zone, expires_at timestamp with time zone, valid_through timestamp with time zone, work_mode text, employment_type text, date_posted timestamp with time zone, application_url text, structured_locations jsonb)'
            AND language.lanname = 'sql'
            AND function_definition.provolatile = 's'
            AND function_definition.prosecdef
            AND function_definition.proisstrict
            AND function_definition.proparallel = 's'
            AND function_definition.proconfig = ARRAY['search_path=pg_catalog']::text[]
        ) AS "publicReaderFunctionCount"
        , (
          SELECT function_definition.prosrc
          FROM pg_proc function_definition
          INNER JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          WHERE namespace.nspname = 'jobs_public'
            AND function_definition.proname = 'read_public_job_detail'
            AND function_definition.pronargs = 1
        ) AS "publicReaderFunctionBody"
        , (
          SELECT count(*)::int
          FROM pg_proc function_definition
          INNER JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          INNER JOIN pg_language language ON language.oid = function_definition.prolang
          WHERE namespace.nspname = 'jobs_public'
            AND function_definition.proname = 'read_public_job_sitemap'
            AND function_definition.pronargs = 3
            AND pg_get_function_identity_arguments(function_definition.oid) =
              'after_last_modified_at timestamp with time zone, after_job_id uuid, requested_limit integer'
            AND pg_get_function_result(function_definition.oid) =
              'TABLE(job_id uuid, last_modified_at timestamp with time zone)'
            AND language.lanname = 'plpgsql'
            AND function_definition.provolatile = 's'
            AND function_definition.prosecdef
            AND NOT function_definition.proisstrict
            AND function_definition.proparallel = 's'
            AND function_definition.proconfig = ARRAY['search_path=pg_catalog']::text[]
        ) AS "publicSitemapFunctionCount"
        , (
          SELECT function_definition.prosrc
          FROM pg_proc function_definition
          INNER JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          WHERE namespace.nspname = 'jobs_public'
            AND function_definition.proname = 'read_public_job_sitemap'
            AND function_definition.pronargs = 3
        ) AS "publicSitemapFunctionBody"
        , (
          SELECT count(*)::int
          FROM (VALUES
            (has_database_privilege(
              'ai_job_apply_public_job_reader', current_database(), 'CONNECT'
            )),
            (NOT has_database_privilege(
              'ai_job_apply_public_job_reader', current_database(), 'TEMPORARY'
            )),
            (NOT has_database_privilege(
              'ai_job_apply_public_job_reader', current_database(), 'CREATE'
            )),
            (has_schema_privilege(
              'ai_job_apply_public_job_reader', 'jobs_public', 'USAGE'
            )),
            (NOT has_schema_privilege(
              'ai_job_apply_public_job_reader', 'jobs', 'USAGE'
            )),
            (NOT has_schema_privilege(
              'ai_job_apply_public_job_reader', 'public', 'USAGE'
            )),
            (has_function_privilege(
              'ai_job_apply_public_job_reader',
              'jobs_public.read_public_job_detail(uuid)', 'EXECUTE'
            )),
            (has_function_privilege(
              'ai_job_apply_public_job_reader',
              'jobs_public.read_public_job_sitemap(timestamptz,uuid,integer)', 'EXECUTE'
            )),
            (NOT has_table_privilege(
              'ai_job_apply_public_job_reader', 'jobs.canonical_jobs', 'SELECT'
            ))
          ) AS expected(granted)
          WHERE granted
        ) AS "publicReaderGrantCount"
        , (
          SELECT count(*)::int
          FROM (
            SELECT membership.roleid, membership.member
            FROM pg_auth_members AS membership
            INNER JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
            WHERE membership.member = 'ai_job_apply_public_job_reader'::regrole
              AND NOT (
                granted_role.rolname = 'rds_iam'
                AND NOT membership.admin_option
                AND NOT membership.inherit_option
                AND NOT membership.set_option
              )
            UNION ALL
            SELECT membership.roleid, membership.member
            FROM pg_auth_members AS membership
            WHERE membership.roleid = 'ai_job_apply_public_job_reader'::regrole
          ) AS unexpected
        ) AS "publicReaderMembershipViolationCount"
        , (
          SELECT count(*)::int
          FROM pg_auth_members AS membership
          WHERE membership.member = 'ai_job_apply_public_job_reader'::regrole
            AND membership.roleid = (
              SELECT oid FROM pg_roles WHERE rolname = 'rds_iam'
            )
            AND NOT membership.admin_option
            AND NOT membership.inherit_option
            AND NOT membership.set_option
        ) AS "publicReaderMembershipCount"
        , (
          WITH reader AS (
            SELECT oid FROM pg_roles WHERE rolname = 'ai_job_apply_public_job_reader'
          ), direct_grants AS (
            SELECT 'database'::text AS object_kind, database_definition.datname AS object_name,
              privilege.privilege_type, privilege.is_grantable
            FROM pg_database AS database_definition
            CROSS JOIN LATERAL aclexplode(database_definition.datacl) AS privilege
            WHERE privilege.grantee = (SELECT oid FROM reader)
            UNION ALL
            SELECT 'schema', namespace.nspname, privilege.privilege_type,
              privilege.is_grantable
            FROM pg_namespace AS namespace
            CROSS JOIN LATERAL aclexplode(namespace.nspacl) AS privilege
            WHERE privilege.grantee = (SELECT oid FROM reader)
            UNION ALL
            SELECT 'relation', namespace.nspname || '.' || class.relname,
              privilege.privilege_type, privilege.is_grantable
            FROM pg_class AS class
            INNER JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
            CROSS JOIN LATERAL aclexplode(class.relacl) AS privilege
            WHERE privilege.grantee = (SELECT oid FROM reader)
            UNION ALL
            SELECT 'function', namespace.nspname || '.' || function_definition.proname ||
              '(' || pg_get_function_identity_arguments(function_definition.oid) || ')',
              privilege.privilege_type, privilege.is_grantable
            FROM pg_proc AS function_definition
            INNER JOIN pg_namespace AS namespace ON namespace.oid = function_definition.pronamespace
            CROSS JOIN LATERAL aclexplode(function_definition.proacl) AS privilege
            WHERE privilege.grantee = (SELECT oid FROM reader)
          )
          SELECT count(*)::int
          FROM direct_grants
          WHERE is_grantable OR NOT (
            (object_kind = 'database' AND object_name = current_database()
              AND privilege_type = 'CONNECT')
            OR (object_kind = 'schema' AND object_name = 'jobs_public'
              AND privilege_type = 'USAGE')
            OR (object_kind = 'function'
              AND object_name = 'jobs_public.read_public_job_detail(requested_job_id uuid)'
              AND privilege_type = 'EXECUTE')
            OR (object_kind = 'function'
              AND object_name = 'jobs_public.read_public_job_sitemap(after_last_modified_at timestamp with time zone, after_job_id uuid, requested_limit integer)'
              AND privilege_type = 'EXECUTE')
          )
        ) AS "publicReaderDirectGrantViolationCount"
        , (
          WITH reader AS (
            SELECT oid FROM pg_roles WHERE rolname = 'ai_job_apply_public_job_reader'
          ), owned AS (
            SELECT datname AS object_name FROM pg_database
            WHERE datdba = (SELECT oid FROM reader)
            UNION ALL
            SELECT nspname FROM pg_namespace WHERE nspowner = (SELECT oid FROM reader)
            UNION ALL
            SELECT namespace.nspname || '.' || class.relname
            FROM pg_class AS class
            INNER JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
            WHERE class.relowner = (SELECT oid FROM reader)
            UNION ALL
            SELECT namespace.nspname || '.' || function_definition.proname
            FROM pg_proc AS function_definition
            INNER JOIN pg_namespace AS namespace ON namespace.oid = function_definition.pronamespace
            WHERE function_definition.proowner = (SELECT oid FROM reader)
            UNION ALL
            SELECT namespace.nspname || '.' || type_definition.typname
            FROM pg_type AS type_definition
            INNER JOIN pg_namespace AS namespace ON namespace.oid = type_definition.typnamespace
            WHERE type_definition.typowner = (SELECT oid FROM reader)
            UNION ALL
            SELECT oid::text FROM pg_largeobject_metadata
            WHERE lomowner = (SELECT oid FROM reader)
          )
          SELECT count(*)::int FROM owned
        ) AS "publicReaderOwnershipCount"
        , (
          SELECT count(*)::int
          FROM pg_db_role_setting
          WHERE setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND setrole = 'ai_job_apply_public_job_reader'::regrole
            AND setconfig = ARRAY['default_transaction_read_only=on']::text[]
        ) AS "publicReaderSettingCount"
        , (
          SELECT count(*)::int FROM pg_roles WHERE rolname = 'rds_iam'
        ) AS "rdsIamRoleCount"
        , (
          SELECT count(*)::int
          FROM pg_attribute AS attribute
          INNER JOIN pg_type AS data_type ON data_type.oid = attribute.atttypid
          WHERE attribute.attrelid = 'jobs.canonical_jobs'::regclass
            AND attribute.attname IN ('work_mode', 'employment_type')
            AND data_type.typname = 'text'
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND NOT attribute.attnotnull
            AND NOT attribute.atthasdef
            AND attribute.attgenerated = ''
            AND attribute.attidentity = ''
        ) AS "matchableColumnCount"
        , ARRAY(
          SELECT pg_get_constraintdef(constraint_definition.oid, true)
          FROM pg_constraint AS constraint_definition
          WHERE constraint_definition.conrelid = 'jobs.canonical_jobs'::regclass
            AND constraint_definition.conname IN (
              'canonical_jobs_work_mode_ck',
              'canonical_jobs_employment_type_ck'
            )
            AND constraint_definition.contype = 'c'
            AND constraint_definition.convalidated
            AND NOT constraint_definition.connoinherit
          ORDER BY constraint_definition.conname
        ) AS "matchableConstraintDefinitions"
        , (
          SELECT count(*)::int
          FROM pg_trigger trigger
          JOIN (VALUES
            ('jobs.job_reports'::regclass, 'job_reports_guard',
              'jobs.guard_job_report()'::regprocedure, 23::smallint),
            ('jobs.moderation_cases'::regclass, 'moderation_cases_guard',
              'jobs.guard_moderation_case()'::regprocedure, 31::smallint),
            ('jobs.moderation_cases'::regclass, 'moderation_cases_append_event',
              'jobs.append_moderation_event()'::regprocedure, 21::smallint),
            ('jobs.moderation_events'::regclass, 'moderation_events_append_only',
              'jobs.guard_moderation_event()'::regprocedure, 31::smallint)
          ) expected(table_oid, trigger_name, function_oid, trigger_type)
            ON expected.table_oid = trigger.tgrelid
           AND expected.trigger_name = trigger.tgname
           AND expected.function_oid = trigger.tgfoid
           AND expected.trigger_type = trigger.tgtype
          WHERE NOT trigger.tgisinternal AND trigger.tgenabled = 'O'
        ) AS "reportingTriggerCount"
        , (
          SELECT count(*)::int
          FROM pg_proc function_definition
          JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          JOIN pg_language language ON language.oid = function_definition.prolang
          WHERE namespace.nspname = 'jobs'
            AND function_definition.proname = ANY(${reportingTriggerFunctions as unknown as string[]})
            AND function_definition.pronargs = 0
            AND language.lanname = 'plpgsql'
            AND function_definition.provolatile = 'v'
            AND NOT function_definition.prosecdef
            AND function_definition.proconfig IS NULL
        ) AS "reportingTriggerFunctionCount"
        , ARRAY(
          SELECT function_definition.prosrc
          FROM unnest(${reportingTriggerFunctions as unknown as string[]}::text[])
            WITH ORDINALITY expected(function_name, ordinal)
          JOIN pg_proc function_definition ON function_definition.proname = expected.function_name
          JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          WHERE namespace.nspname = 'jobs' AND function_definition.pronargs = 0
          ORDER BY expected.ordinal
        ) AS "reportingTriggerFunctionBodies"
        , (
          SELECT count(*)::int
          FROM pg_indexes
          WHERE schemaname = 'jobs'
            AND indexname IN (
              'job_reports_owner_created_idx',
              'job_reports_canonical_reason_created_idx',
              'moderation_cases_open_job_uq',
              'moderation_cases_open_source_uq',
              'moderation_cases_source_control_idx',
              'moderation_events_occurred_idx'
            )
        ) AS "reportingIndexCount"
        , (
          SELECT count(*)::int
          FROM pg_indexes
          WHERE schemaname = 'jobs'
            AND indexname IN (
              'job_contributions_owner_idempotency_uq',
              'job_contributions_owner_created_idx',
              'job_contributions_queued_idx',
              'job_contribution_outbox_contribution_uq',
              'job_contribution_outbox_pending_idx'
            )
        ) AS "contributionIndexCount"
        , (
          SELECT count(*)::int
          FROM pg_trigger trigger
          JOIN (VALUES
            ('jobs.job_contributions'::regclass, 'job_contributions_queued_immutable',
              'jobs.guard_queued_job_contribution()'::regprocedure, 19::smallint),
            ('jobs.job_contribution_outbox'::regclass, 'job_contribution_outbox_append_only',
              'jobs.guard_job_contribution_outbox()'::regprocedure, 19::smallint),
            ('jobs.job_contributions'::regclass, 'job_contributions_candidate_delete_guard',
              'jobs.guard_candidate_job_contribution_delete()'::regprocedure, 11::smallint),
            ('jobs.job_contribution_outbox'::regclass,
              'job_contribution_outbox_candidate_delete_guard',
              'jobs.guard_candidate_job_contribution_outbox_delete()'::regprocedure, 11::smallint)
          ) expected(table_oid, trigger_name, function_oid, trigger_type)
            ON expected.table_oid = trigger.tgrelid
           AND expected.trigger_name = trigger.tgname
           AND expected.function_oid = trigger.tgfoid
           AND expected.trigger_type = trigger.tgtype
          WHERE NOT trigger.tgisinternal AND trigger.tgenabled = 'O'
        ) AS "contributionTriggerCount"
        , (
          SELECT count(*)::int
          FROM pg_constraint constraint_definition
          WHERE constraint_definition.contype = 'f'
            AND constraint_definition.conrelid IN (
              'jobs.job_contributions'::regclass,
              'jobs.job_contribution_outbox'::regclass
            )
        ) AS "contributionForeignKeyCount"
        , (
          SELECT count(*)::int
          FROM pg_constraint constraint_definition
          WHERE constraint_definition.contype = 'f'
            AND constraint_definition.conrelid IN (
              'jobs.job_contributions'::regclass,
              'jobs.job_contribution_outbox'::regclass
            )
            AND constraint_definition.confrelid IN (
              'jobs.canonical_jobs'::regclass,
              'jobs.job_sources'::regclass
            )
        ) AS "contributionCatalogForeignKeyCount"
        , (
          SELECT count(*)::int FROM pg_proc AS procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('jobs.guard_candidate_job_contribution_delete()'),
            to_regprocedure('jobs.guard_candidate_job_contribution_outbox_delete()'),
            to_regprocedure('jobs.export_candidate_data(uuid)'),
            to_regprocedure('jobs.delete_candidate_data(uuid,uuid)')
          ])
        ) AS "contributionCandidateRightsFunctionCount"
        , (
          SELECT count(*)::int FROM pg_proc AS procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('jobs.export_candidate_data(uuid)'),
            to_regprocedure('jobs.delete_candidate_data(uuid,uuid)')
          ]) AND procedure.prosecdef
        ) AS "contributionCandidateRightsSecurityDefinerCount"
        , (
          SELECT count(*)::int
          FROM pg_proc AS procedure
          CROSS JOIN LATERAL aclexplode(
            COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
          ) AS privilege
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('jobs.guard_candidate_job_contribution_delete()'),
            to_regprocedure('jobs.guard_candidate_job_contribution_outbox_delete()'),
            to_regprocedure('jobs.export_candidate_data(uuid)'),
            to_regprocedure('jobs.delete_candidate_data(uuid,uuid)')
          ]) AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
        ) AS "contributionCandidateRightsPublicExecuteViolationCount"
        , (
          SELECT count(*)::int FROM pg_proc AS procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('jobs.guard_candidate_job_contribution_delete()'),
            to_regprocedure('jobs.guard_candidate_job_contribution_outbox_delete()')
          ]) AND pg_get_functiondef(procedure.oid)
            LIKE '%privacy.current_candidate_deletion_authorized%'
        ) AS "contributionCandidateDeleteGuardBodyCount"
        , (
          SELECT count(*)::int
          FROM pg_indexes
          WHERE schemaname = 'jobs'
            AND indexname IN (
              'source_revalidation_queue_source_identity_uq',
              'source_revalidation_queue_claim_idx',
              'source_revalidation_queue_lease_idx',
              'source_revalidation_queue_job_idx',
              'source_verification_evidence_digest_uq',
              'source_verification_evidence_job_idx',
              'source_verification_evidence_source_idx'
            )
        ) AS "revalidationIndexCount"
        , (
          SELECT count(*)::int
          FROM pg_trigger trigger
          JOIN (VALUES
            ('jobs.source_revalidation_queue'::regclass, 'source_revalidation_queue_guard',
              'jobs.guard_source_revalidation_queue()'::regprocedure, 31::smallint),
            ('jobs.source_verification_evidence'::regclass,
              'source_verification_evidence_append_only',
              'jobs.guard_source_verification_evidence()'::regprocedure, 31::smallint)
          ) expected(table_oid, trigger_name, function_oid, trigger_type)
            ON expected.table_oid = trigger.tgrelid
           AND expected.trigger_name = trigger.tgname
           AND expected.function_oid = trigger.tgfoid
           AND expected.trigger_type = trigger.tgtype
          WHERE NOT trigger.tgisinternal AND trigger.tgenabled = 'O'
        ) AS "revalidationTriggerCount"
        , (
          SELECT count(*)::int
          FROM pg_proc function_definition
          JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          JOIN pg_language language ON language.oid = function_definition.prolang
          WHERE namespace.nspname = 'jobs'
            AND function_definition.proname = ANY(${revalidationTriggerFunctions as unknown as string[]})
            AND function_definition.pronargs = 0
            AND language.lanname = 'plpgsql'
            AND function_definition.provolatile = 'v'
            AND NOT function_definition.prosecdef
            AND function_definition.proconfig IS NULL
        ) AS "revalidationTriggerFunctionCount"
        , ARRAY(
          SELECT function_definition.prosrc
          FROM unnest(${revalidationTriggerFunctions as unknown as string[]}::text[])
            WITH ORDINALITY expected(function_name, ordinal)
          JOIN pg_proc function_definition ON function_definition.proname = expected.function_name
          JOIN pg_namespace namespace ON namespace.oid = function_definition.pronamespace
          WHERE namespace.nspname = 'jobs' AND function_definition.pronargs = 0
          ORDER BY expected.ordinal
        ) AS "revalidationTriggerFunctionBodies"
        , (
          SELECT count(*)::int
          FROM pg_constraint constraint_definition
          WHERE constraint_definition.contype = 'f'
            AND constraint_definition.conrelid IN (
              'jobs.source_revalidation_queue'::regclass,
              'jobs.source_verification_evidence'::regclass
            )
        ) AS "revalidationForeignKeyCount"
        , (
          SELECT count(*)::int FROM pg_class relation
          JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
          WHERE namespace.nspname = 'jobs' AND relation.relkind = 'r'
            AND relation.relname = ANY(ARRAY[
              'job_contribution_processing_queue',
              'job_contribution_normalizations',
              'job_contribution_independent_verifications',
              'job_contribution_trust_decisions',
              'job_contribution_state_events',
              'job_contribution_reconciliations',
              'job_contribution_processing_outbox',
              'job_contribution_processing_event_deliveries'
            ])
        ) AS "processingTableCount"
        , (
          SELECT count(*)::int FROM pg_trigger trigger
          WHERE NOT trigger.tgisinternal AND trigger.tgenabled = 'O'
            AND trigger.tgrelid = ANY(ARRAY[
              'jobs.job_contribution_processing_queue'::regclass,
              'jobs.job_contribution_normalizations'::regclass,
              'jobs.job_contribution_independent_verifications'::regclass,
              'jobs.job_contribution_trust_decisions'::regclass,
              'jobs.job_contribution_state_events'::regclass,
              'jobs.job_contribution_reconciliations'::regclass,
              'jobs.job_contribution_processing_outbox'::regclass,
              'jobs.job_contribution_processing_event_deliveries'::regclass
            ])
        ) AS "processingTriggerCount"
        , (
          SELECT count(*)::int FROM pg_proc procedure
          JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
          WHERE namespace.nspname = 'jobs' AND procedure.pronargs = 0
            AND procedure.proname = ANY(ARRAY[
              'guard_job_contribution_processing_append_only',
              'guard_job_contribution_verification_linkage',
              'guard_job_contribution_processing_queue',
              'guard_job_contribution_reconciliation',
              'guard_job_contribution_processing_event_delivery'
            ])
        ) AS "processingTriggerFunctionCount"
        , (
          SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = 'jobs'
            AND table_name = 'job_contribution_independent_verifications'
            AND column_name = 'provider_observation' AND data_type = 'jsonb'
            AND is_nullable = 'NO'
        ) AS "processingProviderObservationColumnCount"
        , (
          SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = 'jobs'
            AND table_name IN (
              'job_contribution_independent_verifications',
              'job_contribution_reconciliations'
            )
            AND column_name IN ('job_id', 'source_id') AND is_nullable = 'YES'
        ) AS "processingNullableCatalogColumnCount"
        , (
          SELECT count(*)::int FROM pg_constraint constraint_definition
          WHERE constraint_definition.contype = 'f'
            AND constraint_definition.conrelid IN (
              'jobs.job_contribution_independent_verifications'::regclass,
              'jobs.job_contribution_reconciliations'::regclass
            )
            AND constraint_definition.confrelid IN (
              'jobs.canonical_jobs'::regclass,
              'jobs.job_sources'::regclass
            )
        ) AS "processingCatalogForeignKeyCount"
        , (
          SELECT count(*)::int FROM pg_constraint constraint_definition
          WHERE constraint_definition.conrelid IN (
              'jobs.job_contribution_independent_verifications'::regclass,
              'jobs.job_contribution_reconciliations'::regclass
            )
            AND constraint_definition.conname = ANY(ARRAY[
              'job_contribution_independent_verifications_catalog_identity_ck',
              'job_contribution_independent_verifications_observation_ck',
              'job_contribution_reconciliations_catalog_identity_ck',
              'job_contribution_reconciliations_applied_identity_ck'
            ])
        ) AS "processingPublicationConstraintCount"
    `;
    if (
      verification?.tableCount !== 26 ||
      verification.migrationCount !== migrationVersions.length ||
      verification.identityIndexCount !== 3 ||
      verification.sourceWithdrawalColumnCount !== 1 ||
      verification.sourceWithdrawalIndexCount !== 1 ||
      JSON.stringify(verification.sourceWithdrawalConstraintDefinitions) !==
        JSON.stringify([
          "CHECK (withdrawn_at IS NULL OR withdrawn_at >= first_observed_at AND withdrawn_at <= last_verified_at)",
        ]) ||
      verification.moderationIndexCount !== 2 ||
      verification.searchIndexCount !== 4 ||
      !verification.searchColumnPresent ||
      verification.searchTriggerCount !== 3 ||
      verification.ingestionTriggerCount !== 4 ||
      verification.ingestionTriggerFunctionCount !== 4 ||
      JSON.stringify(verification.ingestionTriggerFunctionBodies) !==
        JSON.stringify(expectedIngestionTriggerBodies) ||
      verification.ingestionIndexCount !== 3 ||
      verification.ingestionForeignKeyCount !== 3 ||
      JSON.stringify(verification.ingestionSourceConstraintDefinitions) !==
        JSON.stringify([
          "CHECK (schema_version = 1 AND source_id ~ '^[a-z0-9][a-z0-9-]{2,63}$'::text AND adapter_version ~ '^[a-z0-9][a-z0-9._-]{2,99}$'::text AND revision >= 0 AND revision <= '9007199254740991'::bigint AND attempt >= 1 AND attempt <= 5 AND withdrawal_inferred = false AND updated_at >= created_at)",
        ]) ||
      verification.publicSchemaCount !== 1 ||
      verification.publicReaderRoleCount !== 1 ||
      verification.publicReaderFunctionCount !== 1 ||
      verification.publicReaderFunctionBody !== expectedPublicReaderBody ||
      verification.publicSitemapFunctionCount !== 1 ||
      verification.publicSitemapFunctionBody !== expectedPublicSitemapBody ||
      verification.publicReaderGrantCount !== 9 ||
      verification.publicReaderMembershipViolationCount !== 0 ||
      verification.publicReaderMembershipCount !== verification.rdsIamRoleCount ||
      verification.publicReaderDirectGrantViolationCount !== 0 ||
      verification.publicReaderOwnershipCount !== 0 ||
      verification.publicReaderSettingCount !== 1 ||
      verification.matchableColumnCount !== 2 ||
      JSON.stringify(verification.matchableConstraintDefinitions) !==
        JSON.stringify([
          "CHECK (employment_type IS NULL OR (employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text, 'contract'::text, 'internship'::text, 'unknown'::text])))",
          "CHECK (work_mode IS NULL OR (work_mode = ANY (ARRAY['remote'::text, 'hybrid'::text, 'on_site'::text, 'unknown'::text])))",
        ]) ||
      verification.reportingTriggerCount !== 4 ||
      verification.reportingTriggerFunctionCount !== 4 ||
      JSON.stringify(verification.reportingTriggerFunctionBodies) !==
        JSON.stringify(expectedReportingTriggerBodies) ||
      verification.reportingIndexCount !== 6 ||
      verification.contributionIndexCount !== 5 ||
      verification.contributionTriggerCount !== 4 ||
      verification.contributionForeignKeyCount !== 1 ||
      verification.contributionCatalogForeignKeyCount !== 0 ||
      verification.contributionCandidateRightsFunctionCount !== 4 ||
      verification.contributionCandidateRightsSecurityDefinerCount !== 2 ||
      verification.contributionCandidateRightsPublicExecuteViolationCount !== 0 ||
      verification.contributionCandidateDeleteGuardBodyCount !== 2 ||
      verification.revalidationIndexCount !== 7 ||
      verification.revalidationTriggerCount !== 2 ||
      verification.revalidationTriggerFunctionCount !== 2 ||
      JSON.stringify(verification.revalidationTriggerFunctionBodies) !==
        JSON.stringify(expectedRevalidationTriggerBodies) ||
      verification.revalidationForeignKeyCount !== 4 ||
      verification.processingTableCount !== 8 ||
      verification.processingTriggerCount !== 8 ||
      verification.processingTriggerFunctionCount !== 5 ||
      verification.processingProviderObservationColumnCount !== 1 ||
      verification.processingNullableCatalogColumnCount !== 4 ||
      verification.processingCatalogForeignKeyCount !== 4 ||
      verification.processingPublicationConstraintCount !== 4
    ) {
      throw new Error(
        `Jobs database migration verification failed: ${JSON.stringify({
          tableCount: verification?.tableCount,
          migrationCount: verification?.migrationCount,
          identityIndexCount: verification?.identityIndexCount,
          sourceWithdrawalColumnCount: verification?.sourceWithdrawalColumnCount,
          sourceWithdrawalIndexCount: verification?.sourceWithdrawalIndexCount,
          sourceWithdrawalConstraintDefinitions:
            verification?.sourceWithdrawalConstraintDefinitions,
          moderationIndexCount: verification?.moderationIndexCount,
          searchIndexCount: verification?.searchIndexCount,
          searchColumnPresent: verification?.searchColumnPresent,
          searchTriggerCount: verification?.searchTriggerCount,
          ingestionTriggerCount: verification?.ingestionTriggerCount,
          ingestionTriggerFunctionCount: verification?.ingestionTriggerFunctionCount,
          ingestionTriggerBodiesMatch:
            JSON.stringify(verification?.ingestionTriggerFunctionBodies) ===
            JSON.stringify(expectedIngestionTriggerBodies),
          ingestionIndexCount: verification?.ingestionIndexCount,
          ingestionForeignKeyCount: verification?.ingestionForeignKeyCount,
          ingestionSourceConstraintDefinitions: verification?.ingestionSourceConstraintDefinitions,
          publicSchemaCount: verification?.publicSchemaCount,
          publicReaderRoleCount: verification?.publicReaderRoleCount,
          publicReaderFunctionCount: verification?.publicReaderFunctionCount,
          publicReaderFunctionBodyMatches:
            verification?.publicReaderFunctionBody === expectedPublicReaderBody,
          publicSitemapFunctionCount: verification?.publicSitemapFunctionCount,
          publicSitemapFunctionBodyMatches:
            verification?.publicSitemapFunctionBody === expectedPublicSitemapBody,
          publicReaderGrantCount: verification?.publicReaderGrantCount,
          publicReaderMembershipViolationCount: verification?.publicReaderMembershipViolationCount,
          publicReaderMembershipCount: verification?.publicReaderMembershipCount,
          rdsIamRoleCount: verification?.rdsIamRoleCount,
          publicReaderDirectGrantViolationCount:
            verification?.publicReaderDirectGrantViolationCount,
          publicReaderOwnershipCount: verification?.publicReaderOwnershipCount,
          publicReaderSettingCount: verification?.publicReaderSettingCount,
          matchableColumnCount: verification?.matchableColumnCount,
          matchableConstraintDefinitions: verification?.matchableConstraintDefinitions,
          reportingTriggerCount: verification?.reportingTriggerCount,
          reportingTriggerFunctionCount: verification?.reportingTriggerFunctionCount,
          reportingTriggerBodiesMatch:
            JSON.stringify(verification?.reportingTriggerFunctionBodies) ===
            JSON.stringify(expectedReportingTriggerBodies),
          reportingIndexCount: verification?.reportingIndexCount,
          contributionIndexCount: verification?.contributionIndexCount,
          contributionTriggerCount: verification?.contributionTriggerCount,
          contributionForeignKeyCount: verification?.contributionForeignKeyCount,
          contributionCatalogForeignKeyCount: verification?.contributionCatalogForeignKeyCount,
          contributionCandidateRightsFunctionCount:
            verification?.contributionCandidateRightsFunctionCount,
          contributionCandidateRightsSecurityDefinerCount:
            verification?.contributionCandidateRightsSecurityDefinerCount,
          contributionCandidateRightsPublicExecuteViolationCount:
            verification?.contributionCandidateRightsPublicExecuteViolationCount,
          contributionCandidateDeleteGuardBodyCount:
            verification?.contributionCandidateDeleteGuardBodyCount,
          revalidationIndexCount: verification?.revalidationIndexCount,
          revalidationTriggerCount: verification?.revalidationTriggerCount,
          revalidationTriggerFunctionCount: verification?.revalidationTriggerFunctionCount,
          revalidationTriggerBodiesMatch:
            JSON.stringify(verification?.revalidationTriggerFunctionBodies) ===
            JSON.stringify(expectedRevalidationTriggerBodies),
          revalidationForeignKeyCount: verification?.revalidationForeignKeyCount,
          processingTableCount: verification?.processingTableCount,
          processingTriggerCount: verification?.processingTriggerCount,
          processingTriggerFunctionCount: verification?.processingTriggerFunctionCount,
          processingProviderObservationColumnCount:
            verification?.processingProviderObservationColumnCount,
          processingNullableCatalogColumnCount: verification?.processingNullableCatalogColumnCount,
          processingCatalogForeignKeyCount: verification?.processingCatalogForeignKeyCount,
          processingPublicationConstraintCount: verification?.processingPublicationConstraintCount,
        })}`,
      );
    }
  });
  const reprocessingMigration = migrations.find(
    (migration) => migration.version === "0020_contribution_trust_reprocessing",
  );
  if (!reprocessingMigration) throw new Error("Trust reprocessing migration is missing");
  const refreshMigration = migrations.find(
    (migration) => migration.version === "0023_contribution_verification_refresh",
  );
  if (!refreshMigration) throw new Error("Contribution refresh migration is missing");
  for (const [name, args, language] of [
    ["contribution_requires_trust_processing", 2, "sql"],
    ["guard_job_contribution_processing_queue", 0, "plpgsql"],
  ] as const) {
    const source = new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION jobs\\.${name}\\([\\s\\S]*?AS \\$\\$([\\s\\S]*?)\\$\\$;`,
      "u",
    ).exec(
      name === "guard_job_contribution_processing_queue"
        ? refreshMigration.sql
        : reprocessingMigration.sql,
    )?.[1];
    const [actual] = await client<Array<{ body: string }>>`
      SELECT procedure.prosrc AS body FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      JOIN pg_language AS language ON language.oid = procedure.prolang
      WHERE namespace.nspname = 'jobs' AND procedure.proname = ${name}
        AND procedure.pronargs = ${args} AND language.lanname = ${language}
        AND NOT procedure.prosecdef AND procedure.proconfig IS NULL
    `;
    if (!source || actual?.body !== source)
      throw new Error("Trust reprocessing function verification failed");
  }
  const [marker] = await client<Array<{ present: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'jobs' AND table_name = 'job_contribution_processing_queue'
        AND column_name = 'completed_trust_decision_id' AND data_type = 'uuid'
        AND is_nullable = 'YES') AS present
  `;
  if (!marker?.present) throw new Error("Trust reprocessing decision marker is missing");
  const [refreshShape] = await client<
    Array<{
      columns: number;
      constraints: number;
      singletonConstraints: number;
      latestIndex: boolean;
    }>
  >`
    SELECT (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'jobs' AND (
      (table_name = 'job_contribution_processing_queue' AND column_name IN
        ('verification_refresh_attempts','last_verification_refresh_at','verification_refresh_outcome')) OR
      (table_name = 'job_contribution_trust_decisions' AND column_name = 'evidence_digest_sha256')
    )) AS columns,
    (SELECT count(*)::int FROM pg_constraint WHERE connamespace = 'jobs'::regnamespace AND convalidated
      AND conname IN ('job_contribution_verification_digest_uq','job_contribution_verification_refresh_ck',
        'job_contribution_trust_decisions_evidence_ck')) AS constraints,
    (SELECT count(*)::int FROM pg_constraint
      WHERE conrelid = 'jobs.job_contribution_independent_verifications'::regclass
        AND conname IN ('job_contribution_independent_verifications_contribution_id_key',
          'job_contribution_independent_verifications_normalization_id_key')) AS "singletonConstraints",
    EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = 'jobs.job_contribution_verification_latest_idx'::regclass
      AND indisvalid AND indisready AND indrelid = 'jobs.job_contribution_independent_verifications'::regclass) AS "latestIndex"
  `;
  if (
    refreshShape?.columns !== 4 ||
    refreshShape.constraints !== 3 ||
    refreshShape.singletonConstraints !== 0 ||
    !refreshShape.latestIndex
  )
    throw new Error("Contribution verification refresh shape is invalid");
  const leaseMigration = migrations.find(
    (migration) => migration.version === "0022_development_contribution_provider_leases",
  );
  const expectedLeaseGuard =
    leaseMigration &&
    /CREATE OR REPLACE FUNCTION jobs\.guard_job_contribution_reconciliation\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$;/u.exec(
      leaseMigration.sql,
    )?.[1];
  const [leaseGuard] = await client<Array<{ body: string }>>`
    SELECT procedure.prosrc AS body FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    JOIN pg_language AS language ON language.oid = procedure.prolang
    WHERE namespace.nspname = 'jobs' AND procedure.proname = 'guard_job_contribution_reconciliation'
      AND procedure.pronargs = 0 AND language.lanname = 'plpgsql'
      AND NOT procedure.prosecdef AND procedure.proconfig IS NULL
  `;
  if (!expectedLeaseGuard || leaseGuard?.body !== expectedLeaseGuard) {
    throw new Error("Development contribution operation lease guard verification failed");
  }
  const [leaseChronology] = await client<Array<{ definition: string; validated: boolean }>>`
    SELECT pg_get_constraintdef(oid, true) AS definition, convalidated AS validated
    FROM pg_constraint
    WHERE conrelid = 'jobs.job_contribution_reconciliations'::regclass
      AND conname = 'job_contribution_reconciliations_chronology_ck' AND contype = 'c'
  `;
  const expectedLeaseChronology =
    "CHECK (updated_at >= created_at AND capability_expires_at > capability_evaluated_at AND (capability_evaluated_at <= created_at OR kind = 'publication'::text AND (capability_policy_version = 'd2-development-greenhouse-v1'::text AND capability_configuration_digest_sha256 = '8405c7ba82d4d5d127b9bfb0f2f753533d6709d0b89e148a02a1db89c03f1f3b'::text OR capability_policy_version = 'd2-development-lever-v1'::text AND capability_configuration_digest_sha256 = '73a8de43f172d1af75c19e355774ccbb63c10d08485b5cabeb8df524571c3d5c'::text OR capability_policy_version = 'd2-development-ashby-v1'::text AND capability_configuration_digest_sha256 = '5b03a431328af9850b9c08bd8f1508089e4de2d2c31f91b490ebb63a573ae8f5'::text) AND capability_evaluated_at <= updated_at AND capability_expires_at = (capability_evaluated_at + '00:01:00'::interval)))";
  if (!leaseChronology?.validated || leaseChronology.definition !== expectedLeaseChronology) {
    throw new Error("Development contribution operation lease chronology verification failed");
  }
  console.log(`Jobs migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
