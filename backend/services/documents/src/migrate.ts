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
  "0006_cover_letters",
  "0007_cover_letter_work_authorizations",
  "0008_cover_letter_provider_responses",
  "0009_cover_letter_provider_failure",
  "0010_temporary_material_completion",
  "0011_native_material_allocations",
  "0012_native_material_launch_claim",
  "0013_native_material_ready",
  "0014_native_resume_generations",
  "0015_native_resume_observation",
  "0016_native_application_disposal",
  "0017_native_resume_launch_rejection",
  "0018_native_resume_legacy_launch_rejection",
  "0019_native_resume_purge_seals_epoch",
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
      Array<{
        tableCount: number;
        migrationCount: number;
        triggerCount: number;
        workTriggerCount: number;
        responseTriggerCount: number;
        failureTriggerCount: number;
        materialColumnCount: number;
        materialConstraintCount: number;
        materialTriggerCount: number;
        nativeTriggerCount: number;
        launchColumnCount: number;
        launchConstraintCount: number;
        readyColumnCount: number;
        readyGuardCount: number;
        readyConstraintCount: number;
      }>
    >`
      SELECT
        (
          (to_regclass('documents.resume_documents') IS NOT NULL)::int +
          (to_regclass('documents.idempotency_keys') IS NOT NULL)::int +
          (to_regclass('documents.processing_receipts') IS NOT NULL)::int +
          (to_regclass('documents.audit_events') IS NOT NULL)::int +
          (to_regclass('documents.processing_dispositions') IS NOT NULL)::int +
          (to_regclass('documents.cover_letters') IS NOT NULL)::int +
          (to_regclass('documents.cover_letter_work_authorizations') IS NOT NULL)::int +
          (to_regclass('documents.cover_letter_provider_responses') IS NOT NULL)::int +
          (to_regclass('documents.native_material_admission') IS NOT NULL)::int +
          (to_regclass('documents.native_resume_generations') IS NOT NULL)::int +
          (to_regclass('documents.native_material_allocations') IS NOT NULL)::int +
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
        ) AS "triggerCount",
        (
          SELECT count(*)::int FROM pg_trigger
          WHERE tgrelid = 'documents.cover_letter_work_authorizations'::regclass
            AND tgname = 'cover_letter_work_authorizations_protect' AND NOT tgisinternal
        ) AS "workTriggerCount",
        (
          SELECT count(*)::int FROM pg_trigger
          WHERE tgrelid = 'documents.cover_letter_provider_responses'::regclass
            AND tgname = 'cover_letter_provider_responses_protect' AND NOT tgisinternal
        ) AS "responseTriggerCount",
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgrelid = 'documents.cover_letter_work_authorizations'::regclass
            AND tgname = 'cover_letter_provider_failure_protect' AND NOT tgisinternal
        ) AS "failureTriggerCount",
        (SELECT count(*)::int FROM information_schema.columns
          WHERE table_schema = 'documents' AND table_name = 'cover_letters'
            AND column_name IN ('material_work_id', 'material_sha256', 'material_completed_at_ms', 'material_expires_at_ms')
        ) AS "materialColumnCount",
        (SELECT count(*)::int FROM pg_constraint
          WHERE conrelid = 'documents.cover_letters'::regclass
            AND conname = 'cover_letters_temporary_material_ck' AND convalidated
        ) AS "materialConstraintCount",
        (SELECT count(*)::int FROM pg_trigger
          WHERE NOT tgisinternal AND (
            (tgrelid = 'documents.cover_letters'::regclass AND tgname = 'cover_letters_temporary_material_protect') OR
            (tgrelid = 'documents.cover_letter_work_authorizations'::regclass AND tgname = 'cover_letter_work_temporary_material_protect'))
        ) AS "materialTriggerCount",
        (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (
          'native_material_admission_guard', 'native_material_allocation_guard',
          'cover_letters_native_retirement_guard', 'cover_letter_native_claim_guard', 'native_material_launch_claim_guard'
        )) AS "nativeTriggerCount",
        (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'documents'
          AND table_name = 'native_material_allocations' AND column_name IN ('launch_claimed_at', 'launch_configuration_sha256')) AS "launchColumnCount",
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'documents.native_material_allocations'::regclass
          AND conname = 'native_material_launch_claim_ck' AND convalidated) AS "launchConstraintCount",
        (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='documents'
          AND table_name='cover_letters' AND column_name IN ('material_source_fact_ids', 'material_confidence')) AS "readyColumnCount",
        (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND tgname='cover_letters_native_ready_guard') AS "readyGuardCount",
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid='documents.cover_letters'::regclass
          AND conname='cover_letters_material_ready_ck' AND convalidated) AS "readyConstraintCount"
    `;
    if (
      verification?.tableCount !== 12 ||
      verification.migrationCount !== migrationVersions.length ||
      verification.triggerCount !== 2 ||
      verification.workTriggerCount !== 1 ||
      verification.responseTriggerCount !== 1 ||
      verification.failureTriggerCount !== 1 ||
      verification.materialColumnCount !== 4 ||
      verification.materialConstraintCount !== 1 ||
      verification.materialTriggerCount !== 2 ||
      verification.nativeTriggerCount !== 5 ||
      verification.launchColumnCount !== 2 ||
      verification.launchConstraintCount !== 1 ||
      verification.readyColumnCount !== 2 ||
      verification.readyGuardCount !== 1 ||
      verification.readyConstraintCount !== 1
    ) {
      throw new Error("Documents migration verification failed");
    }
  });
  console.log(`Documents migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
