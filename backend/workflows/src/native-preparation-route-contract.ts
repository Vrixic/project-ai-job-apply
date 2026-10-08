import {
  type NativeMaterialRouteControlInput,
  validateNativeMaterialRouteControlInput,
} from "@ai-job-apply/documents-service/native-material-route-control-contract";
import { nativeOwnerClosed } from "@ai-job-apply/documents-service/native-owner-rpc-contract";
export type NativePreparationRouteOriginal = Pick<
  NativeMaterialRouteControlInput,
  "binding" | "reference"
>;
export type NativePreparationRouteInput = {
  schemaVersion: 1;
  protocol: "native-preparation-route.v1";
  eventId: string;
  preparationId: string;
} & ({ action: "stage" | "fail" } | { action: "attach"; original: NativePreparationRouteOriginal });
export interface NativePreparationRouteOutput {
  schemaVersion: 1;
  request: NativePreparationRouteInput;
  outcome: "ready" | "attached" | "terminal" | "pending";
  original: NativePreparationRouteOriginal | null;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
export function validateNativePreparationRouteOriginal(
  value: unknown,
): value is NativePreparationRouteOriginal {
  return (
    nativeOwnerClosed(value, ["binding", "reference"]) &&
    validateNativeMaterialRouteControlInput({
      schemaVersion: 1,
      protocol: "native-material-route.v1",
      action: "capture",
      ...value,
    })
  );
}
export function validateNativePreparationRouteInput(
  value: unknown,
): value is NativePreparationRouteInput {
  try {
    if (!value || typeof value !== "object") return false;
    const action = Object.getOwnPropertyDescriptor(value, "action");
    if (
      !action ||
      !("value" in action) ||
      !nativeOwnerClosed(value, [
        "schemaVersion",
        "protocol",
        "eventId",
        "preparationId",
        "action",
        ...(action.value === "attach" ? ["original"] : []),
      ])
    )
      return false;
    return (
      value.schemaVersion === 1 &&
      value.protocol === "native-preparation-route.v1" &&
      typeof value.eventId === "string" &&
      uuid.test(value.eventId) &&
      typeof value.preparationId === "string" &&
      uuid.test(value.preparationId) &&
      ["stage", "attach", "fail"].includes(value.action as string) &&
      (value.action !== "attach" ||
        (validateNativePreparationRouteOriginal(value.original) &&
          value.original.reference.generationId === value.preparationId)) &&
      Buffer.byteLength(JSON.stringify(value)) <= 8192
    );
  } catch {
    return false;
  }
}
export function validateNativePreparationRouteOutput(
  value: unknown,
): value is NativePreparationRouteOutput {
  try {
    if (
      !nativeOwnerClosed(value, ["schemaVersion", "request", "outcome", "original"]) ||
      value.schemaVersion !== 1 ||
      !validateNativePreparationRouteInput(value.request) ||
      Buffer.byteLength(JSON.stringify(value)) > 8192
    )
      return false;
    if (value.outcome === "ready")
      return (
        value.request.action === "stage" &&
        validateNativePreparationRouteOriginal(value.original) &&
        value.original.reference.generationId === value.request.preparationId
      );
    return (
      value.original === null &&
      (value.outcome === "pending" ||
        value.outcome === "terminal" ||
        (value.outcome === "attached" && value.request.action === "attach"))
    );
  } catch {
    return false;
  }
}
export const nativePreparationRouteUnavailable = () => Error("NativePreparationRouteUnavailable");
