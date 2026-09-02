import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationVersions = ["0001_ugc_trust_foundation"] as const;
const migrations = await Promise.all(
  migrationVersions.map(async (version) => {
    const path = fileURLToPath(new URL(`../../migrations/${version}.sql`, import.meta.url));
    const sql = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
    return { version, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }),
);

const client = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
try {
  await client.begin(async (transaction) => {
    await transaction.unsafe(`
      CREATE SCHEMA IF NOT EXISTS trust;
      CREATE TABLE IF NOT EXISTS trust.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await transaction`SELECT pg_advisory_xact_lock(hashtext('ai-job-apply:trust-migrations'))`;
    for (const migration of migrations) {
      const [existing] = await transaction<{ checksum: string }[]>`
        SELECT checksum FROM trust.schema_migrations WHERE version = ${migration.version}
      `;
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }
      if (!existing) {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO trust.schema_migrations (version, checksum)
          VALUES (${migration.version}, ${migration.checksum})
        `;
      }
    }
    const [verification] = await transaction<
      { tableCount: number; triggerCount: number; indexCount: number; migrationCount: number }[]
    >`
      SELECT
        ((to_regclass('trust.schema_migrations') IS NOT NULL)::int
          + (to_regclass('trust.contribution_cases') IS NOT NULL)::int
          + (to_regclass('trust.case_events') IS NOT NULL)::int
          + (to_regclass('trust.reputation_evidence') IS NOT NULL)::int)::int AS "tableCount",
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgname IN ('contribution_cases_guard', 'contribution_cases_append_event',
            'case_events_immutable', 'reputation_evidence_guard') AND NOT tgisinternal
        ) AS "triggerCount",
        (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'trust'
          AND indexname IN ('contribution_cases_owner_updated_idx',
            'contribution_cases_review_queue_idx', 'case_events_contribution_occurred_idx',
            'reputation_evidence_contributor_idx', 'reputation_evidence_source_idx')
        ) AS "indexCount",
        (SELECT count(*)::int FROM trust.schema_migrations
          WHERE version = ANY(${migrationVersions as unknown as string[]})) AS "migrationCount"
    `;
    if (
      verification?.tableCount !== 4 ||
      verification.triggerCount !== 4 ||
      verification.indexCount !== 5 ||
      verification.migrationCount !== migrationVersions.length
    ) {
      throw new Error(`Trust migration verification failed: ${JSON.stringify(verification)}`);
    }
  });
  console.log(`Trust migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
