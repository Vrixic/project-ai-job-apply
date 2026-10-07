import { type NativeEvidenceBinding, nativeEvidenceBinding } from "./native-evidence-binding.js";
import { nativeOwnerClosed } from "./native-owner-rpc-contract.js";
import {
  type NativeResumeRouteSnapshot,
  nativeResumeRouteSnapshot,
} from "./native-resume-route-policy.js";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "./temporary-material-reference.js";

export type NativeMaterialRouteControlInput = {
  schemaVersion: 1;
  protocol: "native-material-route.v1";
  binding: NativeEvidenceBinding;
  reference: TemporaryMaterialReference;
} & ({ action: "capture" | "retired" } | { action: "admit"; route: NativeResumeRouteSnapshot });
export interface NativeMaterialRouteControlOutput {
  schemaVersion: 1;
  request: NativeMaterialRouteControlInput;
  outcome: "captured" | "admitted" | "retired" | "pending" | "unavailable";
  route: NativeResumeRouteSnapshot | null;
}
export const nativeMaterialRouteControlUnavailable = () =>
  Error("NativeMaterialRouteControlUnavailable");
export function validateNativeMaterialRouteControlInput(
  raw: unknown,
): raw is NativeMaterialRouteControlInput {
  try {
    if (!raw || typeof raw !== "object") return false;
    const action = Object.getOwnPropertyDescriptor(raw, "action");
    if (!action || !("value" in action)) return false;
    if (
      !nativeOwnerClosed(raw, [
        "schemaVersion",
        "protocol",
        "binding",
        "reference",
        "action",
        ...(action.value === "admit" ? ["route"] : []),
      ]) ||
      raw.schemaVersion !== 1 ||
      raw.protocol !== "native-material-route.v1" ||
      !["capture", "admit", "retired"].includes(raw.action as string)
    )
      return false;
    const binding = nativeEvidenceBinding(raw.binding as NativeEvidenceBinding);
    if (!validateTemporaryMaterialReference(raw.reference) || raw.reference.kind !== "cover_letter")
      return false;
    for (const key of ["ownerUserId", "applicationId", "generationId"] as const)
      if (raw.reference[key] !== binding.scope[key]) return false;
    if (raw.action === "admit") {
      const route = nativeResumeRouteSnapshot(raw.route as NativeResumeRouteSnapshot);
      if (
        route.intent.allocationId !== binding.scope.allocationId ||
        route.expiresAtMs !== raw.reference.expiresAtMs
      )
        return false;
    }
    return Buffer.byteLength(JSON.stringify(raw)) <= 8192;
  } catch {
    return false;
  }
}
export function validateNativeMaterialRouteControlOutput(
  raw: unknown,
): raw is NativeMaterialRouteControlOutput {
  try {
    if (
      !nativeOwnerClosed(raw, ["schemaVersion", "request", "outcome", "route"]) ||
      raw.schemaVersion !== 1 ||
      !validateNativeMaterialRouteControlInput(raw.request) ||
      Buffer.byteLength(JSON.stringify(raw)) > 8192
    )
      return false;
    if (raw.outcome === "unavailable") return raw.route === null;
    if (raw.outcome === "captured") {
      const route = nativeResumeRouteSnapshot(raw.route as NativeResumeRouteSnapshot);
      return (
        raw.request.action === "capture" &&
        route.intent.allocationId === raw.request.binding.scope.allocationId &&
        route.expiresAtMs === raw.request.reference.expiresAtMs
      );
    }
    return (
      raw.route === null &&
      ((raw.outcome === "admitted" && raw.request.action === "admit") ||
        (["retired", "pending"].includes(raw.outcome as string) &&
          raw.request.action === "retired"))
    );
  } catch {
    return false;
  }
}
