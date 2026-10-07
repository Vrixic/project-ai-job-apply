import { createHash } from "node:crypto";
import type {
  NativeResumeGenerationScope,
  PostgresNativeResumeGenerationStore,
} from "./native-resume-generation-store.js";
import {
  createNativeTaskAddressReader,
  type NativeTaskAddressTestClients,
} from "./native-task-address.js";
import {
  type NativeTaskLaunchConfiguration,
  nativeResumeLaunchEnvironment,
  nativeTaskLaunchConfiguration,
} from "./native-task-launch-policy.js";

/** Original ready resume only; metadata lookup does not authorize a content read. */
export function createNativeResumeTaskAddressReader(options: {
  registry: Pick<PostgresNativeResumeGenerationStore, "readLaunch">;
  configuration: NativeTaskLaunchConfiguration;
  enabled?: () => boolean;
  timeoutMs?: number;
  testClients?: NativeTaskAddressTestClients;
}) {
  const config = nativeTaskLaunchConfiguration(options.configuration);
  const sha = createHash("sha256")
    .update(JSON.stringify({ protocol: "native-resume-launch.v1", ...config }))
    .digest("hex");
  const readLaunch = options.registry.readLaunch.bind(options.registry);
  const unavailable = () => Error("NativeResumeTaskAddressUnavailable");
  return createNativeTaskAddressReader<NativeResumeGenerationScope>({
    ...options,
    configuration: config,
    kind: "tailored_resume",
    unavailable,
    scope: (input) => input,
    async original(_input, scope) {
      const row = structuredClone(await readLaunch(scope, sha));
      if (
        row.state !== "bound" ||
        !row.ready ||
        !row.allocation ||
        !row.reference ||
        row.allocationId !== scope.allocationId ||
        row.epochId !== scope.epochId ||
        row.configurationSha256 !== sha
      )
        throw unavailable();
      for (const key of ["ownerUserId", "applicationId", "generationId"] as const)
        if (row.reservation.identity[key] !== scope[key]) throw unavailable();
      for (const key of ["clusterArn", "taskDefinitionArn", "containerName"] as const)
        if (row.reservation.deployment[key] !== config[key]) throw unavailable();
      return {
        allocation: row.allocation,
        reference: row.reference,
        environment: nativeResumeLaunchEnvironment(scope, sha),
      };
    },
  });
}
