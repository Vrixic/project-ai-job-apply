import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const migrationVersions = [
  "0001_applications_foundation",
  "0002_candidate_rights",
  "0003_manual_submission",
  "0004_packet_preparation",
  "0005_preparation_dispatch",
  "0006_vault_approval_binding",
  "0007_document_field_hashes",
  "0008_temporary_material_bindings",
  "0009_restricted_packet_values",
  "0010_native_resume_requests",
  "0011_native_resume_execution_receipts",
  "0012_native_resume_execution_observation",
  "0013_native_material_withdrawals",
  "0014_native_material_cleanup_queue",
] as const;
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
        documentFieldHashGuardCount: number;
        temporaryMaterialConstraintCount: number;
        temporaryMaterialTriggerCount: number;
        restrictedTriggerCount: number;
        restrictedConstraintCount: number;
        restrictedDeleteBodyCount: number;
        resumeRequestConstraintCount: number;
        resumeExecutionGuardCount: number;
        resumeObservationGuardCount: number;
        resumeRequestTriggerCount: number;
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
         (to_regclass('applications.packet_preparations') IS NOT NULL)::int +
         (to_regclass('applications.preparation_outbox') IS NOT NULL)::int +
         (to_regclass('applications.preparation_audit') IS NOT NULL)::int +
         (to_regclass('applications.schema_migrations') IS NOT NULL)::int +
         (to_regclass('applications_restricted.packet_values') IS NOT NULL)::int +
         (to_regclass('applications_restricted.packet_read_audit') IS NOT NULL)::int)::int AS "relationCount",
        (SELECT count(*)::int FROM pg_trigger
          WHERE tgname IN (
            'packets_immutable', 'history_immutable', 'command_receipts_immutable',
            'applications_transition_guard', 'approvals_update_guard', 'attempts_update_guard',
            'outbox_payload_immutable', 'applications_candidate_delete_guard',
            'packets_candidate_delete_guard', 'approvals_candidate_delete_guard',
            'attempts_candidate_delete_guard', 'history_candidate_delete_guard',
            'command_receipts_candidate_delete_guard', 'outbox_candidate_delete_guard'
            , 'packet_preparations_update_guard', 'packet_preparations_candidate_delete_guard',
            'preparation_outbox_candidate_delete_guard', 'preparation_audit_candidate_delete_guard',
            'preparation_audit_immutable', 'preparation_outbox_update_guard'
          ) AND NOT tgisinternal) AS "guardTriggerCount",
        (SELECT count(*)::int FROM pg_indexes
          WHERE schemaname = 'applications' AND indexname IN (
            'applications_owner_job_live_uq', 'applications_owner_updated_idx',
            'approvals_application_live_uq', 'attempts_scope_holding_uq', 'attempts_application_idx',
            'history_owner_application_idx', 'outbox_pending_idx', 'outbox_processing_lease_idx',
            'preparation_outbox_dispatch_due_idx'
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
        ) AS "candidateDeletionGuardBodyCount",
        (SELECT count(*)::int FROM pg_constraint
          WHERE conrelid = 'applications.packets'::regclass
            AND conname = 'packets_document_field_hashes_ck' AND contype = 'c' AND convalidated
            AND pg_get_constraintdef(oid) LIKE '%jsonb_path_query_array%'
            AND pg_get_constraintdef(oid) LIKE '%documents.cover_letter%'
            AND pg_get_constraintdef(oid) LIKE '%documents.resume%'
            AND pg_get_constraintdef(oid) LIKE '%jsonb_build_array(cover_letter_hash)%'
            AND pg_get_constraintdef(oid) LIKE '%jsonb_build_array(resume_hash)%'
        ) AS "documentFieldHashGuardCount",
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'applications.packets'::regclass
          AND conname = 'packets_temporary_materials_ck' AND convalidated
        ) AS "temporaryMaterialConstraintCount",
        (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal AND (
          (tgrelid = 'applications.packets'::regclass AND tgname = 'packets_temporary_material_edit') OR
          (tgrelid = 'applications.approvals'::regclass AND tgname = 'approvals_temporary_material_admission') OR
          (tgrelid = 'applications.attempts'::regclass AND tgname = 'attempts_temporary_material_admission'))
        ) AS "temporaryMaterialTriggerCount",
        (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal
          AND tgrelid IN ('applications_restricted.packet_values'::regclass, 'applications_restricted.packet_read_audit'::regclass)
          AND tgenabled = 'O' AND tgname IN ('restricted_packet_values_immutable',
            'restricted_packet_values_candidate_delete_guard', 'restricted_packet_values_active_candidate',
            'restricted_packet_read_audit_immutable', 'restricted_packet_read_audit_candidate_delete_guard',
            'restricted_packet_read_audit_active_candidate')
        ) AS "restrictedTriggerCount",
        (SELECT count(*)::int FROM pg_constraint WHERE convalidated AND (
          (conrelid = 'applications.packets'::regclass AND conname IN (
            'packets_restricted_binding_ck', 'packets_restricted_fields_ck', 'packets_restricted_value_fk')) OR
          (conrelid = 'applications.command_receipts'::regclass AND conname = 'command_receipts_hash_authority_ck'))
        ) AS "restrictedConstraintCount",
        (SELECT count(*)::int FROM pg_proc WHERE oid = to_regprocedure('applications.delete_candidate_data(uuid,uuid)')
          AND prosecdef AND pg_get_functiondef(oid) LIKE '%DELETE FROM applications_restricted.packet_values%'
        ) AS "restrictedDeleteBodyCount",
        (SELECT count(*)::int FROM pg_constraint WHERE conrelid='applications.outbox'::regclass
          AND convalidated AND conname IN ('outbox_resume_packet_fk','outbox_resume_scope_ck'))
          AS "resumeRequestConstraintCount",
        ((SELECT count(*)::int FROM pg_constraint WHERE conrelid='applications.outbox'::regclass
          AND convalidated AND conname='outbox_resume_execution_ck') +
         (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='applications.outbox'::regclass
          AND tgenabled='O' AND tgname='outbox_native_resume_execution_guard') +
         (to_regclass('applications.outbox_native_resume_execution_scan') IS NOT NULL)::int) AS "resumeExecutionGuardCount",
        ((SELECT count(*)::int FROM pg_constraint WHERE conrelid='applications.outbox'::regclass
          AND convalidated AND conname='outbox_resume_observation_ck') +
         (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='applications.outbox'::regclass
          AND tgenabled='O' AND tgname='outbox_resume_execution_observation_guard') +
         (to_regclass('applications.outbox_resume_execution_observation_due') IS NOT NULL)::int) AS "resumeObservationGuardCount",
        (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='applications.outbox'::regclass
          AND tgenabled='O' AND tgname='outbox_native_resume_binding_guard') AS "resumeRequestTriggerCount"
    `;
    if (
      verification?.relationCount !== 13 ||
      verification.guardTriggerCount !== 20 ||
      verification.supportingIndexCount !== 9 ||
      verification.migrationCount !== migrationVersions.length ||
      verification.candidateRightsFunctionCount !== 3 ||
      verification.candidateRightsSecurityDefinerCount !== 2 ||
      verification.candidateRightsPublicExecuteViolationCount !== 0 ||
      verification.candidateDeletionGuardBodyCount !== 1 ||
      verification.documentFieldHashGuardCount !== 1 ||
      verification.temporaryMaterialConstraintCount !== 1 ||
      verification.temporaryMaterialTriggerCount !== 3 ||
      verification.restrictedTriggerCount !== 6 ||
      verification.restrictedConstraintCount !== 4 ||
      verification.restrictedDeleteBodyCount !== 1 ||
      verification.resumeRequestConstraintCount !== 2 ||
      verification.resumeExecutionGuardCount !== 3 ||
      verification.resumeObservationGuardCount !== 3 ||
      verification.resumeRequestTriggerCount !== 1
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
