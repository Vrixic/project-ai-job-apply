import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationVersions = ["0001_inbox_and_preferences", "0002_candidate_rights"] as const;
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
      CREATE SCHEMA IF NOT EXISTS notifications;
      CREATE TABLE IF NOT EXISTS notifications.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await transaction`SELECT pg_advisory_xact_lock(hashtext('ai-job-apply:notifications-migrations'))`;
    for (const migration of migrations) {
      const [existing] = await transaction<{ checksum: string }[]>`
        SELECT checksum FROM notifications.schema_migrations WHERE version = ${migration.version}
      `;
      if (existing && existing.checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }
      if (!existing) {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO notifications.schema_migrations (version, checksum)
          VALUES (${migration.version}, ${migration.checksum})
        `;
      }
    }
    const [verification] = await transaction<
      {
        relationCount: number;
        indexCount: number;
        migrationCount: number;
        rightsFunctionCount: number;
        rightsPublicExecuteViolationCount: number;
      }[]
    >`
      SELECT
        ((to_regclass('notifications.source_receipts') IS NOT NULL)::int +
         (to_regclass('notifications.source_cursors') IS NOT NULL)::int +
         (to_regclass('notifications.inbox_items') IS NOT NULL)::int +
         (to_regclass('notifications.preferences') IS NOT NULL)::int +
         (to_regclass('notifications.schema_migrations') IS NOT NULL)::int)::int AS "relationCount",
        (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'notifications'
          AND indexname IN ('source_receipts_owner_idx', 'inbox_items_owner_state_idx',
            'inbox_items_aggregate_idx', 'inbox_items_expiry_idx')) AS "indexCount",
        (SELECT count(*)::int FROM notifications.schema_migrations
          WHERE version = ANY(${migrationVersions as unknown as string[]})) AS "migrationCount",
        (SELECT count(*)::int FROM pg_proc procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('notifications.export_candidate_data(uuid)'),
            to_regprocedure('notifications.delete_candidate_data(uuid,uuid)')
          ]) AND procedure.prosecdef) AS "rightsFunctionCount",
        (SELECT count(*)::int
          FROM pg_proc procedure
          CROSS JOIN LATERAL aclexplode(
            COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
          ) AS privilege
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('notifications.export_candidate_data(uuid)'),
            to_regprocedure('notifications.delete_candidate_data(uuid,uuid)')
          ]) AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
        ) AS "rightsPublicExecuteViolationCount"
    `;
    if (
      verification?.relationCount !== 5 ||
      verification.indexCount !== 4 ||
      verification.migrationCount !== migrationVersions.length ||
      verification.rightsFunctionCount !== 2 ||
      verification.rightsPublicExecuteViolationCount !== 0
    ) {
      throw new Error(
        `Notifications migration verification failed: ${JSON.stringify(verification)}`,
      );
    }
  });
  console.log(`Notifications migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
