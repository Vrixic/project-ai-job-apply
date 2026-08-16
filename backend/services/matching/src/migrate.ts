import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationVersions = ["0001_saved_jobs"] as const;
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
      CREATE SCHEMA IF NOT EXISTS matching;
      CREATE TABLE IF NOT EXISTS matching.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await transaction`SELECT pg_advisory_xact_lock(hashtext('ai-job-apply:matching-migrations'))`;
    for (const migration of migrations) {
      const [existing] = await transaction<{ checksum: string }[]>`
        SELECT checksum FROM matching.schema_migrations WHERE version = ${migration.version}
      `;
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }
      if (!existing) {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO matching.schema_migrations (version, checksum)
          VALUES (${migration.version}, ${migration.checksum})
        `;
      }
    }
    const [verification] = await transaction<
      { tableCount: number; auditTriggerCount: number; supportingIndexCount: number }[]
    >`
      SELECT
        ((to_regclass('matching.saved_jobs') IS NOT NULL)::int +
         (to_regclass('matching.saved_job_list_state') IS NOT NULL)::int +
         (to_regclass('matching.idempotency_keys') IS NOT NULL)::int +
         (to_regclass('matching.audit_events') IS NOT NULL)::int +
         (to_regclass('matching.schema_migrations') IS NOT NULL)::int)::int AS "tableCount",
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgname = 'matching_audit_events_immutable' AND NOT tgisinternal) AS "auditTriggerCount",
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'matching' AND indexname IN (
            'saved_jobs_owner_page_idx',
            'matching_idempotency_keys_owner_expiry_idx'
          )) AS "supportingIndexCount"
    `;
    if (
      verification?.tableCount !== 5 ||
      verification.auditTriggerCount !== 1 ||
      verification.supportingIndexCount !== 2
    ) {
      throw new Error("Matching saved-job migration verification failed");
    }
  });
  console.log("Matching migrations through 0001_saved_jobs applied and verified.");
} finally {
  await client.end();
}
