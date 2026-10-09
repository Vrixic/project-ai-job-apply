import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { loadApplicationMigrations } from "./application-migrations.js";
import type {
  createLegacyReceiptKmsCipher,
  LegacyReceiptEnvelope,
  LegacyReceiptScope,
} from "./legacy-receipt-cipher.js";
import { legacyReceiptMetadataHash } from "./legacy-receipt-replay.js";

const tables = [
  "applications",
  "packets",
  "approvals",
  "attempts",
  "history",
  "command_receipts",
  "outbox",
  "schema_migrations",
  "packet_preparations",
  "preparation_outbox",
  "preparation_audit",
] as const;
type Tx = postgres.TransactionSql;
interface Receipt {
  owner_user_id: string;
  idempotency_key: string;
  application_id: string;
  original_operation: "create_packet" | "queue_preparation";
  request_hash: string;
  response_revision: string;
  outcome_code: string | null;
  subject_id: string | null;
  created_at_exact: string;
}
const refused = () => Error("LegacyReceiptTransitionUnavailable");

async function fingerprints(tx: Tx, names: readonly string[], columns?: Record<string, string[]>) {
  const result: Record<string, string> = {};
  for (const name of names) {
    const [size] = await tx`SELECT count(*)::int AS count FROM ${tx(`applications.${name}`)}`;
    if (!size || size.count > 10_000) throw refused();
    const [row] = columns
      ? await tx`SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(value ORDER BY value::text), '[]'::jsonb)::text, 'UTF8')), 'hex') AS hash
          FROM (SELECT (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(record))
            WHERE key=ANY(${columns[name] ?? []}::text[])) AS value FROM ${tx(`applications.${name}`)} record) projected`
      : await tx`SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(record) ORDER BY to_jsonb(record)::text), '[]'::jsonb)::text, 'UTF8')), 'hex') AS hash
          FROM ${tx(`applications.${name}`)} record`;
    result[name] = row?.hash;
  }
  return JSON.stringify(result);
}

/** Explicit maintenance capability, never called by the ordinary migration driver. Its caller
 * must establish drained runtimes and recoverable backups. No candidate values or original
 * digests are returned/logged. SQL failures and crypto failures share one fixed error. */
export async function transitionLegacyReceipts(
  client: postgres.Sql,
  options: {
    enabled(): boolean;
    cipher: Pick<ReturnType<typeof createLegacyReceiptKmsCipher>, "encrypt" | "matches">;
    expectedAppliedMigrations?: number;
    expectedLegacyReceipts?: number;
  },
) {
  const enabled = options.enabled;
  const encrypt = options.cipher.encrypt.bind(options.cipher);
  const matches = options.cipher.matches.bind(options.cipher);
  const expectedMigrations = options.expectedAppliedMigrations;
  const expectedReceipts = options.expectedLegacyReceipts;
  const admitted = () => {
    if (!enabled()) throw refused();
  };
  try {
    admitted();
    const migrations = await loadApplicationMigrations();
    async function inventory(tx: Tx) {
      const ledger = await tx<{ version: string; checksum: string }[]>`
        SELECT version,checksum FROM applications.schema_migrations ORDER BY version`;
      if (
        ledger.length < 3 ||
        ledger.length > 8 ||
        ledger.some(
          (row, index) =>
            row.version !== migrations[index]?.version ||
            row.checksum !== migrations[index]?.checksum,
        )
      )
        throw refused();
      const relations = await tx<{ relname: string }[]>`SELECT c.relname FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='applications' AND c.relkind='r' ORDER BY c.relname`;
      const names = relations.map((row) => row.relname);
      const expected = tables.slice(0, ledger.length >= 4 ? 11 : 8).toSorted();
      if (JSON.stringify(names) !== JSON.stringify(expected)) throw refused();
      const [boundary] = await tx`SELECT
        to_regnamespace('applications_receipt_transition') AS staging,
        to_regnamespace('applications_restricted') AS restricted,
        (SELECT count(*)::int FROM pg_constraint WHERE confrelid='applications.command_receipts'::regclass) AS incoming,
        (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='applications.command_receipts'::regclass AND NOT tgisinternal
          AND (tgenabled<>'O' OR tgname NOT IN ('command_receipts_immutable','command_receipts_candidate_delete_guard'))) AS unexpected_triggers,
        (SELECT count(*)::int FROM pg_trigger WHERE tgrelid='applications.command_receipts'::regclass AND NOT tgisinternal) AS triggers,
        (SELECT count(*)::int FROM pg_rewrite WHERE ev_class='applications.command_receipts'::regclass) AS rules,
        (SELECT relacl IS NULL AND NOT relrowsecurity AND NOT relforcerowsecurity AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)
          AND relpersistence='p' AND NOT relispartition
          AND NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='applications.command_receipts'::regclass AND attacl IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM pg_default_acl WHERE defaclrole=relowner AND defaclobjtype='r'
            AND defaclnamespace IN (0,relnamespace))
          FROM pg_class WHERE oid='applications.command_receipts'::regclass) AS owned_plain_table`;
      if (
        !boundary ||
        boundary.staging !== null ||
        boundary.restricted !== null ||
        boundary.incoming !== 0 ||
        boundary.unexpected_triggers !== 0 ||
        boundary.triggers !== 2 ||
        boundary.rules !== 0 ||
        boundary.owned_plain_table !== true
      )
        throw refused();
      const structure =
        await tx`SELECT c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull
        FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='applications' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`;
      const receiptColumns = structure
        .filter((row) => row.relname === "command_receipts")
        .map((row) => row.attname);
      if (
        JSON.stringify(receiptColumns) !==
        JSON.stringify([
          "owner_user_id",
          "idempotency_key",
          "operation",
          "request_hash",
          "application_id",
          "response_revision",
          "outcome_code",
          "subject_id",
          "created_at",
        ])
      )
        throw refused();
      const constraints =
        await tx`SELECT c.relname,p.conname,pg_get_constraintdef(p.oid) AS definition,p.convalidated
        FROM pg_constraint p JOIN pg_class c ON c.oid=p.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='applications' ORDER BY c.relname,p.conname`;
      const triggers =
        await tx`SELECT c.relname,t.tgname,pg_get_triggerdef(t.oid) AS definition,t.tgenabled
        FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='applications' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`;
      const rows = await fingerprints(tx, names);
      const functions = await tx`SELECT p.proname,pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='applications' ORDER BY p.proname,p.oid`;
      const columns: Record<string, string[]> = {};
      for (const row of structure) {
        columns[row.relname] ??= [];
        columns[row.relname]?.push(row.attname);
      }
      const receipts = await tx<Receipt[]>`SELECT owner_user_id,idempotency_key,application_id,
        operation AS original_operation,request_hash,response_revision::text AS response_revision,outcome_code,subject_id,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_exact
        FROM applications.command_receipts WHERE operation IN ('create_packet','queue_preparation')
        ORDER BY owner_user_id,idempotency_key LIMIT 1001`;
      if (receipts.length === 0 || receipts.length > 1000) throw refused();
      if (
        (expectedMigrations !== undefined && ledger.length !== expectedMigrations) ||
        (expectedReceipts !== undefined && receipts.length !== expectedReceipts)
      )
        throw refused();
      for (const owner of [...new Set(receipts.map((row) => row.owner_user_id))].toSorted())
        await tx`SELECT identity.require_active_candidate(${owner}::uuid)`;
      return {
        names,
        columns,
        receipts,
        count: ledger.length,
        rows,
        signature: JSON.stringify({ ledger, structure, constraints, triggers, functions, rows }),
      };
    }
    const original = await client.begin("isolation level repeatable read", async (tx) => {
      await tx`SET LOCAL statement_timeout='30s'`;
      await tx`SET LOCAL lock_timeout='5s'`;
      return inventory(tx);
    });
    // No SQL transaction/lock survives into the crypto phase.
    const prepared: Array<{
      row: Receipt;
      scope: LegacyReceiptScope;
      envelope: LegacyReceiptEnvelope;
    }> = [];
    for (const row of original.receipts) {
      admitted();
      const scope = {
        ownerUserId: row.owner_user_id,
        applicationId: row.application_id,
        protectionId: uuidv7(),
        operation: row.original_operation,
        metadataSha256: legacyReceiptMetadataHash(row),
      };
      const encrypted = await encrypt(scope, row.request_hash);
      const envelope = { ...encrypted, ciphertext: Uint8Array.from(encrypted.ciphertext) };
      if (!(await matches(scope, envelope, row.request_hash))) throw refused();
      admitted();
      prepared.push({ row, scope, envelope });
    }
    return await client.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout='30s'`;
      await tx`SET LOCAL lock_timeout='5s'`;
      await tx`SELECT pg_advisory_xact_lock(hashtext('ai-job-apply:applications-migrations'))`;
      for (const name of [...original.names].sort())
        await tx`LOCK TABLE ${tx(`applications.${name}`)} IN ACCESS EXCLUSIVE MODE`;
      admitted();
      const current = await inventory(tx);
      if (current.signature !== original.signature) throw refused();
      await tx.unsafe(`CREATE SCHEMA applications_receipt_transition;
        REVOKE ALL ON SCHEMA applications_receipt_transition FROM PUBLIC;
        ALTER TABLE applications.command_receipts SET SCHEMA applications_receipt_transition;
        CREATE TABLE applications.command_receipts (LIKE applications_receipt_transition.command_receipts INCLUDING ALL);
        ALTER TABLE applications.command_receipts ADD CONSTRAINT command_receipts_application_fk
          FOREIGN KEY (application_id,owner_user_id) REFERENCES applications.applications(id,owner_user_id) ON DELETE RESTRICT;
        CREATE TRIGGER command_receipts_immutable BEFORE UPDATE ON applications.command_receipts
          FOR EACH ROW EXECUTE FUNCTION applications.reject_append_only_mutation();
        CREATE TRIGGER command_receipts_candidate_delete_guard BEFORE DELETE ON applications.command_receipts
          FOR EACH ROW EXECUTE FUNCTION applications.guard_candidate_delete();
        INSERT INTO applications.command_receipts SELECT * FROM applications_receipt_transition.command_receipts
          WHERE operation NOT IN ('create_packet','queue_preparation');`);
      for (const migration of migrations.slice(current.count)) {
        await tx.unsafe(migration.sql);
        await tx`INSERT INTO applications.schema_migrations(version,checksum) VALUES (${migration.version},${migration.checksum})`;
      }
      for (const { row, scope, envelope } of prepared) {
        await tx`INSERT INTO applications.command_receipts
          (owner_user_id,idempotency_key,application_id,operation,request_hash,request_hash_scheme,
            response_revision,outcome_code,subject_id,created_at)
          VALUES (${row.owner_user_id},${row.idempotency_key},${row.application_id},'archived_legacy',
            ${createHash("sha256").update(envelope.ciphertext).digest("hex")},'legacy-ciphertext-sha256.v1',
            ${row.response_revision},${row.outcome_code},${row.subject_id},${row.created_at_exact}::text::timestamptz)`;
        await tx`INSERT INTO applications_restricted.legacy_receipts
          (owner_user_id,idempotency_key,application_id,protection_id,original_operation,metadata_sha256,encryption_key_arn,ciphertext)
          VALUES (${row.owner_user_id},${row.idempotency_key},${row.application_id},${scope.protectionId},
            ${row.original_operation},${scope.metadataSha256},${envelope.encryptionKeyArn},${Buffer.from(envelope.ciphertext)})`;
      }
      const preserved = original.names.filter(
        (name) => !["command_receipts", "schema_migrations"].includes(name),
      );
      const before = JSON.parse(original.rows) as Record<string, string>;
      const after = JSON.parse(await fingerprints(tx, preserved, original.columns)) as Record<
        string,
        string
      >;
      if (preserved.some((name) => before[name] !== after[name])) throw refused();
      const [ordinary] = await tx`SELECT NOT EXISTS (
        (SELECT owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,outcome_code,subject_id,created_at
          FROM applications_receipt_transition.command_receipts WHERE operation NOT IN ('create_packet','queue_preparation')
        EXCEPT SELECT owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,outcome_code,subject_id,created_at
          FROM applications.command_receipts WHERE operation<>'archived_legacy')
        UNION ALL
        (SELECT owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,outcome_code,subject_id,created_at
          FROM applications.command_receipts WHERE operation<>'archived_legacy'
        EXCEPT SELECT owner_user_id,idempotency_key,operation,request_hash,application_id,response_revision,outcome_code,subject_id,created_at
          FROM applications_receipt_transition.command_receipts WHERE operation NOT IN ('create_packet','queue_preparation'))
      ) AS equal`;
      if (ordinary?.equal !== true) throw refused();
      const [metadata] = await tx`WITH original AS (
        SELECT owner_user_id,idempotency_key,application_id,operation,response_revision,outcome_code,subject_id,created_at
        FROM applications_receipt_transition.command_receipts WHERE operation IN ('create_packet','queue_preparation')
      ), protected AS (
        SELECT m.owner_user_id,m.idempotency_key,m.application_id,a.original_operation AS operation,
          m.response_revision,m.outcome_code,m.subject_id,m.created_at
        FROM applications.command_receipts m JOIN applications_restricted.legacy_receipts a
          USING (owner_user_id,idempotency_key) WHERE m.operation='archived_legacy'
      ) SELECT NOT EXISTS ((SELECT * FROM original EXCEPT SELECT * FROM protected)
        UNION ALL (SELECT * FROM protected EXCEPT SELECT * FROM original)) AS equal`;
      if (metadata?.equal !== true) throw refused();
      await tx`SET CONSTRAINTS ALL IMMEDIATE`;
      admitted();
      // RESTRICT, never CASCADE: an unexpected dependency aborts the entire replacement.
      await tx.unsafe(`DROP TABLE applications_receipt_transition.command_receipts RESTRICT;
        DROP SCHEMA applications_receipt_transition RESTRICT;`);
      return {
        archivedReceipts: prepared.length,
        appliedMigrations: migrations.length - current.count,
      };
    });
  } catch {
    throw refused();
  }
}
