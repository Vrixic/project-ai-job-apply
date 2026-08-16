import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationVersions = ["0001_entitlement_projection"] as const;
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
      CREATE SCHEMA IF NOT EXISTS billing;
      CREATE TABLE IF NOT EXISTS billing.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await transaction`SELECT pg_advisory_xact_lock(hashtext('ai-job-apply:billing-migrations'))`;
    for (const migration of migrations) {
      const [existing] = await transaction<{ checksum: string }[]>`
        SELECT checksum FROM billing.schema_migrations WHERE version = ${migration.version}
      `;
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }
      if (!existing) {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO billing.schema_migrations (version, checksum)
          VALUES (${migration.version}, ${migration.checksum})
        `;
      }
    }
    const [verification] = await transaction<
      {
        relationCount: number;
        appendOnlyTriggerCount: number;
        supportingIndexCount: number;
        foreignKeyCount: number;
      }[]
    >`
      SELECT
        ((to_regclass('billing.entitlement_accounts') IS NOT NULL)::int +
         (to_regclass('billing.entitlement_changes') IS NOT NULL)::int +
         (to_regclass('billing.entitlement_outbox') IS NOT NULL)::int +
         (to_regclass('billing.entitlement_command_receipts') IS NOT NULL)::int +
         (to_regclass('billing.schema_migrations') IS NOT NULL)::int)::int AS "relationCount",
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgname IN (
            'entitlement_changes_immutable',
            'entitlement_changes_chronology_guard',
            'entitlement_accounts_chronology_guard',
            'entitlement_command_receipts_immutable',
            'entitlement_outbox_payload_immutable',
            'entitlement_outbox_delete_forbidden'
          ) AND NOT tgisinternal) AS "appendOnlyTriggerCount",
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'billing' AND indexname IN (
            'entitlement_changes_user_occurred_idx',
            'entitlement_outbox_pending_idx',
            'entitlement_outbox_processing_lease_idx'
          )) AS "supportingIndexCount",
        (SELECT count(*)::int FROM pg_constraint
          WHERE connamespace = 'billing'::regnamespace AND conname IN (
            'entitlement_changes_account_fk',
            'entitlement_outbox_account_fk',
            'entitlement_outbox_change_fk',
            'entitlement_command_account_fk',
            'entitlement_command_change_fk',
            'entitlement_command_outbox_fk'
          ) AND contype = 'f') AS "foreignKeyCount"
    `;
    if (
      verification?.relationCount !== 5 ||
      verification.appendOnlyTriggerCount !== 6 ||
      verification.supportingIndexCount !== 3 ||
      verification.foreignKeyCount !== 6
    ) {
      throw new Error("Billing entitlement migration verification failed");
    }
  });
  console.log("Billing migrations through 0001_entitlement_projection applied and verified.");
} finally {
  await client.end();
}
