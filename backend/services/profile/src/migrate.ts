import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationVersions = [
  "0001_foundation",
  "0002_serverless_outbox",
  "0003_retire_legacy_dispatch",
  "0004_profile_fact_versions",
  "0005_resume_fact_proposals",
  "0006_candidate_rights",
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
const client = postgres(databaseUrl, {
  max: 1,
  onnotice: () => undefined,
});
try {
  await client.begin(async (transaction) => {
    await transaction.unsafe(`
      CREATE SCHEMA IF NOT EXISTS platform;
      CREATE TABLE IF NOT EXISTS platform.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await transaction`
      SELECT pg_advisory_xact_lock(hashtext('ai-job-apply:profile-migrations'))
    `;

    for (const migration of migrations) {
      const existing = await transaction<{ checksum: string }[]>`
        SELECT checksum
        FROM platform.schema_migrations
        WHERE version = ${migration.version}
      `;
      if (existing.length > 0 && existing[0]?.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }

      if (existing.length === 0) {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO platform.schema_migrations (version, checksum)
          VALUES (${migration.version}, ${migration.checksum})
        `;
      }
    }

    const [verification] = await transaction<
      {
        table_count: number;
        migration_count: number;
        outbox_column_count: number;
        profile_fact_trigger_count: number;
      }[]
    >`
      SELECT (
        (to_regclass('identity.users') IS NOT NULL)::int +
        (to_regclass('identity.external_identities') IS NOT NULL)::int +
        (to_regclass('profile.job_preferences') IS NOT NULL)::int +
        (to_regclass('profile.profile_facts') IS NOT NULL)::int +
        (to_regclass('profile.profile_fact_versions') IS NOT NULL)::int +
        (to_regclass('profile.resume_fact_imports') IS NOT NULL)::int +
        (to_regclass('profile.profile_fact_evidence') IS NOT NULL)::int +
        (to_regclass('platform.operations') IS NOT NULL)::int +
        (to_regclass('platform.outbox_events') IS NOT NULL)::int +
        (to_regclass('platform.idempotency_keys') IS NOT NULL)::int +
        (to_regclass('platform.audit_events') IS NOT NULL)::int +
        (to_regclass('platform.schema_migrations') IS NOT NULL)::int +
        (to_regclass('profile.candidate_data_exports') IS NOT NULL)::int +
        (to_regclass('profile.account_deletion_requests') IS NOT NULL)::int +
        (to_regclass('privacy.account_deletion_ledger') IS NOT NULL)::int
      )::int AS table_count,
      (
        SELECT count(*)::int
        FROM platform.schema_migrations
        WHERE version = ANY(${migrationVersions as unknown as string[]})
      ) AS migration_count,
      (
        SELECT count(*)::int
        FROM information_schema.columns
        WHERE table_schema = 'platform'
          AND table_name = 'outbox_events'
          AND column_name IN (
            'dispatch_target',
            'nudge_attempts',
            'nudge_claimed_at',
            'nudge_next_attempt_at',
            'nudged_at',
            'nudge_last_error_code',
            'durable_start_attempts',
            'durable_started_at',
            'durable_execution_name',
            'durable_execution_arn',
            'durable_last_error_code'
          )
      ) AS outbox_column_count,
      (
        SELECT count(*)::int
        FROM pg_trigger
        WHERE tgrelid = 'profile.profile_fact_versions'::regclass
          AND tgname = 'profile_fact_versions_reject_update'
          AND NOT tgisinternal
      ) AS profile_fact_trigger_count
    `;
    if (
      verification?.table_count !== 15 ||
      verification.migration_count !== migrationVersions.length ||
      verification.outbox_column_count !== 11 ||
      verification.profile_fact_trigger_count !== 1
    ) {
      throw new Error("Database migration verification failed");
    }
  });
  console.log(`Database migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
