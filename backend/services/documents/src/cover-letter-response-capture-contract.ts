import {
  type OpenAiBackgroundResponseReference,
  validateOpenAiBackgroundResponseReference,
} from "@ai-job-apply/ai-sdk";
import { validateProviderControlReference } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";

export class CoverLetterResponseCaptureError extends Error {
  constructor() {
    super("CoverLetterResponseCaptureUnavailable");
  }
}

export type CoverLetterResponseCaptureInput =
  | { schemaVersion: 1; action: "reserve"; reference: CoverLetterWorkReference }
  | {
      schemaVersion: 1;
      action: "record_creation";
      reference: CoverLetterWorkReference;
      response: OpenAiBackgroundResponseReference;
    };

export type CoverLetterResponseCaptureOutput =
  | {
      schemaVersion: 1;
      action: "reserve";
      reference: CoverLetterWorkReference;
      outcome: "reserved" | "already_reserved" | "unavailable";
    }
  | {
      schemaVersion: 1;
      action: "record_creation";
      reference: CoverLetterWorkReference;
      response: OpenAiBackgroundResponseReference;
      outcome: "recorded" | "unavailable";
    };

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

/** Closed metadata-only v1. Reflection failures and accessors never reach the owner store. */
export function validateResponseCaptureInput(
  value: unknown,
): value is CoverLetterResponseCaptureInput {
  try {
    if (record(value, ["schemaVersion", "action", "reference"]))
      return (
        value.schemaVersion === 1 &&
        value.action === "reserve" &&
        validateProviderControlReference(value.reference)
      );
    return (
      record(value, ["schemaVersion", "action", "reference", "response"]) &&
      value.schemaVersion === 1 &&
      value.action === "record_creation" &&
      validateProviderControlReference(value.reference) &&
      validateOpenAiBackgroundResponseReference(value.response)
    );
  } catch {
    return false;
  }
}

export function validateResponseCaptureOutput(
  value: unknown,
): value is CoverLetterResponseCaptureOutput {
  try {
    if (record(value, ["schemaVersion", "action", "reference", "outcome"]))
      return (
        value.schemaVersion === 1 &&
        value.action === "reserve" &&
        validateProviderControlReference(value.reference) &&
        typeof value.outcome === "string" &&
        ["reserved", "already_reserved", "unavailable"].includes(value.outcome)
      );
    return (
      record(value, ["schemaVersion", "action", "reference", "response", "outcome"]) &&
      value.schemaVersion === 1 &&
      value.action === "record_creation" &&
      validateProviderControlReference(value.reference) &&
      validateOpenAiBackgroundResponseReference(value.response) &&
      (value.outcome === "recorded" || value.outcome === "unavailable")
    );
  } catch {
    return false;
  }
}
