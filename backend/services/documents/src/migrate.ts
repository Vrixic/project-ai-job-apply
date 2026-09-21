import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const migrationVersions = [
  "0001_resume_intake",
  "0002_resume_processing",
  "0003_candidate_rights",
  "0004_resume_deletion",
  "0005_resume_purge",
] as const;
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
      CREATE SCHEMA IF NOT EXISTS documents;
      CREATE TABLE IF NOT EXISTS documents.schema_migrations (
        version text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await transaction`
      SELECT pg_advisory_xact_lock(hashtext('ai-job-apply:documents-migrations'))
    `;
    for (const migration of migrations) {
      const existing = await transaction<{ checksum: string }[]>`
        SELECT checksum FROM documents.schema_migrations WHERE version = ${migration.version}
      `;
      if (existing[0] && existing[0].checksum !== migration.checksum) {
        throw new Error(`Migration ${migration.version} checksum mismatch`);
      }
      if (!existing[0]) {
        await transaction.unsafe(migration.sql);
        await transaction`
          INSERT INTO documents.schema_migrations (version, checksum)
          VALUES (${migration.version}, ${migration.checksum})
        `;
      }
    }

    const [verification] = await transaction<
      Array<{ tableCount: number; migrationCount: number; triggerCount: number }>
    >`
      SELECT
        (
          (to_regclass('documents.resume_documents') IS NOT NULL)::int +
          (to_regclass('documents.idempotency_keys') IS NOT NULL)::int +
          (to_regclass('documents.processing_receipts') IS NOT NULL)::int +
          (to_regclass('documents.audit_events') IS NOT NULL)::int +
          (to_regclass('documents.processing_dispositions') IS NOT NULL)::int +
          (to_regclass('documents.schema_migrations') IS NOT NULL)::int
        )::int AS "tableCount",
        (
          SELECT count(*)::int FROM documents.schema_migrations
          WHERE version = ANY(${migrationVersions as unknown as string[]})
        ) AS "migrationCount",
        (
          SELECT count(*)::int FROM pg_trigger
          WHERE tgrelid = 'documents.resume_documents'::regclass
            AND tgname IN ('resume_documents_protect_identity', 'resume_documents_enforce_transition')
            AND NOT tgisinternal
        ) AS "triggerCount"
    `;
    if (
      verification?.tableCount !== 6 ||
      verification.migrationCount !== migrationVersions.length ||
      verification.triggerCount !== 2
    ) {
      throw new Error("Documents migration verification failed");
    }
  });
  console.log(`Documents migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
