import { createHash } from "node:crypto";
import type postgres from "postgres";
import { canonicalHash } from "./canonical.js";
import type { createLegacyReceiptKmsCipher } from "./legacy-receipt-cipher.js";

type Query = postgres.Sql | postgres.TransactionSql;
type Operation = "create_packet" | "queue_preparation";
interface Row {
  owner_user_id: string;
  idempotency_key: string;
  application_id: string;
  response_revision: string;
  outcome_code: string | null;
  subject_id: string | null;
  created_at_exact: string;
  request_hash: string;
  request_hash_scheme: string;
  protection_id: string;
  original_operation: Operation;
  metadata_sha256: string;
  encryption_key_arn: string;
  ciphertext: Uint8Array;
}
export class LegacyReceiptReplayUnavailableError extends Error {
  constructor() {
    super("LegacyReceiptReplayUnavailable");
  }
}
export class LegacyReceiptReplayConflictError extends Error {
  constructor() {
    super("LegacyReceiptReplayConflict");
  }
}

/** The original request digest is deliberately absent from this metadata commitment. Preserve
 * original bigint revision and microsecond timestamp strings, rather than rounding via JS Date. */
export function legacyReceiptMetadataHash(
  row: Pick<
    Row,
    | "owner_user_id"
    | "idempotency_key"
    | "application_id"
    | "response_revision"
    | "outcome_code"
    | "subject_id"
    | "created_at_exact"
    | "original_operation"
  >,
) {
  return canonicalHash({
    ownerUserId: row.owner_user_id,
    idempotencyKey: row.idempotency_key,
    applicationId: row.application_id,
    responseRevision: row.response_revision,
    outcomeCode: row.outcome_code,
    subjectId: row.subject_id,
    createdAt: row.created_at_exact,
    operation: row.original_operation,
  });
}

/** Opaque process-local proofs never contain a digest or grant independent command authority. */
export function createLegacyReceiptReplay(
  client: postgres.Sql,
  options: {
    enabled(): boolean;
    cipher: Pick<ReturnType<typeof createLegacyReceiptKmsCipher>, "matches">;
  },
) {
  const enabled = options.enabled;
  const matches = options.cipher.matches.bind(options.cipher);
  const proofs = new WeakMap<object, { row: Row; binding: string }>();
  const permitted = () => {
    if (!enabled()) throw new LegacyReceiptReplayUnavailableError();
  };
  const binding = (row: Row) =>
    canonicalHash({
      ...row,
      ciphertext: Buffer.from(row.ciphertext).toString("hex"),
    });
  async function read(query: Query, owner: string, key: string, application: string) {
    permitted();
    await query`SELECT identity.require_active_candidate(${owner}::uuid)`;
    const [owned] = await query`SELECT id FROM applications.applications
      WHERE id=${application} AND owner_user_id=${owner} FOR SHARE`;
    if (!owned) throw new LegacyReceiptReplayUnavailableError();
    const [row] = await query<Row[]>`
      SELECT marker.owner_user_id, marker.idempotency_key, marker.application_id,
        marker.response_revision::text AS response_revision, marker.outcome_code, marker.subject_id,
        to_char(marker.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_exact,
        marker.request_hash, marker.request_hash_scheme, archived.protection_id,
        archived.original_operation, archived.metadata_sha256, archived.encryption_key_arn,
        archived.ciphertext
      FROM applications.command_receipts marker
      JOIN applications_restricted.legacy_receipts archived
        ON archived.owner_user_id=marker.owner_user_id AND archived.idempotency_key=marker.idempotency_key
        AND archived.application_id=marker.application_id
      WHERE marker.owner_user_id=${owner} AND marker.idempotency_key=${key}
        AND marker.application_id=${application} AND marker.operation='archived_legacy'
    `;
    if (
      row?.request_hash_scheme !== "legacy-ciphertext-sha256.v1" ||
      !(row.ciphertext instanceof Uint8Array) ||
      createHash("sha256").update(row.ciphertext).digest("hex") !== row.request_hash ||
      legacyReceiptMetadataHash(row) !== row.metadata_sha256
    )
      throw new LegacyReceiptReplayUnavailableError();
    return row;
  }

  return Object.freeze({
    async prepare(
      owner: string,
      application: string,
      key: string,
      operation: Operation,
      requestDigest: string,
    ) {
      try {
        const original = await client.begin((tx) => read(tx, owner, key, application));
        if (original.original_operation !== operation) throw new LegacyReceiptReplayConflictError();
        const originalBinding = binding(original);
        // The preceding transaction is finished. KMS never runs while owner/application locks are held.
        const match = await matches(
          {
            ownerUserId: owner,
            applicationId: application,
            protectionId: original.protection_id,
            operation,
            metadataSha256: original.metadata_sha256,
          },
          {
            schemaVersion: 1,
            encryptionKeyArn: original.encryption_key_arn,
            ciphertext: Uint8Array.from(original.ciphertext),
          },
          requestDigest,
        );
        permitted();
        const current = await client.begin((tx) => read(tx, owner, key, application));
        if (binding(current) !== originalBinding) throw new LegacyReceiptReplayUnavailableError();
        if (!match) throw new LegacyReceiptReplayConflictError();
        const proof = Object.freeze({});
        proofs.set(proof, { row: original, binding: originalBinding });
        return proof;
      } catch (error) {
        if (error instanceof LegacyReceiptReplayConflictError) throw error;
        throw new LegacyReceiptReplayUnavailableError();
      }
    },
    async assert(query: Query, proof: object, owner: string, key: string, operation: string) {
      try {
        permitted();
        const original = proofs.get(proof);
        if (
          !original ||
          original.row.owner_user_id !== owner ||
          original.row.idempotency_key !== key ||
          original.row.original_operation !== operation
        )
          throw new LegacyReceiptReplayUnavailableError();
        const row = await read(query, owner, key, original.row.application_id);
        if (binding(row) !== original.binding) throw new LegacyReceiptReplayUnavailableError();
        return {
          applicationId: row.application_id,
          outcomeCode: row.outcome_code,
          subjectId: row.subject_id,
        };
      } catch {
        throw new LegacyReceiptReplayUnavailableError();
      }
    },
  });
}
