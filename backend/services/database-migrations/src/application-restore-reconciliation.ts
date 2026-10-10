import {
  collectRestoreDataInventory,
  compareRestoreDataInventories,
  type RestoreDataInventory,
} from "./restore-data-inventory.js";
import {
  loadCurrentRestoreManifest,
  parseRestoreManifest,
  type RestoreManifestSource,
  type RestoreSqlClient,
  type RestoreSqlExecutor,
} from "./restore-verifier.js";

const denied = () => Error("ApplicationRestoreReconciliationFailed");
const legacyTables = [
  "applications",
  "approvals",
  "attempts",
  "command_receipts",
  "history",
  "outbox",
  "packets",
  "schema_migrations",
].map((name) => `applications.${name}`);
const versions = [
  "0001_applications_foundation",
  "0002_candidate_rights",
  "0003_manual_submission",
];
const versionSql = versions.map((value) => `'${value}'`).join(",");
const extras = {
  "applications.packets": [
    ["temporary_materials", "jsonb", true],
    ["restricted_value_id", "uuid", false],
    ["restricted_metadata_sha256", "text", false],
    ["restricted_ciphertext_sha256", "text", false],
  ],
  "applications.outbox": [
    ["resume_packet_id", "uuid", false],
    ["resume_workflow_arn", "text", false],
    ["resume_execution_arn", "text", false],
    ["resume_dispatch_result", "text", false],
    ["resume_execution_checked_at", "timestamp with time zone", false],
    ["resume_execution_inspection_token", "uuid", false],
    ["resume_execution_terminal_status", "text", false],
    ["resume_execution_notified_at", "timestamp with time zone", false],
  ],
  "applications.command_receipts": [
    ["request_hash_scheme", "text", true],
    ["request_key_arn", "text", false],
  ],
} as const;
const baseColumns = {
  "applications.packets":
    "id,application_id,owner_user_id,version,packet_hash,job_revision,form_adapter_id,form_variant_id,form_hash,resume_hash,cover_letter_hash,fields,created_at",
  "applications.outbox":
    "id,application_id,owner_user_id,application_revision,event_type,subject,payload,occurred_at,available_at,status,claim_token,lease_expires_at,attempt_count,published_at,failed_at,last_error_code",
  "applications.command_receipts":
    "owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,outcome_code,subject_id,created_at",
  "applications.schema_migrations": "version,checksum,applied_at",
} as const;
const originalColumns = {
  "applications.packets": [
    ["id", "uuid", true],
    ["application_id", "uuid", true],
    ["owner_user_id", "uuid", true],
    ["version", "integer", true],
    ["packet_hash", "text", true],
    ["job_revision", "text", true],
    ["form_adapter_id", "text", false],
    ["form_variant_id", "text", false],
    ["form_hash", "text", false],
    ["resume_hash", "text", false],
    ["cover_letter_hash", "text", false],
    ["fields", "jsonb", true],
    ["created_at", "timestamp with time zone", true],
  ],
  "applications.outbox": [
    ["id", "uuid", true],
    ["application_id", "uuid", true],
    ["owner_user_id", "uuid", true],
    ["application_revision", "bigint", true],
    ["event_type", "text", true],
    ["subject", "text", true],
    ["payload", "jsonb", true],
    ["occurred_at", "timestamp with time zone", true],
    ["available_at", "timestamp with time zone", true],
    ["status", "text", true],
    ["claim_token", "uuid", false],
    ["lease_expires_at", "timestamp with time zone", false],
    ["attempt_count", "integer", true],
    ["published_at", "timestamp with time zone", false],
    ["failed_at", "timestamp with time zone", false],
    ["last_error_code", "text", false],
  ],
  "applications.command_receipts": [
    ["owner_user_id", "uuid", true],
    ["idempotency_key", "text", true],
    ["operation", "text", true],
    ["request_hash", "text", true],
    ["application_id", "uuid", true],
    ["response_revision", "bigint", true],
    ["outcome_code", "text", false],
    ["subject_id", "uuid", false],
    ["created_at", "timestamp with time zone", true],
  ],
  "applications.schema_migrations": [
    ["version", "text", true],
    ["checksum", "text", true],
    ["applied_at", "timestamp with time zone", true],
  ],
} as const;
const addedTables = [
  "applications.native_material_cleanup_queue",
  "applications.native_material_withdrawals",
  "applications.packet_preparations",
  "applications.preparation_audit",
  "applications.preparation_outbox",
  "applications_restricted.legacy_receipts",
  "applications_restricted.packet_read_audit",
  "applications_restricted.packet_values",
];
// Fixed column shapes from owning migrations 0004/0005/0009/0013/0014/0015.
const addedColumns = {
  "applications.native_material_cleanup_queue": [
    ["request_id", "uuid", true],
    ["owner_user_id", "uuid", true],
    ["state", "text", true],
    ["after_application_id", "uuid", false],
    ["claim_token", "uuid", false],
    ["lease_expires_at", "timestamp with time zone", false],
    ["available_at", "timestamp with time zone", true],
    ["completed_at", "timestamp with time zone", false],
  ],
  "applications.native_material_withdrawals": [
    ["id", "uuid", true],
    ["owner_user_id", "uuid", true],
    ["requested_at", "timestamp with time zone", true],
  ],
  "applications.packet_preparations": [
    ["id", "uuid", true],
    ["application_id", "uuid", true],
    ["owner_user_id", "uuid", true],
    ["base_packet_id", "uuid", true],
    ["expected_revision", "bigint", true],
    ["job_context_hash", "text", true],
    ["confirmed_facts_hash", "text", true],
    ["notice_version", "text", true],
    ["provider", "text", true],
    ["model", "text", true],
    ["purpose", "text", true],
    ["categories", "jsonb", true],
    ["approved_at", "timestamp with time zone", true],
    ["expires_at", "timestamp with time zone", true],
    ["generation_claimed_at", "timestamp with time zone", false],
    ["state", "text", true],
    ["result_packet_id", "uuid", false],
    ["error_code", "text", false],
    ["created_at", "timestamp with time zone", true],
    ["updated_at", "timestamp with time zone", true],
  ],
  "applications.preparation_audit": [
    ["id", "uuid", true],
    ["preparation_id", "uuid", true],
    ["owner_user_id", "uuid", true],
    ["action", "text", true],
    ["occurred_at", "timestamp with time zone", true],
  ],
  "applications.preparation_outbox": [
    ["id", "uuid", true],
    ["preparation_id", "uuid", true],
    ["owner_user_id", "uuid", true],
    ["event_type", "text", true],
    ["payload", "jsonb", true],
    ["created_at", "timestamp with time zone", true],
    ["published_at", "timestamp with time zone", false],
    ["nudge_claimed_at", "timestamp with time zone", false],
    ["workflow_function_arn", "text", false],
    ["durable_execution_name", "text", false],
    ["bound_at", "timestamp with time zone", false],
    ["dispatch_lease_id", "uuid", false],
    ["dispatch_claimed_at", "timestamp with time zone", false],
    ["dispatch_expires_at", "timestamp with time zone", false],
    ["durable_execution_arn", "text", false],
    ["durable_started_at", "timestamp with time zone", false],
    ["terminal_status", "text", false],
    ["terminal_start_at", "timestamp with time zone", false],
    ["terminal_end_at", "timestamp with time zone", false],
  ],
  "applications_restricted.legacy_receipts": [
    ["owner_user_id", "uuid", true],
    ["idempotency_key", "text", true],
    ["application_id", "uuid", true],
    ["protection_id", "uuid", true],
    ["original_operation", "text", true],
    ["metadata_sha256", "text", true],
    ["encryption_key_arn", "text", true],
    ["ciphertext", "bytea", true],
  ],
  "applications_restricted.packet_read_audit": [
    ["id", "uuid", true],
    ["read_id", "uuid", true],
    ["owner_user_id", "uuid", true],
    ["application_id", "uuid", true],
    ["packet_id", "uuid", true],
    ["purpose", "text", true],
    ["stage", "text", true],
    ["export_request_id", "uuid", false],
    ["export_operation_id", "uuid", false],
    ["created_at", "timestamp with time zone", true],
  ],
  "applications_restricted.packet_values": [
    ["id", "uuid", true],
    ["owner_user_id", "uuid", true],
    ["application_id", "uuid", true],
    ["metadata_sha256", "text", true],
    ["ciphertext_sha256", "text", true],
    ["schema_version", "integer", true],
    ["encryption_key_arn", "text", true],
    ["encrypted_data_key", "bytea", true],
    ["iv", "bytea", true],
    ["ciphertext", "bytea", true],
    ["authentication_tag", "bytea", true],
    ["created_at", "timestamp with time zone", true],
  ],
} as const;
function contracts(old: RestoreManifestSource, current: RestoreManifestSource) {
  const expected = {
    ...current.manifest,
    manifestId: "d3-latest-pretransition-applications-three-v1",
    contributors: current.manifest.contributors.map((owner) =>
      owner.owner === "applications"
        ? {
            ...owner,
            schemas: ["applications"],
            migrations: owner.migrations.slice(0, 3),
            relations: legacyTables,
          }
        : owner,
    ),
  };
  if (
    current.sha256 !== "d5c2b6d9f7204ef87c4798b2dbced4c96c1d2c3258dd6b06945a64ae17396fc5" ||
    old.sha256 !== "1a67ddc33ab3fa2bd84cce4a3d452728a90f8ee755c04b953c13ca5ba8aefb3b" ||
    JSON.stringify(parseRestoreManifest(old.manifest)) !== JSON.stringify(expected)
  )
    throw denied();
  const a = old.manifest.contributors,
    b = current.manifest.contributors;
  if (
    a.length !== 7 ||
    b.length !== 7 ||
    a.reduce((sum, owner) => sum + owner.relations.length, 0) !== 88 ||
    b.reduce((sum, owner) => sum + owner.relations.length, 0) !== 96
  )
    throw denied();
  for (const owner of b) {
    const previous = a.find((item) => item.owner === owner.owner);
    if (!previous) throw denied();
    if (owner.owner !== "applications") {
      if (JSON.stringify(previous) !== JSON.stringify(owner)) throw denied();
    } else if (
      owner.migrations.length !== 15 ||
      JSON.stringify(previous.schemas) !== JSON.stringify(["applications"]) ||
      JSON.stringify(previous.relations) !== JSON.stringify(legacyTables) ||
      JSON.stringify(previous.migrations) !== JSON.stringify(owner.migrations.slice(0, 3)) ||
      JSON.stringify(owner.relations) !== JSON.stringify([...legacyTables, ...addedTables].sort())
    )
      throw denied();
  }
}
function catalog(old: RestoreDataInventory, current: RestoreDataInventory) {
  for (const [relation, shape] of Object.entries(originalColumns)) {
    const a = old.relations.find((row) => row.relation === relation),
      b = current.relations.find((row) => row.relation === relation);
    const original = shape.map(([name, type, notNull]) => ({
      name,
      type,
      notNull,
      identity: "",
      generated: "",
    }));
    if (!a || !b || JSON.stringify(a.columns) !== JSON.stringify(original)) throw denied();
    const additions = extras[relation as keyof typeof extras] ?? [];
    const expected = [
      ...a.columns,
      ...additions.map(([name, type, notNull]) => ({
        name,
        type,
        notNull,
        identity: "",
        generated: "",
      })),
    ];
    if (JSON.stringify(b.columns) !== JSON.stringify(expected)) throw denied();
  }
  for (const name of addedTables) {
    const relation = current.relations.find((row) => row.relation === name);
    if (
      !relation ||
      JSON.stringify(relation.columns) !==
        JSON.stringify(
          addedColumns[name as keyof typeof addedColumns].map(([name, type, notNull]) => ({
            name,
            type,
            notNull,
            identity: "",
            generated: "",
          })),
        ) ||
      relation.rowCount !== (name === "applications_restricted.legacy_receipts" ? 7 : 0)
    )
      throw denied();
  }
}
// Fixed owning projections only: complete rows, original field association and duplicate multiplicity.
function projectionQuery(relation: keyof typeof baseColumns, archived: boolean): string {
  const filter =
    relation === "applications.command_receipts"
      ? archived
        ? " WHERE operation<>'archived_legacy'"
        : " WHERE operation NOT IN ('create_packet','queue_preparation')"
      : relation === "applications.schema_migrations"
        ? ` WHERE version IN (${versionSql})`
        : "";
  return `WITH records AS MATERIALIZED (
    SELECT octet_length(payload) AS bytes,
      CASE WHEN octet_length(payload)<=262144 THEN encode(sha256(convert_to(payload,'UTF8')),'hex') ELSE NULL END AS hash
    FROM (SELECT to_jsonb(record)::text AS payload FROM
      (SELECT ${baseColumns[relation]} FROM ${relation}${filter} LIMIT 10001) record) serialized
  ), stats AS (SELECT count(*) AS count,COALESCE(sum(bytes),0) AS bytes,COALESCE(max(bytes),0) AS max FROM records)
  SELECT count::text,bytes::text,CASE WHEN count<=10000 AND bytes<=4194304 AND max<=262144 THEN
    (SELECT encode(sha256(convert_to('restore-data-rows-v1:'||COALESCE(string_agg(hash,'' ORDER BY hash COLLATE "C"),''),'UTF8')),'hex') FROM records)
    ELSE NULL END AS digest FROM stats`;
}
function aggregate(rows: Record<string, unknown>[]) {
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    typeof row.count !== "string" ||
    !/^(0|[1-9][0-9]{0,4})$/.test(row.count) ||
    Number(row.count) > 10000 ||
    typeof row.bytes !== "string" ||
    !/^(0|[1-9][0-9]{0,6})$/.test(row.bytes) ||
    Number(row.bytes) > 4194304 ||
    typeof row.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.digest)
  )
    throw denied();
  return { count: row.count, bytes: row.bytes, digest: row.digest };
}
export interface ApplicationRestoreReconciliationOptions {
  readonly originalSource: RestoreManifestSource;
  readonly transitionStartedAt: string;
  readonly transitionEndedAt: string;
  enabled(): boolean;
  verifyReceipts(
    original: RestoreSqlClient,
    restored: RestoreSqlClient,
    admission: () => void,
  ): Promise<{ readonly matchedReceipts: 7 }>;
}
/** A separate fail-closed diagnostic for the exact three-to-fifteen Applications transition.
 * It grants no migration, traffic, candidate-rights replay or primary-promotion authority. */
export async function reconcileApplicationRestore(
  original: RestoreSqlClient,
  restored: RestoreSqlClient,
  options: ApplicationRestoreReconciliationOptions,
) {
  const start = process.hrtime.bigint();
  const admitted = () => {
    if (!options.enabled() || process.hrtime.bigint() - start >= 120_000_000_000n) throw denied();
  };
  const current = loadCurrentRestoreManifest();
  async function snapshot(client: RestoreSqlClient, archived: boolean) {
    admitted();
    return client.begin("read only isolation level repeatable read", async (raw) => {
      const tx: RestoreSqlExecutor = {
        unsafe: async <T extends Record<string, unknown>>(query: string) => {
          admitted();
          const rows = await raw.unsafe<T>(query);
          admitted();
          return rows;
        },
      };
      const inventory = await collectRestoreDataInventory(
        { begin: async (_options, work) => work(tx) },
        archived ? current : options.originalSource,
      );
      admitted();
      const projections = [];
      for (const relation of Object.keys(baseColumns) as Array<keyof typeof baseColumns>) {
        admitted();
        projections.push(aggregate(await tx.unsafe(projectionQuery(relation, archived))));
        admitted();
      }
      if (archived) await defaultsAndLedger(tx);
      admitted();
      return { inventory, projections };
    });
  }
  async function defaultsAndLedger(tx: RestoreSqlExecutor) {
    const invalid = await tx.unsafe(`SELECT (
      (SELECT count(*) FROM applications.packets WHERE temporary_materials IS DISTINCT FROM '[]'::jsonb
        OR restricted_value_id IS NOT NULL OR restricted_metadata_sha256 IS NOT NULL OR restricted_ciphertext_sha256 IS NOT NULL)
      +(SELECT count(*) FROM applications.outbox WHERE ${extras["applications.outbox"].map(([name]) => `${name} IS NOT NULL`).join(" OR ")})
      +(SELECT count(*) FROM applications.command_receipts WHERE operation<>'archived_legacy'
        AND (request_hash_scheme<>'sha256.v1' OR request_key_arn IS NOT NULL)))::text AS invalid`);
    if (invalid.length !== 1 || invalid[0]?.invalid !== "0") throw denied();
    admitted();
    // The unchanged ledger defaults to transaction now(); the atomic transition inserts all twelve together.
    const ledger =
      await tx.unsafe(`SELECT count(*)::text AS count,count(DISTINCT applied_at)::text AS instants,
      bool_and(applied_at>='${options.transitionStartedAt}'::timestamptz
        AND applied_at<='${options.transitionEndedAt}'::timestamptz) AS in_window
      FROM applications.schema_migrations WHERE version NOT IN (${versionSql})`);
    if (
      ledger.length !== 1 ||
      ledger[0]?.count !== "12" ||
      ledger[0]?.instants !== "1" ||
      ledger[0]?.in_window !== true
    )
      throw denied();
  }
  try {
    admitted();
    if (original === restored) throw denied();
    for (const date of [options.transitionStartedAt, options.transitionEndedAt])
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) ||
        new Date(date).toISOString() !== date
      )
        throw denied();
    const elapsed = Date.parse(options.transitionEndedAt) - Date.parse(options.transitionStartedAt);
    if (elapsed <= 0 || elapsed > 1800000) throw denied();
    contracts(options.originalSource, current);
    const beforeOld = await snapshot(original, false),
      beforeNew = await snapshot(restored, true);
    catalog(beforeOld.inventory, beforeNew.inventory);
    const comparison = compareRestoreDataInventories(
      beforeOld.inventory,
      beforeNew.inventory,
      options.originalSource,
      current,
    );
    const allowed = new Set([...Object.keys(baseColumns), ...addedTables]);
    if (
      comparison.differingRelations.some((name) => !allowed.has(name)) ||
      JSON.stringify(beforeOld.projections) !== JSON.stringify(beforeNew.projections)
    )
      throw denied();
    admitted();
    const receipts = await options.verifyReceipts(original, restored, admitted);
    admitted();
    if (receipts.matchedReceipts !== 7) throw denied();
    // Recheck complete snapshots after all KMS awaits settle, beyond the transformed receipt subset.
    const afterOld = await snapshot(original, false),
      afterNew = await snapshot(restored, true);
    if (
      JSON.stringify(beforeOld) !== JSON.stringify(afterOld) ||
      JSON.stringify(beforeNew) !== JSON.stringify(afterNew)
    )
      throw denied();
    admitted();
    return {
      schemaVersion: 1 as const,
      originalManifestSha256: options.originalSource.sha256,
      restoredManifestSha256: current.sha256,
      originalInventoryDigest: beforeOld.inventory.digest,
      restoredInventoryDigest: beforeNew.inventory.digest,
      commonRelations: 88 as const,
      addedTables: 8 as const,
      addedMigrations: 12 as const,
      matchedLegacyReceipts: 7 as const,
      transitionReconciled: true as const,
      privacyReplayAccepted: false as const,
      primaryPromotionAuthorized: false as const,
    };
  } catch {
    throw denied();
  }
}
