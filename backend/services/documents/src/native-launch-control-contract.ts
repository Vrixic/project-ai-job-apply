import type { CoverLetterWorkReference } from "./cover-letter-work-store.js";
import type { NativeMaterialLaunchScope } from "./native-material-registry.js";
import { type NativeTaskAllocation, nativeTaskAllocationRegion } from "./native-task-allocation.js";

export type NativeLaunchControlInput =
  | {
      schemaVersion: 1;
      action: "launch";
      ownerUserId: string;
      applicationId: string;
      original: CoverLetterWorkReference;
      previousEpochId: string | null;
    }
  | {
      schemaVersion: 1;
      action: "recover";
      scope: NativeMaterialLaunchScope;
      taskArn: string;
    };
export interface NativeLaunchControlCapture {
  scope: NativeMaterialLaunchScope;
  allocation: NativeTaskAllocation;
}
export interface NativeLaunchControlOutput {
  schemaVersion: 1;
  request: NativeLaunchControlInput;
  outcome: "captured" | "unavailable";
  capture: NativeLaunchControlCapture | null;
}
export const nativeLaunchControlUnavailable = () => Error("NativeLaunchControlUnavailable");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const id = (value: unknown): value is string => typeof value === "string" && uuid.test(value);
function closed(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    return false;
  return (
    Reflect.ownKeys(value).length === keys.length &&
    keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable && "value" in descriptor;
    })
  );
}
export function nativeLaunchControlScope(value: unknown): value is NativeMaterialLaunchScope {
  return (
    closed(value, ["allocationId", "ownerUserId", "applicationId", "generationId", "epochId"]) &&
    Object.values(value).every(id)
  );
}
export function validateNativeLaunchControlInput(
  value: unknown,
): value is NativeLaunchControlInput {
  try {
    if (
      closed(value, [
        "schemaVersion",
        "action",
        "ownerUserId",
        "applicationId",
        "original",
        "previousEpochId",
      ])
    ) {
      const work = value.original;
      return (
        value.schemaVersion === 1 &&
        value.action === "launch" &&
        id(value.ownerUserId) &&
        id(value.applicationId) &&
        (value.previousEpochId === null || id(value.previousEpochId)) &&
        closed(work, ["id", "documentId", "purpose", "requestSha256"]) &&
        id(work.id) &&
        id(work.documentId) &&
        work.purpose === "provider_dispatch" &&
        typeof work.requestSha256 === "string" &&
        /^[a-f0-9]{64}$/u.test(work.requestSha256)
      );
    }
    return (
      closed(value, ["schemaVersion", "action", "scope", "taskArn"]) &&
      value.schemaVersion === 1 &&
      value.action === "recover" &&
      nativeLaunchControlScope(value.scope) &&
      typeof value.taskArn === "string" &&
      /^arn:aws:ecs:us-east-2:[0-9]{12}:task\/[A-Za-z0-9_-]{1,255}\/[a-f0-9]{32}$/u.test(
        value.taskArn,
      )
    );
  } catch {
    return false;
  }
}
export function validateNativeLaunchControlOutput(
  value: unknown,
): value is NativeLaunchControlOutput {
  try {
    if (
      !closed(value, ["schemaVersion", "request", "outcome", "capture"]) ||
      value.schemaVersion !== 1 ||
      !validateNativeLaunchControlInput(value.request)
    )
      return false;
    if (value.outcome === "unavailable") return value.capture === null;
    const capture = value.capture;
    if (
      value.outcome !== "captured" ||
      !closed(capture, ["scope", "allocation"]) ||
      !nativeLaunchControlScope(capture.scope) ||
      !closed(capture.allocation, [
        "allocationId",
        "ownerUserId",
        "applicationId",
        "generationId",
        "clusterArn",
        "taskArn",
        "taskDefinitionArn",
        "containerName",
      ])
    )
      return false;
    const allocation = capture.allocation as unknown as NativeTaskAllocation;
    const scope = capture.scope;
    if (
      nativeTaskAllocationRegion(allocation) !== "us-east-2" ||
      !["allocationId", "ownerUserId", "applicationId", "generationId"].every(
        (key) =>
          scope[key as keyof NativeMaterialLaunchScope] ===
          allocation[key as keyof NativeTaskAllocation],
      )
    )
      return false;
    const request = value.request;
    return request.action === "recover"
      ? Object.keys(request.scope).every(
          (key) =>
            request.scope[key as keyof NativeMaterialLaunchScope] ===
            scope[key as keyof NativeMaterialLaunchScope],
        ) && request.taskArn === allocation.taskArn
      : request.ownerUserId === allocation.ownerUserId &&
          request.applicationId === allocation.applicationId &&
          request.original.documentId === allocation.generationId;
  } catch {
    return false;
  }
}
export function nativeLaunchControlVersion(arn: string): string {
  const version =
    /^arn:aws:lambda:us-east-2:[0-9]{12}:function:[A-Za-z0-9_-]{1,64}:([1-9][0-9]{0,8})$/u.exec(
      arn,
    )?.[1];
  if (!version) throw nativeLaunchControlUnavailable();
  return version;
}
