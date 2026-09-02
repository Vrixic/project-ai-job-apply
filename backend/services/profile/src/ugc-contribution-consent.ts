import { createHash } from "node:crypto";
import type postgres from "postgres";
import { v7 as uuidv7 } from "uuid";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const VERSION = /^[a-z0-9][a-z0-9._-]{2,99}$/u;

export interface UgcContributionConsent {
  client: "extension";
  documentVersion: string;
  expiresAt?: string;
  grantedAt: string;
  id: string;
  ownerUserId: string;
  policyVersion: string;
  previewPayloadSha256: string;
  purpose: "ugc_contribution";
  recordedAt: string;
  replacementConsentId?: string;
  schemaVersion: 1;
  state: "granted" | "revoked" | "superseded";
}

export interface GrantUgcContributionConsentCommand {
  documentVersion: string;
  expiresAt?: string;
  grantedAt: string;
  idempotencyKey: string;
  ownerUserId: string;
  policyVersion: string;
  previewPayloadSha256: string;
  traceId: string;
}

export interface TransitionUgcContributionConsentCommand {
  consentId: string;
  idempotencyKey: string;
  occurredAt: string;
  ownerUserId: string;
  replacementConsentId?: string;
  traceId: string;
}

export interface VerifyUgcContributionConsentCommand {
  consentId: string;
  documentVersion: string;
  ownerUserId: string;
  policyVersion: string;
  previewPayloadSha256: string;
  verifiedAt: string;
}

export type UgcContributionConsentVerification =
  | { consent: UgcContributionConsent; valid: true }
  | {
      reason:
        | "expired"
        | "invalid_request"
        | "mismatch"
        | "not_current"
        | "not_found"
        | "unavailable";
      valid: false;
    };

export interface UgcContributionConsentCreator {
  grant(command: GrantUgcContributionConsentCommand): Promise<UgcContributionConsent>;
}

export interface UgcContributionConsentVerifier {
  verify(command: VerifyUgcContributionConsentCommand): Promise<UgcContributionConsentVerification>;
}

export interface UgcContributionConsentStore
  extends UgcContributionConsentCreator,
    UgcContributionConsentVerifier {
  revoke(command: TransitionUgcContributionConsentCommand): Promise<UgcContributionConsent>;
  supersede(command: TransitionUgcContributionConsentCommand): Promise<UgcContributionConsent>;
}

export class UgcContributionConsentConflictError extends Error {
  constructor() {
    super("The consent command conflicts with an existing idempotency receipt or current state");
    this.name = "UgcContributionConsentConflictError";
  }
}

export class UgcContributionConsentUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("UGC contribution consent is temporarily unavailable", { cause });
    this.name = "UgcContributionConsentUnavailableError";
  }
}

function exactTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function assertOwner(value: string): void {
  if (!UUID_V7.test(value)) throw new TypeError("The consent owner identifier is invalid");
}

function assertIdempotency(value: string): void {
  if (value.length < 16 || value.length > 128) {
    throw new TypeError("The consent idempotency key is invalid");
  }
}

function assertVersion(value: string): void {
  if (!VERSION.test(value)) throw new TypeError("The consent version is invalid");
}

function assertTrace(value: string): void {
  if (value.length < 1 || value.length > 128 || /[\r\n]/u.test(value)) {
    throw new TypeError("The consent trace identifier is invalid");
  }
}

export function assertGrantCommand(command: GrantUgcContributionConsentCommand): void {
  assertOwner(command.ownerUserId);
  assertIdempotency(command.idempotencyKey);
  assertVersion(command.documentVersion);
  assertVersion(command.policyVersion);
  assertTrace(command.traceId);
  if (!SHA256.test(command.previewPayloadSha256) || !exactTimestamp(command.grantedAt)) {
    throw new TypeError("The consent payload binding is invalid");
  }
  if (
    command.expiresAt !== undefined &&
    (!exactTimestamp(command.expiresAt) || command.expiresAt <= command.grantedAt)
  ) {
    throw new TypeError("The consent expiry is invalid");
  }
}

export function assertTransitionCommand(command: TransitionUgcContributionConsentCommand): void {
  assertOwner(command.ownerUserId);
  assertIdempotency(command.idempotencyKey);
  assertTrace(command.traceId);
  if (!UUID_V7.test(command.consentId) || !exactTimestamp(command.occurredAt)) {
    throw new TypeError("The consent transition is invalid");
  }
  if (command.replacementConsentId !== undefined && !UUID_V7.test(command.replacementConsentId)) {
    throw new TypeError("The replacement consent identifier is invalid");
  }
}

export function validateVerificationCommand(command: VerifyUgcContributionConsentCommand): boolean {
  return (
    UUID_V7.test(command.ownerUserId) &&
    UUID_V7.test(command.consentId) &&
    VERSION.test(command.documentVersion) &&
    VERSION.test(command.policyVersion) &&
    SHA256.test(command.previewPayloadSha256) &&
    exactTimestamp(command.verifiedAt)
  );
}

function requestHash(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mapRecord(record: {
  action: UgcContributionConsent["state"];
  consentId: string;
  documentVersion: string;
  expiresAt: Date | string | null;
  grantedAt: Date | string;
  ownerUserId: string;
  policyVersion: string;
  previewPayloadSha256: string;
  recordedAt: Date | string;
  replacementConsentId: string | null;
}): UgcContributionConsent {
  const iso = (value: Date | string): string =>
    value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return {
    client: "extension",
    documentVersion: record.documentVersion,
    ...(record.expiresAt ? { expiresAt: iso(record.expiresAt) } : {}),
    grantedAt: iso(record.grantedAt),
    id: record.consentId,
    ownerUserId: record.ownerUserId,
    policyVersion: record.policyVersion,
    previewPayloadSha256: record.previewPayloadSha256,
    purpose: "ugc_contribution",
    recordedAt: iso(record.recordedAt),
    ...(record.replacementConsentId ? { replacementConsentId: record.replacementConsentId } : {}),
    schemaVersion: 1,
    state: record.action,
  };
}

function parseReceipt(value: unknown): UgcContributionConsent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UgcContributionConsentUnavailableError();
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) =>
        ![
          "client",
          "documentVersion",
          "expiresAt",
          "grantedAt",
          "id",
          "ownerUserId",
          "policyVersion",
          "previewPayloadSha256",
          "purpose",
          "recordedAt",
          "replacementConsentId",
          "schemaVersion",
          "state",
        ].includes(key),
    ) ||
    record.schemaVersion !== 1 ||
    typeof record.id !== "string" ||
    !UUID_V7.test(record.id) ||
    typeof record.ownerUserId !== "string" ||
    !UUID_V7.test(record.ownerUserId) ||
    record.purpose !== "ugc_contribution" ||
    record.client !== "extension" ||
    typeof record.documentVersion !== "string" ||
    !VERSION.test(record.documentVersion) ||
    typeof record.policyVersion !== "string" ||
    !VERSION.test(record.policyVersion) ||
    typeof record.previewPayloadSha256 !== "string" ||
    !SHA256.test(record.previewPayloadSha256) ||
    typeof record.grantedAt !== "string" ||
    !exactTimestamp(record.grantedAt) ||
    typeof record.recordedAt !== "string" ||
    !exactTimestamp(record.recordedAt) ||
    (record.expiresAt !== undefined &&
      (typeof record.expiresAt !== "string" || !exactTimestamp(record.expiresAt))) ||
    (record.replacementConsentId !== undefined &&
      (typeof record.replacementConsentId !== "string" ||
        !UUID_V7.test(record.replacementConsentId))) ||
    (record.state !== "granted" && record.state !== "revoked" && record.state !== "superseded")
  ) {
    throw new UgcContributionConsentUnavailableError();
  }
  return value as UgcContributionConsent;
}

type ConsentRow = Parameters<typeof mapRecord>[0] & { id: string };

export class PostgresUgcContributionConsentStore implements UgcContributionConsentStore {
  constructor(private readonly client: postgres.Sql) {}

  async grant(command: GrantUgcContributionConsentCommand): Promise<UgcContributionConsent> {
    assertGrantCommand(command);
    const scope = "ugc_contribution_consent.grant";
    const hash = requestHash({
      documentVersion: command.documentVersion,
      expiresAt: command.expiresAt,
      grantedAt: command.grantedAt,
      ownerUserId: command.ownerUserId,
      policyVersion: command.policyVersion,
      previewPayloadSha256: command.previewPayloadSha256,
    });
    try {
      return await this.client.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(hashtext(${`${command.ownerUserId}:${scope}:${command.idempotencyKey}`}))`;
        const [receipt] = await transaction<Array<{ requestHash: string; response: unknown }>>`
          SELECT request_hash, response FROM platform.idempotency_keys
          WHERE user_id = ${command.ownerUserId}::uuid AND scope = ${scope}
            AND key = ${command.idempotencyKey}
        `;
        if (receipt) {
          if (receipt.requestHash !== hash) throw new UgcContributionConsentConflictError();
          return parseReceipt(receipt.response);
        }
        const [owner] = await transaction<Array<{ accountState: string }>>`
          SELECT account_state FROM identity.users WHERE id = ${command.ownerUserId}::uuid FOR UPDATE
        `;
        if (owner?.accountState !== "active") throw new UgcContributionConsentConflictError();
        const consentId = uuidv7();
        const [record] = await transaction<ConsentRow[]>`
          INSERT INTO profile.ugc_contribution_consents (
            id, consent_id, owner_user_id, purpose, client, document_version, policy_version,
            preview_payload_sha256, action, granted_at, expires_at, recorded_at
          ) VALUES (
            ${consentId}::uuid, ${consentId}::uuid, ${command.ownerUserId}::uuid,
            'ugc_contribution', 'extension', ${command.documentVersion}, ${command.policyVersion},
            ${command.previewPayloadSha256}, 'granted', ${command.grantedAt}::timestamptz,
            ${command.expiresAt ?? null}::timestamptz, ${command.grantedAt}::timestamptz
          ) RETURNING id, consent_id, owner_user_id, document_version, policy_version,
            preview_payload_sha256, action, granted_at, expires_at, recorded_at,
            replacement_consent_id
        `;
        if (!record) throw new UgcContributionConsentUnavailableError();
        const response = mapRecord(record);
        await transaction`
          INSERT INTO platform.idempotency_keys (user_id, scope, key, request_hash, response)
          VALUES (${command.ownerUserId}::uuid, ${scope}, ${command.idempotencyKey}, ${hash},
            ${JSON.stringify(response)}::jsonb)
        `;
        await transaction`
          INSERT INTO platform.audit_events (
            id, user_id, action, resource_type, resource_id, trace_id, metadata, occurred_at
          ) VALUES (
            ${uuidv7()}::uuid, ${command.ownerUserId}::uuid, 'ugc_contribution_consent.granted',
            'ugc_contribution_consent', ${consentId}::uuid, ${command.traceId},
            ${JSON.stringify({
              client: "extension",
              documentVersion: command.documentVersion,
              policyVersion: command.policyVersion,
              purpose: "ugc_contribution",
            })}::jsonb,
            ${command.grantedAt}::timestamptz
          )
        `;
        return response;
      });
    } catch (error) {
      if (error instanceof UgcContributionConsentConflictError) throw error;
      if (error instanceof UgcContributionConsentUnavailableError) throw error;
      throw new UgcContributionConsentUnavailableError(error);
    }
  }

  async revoke(command: TransitionUgcContributionConsentCommand): Promise<UgcContributionConsent> {
    if (command.replacementConsentId !== undefined)
      throw new TypeError("Revocation cannot replace consent");
    return this.transition(command, "revoked");
  }

  async supersede(
    command: TransitionUgcContributionConsentCommand,
  ): Promise<UgcContributionConsent> {
    if (!command.replacementConsentId)
      throw new TypeError("Supersession requires replacement consent");
    return this.transition(command, "superseded");
  }

  private async transition(
    command: TransitionUgcContributionConsentCommand,
    action: "revoked" | "superseded",
  ): Promise<UgcContributionConsent> {
    assertTransitionCommand(command);
    const scope = `ugc_contribution_consent.${action}`;
    const hash = requestHash({
      action,
      consentId: command.consentId,
      occurredAt: command.occurredAt,
      ownerUserId: command.ownerUserId,
      replacementConsentId: command.replacementConsentId,
    });
    try {
      return await this.client.begin(async (transaction) => {
        await transaction`SELECT pg_advisory_xact_lock(hashtext(${`${command.ownerUserId}:${scope}:${command.idempotencyKey}`}))`;
        const [receipt] = await transaction<Array<{ requestHash: string; response: unknown }>>`
          SELECT request_hash, response FROM platform.idempotency_keys
          WHERE user_id = ${command.ownerUserId}::uuid AND scope = ${scope}
            AND key = ${command.idempotencyKey}
        `;
        if (receipt) {
          if (receipt.requestHash !== hash) throw new UgcContributionConsentConflictError();
          return parseReceipt(receipt.response);
        }
        const [current] = await transaction<ConsentRow[]>`
          SELECT c.id, c.consent_id, c.owner_user_id, c.document_version, c.policy_version,
            c.preview_payload_sha256, c.action, c.granted_at, c.expires_at, c.recorded_at,
            c.replacement_consent_id
          FROM profile.ugc_contribution_consents c
          JOIN identity.users u ON u.id = c.owner_user_id AND u.account_state = 'active'
          WHERE c.owner_user_id = ${command.ownerUserId}::uuid
            AND c.consent_id = ${command.consentId}::uuid
            AND NOT EXISTS (
              SELECT 1 FROM profile.ugc_contribution_consents next
              WHERE next.supersedes_record_id = c.id
            )
          FOR UPDATE OF c
        `;
        if (current?.action !== "granted") {
          throw new UgcContributionConsentConflictError();
        }
        const currentConsent = mapRecord(current);
        if (command.occurredAt < currentConsent.grantedAt) {
          throw new UgcContributionConsentConflictError();
        }
        const eventId = uuidv7();
        const [record] = await transaction<ConsentRow[]>`
          INSERT INTO profile.ugc_contribution_consents (
            id, consent_id, owner_user_id, purpose, client, document_version, policy_version,
            preview_payload_sha256, action, granted_at, expires_at, recorded_at,
            supersedes_record_id, replacement_consent_id
          ) VALUES (
            ${eventId}::uuid, ${current.consentId}::uuid, ${current.ownerUserId}::uuid,
            'ugc_contribution', 'extension', ${current.documentVersion}, ${current.policyVersion},
            ${current.previewPayloadSha256}, ${action}, ${currentConsent.grantedAt}::timestamptz,
            ${currentConsent.expiresAt ?? null}::timestamptz,
            ${command.occurredAt}::timestamptz, ${current.id}::uuid,
            ${command.replacementConsentId ?? null}::uuid
          ) RETURNING id, consent_id, owner_user_id, document_version, policy_version,
            preview_payload_sha256, action, granted_at, expires_at, recorded_at,
            replacement_consent_id
        `;
        if (!record) throw new UgcContributionConsentUnavailableError();
        const response = mapRecord(record);
        await transaction`
          INSERT INTO platform.idempotency_keys (user_id, scope, key, request_hash, response)
          VALUES (${command.ownerUserId}::uuid, ${scope}, ${command.idempotencyKey}, ${hash},
            ${JSON.stringify(response)}::jsonb)
        `;
        await transaction`
          INSERT INTO platform.audit_events (
            id, user_id, action, resource_type, resource_id, trace_id, metadata, occurred_at
          ) VALUES (
            ${uuidv7()}::uuid, ${command.ownerUserId}::uuid,
            ${`ugc_contribution_consent.${action}`}, 'ugc_contribution_consent',
            ${command.consentId}::uuid, ${command.traceId},
            ${JSON.stringify({ client: "extension", purpose: "ugc_contribution" })}::jsonb,
            ${command.occurredAt}::timestamptz
          )
        `;
        return response;
      });
    } catch (error) {
      if (error instanceof UgcContributionConsentConflictError) throw error;
      if (error instanceof UgcContributionConsentUnavailableError) throw error;
      throw new UgcContributionConsentUnavailableError(error);
    }
  }

  async verify(
    command: VerifyUgcContributionConsentCommand,
  ): Promise<UgcContributionConsentVerification> {
    if (!validateVerificationCommand(command)) return { reason: "invalid_request", valid: false };
    try {
      const [record] = await this.client<ConsentRow[]>`
        SELECT c.id, c.consent_id, c.owner_user_id, c.document_version, c.policy_version,
          c.preview_payload_sha256, c.action, c.granted_at, c.expires_at, c.recorded_at,
          c.replacement_consent_id
        FROM profile.ugc_contribution_consents c
        JOIN identity.users u ON u.id = c.owner_user_id AND u.account_state = 'active'
        WHERE c.owner_user_id = ${command.ownerUserId}::uuid
          AND c.consent_id = ${command.consentId}::uuid
          AND NOT EXISTS (
            SELECT 1 FROM profile.ugc_contribution_consents next
            WHERE next.supersedes_record_id = c.id
          )
      `;
      if (!record) return { reason: "not_found", valid: false };
      if (record.action !== "granted") return { reason: "not_current", valid: false };
      if (
        record.documentVersion !== command.documentVersion ||
        record.policyVersion !== command.policyVersion ||
        record.previewPayloadSha256 !== command.previewPayloadSha256
      ) {
        return { reason: "mismatch", valid: false };
      }
      const verifiedAt = Date.parse(command.verifiedAt);
      if (
        verifiedAt < Date.parse(mapRecord(record).grantedAt) ||
        (record.expiresAt && verifiedAt >= Date.parse(mapRecord(record).expiresAt ?? ""))
      ) {
        return { reason: "expired", valid: false };
      }
      return { consent: mapRecord(record), valid: true };
    } catch {
      return { reason: "unavailable", valid: false };
    }
  }
}
