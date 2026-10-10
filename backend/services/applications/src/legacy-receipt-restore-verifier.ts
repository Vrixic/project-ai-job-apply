import { createHash } from "node:crypto";
import { createLegacyReceiptKmsCipher } from "./legacy-receipt-cipher.js";
import { legacyReceiptMetadataHash } from "./legacy-receipt-replay.js";

interface Executor {
  unsafe<T extends Record<string, unknown>>(query: string): Promise<T[]>;
}
interface Client {
  begin<T>(
    options: "read only isolation level repeatable read",
    work: (transaction: Executor) => Promise<T>,
  ): Promise<T>;
}
interface Receipt {
  owner_user_id: string;
  idempotency_key: string;
  application_id: string;
  original_operation: "create_packet" | "queue_preparation";
  response_revision: string;
  outcome_code: string | null;
  subject_id: string | null;
  created_at_exact: string;
  request_hash: string;
}
interface Archive extends Receipt {
  protection_id: string;
  metadata_sha256: string;
  encryption_key_arn: string;
  ciphertext: Uint8Array;
  marker_valid: boolean;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const keys = [
  "owner_user_id",
  "idempotency_key",
  "application_id",
  "original_operation",
  "response_revision",
  "outcome_code",
  "subject_id",
  "created_at_exact",
  "request_hash",
];
const refused = () => Error("LegacyReceiptRestoreVerificationUnavailable");

export function createLegacyReceiptRestoreVerifier(options: {
  encryptionKeyArn: string;
  enabled(): boolean;
  verifyActiveOwners(transaction: Executor, owners: readonly string[]): Promise<void>;
}) {
  return {
    verify: (original: Client, restored: Client, admission: () => void = () => {}) => {
      const start = process.hrtime.bigint();
      const enabled = () => {
        admission();
        return options.enabled() && process.hrtime.bigint() - start < 60_000_000_000n;
      };
      const cipher = createLegacyReceiptKmsCipher({ ...options, enabled, readOnly: true });
      return verifyLegacyReceiptRestore(original, restored, { ...options, enabled, cipher });
    },
  };
}

function validate(row: Record<string, unknown>, archived: boolean): void {
  const expected = archived
    ? [
        ...keys,
        "protection_id",
        "metadata_sha256",
        "encryption_key_arn",
        "ciphertext",
        "marker_valid",
      ]
    : keys;
  if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify([...expected].sort()))
    throw refused();
  if (
    ![row.owner_user_id, row.application_id].every(
      (value) => typeof value === "string" && uuid.test(value),
    ) ||
    typeof row.idempotency_key !== "string" ||
    row.idempotency_key.length < 16 ||
    row.idempotency_key.length > 128 ||
    !["create_packet", "queue_preparation"].includes(String(row.original_operation)) ||
    typeof row.response_revision !== "string" ||
    !/^[1-9][0-9]{0,18}$/.test(row.response_revision) ||
    (row.outcome_code !== null &&
      (typeof row.outcome_code !== "string" ||
        row.outcome_code.length < 1 ||
        row.outcome_code.length > 200)) ||
    (row.subject_id !== null &&
      (typeof row.subject_id !== "string" || !uuid.test(row.subject_id))) ||
    typeof row.created_at_exact !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.created_at_exact) ||
    typeof row.request_hash !== "string" ||
    !hash.test(row.request_hash)
  )
    throw refused();
  if (
    archived &&
    (typeof row.protection_id !== "string" ||
      !uuid.test(row.protection_id) ||
      typeof row.metadata_sha256 !== "string" ||
      !hash.test(row.metadata_sha256) ||
      typeof row.encryption_key_arn !== "string" ||
      !(row.ciphertext instanceof Uint8Array) ||
      row.ciphertext.byteLength < 1 ||
      row.ciphertext.byteLength > 6144 ||
      row.marker_valid !== true ||
      createHash("sha256").update(row.ciphertext).digest("hex") !== row.request_hash)
  )
    throw refused();
}
const identity = (row: Receipt) => JSON.stringify([row.owner_user_id, row.idempotency_key]);
function signature(rows: readonly (Receipt | Archive)[]): string {
  // This commitment stays process-local; original digests never enter diagnostic output.
  return createHash("sha256")
    .update(
      JSON.stringify(
        rows.map((row) => ({
          ...row,
          ...("ciphertext" in row
            ? { ciphertext: Buffer.from(row.ciphertext).toString("hex") }
            : {}),
        })),
      ),
    )
    .digest("hex");
}

/** Fixed three-to-fifteen ledger diagnostic, not replay or migration authority. The caller must
 * independently bind both distinct isolated restores and verify their complete schema/data inventories.
 * Only seven protected original hashes are read transiently. No SQL transaction survives into KMS. */
export async function verifyLegacyReceiptRestore(
  original: Client,
  restored: Client,
  options: {
    enabled(): boolean;
    encryptionKeyArn: string;
    verifyActiveOwners(transaction: Executor, owners: readonly string[]): Promise<void>;
    cipher: Pick<ReturnType<typeof createLegacyReceiptKmsCipher>, "matches">;
  },
): Promise<{ readonly matchedReceipts: 7 }> {
  const started = process.hrtime.bigint();
  const admitted = () => {
    if (!options.enabled() || process.hrtime.bigint() - started >= 60_000_000_000n) throw refused();
  };
  const captured: Uint8Array[] = [];
  async function read(client: Client, archived: boolean): Promise<Receipt[] | Archive[]> {
    admitted();
    const rows = await client.begin("read only isolation level repeatable read", async (tx) => {
      await tx.unsafe(
        "SET LOCAL statement_timeout='15s'; SET LOCAL lock_timeout='5s'; SET LOCAL TimeZone='UTC'; SET LOCAL search_path=pg_catalog",
      );
      admitted();
      const ledger = await tx.unsafe<{ count: string }>(
        "SELECT count(*)::text AS count FROM applications.schema_migrations",
      );
      if (ledger.length !== 1 || ledger[0]?.count !== (archived ? "15" : "3")) throw refused();
      admitted();
      const rows = await tx.unsafe<Record<string, unknown>>(
        archived
          ? `SELECT
        marker.owner_user_id, marker.idempotency_key, marker.application_id,
        archived.original_operation, marker.response_revision::text AS response_revision,
        marker.outcome_code, marker.subject_id,
        to_char(marker.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_exact,
        marker.request_hash, archived.protection_id, archived.metadata_sha256,
        archived.encryption_key_arn, archived.ciphertext,
        (marker.operation='archived_legacy' AND marker.request_hash_scheme='legacy-ciphertext-sha256.v1'
          AND marker.request_key_arn IS NULL AND marker.application_id=archived.application_id) AS marker_valid
        FROM applications.command_receipts marker FULL JOIN applications_restricted.legacy_receipts archived
          USING(owner_user_id,idempotency_key)
        WHERE marker.operation='archived_legacy' OR archived.owner_user_id IS NOT NULL
        ORDER BY marker.owner_user_id,marker.idempotency_key COLLATE "C" LIMIT 8`
          : `SELECT owner_user_id,idempotency_key,application_id,operation AS original_operation,
        response_revision::text AS response_revision,outcome_code,subject_id,
        to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_exact,
        request_hash FROM applications.command_receipts WHERE operation IN ('create_packet','queue_preparation')
        ORDER BY owner_user_id,idempotency_key COLLATE "C" LIMIT 8`,
      );

      // Capture buffers before admission or shape checks can fail; every failure clears them.
      for (const row of rows)
        if (row.ciphertext instanceof Uint8Array) captured.push(row.ciphertext);
      admitted();
      if (rows.length !== 7) throw refused();
      for (const row of rows) validate(row, archived);
      const typed = rows as unknown as Receipt[] | Archive[];
      if (new Set(typed.map(identity)).size !== 7) throw refused();
      if (archived && new Set((typed as Archive[]).map((row) => row.protection_id)).size !== 7)
        throw refused();
      // Identity owns this point-in-time read. A write lease would violate READ ONLY.
      admitted();
      await options.verifyActiveOwners(tx, [...new Set(typed.map((row) => row.owner_user_id))]);
      admitted();
      return typed;
    });
    admitted();
    const typed = rows;
    return typed;
  }
  try {
    admitted();
    if (original === restored) throw refused();
    const oldRows = (await read(original, false)) as Receipt[];
    const newRows = (await read(restored, true)) as Archive[];
    const oldSignature = signature(oldRows),
      newSignature = signature(newRows);
    const archives = new Map(newRows.map((row) => [identity(row), row]));
    for (const row of oldRows) {
      admitted();
      const archive = archives.get(identity(row));
      if (
        !archive ||
        archive.encryption_key_arn !== options.encryptionKeyArn ||
        legacyReceiptMetadataHash(row) !== archive.metadata_sha256 ||
        legacyReceiptMetadataHash(archive) !== archive.metadata_sha256
      )
        throw refused();
      const matched = await options.cipher.matches(
        {
          ownerUserId: row.owner_user_id,
          applicationId: row.application_id,
          protectionId: archive.protection_id,
          operation: row.original_operation,
          metadataSha256: archive.metadata_sha256,
        },
        {
          schemaVersion: 1,
          encryptionKeyArn: archive.encryption_key_arn,
          ciphertext: archive.ciphertext,
        },
        row.request_hash,
      );
      admitted();
      if (matched !== true) throw refused();
    }
    // The cipher awaits have settled before re-reading; no SQL lock spans crypto.
    if (
      signature(await read(original, false)) !== oldSignature ||
      signature(await read(restored, true)) !== newSignature
    )
      throw refused();
    admitted();
    return { matchedReceipts: 7 };
  } catch {
    throw refused();
  } finally {
    for (const buffer of captured) buffer.fill(0);
  }
}
