import { createHash } from "node:crypto";
import type {
  NativeResumeGenerationScope,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";
import { nativeTaskAllocationRegion } from "./native-task-allocation.js";
import {
  type NativeTaskLaunchConfiguration,
  nativeTaskLaunchConfiguration,
  nativeTaskLaunchScope,
} from "./native-task-launch-policy.js";
import { createNativeTaskRetirement } from "./native-task-retirement.js";

const unavailable = () => Error("NativeResumeTaskObservationUnavailable");

/** Trusted private metadata composition. The original registry chooses the task; callers
 * cannot submit a task ARN, terminal timestamp or retirement receipt. No task-stop capability.
 * This records positive task termination, not all-copy disposal or application completion. */
export function createNativeResumeTaskObserver(options: {
  registry: Pick<PostgresNativeResumeGenerationStore, "readLaunch" | "recordRetirement">;
  configuration: NativeTaskLaunchConfiguration;
  enabled?: () => boolean;
  testClient?: Parameters<typeof createNativeTaskRetirement>[0]["testClient"];
}) {
  const config = nativeTaskLaunchConfiguration(options.configuration);
  const sha = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-resume-launch.v1", ...config }))
    .digest("hex");
  const enabled = options.enabled ?? (() => false);
  const check = () => {
    if (!enabled() || (options.testClient && process.env.NODE_ENV !== "test")) throw unavailable();
  };
  let active = false;
  return Object.freeze({
    async observe(input: NativeResumeGenerationScope) {
      if (active) throw unavailable();
      const scope = nativeTaskLaunchScope(input);
      check();
      active = true;
      try {
        const record = structuredClone(await options.registry.readLaunch(scope, sha));
        check();
        const allocation = record.allocation;
        if (
          !allocation ||
          !["bound", "retired"].includes(record.state) ||
          record.epochId !== scope.epochId ||
          record.allocationId !== scope.allocationId ||
          record.configurationSha256 !== sha
        )
          throw unavailable();
        nativeTaskAllocationRegion(allocation);
        for (const key of ["ownerUserId", "applicationId", "generationId", "allocationId"] as const)
          if (allocation[key] !== scope[key]) throw unavailable();
        for (const key of ["clusterArn", "taskDefinitionArn", "containerName"] as const)
          if (allocation[key] !== config[key] || record.reservation.deployment[key] !== config[key])
            throw unavailable();
        for (const key of ["ownerUserId", "applicationId", "generationId"] as const)
          if (record.reservation.identity[key] !== scope[key]) throw unavailable();
        if (record.state !== "retired") {
          const observer = createNativeTaskRetirement({
            allocation,
            enabled,
            maximumObservations: 1,
            ...(options.testClient ? { testClient: options.testClient } : {}),
          });
          const receipt = await observer.observe(scope);
          check();
          await options.registry.recordRetirement(receipt);
          check();
        }
        return Object.freeze({
          schemaVersion: 1 as const,
          outcome: "retired" as const,
          allocationId: scope.allocationId,
          taskArn: allocation.taskArn,
        });
      } catch {
        throw unavailable();
      } finally {
        active = false;
      }
    },
  });
}
