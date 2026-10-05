import {
  providerControlVersion,
  validateProviderControlReference,
} from "./cover-letter-provider-control-contract.js";
import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

export type TemporaryMaterialCompletionOutcome = "claimed" | "already_completed" | "unavailable";
export interface TemporaryMaterialCompletionInput {
  schemaVersion: 1;
  action: "claim_original_completion";
  work: CoverLetterWorkReference;
  material: TemporaryMaterialReference;
}
export interface TemporaryMaterialCompletionOutput extends TemporaryMaterialCompletionInput {
  outcome: TemporaryMaterialCompletionOutcome;
}
export class TemporaryMaterialCompletionError extends Error {
  constructor() {
    super("TemporaryMaterialCompletionUnavailable");
  }
}
export function temporaryMaterialCompletionVersion(arn: string): string {
  try {
    return providerControlVersion(arn);
  } catch {
    throw new TemporaryMaterialCompletionError();
  }
}
function record(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
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
    value.action === "claim_original_completion" &&
    validateProviderControlReference(value.work) &&
    validateTemporaryMaterialReference(value.material) &&
    value.material.kind === "cover_letter" &&
    value.material.generationId === value.work.documentId
  );
}
export function validateTemporaryMaterialCompletionInput(
  value: unknown,
): value is TemporaryMaterialCompletionInput {
  return record(value, ["schemaVersion", "action", "work", "material"]) && binding(value);
}
export function validateTemporaryMaterialCompletionOutput(
  value: unknown,
): value is TemporaryMaterialCompletionOutput {
  return (
    record(value, ["schemaVersion", "action", "work", "material", "outcome"]) &&
    binding(value) &&
    ["claimed", "already_completed", "unavailable"].includes(value.outcome as string)
  );
}
export interface TemporaryMaterialOriginalCompletionStore {
  claimOriginalCompletion(
    work: CoverLetterWorkReference,
    material: TemporaryMaterialReference,
  ): Promise<TemporaryMaterialCompletionOutcome>;
}
