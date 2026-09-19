import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationVersions = ["0001_applications_foundation", "0002_candidate_rights"] as const;
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
      {
        relationCount: number;
        guardTriggerCount: number;
        supportingIndexCount: number;
        migrationCount: number;
        candidateRightsFunctionCount: number;
        candidateRightsSecurityDefinerCount: number;
        candidateRightsPublicExecuteViolationCount: number;
        candidateDeletionGuardBodyCount: number;
      }[]
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
            'applications_transition_guard', 'approvals_update_guard', 'attempts_update_guard',
            'outbox_payload_immutable', 'applications_candidate_delete_guard',
            'packets_candidate_delete_guard', 'approvals_candidate_delete_guard',
            'attempts_candidate_delete_guard', 'history_candidate_delete_guard',
            'command_receipts_candidate_delete_guard', 'outbox_candidate_delete_guard'
          ) AND NOT tgisinternal) AS "guardTriggerCount",
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'applications' AND indexname IN (
            'applications_owner_job_live_uq', 'applications_owner_updated_idx',
            'approvals_application_live_uq', 'attempts_scope_holding_uq', 'attempts_application_idx',
            'history_owner_application_idx', 'outbox_pending_idx', 'outbox_processing_lease_idx'
          )) AS "supportingIndexCount",
        (SELECT count(*)::int FROM applications.schema_migrations
          WHERE version = ANY(${migrationVersions as unknown as string[]})) AS "migrationCount",
        (SELECT count(*)::int FROM pg_proc procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('applications.guard_candidate_delete()'),
            to_regprocedure('applications.export_candidate_data(uuid)'),
            to_regprocedure('applications.delete_candidate_data(uuid,uuid)')
          ])) AS "candidateRightsFunctionCount",
        (SELECT count(*)::int FROM pg_proc procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('applications.export_candidate_data(uuid)'),
            to_regprocedure('applications.delete_candidate_data(uuid,uuid)')
          ]) AND procedure.prosecdef) AS "candidateRightsSecurityDefinerCount",
        (SELECT count(*)::int
          FROM pg_proc procedure
          CROSS JOIN LATERAL aclexplode(
            COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
          ) AS privilege
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('applications.guard_candidate_delete()'),
            to_regprocedure('applications.export_candidate_data(uuid)'),
            to_regprocedure('applications.delete_candidate_data(uuid,uuid)')
          ]) AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
        ) AS "candidateRightsPublicExecuteViolationCount",
        (SELECT count(*)::int FROM pg_proc procedure
          WHERE procedure.oid = to_regprocedure('applications.guard_candidate_delete()')
            AND pg_get_functiondef(procedure.oid)
              LIKE '%privacy.current_candidate_deletion_authorized%'
        ) AS "candidateDeletionGuardBodyCount"
    `;
    if (
      verification?.relationCount !== 8 ||
      verification.guardTriggerCount !== 14 ||
      verification.supportingIndexCount !== 8 ||
      verification.migrationCount !== migrationVersions.length ||
      verification.candidateRightsFunctionCount !== 3 ||
      verification.candidateRightsSecurityDefinerCount !== 2 ||
      verification.candidateRightsPublicExecuteViolationCount !== 0 ||
      verification.candidateDeletionGuardBodyCount !== 1
    ) {
      throw new Error(
        `Applications migration verification failed: ${JSON.stringify(verification)}`,
      );
    }
  });
  console.log(`Applications migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
