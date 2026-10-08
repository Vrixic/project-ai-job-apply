import { isDeepStrictEqual } from "node:util";
import type {
  NativeResumeGenerationScope,
  PostgresNativeResumeGenerationStore,
} from "@ai-job-apply/documents-service/native-resume-generation-store";
import {
  type NativeResumeRouteConfiguration,
  type NativeResumeRouteSnapshot,
  nativeResumeRouteConfiguration,
  nativeResumeRouteSnapshot,
} from "@ai-job-apply/documents-service/native-resume-route-policy";
import type { createNativeResumeTaskAddressReader } from "@ai-job-apply/documents-service/native-resume-task-address";
import { nativeTaskLaunchScope } from "@ai-job-apply/documents-service/native-task-launch-policy";

const unavailable = () => Error("NativeResumeRouteOwnerUnavailable");
/** Private original-route owner ports. No DNS mutation, packet attachment or task-stop capability. */
export function createNativeResumeRouteOwner(options: {
  generations: Pick<PostgresNativeResumeGenerationStore, "readRouteAdmission" | "readLaunch">;
  address: Pick<ReturnType<typeof createNativeResumeTaskAddressReader>, "read">;
  configurationSha256: string;
  route: NativeResumeRouteConfiguration;
  enabled?: () => boolean;
}) {
  const route = nativeResumeRouteConfiguration(options.route);
  const sha = options.configurationSha256;
  if (!/^[a-f0-9]{64}$/u.test(sha)) throw unavailable();
  const enabled = options.enabled ?? (() => false);
  const check = () => {
    if (!enabled()) throw unavailable();
  };
  async function capture(
    input: NativeResumeGenerationScope,
  ): Promise<NativeResumeRouteSnapshot | null> {
    try {
      check();
      const scope = nativeTaskLaunchScope(input);
      const original = await options.generations.readRouteAdmission(scope, sha);
      check();
      if (!original) return null;
      const address = await options.address.read(scope);
      check();
      const fresh = await options.generations.readRouteAdmission(scope, sha);
      check();
      if (
        !fresh ||
        !isDeepStrictEqual(original, fresh) ||
        !fresh.reference ||
        !fresh.allocation ||
        address.allocationId !== scope.allocationId ||
        address.taskArn !== fresh.allocation.taskArn ||
        address.expiresAtMs !== fresh.reference.expiresAtMs ||
        Date.now() >= address.expiresAtMs
      )
        throw unavailable();
      return nativeResumeRouteSnapshot({
        intent: { ...route, allocationId: scope.allocationId, publicIp: address.publicIp },
        expiresAtMs: address.expiresAtMs,
      });
    } catch {
      throw unavailable();
    }
  }
  return Object.freeze({
    capture,
    async admit(scope: NativeResumeGenerationScope, snapshot: NativeResumeRouteSnapshot) {
      const expected = nativeResumeRouteSnapshot(snapshot);
      return isDeepStrictEqual(await capture(scope), expected);
    },
    async retired(input: NativeResumeGenerationScope) {
      try {
        check();
        const scope = nativeTaskLaunchScope(input);
        const row = await options.generations.readLaunch(scope, sha);
        check();
        return row.state === "retired";
      } catch {
        throw unavailable();
      }
    },
  });
}
