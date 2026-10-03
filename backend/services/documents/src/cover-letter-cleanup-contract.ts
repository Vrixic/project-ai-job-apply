import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";

export class CoverLetterCleanupError extends Error {
  constructor() {
    super("CoverLetterCleanupUnavailable");
  }
}

/** Private cleanup control only, never a candidate route or a quiescence certificate. */
export interface CoverLetterCleanupInput {
  schemaVersion: 1;
  action: "fence";
  documentId: string;
  reference: CoverLetterWorkReference;
}
export interface CoverLetterCleanupOutput extends CoverLetterCleanupInput {
  outcome: "pending" | "ledger_terminal" | "unavailable";
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
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
function reference(value: unknown): value is CoverLetterWorkReference {
  return (
    record(value, ["id", "documentId", "purpose", "requestSha256"]) &&
    typeof value.id === "string" &&
    UUID.test(value.id) &&
    typeof value.documentId === "string" &&
    UUID.test(value.documentId) &&
    typeof value.purpose === "string" &&
    ["private_slots", "provider_dispatch", "final_document"].includes(value.purpose) &&
    typeof value.requestSha256 === "string" &&
    HASH.test(value.requestSha256)
  );
}
function binding(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === 1 &&
    value.action === "fence" &&
    typeof value.documentId === "string" &&
    UUID.test(value.documentId) &&
    reference(value.reference) &&
    value.reference.documentId === value.documentId
  );
}
export function validateCoverLetterCleanupInput(value: unknown): value is CoverLetterCleanupInput {
  return record(value, ["schemaVersion", "action", "documentId", "reference"]) && binding(value);
}
export function validateCoverLetterCleanupOutput(
  value: unknown,
): value is CoverLetterCleanupOutput {
  return (
    record(value, ["schemaVersion", "action", "documentId", "reference", "outcome"]) &&
    binding(value) &&
    typeof value.outcome === "string" &&
    ["pending", "ledger_terminal", "unavailable"].includes(value.outcome)
  );
}
