import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationVersions = ["0001_applications_foundation"] as const;
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
      CREATE SCHEMA IF NOT EXISTS applications;
      CREATE TABLE IF NOT EXISTS applications.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await transaction`SELECT pg_advisory_xact_lock(hashtext('ai-job-apply:applications-migrations'))`;
    for (const migration of migrations) {
      const [existing] = await transaction<{ checksum: string }[]>`
        SELECT checksum FROM applications.schema_migrations WHERE version = ${migration.version}
      `;
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }
      if (!existing) {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO applications.schema_migrations (version, checksum)
          VALUES (${migration.version}, ${migration.checksum})
        `;
      }
    }
    const [verification] = await transaction<
      { relationCount: number; guardTriggerCount: number; supportingIndexCount: number }[]
    >`
      SELECT
        ((to_regclass('applications.applications') IS NOT NULL)::int +
         (to_regclass('applications.packets') IS NOT NULL)::int +
         (to_regclass('applications.approvals') IS NOT NULL)::int +
         (to_regclass('applications.attempts') IS NOT NULL)::int +
         (to_regclass('applications.history') IS NOT NULL)::int +
         (to_regclass('applications.command_receipts') IS NOT NULL)::int +
         (to_regclass('applications.outbox') IS NOT NULL)::int +
         (to_regclass('applications.schema_migrations') IS NOT NULL)::int)::int AS "relationCount",
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgname IN (
            'packets_immutable', 'history_immutable', 'command_receipts_immutable',
            'applications_transition_guard', 'approvals_update_guard', 'approvals_delete_forbidden',
            'attempts_update_guard', 'attempts_delete_forbidden', 'outbox_payload_immutable',
            'outbox_delete_forbidden'
          ) AND NOT tgisinternal) AS "guardTriggerCount",
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'applications' AND indexname IN (
            'applications_owner_job_live_uq', 'applications_owner_updated_idx',
            'approvals_application_live_uq', 'attempts_scope_holding_uq', 'attempts_application_idx',
            'history_owner_application_idx', 'outbox_pending_idx', 'outbox_processing_lease_idx'
          )) AS "supportingIndexCount"
    `;
    if (
      verification?.relationCount !== 8 ||
      verification.guardTriggerCount !== 10 ||
      verification.supportingIndexCount !== 8
    ) {
      throw new Error("Applications migration verification failed");
    }
  });
  console.log(`Applications migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
