import { isDeepStrictEqual } from "node:util";
import {
  type NativeEvidenceBinding,
  nativeEvidenceBinding,
} from "@ai-job-apply/documents-service/native-evidence-binding";
import type {
  NativeMaterialLaunchScope,
  PostgresNativeMaterialRegistry,
} from "@ai-job-apply/documents-service/native-material-registry";
import type { createNativeMaterialTaskAddressReader } from "@ai-job-apply/documents-service/native-material-task-address";
import {
  type NativeResumeRouteConfiguration,
  type NativeResumeRouteSnapshot,
  nativeResumeRouteConfiguration,
  nativeResumeRouteSnapshot,
} from "@ai-job-apply/documents-service/native-resume-route-policy";
import { nativeTaskLaunchScope } from "@ai-job-apply/documents-service/native-task-launch-policy";
import {
  type TemporaryMaterialReference,
  validateTemporaryMaterialReference,
} from "@ai-job-apply/documents-service/temporary-material-reference";

const unavailable = () => Error("NativeMaterialRouteOwnerUnavailable");
/** Private owner ports for one admitted original binding/reference, supplied by owning control
 * composition. No candidate-selected DNS, SQL across network awaits, task stop or content read. */
export function createNativeMaterialRouteOwner(options: {
  registry: Pick<PostgresNativeMaterialRegistry, "readLaunch" | "checkEvidenceAdmission">;
  address: Pick<ReturnType<typeof createNativeMaterialTaskAddressReader>, "read">;
  binding: NativeEvidenceBinding;
  reference: TemporaryMaterialReference;
  configurationSha256: string;
  route: NativeResumeRouteConfiguration;
  enabled?: () => boolean;
}) {
  const binding = nativeEvidenceBinding(options.binding);
  const route = nativeResumeRouteConfiguration(options.route);
  const sha = options.configurationSha256;
  if (
    !/^[a-f0-9]{64}$/u.test(sha) ||
    !validateTemporaryMaterialReference(options.reference) ||
    options.reference.kind !== "cover_letter"
  )
    throw unavailable();
  const reference = Object.freeze(structuredClone(options.reference));
  for (const key of ["ownerUserId", "applicationId", "generationId"] as const)
    if (reference[key] !== binding.scope[key]) throw unavailable();
  const enabled = options.enabled ?? (() => false);
  const check = () => {
    if (!enabled()) throw unavailable();
  };
  function scope(input: NativeMaterialLaunchScope) {
    const value = nativeTaskLaunchScope(input);
    if (!isDeepStrictEqual(value, binding.scope)) throw unavailable();
    return value;
  }
  async function original(input: NativeMaterialLaunchScope) {
    check();
    const fixed = scope(input);
    const row = structuredClone(await options.registry.readLaunch(fixed, sha));
    check();
    const { state, allocation, ...identity } = row.intent;
    if (
      !isDeepStrictEqual(identity, binding.scope) ||
      !isDeepStrictEqual(allocation, binding.allocation) ||
      !isDeepStrictEqual(row.original, binding.original) ||
      row.configurationSha256 !== sha ||
      !Number.isSafeInteger(row.claimedAtEpochMs) ||
      (row.claimedAtEpochMs ?? 0) <= 0
    )
      throw unavailable();
    for (const key of ["clusterArn", "taskDefinitionArn", "containerName"] as const)
      if (row.deployment[key] !== binding.allocation[key]) throw unavailable();
    return state;
  }
  async function admitted(input: NativeMaterialLaunchScope) {
    if ((await original(input)) !== "bound" || Date.now() >= reference.expiresAtMs)
      throw unavailable();
    await options.registry.checkEvidenceAdmission(binding);
    check();
    if (Date.now() >= reference.expiresAtMs) throw unavailable();
  }
  async function capture(input: NativeMaterialLaunchScope): Promise<NativeResumeRouteSnapshot> {
    try {
      const fixed = scope(input);
      await admitted(fixed);
      const address = await options.address.read({ scope: fixed, reference });
      check();
      await admitted(fixed);
      if (
        address.allocationId !== fixed.allocationId ||
        address.taskArn !== binding.allocation.taskArn ||
        address.expiresAtMs !== reference.expiresAtMs
      )
        throw unavailable();
      return nativeResumeRouteSnapshot({
        intent: { ...route, allocationId: fixed.allocationId, publicIp: address.publicIp },
        expiresAtMs: reference.expiresAtMs,
      });
    } catch {
      throw unavailable();
    }
  }
  return Object.freeze({
    capture,
    async admit(input: NativeMaterialLaunchScope, snapshot: NativeResumeRouteSnapshot) {
      const expected = nativeResumeRouteSnapshot(snapshot);
      return isDeepStrictEqual(await capture(input), expected);
    },
    async retired(input: NativeMaterialLaunchScope) {
      try {
        // Sealed/expired admission prevents creation, not observation of original retirement.
        return (await original(input)) === "retired";
      } catch {
        throw unavailable();
      }
    },
  });
}
