import { nativeOwnerClosed } from "./native-owner-rpc-contract.js";
import {
  type NativeResumeGenerationScope,
  type NativeResumeReservation,
  nativeResumeReservation,
} from "./native-resume-generation-store.js";
import {
  type NativeResumeRouteSnapshot,
  nativeResumeRouteSnapshot,
} from "./native-resume-route-policy.js";
export type NativeResumePreparationControlInput =
  | { schemaVersion: 1; action: "start"; reservation: NativeResumeReservation }
  | { schemaVersion: 1; action: "complete"; scope: NativeResumeGenerationScope }
  | {
      schemaVersion: 1;
      action: "route_capture" | "route_retired";
      scope: NativeResumeGenerationScope;
    }
  | {
      schemaVersion: 1;
      action: "route_admit";
      scope: NativeResumeGenerationScope;
      route: NativeResumeRouteSnapshot;
    }
  | { schemaVersion: 1; action: "recover"; scope: NativeResumeGenerationScope; taskArn: string };
export interface NativeResumePreparationControlOutput {
  schemaVersion: 1;
  request: NativeResumePreparationControlInput;
  outcome:
    | "reserved"
    | "pending"
    | "ready"
    | "captured"
    | "unavailable"
    | "route_captured"
    | "admitted"
    | "retired";
  scope: NativeResumeGenerationScope | null;
  packet: { id: string; revision: number } | null;
  route?: NativeResumeRouteSnapshot;
}
export const nativeResumePreparationControlUnavailable = () =>
  Error("NativeResumePreparationControlUnavailable");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
function scope(value: unknown): value is NativeResumeGenerationScope {
  return (
    nativeOwnerClosed(value, [
      "ownerUserId",
      "applicationId",
      "generationId",
      "allocationId",
      "epochId",
    ]) && Object.values(value).every((entry) => typeof entry === "string" && uuid.test(entry))
  );
}
export function validateNativeResumePreparationControlInput(
  raw: unknown,
): raw is NativeResumePreparationControlInput {
  try {
    if (!raw || typeof raw !== "object") return false;
    const value = raw as Record<string, unknown>;
    if (Buffer.byteLength(JSON.stringify(value)) > 8192) return false;
    if (value.action === "start") {
      if (
        !nativeOwnerClosed(value, ["schemaVersion", "action", "reservation"]) ||
        value.schemaVersion !== 1
      )
        return false;
      nativeResumeReservation(value.reservation as NativeResumeReservation);
      return true;
    }
    if (
      value.action === "complete" ||
      value.action === "route_capture" ||
      value.action === "route_retired"
    )
      return (
        nativeOwnerClosed(value, ["schemaVersion", "action", "scope"]) &&
        value.schemaVersion === 1 &&
        scope(value.scope)
      );
    if (value.action === "route_admit") {
      if (
        !nativeOwnerClosed(value, ["schemaVersion", "action", "scope", "route"]) ||
        value.schemaVersion !== 1 ||
        !scope(value.scope)
      )
        return false;
      const route = nativeResumeRouteSnapshot(value.route as NativeResumeRouteSnapshot);
      return route.intent.allocationId === value.scope.allocationId;
    }
    return (
      value.action === "recover" &&
      nativeOwnerClosed(value, ["schemaVersion", "action", "scope", "taskArn"]) &&
      value.schemaVersion === 1 &&
      scope(value.scope) &&
      typeof value.taskArn === "string" &&
      /^arn:aws:ecs:us-east-2:[0-9]{12}:task\/[A-Za-z0-9_-]{1,255}\/[a-f0-9]{32}$/u.test(
        value.taskArn,
      )
    );
  } catch {
    return false;
  }
}
export function validateNativeResumePreparationControlOutput(
  value: unknown,
): value is NativeResumePreparationControlOutput {
  try {
    if (
      !nativeOwnerClosed(value, [
        "schemaVersion",
        "request",
        "outcome",
        "scope",
        "packet",
        ...((value as { outcome?: unknown })?.outcome === "route_captured" ? ["route"] : []),
      ]) ||
      value.schemaVersion !== 1 ||
      !validateNativeResumePreparationControlInput(value.request) ||
      Buffer.byteLength(JSON.stringify(value)) > 8192
    )
      return false;
    if (value.outcome === "unavailable") return value.scope === null && value.packet === null;
    if (!scope(value.scope)) return false;
    const expected =
      value.request.action === "start" ? value.request.reservation.identity : value.request.scope;
    for (const key of ["ownerUserId", "applicationId", "generationId"] as const)
      if (value.scope[key] !== expected[key]) return false;
    if (
      value.request.action !== "start" &&
      (value.scope.allocationId !== value.request.scope.allocationId ||
        value.scope.epochId !== value.request.scope.epochId)
    )
      return false;
    if (value.outcome === "reserved")
      return value.request.action === "start" && value.packet === null;
    if (value.outcome === "captured")
      return value.request.action === "recover" && value.packet === null;
    if (value.outcome === "pending")
      return (
        ["complete", "route_capture", "route_retired"].includes(value.request.action) &&
        value.packet === null
      );
    if (value.outcome === "route_captured") {
      const route = nativeResumeRouteSnapshot(value.route as NativeResumeRouteSnapshot);
      return (
        value.request.action === "route_capture" &&
        value.packet === null &&
        route.intent.allocationId === value.scope.allocationId
      );
    }
    if (value.outcome === "admitted")
      return value.request.action === "route_admit" && value.packet === null;
    if (value.outcome === "retired")
      return value.request.action === "route_retired" && value.packet === null;
    return (
      value.outcome === "ready" &&
      value.request.action === "complete" &&
      nativeOwnerClosed(value.packet, ["id", "revision"]) &&
      typeof value.packet.id === "string" &&
      uuid.test(value.packet.id) &&
      Number.isSafeInteger(value.packet.revision) &&
      Number(value.packet.revision) >= 1
    );
  } catch {
    return false;
  }
}
