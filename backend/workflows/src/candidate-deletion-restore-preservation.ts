import { createHash } from "node:crypto";
import type { DatabaseHandle } from "@ai-job-apply/profile-service";
import type { CandidateDeletionRecoveryEntry } from "./candidate-rights-recovery-ledger.js";

type Sql = Pick<DatabaseHandle["client"], "unsafe">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_ROWS = 100_000;
const MAX_BYTES = 64 * 1024 * 1024;

// Fixed, inspected deletion projections. Every other manifest relation is preserved in full.
// Names and predicates are compiled code, never supplied by an operator or request.
const exclusions = new Map<string, string>();
function direct(relations: readonly string[], column: string) {
  for (const relation of relations) exclusions.set(relation, `t.${column} = ANY($1::uuid[])`);
}
direct(
  [
    "identity.external_identities",
    "profile.job_preferences",
    "profile.profile_facts",
    "profile.restricted_answers",
    "profile.resume_fact_imports",
    "documents.audit_events",
    "documents.cover_letter_provider_responses",
    "documents.cover_letter_work_authorizations",
    "documents.cover_letters",
    "documents.idempotency_keys",
    "documents.native_material_admission",
    "documents.native_material_allocations",
    "documents.native_resume_generations",
    "documents.resume_documents",
    "billing.entitlement_accounts",
    "billing.entitlement_changes",
    "billing.entitlement_command_receipts",
    "billing.entitlement_outbox",
  ],
  "user_id",
);
direct(
  [
    "applications.applications",
    "applications.approvals",
    "applications.attempts",
    "applications.command_receipts",
    "applications.history",
    "applications.native_material_cleanup_queue",
    "applications.native_material_withdrawals",
    "applications.outbox",
    "applications.packet_preparations",
    "applications.packets",
    "applications.preparation_audit",
    "applications.preparation_outbox",
    "applications_restricted.legacy_receipts",
    "applications_restricted.packet_read_audit",
    "applications_restricted.packet_values",
    "matching.audit_events",
    "matching.idempotency_keys",
    "matching.private_saved_page_capture_audit_events",
    "matching.private_saved_page_capture_commands",
    "matching.private_saved_page_capture_resolutions",
    "matching.private_saved_page_captures",
    "matching.saved_job_list_state",
    "matching.saved_jobs",
    "profile.ugc_contribution_consents",
    "jobs.job_contributions",
  ],
  "owner_user_id",
);
direct(["identity.users"], "id");
direct(["jobs.job_reports"], "reporter_user_id");
direct(["trust.contribution_cases"], "contributor_user_id");
exclusions.set(
  "platform.audit_events",
  "t.user_id = ANY($1::uuid[]) AND t.action NOT LIKE 'profile.account-deletion.%'",
);
exclusions.set(
  "platform.idempotency_keys",
  "t.user_id = ANY($1::uuid[]) AND t.scope IN ('ugc_contribution_consent.grant','ugc_contribution_consent.revoked','ugc_contribution_consent.superseded')",
);
// Paired bindings preserve other requests and operations belonging to the same candidate.
exclusions.set(
  "profile.account_deletion_requests",
  'EXISTS (SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r("userId" uuid, "requestId" uuid, "operationId" uuid) WHERE t.id = r."requestId" AND t.user_id = r."userId" AND (t.operation_id = r."operationId" OR (t.operation_id IS NULL AND t.state = \'requested\')))',
);
exclusions.set(
  "platform.operations",
  'EXISTS (SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r("userId" uuid, "requestId" uuid, "operationId" uuid) WHERE t.id = r."operationId" AND t.user_id = r."userId" AND t.kind = \'account_deletion\')',
);
exclusions.set("privacy.account_deletion_ledger", "t.request_id = ANY($3::uuid[])");
function child(
  relations: readonly string[],
  parent: string,
  foreignKey: string,
  ownerColumn: string,
) {
  for (const relation of relations)
    exclusions.set(
      relation,
      `EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = t.${foreignKey} AND p.${ownerColumn} = ANY($1::uuid[]))`,
    );
}
child(
  ["profile.profile_fact_versions", "profile.profile_fact_evidence"],
  "profile.profile_facts",
  "fact_id",
  "user_id",
);
child(["profile.restricted_answer_versions"], "profile.restricted_answers", "answer_id", "user_id");
child(
  ["documents.processing_dispositions", "documents.processing_receipts"],
  "documents.resume_documents",
  "document_id",
  "user_id",
);
child(
  [
    "jobs.job_contribution_independent_verifications",
    "jobs.job_contribution_normalizations",
    "jobs.job_contribution_outbox",
    "jobs.job_contribution_processing_outbox",
    "jobs.job_contribution_processing_queue",
    "jobs.job_contribution_reconciliations",
    "jobs.job_contribution_state_events",
    "jobs.job_contribution_trust_decisions",
  ],
  "jobs.job_contributions",
  "contribution_id",
  "owner_user_id",
);
child(["jobs.job_report_case_links"], "jobs.job_reports", "report_id", "reporter_user_id");
child(
  ["trust.case_events", "trust.contribution_decision_outbox", "trust.reputation_evidence"],
  "trust.contribution_cases",
  "case_id",
  "contributor_user_id",
);
exclusions.set(
  "jobs.job_contribution_processing_event_deliveries",
  "EXISTS (SELECT 1 FROM jobs.job_contribution_processing_outbox e JOIN jobs.job_contributions p ON p.id = e.contribution_id WHERE e.id = t.event_id AND p.owner_user_id = ANY($1::uuid[]))",
);
exclusions.set(
  "trust.contribution_decision_deliveries",
  "EXISTS (SELECT 1 FROM trust.contribution_decision_outbox e JOIN trust.contribution_cases p ON p.id = e.case_id WHERE e.id = t.event_id AND p.contributor_user_id = ANY($1::uuid[]))",
);

// Populated from the reviewed current manifest; regression binds exact order and membership.
export const PRESERVATION_RELATIONS: readonly string[] = Object.freeze([
  "applications.applications",
  "applications.approvals",
  "applications.attempts",
  "applications.command_receipts",
  "applications.history",
  "applications.native_material_cleanup_queue",
  "applications.native_material_withdrawals",
  "applications.outbox",
  "applications.packet_preparations",
  "applications.packets",
  "applications.preparation_audit",
  "applications.preparation_outbox",
  "applications.schema_migrations",
  "applications_restricted.legacy_receipts",
  "applications_restricted.packet_read_audit",
  "applications_restricted.packet_values",
  "billing.entitlement_accounts",
  "billing.entitlement_changes",
  "billing.entitlement_command_receipts",
  "billing.entitlement_outbox",
  "billing.schema_migrations",
  "documents.audit_events",
  "documents.cover_letter_provider_responses",
  "documents.cover_letter_work_authorizations",
  "documents.cover_letters",
  "documents.idempotency_keys",
  "documents.native_material_admission",
  "documents.native_material_allocations",
  "documents.native_resume_generations",
  "documents.processing_dispositions",
  "documents.processing_receipts",
  "documents.resume_documents",
  "documents.schema_migrations",
  "jobs.canonical_jobs",
  "jobs.catalog_search_state",
  "jobs.companies",
  "jobs.duplicate_candidates",
  "jobs.duplicate_resolution_events",
  "jobs.ingestion_checkpoints",
  "jobs.ingestion_dispatches",
  "jobs.ingestion_run_events",
  "jobs.job_contribution_independent_verifications",
  "jobs.job_contribution_normalizations",
  "jobs.job_contribution_outbox",
  "jobs.job_contribution_processing_event_deliveries",
  "jobs.job_contribution_processing_outbox",
  "jobs.job_contribution_processing_queue",
  "jobs.job_contribution_reconciliations",
  "jobs.job_contribution_state_events",
  "jobs.job_contribution_trust_decisions",
  "jobs.job_contributions",
  "jobs.job_moderation_blocks",
  "jobs.job_report_case_links",
  "jobs.job_report_retention_totals",
  "jobs.job_reports",
  "jobs.job_sources",
  "jobs.moderation_cases",
  "jobs.moderation_events",
  "jobs.schema_migrations",
  "jobs.source_moderation_pauses",
  "jobs.source_revalidation_queue",
  "jobs.source_verification_evidence",
  "jobs.status_events",
  "matching.audit_events",
  "matching.idempotency_keys",
  "matching.private_saved_page_capture_audit_events",
  "matching.private_saved_page_capture_commands",
  "matching.private_saved_page_capture_resolutions",
  "matching.private_saved_page_captures",
  "matching.saved_job_list_state",
  "matching.saved_jobs",
  "matching.schema_migrations",
  "identity.external_identities",
  "identity.users",
  "platform.audit_events",
  "platform.idempotency_keys",
  "platform.operations",
  "platform.outbox_events",
  "platform.schema_migrations",
  "privacy.account_deletion_ledger",
  "profile.account_deletion_requests",
  "profile.candidate_data_exports",
  "profile.job_preferences",
  "profile.profile_fact_evidence",
  "profile.profile_fact_versions",
  "profile.profile_facts",
  "profile.restricted_answer_versions",
  "profile.restricted_answers",
  "profile.resume_fact_imports",
  "profile.ugc_contribution_consents",
  "trust.case_events",
  "trust.contribution_cases",
  "trust.contribution_decision_deliveries",
  "trust.contribution_decision_outbox",
  "trust.reputation_evidence",
  "trust.schema_migrations",
]);

export interface RestoreDataDigest {
  sha256: string;
  relationCount: 96;
  rowCount: number;
  byteCount: number;
}
export interface RestoreDigestBudget {
  deadline: number;
  rowCount: number;
  byteCount: number;
}
function refuse(): never {
  throw new Error("CandidateDeletionRestorePreservationRejected");
}

/** Aggregate whole-row hashes only cross the SQL boundary. No plaintext row is returned. */
export async function digestRestoredData(
  sql: Sql,
  entries: readonly CandidateDeletionRecoveryEntry[],
  budget: RestoreDigestBudget,
  signal?: AbortSignal,
): Promise<RestoreDataDigest> {
  if (
    entries.length > 1000 ||
    !Number.isFinite(budget.deadline) ||
    ![budget.rowCount, budget.byteCount].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    budget.rowCount > MAX_ROWS ||
    budget.byteCount > MAX_BYTES
  )
    refuse();
  const deadline = Math.min(budget.deadline, Date.now() + 90_000);
  async function query(text: string, parameters: string[] = []) {
    if (signal?.aborted || Date.now() >= deadline) refuse();
    const pending = sql.unsafe<Record<string, unknown>[]>(text, parameters);
    let rejectAbort: ((error: Error) => void) | undefined;
    const abort = () => {
      try {
        void Promise.resolve(pending.cancel()).catch(() => undefined);
      } catch {
        /* Cancellation cannot turn a refused digest into evidence. */
      }
      rejectAbort?.(new Error("CandidateDeletionRestorePreservationRejected"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (signal?.aborted) {
        abort();
        refuse();
      }
      const result = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          rejectAbort = reject;
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => {
              abort();
              reject(new Error("CandidateDeletionRestorePreservationRejected"));
            },
            Math.max(1, Math.min(15_000, deadline - Date.now())),
          );
        }),
      ]);
      if (signal?.aborted || Date.now() >= deadline) refuse();
      return result;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }
  await query(`SET LOCAL TimeZone = 'UTC'; SET LOCAL DateStyle = 'ISO, YMD';
    SET LOCAL IntervalStyle = 'iso_8601'; SET LOCAL extra_float_digits = 3;
    SET LOCAL bytea_output = 'hex'; SET LOCAL row_security = off; SET LOCAL search_path = pg_catalog`);
  const serialization = await query(`SELECT json_build_array(
    current_setting('TimeZone'), current_setting('DateStyle'), current_setting('IntervalStyle'),
    current_setting('extra_float_digits'), current_setting('bytea_output'), current_setting('row_security'),
    current_setting('server_encoding'),current_setting('client_encoding'),
    current_setting('server_version_num')::int / 10000,current_setting('search_path')) AS settings`);
  if (
    serialization.length !== 1 ||
    Object.keys(serialization[0] ?? {}).join(",") !== "settings" ||
    JSON.stringify(serialization[0]?.settings) !==
      JSON.stringify([
        "UTC",
        "ISO, YMD",
        "iso_8601",
        "3",
        "hex",
        "off",
        "UTF8",
        "UTF8",
        16,
        "pg_catalog",
      ])
  )
    refuse();
  const visibility = await query(`WITH tables AS (
    SELECT n.nspname || '.' || c.relname AS name,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relispartition,
      has_table_privilege(c.oid,'SELECT') AS selectable
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('information_schema','pg_catalog','pg_toast')
      AND n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%'
      AND c.relkind IN ('r','p','v','m','f') LIMIT 129
  ) SELECT jsonb_agg(name ORDER BY name COLLATE "C") AS relations,
      bool_and(relkind='r' AND NOT relrowsecurity AND NOT relforcerowsecurity AND NOT relispartition AND selectable) AS visible
    FROM tables`);
  if (
    visibility.length !== 1 ||
    Object.keys(visibility[0] ?? {})
      .sort()
      .join(",") !== "relations,visible" ||
    visibility[0]?.visible !== true ||
    JSON.stringify(visibility[0]?.relations) !== JSON.stringify([...PRESERVATION_RELATIONS].sort())
  )
    refuse();
  const bindings = entries.map(({ userId, requestId, operationId }) => {
    if (![userId, requestId, operationId].every((id) => UUID.test(id))) refuse();
    return { userId, requestId, operationId };
  });
  const values = [
    `{${bindings.map((r) => r.userId).join(",")}}`,
    JSON.stringify(bindings),
    `{${bindings.map((r) => r.requestId).join(",")}}`,
  ];
  const hash = createHash("sha256").update("candidate-deletion-restore-whole-rows-v1\0");
  let rowCount = 0;
  let byteCount = 0;
  for (const relation of PRESERVATION_RELATIONS) {
    const remaining = deadline - Date.now();
    if (signal?.aborted || remaining <= 0) refuse();
    const timeout = Math.max(1, Math.min(15_000, Math.floor(remaining)));
    await query(`SET LOCAL statement_timeout = '${timeout}ms'`);
    const exclusion = entries.length ? exclusions.get(relation) : undefined;
    const result = await query(
      `WITH row_hashes AS MATERIALIZED (
      SELECT CASE WHEN octet_length(to_jsonb(t)::text) <= 262144
        THEN encode(sha256(convert_to(to_jsonb(t)::text, 'UTF8')), 'hex') ELSE NULL END AS h,
        octet_length(to_jsonb(t)::text) AS bytes
      FROM ${relation} t
      WHERE (${exclusion ?? "false"}) IS NOT TRUE
        AND cardinality($1::uuid[]) >= 0 AND jsonb_typeof($2::jsonb) = 'array' AND cardinality($3::uuid[]) >= 0
      LIMIT 10001
    ) SELECT count(*)::text AS rows, COALESCE(sum(bytes),0)::text AS bytes,
      COALESCE(max(bytes),0)::text AS largest,
      encode(sha256(convert_to(COALESCE(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex') AS sha
      , (SELECT CASE WHEN count(*) BETWEEN 1 AND 128 AND bool_and(tn.nspname='pg_catalog')
          THEN encode(sha256(convert_to(COALESCE(string_agg(
          jsonb_build_array(a.attname, format_type(a.atttypid,a.atttypmod),a.attnotnull,
            a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))::text,'' ORDER BY a.attnum),''),'UTF8')),'hex')
          ELSE NULL END
        FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d
          ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        JOIN pg_catalog.pg_type typ ON typ.oid=a.atttypid JOIN pg_catalog.pg_namespace tn ON tn.oid=typ.typnamespace
        WHERE a.attrelid='${relation}'::regclass AND a.attnum>0 AND NOT a.attisdropped) AS schema
      FROM row_hashes`,
      values,
    );
    if (signal?.aborted || Date.now() >= deadline || result.length !== 1) refuse();
    const row = result[0];
    if (!row || Object.keys(row).sort().join(",") !== "bytes,largest,rows,schema,sha") refuse();
    const numbers = [row.rows, row.bytes, row.largest];
    if (!numbers.every((n) => typeof n === "string" && /^(?:0|[1-9][0-9]*)$/u.test(n))) refuse();
    const [count, bytes, largest] = numbers.map(Number) as [number, number, number];
    if (
      ![count, bytes, largest].every(Number.isSafeInteger) ||
      count > 10_000 ||
      bytes > 4 * 1024 * 1024 ||
      largest > 256 * 1024 ||
      ![row.sha, row.schema].every((sha) => typeof sha === "string" && /^[a-f0-9]{64}$/u.test(sha))
    )
      refuse();
    rowCount += count;
    byteCount += bytes;
    budget.rowCount += count;
    budget.byteCount += bytes;
    if (budget.rowCount > MAX_ROWS || budget.byteCount > MAX_BYTES) refuse();
    hash.update(JSON.stringify([relation, row.schema, count, bytes, row.sha])).update("\0");
  }
  if (PRESERVATION_RELATIONS.length !== 96 || signal?.aborted || Date.now() >= deadline) refuse();
  return { sha256: hash.digest("hex"), relationCount: 96, rowCount, byteCount };
}
