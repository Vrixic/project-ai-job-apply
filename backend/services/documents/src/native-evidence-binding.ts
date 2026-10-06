import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import { validateNativeLaunchControlInput } from "./native-launch-control-contract.js";
import type { NativeMaterialLaunchScope } from "./native-material-registry.js";
import { type NativeTaskAllocation, nativeTaskAllocationRegion } from "./native-task-allocation.js";

export interface NativeEvidenceBinding {
  scope: NativeMaterialLaunchScope;
  allocation: NativeTaskAllocation;
  original: CoverLetterWorkReference;
}
const unavailable = () => Error("NativeEvidenceUnavailable");
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && "value" in descriptor;
    })
  );
}
/** Detached metadata only. Equality is not caller authentication, SQL admission or task liveness. */
export function nativeEvidenceBinding(raw: NativeEvidenceBinding): Readonly<NativeEvidenceBinding> {
  try {
    if (
      !closed(raw, ["scope", "allocation", "original"]) ||
      !closed(raw.allocation, [
        "allocationId",
        "ownerUserId",
        "applicationId",
        "generationId",
        "clusterArn",
        "taskArn",
        "taskDefinitionArn",
        "containerName",
      ]) ||
      nativeTaskAllocationRegion(raw.allocation) !== "us-east-2" ||
      !validateNativeLaunchControlInput({
        schemaVersion: 1,
        action: "recover",
        scope: raw.scope,
        taskArn: raw.allocation.taskArn,
      }) ||
      !validateNativeLaunchControlInput({
        schemaVersion: 1,
        action: "launch",
        ownerUserId: raw.scope.ownerUserId,
        applicationId: raw.scope.applicationId,
        original: raw.original,
        previousEpochId: null,
      }) ||
      raw.original.documentId !== raw.scope.generationId ||
      !["allocationId", "ownerUserId", "applicationId", "generationId"].every(
        (key) =>
          raw.allocation[key as keyof NativeTaskAllocation] ===
          raw.scope[key as keyof NativeMaterialLaunchScope],
      )
    )
      throw unavailable();
    const fixed = structuredClone(raw);
    return Object.freeze({
      scope: Object.freeze(fixed.scope),
      allocation: Object.freeze(fixed.allocation),
      original: Object.freeze(fixed.original),
    });
  } catch {
    throw unavailable();
  }
}
