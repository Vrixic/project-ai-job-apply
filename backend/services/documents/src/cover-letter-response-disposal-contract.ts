import {
  type OpenAiResponseCleanup,
  validateOpenAiBackgroundResponseReference,
} from "@ai-job-apply/ai-sdk";
import { validateProviderControlReference } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterResponseInventory } from "./cover-letter-response-store.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";

export class CoverLetterResponseDisposalError extends Error {
  constructor() {
    super("CoverLetterResponseDisposalUnavailable");
  }
}

type DisposalReceipt = Extract<OpenAiResponseCleanup, { kind: "response_deleted" }>;

/** Separate maintenance-only v1; never carries response content or new dispatch authority. */
export type CoverLetterResponseDisposalInput =
  | { schemaVersion: 1; action: "read" | "read_completed"; reference: CoverLetterWorkReference }
  | {
      schemaVersion: 1;
      action: "record_disposal";
      reference: CoverLetterWorkReference;
      cleanup: DisposalReceipt;
    };

export type CoverLetterResponseDisposalOutput =
  | {
      schemaVersion: 1;
      action: "read" | "read_completed";
      reference: CoverLetterWorkReference;
      outcome: "read" | "unavailable";
      inventory: CoverLetterResponseInventory | null;
    }
  | {
      schemaVersion: 1;
      action: "record_disposal";
      reference: CoverLetterWorkReference;
      cleanup: DisposalReceipt;
      outcome: "recorded" | "unavailable";
    };

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
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

function sameWork(a: CoverLetterWorkReference, b: CoverLetterWorkReference): boolean {
  return a.id === b.id && a.documentId === b.documentId && a.requestSha256 === b.requestSha256;
}

function receipt(value: unknown): value is DisposalReceipt {
  return (
    closed(value, ["kind", "reference", "terminalStatus"]) &&
    value.kind === "response_deleted" &&
    validateOpenAiBackgroundResponseReference(value.reference) &&
    typeof value.terminalStatus === "string" &&
    ["completed", "cancelled", "failed", "incomplete"].includes(value.terminalStatus)
  );
}

/** Null means absent inventory, not disposal, terminal work or permission to purge. */
function inventory(value: unknown, ref: CoverLetterWorkReference): boolean {
  return (
    value === null ||
    (closed(value, ["reference", "state", "response"]) &&
      validateProviderControlReference(value.reference) &&
      sameWork(value.reference, ref) &&
      ((value.state === "reserved" && value.response === null) ||
        ((value.state === "acknowledged" || value.state === "disposed") &&
          validateOpenAiBackgroundResponseReference(value.response))))
  );
}

export function validateResponseDisposalInput(
  value: unknown,
): value is CoverLetterResponseDisposalInput {
  try {
    if (closed(value, ["schemaVersion", "action", "reference"]))
      return (
        value.schemaVersion === 1 &&
        (value.action === "read" || value.action === "read_completed") &&
        validateProviderControlReference(value.reference)
      );
    return (
      closed(value, ["schemaVersion", "action", "reference", "cleanup"]) &&
      value.schemaVersion === 1 &&
      value.action === "record_disposal" &&
      validateProviderControlReference(value.reference) &&
      receipt(value.cleanup)
    );
  } catch {
    return false;
  }
}

export function validateResponseDisposalOutput(
  value: unknown,
): value is CoverLetterResponseDisposalOutput {
  try {
    if (closed(value, ["schemaVersion", "action", "reference", "outcome", "inventory"]))
      return (
        value.schemaVersion === 1 &&
        (value.action === "read" || value.action === "read_completed") &&
        validateProviderControlReference(value.reference) &&
        ((value.outcome === "unavailable" && value.inventory === null) ||
          (value.outcome === "read" && inventory(value.inventory, value.reference)))
      );
    return (
      closed(value, ["schemaVersion", "action", "reference", "cleanup", "outcome"]) &&
      value.schemaVersion === 1 &&
      value.action === "record_disposal" &&
      validateProviderControlReference(value.reference) &&
      receipt(value.cleanup) &&
      (value.outcome === "recorded" || value.outcome === "unavailable")
    );
  } catch {
    return false;
  }
}
