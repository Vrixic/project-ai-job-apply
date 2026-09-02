import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationVersions = [
  "0001_ugc_trust_foundation",
  "0002_candidate_rights",
  "0003_decision_signals",
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
      {
        tableCount: number;
        triggerCount: number;
        indexCount: number;
        migrationCount: number;
        candidateRightsFunctionCount: number;
        candidateRightsSecurityDefinerCount: number;
        candidateRightsPublicExecuteViolationCount: number;
        candidateDeletionGuardBodyCount: number;
        decisionSignalFunctionCount: number;
        decisionSignalPublicExecuteViolationCount: number;
      }[]
    >`
      SELECT
        ((to_regclass('trust.schema_migrations') IS NOT NULL)::int
          + (to_regclass('trust.contribution_cases') IS NOT NULL)::int
          + (to_regclass('trust.case_events') IS NOT NULL)::int
          + (to_regclass('trust.reputation_evidence') IS NOT NULL)::int
          + (to_regclass('trust.contribution_decision_outbox') IS NOT NULL)::int
          + (to_regclass('trust.contribution_decision_deliveries') IS NOT NULL)::int)::int AS "tableCount",
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgname IN ('contribution_cases_guard', 'contribution_cases_append_event',
            'contribution_cases_candidate_delete_guard', 'case_events_immutable',
            'case_events_candidate_delete_guard', 'reputation_evidence_guard',
            'reputation_evidence_candidate_delete_guard') AND NOT tgisinternal
            OR (tgname IN ('contribution_decision_outbox_guard',
              'contribution_decision_deliveries_guard') AND NOT tgisinternal)
        ) AS "triggerCount",
        (SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'trust'
          AND indexname IN ('contribution_cases_owner_updated_idx',
            'contribution_cases_review_queue_idx', 'case_events_contribution_occurred_idx',
            'reputation_evidence_contributor_idx', 'reputation_evidence_source_idx',
            'contribution_decision_outbox_created_idx',
            'contribution_decision_deliveries_pending_idx',
            'contribution_decision_deliveries_lease_idx')
        ) AS "indexCount",
        (SELECT count(*)::int FROM trust.schema_migrations
          WHERE version = ANY(${migrationVersions as unknown as string[]})) AS "migrationCount",
        (SELECT count(*)::int FROM pg_proc procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('trust.guard_candidate_case_delete()'),
            to_regprocedure('trust.guard_candidate_case_event_delete()'),
            to_regprocedure('trust.guard_candidate_reputation_evidence_delete()'),
            to_regprocedure('trust.export_candidate_data(uuid)'),
            to_regprocedure('trust.delete_candidate_data(uuid,uuid)')
          ])) AS "candidateRightsFunctionCount",
        (SELECT count(*)::int FROM pg_proc procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('trust.export_candidate_data(uuid)'),
            to_regprocedure('trust.delete_candidate_data(uuid,uuid)')
          ]) AND procedure.prosecdef) AS "candidateRightsSecurityDefinerCount",
        (SELECT count(*)::int
          FROM pg_proc procedure
          CROSS JOIN LATERAL aclexplode(
            COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
          ) AS privilege
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('trust.guard_candidate_case_delete()'),
            to_regprocedure('trust.guard_candidate_case_event_delete()'),
            to_regprocedure('trust.guard_candidate_reputation_evidence_delete()'),
            to_regprocedure('trust.export_candidate_data(uuid)'),
            to_regprocedure('trust.delete_candidate_data(uuid,uuid)')
          ]) AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
        ) AS "candidateRightsPublicExecuteViolationCount",
        (SELECT count(*)::int FROM pg_proc procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('trust.guard_candidate_case_delete()'),
            to_regprocedure('trust.guard_candidate_case_event_delete()'),
            to_regprocedure('trust.guard_candidate_reputation_evidence_delete()')
          ]) AND pg_get_functiondef(procedure.oid)
            LIKE '%privacy.current_candidate_deletion_authorized%'
        ) AS "candidateDeletionGuardBodyCount"
        ,(SELECT count(*)::int FROM pg_proc procedure
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('trust.case_transition_event_id(uuid,integer)'),
            to_regprocedure('trust.guard_contribution_decision_outbox()'),
            to_regprocedure('trust.guard_contribution_decision_delivery()')
          ])) AS "decisionSignalFunctionCount"
        ,(SELECT count(*)::int
          FROM pg_proc procedure
          CROSS JOIN LATERAL aclexplode(
            COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
          ) AS privilege
          WHERE procedure.oid = ANY(ARRAY[
            to_regprocedure('trust.case_transition_event_id(uuid,integer)'),
            to_regprocedure('trust.guard_contribution_decision_outbox()'),
            to_regprocedure('trust.guard_contribution_decision_delivery()')
          ]) AND privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
        ) AS "decisionSignalPublicExecuteViolationCount"
    `;
    if (
      verification?.tableCount !== 6 ||
      verification.triggerCount !== 9 ||
      verification.indexCount !== 8 ||
      verification.migrationCount !== migrationVersions.length ||
      verification.candidateRightsFunctionCount !== 5 ||
      verification.candidateRightsSecurityDefinerCount !== 2 ||
      verification.candidateRightsPublicExecuteViolationCount !== 0 ||
      verification.candidateDeletionGuardBodyCount !== 3 ||
      verification.decisionSignalFunctionCount !== 3 ||
      verification.decisionSignalPublicExecuteViolationCount !== 0
    ) {
      throw new Error(`Trust migration verification failed: ${JSON.stringify(verification)}`);
    }
  });
  console.log(`Trust migrations through ${migrationVersions.at(-1)} applied and verified.`);
} finally {
  await client.end();
}
