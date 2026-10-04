import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";

/**
 * Restricted answer vault (ADR-010, D3-001). A dedicated, separately encrypted boundary for
 * values the candidate supplies and chooses to save for reuse (work authorization, voluntary
 * demographics, sponsorship, and similar). Persistence and matching are deliberately split:
 * `packages/domain/src/answer-vault.ts` decides which stored entry answers a question; this file
 * only stores and retrieves ciphertext. The value is never held in the clear in this process
 * longer than one encrypt or decrypt call, and it is never logged.
 *
 * Concurrency follows the same optimistic pattern as Applications packets (`expectedRevision`):
 * the caller supplies the version it last saw (0 for a new entry), and a mismatch is a conflict
 * to retry, never a silent overwrite. Encryption happens before any database transaction opens,
 * so a slow KMS round trip never holds a connection or an advisory lock.
 */

const FIELD_KEY = /\S/u;
const MAX_KEY_LENGTH = 120;
const MAX_VALUE_BYTES = 3_900; // Leaves margin under the 4096-byte ciphertext column bound.

export type RestrictedAnswerValueType = "string" | "text" | "boolean" | "date" | "decimal" | "enum";
export type RestrictedAnswerSensitivity = "confidential" | "restricted";

export interface RestrictedAnswerCiphertext {
  ciphertext: Uint8Array;
  kmsKeyId: string;
  encryptionAlgorithm: "SYMMETRIC_DEFAULT";
}

/**
 * The only boundary that ever sees a restricted answer's plaintext. The real implementation calls
 * AWS KMS directly (values are short scalars, well under its 4096-byte limit for symmetric
 * Encrypt/Decrypt); tests use a fake that never leaves the process.
 */
export interface RestrictedAnswerCipher {
  encrypt(input: {
    userId: string;
    fieldKey: string;
    context: string;
    plaintext: string;
  }): Promise<RestrictedAnswerCiphertext>;
  decrypt(input: {
    userId: string;
    fieldKey: string;
    context: string;
    ciphertext: RestrictedAnswerCiphertext;
  }): Promise<string>;
}

export class RestrictedAnswerVaultConfigurationError extends Error {
  constructor() {
    super("A restricted-answer cipher is required to use the vault");
    this.name = "RestrictedAnswerVaultConfigurationError";
  }
}

export class RestrictedAnswerVaultInputError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "RestrictedAnswerVaultInputError";
  }
}

/** The caller's expected version does not match the current version; reread and retry. */
export class RestrictedAnswerVaultConflictError extends Error {
  constructor() {
    super("The restricted answer vault entry changed since it was last read");
    this.name = "RestrictedAnswerVaultConflictError";
  }
}

export class RestrictedAnswerVaultNotFoundError extends Error {
  constructor() {
    super("No matching restricted answer vault entry exists for this owner");
    this.name = "RestrictedAnswerVaultNotFoundError";
  }
}

/** The idempotency key was reused for a materially different request. */
export class RestrictedAnswerVaultIdempotencyConflictError extends Error {
  constructor() {
    super("The idempotency key was already used for a different request");
    this.name = "RestrictedAnswerVaultIdempotencyConflictError";
  }
}

export interface RestrictedAnswerSummary {
  id: string;
  fieldKey: string;
  context?: string;
  valueType: RestrictedAnswerValueType;
  sensitivity: RestrictedAnswerSensitivity;
  state: "active" | "deleted";
  version: number;
  confirmedAt: string;
  createdAt: string;
  expiresAt?: string;
}

export interface SaveRestrictedAnswerCommand {
  userId: string;
  fieldKey: string;
  context?: string;
  /** 0 to create a new entry; otherwise the version last read, enforced optimistically. */
  expectedVersion: number;
  valueType: RestrictedAnswerValueType;
  value: string;
  sensitivity: RestrictedAnswerSensitivity;
  sourceReference: string;
  confirmedAt: Date;
  expiresAt?: Date;
  idempotencyKey: string;
  traceId: string;
}

export interface RemoveRestrictedAnswerCommand {
  userId: string;
  id: string;
  expectedVersion: number;
  traceId: string;
}

export interface RemoveRestrictedAnswerByFieldCommand {
  userId: string;
  fieldKey: string;
  context?: string;
  traceId: string;
}

export interface RestrictedAnswerVaultStore {
  save(command: SaveRestrictedAnswerCommand): Promise<{ id: string; version: number }>;
  list(userId: string): Promise<readonly RestrictedAnswerSummary[]>;
  remove(command: RemoveRestrictedAnswerCommand): Promise<{ version: number }>;
  /** Deletes whatever is currently active, if anything; naming an absent entry is a benign no-op. */
  removeByField(command: RemoveRestrictedAnswerByFieldCommand): Promise<{ deleted: boolean }>;
}

function assertKey(value: string | undefined, label: string, required: boolean): void {
  if (value === undefined) {
    if (required) throw new RestrictedAnswerVaultInputError(`${label} is required`);
    return;
  }
  if (value.length === 0 || value.length > MAX_KEY_LENGTH || !FIELD_KEY.test(value)) {
    throw new RestrictedAnswerVaultInputError(`${label} is invalid`);
  }
}

function assertCommand(command: SaveRestrictedAnswerCommand): void {
  assertKey(command.fieldKey, "fieldKey", true);
  assertKey(command.context, "context", false);
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 0) {
    throw new RestrictedAnswerVaultInputError("expectedVersion is invalid");
  }
  if (
    Buffer.byteLength(command.value, "utf8") === 0 ||
    Buffer.byteLength(command.value, "utf8") > MAX_VALUE_BYTES
  ) {
    throw new RestrictedAnswerVaultInputError("value is invalid");
  }
  if (
    command.sourceReference.length === 0 ||
    command.sourceReference.length > 200 ||
    !FIELD_KEY.test(command.sourceReference)
  ) {
    throw new RestrictedAnswerVaultInputError("sourceReference is invalid");
  }
  if (command.expiresAt && command.expiresAt <= command.confirmedAt) {
    throw new RestrictedAnswerVaultInputError("expiresAt must be after confirmedAt");
  }
  if (command.idempotencyKey.length < 16 || command.idempotencyKey.length > 128) {
    throw new RestrictedAnswerVaultInputError("idempotencyKey is invalid");
  }
}

/**
 * Deliberately excludes the plaintext `value`: several restricted answers have a tiny value space
 * (yes/no, a short enum), so a hash including it would let anyone who can read
 * `platform.idempotency_keys` brute-force the answer without ever calling KMS. A client that reuses
 * one idempotency key for two different values is a client bug this hash does not catch; that
 * trade-off is intentional.
 */
function requestHash(command: SaveRestrictedAnswerCommand): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        fieldKey: command.fieldKey,
        context: command.context ?? "",
        expectedVersion: command.expectedVersion,
        valueType: command.valueType,
        sensitivity: command.sensitivity,
        sourceReference: command.sourceReference,
        confirmedAt: command.confirmedAt.toISOString(),
        expiresAt: command.expiresAt?.toISOString() ?? null,
      }),
    )
    .digest("hex");
}

// This store is always composed with the shared, camelCase-transforming client (`createDatabase`),
// never a raw or transaction-scoped client from another service; every row type below matches that
// transform rather than the underlying snake_case column names. A timestamptz column can come back
// as either a Date or a string depending on how it was read, so every row type allows both.
function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

interface VersionRow {
  answerId: string;
  version: number;
  valueType: RestrictedAnswerValueType;
  sensitivity: RestrictedAnswerSensitivity;
  state: "active" | "deleted";
  confirmedAt: Date | string;
  expiresAt: Date | string | null;
}

export class PostgresRestrictedAnswerVaultStore implements RestrictedAnswerVaultStore {
  constructor(
    private readonly client: postgres.Sql,
    private readonly cipher: RestrictedAnswerCipher | undefined,
  ) {}

  private requireCipher(): RestrictedAnswerCipher {
    if (!this.cipher) throw new RestrictedAnswerVaultConfigurationError();
    return this.cipher;
  }

  async save(command: SaveRestrictedAnswerCommand): Promise<{ id: string; version: number }> {
    const cipher = this.requireCipher();
    assertCommand(command);
    const context = command.context ?? "";
    const scope = `restricted-answer-vault.save.v1:${command.fieldKey}:${context}`;
    const hash = requestHash(command);
    // Best-effort, outside any lock: skips a pointless KMS call on the common retry. The
    // authoritative check happens inside the transaction below regardless.
    const [precheck] = await this.client<Array<{ requestHash: string; response: unknown }>>`
      SELECT request_hash AS "requestHash", response
      FROM platform.idempotency_keys
      WHERE user_id = ${command.userId}::uuid AND scope = ${scope} AND key = ${command.idempotencyKey}
    `;
    if (precheck) {
      if (precheck.requestHash !== hash) throw new RestrictedAnswerVaultIdempotencyConflictError();
      return precheck.response as { id: string; version: number };
    }
    const encrypted = await cipher.encrypt({
      userId: command.userId,
      fieldKey: command.fieldKey,
      context,
      plaintext: command.value,
    });
    const nextVersion = command.expectedVersion + 1;
    return this.client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`restricted-answer:${command.userId}:${command.fieldKey}:${context}`}))`;
      const [prior] = await tx<Array<{ requestHash: string; response: unknown }>>`
        SELECT request_hash AS "requestHash", response
        FROM platform.idempotency_keys
        WHERE user_id = ${command.userId}::uuid AND scope = ${scope} AND key = ${command.idempotencyKey}
      `;
      if (prior) {
        if (prior.requestHash !== hash) throw new RestrictedAnswerVaultIdempotencyConflictError();
        return prior.response as { id: string; version: number };
      }
      const candidateId = uuidv7();
      const [row] = await tx<Array<{ id: string }>>`
        INSERT INTO profile.restricted_answers (id, user_id, field_key, context)
        VALUES (${candidateId}, ${command.userId}::uuid, ${command.fieldKey}, ${command.context ?? null})
        ON CONFLICT (user_id, field_key, coalesce(context, ''))
        DO UPDATE SET field_key = excluded.field_key
        RETURNING id
      `;
      const answerId = row?.id;
      if (!answerId) throw new Error("RestrictedAnswerVaultUpsertFailed");
      const [latest] = await tx<Array<{ version: number }>>`
        SELECT version FROM profile.restricted_answer_versions
        WHERE answer_id = ${answerId}::uuid
        ORDER BY version DESC LIMIT 1 FOR UPDATE
      `;
      const currentVersion = latest?.version ?? 0;
      if (currentVersion !== command.expectedVersion) {
        throw new RestrictedAnswerVaultConflictError();
      }
      // Dates travel as ISO strings, not raw Date objects: the shared client is wrapped by
      // drizzle-orm for other callers, and that wrapper breaks postgres.js's own Date parameter
      // serialization for a plain tagged-template query, the same reason every other raw insert in
      // this package casts an ISO string instead of binding a Date (see ugc-contribution-consent.ts).
      await tx`
        INSERT INTO profile.restricted_answer_versions (
          answer_id, version, value_type, sensitivity, ciphertext, kms_key_id,
          encryption_algorithm, state, source_reference, confirmed_at, expires_at
        ) VALUES (
          ${answerId}::uuid, ${nextVersion}, ${command.valueType}, ${command.sensitivity},
          ${Buffer.from(encrypted.ciphertext)}, ${encrypted.kmsKeyId}, ${encrypted.encryptionAlgorithm},
          'active', ${command.sourceReference}, ${command.confirmedAt.toISOString()}::timestamptz,
          ${command.expiresAt ? command.expiresAt.toISOString() : null}::timestamptz
        )
      `;
      const response = { id: answerId, version: nextVersion };
      await tx`
        INSERT INTO platform.idempotency_keys (user_id, scope, key, request_hash, response)
        VALUES (
          ${command.userId}::uuid, ${scope}, ${command.idempotencyKey}, ${hash},
          ${JSON.stringify(response)}::jsonb
        )
      `;
      return response;
    });
  }

  async remove(command: RemoveRestrictedAnswerCommand): Promise<{ version: number }> {
    if (!Number.isInteger(command.expectedVersion) || command.expectedVersion < 1) {
      throw new RestrictedAnswerVaultInputError("expectedVersion is invalid");
    }
    return this.client.begin(async (tx) => {
      const [owned] = await tx<Array<{ id: string; fieldKey: string; context: string | null }>>`
        SELECT id, field_key, context FROM profile.restricted_answers
        WHERE id = ${command.id}::uuid AND user_id = ${command.userId}::uuid
      `;
      if (!owned) throw new RestrictedAnswerVaultNotFoundError();
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`restricted-answer:${command.userId}:${owned.fieldKey}:${owned.context ?? ""}`}))`;
      const [current] = await tx<VersionRow[]>`
        SELECT answer_id, version, value_type, sensitivity, state, confirmed_at, expires_at
        FROM profile.restricted_answer_versions
        WHERE answer_id = ${command.id}::uuid
        ORDER BY version DESC LIMIT 1 FOR UPDATE
      `;
      if (!current || current.version !== command.expectedVersion) {
        throw new RestrictedAnswerVaultConflictError();
      }
      if (current.state === "deleted") return { version: current.version };
      const nextVersion = current.version + 1;
      // The ciphertext carries forward unchanged: deleting needs no plaintext and no new KMS call.
      await tx`
        INSERT INTO profile.restricted_answer_versions (
          answer_id, version, value_type, sensitivity, ciphertext, kms_key_id,
          encryption_algorithm, state, source_reference, confirmed_at, expires_at
        )
        SELECT answer_id, ${nextVersion}, value_type, sensitivity, ciphertext, kms_key_id,
               encryption_algorithm, 'deleted', source_reference, confirmed_at, expires_at
        FROM profile.restricted_answer_versions
        WHERE answer_id = ${command.id}::uuid AND version = ${current.version}
      `;
      return { version: nextVersion };
    });
  }

  async removeByField(
    command: RemoveRestrictedAnswerByFieldCommand,
  ): Promise<{ deleted: boolean }> {
    const context = command.context ?? "";
    return this.client.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`restricted-answer:${command.userId}:${command.fieldKey}:${context}`}))`;
      const [current] = await tx<
        Array<{ id: string; version: number; state: "active" | "deleted" }>
      >`
        SELECT answer.id, version.version, version.state
        FROM profile.restricted_answers AS answer
        JOIN LATERAL (
          SELECT * FROM profile.restricted_answer_versions
          WHERE answer_id = answer.id ORDER BY version DESC LIMIT 1
        ) AS version ON true
        WHERE answer.user_id = ${command.userId}::uuid
          AND answer.field_key = ${command.fieldKey}
          AND coalesce(answer.context, '') = ${context}
        FOR UPDATE OF version
      `;
      if (!current || current.state === "deleted") return { deleted: false };
      const nextVersion = current.version + 1;
      await tx`
        INSERT INTO profile.restricted_answer_versions (
          answer_id, version, value_type, sensitivity, ciphertext, kms_key_id,
          encryption_algorithm, state, source_reference, confirmed_at, expires_at
        )
        SELECT answer_id, ${nextVersion}, value_type, sensitivity, ciphertext, kms_key_id,
               encryption_algorithm, 'deleted', source_reference, confirmed_at, expires_at
        FROM profile.restricted_answer_versions
        WHERE answer_id = ${current.id}::uuid AND version = ${current.version}
      `;
      return { deleted: true };
    });
  }

  async list(userId: string): Promise<readonly RestrictedAnswerSummary[]> {
    const rows = await this.client<
      Array<{
        id: string;
        fieldKey: string;
        context: string | null;
        version: number;
        valueType: RestrictedAnswerValueType;
        sensitivity: RestrictedAnswerSensitivity;
        state: "active" | "deleted";
        confirmedAt: Date | string;
        createdAt: string;
        expiresAt: Date | string | null;
      }>
    >`
      SELECT answer.id, answer.field_key, answer.context, version.version, version.value_type,
             version.sensitivity, version.state, version.confirmed_at, version.expires_at,
             to_jsonb(answer.created_at) #>> '{}' AS created_at
      FROM profile.restricted_answers AS answer
      JOIN LATERAL (
        SELECT * FROM profile.restricted_answer_versions
        WHERE answer_id = answer.id ORDER BY version DESC LIMIT 1
      ) AS version ON true
      WHERE answer.user_id = ${userId}::uuid
      ORDER BY answer.created_at, answer.id
    `;
    return rows.map((row) => ({
      id: row.id,
      fieldKey: row.fieldKey,
      ...(row.context ? { context: row.context } : {}),
      valueType: row.valueType,
      sensitivity: row.sensitivity,
      state: row.state,
      version: row.version,
      confirmedAt: iso(row.confirmedAt),
      // Match the portable export's PostgreSQL JSON timestamp without losing sub-ms precision.
      createdAt: row.createdAt,
      ...(row.expiresAt ? { expiresAt: iso(row.expiresAt) } : {}),
    }));
  }

  /**
   * Reads and decrypts the caller's own currently active entry for a question, for a future
   * server-side consumer (Applications packet preparation) rather than any HTTP response. It is
   * never exposed through a Gateway route: a restricted answer's plaintext leaves this boundary
   * only into an owner-scoped packet the candidate then reviews.
   */
  async readActiveValue(input: {
    userId: string;
    fieldKey: string;
    context?: string;
  }): Promise<
    { id: string; version: number; valueType: RestrictedAnswerValueType; value: string } | undefined
  > {
    const { userId, fieldKey } = input;
    const context = input.context ?? "";
    const [row] = await this.client<
      Array<{
        id: string;
        version: number;
        valueType: RestrictedAnswerValueType;
        ciphertext: Buffer;
        kmsKeyId: string;
        encryptionAlgorithm: "SYMMETRIC_DEFAULT";
      }>
    >`
      SELECT answer.id, version.version, version.value_type, version.ciphertext,
             version.kms_key_id, version.encryption_algorithm
      FROM profile.restricted_answers AS answer
      JOIN LATERAL (
        SELECT * FROM profile.restricted_answer_versions
        WHERE answer_id = answer.id ORDER BY version DESC LIMIT 1
      ) AS version ON true
      WHERE answer.user_id = ${userId}::uuid
        AND answer.field_key = ${fieldKey}
        AND coalesce(answer.context, '') = ${context}
        AND version.state = 'active'
        AND (version.expires_at IS NULL OR version.expires_at > clock_timestamp())
    `;
    if (!row) return undefined;
    const value = await this.requireCipher().decrypt({
      userId,
      fieldKey,
      context,
      ciphertext: {
        ciphertext: new Uint8Array(row.ciphertext),
        kmsKeyId: row.kmsKeyId,
        encryptionAlgorithm: row.encryptionAlgorithm,
      },
    });
    // KMS runs without a SQL lock. A correction, tombstone or expiry committed while it
    // was pending must withhold this snapshot, never return an older saved answer.
    const [current] = await this.client<Array<{ current: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM profile.restricted_answers AS answer
        JOIN LATERAL (
          SELECT version, state, expires_at FROM profile.restricted_answer_versions
          WHERE answer_id = answer.id ORDER BY version DESC LIMIT 1
        ) AS version ON true
        WHERE answer.user_id = ${userId}::uuid AND answer.id = ${row.id}::uuid
          AND answer.field_key = ${fieldKey}
          AND coalesce(answer.context, '') = ${context}
          AND version.version = ${row.version} AND version.state = 'active'
          AND (version.expires_at IS NULL OR version.expires_at > clock_timestamp())
      ) AS current
    `;
    if (current?.current !== true) return undefined;
    return { id: row.id, version: row.version, valueType: row.valueType, value };
  }
}
