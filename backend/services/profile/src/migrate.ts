import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const migrationVersion = "0001_foundation";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationPath = fileURLToPath(
  new URL("../../migrations/0001_foundation.sql", import.meta.url),
);
const migration = await readFile(migrationPath, "utf8");
const normalizedMigration = migration.replaceAll("\r\n", "\n");
const checksum = createHash("sha256").update(normalizedMigration).digest("hex");
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

    const existing = await transaction<{ checksum: string }[]>`
      SELECT checksum
      FROM platform.schema_migrations
      WHERE version = ${migrationVersion}
    `;
    if (existing.length > 0 && existing[0]?.checksum !== checksum) {
      throw new Error(`Migration ${migrationVersion} checksum mismatch`);
    }

    if (existing.length === 0) {
      await transaction.unsafe(normalizedMigration);
      await transaction`
        INSERT INTO platform.schema_migrations (version, checksum)
        VALUES (${migrationVersion}, ${checksum})
      `;
    }

    const [verification] = await transaction<{ table_count: number }[]>`
      SELECT (
        (to_regclass('identity.users') IS NOT NULL)::int +
        (to_regclass('identity.external_identities') IS NOT NULL)::int +
        (to_regclass('profile.job_preferences') IS NOT NULL)::int +
        (to_regclass('platform.operations') IS NOT NULL)::int +
        (to_regclass('platform.outbox_events') IS NOT NULL)::int +
        (to_regclass('platform.idempotency_keys') IS NOT NULL)::int +
        (to_regclass('platform.audit_events') IS NOT NULL)::int +
        (to_regclass('platform.schema_migrations') IS NOT NULL)::int
      )::int AS table_count
    `;
    if (verification?.table_count !== 8) {
      throw new Error(`Migration ${migrationVersion} verification failed`);
    }
  });
  console.log(`Database migration ${migrationVersion} applied and verified.`);
} finally {
  await client.end();
}
