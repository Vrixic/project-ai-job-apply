import { coverLetterProviderTimestamp } from "./cover-letter-provider-contract.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";

export class CoverLetterProviderControlError extends Error {
  constructor() {
    super("CoverLetterProviderControlUnavailable");
  }
}
export type CoverLetterProviderControlInput =
  | {
      schemaVersion: 1;
      action: "claim";
      documentId: string;
      requestSha256: string;
      consentExpiresAt: string;
    }
  | { schemaVersion: 1; action: "settle"; documentId: string; reference: CoverLetterWorkReference };
export type CoverLetterProviderControlOutput =
  | {
      schemaVersion: 1;
      action: "claim";
      documentId: string;
      outcome: "claimed";
      reference: CoverLetterWorkReference;
    }
  | { schemaVersion: 1; action: "claim" | "settle"; documentId: string; outcome: "unavailable" }
  | {
      schemaVersion: 1;
      action: "settle";
      documentId: string;
      outcome: "settled";
      reference: CoverLetterWorkReference;
    };

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const id = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const own = Reflect.ownKeys(value);
  return (
    own.length === keys.length &&
    own.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key === "string" &&
        keys.includes(key) &&
        descriptor?.enumerable === true &&
        Object.hasOwn(descriptor, "value")
      );
    })
  );
}
export function validateProviderControlReference(
  value: unknown,
): value is CoverLetterWorkReference {
  return (
    record(value, ["id", "documentId", "purpose", "requestSha256"]) &&
    id(value.id) &&
    id(value.documentId) &&
    value.purpose === "provider_dispatch" &&
    typeof value.requestSha256 === "string" &&
    HASH.test(value.requestSha256)
  );
}
export function validateProviderControlInput(
  value: unknown,
): value is CoverLetterProviderControlInput {
  if (record(value, ["schemaVersion", "action", "documentId", "requestSha256", "consentExpiresAt"]))
    return (
      value.schemaVersion === 1 &&
      value.action === "claim" &&
      id(value.documentId) &&
      typeof value.requestSha256 === "string" &&
      HASH.test(value.requestSha256) &&
      coverLetterProviderTimestamp(value.consentExpiresAt) !== undefined
    );
  return (
    record(value, ["schemaVersion", "action", "documentId", "reference"]) &&
    value.schemaVersion === 1 &&
    value.action === "settle" &&
    id(value.documentId) &&
    validateProviderControlReference(value.reference) &&
    value.reference.documentId === value.documentId
  );
}
export function validateProviderControlOutput(
  value: unknown,
): value is CoverLetterProviderControlOutput {
  if (record(value, ["schemaVersion", "action", "documentId", "outcome", "reference"]))
    return (
      value.schemaVersion === 1 &&
      ((value.action === "claim" && value.outcome === "claimed") ||
        (value.action === "settle" && value.outcome === "settled")) &&
      id(value.documentId) &&
      validateProviderControlReference(value.reference) &&
      value.reference.documentId === value.documentId
    );
  return (
    record(value, ["schemaVersion", "action", "documentId", "outcome"]) &&
    value.schemaVersion === 1 &&
    id(value.documentId) &&
    (value.action === "claim" || value.action === "settle") &&
    value.outcome === "unavailable"
  );
}
export function providerControlVersion(arn: string): string {
  const match =
    /^arn:aws:lambda:us-east-2:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:([1-9][0-9]{0,8})$/u.exec(
      arn,
    );
  if (!match?.[1]) throw new CoverLetterProviderControlError();
  return match[1];
}
