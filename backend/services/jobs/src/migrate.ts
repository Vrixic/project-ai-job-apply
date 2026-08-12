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

    const [verification] = await transaction<
      {
        tableCount: number;
        migrationCount: number;
        identityIndexCount: number;
        moderationIndexCount: number;
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
          (to_regclass('jobs.schema_migrations') IS NOT NULL)::int
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
          SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'jobs'
            AND indexname IN (
              'duplicate_candidates_exact_loser_uq',
              'duplicate_resolution_events_pair_occurred_idx'
            )
        ) AS "moderationIndexCount"
    `;
    if (
      verification?.tableCount !== 7 ||
      verification.migrationCount !== migrationVersions.length ||
      verification.identityIndexCount !== 3 ||
      verification.moderationIndexCount !== 2
    ) {
      throw new Error("Jobs database migration verification failed");
    }
  });
  console.log(`Jobs migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
