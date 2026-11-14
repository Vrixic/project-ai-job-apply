import { createHash } from "node:crypto";

export const coverLetterProviderSlots = ["request", "dispatch", "result"] as const;
export type CoverLetterProviderSlot = (typeof coverLetterProviderSlots)[number];
export const coverLetterProviderByteLimits = Object.freeze({
  request: 196_608,
  dispatch: 4_096,
  result: 49_152,
});
export class CoverLetterProviderTransportError extends Error {
  constructor() {
    super("CoverLetterProviderTransportRejected");
    this.name = "CoverLetterProviderTransportError";
  }
}
export interface CoverLetterProviderReference {
  objectVersion: string;
  etag: string;
  sha256: string;
  sizeBytes: number;
}
export interface CoverLetterProviderRequest {
  schemaVersion: 1;
  documentId: string;
  noticeVersion: "bedrock-cover-letter.v1";
  promptVersion: "1.0.0";
  jobContextHash: string;
  confirmedFactsHash: string;
  approvedAt: string;
  expiresAt: string;
  system: string;
  user: string;
  maxOutputChars: number;
}
interface CoverLetterProviderBinding {
  schemaVersion: 1;
  documentId: string;
  requestSha256: string;
}
/** ADR-059 addendum 12: the disclosure names the model, so the model is bound to the notice version. A different
 * model needs a new notice version, owner review and a fresh read of the AWS retention pages. */
export const COVER_LETTER_PROVIDER_MODEL = Object.freeze({
  provider: "bedrock",
  model: "us.anthropic.claude-sonnet-4-6",
  version: "us.anthropic.claude-sonnet-4-6",
} as const);
/** The isolated provider Lambda path (ADR-037) was designed for OpenAI and is superseded for cover letters by
 * ADR-059 addendum 12. It was never deployed. It stays compiled and tested with its own identity, and nothing
 * live (the native generation actor) accepts it. */
export const COVER_LETTER_ISOLATED_OPENAI_MODEL = Object.freeze({
  provider: "openai",
  model: "gpt-6-luna",
  version: "gpt-6-luna",
} as const);
type CoverLetterProviderIdentity =
  | typeof COVER_LETTER_PROVIDER_MODEL
  | typeof COVER_LETTER_ISOLATED_OPENAI_MODEL;
function identityMatches(
  value: unknown,
  expected: CoverLetterProviderIdentity,
): value is CoverLetterProviderIdentity {
  return (
    record(value, ["provider", "model", "version"]) &&
    value.provider === expected.provider &&
    value.model === expected.model &&
    value.version === expected.version
  );
}
/** Transport objects of the isolated path: either reviewed identity. */
export function validateCoverLetterProviderModel(
  value: unknown,
): value is CoverLetterProviderIdentity {
  return (
    identityMatches(value, COVER_LETTER_PROVIDER_MODEL) ||
    identityMatches(value, COVER_LETTER_ISOLATED_OPENAI_MODEL)
  );
}
/** The native generation actor: only the model the current notice names. */
export function validateNativeCoverLetterModel(
  value: unknown,
): value is typeof COVER_LETTER_PROVIDER_MODEL {
  return identityMatches(value, COVER_LETTER_PROVIDER_MODEL);
}
export type CoverLetterProviderDispatch = CoverLetterProviderBinding &
  ({ state: "issued" } | { state: "claimed"; dispatchedAt: string });
export type CoverLetterProviderResult = CoverLetterProviderBinding &
  (
    | { state: "pending" }
    | {
        state: "ready";
        dispatchedAt: string;
        text: string;
        model: CoverLetterProviderIdentity;
        outputCharacters: number;
      }
  );
export interface CoverLetterProviderInput {
  schemaVersion: 1;
  documentId: string;
  request: CoverLetterProviderReference;
}
export type CoverLetterProviderOutput =
  | { schemaVersion: 1; documentId: string; outcome: "ready"; result: CoverLetterProviderReference }
  | { schemaVersion: 1; documentId: string; outcome: "in_progress" | "failed" };

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    own.every(
      (key) =>
        typeof key === "string" &&
        keys.includes(key) &&
        Object.getOwnPropertyDescriptor(value, key)?.enumerable === true &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, "value"),
    )
  );
}
const hash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const id = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
export function coverLetterProviderTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    return;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : undefined;
}
export function validateCoverLetterProviderReference(
  value: unknown,
  slot: CoverLetterProviderSlot,
): value is CoverLetterProviderReference {
  return (
    record(value, ["objectVersion", "etag", "sha256", "sizeBytes"]) &&
    typeof value.etag === "string" &&
    /^"[A-Za-z0-9._~+/=-]{1,256}"$/u.test(value.etag) &&
    typeof value.objectVersion === "string" &&
    value.objectVersion.length > 0 &&
    value.objectVersion.length <= 1_024 &&
    value.objectVersion !== "null" &&
    [...value.objectVersion].every(
      (character) => (character.codePointAt(0) ?? 0) >= 32 && character.codePointAt(0) !== 127,
    ) &&
    hash(value.sha256) &&
    Number.isSafeInteger(value.sizeBytes) &&
    (value.sizeBytes as number) > 0 &&
    (value.sizeBytes as number) <= coverLetterProviderByteLimits[slot]
  );
}
export function validateCoverLetterProviderInput(
  value: unknown,
): value is CoverLetterProviderInput {
  return (
    record(value, ["schemaVersion", "documentId", "request"]) &&
    value.schemaVersion === 1 &&
    id(value.documentId) &&
    validateCoverLetterProviderReference(value.request, "request")
  );
}
export function validateCoverLetterProviderOutput(
  value: unknown,
): value is CoverLetterProviderOutput {
  if (
    !record(value, [
      "schemaVersion",
      "documentId",
      "outcome",
      ...(value && typeof value === "object" && Object.hasOwn(value, "result") ? ["result"] : []),
    ]) ||
    value.schemaVersion !== 1 ||
    !id(value.documentId)
  )
    return false;
  if (value.outcome === "ready")
    return validateCoverLetterProviderReference(value.result, "result");
  return (
    (value.outcome === "in_progress" || value.outcome === "failed") &&
    !Object.hasOwn(value, "result")
  );
}
export function coverLetterProviderKey(documentId: string, slot: CoverLetterProviderSlot): string {
  if (!id(documentId) || !coverLetterProviderSlots.includes(slot))
    throw new CoverLetterProviderTransportError();
  return `normalized/${documentId}/generation/${slot}.v1.json`;
}
function validateObject(
  slot: CoverLetterProviderSlot,
  value: unknown,
): value is CoverLetterProviderRequest | CoverLetterProviderDispatch | CoverLetterProviderResult {
  if (slot === "request") {
    if (
      !record(value, [
        "schemaVersion",
        "documentId",
        "noticeVersion",
        "promptVersion",
        "jobContextHash",
        "confirmedFactsHash",
        "approvedAt",
        "expiresAt",
        "system",
        "user",
        "maxOutputChars",
      ])
    )
      return false;
    const approved = coverLetterProviderTimestamp(value.approvedAt);
    const expires = coverLetterProviderTimestamp(value.expiresAt);
    return (
      value.schemaVersion === 1 &&
      id(value.documentId) &&
      value.noticeVersion === "bedrock-cover-letter.v1" &&
      value.promptVersion === "1.0.0" &&
      hash(value.jobContextHash) &&
      hash(value.confirmedFactsHash) &&
      approved !== undefined &&
      expires === approved + 900_000 &&
      typeof value.system === "string" &&
      value.system.length > 0 &&
      typeof value.user === "string" &&
      value.user.length > 0 &&
      value.system.length + value.user.length <= 40_000 &&
      Number.isSafeInteger(value.maxOutputChars) &&
      (value.maxOutputChars as number) >= 1 &&
      (value.maxOutputChars as number) <= 8_000
    );
  }
  const state =
    value && typeof value === "object"
      ? Object.getOwnPropertyDescriptor(value, "state")?.value
      : undefined;
  const settled = state === (slot === "dispatch" ? "claimed" : "ready");
  if (
    !record(value, [
      "schemaVersion",
      "documentId",
      "requestSha256",
      "state",
      ...(settled
        ? ["dispatchedAt", ...(slot === "result" ? ["text", "model", "outputCharacters"] : [])]
        : []),
    ])
  )
    return false;
  return (
    value.schemaVersion === 1 &&
    id(value.documentId) &&
    hash(value.requestSha256) &&
    (settled
      ? coverLetterProviderTimestamp(value.dispatchedAt) !== undefined &&
        (slot !== "result" ||
          (typeof value.text === "string" &&
            value.text.length > 0 &&
            value.text.length <= 8_000 &&
            validateCoverLetterProviderModel(value.model) &&
            Number.isSafeInteger(value.outputCharacters) &&
            (value.outputCharacters as number) >= 1 &&
            (value.outputCharacters as number) <= 8_000))
      : state === (slot === "dispatch" ? "issued" : "pending"))
  );
}
export function encodeCoverLetterProviderObject(
  slot: CoverLetterProviderSlot,
  value: unknown,
): Uint8Array {
  if (!coverLetterProviderSlots.includes(slot) || !validateObject(slot, value))
    throw new CoverLetterProviderTransportError();
  // Stable key order is part of immutable request identity, independent of caller object order.
  const keys =
    slot === "request"
      ? [
          "schemaVersion",
          "documentId",
          "noticeVersion",
          "promptVersion",
          "jobContextHash",
          "confirmedFactsHash",
          "approvedAt",
          "expiresAt",
          "system",
          "user",
          "maxOutputChars",
        ]
      : [
          "schemaVersion",
          "documentId",
          "requestSha256",
          "state",
          ...(Object.hasOwn(value, "dispatchedAt") ? ["dispatchedAt"] : []),
          ...(Object.hasOwn(value, "text") ? ["text"] : []),
          ...(Object.hasOwn(value, "model") ? ["model", "outputCharacters"] : []),
        ];
  const source = value as unknown as Record<string, unknown>;
  const bytes = new TextEncoder().encode(
    JSON.stringify(
      Object.fromEntries(
        keys.map((key) => [
          key,
          key === "model"
            ? {
                provider: (source.model as CoverLetterProviderIdentity).provider,
                model: (source.model as CoverLetterProviderIdentity).model,
                version: (source.model as CoverLetterProviderIdentity).version,
              }
            : source[key],
        ]),
      ),
    ),
  );
  if (bytes.byteLength > coverLetterProviderByteLimits[slot])
    throw new CoverLetterProviderTransportError();
  return bytes;
}
export function decodeCoverLetterProviderObject(
  slot: CoverLetterProviderSlot,
  bytes: Uint8Array,
): CoverLetterProviderRequest | CoverLetterProviderDispatch | CoverLetterProviderResult {
  try {
    if (
      !coverLetterProviderSlots.includes(slot) ||
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength < 1 ||
      bytes.byteLength > coverLetterProviderByteLimits[slot]
    )
      throw new CoverLetterProviderTransportError();
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!validateObject(slot, value)) throw new CoverLetterProviderTransportError();
    // Stored objects must be the canonical encoding, rejecting duplicate/escaped keys and
    // ambiguous JSON spellings rather than collapsing them before ownership checks.
    const canonical = encodeCoverLetterProviderObject(slot, value);
    if (Buffer.compare(Buffer.from(bytes), Buffer.from(canonical)) !== 0)
      throw new CoverLetterProviderTransportError();
    return value;
  } catch {
    throw new CoverLetterProviderTransportError();
  }
}
export function coverLetterProviderSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
