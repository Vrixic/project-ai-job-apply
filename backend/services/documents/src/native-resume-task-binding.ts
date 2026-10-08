import { createHash } from "node:crypto";
import { nativeLaunchControlVersion } from "./native-launch-control-contract.js";
import { nativeOwnerClosed } from "./native-owner-rpc-contract.js";
import type { NativeResumeGenerationScope } from "./native-resume-generation-store.js";
import { type NativeTaskAllocation, nativeTaskAllocationRegion } from "./native-task-allocation.js";

export interface NativeResumeTaskBinding {
  schemaVersion: 1;
  kind: "tailored_resume";
  scope: NativeResumeGenerationScope;
  allocation: NativeTaskAllocation;
  configurationSha256: string;
}
const unavailable = () => Error("NativeResumeTaskBindingUnavailable");
const scopeKeys = [
  "allocationId",
  "ownerUserId",
  "applicationId",
  "generationId",
  "epochId",
] as const;
const allocationKeys = [
  "allocationId",
  "ownerUserId",
  "applicationId",
  "generationId",
  "clusterArn",
  "taskArn",
  "taskDefinitionArn",
  "containerName",
] as const;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const hash = /^[a-f0-9]{64}$/u;

/** Scalar original resume allocation only. No provider work/consent authority is manufactured. */
export function nativeResumeTaskBinding(raw: unknown): Readonly<NativeResumeTaskBinding> {
  try {
    if (
      !nativeOwnerClosed(raw, [
        "schemaVersion",
        "kind",
        "scope",
        "allocation",
        "configurationSha256",
      ]) ||
      raw.schemaVersion !== 1 ||
      raw.kind !== "tailored_resume" ||
      !nativeOwnerClosed(raw.scope, scopeKeys) ||
      !nativeOwnerClosed(raw.allocation, allocationKeys) ||
      typeof raw.configurationSha256 !== "string" ||
      !hash.test(raw.configurationSha256)
    )
      throw unavailable();
    const scope = raw.scope,
      allocation = raw.allocation;
    if (
      !scopeKeys.every(
        (key) => typeof scope[key] === "string" && uuid.test(scope[key] as string),
      ) ||
      !allocationKeys.every((key) => typeof allocation[key] === "string") ||
      !scopeKeys
        .filter((key) => key !== "epochId")
        .every((key) => scope[key] === allocation[key]) ||
      nativeTaskAllocationRegion(allocation as unknown as NativeTaskAllocation) !== "us-east-2"
    )
      throw unavailable();
    const fixed = structuredClone(raw) as unknown as NativeResumeTaskBinding;
    return Object.freeze({
      ...fixed,
      scope: Object.freeze(fixed.scope),
      allocation: Object.freeze(fixed.allocation),
    });
  } catch {
    throw unavailable();
  }
}

export function nativeResumeTaskCallerScope(raw: NativeResumeTaskBinding, targetArn: string) {
  const binding = nativeResumeTaskBinding(raw);
  nativeLaunchControlVersion(targetArn);
  const account = binding.allocation.clusterArn.split(":")[4];
  if (!targetArn.startsWith(`arn:aws:lambda:us-east-2:${account}:function:`)) throw unavailable();
  const metadata = [
    "native-resume-task-caller.v1",
    targetArn,
    ...scopeKeys.map((key) => binding.scope[key]),
    ...allocationKeys.slice(4).map((key) => binding.allocation[key]),
    binding.configurationSha256,
  ];
  return Object.freeze({
    binding,
    targetArn,
    digest(requestSha256: string) {
      if (typeof requestSha256 !== "string" || !hash.test(requestSha256)) throw unavailable();
      return createHash("sha256")
        .update(JSON.stringify([...metadata, requestSha256]))
        .digest("hex");
    },
  });
}
