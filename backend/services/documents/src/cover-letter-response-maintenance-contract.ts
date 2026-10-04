import { validateProviderControlReference } from "./cover-letter-provider-control-contract.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";

export class CoverLetterResponseMaintenanceError extends Error {
  constructor() {
    super("CoverLetterResponseMaintenanceUnavailable");
  }
}

/** Private maintenance selector; caller supplies no failure classification or provider identity. */
export interface CoverLetterResponseMaintenanceInput {
  schemaVersion: 1;
  action: "reconcile_failed" | "reconcile_completed";
  reference: CoverLetterWorkReference;
}
export interface CoverLetterResponseMaintenanceOutput extends CoverLetterResponseMaintenanceInput {
  outcome: "unresolved" | "response_disposed";
}

function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return false;
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
function binding(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === 1 &&
    ["reconcile_failed", "reconcile_completed"].includes(value.action as string) &&
    validateProviderControlReference(value.reference)
  );
}
export function validateResponseMaintenanceInput(
  value: unknown,
): value is CoverLetterResponseMaintenanceInput {
  try {
    return closed(value, ["schemaVersion", "action", "reference"]) && binding(value);
  } catch {
    return false;
  }
}
export function validateResponseMaintenanceOutput(
  value: unknown,
): value is CoverLetterResponseMaintenanceOutput {
  try {
    return (
      closed(value, ["schemaVersion", "action", "reference", "outcome"]) &&
      binding(value) &&
      ["unresolved", "response_disposed"].includes(value.outcome as string)
    );
  } catch {
    return false;
  }
}
